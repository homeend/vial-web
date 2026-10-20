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
    assert client.put("/api/lighting", json={}).status_code == 422
    assert client.post("/api/lighting/save").status_code == 422
    assert log == []


@pytest.mark.parametrize("lit", ["vialrgb", "qmk_backlight_rgblight"], indirect=True)
def test_a_change_of_nothing_is_refused(lit):
    client, virtual = lit
    log = sent(virtual)
    assert client.put("/api/lighting", json={}).status_code == 422
    assert client.put("/api/lighting", json={"vialrgb": None, "rgblight": None, "backlight": None}).status_code == 422
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
def test_vialrgb_with_nothing_to_change_sends_nothing(lit):
    client, virtual = lit
    # changed on the keyboard (a key): a request built from the server's copy would undo it
    virtual.vialrgb["mode"] = 7
    log = sent(virtual)
    assert client.put("/api/lighting", json={"vialrgb": {}}).json()["vialrgb"]["mode"] == 7
    assert client.put("/api/lighting", json={"vialrgb": {"mode": None}}).json()["vialrgb"]["mode"] == 7
    assert log == []
    assert virtual.vialrgb["mode"] == 7


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
def test_rgblight_switched_off_or_on_with_a_key_is_read_before_the_effect_is_sent(lit):
    client, virtual = lit
    # RGB_TOG on the keyboard: the server's copy still says the light is on
    virtual.rgblight["enable"] = False
    log = sent(virtual)
    assert client.put("/api/lighting", json={"rgblight": {"effect": 20}}).json()["rgblight"]["effect"] == 20
    assert [entry[1] for entry in log] == [QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT]
    assert (virtual.rgblight["enable"], virtual.rgblight["mode"]) == (True, 20)
    # and the other way: switched off here, on with the key; a light that is on takes the effect at once
    client.put("/api/lighting", json={"rgblight": {"effect": 0}})
    virtual.rgblight["enable"] = True
    log.clear()
    assert client.put("/api/lighting", json={"rgblight": {"effect": 3}}).json()["rgblight"]["effect"] == 3
    assert [entry[1] for entry in log] == [QMK_RGBLIGHT_EFFECT]


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_reply_shows_what_the_firmware_ignores(lit):
    client, virtual = lit
    # off: no colour is taken
    client.put("/api/lighting", json={"rgblight": {"effect": 0}})
    off = client.put("/api/lighting", json={"rgblight": {"hue": 10, "saturation": 10, "brightness": 10}}).json()
    assert (off["rgblight"]["hue"], off["rgblight"]["brightness"]) == (0, 255)
    # breathing keeps its brightness
    client.put("/api/lighting", json={"rgblight": {"effect": 3}})
    breathing = client.put("/api/lighting", json={"rgblight": {"brightness": 10}}).json()["rgblight"]
    assert breathing["brightness"] == 255
    # a rainbow keeps its hue, takes the saturation
    client.put("/api/lighting", json={"rgblight": {"effect": 7}})
    rainbow = client.put("/api/lighting", json={"rgblight": {"hue": 77, "saturation": 33}}).json()["rgblight"]
    assert (rainbow["hue"], rainbow["saturation"]) == (0, 33)



# ---------- Undo: the web page's restorePatches (web/src/lighting/lighting.ts) ----------

# (kind, the lighting to bring back, the changes made since, the first of the two patches restorePatches sends)
UNDO_CASES = {
    "vialrgb off": ("vialrgb", {"mode": 0, "hsv": [10, 20, 30]},
                    [{"mode": 2}, {"hsv": [99, 99, 99]}], {"mode": 2, "hsv": [10, 20, 30]}),
    "rgblight off": ("rgblight", {"effect": 0, "hue": 10, "saturation": 20, "brightness": 30},
                     [{"effect": 1}, {"hue": 99, "saturation": 99, "brightness": 99}],
                     {"effect": 1, "hue": 10, "saturation": 20, "brightness": 30}),
    "rgblight breathing": ("rgblight", {"effect": 2, "hue": 10, "saturation": 20, "brightness": 30},
                           [{"effect": 1}, {"brightness": 99}],
                           {"effect": 1, "hue": 10, "saturation": 20, "brightness": 30}),
    "rgblight rainbow": ("rgblight", {"effect": 6, "hue": 10, "saturation": 20, "brightness": 30},
                         [{"effect": 1}, {"hue": 99}],
                         {"effect": 1, "hue": 10, "saturation": 20, "brightness": 30}),
}


