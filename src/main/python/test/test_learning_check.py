""" The lesson set checker (server.learning_check) and its command line (util/learning/check_lessons.py) """
import copy
import importlib.util
import json
import os

import pytest

from server import learning_check
from server.learning_check import Report, check, check_set, export_chars

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
EXAMPLES = os.path.join(ROOT, "docs", "learning", "examples")
CLI = os.path.join(ROOT, "util", "learning", "check_lessons.py")


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
    assert errors == ["format: expected vial-web-lessons/1, got 'x'",
                      "id: 'bad id': letters, digits, - and _ only, at most 64 characters", "layout: missing"]
    errors, _ = check_set({"format": "vial-web-lessons/1", "id": "x", "title": "t", "language": "en",
                           "layout": {"name": "n", "uid": "0000000000000001", "hash": "sha256:0123456789abcdef"},
                           "lessons": []})
    assert errors == ["lessons: missing or empty"]


def test_repeated_ids_and_missing_parts():
    data = minimal_set()
    lesson = copy.deepcopy(data["lessons"][0])
    lesson["new"], lesson["review"], lesson["guidance"] = [], True, ""
    data["lessons"].append(lesson)
    errors, warnings = check_set(data)
    assert "lessons[1]: lesson id '01' repeats" in errors
    assert "lesson 01/guidance: empty" in errors
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


def test_the_schema_path_is_none_where_the_source_tree_is_too_shallow(tmp_path):
    """ PyInstaller unpacks the Linux one-file build to /tmp/_MEIxxxxxx: this file has four parents there, no docs
    folder above them. The path is found lazily and is None then, so that the checker (and the app) still import. """
    # not /tmp itself: on macOS it is a link to /private/tmp, and resolve() counts one parent more there
    assert learning_check.schema_path("/mei/_MEI123456/server/learning_check.py") is None
    assert learning_check.schema_path("/opt/vial/server/learning_check.py") is None
    assert learning_check.schema_path("/a/b/c/d/learning_check.py") is not None  # five parents: counted up
    found = learning_check.schema_path()
    assert found is not None and found.name == "lesson-set.schema.json" and found.is_file()
    assert learning_check.schema_path(__file__) == found  # test/ lies beside server/: four up is the same tree


def test_schema_check_without_the_schema_file_only_says_so(monkeypatch, tmp_path):
    """ A frozen build has no docs folder: "not found", and no error in the report for it (every import would fail
    otherwise). Run with a stand-in jsonschema, as the real one needn't be installed: the file is looked for first. """
    import sys
    import types
    stub = types.ModuleType("jsonschema")
    stub.Draft202012Validator = lambda schema: types.SimpleNamespace(iter_errors=lambda data: [])
    monkeypatch.setitem(sys.modules, "jsonschema", stub)
    for path in (None, tmp_path / "missing.json", tmp_path):
        monkeypatch.setattr(learning_check, "schema_path", lambda path=path: path)
        report = Report()
        assert learning_check.schema_check(minimal_set(), report) == "schema: not found", path
        assert report.errors == [] and report.warnings == []
    monkeypatch.undo()  # the real schema_path again, under the stand-in still
    monkeypatch.setitem(sys.modules, "jsonschema", stub)
    report = Report()
    assert learning_check.schema_check(minimal_set(), report) == "schema: checked against lesson-set.schema.json"
    assert report.errors == []


