# SPDX-License-Identifier: GPL-2.0-or-later
""" The lesson generator's files, which the Learning page offers for download: the documents an LLM follows to write a
lesson set (docs/learning), the Claude Code skill that wraps them, and the generator pack, a zip of what a chat LLM
needs with the keyboard's layout export in it (the recipe: docs/learning/PROMPT.md). Vial calls no LLM itself. """
import io
import json
import os
import re
import zipfile
from typing import NamedTuple

import resources


class GeneratorFile(NamedTuple):
    name: str
    """ the file name it is served and downloaded as (unique) """
    resource: resources.Resource
    """ the bundled resource holding it """
    inside: str
    """ its '/'-separated path inside the resource; "" when the resource is the file itself """
    media_type: str
    description: str
    """ what it is, for the page's list """
    packed: bool
    """ whether the generator pack holds it """


MARKDOWN = "text/markdown; charset=utf-8"
JSON = "application/json"
ZIP = "application/zip"
EXPORT_NAME = "layout-export.json"
""" the keyboard's layout export, as the pack names it (GENERATE.md names it so) """

FILES = (
    GeneratorFile("PROMPT.md", resources.LEARNING_DOCS, "PROMPT.md", MARKDOWN,
                  "the recipe for a chat LLM that can run nothing, with the prompt to paste", True),
    GeneratorFile("GENERATE.md", resources.LEARNING_DOCS, "GENERATE.md", MARKDOWN,
                  "the instructions the LLM follows: inputs, seven steps, rules of thumb", True),
    GeneratorFile("lesson-rules.md", resources.LEARNING_DOCS, "lesson-rules.md", MARKDOWN,
                  "how to choose and order the lessons, and what each exercise holds", True),
    GeneratorFile("lesson-format.md", resources.LEARNING_DOCS, "lesson-format.md", MARKDOWN,
                  "the layout export and the lesson set, field by field", True),
    GeneratorFile("lesson-set.schema.json", resources.LEARNING_DOCS, "lesson-set.schema.json", JSON,
                  "the lesson set's JSON Schema", True),
    GeneratorFile("corne-sim-en.json", resources.LEARNING_DOCS, "examples/corne-sim-en.json", JSON,
                  "an example of the output: the first two lessons for a simulated Corne", True),
    GeneratorFile("corne-sim-layout-export.json", resources.LEARNING_DOCS, "examples/corne-sim-layout-export.json",
                  JSON, "the layout export that example was written from", False),
    GeneratorFile("ansi-60-en.json", resources.LEARNING_DOCS, "examples/ansi-60-en.json", JSON,
                  "a complete course for a plain US QWERTY board: 18 lessons, 177 exercises", False),
    GeneratorFile("course-method.md", resources.LEARNING_DOCS, "course-method.md", MARKDOWN,
                  "background: the touch-typing method the rules are written from", False),
    GeneratorFile("SKILL.md", resources.GENERATE_SKILL, "", MARKDOWN,
                  "the Claude Code skill that wraps GENERATE.md (goes in .claude/skills/generate-lessons/)", False),
)
""" every file served, in the order the page lists them """
BY_NAME = {f.name: f for f in FILES}
PACKED = tuple(f for f in FILES if f.packed)
""" what the generator pack holds, besides the layout export """


def path_of(file):
    """ Where the file is: in the repository, or in the unpacked executable """
    base = resources.path(file.resource)
    return os.path.join(base, *file.inside.split("/")) if file.inside else base


def read(file):
    """ The file's bytes """
    with open(path_of(file), "rb") as inf:
        return inf.read()


def size(file):
    """ The file's size in bytes """
    return os.path.getsize(path_of(file))


def pack(export):
    """ The generator pack: a zip of PACKED and the layout export (a dict, written as the Fingers view's Export writes
    it: one-space indentation, UTF-8) """
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in PACKED:
            zf.writestr(file.name, read(file))
        zf.writestr(EXPORT_NAME, (json.dumps(export, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
    return out.getvalue()


def safe_file_name(name):
    """ A keyboard's name as a file name, as web/src/lib/fileName.ts makes it: each run of characters file systems
    refuse becomes one "_", dots, spaces and underscores at the ends go, it is cut to 100 characters, and "keyboard"
    stands when nothing is left """
    safe = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", name)
    safe = re.sub(r"^[\s._]+|[\s._]+$", "", safe)
    return safe[:100] or "keyboard"


def pack_name(keyboard_name):
    """ The pack's file name for a keyboard: <its name>-lesson-generator.zip """
    return safe_file_name(keyboard_name) + "-lesson-generator.zip"


def attachment(file_name):
    """ The Content-Disposition that downloads the reply as file_name: a plain name when it is ASCII, else an ASCII
    stand-in with the name itself encoded (RFC 6266 / 5987) """
    try:
        file_name.encode("ascii")
    except UnicodeEncodeError:
        fallback = re.sub(r"[^\x20-\x7e]", "_", file_name).replace('"', "_")
        return "attachment; filename=\"{}\"; filename*=UTF-8''{}".format(fallback, _percent_encode(file_name))
    return 'attachment; filename="{}"'.format(file_name.replace('"', "_"))


def _percent_encode(text):
    return "".join(c if (c.isascii() and c.isalnum()) or c in "-._~" else "".join("%{:02X}".format(b) for b in c.encode("utf-8"))
                   for c in text)
