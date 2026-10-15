""" The server stays responsive and robust: device I/O off the event loop, events, errors and headers """
import asyncio
import json
import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import transport
from protocol.unlock_hook import set_unlock_handler
from server import app as app_module, edits
from server.app import EventHub, create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne, encode
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN

SECURITY_HEADERS = {
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
}


def pause(seconds):
    """ time.sleep is patched out for the protocol's retries, so wait on an event instead """
    threading.Event().wait(seconds)


def wait_until(condition, timeout=3.0):
    deadline = time.monotonic() + timeout
    while not condition() and time.monotonic() < deadline:
        pause(0.01)
    return condition()


@pytest.fixture
def server(tmp_path, monkeypatch):
    """ (client with a session cookie, device manager, app) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager, app
    set_unlock_handler(None)


# ---------- device I/O stays off the event loop ----------

def test_waiting_for_the_keyboard_does_not_block_other_requests(server, monkeypatch):
    client, manager, app = server
    monkeypatch.setattr(manager, "reload", lambda: None)  # what remains is the route's own device access
    held, release = threading.Event(), threading.Event()

    def busy_keyboard():
        with manager.lock:
            held.set()
            release.wait(3)
    holder = threading.Thread(target=busy_keyboard)
    holder.start()
    held.wait(3)
    results = []
    empty_layout = json.dumps({"layout": [], "encoder_layout": [], "layout_options": -1})
    requests = [threading.Thread(target=lambda: results.append(client.post("/api/reload").status_code)),
                threading.Thread(target=lambda: results.append(
                    client.post("/api/layout-file", content=empty_layout).status_code))]
    try:
        for r in requests:
            r.start()
        pause(0.3)  # both requests are now waiting for the keyboard
        start = time.monotonic()
        assert client.get("/api/health").status_code == 200
        elapsed = time.monotonic() - start
    finally:
        release.set()
        holder.join()
        for r in requests:
            r.join()
    assert elapsed < 1.0
    assert sorted(results) == [200, 200]


# ---------- session token ----------

def test_non_ascii_token_or_cookie_is_refused_not_an_error(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/session", headers={"cookie": b"vial_session=\xc4\x85"}).status_code == 401
        assert c.get("/?token=%C4%85").status_code == 401
        assert c.get("/?token=%C4%85", headers={"cookie": b"vial_session=\xc4\x85"}).status_code == 401
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(EVENTS, headers={"origin": BASE, "cookie": b"vial_session=\xc4\x85"}) as ws:
                ws.receive_json()


# ---------- tab-closed detection ----------

class Tab:
    """ Stands in for a UI tab's WebSocket """

    def __init__(self, stalls=False, fails=False, close_stalls=False):
        self.events = []
        self.stalls = stalls
        self.fails = fails
        self.close_stalls = close_stalls
        self.closed = None
        self.close_calls = 0

    async def send_json(self, event):
        if self.fails:
            raise RuntimeError("connection reset")
        if self.stalls:
            await asyncio.Event().wait()
        self.events.append(event)

    async def close(self, code=1000, reason=None):
        self.closed = code
        self.close_calls += 1
        if self.close_stalls:
            await asyncio.Event().wait()


def test_reopening_a_tab_restarts_the_closed_timer():
    gone = []

    async def scenario():
        hub = EventHub(lambda: gone.append(time.monotonic()), grace_seconds=0.5)
        first, second = Tab(), Tab()
        start = time.monotonic()
        await hub.add(first)
        await hub.remove(first)  # closed...
        await asyncio.sleep(0.2)
        await hub.add(second)  # ...and reopened within the grace period
        await asyncio.sleep(0.1)
        await hub.remove(second)  # closed again at about 0.3 s: notify at 0.8 s
        await asyncio.sleep(0.3)
        assert gone == []  # the first close's timer (0.5 s) must not fire
        await asyncio.sleep(0.6)
        return start

    start = asyncio.run(scenario())
    assert len(gone) == 1
    assert gone[0] - start >= 0.75


def test_a_tab_staying_open_cancels_the_closed_timer():
    gone = []

    async def scenario():
        hub = EventHub(lambda: gone.append(True), grace_seconds=0.1)
        first, second = Tab(), Tab()
        await hub.add(first)
        await hub.remove(first)
        await hub.add(second)
        await asyncio.sleep(0.3)

    asyncio.run(scenario())
    assert gone == []


