# SPDX-License-Identifier: GPL-2.0-or-later
""" Turns a keycode into what the UI shows: its legend (what the key cap says), tap and hold labels, a kind, the
layer, tap dance or macro it refers to, and a description.

All keycode knowledge comes from keycodes/ (and the keyboard languages of keymap/); this module only interprets it.
"""
import contextlib
import contextvars
import re

from keycodes.keycodes import Keycode, RAWCODES_MAP, KEYCODES_MEDIA, KEYCODES_BACKLIGHT

LAYER_ACTIONS = {
    "MO": "while held", "TG": "toggle", "TO": "switch to", "TT": "hold, or tap to toggle",
    "OSL": "one-shot", "DF": "default", "PDF": "default (saved)",
}
MODIFIER_KEYS = {"KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"}
MOUSE_PREFIXES = ("KC_MS_", "KC_BTN", "KC_WH_", "KC_ACL")

RE_TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
RE_MACRO = re.compile(r"^M(\d+)$")
RE_LAYER = re.compile(r"^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$")
RE_LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")
RE_NUMBERED = re.compile(r"^(M\d+|(TD|MO|TG|TO|TT|OSL|DF|PDF)\(\d+\))$")
RE_LEGEND_GAP = re.compile(r"\s{2,}")
MEDIA_CODES = frozenset(k.qmk_id for k in KEYCODES_MEDIA)
LIGHTING_CODES = frozenset(k.qmk_id for k in KEYCODES_BACKLIGHT)

# QMK's 5-bit modifier sets: Ctrl, Shift, Alt, Gui, and a bit saying they are the right-hand ones
MOD_CTRL, MOD_SHIFT, MOD_ALT, MOD_GUI, MOD_RIGHT = 0x01, 0x02, 0x04, 0x08, 0x10
MOD_BITS = [(MOD_CTRL, "Ctrl"), (MOD_SHIFT, "Shift"), (MOD_ALT, "Alt"), (MOD_GUI, "Gui")]
QK_MODS = (0x0100, 0x1FFF)
""" a key with modifiers held, e.g. LCTL(KC_C): modifiers in bits 8-12, the key in bits 0-7 (both protocols) """
QK_MOD_TAP = {6: (0x2000, 0x3FFF), 5: (0x6000, 0x7FFF)}
""" mod-tap: modifiers on hold in bits 8-12, the tapped key in bits 0-7 """
QK_ONE_SHOT_MOD = {6: (0x52A0, 0x52BF), 5: (0x5500, 0x55FF)}
""" one-shot modifiers: modifiers in bits 0-4 """

_overrides = contextvars.ContextVar("keyboard_language_overrides", default={})
""" The keyboard language's labels, {qmk_id: Vial label}, for describe() calls in this context """


@contextlib.contextmanager
def keyboard_language(overrides):
    """ Within the block, describe() labels keys as the computer's keyboard language types them, e.g. with Polish,
    KC_A has the AltGr character "ą". overrides: {qmk_id: Vial label}, from server.languages.overrides(). """
    token = _overrides.set(overrides)
    try:
        yield
    finally:
        _overrides.reset(token)


def _legend(main, shifted=None, alt_gr=None):
    return {"main": main, "shifted": shifted, "altGr": alt_gr}


def _join_words(lines):
    """ ["Caps", "Lock"] -> "Caps Lock"; ["Boot-", "loader"] -> "Bootloader" """
    text = ""
    for line in lines:
        if text.endswith("-") and len(text) > 1:
            text = text[:-1] + line
        else:
            text = "{} {}".format(text, line) if text else line
    return text


def legend_of(label):
    """ A Vial label -> legend {main, shifted, altGr}, all on one line.

    Vial's labels are laid out for its Qt key widgets, in two columns. The left column holds the key's characters:
    a single character over another line is shifted over unshifted ("!" over "1", "~" over "Esc"); anything else is
    one label broken into lines ("Caps" over "Lock"). A keyboard language's label may have a right column, after two or more spaces (or alone on
    an indented line): the AltGr characters, the lower one typed with AltGr alone. """
    left, right = [], []
    for line in label.split("\n"):
        if line.startswith("  "):
            first, second = "", line.strip()
        else:
            parts = RE_LEGEND_GAP.split(line.strip(), maxsplit=1)
            first, second = parts[0], parts[1] if len(parts) > 1 else ""
        left.append(first)
        right.append(second)
    alt_gr = right[-1] or None
    chars = [c for c in left if c]
    if len(left) == 2 and len(chars) == 2 and len(chars[0]) == 1:
        return _legend(chars[1], chars[0], alt_gr)
    return _legend(_join_words(chars), None, alt_gr)


