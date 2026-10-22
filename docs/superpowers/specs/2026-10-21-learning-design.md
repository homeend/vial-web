# Learning: design

_2026-10-21. Agreed with the owner in a brainstorming session. Planned as phase 9, after phase 8 (Arrange layers)
is merged. Phase 1 of the work (this document, `docs/learning/`, the lesson checker and the `generate-lessons`
skill) is on branch `phase9-learning`; the app changes below are phase 2._

## The problem

The owner has a split column-stagger keyboard with its own letter arrangement, layers under the thumbs and
home-row mods. Typing courses on the web teach a fixed layout on a row-stagger board, so none of them teaches the
owner's keyboard. The app knows the layout; it should teach it.

## Decisions

| Question | Decision |
|---|---|
| Where the lessons come from | **Generated from the layout by an agent outside the app** (Claude Code with the `generate-lessons` skill), from an export the app writes. The app only loads, shows and scores lesson sets. In-app generation with an API key is a later step, once the recipe and the UI have proven themselves. |
| What is generated | A **lesson set** in a documented JSON format with a schema and a checker, so a file either loads or says why not. |
| The method | typingstudy.com's course structure, written down as rules in `docs/learning/course-method.md` and `lesson-rules.md`: resting keys first, then mirrored pairs by usefulness, punctuation, capitals, symbols, layer symbols, numbers, all keys; the same exercise sequence per lesson. |
| Fingers | **The app proposes from the key positions; the user corrects** in a Fingers editor. The export carries the result, so the generator never guesses. |
| Scope of a course | Letters and punctuation on layer 0, capitals, then every symbol and digit reachable on any layer, with the access path taught. Modifier holds, combos, macros: not drilled. |
| Language | English first. The format carries a language per lesson set; Polish is a later lesson set with Polish letters on AltGr or a layer. |
| Pass criteria | Accuracy ≥ 95 % on every main exercise passes a lesson; WPM is recorded and a target WPM (default 30) gives a star. Nothing is locked. Both numbers are settings. |
| Where progress lives | In the app's config folder, per keyboard uid and per lesson set (`learning/<uid>/…`), as JSON written like `names.json`. |
| Layout changes | A lesson set carries a hash of the character map it was built from. A different hash marks the set **out of date**; it still opens. |
| The keyboard | **Read only.** Learning never writes to the keyboard. |

Rejected: calling an LLM from the app now (an API key, a provider choice and a prompt to maintain before the
lessons are known to be good); generating the drills in code without an LLM (word lists per language, sentence
quality — the agent does this better, and the rules make it checkable); typing against the OS keyboard events
only (the app also has the matrix tester's key-down events, but typed characters are what the OS gives, so the
page listens to `keydown`/`input` like any typing tutor).

## 1. The Learning page (web)

