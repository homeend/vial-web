# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
import contextvars
import logging
import struct
import threading
import time
from collections import namedtuple
from dataclasses import dataclass
from typing import Optional

from protocol.constants import CMD_VIA_BOOTLOADER_JUMP, CMD_VIA_GET_KEYBOARD_VALUE, CMD_VIA_VIAL_PREFIX, \
    CMD_VIAL_GET_KEYBOARD_ID, VIA_ID_UNHANDLED, VIA_SWITCH_MATRIX_STATE, VIAL_PROTOCOL_MATRIX_TESTER
from protocol.keyboard_comm import Keyboard
from simulator.device import SimulatedHidDevice
from transport import MSG_LEN

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

VIAL_SERIAL_MAGIC = "vial:f64c2b3c"
""" in the USB serial number of every Vial keyboard (hid_discovery.VIAL_SERIAL_NUMBER_MAGIC; not imported from there, as
that loads hidapi) """

Status = namedtuple("Status", "connected title unlocked error")


class NotConnected(RuntimeError):
    pass


class KeyboardLocked(RuntimeError):
    pass


class KeyboardRefused(RuntimeError):
    """ The keyboard answered, and refused the change: the message says which one """


class DeviceIOError(RuntimeError):
    """ The HID handle itself failed (it is closed or no longer valid), as opposed to a request that was refused """


class UnknownKeyboard(LookupError):
    """ No keyboard of that id is plugged in (DeviceManager.select) """


class KeyboardChanged(Exception):
    """ A request meant for one keyboard (meant_for) while another one is open: it was not sent """


meant_for = contextvars.ContextVar("meant_for", default=None)
""" The keyboard (KeyboardInfo.id) the request being served is meant for, or None: any. A page sends the id of the
keyboard it shows with each change (the server app puts it here), so that a change sent while another tab switched
keyboards never reaches the keyboard opened instead: DeviceManager refuses it, under the device lock (KeyboardChanged).
"""


def require_unlocked(keyboard):
    """ Unlock handler for the server (protocol.unlock_hook). The protocol calls it before a security-sensitive write
    (a macro, QK_BOOT). Unlocking needs the user to hold keys, which the UI asks for, so a locked keyboard refuses the
    write (KeyboardLocked, 423): the UI then unlocks it (POST /api/unlock/start) and sends the change again. """
    if keyboard.get_unlock_status() != 1:
        raise KeyboardLocked("the keyboard is locked: unlock it to make this change")
    return True


