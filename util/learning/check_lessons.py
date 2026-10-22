#!/usr/bin/env python3
"""Check a lesson set (docs/learning/lesson-format.md) before the app loads it.

    python util/learning/check_lessons.py <set>.json [--layout layout-export.json]

Errors (exit 1): the file isn't a lesson set, ids repeat, an exercise uses a character the course hasn't taught
yet, a new key doesn't type that character in the export. Warnings (exit 0): sizes outside the ranges of
lesson-rules.md section 5, too few new characters in a new-key exercise, groups not doubled, a lesson missing an
exercise kind, a new character never drilled. The checks are the server's (src/main/python/server/learning_check.py),
so the app and the command line agree. Standard library only; `jsonschema` is used when installed.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "main", "python"))

from server.learning_check import Report, check, export_keys, load, schema_check  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("lesson_set", help="the lesson set JSON file")
    parser.add_argument("--layout", help="the layout export the set was made from; checks the new keys")
    parser.add_argument("--known", default="",
                        help="characters taught before this file's first lesson (for checking a batch of lessons)")
    parser.add_argument("--first-lesson", type=int, default=0,
                        help="0-based number of this file's first lesson in the course (with --known)")
    parser.add_argument("--course", help="the whole course (a lesson set, exercises may be empty): what is known "
                                         "before this file's first lesson is taken from its earlier lessons")
    args = parser.parse_args(argv)

    report = Report()
    data = load(args.lesson_set, report, "lesson set")
    keys = None
    if args.layout:
        export = load(args.layout, report, "layout export")
        if isinstance(export, dict):
            keys = export_keys(export, data, report)
    known, first = args.known, args.first_lesson
    if args.course and isinstance(data, dict) and data.get("lessons"):
        course = load(args.course, report, "course")
        first_id = (data["lessons"][0] or {}).get("id") if isinstance(data["lessons"][0], dict) else None
        ids = [l.get("id") for l in (course or {}).get("lessons", []) if isinstance(l, dict)]
        if first_id not in ids:
            report.error("course", f"lesson {first_id!r} is not in {args.course}")
        else:
            first = ids.index(first_id)
            known = "".join(n.get("char", "") for l in course["lessons"][:first] for n in (l.get("new") or []))
    note = None
    if data is not None:
        note = schema_check(data, report)
        check(data, keys, report, known, first)

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
