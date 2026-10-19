# SPDX-License-Identifier: GPL-2.0-or-later
""" A realistic default keyboard for fake mode: a 42-key split (Corne layout) with sample content. """
from keycodes.keycodes import Keycode
from keycodes.keycodes_v6 import keycodes_v6
from macro.macro_action import ActionText, ActionTap, ActionDelay, ActionDown, ActionUp
from simulator.virtual_keyboard import VirtualKeyboard

VIAL_PROTOCOL = 6
CORNE_UID = 0x5EED_C0DE_0042_0042

# Left half: matrix rows 0-3, columns 0-5 from the outside in.
# Right half: matrix rows 4-7, mirrored so column 0 is the outermost key.
LEFT = [[(r, c) for c in range(6)] for r in range(3)]
RIGHT = [[(r + 4, 5 - c) for c in range(6)] for r in range(3)]
LEFT_THUMBS = [(3, 3), (3, 4), (3, 5)]
RIGHT_THUMBS = [(7, 5), (7, 4), (7, 3)]
UNLOCK_KEYS = [LEFT[0][0], RIGHT[0][5]]
""" held to unlock the keyboard: the outermost keys of both top rows (Tab and Backspace) """


def definition():
    """ vial.json for the simulated keyboard (KLE layout, matrix 8x6, VialRGB lighting) """
    rows = []
    for r in range(3):
        rows.append(["{},{}".format(*rc) for rc in LEFT[r]] + [{"x": 3}] + ["{},{}".format(*rc) for rc in RIGHT[r]])
    rows.append([{"x": 3}] + ["{},{}".format(*rc) for rc in LEFT_THUMBS] + [{"x": 3}] +
                ["{},{}".format(*rc) for rc in RIGHT_THUMBS])
    return {
        "name": "Simulated Corne",
        "vendorId": "0xFEED",
        "productId": "0x0042",
        "lighting": "vialrgb",
        "matrix": {"rows": 8, "cols": 6},
        "layouts": {"keymap": rows},
    }


def encode(qmk_id):
    """ Keycode name or expression (e.g. "LT1(KC_SPC)", "LCTL(KC_C)") -> firmware integer, protocol 6 """
    if qmk_id in keycodes_v6.kc:
        return keycodes_v6.kc[qmk_id]
    saved = Keycode.protocol
    Keycode.protocol = VIAL_PROTOCOL
    try:
        return Keycode.deserialize(qmk_id, reraise=True)
    finally:
        Keycode.protocol = saved


