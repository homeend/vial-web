""" The matrix tester (the keys held, read while a tab watches) and the reboot to the bootloader, against the simulated
keyboard """
import asyncio
import threading
import time
from collections import deque

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.constants import CMD_VIA_BOOTLOADER_JUMP, CMD_VIA_GET_KEYBOARD_VALUE, CMD_VIA_GET_KEYCODE, \
    VIA_SWITCH_MATRIX_STATE
from protocol.unlock_hook import set_unlock_handler
from server.app import MATRIX_FAILURE_PAUSE, MatrixWatcher, create_app
from server.device import MATRIX_STRAYS_MAX, DeviceManager, FakeBackend, JumpUnanswered, KeyboardLocked, \
    KeyboardRefused, MatrixReading, NotConnected, has_matrix_tester, matrix_pressed, require_unlocked
from server.names import NamesStore
from simulator.corne import UNLOCK_KEYS, make_corne
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN
from test.test_api_server import pause, wait_until

INTERVAL = 0.03
GAP = 0.015


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


def connected(factory=make_corne):
    manager = DeviceManager(FakeBackend(factory))
    assert manager.connect()
    manager.take_events()
    return manager


def locked_corne():
    vk = make_corne()
    vk.unlocked = False
    vk.unlock_counter_max = 2
    return vk


def matrix_requests(vk):
    """ When the simulated keyboard is asked for its switch matrix from now on (time.monotonic seconds) """
    times = []
    process = vk.process

    def recording(msg):
        if msg[0] == CMD_VIA_GET_KEYBOARD_VALUE and msg[1] == VIA_SWITCH_MATRIX_STATE:
            times.append(time.monotonic())
        return process(msg)
    vk.process = recording
    return times


@pytest.fixture
def served(tmp_path):
    """ (client with a session cookie, manager) serving a Corne; the matrix is read every 30 ms while watched """
    manager = connected()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01, matrix_interval=INTERVAL, matrix_gap=GAP)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager


def matrix_events(ws, until):
    """ The "matrix" states sent up to the first that `until` takes """
    seen = []
    while True:
        event = ws.receive_json()
        if event["type"] != "matrix":
            continue
        seen.append(event["matrix"])
        if until(event["matrix"]):
            return seen


def press(client, row, col, pressed=True):
    response = client.put("/api/simulator/matrix", json={"row": row, "col": col, "pressed": pressed})
    assert response.status_code == 200
    return response.json()


# ---------- reading the matrix ----------

def test_the_reply_is_read_as_qt_reads_it():
    # 2 bytes of request, then each row: ceil(cols / 8) bytes, the highest columns first
    data = bytes([2, 3]) + bytes([0b0000_0010, 0b1000_0001]) + bytes([0, 0]) + bytes([0b0000_0001, 0])
    assert matrix_pressed(data, 3, 10) == [(0, 0), (0, 7), (0, 9), (2, 8)]


def test_a_wide_matrix_is_read_from_the_simulator():
    definition = {"name": "Wide", "matrix": {"rows": 2, "cols": 12}, "lighting": "none",
                  "layouts": {"keymap": [["0,0", "0,11"], ["1,3", "1,8"]]}}
    manager = connected(lambda: VirtualKeyboard(definition))
    vk = manager.backend.virtual
    vk.press(0, 11)
    vk.press(1, 3)
    assert manager.poll_matrix() == MatrixReading("testing", ((0, 11), (1, 3)))


def test_the_corne_tells_its_keys_held():
    manager = connected()
    assert manager.poll_matrix() == MatrixReading("testing")
    manager.backend.virtual.press(4, 5)
    manager.backend.virtual.press(7, 3)
    assert manager.poll_matrix() == MatrixReading("testing", ((4, 5), (7, 3)))


def test_a_locked_keyboard_is_not_asked():
    manager = connected(locked_corne)
    times = matrix_requests(manager.backend.virtual)
    assert manager.poll_matrix() == MatrixReading("locked")
    manager.start_unlock()
    assert manager.poll_matrix() == MatrixReading("locked")  # waiting for its unlock keys: it answers nothing else
    assert times == []


