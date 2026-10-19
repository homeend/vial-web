# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
import logging
import struct
import threading
import time
from collections import namedtuple
from dataclasses import dataclass

from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID
from protocol.keyboard_comm import Keyboard
from simulator.device import SimulatedHidDevice

log = logging.getLogger(__name__)

RETRY_FIRST = 2.0
""" seconds before a keyboard that failed to load is tried again; the wait doubles after each failure... """
RETRY_MAX = 30.0
""" ...up to this many seconds """
PRESENT_ERROR_LOG_INTERVAL = 60.0
""" a backend that keeps failing to tell whether the keyboard is plugged in is logged at most this often (seconds) """

SAFE_UNLOCK_POLL_GAP = 0.15
""" seconds the real app's device manager leaves at least between two unlock requests (unlock_start, unlock_poll).
The firmware (vial-qmk quantum/vial.c) counts down only on a poll that comes more than 100 ms after the unlock start or
its last count-down: any sooner poll starts the countdown over, so polls that come too fast never unlock it. """

Status = namedtuple("Status", "connected title unlocked error")


class NotConnected(RuntimeError):
    pass


class KeyboardLocked(RuntimeError):
    pass


class DeviceIOError(RuntimeError):
    """ The HID handle itself failed (it is closed or no longer valid), as opposed to a request that was refused """


def require_unlocked(keyboard):
    """ Unlock handler for the server (protocol.unlock_hook). The protocol calls it before a security-sensitive write
    (a macro, QK_BOOT). Unlocking needs the user to hold keys, which the UI asks for, so a locked keyboard refuses the
    write (KeyboardLocked, 423): the UI then unlocks it (POST /api/unlock/start) and sends the change again. """
    if keyboard.get_unlock_status() != 1:
        raise KeyboardLocked("the keyboard is locked: unlock it to make this change")
    return True