# Each layer: 3 rows of 6 keys per half, then 3 thumb keys per half. Everything is listed left to right as it
# appears on the board: outside to inside on the left half, inside to outside on the right half. So the left
# thumbs are (3,3) -> (3,5) and the right thumbs (7,5) -> (7,3), as in LEFT_THUMBS / RIGHT_THUMBS.
LAYERS = [
    {   # 0: base, with home-row mods
        "left": [["KC_TAB", "LGUI_T(KC_W)", "KC_L", "KC_R", "LT2(KC_B)", "KC_Z"],
                 ["KC_LCTL", "LT2(KC_S)", "LALT_T(KC_H)", "LCTL_T(KC_N)", "LSFT_T(KC_T)", "KC_COMM"],
                 ["KC_LSFT", "KC_F", "KC_M", "KC_C", "KC_V", "KC_SLSH"]],
        "right": [["KC_Q", "KC_U", "KC_D", "KC_J", "KC_BSLS", "KC_BSPC"],
                  ["KC_DOT", "RGUI_T(KC_A)", "RALT_T(KC_E)", "RCTL_T(KC_O)", "RSFT_T(KC_I)", "KC_QUOT"],
                  ["KC_G", "KC_P", "KC_X", "KC_K", "KC_Y", "KC_RSFT"]],
        "left_thumbs": ["KC_ESC", "LT1(KC_SPC)", "TD(0)"],
        "right_thumbs": ["M0", "KC_ENT", "OSL(3)"],
    },
    {   # 1: symbols (hold Space)
        "left": [["KC_TRNS", "LSFT(KC_1)", "LSFT(KC_2)", "LSFT(KC_3)", "LSFT(KC_4)", "LSFT(KC_5)"],
                 ["KC_TRNS", "KC_GRV", "LSFT(KC_EQL)", "LSFT(KC_9)", "LSFT(KC_0)", "KC_EQL"],
                 ["KC_TRNS", "LSFT(KC_GRV)", "LSFT(KC_LBRC)", "LSFT(KC_RBRC)", "KC_LBRC", "KC_RBRC"]],
        "right": [["LSFT(KC_6)", "LSFT(KC_7)", "LSFT(KC_8)", "KC_MINS", "LSFT(KC_MINS)", "KC_TRNS"],
                  ["KC_SCLN", "LSFT(KC_SCLN)", "LSFT(KC_QUOT)", "LSFT(KC_BSLS)", "KC_BSLS", "KC_TRNS"],
                  ["KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
    },
    {   # 2: navigation (hold S or B)
        "left": [["KC_TRNS", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS", "KC_NO"],
                 ["KC_TRNS", "KC_TRNS", "KC_LALT", "KC_LCTL", "KC_LSFT", "KC_NO"],
                 ["KC_TRNS", "LCTL(KC_Z)", "LCTL(KC_X)", "LCTL(KC_C)", "LCTL(KC_V)", "KC_NO"]],
        "right": [["KC_PGUP", "KC_HOME", "KC_UP", "KC_END", "KC_NO", "KC_DEL"],
                  ["KC_PGDN", "KC_LEFT", "KC_DOWN", "KC_RGHT", "KC_NO", "KC_NO"],
                  ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
    },
    {   # 3: numbers and function keys (one-shot from the right thumb)
        "left": [["KC_TRNS", "KC_F1", "KC_F2", "KC_F3", "KC_F4", "KC_F5"],
                 ["KC_TRNS", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5"],
                 ["KC_TRNS", "KC_F11", "KC_F12", "KC_NO", "KC_NO", "KC_NO"]],
        "right": [["KC_F6", "KC_F7", "KC_F8", "KC_F9", "KC_F10", "KC_TRNS"],
                  ["KC_6", "KC_7", "KC_8", "KC_9", "KC_0", "KC_TRNS"],
                  ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "TO(0)"],
    },
]


def keymap(layers=None):
    """ {(layer, row, col): keycode} for the first `layers` layers (all of them by default) """
    out = {}
    for layer, keys in enumerate(LAYERS[:layers]):
        for side, positions in (("left", LEFT), ("right", RIGHT)):
            for r in range(3):
                for c in range(6):
                    out[(layer, *positions[r][c])] = encode(keys[side][r][c])
        for side, positions in (("left_thumbs", LEFT_THUMBS), ("right_thumbs", RIGHT_THUMBS)):
            for i in range(3):
                out[(layer, *positions[i])] = encode(keys[side][i])
    return out


def macros():
    """ Macro buffer: M0 types "git status" and Enter; M1 copies a line; the rest are empty """
    m0 = [ActionText("git status"), ActionTap(["KC_ENT"])]
    m1 = [ActionTap(["KC_HOME"]), ActionDown(["KC_LSFT"]), ActionTap(["KC_END"]), ActionUp(["KC_LSFT"]),
          ActionDelay(50), ActionTap(["LCTL(KC_C)"])]
    saved = Keycode.protocol
    Keycode.protocol = VIAL_PROTOCOL
    try:
        data = [b"".join(a.serialize(VIAL_PROTOCOL) for a in m) for m in (m0, m1)]
    finally:
        Keycode.protocol = saved
    return b"\x00".join(data) + b"\x00"


def make_corne(layers=len(LAYERS)):
    """ A fresh simulated Corne; nothing is shared between calls. With more layers than the sample keymap has, the
    others are empty (KC_NO); with fewer, the sample's last layers are left out. """
    ko_options_enabled = 0b1000_0111  # enabled, activates on trigger down / required mod down / negative mod up
    ark_options = 0b1110  # enabled, ignore mod handedness, bidirectional
    return VirtualKeyboard(
        definition(),
        layers=layers,
        keymap=keymap(layers),
        uid=CORNE_UID,
        vial_protocol=VIAL_PROTOCOL,
        macro_count=16,
        macro_memory=900,
        macros=macros(),
        tap_dance=[(encode("KC_TAB"), encode("KC_NO"), encode("KC_CAPS"), encode("KC_NO"), 200),
                   (encode("KC_ESC"), encode("KC_LCTL"), encode("LCTL(KC_S)"), encode("KC_NO"), 200)] +
                  [(0, 0, 0, 0, 200)] * 6,
        combos=[(encode("KC_K"), encode("KC_Y"), 0, 0, encode("KC_ESC")),
                (encode("KC_M"), encode("KC_C"), 0, 0, encode("KC_ENT"))] +
               [(0, 0, 0, 0, 0)] * 6,
        # Left Shift + Backspace sends Delete on every layer; Shift (either) + Esc sends ~ on the base layer, as QMK's
        # ko_make_basic(MOD_MASK_SHIFT, KC_ESC, KC_TILD) would, but only there
        key_overrides=[(encode("KC_BSPC"), encode("KC_DEL"), 0xFFFF, 0x02, 0, 0x02, ko_options_enabled),
                       (encode("KC_ESC"), encode("LSFT(KC_GRV)"), 0x0001, 0x22, 0, 0x22, ko_options_enabled)] +
                      # the rest as the firmware's reset leaves them (vial-qmk dynamic_keymap.c): every layer and the
                      # three start options, switched off, no keys
                      [(0, 0, 0xFFFF, 0, 0, 0, 0x07)] * 2,
        # Shift+Left then Alt Repeat gives Shift+Right, and the other way round
        alt_repeat_keys=[(encode("KC_LEFT"), encode("KC_RGHT"), 0x02, ark_options)] + [(0, 0, 0, 0)] * 3,
        # 22-24 are the separate Permissive Hold / Hold On Other Key Press / Retro Tapping settings. The legacy
        # bitfield (8) also has Permissive Hold and Retro Tapping bits, so it is left out to avoid showing them twice.
        # The others are QMK's defaults: Grave Escape (1), Auto Shift (3, 4), One Shot Keys (5, 6), the mouse keys
        # (9-17) and Magic (21, N-key rollover off)
        settings={1: 0, 2: 50, 3: 0, 4: 175, 5: 5, 6: 5000, 7: 200, 9: 10, 10: 16, 11: 8, 12: 10, 13: 30, 14: 10,
                  15: 80, 16: 8, 17: 40, 21: 0, 22: 0, 23: 0, 24: 0, 25: 100},
        # unlocked, as nobody can hold its keys; tests lock it to try the unlock
        unlocked=True,
        unlock_keys=UNLOCK_KEYS,
    )
