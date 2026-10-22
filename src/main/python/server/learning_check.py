# SPDX-License-Identifier: GPL-2.0-or-later
""" Checks a lesson set (docs/learning/lesson-format.md section 3) before the app loads it, and before the command line
(util/learning/check_lessons.py) lets one through: both use these functions, so they agree.

Errors: the file isn't a lesson set, ids repeat, an exercise uses a character the course hasn't taught yet, a new key
doesn't type that character in the layout export. Warnings: sizes outside the ranges of lesson-rules.md section 5, too
few new characters in a new-key exercise, groups not doubled, a lesson missing an exercise kind, a new character never
drilled. Pure: no file is read but the JSON Schema, and that only when `jsonschema` is installed. """
import json
import re
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[4] / "docs" / "learning" / "lesson-set.schema.json"
FORMAT = "vial-web-lessons/1"
EXPORT_FORMAT = "vial-web-layout-export/1"

KINDS = ("new-keys", "keys", "words", "blind", "text", "extra-keys", "extra-words")
SIZES = {"new-keys": (220, 460), "keys": (200, 420), "words": (450, 600), "blind": (400, 520),
         "text": (450, 600), "extra-keys": (200, 420), "extra-words": (450, 600)}
GROUP_KINDS = ("new-keys", "keys", "extra-keys")
MAIN_KINDS = ("new-keys", "keys", "words", "blind", "text")
LESSON_1_KINDS = ("new-keys", "keys", "words")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
KEY_ID = re.compile(r"^r[0-9]+c[0-9]+$")


class Report:
    """ What a check found: errors (the set can't be used) and warnings (it can, but the rules say otherwise), each
    "where: what" """

    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, what):
        self.errors.append("{}: {}".format(where, what))

    def warn(self, where, what):
        self.warnings.append("{}: {}".format(where, what))


def load(path, report, what):
    """ The JSON in path, or None with an error in the report saying why it couldn't be read """
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        report.error(what, "can't read {}: {}".format(path, e))
        return None


def schema_check(data, report):
    """ The JSON Schema's say, as errors in the report, when jsonschema is installed (it isn't needed: the structural
    checks cover what matters); returns a note on what was done """
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return "schema: jsonschema not installed, structural checks only"
    schema = load(SCHEMA, report, "schema")
    if schema is None:
        return "schema: not found"
    for err in sorted(jsonschema.Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path)):
        where = "/".join(str(p) for p in err.path) or "(root)"
        report.error(where, err.message)
    return "schema: checked against {}".format(SCHEMA.name)


def export_chars(export):
    """ key id -> {layer (str): {"tap": c, "shift": c, "altGr": c}} from a layout export """
    return {k["id"]: k.get("chars", {}) for k in export.get("keys", [])}


def export_keys(export, data, report):
    """ The characters of a layout export (export_chars), for checking the set's new keys against; an error when it
    isn't an export, a warning when the set's layout hash isn't the export's (made from another layout) """
    if export.get("format") != EXPORT_FORMAT:
        report.error("layout export", "unexpected format {!r}".format(export.get("format")))
    keys = export_chars(export)
    layout = data.get("layout") if isinstance(data, dict) else None
    if isinstance(layout, dict) and layout.get("hash") != export.get("hash"):
        report.warn("layout/hash", "differs from the export's hash: the set was made from another layout")
    return keys


def check_header(data, report):
    """ The set's own fields; False when the lessons can't be checked at all """
    if not isinstance(data, dict):
        report.error("(root)", "not a JSON object")
        return False
    if data.get("format") != FORMAT:
        report.error("format", "expected {}, got {!r}".format(FORMAT, data.get("format")))
    for field in ("id", "title", "language"):
        if not isinstance(data.get(field), str) or not data[field]:
            report.error(field, "missing or empty")
    if isinstance(data.get("id"), str) and not ID.match(data["id"]):
        report.error("id", "letters, digits, - and _ only")
    layout = data.get("layout")
    if not isinstance(layout, dict):
        report.error("layout", "missing")
    else:
        for field in ("name", "uid", "hash"):
            if not isinstance(layout.get(field), str):
                report.error("layout/{}".format(field), "missing")
    if not isinstance(data.get("lessons"), list) or not data["lessons"]:
        report.error("lessons", "missing or empty")
        return False
    return True


def check_new(lesson, where, known, keys, report):
    """ The lesson's new characters, checked against the export's keys when given; returns them as a set """
    new = set()
    for j, entry in enumerate(lesson.get("new") or []):
        w = "{}/new[{}]".format(where, j)
        c = entry.get("char") if isinstance(entry, dict) else None
        if not isinstance(c, str) or len(c) != 1 or c == " ":
            report.error(w, "char must be one character, not a space")
            continue
        if c in known:
            report.warn(w, "{!r} is already known".format(c))
        if c in new:
            report.warn(w, "{!r} listed twice".format(c))
        new.add(c)
        key, layer, via = entry.get("key"), entry.get("layer", 0), entry.get("via", "tap")
        if key is not None and not (isinstance(key, str) and KEY_ID.match(key)):
            report.error(w, "key id {!r} should look like r1c4".format(key))
        if via not in ("tap", "shift", "altGr"):
            report.error(w, "via must be tap, shift or altGr, not {!r}".format(via))
        if keys is not None and key is not None:
            if key not in keys:
                report.error(w, "key {} is not in the layout export".format(key))
            else:
                typed = keys[key].get(str(layer), {}).get(via)
                if typed != c:
                    report.error(w, "key {} layer {} {} types {!r}, not {!r}".format(key, layer, via, typed, c))
    if not new and not lesson.get("review"):
        report.warn(where, "no new characters and not a review lesson")
    return new


