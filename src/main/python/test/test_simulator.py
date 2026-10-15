import pytest

import transport
from protocol.key_override import KeyOverrideEntry
from protocol.keyboard_comm import Keyboard
from simulator.corne import make_corne, encode
from simulator.device import SimulatedHidDevice


@pytest.fixture
def corne():
    """ (simulated keyboard, Keyboard object loaded from it through the real protocol code) """
    vk = make_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    return vk, kb


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
    assert {"caps_word", "layer_lock"} <= kb.supported_features


def test_reload_reads_macros_settings_and_lighting(corne):
    vk, kb = corne
    assert kb.save_macro()[0] == [["text", "git status"], ["tap", "KC_ENTER"]]
    assert kb.save_macro()[1][4] == ["delay", 50]
    assert (kb.macro_count, kb.macro_memory) == (16, 900)
    assert kb.settings[7] == 200
    assert kb.lighting_vialrgb and kb.rgb_mode == 2
    assert kb.rgb_supported_effects == set(range(9))


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