def test_keyboards_that_cant_tell():
    old = connected(lambda: VirtualKeyboard(make_corne().definition, vial_protocol=2))
    assert not has_matrix_tester(old.keyboard)
    assert old.poll_matrix() == MatrixReading("unsupported")
    # via.c leaves a matrix out that may not fit in a reply: (cols / 8 + 1) * rows > 28
    big = {"name": "Big", "matrix": {"rows": 15, "cols": 8}, "lighting": "none", "layouts": {"keymap": [["0,0"]]}}
    assert not has_matrix_tester(connected(lambda: VirtualKeyboard(big)).keyboard)
    fits = dict(big, matrix={"rows": 14, "cols": 8})
    assert has_matrix_tester(connected(lambda: VirtualKeyboard(fits)).keyboard)


def test_the_model_says_whether_the_matrix_tester_works(served):
    client, manager = served
    assert client.get("/api/keyboard").json()["matrixTester"] is True


class QueuedReplies:
    """ The simulated keyboard's replies queued as a HID device queues them. The next `slow` replies come late: the
    read waiting for one gives up, and it arrives after the next read, whatever that read got, ahead of the replies to
    later requests. The next `lost` replies never come. `strays` are reports that arrive right after the next request
    is sent, ahead of its reply. """

    def __init__(self, device):
        self.queue = deque()
        self.late = []
        """ sent late, not arrived yet """
        self.arriving = []
        """ arriving: in the queue at the next write or read """
        self.slow = 0
        self.lost = 0
        self.strays = []
        write, read = device.write, device.read

        def queued_write(data):
            self._arrive()
            written = write(data)
            reply = bytes(read(transport.MSG_LEN))
            self.queue.extend(self.strays)
            self.strays.clear()
            if self.lost:
                self.lost -= 1
            elif self.slow:
                self.slow -= 1
                self.late.append(reply)
            else:
                self.queue.append(reply)
            return written

        def queued_read(length, timeout_ms=0):
            self._arrive()
            data = list(self.queue.popleft()) if self.queue else []
            self.arriving, self.late = self.late, []
            return data
        device.write, device.read = queued_write, queued_read

    def _arrive(self):
        self.queue.extend(self.arriving)
        self.arriving = []

    def idle(self):
        """ nothing queued or still to come """
        return not (self.queue or self.late or self.arriving)


def stray_report():
    """ What a keymap reply would read as, taken for the matrix: every key of the first rows held """
    return bytes([CMD_VIA_GET_KEYCODE, 0, 0xff, 0xff, 0xff, 0xff]).ljust(transport.MSG_LEN, b"\0")


def test_a_late_reply_is_not_taken_for_the_next_request():
    manager = connected()
    replies = QueuedReplies(manager.device)
    manager.backend.virtual.press(4, 5)
    # the first try goes unanswered in time, so the request is sent again: two replies come
    replies.slow = 1
    assert manager.poll_matrix() == MatrixReading("testing", ((4, 5),))
    assert manager.run(lambda kb: kb.get_unlock_status()) == 1
    assert manager.poll_matrix() == MatrixReading("testing", ((4, 5),))
    assert replies.idle()


def test_a_reply_late_after_the_request_got_through_is_not_taken_for_the_next_one():
    manager = connected()
    replies = QueuedReplies(manager.device)
    # two tries go unanswered in time; the late replies come while the next try waits, and after it
    replies.slow = 2
    assert manager.poll_matrix() == MatrixReading("testing")
    manager.backend.virtual.press(2, 3)
    assert manager.run(lambda kb: kb.get_unlock_status()) == 1
    assert manager.poll_matrix() == MatrixReading("testing", ((2, 3),))
    assert replies.idle()


def test_a_report_that_isnt_the_matrix_is_not_read_as_it():
    manager = connected()
    replies = QueuedReplies(manager.device)
    manager.backend.virtual.press(0, 1)
    replies.strays += [stray_report(), stray_report()]
    assert manager.poll_matrix() == MatrixReading("testing", ((0, 1),))
    assert replies.idle()
    # too many: the reading fails, and its reply, which comes after them, isn't read as the next one's
    replies.strays += [stray_report()] * (MATRIX_STRAYS_MAX + 1)
    with pytest.raises(RuntimeError):
        manager.poll_matrix()
    manager.backend.virtual.press(0, 2)
    assert manager.poll_matrix() == MatrixReading("testing", ((0, 1), (0, 2)))
    assert manager.run(lambda kb: kb.get_unlock_status()) == 1
    assert replies.idle()