def settable(kind, lighting):
    """ What a patch can set (lighting.ts settable) """
    keys = ("mode", "speed", "hsv") if kind == "vialrgb" else ("effect", "hue", "saturation", "brightness")
    return {key: lighting[kind][key] for key in keys}


def changed_since(client, kind, baseline, changes):
    """ The keyboard set to `baseline`, then changed; what it showed at the baseline """
    if kind == "vialrgb":
        # the colour is taken under an effect that takes it, then the effect is set
        client.put("/api/lighting", json={kind: {"mode": 2, "hsv": baseline["hsv"]}})
    else:
        client.put("/api/lighting", json={kind: {"effect": 1, **{k: v for k, v in baseline.items() if k != "effect"}}})
    kept = client.put("/api/lighting", json={kind: baseline}).json()
    assert {k: kept[kind][k] for k in baseline} == baseline
    for change in changes:
        client.put("/api/lighting", json={kind: change})
    return settable(kind, kept)


@pytest.mark.parametrize("lit, case", [(UNDO_CASES[name][0].replace("rgblight", "qmk_rgblight"), name)
                                       for name in UNDO_CASES], indirect=["lit"])
def test_undo_in_one_patch_leaves_what_the_effect_brought_back_ignores(lit, case):
    client, virtual = lit
    kind, baseline, changes, _ = UNDO_CASES[case]
    kept = changed_since(client, kind, baseline, changes)
    # restorePatch: the server sets the effect first, which then ignores the colour sent with it
    after = client.put("/api/lighting", json={kind: kept}).json()
    assert settable(kind, after) != kept


@pytest.mark.parametrize("lit, case", [(UNDO_CASES[name][0].replace("rgblight", "qmk_rgblight"), name)
                                       for name in UNDO_CASES], indirect=["lit"])
def test_undo_in_two_patches_brings_everything_back(lit, case):
    client, virtual = lit
    kind, baseline, changes, first = UNDO_CASES[case]
    kept = changed_since(client, kind, baseline, changes)
    # restorePatches: the colour under an effect that takes it, then restorePatch
    client.put("/api/lighting", json={kind: first})
    after = client.put("/api/lighting", json={kind: kept}).json()
    assert settable(kind, after) == kept
    assert settable(kind, client.get("/api/keyboard").json()["lighting"]) == kept


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
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 4}, "backlight": {"brightness": 0}}).json()
    assert (reply["rgblight"]["effect"], reply["backlight"]["brightness"]) == (4, 0)


@pytest.mark.parametrize("lit", ["qmk_backlight_rgblight"], indirect=True)
def test_a_failed_write_leaves_the_model_as_the_keyboard_shows(lit):
    client, virtual = lit
    process = virtual.process

    def failing(msg):
        if (msg[0], msg[1]) == (CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS):
            raise OSError("the cable came loose")
        return process(msg)
    virtual.process = failing
    change = {"rgblight": {"effect": 4}, "backlight": {"brightness": 0}}
    assert client.put("/api/lighting", json=change).status_code == 502
    virtual.process = process
    lighting = client.get("/api/keyboard").json()["lighting"]
    # the effect was taken, the brightness not: still level 3 of 3
    assert (lighting["rgblight"]["effect"], lighting["backlight"]["brightness"]) == (4, 255)


