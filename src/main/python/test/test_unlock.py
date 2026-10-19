""" Unlocking the keyboard: the device manager follows the protocol as Qt's unlocker does, against the simulated Corne
(unlock keys: Tab at row 0 column 0, Backspace at row 4 column 0) """
import pytest

import transport
from protocol.keyboard_comm import Keyboard
from protocol.unlock_hook import request_unlock, set_unlock_handler
from server.device import DeviceManager, FakeBackend, KeyboardLocked, NotConnected, UnlockState, require_unlocked
from simulator.corne import UNLOCK_KEYS, make_corne
from simulator.device import SimulatedHidDevice

COUNTDOWN = 3
""" the simulated keyboards here count down from 3, so that a few polls unlock them """
KEYS = tuple(UNLOCK_KEYS)


def locked_corne(**kwargs):
    vk = make_corne(**kwargs)
    vk.unlocked = False
    vk.unlock_counter_max = COUNTDOWN
    return vk


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


@pytest.fixture
def manager():
    m = DeviceManager(FakeBackend(locked_corne))
    assert m.connect()
    m.take_events()
    return m


def virtual(manager):
    return manager.backend.virtual


def write_macro(kb):
    """ A macro change, as the API makes it: the protocol asks for the keyboard to be unlocked first """
    request_unlock(kb)
    kb.set_macro(b"hi\x00" + b"\x00" * 15)


# ---------- device manager ----------

def test_a_locked_keyboard_is_reported_locked(manager):
    assert not manager.unlocked
    assert manager.unlock_state() == UnlockState("locked")


def test_start_sends_unlock_start_and_names_the_keys(manager):
    state = manager.start_unlock()
    assert state == UnlockState("unlocking", KEYS)
    assert virtual(manager).unlock_in_progress
    assert manager.take_events() == ["unlock"]


def test_the_countdown_runs_while_the_keys_are_held(manager):
    manager.start_unlock()
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN, COUNTDOWN)  # not held: starts over
    virtual(manager).hold_unlock_keys(True)
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN - 1, COUNTDOWN)
    virtual(manager).release(*KEYS[0])
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN, COUNTDOWN)
    assert manager.take_events() == ["unlock"]  # the start; readings of the countdown aren't events


def test_holding_the_keys_until_the_end_unlocks(manager):
    manager.start_unlock()
    virtual(manager).hold_unlock_keys(True)
    states = [manager.poll_unlock().state for _ in range(COUNTDOWN)]
    assert states == ["unlocking"] * (COUNTDOWN - 1) + ["unlocked"]
    assert manager.unlocked and virtual(manager).unlocked
    assert manager.status().unlocked
    assert manager.take_events() == ["unlock", "unlock"]
    # the writes that needed it go through now
    manager.run(write_macro)
    assert virtual(manager).macros()[0] == b"hi"


def test_an_unlocked_keyboard_is_left_alone():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    assert m.start_unlock() == UnlockState("unlocked")
    assert not m.backend.virtual.unlock_in_progress
    assert m.take_events() == []


def test_while_unlocking_the_keyboard_takes_no_requests_but_can_be_read(manager):
    manager.start_unlock()
    with pytest.raises(KeyboardLocked, match="waiting for its unlock keys"):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_A"))
    assert manager.read(lambda kb: kb.layout[(0, 0, 0)]) == "KC_TAB"


def test_cancel_stops_following_but_the_keyboard_keeps_waiting(manager):
    manager.start_unlock()
    assert manager.cancel_unlock() == UnlockState("cancelled", KEYS)
    assert virtual(manager).unlock_in_progress
    virtual(manager).hold_unlock_keys(True)
    assert manager.poll_unlock().state == "cancelled"  # not followed: nothing is sent
    assert virtual(manager).unlock_counter == COUNTDOWN
    with pytest.raises(KeyboardLocked):
        manager.run(write_macro)
    assert manager.take_events() == ["unlock", "unlock"]
    # started again, it counts down from the top
    assert manager.start_unlock().state == "unlocking"
    assert [manager.poll_unlock().state for _ in range(COUNTDOWN)][-1] == "unlocked"


def test_lock(manager):
    manager.start_unlock()
    virtual(manager).hold_unlock_keys(True)
    for _ in range(COUNTDOWN):
        manager.poll_unlock()
    manager.take_events()
    assert manager.lock_keyboard() == UnlockState("locked")
    assert not virtual(manager).unlocked and not manager.unlocked
    assert manager.take_events() == ["unlock"]


def test_lock_waits_until_an_unlock_is_over(manager):
    manager.start_unlock()
    with pytest.raises(KeyboardLocked):
        manager.lock_keyboard()


def test_a_write_refused_while_locked_reports_the_keyboard_locked():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    assert m.unlocked
    m.backend.virtual.unlocked = False  # locked behind Vial's back (plugged in again, in reality)
    with pytest.raises(KeyboardLocked):
        m.run(write_macro)
    assert m.unlock_state() == UnlockState("locked")
    assert m.take_events() == ["unlock"]


def test_read_unlocked_follows_the_keyboard():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    m.backend.virtual.unlocked = False
    assert m.read_unlocked() == UnlockState("locked")
    assert m.take_events() == ["unlock"]
    assert m.read_unlocked() == UnlockState("locked")
    assert m.take_events() == []


def interrupted_corne():
    """ A locked Corne still waiting for an unlock started by a Vial that was closed meanwhile """
    vk = locked_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.unlock_start()
    assert vk.unlock_in_progress
    return vk


def test_an_interrupted_unlock_is_finished_on_connect_before_the_keyboard_is_read():
    m = DeviceManager(FakeBackend(interrupted_corne))
    assert not m.connect()
    assert not m.connected and m.status().title == "Simulated: Simulated Corne"
    assert m.unlock_state() == UnlockState("unlocking", KEYS)
    assert m.take_events() == ["unlock"]
    with pytest.raises(NotConnected):
        m.run(lambda kb: None)
    assert m.check() == []  # the hot-plug poll leaves it to the unlock

    m.backend.virtual.hold_unlock_keys(True)
    states = [m.poll_unlock().state for _ in range(COUNTDOWN)]
    assert states[-1] == "unlocked"
    assert m.connected and m.unlocked
    assert m.take_events() == ["unlock", "connected"]
    assert m.run(lambda kb: kb.layout[(0, 0, 0)]) == "KC_TAB"


def test_unplugging_a_keyboard_that_waits_for_its_unlock_ends_it():
    m = DeviceManager(FakeBackend(interrupted_corne))
    m.connect()
    m.take_events()
    m.backend.virtual.connected = False
    assert m.check() == ["unlock"]
    assert m.unlock_state() == UnlockState("locked")
    assert m.status().title is None
