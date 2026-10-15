""" Invalid requests are refused with 422 before anything is written to the keyboard """
import copy
import json

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import encode
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN, setup, client, virtual  # noqa: F401 (fixtures)

TD_BODY = {"tap": "KC_A", "hold": "KC_NO", "doubleTap": "KC_NO", "tapHold": "KC_NO", "tappingTerm": 200}
KO_BODY = {"trigger": "KC_A", "replacement": "KC_B", "layers": 1, "triggerMods": 0, "negativeModMask": 0,
           "suppressedMods": 0, "options": 0x80}
ARK_BODY = {"keycode": "KC_A", "altKeycode": "KC_B", "allowedMods": 0, "options": 8}


def snapshot(virtual):
    """ Everything the simulated keyboard stores """
    return copy.deepcopy((virtual.keymap, virtual.encoders, virtual.layout_options, bytes(virtual.macro_buffer),
                          virtual.tap_dance, virtual.combos, virtual.key_overrides, virtual.alt_repeat_keys,
                          virtual.settings, virtual.vialrgb))


def macro_items(**changes):
    items = [[] for _ in range(16)]
    for index, actions in changes.items():
        items[int(index[1:])] = actions
    return items


# ---------- keycodes ----------

@pytest.mark.parametrize("code", ["True", "False", "true"])
def test_bools_are_not_keycodes(client, virtual, code):
    assert client.post("/api/keycodes/parse", json={"expression": code}).status_code == 422
    before = snapshot(virtual)
    assert client.put("/api/keymap/0/0/0", json={"code": code}).status_code == 422
    assert snapshot(virtual) == before


@pytest.mark.parametrize("code, problem", [
    ("TD(8)", "tap dance"), ("TD(200)", "tap dance"), ("0x57C8", "tap dance"),
    ("M16", "macro"), ("0x7710", "macro"),
    ("MO(4)", "layer"), ("MO(15)", "layer"), ("TG(31)", "layer"), ("TO(4)", "layer"), ("TT(4)", "layer"),
    ("OSL(4)", "layer"), ("DF(4)", "layer"), ("PDF(4)", "layer"), ("LT4(KC_A)", "layer"),
    ("LT(15, KC_A)", "layer"), ("LM(5, MOD_LSFT)", "layer"),
])
def test_keycodes_beyond_the_keyboard_are_refused(client, virtual, code, problem):
    before = snapshot(virtual)
    response = client.put("/api/keymap/0/0/0", json={"code": code})
    assert response.status_code == 422
    assert problem in response.json()["detail"]
    assert snapshot(virtual) == before


@pytest.mark.parametrize("code", ["TD(7)", "M15", "MO(3)", "TO(3)", "LT3(KC_A)", "LM(3, MOD_LSFT)", "KC_A"])
def test_keycodes_within_the_keyboard_are_accepted(client, virtual, code):
    assert client.put("/api/keymap/0/0/0", json={"code": code}).status_code == 200
    assert virtual.keymap[0][0][0] == encode(client.post("/api/keycodes/parse",
                                                         json={"expression": code}).json()["code"])


@pytest.mark.parametrize("path, body", [
    ("/api/tap-dance/0", dict(TD_BODY, doubleTap="TD(9)")),
    ("/api/tap-dance/0", dict(TD_BODY, tapHold="MO(4)")),
    ("/api/combos/0", {"keys": ["KC_A", "M20", "KC_NO", "KC_NO"], "output": "KC_B"}),
    ("/api/combos/0", {"keys": ["KC_A", "KC_B", "KC_NO", "KC_NO"], "output": "TG(5)"}),
    ("/api/key-overrides/0", dict(KO_BODY, replacement="OSL(9)")),
    ("/api/key-overrides/0", dict(KO_BODY, trigger="TD(100)")),
    ("/api/alt-repeat/0", dict(ARK_BODY, altKeycode="LT7(KC_A)")),
    ("/api/macros", {"items": macro_items(m0=[{"type": "tap", "keys": ["KC_A", "MO(6)"]}])}),
    ("/api/macros", {"items": macro_items(m0=[{"type": "down", "keys": ["NOT_A_KEY"]}])}),
])
def test_every_keycode_field_is_checked(client, virtual, path, body):
    before = snapshot(virtual)
    assert client.put(path, json=body).status_code == 422
    assert snapshot(virtual) == before


