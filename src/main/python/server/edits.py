# SPDX-License-Identifier: GPL-2.0-or-later
""" Applies validated API requests to the keyboard through the protocol layer.

Every function takes the loaded Keyboard first and raises ValueError for requests that don't fit this keyboard.
Everything is checked before the first write, so a refused request leaves the keyboard untouched.
They are called by DeviceManager.run, which holds the device lock.
"""
import json
import re

from pydantic import ValidationError

from keycodes.keycodes import Keycode, RESET_KEYCODE
from macro.macro_action import ActionText, ActionDelay, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.constants import VIAL_PROTOCOL_ADVANCED_MACROS
from protocol.key_override import KeyOverrideEntry
from protocol.qmk_settings_codec import QmkSettingsCodec
from protocol.unlock_hook import request_unlock
from server import model, schemas
from server.describe import parse_value, reference

MACRO_TEXT = re.compile(r"[\t\n\x20-\x7e]*")
""" What a macro text step may hold. The firmware types printable ASCII; a 0 byte would end the macro and bytes
1-8 start key actions. """
NAME_KINDS = {"layers": "layer", "tapDance": "tap dance", "macros": "macro"}


def _counts(kb):
    return {"layer": kb.layers, "tap dance": kb.tap_dance_count, "macro": kb.macro_count}


def code(kb, keycode):
    """ Validate a keycode for this keyboard (an expression such as "LCTL(KC_A)", or a firmware integer) and
    normalize it. Layer, tap dance and macro keycodes must point at one the keyboard has. """
    if isinstance(keycode, str):
        value = parse_value(keycode)
    elif isinstance(keycode, int) and not isinstance(keycode, bool) and 0 <= keycode <= 0xFFFF:
        value = keycode
    else:
        raise ValueError("not a keycode: {!r}".format(keycode))
    target = reference(value)
    if target is not None:
        what, number = target
        count = _counts(kb)[what]
        if number >= count:
            raise ValueError("{} refers to {} {}, but this keyboard's {}s are {}".format(
                keycode, what, number, what, "none" if count == 0 else "0 to {}".format(count - 1)))
    return Keycode.normalize(Keycode.serialize(value))


def _check_index(index, count, what):
    if not 0 <= index < count:
        raise ValueError("{} {} does not exist (this keyboard has {})".format(what, index, count))


def set_key(kb, layer, row, col, keycode):
    _check_index(layer, kb.layers, "layer")
    if (row, col) not in kb.rowcol:
        raise ValueError("no key at row {} column {}".format(row, col))
    kb.set_key(layer, row, col, code(kb, keycode))
    return model.d(kb.layout[(layer, row, col)])


def set_encoder(kb, layer, index, direction, keycode):
    _check_index(layer, kb.layers, "layer")
    if (layer, index, direction) not in kb.encoder_layout:
        raise ValueError("no encoder {} direction {}".format(index, direction))
    kb.set_encoder(layer, index, direction, code(kb, keycode))
    return model.d(kb.encoder_layout[(layer, index, direction)])


def set_layout_options(kb, value):
    if not kb.layout_labels:
        raise ValueError("this keyboard has no layout options")
    kb.set_layout_options(value)
    return kb.layout_options


def _tap_dance_entry(kb, body):
    return (code(kb, body.tap), code(kb, body.hold), code(kb, body.doubleTap), code(kb, body.tapHold),
            body.tappingTerm)


def set_tap_dance(kb, index, body, names):
    _check_index(index, kb.tap_dance_count, "tap dance")
    kb.tap_dance_set(index, _tap_dance_entry(kb, body))
    return model.tap_dance(index, kb.tap_dance_entries[index], names)


def _combo_entry(kb, body):
    return tuple(code(kb, k) for k in body.keys) + (code(kb, body.output),)


def set_combo(kb, index, body):
    _check_index(index, kb.combo_count, "combo")
    kb.combo_set(index, _combo_entry(kb, body))
    return model.combo(index, kb.combo_entries[index])


def _key_override_entry(kb, body):
    return KeyOverrideEntry((code(kb, body.trigger), code(kb, body.replacement), body.layers, body.triggerMods,
                             body.negativeModMask, body.suppressedMods, body.options))


def set_key_override(kb, index, body):
    _check_index(index, kb.key_override_count, "key override")
    kb.key_override_set(index, _key_override_entry(kb, body))
    return model.key_override(index, kb.key_override_entries[index])


def _alt_repeat_key_entry(kb, body):
    return AltRepeatKeyEntry((code(kb, body.keycode), code(kb, body.altKeycode), body.allowedMods, body.options))


def set_alt_repeat_key(kb, index, body):
    _check_index(index, kb.alt_repeat_key_count, "alt-repeat key")
    kb.alt_repeat_key_set(index, _alt_repeat_key_entry(kb, body))
    return model.alt_repeat_key(index, kb.alt_repeat_key_entries[index])