def _keycode_legend(code):
    """ Legend of a keycode (of its outer keycode, if it wraps another one) in the keyboard language """
    keycode = Keycode.find_outer_keycode(code)
    overrides = _overrides.get()
    if keycode is not None and keycode.qmk_id in overrides:
        return legend_of(overrides[keycode.qmk_id])
    return legend_of(Keycode.label(code))


def mods_name(bits):
    """ QMK's 5 modifier bits -> "Ctrl+Shift", "RCtrl+AltGr", "Meh", "Hyper" """
    if bits == MOD_CTRL | MOD_SHIFT | MOD_ALT | MOD_GUI:
        return "Hyper"
    if bits == MOD_CTRL | MOD_SHIFT | MOD_ALT:
        return "Meh"
    right = bits & MOD_RIGHT
    names = [(("AltGr" if name == "Alt" else "R" + name) if right else name)
             for bit, name in MOD_BITS if bits & bit]
    return "+".join(names)


def _in(value, ranges):
    first, last = ranges[Keycode.protocol] if isinstance(ranges, dict) else ranges
    return first <= value <= last


def _description(code):
    keycode = Keycode.find_outer_keycode(code)
    return keycode.tooltip if keycode is not None and keycode.tooltip else None


def _result(code, kind, legend, tap=None, hold=None, layer=None, layer_action=None, index=None):
    return {"code": code, "kind": kind, "tap": legend["main"] if tap is None else tap, "legend": legend,
            "hold": hold, "layer": layer, "layerAction": layer_action, "index": index,
            "description": _description(code)}


def one_line(label):
    """ "!\\n1" (shifted over unshifted) -> "1"; "Caps\\nLock" -> "Caps Lock" """
    lines = [line.strip() for line in label.split("\n") if line.strip()]
    if len(lines) == 2 and all(len(line) == 1 for line in lines):
        return lines[-1]
    return " ".join(lines)


def _with_mods(code, bits, inner_code):
    """ A key with modifiers held, e.g. LCTL(KC_C) """
    inner = _keycode_legend(inner_code)
    if Keycode.find_outer_keycode(inner_code) is not None and Keycode.find_outer_keycode(inner_code).qmk_id \
            in _overrides.get():
        # what the keyboard language types: Shift+7 is "/" in German, AltGr+A is "ą" in Polish
        if bits & ~MOD_RIGHT == MOD_SHIFT and inner["shifted"]:
            return _result(code, "basic", _legend(inner["shifted"]))
        if bits == MOD_RIGHT | MOD_ALT and inner["altGr"]:
            return _result(code, "basic", _legend(inner["altGr"]))
    else:
        # shifted symbols have keycodes of their own, e.g. LSFT(KC_1) is KC_EXLM, "!"
        direct = RAWCODES_MAP.get(Keycode.deserialize(code))
        if direct is not None and not direct.masked:
            return _result(code, "basic", legend_of(direct.label))
    if not inner["main"]:  # e.g. LCTL(KC_NO): just the modifiers
        return _result(code, "modifier", _legend(mods_name(bits)))
    return _result(code, "basic", _legend("{}+{}".format(mods_name(bits), inner["main"])))