def test_event_hub_has_no_unused_state():
    assert "ever_connected" not in vars(EventHub())


# ---------- broadcast ----------

def test_broadcast_drops_tabs_that_stop_reading_or_fail():
    async def scenario():
        hub = EventHub(send_timeout=0.1)
        good, stalled, broken = Tab(), Tab(stalls=True), Tab(fails=True)
        for tab in (good, stalled, broken):
            await hub.add(tab)
        start = time.monotonic()
        await hub.broadcast({"type": "reloaded"})
        elapsed = time.monotonic() - start
        await hub.broadcast({"type": "connected"})
        return hub, good, elapsed

    hub, good, elapsed = asyncio.run(scenario())
    assert elapsed < 0.5
    assert hub.clients == {good}
    assert good.events == [{"type": "reloaded"}, {"type": "connected"}]


def test_dropped_tabs_are_closed_without_holding_up_the_broadcast():
    """ A dropped tab's socket is closed, so the tab notices and reconnects instead of silently missing events """
    async def scenario():
        hub = EventHub(send_timeout=0.1)
        good, stalled, broken = Tab(), Tab(stalls=True, close_stalls=True), Tab(fails=True)
        for tab in (good, stalled, broken):
            await hub.add(tab)
        start = time.monotonic()
        await hub.broadcast({"type": "reloaded"})
        elapsed = time.monotonic() - start
        await asyncio.gather(*hub._closing.values())  # the stalled close gives up after the send timeout
        return good, stalled, broken, elapsed, hub

    good, stalled, broken, elapsed, hub = asyncio.run(scenario())
    assert elapsed < 1.0  # one send timeout (0.1 s), not also the stalled close
    assert good.closed is None
    assert stalled.closed is not None and broken.closed is not None
    assert not hub._closing


def test_a_tab_is_closed_once_and_shutdown_ends_pending_closes():
    async def scenario():
        hub = EventHub(send_timeout=0.1)
        stalled = Tab(stalls=True, close_stalls=True)
        await hub.add(stalled)
        # two broadcasts at once both find the tab stalled
        await asyncio.gather(hub.broadcast({"type": "reloaded"}), hub.broadcast({"type": "connected"}))
        pending = list(hub._closing.values())
        assert pending and not any(task.done() for task in pending)  # the close itself is stalled
        await hub.shutdown()
        return stalled, pending, hub

    stalled, pending, hub = asyncio.run(scenario())
    assert stalled.close_calls == 1
    assert all(task.done() for task in pending)
    assert not hub._closing


def test_dropped_websocket_tab_gets_closed(server):
    client, manager, app = server
    hub = app.state.hub
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
        tab = next(iter(hub.clients))

        async def failing_send(event):
            raise RuntimeError("stalled")
        tab.send_json = failing_send
        assert client.post("/api/reload").status_code == 200
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert hub.clients == set()


# ---------- hot-plug poll loop ----------

def test_poll_loop_survives_errors_and_stops_cleanly(tmp_path, caplog):
    manager = DeviceManager(FakeBackend(make_corne))
    calls = []

    def check():
        calls.append(True)
        if len(calls) == 1:
            raise OSError("hidapi hiccup")
        return []
    manager.check = check
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0.01)
    with caplog.at_level(logging.ERROR, logger="server.app"):
        with TestClient(app, base_url=BASE):
            assert wait_until(lambda: len(calls) >= 3)
    assert "hidapi hiccup" in caplog.text
    assert app.state.poll_task.done()


# ---------- error mapping and limits ----------

def test_recursion_error_is_a_bad_request(server, monkeypatch):
    client, manager, app = server

    def too_deep(*args):
        raise RecursionError("maximum recursion depth exceeded")
    monkeypatch.setattr(edits, "set_key", too_deep)
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}).status_code == 422


def test_closed_device_handle_is_a_keyboard_error_not_a_bad_request(server):
    """ hidapi raises ValueError for a closed or invalid handle; that must not look like an invalid request """
    client, manager, app = server
    manager.device.close()
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_B"}).status_code == 502
    # a request refused before the keyboard is touched is still a bad request
    assert client.put("/api/keymap/0/0/0", json={"code": "NOT_A_KEYCODE"}).status_code == 422
    # the hot-plug poll reopens the keyboard
    assert manager.check() == ["disconnected", "connected"]
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_B"}).status_code == 200
    assert manager.backend.virtual.keymap[0][0][0] == encode("KC_B")


