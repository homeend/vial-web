""" The matrix tester (the keys held), against the simulated keyboard """
import time

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.constants import CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, MatrixReading, has_matrix_tester, matrix_pressed, \
    require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN


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
    """ (client with a session cookie, manager) serving a Corne """
    manager = connected()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager


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
