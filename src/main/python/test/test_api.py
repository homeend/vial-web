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
        assert "vial_session_{}={}".format(PORT, TOKEN) in cookie
        assert "HttpOnly" in cookie and "SameSite=strict" in cookie


def test_requests_without_session_are_refused(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/session").status_code == 401
        assert c.get("/?token=wrong").status_code == 401
        assert c.get("/").status_code == 401
        assert c.get("/api/health").status_code == 200


class NoRealKeyboard:
    """ A real-mode backend that finds nothing; never touches hidapi """
    fake = False

    def find(self):
        return []


@pytest.mark.parametrize("backend, fake", [(FakeBackend(make_corne), True), (NoRealKeyboard(), False)])
def test_health_says_whether_the_keyboard_is_simulated(tmp_path, backend, fake):
    """ A second launch only attaches to an instance of its own mode """
    app = create_app(DeviceManager(backend), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0,
                     instance_id="abc")
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/health").json() == {"app": "vial", "instance": "abc", "fake": fake}


def test_session_cookie_is_per_port(tmp_path):
    """ Two servers on 127.0.0.1 share cookies: each has its own cookie name, for HTTP and WebSocket requests alike """
    app = create_app(DeviceManager(FakeBackend(make_corne)), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
                     poll_interval=0)
    ours = {"origin": BASE, "cookie": "vial_session_{}={}".format(PORT, TOKEN)}
    other_ports = {"origin": BASE, "cookie": "vial_session_{}={}; vial_session={}".format(PORT + 1, TOKEN, TOKEN)}
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/session", headers=other_ports).status_code == 401
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(EVENTS, headers=other_ports) as ws:
                ws.receive_json()
        assert c.get("/api/session", headers=ours).status_code == 200
        with c.websocket_connect(EVENTS, headers=ours) as ws:
            assert ws.receive_json() == {"type": "disconnected"}


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


def test_keycode_catalogue_works_without_a_keyboard(setup):
    client, virtual, app = setup
    client.put("/api/simulator/connection", json={"connected": False})
    app.state.manager.check()  # the hot-plug poll notices
    assert client.get("/api/session").json()["status"] == "disconnected"
    response = client.get("/api/keycodes")
    assert response.status_code == 200 and response.json()[0]["name"] == "Basic"
    assert client.post("/api/keycodes/parse", json={"expression": "LT(1, KC_A)"}).json()["code"] == "LT1(KC_A)"


def test_keycode_catalogue_before_any_keyboard_was_connected(tmp_path):
    app = create_app(DeviceManager(NoRealKeyboard()), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
                     poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        response = c.get("/api/keycodes")
        assert response.status_code == 200
        assert any(k["code"] == "KC_A" for k in response.json()[0]["keycodes"])


def test_keycode_catalogue_has_descriptions(client):
    modifiers = next(c for c in client.get("/api/keycodes").json() if c["name"] == "Modifiers")["keycodes"]
    gesc = next(k for k in modifiers if k["code"] == "KC_GESC")
    assert gesc["legend"] == {"main": "Esc", "shifted": "~", "altGr": None}
    assert gesc["description"].startswith("Esc normally") and "tooltip" not in gesc


def test_placeholder_page_when_ui_not_built(client):
    response = client.get("/")
    assert response.status_code == 200 and "Vial server is running" in response.text


def test_placeholder_page_keeps_an_events_connection_open(client):
    """ Without one, Vial would never print the reopen message once the tab is closed """
    response = client.get("/")
    assert '<script>' in response.text and '"ws://" + location.host + "/api/events"' in response.text
    csp = response.headers["content-security-policy"]
    assert "script-src" not in csp and "default-src" not in csp  # the inline script may run


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
    original = client.get("/api/layout-file").content
    assert client.post("/api/layout-file", content=original).status_code == 200
    assert json.loads(client.get("/api/layout-file").content) == json.loads(original)

    data = json.loads(original)
    assert data["layout"][0][0][0] == "KC_TAB"
    data["layout"][0][0][0] = "KC_Q"
    response = client.post("/api/layout-file", content=json.dumps(data))
    assert response.status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Q")
    assert json.loads(client.get("/api/layout-file").content) == data
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


# ---------- simulator controls (fake mode only) ----------

def test_simulated_keyboard_can_be_unplugged_and_plugged_back(setup):
    client, virtual, app = setup
    response = client.put("/api/simulator/connection", json={"connected": False})
    assert response.status_code == 200 and response.json() == {"connected": False}
    assert not virtual.connected
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}).status_code == 503
    assert client.put("/api/simulator/connection", json={"connected": True}).json() == {"connected": True}
    assert virtual.connected


