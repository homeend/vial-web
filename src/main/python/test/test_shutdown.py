""" Quit Vial: POST /api/shutdown lets go of the keyboard, tells every tab, and stops the server once it has answered """
import asyncio
import logging
import threading
import time

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import STOPPED_CLOSE_CODE, create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN


def pause(seconds):
    """ time.sleep, which the tests here turn off (transport.time is the time module) """
    threading.Event().wait(seconds)


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


def test_quit_closes_every_tabs_link_once_it_is_told(quitting):
    """ The server closes them before it stops: uvicorn 0.54, stopping, fails on a link a tab is still closing (see
    test_vial_web's test_a_tab_closing_its_link_as_vial_stops_doesnt_make_vial_fail) """
    client, manager, stops = quitting
    with client.websocket_connect(EVENTS, headers=ORIGIN) as first, \
            client.websocket_connect(EVENTS, headers=ORIGIN) as second:
        assert first.receive_json() == {"type": "connected"}
        assert second.receive_json() == {"type": "connected"}
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
        for tab in (first, second):
            assert tab.receive_json() == {"type": "stopped"}
            with pytest.raises(WebSocketDisconnect) as closed:
                tab.receive_json()
            assert closed.value.code == STOPPED_CLOSE_CODE == 1001  # going away


def test_after_quit_no_keyboard_is_opened_again(quitting):
    """ The server is stopping: the hot-plug poll doesn't find the keyboard still plugged in, and edits are refused """
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert manager.backend.virtual is not None  # still plugged in
    assert manager.check() == []
    assert manager.keyboard is None
    assert client.get("/api/session").json()["status"] == "disconnected"
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}, headers=ORIGIN).status_code == 503


def test_quit_asked_twice_answers_both_times_and_stops_the_server_once(quitting):
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert [s["stopped"] for s in stops] == [True]  # the console says once that Vial is stopping


def test_quit_asked_twice_at_once_lets_go_of_the_keyboard_once_and_answers_both(tmp_path, monkeypatch):
    """ The second request comes while the first is still letting go of the keyboard: it waits for that, and answers
    the same """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    closing = threading.Event()
    closes = []
    close = manager.close

    def slow_close():
        closes.append(True)
        closing.set()
        pause(0.3)  # the other request arrives meanwhile
        close()
    monkeypatch.setattr(manager, "close", slow_close)
    stops = []
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     on_stop=lambda: stops.append(manager.stopped))

    async def quit_twice():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE) as client:
            assert (await client.get("/?token=" + TOKEN, follow_redirects=False)).status_code == 303

            async def second():
                await asyncio.to_thread(closing.wait, 5)  # sent once the first is letting go of the keyboard
                return await client.post("/api/shutdown", headers=ORIGIN)
            return await asyncio.gather(client.post("/api/shutdown", headers=ORIGIN), second())
    try:
        first, second = asyncio.run(quit_twice())
    finally:
        set_unlock_handler(None)
    assert (first.status_code, second.status_code) == (204, 204)
    assert closes == [True]
    assert stops == [True]


def test_a_failed_step_of_quit_is_logged_and_vial_stops_all_the_same(quitting, monkeypatch, caplog):
    """ The server stops even if the keyboard couldn't be let go of: vial_web closes it again on its way out """
    client, manager, stops = quitting

    def broken():
        raise OSError("the keyboard went away")
    monkeypatch.setattr(manager, "close", broken)
    with client.websocket_connect(EVENTS, headers=ORIGIN) as tab:
        assert tab.receive_json() == {"type": "connected"}
        with caplog.at_level(logging.ERROR, logger="server.app"):
            assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
        assert tab.receive_json() == {"type": "stopped"}  # told all the same
    assert "the keyboard went away" in caplog.text
    assert len(stops) == 1
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204  # asked again: not stuck on the failure
    assert len(stops) == 1


def test_a_failure_before_the_keyboard_is_let_go_of_still_lets_go_of_it(quitting, monkeypatch, caplog):
    client, manager, stops = quitting
    device = manager.device

    follower = client.app.state.unlock_follower
    shutdown = follower.shutdown
    failures = []

    async def broken():
        if not failures:  # the first time only: the server's own stop runs it too
            failures.append(True)
            raise RuntimeError("the unlock follower failed")
        await shutdown()
    monkeypatch.setattr(follower, "shutdown", broken)
    with caplog.at_level(logging.ERROR, logger="server.app"):
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert "the unlock follower failed" in caplog.text
    assert device.closed
    assert stops == [{"keyboard": None, "stopped": True}]


def test_a_tab_that_connects_after_quit_is_told_vial_stopped_first(quitting):
    """ e.g. a tab that was reconnecting: it must not wait for a Vial that is gone for good """
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    with client.websocket_connect(EVENTS, headers=ORIGIN) as late:
        assert late.receive_json() == {"type": "stopped"}
        with pytest.raises(WebSocketDisconnect) as closed:  # and closed, as the others were
            late.receive_json()
        assert closed.value.code == STOPPED_CLOSE_CODE


def test_tabs_closing_after_quit_dont_say_vial_is_still_running(tmp_path, monkeypatch):
    """ The tabs close their links once told Vial stopped: that isn't "all tabs closed, Vial is still running" """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    gone = []
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     close_grace=0.05, on_all_clients_gone=lambda: gone.append(True), on_stop=lambda: None)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        with client.websocket_connect(EVENTS, headers=ORIGIN) as tab:
            assert tab.receive_json() == {"type": "connected"}
        deadline = time.monotonic() + 5
        while not gone and time.monotonic() < deadline:
            pause(0.02)
        assert gone == [True]  # without Quit, the last tab closing is reported
        gone.clear()
        with client.websocket_connect(EVENTS, headers=ORIGIN) as tab:
            assert tab.receive_json() == {"type": "connected"}
            assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
            assert tab.receive_json() == {"type": "stopped"}
        pause(0.5)  # the grace, ten times over
        assert gone == []


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
