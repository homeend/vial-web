""" server.layers: renumbering layer keycodes on both protocols, and arranging a whole keyboard state """
import random

import pytest

from server.layers import BadOrder, DoesNotFit, KeyboardState, arrange, check_order, move_mask, renumber, reverse
from server.names import NamesStore

# protocol 6 (vial-qmk quantum/keycodes.h, quantum_keycodes.h)
V6 = {
    "LT": lambda layer, kc=0x2C: 0x4000 | (layer << 8) | kc,
    "LM": lambda layer, mods=0x02: 0x5000 | (layer << 5) | mods,
    "TO": lambda layer: 0x5200 | layer,
    "MO": lambda layer: 0x5220 | layer,
    "DF": lambda layer: 0x5240 | layer,
    "TG": lambda layer: 0x5260 | layer,
    "OSL": lambda layer: 0x5280 | layer,
    "TT": lambda layer: 0x52C0 | layer,
    "PDF": lambda layer: 0x52E0 | layer,
}
# protocol 5 (vial-qmk before QMK's keycode change: quantum_keycodes.h; TO has ON_PRESS in bit 4)
V5 = {
    "LT": lambda layer, kc=0x2C: 0x4000 | (layer << 8) | kc,
    "LM": lambda layer, mods=0x02: 0x5900 | (layer << 4) | mods,
    "TO": lambda layer: 0x5010 | layer,
    "MO": lambda layer: 0x5100 | layer,
    "DF": lambda layer: 0x5200 | layer,
    "TG": lambda layer: 0x5300 | layer,
    "OSL": lambda layer: 0x5400 | layer,
    "TT": lambda layer: 0x5800 | layer,
}
TABLES = {6: V6, 5: V5}
LARGEST = {6: {"LT": 15, "LM": 15}, 5: {"LT": 15, "LM": 15, "TO": 15}}
FN_MO = {6: (0x7C77, 0x7C78), 5: (0x5F10, 0x5F11)}

FAMILIES = [(protocol, name) for protocol, table in TABLES.items() for name in table]


def largest(protocol, name):
    return LARGEST[protocol].get(name, 31)


@pytest.mark.parametrize("protocol,name", FAMILIES)
def test_each_family_follows_its_layer(protocol, name):
    make = TABLES[protocol][name]
    assert renumber(make(1), {1: 2, 2: 1}, protocol) == make(2)
    assert renumber(make(2), {1: 2, 2: 1}, protocol) == make(1)


@pytest.mark.parametrize("protocol,name", FAMILIES)
def test_each_family_at_its_edge(protocol, name):
    make = TABLES[protocol][name]
    top = largest(protocol, name)
    assert renumber(make(top), {top: 1, 1: top}, protocol) == make(1)
    assert renumber(make(1), {top: 1, 1: top}, protocol) == make(top)


@pytest.mark.parametrize("protocol,name", FAMILIES)
def test_a_number_past_the_field_is_a_problem(protocol, name):
    make = TABLES[protocol][name]
    top = largest(protocol, name)
    if top >= 31:  # MO and the others hold any layer a keyboard can have (32 at most)
        return
    with pytest.raises(DoesNotFit, match="keys hold layers 0 to {}".format(top)):
        renumber(make(2), {2: top + 1}, protocol)


@pytest.mark.parametrize("protocol", [5, 6])
def test_the_rest_of_the_keycode_stays(protocol):
    table = TABLES[protocol]
    assert renumber(table["LT"](1, 0x04), {1: 3}, protocol) == table["LT"](3, 0x04)
    assert renumber(table["LM"](1, 0x05), {1: 3}, protocol) == table["LM"](3, 0x05)


def test_protocol_5_to_keeps_when_it_acts():
    # bits 4-5 of protocol 5's TO held ON_PRESS (when it acts) in older builds, and vial-gui still writes them: kept
    assert renumber(0x5021, {1: 2}, 5) == 0x5022


@pytest.mark.parametrize("protocol", [5, 6])
def test_tri_layer_keys_are_not_renumbered(protocol):
    for code in FN_MO[protocol]:
        assert renumber(code, {1: 3, 2: 1, 3: 2}, protocol) == code


@pytest.mark.parametrize("protocol,code", [
    (6, 0x3FFF), (6, 0x52A0), (6, 0x52BF), (6, 0x5300), (6, 0x7C76), (6, 0x7C79), (6, 0x5700), (6, 0x0004),
    (5, 0x5500), (5, 0x56FF), (5, 0x5A00), (5, 0x5F0F), (5, 0x5F12), (5, 0x5700),
])
def test_keycodes_next_to_the_ranges_are_unchanged(protocol, code):
    assert renumber(code, {n: 31 - n for n in range(32)}, protocol) == code


def test_a_layer_the_mapping_does_not_have_stays():
    assert renumber(V6["MO"](9), {0: 0, 1: 2, 2: 1}, 6) == V6["MO"](9)


# ---------- orders ----------

