# SPDX-License-Identifier: GPL-2.0-or-later
""" A Vial keyboard simulated at the HID packet level.

It answers the same 32-byte requests real firmware does, so the real protocol code runs against it unchanged.
All state is kept in memory as raw integers (keycodes as the firmware stores them).
"""
import copy
import json
import lzma
import math
import struct

from protocol.constants import CMD_VIA_GET_PROTOCOL_VERSION, CMD_VIA_GET_KEYBOARD_VALUE, CMD_VIA_SET_KEYBOARD_VALUE, \
    CMD_VIA_SET_KEYCODE, CMD_VIA_LIGHTING_SET_VALUE, CMD_VIA_LIGHTING_GET_VALUE, CMD_VIA_LIGHTING_SAVE, \
    CMD_VIA_MACRO_GET_COUNT, CMD_VIA_MACRO_GET_BUFFER_SIZE, CMD_VIA_MACRO_GET_BUFFER, CMD_VIA_MACRO_SET_BUFFER, \
    CMD_VIA_GET_LAYER_COUNT, CMD_VIA_KEYMAP_GET_BUFFER, CMD_VIA_VIAL_PREFIX, VIA_LAYOUT_OPTIONS, \
    VIA_SWITCH_MATRIX_STATE, QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT, QMK_RGBLIGHT_BRIGHTNESS, \
    QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR, VIALRGB_GET_INFO, VIALRGB_GET_MODE, \
    VIALRGB_GET_SUPPORTED, VIALRGB_SET_MODE, CMD_VIAL_GET_KEYBOARD_ID, CMD_VIAL_GET_SIZE, CMD_VIAL_GET_DEFINITION, \
    CMD_VIAL_GET_ENCODER, CMD_VIAL_SET_ENCODER, CMD_VIAL_GET_UNLOCK_STATUS, CMD_VIAL_UNLOCK_START, \
    CMD_VIAL_UNLOCK_POLL, CMD_VIAL_LOCK, CMD_VIAL_QMK_SETTINGS_QUERY, CMD_VIAL_QMK_SETTINGS_GET, \
    CMD_VIAL_QMK_SETTINGS_SET, CMD_VIAL_QMK_SETTINGS_RESET, CMD_VIAL_DYNAMIC_ENTRY_OP, \
    DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES, DYNAMIC_VIAL_TAP_DANCE_GET, DYNAMIC_VIAL_TAP_DANCE_SET, \
    DYNAMIC_VIAL_COMBO_GET, DYNAMIC_VIAL_COMBO_SET, DYNAMIC_VIAL_KEY_OVERRIDE_GET, DYNAMIC_VIAL_KEY_OVERRIDE_SET, \
    DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, BUFFER_FETCH_CHUNK
from keycodes.keycodes_v5 import keycodes_v5
from keycodes.keycodes_v6 import keycodes_v6
from kle_serial import Serial as KleSerial
from protocol.qmk_settings_codec import QmkSettingsCodec

CMD_VIA_BOOTLOADER_JUMP = 0x0B
# polls the firmware wants the unlock keys held for (VIAL_UNLOCK_COUNTER_MAX). The firmware counts down at most once
# every 100 ms; the simulator counts down on every poll, so tests needn't wait.
UNLOCK_COUNTER_MAX = 50
# the firmware has room for this many unlock keys in the unlock status reply
MAX_UNLOCK_KEYS = 15
# while an unlock is in progress the firmware answers only these Vial commands and echoes everything else
ALLOWED_DURING_UNLOCK = {CMD_VIAL_GET_KEYBOARD_ID, CMD_VIAL_GET_SIZE, CMD_VIAL_GET_DEFINITION,
                         CMD_VIAL_GET_UNLOCK_STATUS, CMD_VIAL_UNLOCK_START, CMD_VIAL_UNLOCK_POLL}
# QMK settings the protocol code has no definition for are answered with the widest QMK setting width
UNKNOWN_SETTING_WIDTH = 4
# bits of the last byte of the dynamic entry count reply
FEATURE_CAPS_WORD = 1 << 0
FEATURE_LAYER_LOCK = 1 << 1
NO_MORE = 0xFFFF


class SimulatorError(RuntimeError):
    pass


