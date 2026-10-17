import json

import pytest

from keycodes.keycodes import Keycode
from test.test_core_isolation import run_isolated
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


@pytest.mark.parametrize("protocol, value, layer, action, hold", [
    (6, 0x5022, 1, "while held, with modifiers", "Shift"),
    (6, 0x5045, 2, "while held, with modifiers", "Ctrl+Alt"),
    (6, 0x51F2, 15, "while held, with modifiers", "RShift"),
    (6, 0x5180, 12, "while held", None),  # no modifiers: as MO
    (5, 0x5912, 1, "while held, with modifiers", "Shift"),
    (5, 0x5925, 2, "while held, with modifiers", "Ctrl+Alt"),
])
def test_layer_mod_is_a_layer_key(monkeypatch, protocol, value, layer, action, hold):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    result = describe(Keycode.serialize(value))
    assert (result["kind"], result["layer"], result["layerAction"], result["hold"], result["triLayer"]) ==         ("layer", layer, action, hold, None)
    assert result["legend"]["main"] == "LM {}".format(layer)
    assert result["description"].startswith("Turns on layer {} while held".format(layer))
    assert result["tapCode"] is None


@pytest.mark.parametrize("protocol, value, layer", [(6, 0x7C77, 1), (6, 0x7C78, 2), (5, 0x5F10, 1), (5, 0x5F11, 2)])
def test_tri_layer_keys_are_layer_keys(monkeypatch, protocol, value, layer):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    result = describe(Keycode.serialize(value))
    assert (result["kind"], result["layer"], result["layerAction"], result["triLayer"]) ==         ("layer", layer, "while held", 3)
    assert result["legend"]["main"] == "Fn{} (Fn3)".format(layer)
    assert result["description"] == "Turns on layer {} while held, and layer 3 while Fn{} is held too".format(
        layer, 3 - layer)


def test_tri_layer_keys_by_name():
    # the loaded Corne has 4 layers, so FN_MO13 and FN_MO23 have names
    assert (describe("FN_MO13")["layer"], describe("FN_MO23")["layer"]) == (1, 2)
    assert parse("FN_MO23")["triLayer"] == 3


def test_other_keys_have_no_tri_layer():
    assert describe("MO(3)")["triLayer"] is None


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


@pytest.mark.parametrize("protocol, value", [
    (6, 0x1004),  # QK_MODS with only the right-hand bit: no modifier, KC_A
    (6, 0x1000),
    (6, 0x2004),  # QK_MOD_TAP with no modifier bits
    (6, 0x3004),  # ... with only the right-hand bit
    (6, 0x52A0),  # QK_ONE_SHOT_MOD with no modifier bits
    (6, 0x52B0),  # ... with only the right-hand bit
    (5, 0x6004),
    (5, 0x5500),
    (5, 0x5510),
])
def test_modifier_bits_naming_no_modifier_read_as_raw_codes(monkeypatch, protocol, value):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    result = describe(Keycode.serialize(value))
    assert (result["kind"], result["hold"], result["legend"]["shifted"], result["legend"]["altGr"]) \
        == ("other", None, None, None)
    assert result["tap"] == result["legend"]["main"] == result["code"]
    assert int(result["tap"], 16) == value


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


def test_parse_works_before_any_keyboard_was_read(monkeypatch):
    monkeypatch.setattr(Keycode, "protocol", 0)  # what a fresh process has until a keyboard is read
    assert parse("KC_A")["code"] == "KC_A"
    assert parse("LT(1, KC_A)")["code"] == "LT1(KC_A)"
    assert parse("KC_A")["kind"] == "basic" and parse("KC_A")["tap"] == "A"


def test_parse_in_a_fresh_process_reads_mod_tap_and_one_shot_mod():
    """ Keycode.protocol is 0 there and the keycode tables are the protocol 5 ones: describe must read them that way """
    result = run_isolated("import json\n"
                          "from server.describe import parse\n"
                          "print(json.dumps([parse('LCTL_T(KC_A)'), parse('OSM(MOD_LCTL)')]))")
    assert result.returncode == 0, result.stderr
    mod_tap, one_shot = json.loads(result.stdout)
    assert (mod_tap["kind"], mod_tap["tap"], mod_tap["hold"]) == ("mod-tap", "A", "Ctrl")
    assert one_shot["kind"] == "one-shot-mod"


# ---------- the tapped keycode: what a hold action can be added to ----------

