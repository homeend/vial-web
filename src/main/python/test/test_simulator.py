import struct

import pytest

import transport
from protocol.constants import CMD_VIA_SET_KEYCODE, CMD_VIA_MACRO_SET_BUFFER, CMD_VIA_MACRO_GET_BUFFER, \
    CMD_VIA_KEYMAP_GET_BUFFER, CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE, CMD_VIA_VIAL_PREFIX, \
    CMD_VIAL_SET_ENCODER, CMD_VIAL_GET_ENCODER, CMD_VIAL_QMK_SETTINGS_GET, CMD_VIAL_QMK_SETTINGS_SET, \
    CMD_VIAL_DYNAMIC_ENTRY_OP, DYNAMIC_VIAL_TAP_DANCE_SET, DYNAMIC_VIAL_COMBO_SET, DYNAMIC_VIAL_KEY_OVERRIDE_SET, \
    DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, CMD_VIAL_QMK_SETTINGS_RESET, CMD_VIA_SET_KEYBOARD_VALUE, VIA_LAYOUT_OPTIONS
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.key_override import KeyOverrideEntry
from protocol.keyboard_comm import Keyboard
from protocol.qmk_settings_codec import QmkSettingsCodec
from simulator.corne import make_corne, encode
from simulator.device import SimulatedHidDevice
from simulator.virtual_keyboard import VirtualKeyboard, SimulatorError, CMD_VIA_BOOTLOADER_JUMP, UNLOCK_COUNTER_MAX, \
    FIRMWARE_UNLOCK_POLL_GAP, WRITE_COMMANDS, VIAL_WRITE_COMMANDS, DYNAMIC_SETS
from transport import MSG_LEN

QK_BOOT = 0x7C00  # protocol 6

