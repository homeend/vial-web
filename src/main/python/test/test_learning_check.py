""" The lesson set checker (server.learning_check) """
import copy
import json
import os

from server import learning_check
from server.learning_check import Report, check, check_set, export_chars

EXAMPLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "docs", "learning",
                        "examples")


def lines(text, size):
    """ A text repeated to at least `size` characters, as exercise lines of under 80 characters """
    words = (text + " ") * (size // (len(text) + 1) + 1)
    out, line = [], ""
    for word in words.split():
        if len(line) + len(word) + 1 > 76:
            out.append(line)
            line = ""
        line = (line + " " + word).strip()
    out.append(line)
    return out


def minimal_set():
    """ A lesson set that passes with no warnings: lesson 1 teaches a, b (the keys r1c1 and r1c2 of EXPORT) """
    return {
        "format": "vial-web-lessons/1", "id": "mini", "title": "Mini", "language": "en",
        "layout": {"name": "Mini", "uid": "0000000000000001", "hash": "sha256:0123456789abcdef"},
        "lessons": [{
            "id": "01", "title": "New keys: a and b", "guidance": "Rest on a and b.",
            "new": [{"char": "a", "key": "r1c1", "layer": 0, "via": "tap"},
                    {"char": "b", "key": "r1c2", "layer": 0, "via": "tap"}],
            "exercises": [
                {"id": "01-n1", "kind": "new-keys", "title": "New key exercise", "lines": lines("abab baba", 240)},
                {"id": "01-k1", "kind": "keys", "title": "Key exercise", "lines": lines("ab ab ba ba", 220)},
                {"id": "01-w1", "kind": "words", "title": "Word exercise", "lines": lines("abba baab ab", 460)},
            ],
        }],
    }


EXPORT = {
    "format": "vial-web-layout-export/1", "hash": "sha256:0123456789abcdef",
    "keys": [{"id": "r1c1", "chars": {"0": {"tap": "a", "shift": "A"}}},
             {"id": "r1c2", "chars": {"0": {"tap": "b", "shift": "B"}, "1": {"tap": "1"}}}],
}


def test_a_minimal_valid_set_passes():
    assert check_set(minimal_set()) == ([], [])
    assert check_set(minimal_set(), EXPORT) == ([], [])


def test_an_untaught_character_is_an_error():
    data = minimal_set()
    data["lessons"][0]["exercises"][1]["lines"].append("ab cab")
    errors, warnings = check_set(data)
    assert errors == ["exercise 01-k1: uses characters not taught yet: 'c'"]
    assert warnings == []


def test_a_new_key_that_does_not_type_the_character_is_an_error():
    data = minimal_set()
    data["lessons"][0]["new"][1]["layer"] = 1  # r1c2 types "1" there, not "b"
    data["lessons"][0]["new"].append({"char": "c", "key": "r9c9", "layer": 0, "via": "tap"})
    data["lessons"][0]["exercises"][0]["lines"][0] += " cab"
    errors, warnings = check_set(data, EXPORT)
    assert errors == ["lesson 01/new[1]: key r1c2 layer 1 tap types '1', not 'b'",
                      "lesson 01/new[2]: key r9c9 is not in the layout export"]
    # without the export the keys aren't checked, and nothing is wrong
    assert check_set(data) == ([], [])


def test_check_set_returns_errors_and_warnings():
    data = minimal_set()
    data["layout"]["hash"] = "sha256:ffffffffffffffff"
    data["lessons"][0]["exercises"][2]["lines"] = ["abba baab"]  # too short for a word exercise
    data["lessons"][0]["new"].append({"char": "c", "key": "r1c1", "layer": 0, "via": "tap"})
    errors, warnings = check_set(data, EXPORT)
    assert errors == ["lesson 01/new[2]: key r1c1 layer 0 tap types 'a', not 'c'"]
    assert warnings == ["layout/hash: differs from the export's hash: the set was made from another layout",
                        "exercise 01-w1: 9 characters; words should have 450-600",
                        "lesson 01: new character 'c' never appears in its exercises"]


def test_header_problems():
    assert check_set("not a set") == (["(root): not a JSON object"], [])
    data = minimal_set()
    data["format"], data["id"], data["layout"] = "x", "bad id", None
    errors, _ = check_set(data)
    assert errors == ["format: expected vial-web-lessons/1, got 'x'", "id: letters, digits, - and _ only",
                      "layout: missing"]
    errors, _ = check_set({"format": "vial-web-lessons/1", "id": "x", "title": "t", "language": "en",
                           "layout": {"name": "n", "uid": "u", "hash": "h"}, "lessons": []})
    assert errors == ["lessons: missing or empty"]


def test_repeated_ids_and_missing_parts():
    data = minimal_set()
    lesson = copy.deepcopy(data["lessons"][0])
    lesson["new"], lesson["review"], lesson["guidance"] = [], True, ""
    data["lessons"].append(lesson)
    errors, warnings = check_set(data)
    assert "lessons[1]: lesson id '01' repeats" in errors
    assert "lesson 01: missing guidance" in errors
    assert "lesson 01/exercises[0]: exercise id '01-n1' repeats" in errors
    assert "lesson 01: has no blind exercise" in warnings and "lesson 01: has no text exercise" in warnings


def test_check_takes_what_was_known_before_a_batch():
    data = minimal_set()
    data["lessons"][0]["exercises"][1]["lines"].append("ab cab")
    report = Report()
    check(data, None, report, known_before="c", first_lesson=3)
    assert report.errors == []
    # as lesson 4 of its course, it should have the blind and text exercises too
    assert report.warnings == ["lesson 01: has no blind exercise", "lesson 01: has no text exercise"]


def test_export_chars():
    assert export_chars(EXPORT) == {"r1c1": {"0": {"tap": "a", "shift": "A"}},
                                    "r1c2": {"0": {"tap": "b", "shift": "B"}, "1": {"tap": "1"}}}
    assert export_chars({}) == {}


def test_the_worked_example_passes_against_its_export():
    with open(os.path.join(EXAMPLES, "corne-sim-en.json"), encoding="utf-8") as inf:
        data = json.load(inf)
    with open(os.path.join(EXAMPLES, "corne-sim-layout-export.json"), encoding="utf-8") as inf:
        export = json.load(inf)
    assert check_set(data, export) == ([], [])


def test_schema_check_without_jsonschema_only_says_so(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def no_jsonschema(name, *args, **kwargs):
        if name == "jsonschema":
            raise ImportError("not here")
        return real_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", no_jsonschema)
    report = Report()
    assert learning_check.schema_check(minimal_set(), report) == "schema: jsonschema not installed, structural " \
                                                                  "checks only"
    assert report.errors == []