@pytest.mark.parametrize("order", [[0, 1, 1, 2], [0, 1, 2], [0, 1, 2, 4], [1, 0, 2, 3], [0, 1, 2, 3, 4]])
def test_bad_orders_are_refused(order):
    with pytest.raises(BadOrder):
        check_order(order, 4)


def test_reverse_puts_layers_back():
    order = [0, 3, 1, 2]
    back = reverse(order)
    assert back == [0, 2, 3, 1]
    assert [order[i] for i in back] == [0, 1, 2, 3]


def test_move_mask():
    assert move_mask(0b0110, {0: 0, 1: 2, 2: 1}) == 0b0110
    assert move_mask(0b0010, {0: 0, 1: 3, 2: 1, 3: 2}) == 0b1000
    assert move_mask(0xFFF0, {0: 0, 1: 1, 2: 2, 3: 3}) == 0xFFF0
    with pytest.raises(DoesNotFit):
        move_mask(0b0100, {2: 16})


# ---------- arranging a state ----------

def state(**fields):
    base = dict(layers=4, keys={}, encoders={}, tap_dance=(), combos=(), key_overrides=(), alt_repeat_keys=(),
                macros=())
    base.update(fields)
    return KeyboardState(**base)


def test_keymap_and_encoders_move_and_renumber():
    s = state(keys={(0, 0, 0): V6["MO"](3), (1, 0, 0): 0x04, (2, 0, 0): 0x05, (3, 0, 0): V6["TO"](0)},
              encoders={(0, 0, 0): V6["TG"](1), (3, 0, 1): 0x06, (1, 0, 0): 0, (2, 0, 0): 0, (0, 0, 1): 0,
                        (1, 0, 1): 0, (2, 0, 1): 0, (3, 0, 0): 0})
    result = arrange(s, [0, 3, 1, 2], 6)
    t = result.target
    assert t.keys == {(0, 0, 0): V6["MO"](1), (1, 0, 0): V6["TO"](0), (2, 0, 0): 0x04, (3, 0, 0): 0x05}
    assert t.encoders[(0, 0, 0)] == V6["TG"](2)
    assert t.encoders[(1, 0, 1)] == 0x06
    assert result.moves == ((3, 1), (1, 2), (2, 3))
    assert result.references["keymap"] == 1 and result.references["encoders"] == 1
    assert result.keys == 4 + 3  # four keys and three encoder directions hold something else
    assert result.problems == ()


def test_every_place_with_layer_numbers():
    s = state(
        keys={(0, 0, 0): 0x04},
        tap_dance=((V6["MO"](1), V6["LT"](2, 0x04), 0x05, V6["OSL"](3), 200),),
        combos=((0x04, V6["TT"](1), 0, 0, V6["DF"](2)),),
        key_overrides=((V6["MO"](1), V6["TG"](3), 0b0110, 0, 0, 0, 0x87),),
        alt_repeat_keys=((V6["LM"](1), V6["PDF"](2), 0, 0x08),),
        macros=((("text", "hi"), ("tap", (0x04, V6["MO"](3))), ("delay", 50)), ()),
    )
    result = arrange(s, [0, 2, 3, 1], 6)  # 2 -> 1, 3 -> 2, 1 -> 3
    t = result.target
    assert t.tap_dance == ((V6["MO"](3), V6["LT"](1, 0x04), 0x05, V6["OSL"](2), 200),)
    assert t.combos == ((0x04, V6["TT"](3), 0, 0, V6["DF"](1)),)
    assert t.key_overrides == ((V6["MO"](3), V6["TG"](2), 0b1010, 0, 0, 0, 0x87),)
    assert t.alt_repeat_keys == ((V6["LM"](3), V6["PDF"](1), 0, 0x08),)
    assert t.macros == ((("text", "hi"), ("tap", (0x04, V6["MO"](2))), ("delay", 50)), ())
    assert result.references == {"keymap": 0, "encoders": 0, "tapDance": 3, "combos": 2, "keyOverrides": 2,
                                 "altRepeatKeys": 2, "macros": 1}
    assert result.key_overrides == 1


def test_an_empty_key_override_keeps_its_mask():
    s = state(key_overrides=((0, 0, 0xFFFF, 0, 0, 0, 0x07),))
    assert arrange(s, [0, 2, 1, 3], 6).target.key_overrides == s.key_overrides


def test_an_enabled_key_override_with_no_trigger_and_no_replacement_still_acts_and_its_mask_moves():
    # the firmware activates an enabled entry with trigger KC_NO whenever its trigger modifiers are held
    s = state(key_overrides=((0, 0, 0b0110, 0x02, 0, 0, 0x87),))
    assert arrange(s, [0, 2, 3, 1], 6).target.key_overrides == ((0, 0, 0b1010, 0x02, 0, 0, 0x87),)
    s = state(layers=20, key_overrides=((0, 0, 1 << 3, 0x02, 0, 0, 0x87),))
    result = arrange(s, [0, 1] + list(range(4, 20)) + [2, 3], 6)
    assert [(p.place, p.where) for p in result.problems] == [("keyOverrides", "key override 0")]