# 1 row x 2 columns plus one encoder
TINY = {"name": "Tiny", "matrix": {"rows": 1, "cols": 2},
        "layouts": {"keymap": [["0,0", "0,1", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


@pytest.fixture
def corne():
    """ (simulated keyboard, Keyboard object loaded from it through the real protocol code) """
    vk = make_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    return vk, kb


@pytest.fixture
def locked(corne):
    """ The Corne, locked through the protocol """
    vk, kb = corne
    kb.lock()
    assert kb.get_unlock_status() == 0
    return vk, kb


def send(vk, data):
    """ One raw request straight to the simulated keyboard """
    return vk.process(data + b"\x00" * (MSG_LEN - len(data)))


def send_through_device(vk, data):
    """ One raw request through the hidapi stand-in, which checks the reply fits into a report """
    return transport.hid_send(SimulatedHidDevice(vk), data)


def dynamic_set(op, idx, fmt, *values):
    return struct.pack("BBBB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_DYNAMIC_ENTRY_OP, op, idx) + struct.pack(fmt, *values)


# ---------- loading through the real protocol code ----------

def test_reload_reads_geometry_and_identity(corne):
    vk, kb = corne
    assert (kb.layers, kb.rows, kb.cols) == (4, 8, 6)
    assert len(kb.keys) == 42
    assert kb.vial_protocol == 6
    assert kb.keyboard_id == 0x5EEDC0DE00420042


def test_reload_reads_keymap(corne):
    vk, kb = corne
    assert kb.layout[(0, 1, 1)] == "LT2(KC_S)"
    assert kb.layout[(0, 1, 4)] == "LSFT_T(KC_T)"
    assert kb.layout[(0, 3, 5)] == "TD(0)"
    assert kb.layout[(0, 7, 5)] == "M0"
    assert kb.layout[(0, 7, 3)] == "OSL(3)"
    assert kb.layout[(1, 0, 0)] == "KC_TRNS"


def test_reload_reads_dynamic_entries(corne):
    vk, kb = corne
    assert kb.tap_dance_entries[0] == ("KC_TAB", "KC_NO", "KC_CAPSLOCK", "KC_NO", 200)
    assert kb.combo_entries[0] == ("KC_K", "KC_Y", "KC_NO", "KC_NO", "KC_ESCAPE")
    assert kb.key_override_entries[0].save()["replacement"] == "KC_DELETE"
    assert kb.alt_repeat_key_count == 4
    ark = kb.alt_repeat_key_entries[0]
    assert (ark.keycode, ark.alt_keycode, ark.allowed_mods) == ("KC_LEFT", "KC_RIGHT", 0x02)
    assert (ark.options.enabled, ark.options.bidirectional, ark.options.ignore_mod_handedness,
            ark.options.default_to_this_alt_key) == (True, True, True, False)
    assert not kb.alt_repeat_key_entries[1].options.enabled
    assert {"caps_word", "layer_lock"} <= kb.supported_features


def test_reload_reads_macros_settings_and_lighting(corne):
    vk, kb = corne
    assert kb.save_macro()[0] == [["text", "git status"], ["tap", "KC_ENTER"]]
    assert kb.save_macro()[1][4] == ["delay", 50]
    assert (kb.macro_count, kb.macro_memory) == (16, 900)
    assert kb.settings[7] == 200
    assert kb.lighting_vialrgb and kb.rgb_mode == 2
    assert kb.rgb_supported_effects == set(range(9))


def test_sample_settings_have_no_legacy_bitfield(corne):
    vk, kb = corne
    # qsid 8 is the legacy bitfield for Permissive Hold / Retro Tapping, which 22-24 replace
    assert 8 not in kb.supported_settings
    assert {7, 22, 23, 24, 25} <= kb.supported_settings


def test_writes_reach_the_simulator(corne):
    vk, kb = corne
    kb.set_key(0, 0, 0, "KC_A")
    assert vk.keymap[0][0][0] == encode("KC_A")

    kb.tap_dance_set(1, ("KC_A", "KC_B", "KC_C", "KC_D", 250))
    assert vk.tap_dance[1] == (encode("KC_A"), encode("KC_B"), encode("KC_C"), encode("KC_D"), 250)

    kb.combo_set(1, ("KC_Q", "KC_W", "KC_NO", "KC_NO", "KC_TAB"))
    assert vk.combos[1] == (encode("KC_Q"), encode("KC_W"), 0, 0, encode("KC_TAB"))

    kb.key_override_set(1, KeyOverrideEntry(("KC_A", "KC_B", 1, 0, 0, 0, 0x80)))
    assert vk.key_overrides[1] == (encode("KC_A"), encode("KC_B"), 1, 0, 0, 0, 0x80)

    kb.qmk_settings_set(7, 175)
    assert vk.settings[7] == 175

    kb.set_vialrgb_mode(5)
    assert vk.vialrgb["mode"] == 5

    # and they come back through the protocol
    kb.reload()
    assert kb.layout[(0, 0, 0)] == "KC_A"
    assert kb.tap_dance_entries[1] == ("KC_A", "KC_B", "KC_C", "KC_D", 250)
    assert kb.combo_entries[1] == ("KC_Q", "KC_W", "KC_NO", "KC_NO", "KC_TAB")
    assert kb.key_override_entries[1].save() == KeyOverrideEntry(("KC_A", "KC_B", 1, 0, 0, 0, 0x80)).save()
    assert kb.settings[7] == 175
    assert kb.rgb_mode == 5


def command_of(msg):
    """ What a request asks: ("via", command), ("vial", command) or ("dynamic", operation) """
    if msg[0] == CMD_VIA_VIAL_PREFIX:
        return ("dynamic", msg[2]) if msg[1] == CMD_VIAL_DYNAMIC_ENTRY_OP else ("vial", msg[1])
    return "via", msg[0]


def test_the_requests_counted_as_writes_are_those_the_simulator_logs():
    """ fail_writes() counts the requests is_write() names (WRITE_COMMANDS, VIAL_WRITE_COMMANDS, DYNAMIC_SETS): each
    request the simulator logs in `writes`, and the QMK settings reset, which logs nothing; no read, nor the lighting
    save, which changes nothing Vial reads back """
    seen = []
    for vk in (make_corne(), VirtualKeyboard(TINY, settings={7: 200})):
        process = vk.process

        def recording(msg, vk=vk, process=process):
            before = len(vk.writes)
            reply = process(msg)
            seen.append((command_of(bytes(msg)), VirtualKeyboard.is_write(bytes(msg)), len(vk.writes) > before))
            return reply
        vk.process = recording
        kb = Keyboard(SimulatedHidDevice(vk))
        kb.reload()
        kb.set_key(0, 0, 0, "KC_A")
        if kb.encoder_count:
            kb.set_encoder(0, 0, 1, "KC_B")
        else:
            kb.tap_dance_set(1, ("KC_A", "KC_B", "KC_C", "KC_D", 250))
            kb.combo_set(1, ("KC_Q", "KC_W", "KC_NO", "KC_NO", "KC_TAB"))
            kb.key_override_set(1, KeyOverrideEntry(("KC_A", "KC_B", 1, 0, 0, 0, 0x80)))
            kb.alt_repeat_key_set(1, AltRepeatKeyEntry(("KC_A", "KC_B", 0, 0x08)))
            kb.set_macro(b"hi\x00")
            kb.set_vialrgb_mode(5)
            kb.save_rgb()
            kb.matrix_poll()
        kb.qmk_settings_set(7, 175)
        kb.qmk_settings_reset()
        send_through_device(vk, struct.pack(">BBI", CMD_VIA_SET_KEYBOARD_VALUE, VIA_LAYOUT_OPTIONS, 1))
    logged = {command for command, _, wrote in seen if wrote}
    counted = {command for command, write, _ in seen if write}
    assert all(write for _, write, wrote in seen if wrote)
    assert counted - logged == {("vial", CMD_VIAL_QMK_SETTINGS_RESET)}
    assert counted == ({("via", c) for c in WRITE_COMMANDS} | {("vial", c) for c in VIAL_WRITE_COMMANDS}
                       | {("dynamic", op) for op in DYNAMIC_SETS})


def test_fail_writes_sets_how_before_when():
    # a write counted down on another thread (the device lock, not the backend's) sees `unplug` already set
    class Watched(VirtualKeyboard):
        def __setattr__(self, name, value):
            if name == "fail_write_in" and value is not None:
                armed.append(self.fail_unplugs)
            super().__setattr__(name, value)
    armed = []
    vk = Watched(TINY)
    vk.fail_writes(3, unplug=True)
    vk.fail_writes(2)
    assert armed == [True, False]


def test_macro_write_round_trips(corne):
    vk, kb = corne
    macros = kb.macros_deserialize(kb.macro)
    macros[2] = kb.macros_deserialize(kb.macro)[0]
    kb.set_macro(kb.macros_serialize(macros))
    assert vk.macros()[2] == vk.macros()[0] == b"git status\x01\x01\x28"


def test_matrix_state_reports_pressed_keys(corne):
    vk, kb = corne
    vk.press(1, 2)
    data = kb.matrix_poll()
    # one byte per row after the 2-byte header; bit = column
    assert data[2 + 1] == 1 << 2


def test_unplugged_keyboard_fails_cleanly(corne, monkeypatch):
    vk, kb = corne
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    vk.connected = False
    with pytest.raises(RuntimeError, match="failed to communicate"):
        kb.set_key(0, 0, 0, "KC_B")


def test_device_rejects_reports_without_report_id():
    dev = SimulatedHidDevice(make_corne())
    with pytest.raises(ValueError):
        dev.write(b"\x01" * 33)


def test_encode_matches_protocol_6_values():
    assert encode("KC_A") == 0x04
    assert encode("LT2(KC_S)") == 0x4216
    assert encode("TD(0)") == 0x5700
    assert encode("QK_BOOT") == QK_BOOT


# ---------- the lock, as Vial firmware enforces it ----------

def test_locked_keyboard_ignores_macro_writes(locked):
    vk, kb = locked
    before = bytes(vk.macro_buffer)
    kb.set_macro(b"oops\x00")
    assert bytes(vk.macro_buffer) == before
    assert not [w for w in vk.writes if w[0] == "macro"]


def test_locked_keyboard_hides_the_matrix(locked):
    vk, kb = locked
    vk.press(1, 2)
    data = kb.matrix_poll()
    assert data[2:] == b"\x00" * (MSG_LEN - 2)


def test_locked_keyboard_stores_kc_no_instead_of_qk_boot(locked):
    vk, kb = locked
    send(vk, struct.pack(">BBBBH", CMD_VIA_SET_KEYCODE, 0, 0, 0, QK_BOOT))
    assert vk.keymap[0][0][0] == 0

    send(vk, dynamic_set(DYNAMIC_VIAL_TAP_DANCE_SET, 0, "<HHHHH", QK_BOOT, QK_BOOT, QK_BOOT, QK_BOOT, 150))
    assert vk.tap_dance[0] == (0, 0, 0, 0, 150)

    a, b = encode("KC_A"), encode("KC_B")
    send(vk, dynamic_set(DYNAMIC_VIAL_COMBO_SET, 0, "<HHHHH", a, b, 0, 0, QK_BOOT))
    assert vk.combos[0] == (a, b, 0, 0, 0)

    send(vk, dynamic_set(DYNAMIC_VIAL_KEY_OVERRIDE_SET, 0, "<HHHBBBB", a, QK_BOOT, 1, 0, 0, 0, 0x80))
    assert vk.key_overrides[0] == (a, 0, 1, 0, 0, 0, 0x80)

    send(vk, dynamic_set(DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, 0, "<HHBB", QK_BOOT, QK_BOOT, 0, 8))
    assert vk.alt_repeat_keys[0] == (0, 0, 0, 8)


def test_locked_keyboard_stores_kc_no_instead_of_qk_boot_on_encoders():
    vk = VirtualKeyboard(TINY, unlocked=False)
    send(vk, struct.pack(">BBBBBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_SET_ENCODER, 0, 0, 0, QK_BOOT))
    send(vk, struct.pack(">BBBBBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_SET_ENCODER, 0, 0, 1, encode("KC_A")))
    assert send(vk, struct.pack("BBBB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_ENCODER, 0, 0))[:4] == \
        struct.pack(">HH", 0, encode("KC_A"))


def test_unlocked_keyboard_accepts_qk_boot(corne):
    vk, kb = corne
    send(vk, struct.pack(">BBBBH", CMD_VIA_SET_KEYCODE, 0, 0, 0, QK_BOOT))
    assert vk.keymap[0][0][0] == QK_BOOT
    send(vk, dynamic_set(DYNAMIC_VIAL_COMBO_SET, 0, "<HHHHH", 4, 5, 0, 0, QK_BOOT))
    assert vk.combos[0][4] == QK_BOOT


def test_locked_keyboard_ignores_bootloader_jump(locked):
    vk, kb = locked
    send(vk, bytes([CMD_VIA_BOOTLOADER_JUMP]))
    assert vk.connected and not vk.bootloader_requested


def test_unlocked_bootloader_jump_disconnects(corne):
    vk, kb = corne
    kb.reset()
    assert vk.bootloader_requested
    assert not vk.connected


def test_unlock_poll_needs_unlock_start(locked):
    vk, kb = locked
    assert kb.unlock_poll()[0] == 0
    assert kb.get_unlock_status() == 0
    kb.unlock_start()
    assert kb.get_unlock_in_progress() == 1
    vk.hold_unlock_keys(True)
    for remaining in range(UNLOCK_COUNTER_MAX - 1, 0, -1):
        assert kb.unlock_poll()[0:3] == bytes([0, 1, remaining])
    assert kb.unlock_poll()[0:3] == bytes([1, 0, 0])
    assert kb.get_unlock_status() == 1


def test_without_unlock_keys_every_poll_counts_down():
    vk = VirtualKeyboard(TINY, unlocked=False, unlock_counter_max=2)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.unlock_start()
    assert [kb.unlock_poll()[0:3] for _ in range(2)] == [bytes([0, 1, 1]), bytes([1, 0, 0])]


def test_unlock_counts_down_while_the_unlock_keys_are_held():
    vk = VirtualKeyboard(TINY, unlocked=False, unlock_keys=[(0, 0), (0, 1)], unlock_counter_max=3)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    assert kb.get_unlock_keys() == [(0, 0), (0, 1)]
    kb.unlock_start()
    vk.press(0, 0)
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
    vk.press(0, 1)
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 2])
    # letting go starts the countdown again
    vk.release(0, 1)
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
    vk.hold_unlock_keys(True)
    assert [kb.unlock_poll()[0:3] for _ in range(3)] == [bytes([0, 1, 2]), bytes([0, 1, 1]), bytes([1, 0, 0])]
    assert kb.get_unlock_status() == 1
    vk.hold_unlock_keys(False)
    assert vk.pressed == set()


@pytest.mark.parametrize("counter_max", [0, 256])
def test_unlock_countdown_starts_at_1_to_255(counter_max):
    with pytest.raises(SimulatorError):
        VirtualKeyboard(TINY, unlock_counter_max=counter_max)


def test_unlock_poll_gap_cannot_be_negative():
    with pytest.raises(SimulatorError):
        VirtualKeyboard(TINY, unlock_poll_gap=-0.1)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def gapped_keyboard(counter_max=3):
    clock = FakeClock()
    vk = VirtualKeyboard(TINY, unlocked=False, unlock_keys=[(0, 0)], unlock_counter_max=counter_max,
                         unlock_poll_gap=FIRMWARE_UNLOCK_POLL_GAP, clock=clock)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.unlock_start()
    vk.hold_unlock_keys(True)
    return vk, kb, clock


def test_polls_within_the_gap_never_count_down():
    vk, kb, clock = gapped_keyboard()
    for _ in range(9):
        # the start's timestamp stays, so every poll up to the gap after the start is too fast
        clock.now += FIRMWARE_UNLOCK_POLL_GAP / 10
        assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
    assert not vk.unlocked


def test_polls_slower_than_the_gap_count_down_and_unlock():
    vk, kb, clock = gapped_keyboard()
    replies = []
    for _ in range(3):
        clock.now += 0.2
        replies.append(kb.unlock_poll()[0:3])
    assert replies == [bytes([0, 1, 2]), bytes([0, 1, 1]), bytes([1, 0, 0])]
    assert kb.get_unlock_status() == 1


def test_a_too_fast_poll_starts_the_countdown_again():
    vk, kb, clock = gapped_keyboard()
    clock.now += 0.2
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 2])
    clock.now += 0.05
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
    # the too-fast poll did not move the count timer, so the next slow-enough poll counts again
    clock.now += 0.06
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 2])
    clock.now += 0.2
    assert kb.unlock_poll()[0:3] == bytes([0, 1, 1])
    clock.now += 0.2
    assert kb.unlock_poll()[0:3] == bytes([1, 0, 0])


def test_the_simulated_corne_has_tab_and_backspace_as_unlock_keys():
    vk = make_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    assert kb.get_unlock_keys() == [(0, 0), (4, 0)]
    assert vk.keymap[0][0][0] == encode("KC_TAB")
    assert vk.keymap[0][4][0] == encode("KC_BSPC")


def test_unlock_in_progress_only_answers_unlock_and_identity_commands(locked):
    vk, kb = locked
    kb.unlock_start()
    request = struct.pack(">BBBBH", CMD_VIA_SET_KEYCODE, 0, 0, 0, encode("KC_A"))
    assert send(vk, request) == request + b"\x00" * (MSG_LEN - len(request))
    assert vk.keymap[0][0][0] == encode("KC_TAB")
    assert kb.get_uid() == struct.pack("<Q", 0x5EEDC0DE00420042)
    vk.hold_unlock_keys(True)
    for _ in range(UNLOCK_COUNTER_MAX):
        if not kb.unlock_poll()[1]:
            break
    assert vk.unlocked
    kb.set_key(0, 0, 0, "KC_A")
    assert vk.keymap[0][0][0] == encode("KC_A")


# ---------- malformed packets ----------

def test_oversized_macro_write_is_rejected(corne):
    vk, kb = corne
    with pytest.raises(SimulatorError):
        send(vk, struct.pack(">BHB", CMD_VIA_MACRO_SET_BUFFER, 0, MSG_LEN - 3))
    assert len(vk.macro_buffer) == 900


@pytest.mark.parametrize("cmd", [CMD_VIA_MACRO_GET_BUFFER, CMD_VIA_KEYMAP_GET_BUFFER])
def test_oversized_buffer_read_returns_no_data(corne, cmd):
    vk, kb = corne
    request = struct.pack(">BHB", cmd, 0, 29)
    reply = send_through_device(vk, request)
    assert reply == request + b"\x00" * (MSG_LEN - len(request))


def test_matrix_too_big_for_a_report_is_left_out():
    vk = VirtualKeyboard({"matrix": {"rows": 20, "cols": 10}, "layouts": {"keymap": [["0,0"]]}})
    vk.press(0, 0)
    reply = send_through_device(vk, struct.pack("BB", CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE))
    assert reply[2:] == b"\x00" * (MSG_LEN - 2)


@pytest.mark.parametrize("layer, row, col", [(4, 0, 0), (0, 8, 0), (0, 0, 6), (255, 255, 255)])
def test_out_of_range_keycode_write_is_ignored(corne, layer, row, col):
    vk, kb = corne
    before = [[row[:] for row in layer] for layer in vk.keymap]
    send_through_device(vk, struct.pack(">BBBBH", CMD_VIA_SET_KEYCODE, layer, row, col, 4))
    assert vk.keymap == before
    assert not [w for w in vk.writes if w[0] == "keycode"]


@pytest.mark.parametrize("layer, idx", [(4, 0), (0, 1), (0, 255)])
def test_out_of_range_encoder_write_is_ignored(layer, idx):
    vk = VirtualKeyboard(TINY)
    send_through_device(vk, struct.pack(">BBBBBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_SET_ENCODER, layer, idx, 0, 4))
    assert vk.encoders == {}
    assert send(vk, struct.pack("BBBB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_ENCODER, layer, idx))[:4] == b"\x00" * 4


def test_encoder_write_in_range_works():
    vk = VirtualKeyboard(TINY)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    assert kb.encoder_count == 1
    kb.set_encoder(3, 0, 1, "KC_B")
    kb.reload()
    assert kb.encoder_layout[(3, 0, 1)] == "KC_B"


def test_unknown_setting_does_not_touch_the_codec():
    unknown = 0xF00
    assert unknown not in QmkSettingsCodec.fields()
    vk = VirtualKeyboard(TINY, settings={7: 200, unknown: 3})
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    assert unknown in kb.supported_settings and unknown not in kb.settings
    assert send(vk, struct.pack("<BBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_GET, unknown))[0] == 0
    send(vk, struct.pack("<BBHB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_SET, unknown, 5))
    assert vk.settings[unknown] == 5
    assert unknown not in QmkSettingsCodec.fields()


# ---------- the hidapi stand-in ----------

def test_closed_device_raises_like_hidapi():
    dev = SimulatedHidDevice(make_corne())
    dev.close()
    with pytest.raises(ValueError):
        dev.write(b"\x00" * (MSG_LEN + 1))
    with pytest.raises(ValueError):
        dev.read(MSG_LEN)
    # hid_send only retries OSError, so like real hidapi the error reaches the caller
    with pytest.raises(ValueError):
        transport.hid_send(dev, b"\x01")
    dev.open_path(b"simulated")
    assert transport.hid_send(dev, b"\x01")[0] == 1


@pytest.mark.parametrize("lookup", [
    lambda qsid: QmkSettingsCodec.qsid_serialize(qsid, 1),
    lambda qsid: QmkSettingsCodec.qsid_deserialize(qsid, b"\x01"),
])
def test_unknown_qsid_lookup_does_not_make_it_supported(lookup):
    assert not QmkSettingsCodec.is_qsid_supported(60000)
    with pytest.raises(RuntimeError):
        lookup(60000)
    assert not QmkSettingsCodec.is_qsid_supported(60000)
    assert 60000 not in QmkSettingsCodec.fields()


def test_firmware_without_the_bootloader_jump_answers_it_unhandled():
    vk = VirtualKeyboard(make_corne().definition, bootloader_jump=False)
    reply = send(vk, bytes([CMD_VIA_BOOTLOADER_JUMP]))
    assert reply[0] == 0xFF
    assert vk.connected and not vk.bootloader_requested


@pytest.mark.parametrize("levels", [0, 32])
def test_backlight_levels_are_checked(levels):
    with pytest.raises(SimulatorError):
        VirtualKeyboard(make_corne(lighting="qmk_backlight").definition, backlight_levels=levels)


@pytest.mark.parametrize("levels, start, level, brightness", [
    (5, 255, 3, 153),  # starts at the top level (BACKLIGHT_DEFAULT_LEVEL); 160 * 5 / 255 = level 3
    (1, 255, 0, 0),  # one level: starts on it; 160 * 1 / 255 = level 0
])
def test_backlight_brightness_steps_follow_the_levels(levels, start, level, brightness):
    vk = VirtualKeyboard(make_corne(lighting="qmk_backlight").definition, backlight_levels=levels)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    assert kb.backlight_brightness == start
    kb.set_qmk_backlight_brightness(160)
    kb.reload_rgb()
    assert vk.backlight["level"] == level and kb.backlight_brightness == brightness


def test_backlight_breathing_is_kept_at_once():
    """ via.c turns breathing on and off with backlight_enable/disable_breathing, which write the whole backlight
    config (breathing and the level it runs at) to EEPROM: no save needed. A brightness alone is kept only by a save. """
    vk = VirtualKeyboard(make_corne(lighting="qmk_backlight_rgblight").definition)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.set_qmk_backlight_brightness(255)
    assert vk.lighting_saved is None
    kb.set_qmk_backlight_effect(1)
    assert vk.lighting_saved == {"rgblight": None, "backlight": vk.backlight, "vialrgb": None}
    assert vk.lighting_saved["backlight"]["breathing"] and vk.lighting_saved["backlight"]["level"] == 3
    # a copy: a later brightness is not kept
    kb.set_qmk_backlight_brightness(0)
    assert vk.lighting_saved["backlight"]["level"] == 3
    # breathing that doesn't change writes nothing
    kb.set_qmk_backlight_effect(1)
    assert vk.lighting_saved["backlight"]["level"] == 3
    # after a save, a change of breathing updates the backlight only
    kb.set_qmk_backlight_brightness(85)
    kb.set_qmk_rgblight_effect(4)
    kb.save_rgb()
    kb.set_qmk_rgblight_effect(5)
    kb.set_qmk_backlight_brightness(170)
    kb.set_qmk_backlight_effect(0)
    assert vk.lighting_saved["rgblight"]["mode"] == 4
    assert vk.lighting_saved["backlight"] == {**vk.backlight, "level": 2, "breathing": False}


def test_backlight_breathing_is_not_kept_without_breathing_built_in():
    vk = VirtualKeyboard(make_corne(lighting="qmk_backlight").definition, backlight_breathing=False)
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.set_qmk_backlight_effect(1)
    assert vk.lighting_saved is None


@pytest.mark.parametrize("effect", [9, 0xFFFF])
def test_unsupported_vialrgb_effect_runs_solid_colour(corne, effect):
    """ vialrgb.c maps an effect it doesn't have to QMK mode 0, which rgb_matrix_mode_noeeprom raises to 1 (Solid
    colour), read back as VialRGB's Solid colour """
    vk, kb = corne
    kb.set_vialrgb_mode(5)
    kb.set_vialrgb_mode(effect)
    assert vk.vialrgb["enable"] and vk.vialrgb["mode"] == 2
    kb.reload_rgb()
    assert kb.rgb_mode == 2


def test_lighting_now_is_a_copy():
    vk = make_corne()
    vk.lighting_now()["vialrgb"]["mode"] = 7
    assert vk.vialrgb["mode"] == 2


def test_unknown_lighting_is_refused():
    with pytest.raises(ValueError):
        make_corne(lighting="rgb_matrix")
