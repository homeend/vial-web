""" Layer numbers in keycodes: describe.py's ranges come from one definition (REFERENCES) """


def test_describes_ranges_come_from_the_one_definition():
    # describe.py's LM range and tri-layer keys are derived from REFERENCES: the firmware's values
    from server.describe import QK_LAYER_MOD, TRI_LAYER_KEYS
    assert QK_LAYER_MOD == {6: (0x5000, 0x51FF), 5: (0x5900, 0x59FF)}
    assert TRI_LAYER_KEYS == {6: {0x7C77: 1, 0x7C78: 2}, 5: {0x5F10: 1, 0x5F11: 2}}
