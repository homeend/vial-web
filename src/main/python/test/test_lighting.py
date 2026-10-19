""" Lighting against the simulated keyboard, each kind as its firmware code in vial-qmk works (vialrgb.c, via.c,
rgblight.c, backlight.c): changes are shown at once and kept only once saved, as Qt's Lighting tab does """
import struct

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.constants import CMD_VIA_LIGHTING_SAVE, CMD_VIA_LIGHTING_SET_VALUE, \
    QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT, QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_COLOR, QMK_RGBLIGHT_EFFECT, \
    VIALRGB_SET_MODE
from protocol.keyboard_comm import Keyboard
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import LIGHTING, make_corne
from simulator.device import SimulatedHidDevice
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN


def api_for(tmp_path, factory):
    manager = DeviceManager(FakeBackend(factory))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    client = TestClient(app, base_url=BASE)
    return client, manager


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


@pytest.fixture
def lit(tmp_path, request):
    """ (client, virtual keyboard) of a Corne with the lighting the test is parametrized with """
    client, manager = api_for(tmp_path, lambda: make_corne(lighting=request.param))
    with client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager.backend.virtual


def sent(virtual):
    """ The lighting requests the simulated keyboard is sent from now on: (command, value id, the bytes after) """
    log = []
    process = virtual.process

    def recording(msg):
        if msg[0] in (CMD_VIA_LIGHTING_SET_VALUE, CMD_VIA_LIGHTING_SAVE):
            log.append((msg[0], msg[1], bytes(msg[2:8])))
        return process(msg)
    virtual.process = recording
    return log


# ---------- what the model says ----------

@pytest.mark.parametrize("lit", LIGHTING, indirect=True)
def test_only_the_kinds_the_keyboard_has_are_in_the_model(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    lighting = client.get("/api/keyboard").json()["lighting"]
    assert (lighting["vialrgb"] is not None) == (kind == "vialrgb")
    assert (lighting["rgblight"] is not None) == ("rgblight" in kind)
    assert (lighting["backlight"] is not None) == ("backlight" in kind)


@pytest.mark.parametrize("lit", ["none"], indirect=True)
def test_a_keyboard_without_lighting_refuses_lighting_changes_and_saves(lit):
    client, virtual = lit
    log = sent(virtual)
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 1}}).status_code == 422
    assert client.put("/api/lighting", json={"rgblight": {"effect": 1}}).status_code == 422
    assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).status_code == 422
    assert client.post("/api/lighting/save").status_code == 422
    assert log == []


# ---------- VialRGB ----------

@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_sends_effect_speed_and_colour_in_one_request(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"vialrgb": {"mode": 5, "speed": 40, "hsv": [10, 20, 30]}}).json()
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, VIALRGB_SET_MODE, struct.pack("<HBBBB", 5, 40, 10, 20, 30))]
    assert reply["vialrgb"] == {"mode": 5, "speed": 40, "hsv": [10, 20, 30], "maxBrightness": 200,
                                "supportedEffects": [0, 1, 2, 3, 4, 5, 6, 7, 8]}
    # a change of one keeps the others
    reply = client.put("/api/lighting", json={"vialrgb": {"speed": 41}}).json()
    assert log[-1] == (CMD_VIA_LIGHTING_SET_VALUE, VIALRGB_SET_MODE, struct.pack("<HBBBB", 5, 41, 10, 20, 30))
    assert reply["vialrgb"]["hsv"] == [10, 20, 30]


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_brightness_is_capped_at_the_keyboards_maximum(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": [1, 2, 255]}}).json()["vialrgb"]["hsv"] == [1, 2, 200]
    assert virtual.vialrgb["hsv"] == (1, 2, 200)


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_off_keeps_its_colour_and_the_reply_says_what_the_keyboard_shows(lit):
    client, virtual = lit
    off = client.put("/api/lighting", json={"vialrgb": {"mode": 0}}).json()["vialrgb"]
    assert off["mode"] == 0
    # rgb_matrix_sethsv_noeeprom does nothing while the matrix is off: the reply shows the colour unchanged
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": [99, 99, 99]}}).json()["vialrgb"]["hsv"] == \
        off["hsv"]
    on = client.put("/api/lighting", json={"vialrgb": {"mode": 2, "hsv": [99, 99, 99]}}).json()["vialrgb"]
    assert (on["mode"], on["hsv"]) == (2, [99, 99, 99])


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_effects_the_keyboard_lacks_are_refused(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 9}}).status_code == 422
    assert virtual.vialrgb["mode"] == 2


