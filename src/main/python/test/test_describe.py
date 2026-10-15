import pytest

from server.describe import describe, parse, one_line


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


@pytest.mark.parametrize("expression", ["NOT_A_KEY", "0x10000", "-1", "KC_A +"])
def test_parse_rejects_invalid(expression):
    with pytest.raises(ValueError):
        parse(expression)


@pytest.mark.parametrize("label, expected", [
    ("!\n1", "1"), ("Caps\nLock", "Caps Lock"), ("{ \n[ ", "["), ("Mouse\nWheel\nUp", "Mouse Wheel Up"), ("A", "A"),
])
def test_one_line(label, expected):
    assert one_line(label) == expected