def interrupted_unlock_keys(keyboard):
    """ The unlock keys, if the keyboard is still waiting for an unlock started earlier (by a Vial closed meanwhile),
    else None. Asked before anything else is read: while it waits, the keyboard answers only its identity and unlock
    requests, and sends every other request back unanswered. """
    data = keyboard.usb_send(keyboard.dev, struct.pack("BB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID),
                             retries=20)
    # what the unlock requests check, as Keyboard.reload_layout sets it
    keyboard.vial_protocol = struct.unpack("<I", data[0:4])[0]
    return keyboard.get_unlock_keys() if keyboard.get_unlock_in_progress() else None


@dataclass(frozen=True)
class UnlockState:
    """ Whether the keyboard is unlocked, and how far an unlock has got (schemas.UnlockState) """
    state: str
    """ "locked", "unlocking", "cancelled" (no longer followed, but the keyboard still waits for its keys) or
    "unlocked" """
    keys: tuple = ()
    """ (row, col) of each key to hold, while unlocking or cancelled """
    remaining: int = 0
    """ the keyboard's countdown: polls with every key held that it still wants (0 before the first poll) """
    total: int = 0
    """ where the countdown started: the highest it was seen at """


@dataclass
class _Unlock:
    """ An unlock the keyboard is waiting for: it takes no other request until it is unlocked or plugged in again """
    keys: list
    remaining: int = 0
    total: int = 0
    following: bool = True
    """ polled (unlock_poll) until done; False once cancelled """


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

    def set_connected(self, connected):
        """ Simulate unplugging the keyboard (False) or plugging it back in (True); the hot-plug poll notices """
        if self.virtual is None:
            self.virtual = self.keyboard_factory()
        self.virtual.connected = connected


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
    Owns the open keyboard. All access goes through run() or read() (or reload()), which hold the device lock.

    check() is the hot-plug poll (about once a second) and the one place where the connection is repaired:
    - an unplugged keyboard is closed ("disconnected");
    - a keyboard whose handle stopped working while it is still listed (a replug on the same port within one poll,
      a USB reset) is closed and reopened ("disconnected", then "connected"). The request that hit the dead handle
      still fails: writes are not retried, since they are not known to be safe to repeat. Requests made before the
      poll reopens it fail at once;
    - a keyboard whose presence can't be checked (the backend raises) is kept as it is;
    - with no keyboard, the first one found is opened and loaded ("connected"). One that fails to load is not tried
      again for RETRY_FIRST seconds, doubling up to RETRY_MAX, unless it is unplugged and plugged back in.

    Unlocking works as Qt's unlocker does: start_unlock() sends unlock_start, then poll_unlock() (called about every
    200 ms while the state is "unlocking") reads the keyboard's countdown, which runs while the user holds the unlock
    keys, until it is unlocked. While the keyboard waits for its unlock keys it answers nothing else, so run() refuses
    every request then (KeyboardLocked); read() still works. A keyboard found waiting for an unlock started earlier (by
    a Vial closed meanwhile) is opened but not read: that unlock is finished first, as Qt does, then the keyboard is
    read ("connected"). The unlock state changing (started, done, cancelled, locked) is an "unlock" event; the readings
    of the countdown are not events, whoever follows the unlock (the server app) sends them on. Unplugging a loaded
    keyboard mid-unlock ends the unlock with only a "disconnected" event, no "unlock" one: the UI must close its unlock
    dialog on that. (A keyboard that waited to be read is reported with an "unlock" event, as the UI never had it.)

    unlock_poll_gap: seconds poll_unlock() leaves at least between two unlock requests it sends (0: none; the real app
    uses SAFE_UNLOCK_POLL_GAP), so that polls that come too fast can't keep the firmware from counting down.
    """

    def __init__(self, backend, clock=time.monotonic, unlock_poll_gap=0.0):
        self.backend = backend
        self.clock = clock
        self.unlock_poll_gap = unlock_poll_gap
        self.unlock_sent = None
        """ clock time of the last unlock_start or unlock_poll sent """
        self.lock = threading.RLock()
        self.keyboard = None
        self.device = None
        self.handle = None
        self.candidate = None
        self.title = None
        self.error = None
        self.unlocked = False
        self.unlocking = None
        """ _Unlock while the keyboard waits for its unlock keys """
        self.waiting = None
        """ the Keyboard opened but not read yet, while an unlock started earlier is finished first """
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
                unlocked = False
                try:
                    dev, title = self.backend.open(candidate)
                    handle = CheckedDevice(dev)
                    keyboard = Keyboard(handle)
                    unlock_keys = interrupted_unlock_keys(keyboard)
                    if unlock_keys is not None:
                        keyboard.unlock_start()  # as Qt's unlocker does for every unlock
                        self.unlock_sent = self.clock()
                    else:
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
                self.device, self.handle, self.candidate, self.title, self.error = dev, handle, candidate, title, None
                if unlock_keys is not None:
                    log.info("%s is waiting to be unlocked: finishing that before reading it", title)
                    self.waiting = keyboard
                    self.unlocking = _Unlock(unlock_keys)
                    self.pending_events.append("unlock")
                    return False
                self.keyboard, self.unlocked = keyboard, unlocked
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
            except (NotConnected, KeyboardLocked):
                raise
            except Exception as e:
                log.warning("could not reload the keyboard: %s", e)
                self._close()
                self.error = str(e) or e.__class__.__name__
                self.pending_events.append("disconnected")
                raise

    def run(self, fn):
        """ Call fn(keyboard) while holding the device lock. Refused while the keyboard waits for its unlock keys. """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            if self.unlocking is not None:
                raise KeyboardLocked("the keyboard is waiting for its unlock keys: it takes no changes until it is "
                                     "unlocked")
            try:
                return self._io(self.keyboard, fn)
            except KeyboardLocked:
                # the unlock handler found it locked
                if self.unlocked:
                    self.unlocked = False
                    self.pending_events.append("unlock")
                raise

    def read(self, fn):
        """ Call fn(keyboard) while holding the device lock, for what only reads what was loaded (no device I/O): it
        works while the keyboard waits for its unlock keys too """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            return fn(self.keyboard)

    def _io(self, keyboard, fn):
        """ fn(keyboard), the lock held; a failure that means the keyboard is gone closes it (NotConnected) """
        try:
            return fn(keyboard)
        except (OSError, RuntimeError) as e:
            if isinstance(e, (NotConnected, KeyboardLocked)) or self._present() is not False:
                # still plugged in (or the backend can't tell): if the handle itself stopped working, later
                # requests fail at once until check() reopens it
                if self.handle is not None and not self.handle.healthy:
                    self.handle.broken = True
                raise
            self._close_reporting()
            raise NotConnected("keyboard disconnected") from e

    # ---------- unlocking ----------

    def unlock_state(self):
        """ UnlockState of the keyboard """
        with self.lock:
            u = self.unlocking
            if u is not None:
                return UnlockState("unlocking" if u.following else "cancelled", tuple(u.keys), u.remaining, u.total)
            return UnlockState("unlocked" if self.unlocked else "locked")

    def _unlock_target(self):
        """ The keyboard an unlock talks to: the loaded one, or one waiting to be read until it is unlocked """
        if self.keyboard is not None:
            return self.keyboard
        if self.waiting is not None:
            return self.waiting
        raise NotConnected("no keyboard connected")

    def start_unlock(self):
        """ Start unlocking as Qt's unlocker does: unlock_start, after which poll_unlock() follows the countdown. An
        unlock being followed already (started from another tab) is left to run: starting it again would start its
        countdown over. A cancelled unlock is followed again (the keyboard starts its countdown over). An unlocked
        keyboard is left alone. Returns unlock_state(). """
        with self.lock:
            if self.unlocking is not None and self.unlocking.following:
                return self.unlock_state()
            keyboard = self._unlock_target()
            if self.unlocking is None:
                if self._io(keyboard, lambda kb: kb.get_unlock_status()) == 1:
                    self.unlocked = True
                    return self.unlock_state()
                keys = self._io(keyboard, lambda kb: kb.get_unlock_keys())
            else:
                keys = self.unlocking.keys
            self._io(keyboard, lambda kb: kb.unlock_start())
            self.unlock_sent = self.clock()
            self.unlocking = _Unlock(keys)
            self.pending_events.append("unlock")
            return self.unlock_state()

    def poll_unlock(self):
        """ One poll of the unlock being followed: the keyboard counts down while every unlock key is held, and starts
        again when one is let go. The unlock is over when the keyboard says it is no longer in progress (an unlocked
        keyboard that was sent unlock_start still waits for its keys until its countdown ends). Once it is unlocked, a
        keyboard that waited for that is read ("connected", or "disconnected" when that fails). Unplugging the keyboard ends the unlock too, with only a
        "disconnected" event for a loaded keyboard.

        The firmware counts down only on a poll more than 100 ms after the unlock start or its last count-down, and
        starts over on any sooner poll, so polls must come slower than that. A poll within unlock_poll_gap seconds of
        the last unlock request sent sends nothing (two followers polling at once can't stall the countdown).

        Returns unlock_state(). """
        with self.lock:
            u = self.unlocking
            if u is None or not u.following:
                return self.unlock_state()
            if self.unlock_sent is not None and self.clock() - self.unlock_sent < self.unlock_poll_gap:
                return self.unlock_state()
            data = self._io(self._unlock_target(), lambda kb: kb.unlock_poll())
            self.unlock_sent = self.clock()
            unlocked, in_progress, counter = data[0], data[1], data[2]
            u.remaining, u.total = counter, max(u.total, counter)
            if not in_progress:
                self.unlocking = None
                self.unlocked = unlocked == 1
                self.pending_events.append("unlock")
                if self.waiting is not None:
                    self._read_waiting()
            return self.unlock_state()

    def _read_waiting(self):
        """ Read the keyboard that waited for its unlock, now that it answers again ("connected"). If that fails, it
        is closed with a "disconnected" event, so that the UI, which waited for it, reads the error in the status. """
        keyboard, self.waiting = self.waiting, None
        try:
            keyboard.reload()
        except Exception as e:
            log.warning("could not load keyboard %s: %s", self.candidate, e)
            self._failed(candidate_key(self.candidate))
            self._close()
            self.error = str(e) or e.__class__.__name__
            self.pending_events.append("disconnected")
            return
        self.keyboard = keyboard
        log.info("connected to %s", self.title)
        self.pending_events.append("connected")

    def cancel_unlock(self):
        """ Stop following the unlock. The keyboard can't be told to stop waiting for its unlock keys: it takes no
        changes until it is unlocked (start_unlock again) or plugged in again. Returns unlock_state(). """
        with self.lock:
            if self.unlocking is not None and self.unlocking.following:
                self.unlocking.following = False
                self.pending_events.append("unlock")
            return self.unlock_state()

    def lock_keyboard(self):
        """ Lock the keyboard again (Qt's Security > Lock); an "unlock" event if that changed it. Refused while the
        keyboard waits for its unlock keys (KeyboardLocked). Returns unlock_state(). """
        with self.lock:
            def lock(kb):
                kb.lock()
                return kb.get_unlock_status() == 1
            unlocked = self.run(lock)
            if unlocked != self.unlocked:
                self.unlocked = unlocked
                self.pending_events.append("unlock")
            return self.unlock_state()

    def read_unlocked(self):
        """ Ask the keyboard whether it is unlocked: it may have been locked meanwhile. During an unlock the keyboard
        is not asked: the unlock's own state is returned. Returns unlock_state(). """
        with self.lock:
            if self.unlocking is not None:
                return self.unlock_state()
            unlocked = self.run(lambda kb: kb.get_unlock_status()) == 1
            if unlocked != self.unlocked:
                self.unlocked = unlocked
                self.pending_events.append("unlock")
            return self.unlock_state()

    # ---------- hot-plug ----------

    def check(self):
        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
        with self.lock:
            if self.device is not None:
                if self._present() is False:
                    self._close_reporting()
                elif not self.handle.healthy:
                    log.warning("%s stopped answering; reopening it", self.title)
                    self._close_reporting()
            if self.device is None and self._connect(wait_after_failures=True):
                self.pending_events.append("connected")
            return self.take_events()

    def take_events(self):
        """ The events since the last call, in order: "connected", "disconnected", "unlock" """
        with self.lock:
            events, self.pending_events = self.pending_events, []
            return events

    def _close_reporting(self):
        """ Close the keyboard, with the event that says so: "disconnected" for a loaded one; "unlock" for one that
        waited for its unlock (the UI never had it), whose unlock is over """
        was_loaded = self.keyboard is not None
        self._close()
        self.pending_events.append("disconnected" if was_loaded else "unlock")

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
        self.keyboard = self.device = self.handle = self.candidate = self.title = self.waiting = None
        self.unlocking = self.unlock_sent = None
        self.unlocked = False