def test_unplugging_the_simulator_is_reported_by_the_hot_plug_poll(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        c.put("/api/simulator/connection", json={"connected": False})
        assert manager.check() == ["disconnected"]
        c.put("/api/simulator/connection", json={"connected": True})
        assert manager.check() == ["connected"]
        assert c.get("/api/keyboard").status_code == 200


def test_simulator_controls_need_the_session(tmp_path):
    app = create_app(DeviceManager(FakeBackend(make_corne)), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
                     poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        assert c.put("/api/simulator/connection", json={"connected": False}).status_code == 401


def test_simulator_controls_do_not_exist_for_real_keyboards(tmp_path):
    app = create_app(DeviceManager(NoRealKeyboard()), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
                     poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        assert c.put("/api/simulator/connection", json={"connected": False}).status_code in (404, 405)
        assert "/api/simulator/connection" not in c.get("/openapi.json").text


# ---------- keyboard languages ----------

POLISH = "polish-qwerty"


def key_at(model, layer, row, col):
    index = next(i for i, k in enumerate(model["keys"]) if (k["row"], k["col"]) == (row, col))
    return model["layers"][layer]["keys"][index]


def test_keyboard_languages_are_listed(client):
    listed = client.get("/api/keyboard-languages").json()
    assert listed[0] == {"id": "en-us", "name": "English (US)"}
    assert {"id": POLISH, "name": "Polish (QWERTY)"} in listed


def test_keyboard_is_described_in_the_chosen_language(client):
    # base layer, right home row: RALT_T(KC_E)
    english = key_at(client.get("/api/keyboard").json(), 0, 5, 3)
    polish = key_at(client.get("/api/keyboard", params={"lang": POLISH}).json(), 0, 5, 3)
    assert (english["tap"], english["legend"]["altGr"]) == ("E", None)
    assert (polish["code"], polish["tap"], polish["legend"]["altGr"]) == ("RALT_T(KC_E)", "E", "ę")


def test_keycode_catalogue_in_the_chosen_language(client):
    basic = client.get("/api/keycodes", params={"lang": POLISH}).json()[0]["keycodes"]
    assert next(k for k in basic if k["code"] == "KC_A")["legend"]["altGr"] == "ą"


def test_edits_and_parsing_answer_in_the_chosen_language(client):
    set_key = client.put("/api/keymap/0/0/0", params={"lang": POLISH}, json={"code": "RALT(KC_A)"})
    assert set_key.json()["tap"] == "ą"
    parsed = client.post("/api/keycodes/parse", params={"lang": POLISH}, json={"expression": "KC_L"})
    assert parsed.json()["legend"]["altGr"] == "ł"
    assert client.post("/api/keycodes/parse", json={"expression": "KC_L"}).json()["legend"]["altGr"] is None


def test_unknown_language_is_refused(client, virtual):
    response = client.put("/api/keymap/0/0/0", params={"lang": "klingon"}, json={"code": "KC_A"})
    assert response.status_code == 422 and "unknown keyboard language" in response.json()["detail"]
    assert virtual.keymap[0][0][0] == encode("KC_TAB")