# ---------- QMK RGB light ----------

@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_brightness_and_colour_as_qt_sends_them(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 15}}).json()["rgblight"]
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_EFFECT, bytes([15, 0, 0, 0, 0, 0]))]
    assert reply["effect"] == 15
    log.clear()
    reply = client.put("/api/lighting", json={"rgblight": {"hue": 100, "saturation": 200, "brightness": 50}}).json()
    # Qt's set_qmk_rgblight_color: the brightness, then hue and saturation
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_BRIGHTNESS, bytes([50, 0, 0, 0, 0, 0])),
                   (CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_COLOR, bytes([100, 200, 0, 0, 0, 0]))]
    assert {k: reply["rgblight"][k] for k in ("hue", "saturation", "brightness")} == \
        {"hue": 100, "saturation": 200, "brightness": 50}
    log.clear()
    assert client.put("/api/lighting", json={"rgblight": {"brightness": 70}}).json()["rgblight"]["brightness"] == 70
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_BRIGHTNESS, bytes([70, 0, 0, 0, 0, 0]))]


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_from_off_is_sent_twice_so_the_keyboard_takes_it(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"rgblight": {"effect": 0}}).json()["rgblight"]["effect"] == 0
    assert not virtual.rgblight["enable"]
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 20}}).json()["rgblight"]
    # once turns it on with the effect it had before (via.c: rgblight_mode_noeeprom ignores a light that is off)
    assert [entry[1] for entry in log] == [QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT]
    assert reply["effect"] == 20


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_once_when_it_is_on(lit):
    client, virtual = lit
    log = sent(virtual)
    client.put("/api/lighting", json={"rgblight": {"effect": 3}})
    assert len(log) == 1


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_reply_shows_what_the_firmware_ignores(lit):
    client, virtual = lit
    # off: no colour is taken
    client.put("/api/lighting", json={"rgblight": {"effect": 0}})
    off = client.put("/api/lighting", json={"rgblight": {"hue": 10, "saturation": 10, "brightness": 10}}).json()
    assert (off["rgblight"]["hue"], off["rgblight"]["brightness"]) == (0, 128)
    # breathing keeps its brightness
    client.put("/api/lighting", json={"rgblight": {"effect": 3}})
    breathing = client.put("/api/lighting", json={"rgblight": {"brightness": 10}}).json()["rgblight"]
    assert breathing["brightness"] == 128
    # a rainbow keeps its hue, takes the saturation
    client.put("/api/lighting", json={"rgblight": {"effect": 7}})
    rainbow = client.put("/api/lighting", json={"rgblight": {"hue": 77, "saturation": 33}}).json()["rgblight"]
    assert (rainbow["hue"], rainbow["saturation"]) == (0, 33)


# ---------- backlight ----------

@pytest.mark.parametrize("lit", ["qmk_backlight"], indirect=True)
def test_backlight_brightness_settles_on_one_of_the_keyboards_steps(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"backlight": {"brightness": 200}}).json()["backlight"]
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS, bytes([200, 0, 0, 0, 0, 0]))]
    # 3 levels: 200 * 3 / 255 = level 2, read back as 2 * 255 / 3
    assert reply["brightness"] == 170
    assert client.put("/api/lighting", json={"backlight": {"brightness": 255}}).json()["backlight"]["brightness"] \
        == 255
    assert client.put("/api/lighting", json={"backlight": {"brightness": 84}}).json()["backlight"]["brightness"] == 0


@pytest.mark.parametrize("lit", ["qmk_backlight"], indirect=True)
def test_backlight_breathing(lit):
    client, virtual = lit
    log = sent(virtual)
    assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]["effect"] == 1
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_EFFECT, bytes([1, 0, 0, 0, 0, 0]))]
    assert client.put("/api/lighting", json={"backlight": {"effect": 0}}).json()["backlight"]["effect"] == 0