def describe(code):
    """ Keycode string (as the protocol layer stores it) -> description dict for the UI """
    code = Keycode.normalize(code)
    value = Keycode.deserialize(code)

    if code == "KC_NO":
        return _result(code, "none", _legend(""))
    if code == "KC_TRNS":
        return _result(code, "transparent", _legend("▽"))

    m = RE_TAP_DANCE.match(code)
    if m:
        return _result(code, "tap-dance", _legend("TD {}".format(m.group(1))), index=int(m.group(1)))
    m = RE_MACRO.match(code)
    if m:
        return _result(code, "macro", _legend("M {}".format(m.group(1))), index=int(m.group(1)))
    m = RE_LAYER.match(code)
    if m:
        layer = int(m.group(2))
        return _result(code, "layer", _legend("{} {}".format(m.group(1), layer)), layer=layer,
                       layer_action=LAYER_ACTIONS[m.group(1)])
    m = RE_LAYER_TAP.match(code)
    if m:
        layer = int(m.group(1))
        return _result(code, "layer-tap", _keycode_legend(m.group(2)), hold="layer {}".format(layer), layer=layer,
                       layer_action=LAYER_ACTIONS["MO"])

    if _in(value, QK_MOD_TAP):
        return _result(code, "mod-tap", _keycode_legend(Keycode.serialize(value & 0xFF)),
                       hold=mods_name((value >> 8) & 0x1F))
    if _in(value, QK_ONE_SHOT_MOD):
        return _result(code, "one-shot-mod", _legend(mods_name(value & 0x1F)))
    if _in(value, QK_MODS):
        return _with_mods(code, (value >> 8) & 0x1F, Keycode.serialize(value & 0xFF))

    if code in MODIFIER_KEYS:
        return _result(code, "modifier", _keycode_legend(code))
    if code.startswith(MOUSE_PREFIXES):
        return _result(code, "mouse", _keycode_legend(code))
    if code in MEDIA_CODES:
        return _result(code, "media", _keycode_legend(code))
    if code in LIGHTING_CODES:
        return _result(code, "lighting", _keycode_legend(code))
    if Keycode.find(code) is not None and Keycode.is_basic(code):
        return _result(code, "basic", _keycode_legend(code))
    return _result(code, "other", _keycode_legend(code))


def parse_value(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> firmware integer; raises ValueError """
    expression = expression.strip()
    if RE_NUMBERED.match(expression):
        # numbered keycodes the keyboard doesn't have aren't in the keycode tables; the firmware's own tables give
        # their real value (the generic parser gets some wrong, e.g. TO(n), or doesn't know them, e.g. M20, PDF(n))
        try:
            value = Keycode.resolve(expression)
        except RuntimeError as e:
            raise ValueError("not a valid keycode: {}".format(expression)) from e
    else:
        try:
            value = Keycode.deserialize(expression, reraise=True)
        except Exception as e:
            raise ValueError("not a valid keycode: {}".format(e)) from e
    if isinstance(value, bool):  # an int to Python, but "True" isn't a keycode
        raise ValueError("not a valid keycode: {}".format(expression))
    if not isinstance(value, int) or not 0 <= value <= 0xFFFF:
        raise ValueError("keycode must be a number between 0 and 0xFFFF")
    return value


def parse(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> description; raises ValueError """
    return describe(Keycode.serialize(parse_value(expression)))


# (first, last, what, number) for keycodes that point at a layer, tap dance or macro; number(value) -> its number
_REFERENCES_V6 = [
    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
    (0x5000, 0x51FF, "layer", lambda v: (v >> 5) & 0xF),  # LM
    (0x5200, 0x529F, "layer", lambda v: v & 0x1F),  # TO, MO, DF, TG, OSL
    (0x52C0, 0x52FF, "layer", lambda v: v & 0x1F),  # TT, PDF
    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
    (0x7700, 0x77FF, "macro", lambda v: v & 0xFF),
    (0x7C77, 0x7C78, "layer", lambda v: 3),  # FN_MO13, FN_MO23
]
_REFERENCES_V5 = [
    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
    (0x5000, 0x50FF, "layer", lambda v: v & 0xF),  # TO
    (0x5100, 0x54FF, "layer", lambda v: v & 0xFF),  # MO, DF, TG, OSL
    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
    (0x5800, 0x58FF, "layer", lambda v: v & 0xFF),  # TT
    (0x5900, 0x59FF, "layer", lambda v: (v >> 4) & 0xF),  # LM
    (0x5F10, 0x5F11, "layer", lambda v: 3),  # FN_MO13, FN_MO23
    (0x5F12, 0x5F7F, "macro", lambda v: v - 0x5F12),
]


def reference(value):
    """ Firmware keycode -> ("layer" | "tap dance" | "macro", number) it points at, or None """
    for first, last, what, number in (_REFERENCES_V6 if Keycode.protocol == 6 else _REFERENCES_V5):
        if first <= value <= last:
            return what, number(value)
    return None
