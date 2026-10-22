# SPDX-License-Identifier: GPL-2.0-or-later
""" Checks a lesson set (docs/learning/lesson-format.md section 3) before the app loads it, and before the command line
(util/learning/check_lessons.py) lets one through: both use these functions, so they agree.

Errors: the file isn't a lesson set, ids repeat, an exercise uses a character the course hasn't taught yet, a new key
doesn't type that character in the layout export. Warnings: sizes outside the ranges of lesson-rules.md section 5, too
few new characters in a new-key exercise, groups not doubled, a lesson missing an exercise kind, a new character never
drilled. The checks take the parsed document, whatever its shape, and report instead of raising. Files are read by
load() alone (the command line's files) and by schema_check() for the JSON Schema, that only when `jsonschema` is
installed. """
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
VIAS = ("tap", "shift", "altGr")
# The patterns and limits are the schema's (lesson-set.schema.json), matched whole with fullmatch(): match() would let
# "01\n" through, as $ matches before a final newline too.
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")  # the set's id: its file name
ITEM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")  # a lesson's or an exercise's id: part of an address
KEY_ID = re.compile(r"^r[0-9]+c[0-9]+$")
UID = re.compile(r"^[0-9A-Fa-f]{16}$")
HASH = re.compile(r"^sha256:[0-9a-f]{8,64}$")
LANGUAGE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")  # a BCP-47 tag: en, pl, pt-BR
MAX_TITLE, MAX_EXERCISE_TITLE, MAX_GUIDANCE, MAX_LINE, MAX_PATH = 120, 80, 1000, 200, 80
# Windows makes no file of these names, with any extension: the set id becomes <id>.json
RESERVED = {"con", "prn", "aux", "nul"} | {"com{}".format(i) for i in range(1, 10)} | \
           {"lpt{}".format(i) for i in range(1, 10)}


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


def short(value):
    """ repr(value) cut to 60 characters: for a message that echoes a value from the file """
    try:
        text = repr(value)
    except RecursionError:
        text = "a deeply nested {}".format(type(value).__name__)
    return text if len(text) <= 60 else text[:57] + "..."


def id_problem(value, pattern, limit):
    """ What's wrong with value as an id (a file name, a part of an address) the pattern allows, or None """
    if value is None:
        return "missing"
    if not isinstance(value, str):
        return "must be a string"
    if not pattern.fullmatch(value):
        return "{}: letters, digits, - and _ only, at most {} characters".format(short(value), limit)
    if value.split(".")[0].lower() in RESERVED:
        return "{} is a reserved device name on Windows".format(short(value))
    return None


def string_problem(value, limit, required=True):
    """ What's wrong with value as a text of at most limit characters, or None; an optional one may be missing """
    if value is None:
        return "missing" if required else None
    if not isinstance(value, str):
        return "must be a string"
    if required and not value.strip():
        return "empty"
    if len(value) > limit:
        return "{} characters; at most {}".format(len(value), limit)
    return None


def check_strings(data, report):
    """ Every string in the document, keys included, must be UTF-8: a lone surrogate is legal JSON that neither the
    reply nor the file on disk could hold. Walks without recursion, so a deeply nested document is no trouble. """
    stack = [("", data)]
    while stack:
        where, value = stack.pop()
        if isinstance(value, str):
            try:
                value.encode("utf-8")
            except UnicodeEncodeError:
                report.error(where or "(root)", "not valid UTF-8 (a lone surrogate)")
        elif isinstance(value, list):
            stack.extend(("{}[{}]".format(where, i), v) for i, v in reversed(list(enumerate(value))))
        elif isinstance(value, dict):
            for key, v in reversed(list(value.items())):
                try:
                    key.encode("utf-8")
                except UnicodeEncodeError:
                    report.error(where or "(root)", "a key is not valid UTF-8 (a lone surrogate)")
                    continue
                label = key if key.isprintable() and len(key) <= 40 else short(key)
                stack.append(("{}/{}".format(where, label) if where else label, v))


def export_chars(export):
    """ key id -> {layer (str): {"tap": c, "shift": c, "altGr": c}} from a layout export; a key without an id is
    left out, one without chars has none """
    keys = export.get("keys") if isinstance(export, dict) else None
    out = {}
    for k in keys if isinstance(keys, list) else []:
        if isinstance(k, dict) and isinstance(k.get("id"), str):
            out[k["id"]] = k["chars"] if isinstance(k.get("chars"), dict) else {}
    return out


