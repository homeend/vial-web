#!/usr/bin/env python3
"""Check a lesson set (docs/learning/lesson-format.md) before the app loads it.

    python util/learning/check_lessons.py <set>.json [--layout layout-export.json]

Errors (exit 1): the file isn't a lesson set, ids repeat, an exercise uses a character the course hasn't taught
yet, a new key doesn't type that character in the export. Warnings (exit 0): sizes outside the ranges of
lesson-rules.md section 5, too few new characters in a new-key exercise, groups not doubled, a lesson missing an
exercise kind, a new character never drilled. Standard library only; `jsonschema` is used when installed.
"""

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[2] / "docs" / "learning" / "lesson-set.schema.json"

KINDS = ("new-keys", "keys", "words", "blind", "text", "extra-keys", "extra-words")
SIZES = {"new-keys": (220, 460), "keys": (200, 420), "words": (450, 600), "blind": (400, 520),
         "text": (450, 600), "extra-keys": (200, 420), "extra-words": (450, 600)}
GROUP_KINDS = ("new-keys", "keys", "extra-keys")
MAIN_KINDS = ("new-keys", "keys", "words", "blind", "text")
LESSON_1_KINDS = ("new-keys", "keys", "words")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
KEY_ID = re.compile(r"^r[0-9]+c[0-9]+$")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, what):
        self.errors.append(f"{where}: {what}")

    def warn(self, where, what):
        self.warnings.append(f"{where}: {what}")


def load(path, report, what):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        report.error(what, f"can't read {path}: {e}")
        return None


def schema_check(data, report):
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
    return f"schema: checked against {SCHEMA.name}"


def export_chars(export):
    """key id -> {layer (str): {"tap": c, "shift": c, "altGr": c}} from a layout export"""
    return {k["id"]: k.get("chars", {}) for k in export.get("keys", [])}


def check_header(data, report):
    if not isinstance(data, dict):
        report.error("(root)", "not a JSON object")
        return False
    if data.get("format") != "vial-web-lessons/1":
        report.error("format", f"expected vial-web-lessons/1, got {data.get('format')!r}")
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
                report.error(f"layout/{field}", "missing")
    if not isinstance(data.get("lessons"), list) or not data["lessons"]:
        report.error("lessons", "missing or empty")
        return False
    return True


def check_new(lesson, where, known, keys, report):
    """returns the set of this lesson's new characters"""
    new = set()
    for j, entry in enumerate(lesson.get("new") or []):
        w = f"{where}/new[{j}]"
        c = entry.get("char") if isinstance(entry, dict) else None
        if not isinstance(c, str) or len(c) != 1 or c == " ":
            report.error(w, "char must be one character, not a space")
            continue
        if c in known:
            report.warn(w, f"{c!r} is already known")
        if c in new:
            report.warn(w, f"{c!r} listed twice")
        new.add(c)
        key, layer, via = entry.get("key"), entry.get("layer", 0), entry.get("via", "tap")
        if key is not None and not (isinstance(key, str) and KEY_ID.match(key)):
            report.error(w, f"key id {key!r} should look like r1c4")
        if via not in ("tap", "shift", "altGr"):
            report.error(w, f"via must be tap, shift or altGr, not {via!r}")
        if keys is not None and key is not None:
            if key not in keys:
                report.error(w, f"key {key} is not in the layout export")
            else:
                typed = keys[key].get(str(layer), {}).get(via)
                if typed != c:
                    report.error(w, f"key {key} layer {layer} {via} types {typed!r}, not {c!r}")
    if not new and not lesson.get("review"):
        report.warn(where, "no new characters and not a review lesson")
    return new


