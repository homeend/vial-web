import pytest

from keycodes.keycodes import Keycode
from server.describe import describe, parse, parse_value, one_line, reference


@pytest.fixture(autouse=True)
def loaded_keyboard(corne_keyboard):
    """ Layer, tap dance and macro keycodes only exist once a keyboard is loaded """
    return corne_keyboard


@pytest.mark.parametrize("code, kind, tap, hold, layer, index", [
    ("KC_NO", "none", "", None, None, None),
    ("KC_TRNS", "transparent", "▽", None, None, None),
    ("KC_A", "basic", "A", None, None, None),
    ("KC_1", "basic", "1", None, None, None),
    ("KC_CAPSLOCK", "basic", "Caps Lock", None, None, None),
    ("LSFT(KC_1)", "basic", "!", None, None, None),
    ("LCTL(KC_C)", "basic", "Ctrl+C", None, None, None),
    ("LCTL(KC_NO)", "modifier", "Ctrl", None, None, None),
    ("C_S(KC_NO)", "modifier", "Ctrl+Shift", None, None, None),
    ("RALT(KC_NO)", "modifier", "AltGr", None, None, None),
    ("LT2(KC_S)", "layer-tap", "S", "layer 2", 2, None),
    ("LSFT_T(KC_T)", "mod-tap", "T", "Shift", None, None),
    ("ALL_T(KC_B)", "mod-tap", "B", "Hyper", None, None),
    ("MO(1)", "layer", "MO 1", None, 1, None),
    ("OSL(3)", "layer", "OSL 3", None, 3, None),
    ("TD(0)", "tap-dance", "TD 0", None, None, 0),
    ("M0", "macro", "M 0", None, None, 0),
    ("OSM(MOD_LSFT)", "one-shot-mod", "Shift", None, None, None),
    ("OSM(MOD_RCTL|MOD_RALT)", "one-shot-mod", "RCtrl+AltGr", None, None, None),
    ("KC_LCTRL", "modifier", "LCtrl", None, None, None),
    ("KC_MS_U", "mouse", "Mouse Up", None, None, None),
    ("KC_VOLU", "media", "Vol +", None, None, None),
    ("RGB_TOG", "lighting", "RGB Toggle", None, None, None),
    ("QK_BOOT", "other", "Bootloader", None, None, None),
])
def test_describe(code, kind, tap, hold, layer, index):
    result = describe(code)
    assert (result["kind"], result["tap"], result["hold"], result["layer"], result["index"]) == \
        (kind, tap, hold, layer, index)


def test_describe_normalizes_aliases():
    assert describe("KC_ENT")["code"] == "KC_ENTER"


# ---------- legends: what the key cap shows ----------

@pytest.mark.parametrize("code, legend", [
    ("KC_A", {"main": "A", "shifted": None, "altGr": None}),
    ("KC_1", {"main": "1", "shifted": "!", "altGr": None}),
    ("KC_LBRACKET", {"main": "[", "shifted": "{", "altGr": None}),
    ("KC_CAPSLOCK", {"main": "Caps Lock", "shifted": None, "altGr": None}),
    ("LT1(KC_SLASH)", {"main": "/", "shifted": "?", "altGr": None}),
    ("LSFT_T(KC_1)", {"main": "1", "shifted": "!", "altGr": None}),
    ("LCTL(KC_C)", {"main": "Ctrl+C", "shifted": None, "altGr": None}),
    ("MO(1)", {"main": "MO 1", "shifted": None, "altGr": None}),
    ("KC_NO", {"main": "", "shifted": None, "altGr": None}),
])
def test_legend(code, legend):
    assert describe(code)["legend"] == legend


def test_labels_have_no_line_breaks():
    """ Qt's labels break lines for its key widgets ("Caps", "Lock"); the API sends words and lets the UI wrap """
    from server.model import KEYCODE_CATEGORIES
    for _, keycodes in KEYCODE_CATEGORIES:
        for keycode in keycodes:
            if "(kc)" in keycode.qmk_id:
                continue
            result = describe(keycode.qmk_id)
            assert "\n" not in result["tap"], keycode.qmk_id
            assert all("\n" not in (part or "") for part in result["legend"].values()), keycode.qmk_id


# ---------- descriptions ----------

def test_description_is_the_explanation_only():
    assert describe("LT2(KC_S)")["description"] == "kc on tap, switch to layer 2 while held"
    assert describe("KC_GESC")["description"].startswith("Esc normally")
    assert describe("KC_A")["description"] is None


# ---------- layer actions ----------

@pytest.mark.parametrize("code, action", [
    ("MO(1)", "while held"), ("TG(1)", "toggle"), ("TO(1)", "switch to"), ("TT(1)", "hold, or tap to toggle"),
    ("OSL(1)", "one-shot"), ("DF(1)", "default"), ("LT1(KC_A)", "while held"), ("KC_A", None), ("TD(0)", None),
])
def test_layer_action(code, action):
    assert describe(code)["layerAction"] == action


