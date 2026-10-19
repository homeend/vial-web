""" Guards on the unlock that the real firmware needs (vial-qmk quantum/vial.c): an unlock is started once, its polls
come slowly enough for the firmware to count down, and it ends when the keyboard says so """
import pytest

import vial_web
from server import device as device_module
from server.device import SAFE_UNLOCK_POLL_GAP, DeviceManager, FakeBackend, KeyboardLocked, UnlockState
from simulator.virtual_keyboard import FIRMWARE_UNLOCK_POLL_GAP
from test.test_unlock import COUNTDOWN, KEYS, locked_corne, no_retry_pauses, virtual  # noqa: F401 (a fixture)


class FakeClock:
    """ Seconds, moved on by hand """

    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance_ms(self, ms):
        self.now = round(self.now + ms / 1000, 6)


def sent(manager):
    """ The requests the manager sends to the keyboard from now on: a list of their first two bytes """
    requests = []
    handle = manager.handle
    write = handle.write

    def recording(data):
        requests.append(bytes(data[1:3]))  # after the HID report id
        return write(data)
    handle.write = recording
    return requests


@pytest.fixture
def manager():
    m = DeviceManager(FakeBackend(locked_corne))
    assert m.connect()
    m.take_events()
    return m


def paced(manager_gap):
    """ (manager, clock) of a locked Corne that counts down as the real firmware does: only on a poll more than 100 ms
    after the unlock start or the last count-down, any other poll starting the countdown over """
    clock = FakeClock()

    def firmware_corne():
        vk = locked_corne()
        vk.unlock_poll_gap, vk.clock = FIRMWARE_UNLOCK_POLL_GAP, clock
        return vk
    m = DeviceManager(FakeBackend(firmware_corne), clock=clock, unlock_poll_gap=manager_gap)
    assert m.connect()
    m.take_events()
    return m, clock


# ---------- started once ----------

def test_a_second_start_while_following_keeps_the_countdown_and_sends_nothing(manager):
    manager.start_unlock()
    virtual(manager).hold_unlock_keys(True)
    manager.poll_unlock()
    assert virtual(manager).unlock_counter == COUNTDOWN - 1
    manager.take_events()
    requests = sent(manager)
    # another tab starting the unlock while it runs
    assert manager.start_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN - 1, COUNTDOWN - 1)
    assert requests == []
    assert virtual(manager).unlock_counter == COUNTDOWN - 1
    assert manager.take_events() == []
    assert [manager.poll_unlock().state for _ in range(COUNTDOWN - 1)][-1] == "unlocked"


# ---------- polls paced for the firmware ----------

def test_the_safe_gap_is_longer_than_the_firmwares():
    assert SAFE_UNLOCK_POLL_GAP > FIRMWARE_UNLOCK_POLL_GAP


def test_polls_sooner_than_the_gap_send_nothing_and_later_ones_count_down():
    m, clock = paced(SAFE_UNLOCK_POLL_GAP)
    m.start_unlock()
    virtual(m).hold_unlock_keys(True)
    requests = sent(m)
    clock.advance_ms(100)
    assert m.poll_unlock() == UnlockState("unlocking", KEYS)  # too soon after the start: not sent
    clock.advance_ms(40)
    assert m.poll_unlock() == UnlockState("unlocking", KEYS)
    assert requests == []
    clock.advance_ms(10)  # 150 ms after the start
    assert m.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN - 1, COUNTDOWN - 1)
    assert len(requests) == 1
    clock.advance_ms(149)  # too soon after that poll
    assert m.poll_unlock().remaining == COUNTDOWN - 1
    assert len(requests) == 1
    assert virtual(m).unlock_counter == COUNTDOWN - 1


def test_polled_every_60_ms_the_firmware_still_unlocks():
    m, clock = paced(SAFE_UNLOCK_POLL_GAP)
    m.start_unlock()
    virtual(m).hold_unlock_keys(True)
    requests = sent(m)
    states = []
    for _ in range(100):
        clock.advance_ms(60)
        states.append(m.poll_unlock().state)
        if states[-1] != "unlocking":
            break
    assert states[-1] == "unlocked"
    assert len(requests) == COUNTDOWN  # one poll in three sent, each 180 ms after the one before
    assert m.unlocked and virtual(m).unlocked


def test_without_the_gap_polls_every_60_ms_never_unlock_the_firmware():
    """ why the gap is there: the firmware starts its countdown over on a poll within 100 ms """
    m, clock = paced(0.0)
    m.start_unlock()
    virtual(m).hold_unlock_keys(True)
    for _ in range(100):
        clock.advance_ms(60)
        assert m.poll_unlock().state == "unlocking"
    assert not virtual(m).unlocked


# ---------- ends when the keyboard says so ----------

def test_an_unlocked_keyboard_still_counting_down_is_followed_until_it_is_done(manager):
    manager.start_unlock()
    virtual(manager).unlocked = True  # unlock_start sent to an unlocked keyboard: it still waits for its keys
    manager.take_events()
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN, COUNTDOWN)
    with pytest.raises(KeyboardLocked, match="waiting for its unlock keys"):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_A"))  # it still echoes every other request
    virtual(manager).hold_unlock_keys(True)
    states = [manager.poll_unlock().state for _ in range(COUNTDOWN)]
    assert states == ["unlocking"] * (COUNTDOWN - 1) + ["unlocked"]
    assert not virtual(manager).unlock_in_progress
    assert manager.unlocked
    assert manager.take_events() == ["unlock"]


# ---------- read_unlocked and lock_keyboard ----------

def test_read_unlocked_during_an_unlock_gives_its_state_without_asking_the_keyboard(manager):
    manager.start_unlock()
    requests = sent(manager)
    assert manager.read_unlocked() == UnlockState("unlocking", KEYS)
    manager.cancel_unlock()
    assert manager.read_unlocked() == UnlockState("cancelled", KEYS)
    assert requests == []


def test_locking_a_locked_keyboard_is_no_event(manager):
    assert manager.lock_keyboard() == UnlockState("locked")
    assert manager.take_events() == []


# ---------- the app ----------

def test_vial_web_paces_the_unlock_polls(monkeypatch, capsys):
    made = []

    class Recording(DeviceManager):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            made.append(self)
    monkeypatch.setattr(device_module, "DeviceManager", Recording)
    assert vial_web.main(["--fake", "--dry-run"]) == 0
    assert [m.unlock_poll_gap for m in made] == [SAFE_UNLOCK_POLL_GAP]
