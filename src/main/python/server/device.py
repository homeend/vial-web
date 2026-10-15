# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
import logging
import threading
import time
from collections import namedtuple

from protocol.keyboard_comm import Keyboard
from simulator.device import SimulatedHidDevice

log = logging.getLogger(__name__)

RETRY_FIRST = 2.0
""" seconds before a keyboard that failed to load is tried again; the wait doubles after each failure... """
RETRY_MAX = 30.0
""" ...up to this many seconds """
PRESENT_ERROR_LOG_INTERVAL = 60.0
""" a backend that keeps failing to tell whether the keyboard is plugged in is logged at most this often (seconds) """

Status = namedtuple("Status", "connected title unlocked error")


class NotConnected(RuntimeError):
    pass


class KeyboardLocked(RuntimeError):
    pass


class DeviceIOError(RuntimeError):
    """ The HID handle itself failed (it is closed or no longer valid), as opposed to a request that was refused """


def require_unlocked(keyboard):
    """ Unlock handler for the server: the web UI can't run the unlock flow yet, so refuse instead """
    if keyboard.get_unlock_status() != 1:
        raise KeyboardLocked("the keyboard is locked; unlock it in the Qt app to change security-sensitive keys")
    return True


class CheckedDevice:
    """
    Wraps an open HID handle for the protocol layer.

    - hidapi raises ValueError for a closed or invalid handle. That is a transport failure, not a bad request,
      so it becomes DeviceIOError (which the protocol's retries don't swallow, and the API reports as 502).
    - Remembers whether the last exchange with the keyboard worked, so the hot-plug poll can tell a dead handle
      from a request that failed for another reason.
    - Once a request has failed on it while it wasn't working (broken), every further exchange fails at once,
      instead of going through the protocol's retries (seconds each, holding the device lock) until the hot-plug
      poll reopens it. Within one request the retries still run, so a handle that recovers is kept.
    """

    def __init__(self, dev):
        self.dev = dev
        self.healthy = True
        self.broken = False

    def _check_usable(self):
        if self.broken:
            raise DeviceIOError("the connection to the keyboard is broken; waiting for it to be reopened")

    def write(self, data):
        self._check_usable()
        try:
            written = self.dev.write(data)
        except ValueError as e:
            self.healthy = False
            raise DeviceIOError("the connection to the keyboard is broken ({})".format(e)) from e
        except OSError:
            self.healthy = False
            raise
        if written != len(data):
            self.healthy = False
        return written

    def read(self, length, timeout_ms=0):
        self._check_usable()
        try:
            data = self.dev.read(length, timeout_ms=timeout_ms)
        except ValueError as e:
            self.healthy = False
            raise DeviceIOError("the connection to the keyboard is broken ({})".format(e)) from e
        except OSError:
            self.healthy = False
            raise
        # no reply in time: the keyboard isn't answering (yet); a later reply makes the handle healthy again
        self.healthy = bool(data)
        return data

    def __getattr__(self, name):
        return getattr(self.dev, name)


class FakeBackend:
    """ Serves one simulated keyboard. Never touches hidapi. """

    fake = True

    def __init__(self, keyboard_factory):
        self.keyboard_factory = keyboard_factory
        self.virtual = None

    def find(self):
        if self.virtual is None:
            self.virtual = self.keyboard_factory()
        return ["simulated"] if self.virtual.connected else []

    def open(self, candidate):
        return SimulatedHidDevice(self.virtual), "Simulated: " + self.virtual.definition.get("name", "keyboard")

    def present(self, candidate):
        return self.virtual is not None and self.virtual.connected


class HidBackend:
    """ Real keyboards through hidapi; imported lazily so fake mode never loads hidapi """

    fake = False

    def find(self):
        from server.hid_discovery import find_vial_keyboards
        return find_vial_keyboards()

    def open(self, desc):
        from hidproxy import hid
        dev = hid.device()
        dev.open_path(desc["path"])
        title = "{} {}".format(desc.get("manufacturer_string", ""), desc.get("product_string", "")).strip()
        return dev, title or "Vial keyboard"

    def present(self, desc):
        from hidproxy import hid
        # only this keyboard's interfaces: enumerating everything is slow on some systems
        listed = hid.enumerate(desc.get("vendor_id", 0), desc.get("product_id", 0))
        return any(d["path"] == desc["path"] for d in listed)


def candidate_key(candidate):
    """ What identifies a candidate between two find() calls: its HID path """
    return candidate.get("path") if isinstance(candidate, dict) else candidate


