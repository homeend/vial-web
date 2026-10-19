# SPDX-License-Identifier: GPL-2.0-or-later
""" Builds the API's view of a loaded keyboard. Reads only what the protocol layer already holds: no device I/O. """
from keycodes.keycodes import KEYCODES_SPECIAL, KEYCODES_BASIC, KEYCODES_SHIFTED, KEYCODES_ISO, KEYCODES_LAYERS, \
    KEYCODES_BOOT, KEYCODES_MODIFIERS, KEYCODES_QUANTUM, KEYCODES_BACKLIGHT, KEYCODES_MEDIA, KEYCODES_TAP_DANCE, \
    KEYCODES_MACRO, KEYCODES_USER, KEYCODES_MIDI
from macro.macro_action import ActionText, ActionDelay, ActionSequence
from server import schemas
from server.describe import describe
from server.names import suggest_tap_dance_name, suggest_macro_name

KEYCODE_CATEGORIES = [
    ("Basic", KEYCODES_SPECIAL + KEYCODES_BASIC),
    ("Shifted", KEYCODES_SHIFTED),
    ("ISO / JIS", KEYCODES_ISO),
    ("Layers", KEYCODES_LAYERS),
    ("Modifiers", KEYCODES_MODIFIERS),
    ("Quantum", KEYCODES_QUANTUM),
    ("Lighting", KEYCODES_BACKLIGHT),
    ("Media", KEYCODES_MEDIA),
    ("Tap dance", KEYCODES_TAP_DANCE),
    ("Macros", KEYCODES_MACRO),
    ("User", KEYCODES_USER),
    ("MIDI", KEYCODES_MIDI),
    ("Boot", KEYCODES_BOOT),
]


def d(code):
    return schemas.Described(**describe(code))


def geometry(key):
    return schemas.KeyGeometry(
        row=key.row, col=key.col, encoder=key.encoder_idx, direction=key.encoder_dir,
        x=key.x, y=key.y, w=key.width, h=key.height, x2=key.x2, y2=key.y2, w2=key.width2, h2=key.height2,
        r=key.rotation_angle, rx=key.rotation_x, ry=key.rotation_y,
        layoutIndex=key.layout_index, layoutOption=key.layout_option, decal=key.decal,
    )


def layer_name(names, index):
    custom = names["layers"].get(str(index))
    return (custom, True) if custom else (("Base" if index == 0 else "Layer {}".format(index)), False)


def display_name(kb, names, kind, index):
    """ The name a layer, tap dance or macro is shown with -> schemas.Named """
    if kind == "layers":
        name, custom = layer_name(names, index)
    elif kind == "tapDance":
        entry = tap_dance(index, kb.tap_dance_entries[index], names)
        name, custom = entry.name, entry.customName
    else:
        entry = macros(kb, names).items[index]
        name, custom = entry.name, entry.customName
    return schemas.Named(kind=kind, index=index, name=name, customName=custom)


def tap_dance(index, entry, names):
    tap, hold, double_tap, tap_hold, term = entry
    slots = [d(tap), d(hold), d(double_tap), d(tap_hold)]
    custom = names["tapDance"].get(str(index))
    return schemas.TapDance(
        index=index, name=custom or suggest_tap_dance_name([s.model_dump() for s in slots]),
        customName=bool(custom), tap=slots[0], hold=slots[1], doubleTap=slots[2], tapHold=slots[3],
        tappingTerm=term,
    )


def combo(index, entry):
    return schemas.Combo(index=index, keys=[d(code) for code in entry[:4]], output=d(entry[4]))


def key_override(index, entry):
    return schemas.KeyOverride(
        index=index, trigger=d(entry.trigger), replacement=d(entry.replacement), layers=entry.layers,
        triggerMods=entry.trigger_mods, negativeModMask=entry.negative_mod_mask,
        suppressedMods=entry.suppressed_mods, options=entry.options.serialize(), enabled=entry.options.enabled,
    )


def alt_repeat_key(index, entry):
    return schemas.AltRepeatKey(
        index=index, keycode=d(entry.keycode), altKeycode=d(entry.alt_keycode), allowedMods=entry.allowed_mods,
        options=entry.options.serialize(), enabled=entry.options.enabled,
    )


def macro_action(action):
    if isinstance(action, ActionText):
        return schemas.MacroAction(type="text", text=action.text)
    if isinstance(action, ActionDelay):
        return schemas.MacroAction(type="delay", delay=action.delay)
    if isinstance(action, ActionSequence):
        return schemas.MacroAction(type=action.tag, keys=[d(code) for code in action.sequence])
    raise ValueError("unknown macro action {!r}".format(action))