def test_backlight_without_breathing_reads_it_off(tmp_path):
    definition = make_corne(lighting="qmk_backlight").definition
    client, manager = api_for(tmp_path, lambda: VirtualKeyboard(definition, backlight_breathing=False))
    with client:
        client.get("/?token=" + TOKEN)
        assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]["effect"] == 0


@pytest.mark.parametrize("lit", ["qmk_backlight_rgblight"], indirect=True)
def test_both_kinds_change_in_one_request(lit):
    client, virtual = lit
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}).json()
    assert (reply["rgblight"]["effect"], reply["backlight"]["brightness"]) == (4, 255)


# ---------- kept only once saved ----------

@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_changes_are_kept_only_once_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    change = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
              "qmk_backlight": {"backlight": {"brightness": 255}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}}[kind]
    log = sent(virtual)
    shown = client.put("/api/lighting", json=change).json()
    assert virtual.lighting_saved is None
    assert all(entry[0] != CMD_VIA_LIGHTING_SAVE for entry in log)
    saved = client.post("/api/lighting/save").json()
    assert saved == shown
    # one save request keeps every kind (via.c id_lighting_save)
    assert [entry[0] for entry in log].count(CMD_VIA_LIGHTING_SAVE) == 1
    assert virtual.lighting_saved == virtual.lighting_now()


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_saving_needs_a_connected_keyboard(lit):
    client, virtual = lit
    virtual.connected = False
    assert client.post("/api/lighting/save").status_code == 503


@pytest.mark.parametrize("kind", LIGHTING)
def test_lighting_reads_back_with_the_protocol_code(kind):
    """ The protocol code (keyboard_comm.reload_persistent_rgb and reload_rgb) reads what the simulator shows """
    kb = Keyboard(SimulatedHidDevice(make_corne(lighting=kind)))
    kb.reload()
    assert (kb.lighting_vialrgb, kb.lighting_qmk_rgblight, kb.lighting_qmk_backlight) == \
        (kind == "vialrgb", "rgblight" in kind, "backlight" in kind)
    if kb.lighting_qmk_rgblight:
        assert (kb.underglow_effect, kb.underglow_brightness, kb.underglow_color) == (1, 128, (0, 255))
    if kb.lighting_qmk_backlight:
        # level 2 of 3
        assert (kb.backlight_brightness, kb.backlight_effect) == (170, 0)
    if kb.lighting_vialrgb:
        assert (kb.rgb_mode, kb.rgb_speed, kb.rgb_hsv, kb.rgb_maximum_brightness) == (2, 128, (0, 255, 128), 200)


@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_plugged_in_again_the_keyboard_has_the_lighting_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    first = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
             "qmk_backlight": {"backlight": {"brightness": 255}},
             "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}}[kind]
    second = {"vialrgb": {"vialrgb": {"mode": 5}}, "qmk_rgblight": {"rgblight": {"effect": 5}},
              "qmk_backlight": {"backlight": {"brightness": 0}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 5}, "backlight": {"brightness": 0}}}[kind]
    before = client.get("/api/keyboard").json()["lighting"]
    # not saved: gone after a replug
    client.put("/api/lighting", json=first)
    replug(client)
    assert client.get("/api/keyboard").json()["lighting"] == before
    # saved: kept, a later change not
    saved = client.put("/api/lighting", json=first).json()
    client.post("/api/lighting/save")
    client.put("/api/lighting", json=second)
    replug(client)
    assert client.get("/api/keyboard").json()["lighting"] == saved


@pytest.mark.parametrize("lit", ["qmk_backlight"], indirect=True)
def test_plugged_in_again_the_keyboard_keeps_the_breathing_it_wrote_at_once(lit):
    client, virtual = lit
    # backlight_enable_breathing writes the backlight's config, with the level it runs at, to EEPROM without a save
    client.put("/api/lighting", json={"backlight": {"brightness": 255}})
    kept = client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]
    assert kept == {"brightness": 255, "effect": 1}
    # a later brightness is only shown
    client.put("/api/lighting", json={"backlight": {"brightness": 0}})
    replug(client)
    assert client.get("/api/keyboard").json()["lighting"]["backlight"] == kept


def replug(client):
    manager = client.app.state.manager
    client.put("/api/simulator/connection", json={"connected": False})
    assert manager.check() == ["disconnected"]
    client.put("/api/simulator/connection", json={"connected": True})
    assert manager.check() == ["connected"]