@pytest.mark.parametrize("lit", ["qmk_backlight_rgblight"], indirect=True)
def test_a_keyboard_unplugged_during_a_write_is_read_back_once_at_most(lit):
    """ The read-back after a failed write runs with the device lock held, before the unplug is noticed: each query is
    tried once, not with the protocol's 20 retries (about 10 s with the lock held for a keyboard that is gone) """
    client, virtual = lit
    process = virtual.process
    after = []

    def unplugging(msg):
        if (msg[0], msg[1]) == (CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS):
            virtual.connected = False
        if not virtual.connected:
            after.append(bytes(msg[:2]))
        return process(msg)
    virtual.process = unplugging
    assert client.put("/api/lighting", json={"backlight": {"brightness": 0}}).status_code == 503
    # the write itself (with the protocol's own retries), then one query of the read-back, which fails
    write = bytes([CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS])
    assert [m for m in after if m != write] == [after[-1]] and after[-1] != write
    assert client.get("/api/session").json()["status"] == "disconnected"


@pytest.mark.parametrize("lit", ["qmk_backlight_rgblight"], indirect=True)
def test_the_read_back_after_a_failed_write_keeps_the_protocols_retries_afterwards(lit):
    client, virtual = lit
    process = virtual.process
    send = client.app.state.manager.keyboard.usb_send

    def failing(msg):
        if (msg[0], msg[1]) == (CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS):
            raise OSError("the cable came loose")
        return process(msg)
    virtual.process = failing
    assert client.put("/api/lighting", json={"backlight": {"brightness": 0}}).status_code == 502
    assert client.app.state.manager.keyboard.usb_send is send


# ---------- kept only once saved ----------

@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_changes_are_kept_only_once_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    change = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
              "qmk_backlight": {"backlight": {"brightness": 0}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 0}}}[kind]
    log = sent(virtual)
    shown = client.put("/api/lighting", json=change).json()
    assert virtual.lighting_saved is None
    assert all(entry[0] != CMD_VIA_LIGHTING_SAVE for entry in log)
    saved = client.post("/api/lighting/save").json()
    assert saved == shown
    # one save request keeps every kind (via.c id_lighting_save)
    assert [entry[0] for entry in log].count(CMD_VIA_LIGHTING_SAVE) == 1
    assert virtual.lighting_saved == virtual.lighting_now()


@pytest.mark.parametrize("lit", ["vialrgb", "qmk_backlight_rgblight"], indirect=True)
def test_a_save_replies_with_what_the_keyboard_kept(lit):
    client, virtual = lit
    # changed on the keyboard (its keys), not through the server
    if virtual.vialrgb is not None:
        virtual.vialrgb["mode"] = 7
    else:
        virtual.rgblight["mode"] = 6
        virtual.backlight["level"] = 3
    saved = client.post("/api/lighting/save").json()
    if virtual.vialrgb is not None:
        assert saved["vialrgb"]["mode"] == 7
    else:
        assert (saved["rgblight"]["effect"], saved["backlight"]["brightness"]) == (6, 255)
    assert virtual.lighting_saved == virtual.lighting_now()
    assert client.get("/api/keyboard").json()["lighting"] == saved


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
        # the firmware's defaults: RGBLIGHT_LIMIT_VAL
        assert (kb.underglow_effect, kb.underglow_brightness, kb.underglow_color) == (1, 255, (0, 255))
    if kb.lighting_qmk_backlight:
        # level 3 of 3: BACKLIGHT_DEFAULT_LEVEL is the top one
        assert (kb.backlight_brightness, kb.backlight_effect) == (255, 0)
    if kb.lighting_vialrgb:
        # the RGB matrix at its maximum brightness, RGB_MATRIX_DEFAULT_SPD
        assert (kb.rgb_mode, kb.rgb_speed, kb.rgb_hsv, kb.rgb_maximum_brightness) == (2, 127, (0, 255, 200), 200)


@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_plugged_in_again_the_keyboard_has_the_lighting_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    first = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
             "qmk_backlight": {"backlight": {"brightness": 0}},
             "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 0}}}[kind]
    second = {"vialrgb": {"vialrgb": {"mode": 5}}, "qmk_rgblight": {"rgblight": {"effect": 5}},
              "qmk_backlight": {"backlight": {"brightness": 255}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 5}, "backlight": {"brightness": 255}}}[kind]
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
    client.put("/api/lighting", json={"backlight": {"brightness": 170}})
    kept = client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]
    assert kept == {"brightness": 170, "effect": 1}
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
