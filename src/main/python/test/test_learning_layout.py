""" The finger proposal and the layout export (server.learning_layout), on the simulated Corne (and a QWERTY one),
an ANSI 60 % and a 4x10 ortho: pure functions over the keyboard model as a dict """
import json
import os

import pytest

from server import describe, languages, learning_check, learning_layout, model
from server.device import DeviceManager, FakeBackend
from simulator import corne
from simulator.corne import make_corne, encode
from simulator.virtual_keyboard import VirtualKeyboard

NO_NAMES = {"layers": {}, "tapDance": {}, "macros": {}}

EXAMPLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "docs", "learning",
                        "examples")


def model_of(factory):
    """ The API's model (GET /api/keyboard) of a simulated keyboard, as a dict """
    manager = DeviceManager(FakeBackend(factory))
    manager.connect()
    return manager.read(lambda kb: model.build(kb, NO_NAMES, True)).model_dump()


def keymap_of(rows):
    """ {(0, row, col): keycode} from the keycode names of layer 0, one list per matrix row """
    return {(0, r, c): encode(code) for r, row in enumerate(rows) for c, code in enumerate(row)}


def ids_by_tap(built):
    """ keycode name on layer 0 -> key id (the first key with it) """
    out = {}
    for g, k in zip(built["keys"], built["layers"][0]["keys"]):
        out.setdefault(k["code"], learning_layout.key_id(g))
    return out


