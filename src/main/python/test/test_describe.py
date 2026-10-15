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
    ("KC_1", "basic", "!\n1", None, None, None),
    ("LSFT(KC_1)", "basic", "!", None, None, None),
    ("LCTL(KC_C)", "basic", "Ctrl+C", None, None, None),
    ("LCTL(KC_NO)", "modifier", "Ctrl", None, None, None),
    ("C_S(KC_NO)", "modifier", "Ctrl+Shift", None, None, None),
    ("RALT(KC_NO)", "modifier", "AltGr", None, None, None),
    ("LT2(KC_S)", "layer-tap", "S", "layer 2", 2, None),
    ("LSFT_T(KC_T)", "mod-tap", "T", "Shift", None, None),
    ("ALL_T(KC_B)", "mod-tap", "B", "Hyper", None, None),
    ("MO(1)", "layer", "MO 1", "while held", 1, None),
    ("OSL(3)", "layer", "OSL 3", "one-shot", 3, None),
    ("TD(0)", "tap-dance", "TD 0", None, None, 0),
    ("M0", "macro", "M 0", None, None, 0),
    ("OSM(MOD_LSFT)", "one-shot-mod", "OSM", "LSft", None, None),
    ("KC_LCTRL", "modifier", "LCtrl", None, None, None),
    ("KC_MS_U", "mouse", "Mouse\nUp", None, None, None),
    ("KC_VOLU", "media", "Vol +", None, None, None),
    ("RGB_TOG", "lighting", "RGB\nToggle", None, None, None),
    ("QK_BOOT", "other", "Boot-\nloader", None, None, None),
])
def test_describe(code, kind, tap, hold, layer, index):
    result = describe(code)
    assert (result["kind"], result["tap"], result["hold"], result["layer"], result["index"]) == \
        (kind, tap, hold, layer, index)


def test_describe_normalizes_aliases():
    assert describe("KC_ENT")["code"] == "KC_ENTER"


def test_describe_includes_tooltip():
    assert describe("LT2(KC_S)")["tooltip"] == "LT2(kc): kc on tap, switch to layer 2 while held"


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