def check_exercise(ex, where, known, new, report):
    """ One exercise's kind, lines, characters and sizes; returns its text (the lines joined) when it has one """
    kind = ex.get("kind")
    if kind not in KINDS:
        report.error(where, "unknown kind {!r}".format(kind))
        return
    lines = ex.get("lines")
    if not isinstance(lines, list) or not lines or not all(isinstance(l, str) and l for l in lines):
        report.error(where, "lines must be a non-empty list of non-empty strings")
        return
    for i, line in enumerate(lines):
        if line != line.strip():
            report.error("{}/lines[{}]".format(where, i), "leading or trailing space")
        if "  " in line or "\t" in line:
            report.warn("{}/lines[{}]".format(where, i), "double space or tab")
        if len(line) > 80:
            report.warn("{}/lines[{}]".format(where, i), "{} characters; keep lines under 80".format(len(line)))
    text = " ".join(lines)
    unknown = sorted(set(text) - known)
    if unknown:
        report.error(where, "uses characters not taught yet: " + " ".join(repr(c) for c in unknown))
    low, high = SIZES[kind]
    if not low <= len(text) <= high:
        report.warn(where, "{} characters; {} should have {}-{}".format(len(text), kind, low, high))
    if kind in GROUP_KINDS:
        groups = text.split()
        # "read read" is a doubled group; "shsh" is a doubled two-character alternation (lesson 1 style)
        doubled = sum(1 for a, b in zip(groups, groups[1:]) if a == b)
        alternations = sum(1 for g in groups if len(g) == 4 and g[:2] == g[2:])
        if groups and doubled + alternations // 2 < len(groups) // 2 * 0.8:
            report.warn(where, "only {} of {} group pairs are doubled".format(doubled, len(groups) // 2))
    if kind == "new-keys" and new:
        letters = text.replace(" ", "")
        share = sum(1 for c in letters if c in new) / max(len(letters), 1)
        if share < 0.4:
            report.warn(where, "new characters are {:.0%} of the text; at least 40 % expected".format(share))
    return text


def check(data, keys, report, known_before="", first_lesson=0):
    """ The whole set, lesson by lesson. keys: export_chars() of the layout export, or None not to check the new keys.
    known_before, first_lesson: for a file holding part of a course, the characters taught before its first lesson
    and that lesson's 0-based number in the course. """
    if not check_header(data, report):
        return
    known = {" "} | set(known_before)
    lesson_ids, exercise_ids = set(), set()
    for i, lesson in enumerate(data["lessons"]):
        where = "lessons[{}]".format(i)
        if not isinstance(lesson, dict):
            report.error(where, "not an object")
            continue
        lid = lesson.get("id")
        if not isinstance(lid, str) or not ID.match(lid):
            report.error(where, "bad id {!r}".format(lid))
        elif lid in lesson_ids:
            report.error(where, "lesson id {!r} repeats".format(lid))
        lesson_ids.add(lid)
        where = "lesson {}".format(lid)
        if not isinstance(lesson.get("title"), str) or not lesson["title"]:
            report.error(where, "missing title")
        if not isinstance(lesson.get("guidance"), str) or not lesson["guidance"].strip():
            report.error(where, "missing guidance")
        new = check_new(lesson, where, known, keys, report)
        known |= new
        exercises = lesson.get("exercises")
        if not isinstance(exercises, list) or not exercises:
            report.error(where, "no exercises")
            continue
        kinds, drilled = [], set()
        for j, ex in enumerate(exercises):
            w = "{}/exercises[{}]".format(where, j)
            if not isinstance(ex, dict):
                report.error(w, "not an object")
                continue
            eid = ex.get("id")
            if not isinstance(eid, str) or not ID.match(eid):
                report.error(w, "bad id {!r}".format(eid))
            elif eid in exercise_ids:
                report.error(w, "exercise id {!r} repeats".format(eid))
            exercise_ids.add(eid)
            if not isinstance(ex.get("title"), str) or not ex["title"]:
                report.error(w, "missing title")
            text = check_exercise(ex, "exercise {}".format(eid), known, new, report)
            kinds.append(ex.get("kind"))
            if text:
                drilled |= set(text)
        expected = LESSON_1_KINDS if i + first_lesson == 0 else MAIN_KINDS
        for kind in expected:
            if kind not in kinds:
                report.warn(where, "has no {} exercise".format(kind))
        main = [k for k in kinds if k in MAIN_KINDS]
        if main != sorted(main, key=MAIN_KINDS.index):
            report.warn(where, "main exercises are not in the order new-keys, keys, words, blind, text")
        for c in sorted(new - drilled):
            report.warn(where, "new character {!r} never appears in its exercises".format(c))


def check_set(data, export=None):
    """ The server's check of a lesson set (the parsed file): (errors, warnings). With the layout export of the
    keyboard, the new keys are checked against what it types, and a hash that isn't the export's is a warning. """
    report = Report()
    keys = export_keys(export, data, report) if isinstance(export, dict) else None
    schema_check(data, report)
    check(data, keys, report)
    return report.errors, report.warnings