@pytest.mark.parametrize("code, tap_code", [
    ("KC_A", "KC_A"),
    ("KC_ENT", "KC_ENTER"),  # by its own name, normalized
    ("KC_LCTRL", "KC_LCTRL"),
    ("KC_MS_U", "KC_MS_U"),
    ("KC_F13", "KC_F13"),
    ("LT2(KC_S)", "KC_S"),
    ("LSFT_T(KC_T)", "KC_T"),
    ("ALL_T(KC_B)", "KC_B"),
    ("MT(MOD_RCTL | MOD_RSFT, KC_A)", "KC_A"),  # a mod-tap Vial has no name for
    ("LT1(KC_NO)", "KC_NO"),  # hold only: the hold can still be changed or removed
    ("LSFT_T(KC_NO)", "KC_NO"),
    ("LT1(KC_TRNS)", None),
    ("KC_NO", None),
    ("KC_TRNS", None),
    ("LCTL(KC_C)", None),
    ("LSFT(KC_1)", None),
    ("MO(1)", None),
    ("TD(0)", None),
    ("M0", None),
    ("OSM(MOD_LSFT)", None),
    ("QK_BOOT", None),
    ("RGB_TOG", None),
    ("0x2004", None),  # a mod-tap without modifiers
    # keys that hold and tap already, or do something other than type a key: the firmware can't add a hold
    ("KC_GESC", None), ("KC_LSPO", None), ("KC_RSPC", None), ("KC_SFTENT", None), ("KC_ASTG", None),
    ("KC_ASUP", None), ("KC_ASON", None),
])
def test_tap_code(code, tap_code):
    assert parse(code)["tapCode"] == tap_code


@pytest.mark.parametrize("bits", ALL_MODS)
def test_every_mod_tap_combination_has_its_tapped_keycode(bits):
    assert describe(Keycode.serialize(0x2000 | (bits << 8) | 0x04))["tapCode"] == "KC_A"


def test_unnamed_basic_codes_have_no_tapped_keycode():
    assert describe(Keycode.serialize(0x66))["tapCode"] is None


@pytest.mark.parametrize("value, tap_code", [(0x7304, "KC_A"), (0x4204, "KC_A"), (0x5512, None)])
def test_tap_code_in_protocol_5(monkeypatch, value, tap_code):
    monkeypatch.setattr(Keycode, "protocol", 5)
    assert describe(Keycode.serialize(value))["tapCode"] == tap_code


# ---------- arguments that don't fit in the keycode are refused, not cut short ----------

@pytest.mark.parametrize("expression, message", [
    ("LT(16, KC_A)", "LT works with layers 0–15"),
    ("LT(-1, KC_A)", "LT works with layers 0–15"),
    ("LT(0x10, KC_A)", "LT works with layers 0–15"),
    ("LM(16, MOD_LSFT)", "LM works with layers 0–15"),
    ("MO(32)", "MO works with layers 0–31"),
    ("MO( 32 )", "MO works with layers 0–31"),
    ("MO(0x20)", "MO works with layers 0–31"),
    ("TG(40)", "TG works with layers 0–31"),
    ("TO(32)", "TO works with layers 0–31"),
    ("DF(0x20)", "DF works with layers 0–31"),
    ("OSL(0x20)", "OSL works with layers 0–31"),
    ("TT(0x20)", "TT works with layers 0–31"),
    ("TD(0x100)", "TD works with tap dances 0–255"),
    ("LT(1, KC_EXLM)", "LT taps a basic keycode"),
    ("LT(1, LCTL(KC_A))", "LT taps a basic keycode"),
    ("LT1(LCTL(KC_A))", "LT taps a basic keycode"),
    ("MT(MOD_LSFT, LCTL(KC_A))", "MT taps a basic keycode"),
    ("LSFT_T(KC_EXLM)", "MT taps a basic keycode"),
    ("MT(0x20, KC_A)", "MT holds modifiers"),
    ("OSM(0x20)", "OSM holds modifiers"),
    ("LM(1, 0x20)", "LM holds modifiers"),
])
def test_arguments_that_do_not_fit_are_refused(expression, message):
    with pytest.raises(ValueError) as e:
        parse_value(expression)
    assert str(e.value) == message or str(e.value).startswith(message)


@pytest.mark.parametrize("expression, value", [
    ("LT(15, KC_A)", 0x4F04),
    ("LT(0, KC_NO)", 0x4000),
    ("MO( 31 )", 0x523F),
    ("TO( 5 )", 0x5205),  # protocol 6's TO has no ON_PRESS bits
    ("MT(MOD_RCTL | MOD_RSFT, KC_RGUI)", 0x33E7),
    ("LM(15, MOD_LSFT | MOD_RCTL)", 0x51F3),
    ("TD( 255 )", 0x57FF),
])
def test_arguments_at_the_limits_are_kept(expression, value):
    assert parse_value(expression) == value