ENCODER_DEFINITION = {"name": "Knob", "matrix": {"rows": 1, "cols": 2}, "lighting": "none",
                      "layouts": {"keymap": [["0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"], ["0,0", "0,1"]]}}


def test_encoder_keycodes_are_checked(tmp_path, monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    try:
        manager = DeviceManager(FakeBackend(lambda: VirtualKeyboard(ENCODER_DEFINITION, layers=2)))
        manager.connect()
        app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
        with TestClient(app, base_url=BASE) as c:
            c.get("/?token=" + TOKEN, follow_redirects=False)
            assert c.put("/api/encoders/0/0/1", json={"code": "MO(2)"}).status_code == 422
            assert c.put("/api/encoders/0/0/1", json={"code": "TD(0)"}).status_code == 422  # no tap dances
            assert manager.backend.virtual.encoders.get((0, 0, 1), 0) == 0
            assert c.put("/api/encoders/0/0/1", json={"code": "MO(1)"}).status_code == 200
            assert manager.backend.virtual.encoders[(0, 0, 1)] == encode("MO(1)")
    finally:
        set_unlock_handler(None)


# ---------- other fields ----------

@pytest.mark.parametrize("hsv", [[999, -5, 300], [256, 0, 0], [0, -1, 0], [0, 0, 256]])
def test_vialrgb_colour_must_be_bytes(client, virtual, hsv):
    before = snapshot(virtual)
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": hsv}}).status_code == 422
    assert snapshot(virtual) == before
    # nothing stale was cached: the next write still works
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": [1, 2, 3]}}).status_code == 200
    assert virtual.vialrgb["hsv"] == (1, 2, 3)


def test_setting_value_must_fit_the_setting(client, virtual):
    before = snapshot(virtual)
    assert client.put("/api/qmk-settings/7", json={"value": 70000}).status_code == 422  # 2-byte setting
    assert client.put("/api/qmk-settings/22", json={"value": 256}).status_code == 422  # 1-byte setting
    assert client.put("/api/qmk-settings/999", json={"value": 1}).status_code == 422  # unknown setting
    assert snapshot(virtual) == before
    settings = {s["qsid"]: s["value"] for s in client.get("/api/keyboard").json()["settings"]}
    assert settings[7] == 200
    assert client.put("/api/qmk-settings/7", json={"value": 65535}).status_code == 200
    assert virtual.settings[7] == 65535


@pytest.mark.parametrize("text", ["a\0b", "\x01\x04", "\u0105\u20ac", "x" * 256, "bell\x07", "del\x7f"])
def test_macro_text_must_be_printable_ascii(client, virtual, text):
    before = snapshot(virtual)
    response = client.put("/api/macros", json={"items": macro_items(m0=[{"type": "text", "text": text}])})
    assert response.status_code == 422
    assert snapshot(virtual) == before


def test_macro_text_allows_tab_and_newline(client, virtual):
    text = "line one\n\tline two ~"
    response = client.put("/api/macros", json={"items": macro_items(m3=[{"type": "text", "text": text}])})
    assert response.status_code == 200
    assert response.json()["items"][3]["actions"] == [{"type": "text", "text": text, "keys": [], "delay": None}]
    assert virtual.macros()[3] == text.encode("ascii")


def test_name_index_must_exist(client):
    for kind, count in (("layers", 4), ("tapDance", 8), ("macros", 16)):
        assert client.put("/api/names/{}/{}".format(kind, count), json={"name": "x"}).status_code == 422
        assert client.put("/api/names/{}/-1".format(kind), json={"name": "x"}).status_code == 422
        assert client.put("/api/names/{}/{}".format(kind, count - 1), json={"name": "x"}).status_code == 200
    names = client.get("/api/names").json()
    assert names == {"layers": {"3": "x"}, "tapDance": {"7": "x"}, "macros": {"15": "x"}}


def test_lighting_is_checked_before_writing(client, virtual):
    before = snapshot(virtual)
    response = client.put("/api/lighting", json={"vialrgb": {"mode": 3, "hsv": [1, 2, 3]},
                                                 "backlight": {"brightness": 1}})
    assert response.status_code == 422
    response = client.put("/api/lighting", json={"vialrgb": {"mode": 3}, "rgblight": {"effect": 1}})
    assert response.status_code == 422
    assert snapshot(virtual) == before
    assert not virtual.lighting_saved


# ---------- size limits and unknown fields ----------

@pytest.mark.parametrize("path, body", [
    ("/api/keymap/0/0/0", {"code": "KC_A", "extra": 1}),
    ("/api/keymap/0/0/0", {"code": "LCTL(" * 40 + "KC_A" + ")" * 40}),
    ("/api/tap-dance/0", dict(TD_BODY, tap="KC_A" + " " * 300)),
    ("/api/tap-dance/0", dict(TD_BODY, color="red")),
    ("/api/combos/0", {"keys": ["KC_A", "KC_B", "KC_NO", "KC_NO"], "output": "KC_C", "x": 0}),
    ("/api/key-overrides/0", dict(KO_BODY, enabled=True)),
    ("/api/alt-repeat/0", dict(ARK_BODY, enabled=True)),
    ("/api/macros", {"items": macro_items(m0=[{"type": "tap", "keys": ["KC_A"] * 33}])}),
    ("/api/macros", {"items": macro_items(m0=[{"type": "tap", "keys": ["KC_A"]}] * 257)}),
    ("/api/macros", {"items": [[] for _ in range(257)]}),
    ("/api/macros", {"items": macro_items(m0=[{"type": "tap", "keys": ["KC_A"], "name": "x"}])}),
    ("/api/qmk-settings/7", {"value": 1, "x": 1}),
    ("/api/lighting", {"vialrgb": {"mode": 3, "brightness": 4}}),
    ("/api/names/layers/0", {"name": "x", "color": "red"}),
    ("/api/layout-options", {"value": 0, "x": 1}),
])
def test_oversized_and_unknown_fields_are_refused(client, virtual, path, body):
    before = snapshot(virtual)
    assert client.put(path, json=body).status_code == 422
    assert snapshot(virtual) == before


# ---------- .vil upload: all or nothing ----------

def upload(client, data):
    return client.post("/api/layout-file", content=data if isinstance(data, bytes) else json.dumps(data))


@pytest.fixture
def vil(client):
    """ The keyboard's current .vil with key 0,0 changed, so a partial write would show """
    data = json.loads(client.get("/api/layout-file").content)
    data["layout"][0][0][0] = "KC_Z"
    return data


def break_encoders(d):
    del d["encoder_layout"]


def break_setting(d):
    d["settings"] = {"7": 99999999999}


def break_tapping_term(d):
    d["tap_dance"][0][4] = 99999999


def break_keycode(d):
    d["layout"][0][0][1] = "NOT_A_KEY"


def break_tap_dance_reference(d):
    d["layout"][1][0][1] = "TD(200)"


def break_layer_reference(d):
    d["combo"][0][4] = "MO(9)"


def break_macro_text(d):
    d["macro"][2] = [["text", "a\u0000b"]]


def break_macro_key(d):
    d["macro"][2] = [["tap", "KC_A", "M99"]]


def break_macro_tag(d):
    d["macro"][2] = [["wiggle", 3]]


def break_key_override(d):
    d["key_override"][0]["layers"] = 0x10000


def break_alt_repeat_key(d):
    d["alt_repeat_key"][0]["alt_keycode"] = "BOGUS"


def break_bool_keycode(d):
    d["layout"][0][1][0] = True


def break_layout_options(d):
    d["layout_options"] = "wide"


def break_macro_size(d):
    d["macro"] = [[["text", "x" * 200]] for _ in range(16)]


@pytest.mark.parametrize("breaker", [
    break_encoders, break_setting, break_tapping_term, break_keycode, break_tap_dance_reference,
    break_layer_reference, break_macro_text, break_macro_key, break_macro_tag, break_key_override,
    break_alt_repeat_key, break_bool_keycode, break_layout_options, break_macro_size,
])
def test_invalid_layout_file_writes_nothing(client, virtual, vil, breaker):
    breaker(vil)
    before = snapshot(virtual)
    response = upload(client, vil)
    assert response.status_code == 422, response.text
    assert snapshot(virtual) == before


@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b"\xff\xfe", b"[" * 100000 + b"]" * 100000,
                                  json.dumps({"layout": []}).encode()],
                         ids=["not json", "not an object", "not utf-8", "deeply nested", "missing sections"])
