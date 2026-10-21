# SPDX-License-Identifier: GPL-2.0-or-later
""" Moving layers to other positions, every reference to a layer following it. Pure functions over a KeyboardState:
no I/O (server.arranger reads the keyboard into one and writes one back).

An order lists, for each new position, the layer that goes there: order[new position] = old layer. [0, 3, 1, 2] puts
layer 3 at position 1, and layers 1 and 2 after it. Layer 0 never moves: the keyboard starts on it.
"""
import dataclasses
from typing import Optional

from server.describe import TRI_LAYER, reference_range

KO_LAYER_BITS = 16
""" a key override's "active on layers" is 16 bits, one per layer 0 to 15 (vial-qmk vial.h, vial_key_override_entry_t's
uint16_t layers) """
TRI_LAYERS = (1, 2, TRI_LAYER)
""" the layers FN_MO13 and FN_MO23 use, by number """
PLACES = ("keymap", "encoders", "tapDance", "combos", "keyOverrides", "altRepeatKeys", "macros")
""" where keycodes are, in the order they are written """


@dataclasses.dataclass(frozen=True)
class KeyboardState:
    """ Everything of a keyboard that holds layer numbers, keycodes as firmware integers.

    keys: {(layer, row, col): keycode}; encoders: {(layer, encoder, direction): keycode}
    tap_dance: (tap, hold, double tap, tap-hold, tapping term) each
    combos: (key 1, key 2, key 3, key 4, output) each
    key_overrides: (trigger, replacement, layers, trigger mods, negative mod mask, suppressed mods, options) each
    alt_repeat_keys: (keycode, alt keycode, allowed mods, options) each
    macros: each macro's steps: ("text", str), ("delay", ms) or ("tap" | "down" | "up", (keycode, ...))
    """
    layers: int
    keys: dict
    encoders: dict
    tap_dance: tuple = ()
    combos: tuple = ()
    key_overrides: tuple = ()
    alt_repeat_keys: tuple = ()
    macros: tuple = ()


@dataclasses.dataclass(frozen=True)
class Problem:
    """ Why an order can't be written: a layer number that doesn't fit where it must go """
    place: str
    """ one of PLACES """
    where: str
    """ "layer 2, row 0, column 4", "tap dance 3, hold", "key override 1" """
    text: str


@dataclasses.dataclass(frozen=True)
class Arrangement:
    """ What an order does to a keyboard """
    target: KeyboardState
    moves: tuple
    """ (old position, new position) of each layer that moves """
    keys: int
    """ keymap positions and encoder directions that change """
    references: dict
    """ by place (PLACES): the keycodes whose layer number changes """
    key_overrides: int
    """ key overrides whose "active on layers" changes """
    tri_layer: Optional[tuple]
    """ a tri-layer key is set and layers 1-3 change: the old layers at positions 1, 2 and 3 after the order (they were
    1, 2 and 3); None otherwise """
    problems: tuple


class DoesNotFit(ValueError):
    """ A layer number that doesn't fit the field of the keycode that must hold it """


class BadOrder(ValueError):
    """ An order that isn't one of the keyboard's layers """


def check_order(order, layers):
    """ ValueError unless order holds every layer 0 to layers - 1 once, layer 0 first """
    order = list(order)
    if len(order) != layers or sorted(order) != list(range(layers)):
        raise BadOrder("the order must list each of the {} layers (0 to {}) once".format(layers, layers - 1))
    if order[0] != 0:
        raise BadOrder("layer 0 stays first: the keyboard starts on it")
    return order


def mapping_of(order):
    """ order -> {old layer: new position} """
    return {old: new for new, old in enumerate(order)}


def reverse(order):
    """ The order that puts layers back where they were before `order` """
    back = [0] * len(order)
    for new, old in enumerate(order):
        back[old] = new
    return back


def renumber(code, mapping, protocol):
    """ The keycode with its layer number moved through mapping ({old layer: new layer}), or the same keycode when it
    holds no layer number of its own (FN_MO13 and FN_MO23 use fixed layers) or one mapping doesn't have (a layer the
    keyboard doesn't have). DoesNotFit when the new number doesn't fit the keycode's field (LT and LM hold layers 0 to
    15). protocol: 5 or 6. """
    ref = reference_range(code, protocol)
    if ref is None or ref.what != "layer" or ref.fixed is not None:
        return code
    layer = ref.number(code)
    if layer not in mapping:
        return code
    new = mapping[layer]
    if new > ref.largest:
        raise DoesNotFit("{} keys hold layers 0 to {}: layer {} can't go to position {}".format(
            ref.names, ref.largest, layer, new))
    return ref.with_number(code, new)


def is_tri_layer_key(code, protocol):
    ref = reference_range(code, protocol)
    return ref is not None and ref.what == "layer" and ref.fixed is not None