def _macro_action(kb, kind, text=None, keys=(), delay=None):
    """ One macro step, from the API or from a .vil file """
    if kind == "text":
        if not isinstance(text, str) or not text:
            raise ValueError("a text step needs text")
        if len(text) > schemas.MACRO_TEXT_MAX:
            raise ValueError("a text step holds at most {} characters".format(schemas.MACRO_TEXT_MAX))
        if not MACRO_TEXT.fullmatch(text):
            raise ValueError("macro text can only hold printable ASCII characters, tabs and line breaks")
        return ActionText(text)
    if kind == "delay":
        if isinstance(delay, bool) or not isinstance(delay, int) or not 0 <= delay <= schemas.MACRO_DELAY_MAX:
            raise ValueError("a delay step needs a delay from 0 to {} ms".format(schemas.MACRO_DELAY_MAX))
        if kb.vial_protocol < VIAL_PROTOCOL_ADVANCED_MACROS:
            raise ValueError("this keyboard's firmware doesn't support delays in macros")
        return ActionDelay(delay)
    if kind not in ("tap", "down", "up"):
        raise ValueError("unknown macro step {!r}".format(kind))
    if not keys:
        raise ValueError("a {} step needs at least one key".format(kind))
    if len(keys) > schemas.MACRO_KEYS_MAX:
        raise ValueError("a {} step holds at most {} keys".format(kind, schemas.MACRO_KEYS_MAX))
    return tag_to_action[kind]([code(kb, k) for k in keys])


def _macros_data(kb, macros):
    """ All macros (macro_count lists of actions) -> the macro buffer; refused if it doesn't fit """
    data = kb.macros_serialize(macros)
    if len(data) > kb.macro_memory:
        raise ValueError("macros need {} bytes but the keyboard has {}".format(len(data), kb.macro_memory))
    return data


def set_macros(kb, body, names):
    if len(body.items) != kb.macro_count:
        raise ValueError("expected {} macros, got {}".format(kb.macro_count, len(body.items)))
    data = _macros_data(kb, [[_macro_action(kb, a.type, a.text, a.keys, a.delay) for a in actions]
                             for actions in body.items])
    if data != kb.macro:
        request_unlock(kb)
        kb.set_macro(data)
    return model.macros(kb, names)


def _check_setting(kb, qsid, value):
    if qsid not in kb.supported_settings or not QmkSettingsCodec.is_qsid_supported(qsid):
        raise ValueError("setting {} is not supported by this keyboard".format(qsid))
    width = QmkSettingsCodec.fields()[qsid][0].get("width", 1)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 1 << (8 * width):
        raise ValueError("setting {} must be a number from 0 to {}".format(qsid, (1 << (8 * width)) - 1))


def _write_setting(kb, qsid, value):
    if kb.qmk_settings_set(qsid, value) != 0:
        raise RuntimeError("the keyboard rejected setting {}".format(qsid))


def set_setting(kb, qsid, value):
    _check_setting(kb, qsid, value)
    _write_setting(kb, qsid, value)
    return value


def reset_settings(kb):
    kb.qmk_settings_reset()
    kb.reload_settings()


def set_lighting(kb, body):
    # check every section before writing any of them
    if body.vialrgb is not None:
        if not kb.lighting_vialrgb:
            raise ValueError("this keyboard has no VialRGB lighting")
        if body.vialrgb.mode is not None and body.vialrgb.mode not in kb.rgb_supported_effects:
            raise ValueError("effect {} is not supported".format(body.vialrgb.mode))
    if body.rgblight is not None and not kb.lighting_qmk_rgblight:
        raise ValueError("this keyboard has no RGB light")
    if body.backlight is not None and not kb.lighting_qmk_backlight:
        raise ValueError("this keyboard has no backlight")

    if body.vialrgb is not None:
        if body.vialrgb.mode is not None:
            kb.set_vialrgb_mode(body.vialrgb.mode)
        if body.vialrgb.speed is not None:
            kb.set_vialrgb_speed(body.vialrgb.speed)
        if body.vialrgb.hsv is not None:
            h, s, v = body.vialrgb.hsv
            kb.set_vialrgb_color(h, s, min(v, kb.rgb_maximum_brightness))
    if body.rgblight is not None:
        r = body.rgblight
        if r.effect is not None:
            kb.set_qmk_rgblight_effect(r.effect)
        if r.speed is not None:
            kb.set_qmk_rgblight_effect_speed(r.speed)
        if r.hue is not None or r.saturation is not None:
            hue = kb.underglow_color[0] if r.hue is None else r.hue
            sat = kb.underglow_color[1] if r.saturation is None else r.saturation
            kb.set_qmk_rgblight_color(hue, sat, kb.underglow_brightness if r.brightness is None else r.brightness)
            kb.underglow_color = (hue, sat)
        elif r.brightness is not None:
            kb.set_qmk_rgblight_brightness(r.brightness)
    if body.backlight is not None:
        if body.backlight.brightness is not None:
            kb.set_qmk_backlight_brightness(body.backlight.brightness)
        if body.backlight.effect is not None:
            kb.set_qmk_backlight_effect(body.backlight.effect)
    if body.save:
        kb.save_rgb()
    return model.lighting(kb)