class VirtualKeyboard:

    def __init__(self, definition, layers=4, keymap=None, uid=0xF00DFACEDEADBEEF, vial_protocol=6,
                 via_protocol=9, macro_count=8, macro_memory=512, macros=b"", tap_dance=None, combos=None,
                 key_overrides=None, alt_repeat_keys=None, settings=None, unlocked=True, unlock_keys=(),
                 unlock_counter_max=UNLOCK_COUNTER_MAX, features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK):
        """
        definition: vial.json as a dict or JSON string
        keymap: optional {(layer, row, col): keycode}; unset keys are KC_NO
        macros: initial macro buffer bytes (NUL-separated); padded with zeros to macro_memory
        tap_dance / combos: lists of 5-int tuples, as the firmware stores them
        key_overrides: list of 7-int tuples (trigger, replacement, layers, trigger_mods, negative_mod_mask,
                       suppressed_mods, options)
        alt_repeat_keys: list of 4-int tuples (keycode, alt_keycode, allowed_mods, options)
        settings: {qsid: int} of supported QMK settings; None means the firmware has no QMK settings
        unlocked: start unlocked; a locked keyboard refuses security-sensitive writes like Vial firmware does
        unlock_keys: [(row, col)] the user must press(); every UNLOCK_POLL while all of them are held counts down by
                     one, and the keyboard unlocks at zero. None: no key needs holding, the polls alone count down.
        unlock_counter_max: where the countdown starts (VIAL_UNLOCK_COUNTER_MAX); a key let go starts it again
        """
        if isinstance(definition, str):
            definition = json.loads(definition)
        self.definition = definition
        self.compressed_definition = lzma.compress(json.dumps(definition).encode("utf-8"))

        self.rows = definition["matrix"]["rows"]
        self.cols = definition["matrix"]["cols"]
        self.layers = layers
        self.keymap = [[[0] * self.cols for _ in range(self.rows)] for _ in range(layers)]
        for (layer, row, col), code in (keymap or {}).items():
            self.keymap[layer][row][col] = code

        self.encoders = {}
        self.encoder_count = self._count_encoders(definition)
        self.layout_options = 0

        self.uid = uid
        self.vial_protocol = vial_protocol
        self.via_protocol = via_protocol
        self.features = features
        self.qk_boot = (keycodes_v6 if vial_protocol >= 6 else keycodes_v5).kc["QK_BOOT"]

        self.macro_count = macro_count
        if len(macros) > macro_memory:
            raise SimulatorError("initial macros do not fit into macro memory")
        self.macro_buffer = bytearray(macros + b"\x00" * (macro_memory - len(macros)))

        self.tap_dance = list(tap_dance or [])
        self.combos = list(combos or [])
        self.key_overrides = list(key_overrides or [])
        self.alt_repeat_keys = list(alt_repeat_keys or [])

        self.settings = None if settings is None else dict(settings)
        self.default_settings = None if settings is None else dict(settings)

        if len(unlock_keys) > MAX_UNLOCK_KEYS:
            raise SimulatorError("at most {} unlock keys fit into the unlock status".format(MAX_UNLOCK_KEYS))
        if unlock_counter_max < 1:
            raise SimulatorError("the unlock countdown must start at 1 or more")
        self.unlock_keys = list(unlock_keys)
        self.unlock_counter_max = unlock_counter_max
        self.unlocked = unlocked
        self.unlock_in_progress = False
        self.unlock_counter = 0

        lighting = definition.get("lighting", "none")
        self.rgblight = {"brightness": 128, "effect": 1, "speed": 2, "color": (0, 255)} \
            if lighting in ["qmk_rgblight", "qmk_backlight_rgblight"] else None
        self.backlight = {"brightness": 128, "effect": 0} \
            if lighting in ["qmk_backlight", "qmk_backlight_rgblight"] else None
        self.vialrgb = {"mode": 2, "speed": 128, "hsv": (0, 255, 128), "max_brightness": 200,
                        "supported": [1, 2, 3, 4, 5, 6, 7, 8]} if lighting == "vialrgb" else None
        self.lighting_saved = False

        self.pressed = set()
        self.connected = True
        self.bootloader_requested = False
        self.writes = []

    # --- helpers for tests and the fake server ---

    def press(self, row, col):
        self.pressed.add((row, col))

    def release(self, row, col):
        self.pressed.discard((row, col))

    def hold_unlock_keys(self, held):
        """ The user presses (True) or lets go of (False) every unlock key """
        for row, col in self.unlock_keys:
            (self.press if held else self.release)(row, col)

    def macros(self):
        """ Macro buffer split into macro_count byte strings """
        return bytes(self.macro_buffer).split(b"\x00")[:self.macro_count]

    @staticmethod
    def _count_encoders(definition):
        """ Number of encoders the layout declares, found the same way the protocol code finds them """
        keys = KleSerial().deserialize(copy.deepcopy(definition["layouts"]["keymap"])).keys
        return max((int(key.labels[0].split(",")[0]) + 1 for key in keys if key.labels[4] == "e"), default=0)

    def _firewall(self, code):
        """ vial_keycode_firewall: a locked keyboard stores KC_NO instead of QK_BOOT """
        return 0 if code == self.qk_boot and not self.unlocked else code

    # --- packet handling ---

    def process(self, msg):
        """ Handle one 32-byte request and return the reply (padded to 32 bytes by the device) """
        if not self.connected:
            raise OSError("simulated keyboard is unplugged")
        msg = bytes(msg)
        cmd = msg[0]
        if self.unlock_in_progress and not (cmd == CMD_VIA_VIAL_PREFIX and msg[1] in ALLOWED_DURING_UNLOCK):
            return msg
        if cmd == CMD_VIA_VIAL_PREFIX:
            return self._vial(msg)
        handler = {
            CMD_VIA_GET_PROTOCOL_VERSION: lambda: struct.pack(">BH", cmd, self.via_protocol),
            CMD_VIA_GET_KEYBOARD_VALUE: lambda: self._get_keyboard_value(msg),
            CMD_VIA_SET_KEYBOARD_VALUE: lambda: self._set_keyboard_value(msg),
            CMD_VIA_SET_KEYCODE: lambda: self._set_keycode(msg),
            CMD_VIA_LIGHTING_GET_VALUE: lambda: self._lighting_get(msg),
            CMD_VIA_LIGHTING_SET_VALUE: lambda: self._lighting_set(msg),
            CMD_VIA_LIGHTING_SAVE: lambda: self._lighting_save(msg),
            CMD_VIA_MACRO_GET_COUNT: lambda: struct.pack(">BB", cmd, self.macro_count),
            CMD_VIA_MACRO_GET_BUFFER_SIZE: lambda: struct.pack(">BH", cmd, len(self.macro_buffer)),
            CMD_VIA_MACRO_GET_BUFFER: lambda: self._read_buffer(msg, bytes(self.macro_buffer)),
            CMD_VIA_MACRO_SET_BUFFER: lambda: self._write_macro_buffer(msg),
            CMD_VIA_GET_LAYER_COUNT: lambda: struct.pack(">BB", cmd, self.layers),
            CMD_VIA_KEYMAP_GET_BUFFER: lambda: self._read_buffer(msg, self._keymap_buffer()),
            CMD_VIA_BOOTLOADER_JUMP: lambda: self._bootloader(msg),
        }.get(cmd)
        if handler is None:
            raise SimulatorError("unknown VIA command 0x{:02X}".format(cmd))
        return handler()

    def _keymap_buffer(self):
        out = b""
        for layer in self.keymap:
            for row in layer:
                for code in row:
                    out += struct.pack(">H", code)
        return out

    @staticmethod
    def _read_buffer(msg, buffer):
        offset, size = struct.unpack_from(">HB", msg, 1)
        if size > BUFFER_FETCH_CHUNK:
            # the data would not fit into the reply: the firmware sends the request back without data
            return msg[0:4]
        # the reply echoes the 4-byte request header, then the data
        return msg[0:4] + buffer[offset:offset + size]

    def _write_macro_buffer(self, msg):
        if not self.unlocked:
            # Vial firmware refuses macro changes until the keyboard is unlocked
            return msg
        offset, size = struct.unpack_from(">HB", msg, 1)
        if size > BUFFER_FETCH_CHUNK:
            raise SimulatorError("macro write of {} bytes does not fit into one packet".format(size))
        if offset + size > len(self.macro_buffer):
            raise SimulatorError("macro write past the end of macro memory")
        self.macro_buffer[offset:offset + size] = msg[4:4 + size]
        self.writes.append(("macro", offset, size))
        return msg[0:4]

    def _set_keycode(self, msg):
        layer, row, col, code = struct.unpack_from(">BBBH", msg, 1)
        if layer >= self.layers or row >= self.rows or col >= self.cols:
            return msg[0:6]
        # stricter than the real firmware, which only filters QK_BOOT in set_buffer, not in single-key writes:
        # server code must not rely on this check
        code = self._firewall(code)
        self.keymap[layer][row][col] = code
        self.writes.append(("keycode", layer, row, col, code))
        return msg[0:6]

    def _get_keyboard_value(self, msg):
        sub = msg[1]
        if sub == VIA_LAYOUT_OPTIONS:
            return struct.pack(">BBI", msg[0], sub, self.layout_options)
        if sub == VIA_SWITCH_MATRIX_STATE:
            # Vial hides the matrix (a would-be keylogger) until unlocked; QMK leaves it out when it might not
            # fit into the reply, using this conservative estimate of the row size
            if not self.unlocked or (self.cols // 8 + 1) * self.rows > 28:
                return msg[0:2]
            row_size = math.ceil(self.cols / 8)
            out = msg[0:2]
            for row in range(self.rows):
                bits = 0
                for col in range(self.cols):
                    if (row, col) in self.pressed:
                        bits |= 1 << col
                out += bits.to_bytes(row_size, byteorder="big")
            return out
        raise SimulatorError("unknown keyboard value 0x{:02X}".format(sub))

    def _set_keyboard_value(self, msg):
        sub = msg[1]
        if sub == VIA_LAYOUT_OPTIONS:
            self.layout_options = struct.unpack_from(">I", msg, 2)[0]
            self.writes.append(("layout_options", self.layout_options))
            return msg[0:6]
        raise SimulatorError("unknown keyboard value 0x{:02X}".format(sub))

    def _lighting_get(self, msg):
        sub = msg[1]
        head = msg[0:2]
        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
            if sub == QMK_RGBLIGHT_COLOR:
                return head + bytes(self.rgblight["color"])
            key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
                   QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
            return head + bytes([self.rgblight[key]])
        if self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
            key = "brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"
            return head + bytes([self.backlight[key]])
        if self.vialrgb is not None:
            if sub == VIALRGB_GET_INFO:
                return head + struct.pack("<HB", 1, self.vialrgb["max_brightness"])
            if sub == VIALRGB_GET_MODE:
                return head + struct.pack("<HBBBB", self.vialrgb["mode"], self.vialrgb["speed"],
                                          *self.vialrgb["hsv"])
            if sub == VIALRGB_GET_SUPPORTED:
                after = struct.unpack_from("<H", msg, 2)[0]
                effects = [e for e in sorted(self.vialrgb["supported"]) if e > after][:15]
                effects += [NO_MORE] * (15 - len(effects))
                return head + struct.pack("<15H", *effects)
        raise SimulatorError("unsupported lighting query 0x{:02X}".format(sub))

    def _lighting_set(self, msg):
        sub = msg[1]
        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
            if sub == QMK_RGBLIGHT_COLOR:
                self.rgblight["color"] = (msg[2], msg[3])
            else:
                key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
                       QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
                self.rgblight[key] = msg[2]
        elif self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
            self.backlight["brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"] = msg[2]
        elif self.vialrgb is not None and sub == VIALRGB_SET_MODE:
            mode, speed, h, s, v = struct.unpack_from("<HBBBB", msg, 2)
            self.vialrgb["mode"], self.vialrgb["speed"], self.vialrgb["hsv"] = mode, speed, (h, s, v)
        else:
            raise SimulatorError("unsupported lighting change 0x{:02X}".format(sub))
        self.writes.append(("lighting", sub))
        return msg[0:2]

    def _lighting_save(self, msg):
        self.lighting_saved = True
        return msg[0:1]

    def _bootloader(self, msg):
        if not self.unlocked:
            return msg
        # the firmware answers first, then jumps to the bootloader: the keyboard drops off the bus
        self.bootloader_requested = True
        self.connected = False
        return msg

    # --- Vial commands ---

    def _vial(self, msg):
        sub = msg[1]
        if sub == CMD_VIAL_GET_KEYBOARD_ID:
            return struct.pack("<IQ", self.vial_protocol, self.uid)
        if sub == CMD_VIAL_GET_SIZE:
            return struct.pack("<I", len(self.compressed_definition))
        if sub == CMD_VIAL_GET_DEFINITION:
            page = struct.unpack_from("<I", msg, 2)[0]
            return self.compressed_definition[page * 32:(page + 1) * 32]
        if sub == CMD_VIAL_GET_ENCODER:
            layer, idx = msg[2], msg[3]
            return struct.pack(">HH", self.encoders.get((layer, idx, 0), 0), self.encoders.get((layer, idx, 1), 0))
        if sub == CMD_VIAL_SET_ENCODER:
            layer, idx, direction, code = struct.unpack_from(">BBBH", msg, 2)
            if layer >= self.layers or idx >= self.encoder_count:
                return b""
            direction = 1 if direction else 0
            code = self._firewall(code)
            self.encoders[(layer, idx, direction)] = code
            self.writes.append(("encoder", layer, idx, direction, code))
            return b""
        if sub == CMD_VIAL_GET_UNLOCK_STATUS:
            # unlock keys as (row, col) pairs; unused slots are (255, 255)
            keys = b"".join(bytes(rc) for rc in self.unlock_keys)
            return bytes([int(self.unlocked), int(self.unlock_in_progress)]) + keys + b"\xFF" * (30 - len(keys))
        if sub == CMD_VIAL_UNLOCK_START:
            self.unlock_in_progress = True
            self.unlock_counter = self.unlock_counter_max
            return b""
        if sub == CMD_VIAL_UNLOCK_POLL:
            if self.unlock_in_progress:
                if all(rc in self.pressed for rc in self.unlock_keys):
                    # counts down while every unlock key stays held
                    self.unlock_counter -= 1
                    if self.unlock_counter == 0:
                        self.unlocked, self.unlock_in_progress = True, False
                else:
                    self.unlock_counter = self.unlock_counter_max
            return bytes([int(self.unlocked), int(self.unlock_in_progress), self.unlock_counter])
        if sub == CMD_VIAL_LOCK:
            self.unlocked = False
            return b""
        if sub == CMD_VIAL_QMK_SETTINGS_QUERY:
            after = struct.unpack_from("<H", msg, 2)[0]
            qsids = [q for q in sorted(self.settings or {}) if q > after][:16]
            qsids += [NO_MORE] * (16 - len(qsids))
            return struct.pack("<16H", *qsids)
        if sub == CMD_VIAL_QMK_SETTINGS_GET:
            qsid = struct.unpack_from("<H", msg, 2)[0]
            if not self.settings or qsid not in self.settings:
                return b"\x01"
            return b"\x00" + self.settings[qsid].to_bytes(self._setting_width(qsid), byteorder="little")
        if sub == CMD_VIAL_QMK_SETTINGS_SET:
            qsid = struct.unpack_from("<H", msg, 2)[0]
            if not self.settings or qsid not in self.settings:
                return b"\x01"
            width = self._setting_width(qsid)
            self.settings[qsid] = int.from_bytes(msg[4:4 + width], byteorder="little")
            self.writes.append(("setting", qsid, self.settings[qsid]))
            return b"\x00"
        if sub == CMD_VIAL_QMK_SETTINGS_RESET:
            if self.settings is not None:
                self.settings = dict(self.default_settings)
            return b""
        if sub == CMD_VIAL_DYNAMIC_ENTRY_OP:
            return self._dynamic(msg)
        raise SimulatorError("unknown Vial command 0x{:02X}".format(sub))

    @staticmethod
    def _setting_width(qsid):
        # .get: indexing the codec's defaultdict would add an empty entry for an unknown qsid
        fields = QmkSettingsCodec.fields().get(qsid)
        return fields[0].get("width", 1) if fields else UNKNOWN_SETTING_WIDTH

    DYNAMIC = {
        # get command: (attribute, struct format, set command, fields the firmware passes through the firewall)
        DYNAMIC_VIAL_TAP_DANCE_GET: ("tap_dance", "<HHHHH", DYNAMIC_VIAL_TAP_DANCE_SET, (0, 1, 2, 3)),
        DYNAMIC_VIAL_COMBO_GET: ("combos", "<HHHHH", DYNAMIC_VIAL_COMBO_SET, (4,)),
        DYNAMIC_VIAL_KEY_OVERRIDE_GET: ("key_overrides", "<HHHBBBB", DYNAMIC_VIAL_KEY_OVERRIDE_SET, (1,)),
        DYNAMIC_VIAL_ALT_REPEAT_KEY_GET: ("alt_repeat_keys", "<HHBB", DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, (0, 1)),
    }

    def _dynamic(self, msg):
        op = msg[2]
        if op == DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES:
            counts = struct.pack("BBBB", len(self.tap_dance), len(self.combos), len(self.key_overrides),
                                 len(self.alt_repeat_keys))
            return counts + b"\x00" * (31 - len(counts)) + bytes([self.features])
        for get_op, (attr, fmt, set_op, guarded) in self.DYNAMIC.items():
            entries = getattr(self, attr)
            if op == get_op:
                idx = msg[3]
                if idx >= len(entries):
                    return b"\x01"
                return b"\x00" + struct.pack(fmt, *entries[idx])
            if op == set_op:
                idx = msg[3]
                if idx >= len(entries):
                    return b"\x01"
                entry = list(struct.unpack_from(fmt, msg, 4))
                for field in guarded:
                    entry[field] = self._firewall(entry[field])
                entries[idx] = tuple(entry)
                self.writes.append((attr, idx, entries[idx]))
                return b"\x00"
        raise SimulatorError("unknown dynamic entry op 0x{:02X}".format(op))