def test_a_report_lists_two_hundred_lines_at_most_then_counts_the_rest():
    """ {"lessons": [1, 1, 1, ...]} of thousands (a 4 MiB file could hold two million) is 200 errors and one closing
    line, not an error per entry in the reply; the warnings the same """
    data = minimal_set()
    data["lessons"] = [1] * 5000
    errors, warnings = check_set(data)
    assert len(errors) == learning_check.MAX_REPORTED + 1 == 201
    assert errors[0] == "lessons[0]: not an object" and errors[199] == "lessons[199]: not an object"
    assert errors[200] == "... and 4800 more"
    assert warnings == []
    # a lesson repeated: each copy repeats the ids (4 errors) and lacks new characters and two exercise kinds
    # (3 warnings)
    data = minimal_set()
    again = copy.deepcopy(data["lessons"][0])
    again["new"] = []
    data["lessons"] += [copy.deepcopy(again) for _ in range(3000)]
    errors, warnings = check_set(data)
    assert len(errors) == 201 and errors[-1] == "... and 11800 more"
    assert len(warnings) == 201 and warnings[-1] == "... and 8800 more"
    assert warnings[0] == "lesson 01: no new characters and not a review lesson"
    # exactly the limit: no closing line
    report = Report()
    for i in range(learning_check.MAX_REPORTED):
        report.error("e{}".format(i), "x")
    assert len(report.errors) == 200 and report.errors[-1] == "e199: x"
    report.warn("w", "y")
    assert report.warnings == ["w: y"]
    report.error("one more", "x")
    assert len(report.errors) == 201 and report.errors[-1] == "... and 1 more"
    # the counts say how many were found, not how many lines are listed (the CLI's summary line uses them)
    assert report.error_count == 201 and report.warning_count == 1


def mutated(path, value):
    """ A minimal set with the field at path (keys and indices) replaced by value """
    data = minimal_set()
    obj = data
    for p in path[:-1]:
        obj = obj[p]
    obj[path[-1]] = value
    return data


def nested(depth):
    """ A list nested depth deep (json.loads would make one up to the recursion limit) """
    out = []
    for _ in range(depth):
        out = [out]
    return out


