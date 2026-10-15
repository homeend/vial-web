import pytest

from server import languages
from server.describe import describe, keyboard_language, legend_of

POLISH = "polish-qwerty"
GERMAN = "german-qwertz"


@pytest.fixture(autouse=True)
def loaded_keyboard(corne_keyboard):
    """ The keycode tables are those of a loaded (protocol 6) keyboard """
    return corne_keyboard


def described(code, lang):
    with keyboard_language(languages.overrides(lang)):
        return describe(code)


def legend(main, shifted=None, alt_gr=None):
    return {"main": main, "shifted": shifted, "altGr": alt_gr}


# ---------- the list of languages ----------

def test_default_language_is_english_us_without_overrides():
    first = languages.catalogue()[0]
    assert first == {"id": languages.DEFAULT, "name": "English (US)"}
    assert languages.DEFAULT == "en-us"
    assert languages.overrides(languages.DEFAULT) == {}


def test_every_vial_keyboard_layout_is_offered_once():
    from keymaps import KEYMAPS
    ids = [entry["id"] for entry in languages.catalogue()]
    assert len(ids) == len(set(ids)) == len(KEYMAPS)
    assert {"id": POLISH, "name": "Polish (QWERTY)"} in languages.catalogue()
    assert all(i.isascii() and i == i.lower() and " " not in i for i in ids)


def test_unknown_language_is_an_error():
    with pytest.raises(ValueError, match="unknown keyboard language"):
        languages.overrides("klingon")


# ---------- reading Vial's labels ----------

@pytest.mark.parametrize("label, expected", [
    ("A", legend("A")),
    ("!\n1", legend("1", "!")),  # shifted over unshifted
    ("Caps\nLock", legend("Caps Lock")),  # one label, broken in two lines
    ("Boot-\nloader", legend("Bootloader")),
    ("Mouse\nWheel\nUp", legend("Mouse Wheel Up")),
    ("~ \n` ", legend("`", "~")),  # Polish: trailing spaces only
    ("A\n   ą", legend("A", None, "ą")),  # Polish: AltGr character in the lower right
    ("!  ¹\n1  ¡", legend("1", "!", "¡")),  # Canadian CSA: shifted and unshifted, with and without AltGr
    ("@   \n2  ²", legend("2", "@", "²")),
    ("1\n&", legend("&", "1")),  # French: the shifted character is the digit
    ("AltGr", legend("AltGr")),
    ("", legend("")),
])
def test_legend_of(label, expected):
    assert legend_of(label) == expected


def test_every_language_label_reads_as_a_legend():
    """ Except the few keys a layout leaves blank on purpose (Colemak DH ISO: KC_B) """
    for entry in languages.catalogue():
        for qmk_id, label in languages.overrides(entry["id"]).items():
            result = legend_of(label)
            assert result["main"] or not label.strip(), (entry["id"], qmk_id, label)
            assert all("\n" not in (part or "") for part in result.values()), (entry["id"], qmk_id, label)


# ---------- describing keys in a language ----------

def test_polish_letter_shows_its_alt_gr_character():
    result = described("KC_A", POLISH)
    assert (result["tap"], result["legend"]) == ("A", legend("A", None, "ą"))


def test_polish_alt_gr_with_a_letter_is_the_polish_letter():
    result = described("RALT(KC_A)", POLISH)
    assert (result["kind"], result["tap"], result["legend"]) == ("basic", "ą", legend("ą"))


def test_alt_gr_with_a_key_that_has_no_alt_gr_character_stays_generic():
    assert described("RALT(KC_B)", POLISH)["tap"] == "AltGr+B"


def test_polish_mod_tap_and_layer_tap_keep_the_alt_gr_character():
    assert described("RALT_T(KC_E)", POLISH)["legend"] == legend("E", None, "ę")
    assert described("LT1(KC_L)", POLISH)["legend"]["altGr"] == "ł"


def test_polish_right_alt_is_alt_gr():
    assert described("KC_RALT", POLISH)["tap"] == "AltGr"


def test_german_keys_are_relabelled():
    assert described("KC_Y", GERMAN)["tap"] == "Z"
    assert described("KC_7", GERMAN)["legend"] == legend("7", "/")


def test_german_shifted_key_is_the_german_shifted_character():
    assert described("LSFT(KC_7)", GERMAN)["tap"] == "/"


def test_english_has_no_alt_gr_characters():
    assert describe("KC_A")["legend"] == legend("A")
    assert describe("RALT(KC_A)")["tap"] == "AltGr+A"


def test_language_applies_only_inside_the_block():
    with keyboard_language(languages.overrides(POLISH)):
        assert describe("KC_A")["legend"]["altGr"] == "ą"
    assert describe("KC_A")["legend"]["altGr"] is None