def check_name(kb, kind, index):
    """ Names can only be given to layers, tap dances and macros the keyboard has """
    if kind not in NAME_KINDS:
        raise ValueError("unknown name kind: {}".format(kind))
    what = NAME_KINDS[kind]
    _check_index(index, _counts(kb)[what], what)


# ---------- .vil files ----------

class _Invalid(Exception):
    """ A problem in a .vil file, with where it is """


def _at(where, fn, *args):
    """ fn(*args), with any problem it finds reported as being at `where` in the file """
    try:
        return fn(*args)
    except _Invalid as e:
        raise _Invalid("{}: {}".format(where, e))
    except (ValueError, TypeError, KeyError, IndexError, AttributeError) as e:
        if isinstance(e, ValidationError):
            e = "; ".join("{} {}".format(".".join(str(p) for p in err["loc"]), err["msg"]).strip()
                          for err in e.errors())
        elif isinstance(e, KeyError):
            e = "missing {}".format(e)
        raise _Invalid("{}: {}".format(where, e))


def _list(value, what):
    if not isinstance(value, list):
        raise _Invalid("{} must be a list".format(what))
    return value


def _schema(cls, fields):
    """ Check .vil values with the API's request schema; strict, so e.g. true or "5" is not a number """
    return cls.model_validate(fields, strict=True)


def _vil_macro_action(kb, act):
    act = _list(act, "a macro step")
    if not act:
        raise ValueError("empty macro step")
    kind = act[0]
    if kind in ("text", "delay") and len(act) != 2:
        raise ValueError("a {} step has one value".format(kind))
    if kind == "text":
        return _macro_action(kb, kind, text=act[1])
    if kind == "delay":
        return _macro_action(kb, kind, delay=act[1])
    return _macro_action(kb, kind, keys=act[1:])


def _vil_settings(kb, settings):
    """ {qsid: value} to write; settings this keyboard doesn't have are skipped, as the Qt app does """
    if not isinstance(settings, dict):
        raise ValueError("settings must be an object")
    out = {}
    for key, value in settings.items():
        try:
            qsid = int(key)
        except ValueError:
            raise ValueError("unknown setting {!r}".format(key))
        if qsid in kb.supported_settings and QmkSettingsCodec.is_qsid_supported(qsid):
            _check_setting(kb, qsid, value)
            out[qsid] = value
    return out