L = ["lessons", 0]
E = L + ["exercises", 0]
N = L + ["new", 0]
SHAPES = {
    "root list": [], "root null": None, "root number": 5, "root string": "x",
    "lessons dict": mutated(["lessons"], {"a": 1}), "lessons string": mutated(["lessons"], "abc"),
    "lessons of numbers": mutated(["lessons"], [1, 2]), "lessons nested": mutated(["lessons"], nested(3000)),
    "title number": mutated(["title"], 7), "title nested": mutated(["title"], nested(3000)),
    "id list": mutated(["id"], ["x"]), "id with path": mutated(["id"], "../x"),
    "id with backslash": mutated(["id"], "a\\b"), "id huge": mutated(["id"], "x" * 100000),
    "layout list": mutated(["layout"], []), "layout uid number": mutated(["layout", "uid"], 5),
    "layout hash list": mutated(["layout", "hash"], ["sha256:0123456789abcdef"]),
    "language list": mutated(["language"], ["en"]), "notes nested": mutated(["notes"], nested(3000)),
    "format nested": mutated(["format"], nested(3000)), "format huge": mutated(["format"], "x" * 100000),
    "lesson id list": mutated(L + ["id"], ["01"]), "lesson id dict": mutated(L + ["id"], {}),
    "lesson title number": mutated(L + ["title"], 3), "guidance list": mutated(L + ["guidance"], []),
    "review string": mutated(L + ["review"], "yes"), "review nested": mutated(L + ["review"], nested(3000)),
    "new string": mutated(L + ["new"], "ab"), "new number": mutated(L + ["new"], 5),
    "new true": mutated(L + ["new"], True), "new dict": mutated(L + ["new"], {"char": "a"}),
    "new of numbers": mutated(L + ["new"], [1, 2]), "new entry char list": mutated(N + ["char"], ["a"]),
    "new entry char two characters": mutated(N + ["char"], "ab"),
    "new entry key list": mutated(N + ["key"], ["r1c1"]), "new entry key dict": mutated(N + ["key"], {}),
    "new entry key number": mutated(N + ["key"], 5), "new entry key nested": mutated(N + ["key"], nested(3000)),
    "new entry layer list": mutated(N + ["layer"], [0]), "new entry layer dict": mutated(N + ["layer"], {}),
    "new entry layer string": mutated(N + ["layer"], "0"), "new entry layer bool": mutated(N + ["layer"], True),
    "new entry layer big": mutated(N + ["layer"], 32), "new entry via list": mutated(N + ["via"], ["tap"]),
    "new entry via dict": mutated(N + ["via"], {}), "new entry via number": mutated(N + ["via"], 1),
    "new entry path list": mutated(N + ["path"], []), "new entry path long": mutated(N + ["path"], "x" * 81),
    "exercises null": mutated(L + ["exercises"], None), "exercises dict": mutated(L + ["exercises"], {"a": 1}),
    "exercises string": mutated(L + ["exercises"], "x"), "exercise null": mutated(E, None),
    "exercise id list": mutated(E + ["id"], []), "exercise id dict": mutated(E + ["id"], {}),
    "exercise kind list": mutated(E + ["kind"], ["keys"]), "exercise kind dict": mutated(E + ["kind"], {}),
    "exercise kind number": mutated(E + ["kind"], 1), "exercise title list": mutated(E + ["title"], []),
    "lines string": mutated(E + ["lines"], "abab"), "lines dict": mutated(E + ["lines"], {}),
    "lines null": mutated(E + ["lines"], None), "lines with numbers": mutated(E + ["lines"], ["abab", 1]),
    "lines with null": mutated(E + ["lines"], ["abab", None]),
    "lines with nested list": mutated(E + ["lines"], [["abab"]]),
    "line with inner newline": mutated(E + ["lines"], ["ab\nab"]),
    "line with nbsp": mutated(E + ["lines"], ["ab\xa0ab"]), "line nbsp trailing": mutated(E + ["lines"], ["abab\xa0"]),
    "line capital": mutated(E + ["lines"], ["abAb"]),
}


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_check_set_reports_any_shape_and_never_raises(shape):
    """ The import route feeds check_set whatever JSON it got: every shape is an error in the reply, not a 500 """
    for export in (None, EXPORT):
        result = check_set(SHAPES[shape], export)
        assert isinstance(result, tuple) and len(result) == 2
        errors, warnings = result
        assert isinstance(errors, list) and isinstance(warnings, list)
        assert errors, "a malformed set has at least one error"
        assert all(isinstance(line, str) for line in errors + warnings)
        # the reply is sent as JSON with ensure_ascii=False, and each message fits one
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        assert len(encoded) < 4000, "a message echoes a value cut short, not whole"


def test_a_value_echoed_in_a_message_is_cut_short():
    errors, _ = check_set(mutated(["format"], "x" * 100000))
    assert errors == ["format: expected vial-web-lessons/1, got '" + "x" * 56 + "..."]
    errors, _ = check_set(mutated(E + ["kind"], "k" * 100))
    assert "exercise 01-n1: unknown kind '" + "k" * 56 + "..." in errors


def test_ids_with_a_trailing_newline_are_refused():
    """ $ matches before a final newline: the ids are matched whole """
    assert check_set(mutated(["id"], "mini\n"))[0] == [
        "id: 'mini\\n': letters, digits, - and _ only, at most 64 characters"]
    assert check_set(mutated(L + ["id"], "01\n"))[0] == [
        "lessons[0]/id: '01\\n': letters, digits, - and _ only, at most 32 characters"]
    assert check_set(mutated(E + ["id"], "01-n1\n"))[0] == [
        "lesson 01/exercises[0]/id: '01-n1\\n': letters, digits, - and _ only, at most 32 characters"]
    assert check_set(mutated(N + ["key"], "r1c1\n"), EXPORT)[0] == [
        "lesson 01/new[0]: key id 'r1c1\\n' should look like r1c4"]
    assert check_set(mutated(["layout", "uid"], "0000000000000001\n"))[0] == [
        "layout/uid: '0000000000000001\\n' isn't 16 hex digits"]
    assert check_set(mutated(["language"], "en\n"))[0] == [
        "language: 'en\\n' isn't a language tag like en, pl or pt-BR"]