def check_exercise(ex, where, known, new, report):
    kind = ex.get("kind")
    if kind not in KINDS:
        report.error(where, f"unknown kind {kind!r}")
        return
    lines = ex.get("lines")
    if not isinstance(lines, list) or not lines or not all(isinstance(l, str) and l for l in lines):
        report.error(where, "lines must be a non-empty list of non-empty strings")
        return
    for i, line in enumerate(lines):
        if line != line.strip():
            report.error(f"{where}/lines[{i}]", "leading or trailing space")
        if "  " in line or "\t" in line:
            report.warn(f"{where}/lines[{i}]", "double space or tab")
        if len(line) > 80:
            report.warn(f"{where}/lines[{i}]", f"{len(line)} characters; keep lines under 80")
    text = " ".join(lines)
    unknown = sorted(set(text) - known)
    if unknown:
        report.error(where, "uses characters not taught yet: " + " ".join(repr(c) for c in unknown))
    low, high = SIZES[kind]
    if not low <= len(text) <= high:
        report.warn(where, f"{len(text)} characters; {kind} should have {low}-{high}")
    if kind in GROUP_KINDS:
        groups = text.split()
        # "read read" is a doubled group; "shsh" is a doubled two-character alternation (lesson 1 style)
        doubled = sum(1 for a, b in zip(groups, groups[1:]) if a == b)
        alternations = sum(1 for g in groups if len(g) == 4 and g[:2] == g[2:])
        if groups and doubled + alternations // 2 < len(groups) // 2 * 0.8:
            report.warn(where, f"only {doubled} of {len(groups) // 2} group pairs are doubled")
    if kind == "new-keys" and new:
        letters = text.replace(" ", "")
        share = sum(1 for c in letters if c in new) / max(len(letters), 1)
        if share < 0.4:
            report.warn(where, f"new characters are {share:.0%} of the text; at least 40 % expected")
    return text


def check(data, keys, report):
    if not check_header(data, report):
        return
    known = {" "}
    lesson_ids, exercise_ids = set(), set()
    for i, lesson in enumerate(data["lessons"]):
        where = f"lessons[{i}]"
        if not isinstance(lesson, dict):
            report.error(where, "not an object")
            continue
        lid = lesson.get("id")
        if not isinstance(lid, str) or not ID.match(lid):
            report.error(where, f"bad id {lid!r}")
        elif lid in lesson_ids:
            report.error(where, f"lesson id {lid!r} repeats")
        lesson_ids.add(lid)
        where = f"lesson {lid}"
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
            w = f"{where}/exercises[{j}]"
            if not isinstance(ex, dict):
                report.error(w, "not an object")
                continue
            eid = ex.get("id")
            if not isinstance(eid, str) or not ID.match(eid):
                report.error(w, f"bad id {eid!r}")
            elif eid in exercise_ids:
                report.error(w, f"exercise id {eid!r} repeats")
            exercise_ids.add(eid)
            if not isinstance(ex.get("title"), str) or not ex["title"]:
                report.error(w, "missing title")
            text = check_exercise(ex, f"exercise {eid}", known, new, report)
            kinds.append(ex.get("kind"))
            if text:
                drilled |= set(text)
        expected = LESSON_1_KINDS if i == 0 else MAIN_KINDS
        for kind in expected:
            if kind not in kinds:
                report.warn(where, f"has no {kind} exercise")
        main = [k for k in kinds if k in MAIN_KINDS]
        if main != sorted(main, key=MAIN_KINDS.index):
            report.warn(where, "main exercises are not in the order new-keys, keys, words, blind, text")
        for c in sorted(new - drilled):
            report.warn(where, f"new character {c!r} never appears in its exercises")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("lesson_set", help="the lesson set JSON file")
    parser.add_argument("--layout", help="the layout export the set was made from; checks the new keys")
    args = parser.parse_args(argv)

    report = Report()
    data = load(args.lesson_set, report, "lesson set")
    keys = None
    if args.layout:
        export = load(args.layout, report, "layout export")
        if isinstance(export, dict):
            if export.get("format") != "vial-web-layout-export/1":
                report.error("layout export", f"unexpected format {export.get('format')!r}")
            keys = export_chars(export)
            layout = data.get("layout") if isinstance(data, dict) else None
            if isinstance(layout, dict) and layout.get("hash") != export.get("hash"):
                report.warn("layout/hash", "differs from the export's hash: the set was made from another layout")
    note = None
    if data is not None:
        note = schema_check(data, report)
        check(data, keys, report)

    if note:
        print(note)
    for line in report.errors:
        print("error:", line)
    for line in report.warnings:
        print("warning:", line)
    lessons = len(data.get("lessons", [])) if isinstance(data, dict) else 0
    print(f"{args.lesson_set}: {lessons} lessons, {len(report.errors)} errors, {len(report.warnings)} warnings")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