def macros(kb, names):
    items = []
    for index, actions in enumerate(kb.macros_deserialize(kb.macro)):
        converted = [macro_action(a) for a in actions]
        custom = names["macros"].get(str(index))
        items.append(schemas.Macro(index=index, name=custom or suggest_macro_name([a.model_dump() for a in converted]),
                                   customName=bool(custom), actions=converted))
    return schemas.Macros(count=kb.macro_count, memory=kb.macro_memory, used=len(kb.macro), items=items)


def lighting(kb):
    out = schemas.Lighting()
    if kb.lighting_vialrgb:
        out.vialrgb = schemas.VialRgb(mode=kb.rgb_mode, speed=kb.rgb_speed, hsv=list(kb.rgb_hsv),
                                      maxBrightness=kb.rgb_maximum_brightness,
                                      supportedEffects=sorted(kb.rgb_supported_effects))
    if kb.lighting_qmk_rgblight:
        out.rgblight = schemas.RgbLight(brightness=kb.underglow_brightness, effect=kb.underglow_effect,
                                        speed=kb.underglow_effect_speed, hue=kb.underglow_color[0],
                                        saturation=kb.underglow_color[1])
    if kb.lighting_qmk_backlight:
        out.backlight = schemas.Backlight(brightness=kb.backlight_brightness, effect=kb.backlight_effect)
    return out


def build(kb, names, unlocked):
    """ Keyboard (already reloaded) + names for its UID -> KeyboardModel """
    layers = []
    for index in range(kb.layers):
        name, custom = layer_name(names, index)
        layers.append(schemas.Layer(
            index=index, name=name, customName=custom,
            keys=[d(kb.layout[(index, key.row, key.col)]) for key in kb.keys],
            encoders=[d(kb.encoder_layout[(index, key.encoder_idx, key.encoder_dir)]) for key in kb.encoders],
        ))
    layout_options = None
    if kb.layout_labels:
        layout_options = schemas.LayoutOptions(value=kb.layout_options, labels=kb.layout_labels)
    return schemas.KeyboardModel(
        name=kb.definition.get("name", "Keyboard"),
        uid=uid_of(kb),
        viaProtocol=kb.via_protocol,
        vialProtocol=kb.vial_protocol,
        rows=kb.rows,
        cols=kb.cols,
        keys=[geometry(key) for key in kb.keys],
        encoders=[geometry(key) for key in kb.encoders],
        layoutOptions=layout_options,
        layers=layers,
        tapDance=[tap_dance(i, e, names) for i, e in enumerate(kb.tap_dance_entries)],
        combos=[combo(i, e) for i, e in enumerate(kb.combo_entries)],
        keyOverrides=[key_override(i, e) for i, e in enumerate(kb.key_override_entries)],
        altRepeatKeys=[alt_repeat_key(i, e) for i, e in enumerate(kb.alt_repeat_key_entries)],
        macros=macros(kb, names),
        settings=[schemas.QmkSetting(qsid=q, value=v) for q, v in sorted(kb.settings.items())],
        lighting=lighting(kb),
        features=sorted(kb.supported_features),
        unlocked=unlocked,
    )


def uid_of(kb):
    return "{:016X}".format(kb.keyboard_id & 0xFFFFFFFFFFFFFFFF)


def catalogue_keycode(keycode):
    """ The keycode as the picker offers it; None when the keyboard's protocol has no such keycode: protocol 5's
    tables (also used before any keyboard is read) give those placeholders above 16 bits, e.g. QK_REPEAT_KEY """
    described = describe(keycode.qmk_id)
    if not 0 <= described["value"] <= 0xFFFF:
        return None
    return schemas.CatalogueKeycode(**described, aliases=[a for a in keycode.alias if a != described["code"]])


def keycode_catalogue():
    """ Keycodes the picker offers, grouped; hidden (unsupported) keycodes are left out, as are those the keyboard's
    protocol doesn't have (see catalogue_keycode) """
    out = []
    for name, keycodes in KEYCODE_CATEGORIES:
        items = [catalogue_keycode(kc) for kc in keycodes if not kc.hidden and "(kc)" not in kc.qmk_id]
        items = [item for item in items if item is not None]
        masks = [kc.qmk_id for kc in keycodes if not kc.hidden and "(kc)" in kc.qmk_id]
        if items or masks:
            out.append({"name": name, "keycodes": items, "templates": masks})
    return out
