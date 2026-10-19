""" Unlocking the keyboard: the device manager follows the protocol as Qt's unlocker does, and the API lets the UI run
it, against the simulated Corne (unlock keys: Tab at row 0 column 0, Backspace at row 4 column 0) """
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

import transport
import vial_web
from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_UNLOCK_POLL
from protocol.keyboard_comm import Keyboard
from protocol.unlock_hook import request_unlock, set_unlock_handler
from server import app as app_module
from server.app import create_app
from server.device import SAFE_UNLOCK_POLL_GAP, DeviceManager, FakeBackend, KeyboardLocked, NotConnected, \
    UnlockState, require_unlocked
from server.names import NamesStore
from simulator.corne import UNLOCK_KEYS, definition, make_corne
from simulator.device import SimulatedHidDevice
from simulator.virtual_keyboard import FIRMWARE_UNLOCK_POLL_GAP
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN
from test.test_api_server import pause, wait_until

COUNTDOWN = 3
""" the simulated keyboards here count down from 3, so that a few polls unlock them """
KEYS = tuple(UNLOCK_KEYS)
STEPS = [{"type": "text", "text": "hi"}]


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


def test_a_keyboard_that_cant_be_read_once_unlocked_is_reported_gone_with_why():
    m = DeviceManager(FakeBackend(interrupted_corne))
    m.connect()
    m.take_events()

    def fail():
        raise OSError("read failed")
    m.waiting.reload = fail
    m.backend.virtual.hold_unlock_keys(True)
    for _ in range(COUNTDOWN):
        m.poll_unlock()
    assert not m.connected
    assert m.unlock_state() == UnlockState("locked")
    # the UI reads the session again on "disconnected", which says why
    assert m.take_events() == ["unlock", "disconnected"]
    assert m.status() == (False, None, False, "read failed")


def test_unplugging_a_keyboard_that_waits_for_its_unlock_ends_it():
    m = DeviceManager(FakeBackend(interrupted_corne))
    m.connect()
    m.take_events()
    m.backend.virtual.connected = False
    assert m.check() == ["unlock"]
    assert m.unlock_state() == UnlockState("locked")
    assert m.status().title is None


# ---------- API ----------