def test_tri_layer_warning():
    s = state(keys={(0, 0, 0): FN_MO[6][0]})
    assert arrange(s, [0, 3, 1, 2], 6).tri_layer == (3, 1, 2)
    assert arrange(s, [0, 1, 2, 3], 6).tri_layer is None
    # anywhere: a tap dance has it
    s = state(tap_dance=((FN_MO[6][1], 0, 0, 0, 200),))
    assert arrange(s, [0, 2, 1, 3], 6).tri_layer == (2, 1, 3)
    # no tri-layer key: nothing to say
    assert arrange(state(), [0, 2, 1, 3], 6).tri_layer is None
    # layers 1 to 3 stay: nothing to say
    s = state(layers=6, keys={(0, 0, 0): FN_MO[6][0]})
    assert arrange(s, [0, 1, 2, 3, 5, 4], 6).tri_layer is None


def test_problems_block_and_say_where():
    s = state(layers=20, keys={(2, 0, 4): V6["LT"](2)}, key_overrides=((0x04, 0x05, 1 << 3, 0, 0, 0, 0x87),))
    order = [0, 1] + list(range(4, 20)) + [2, 3]  # layers 2 and 3 go to positions 18 and 19
    result = arrange(s, order, 6)
    places = {(p.place, p.where) for p in result.problems}
    assert places == {("keymap", "layer 2, row 0, column 4"), ("keyOverrides", "key override 0")}
    assert all("can't go to position" in p.text for p in result.problems)


def test_nothing_to_change():
    s = state(keys={(1, 0, 0): V6["MO"](2)})
    result = arrange(s, [0, 1, 2, 3], 6)
    assert result.moves == () and result.keys == 0 and result.target == s


# ---------- round trips ----------

def random_code(rng, layers, protocol):
    table = TABLES[protocol]
    kind = rng.randrange(6)
    if kind == 0:
        return rng.randrange(0x00, 0xFF)
    if kind == 1:
        return FN_MO[protocol][rng.randrange(2)]
    name = rng.choice(sorted(table))
    top = min(layers - 1, largest(protocol, name))
    layer = rng.randrange(top + 1)
    if protocol == 5 and name == "TO":
        return 0x5000 | (rng.randrange(4) << 4) | layer  # bits 4-5 are not the layer
    return table[name](layer)


def random_state(rng, protocol):
    layers = rng.randrange(17, 21) if rng.randrange(4) == 0 else rng.randrange(3, 13)
    code = lambda: random_code(rng, layers, protocol)  # noqa: E731
    keys = {(layer, row, col): code() for layer in range(layers) for row in range(2) for col in range(3)}
    encoders = {(layer, 0, d): code() for layer in range(layers) for d in range(2)}
    return KeyboardState(
        layers=layers, keys=keys, encoders=encoders,
        tap_dance=tuple((code(), code(), code(), code(), rng.randrange(500)) for _ in range(3)),
        combos=tuple(tuple(code() for _ in range(5)) for _ in range(3)),
        key_overrides=tuple((code(), code(), rng.randrange(1 << 16), 2, 0, 2, 0x87) for _ in range(3))
        + ((0, 0, rng.randrange(1 << 16), 2, 0, 0, 0x87), (0, 0, 0xFFFF, 0, 0, 0, 0x07)),
        alt_repeat_keys=tuple((code(), code(), 0, 8) for _ in range(2)),
        macros=tuple((("text", "x"), ("tap", (code(), code())), ("down", (code(),))) for _ in range(2)),
    )


@pytest.mark.parametrize("protocol", [5, 6])
def test_arranging_then_the_reverse_order_gives_the_start_back(protocol, tmp_path):
    rng = random.Random(8)
    names = NamesStore(str(tmp_path / "names.json"))
    for attempt in range(150):
        s = random_state(rng, protocol)
        # layers 0 to 15 stay among themselves when there are more: the 4-bit fields and the 16-bit mask can't go further
        low = min(s.layers, 16)
        order = [0] + rng.sample(range(1, low), low - 1) + rng.sample(range(low, s.layers), s.layers - low)
        uid = "K{}".format(attempt)
        for layer in rng.sample(range(s.layers), rng.randrange(s.layers)):
            names.set(uid, "layers", layer, "name {}".format(layer))
        named = names.get(uid)
        there = arrange(s, order, protocol)
        assert there.problems == ()
        names.move_layers(uid, order)
        back = arrange(there.target, reverse(order), protocol)
        assert back.problems == ()
        assert back.target == s, (order, attempt)
        names.move_layers(uid, reverse(order))
        assert names.get(uid) == named


def test_describes_ranges_come_from_the_one_definition():
    # describe.py's LM range and tri-layer keys are derived from REFERENCES: the firmware's values
    from server.describe import QK_LAYER_MOD, TRI_LAYER_KEYS
    assert QK_LAYER_MOD == {6: (0x5000, 0x51FF), 5: (0x5900, 0x59FF)}
    assert TRI_LAYER_KEYS == {6: {0x7C77: 1, 0x7C78: 2}, 5: {0x5F10: 1, 0x5F11: 2}}
