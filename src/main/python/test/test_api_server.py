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

    def __init__(self, stalls=False, fails=False):
        self.events = []
        self.stalls = stalls
        self.fails = fails

    async def send_json(self, event):
        if self.fails:
            raise RuntimeError("connection reset")
        if self.stalls:
            await asyncio.Event().wait()
        self.events.append(event)


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


def test_upload_still_round_trips(server):
    client, manager, app = server
    data = json.loads(client.get("/api/layout-file").content)
    data["layout"][0][0][0] = "KC_Q"
    assert client.post("/api/layout-file", content=json.dumps(data), headers=ORIGIN).status_code == 200
    assert manager.backend.virtual.keymap[0][0][0] == encode("KC_Q")