def test_a_report_that_isnt_the_matrix_with_no_reply_after_it_fails_the_reading():
    manager = connected()
    replies = QueuedReplies(manager.device)
    replies.strays.append(stray_report())
    replies.lost = 1
    with pytest.raises(RuntimeError):
        manager.poll_matrix()
    # as an unanswered request does: the handle is reopened by the next hot-plug check
    assert manager.check() == ["disconnected", "connected"]
    assert manager.poll_matrix() == MatrixReading("testing")


# ---------- watching it ----------

def test_a_tab_watching_gets_the_keys_held_at_every_change(served):
    client, manager = served
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        ws.send_json({"type": "matrix", "watch": True})
        assert matrix_events(ws, lambda m: True) == [{"state": "testing", "pressed": []}]
        assert press(client, 0, 0) == {"pressed": [[0, 0]]}
        assert matrix_events(ws, lambda m: m["pressed"])[-1] == {"state": "testing", "pressed": [{"row": 0, "col": 0}]}
        press(client, 4, 5)
        press(client, 0, 0, False)
        states = matrix_events(ws, lambda m: m["pressed"] == [{"row": 4, "col": 5}])
        assert all(m["state"] == "testing" for m in states)
        press(client, 4, 5, False)
        assert matrix_events(ws, lambda m: not m["pressed"])
        ws.send_json({"type": "matrix", "watch": False})
        assert wait_until(lambda: client.app.state.matrix.task is None)


def test_reading_stops_when_no_tab_watches(served):
    client, manager = served
    watcher = client.app.state.matrix
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        matrix_events(ws, lambda m: True)
        assert watcher.task is not None
    # the tab closed: no more readings
    assert wait_until(lambda: watcher.task is None)
    times = matrix_requests(manager.backend.virtual)
    pause(INTERVAL * 5)
    assert times == []


def test_two_tabs_share_one_reader_and_a_late_one_gets_the_last_reading(served):
    client, manager = served
    watcher = client.app.state.matrix
    press(client, 1, 1)
    with client.websocket_connect(EVENTS, headers=ORIGIN) as first, \
            client.websocket_connect(EVENTS, headers=ORIGIN) as second:
        first.receive_json()
        second.receive_json()
        first.send_json({"type": "matrix", "watch": True})
        assert matrix_events(first, lambda m: True)[-1]["pressed"] == [{"row": 1, "col": 1}]
        task = watcher.task
        second.send_json({"type": "matrix", "watch": True})
        assert matrix_events(second, lambda m: True) == [{"state": "testing", "pressed": [{"row": 1, "col": 1}]}]
        assert watcher.task is task
        first.send_json({"type": "matrix", "watch": False})
        pause(INTERVAL * 3)
        assert watcher.task is task  # the second still watches
    press(client, 1, 1, False)


def test_messages_that_arent_asking_to_watch_are_ignored(served):
    client, manager = served
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        for text in ["not json", "[1]", '{"type": "matrix"}', '{"type": "matrix", "watch": 1}', '{"type": "x"}']:
            ws.send_text(text)
        pause(INTERVAL * 3)
        assert client.app.state.matrix.task is None
        assert client.get("/api/session").status_code == 200


def test_readings_are_paced(served):
    client, manager = served
    times = matrix_requests(manager.backend.virtual)
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        pause(INTERVAL * 12)
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert len(gaps) >= 5
    # about every INTERVAL, never back to back
    assert min(gaps) > INTERVAL * 0.7, gaps


def test_readings_leave_the_keyboard_alone_for_a_while_even_when_slow(tmp_path):
    manager = connected()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     matrix_interval=0.01, matrix_gap=0.05)
    poll = manager.poll_matrix

    def slow_poll():
        pause(0.03)  # longer than the interval
        return poll()
    manager.poll_matrix = slow_poll
    times = matrix_requests(manager.backend.virtual)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
            ws.receive_json()
            ws.send_json({"type": "matrix", "watch": True})
            pause(0.5)
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert gaps and min(gaps) > 0.05 + 0.03 * 0.7, gaps


