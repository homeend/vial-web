# Generating a lesson set — instructions for an agent

_The prompt. Give an LLM or a Claude Code agent this file, the layout export, and the two documents it names, and
it writes a lesson set the app can load. The Claude Code skill `generate-lessons` wraps these steps._

## Inputs

1. `layout-export.json` — the keyboard, from **Learning → Fingers → Export** in the app, or until that exists
   from `python util/learning/export_layout.py keyboard.json -o layout-export.json` with a saved
   `GET /api/keyboard` reply (format: [lesson-format.md](lesson-format.md) section 2).
2. [lesson-rules.md](lesson-rules.md) — how to choose and order the lessons and what each exercise contains.
3. [lesson-format.md](lesson-format.md) and [lesson-set.schema.json](lesson-set.schema.json) — the output.
4. The course language (`en` unless told otherwise) and, optionally, a lesson set `id` and title.

## Steps

1. **Read the export.** List every teachable character (rules § 3) with its key id, layer, `via`, and the access
   path label. Note the resting keys (`home: true`), the Shift keys and their hands, and how each layer is reached.
   Write this list down first; everything else refers to it.
2. **Plan the course** (rules § 4): lesson 1 = resting keys; mirrored pairs and singles with their scores; the
   hand adjustments (words, `, .`, capitals); then symbols, layer symbols, digits, all keys. Produce a table like
   the scenarios in rules § 6–7: number, new characters, position, one-line guidance. Show this table to the user
   before writing exercises when working interactively; otherwise continue.
3. **Write the exercises** of every lesson in the order and with the sizes of rules § 5. Keep a running set of
   known characters; **never use a character that isn't known yet** — that includes capitals before the capitals
   lesson, apostrophes, hyphens, digits. Real words only in word/blind/text exercises; sentences in text exercises
   once capitals and the full stop are known. Vary the words between exercises of the same lesson.
   A full course is about 180 exercises; the way that worked: first save the plan as a **skeleton** (the lesson
   set with every lesson's `new` and `guidance` and empty `exercises`), then write the exercises in batches of
   three or four lessons (one subagent per batch, each with the same brief), check each batch with
   `check_lessons.py <batch>.json --course <skeleton>.json` (it takes the known characters from the skeleton's
   earlier lessons), and merge the batches back in the skeleton's order.
4. **Write the guidance** of each lesson (rules § 4.5): hand, finger, move, access path, "tap, don't hold" when the
   key also holds. Plain words.
5. **Fill the header**: `format`, `id`, `title`, `language`, `layout` (name, uid and **hash copied from the
   export**), `generatedBy`, `notes` (what was left out and why: combos, macros, toggle layers).
6. **Check**: `python util/learning/check_lessons.py <set>.json --layout layout-export.json`. Fix every error and
   every warning you can; a warning you keep gets a line in `notes`.
7. **Deliver** the file as `<id>.json`. The user puts it in `learning/<uid>/sets/` or imports it in the app.

## Rules of thumb

- A lesson's new keys should appear in at least half of its word-exercise words.
- Don't invent words. If the known characters give too few words, use letter groups (rules § 5) and say so in the
  lesson's guidance ("few real words yet").
- Keep every line under 80 characters; around 8–12 lines per exercise.
- Proper nouns, acronyms and names appear only from the capitals lesson on.
- One-shot layers: one tap per character; say it in the guidance, and keep digit runs short in the drills.
- Mirror the site's variety: the first new-key exercise of a lesson leans on the new keys, the second mixes more
  of the old ones; key exercise 2 uses other words than key exercise 1.
- Ask when the export looks wrong (a resting key with no letter, a letter missing, a layer nobody reaches); don't
  guess a layout.