def test_a_lone_surrogate_anywhere_is_an_error():
    """ Legal JSON, but neither the reply (ensure_ascii=False) nor the file on disk could hold it """
    surrogate = "\ud83d"
    for path, where in ((N + ["char"], "lessons[0]/new[0]/char"),
                        (E + ["lines", 0], "lessons[0]/exercises[0]/lines[0]"),
                        (["title"], "title"), (L + ["title"], "lessons[0]/title"), (["notes"], "notes"),
                        (["layout", "name"], "layout/name"), (E + ["title"], "lessons[0]/exercises[0]/title")):
        data = mutated(path, "ab" + surrogate)
        errors, warnings = check_set(data, EXPORT)
        assert errors[0] == where + ": not valid UTF-8 (a lone surrogate)", path
        json.dumps((errors, warnings), ensure_ascii=False).encode("utf-8")
    data = minimal_set()
    data[surrogate] = 1
    data["lessons"][0]["x" * 70] = [{surrogate: surrogate}]  # a long key is cut short in the place named
    errors, _ = check_set(data)
    assert errors == ["(root): a key is not valid UTF-8 (a lone surrogate)",
                      "lessons[0]/'" + "x" * 56 + "...[0]: a key is not valid UTF-8 (a lone surrogate)"]
    assert check_set(surrogate)[0] == ["(root): not valid UTF-8 (a lone surrogate)", "(root): not a JSON object"]


def test_a_huge_flat_list_is_walked_in_bounded_memory():
    """ check_strings keeps one iterator per level, not a label and a tuple for every child of a container: a
    two-million-element list is walked in under a second (tracemalloc would make that ten), and a 200 000-element
    one, traced, peaks in kilobytes where holding every child's label and tuple took some 40 MB """
    import time
    import tracemalloc
    data = minimal_set()
    data["lessons"][0]["big"] = ["ab"] * 2_000_000  # an unknown field: the checker lets it be
    data["lessons"][0]["big"][-1] = "ab\ud83d"  # the last one is still looked at
    report = Report()
    started = time.perf_counter()
    learning_check.check_strings(data, report)
    elapsed = time.perf_counter() - started
    assert report.errors == ["lessons[0]/big[1999999]: not valid UTF-8 (a lone surrogate)"]
    assert elapsed < 15, elapsed  # about a second alone; wide, so that a loaded machine (the e2e suite beside) passes
    # the whole check returns too
    data["lessons"][0]["big"][-1] = "ab"
    assert check_set(data, EXPORT) == ([], [])
    data["lessons"][0]["big"] = ["ab"] * 200_000
    tracemalloc.start()
    learning_check.check_strings(data, Report())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert peak < 1024 * 1024, peak


def test_a_missing_new_char_says_so():
    """ the first error; the exercises then use the untaught 'a', which follows """
    assert check_set(mutated(N + ["char"], None))[0][0] == "lesson 01/new[0]: char missing"
    data = minimal_set()
    del data["lessons"][0]["new"][0]["char"]
    assert check_set(data)[0][0] == "lesson 01/new[0]: char missing"
    assert check_set(mutated(N + ["char"], "ab"))[0][0] == "lesson 01/new[0]: char must be one character, not a space"
    assert check_set(mutated(N + ["char"], " "))[0][0] == "lesson 01/new[0]: char must be one character, not a space"