def test_malformed_layout_file(client, virtual, body):
    before = snapshot(virtual)
    assert upload(client, body).status_code == 422
    assert snapshot(virtual) == before


def test_locked_keyboard_refuses_layout_file_with_bootloader_key(client, virtual, vil):
    virtual.unlocked = False
    vil["layout"][0][0][1] = "QK_BOOT"
    before = snapshot(virtual)
    assert upload(client, vil).status_code == 423
    assert snapshot(virtual) == before


def test_locked_keyboard_refuses_layout_file_that_changes_macros(client, virtual, vil):
    virtual.unlocked = False
    vil["macro"][2] = [["text", "new"]]
    before = snapshot(virtual)
    assert upload(client, vil).status_code == 423
    assert snapshot(virtual) == before


def test_locked_keyboard_accepts_layout_file_without_sensitive_changes(client, virtual, vil):
    virtual.unlocked = False
    assert upload(client, vil).status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Z")


def test_layout_file_restores_everything(client, virtual, vil):
    vil["layout"][3][1][1] = "MO(2)"
    vil["layout_options"] = 0
    vil["macro"][2] = [["text", "hello\n"], ["tap", "KC_A", "LCTL(KC_C)"], ["delay", 30]]
    vil["tap_dance"][3] = ["KC_A", "TD(1)", "KC_NO", "KC_NO", 150]
    vil["combo"][3] = ["KC_A", "KC_B", "KC_NO", "KC_NO", "M1"]
    vil["key_override"][2] = {"trigger": "KC_A", "replacement": "KC_B", "layers": 3, "trigger_mods": 2,
                              "negative_mod_mask": 0, "suppressed_mods": 2, "options": 0x81}
    vil["alt_repeat_key"][1] = {"keycode": "KC_UP", "alt_keycode": "KC_DOWN", "allowed_mods": 0, "options": 8}
    vil["settings"] = {"7": 250, "999": 5}  # settings this keyboard doesn't have are skipped
    response = upload(client, vil)
    assert response.status_code == 200, response.text
    assert virtual.keymap[0][0][0] == encode("KC_Z")
    assert virtual.keymap[3][1][1] == encode("MO(2)")
    actions = response.json()["macros"]["items"][2]["actions"]
    assert [(a["type"], a["text"], [k["code"] for k in a["keys"]], a["delay"]) for a in actions] == \
        [("text", "hello\n", [], None), ("tap", None, ["KC_A", "LCTL(KC_C)"], None), ("delay", None, [], 30)]
    assert virtual.tap_dance[3] == (encode("KC_A"), encode("TD(1)"), 0, 0, 150)
    assert virtual.combos[3] == (encode("KC_A"), encode("KC_B"), 0, 0, encode("M1"))
    assert virtual.key_overrides[2] == (encode("KC_A"), encode("KC_B"), 3, 2, 0, 2, 0x81)
    assert virtual.alt_repeat_keys[1] == (encode("KC_UP"), encode("KC_DOWN"), 0, 8)
    assert virtual.settings[7] == 250
    assert response.json()["layers"][0]["keys"][0]["code"] == "KC_Z"


class Recorder:
    """ Stands in for a UI tab's WebSocket and keeps the events it is sent """

    def __init__(self):
        self.events = []

    async def send_json(self, event):
        self.events.append(event)


def test_layout_file_failing_halfway_makes_the_ui_reload(setup, vil, monkeypatch):
    client, virtual, app = setup
    tab = Recorder()
    app.state.hub.clients.add(tab)

    def broken(msg):
        raise RuntimeError("the keyboard stopped answering")
    monkeypatch.setattr(virtual, "_write_macro_buffer", broken)
    vil["macro"][2] = [["text", "new"]]
    response = upload(client, vil)
    assert response.status_code == 502
    assert tab.events == [{"type": "reloaded"}]
    # what was written before the failure is what the server now reports
    assert virtual.keymap[0][0][0] == encode("KC_Z")
    assert client.get("/api/keyboard").json()["layers"][0]["keys"][0]["code"] == "KC_Z"


def test_layout_file_success_makes_the_ui_reload(setup, vil):
    client, virtual, app = setup
    tab = Recorder()
    app.state.hub.clients.add(tab)
    assert upload(client, vil).status_code == 200
    assert tab.events == [{"type": "reloaded"}]
