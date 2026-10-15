# SPDX-License-Identifier: GPL-2.0-or-later
""" Turns a keycode into what the UI shows: tap and hold labels, a kind, and the layer or entry it refers to.

All keycode knowledge comes from keycodes/; this module only interprets it.
"""
import re

from keycodes.keycodes import Keycode, RAWCODES_MAP, KEYCODES_MEDIA, KEYCODES_BACKLIGHT

MOD_NAMES = {
    "LCTL": "Ctrl", "LSFT": "Shift", "LALT": "Alt", "LGUI": "Gui",
    "RCTL": "RCtrl", "RSFT": "RShift", "RALT": "AltGr", "RGUI": "RGui",
    "C_S": "Ctrl+Shift", "LCA": "Ctrl+Alt", "LCG": "Ctrl+Gui", "LSA": "Shift+Alt", "LAG": "Alt+Gui",
    "SGUI": "Gui+Shift", "LCAG": "Ctrl+Alt+Gui", "RCG": "RCtrl+RGui", "RCAG": "RCtrl+RAlt+RGui",
    "MEH": "Meh", "HYPR": "Hyper", "ALL": "Hyper",
}
LAYER_ACTIONS = {
    "MO": "while held", "TG": "toggle", "TO": "switch to", "TT": "hold, or tap to toggle",
    "OSL": "one-shot", "DF": "set default", "PDF": "set default (saved)",
}
MODIFIER_KEYS = {"KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"}
MOUSE_PREFIXES = ("KC_MS_", "KC_BTN", "KC_WH_", "KC_ACL")

RE_TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
RE_MACRO = re.compile(r"^M(\d+)$")
RE_LAYER = re.compile(r"^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$")
RE_LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")


def _result(code, kind, tap, hold=None, layer=None, index=None):
    return {"code": code, "kind": kind, "tap": tap, "hold": hold, "layer": layer, "index": index,
            "tooltip": Keycode.tooltip(code)}


def one_line(label):
    """ "!\\n1" (shifted over unshifted) -> "1"; "Caps\\nLock" -> "Caps Lock" """
    lines = [line.strip() for line in label.split("\n") if line.strip()]
    if len(lines) == 2 and all(len(line) == 1 for line in lines):
        return lines[-1]
    return " ".join(lines)


def _short_label(code):
    return one_line(Keycode.label(code))


def _mods(outer_qmk_id):
    """ "LSFT_T(kc)" or "LSFT(kc)" -> "Shift" """
    prefix = outer_qmk_id[:outer_qmk_id.find("(")]
    if prefix.endswith("_T"):
        prefix = prefix[:-2]
    return MOD_NAMES.get(prefix, prefix)


def describe(code):
    """ Keycode string (as the protocol layer stores it) -> description dict for the UI """
    code = Keycode.normalize(code)

    if code == "KC_NO":
        return _result(code, "none", "")
    if code == "KC_TRNS":
        return _result(code, "transparent", "▽")

    m = RE_TAP_DANCE.match(code)
    if m:
        return _result(code, "tap-dance", "TD {}".format(m.group(1)), index=int(m.group(1)))
    m = RE_MACRO.match(code)
    if m:
        return _result(code, "macro", "M {}".format(m.group(1)), index=int(m.group(1)))
    m = RE_LAYER.match(code)
    if m:
        layer = int(m.group(2))
        return _result(code, "layer", "{} {}".format(m.group(1), layer), LAYER_ACTIONS[m.group(1)], layer=layer)
    m = RE_LAYER_TAP.match(code)
    if m:
        layer = int(m.group(1))
        return _result(code, "layer-tap", Keycode.label(m.group(2)), "layer {}".format(layer), layer=layer)

    if Keycode.is_mask(code):
        outer = Keycode.find_outer_keycode(code).qmk_id
        inner = Keycode.find_inner_keycode(code).qmk_id
        if outer.endswith("_T(kc)"):
            return _result(code, "mod-tap", Keycode.label(inner), _mods(outer))
        # a modifier held with a key: shifted symbols have their own label, e.g. LSFT(KC_1) is "!"
        direct = RAWCODES_MAP.get(Keycode.deserialize(code))
        if direct is not None and not direct.masked:
            return _result(code, "basic", direct.label)
        return _result(code, "basic", "{}+{}".format(_mods(outer), _short_label(inner)))

    if code.startswith("OSM("):
        return _result(code, "one-shot-mod", "OSM", Keycode.label(code).split("\n", 1)[-1].replace("\n", " "))
    if code in MODIFIER_KEYS:
        return _result(code, "modifier", Keycode.label(code))
    if code.startswith(MOUSE_PREFIXES):
        return _result(code, "mouse", Keycode.label(code))
    if code in {k.qmk_id for k in KEYCODES_MEDIA}:
        return _result(code, "media", Keycode.label(code))
    if code in {k.qmk_id for k in KEYCODES_BACKLIGHT}:
        return _result(code, "lighting", Keycode.label(code))
    if Keycode.find(code) is not None and Keycode.is_basic(code):
        return _result(code, "basic", Keycode.label(code))
    return _result(code, "other", Keycode.label(code))


def parse(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> description; raises ValueError """
    try:
        value = Keycode.deserialize(expression.strip(), reraise=True)
    except Exception as e:
        raise ValueError("not a valid keycode: {}".format(e))
    if not isinstance(value, int) or not 0 <= value <= 0xFFFF:
        raise ValueError("keycode must be a number between 0 and 0xFFFF")
    return describe(Keycode.serialize(value))