def test_the_schema_allows_what_the_checker_allows():
    """ lesson-set.schema.json restates the checker: unknown properties pass, and `new` may be missing """
    with open(learning_check.schema_path(), encoding="utf-8") as inf:
        schema = json.load(inf)
    assert "additionalProperties" not in json.dumps(schema)
    assert "new" not in schema["$defs"]["lesson"]["required"]
    assert schema["$defs"]["lesson"]["properties"]["new"]["default"] == []
    assert "authority" in schema["description"] and "jsonschema" in schema["description"]
    data = minimal_set()
    data["extra"], data["lessons"][0]["extra"], data["lessons"][0]["exercises"][0]["extra"] = 1, 2, 3
    data["lessons"][0]["new"][0]["extra"], data["layout"]["extra"] = 4, 5
    assert check_set(data, EXPORT) == ([], [])
    data = minimal_set()
    del data["lessons"][0]["new"]
    data["lessons"][0]["review"] = True
    data["lessons"][0]["exercises"] = [{"id": "01-k1", "kind": "keys", "title": "Keys", "lines": ["x"]}]
    errors, _ = check_set(data)
    assert errors == ["exercise 01-k1: uses characters not taught yet: 'x'"]  # a missing new is [], not an error


def test_reserved_device_names_are_refused_as_ids():
    """ Windows makes no file con.json, and the lesson and exercise ids go into addresses """
    for name in ("con", "CON", "Prn", "aux", "nul", "com1", "COM9", "lpt1", "lpt9"):
        assert check_set(mutated(["id"], name))[0] == ["id: {!r} is a reserved device name on Windows".format(name)]
    assert check_set(mutated(["id"], "com0")) == ([], [])  # only 1-9 are devices
    assert check_set(mutated(["id"], "console")) == ([], [])
    assert check_set(mutated(L + ["id"], "aux"))[0] == ["lessons[0]/id: 'aux' is a reserved device name on Windows"]
    assert check_set(mutated(E + ["id"], "lpt3"))[0] == [
        "lesson 01/exercises[0]/id: 'lpt3' is a reserved device name on Windows"]