def has_matrix_tester(keyboard):
    """ Whether the keyboard tells which of its keys are held (Qt's matrix tester): Vial protocol 3 or later, and a
    matrix that fits in one reply by the firmware's own estimate (via.c: (MATRIX_COLS / 8 + 1) * MATRIX_ROWS <= 28;
    a larger one leaves the reply empty) """
    return keyboard.vial_protocol >= VIAL_PROTOCOL_MATRIX_TESTER and (keyboard.cols // 8 + 1) * keyboard.rows <= 28


MATRIX_REQUEST = struct.pack("BB", CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE)
""" what the reply to a switch matrix request starts with: the request, echoed """
MATRIX_STRAYS_MAX = 4
""" reports read at most after a switch matrix request that aren't its reply, before the reading fails """
REPLY_TIMEOUT_MS = 500
""" how long a reply is waited for (transport.hid_send waits as long) """


def read_matrix(keyboard):
    """ The reply to a switch matrix request (Keyboard.matrix_poll). A report that doesn't echo the request (one that
    came too late for an earlier request) is skipped and the reply read again: it is never read as the matrix.
    RuntimeError when the reply doesn't come. """
    data = keyboard.matrix_poll()
    strays = 0
    while bytes(data[:2]) != MATRIX_REQUEST:
        keyboard.dev.stray()
        strays += 1
        if strays > MATRIX_STRAYS_MAX:
            raise RuntimeError("the keyboard's replies don't answer the switch matrix request")
        data = bytes(keyboard.dev.read(MSG_LEN, timeout_ms=REPLY_TIMEOUT_MS))
        if not data:
            raise RuntimeError("failed to communicate with the device")
    return data


def matrix_pressed(data, rows, cols):
    """ The (row, col) of each key held, from the reply to a switch matrix request, as Qt's matrix tester reads it:
    after the 2 bytes of the request, each row takes ceil(cols / 8) bytes, the highest columns first """
    row_size = (cols + 7) // 8
    pressed = []
    for row in range(rows):
        start = 2 + row * row_size
        bits = int.from_bytes(bytes(data[start:start + row_size]), byteorder="big")
        pressed += [(row, col) for col in range(cols) if bits >> col & 1]
    return pressed


@dataclass(frozen=True)
class MatrixReading:
    """ One reading of the switch matrix (schemas.MatrixState) """
    state: str
    """ "testing": `pressed` is what is held now; "locked": the firmware shows nothing until the keyboard is unlocked;
    "unsupported": this keyboard can't tell (has_matrix_tester) """
    pressed: tuple = ()


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
    - A reply that comes after its read gave up (the protocol then sends the request again, or fails) would be read
      as the reply to the next request. So once a request has gone unanswered, the reports queued meanwhile are
      dropped before the next one is sent.
    """

    DRAIN_MAX = 16
    """ reports dropped at most before a request: more means the keyboard keeps sending, and the request goes ahead """

    def __init__(self, dev):
        self.dev = dev
        self.healthy = True
        self.broken = False
        self.unanswered = 0
        """ requests sent whose reply hasn't been read: theirs may still come """

    def _check_usable(self):
        if self.broken:
            raise DeviceIOError("the connection to the keyboard is broken; waiting for it to be reopened")

    def _read(self, length, timeout_ms):
        try:
            return self.dev.read(length, timeout_ms=timeout_ms)
        except ValueError as e:
            self.healthy = False
            raise DeviceIOError("the connection to the keyboard is broken ({})".format(e)) from e
        except OSError:
            self.healthy = False
            raise

    def _drop_late_replies(self):
        """ Read what has queued up since a request went unanswered, without waiting: replies that came too late """
        # a timeout of 0 would block for good in hidapi's blocking mode: 1 ms
        dropped = 0
        while dropped < self.DRAIN_MAX and self._read(MSG_LEN, 1):
            dropped += 1
        if dropped:
            log.info("dropped %d late replies from the keyboard", dropped)
        self.unanswered = 0

    def write(self, data):
        self._check_usable()
        if self.unanswered:
            self._drop_late_replies()
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
        else:
            self.unanswered += 1
        return written

    def read(self, length, timeout_ms=0):
        self._check_usable()
        data = self._read(length, timeout_ms)
        # no reply in time: the keyboard isn't answering (yet); a later reply makes the handle healthy again
        self.healthy = bool(data)
        if data:
            self.unanswered = max(0, self.unanswered - 1)
        return data

    def stray(self):
        """ The report just read wasn't the reply to the request: that may still come """
        self.unanswered += 1

    def __getattr__(self, name):
        return getattr(self.dev, name)


class FakeBackend:
    """ Serves simulated keyboards: the first one, and a second one plugged in and out on demand (set_second_connected).
    Each is found as a real one is (the description hidapi gives), with a serial number of its own. Never touches
    hidapi. """

    fake = True
    VENDOR_ID = 0xF00D
    PRODUCT_ID = 0xCAFE

    def __init__(self, keyboard_factory, second_factory=None):
        self.keyboard_factory = keyboard_factory
        self.second_factory = second_factory or keyboard_factory
        """ makes the second keyboard; by default, one like the first """
        self.virtual = None
        """ the first simulated keyboard, once looked for """
        self.second = None
        """ the second simulated keyboard, once plugged in """
        self.second_protocol = None
        """ the second keyboard's own Vial protocol, while it is plugged in unreadable """
        # find() runs outside the device lock, while the test hooks change what is plugged in
        self.lock = threading.RLock()

    def _first(self):
        with self.lock:
            if self.virtual is None:
                self.virtual = self.keyboard_factory()
            return self.virtual

    @staticmethod
    def describe(number, virtual):
        """ What hidapi would say of simulated keyboard `number` (1 or 2) """
        return {"path": "simulated:{}".format(number), "vendor_id": FakeBackend.VENDOR_ID,
                "product_id": FakeBackend.PRODUCT_ID, "serial_number": "{}:SIM{:04d}".format(VIAL_SERIAL_MAGIC, number),
                "manufacturer_string": "Simulated", "product_string": virtual.definition.get("name", "keyboard")}

    def find(self):
        with self.lock:
            plugged = [(1, self._first()), (2, self.second)]
            return [self.describe(n, vk) for n, vk in plugged if vk is not None and vk.connected]

    def virtual_of(self, candidate):
        """ The simulated keyboard a candidate of find() is """
        with self.lock:
            return self._first() if candidate["path"] == "simulated:1" else self.second

    def open(self, candidate):
        virtual = self.virtual_of(candidate)
        return SimulatedHidDevice(virtual), "Simulated: " + virtual.definition.get("name", "keyboard")

    def present(self, candidate):
        virtual = self.virtual_of(candidate)
        return virtual is not None and virtual.connected

    def set_connected(self, connected):
        """ Simulate unplugging the first keyboard (False) or plugging it back in (True, VirtualKeyboard.plug_in); the
        hot-plug poll notices """
        with self.lock:
            virtual = self._first()
            if connected and not virtual.connected:
                virtual.plug_in()
            virtual.connected = connected

    def set_second_connected(self, connected, unreadable=False):
        """ Simulate plugging the second keyboard in (True) or unplugging it (False); the hot-plug poll notices.
        unreadable: plugged in with firmware of a Vial protocol this Vial doesn't know, so it is listed but fails to
        load (until it is plugged in again without that) """
        with self.lock:
            if self.second is None:
                if not connected:
                    return
                self.second = self.second_factory()
                self.second.connected = False
            second = self.second
            if connected and not second.connected:
                second.plug_in()
                if self.second_protocol is not None:
                    second.vial_protocol, self.second_protocol = self.second_protocol, None
                if unreadable:
                    self.second_protocol, second.vial_protocol = second.vial_protocol, 99
            second.connected = connected


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


@dataclass(frozen=True)
class KeyboardInfo:
    """ A Vial keyboard found (schemas.KeyboardEntry) """
    id: str
    """ what tells it apart from the others, the same after a replug (its HID path is not): its USB serial number when
    it has one of its own, else its vendor and product IDs and product name; and, among keyboards alike, a number (1,
    2...) that it keeps while it stays plugged in (see keyboard_infos) """
    name: str
    vendor_id: int
    product_id: int
    serial: Optional[str]
    """ its serial number without the Vial magic, if anything else is in it """
    key: object
    """ candidate_key() of the candidate """
    candidate: object = None


def own_serial(serial):
    """ What a USB serial number has besides the Vial magic: most Vial firmware's serial number is only the magic, which
    every Vial keyboard has. None when that is all. """
    rest = (serial or "").replace(VIAL_SERIAL_MAGIC, "").strip(" :-_/")
    return rest or None


def keyboard_infos(candidates, previous=()):
    """ KeyboardInfo of each candidate of a backend's find(), in the same order.

    Keyboards alike (no serial number of their own, the same IDs and name) are numbered. previous: the KeyboardInfo of
    the listing before: a keyboard still at a path listed then keeps its number, so that unplugging one of them never
    gives its id to another (which would then be opened as the one chosen). A keyboard at a new path (plugged in, or in
    again) takes the lowest number free among those alike, in the order of their paths. """
    def field(candidate, name, default):
        value = candidate.get(name) if isinstance(candidate, dict) else None
        return default if value is None else value
    described = []
    for candidate in candidates:
        vid, pid = field(candidate, "vendor_id", 0), field(candidate, "product_id", 0)
        serial = own_serial(field(candidate, "serial_number", ""))
        title = "{} {}".format(field(candidate, "manufacturer_string", ""),
                               field(candidate, "product_string", "")).strip()
        name = field(candidate, "product_string", "").strip() or title or "Vial keyboard"
        base = "{:04x}:{:04x}:{}".format(vid, pid, "serial:" + serial if serial else "name:" + name)
        described.append((base, name, vid, pid, serial, candidate))
    kept = {info.key: info.id for info in previous}
    order = sorted(range(len(described)), key=lambda i: (described[i][0], str(candidate_key(described[i][5]))))
    number, taken = {}, {}
    # first those listed before at the same path, with the number they had
    for i in order:
        base, key = described[i][0], candidate_key(described[i][5])
        had = kept.get(key, "")
        if had.startswith(base + "#") and had[len(base) + 1:].isdigit():
            n = int(had[len(base) + 1:])
            if n not in taken.setdefault(base, set()):
                number[i] = n
                taken[base].add(n)
    # then the others, the lowest number free
    for i in order:
        if i in number:
            continue
        base = described[i][0]
        used = taken.setdefault(base, set())
        n = 1
        while n in used:
            n += 1
        number[i] = n
        used.add(n)
    return [KeyboardInfo("{}#{}".format(base, number[i]), name, vid, pid, serial, candidate_key(candidate), candidate)
            for i, (base, name, vid, pid, serial, candidate) in enumerate(described)]


def id_order(keyboard_id):
    """ Sort key of a KeyboardInfo.id: by what it is, then by its number among keyboards alike (2 before 10) """
    base, _, number = keyboard_id.rpartition("#")
    return (base, int(number)) if number.isdigit() else (keyboard_id, 0)


ListedKeyboard = namedtuple("ListedKeyboard", "info plugged")
""" A keyboard of the list: its KeyboardInfo, and whether it is plugged in (the chosen one stays listed unplugged) """

KeyboardList = namedtuple("KeyboardList", "entries chosen open")
""" The ListedKeyboard of each keyboard; the id of the one chosen (None: none was, the first one found is used) and of
the one open (None: none is) """


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
    - with no keyboard, the chosen one (select()) is opened and loaded once it is plugged in ("connected"), and only
      that one; with none chosen, the first one found. One that fails to load is not tried again for RETRY_FIRST
      seconds, doubling up to RETRY_MAX, unless it is unplugged and plugged back in.

    Every poll lists the Vial keyboards plugged in (outside the device lock: that can take a while). `changes` counts
    the changes of what the UI shows of them, while a keyboard is open or not: the list, the one chosen, the one open,
    and the error that says why none could be read (`error`, `error_kind`). The server app tells the UI when it grows
    ("keyboards" event); these changes are not events of take_events(), which are about the open keyboard.

    select() chooses the keyboard to use, kept for the manager's lifetime by its id (KeyboardInfo.id, which stays the
    same across a replug). Choosing another one closes the one open (whatever waited on it ends: an unlock followed,
    requests refused until then) and opens the chosen one: "connected" when it is loaded; else "disconnected" for the
    one closed, if it was loaded. The chosen keyboard unplugged stays listed, as unplugged, and is waited for: another
    one is never opened instead.

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
        self._error = None
        self.error_kind = None
        """ what `error` is about: "list" (looking for keyboards failed) or "read" (one found couldn't be read) """
        self.changes = 0
        """ counts the changes of the list, the choice, the keyboard open and the error (see the class) """
        self.listed = []
        """ KeyboardInfo of each Vial keyboard plugged in, as last found """
        self.chosen = None
        """ id of the keyboard chosen (select()); None: none was, the first one found is used """
        self.chosen_info = None
        """ the chosen keyboard's KeyboardInfo, as last found: it is listed while it is unplugged too """
        self.open_id = None
        """ id of the keyboard open (loaded, or waiting to be read until it is unlocked) """
        self.list_error_logged = None
        """ clock time a failing listing was last logged while a keyboard was open """
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

    @property
    def error(self):
        """ why no keyboard could be opened, or None """
        return self._error

    @error.setter
    def error(self, text):
        # set this way, it is about a keyboard that couldn't be read
        self._set_error(text, "read")

    def _set_error(self, text, kind):
        kind = kind if text is not None else None
        if (text, kind) != (self._error, self.error_kind):
            self._error, self.error_kind = text, kind
            self.changes += 1

    def _find(self):
        """ (the candidates the backend finds, None), or (None, the exception it raised) """
        try:
            return list(self.backend.find()), None
        except Exception as e:
            return None, e

    def _list(self, candidates):
        """ Keep the keyboards found: a change when they aren't those listed before (in whatever order hidapi gives
        them: it promises none) """
        listed = keyboard_infos(candidates, self.listed)

        def shown(infos):
            return sorted((id_order(i.id), i.name, i.serial) for i in infos)
        if shown(listed) != shown(self.listed):
            self.changes += 1
        self.listed = listed
        for info in listed:
            if info.id == self.chosen:
                self.chosen_info = info

    def keyboard_list(self):
        """ KeyboardList: the keyboards plugged in, by id (not in the order they were found, which may change from one
        listing to the next), and the chosen one unplugged """
        with self.lock:
            entries = [ListedKeyboard(info, True) for info in self.listed]
            if self.chosen_info is not None and all(info.id != self.chosen for info in self.listed):
                entries.append(ListedKeyboard(self.chosen_info, False))
            return KeyboardList(sorted(entries, key=lambda e: id_order(e.info.id)), self.chosen, self.open_id)

    def select(self, keyboard_id):
        """ Choose the keyboard to use (see the class). One unplugged can be chosen only if it was chosen already
        (UnknownKeyboard otherwise). Returns whether another keyboard was opened (loaded, or waiting to be read until it
        is unlocked): False when the chosen one is open already, unplugged, or couldn't be opened (`error` says why). """
        with self.lock:
            info = next((i for i in self.listed if i.id == keyboard_id), None)
            if info is None and keyboard_id != self.chosen:
                raise UnknownKeyboard("no keyboard {} is plugged in".format(keyboard_id))
            if keyboard_id != self.chosen:
                self.chosen = keyboard_id
                self.changes += 1
            if info is not None:
                self.chosen_info = info  # listed while it is unplugged, from now on
            if info is None or self.open_id == keyboard_id:
                return False  # opened once it is plugged in again, or open already
            was_loaded, was_waiting = self.keyboard is not None, self.waiting is not None
            at = len(self.pending_events)
            if self._connect(wait_after_failures=False):
                self.pending_events.append("connected")
                return True
            if was_loaded:
                self.pending_events.insert(at, "disconnected")
            elif was_waiting:
                self.pending_events.insert(at, "unlock")  # its unlock is over
            return self.device is not None

    def status(self):
        """ connected, title, unlocked and error, read together """
        with self.lock:
            return Status(self.keyboard is not None, self.title, self.unlocked, self.error)

    def connect(self, resume_unlock=True):
        """ Open the first keyboard found and load everything from it. Returns True when connected.

        A keyboard found waiting for an unlock started earlier can't be read until it is unlocked: it is sent
        unlock_start, as Qt's unlocker does, and the unlock is followed (unlock_state() "unlocking"). With
        resume_unlock False (a dry run) it is sent nothing: the unlock is left as it is, not followed ("cancelled"). """
        return self._connect(wait_after_failures=False, resume_unlock=resume_unlock)

    def _connect(self, wait_after_failures, resume_unlock=True, found=None):
        """ found: what _find() gave, if it was called already """
        with self.lock:
            self._close()
            candidates, failure = self._find() if found is None else found
            if failure is not None:
                log.error("could not list keyboards", exc_info=failure)
                self._set_error("could not list keyboards: {}".format(failure), "list")
                return False
            self._list(candidates)
            # the chosen keyboard only, or the first one found that loads
            tried = [info for info in self.listed if self.chosen is None or info.id == self.chosen]
            if not tried:
                self.error = None
            listed = {info.key for info in self.listed}
            # a keyboard that went away and came back gets a fresh start
            self.failures = {k: v for k, v in self.failures.items() if k in listed}
            for info in tried:
                candidate, key = info.candidate, info.key
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
                        if resume_unlock:
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
                self.open_id = info.id
                self.changes += 1
                if unlock_keys is not None:
                    log.info("%s is waiting to be unlocked: %s", title,
                             "finishing that before reading it" if resume_unlock else "left as it is")
                    self.waiting = keyboard
                    self.unlocking = _Unlock(unlock_keys, following=resume_unlock)
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
            except (NotConnected, KeyboardLocked, KeyboardChanged):
                raise
            except Exception as e:
                log.warning("could not reload the keyboard: %s", e)
                self._close()
                self.error = str(e) or e.__class__.__name__
                self.pending_events.append("disconnected")
                raise

    def run(self, fn):
        """ Call fn(keyboard) while holding the device lock. Refused while the keyboard waits for its unlock keys, and
        when the request is meant for another keyboard (meant_for). """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            self._check_meant_for()
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
            self._check_meant_for()
            return fn(self.keyboard)

    def _check_meant_for(self):
        """ KeyboardChanged when the request is meant for another keyboard than the one open (meant_for); the lock
        held. With none open, the request fails as it would anyway. """
        wanted = meant_for.get()
        if wanted is not None and self.open_id is not None and wanted != self.open_id:
            raise KeyboardChanged("The keyboard changed (another one was opened): this change was not sent.")

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
        keyboard is left alone. Refused when the request is meant for another keyboard (meant_for). Returns
        unlock_state(). """
        with self.lock:
            self._check_meant_for()
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

    # ---------- matrix tester, bootloader ----------

    def poll_matrix(self):
        """ Read which keys are held: one request, under the device lock. The firmware hides them (a would-be
        keylogger) until the keyboard is unlocked, and answers nothing while it waits for its unlock keys: then the
        keyboard isn't asked, and the reading says "locked". Returns a MatrixReading. """
        with self.lock:
            keyboard = self.keyboard
            if keyboard is None:
                raise NotConnected("no keyboard connected")
            if not has_matrix_tester(keyboard):
                return MatrixReading("unsupported")
            if self.unlocking is not None or not self.unlocked:
                return MatrixReading("locked")
            data = self._io(keyboard, read_matrix)
            return MatrixReading("testing", tuple(matrix_pressed(data, keyboard.rows, keyboard.cols)))

    def reboot_to_bootloader(self):
        """ Restart the keyboard into its bootloader, as Qt's Security > Reboot to bootloader does: the keyboard must
        be unlocked (KeyboardLocked otherwise), and then jumps (via.c id_bootloader_jump), leaving Vial: it is closed,
        with a "disconnected" event. A firmware that doesn't take the jump (vial-qmk leaves it out of VIAL_INSECURE
        builds) answers id_unhandled: KeyboardRefused, and the keyboard stays. """
        with self.lock:
            def jump(kb):
                require_unlocked(kb)
                # one try: the firmware answers, waits 100 ms and jumps; sent again, it would reach the bootloader
                return kb.usb_send(kb.dev, struct.pack("B", CMD_VIA_BOOTLOADER_JUMP))
            reply = self.run(jump)
            # an echoed command is ambiguous (a locked keyboard's `goto skip` echoes it in via.c too); accepted, as the
            # unlock status was read just before, under the same lock
            if reply[0] == VIA_ID_UNHANDLED:
                raise KeyboardRefused("this keyboard's firmware can't restart into its bootloader from Vial (it is "
                                      "built without that)")
            log.info("%s restarted into its bootloader", self.title)
            self._close_reporting()

    # ---------- hot-plug ----------

    def check(self):
        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
        # outside the device lock: listing every HID device can take a while on some systems, and requests to the
        # open keyboard go on meanwhile (as Qt's autorefresh thread lists them)
        found = self._find()
        with self.lock:
            candidates, failure = found
            if failure is None:
                self._list(candidates)
            elif self.device is not None:
                now = self.clock()
                if self.list_error_logged is None or now - self.list_error_logged >= PRESENT_ERROR_LOG_INTERVAL:
                    self.list_error_logged = now
                    log.error("could not list keyboards; the list is kept as it was", exc_info=failure)
            if self.device is not None:
                # listed just now, it is plugged in: the backend isn't asked again (another HID enumeration). Not
                # listed, or not listed at all (that failed): it is asked, as it would be anyway
                listed = failure is None and any(info.key == candidate_key(self.candidate) for info in self.listed)
                if not listed and self._present() is False:
                    self._close_reporting()
                elif not self.handle.healthy:
                    log.warning("%s stopped answering; reopening it", self.title)
                    self._close_reporting()
            if self.device is None and self._connect(wait_after_failures=True, found=found):
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
        if self.open_id is not None:
            self.open_id = None
            self.changes += 1
        self.keyboard = self.device = self.handle = self.candidate = self.title = self.waiting = None
        self.unlocking = self.unlock_sent = None
        self.unlocked = False
