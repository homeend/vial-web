import json

import pytest

from server.names import NamesStore, suggest_tap_dance_name, suggest_macro_name


def slot(kind, tap, code="X"):
    return {"kind": kind, "tap": tap, "code": code}


def test_missing_file_means_no_names(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    assert store.get("ABC") == {"layers": {}, "tapDance": {}, "macros": {}}


def test_set_get_and_clear(tmp_path):
    path = tmp_path / "sub" / "names.json"
    store = NamesStore(str(path))
    store.set("ABC", "layers", 1, "  symbols  ")
    store.set("ABC", "macros", 0, "git")
    assert store.get("ABC")["layers"] == {"1": "symbols"}
    assert json.loads(path.read_text(encoding="utf-8"))["ABC"]["macros"] == {"0": "git"}
    store.set("ABC", "layers", 1, "")
    assert store.get("ABC")["layers"] == {}
    assert store.get("OTHER")["macros"] == {}


def test_names_are_truncated(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    assert store.set("ABC", "tapDance", 0, "x" * 100)["tapDance"]["0"] == "x" * 40


def test_unknown_kind_rejected(tmp_path):
    with pytest.raises(ValueError):
        NamesStore(str(tmp_path / "names.json")).set("ABC", "combos", 0, "x")


def test_corrupt_file_is_ignored(tmp_path):
    path = tmp_path / "names.json"
    path.write_text("not json", encoding="utf-8")
    assert NamesStore(str(path)).get("ABC")["layers"] == {}


def test_suggest_tap_dance_name():
    slots = [slot("basic", "Tab"), slot("none", ""), slot("basic", "Caps\nLock"), slot("none", "")]
    assert suggest_tap_dance_name(slots) == "Tab / Caps Lock"
    assert suggest_tap_dance_name([slot("none", "")] * 4) == ""


def test_suggest_macro_name():
    assert suggest_macro_name([{"type": "text", "text": "git status", "keys": []}]) == "git status"
    assert suggest_macro_name([{"type": "tap", "text": None, "keys": [slot("basic", "Home")]}]) == "Home"
    assert suggest_macro_name([]) == ""