def test_the_schemas_patterns_and_limits():
    """ What the app relies on, as lesson-set.schema.json has it, checked without jsonschema too """
    assert check_set(mutated(["id"], "x" * 64)) == ([], [])
    assert check_set(mutated(["id"], "x" * 65))[0] == [
        "id: '" + "x" * 56 + "...: letters, digits, - and _ only, at most 64 characters"]
    assert check_set(mutated(L + ["id"], "x" * 32)) == ([], [])
    assert check_set(mutated(L + ["id"], "x" * 33))[0] == [
        "lessons[0]/id: '" + "x" * 33 + "': letters, digits, - and _ only, at most 32 characters"]
    assert check_set(mutated(E + ["id"], "x" * 33))[0] == [
        "lesson 01/exercises[0]/id: '" + "x" * 33 + "': letters, digits, - and _ only, at most 32 characters"]
    assert check_set(mutated(["layout", "uid"], "5EEDC0DE00420042")) == ([], [])
    assert check_set(mutated(["layout", "uid"], "5EEDC0DE0042004"))[0] == [
        "layout/uid: '5EEDC0DE0042004' isn't 16 hex digits"]
    assert check_set(mutated(["layout", "uid"], 5))[0] == ["layout/uid: must be a string"]
    assert check_set(mutated(["layout", "uid"], None))[0] == ["layout/uid: missing"]
    assert check_set(mutated(["layout", "hash"], "sha256:" + "f" * 64)) == ([], [])
    assert check_set(mutated(["layout", "hash"], "sha256:0123456"))[0] == [
        "layout/hash: 'sha256:0123456' isn't sha256: and 8 to 64 hex digits"]
    assert check_set(mutated(["layout", "hash"], "md5:0123456789abcdef"))[0] == [
        "layout/hash: 'md5:0123456789abcdef' isn't sha256: and 8 to 64 hex digits"]
    assert check_set(mutated(["layout", "name"], 5))[0] == ["layout/name: must be a string"]
    for tag in ("en", "pl", "pt-BR", "zh-Hant-TW", "ast"):
        assert check_set(mutated(["language"], tag)) == ([], []), tag
    for tag in ("English", "e", "en_US", "", "EN"):
        assert check_set(mutated(["language"], tag))[0] == [
            "language: {!r} isn't a language tag like en, pl or pt-BR".format(tag)], tag
    assert check_set(mutated(["language"], 5))[0] == ["language: must be a string"]
    assert check_set(mutated(["title"], "t" * 120)) == ([], [])
    assert check_set(mutated(["title"], "t" * 121))[0] == ["title: 121 characters; at most 120"]
    assert check_set(mutated(["title"], 7))[0] == ["title: must be a string"]
    assert check_set(mutated(["title"], " "))[0] == ["title: empty"]
    assert check_set(mutated(["title"], None))[0] == ["title: missing"]
    assert check_set(mutated(L + ["title"], "t" * 121))[0] == ["lesson 01/title: 121 characters; at most 120"]
    assert check_set(mutated(L + ["title"], 3))[0] == ["lesson 01/title: must be a string"]
    assert check_set(mutated(L + ["guidance"], "g" * 1000)) == ([], [])
    assert check_set(mutated(L + ["guidance"], "g" * 1001))[0] == ["lesson 01/guidance: 1001 characters; at most 1000"]
    assert check_set(mutated(L + ["review"], "yes"))[0] == ["lesson 01/review: must be true or false"]
    assert check_set(mutated(E + ["title"], "t" * 80)) == ([], [])
    assert check_set(mutated(E + ["title"], "t" * 81))[0] == ["exercise 01-n1/title: 81 characters; at most 80"]
    assert check_set(mutated(E + ["title"], 1))[0] == ["exercise 01-n1/title: must be a string"]
    assert check_set(mutated(N + ["path"], "hold Space")) == ([], [])
    assert check_set(mutated(N + ["path"], "p" * 81))[0] == ["lesson 01/new[0]/path: 81 characters; at most 80"]
    assert check_set(mutated(N + ["path"], 1))[0] == ["lesson 01/new[0]/path: must be a string"]
    assert check_set(mutated(N + ["layer"], 31), EXPORT)[0] == [
        "lesson 01/new[0]: key r1c1 layer 31 tap types None, not 'a'"]
    assert check_set(mutated(N + ["layer"], 32))[0] == [
        "lesson 01/new[0]: layer must be a whole number from 0 to 31, not 32"]
    assert check_set(mutated(N + ["layer"], "0"))[0] == [
        "lesson 01/new[0]: layer must be a whole number from 0 to 31, not '0'"]
    assert check_set(mutated(L + ["new"], 5))[0][0] == "lesson 01/new: must be a list"
    assert check_set(mutated(["notes"], "Combo K+Y gives Esc; not drilled.")) == ([], [])
    assert check_set(mutated(["notes"], ["x"]))[0] == ["notes: must be a string"]
    # a long line is a warning past 80 characters, an error past 200
    data = minimal_set()
    data["lessons"][0]["exercises"][2]["lines"][0] = "ab " * 27 + "ab"  # 83 characters
    errors, warnings = check_set(data)
    assert errors == [] and warnings[0] == "exercise 01-w1/lines[0]: 83 characters; keep lines under 80"
    data["lessons"][0]["exercises"][2]["lines"][0] = "ab " * 67 + "ab"  # 203
    errors, warnings = check_set(data)
    assert errors == ["exercise 01-w1/lines[0]: 203 characters; at most 200"]
    assert not any("keep lines under" in w for w in warnings)


def test_the_doubling_warning_counts_doubled_groups_and_alternations():
    data = minimal_set()
    # "abab abab" is a doubled pair, and its two "abab" are alternations that count as one more pair: 2 of 5
    data["lessons"][0]["exercises"][1]["lines"] = ["abab abab", "ab ba ab ba ab ba ab ba"]
    _, warnings = check_set(data)
    assert "exercise 01-k1: only 2 of 5 group pairs are doubled" in warnings


