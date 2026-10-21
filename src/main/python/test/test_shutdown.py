""" Quit Vial: POST /api/shutdown lets go of the keyboard, tells every tab, and stops the server once it has answered """
import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN


@pytest.fixture
def quitting(tmp_path, monkeypatch):
    """ (client with a session cookie, device manager, what on_stop saw each time it was called) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    stops = []

    def on_stop():
        # what the server stopping finds: the keyboard let go of already
        stops.append({"keyboard": manager.keyboard, "stopped": manager.stopped})

    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0, on_stop=on_stop)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager, stops
    set_unlock_handler(None)


def test_quit_lets_go_of_the_keyboard_then_stops_the_server(quitting):
    client, manager, stops = quitting
    device = manager.device
    response = client.post("/api/shutdown", headers=ORIGIN)
    assert response.status_code == 204
    assert response.content == b""
    assert device.closed
    assert stops == [{"keyboard": None, "stopped": True}]


def test_quit_tells_every_tab_that_vial_stopped(quitting):
    client, manager, stops = quitting
    with client.websocket_connect(EVENTS, headers=ORIGIN) as first, \
            client.websocket_connect(EVENTS, headers=ORIGIN) as second:
        assert first.receive_json() == {"type": "connected"}
        assert second.receive_json() == {"type": "connected"}
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
        assert first.receive_json() == {"type": "stopped"}
        assert second.receive_json() == {"type": "stopped"}


def test_after_quit_no_keyboard_is_opened_again(quitting):
    """ The server is stopping: the hot-plug poll doesn't find the keyboard still plugged in, and edits are refused """
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert manager.backend.virtual is not None  # still plugged in
    assert manager.check() == []
    assert manager.keyboard is None
    assert client.get("/api/session").json()["status"] == "disconnected"
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}, headers=ORIGIN).status_code == 503


def test_quit_asked_twice_answers_both_times(quitting):
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert [s["stopped"] for s in stops] == [True, True]  # uvicorn's should_exit, set twice


def test_quit_is_protected_like_every_route(quitting):
    client, manager, stops = quitting
    other_site = {"origin": "http://evil.example"}
    assert client.post("/api/shutdown", headers=other_site).status_code == 403
    assert client.post("/api/shutdown", headers={**ORIGIN, "host": "evil.example"}).status_code == 403
    client.cookies.clear()
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 401
    assert stops == []
    assert manager.keyboard is not None


def test_quit_is_refused_by_a_server_that_cannot_be_stopped_from_the_page(tmp_path, monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 501
        assert manager.keyboard is not None


def test_quit_is_in_the_api_schema(quitting):
    client, manager, stops = quitting
    schema = client.get("/openapi.json").json()
    assert "204" in schema["paths"]["/api/shutdown"]["post"]["responses"]
    assert "stopped" in schema["components"]["schemas"]["Event"]["properties"]["type"]["enum"]
