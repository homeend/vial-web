import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne, encode

TOKEN = "test-token"
PORT = 8765
BASE = "http://127.0.0.1:{}".format(PORT)
ORIGIN = {"origin": BASE}
# the test client sends "Host: testserver" on WebSockets unless the URL names the host
EVENTS = "ws://127.0.0.1:{}/api/events".format(PORT)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """ (client with a session cookie, simulated keyboard, app) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    gone = []
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     close_grace=0.05, on_all_clients_gone=lambda: gone.append(True))
    app.state.gone = gone
    with TestClient(app, base_url=BASE) as client:
        response = client.get("/?token=" + TOKEN, follow_redirects=False)
        assert response.status_code == 303
        yield client, manager.backend.virtual, app
    set_unlock_handler(None)


@pytest.fixture
def client(setup):
    return setup[0]


@pytest.fixture
def virtual(setup):
    return setup[1]


# ---------- security ----------

def test_token_handshake_sets_http_only_cookie(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        response = c.get("/?token=" + TOKEN, follow_redirects=False)
        assert response.headers["location"] == "/"
        cookie = response.headers["set-cookie"]
        assert "vial_session=" + TOKEN in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie


def test_requests_without_session_are_refused(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/session").status_code == 401
        assert c.get("/?token=wrong").status_code == 401
        assert c.get("/").status_code == 401
        assert c.get("/api/health").status_code == 200


def test_foreign_host_and_origin_are_refused(client):
    assert client.get("/api/session", headers={"host": "evil.example"}).status_code == 403
    assert client.get("/api/session", headers={"host": "127.0.0.1:9999"}).status_code == 403
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"},
                      headers={"origin": "http://evil.example"}).status_code == 403
    assert client.get("/api/session", headers=ORIGIN).status_code == 200


# ---------- reading ----------

def test_session_and_keyboard(client):
    assert client.get("/api/session").json() == \
        {"status": "connected", "fake": True, "device": "Simulated: Simulated Corne", "error": None}
    kb = client.get("/api/keyboard").json()
    assert (kb["name"], len(kb["layers"]), len(kb["keys"])) == ("Simulated Corne", 4, 42)


def test_keycodes_and_parse(client):
    names = [c["name"] for c in client.get("/api/keycodes").json()]
    assert names[:2] == ["Basic", "Shifted"]
    assert client.post("/api/keycodes/parse", json={"expression": "LCTL(KC_A)"}).json()["tap"] == "Ctrl+A"
    assert client.post("/api/keycodes/parse", json={"expression": "NOPE"}).status_code == 422


def test_placeholder_page_when_ui_not_built(client):
    response = client.get("/")
    assert response.status_code == 200 and "Vial server is running" in response.text


# ---------- writing ----------

def test_set_key_writes_to_keyboard(client, virtual):
    response = client.put("/api/keymap/0/0/0", json={"code": "LCTL(KC_A)"})
    assert response.status_code == 200
    assert response.json()["tap"] == "Ctrl+A"
    assert virtual.keymap[0][0][0] == encode("LCTL(KC_A)")


@pytest.mark.parametrize("path, body", [
    ("/api/keymap/9/0/0", {"code": "KC_A"}),
    ("/api/keymap/0/3/0", {"code": "KC_A"}),
    ("/api/keymap/0/0/0", {"code": "NOT_A_KEY"}),
    ("/api/tap-dance/99", {"tap": "KC_A", "hold": "KC_NO", "doubleTap": "KC_NO", "tapHold": "KC_NO",
                           "tappingTerm": 200}),
    ("/api/qmk-settings/1", {"value": 1}),
])
def test_invalid_writes_are_rejected(client, virtual, path, body):
    before = [row[:] for row in virtual.keymap[0]]
    assert client.put(path, json=body).status_code == 422
    assert virtual.keymap[0] == before


def test_tap_dance_combo_override_alt_repeat(client, virtual):
    td = client.put("/api/tap-dance/2", json={"tap": "KC_A", "hold": "KC_LCTL", "doubleTap": "KC_B",
                                              "tapHold": "KC_NO", "tappingTerm": 180}).json()
    assert (td["name"], td["tappingTerm"]) == ("A / LCtrl / B", 180)
    assert virtual.tap_dance[2] == (encode("KC_A"), encode("KC_LCTL"), encode("KC_B"), 0, 180)

    combo = client.put("/api/combos/2", json={"keys": ["KC_J", "KC_K", "KC_NO", "KC_NO"], "output": "KC_ESC"})
    assert combo.json()["output"]["code"] == "KC_ESCAPE"
    assert virtual.combos[2] == (encode("KC_J"), encode("KC_K"), 0, 0, encode("KC_ESC"))

    ko = client.put("/api/key-overrides/1", json={"trigger": "KC_A", "replacement": "KC_B", "layers": 1,
                                                  "triggerMods": 2, "negativeModMask": 0, "suppressedMods": 2,
                                                  "options": 0x80})
    assert ko.json()["enabled"] is True
    assert virtual.key_overrides[1] == (encode("KC_A"), encode("KC_B"), 1, 2, 0, 2, 0x80)

    ark = client.put("/api/alt-repeat/0", json={"keycode": "KC_A", "altKeycode": "KC_B", "allowedMods": 0,
                                                "options": 8})
    assert ark.json()["enabled"] is True
    assert virtual.alt_repeat_keys[0] == (encode("KC_A"), encode("KC_B"), 0, 8)


def test_macros(client, virtual):
    items = [[] for _ in range(16)]
    items[3] = [{"type": "text", "text": "hi"}, {"type": "tap", "keys": ["KC_ENT"]}, {"type": "delay", "delay": 20}]
    result = client.put("/api/macros", json={"items": items})
    assert result.status_code == 200
    assert result.json()["items"][3]["name"] == "hi"
    assert virtual.macros()[3] == b"hi\x01\x01\x28\x01\x04\x15\x01"

    items[0] = [{"type": "text", "text": "x" * 250}] * 4  # 1000 bytes; one text step holds at most 255
    response = client.put("/api/macros", json={"items": items})
    assert response.status_code == 422 and "bytes" in response.json()["detail"]
    assert client.put("/api/macros", json={"items": items[:3]}).status_code == 422


def test_settings_and_lighting(client, virtual):
    assert client.put("/api/qmk-settings/7", json={"value": 180}).json() == {"qsid": 7, "value": 180}
    assert virtual.settings[7] == 180
    reset = {s["qsid"]: s["value"] for s in client.post("/api/qmk-settings/reset").json()}
    assert reset[7] == 200
    assert "tabs" in client.get("/api/qmk-settings/definitions").json()

    lighting = client.put("/api/lighting", json={"vialrgb": {"mode": 3, "hsv": [10, 20, 255]}}).json()
    assert lighting["vialrgb"]["mode"] == 3
    assert virtual.vialrgb["hsv"] == (10, 20, 200)  # clamped to the keyboard's maximum brightness
    assert virtual.lighting_saved
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 99}}).status_code == 422
    assert client.put("/api/lighting", json={"backlight": {"brightness": 1}}).status_code == 422


def test_names(client):
    assert client.put("/api/names/layers/1", json={"name": "symbols"}).json()["layers"] == {"1": "symbols"}
    assert client.get("/api/keyboard").json()["layers"][1]["name"] == "symbols"
    assert client.put("/api/names/combos/1", json={"name": "x"}).status_code == 422


def test_layout_file_round_trip(client, virtual):
    data = json.loads(client.get("/api/layout-file").content)
    assert data["layout"][0][0][0] == "KC_TAB"
    data["layout"][0][0][0] = "KC_Q"
    response = client.post("/api/layout-file", content=json.dumps(data))
    assert response.status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Q")
    assert client.post("/api/layout-file", content=b"not json").status_code == 422


# ---------- failures ----------

def test_locked_keyboard_refuses_bootloader_key(client, virtual):
    virtual.unlocked = False
    response = client.put("/api/keymap/0/0/0", json={"code": "QK_BOOT"})
    assert response.status_code == 423
    assert virtual.keymap[0][0][0] == encode("KC_TAB")


def test_unplugged_keyboard_gives_503(client, virtual):
    virtual.connected = False
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}).status_code == 503
    assert client.get("/api/keyboard").status_code == 503
    assert client.get("/api/session").json()["status"] == "disconnected"


# ---------- live events ----------

def test_websocket_requires_origin_and_session(client):
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(EVENTS) as ws:
            ws.receive_json()


def test_last_tab_closing_is_reported(setup):
    client, virtual, app = setup
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        assert app.state.gone == []
    deadline = time.time() + 2
    while not app.state.gone and time.time() < deadline:
        time.sleep(0.02)
    assert app.state.gone == [True]