def test_a_layout_export_that_is_odd_is_reported_not_a_crash():
    data = minimal_set()
    errors, warnings = check_set(data, {"format": "vial-web-layout-export/1", "hash": "sha256:0123456789abcdef",
                                        "keys": [{"chars": {}}, 5, {"id": "r1c1"}, {"id": "r1c2", "chars": "x"}]})
    assert errors == ["lesson 01/new[0]: key r1c1 layer 0 tap types None, not 'a'",
                      "lesson 01/new[1]: key r1c2 layer 0 tap types None, not 'b'"]
    errors, _ = check_set(data, {"format": "x" * 100, "keys": []})
    assert errors == ["layout export: unexpected format '" + "x" * 56 + "...",
                      "lesson 01/new[0]: key r1c1 is not in the layout export",
                      "lesson 01/new[1]: key r1c2 is not in the layout export"]
    assert export_chars({"keys": [{"id": "r1c1", "chars": {"0": {"tap": "a"}}}, {"id": 5}]}) == {
        "r1c1": {"0": {"tap": "a"}}}
    assert export_chars([]) == {} and export_chars({"keys": "x"}) == {}


def test_a_layout_export_that_is_not_one_is_one_error_and_no_key_is_compared():
    """ not an object, or no list of keys: one error, not one per new key; the hash isn't compared either """
    data = minimal_set()
    for export in ([], "x", 5, True, {}, {"format": "vial-web-layout-export/1", "hash": "sha256:0123456789abcdef"},
                   {"format": "vial-web-layout-export/1", "hash": "sha256:0123456789abcdef", "keys": 5},
                   {"format": "vial-web-layout-export/1", "hash": "sha256:ffffffffffffffff", "keys": {"r1c1": {}}}):
        assert check_set(data, export) == (["layout export: not a layout export (no keys)"], []), export
    assert check_set(data, {"format": "x", "hash": "sha256:ffffffffffffffff"}) == (
        ["layout export: not a layout export (no keys)"], [])
    assert check_set(data, None) == ([], [])  # no export: nothing to compare with
    # with keys, a wrong format is reported and the keys are compared still
    assert check_set(data, {"format": "x", "hash": "sha256:0123456789abcdef", "keys": EXPORT["keys"]}) == (
        ["layout export: unexpected format 'x'"], [])


