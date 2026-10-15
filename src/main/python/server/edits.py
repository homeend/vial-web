# SPDX-License-Identifier: GPL-2.0-or-later
""" Applies validated API requests to the keyboard through the protocol layer.

Every function takes the loaded Keyboard first and raises ValueError for requests that don't fit this keyboard.
They are called by DeviceManager.run, which holds the device lock.
"""
from macro.macro_action import ActionText, ActionDelay, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.key_override import KeyOverrideEntry
from protocol.qmk_settings_codec import QmkSettingsCodec
from protocol.unlock_hook import request_unlock
from server import model
from server.describe import parse


def code(expression):
    """ Validate and normalize a keycode expression """
    return parse(expression)["code"]


def _check_index(index, count, what):
    if not 0 <= index < count:
        raise ValueError("{} {} does not exist (this keyboard has {})".format(what, index, count))


def set_key(kb, layer, row, col, keycode):
    _check_index(layer, kb.layers, "layer")
    if (row, col) not in kb.rowcol:
        raise ValueError("no key at row {} column {}".format(row, col))
    kb.set_key(layer, row, col, code(keycode))
    return model.d(kb.layout[(layer, row, col)])


def set_encoder(kb, layer, index, direction, keycode):
    _check_index(layer, kb.layers, "layer")
    if (layer, index, direction) not in kb.encoder_layout:
        raise ValueError("no encoder {} direction {}".format(index, direction))
    kb.set_encoder(layer, index, direction, code(keycode))
    return model.d(kb.encoder_layout[(layer, index, direction)])


def set_layout_options(kb, value):
    if not kb.layout_labels:
        raise ValueError("this keyboard has no layout options")
    kb.set_layout_options(value)
    return kb.layout_options


def set_tap_dance(kb, index, body, names):
    _check_index(index, kb.tap_dance_count, "tap dance")
    entry = (code(body.tap), code(body.hold), code(body.doubleTap), code(body.tapHold), body.tappingTerm)
    kb.tap_dance_set(index, entry)
    return model.tap_dance(index, kb.tap_dance_entries[index], names)


def set_combo(kb, index, body):
    _check_index(index, kb.combo_count, "combo")
    entry = tuple(code(k) for k in body.keys) + (code(body.output),)
    kb.combo_set(index, entry)
    return model.combo(index, kb.combo_entries[index])


def set_key_override(kb, index, body):
    _check_index(index, kb.key_override_count, "key override")
    entry = KeyOverrideEntry((code(body.trigger), code(body.replacement), body.layers, body.triggerMods,
                              body.negativeModMask, body.suppressedMods, body.options))
    kb.key_override_set(index, entry)
    return model.key_override(index, kb.key_override_entries[index])


def set_alt_repeat_key(kb, index, body):
    _check_index(index, kb.alt_repeat_key_count, "alt-repeat key")
    entry = AltRepeatKeyEntry((code(body.keycode), code(body.altKeycode), body.allowedMods, body.options))
    kb.alt_repeat_key_set(index, entry)
    return model.alt_repeat_key(index, kb.alt_repeat_key_entries[index])


def _macro_action(action):
    if action.type == "text":
        if not action.text:
            raise ValueError("a text step needs text")
        return ActionText(action.text)
    if action.type == "delay":
        if action.delay is None:
            raise ValueError("a delay step needs a delay")
        return ActionDelay(action.delay)
    if not action.keys:
        raise ValueError("a {} step needs at least one key".format(action.type))
    return tag_to_action[action.type]([code(k) for k in action.keys])


def set_macros(kb, body, names):
    if len(body.items) != kb.macro_count:
        raise ValueError("expected {} macros, got {}".format(kb.macro_count, len(body.items)))
    data = kb.macros_serialize([[_macro_action(a) for a in actions] for actions in body.items])
    if len(data) > kb.macro_memory:
        raise ValueError("macros need {} bytes but the keyboard has {}".format(len(data), kb.macro_memory))
    if data != kb.macro:
        request_unlock(kb)
        kb.set_macro(data)
    return model.macros(kb, names)


def set_setting(kb, qsid, value):
    if qsid not in kb.supported_settings or not QmkSettingsCodec.is_qsid_supported(qsid):
        raise ValueError("setting {} is not supported by this keyboard".format(qsid))
    if kb.qmk_settings_set(qsid, value) != 0:
        raise RuntimeError("the keyboard rejected setting {}".format(qsid))
    return value


def reset_settings(kb):
    kb.qmk_settings_reset()
    kb.reload_settings()


def set_lighting(kb, body):
    if body.vialrgb is not None:
        if not kb.lighting_vialrgb:
            raise ValueError("this keyboard has no VialRGB lighting")
        if body.vialrgb.mode is not None:
            if body.vialrgb.mode not in kb.rgb_supported_effects:
                raise ValueError("effect {} is not supported".format(body.vialrgb.mode))
            kb.set_vialrgb_mode(body.vialrgb.mode)
        if body.vialrgb.speed is not None:
            kb.set_vialrgb_speed(body.vialrgb.speed)
        if body.vialrgb.hsv is not None:
            h, s, v = body.vialrgb.hsv
            kb.set_vialrgb_color(h, s, min(v, kb.rgb_maximum_brightness))
    if body.rgblight is not None:
        if not kb.lighting_qmk_rgblight:
            raise ValueError("this keyboard has no RGB light")
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
        if not kb.lighting_qmk_backlight:
            raise ValueError("this keyboard has no backlight")
        if body.backlight.brightness is not None:
            kb.set_qmk_backlight_brightness(body.backlight.brightness)
        if body.backlight.effect is not None:
            kb.set_qmk_backlight_effect(body.backlight.effect)
    if body.save:
        kb.save_rgb()
    return model.lighting(kb)


def restore_layout_file(kb, data):
    """ Apply a .vil file (bytes) to the keyboard """
    try:
        kb.restore_layout(data)
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError("not a valid Vial layout file: {}".format(e))