# a row-stagger 60 %: the number row, Tab 1.5u, Caps 1.75u, Shift 2.25u / 2.75u, 1.25u modifiers and a 6.25u Space
ANSI_60 = {
    "name": "ANSI 60", "matrix": {"rows": 5, "cols": 14},
    "layouts": {"keymap": [
        ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "0,6", "0,7", "0,8", "0,9", "0,10", "0,11", "0,12", {"w": 2}, "0,13"],
        [{"w": 1.5}, "1,0", "1,1", "1,2", "1,3", "1,4", "1,5", "1,6", "1,7", "1,8", "1,9", "1,10", "1,11", "1,12",
         {"w": 1.5}, "1,13"],
        [{"w": 1.75}, "2,0", "2,1", "2,2", "2,3", "2,4", "2,5", "2,6", "2,7", "2,8", "2,9", "2,10", "2,11",
         {"w": 2.25}, "2,12"],
        [{"w": 2.25}, "3,0", "3,1", "3,2", "3,3", "3,4", "3,5", "3,6", "3,7", "3,8", "3,9", "3,10", {"w": 2.75}, "3,11"],
        [{"w": 1.25}, "4,0", {"w": 1.25}, "4,1", {"w": 1.25}, "4,2", {"w": 6.25}, "4,3", {"w": 1.25}, "4,4",
         {"w": 1.25}, "4,5", {"w": 1.25}, "4,6", {"w": 1.25}, "4,7"],
    ]},
}
ANSI_60_LAYER_0 = [
    ["KC_GRV", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5", "KC_6", "KC_7", "KC_8", "KC_9", "KC_0", "KC_MINS", "KC_EQL",
     "KC_BSPC"],
    ["KC_TAB", "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P", "KC_LBRC", "KC_RBRC",
     "KC_BSLS"],
    ["KC_CAPS", "KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H", "KC_J", "KC_K", "KC_L", "KC_SCLN", "KC_QUOT", "KC_ENT"],
    ["KC_LSFT", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH", "KC_RSFT"],
    ["KC_LCTL", "KC_LGUI", "KC_LALT", "KC_SPC", "KC_RALT", "KC_RGUI", "MO(1)", "KC_RCTL"],
]

# a 4x10 ortho (no number row, two Space keys in the bottom row)
ORTHO_4X10 = {
    "name": "Ortho", "matrix": {"rows": 4, "cols": 10},
    "layouts": {"keymap": [["{},{}".format(r, c) for c in range(10)] for r in range(4)]},
}
ORTHO_LAYER_0 = [
    ["KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P"],
    ["KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H", "KC_J", "KC_K", "KC_L", "KC_SCLN"],
    ["KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH"],
    ["KC_LCTL", "KC_LGUI", "KC_LALT", "MO(1)", "KC_SPC", "KC_SPC", "MO(2)", "KC_LEFT", "KC_DOWN", "KC_RGHT"],
]


@pytest.fixture(scope="module")
def corne_model():
    return model_of(make_corne)


@pytest.fixture(scope="module")
def ansi_model():
    return model_of(lambda: VirtualKeyboard(ANSI_60, layers=2, keymap=keymap_of(ANSI_60_LAYER_0)))


@pytest.fixture(scope="module")
def ortho_model():
    return model_of(lambda: VirtualKeyboard(ORTHO_4X10, layers=3, keymap=keymap_of(ORTHO_LAYER_0)))


def fingers_by_tap(built):
    proposal = learning_layout.proposal(built)
    return {code: proposal[kid] for code, kid in ids_by_tap(built).items()}


# ---------- the proposal: simulated Corne ----------

def test_corne_resting_keys_are_the_home_row_letters_and_both_thumb_rests(corne_model):
    proposal = learning_layout.proposal(corne_model)
    by_tap = fingers_by_tap(corne_model)
    home = sorted(kid for kid, f in proposal.items() if f["home"])
    # left home row S H N T (r1c1..r1c4), right A E O I (r5c1..r5c4), Space (r3c4) and Enter (r7c4)
    assert home == ["r1c1", "r1c2", "r1c3", "r1c4", "r3c4", "r5c1", "r5c2", "r5c3", "r5c4", "r7c4"]
    assert by_tap["LT2(KC_S)"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["LSFT_T(KC_T)"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["RGUI_T(KC_A)"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["RSFT_T(KC_I)"]["finger"] == "pinky" and by_tap["RSFT_T(KC_I)"]["hand"] == "right"


def test_corne_thumbs_and_reaches(corne_model):
    by_tap = fingers_by_tap(corne_model)
    # the LT1(KC_SPC) thumb is the left rest, Enter the right one; the others inner / outer by their distance to the gap
    assert by_tap["LT1(KC_SPACE)"] == {"hand": "left", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_ENTER"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_ESCAPE"]["reach"] == "outer" and by_tap["TD(0)"]["reach"] == "inner"
    assert by_tap["M0"]["reach"] == "inner" and by_tap["OSL(3)"]["reach"] == "outer"
    # the sixth column (comma, Z, slash) is the index finger's inner reach; the first (Tab, Ctrl, Shift) the pinky's outer
    assert by_tap["KC_COMMA"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_Z"]["reach"] == "inner" and by_tap["KC_SLASH"]["reach"] == "inner"
    assert by_tap["KC_TAB"] == {"hand": "left", "finger": "pinky", "row": "top", "reach": "outer", "home": False}
    assert by_tap["KC_LCTRL"]["reach"] == "outer" and by_tap["KC_LSHIFT"]["reach"] == "outer"
    assert by_tap["KC_Q"]["reach"] == "inner" and by_tap["KC_BSLASH"]["finger"] == "pinky"
    assert by_tap["KC_BSPACE"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "outer", "home": False}
    # up and down from the resting keys
    assert by_tap["KC_L"] == {"hand": "left", "finger": "ring", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_V"] == {"hand": "left", "finger": "index", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_Y"] == {"hand": "right", "finger": "pinky", "row": "bottom", "reach": "down", "home": False}


def qwerty_corne():
    """ The simulated Corne's shape with a number row above it (matrix rows 8 and 9) and QWERTY on layer 0: five
    letters in each hand's home row (A S D F G | H J K L ; '), so G and H are the extra columns, not , and . """
    definition = corne.definition()
    definition["matrix"]["rows"] = 10
    rows = definition["layouts"]["keymap"]
    rows.insert(0, ["8,{}".format(c) for c in range(6)] + [{"x": 3}] + ["9,{}".format(5 - c) for c in range(6)])
    nothing = ["KC_NO"] * 3
    layer_0 = [  # matrix rows: left 0-2 (outside in), left thumbs 3, right 4-6 (col 0 outermost), right thumbs 7
        ["KC_TAB", "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T"],
        ["KC_LCTL", "KC_A", "KC_S", "KC_D", "KC_F", "KC_G"],
        ["KC_LSFT", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B"],
        nothing + ["KC_LGUI", "KC_SPC", "KC_LALT"],
        ["KC_BSPC", "KC_P", "KC_O", "KC_I", "KC_U", "KC_Y"],
        ["KC_QUOT", "KC_SCLN", "KC_L", "KC_K", "KC_J", "KC_H"],
        ["KC_RSFT", "KC_SLSH", "KC_DOT", "KC_COMM", "KC_M", "KC_N"],
        nothing + ["KC_RALT", "KC_ENT", "KC_RGUI"],
        ["KC_GRV", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5"],
        ["KC_DEL", "KC_0", "KC_9", "KC_8", "KC_7", "KC_6"],
    ]
    return VirtualKeyboard(definition, layers=1, keymap=keymap_of(layer_0))


def test_qwerty_corne_has_five_home_row_letters_and_the_inner_ones_are_the_index_fingers_reach():
    by_tap = fingers_by_tap(model_of(qwerty_corne))
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_S"]["finger"] == "ring" and by_tap["KC_D"]["finger"] == "middle"
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_H"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_J"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_SCOLON"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_QUOTE"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "outer", "home": False}
    assert by_tap["KC_LCTRL"]["reach"] == "outer" and by_tap["KC_T"]["reach"] == "inner"
    assert by_tap["KC_Y"] == {"hand": "right", "finger": "index", "row": "top", "reach": "inner", "home": False}
    assert by_tap["KC_B"]["reach"] == "inner" and by_tap["KC_V"]["reach"] == "down"
    # the number row is always up: above the inner column (6) and the outer one (`, Delete) too
    assert by_tap["KC_1"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_5"]["finger"] == "index" and by_tap["KC_6"]["finger"] == "index"
    assert by_tap["KC_6"]["reach"] == "up" and by_tap["KC_GRAVE"]["reach"] == "up" and by_tap["KC_DELETE"]["reach"] == "up"
    assert by_tap["KC_SPACE"]["home"] and by_tap["KC_ENTER"]["home"]


def sweep(layer_0):
    """ A 34-key split (a Sweep / Ferris): three rows of five keys a hand round a gap of three keys, two thumb keys a
    hand (matrix row 3, columns 3-6); layer_0: each matrix row's keycodes left to right as on the board """
    rows = [["{},{}".format(r, c) for c in range(5)] + [{"x": 3}] + ["{},{}".format(r, c) for c in range(5, 10)]
            for r in range(3)]
    rows.append([{"x": 3}, "3,3", "3,4", {"x": 3}, "3,5", "3,6"])
    definition = {"name": "Sweep", "matrix": {"rows": 4, "cols": 10}, "layouts": {"keymap": rows}}
    return VirtualKeyboard(definition, layers=1, keymap=keymap_of(layer_0))


QWERTY_SWEEP = [
    ["KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P"],
    ["KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H", "KC_J", "KC_K", "KC_L", "KC_SCLN"],
    ["KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH"],
    ["KC_NO"] * 3 + ["KC_LGUI", "KC_SPC", "KC_ENT", "KC_RALT"],
]


def test_qwerty_sweep_rests_on_j_k_l_semicolon_and_h_is_the_index_fingers_inner_reach():
    """ five typing columns a hand and nothing nearer the gap: the inner end is the extra one on both hands, though
    H is a letter and ; is not """
    by_tap = fingers_by_tap(model_of(lambda: sweep(QWERTY_SWEEP)))
    assert by_tap["KC_J"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_K"]["finger"] == "middle" and by_tap["KC_L"]["finger"] == "ring"
    assert by_tap["KC_SCOLON"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_H"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_D"]["finger"] == "middle" and by_tap["KC_S"]["finger"] == "ring"
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_Y"]["reach"] == "inner" and by_tap["KC_N"]["reach"] == "inner"
    assert by_tap["KC_U"] == {"hand": "right", "finger": "index", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_SLASH"] == {"hand": "right", "finger": "pinky", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_SPACE"]["home"] and by_tap["KC_ENTER"]["home"]
    assert by_tap["KC_LGUI"]["reach"] == "outer" and by_tap["KC_RALT"]["reach"] == "outer"


def test_five_typing_columns_with_neither_end_a_letter_make_the_inner_end_the_extra_one():
    """ ; S D F , | . J K L ': the comma and the full stop next to the gap are the extras, as on the Corne """
    rows = [row[:] for row in QWERTY_SWEEP]
    rows[1] = ["KC_SCLN", "KC_S", "KC_D", "KC_F", "KC_COMM", "KC_DOT", "KC_J", "KC_K", "KC_L", "KC_QUOT"]
    by_tap = fingers_by_tap(model_of(lambda: sweep(rows)))
    assert by_tap["KC_COMMA"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_DOT"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_F"]["home"] and by_tap["KC_J"]["home"]
    assert by_tap["KC_SCOLON"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_QUOTE"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}


def test_a_column_that_types_nothing_nearer_the_gap_makes_the_outer_end_the_extra_one():
    """ Ctrl N E I O ' on a Corne's right half: the hand rests one column in, on N E I O; the quote is the pinky's
    outer reach and Ctrl the index finger's inner one. The left half (Ctrl A S D F G) is the QWERTY Corne's. """
    definition = corne.definition()
    layer_0 = [
        ["KC_TAB", "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T"],
        ["KC_LCTL", "KC_A", "KC_S", "KC_D", "KC_F", "KC_G"],
        ["KC_LSFT", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B"],
        ["KC_NO"] * 3 + ["KC_LGUI", "KC_SPC", "KC_LALT"],
        ["KC_BSPC", "KC_P", "KC_Y", "KC_U", "KC_L", "KC_J"],  # right rows: column 0 is the outermost key
        ["KC_QUOT", "KC_O", "KC_I", "KC_E", "KC_N", "KC_RCTL"],
        ["KC_RSFT", "KC_SLSH", "KC_DOT", "KC_COMM", "KC_M", "KC_H"],
        ["KC_NO"] * 3 + ["KC_RALT", "KC_ENT", "KC_RGUI"],
    ]
    by_tap = fingers_by_tap(model_of(lambda: VirtualKeyboard(definition, layers=1, keymap=keymap_of(layer_0))))
    assert by_tap["KC_N"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_E"]["finger"] == "middle" and by_tap["KC_I"]["finger"] == "ring"
    assert by_tap["KC_O"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_QUOTE"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "outer", "home": False}
    assert by_tap["KC_RCTRL"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_H"]["reach"] == "inner" and by_tap["KC_J"]["reach"] == "inner"
    assert by_tap["KC_M"] == {"hand": "right", "finger": "index", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_BSPACE"]["reach"] == "outer"
    # the left half is unchanged: both ends letters, G the extra one
    assert by_tap["KC_F"]["home"] and by_tap["KC_A"]["home"] and by_tap["KC_G"]["reach"] == "inner"


def test_a_plain_altgr_key_carries_its_hold_so_the_picture_can_light_it():
    """ the QWERTY Corne's right inner thumb is KC_RALT: nothing to type, but the way to a Polish letter """
    built = model_of(qwerty_corne)
    export = learning_layout.export(built)
    keys, ids = {k["id"]: k for k in export["keys"]}, ids_by_tap(built)
    assert keys[ids["KC_RALT"]]["chars"] == {"0": {"hold": "AltGr"}}
    assert keys[ids["KC_RALT"]]["row"] == "thumb"
    # the other plain modifiers carry nothing, as before
    assert keys[ids["KC_LALT"]]["chars"] == {} and keys[ids["KC_LGUI"]]["chars"] == {}
    assert keys[ids["KC_LCTRL"]]["chars"] == {} and keys[ids["KC_LSHIFT"]]["chars"] == {}
    # the right Alt alone with no key, as describe names it
    assert learning_layout.describe_key({"code": "RALT(KC_NO)", "kind": "modifier", "legend": {"main": "AltGr"}}, []) \
        == learning_layout.KeyOnLayer(None, "AltGr", None, False)
    assert learning_layout.describe_key(describe.describe("RALT(KC_NO)"), []).hold == "AltGr"
    # hold is not in the hash: the same keymap with a left Alt there hashes the same
    swapped = json.loads(json.dumps(built))
    for k in swapped["layers"][0]["keys"]:
        if k["code"] == "KC_RALT":
            k.update(describe.describe("KC_LALT"))
    assert learning_layout.export(swapped)["hash"] == export["hash"]
    assert learning_layout.export(swapped)["keys"] != export["keys"]


def test_corne_proposal_matches_the_worked_example(corne_model):
    """ docs/learning/examples/corne-sim-layout-export.json was made by the verified prototype """
    with open(os.path.join(EXAMPLES, "corne-sim-layout-export.json"), encoding="utf-8") as inf:
        example = json.load(inf)
    proposal = learning_layout.proposal(corne_model)
    for key in example["keys"]:
        expected = {k: key[k] for k in ("hand", "finger", "row", "reach", "home")}
        assert proposal[key["id"]] == expected, key["id"]


# ---------- the proposal: a row-stagger 60 % ----------

def test_ansi_home_row(ansi_model):
    by_tap = fingers_by_tap(ansi_model)
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_S"]["finger"] == "ring" and by_tap["KC_D"]["finger"] == "middle"
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_H"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_J"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_SCOLON"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_QUOTE"]["reach"] == "outer" and by_tap["KC_ENTER"]["reach"] == "outer"
    assert by_tap["KC_CAPSLOCK"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "outer", "home": False}


def test_ansi_other_rows(ansi_model):
    by_tap = fingers_by_tap(ansi_model)
    assert by_tap["KC_P"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_Q"]["finger"] == "pinky" and by_tap["KC_Q"]["reach"] == "up"
    assert by_tap["KC_T"]["reach"] == "inner" and by_tap["KC_Y"]["reach"] == "inner"
    assert by_tap["KC_R"] == {"hand": "left", "finger": "index", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_B"] == {"hand": "left", "finger": "index", "row": "bottom", "reach": "inner", "home": False}
    assert by_tap["KC_N"]["hand"] == "right" and by_tap["KC_N"]["reach"] == "inner"
    assert by_tap["KC_M"] == {"hand": "right", "finger": "index", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_SLASH"]["finger"] == "pinky" and by_tap["KC_RSHIFT"]["reach"] == "outer"
    assert by_tap["KC_SPACE"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_LCTRL"]["row"] == "thumb" and by_tap["KC_LCTRL"]["finger"] == "thumb"
    # the number row: up from the top row's finger, as the charts have it (1 pinky, 2 ring, 3 middle, 4 5 6 index;
    # 7 index, 8 middle, 9 ring, 0 - pinky); always up, even above the inner and outer columns
    assert by_tap["KC_1"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_2"]["finger"] == "ring" and by_tap["KC_3"]["finger"] == "middle"
    assert by_tap["KC_4"] == {"hand": "left", "finger": "index", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_5"]["finger"] == "index" and by_tap["KC_6"]["finger"] == "index"
    assert by_tap["KC_6"]["hand"] == "left" and by_tap["KC_7"]["hand"] == "right"
    assert by_tap["KC_7"]["finger"] == "index"
    assert by_tap["KC_8"] == {"hand": "right", "finger": "middle", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_9"]["finger"] == "ring"
    assert by_tap["KC_0"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_MINUS"]["finger"] == "pinky" and by_tap["KC_EQUAL"]["reach"] == "up"
    assert by_tap["KC_6"]["reach"] == "up"
    assert by_tap["KC_GRAVE"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_BSPACE"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "up", "home": False}


def test_one_board_split_does_not_depend_on_the_keyboard_language(ansi_model):
    """ Under German, ; and ' are the letters Ö and Ä: eleven letters in the home row, and parting between the two
    middle ones would rest the hands on S D F G and K L Ö Ä. The hands part after the fifth key that types a
    character (Caps Lock types nothing): A S D F G | H J K L Ö Ä, the same fingers as under en-us. """
    with describe.keyboard_language(languages.overrides("german-qwertz")):
        german = model_of(lambda: VirtualKeyboard(ANSI_60, layers=2, keymap=keymap_of(ANSI_60_LAYER_0)))
    ids = ids_by_tap(german)
    export = learning_layout.export(german, language="german-qwertz")
    keys = {k["id"]: k for k in export["keys"]}
    assert keys[ids["KC_SCOLON"]]["chars"]["0"]["tap"] == "ö" and keys[ids["KC_QUOTE"]]["chars"]["0"]["tap"] == "ä"
    assert learning_layout.proposal(german) == learning_layout.proposal(ansi_model)
    by_tap = fingers_by_tap(german)
    assert sorted(kid for kid, f in learning_layout.proposal(german).items() if f["home"]) == \
        sorted(ids[c] for c in ("KC_A", "KC_S", "KC_D", "KC_F", "KC_J", "KC_K", "KC_L", "KC_SCOLON", "KC_SPACE",
                                "KC_LALT"))  # the left thumb rests on Alt: Space is the right hand's
    assert by_tap["KC_G"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_H"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_QUOTE"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "outer", "home": False}
    # fewer than ten typing keys in the home row (a lone half): halfway across
    half = {"name": "Half", "matrix": {"rows": 3, "cols": 6},
            "layouts": {"keymap": [["{},{}".format(r, c) for c in range(6)] for r in range(3)]}}
    layer_0 = [["KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y"], ["KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H"],
               ["KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N"]]
    by_tap = fingers_by_tap(model_of(lambda: VirtualKeyboard(half, layers=1, keymap=keymap_of(layer_0))))
    assert [by_tap[c]["hand"] for c in ("KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H")] == ["left"] * 3 + ["right"] * 3


# ---------- the proposal: a 4x10 ortho ----------

def test_ortho(ortho_model):
    by_tap = fingers_by_tap(ortho_model)
    proposal = learning_layout.proposal(ortho_model)
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"]["reach"] == "inner" and by_tap["KC_H"]["reach"] == "inner"
    assert by_tap["KC_T"] == {"hand": "left", "finger": "index", "row": "top", "reach": "inner", "home": False}
    assert by_tap["KC_P"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_SCOLON"]["home"] is True and by_tap["KC_SLASH"]["reach"] == "down"
    # each hand's Space is its thumb's resting key
    assert proposal["r3c4"] == {"hand": "left", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert proposal["r3c5"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert proposal["r3c3"]["reach"] == "outer" and proposal["r3c6"]["reach"] == "outer"
    assert not any(f["row"] == "number" for f in proposal.values())


def rotated_thumbs_corne():
    """ The simulated Corne with its thumb keys drawn at the bottom letter row's height, but rotated by 30 degrees so
    that their centres end up below it (as a real Corne's vial.json draws them) """
    definition = corne.definition()
    rows = definition["layouts"]["keymap"]
    rows[3] = [{"r": 30, "rx": 3, "ry": 3, "x": 1.5, "y": -1}] + ["{},{}".format(*rc) for rc in corne.LEFT_THUMBS]
    rows.append([{"r": -30, "rx": 12, "ry": 3, "x": -4.5, "y": -1}] + ["{},{}".format(*rc) for rc in corne.RIGHT_THUMBS])
    return VirtualKeyboard(definition, layers=4, keymap=corne.keymap(), uid=corne.CORNE_UID)


def test_rotated_thumb_keys_land_in_the_thumb_row():
    built = model_of(rotated_thumbs_corne)
    proposal = learning_layout.proposal(built)
    for rc in corne.LEFT_THUMBS + corne.RIGHT_THUMBS:
        kid = "r{}c{}".format(*rc)
        assert proposal[kid]["row"] == "thumb" and proposal[kid]["finger"] == "thumb", kid
        geometry = next(g for g in built["keys"] if (g["row"], g["col"]) == rc)
        assert geometry["y"] == 2 and learning_layout.centre(geometry)[1] > 3  # drawn in the bottom row, rotated below it
    assert proposal["r3c4"]["reach"] == "rest" and proposal["r7c4"]["reach"] == "rest"
    assert proposal["r1c4"]["home"] and proposal["r2c4"]["row"] == "bottom"


# ---------- corrections ----------

def test_apply_fingers_overrides_and_resting_keys(corne_model):
    proposal = learning_layout.proposal(corne_model)
    fixed = learning_layout.apply_fingers(proposal, {
        "format": "vial-web-fingers/1",
        "keys": {"r0c5": {"finger": "middle", "reach": "up"}, "r9c9": {"finger": "ring", "reach": "up"}},
        "home": ["r1c1", "r1c2", "r1c3", "r1c5", "r3c3"],
    })
    assert fixed["r0c5"]["finger"] == "middle" and fixed["r0c5"]["reach"] == "up"
    assert "r9c9" not in fixed
    assert fixed["r1c5"]["home"] and fixed["r1c5"]["reach"] == "rest"
    assert not fixed["r1c4"]["home"] and fixed["r1c4"]["reach"] == "rest"  # a finger's reach is its own to change
    assert fixed["r3c3"]["home"] and fixed["r3c3"]["reach"] == "outer"  # a thumb key keeps its reach
    assert not fixed["r3c4"]["home"]
    assert proposal["r0c5"]["finger"] == "index"  # the proposal itself is left alone


# ---------- the export ----------

def test_export_resolves_transparent_keys_and_drops_unreachable_layers(corne_model):
    export = learning_layout.export(corne_model)
    assert export["format"] == "vial-web-layout-export/1"
    assert export["keyboard"] == {"name": "Simulated Corne", "uid": "5EEDC0DE00420042"}
    assert export["language"] == "en-us"
    keys = {k["id"]: k for k in export["keys"]}
    # T on layer 0 is a mod-tap (Shift); layer 1 types ")", layer 3 "4" (and "$" with Shift); on layer 2 it is Shift
    assert keys["r1c4"]["chars"] == {"0": {"tap": "t", "shift": "T", "hold": "Shift"}, "1": {"tap": ")"},
                                     "3": {"tap": "4", "shift": "$"}}
    # B holds layer 2, where it is transparent: it types B there as well
    assert keys["r0c4"]["chars"] == {"0": {"tap": "b", "shift": "B", "hold": "layer 2"}, "1": {"tap": "$"},
                                     "2": {"tap": "b", "shift": "B"}}
    assert keys["r0c4"]["layerKey"] == {"layer": 2, "how": "hold"}
    # Space is transparent on every other layer: it types a space on each
    assert keys["r3c4"]["chars"] == {"0": {"tap": " ", "hold": "layer 1"}, "1": {"tap": " "}, "2": {"tap": " "},
                                     "3": {"tap": " "}}
    assert keys["r3c4"]["layerKey"] == {"layer": 1, "how": "hold"}
    assert [l["index"] for l in export["layers"]] == [0, 1, 2, 3]
    assert export["layers"][1]["reachedBy"] == [{"key": "r3c4", "how": "hold", "label": "hold Space"}]
    assert export["layers"][3]["reachedBy"] == [{"key": "r7c3", "how": "oneShot", "label": "tap OSL 3"}]
    assert {s["key"] for s in export["shiftKeys"]} == {"r1c4", "r5c1", "r2c0", "r6c0"}
    assert export["keys"] == sorted(export["keys"], key=lambda k: (k["y"], k["x"]))


def test_export_matches_the_worked_example(corne_model):
    with open(os.path.join(EXAMPLES, "corne-sim-layout-export.json"), encoding="utf-8") as inf:
        example = json.load(inf)
    export = learning_layout.export(corne_model)
    assert export["hash"] == example["hash"]
    for field in ("keyboard", "layers", "shiftKeys", "keys"):
        assert export[field] == example[field], field


def test_export_with_fewer_layers_drops_those_no_key_reaches():
    built = model_of(lambda: make_corne(layers=2))
    export = learning_layout.export(built)
    assert [l["index"] for l in export["layers"]] == [0, 1]
    assert all(set(k["chars"]) <= {"0", "1"} for k in export["keys"])


def test_hash_ignores_layer_names_but_not_moved_letters(corne_model):
    base = learning_layout.export(corne_model)["hash"]
    renamed = json.loads(json.dumps(corne_model))
    renamed["layers"][1]["name"], renamed["layers"][1]["customName"] = "Symbols", True
    assert learning_layout.export(renamed)["hash"] == base
    assert learning_layout.export(renamed)["layers"][1]["name"] == "Symbols"
    moved = model_of(lambda: make_corne())
    i, j = next(i for i, g in enumerate(moved["keys"]) if (g["row"], g["col"]) == (0, 2)), \
        next(i for i, g in enumerate(moved["keys"]) if (g["row"], g["col"]) == (0, 3))
    keys = moved["layers"][0]["keys"]
    keys[i], keys[j] = keys[j], keys[i]  # L and R change places
    assert learning_layout.export(moved)["hash"] != base
    assert learning_layout.export(corne_model, language="pl")["language"] == "pl"


def test_letters_keep_their_altgr_character_and_a_capital_of_two_letters_falls_back_to_the_legend():
    with describe.keyboard_language(languages.overrides("polish-qwerty")):
        polish = model_of(make_corne)
    export = learning_layout.export(polish, language="polish-qwerty")
    keys = {k["id"]: k for k in export["keys"]}
    ids = ids_by_tap(polish)
    assert keys[ids["RGUI_T(KC_A)"]]["chars"]["0"] == {"tap": "a", "shift": "A", "altGr": "ą", "hold": "RGui"}
    assert keys[ids["KC_L"]]["chars"]["0"] == {"tap": "l", "shift": "L", "altGr": "ł"}
    assert keys[ids["LGUI_T(KC_W)"]]["chars"]["0"] == {"tap": "w", "shift": "W", "hold": "Gui"}  # W has no AltGr one
    assert export["hash"] != learning_layout.export(model_of(make_corne))["hash"]  # altGr is in the character map
    # ß: its capital is "SS", so Shift types the legend's shifted character
    assert learning_layout.char_of({"main": "ß", "shifted": "?", "altGr": None}, "KC_MINUS", "KC_MINUS") == \
        {"tap": "ß", "shift": "?"}
    # İ: its small letter is two code points (i and a combining dot), so the tap is the legend's own character
    assert len("İ".lower()) == 2
    assert learning_layout.char_of({"main": "İ", "shifted": None, "altGr": None}, "KC_I", "KC_I") == \
        {"tap": "İ", "shift": "İ"}


# a key, a layout option whose choices draw a key at x 1 (choice 0) or x 2 and a row lower (choice 1), and a decal
# that would stand in for r0c0 at x 3
OPTIONS = {"name": "Options", "matrix": {"rows": 1, "cols": 3},
           "layouts": {"labels": ["Split"],
                       "keymap": [["0,0", "0,1\n\n\n0,0"], [{"x": 2}, "0,2\n\n\n0,1", {"d": True}, "0,0"]]}}


def test_export_holds_the_chosen_layout_option_and_no_decal():
    keymap = {(0, 0, 0): encode("KC_A"), (0, 0, 1): encode("KC_B"), (0, 0, 2): encode("KC_C")}
    built = model_of(lambda: VirtualKeyboard(OPTIONS, layers=1, keymap=keymap))
    assert [g["decal"] for g in built["keys"]] == [False, False, False, True]  # the model has all four
    export = learning_layout.export(built)
    assert [(k["id"], k["x"], k["y"]) for k in export["keys"]] == [("r0c0", 0.5, 0.5), ("r0c1", 1.5, 0.5)]
    assert set(learning_layout.proposal(built)) == {"r0c0", "r0c1"}
    built["layoutOptions"]["value"] = 1
    export = learning_layout.export(built)
    # choice 1's key is drawn where choice 0's is, as the picture draws it
    assert [(k["id"], k["x"], k["y"]) for k in export["keys"]] == [("r0c0", 0.5, 0.5), ("r0c2", 1.5, 0.5)]
    assert export["keys"][1]["chars"] == {"0": {"tap": "c", "shift": "C"}}
    assert learning_layout.layout_choices({"value": 0b1_10_1, "labels": ["A", ["B", "x", "y", "z"], "C"]}) == [1, 2, 1]
    # hand-edited JSON: no value is the first choice of each option, no labels no options
    assert learning_layout.layout_choices({"labels": ["A", "B"]}) == [0, 0]
    assert learning_layout.layout_choices({"value": "3", "labels": ["A"]}) == [0]
    assert learning_layout.layout_choices({"value": 1}) == [] and learning_layout.layout_choices({}) == []


# as OPTIONS, but choice 1's key is drawn turned by 90 degrees about its own top-left corner (2, 1), so its drawn
# box is (1, 1)-(2, 2): a key unit to the left of its unrotated rectangle
OPTIONS_ROTATED = {"name": "Options", "matrix": {"rows": 1, "cols": 3},
                   "layouts": {"labels": ["Split"],
                               "keymap": [["0,0", "0,1\n\n\n0,0"], [{"r": 90, "rx": 2, "ry": 1}, "0,2\n\n\n0,1"]]}}


def test_a_rotated_choice_is_moved_by_its_drawn_corner_as_the_picture_does():
    keymap = {(0, 0, 0): encode("KC_A"), (0, 0, 1): encode("KC_B"), (0, 0, 2): encode("KC_C")}
    built = model_of(lambda: VirtualKeyboard(OPTIONS_ROTATED, layers=1, keymap=keymap))
    turned = built["keys"][2]
    assert (turned["x"], turned["y"], turned["r"], turned["rx"], turned["ry"]) == (2, 1, 90, 2, 1)
    assert sorted((round(x, 6), round(y, 6)) for x, y in learning_layout.corners(turned)) == \
        [(1, 1), (1, 2), (2, 1), (2, 2)]
    built["layoutOptions"]["value"] = 1
    export = learning_layout.export(built)
    # the drawn box's corner (1, 1) goes to choice 0's (1, 0): the key's centre lands where choice 0's is drawn, not
    # a key unit left of it (over r0c0) as moving the unrotated rectangle would put it
    assert [(k["id"], k["x"], k["y"]) for k in export["keys"]] == [("r0c0", 0.5, 0.5), ("r0c2", 1.5, 0.5)]
    # a key with a second rectangle (an ISO Enter): its corners are both rectangles'
    iso = {"x": 1, "y": 0, "w": 1.5, "h": 1, "x2": 0.25, "y2": 0, "w2": 1.25, "h2": 2}
    assert max(p[1] for p in learning_layout.corners(iso)) == 2 and min(p[0] for p in learning_layout.corners(iso)) == 1


# as OPTIONS, but choice 1 holds an encoder (at x 2, y 1) to the left of its key (x 3): the box around the choice's
# keys and encoders starts at the encoder, which goes where choice 0's key (x 1) is drawn, and the key beside it
OPTIONS_ENCODER = {"name": "Options", "matrix": {"rows": 1, "cols": 3},
                   "layouts": {"labels": ["Split"],
                               "keymap": [["0,0", "0,1\n\n\n0,0"],
                                          [{"x": 2}, "0,0\n\n\n0,1\n\n\n\n\n\ne", "0,2\n\n\n0,1"]]}}


def test_an_encoder_inside_a_layout_option_counts_for_where_the_choice_is_drawn():
    keymap = {(0, 0, 0): encode("KC_A"), (0, 0, 1): encode("KC_B"), (0, 0, 2): encode("KC_C")}
    built = model_of(lambda: VirtualKeyboard(OPTIONS_ENCODER, layers=1, keymap=keymap))
    assert len(built["encoders"]) == 1
    encoder = built["encoders"][0]
    assert (encoder["layoutIndex"], encoder["layoutOption"], encoder["x"], encoder["y"]) == (0, 1, 2, 1)
    assert sorted(learning_layout.corners(encoder)) == [(2, 1), (2, 2), (3, 1), (3, 2)]
    built["layoutOptions"]["value"] = 1
    visible = learning_layout.visible_keys(built)
    # the encoder itself is no key the lessons type; its key lands at (2, 0), beside where the encoder is drawn, not
    # at (1, 0) as it would were the box drawn around the keys alone
    assert [(i, learning_layout.key_id(g), g["x"], g["y"]) for i, g in visible] == [(0, "r0c0", 0, 0), (2, "r0c2", 2, 0)]
    export = learning_layout.export(built)
    assert [(k["id"], k["x"], k["y"]) for k in export["keys"]] == [("r0c0", 0.5, 0.5), ("r0c2", 2.5, 0.5)]
    assert export["keys"][1]["chars"] == {"0": {"tap": "c", "shift": "C"}}


def test_an_empty_keyboard_exports_no_keys():
    empty = {"name": "Empty", "uid": "0", "keys": [], "layers": [{"index": 0, "name": "Layer 0", "keys": []}]}
    assert learning_layout.proposal(empty) == {}
    export = learning_layout.export(empty)
    assert export["keys"] == [] and [l["index"] for l in export["layers"]] == [0]
    no_layers = {"name": "Empty", "uid": "0", "keys": [{"row": 0, "col": 0, "x": 0, "y": 0, "w": 1, "h": 1}],
                 "layers": []}
    assert learning_layout.proposal(no_layers) == {}
    assert learning_layout.export(no_layers)["keys"] == [] and learning_layout.export(no_layers)["layers"] == []


def test_shift_keys_are_the_keys_that_give_shift_alone():
    definition = {"name": "Shifts", "matrix": {"rows": 1, "cols": 6},
                  "layouts": {"keymap": [["0,0", "0,1", "0,2", "0,3", "0,4", "0,5"]]}}
    keymap = {(0, 0, 0): encode("KC_LSFT"), (0, 0, 1): encode("LSFT_T(KC_A)"), (0, 0, 2): encode("C_S_T(KC_B)"),
              (0, 0, 3): encode("OSM(MOD_LSFT)"), (0, 0, 4): encode("RSFT_T(KC_C)"), (0, 0, 5): encode("OSM(MOD_RSFT)")}
    export = learning_layout.export(model_of(lambda: VirtualKeyboard(definition, layers=1, keymap=keymap)))
    assert [(s["key"], s["label"]) for s in export["shiftKeys"]] == [
        ("r0c0", "Shift"), ("r0c1", "A (hold)"), ("r0c3", "Shift (one-shot)"), ("r0c4", "C (hold)"),
        ("r0c5", "Shift (one-shot)")]  # Ctrl+Shift on B is no Shift key
    keys = {k["id"]: k for k in export["keys"]}
    assert keys["r0c2"]["chars"] == {"0": {"tap": "b", "shift": "B", "hold": "Ctrl+Shift"}}


def test_layer_mod_and_tri_layer_keys_reach_their_layer():
    definition = {"name": "LM", "matrix": {"rows": 1, "cols": 4},
                  "layouts": {"keymap": [["0,0", "0,1", "0,2", "0,3"]]}}
    keymap = {(0, 0, 0): encode("LM(1, MOD_LSFT)"), (0, 0, 1): encode("FN_MO13"), (0, 0, 2): encode("FN_MO23"),
              (0, 0, 3): encode("KC_A"), (1, 0, 3): encode("KC_B"), (2, 0, 3): encode("KC_C"), (3, 0, 3): encode("KC_D")}
    built = model_of(lambda: VirtualKeyboard(definition, layers=4, keymap=keymap))
    export = learning_layout.export(built)
    reached = {l["index"]: l["reachedBy"] for l in export["layers"]}
    assert set(reached) == {0, 1, 2}  # layer 3 (both tri-layer keys held) isn't a path a lesson teaches
    assert reached[1] == [{"key": "r0c0", "how": "hold", "label": "hold LM 1"},
                          {"key": "r0c1", "how": "hold", "label": "hold Fn1 (Fn3)"}]
    assert reached[2] == [{"key": "r0c2", "how": "hold", "label": "hold Fn2 (Fn3)"}]
    keys = {k["id"]: k for k in export["keys"]}
    assert keys["r0c0"]["layerKey"] == {"layer": 1, "how": "hold"}
    assert keys["r0c3"]["chars"] == {"0": {"tap": "a", "shift": "A"}, "1": {"tap": "b", "shift": "B"},
                                     "2": {"tap": "c", "shift": "C"}}


# ---------- re-fitting a lesson set to the keyboard as it is now ----------

# four keys: a (A) and 1; b (B), 2 and a with Shift on layer 1; c, b on layer 1, x on layer 2 (which no key reaches);
# Space, which holds layer 1
FIT_EXPORT = {
    "format": "vial-web-layout-export/1", "keyboard": {"name": "Fit", "uid": "0000000000000002"},
    "hash": "sha256:fedcba9876543210", "exportedAt": "2026-10-22T10:00:00Z", "language": "en-us",
    "layers": [{"index": 0, "name": "Base", "reachedBy": []},
               {"index": 1, "name": "Sym", "reachedBy": [{"key": "r0c3", "how": "hold", "label": "hold Space"},
                                                         {"key": "r0c2", "how": "oneShot", "label": "tap C"}]},
               {"index": 2, "name": "Lost", "reachedBy": []}],
    "shiftKeys": [],
    "keys": [{"id": "r0c0", "chars": {"0": {"tap": "a", "shift": "A"}, "1": {"tap": "1"}}},
             {"id": "r0c1", "chars": {"0": {"tap": "b", "shift": "B"}, "1": {"tap": "2", "shift": "a"}}},
             {"id": "r0c2", "chars": {"0": {"tap": "c"}, "1": {"tap": "b"}, "2": {"tap": "x"}}},
             {"id": "r0c3", "chars": {"0": {"tap": " ", "hold": "layer 1"}}, "layerKey": {"layer": 1, "how": "hold"}}],
}


def set_of(*entries, **lesson):
    """ A lesson set with one lesson whose new entries are given (refit reads nothing else of it; its one exercise
    drills those characters, so that the checker has nothing against it but its size) """
    return {"format": "vial-web-lessons/1", "id": "fit", "title": "Fit", "language": "en",
            "layout": {"name": "Old", "uid": "0000000000000001", "hash": "sha256:0123456789abcdef"},
            "lessons": [{"id": "01", "title": "One", "guidance": "Go.", "new": list(entries), **lesson,
                         "exercises": [{"id": "01-n1", "kind": "new-keys", "title": "New",
                                        "lines": ["".join(e["char"] for e in entries) or "x"]}]}]}


def entry(char, key, layer=0, via="tap", **more):
    return {"char": char, "key": key, "layer": layer, "via": via, **more}


def test_refit_chooses_the_old_key_then_the_old_layer_then_the_first_candidate():
    data = set_of(
        entry("a", "r0c0"),                                     # still there: unchanged
        entry("a", "r0c1", 1, "shift", path="hold Space"),      # still there too, though a is cheaper on r0c0
        entry("1", "r0c0"),                                     # the same key, now on layer 1: the path appears
        entry("b", "r0c2", 0, path="old"),                      # the same key on layer 1 beats another key on layer 0
        entry("b", "r0c0", 0, path="old"),                      # not on r0c0 any more: another key on the old layer
        entry("c", "r0c1", 1, path="hold Space"),               # neither: the first candidate, on layer 0 (no path)
        entry("x", "r0c0", 0, path="old"),                      # only on layer 2, which nothing reaches: no path
        entry("2", "r9c9", 7, "altGr", note="kept as it is"),   # a key and a layer that never existed
    )
    before = json.loads(json.dumps(data))
    fitted, problems = learning_layout.refit(data, FIT_EXPORT)
    assert problems == []
    assert data == before  # a new document; the input is left alone
    assert fitted["lessons"][0]["new"] == [
        entry("a", "r0c0"),
        entry("a", "r0c1", 1, "shift", path="hold Space"),
        entry("1", "r0c0", 1, path="hold Space"),
        entry("b", "r0c2", 1, path="hold Space"),
        entry("b", "r0c1"),
        entry("c", "r0c2"),
        entry("x", "r0c2", 2),
        entry("2", "r0c1", 1, path="hold Space", note="kept as it is"),
    ]
    assert fitted["layout"] == {"name": "Fit", "uid": "0000000000000002", "hash": "sha256:fedcba9876543210"}
    # the rest of the set is as it was
    assert {k: v for k, v in fitted.items() if k not in ("layout", "lessons")} == \
        {k: v for k, v in before.items() if k not in ("layout", "lessons")}
    assert fitted["lessons"][0]["exercises"] == before["lessons"][0]["exercises"]
    # the choice is settled: fitting again changes nothing
    assert learning_layout.refit(fitted, FIT_EXPORT) == (fitted, [])


def test_refit_lists_every_character_no_key_types_and_fits_the_rest():
    data = set_of(entry("a", "r0c0"), entry("z", "r0c0"), entry("1", "r0c0"), entry("Q", "r0c1", 0, "shift"))
    data["lessons"].append({**data["lessons"][0], "id": "02", "new": [entry("b", "r0c1"), entry(";", "r0c0", 1)]})
    fitted, problems = learning_layout.refit(data, FIT_EXPORT)
    assert problems == ["lesson 01/new[1]: 'z' is typed by no key of this keyboard",
                        "lesson 01/new[3]: 'Q' is typed by no key of this keyboard",
                        "lesson 02/new[1]: ';' is typed by no key of this keyboard"]
    assert fitted["lessons"][0]["new"][2] == entry("1", "r0c0", 1, path="hold Space")  # the others were fitted
    assert fitted["lessons"][0]["new"][1] == entry("z", "r0c0")  # a lost one is left as it was
    # a review lesson with no new entries, or none at all, is fine
    assert learning_layout.refit(set_of(review=True), FIT_EXPORT)[1] == []
    without = set_of()
    del without["lessons"][0]["new"]
    assert learning_layout.refit(without, FIT_EXPORT) == ({**without, "layout": FIT_EXPORT["keyboard"] | {
        "hash": FIT_EXPORT["hash"]}}, [])


def swap_layers(export, a, b):
    """ The export with what layers a and b hold exchanged (the keys that reach each stay), under another hash """
    out = json.loads(json.dumps(export))
    for key in out["keys"]:
        chars = key["chars"]
        chars[a], chars[b] = chars.pop(b, None), chars.pop(a, None)
        key["chars"] = {l: c for l, c in chars.items() if c is not None}
    names = {l["index"]: l["name"] for l in out["layers"]}
    for layer in out["layers"]:
        layer["name"] = names.get({int(a): int(b), int(b): int(a)}.get(layer["index"], layer["index"]), layer["name"])
    out["hash"] = "sha256:" + "".join(reversed(out["hash"][len("sha256:"):]))
    return out


def test_refit_follows_two_layers_that_changed_places(corne_model):
    """ The symbols of layer 1 (held Space) and the digits of layer 3 (one-shot) exchange layers: every entry follows
    its character, and the path labels follow the layers """
    export = learning_layout.export(corne_model)
    swapped = swap_layers(export, "1", "3")
    assert swapped["hash"] != export["hash"]
    keys = {k["id"]: k for k in swapped["keys"]}
    assert keys["r1c4"]["chars"]["1"] == {"tap": "4", "shift": "$"} and keys["r1c4"]["chars"]["3"] == {"tap": ")"}
    data = set_of(entry("s", "r1c1"), entry("S", "r1c1", 0, "shift"),
                  entry(")", "r1c4", 1, path="hold Space"), entry("(", "r1c3", 1, path="hold Space"),
                  entry("4", "r1c4", 3, path="tap OSL 3"), entry("$", "r1c4", 3, "shift", path="tap OSL 3"),
                  entry("x", "r6c3", 1, path="hold Space"))
    data["layout"] = {"name": export["keyboard"]["name"], "uid": export["keyboard"]["uid"], "hash": export["hash"]}
    fitted, problems = learning_layout.refit(data, swapped)
    assert problems == []
    assert fitted["lessons"][0]["new"] == [
        entry("s", "r1c1"), entry("S", "r1c1", 0, "shift"),
        entry(")", "r1c4", 3, path="tap OSL 3"), entry("(", "r1c3", 3, path="tap OSL 3"),
        entry("4", "r1c4", 1, path="hold Space"),
        entry("$", "r1c4", 1, "shift", path="hold Space"),  # the same key, not r0c4 which now types $ on layer 3
        entry("x", "r6c3"),  # x stays on r6c3 (layers 0 and 3 now): the same key on its lowest layer, no path
    ]
    assert fitted["layout"]["hash"] == swapped["hash"]
    # every entry points at a key that types its character: the checker agrees
    assert learning_check.check_set(fitted, swapped)[0] == []
    assert learning_check.check_set(data, swapped)[0] != []
