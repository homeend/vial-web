""" The finger proposal and the layout export (server.learning_layout), on the simulated Corne, an ANSI 60 % and a
4x10 ortho: pure functions over the keyboard model as a dict """
import json
import os

import pytest

from server import learning_layout, model
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
    # 7 index, 8 middle, 9 ring, 0 - pinky)
    assert by_tap["KC_1"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_2"]["finger"] == "ring" and by_tap["KC_3"]["finger"] == "middle"
    assert by_tap["KC_4"] == {"hand": "left", "finger": "index", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_5"]["finger"] == "index" and by_tap["KC_6"]["finger"] == "index"
    assert by_tap["KC_6"]["hand"] == "left" and by_tap["KC_7"]["hand"] == "right"
    assert by_tap["KC_7"]["finger"] == "index"
    assert by_tap["KC_8"] == {"hand": "right", "finger": "middle", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_9"]["finger"] == "ring"
    assert by_tap["KC_0"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_MINUS"]["finger"] == "pinky" and by_tap["KC_EQUAL"]["reach"] == "outer"
    assert by_tap["KC_GRAVE"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "outer", "home": False}
    assert by_tap["KC_BSPACE"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "outer", "home": False}


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