def test_failed_reload_reports_the_keyboard_as_disconnected(server, monkeypatch):
    client, manager, app = server

    def broken():
        raise RuntimeError("bad reply")
    monkeypatch.setattr(manager.keyboard, "reload_keymap", broken)
    assert client.post("/api/reload").status_code == 502
    session = client.get("/api/session").json()
    assert (session["status"], session["device"], session["error"]) == ("disconnected", None, "bad reply")
    assert client.get("/api/keyboard").status_code == 503


def test_deeply_nested_request_bodies_are_bad_requests(server):
    client, manager, app = server
    deep = b"[" * 100000 + b"]" * 100000
    assert client.post("/api/layout-file", content=deep).status_code == 422
    response = client.put("/api/keymap/0/0/0", content=deep, headers={"content-type": "application/json"})
    assert 400 <= response.status_code < 500


def test_oversized_layout_file_is_refused(server):
    client, manager, app = server
    virtual = manager.backend.virtual
    before = [row[:] for row in virtual.keymap[0]]
    big = b" " * (app_module.MAX_LAYOUT_FILE + 1)
    assert client.post("/api/layout-file", content=big).status_code == 413
    assert client.post("/api/layout-file", content=iter([big[:1000], big[1000:]])).status_code == 413
    assert virtual.keymap[0] == before


def test_oversized_layout_file_is_refused_while_reading(tmp_path):
    """ An upload without a Content-Length is cut off at the limit instead of being read completely """
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    chunk = b" " * 65536
    total_chunks = 200  # 12.5 MiB
    received = []
    sent = []

    async def receive():
        if len(received) < total_chunks:
            received.append(True)
            return {"type": "http.request", "body": chunk, "more_body": len(received) < total_chunks}
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": "/api/layout-file", "raw_path": b"/api/layout-file", "query_string": b"", "root_path": "",
        "headers": [(b"host", "127.0.0.1:{}".format(PORT).encode()),
                    (b"cookie", "vial_session={}".format(TOKEN).encode())],
        "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", PORT),
    }
    asyncio.run(app(scope, receive, send))
    assert next(m["status"] for m in sent if m["type"] == "http.response.start") == 413
    assert len(received) <= app_module.MAX_LAYOUT_FILE // len(chunk) + 2


# ---------- security headers ----------

def test_security_headers_on_every_response(server):
    client, manager, app = server
    responses = [
        client.get("/api/health"),
        client.get("/api/session"),
        client.get("/"),
        client.put("/api/keymap/0/0/0", json={"code": "NOT_A_KEY"}),
        client.get("/api/session", headers={"host": "evil.example"}),
        client.get("/api/session", headers={"origin": "http://evil.example"}),
        client.get("/api/layout-file"),
        client.get("/?token=" + TOKEN, follow_redirects=False),
    ]
    with TestClient(app, base_url=BASE) as anonymous:
        responses.append(anonymous.get("/api/session"))
        responses.append(anonymous.get("/"))
    assert sorted({r.status_code for r in responses}) == [200, 303, 401, 403, 422]
    for response in responses:
        for name, value in SECURITY_HEADERS.items():
            assert response.headers.get(name) == value, (response.request.url, name)


def test_reload_reads_and_builds_in_one_worker_call(server, monkeypatch):
    """ Reading the keyboard and building the reply happen under one hold of the device lock """
    client, manager, app = server
    calls = []
    real = asyncio.to_thread

    async def counting(fn, *args, **kwargs):
        calls.append(fn)
        return await real(fn, *args, **kwargs)
    monkeypatch.setattr(app_module.asyncio, "to_thread", counting)
    assert client.post("/api/reload").status_code == 200
    assert len(calls) == 1


def test_disconnect_during_upload_is_logged_without_traceback(server, caplog):
    client, manager, app = server
    virtual = manager.backend.virtual
    data = json.loads(client.get("/api/layout-file").content)
    data["layout"][0][0][0] = "KC_Q"
    data["macro"][3] = [["text", "unplugged"]]

    def unplug(msg):
        virtual.connected = False
        raise OSError("device unplugged")
    virtual._write_macro_buffer = unplug
    with caplog.at_level(logging.INFO, logger="server.app"):
        assert client.post("/api/layout-file", content=json.dumps(data)).status_code == 503
    resync = [r for r in caplog.records if r.name == "server.app" and "re-read" in r.getMessage()]
    assert resync and all(r.exc_info is None for r in resync)