def move_mask(mask, mapping):
    """ A key override's layer mask with each layer's bit at its new position; bits of layers mapping doesn't have stay.
    DoesNotFit when a layer in it would go past bit 15. """
    out = 0
    for bit in range(KO_LAYER_BITS):
        if not mask & (1 << bit):
            continue
        new = mapping.get(bit, bit)
        if new >= KO_LAYER_BITS:
            raise DoesNotFit("a key override's layers are 0 to {}: layer {} can't go to position {}".format(
                KO_LAYER_BITS - 1, bit, new))
        out |= 1 << new
    return out


class _Renumbering:
    """ Renumbers keycodes, counting by place those that change and keeping the problems met """

    def __init__(self, mapping, protocol):
        self.mapping = mapping
        self.protocol = protocol
        self.counts = {place: 0 for place in PLACES}
        self.problems = []
        self.tri_layer = False

    def code(self, value, place, where):
        if is_tri_layer_key(value, self.protocol):
            self.tri_layer = True
        try:
            new = renumber(value, self.mapping, self.protocol)
        except DoesNotFit as e:
            self.problems.append(Problem(place, where, str(e)))
            return value
        if new != value:
            self.counts[place] += 1
        return new


TAP_DANCE_SLOTS = ("tap", "hold", "double tap", "tap-hold")
COMBO_SLOTS = ("key 1", "key 2", "key 3", "key 4", "output")


def _set(key_override):
    """ A key override that is set: an empty one (no trigger, no replacement) does nothing, and keeps its mask """
    return key_override[0] != 0 or key_override[1] != 0


def arrange(state, order, protocol):
    """ The keyboard after moving its layers to `order` (see the module), every layer reference following, as an
    Arrangement. BadOrder for an order that isn't the keyboard's layers with layer 0 first. protocol: 5 or 6. """
    order = check_order(order, state.layers)
    mapping = mapping_of(order)
    r = _Renumbering(mapping, protocol)

    keys = {}
    for (layer, row, col), value in state.keys.items():
        keys[(mapping[layer], row, col)] = r.code(value, "keymap", "layer {}, row {}, column {}".format(layer, row, col))
    encoders = {}
    for (layer, index, direction), value in state.encoders.items():
        encoders[(mapping[layer], index, direction)] = r.code(
            value, "encoders", "layer {}, encoder {}, direction {}".format(layer, index, direction))

    tap_dance = tuple(
        tuple(r.code(v, "tapDance", "tap dance {}, {}".format(i, TAP_DANCE_SLOTS[n])) for n, v in enumerate(e[:4]))
        + (e[4],) for i, e in enumerate(state.tap_dance))
    combos = tuple(tuple(r.code(v, "combos", "combo {}, {}".format(i, COMBO_SLOTS[n])) for n, v in enumerate(e))
                   for i, e in enumerate(state.combos))

    key_overrides = []
    masks_moved = 0
    for i, e in enumerate(state.key_overrides):
        where = "key override {}".format(i)
        trigger = r.code(e[0], "keyOverrides", where)
        replacement = r.code(e[1], "keyOverrides", where)
        mask = e[2]
        if _set(e):
            try:
                mask = move_mask(e[2], mapping)
            except DoesNotFit as problem:
                r.problems.append(Problem("keyOverrides", where, str(problem)))
        masks_moved += mask != e[2]
        key_overrides.append((trigger, replacement, mask) + tuple(e[3:]))

    alt_repeat_keys = tuple(
        (r.code(e[0], "altRepeatKeys", "alt-repeat key {}".format(i)),
         r.code(e[1], "altRepeatKeys", "alt-repeat key {}".format(i))) + tuple(e[2:])
        for i, e in enumerate(state.alt_repeat_keys))

    macros = tuple(
        tuple(step if step[0] not in ("tap", "down", "up") else
              (step[0], tuple(r.code(v, "macros", "macro {}, step {}".format(i, s)) for v in step[1]))
              for s, step in enumerate(steps))
        for i, steps in enumerate(state.macros))

    target = KeyboardState(state.layers, keys, encoders, tap_dance, combos, tuple(key_overrides), alt_repeat_keys,
                           macros)
    tri_moves = any(len(order) > n and order[n] != n for n in TRI_LAYERS)
    tri_layer = tuple(order[n] if n < len(order) else None for n in TRI_LAYERS) if r.tri_layer and tri_moves else None
    return Arrangement(
        target=target,
        moves=tuple((old, new) for new, old in enumerate(order) if old != new),
        keys=sum(keys.get(pos) != value for pos, value in state.keys.items())
        + sum(encoders.get(pos) != value for pos, value in state.encoders.items()),
        references=r.counts,
        key_overrides=masks_moved,
        tri_layer=tri_layer,
        problems=tuple(r.problems),
    )