class DeviceManager:
    """
    Owns the open keyboard. All access goes through run() (or reload()), which hold the device lock.

    check() is the hot-plug poll (about once a second) and the one place where the connection is repaired:
    - an unplugged keyboard is closed ("disconnected");
    - a keyboard whose handle stopped working while it is still listed (a replug on the same port within one poll,
      a USB reset) is closed and reopened ("disconnected", then "connected"). The request that hit the dead handle
      still fails: writes are not retried, since they are not known to be safe to repeat. Requests made before the
      poll reopens it fail at once;
    - a keyboard whose presence can't be checked (the backend raises) is kept as it is;
    - with no keyboard, the first one found is opened and loaded ("connected"). One that fails to load is not tried
      again for RETRY_FIRST seconds, doubling up to RETRY_MAX, unless it is unplugged and plugged back in.
    """

    def __init__(self, backend, clock=time.monotonic):
        self.backend = backend
        self.clock = clock
        self.lock = threading.RLock()
        self.keyboard = None
        self.device = None
        self.handle = None
        self.candidate = None
        self.title = None
        self.error = None
        self.unlocked = False
        self.pending_events = []
        self.failures = {}
        """ candidate key -> (failed attempts, clock time of the next attempt) """
        self.present_error_logged = None
        """ clock time a failing present() was last logged """

    @property
    def connected(self):
        return self.keyboard is not None

    def status(self):
        """ connected, title, unlocked and error, read together """
        with self.lock:
            return Status(self.keyboard is not None, self.title, self.unlocked, self.error)

    def connect(self):
        """ Open the first keyboard found and load everything from it. Returns True when connected. """
        return self._connect(wait_after_failures=False)

    def _connect(self, wait_after_failures):
        with self.lock:
            self._close()
            try:
                candidates = list(self.backend.find())
            except Exception as e:
                log.exception("could not list keyboards")
                self.error = "could not list keyboards: {}".format(e)
                return False
            if not candidates:
                self.error = None
            listed = {candidate_key(c) for c in candidates}
            # a keyboard that went away and came back gets a fresh start
            self.failures = {k: v for k, v in self.failures.items() if k in listed}
            for candidate in candidates:
                key = candidate_key(candidate)
                if wait_after_failures and key in self.failures and self.clock() < self.failures[key][1]:
                    continue
                dev = None
                try:
                    dev, title = self.backend.open(candidate)
                    handle = CheckedDevice(dev)
                    keyboard = Keyboard(handle)
                    keyboard.reload()
                    unlocked = keyboard.get_unlock_status() == 1
                except Exception as e:
                    log.warning("could not load keyboard %s: %s", candidate, e)
                    self.error = str(e) or e.__class__.__name__
                    self._failed(key)
                    if dev is not None:
                        self._close_device(dev)
                    continue
                self.failures.pop(key, None)
                self.keyboard, self.device, self.handle = keyboard, dev, handle
                self.candidate, self.title = candidate, title
                self.unlocked, self.error = unlocked, None
                log.info("connected to %s", title)
                return True
            return False

    def _failed(self, key):
        attempts = self.failures.get(key, (0, 0))[0] + 1
        wait = min(RETRY_FIRST * 2 ** (attempts - 1), RETRY_MAX)
        self.failures[key] = (attempts, self.clock() + wait)

    def reload(self):
        """ Read everything from the keyboard again. If that fails, the keyboard is closed: Keyboard.reload starts by
        clearing what it had loaded, so a half-loaded keyboard must not stay in use. """
        def do_reload(keyboard):
            keyboard.reload()
            self.unlocked = keyboard.get_unlock_status() == 1
        with self.lock:
            try:
                self.run(do_reload)
            except NotConnected:
                raise
            except Exception as e:
                log.warning("could not reload the keyboard: %s", e)
                self._close()
                self.error = str(e) or e.__class__.__name__
                self.pending_events.append("disconnected")
                raise

    def run(self, fn):
        """ Call fn(keyboard) while holding the device lock """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            try:
                return fn(self.keyboard)
            except (OSError, RuntimeError) as e:
                if isinstance(e, (NotConnected, KeyboardLocked)) or self._present() is not False:
                    # still plugged in (or the backend can't tell): if the handle itself stopped working, later
                    # requests fail at once until check() reopens it
                    if self.handle is not None and not self.handle.healthy:
                        self.handle.broken = True
                    raise
                self._close()
                self.pending_events.append("disconnected")
                raise NotConnected("keyboard disconnected") from e

    def check(self):
        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
        with self.lock:
            if self.keyboard is not None:
                if self._present() is False:
                    self._close()
                    self.pending_events.append("disconnected")
                elif not self.handle.healthy:
                    log.warning("%s stopped answering; reopening it", self.title)
                    self._close()
                    self.pending_events.append("disconnected")
            if self.keyboard is None and self._connect(wait_after_failures=True):
                self.pending_events.append("connected")
            events, self.pending_events = self.pending_events, []
            return events

    def _present(self):
        """ Whether the open keyboard is still plugged in, or None when the backend can't tell (it raised). Unknown
        keeps the keyboard: treating it as unplugged would close and reload it on every poll while it works. An
        unplug still shows up as a dead handle, which check() reopens. """
        try:
            return bool(self.backend.present(self.candidate))
        except Exception:
            now = self.clock()
            if self.present_error_logged is None or now - self.present_error_logged >= PRESENT_ERROR_LOG_INTERVAL:
                self.present_error_logged = now
                log.exception("could not check whether the keyboard is still connected; assuming it is")
            return None

    def close(self):
        """ Let go of the keyboard: the server is stopping """
        with self.lock:
            self._close()

    @staticmethod
    def _close_device(dev):
        try:
            dev.close()
        except Exception as e:
            log.warning("could not close the keyboard: %s", e)

    def _close(self):
        if self.device is not None:
            self._close_device(self.device)
        self.keyboard = self.device = self.handle = self.candidate = self.title = None
        self.unlocked = False