A new left-menu entry **Learning**, after Macros and before the Keyboard page (`lib/route.ts`, `App.svelte`).
Three views, by hash: `#learning` (lesson sets and lessons), `#learning/<set>/<lesson>` (a lesson's exercises),
`#learning/<set>/<lesson>/<exercise>` (typing). Plus **Fingers** (`#learning/fingers`).

**Lesson list**

```
┌ Learning ─────────────────────────────────────────────────────────────┐
│ Lesson set: [ Simulated Corne — English ▾ ]   Import…  Fingers…       │
│ ⚠ Built for another layout (3 characters moved). Export and           │
│   regenerate, or carry on.                                            │
│                                                                       │
│  1  New keys: Home row            ★ passed  98 %  34 wpm              │
│  2  New keys: r and d               passed  96 %  27 wpm              │
│  3  New keys: b and u               3 of 10 done                      │
│  4  New keys: l and j                                                 │
│  …                                                                    │
│                                                                       │
│ No lesson set yet? Fingers… → Export, then run the generate-lessons   │
│ skill in Claude Code and Import the file it writes.                   │
└───────────────────────────────────────────────────────────────────────┘
```

- The set selector lists `learning/<uid>/sets/*.json`; the last chosen set is remembered. Files that don't load
  are listed greyed with the checker's first error.
- A lesson row: number, title, state (passed with ★ when every main exercise reached the target WPM; "n of m
  done"; empty), best accuracy and WPM across its main exercises.

**A lesson**: the guidance text, the new keys lit on the keyboard picture (the access path shown as `hold Space →`
plus the key, the way the Overview's reach analysis names it), and the exercise list with each one's best result.

**Typing an exercise**

```
┌ 2 · New keys: r and d · Key exercise 1 ──────────────────────────────┐
│  order order trade trade hired hired tired tired stand stand …       │
│  ‾‾‾‾‾‾‾^                                                            │
│  [ keyboard picture: next key lit; hold key lit with the "held" look ]│
│  23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48                 Esc quits│
└───────────────────────────────────────────────────────────────────────┘
```

- The text is shown with the typed part marked, errors in red, the next character underlined. Group and word
  kinds join the lines with spaces and wrap; `text` shows lines one under another.
- Typing: the page listens to `keydown` (for Backspace, Enter, Escape) and `input`/`keypress` characters. A
  character is compared with the expected one; wrong ones count an error and are shown struck out until corrected.
  Backspace works inside the current group/word only (R4 of course-method.md). Space ends a word; in `text`,
  Enter ends a line. Timing starts at the first key.
- Picture: shown for all kinds but `blind`; the next key lit for `new-keys`, `keys`, `extra-keys` (the character's
  key, plus Shift of the other hand for a capital, plus the layer key with the "held" style for a layer
  character). The lookup is `analysis/find.ts`'s character → key (cheapest path), the same the lesson set's
  checker uses.
- Finishing: the result card (accuracy, WPM, time, errors; "passed" when ≥ the pass accuracy; a star at the
  target WPM), **Again** and **Next exercise**; the attempt is saved. Escape before the end discards the attempt.
- Settings on the page (gear): pass accuracy, target WPM, "show the picture in word exercises" (default on).

**Fingers** (`#learning/fingers`): the keyboard picture coloured by finger (eight colours plus thumbs), the
resting keys ringed. Click a key, pick its finger and reach from a small menu; "Reset to proposal". **Export**
writes `learning/<uid>/layout-export.json` and offers it as a download; the page says what to do with it (the
skill). **Import** takes a lesson set file, runs the checker, saves it under `sets/` and selects it.

Widths: list pages 860 px; the typing view uses the keymap width (1100 px) because of the picture. Must fit a
1080p window with the picture and six lines of text.

## 2. The server

New module `server/learning.py`, routes in `app.py`:

| Route | Does |
|---|---|
| `GET /api/learning/fingers` | the proposal merged with the user's corrections: per key `finger`, `reach`, `home`, `hand`, `row` |
| `PUT /api/learning/fingers` | saves corrections (`fingers.json`); `DELETE` resets |
| `GET /api/learning/export` | the layout export (lesson-format.md § 2); also saves it as `layout-export.json` |
| `GET /api/learning/sets` | the lesson sets of the current keyboard: id, title, language, lesson count, `outOfDate`, `error` |
| `POST /api/learning/sets` | imports a lesson set (body = the file); runs the checks of `check_lessons.py`; 422 with the errors |
| `GET /api/learning/sets/{id}` | one set |
| `DELETE /api/learning/sets/{id}` | removes a set (its progress file stays) |
| `GET /api/learning/progress/{set}` / `PUT …/{set}/{exercise}` | reads progress; records one attempt (server computes `best`, keeps 50) |
| `GET/PUT /api/learning/settings` | pass accuracy, target WPM, picture in word exercises |

- The finger proposal (lesson-rules.md § 2) is pure Python over `KeyboardModel.keys` (geometry) and layer 0's
  described keys; unit-tested on the simulated Corne, an ANSI 60 % and a 40 % ortho definition. The prototype is
  `util/learning/export_layout.py` (rotated key centres, 1u grid rows and columns, finger columns from the
  home row's letters, thumb resting key = Space/Enter); it was checked on the simulated Corne and the owner's
  W-CORNE and moves into `server/learning.py`.
- The export's character map comes from `describe.py`'s legends (`main`/`shifted`/`altGr` per language) and
  `layers.py`/`reach` for how layers are reached; transparent keys resolved through the layer stack with layer 0
  at the bottom. `hash` = SHA-256 over the sorted (key id, layer, tap/shift/altGr) triples.
- The checker's logic moves into `server/learning_check.py` and `util/learning/check_lessons.py` imports it, so
  the app and the command line agree.
- All files under `config_dir()/learning/<uid>/`, written like `NamesStore` (temp, fsync, replace; `.corrupt`
  aside on parse failure).
- The schema types are added to `schemas.py` and `web/src/api/schema.d.ts` regenerated.

## 3. The keyboard picture

`Keyboard.svelte` already has `highlights`, `rings`, `pressed` and `faded`. Learning adds nothing to it; the
typing view computes the arrays: the next key in `highlights`, the modifier/layer key in `pressed`, everything
else `faded` in the new-key exercises so the lit key stands out. The Fingers view uses `rings` with the finger
colours and `selected` for the key being edited.

## 4. Later

- In-app generation: a Settings entry for an OpenAI-compatible endpoint (covers Ollama, LM Studio, OpenRouter)
  and Anthropic; **Generate** sends GENERATE.md + the rules + the export, checks the reply with the same checker,
  retries once with the errors, saves the set. Needs the recipe proven first.
- Polish lesson sets; the course language's letter frequencies in the rules.
- A free-typing mode and a speed test on the lesson set's words.
- Drilling home-row-mod holds and combos.

## 5. Tests

- pytest: the finger proposal on three definitions; the export (resolved transparent keys, hash stability under
  renames); import with a bad file (422 with the checker's messages); progress (best, 50 attempts, pass/star);
  the files written atomically and keyed by uid.
- Vitest: the typing engine (expected/typed/errors/Backspace-in-word/Enter in text; WPM and accuracy
  formulas); the picture arrays for a plain, shifted and layer character; the lesson state (passed, star).
- e2e: import the worked example, type lesson 1's first exercise with Playwright's keyboard, see the result and
  the lesson row update; the blind exercise hides the picture; the out-of-date banner after a simulator keymap
  change.