def cli():
    """ The command line's module, loaded from util/learning """
    spec = importlib.util.spec_from_file_location("check_lessons", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_command_line_checks_a_file_against_an_export(tmp_path, capsys):
    data = minimal_set()
    data["lessons"][0]["new"][0]["key"] = "r1c2"
    (tmp_path / "mini.json").write_text(json.dumps(data), encoding="utf-8")
    (tmp_path / "export.json").write_text(json.dumps(EXPORT), encoding="utf-8")
    assert cli().main([str(tmp_path / "mini.json"), "--layout", str(tmp_path / "export.json")]) == 1
    out = capsys.readouterr().out
    assert "error: lesson 01/new[0]: key r1c2 layer 0 tap types 'b', not 'a'" in out
    assert out.strip().endswith("1 lessons, 1 errors, 0 warnings")
    assert cli().main([str(tmp_path / "mini.json")]) == 0
    assert capsys.readouterr().out.strip().endswith("1 lessons, 0 errors, 0 warnings")


def test_the_command_line_takes_a_course_for_what_is_known(tmp_path, capsys):
    """ A batch holding lesson 2 of a course: what lesson 1 taught is known; lesson 2 is the course's """
    course = minimal_set()
    second = copy.deepcopy(course["lessons"][0])
    second["id"], second["new"] = "02", [{"char": "c", "key": "r1c3"}]
    second["exercises"] = [{"id": "02-n1", "kind": "new-keys", "title": "New", "lines": lines("cab cab", 240)},
                           {"id": "02-k1", "kind": "keys", "title": "Keys", "lines": lines("ca ca cb cb", 220)},
                           {"id": "02-w1", "kind": "words", "title": "Words", "lines": lines("cab abc", 460)}]
    course["lessons"].append(second)
    batch = minimal_set()
    batch["lessons"] = [second]
    (tmp_path / "course.json").write_text(json.dumps(course), encoding="utf-8")
    (tmp_path / "batch.json").write_text(json.dumps(batch), encoding="utf-8")
    assert cli().main([str(tmp_path / "batch.json"), "--course", str(tmp_path / "course.json")]) == 0
    out = capsys.readouterr().out
    assert "error:" not in out and "warning: lesson 02: has no blind exercise" in out
    # without the course, a and b aren't known
    assert cli().main([str(tmp_path / "batch.json")]) == 1
    assert "error: exercise 02-n1: uses characters not taught yet: 'a' 'b'" in capsys.readouterr().out


def test_the_command_line_reports_malformed_course_and_export_files(tmp_path, capsys):
    (tmp_path / "mini.json").write_text(json.dumps(minimal_set()), encoding="utf-8")
    for name, content in (("list.json", "[]"), ("lessons-string.json", '{"lessons": "x"}'),
                          ("no-lessons.json", '{"lessons": [5, {"id": "01", "new": 3}]}'), ("broken.json", "{")):
        (tmp_path / name).write_text(content, encoding="utf-8")
    assert cli().main([str(tmp_path / "mini.json"), "--course", str(tmp_path / "list.json")]) == 1
    assert "error: course: can't use " in capsys.readouterr().out
    assert cli().main([str(tmp_path / "mini.json"), "--course", str(tmp_path / "lessons-string.json")]) == 1
    assert "error: course: can't use " in capsys.readouterr().out
    assert cli().main([str(tmp_path / "mini.json"), "--course", str(tmp_path / "no-lessons.json")]) == 0
    assert "error:" not in capsys.readouterr().out  # lesson 01 is the first; nothing before it
    assert cli().main([str(tmp_path / "mini.json"), "--course", str(tmp_path / "broken.json")]) == 1
    assert "error: course: can't read " in capsys.readouterr().out
    (tmp_path / "keys-no-ids.json").write_text(json.dumps({"format": "vial-web-layout-export/1",
                                                            "hash": "sha256:0123456789abcdef",
                                                            "keys": [{"chars": {}}, "r1c1"]}), encoding="utf-8")
    assert cli().main([str(tmp_path / "mini.json"), "--layout", str(tmp_path / "keys-no-ids.json")]) == 1
    assert "error: lesson 01/new[0]: key r1c1 is not in the layout export" in capsys.readouterr().out
    # a layout file that isn't an export (a list, null, an object with no keys): one error, no key compared
    (tmp_path / "null.json").write_text("null", encoding="utf-8")
    (tmp_path / "no-keys.json").write_text('{"format": "vial-web-layout-export/1"}', encoding="utf-8")
    for name in ("list.json", "null.json", "no-keys.json"):
        assert cli().main([str(tmp_path / "mini.json"), "--layout", str(tmp_path / name)]) == 1, name
        out = capsys.readouterr().out
        assert "error: layout export: not a layout export (no keys)" in out, name
        assert "is not in the layout export" not in out and out.strip().endswith("1 lessons, 1 errors, 0 warnings")
    assert cli().main([str(tmp_path / "mini.json"), "--layout", str(tmp_path / "broken.json")]) == 1
    out = capsys.readouterr().out
    assert "error: layout export: can't read " in out and "not a layout export" not in out
    (tmp_path / "lessons-number.json").write_text('{"lessons": 5}', encoding="utf-8")
    assert cli().main([str(tmp_path / "lessons-number.json"), "--course", str(tmp_path / "mini.json")]) == 1
    assert capsys.readouterr().out.strip().endswith("0 lessons, 6 errors, 0 warnings")