def test_edits_are_not_held_up_while_the_matrix_is_read(served):
    client, manager = served
    readings = []
    poll = manager.poll_matrix

    def counting_poll():
        readings.append(True)
        return poll()
    manager.poll_matrix = counting_poll
    slowest = 0
    edits = 0
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        matrix_events(ws, lambda m: True)
        until = time.monotonic() + INTERVAL * 10
        while time.monotonic() < until:
            started = time.monotonic()
            assert client.put("/api/keymap/0/0/0", json={"code": ["KC_A", "KC_TAB"][edits % 2]}).status_code == 200
            slowest = max(slowest, time.monotonic() - started)
            edits += 1
    assert len(readings) >= 5 and edits >= 10
    # an edit waits at most for one reading to end
    assert slowest < 0.5, slowest


def test_a_locked_keyboard_says_so_then_shows_the_keys_once_unlocked(tmp_path):
    manager = connected(locked_corne)
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01, matrix_interval=INTERVAL, matrix_gap=GAP)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
            ws.receive_json()
            ws.send_json({"type": "matrix", "watch": True})
            assert matrix_events(ws, lambda m: True) == [{"state": "locked", "pressed": []}]
            # the unlock runs (the countdown is read meanwhile), then the keys show
            client.put("/api/simulator/unlock", json={"keysHeld": True})
            client.post("/api/unlock/start")
            states = matrix_events(ws, lambda m: m["state"] == "testing")
            # the unlock keys are held: they show
            assert states[-1]["pressed"] == [{"row": r, "col": c} for r, c in sorted(UNLOCK_KEYS)]
            client.post("/api/lock")
            assert matrix_events(ws, lambda m: m["state"] == "locked")[-1] == {"state": "locked", "pressed": []}


def test_an_unplugged_keyboard_is_reported_and_followed_again_when_back(served):
    client, manager = served
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        matrix_events(ws, lambda m: True)
        client.put("/api/simulator/connection", json={"connected": False})
        manager.check()
        assert matrix_events(ws, lambda m: m["state"] == "disconnected")[-1] == {"state": "disconnected", "pressed": []}
        client.put("/api/simulator/connection", json={"connected": True})
        manager.check()
        assert matrix_events(ws, lambda m: m["state"] == "testing")


def test_a_failed_reading_is_logged_once_and_reading_goes_on(served, caplog):
    client, manager = served
    poll = manager.poll_matrix
    failures = []

    def failing_poll():
        if len(failures) < 3:
            failures.append(True)
            raise RuntimeError("failed to communicate with the device")
        return poll()
    manager.poll_matrix = failing_poll
    client.app.state.matrix.failure_pause = GAP
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        ws.send_json({"type": "matrix", "watch": True})
        assert matrix_events(ws, lambda m: True) == [{"state": "testing", "pressed": []}]
    assert [r.message for r in caplog.records].count(
        "reading the switch matrix failed: failed to communicate with the device") == 1


def test_a_failed_reading_is_followed_by_a_pause():
    manager = connected()
    poll = manager.poll_matrix
    readings = []

    def failing_poll():
        readings.append(True)
        if len(readings) <= 2:
            raise RuntimeError("failed to communicate with the device")
        return poll()
    manager.poll_matrix = failing_poll
    pauses = []
    sent = []

    async def send(ws, event):
        sent.append(event)

    async def watch():
        watcher = MatrixWatcher(manager, send, INTERVAL, GAP, sleep=sleep)
        await watcher.watch("tab")
        while len(pauses) < 4:
            await asyncio.sleep(0)
        await watcher.shutdown()

    async def sleep(seconds):
        pauses.append(seconds)
        await asyncio.sleep(0)
    asyncio.run(watch())
    # after each failure the keyboard is left alone for a while; then readings are paced as usual
    assert pauses[:2] == [MATRIX_FAILURE_PAUSE, MATRIX_FAILURE_PAUSE]
    assert all(GAP <= p <= INTERVAL for p in pauses[2:4]), pauses
    assert MATRIX_FAILURE_PAUSE >= 0.5
    assert sent[0] == {"type": "matrix", "matrix": {"state": "testing", "pressed": []}}