def export_keys(export, data, report):
    """ The characters of a layout export (export_chars), for checking the set's new keys against; an error when it
    isn't an export, a warning when the set's layout hash isn't the export's (made from another layout) """
    if export.get("format") != EXPORT_FORMAT:
        report.error("layout export", "unexpected format {}".format(short(export.get("format"))))
    elif not isinstance(export.get("keys"), list):
        report.error("layout export", "has no keys")
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
        report.error("format", "expected {}, got {}".format(FORMAT, short(data.get("format"))))
    problem = id_problem(data.get("id"), ID, 64)
    if problem:
        report.error("id", problem)
    problem = string_problem(data.get("title"), MAX_TITLE)
    if problem:
        report.error("title", problem)
    language = data.get("language")
    if not isinstance(language, str):
        report.error("language", "missing" if language is None else "must be a string")
    elif not LANGUAGE.fullmatch(language):
        report.error("language", "{} isn't a language tag like en, pl or pt-BR".format(short(language)))
    if data.get("notes") is not None and not isinstance(data["notes"], str):
        report.error("notes", "must be a string")
    layout = data.get("layout")
    if not isinstance(layout, dict):
        report.error("layout", "missing" if layout is None else "must be an object")
    else:
        for field, pattern, like in (("name", None, None), ("uid", UID, "16 hex digits"),
                                     ("hash", HASH, "sha256: and 8 to 64 hex digits")):
            value = layout.get(field)
            if not isinstance(value, str):
                report.error("layout/{}".format(field), "missing" if value is None else "must be a string")
            elif pattern is not None and not pattern.fullmatch(value):
                report.error("layout/{}".format(field), "{} isn't {}".format(short(value), like))
    lessons = data.get("lessons")
    if not isinstance(lessons, list) or not lessons:
        report.error("lessons", "missing or empty" if lessons is None or lessons == [] else "must be a list")
        return False
    return True


def check_new(lesson, where, known, keys, report):
    """ The lesson's new characters, checked against the export's keys when given; returns them as a set """
    new = set()
    entries = lesson.get("new")
    if entries is None:
        entries = []
    elif not isinstance(entries, list):
        report.error(where + "/new", "must be a list")
        entries = []
    for j, entry in enumerate(entries):
        w = "{}/new[{}]".format(where, j)
        if not isinstance(entry, dict):
            report.error(w, "not an object")
            continue
        c = entry.get("char")
        if not isinstance(c, str) or len(c) != 1 or c == " ":
            report.error(w, "char must be one character, not a space")
            continue
        if c in known:
            report.warn(w, "{!r} is already known".format(c))
        if c in new:
            report.warn(w, "{!r} listed twice".format(c))
        new.add(c)
        key, layer, via = entry.get("key"), entry.get("layer", 0), entry.get("via", "tap")
        key_ok = isinstance(key, str) and KEY_ID.fullmatch(key) is not None
        if key is not None and not key_ok:
            report.error(w, "key id {} should look like r1c4".format(short(key)))
        layer_ok = isinstance(layer, int) and not isinstance(layer, bool) and 0 <= layer <= 31
        if not layer_ok:
            report.error(w, "layer must be a whole number from 0 to 31, not {}".format(short(layer)))
        if via not in VIAS:
            report.error(w, "via must be tap, shift or altGr, not {}".format(short(via)))
        problem = string_problem(entry.get("path"), MAX_PATH, required=False)
        if problem:
            report.error(w + "/path", problem)
        if keys is not None and key_ok and layer_ok and via in VIAS:
            if key not in keys:
                report.error(w, "key {} is not in the layout export".format(key))
            else:
                layer_chars = keys[key].get(str(layer))
                typed = layer_chars.get(via) if isinstance(layer_chars, dict) else None
                if typed != c:
                    report.error(w, "key {} layer {} {} types {}, not {!r}".format(key, layer, via, short(typed), c))
    if not new and not lesson.get("review"):
        report.warn(where, "no new characters and not a review lesson")
    return new


def check_exercise(ex, where, known, new, report):
    """ One exercise's kind, lines, characters and sizes; returns its text (the lines joined) when it has one """
    kind = ex.get("kind")
    if kind not in KINDS:
        report.error(where, "unknown kind {}".format(short(kind)))
        return
    lines = ex.get("lines")
    if not isinstance(lines, list) or not lines or not all(isinstance(l, str) and l for l in lines):
        report.error(where, "lines must be a non-empty list of non-empty strings")
        return
    for i, line in enumerate(lines):
        w = "{}/lines[{}]".format(where, i)
        if line != line.strip():
            report.error(w, "leading or trailing space")
        if "  " in line or "\t" in line:
            report.warn(w, "double space or tab")
        if len(line) > MAX_LINE:
            report.error(w, "{} characters; at most {}".format(len(line), MAX_LINE))
        elif len(line) > 80:
            report.warn(w, "{} characters; keep lines under 80".format(len(line)))
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
        pairs = doubled + alternations // 2
        if groups and pairs < len(groups) // 2 * 0.8:
            report.warn(where, "only {} of {} group pairs are doubled".format(pairs, len(groups) // 2))
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
    check_strings(data, report)
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
        problem = id_problem(lid, ITEM_ID, 32)
        if problem:
            report.error(where + "/id", problem)
        else:
            if lid in lesson_ids:
                report.error(where, "lesson id {!r} repeats".format(lid))
            lesson_ids.add(lid)
            where = "lesson {}".format(lid)
        for field, limit in (("title", MAX_TITLE), ("guidance", MAX_GUIDANCE)):
            problem = string_problem(lesson.get(field), limit)
            if problem:
                report.error("{}/{}".format(where, field), problem)
        review = lesson.get("review")
        if review is not None and not isinstance(review, bool):
            report.error(where + "/review", "must be true or false")
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
            problem = id_problem(eid, ITEM_ID, 32)
            if problem:
                report.error(w + "/id", problem)
            else:
                if eid in exercise_ids:
                    report.error(w, "exercise id {!r} repeats".format(eid))
                exercise_ids.add(eid)
                w = "exercise {}".format(eid)
            problem = string_problem(ex.get("title"), MAX_EXERCISE_TITLE)
            if problem:
                report.error(w + "/title", problem)
            text = check_exercise(ex, w, known, new, report)
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