@pytest.mark.parametrize("expression, message", [
    ("TO(16)", "TO works with layers 0–15"),  # protocol 5's TO keeps 4 bits for the layer
    ("TO( 16 )", "TO works with layers 0–15"),
    ("LT(16, KC_A)", "LT works with layers 0–15"),
    ("LM(1, 0x10)", "LM holds modifiers"),  # 4 bits in protocol 5
])
def test_protocol_5_limits(monkeypatch, expression, message):
    monkeypatch.setattr(Keycode, "protocol", 5)
    with pytest.raises(ValueError, match=message):
        parse_value(expression)


def test_protocol_5_keeps_its_wider_layer_numbers(monkeypatch):
    monkeypatch.setattr(Keycode, "protocol", 5)
    assert parse_value("TO( 15 )") == 0x501F
    assert parse_value("MO( 40 )") == 0x5128


# ---------- every keycode name the tables give reads back as the same keycode ----------

ROUND_TRIP_RANGES = {
    # layer-tap, layer-mod, TO/MO/DF/TG/OSL/one-shot mod/TT/PDF, tap dance; mod-tap is sampled below
    6: [range(0x4000, 0x5000), range(0x5000, 0x5300), range(0x5700, 0x5800)],
    # layer-tap, TO, MO, DF, TG, OSL, one-shot mod, tap dance, TT, layer-mod
    5: [range(0x4000, 0x5000), range(0x5000, 0x5A00)],
}
MOD_TAP_BASE = {6: 0x2000, 5: 0x6000}


def keyboard_tables(protocol, layers):
    """ Rebuilds the keycode tables for a keyboard of this protocol and layer count, as loading one does """
    from types import SimpleNamespace
    from keycodes.keycodes import recreate_keyboard_keycodes
    recreate_keyboard_keycodes(SimpleNamespace(vial_protocol=protocol, layers=layers, macro_count=16,
                                               tap_dance_count=16, custom_keycodes=None, midi="disabled",
                                               supported_features=set()))


@pytest.fixture
def rebuilt_tables(monkeypatch, corne_keyboard):
    """ The keycode tables can be rebuilt in the test; afterwards they are the Corne's again """
    from keycodes.keycodes import recreate_keyboard_keycodes
    monkeypatch.setattr(Keycode, "protocol", Keycode.protocol)
    yield keyboard_tables
    recreate_keyboard_keycodes(corne_keyboard[1])


@pytest.mark.parametrize("layers", [4, 16, 32])
@pytest.mark.parametrize("protocol", [5, 6])
def test_keycode_names_round_trip(rebuilt_tables, protocol, layers):
    """ What describe() and .vil export write for a keycode, the server reads back as that keycode, e.g. protocol 5's
    TO(0) isn't written as TO(16), which shares its value """
    rebuilt_tables(protocol, layers)
    values = [v for r in ROUND_TRIP_RANGES[protocol] for v in r]
    values += [MOD_TAP_BASE[protocol] | (bits << 8) | kc for bits in range(0x20) for kc in (0x00, 0x04, 0xE7)]
    values += [(bits << 8) | kc for bits in range(1, 0x20) for kc in (0x00, 0x04)]  # keys with modifiers
    wrong = {}
    for value in values:
        name = Keycode.serialize(value)
        if name.startswith("0x"):
            continue  # no name: written as the number
        try:
            back = parse_value(name)
        except ValueError as e:
            back = str(e)
        if back != value:
            wrong[hex(value)] = (name, back)
    assert wrong == {}


@pytest.mark.parametrize("protocol, message", [
    (6, "LM holds modifiers, MOD_LCTL to MOD_RGUI"), (5, "LM holds modifiers, MOD_LCTL to MOD_LGUI"),
])
def test_layer_mod_names_the_modifiers_of_the_protocol(monkeypatch, protocol, message):
    monkeypatch.setattr(Keycode, "protocol", protocol)
    with pytest.raises(ValueError, match=message):
        parse_value("LM(1, 0x20)")


@pytest.mark.parametrize("bits", ALL_MODS)
def test_every_mod_tap_combination_has_its_tapped_keycode_in_protocol_5(rebuilt_tables, bits):
    rebuilt_tables(5, 4)  # protocol 5's own tables: some protocol 6 names have these values, e.g. M4 is 0x7704
    assert describe(Keycode.serialize(0x6000 | (bits << 8) | 0x04))["tapCode"] == "KC_A"