def _parse_layout_file(kb, data):
    """ Decode and check a whole .vil file against this keyboard, without writing. Returns the changes. """
    try:
        doc = json.loads(data)
    except RecursionError:
        raise _Invalid("nested too deeply")
    except ValueError as e:  # not JSON, or not UTF-8
        raise _Invalid(str(e))
    if not isinstance(doc, dict):
        raise _Invalid("expected a JSON object")
    for required in ("layout", "encoder_layout", "layout_options"):
        if required not in doc:
            raise _Invalid("missing {}".format(required))

    keys = {}
    for layer, rows in enumerate(_list(doc["layout"], "layout")):
        for row, cols in enumerate(_list(rows, "a layout layer")):
            for col, value in enumerate(_list(cols, "a layout row")):
                # the file lists every matrix position; positions without a key hold -1
                if (layer, row, col) in kb.layout:
                    keys[(layer, row, col)] = _at("layer {} row {} column {}".format(layer, row, col),
                                                  code, kb, value)

    encoders = {}
    for layer, items in enumerate(_list(doc["encoder_layout"], "encoder_layout")):
        for index, pair in enumerate(_list(items, "an encoder layer")):
            for direction, value in enumerate(_list(pair, "an encoder")[:2]):
                if (layer, index, direction) in kb.encoder_layout:
                    encoders[(layer, index, direction)] = _at(
                        "layer {} encoder {} direction {}".format(layer, index, direction), code, kb, value)

    layout_options = doc["layout_options"]  # -1: the keyboard that saved the file had none
    if isinstance(layout_options, bool) or not isinstance(layout_options, int) or \
            not -1 <= layout_options <= 0xFFFFFFFF:
        raise _Invalid("layout_options must be a number")

    macro_data = None
    if doc.get("macro") is not None:
        macros = []
        # macros beyond what the keyboard has are skipped, as the Qt app does
        for index, actions in enumerate(_list(doc["macro"], "macro")[:kb.macro_count]):
            macros.append([_at("macro {} step {}".format(index, step), _vil_macro_action, kb, act)
                           for step, act in enumerate(_list(actions, "a macro"))])
        macros += [[] for _ in range(kb.macro_count - len(macros))]
        macro_data = _at("macros", _macros_data, kb, macros)

    def entries(section, count, convert):
        """ (index, entry) of a section; entries beyond what the keyboard has are skipped, as the Qt app does """
        return [(index, _at("{} {}".format(section, index), convert, entry))
                for index, entry in enumerate(_list(doc.get(section, []), section)[:count])]

    def tap_dance(e):
        tap, hold, double_tap, tap_hold, term = _list(e, "a tap dance")
        return _tap_dance_entry(kb, _schema(schemas.TapDanceIn, dict(
            tap=tap, hold=hold, doubleTap=double_tap, tapHold=tap_hold, tappingTerm=term)))

    def combo(e):
        if len(_list(e, "a combo")) != 5:
            raise ValueError("a combo has 4 keys and an output")
        return _combo_entry(kb, _schema(schemas.ComboIn, dict(keys=e[:4], output=e[4])))

    def key_override(e):
        return _key_override_entry(kb, _schema(schemas.KeyOverrideIn, dict(
            trigger=e["trigger"], replacement=e["replacement"], layers=e["layers"], triggerMods=e["trigger_mods"],
            negativeModMask=e["negative_mod_mask"], suppressedMods=e["suppressed_mods"], options=e["options"])))

    def alt_repeat_key(e):
        return _alt_repeat_key_entry(kb, _schema(schemas.AltRepeatKeyIn, dict(
            keycode=e["keycode"], altKeycode=e["alt_keycode"], allowedMods=e["allowed_mods"],
            options=e["options"])))

    return {
        "keys": keys,
        "encoders": encoders,
        "layout_options": layout_options,
        "macro": macro_data,
        "tap_dance": entries("tap_dance", kb.tap_dance_count, tap_dance),
        "combo": entries("combo", kb.combo_count, combo),
        "key_override": entries("key_override", kb.key_override_count, key_override),
        "alt_repeat_key": entries("alt_repeat_key", kb.alt_repeat_key_count, alt_repeat_key),
        "settings": _at("settings", _vil_settings, kb, doc.get("settings", {})),
    }


def _needs_unlock(kb, changes):
    """ Whether writing these changes needs an unlocked keyboard, by the rules the protocol layer applies """
    boot = RESET_KEYCODE
    return any((
        any(c == boot and kb.layout[pos] != c for pos, c in changes["keys"].items()),
        any(c == boot and kb.encoder_layout[pos] != c for pos, c in changes["encoders"].items()),
        changes["macro"] is not None and changes["macro"] != kb.macro,
        any(boot in e[:4] and kb.tap_dance_entries[i] != e for i, e in changes["tap_dance"]),
        any(e[4] == boot and kb.combo_entries[i] != e for i, e in changes["combo"]),
        any(e.replacement == boot and kb.key_override_entries[i] != e for i, e in changes["key_override"]),
        any(boot in (e.keycode, e.alt_keycode) and kb.alt_repeat_key_entries[i] != e
            for i, e in changes["alt_repeat_key"]),
    ))


def prepare_layout_file(kb, data):
    """ Check a whole .vil file (bytes), including whether the keyboard must be unlocked for it, without writing
    anything. Raises ValueError (or KeyboardLocked) if it can't be applied; returns apply(), which writes it. """
    try:
        changes = _parse_layout_file(kb, data)
    except _Invalid as e:
        raise ValueError("not a valid Vial layout file: {}".format(e))
    if _needs_unlock(kb, changes):
        request_unlock(kb)

    def apply():
        for (layer, row, col), keycode in changes["keys"].items():
            kb.set_key(layer, row, col, keycode)
        for (layer, index, direction), keycode in changes["encoders"].items():
            kb.set_encoder(layer, index, direction, keycode)
        if changes["layout_options"] != -1:
            kb.set_layout_options(changes["layout_options"])
        if changes["macro"] is not None and changes["macro"] != kb.macro:
            request_unlock(kb)
            kb.set_macro(changes["macro"])
        for index, entry in changes["tap_dance"]:
            kb.tap_dance_set(index, entry)
        for index, entry in changes["combo"]:
            kb.combo_set(index, entry)
        for index, entry in changes["key_override"]:
            kb.key_override_set(index, entry)
        for index, entry in changes["alt_repeat_key"]:
            kb.alt_repeat_key_set(index, entry)
        for qsid, value in changes["settings"].items():
            if kb.settings.get(qsid) != value:
                _write_setting(kb, qsid, value)

    return apply