# ---------- modifiers: every combination the firmware can store ----------

MOD_BITS = [(0x01, "Ctrl"), (0x02, "Shift"), (0x04, "Alt"), (0x08, "Gui")]


def expected_mods(bits):
    """ What the hold label of a mod-tap with these 5 modifier bits should read """
    if bits == 0x0F:
        return "Hyper"
    if bits == 0x07:
        return "Meh"
    right = bits & 0x10
    return "+".join(("AltGr" if name == "Alt" else "R" + name) if right else name
                    for bit, name in MOD_BITS if bits & bit)


ALL_MODS = [bits for bits in range(1, 0x20) if bits & 0x0F]


@pytest.mark.parametrize("bits", ALL_MODS)
def test_every_mod_tap_combination_is_a_mod_tap_with_a_readable_hold(bits):
    result = describe(Keycode.serialize(0x2000 | (bits << 8) | 0x04))  # protocol 6 QK_MOD_TAP, KC_A
    assert (result["kind"], result["tap"], result["hold"]) == ("mod-tap", "A", expected_mods(bits))


@pytest.mark.parametrize("bits", ALL_MODS)
def test_every_modifier_combination_with_a_key_is_readable(bits):
    result = describe(Keycode.serialize((bits << 8) | 0x06))  # protocol 6 QK_MODS, KC_C
    assert (result["kind"], result["tap"]) == ("basic", "{}+C".format(expected_mods(bits)))


def test_right_hand_mod_tap_from_an_expression():
    result = parse("MT(MOD_RCTL | MOD_RSFT, KC_A)")
    assert (result["kind"], result["tap"], result["hold"]) == ("mod-tap", "A", "RCtrl+RShift")


def test_every_mod_tap_in_the_keycode_tables_reads_well():
    from keycodes.keycodes import KEYCODES_MODIFIERS
    mod_taps = [k.qmk_id for k in KEYCODES_MODIFIERS if k.qmk_id.endswith("_T(kc)")]
    assert len(mod_taps) >= 19
    for qmk_id in mod_taps:
        result = describe(qmk_id.replace("(kc)", "(KC_A)"))
        assert result["kind"] == "mod-tap" and result["tap"] == "A", qmk_id
        assert "_" not in result["hold"] and result["hold"], qmk_id


@pytest.mark.parametrize("protocol, value, kind, hold", [
    (5, 0x7304, "mod-tap", "RCtrl+RShift"),  # protocol 5 QK_MOD_TAP is 0x6000
    (5, 0x5512, "one-shot-mod", None),
])
def test_mods_in_protocol_5(monkeypatch, protocol, value, kind, hold):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    result = describe(Keycode.serialize(value))
    assert (result["kind"], result["hold"]) == (kind, hold)


def test_parse_accepts_expressions_and_numbers():
    assert parse("LCTL(KC_A)")["code"] == "LCTL(KC_A)"
    assert parse(" 0x7E05 ")["code"] == "USER05"


@pytest.mark.parametrize("expression", ["NOT_A_KEY", "0x10000", "-1", "KC_A +", "True", "False", "TD(300)", "MO(40)"])
def test_parse_rejects_invalid(expression):
    with pytest.raises(ValueError):
        parse(expression)


def test_parse_uses_the_firmware_value_of_numbered_keycodes():
    # TO(n), PDF(n) and Mn beyond the loaded keyboard are not in the keycode tables
    assert parse_value("TO(9)") == 0x5209
    assert parse_value("PDF(5)") == 0x52E5
    assert parse_value("M20") == 0x7714


@pytest.mark.parametrize("protocol, value, expected", [
    (6, 0x4305, ("layer", 3)), (6, 0x50A2, ("layer", 5)), (6, 0x5211, ("layer", 17)), (6, 0x5225, ("layer", 5)),
    (6, 0x52A2, None), (6, 0x52C4, ("layer", 4)), (6, 0x52E1, ("layer", 1)), (6, 0x5705, ("tap dance", 5)),
    (6, 0x7702, ("macro", 2)), (6, 0x7C77, ("layer", 3)), (6, 0x0004, None), (6, 0x7E00, None),
    (5, 0x4305, ("layer", 3)), (5, 0x5013, ("layer", 3)), (5, 0x5104, ("layer", 4)), (5, 0x5402, ("layer", 2)),
    (5, 0x5502, None), (5, 0x5706, ("tap dance", 6)), (5, 0x5805, ("layer", 5)), (5, 0x5952, ("layer", 5)),
    (5, 0x5F14, ("macro", 2)), (5, 0x5F80, None),
])
def test_reference(monkeypatch, protocol, value, expected):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    assert reference(value) == expected


@pytest.mark.parametrize("label, expected", [
    ("!\n1", "1"), ("Caps\nLock", "Caps Lock"), ("{ \n[ ", "["), ("Mouse\nWheel\nUp", "Mouse Wheel Up"), ("A", "A"),
])
def test_one_line(label, expected):
    assert one_line(label) == expected
