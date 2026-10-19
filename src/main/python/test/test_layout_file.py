""" .vil files: the preview of what loading one changes, files of another keyboard, the download's name, and a locked
keyboard that must never be written in part """
import json

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server import app as app_module
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import CORNE_UID, encode
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, ORIGIN, PORT, TOKEN, setup, client, virtual  # noqa: F401 (fixtures)
from test.test_api_validation import snapshot

# 1 row x 2 columns, one encoder, and a layout option
OPTIONS = {"name": "Knob/Pad: \"mini\"", "matrix": {"rows": 1, "cols": 2},
           "layouts": {"labels": ["Split"],
                       "keymap": [["0,0", "0,1\n\n\n0,0", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


def preview(client, data):
    return client.post("/api/layout-file/preview", content=data if isinstance(data, bytes) else json.dumps(data))


def upload(client, data):
    return client.post("/api/layout-file", content=data if isinstance(data, bytes) else json.dumps(data))


@pytest.fixture
def vil(client):
    return json.loads(client.get("/api/layout-file").content)


@pytest.fixture
def knob(tmp_path, monkeypatch):
    """ (client, simulated keyboard with an encoder and a layout option) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(lambda: VirtualKeyboard(OPTIONS, layers=2)))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        yield c, manager.backend.virtual
    set_unlock_handler(None)


# ---------- the preview ----------

def test_the_keyboards_own_file_changes_nothing(client, virtual, vil):
    response = preview(client, vil)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["uid"] == "{:016X}".format(CORNE_UID)
    for section in ("keys", "encoders", "tapDance", "combos", "keyOverrides", "altRepeatKeys", "macros", "settings",
                    "ignored"):
        assert result[section] == [], section
    assert (result["layoutOptions"], result["needsUnlock"]) == (None, False)


def test_the_preview_lists_every_change_and_writes_none(client, virtual, vil):
    vil["layout"][0][0][0] = "KC_Z"
    vil["layout"][2][4][1] = "LCTL(KC_C)"
    vil["tap_dance"][3] = ["KC_A", "KC_NO", "KC_B", "KC_NO", 180]
    vil["combo"][1][4] = "KC_TAB"
    vil["key_override"][2] = {"trigger": "KC_A", "replacement": "KC_B", "layers": 3, "trigger_mods": 2,
                              "negative_mod_mask": 0, "suppressed_mods": 2, "options": 0x87}
    vil["alt_repeat_key"][0]["alt_keycode"] = "KC_HOME"
    vil["macro"][5] = [["text", "hello"]]
    vil["settings"]["7"] = 250
    before = snapshot(virtual)
    response = preview(client, vil)
    assert response.status_code == 200, response.text
    result = response.json()
    assert snapshot(virtual) == before

    keys = [(k["layer"], k["row"], k["col"], k["before"]["code"], k["after"]["code"]) for k in result["keys"]]
    assert keys == [(0, 0, 0, "KC_TAB", "KC_Z"), (2, 4, 1, "KC_NO", "LCTL(KC_C)")]
    assert [(t["before"]["index"], t["after"]["tap"]["code"], t["after"]["tappingTerm"])
            for t in result["tapDance"]] == [(3, "KC_A", 180)]
    assert [(c["after"]["index"], c["before"]["output"]["code"], c["after"]["output"]["code"])
            for c in result["combos"]] == [(1, "KC_ENTER", "KC_TAB")]
    assert [(o["after"]["index"], o["after"]["trigger"]["code"], o["after"]["enabled"])
            for o in result["keyOverrides"]] == [(2, "KC_A", True)]
    assert [(a["after"]["index"], a["before"]["altKeycode"]["code"], a["after"]["altKeycode"]["code"])
            for a in result["altRepeatKeys"]] == [(0, "KC_RIGHT", "KC_HOME")]
    assert [(m["after"]["index"], m["before"]["actions"], m["after"]["actions"][0]["text"])
            for m in result["macros"]] == [(5, [], "hello")]
    assert result["settings"] == [{"qsid": 7, "before": 200, "after": 250}]
    assert result["needsUnlock"] is True  # it changes the macros


def test_the_preview_names_what_the_keyboard_has_no_room_for(client, virtual, vil):
    vil["layout"] += [vil["layout"][0]] * 2  # layers 4 and 5
    vil["tap_dance"] += [["KC_A", "KC_NO", "KC_NO", "KC_NO", 200]] * 8  # tap dances 8 to 15
    vil["macro"] += [[]]  # macro 16
    vil["settings"]["8"] = 1  # the legacy Tap-Hold bitfield, which this keyboard doesn't have
    vil["settings"]["999"] = 1
    result = preview(client, vil).json()
    assert result["ignored"] == ["layers 4 to 5", "macro 16", "tap dances 8 to 15", "QMK settings 8, 999"]
    assert result["keys"] == [] and result["tapDance"] == []


def test_encoders_and_layout_options_in_the_preview(knob, monkeypatch):
    client, virtual = knob
    data = json.loads(client.get("/api/layout-file").content)
    data["encoder_layout"][1][0] = ["KC_VOLU", "KC_VOLD"]
    data["layout_options"] = 1
    result = preview(client, data).json()
    assert [(e["layer"], e["encoder"], e["direction"], e["after"]["code"]) for e in result["encoders"]] == \
        [(1, 0, 0, "KC_VOLU"), (1, 0, 1, "KC_VOLD")]
    assert result["layoutOptions"] == {"before": 0, "after": 1}


@pytest.mark.parametrize("body", [b"not json", json.dumps({"layout": []}).encode()])
def test_a_broken_file_is_refused_by_the_preview_as_by_loading(client, virtual, body):
    before = snapshot(virtual)
    previewed, uploaded = preview(client, body), upload(client, body)
    assert previewed.status_code == uploaded.status_code == 422
    assert previewed.json()["detail"] == uploaded.json()["detail"]
    assert previewed.json()["detail"].startswith("not a valid Vial layout file")
    assert snapshot(virtual) == before


def test_the_preview_works_on_a_locked_keyboard(client, virtual, vil):
    virtual.unlocked = False
    vil["macro"][5] = [["text", "hello"]]
    response = preview(client, vil)
    assert response.status_code == 200
    assert response.json()["needsUnlock"] is True


def test_the_preview_keeps_the_size_limit_and_the_security_checks(client, virtual):
    big = b" " * (app_module.MAX_LAYOUT_FILE + 1)
    assert client.post("/api/layout-file/preview", content=big).status_code == 413
    assert client.post("/api/layout-file/preview", content=b"{}",
                       headers={"origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/layout-file/preview", content=b"{}", headers=ORIGIN).status_code == 422
    client.cookies.clear()
    assert client.post("/api/layout-file/preview", content=b"{}").status_code == 401


# ---------- another keyboard's file ----------

def test_another_keyboards_file_is_refused_and_nothing_is_written(client, virtual, vil):
    vil["uid"] = 0x1122334455667788
    vil["layout"][0][0][0] = "KC_Z"
    before = snapshot(virtual)
    for response in (preview(client, vil), upload(client, vil)):
        assert response.status_code == 422
        assert response.json()["detail"] == "this layout file is for another keyboard (ID 1122334455667788), " \
                                            "not this one (ID {:016X})".format(CORNE_UID)
    assert snapshot(virtual) == before


@pytest.mark.parametrize("uid", ["5EEDC0DE00420042", True, -1, 1 << 64])
def test_a_uid_that_is_not_a_keyboard_id_is_refused(client, virtual, vil, uid):
    vil["uid"] = uid
    before = snapshot(virtual)
    response = upload(client, vil)
    assert response.status_code == 422 and "uid must be a number" in response.json()["detail"]
    assert snapshot(virtual) == before


def test_a_file_that_does_not_say_its_keyboard_is_taken(client, virtual, vil):
    del vil["uid"]
    vil["layout"][0][0][0] = "KC_Z"
    assert preview(client, vil).json()["uid"] is None
    assert upload(client, vil).status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Z")


# ---------- a locked keyboard ----------

def test_a_file_with_macros_writes_nothing_on_a_locked_keyboard(client, virtual, vil):
    """ the keys come first in a file, the macros later: a locked keyboard must refuse it before the first key """
    virtual.unlocked = False
    vil["layout"][0][0][0] = "KC_Z"
    vil["macro"][5] = [["text", "hello"]]
    before = snapshot(virtual)
    response = upload(client, vil)
    assert response.status_code == 423
    assert snapshot(virtual) == before
    assert virtual.writes == []

    virtual.unlocked = True  # the user held the unlock keys; the UI sends the file again
    assert upload(client, vil).status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Z")
    assert virtual.macros()[5] == b"hello"


# ---------- downloading ----------

def test_the_download_is_named_after_the_keyboard(client):
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Simulated Corne.vil\"; filename*=UTF-8''Simulated%20Corne.vil"


def test_a_name_with_characters_files_cannot_have(knob):
    client, virtual = knob
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Knob_Pad_ _mini.vil\"; filename*=UTF-8''Knob_Pad_%20_mini.vil"


# ---------- QMK settings definitions ----------

def test_setting_definitions_are_typed(client):
    tabs = client.get("/api/qmk-settings/definitions").json()["tabs"]
    magic = next(t for t in tabs if t["name"] == "Magic")
    assert magic["fields"][0] == {"type": "boolean", "title": "Swap Caps Lock and Left Control", "qsid": 21,
                                  "bit": 0, "width": 4, "min": None, "max": None}
    tapping_term = next(f for t in tabs for f in t["fields"] if f["qsid"] == 7)
    assert (tapping_term["type"], tapping_term["min"], tapping_term["max"], tapping_term["width"]) == \
        ("integer", 0, 10000, 2)