def test_a_keyboard_locked_behind_the_servers_back_says_locked(served):
    client, manager = served
    assert manager.unlocked
    manager.backend.virtual.unlocked = False  # another app locked it: the firmware shows nothing held
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        ws.send_json({"type": "matrix", "watch": True})
        events = []
        while not any(e["type"] == "matrix" for e in events):
            events.append(ws.receive_json())
        assert [e["unlock"]["state"] for e in events if e["type"] == "unlock"] == ["locked"]
        assert events[-1]["matrix"] == {"state": "locked", "pressed": []}
    assert not manager.unlocked


def test_stopping_the_server_while_watched_leaves_no_task():
    manager = connected()
    sent = []

    async def send(ws, event):
        sent.append(event)

    async def watch_then_stop():
        watcher = MatrixWatcher(manager, send, INTERVAL, GAP)
        await watcher.watch("tab")
        task = watcher.task
        await asyncio.sleep(INTERVAL * 3)
        await watcher.shutdown()
        await watcher.watch("another tab")  # nothing starts once stopping
        return watcher, task
    watcher, task = asyncio.run(watch_then_stop())
    assert task.done() and watcher.task is None
    assert sent == [{"type": "matrix", "matrix": {"state": "testing", "pressed": []}}]


def test_the_simulator_hook_presses_and_lets_go(served):
    client, manager = served
    assert press(client, 2, 3) == {"pressed": [[2, 3]]}
    assert manager.backend.virtual.pressed == {(2, 3)}
    assert press(client, 2, 3, False) == {"pressed": []}
    assert client.put("/api/simulator/matrix", json={"row": 256, "col": 0, "pressed": True}).status_code == 422


# ---------- reboot to the bootloader ----------

def test_rebooting_needs_an_unlocked_keyboard():
    manager = connected(locked_corne)
    with pytest.raises(KeyboardLocked):
        manager.reboot_to_bootloader()
    vk = manager.backend.virtual
    assert vk.connected and not vk.bootloader_requested
    assert manager.connected


def test_rebooting_drops_the_keyboard():
    manager = connected()
    manager.reboot_to_bootloader()
    assert manager.backend.virtual.bootloader_requested
    assert not manager.connected
    assert manager.take_events() == ["disconnected"]
    # it isn't found again: in its bootloader it is no Vial keyboard
    assert manager.check() == []


def test_firmware_without_the_jump_says_so_and_stays():
    manager = connected(lambda: VirtualKeyboard(make_corne().definition, bootloader_jump=False))
    with pytest.raises(KeyboardRefused, match="can't reboot into its bootloader"):
        manager.reboot_to_bootloader()
    assert manager.connected
    assert manager.run(lambda kb: kb.get_unlock_status()) == 1


def test_the_bootloader_route(served):
    client, manager = served
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        session = client.post("/api/bootloader").json()
        assert (session["status"], session["device"], session["error"]) == ("disconnected", None, None)
        assert ws.receive_json() == {"type": "disconnected"}
    assert manager.backend.virtual.bootloader_requested
    assert client.get("/api/keyboard").status_code == 503


def test_the_bootloader_route_refuses_a_locked_keyboard(tmp_path):
    manager = connected(locked_corne)
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        response = client.post("/api/bootloader")
        assert response.status_code == 423
        assert response.json()["detail"] == "the keyboard is locked: unlock it to make this change"
        assert client.get("/api/session").json()["status"] == "connected"
        assert not manager.backend.virtual.bootloader_requested


def test_the_bootloader_route_with_firmware_without_the_jump(tmp_path):
    manager = connected(lambda: VirtualKeyboard(make_corne().definition, bootloader_jump=False))
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN)
        response = client.post("/api/bootloader")
        assert response.status_code == 422
        assert "built without that" in response.json()["detail"]
        assert client.get("/api/session").json()["status"] == "connected"


def test_waiting_reboot_requests_wait_for_the_device_lock():
    """ A reboot sent while another request holds the keyboard waits for it, then jumps """
    manager = connected()
    release = threading.Event()
    holding = threading.Event()

    def hold(kb):
        holding.set()
        release.wait(5)
    worker = threading.Thread(target=manager.run, args=(hold,))
    worker.start()
    assert holding.wait(5)
    done = []
    rebooter = threading.Thread(target=lambda: done.append(manager.reboot_to_bootloader()))
    rebooter.start()
    pause(0.05)
    assert not done and not manager.backend.virtual.bootloader_requested
    release.set()
    worker.join(5)
    rebooter.join(5)
    assert manager.backend.virtual.bootloader_requested


