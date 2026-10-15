from server import model

NO_NAMES = {"layers": {}, "tapDance": {}, "macros": {}}


def key_index(result, row, col):
    return next(i for i, k in enumerate(result.keys) if (k.row, k.col) == (row, col))


def test_build_geometry_and_layers(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=True)
    assert result.name == "Simulated Corne"
    assert result.uid == "5EEDC0DE00420042"
    assert (result.rows, result.cols, len(result.keys), len(result.encoders)) == (8, 6, 42, 0)
    assert [layer.name for layer in result.layers] == ["Base", "Layer 1", "Layer 2", "Layer 3"]
    s_key = result.layers[0].keys[key_index(result, 1, 1)]
    assert (s_key.kind, s_key.tap, s_key.hold, s_key.layer) == ("layer-tap", "S", "layer 2", 2)
    thumb = result.keys[key_index(result, 7, 5)]
    assert (thumb.x, thumb.y) == (9, 3)


def test_build_uses_custom_names(corne_keyboard):
    virtual, kb = corne_keyboard
    names = {"layers": {"1": "symbols"}, "tapDance": {"0": "Caps"}, "macros": {}}
    result = model.build(kb, names, unlocked=True)
    assert (result.layers[1].name, result.layers[1].customName) == ("symbols", True)
    assert (result.tapDance[0].name, result.tapDance[0].customName) == ("Caps", True)


def test_build_behaviours(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=True)
    td = result.tapDance[0]
    assert (td.name, td.tap.tap, td.doubleTap.code, td.hold.kind, td.tappingTerm) == \
        ("Tab / Caps Lock", "Tab", "KC_CAPSLOCK", "none", 200)
    assert [k.code for k in result.combos[0].keys] == ["KC_K", "KC_Y", "KC_NO", "KC_NO"]
    assert result.combos[0].output.code == "KC_ESCAPE"
    assert (result.keyOverrides[0].trigger.code, result.keyOverrides[0].enabled) == ("KC_BSPACE", True)
    assert len(result.altRepeatKeys) == 4


def test_build_macros_settings_lighting(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=False)
    assert (result.macros.count, result.macros.memory, result.macros.used) == (16, 900, len(kb.macro))
    first = result.macros.items[0]
    assert first.name == "git status"
    assert [a.type for a in first.actions] == ["text", "tap"]
    assert result.macros.items[1].actions[4].delay == 50
    assert {s.qsid: s.value for s in result.settings}[7] == 200
    assert result.lighting.vialrgb.mode == 2 and result.lighting.rgblight is None
    assert "caps_word" in result.features
    assert result.unlocked is False


def test_keycode_catalogue(corne_keyboard):
    catalogue = {c["name"]: c for c in model.keycode_catalogue()}
    assert "KC_A" in [k.code for k in catalogue["Basic"]["keycodes"]]
    assert "TD(7)" in [k.code for k in catalogue["Tap dance"]["keycodes"]]
    assert "LT0(kc)" in catalogue["Layers"]["templates"]