@pytest.fixture
def api(tmp_path):
    """ (client with a session cookie, manager) of a locked Corne; the countdown is read every 10 ms """
    manager = DeviceManager(FakeBackend(locked_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager


def unlock_events(ws, until):
    """ The "unlock" events up to the first whose state is `until` """
    seen = []
    while True:
        event = ws.receive_json()
        if event["type"] != "unlock":
            continue
        seen.append(event["unlock"])
        if event["unlock"]["state"] == until:
            return seen


def test_session_and_model_say_whether_the_keyboard_is_unlocked(api):
    client, manager = api
    assert client.get("/api/session").json()["unlock"] == {"state": "locked", "keys": [], "remaining": 0, "total": 0}
    assert client.get("/api/keyboard").json()["unlocked"] is False


def test_a_macro_change_is_refused_while_locked_then_saved_once_unlocked(api):
    client, manager = api
    body = {"items": [STEPS] + [[]] * 15}
    refused = client.put("/api/macros", json=body)
    assert refused.status_code == 423
    assert refused.json()["detail"] == "the keyboard is locked: unlock it to make this change"

    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        started = client.post("/api/unlock/start").json()
        assert started == {"state": "unlocking", "keys": [{"row": 0, "col": 0}, {"row": 4, "col": 0}],
                           "remaining": 0, "total": 0}
        # the start's own "unlock" event; the countdown is then read until the keys are held all through it
        progress = unlock_events(ws, "unlocking")
        assert progress[0]["state"] == "unlocking"
        assert client.put("/api/macros", json=body).status_code == 423  # still waiting
        manager.backend.virtual.hold_unlock_keys(True)
        states = unlock_events(ws, "unlocked")
        assert [s["remaining"] for s in states if s["state"] == "unlocking" and s["remaining"] < COUNTDOWN]
        assert states[-1] == {"state": "unlocked", "keys": [], "remaining": 0, "total": 0}

    assert client.get("/api/session").json()["unlock"]["state"] == "unlocked"
    saved = client.put("/api/macros", json=body)
    assert saved.status_code == 200
    assert saved.json()["items"][0]["actions"] == [{"type": "text", "text": "hi", "keys": [], "delay": None}]


def test_cancel_and_lock(api):
    client, manager = api
    client.post("/api/unlock/start")
    assert client.post("/api/unlock/cancel").json()["state"] == "cancelled"
    manager.backend.virtual.hold_unlock_keys(True)
    pause(0.1)  # ten readings' worth of the countdown (every 10 ms here)
    assert manager.backend.virtual.unlock_counter == COUNTDOWN  # nothing reads the countdown any more
    assert client.post("/api/lock").status_code == 423  # the keyboard still waits for its unlock keys
    # started again and finished
    assert client.post("/api/unlock/start").json()["state"] == "unlocking"
    assert wait_until(lambda: client.get("/api/session").json()["unlock"]["state"] == "unlocked")
    assert client.post("/api/lock").json() == {"state": "locked", "keys": [], "remaining": 0, "total": 0}
    assert not manager.backend.virtual.unlocked


def test_the_simulator_hook_holds_the_keys_and_locks_the_keyboard(tmp_path):
    manager = DeviceManager(FakeBackend(lambda: make_corne()))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        assert client.get("/api/session").json()["unlock"]["state"] == "unlocked"
        assert client.put("/api/simulator/unlock", json={"locked": True}).json()["state"] == "locked"
        assert not manager.unlocked
        assert client.put("/api/simulator/unlock", json={"keysHeld": True}).status_code == 200
        assert manager.backend.virtual.pressed == set(UNLOCK_KEYS)
        client.post("/api/unlock/start")
        assert wait_until(lambda: client.get("/api/session").json()["unlock"]["state"] == "unlocked", timeout=5)
        client.put("/api/simulator/unlock", json={"keysHeld": False})
        assert manager.backend.virtual.pressed == set()


def test_an_interrupted_unlock_is_followed_from_the_start(tmp_path):
    manager = DeviceManager(FakeBackend(interrupted_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        session = client.get("/api/session").json()
        assert (session["status"], session["unlock"]["state"]) == ("disconnected", "unlocking")
        assert client.get("/api/keyboard").status_code == 503
        manager.backend.virtual.hold_unlock_keys(True)
        assert wait_until(lambda: client.get("/api/session").json()["status"] == "connected")
        assert client.get("/api/keyboard").json()["unlocked"] is True


# ---------- one reader of the countdown, cancel, shutdown ----------

INTERVAL = 0.05
""" seconds between two readings of the countdown in the tests below """


def poll_times(vk):
    """ When the simulated keyboard is sent unlock_poll from now on (time.monotonic seconds) """
    times = []
    process = vk.process

    def recording(msg):
        if msg[0] == CMD_VIA_VIAL_PREFIX and msg[1] == CMD_VIAL_UNLOCK_POLL:
            times.append(time.monotonic())
        return process(msg)
    vk.process = recording
    return times


def test_the_countdown_is_read_by_one_task_however_the_unlock_is_started(tmp_path):
    manager = DeviceManager(FakeBackend(locked_corne))
    manager.connect()
    # the hot-plug poll sees the unlock too, every 10 ms
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0.01,
                     unlock_interval=INTERVAL)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        client.post("/api/unlock/start")
        client.post("/api/unlock/start")  # from another tab
        client.post("/api/unlock/cancel")
        client.post("/api/unlock/start")  # started again at once
        client.post("/api/unlock/start")
        pause(INTERVAL * 2)  # a reader no longer wanted has stopped by now
        times = poll_times(manager.backend.virtual)
        pause(INTERVAL * 8)
        assert client.get("/api/session").json()["unlock"]["state"] == "unlocking"  # keys not held: it never ends
    assert len(times) >= 3
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert min(gaps) > INTERVAL * 0.8, gaps


def test_cancel_leaves_the_reader_to_stop_by_itself(api):
    client, manager = api
    follower = client.app.state.unlock_follower
    client.post("/api/unlock/start")
    task = follower.task
    assert task is not None and not task.done()
    assert client.post("/api/unlock/cancel").json()["state"] == "cancelled"
    assert wait_until(task.done)
    assert not task.cancelled()
    assert follower.task is None


def test_cancelling_as_the_unlock_ends_still_tells_every_tab_it_is_unlocked(api):
    """ The reader has just taken the unlock's last events when the user cancels: they still reach the tabs """
    client, manager = api
    took_last, go_on = threading.Event(), threading.Event()
    take_events = manager.take_events

    def slow_take_events():
        events = take_events()
        if manager.unlocked and "unlock" in events and not took_last.is_set():
            took_last.set()
            go_on.wait(5)
        return events
    manager.take_events = slow_take_events

    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        manager.backend.virtual.hold_unlock_keys(True)
        client.post("/api/unlock/start")
        assert took_last.wait(5)
        assert client.post("/api/unlock/cancel").json()["state"] == "unlocked"
        go_on.set()
        pause(0.2)
        client.post("/api/lock")  # an event after which to stop reading
        states = [s["state"] for s in unlock_events(ws, "locked")]
    assert states[-2:] == ["unlocked", "locked"]


def test_stopping_the_server_mid_unlock_leaves_no_task_running(tmp_path):
    manager = DeviceManager(FakeBackend(locked_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0.01,
                     unlock_interval=0.01)
    follower = app.state.unlock_follower
    tasks = []
    start = follower.start

    def recording_start():
        start()
        if follower.task is not None:
            tasks.append(follower.task)
    follower.start = recording_start
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        client.post("/api/unlock/start")
        pause(0.1)  # being read, and seen by the hot-plug poll
        assert tasks and not tasks[-1].done()
    assert all(task.done() for task in tasks)
    assert follower.task is None
    assert app.state.poll_task.done()


# ---------- timing ----------

def test_the_countdown_is_read_slowly_enough_for_the_firmware():
    # vial-qmk quantum/vial.c counts down only on a poll more than 100 ms after the unlock start or its last
    # count-down, and starts over on any sooner one; the device manager also leaves SAFE_UNLOCK_POLL_GAP between polls
    assert app_module.UNLOCK_POLL_INTERVAL >= SAFE_UNLOCK_POLL_GAP
    assert app_module.UNLOCK_POLL_INTERVAL > FIRMWARE_UNLOCK_POLL_GAP


@pytest.mark.parametrize("with_definition", [False, True])
def test_the_fake_keyboard_of_vial_web_counts_down_as_the_firmware_does(tmp_path, with_definition):
    argv = ["--fake"]
    if with_definition:
        path = tmp_path / "vial.json"
        path.write_text(json.dumps(definition()), encoding="utf-8")
        argv += ["--definition", str(path)]
    backend = vial_web.make_backend(vial_web.parse_args(argv))
    assert backend.keyboard_factory().unlock_poll_gap == FIRMWARE_UNLOCK_POLL_GAP
    # the tests' own simulated keyboards count down on every poll
    assert make_corne().unlock_poll_gap == 0
