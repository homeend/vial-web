import codecs
import json
import os

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


def test_set_on_garbage_file_moves_it_aside(tmp_path):
    path = tmp_path / "names.json"
    path.write_text('{"ABC": {"layers": {"0": "ba', encoding="utf-8")
    store = NamesStore(str(path))
    assert store.set("ABC", "layers", 1, "sym")["layers"] == {"1": "sym"}
    assert (tmp_path / "names.json.corrupt").read_text(encoding="utf-8").startswith('{"ABC"')
    path.write_text("again bad", encoding="utf-8")
    store.set("ABC", "layers", 2, "x")
    assert (tmp_path / "names.json.corrupt").read_text(encoding="utf-8") == "again bad"


def test_read_error_does_not_wipe_names(tmp_path, monkeypatch):
    store = NamesStore(str(tmp_path / "names.json"))
    store.set("ABC", "layers", 0, "base")
    real_open = open

    def deny(path, *args, **kwargs):
        if str(path) == store.path and "r" in (args[0] if args else kwargs.get("mode", "r")):
            raise PermissionError("denied")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", deny)
    assert store.get("ABC")["layers"] == {}
    with pytest.raises(PermissionError):
        store.set("ABC", "layers", 1, "x")
    monkeypatch.undo()
    assert store.get("ABC")["layers"] == {"0": "base"}


@pytest.mark.parametrize("content", [
    '{"ABC": "x"}', '{"ABC": {"layers": "xy"}}', '{"ABC": {"layers": [1]}}',
    '{"ABC": {"layers": {"0": 5, "1": "ok"}}}', '[1, 2]',
])
def test_wrong_shapes_are_tolerated(tmp_path, content):
    path = tmp_path / "names.json"
    path.write_text(content, encoding="utf-8")
    store = NamesStore(str(path))
    assert set(store.get("ABC")) == {"layers", "tapDance", "macros"}
    assert all(isinstance(v, str) for v in store.get("ABC")["layers"].values())
    assert store.set("ABC", "macros", 3, "m")["macros"] == {"3": "m"}


def test_failed_replace_leaves_no_temp_file(tmp_path, monkeypatch):
    store = NamesStore(str(tmp_path / "names.json"))

    def boom(src, dst):
        raise OSError("boom")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError):
        store.set("ABC", "layers", 0, "x")
    assert list(tmp_path.iterdir()) == []


def test_truncation_never_leaves_trailing_space(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    assert store.set("ABC", "layers", 0, "a" * 39 + " b")["layers"]["0"] == "a" * 39


def test_file_with_a_byte_order_mark_is_read(tmp_path):
    """ Windows Notepad may save UTF-8 with a BOM; that is not a corrupt file """
    path = tmp_path / "names.json"
    path.write_bytes(codecs.BOM_UTF8 + json.dumps({"ABC": {"layers": {"0": "base"}}}).encode("utf-8"))
    store = NamesStore(str(path))
    assert store.get("ABC")["layers"] == {"0": "base"}
    assert store.set("ABC", "layers", 1, "nav")["layers"] == {"0": "base", "1": "nav"}
    assert not (tmp_path / "names.json.corrupt").exists()


# ---------- moving layer names (Arrange layers) ----------

def test_move_layers_moves_names_with_their_layers(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    store.set("K", "layers", 1, "Sym")
    store.set("K", "layers", 3, "Num")
    store.set("K", "layers", 9, "Past the order")
    store.set("K", "macros", 1, "Mail")
    names = store.move_layers("K", [0, 3, 1, 2])
    # layer 2 had no name: position 3 has none either; names past the order and of other kinds stay
    assert names["layers"] == {"1": "Num", "2": "Sym", "9": "Past the order"}
    assert names["macros"] == {"1": "Mail"}
    assert store.move_layers("K", [0, 2, 3, 1])["layers"] == {"1": "Sym", "3": "Num", "9": "Past the order"}


def test_move_layers_writes_nothing_when_no_name_moves(tmp_path):
    path = tmp_path / "names.json"
    store = NamesStore(str(path))
    assert store.move_layers("K", [0, 2, 1]) == {"layers": {}, "tapDance": {}, "macros": {}}
    assert not path.exists()


def test_move_layers_writes_nothing_when_the_names_stay(tmp_path, monkeypatch):
    store = NamesStore(str(tmp_path / "names.json"))
    store.set("K", "layers", 0, "Base")
    store.set("K", "layers", 3, "Num")
    store.set("K", "macros", 1, "Mail")

    def no_write(data):
        raise AssertionError("written")
    monkeypatch.setattr(store, "_save", no_write)
    # layers 1 and 2 change places, neither has a name
    assert store.move_layers("K", [0, 2, 1, 3])["layers"] == {"0": "Base", "3": "Num"}


def test_move_layers_keeps_keys_that_are_not_a_layer_number_as_the_store_writes_it(tmp_path):
    # a hand-edited file: "01" and "²" (a digit int() refuses) are no layer's name (the UI looks up "1"), and stay as
    # they are, never lost
    path = tmp_path / "names.json"
    path.write_text(json.dumps({"K": {"layers": {"01": "Odd", "²": "Sup", "1": "Sym", " 2": "Spaced"}}}),
                    encoding="utf-8")
    store = NamesStore(str(path))
    assert store.move_layers("K", [0, 2, 1])["layers"] == {"01": "Odd", "²": "Sup", "2": "Sym", " 2": "Spaced"}


def test_move_layers_is_one_write_that_keeps_the_old_file_on_failure(tmp_path, monkeypatch):
    path = tmp_path / "names.json"
    store = NamesStore(str(path))
    store.set("K", "layers", 1, "Sym")
    before = path.read_bytes()

    def broken(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "replace", broken)
    with pytest.raises(OSError):
        store.move_layers("K", [0, 2, 1])
    assert path.read_bytes() == before
    assert not (tmp_path / "names.json.tmp").exists()
