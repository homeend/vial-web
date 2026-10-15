# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
import logging
import threading

from protocol.keyboard_comm import Keyboard
from simulator.device import SimulatedHidDevice

log = logging.getLogger(__name__)


class NotConnected(RuntimeError):
    pass


class KeyboardLocked(RuntimeError):
    pass


def require_unlocked(keyboard):
    """ Unlock handler for the server: the web UI can't run the unlock flow yet, so refuse instead """
    if keyboard.get_unlock_status() != 1:
        raise KeyboardLocked("the keyboard is locked; unlock it in the Qt app to change security-sensitive keys")
    return True


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
        return any(d["path"] == desc["path"] for d in hid.enumerate())


class DeviceManager:

    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.RLock()
        self.keyboard = None
        self.device = None
        self.candidate = None
        self.title = None
        self.error = None
        self.unlocked = False
        self.pending_events = []

    @property
    def connected(self):
        return self.keyboard is not None

    def connect(self):
        """ Open the first keyboard found and load everything from it. Returns True when connected. """
        with self.lock:
            self._close()
            for candidate in self.backend.find():
                dev = None
                try:
                    dev, title = self.backend.open(candidate)
                    keyboard = Keyboard(dev)
                    keyboard.reload()
                    unlocked = keyboard.get_unlock_status() == 1
                except Exception as e:
                    log.warning("could not load keyboard %s: %s", candidate, e)
                    self.error = str(e) or e.__class__.__name__
                    if dev is not None:
                        dev.close()
                    continue
                self.keyboard, self.device, self.candidate, self.title = keyboard, dev, candidate, title
                self.unlocked, self.error = unlocked, None
                log.info("connected to %s", title)
                return True
            return False

    def reload(self):
        """ Read everything from the keyboard again """
        def do_reload(keyboard):
            keyboard.reload()
            self.unlocked = keyboard.get_unlock_status() == 1
        self.run(do_reload)

    def run(self, fn):
        """ Call fn(keyboard) while holding the device lock """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            try:
                return fn(self.keyboard)
            except (OSError, RuntimeError) as e:
                if isinstance(e, (NotConnected, KeyboardLocked)) or self.backend.present(self.candidate):
                    raise
                self._close()
                self.pending_events.append("disconnected")
                raise NotConnected("keyboard disconnected") from e

    def check(self):
        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
        with self.lock:
            if self.keyboard is not None and not self.backend.present(self.candidate):
                self._close()
                self.pending_events.append("disconnected")
            elif self.keyboard is None and self.connect():
                self.pending_events.append("connected")
            events, self.pending_events = self.pending_events, []
            return events

    def _close(self):
        if self.device is not None:
            try:
                self.device.close()
            except Exception:
                pass
        self.keyboard = self.device = self.candidate = self.title = None
        self.unlocked = False