def jump_requests(manager, lose_reply=False):
    """ How many bootloader jumps the simulated keyboard is sent from now on (a list that counts them); with
    lose_reply the jump is taken but its answer never arrives, as when the keyboard drops off the bus first """
    vk = manager.backend.virtual
    sent = []
    process = vk.process

    def counting(msg):
        reply = process(msg)
        if msg[0] == CMD_VIA_BOOTLOADER_JUMP:
            sent.append(msg)
        return reply
    vk.process = counting
    if lose_reply:
        dev = manager.handle.dev
        read = dev.read

        def losing(length, timeout_ms=0):
            data = read(length, timeout_ms)
            return [] if data and data[0] == CMD_VIA_BOOTLOADER_JUMP else data
        dev.read = losing
    return sent


def test_the_jump_is_sent_once():
    manager = connected()
    sent = jump_requests(manager)
    manager.reboot_to_bootloader()
    assert len(sent) == 1


def test_the_jump_is_sent_once_when_the_reply_is_lost():
    """ Sent, and not answered: the keyboard most likely jumped, which the error says, and it is closed """
    manager = connected()
    vk = manager.backend.virtual
    sent = jump_requests(manager, lose_reply=True)
    with pytest.raises(JumpUnanswered):
        manager.reboot_to_bootloader()
    assert len(sent) == 1 and vk.bootloader_requested
    assert not manager.connected
    assert manager.take_events() == ["disconnected"]


def test_a_lost_reply_from_a_keyboard_still_plugged_in_closes_it_until_it_is_found_again():
    """ The reply lost, but the keyboard still there (it didn't jump after all): it is closed all the same, as most
    likely gone, and the hot-plug poll opens it again """
    manager = connected()
    vk = manager.backend.virtual
    jump_requests(manager, lose_reply=True)
    # it answers, and stays
    vk._bootloader = lambda msg: msg
    with pytest.raises(JumpUnanswered):
        manager.reboot_to_bootloader()
    assert not manager.connected
    assert manager.take_events() == ["disconnected"]
    assert manager.check() == ["connected"]


def test_a_jump_that_could_not_be_sent_is_no_lost_reply():
    """ The keyboard went before the jump was written: nothing was sent, which isn't a jump that went unanswered """
    manager = connected()
    vk = manager.backend.virtual
    sent = jump_requests(manager)
    dev = manager.handle.dev

    def unplugged(data):
        vk.connected = False
        raise OSError("the keyboard is gone")
    dev.write = unplugged
    with pytest.raises(NotConnected) as raised:
        manager.reboot_to_bootloader()
    assert not isinstance(raised.value, JumpUnanswered)
    assert sent == [] and not vk.bootloader_requested


def test_the_bootloader_route_says_when_the_reply_was_lost(served):
    """ 504, unlike a jump not sent (503): the keyboard most likely restarted into its bootloader; the "disconnected"
    event comes first """
    client, manager = served
    jump_requests(manager, lose_reply=True)
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        response = client.post("/api/bootloader")
        assert response.status_code == 504
        assert "most likely rebooted into its bootloader" in response.json()["detail"]
        assert ws.receive_json() == {"type": "disconnected"}
    assert manager.backend.virtual.bootloader_requested
    assert client.get("/api/session").json()["status"] == "disconnected"


def test_the_bootloader_route_is_guarded(served):
    client, manager = served
    with TestClient(client.app, base_url=BASE) as anonymous:
        assert anonymous.post("/api/bootloader").status_code == 401
    assert client.post("/api/bootloader", headers={"origin": "http://evil.example"}).status_code == 403
    assert client.get("/api/bootloader").status_code == 405
    assert not manager.backend.virtual.bootloader_requested
    assert manager.connected


def test_the_bootloader_route_when_the_keyboard_was_locked_behind_our_back(served):
    client, manager = served
    assert manager.unlocked
    manager.backend.virtual.unlocked = False
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        assert client.post("/api/bootloader").status_code == 423
        message = ws.receive_json()
        assert (message["type"], message["unlock"]["state"]) == ("unlock", "locked")
    assert not manager.unlocked and not manager.backend.virtual.bootloader_requested
