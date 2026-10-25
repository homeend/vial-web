---
name: generate-lessons
description: Generate a typing course (a Vial web lesson set) for a keyboard layout from the app's layout export. Use when the user asks for typing lessons, a learning course, or to regenerate lessons for their keyboard.
---

# Generate lessons

Follow `docs/learning/GENERATE.md` to the letter. It names the inputs (the layout export, `lesson-rules.md`,
`lesson-format.md`, `lesson-set.schema.json`), the seven steps, and the rules of thumb.

Short form:

1. Ask for the layout export if none was given (`Learning → Fingers → Export` in the app, or
   `learning/<uid>/layout-export.json` in the app's config folder; until the app has that page:
   `python util/learning/export_layout.py keyboard.json -o layout-export.json` from a saved `GET /api/keyboard`
   reply). Never work from a `.vil` file or guess fingers. Never read the owner's keyboard yourself unless told to.
2. Read the three documents in `docs/learning/`. When this project isn't the vial-web repository, the user has them
   from the app's Learning page (the generator pack: `GENERATE.md`, `lesson-rules.md`, `lesson-format.md`,
   `lesson-set.schema.json` and the export in one zip); ask where they are. Build the teachable-character list,
   then the course table (lesson-rules.md § 4), and show the table to the user before writing the exercises.
3. Write the lesson set JSON (lesson-format.md § 3) with every exercise of lesson-rules.md § 5, known characters
   only, real words, sentences once capitals and the full stop are known.
4. Run `python util/learning/check_lessons.py <set>.json --layout <export>.json`; fix errors, then warnings;
   keep what remains in `notes`. Without the repository there is no checker: check the rules and the schema
   yourself, and say that the app checks the file on import and lists what it refuses.
5. Save as `<id>.json` where the user wants it (default: next to the export) and say how to load it.

An example with the first two lessons of the simulated Corne: `docs/learning/examples/corne-sim-en.json`. A full
course for a plain US QWERTY board (18 lessons, made by this recipe): `docs/learning/examples/ansi-60-en.json`,
with its export and a simulated board next to it (`examples/ansi-60/README.md`).
