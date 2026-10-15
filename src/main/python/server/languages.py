# SPDX-License-Identifier: GPL-2.0-or-later
""" Keyboard languages: the layout the computer types with (Polish, German, ...), which changes what a key's label
should say. The labels come from Vial's own keyboard layouts (keymaps.py, keymap/); describe() applies them. """
import re
import unicodedata

from keymaps import KEYMAPS

DEFAULT = "en-us"
DEFAULT_NAME = "English (US)"
""" Vial's first layout ("QWERTY") relabels nothing: keycodes are named after the US layout """


def _slug(name):
    """ "French (BÉPO)" -> "french-bepo" """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


_LANGUAGES = {DEFAULT: (DEFAULT_NAME, KEYMAPS[0][1])}
for _name, _keymap in KEYMAPS[1:]:
    _LANGUAGES[_slug(_name)] = (_name, _keymap)


def catalogue():
    """ [{"id": "polish-qwerty", "name": "Polish (QWERTY)"}, ...], English (US) first """
    return [{"id": lang, "name": name} for lang, (name, _) in _LANGUAGES.items()]


def overrides(lang):
    """ {qmk_id: Vial label} of a keyboard language; raises ValueError for an unknown one """
    if lang not in _LANGUAGES:
        raise ValueError("unknown keyboard language: {}".format(lang))
    return _LANGUAGES[lang][1]
