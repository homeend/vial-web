# Phase 9: Learning — the app (phase 2) — Implementation Plan

> **Since (phase 9 follow-ups, 2026-10-22):** a layer key exports no character on the layer it reaches (lesson-format.md § 2), so the simulated Corne's export hash is `sha256:4bc5cc1ba5f8b710` wherever this plan says `sha256:e435c3da038f9048`; the plan is left as it was written.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a **Learning** page that teaches the user's own keyboard layout: the app proposes which finger rests on and reaches each key (the user corrects it), exports the layout for the lesson generator (the `generate-lessons` Claude Code skill, phase 1 of this phase), imports the lesson set the generator writes, shows each lesson's new keys on the keyboard picture, lets the user type every exercise with the next key lit, and records accuracy and speed per keyboard on this computer. Nothing is written to the keyboard.

**Architecture:**
- **Pure Python for the layout logic.** `server/learning_layout.py` turns the keyboard model (`schemas.KeyboardModel` as a dict, the same JSON `GET /api/keyboard` sends) into the finger proposal and the **layout export** (`vial-web-layout-export/1`, `docs/learning/lesson-format.md` § 2), with the hash the lesson sets are checked against. `server/learning_check.py` checks a **lesson set** (`vial-web-lessons/1`, § 3): structure, ids, and that every exercise uses only characters taught so far. Both came from the phase 1 scripts in `util/learning/`, which become thin command lines over them, so the app and the generator's checks agree.
- **`server/learning.py` does the I/O.** `LearningStore(root)` keeps, per keyboard uid under `<config dir>/learning/<uid>/`, the finger corrections (`fingers.json`), the last export (`layout-export.json`), the lesson sets (`sets/<id>.json`) and the progress per set (`progress/<id>.json`), plus `settings.json`; every write is a temp file, fsync and replace (as `NamesStore`), every read tolerant (a bad file is listed with its error, or moved aside to `.corrupt` on a write path).
- **Routes** `/api/learning/{fingers,export,sets,sets/{set},progress/{set},progress/{set}/{exercise},settings}`, for the keyboard open, through `read()` (they work while the keyboard waits for its unlock keys too, as nothing is written to it).
- **Web:** `web/src/learning/` holds pure modules with Vitest — `types.ts` (the file formats), `engine.ts` (the typing engine: expected characters, position, errors, Backspace inside the word, Enter between text lines, WPM and accuracy), `picture.ts` (which keys light up for a character: the key, the other hand's Shift, the layer key), `state.ts` (passed / star / next exercise), `storage.ts` (the remembered set), `fingers.ts` (finger colours), `format.ts` (the texts) — a store `learning.svelte.ts`, and the views: `LearningPage.svelte` (by the address `#learning`, `#learning/fingers`, `#learning/<set>/<lesson>[/<exercise>]`), `LessonList`, `LessonView`, `TypingView`, `FingersView`, `SettingsDialog`, `Board`.
- **The keyboard picture is reused as it is:** `Keyboard.svelte` gets `highlights`, `pressed`, `faded`, `rings`, `chosen` arrays; nothing in it changes.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2.14.1, pytest 9.1.1 with pytest-xdist 3.8.0.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0 (`npm run gen:api`).
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependency: `requirements.txt`, `test-requirements.txt`, `web/package.json` and `web/package-lock.json` don't change.

**Design (scope contract):** `docs/superpowers/specs/2026-10-21-learning-design.md`, agreed with the owner on 2026-10-21; the formats `docs/learning/lesson-format.md` and the rules `docs/learning/lesson-rules.md` (phase 1, already on this branch). Phase 8 is done and on `main`.

**Source:** the verified prototype, branch `proto-phase9` (9 commits on `phase9-learning` at `c38d3e3`, from `7d3acce` to `2a1737e`; pytest 1316 passed / 6 skipped, Vitest 931, e2e 221, both example exports byte-identical to the phase 1 script's). Applied in order, the tasks below give exactly its code.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `--fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e fixtures start it exactly like that. pytest uses the in-process simulator.
   - This feature never writes to the keyboard, but the app does elsewhere: never run Vial without `--fake`.
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry. The Learning files go under the `--data-dir` of the fake servers and under pytest's `tmp_path` only.
   - Stop every server you start, with `POST /api/shutdown` first; the e2e fixtures do this. Leave no stray processes.
2. **Shell:** Git Bash on Windows; the commands are written for it.
   - Every command block starts in the repository root. A `cd` inside a block applies to that block only.
   - On Linux/macOS, replace `.venv/Scripts/python.exe` with `.venv/bin/python`.
3. **Python:** the repository's own `.venv`, Python 3.13, with `test-requirements.txt` installed. Call it as `.venv/Scripts/python.exe` explicitly. Never pipe a script into `python -`: write it to a file, or use `-c` as the steps do.
   - Tests run from `src/main/python`, because the code uses top-level imports. The whole suite runs on every core:

   ```
   cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
   ```

   - A single test file runs without `-n auto --dist worksteal`.
   - The web scripts (`gen:api`, `check:api`, e2e) find this same `.venv` themselves, or the Python named by `VIAL_PYTHON`.
   - `jsonschema` is not installed and must not be: the checker's structural checks are what the app relies on; the JSON Schema is for editors and the generator.
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency: `web/package.json` and `web/package-lock.json` don't change. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **Downloads:** none. Only the pinned packages from PyPI (into this checkout's `.venv`) and from npm (inside `web/`), and this phase adds none.
7. **End-to-end tests run in parallel** (`web/README.md`, "End-to-end tests"): half the cores by default, `E2E_WORKERS=<n>` to choose. Each Playwright worker starts its own fake servers, shared by the tests of that worker.
   - Every test puts back what it changed, in a `finally`: the Learning tests delete the set they imported, reset the fingers and the settings through the API, and put back any key they changed.
   - `npm run e2e` builds first; `npx playwright test <spec>` runs against the last build.
8. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
9. **Line endings and encodings:** Windows checkouts use CRLF (`core.autocrlf=true`); the repository stores LF.
   - Edit with tools that keep the existing line endings. Git Bash's `sed -i` strips the CRs; use an editor, or Python with `newline=''`. `git apply` keeps them.
   - Python's default encoding here is cp1250: a script that writes files must open them with `encoding="utf-8"` and `newline=''`, or "…", "←", "★" and "⚠" break.
   - Bash heredocs can mangle `\\` and some quoting: write code with an editor, not with `echo` or a heredoc.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
   - Check a written file with `git diff` before committing.
10. **Commits:** one commit per task, on branch `phase9-learning`, in its worktree (never on `main`: the owner's main tree stays on `main` until the phase is finished and merged).
    - Add the files the task names. Never `git add -A`. Leave the untracked `gh.txt`, `STATUS.md` and `docs/learning/examples/w-corne-*.json` alone (the owner decides about those two).
    - End every commit message with the trailer the session tells you to use.
11. **How code is given.**
    - "Create `X`:" is followed by the file's complete content. "Replace `X` with:" likewise, for a file that shrinks to a command line.
    - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `c38d3e3`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
    - A file changed by several tasks has one diff in each. The tasks are in order, so each diff applies to what the task before left.
    - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it in Task 4, in the same commit as the schema change.
    - Each "Expected:" lists text that the command's output contains.
12. **Standing rules (owner and earlier phases)**, for every view of the page:
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the lesson list, a lesson and the Fingers view are at most 860 px (`--list-max`); the typing view uses the keymap's 1100 px (`--content-max`) for the picture; all centred. Nothing scrolls sideways at 800 px or at 375 px.
    - Heights: the owner uses a 1080p screen, which leaves about 1920 × 950 px for the page; the typing view fits there with the picture and six lines of text.
    - Anything the user typed or a file carried (a set's title, a lesson's title, an import error) is cut short with "…" and a tooltip with the full text wherever it shows.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike. A disabled button shows no tooltip in Firefox, so buttons that need one use `aria-disabled` with a `title`.
    - Both themes, light and dark, must read well; the finger colours are tokens in all three palette blocks of `app.css`.
    - Focus is always visible, and it never falls to `<body>`: the typing area takes the focus when an exercise opens and after Again; when a view goes, the focus moves to the heading of the one that replaces it.
    - Every sentence about what the keyboard or Vial does is true for the vial-qmk firmware and for this code.
    - Each page says how saving works: the Learning page's note says "Results are kept on this computer, per keyboard."; the Fingers view says a change is saved at once; the typing view says Escape quits without saving.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

`phase9-learning` is checked out in a worktree, at `c38d3e3` (on `main` `0760185`); phase 1's documents, checker, export script and the `generate-lessons` skill are on it. `.venv` exists (Python 3.13, `test-requirements.txt` installed), and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1256 passed, 6 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  53 passed (53)` and `Tests  870 passed (870)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

```bash
cd web && npm run e2e
```

Expected: `212 passed`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/server/learning_layout.py` | **new.** Pure: `char_of`, `held_layer`, `describe_key`, `centre`, `key_id`, `grid`, `row_names`, `one_board_split`, `propose_fingers`, `proposal`, `apply_fingers`, `export`; `FORMAT`, `HOW`, `TRI_LAYER`, `SPLIT_GAP` — the finger proposal and the layout export from the keyboard model |
| `src/main/python/server/learning_check.py` | **new.** Pure: `Report`, `load`, `schema_check`, `export_chars`, `export_keys`, `check_header`, `check_new`, `check_exercise`, `check`, `check_set`; `KINDS`, `SIZES`, `MAIN_KINDS`, `ID`, `KEY_ID` — the lesson set checker |
| `util/learning/export_layout.py`, `util/learning/check_lessons.py` | thin command lines over the two modules (phase 1's scripts, same options and output) |
| `src/main/python/server/learning.py` | **new.** `LearningStore(root)`: `fingers`, `set_fingers`, `clear_fingers`, `export`, `sets`, `set`, `import_set`, `delete_set`, `progress`, `record`, `settings`, `set_settings`; `NotFound` (404), `LessonSetInvalid` (422 with `errors` and `warnings`); `ATTEMPTS_KEPT`, `DEFAULT_SETTINGS` |
| `src/main/python/server/schemas.py` | `FingerKey`, `FingerFix`, `Fingers`, `FingersIn`, `LayoutExport`, `LessonSetSummary`, `LessonSetImported`, `Attempt`, `AttemptIn`, `ExerciseProgress`, `Progress`, `LearningSettings`, `LearningSettingsIn` |
| `src/main/python/server/app.py` | `create_app(..., learning=None)` and the `/api/learning/*` routes; the 404/422/501 answers |
| `src/main/python/vial_web.py` | `learning_dir(fake)` = `<config dir>/learning`; `serve` passes `LearningStore(learning_dir(args.fake))` |
| `src/main/python/test/test_learning_layout.py` | **new.** The proposal on the simulated Corne, a one-piece 60 % and a 4×10 ortho; the export: resolved transparent keys, unreachable layers dropped, the hash stable under a rename and changed by a moved letter, rotated thumbs |
| `src/main/python/test/test_learning_check.py` | **new.** A valid set, an untaught character, a wrong `new` key against an export, `check_set` |
| `src/main/python/test/test_learning.py` | **new.** The store's files, atomic writes, corrupt files, 50 attempts, best; the routes: fingers, export, import of the worked example and of a bad file, get/delete, progress, settings |
| `src/main/python/test/test_dump_openapi.py`, `test_vial_web.py` | the new paths in the OpenAPI; `learning/` under `--data-dir` |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` (Task 4) |
| `web/src/api/client.ts`, `errors.ts`, `api.ts`, `types.ts` | `Reply` knows 201, `Method` gains `delete`, `ApiError.errors`; the 12 Learning routes and their type aliases |
| `web/src/lib/route.ts`, `router.svelte.ts` | `"learning"` section; `Route.path` (`#learning/<set>/<lesson>/<exercise>`, `#learning/fingers`); `sameRoute`; `router.go(..., {path})` |
| `web/src/learning/types.ts` | the file formats as types; `readLessonSet` |
| `web/src/learning/engine.ts` | the typing engine: `createEngine`, `press`, `resultOf`, `progressOf`, `segments` |
| `web/src/learning/picture.ts` | `placeOfChars`, `pictureFor`, `pictureForAll`, `heldKeysFor`, `nextKeyLabel`, `keyIdOf`, `keyIndex` |
| `web/src/learning/state.ts`, `storage.ts`, `fingers.ts`, `format.ts` | lesson status and next exercise; the remembered set; finger colours and labels; the texts |
| `web/src/learning/learning.svelte.ts` | the store `learning`: sets, the chosen and open set, progress, settings, export, fingers; loads, imports, records, saves |
| `web/src/learning/LearningPage.svelte` | the views by the address; unknown names → the list with a note |
| `web/src/learning/LessonList.svelte`, `SettingsDialog.svelte` | the set selector, Import…, Remove, Fingers…, the settings; the out-of-date banner; the lesson rows |
| `web/src/learning/LessonView.svelte`, `TypingView.svelte`, `Board.svelte` | a lesson's guidance, new keys and exercises; typing with the picture and the result card; the picture card |
| `web/src/learning/FingersView.svelte` | the finger editor, Reset to proposal, Export |
| `web/src/App.svelte`, `web/src/ui/SelectField.svelte` | the Learning section on every keyboard; the page's width per view; disabled choices |
| `web/src/app.css` | `--finger-index`, `--finger-middle`, `--finger-ring`, `--finger-pinky`, `--finger-thumb` in the three palettes |
| `web/e2e/learning.spec.ts`, `fixtures.ts`, `lighting.spec.ts` | the Learning tests; `api(page).delete`; the nav list includes Learning |
| `README.md` | the Learning bullet, the phase 9 row, the files table |

## Decisions

These come from the design and the verified prototype (`proto-phase9`).

1. **The finger proposal.** A split board (a gap wider than one key between the hands) uses the phase 1 rule: the hand split is the widest gap, rows and columns are a 1u grid of the rotated key centres, the three rows with the most letters are top / home / bottom, the finger columns come from the home-row columns whose key types a character, counted from the gap outwards (four: the fingers index to pinky; five: the extra column is the end whose key is not a letter, or the inner end when both ends are letters; six or more: the innermost is the extra one and the four after it the fingers), the extra inner column is the index finger's inner reach, outer ones the pinky's, the number row is always `up`, the thumb's resting key is Space, else Enter, else the widest, else the nearest to the index finger. A one-piece board (a 60 %, an ortho) has no such gap: the split falls between the home row's middle letters (the left hand takes the odd one), each letter row counts fingers from the split outwards, the number row takes the finger of the nearest top-row key (ties to the key on the right), a key exactly on the split goes left. The split-board path is byte-identical to the phase 1 script: the simulated Corne's export hash stays `sha256:e435c3da038f9048` and the owner's W-CORNE's `sha256:62c4df891e345d62`, so the lesson sets made in phase 1 stay valid. Fixed after review: the Task 1 listing below took the home row's *letter* columns `[:4]`, which on a QWERTY Corne (`A S D F G | H J K L ; '`) made G the index finger's resting key and A the pinky's outer reach; the branch has the rule above (and `visible_keys()` for decals and layout options, AltGr on letters, exact Shift detection, the number row always `up`), so the listing is historical.
2. **The export's hash** covers the character map only (every key's tap / shift / altGr characters per layer and the layer access paths), so a renamed layer or a changed macro keeps a lesson set valid, and a moved character marks it out of date. The layer's name in the export is its display name (the phase 1 script wrote `true` for a custom-named layer: fixed).
3. **Layer keys** that count as "hold" are MO, TT, LT, LM (`kind == "layer"` with a `layerAction` starting "while held", or the `LM(n, …)` spelling) and the tri-layer keys `FN_MO13`/`FN_MO23`; OSL is "oneShot", TG "toggle", TO/DF/PDF "switch". Only layer 0 and the layers a layer-0 key reaches are exported: characters on other layers can't be typed from the base layer.
4. **The store.** Files under `<config dir>/learning/<uid>/`; the `--data-dir` option moves them with everything else. A lesson set's file name is its `id` (letters, digits, `-`, `_`, at most 64), so no path escapes the folder; a file whose inner `id` differs from its name, or that doesn't parse, or fails the checker, is listed with an `error` and can't be opened. `record()` computes accuracy and WPM to one decimal, refuses `chars < 1` and `seconds ≤ 0` (422); `errors` may exceed `chars` (every wrong press counts), and accuracy floors at 0; keeps the last 50 attempts and the best (highest accuracy, then highest WPM); `progress()` recomputes `best` and `done` from the attempts kept, so a hand-edited file heals. Settings are strict (`StrictInt`, `StrictBool`): `"no"` is not `False`.
5. **The routes** go through `read()`, so they work while the keyboard waits for its unlock keys. `GET /api/learning/sets` computes the current export's hash once per request for `outOfDate` without saving the export file; `GET /api/learning/export` saves it. `POST /api/learning/sets` takes the raw JSON document (at most 4 MiB), runs the checker, answers 201 with the summary and the warnings, or 422 with `{detail, errors, warnings}`. `create_app(..., learning=None)` keeps the forty-odd existing `create_app` calls (tests, the OpenAPI dump) working: without a store the routes answer 501.
6. **The address.** `#learning` (the lesson list), `#learning/fingers`, `#learning/<set>/<lesson>` (a lesson), `#learning/<set>/<lesson>/<exercise>` (typing). Each name is `[A-Za-z0-9_-]{1,64}`, at most three; anything else under `#learning/…` shows the list and the address is replaced with `#learning` (no step back), the way `#lighting/3` is handled. `item` is always null for this section, and a `path` given to another section is dropped. Opening a lesson or exercise from the address also makes that set the remembered one, so Back shows the set you were in.
7. **The typing engine** (`engine.ts`). The expected characters are the exercise's lines joined by one space (group and word kinds), or the lines with Enter between them (`text`; the Enter counts as a character). A wrong key counts one error and the position does not advance until the right key is typed, as on typingstudy; Backspace clears the wrong mark, or moves back one position, never past the start of the current group or word (R4 of `course-method.md`), and never reduces the error count. Keys the engine doesn't know (Shift, Tab, arrows) change nothing; Backspace starts the clock like any press. `resultOf` is for a finished exercise only; `progressOf(state, now)` feeds the status line.
8. **The picture** (`picture.ts`). Where a character is comes from the lesson set itself: every lesson's `new` entries give the key id, layer and `via`; space is the layer-0 key that types it. So the lit key always matches what the generator taught, and `analysis/find.ts` is not involved. A capital lights the Shift key of the other hand (from the export's `shiftKeys`); a layer character lights the layer key with the "held" look; `via: "altGr"` the layer-0 key whose hold is AltGr. An unknown character gives all-false arrays. The lesson view unions its new keys (`pictureForAll`). Fixed after review: a plain `KC_RALT` is exported with `"hold": "AltGr"` for this alone (a mod-tap's hold already says it); among several Shift or layer keys the picture prefers a resting key (`home`), then a thumb-row key, then the first listed, and the status line names the way to a layer by the lesson's own `path` when it has one, else by the label of the key it presses; a `new` entry without a `key` places nothing, and a missing `layer` or `via` is 0 or `tap`.
9. **Pass and star.** A lesson is passed when every main exercise (`new-keys`, `keys`, `words`, `blind`, `text`) has a best attempt with accuracy ≥ the pass accuracy (default 95 %); a star when each of those also reached the target WPM (default 30). The row shows the mean of the bests. Extras don't count; nothing is locked. An attempt is saved when the exercise is typed to the end, with the exact elapsed seconds; Escape, another view or another keyboard discards it, with no question (the design: abandoned attempts are not kept).
10. **The Fingers view** marks the resting keys through `chosen` (aria-pressed) and a fill of its own, because `Keyboard.svelte` draws `pressed` only on non-interactive pictures, and the view's keys must be clickable; `Keyboard.svelte` is untouched. A change is saved at once with the whole map (every key's finger and reach, the resting keys). Export writes `layout-export.json` on the server and downloads it as `<keyboard name>-layout-export.json`.
11. **The picture in word exercises** (a setting, default on) covers `words`, `extra-words` and `text`; `blind` never shows it; the group kinds always do, with the next key lit and "Next: …" named.
12. **The client's API layer**: `Reply` knows 201 and `Method` `delete`; `ApiError` carries the server's `errors` list so the import can list them.

## Out of scope / later

- **In-app generation** (an OpenAI-compatible endpoint, Anthropic): after the recipe and this page have proven themselves (design § 4).
- **Polish lesson sets** and the course language's frequencies in the rules.
- **Dead keys and composition** in the typing view: `event.key` characters only; AltGr characters type (Ctrl+Alt = AltGr on Windows is left to the browser).
- **Drilling holds and combos.** Modifier holds, combos and macros are not drilled.
- **A free-typing mode and a speed test.**
- **The version bump and the release** at merge time: the owner's call (`version.py`, a `vX.Y.Z` tag makes the release).
- **The owner's W-CORNE example files** (`docs/learning/examples/w-corne-en.json`, `w-corne-layout-export.json`) stay untracked until the owner decides.

## Owner checklist (after the last task)

The owner runs this, not you, on the W-CORNE. Learning never writes to the keyboard.

1. **Learning → Fingers…:** the proposal on the W-CORNE (resting keys S H N T / A E O I and the two thumb keys; the finger colours), correct one key, reload the page: the correction stays. **Export** downloads `W-CORNE-layout-export.json`; its `hash` is `sha256:62c4df891e345d62` (the hash the phase 1 lesson set carries) — if it differs, say so: the lesson set would show as out of date.
2. **Import** `docs/learning/examples/w-corne-en.json` (the 19-lesson set from phase 1): no banner, 19 rows.
3. **Type lesson 1's first exercise** on the W-CORNE: the next key lights the right key, a wrong key is marked and Backspace clears it, the result card shows and the row says "1 of 7 done" (lesson 1 has 7 exercises). Then a `text` exercise (Enter between lines) and a `blind` one (no picture). Then a symbol lesson: the layer key lights with the held look.
4. **Settings** (the gear): change the pass accuracy, see a row's state change.
5. **Firefox at 1080p, both themes:** the typing view fits with the picture and six lines; nothing scrolls sideways; long titles are cut with "…".
6. **Where the files are:** `%LOCALAPPDATA%\Vial\learning\362FF631AF2847F7\` holds `fingers.json`, `layout-export.json`, `sets/`, `progress/`, `settings.json`.

---

### Task 1: `server/learning_layout.py`: the finger proposal and the layout export, pure

A *layout export* is the JSON the lesson generator (an agent outside the app, `docs/learning/GENERATE.md`) reads: which finger types each key of the keyboard and from where, what each key types on each layer (tap, with Shift, with AltGr), how each layer is reached from layer 0, and a `hash` of that character map, which a lesson set carries so that the app can tell when the layout changed under it (`docs/learning/lesson-format.md` section 2). The *finger proposal* is the app's guess at the fingers from the key positions and what layer 0 types (`docs/learning/lesson-rules.md` section 2); a *resting key* is the key a finger rests on (the home row's letters, and Space or Enter for the thumbs). Phase 1 prototyped both in `util/learning/export_layout.py`; the design (section 2) moves the logic into the server, pure Python over the keyboard model as a dict (`schemas.KeyboardModel.model_dump()`, the JSON of `GET /api/keyboard`), so that the server and the script share it. The script becomes a thin command line over the module, with the same output.

What the module does, and the decisions baked into it (from its docstrings):

- `char_of(legend, code, tap_code)`: the characters a basic key types, from `describe.py`'s legend (`main`, `shifted`, `altGr`, as the keyboard language labels them); a letter gives `tap` and `shift`; Space is `" "`.
- `describe_key(k, tap_dances)`: one described key on one layer -> (characters, hold label, layer key, transparent). Layer keys: `MO/OSL/TG/TO/TT/DF/PDF(n)` by name (`HOW` says how each reaches its layer), `LT<n>(kc)` as a hold with the tapped key's characters, a tap dance by its tap and hold. **`LM(n, mods)` and Vial's tri-layer keys `FN_MO13`/`FN_MO23` are found by `held_layer()`**: the API names LM by its number (a hex code) and the tri-layer keys by name, so they aren't matched by the `MO(n)` spelling; LM is `kind == "layer"` with a `layerAction` that starts "while held", or the `LM(n, mods)` spelling; all count as `how: "hold"`. Layer 3 (both tri-layer keys held) is no path a lesson teaches.
- `centre(g)`: the key's centre in key units, rotated the way the picture draws it (`web/src/keyboard/geometry.ts`), rounded to 2 decimals; `key_id(g)` is `"r<row>c<col>"` from the matrix position; `grid()` snaps a centre to a 1u row or column.
- `propose_fingers(keys, tap0, rest_pref)`: a **split board** (a gap wider than `SPLIT_GAP` = 1u between neighbouring key centres) parts at the widest gap, and each hand's finger columns come from the 1u columns whose home-row key types a character, from the gap outwards (four: index, middle, ring, pinky; of five, the extra column is the end whose key is not a letter, or the inner end when both are letters; of six or more, the innermost is the extra one and the next four the fingers — the rule as fixed after review, see Decision 1); the extra inner column and any column nearer the gap are the index finger's inner reach, columns beyond the pinky its outer reach; rows are named by their letters (the three rows with the most letters are top, home and bottom, anything above is the number row, anything below the thumbs). This path is **byte-identical to the phase 1 script**: both example exports come out the same (the simulated Corne's hash `sha256:e435c3da038f9048`, which `docs/learning/examples/corne-sim-layout-export.json` carries and the tests below pin; the owner's W-CORNE `sha256:62c4df891e345d62`, checked by the prototype's authors on the saved export). A **board in one piece** (ANSI, ortho: no such gap) is new in this task: the hands part between the home row's two middle letters (G and H on QWERTY), the left hand taking the odd one; its rows are staggered, so each letter row counts its keys from the gap outwards instead (inner, index, middle, ring, pinky, then the pinky's outer reach); a key exactly on the split (B, between G and H) is the left hand's; the number row is typed up from the nearest top-row key, a tie going to the one on the right (2 is above Q and W: the ring finger's; 8 above U and I: the middle finger's), as the typing charts have it. The thumb rests on Space, else Enter, else the widest key, else the one nearest the index finger; the other thumb keys are inner or outer by their distance to the split.
- `proposal(model)` runs it on layer 0 (`tap0`: what each key taps; `rest_pref`: 2 for Space, 1 for Enter). `apply_fingers(proposal, fingers_file)` puts the user's corrections (a `vial-web-fingers/1` file, Task 3) on top as a new dict: keys the keyboard doesn't have are ignored, a resting key that isn't a thumb's gets the `rest` reach, a thumb key keeps its reach.
- `export(model, fingers=None, language="en-us")`: the export. A transparent key on a higher layer types what layer 0 types there (layer 0 is the bottom of the stack); only layer 0 and the layers a layer-0 key reaches are kept, since characters on the others can't be typed; `reachedBy` lists each layer's access paths with a label ("hold Space", "tap OSL 3"); `shiftKeys` the Shift keys and mod-taps holding Shift, per hand; the keys are sorted by position (y, then x). **`hash`** is SHA-256 (the first 16 hex digits) over the sorted (key id, layer, tap/shift/altGr, character) triples and the (layer, key, how) reach pairs, and nothing else, so a lesson set stays valid when a layer is renamed. The layer's name in the export is `l["name"]`: the phase 1 script wrote `customName or name`, which is a bug (`customName` is a flag).

The tests build the model of three simulated keyboards (`model_of()`: the API's model of a `VirtualKeyboard`, as a dict): the simulated Corne (split), a row-stagger ANSI 60 % and a 4x10 ortho; they pin the resting keys, thumbs and reaches, the number row, rotated thumb keys landing in the thumb row, the corrections, transparent keys and unreachable layers in the export, the worked example (proposal and export, field by field, hash included), the hash ignoring a rename but not two letters swapped, and LM and the tri-layer keys reaching their layer. `test_learning.py` (Tasks 3 and 4) imports `model_of` and `EXAMPLES` from here.

**Files:**
- Create: `src/main/python/server/learning_layout.py`
- Replace: `util/learning/export_layout.py`
- Test: `src/main/python/test/test_learning_layout.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_learning_layout.py`:

```python
""" The finger proposal and the layout export (server.learning_layout), on the simulated Corne, an ANSI 60 % and a
4x10 ortho: pure functions over the keyboard model as a dict """
import json
import os

import pytest

from server import learning_layout, model
from server.device import DeviceManager, FakeBackend
from simulator import corne
from simulator.corne import make_corne, encode
from simulator.virtual_keyboard import VirtualKeyboard

NO_NAMES = {"layers": {}, "tapDance": {}, "macros": {}}

EXAMPLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "docs", "learning",
                        "examples")


def model_of(factory):
    """ The API's model (GET /api/keyboard) of a simulated keyboard, as a dict """
    manager = DeviceManager(FakeBackend(factory))
    manager.connect()
    return manager.read(lambda kb: model.build(kb, NO_NAMES, True)).model_dump()


def keymap_of(rows):
    """ {(0, row, col): keycode} from the keycode names of layer 0, one list per matrix row """
    return {(0, r, c): encode(code) for r, row in enumerate(rows) for c, code in enumerate(row)}


def ids_by_tap(built):
    """ keycode name on layer 0 -> key id (the first key with it) """
    out = {}
    for g, k in zip(built["keys"], built["layers"][0]["keys"]):
        out.setdefault(k["code"], learning_layout.key_id(g))
    return out


# a row-stagger 60 %: the number row, Tab 1.5u, Caps 1.75u, Shift 2.25u / 2.75u, 1.25u modifiers and a 6.25u Space
ANSI_60 = {
    "name": "ANSI 60", "matrix": {"rows": 5, "cols": 14},
    "layouts": {"keymap": [
        ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "0,6", "0,7", "0,8", "0,9", "0,10", "0,11", "0,12", {"w": 2}, "0,13"],
        [{"w": 1.5}, "1,0", "1,1", "1,2", "1,3", "1,4", "1,5", "1,6", "1,7", "1,8", "1,9", "1,10", "1,11", "1,12",
         {"w": 1.5}, "1,13"],
        [{"w": 1.75}, "2,0", "2,1", "2,2", "2,3", "2,4", "2,5", "2,6", "2,7", "2,8", "2,9", "2,10", "2,11",
         {"w": 2.25}, "2,12"],
        [{"w": 2.25}, "3,0", "3,1", "3,2", "3,3", "3,4", "3,5", "3,6", "3,7", "3,8", "3,9", "3,10", {"w": 2.75}, "3,11"],
        [{"w": 1.25}, "4,0", {"w": 1.25}, "4,1", {"w": 1.25}, "4,2", {"w": 6.25}, "4,3", {"w": 1.25}, "4,4",
         {"w": 1.25}, "4,5", {"w": 1.25}, "4,6", {"w": 1.25}, "4,7"],
    ]},
}
ANSI_60_LAYER_0 = [
    ["KC_GRV", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5", "KC_6", "KC_7", "KC_8", "KC_9", "KC_0", "KC_MINS", "KC_EQL",
     "KC_BSPC"],
    ["KC_TAB", "KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P", "KC_LBRC", "KC_RBRC",
     "KC_BSLS"],
    ["KC_CAPS", "KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H", "KC_J", "KC_K", "KC_L", "KC_SCLN", "KC_QUOT", "KC_ENT"],
    ["KC_LSFT", "KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH", "KC_RSFT"],
    ["KC_LCTL", "KC_LGUI", "KC_LALT", "KC_SPC", "KC_RALT", "KC_RGUI", "MO(1)", "KC_RCTL"],
]

# a 4x10 ortho (no number row, two Space keys in the bottom row)
ORTHO_4X10 = {
    "name": "Ortho", "matrix": {"rows": 4, "cols": 10},
    "layouts": {"keymap": [["{},{}".format(r, c) for c in range(10)] for r in range(4)]},
}
ORTHO_LAYER_0 = [
    ["KC_Q", "KC_W", "KC_E", "KC_R", "KC_T", "KC_Y", "KC_U", "KC_I", "KC_O", "KC_P"],
    ["KC_A", "KC_S", "KC_D", "KC_F", "KC_G", "KC_H", "KC_J", "KC_K", "KC_L", "KC_SCLN"],
    ["KC_Z", "KC_X", "KC_C", "KC_V", "KC_B", "KC_N", "KC_M", "KC_COMM", "KC_DOT", "KC_SLSH"],
    ["KC_LCTL", "KC_LGUI", "KC_LALT", "MO(1)", "KC_SPC", "KC_SPC", "MO(2)", "KC_LEFT", "KC_DOWN", "KC_RGHT"],
]


@pytest.fixture(scope="module")
def corne_model():
    return model_of(make_corne)


@pytest.fixture(scope="module")
def ansi_model():
    return model_of(lambda: VirtualKeyboard(ANSI_60, layers=2, keymap=keymap_of(ANSI_60_LAYER_0)))


@pytest.fixture(scope="module")
def ortho_model():
    return model_of(lambda: VirtualKeyboard(ORTHO_4X10, layers=3, keymap=keymap_of(ORTHO_LAYER_0)))


def fingers_by_tap(built):
    proposal = learning_layout.proposal(built)
    return {code: proposal[kid] for code, kid in ids_by_tap(built).items()}


# ---------- the proposal: simulated Corne ----------

def test_corne_resting_keys_are_the_home_row_letters_and_both_thumb_rests(corne_model):
    proposal = learning_layout.proposal(corne_model)
    by_tap = fingers_by_tap(corne_model)
    home = sorted(kid for kid, f in proposal.items() if f["home"])
    # left home row S H N T (r1c1..r1c4), right A E O I (r5c1..r5c4), Space (r3c4) and Enter (r7c4)
    assert home == ["r1c1", "r1c2", "r1c3", "r1c4", "r3c4", "r5c1", "r5c2", "r5c3", "r5c4", "r7c4"]
    assert by_tap["LT2(KC_S)"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["LSFT_T(KC_T)"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["RGUI_T(KC_A)"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["RSFT_T(KC_I)"]["finger"] == "pinky" and by_tap["RSFT_T(KC_I)"]["hand"] == "right"


def test_corne_thumbs_and_reaches(corne_model):
    by_tap = fingers_by_tap(corne_model)
    # the LT1(KC_SPC) thumb is the left rest, Enter the right one; the others inner / outer by their distance to the gap
    assert by_tap["LT1(KC_SPACE)"] == {"hand": "left", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_ENTER"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_ESCAPE"]["reach"] == "outer" and by_tap["TD(0)"]["reach"] == "inner"
    assert by_tap["M0"]["reach"] == "inner" and by_tap["OSL(3)"]["reach"] == "outer"
    # the sixth column (comma, Z, slash) is the index finger's inner reach; the first (Tab, Ctrl, Shift) the pinky's outer
    assert by_tap["KC_COMMA"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_Z"]["reach"] == "inner" and by_tap["KC_SLASH"]["reach"] == "inner"
    assert by_tap["KC_TAB"] == {"hand": "left", "finger": "pinky", "row": "top", "reach": "outer", "home": False}
    assert by_tap["KC_LCTRL"]["reach"] == "outer" and by_tap["KC_LSHIFT"]["reach"] == "outer"
    assert by_tap["KC_Q"]["reach"] == "inner" and by_tap["KC_BSLASH"]["finger"] == "pinky"
    assert by_tap["KC_BSPACE"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "outer", "home": False}
    # up and down from the resting keys
    assert by_tap["KC_L"] == {"hand": "left", "finger": "ring", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_V"] == {"hand": "left", "finger": "index", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_Y"] == {"hand": "right", "finger": "pinky", "row": "bottom", "reach": "down", "home": False}


def test_corne_proposal_matches_the_worked_example(corne_model):
    """ docs/learning/examples/corne-sim-layout-export.json was made by the verified prototype """
    with open(os.path.join(EXAMPLES, "corne-sim-layout-export.json"), encoding="utf-8") as inf:
        example = json.load(inf)
    proposal = learning_layout.proposal(corne_model)
    for key in example["keys"]:
        expected = {k: key[k] for k in ("hand", "finger", "row", "reach", "home")}
        assert proposal[key["id"]] == expected, key["id"]


# ---------- the proposal: a row-stagger 60 % ----------

def test_ansi_home_row(ansi_model):
    by_tap = fingers_by_tap(ansi_model)
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_S"]["finger"] == "ring" and by_tap["KC_D"]["finger"] == "middle"
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"] == {"hand": "left", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_H"] == {"hand": "right", "finger": "index", "row": "home", "reach": "inner", "home": False}
    assert by_tap["KC_J"] == {"hand": "right", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_SCOLON"] == {"hand": "right", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_QUOTE"]["reach"] == "outer" and by_tap["KC_ENTER"]["reach"] == "outer"
    assert by_tap["KC_CAPSLOCK"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "outer", "home": False}


def test_ansi_other_rows(ansi_model):
    by_tap = fingers_by_tap(ansi_model)
    assert by_tap["KC_P"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_Q"]["finger"] == "pinky" and by_tap["KC_Q"]["reach"] == "up"
    assert by_tap["KC_T"]["reach"] == "inner" and by_tap["KC_Y"]["reach"] == "inner"
    assert by_tap["KC_R"] == {"hand": "left", "finger": "index", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_B"] == {"hand": "left", "finger": "index", "row": "bottom", "reach": "inner", "home": False}
    assert by_tap["KC_N"]["hand"] == "right" and by_tap["KC_N"]["reach"] == "inner"
    assert by_tap["KC_M"] == {"hand": "right", "finger": "index", "row": "bottom", "reach": "down", "home": False}
    assert by_tap["KC_SLASH"]["finger"] == "pinky" and by_tap["KC_RSHIFT"]["reach"] == "outer"
    assert by_tap["KC_SPACE"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert by_tap["KC_LCTRL"]["row"] == "thumb" and by_tap["KC_LCTRL"]["finger"] == "thumb"
    # the number row: up from the top row's finger, as the charts have it (1 pinky, 2 ring, 3 middle, 4 5 6 index;
    # 7 index, 8 middle, 9 ring, 0 - pinky)
    assert by_tap["KC_1"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_2"]["finger"] == "ring" and by_tap["KC_3"]["finger"] == "middle"
    assert by_tap["KC_4"] == {"hand": "left", "finger": "index", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_5"]["finger"] == "index" and by_tap["KC_6"]["finger"] == "index"
    assert by_tap["KC_6"]["hand"] == "left" and by_tap["KC_7"]["hand"] == "right"
    assert by_tap["KC_7"]["finger"] == "index"
    assert by_tap["KC_8"] == {"hand": "right", "finger": "middle", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_9"]["finger"] == "ring"
    assert by_tap["KC_0"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "up", "home": False}
    assert by_tap["KC_MINUS"]["finger"] == "pinky" and by_tap["KC_EQUAL"]["reach"] == "outer"
    assert by_tap["KC_GRAVE"] == {"hand": "left", "finger": "pinky", "row": "number", "reach": "outer", "home": False}
    assert by_tap["KC_BSPACE"] == {"hand": "right", "finger": "pinky", "row": "number", "reach": "outer", "home": False}


# ---------- the proposal: a 4x10 ortho ----------

def test_ortho(ortho_model):
    by_tap = fingers_by_tap(ortho_model)
    proposal = learning_layout.proposal(ortho_model)
    assert by_tap["KC_A"] == {"hand": "left", "finger": "pinky", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_F"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
    assert by_tap["KC_G"]["reach"] == "inner" and by_tap["KC_H"]["reach"] == "inner"
    assert by_tap["KC_T"] == {"hand": "left", "finger": "index", "row": "top", "reach": "inner", "home": False}
    assert by_tap["KC_P"] == {"hand": "right", "finger": "pinky", "row": "top", "reach": "up", "home": False}
    assert by_tap["KC_SCOLON"]["home"] is True and by_tap["KC_SLASH"]["reach"] == "down"
    # each hand's Space is its thumb's resting key
    assert proposal["r3c4"] == {"hand": "left", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert proposal["r3c5"] == {"hand": "right", "finger": "thumb", "row": "thumb", "reach": "rest", "home": True}
    assert proposal["r3c3"]["reach"] == "outer" and proposal["r3c6"]["reach"] == "outer"
    assert not any(f["row"] == "number" for f in proposal.values())


def rotated_thumbs_corne():
    """ The simulated Corne with its thumb keys drawn at the bottom letter row's height, but rotated by 30 degrees so
    that their centres end up below it (as a real Corne's vial.json draws them) """
    definition = corne.definition()
    rows = definition["layouts"]["keymap"]
    rows[3] = [{"r": 30, "rx": 3, "ry": 3, "x": 1.5, "y": -1}] + ["{},{}".format(*rc) for rc in corne.LEFT_THUMBS]
    rows.append([{"r": -30, "rx": 12, "ry": 3, "x": -4.5, "y": -1}] + ["{},{}".format(*rc) for rc in corne.RIGHT_THUMBS])
    return VirtualKeyboard(definition, layers=4, keymap=corne.keymap(), uid=corne.CORNE_UID)


def test_rotated_thumb_keys_land_in_the_thumb_row():
    built = model_of(rotated_thumbs_corne)
    proposal = learning_layout.proposal(built)
    for rc in corne.LEFT_THUMBS + corne.RIGHT_THUMBS:
        kid = "r{}c{}".format(*rc)
        assert proposal[kid]["row"] == "thumb" and proposal[kid]["finger"] == "thumb", kid
        geometry = next(g for g in built["keys"] if (g["row"], g["col"]) == rc)
        assert geometry["y"] == 2 and learning_layout.centre(geometry)[1] > 3  # drawn in the bottom row, rotated below it
    assert proposal["r3c4"]["reach"] == "rest" and proposal["r7c4"]["reach"] == "rest"
    assert proposal["r1c4"]["home"] and proposal["r2c4"]["row"] == "bottom"


# ---------- corrections ----------

def test_apply_fingers_overrides_and_resting_keys(corne_model):
    proposal = learning_layout.proposal(corne_model)
    fixed = learning_layout.apply_fingers(proposal, {
        "format": "vial-web-fingers/1",
        "keys": {"r0c5": {"finger": "middle", "reach": "up"}, "r9c9": {"finger": "ring", "reach": "up"}},
        "home": ["r1c1", "r1c2", "r1c3", "r1c5", "r3c3"],
    })
    assert fixed["r0c5"]["finger"] == "middle" and fixed["r0c5"]["reach"] == "up"
    assert "r9c9" not in fixed
    assert fixed["r1c5"]["home"] and fixed["r1c5"]["reach"] == "rest"
    assert not fixed["r1c4"]["home"] and fixed["r1c4"]["reach"] == "rest"  # a finger's reach is its own to change
    assert fixed["r3c3"]["home"] and fixed["r3c3"]["reach"] == "outer"  # a thumb key keeps its reach
    assert not fixed["r3c4"]["home"]
    assert proposal["r0c5"]["finger"] == "index"  # the proposal itself is left alone


# ---------- the export ----------

def test_export_resolves_transparent_keys_and_drops_unreachable_layers(corne_model):
    export = learning_layout.export(corne_model)
    assert export["format"] == "vial-web-layout-export/1"
    assert export["keyboard"] == {"name": "Simulated Corne", "uid": "5EEDC0DE00420042"}
    assert export["language"] == "en-us"
    keys = {k["id"]: k for k in export["keys"]}
    # T on layer 0 is a mod-tap (Shift); layer 1 types ")", layer 3 "4" (and "$" with Shift); on layer 2 it is Shift
    assert keys["r1c4"]["chars"] == {"0": {"tap": "t", "shift": "T", "hold": "Shift"}, "1": {"tap": ")"},
                                     "3": {"tap": "4", "shift": "$"}}
    # B holds layer 2, where it is transparent: it types B there as well
    assert keys["r0c4"]["chars"] == {"0": {"tap": "b", "shift": "B", "hold": "layer 2"}, "1": {"tap": "$"},
                                     "2": {"tap": "b", "shift": "B"}}
    assert keys["r0c4"]["layerKey"] == {"layer": 2, "how": "hold"}
    # Space is transparent on every other layer: it types a space on each
    assert keys["r3c4"]["chars"] == {"0": {"tap": " ", "hold": "layer 1"}, "1": {"tap": " "}, "2": {"tap": " "},
                                     "3": {"tap": " "}}
    assert keys["r3c4"]["layerKey"] == {"layer": 1, "how": "hold"}
    assert [l["index"] for l in export["layers"]] == [0, 1, 2, 3]
    assert export["layers"][1]["reachedBy"] == [{"key": "r3c4", "how": "hold", "label": "hold Space"}]
    assert export["layers"][3]["reachedBy"] == [{"key": "r7c3", "how": "oneShot", "label": "tap OSL 3"}]
    assert {s["key"] for s in export["shiftKeys"]} == {"r1c4", "r5c1", "r2c0", "r6c0"}
    assert export["keys"] == sorted(export["keys"], key=lambda k: (k["y"], k["x"]))


def test_export_matches_the_worked_example(corne_model):
    with open(os.path.join(EXAMPLES, "corne-sim-layout-export.json"), encoding="utf-8") as inf:
        example = json.load(inf)
    export = learning_layout.export(corne_model)
    assert export["hash"] == example["hash"]
    for field in ("keyboard", "layers", "shiftKeys", "keys"):
        assert export[field] == example[field], field


def test_export_with_fewer_layers_drops_those_no_key_reaches():
    built = model_of(lambda: make_corne(layers=2))
    export = learning_layout.export(built)
    assert [l["index"] for l in export["layers"]] == [0, 1]
    assert all(set(k["chars"]) <= {"0", "1"} for k in export["keys"])


def test_hash_ignores_layer_names_but_not_moved_letters(corne_model):
    base = learning_layout.export(corne_model)["hash"]
    renamed = json.loads(json.dumps(corne_model))
    renamed["layers"][1]["name"], renamed["layers"][1]["customName"] = "Symbols", True
    assert learning_layout.export(renamed)["hash"] == base
    assert learning_layout.export(renamed)["layers"][1]["name"] == "Symbols"
    moved = model_of(lambda: make_corne())
    i, j = next(i for i, g in enumerate(moved["keys"]) if (g["row"], g["col"]) == (0, 2)), \
        next(i for i, g in enumerate(moved["keys"]) if (g["row"], g["col"]) == (0, 3))
    keys = moved["layers"][0]["keys"]
    keys[i], keys[j] = keys[j], keys[i]  # L and R change places
    assert learning_layout.export(moved)["hash"] != base
    assert learning_layout.export(corne_model, language="pl")["language"] == "pl"


def test_layer_mod_and_tri_layer_keys_reach_their_layer():
    definition = {"name": "LM", "matrix": {"rows": 1, "cols": 4},
                  "layouts": {"keymap": [["0,0", "0,1", "0,2", "0,3"]]}}
    keymap = {(0, 0, 0): encode("LM(1, MOD_LSFT)"), (0, 0, 1): encode("FN_MO13"), (0, 0, 2): encode("FN_MO23"),
              (0, 0, 3): encode("KC_A"), (1, 0, 3): encode("KC_B"), (2, 0, 3): encode("KC_C"), (3, 0, 3): encode("KC_D")}
    built = model_of(lambda: VirtualKeyboard(definition, layers=4, keymap=keymap))
    export = learning_layout.export(built)
    reached = {l["index"]: l["reachedBy"] for l in export["layers"]}
    assert set(reached) == {0, 1, 2}  # layer 3 (both tri-layer keys held) isn't a path a lesson teaches
    assert reached[1] == [{"key": "r0c0", "how": "hold", "label": "hold LM 1"},
                          {"key": "r0c1", "how": "hold", "label": "hold Fn1 (Fn3)"}]
    assert reached[2] == [{"key": "r0c2", "how": "hold", "label": "hold Fn2 (Fn3)"}]
    keys = {k["id"]: k for k in export["keys"]}
    assert keys["r0c0"]["layerKey"] == {"layer": 1, "how": "hold"}
    assert keys["r0c3"]["chars"] == {"0": {"tap": "a", "shift": "A"}, "1": {"tap": "b", "shift": "B"},
                                     "2": {"tap": "c", "shift": "C"}}
```

- [ ] **Step 2: Run it: it fails**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning_layout.py
```

Expected: `ImportError: cannot import name 'learning_layout' from 'server'`

- [ ] **Step 3: The module**

Create `src/main/python/server/learning_layout.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" The Learning feature's layout export (docs/learning/lesson-format.md section 2): which finger types each key, by
the rules of lesson-rules.md section 2, and what each key types on each layer. Pure functions over the keyboard's
model as a dict (schemas.KeyboardModel.model_dump(), the JSON of GET /api/keyboard), so that the server and
util/learning/export_layout.py share them. """
import hashlib
import json
import math
import re
from datetime import datetime, timezone

FORMAT = "vial-web-layout-export/1"
FINGERS_OUT = ["index", "middle", "ring", "pinky"]
""" the finger columns from the gap outwards """
LAYER_KEY = re.compile(r"^(MO|OSL|TG|TO|TT|DF|PDF)\((\d+)\)$")
LAYER_MOD = re.compile(r"^LM\((\d+),.*\)$")
LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")
TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
HOW = {"MO": "hold", "OSL": "oneShot", "TG": "toggle", "TT": "hold", "TO": "switch", "DF": "switch", "PDF": "switch"}
""" how a layer key reaches its layer, by keycode; LM and the tri-layer keys are MO-like (see held_layer) """
TRI_LAYER = {"FN_MO13": 1, "FN_MO23": 2}
""" Vial's tri-layer keys: layer 1 or 2 while held (and layer 3 while both are, which no lesson teaches) """
HELD = "while held"
""" the start of Described.layerAction for a layer that is on while the key is held (LM, with or without modifiers) """
SPLIT_GAP = 1.0
""" a gap wider than this between neighbouring key centres (in key units) splits the board in two halves; without one
the board is one piece and the hands part between the home row's middle letters """
REACH_OF_ROW = {"home": "rest", "top": "up", "bottom": "down", "number": "up"}
""" a finger column's reach by row: the number row is up from the top row's finger """


def char_of(legend, code, tap_code):
    """ {"tap", "shift", "altGr"} typed by a basic key, or None when it types nothing printable """
    if not legend:
        return None
    main = legend.get("main") or ""
    if code == "KC_SPACE" or tap_code == "KC_SPACE":
        return {"tap": " "}
    if len(main) == 1 and main.isalpha():
        return {"tap": main.lower(), "shift": main.upper()}
    if len(main) == 1 and not main.isspace():
        out = {"tap": main}
        if legend.get("shifted") and len(legend["shifted"]) == 1:
            out["shift"] = legend["shifted"]
        if legend.get("altGr") and len(legend["altGr"]) == 1:
            out["altGr"] = legend["altGr"]
        return out
    return None


def held_layer(k):
    """ The layer an LM or tri-layer key holds, or None. The API names LM by its number (a hex code) and the tri-layer
    keys FN_MO13 / FN_MO23, so these aren't found by the keycode name as MO(n) is. """
    code = k.get("code") or ""
    if code in TRI_LAYER:
        return TRI_LAYER[code]
    m = LAYER_MOD.match(code)
    if m:
        return int(m.group(1))
    if k.get("kind") == "layer" and isinstance(k.get("layer"), int) and (k.get("layerAction") or "").startswith(HELD):
        return k["layer"]
    return None


def describe_key(k, tap_dances):
    """ (chars, hold label, layer key, transparent) of one described key (schemas.Described as a dict) on one layer """
    code = k.get("code") or "KC_NO"
    if code in ("KC_NO", "KC_TRNS"):
        return None, None, None, code == "KC_TRNS"
    hold = k.get("hold")
    layer_key = None
    m = LAYER_KEY.match(code)
    if m:
        layer_key = {"layer": int(m.group(2)), "how": HOW[m.group(1)]}
        return None, None, layer_key, False
    held = held_layer(k)
    if held is not None:
        return None, None, {"layer": held, "how": "hold"}, False
    m = LAYER_TAP.match(code)
    if m:
        layer_key = {"layer": int(m.group(1)), "how": "hold"}
        hold = "layer {}".format(m.group(1))
    td = TAP_DANCE.match(code)
    if td and int(td.group(1)) < len(tap_dances):
        dance = tap_dances[int(td.group(1))]
        tap = dance.get("tap") or {}
        chars = char_of(tap.get("legend"), tap.get("code"), tap.get("tapCode"))
        h = dance.get("hold") or {}
        hm = LAYER_KEY.match(h.get("code") or "")
        if hm:
            layer_key = {"layer": int(hm.group(2)), "how": HOW[hm.group(1)]}
            hold = "layer {}".format(hm.group(2))
        elif h.get("code") not in (None, "KC_NO"):
            hold = (h.get("legend") or {}).get("main")
        return chars, hold, layer_key, False
    if k.get("kind") == "modifier":
        return None, None, None, False
    chars = char_of(k.get("legend"), code, k.get("tapCode"))
    if k.get("kind") == "mod-tap" or (hold and k.get("tapCode")):
        hold = hold or k.get("hold")
    return chars, hold, layer_key, False


def centre(g):
    """ The key's centre in key units, rotated the way the picture draws it (web/src/keyboard/geometry.ts) """
    x, y = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
    r = g.get("r") or 0
    if not r:
        return round(x, 2), round(y, 2)
    rx, ry = g.get("rx") or 0, g.get("ry") or 0
    a = math.radians(r)
    dx, dy = x - rx, y - ry
    return round(rx + dx * math.cos(a) - dy * math.sin(a), 2), round(ry + dx * math.sin(a) + dy * math.cos(a), 2)


def key_id(g):
    """ "r1c4": the key's id in the export, from its matrix position """
    return "r{}c{}".format(g["row"], g["col"])


def grid(value, origin):
    """ Which 1u row or column a centre falls in, counted from the first one (column stagger is under half a key) """
    return math.floor(value - origin + 0.5)


def row_names(keys, row_idx, letter):
    """ Row number -> "number", "top", "home", "bottom" or "thumb": the three rows with the most letters are top, home
    and bottom; anything above is the number row, anything below the thumbs. Also the home row's number. """
    rows = sorted(set(row_idx.values()))
    letters_in_row = {r: sum(1 for g in keys if row_idx[key_id(g)] == r and letter[key_id(g)]) for r in rows}
    main_rows = sorted(sorted(rows, key=lambda r: -letters_in_row[r])[:3])
    names = {}
    for r in rows:
        if r in main_rows:
            names[r] = ("top", "home", "bottom")[main_rows.index(r)]
        elif r < main_rows[0]:
            names[r] = "number"
        else:
            names[r] = "thumb"
    return names, main_rows[1] if len(main_rows) > 1 else main_rows[0]


def one_board_split(keys, pos, letter):
    """ Where the hands part on a board in one piece: between the two middle letters of the home row (g and h on
    QWERTY), the left hand taking the odd one. Halfway across when the home row has fewer than two letters. """
    y0 = min(p[1] for p in pos.values())
    row_idx = {key_id(g): grid(pos[key_id(g)][1], y0) for g in keys}
    _, home_row = row_names(keys, row_idx, letter)
    xs = sorted(pos[key_id(g)][0] for g in keys if row_idx[key_id(g)] == home_row and letter[key_id(g)])
    if len(xs) < 2:
        xs = sorted(p[0] for p in pos.values())
        return (xs[0] + xs[-1]) / 2
    left = (len(xs) + 1) // 2
    return (xs[left - 1] + xs[left]) / 2


def propose_fingers(model, tap0, rest_pref):
    """ Key id -> {hand, finger, row, reach, home} from the positions and what layer 0 types. `tap0`: id -> the
    character tapped on layer 0; `rest_pref`: id -> 2 for Space, 1 for Enter (the thumbs' resting keys).

    A split board (a gap wider than SPLIT_GAP) parts at the gap, and each hand's finger columns are the 1u columns
    whose home-row key is a letter, from the gap outwards; a column nearer the gap is the index finger's inner reach
    and columns beyond the pinky its outer reach. A board in one piece parts between the home row's middle letters,
    and its rows are staggered, so each row counts its keys from the gap outwards instead: inner, index, middle, ring,
    pinky, outer. The rows below the bottom letter row are the thumbs; the thumb rests on Space, else Enter, else the
    widest key, else the one nearest the index finger. """
    keys = model["keys"]
    pos = {key_id(g): centre(g) for g in keys}
    letter = {kid: bool(c) and c.isalpha() for kid, c in tap0.items()}
    xs = sorted({p[0] for p in pos.values()})
    # the hand split is the widest gap between key centres, when there is one
    gap_at = max(zip(xs, xs[1:]), key=lambda p: p[1] - p[0]) if len(xs) > 1 else (xs[0], xs[0])
    one_board = gap_at[1] - gap_at[0] <= SPLIT_GAP
    split = one_board_split(keys, pos, letter) if one_board else (gap_at[0] + gap_at[1]) / 2
    out = {}
    for hand in ("left", "right"):
        # a key right under the split (B on a row-stagger board, between G and H) is the left hand's; on a split board
        # no key centre lies in the gap
        hand_keys = [g for g in keys if (pos[key_id(g)][0] <= split) == (hand == "left")]
        if not hand_keys:
            continue
        y0 = min(pos[key_id(g)][1] for g in hand_keys)
        x0 = min(pos[key_id(g)][0] for g in hand_keys)
        row_idx = {key_id(g): grid(pos[key_id(g)][1], y0) for g in hand_keys}
        col_idx = {key_id(g): grid(pos[key_id(g)][0], x0) for g in hand_keys}
        row_name, home_row = row_names(hand_keys, row_idx, letter)
        row_of = {kid: row_name[r] for kid, r in row_idx.items()}
        # finger columns: the columns whose home-row key is a letter, from the gap outwards
        cols = sorted({col_idx[kid] for kid in row_of if row_of[kid] != "thumb"})
        home_letter_cols = sorted({col_idx[kid] for kid in row_of if row_idx[kid] == home_row and letter[kid]})
        if hand == "left":
            home_letter_cols.reverse()  # nearest the gap first
        finger_cols = home_letter_cols[:4]
        finger_of = {c: FINGERS_OUT[i] for i, c in enumerate(finger_cols)}
        inner_cols = [c for c in cols if (c > finger_cols[0]) == (hand == "left")] if finger_cols else []
        outer_cols = [c for c in cols if (c < finger_cols[-1]) == (hand == "left")] if finger_cols else []
        # one board: each letter row's keys counted from the gap; position 0 is the inner reach, 1 to 4 the fingers,
        # the rest the pinky's outer reach. The number row is shifted half a key to the left of the letter rows, so
        # each of its keys is typed up from the nearest top-row key, a tie going to the one on the right (2 is above Q
        # and W, and the ring finger's; 8 above U and I, and the middle finger's)
        from_gap, one_board_fingers = {}, {}
        if one_board:
            for r in set(row_idx.values()):
                in_row = sorted((g for g in hand_keys if row_idx[key_id(g)] == r),
                                key=lambda g: abs(pos[key_id(g)][0] - split))
                from_gap.update({key_id(g): i for i, g in enumerate(in_row)})
            for kid, i in from_gap.items():
                if row_of[kid] in ("number", "thumb"):
                    continue
                if i == 0:
                    one_board_fingers[kid] = ("index", "inner")
                elif i <= 4:
                    one_board_fingers[kid] = (FINGERS_OUT[i - 1], REACH_OF_ROW[row_of[kid]])
                else:
                    one_board_fingers[kid] = ("pinky", "outer")
            top = [kid for kid in from_gap if row_of[kid] == "top"]
            for kid in from_gap:
                if row_of[kid] == "number":
                    if not top:
                        one_board_fingers[kid] = ("index", "inner") if from_gap[kid] == 0 else ("pinky", "outer")
                        continue
                    below = min(top, key=lambda t: (round(abs(pos[t][0] - pos[kid][0]), 2), -pos[t][0]))
                    finger, reach = one_board_fingers[below]
                    one_board_fingers[kid] = (finger, reach if reach in ("inner", "outer") else "up")
        thumbs = [g for g in hand_keys if row_of[key_id(g)] == "thumb"]
        # the thumb's resting key: Space, else Enter, else the widest, else the one nearest the index finger
        thumb_rest = None
        if thumbs:
            if one_board:
                index_keys = [kid for kid, i in from_gap.items() if i == 1 and row_idx[kid] == home_row]
                index_x = pos[index_keys[0]][0] if index_keys else split
            else:
                index_x = x0 + finger_cols[0] if finger_cols else split
            thumb_rest = max(thumbs, key=lambda g: (rest_pref.get(key_id(g), 0), g["w"], -abs(pos[key_id(g)][0] - index_x)))
        for g in hand_keys:
            kid = key_id(g)
            x = col_idx[kid]
            row = row_of[kid]
            if row == "thumb":
                if g is thumb_rest:
                    reach = "rest"
                else:
                    reach = "inner" if abs(pos[kid][0] - split) < abs(pos[key_id(thumb_rest)][0] - split) else "outer"
                out[kid] = {"hand": hand, "finger": "thumb", "row": row, "reach": reach, "home": g is thumb_rest}
                continue
            if one_board:
                finger, reach = one_board_fingers[kid]
            elif x in finger_of:
                finger, reach = finger_of[x], REACH_OF_ROW[row]
            elif x in inner_cols:
                finger, reach = "index", "inner"
            elif x in outer_cols:
                finger, reach = "pinky", "outer"
            else:
                finger, reach = "index", "inner"
            out[kid] = {"hand": hand, "finger": finger, "row": row, "reach": reach,
                        "home": row == "home" and reach == "rest"}
    return out


def proposal(model):
    """ The app's finger proposal for the keyboard: key id -> {hand, finger, row, reach, home}, from the key positions
    and what layer 0 types """
    tap_dances = model.get("tapDance") or []
    tap0, rest_pref = {}, {}
    for g, k in zip(model["keys"], model["layers"][0]["keys"]):
        chars, _, _, _ = describe_key(k, tap_dances)
        tap0[key_id(g)] = (chars or {}).get("tap")
        if tap0[key_id(g)] == " ":
            rest_pref[key_id(g)] = 2
        elif k.get("tapCode") == "KC_ENTER" or k.get("code") == "KC_ENTER":
            rest_pref[key_id(g)] = 1
    return propose_fingers(model, tap0, rest_pref)


def apply_fingers(proposal, fingers_file):
    """ The proposal with the user's corrections (a vial-web-fingers/1 file as a dict, or None) on top: a new dict.
    Keys the keyboard doesn't have are ignored; a resting key that isn't a thumb's gets the rest reach. """
    out = {kid: dict(entry) for kid, entry in proposal.items()}
    if not fingers_file:
        return out
    for kid, change in (fingers_file.get("keys") or {}).items():
        if kid in out and isinstance(change, dict):
            out[kid].update({k: v for k, v in change.items() if k in ("finger", "reach", "hand", "row")})
    if "home" in fingers_file:
        home = set(fingers_file["home"] or [])
        for kid in out:
            out[kid]["home"] = kid in home
            if kid in home and out[kid]["finger"] != "thumb":
                out[kid]["reach"] = "rest"
    return out


def export(model, fingers=None, language="en-us"):
    """ The layout export of the keyboard's model, with the user's finger corrections (apply_fingers) and the keyboard
    language the model was described in. `hash` covers the character map (every key's characters per layer and the
    layer access paths) and nothing else: a lesson set stays valid when a layer is renamed. """
    fingers_of = apply_fingers(proposal(model), fingers)
    tap_dances = model.get("tapDance") or []
    layers = model["layers"]
    keys_out = {}
    layer_reach = {l["index"]: [] for l in layers}
    shift_keys = []
    for i, g in enumerate(model["keys"]):
        kid = key_id(g)
        k0 = layers[0]["keys"][i]
        chars_by_layer, layer_key = {}, None
        for layer in layers:
            k = layer["keys"][i]
            chars, hold, lk, transparent = describe_key(k, tap_dances)
            if transparent and layer["index"] != 0:
                k = k0
                chars, hold, lk, _ = describe_key(k0, tap_dances)
            if layer["index"] == 0:
                layer_key = lk
                if k.get("code") in ("KC_LSHIFT", "KC_RSHIFT") or (hold and hold.lower().endswith("shift")):
                    shift = k.get("code") in ("KC_LSHIFT", "KC_RSHIFT")
                    label = "Shift" if shift else "{} (hold)".format((k.get("legend") or {}).get("main"))
                    shift_keys.append({"key": kid, "hand": fingers_of[kid]["hand"], "label": label})
            if lk and lk["layer"] in layer_reach and layer["index"] == 0:
                label = {"hold": "hold", "oneShot": "tap", "toggle": "toggle with", "switch": "switch with"}[lk["how"]]
                tap = (chars or {}).get("tap")
                name = "Space" if tap == " " else (tap.upper() if tap else (k.get("legend") or {}).get("main") or kid)
                layer_reach[lk["layer"]].append({"key": kid, "how": lk["how"], "label": "{} {}".format(label, name)})
            if chars:
                entry = dict(chars)
                if hold and layer["index"] == 0:
                    entry["hold"] = hold
                chars_by_layer[str(layer["index"])] = entry
            elif hold and layer["index"] == 0 and not chars:
                chars_by_layer.setdefault("0", {})["hold"] = hold
        x, y = centre(g)
        entry = {"id": kid, **fingers_of[kid], "x": x, "y": y, "chars": chars_by_layer}
        if layer_key:
            entry["layerKey"] = layer_key
        keys_out[kid] = entry
    # only layer 0 and the layers a layer-0 key reaches count; characters on the others can't be typed
    reachable = {"0"} | {str(l) for l, rs in layer_reach.items() if rs}
    for e in keys_out.values():
        e["chars"] = {l: c for l, c in e["chars"].items() if l in reachable}
    triples = sorted((kid, layer, which, c) for kid, e in keys_out.items()
                     for layer, chars in e["chars"].items() for which, c in chars.items() if which != "hold")
    reach_pairs = sorted((str(l), r["key"], r["how"]) for l, rs in layer_reach.items() for r in rs)
    digest = hashlib.sha256(json.dumps([triples, reach_pairs]).encode()).hexdigest()
    return {
        "format": FORMAT,
        "keyboard": {"name": model["name"], "uid": model["uid"]},
        "hash": "sha256:{}".format(digest[:16]),
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "language": language,
        "layers": [{"index": l["index"], "name": l["name"], "reachedBy": layer_reach[l["index"]]}
                   for l in layers if str(l["index"]) in reachable],
        "shiftKeys": shift_keys,
        "keys": [keys_out[k] for k in sorted(keys_out, key=lambda kid: (keys_out[kid]["y"], keys_out[kid]["x"]))],
    }
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning_layout.py
```

Expected: `13 passed`.

- [ ] **Step 5: The script becomes a command line over the module**

The script keeps its usage, its `--fingers` and `-o` options and its summary line; the rules now come from `server.learning_layout.export` (it puts `src/main/python` on `sys.path`). Standard library only, as before.

Replace `util/learning/export_layout.py` with:

```python
#!/usr/bin/env python3
"""Turn the app's keyboard model (GET /api/keyboard) into a layout export for the lesson generator.

    python util/learning/export_layout.py keyboard.json [--fingers fingers.json] [-o layout-export.json]

A stand-in for the app's Learning → Fingers → Export (docs/learning/lesson-format.md section 2), and a way to export
a saved GET /api/keyboard reply by hand. The rules live in the server (src/main/python/server/learning_layout.py):
fingers come from the key positions by lesson-rules.md section 2; a fingers.json (section 2.3) overrides them.
Standard library only.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "main", "python"))

from server.learning_layout import export  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("keyboard", help="JSON from GET /api/keyboard")
    parser.add_argument("--fingers", help="fingers.json with corrections")
    parser.add_argument("-o", "--out", help="where to write the export (default: stdout)")
    args = parser.parse_args(argv)
    with open(args.keyboard, encoding="utf-8-sig") as f:
        model = json.load(f)
    fingers = None
    if args.fingers:
        with open(args.fingers, encoding="utf-8-sig") as f:
            fingers = json.load(f)
    result = export(model, fingers)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
        letters = sorted(c["0"]["tap"] for k in result["keys"] for c in [k["chars"]]
                         if "0" in c and c["0"].get("tap", "").isalpha())
        print(f"{args.out}: {len(result['keys'])} keys, {len(result['layers'])} layers with characters, "
              f"letters on layer 0: {''.join(letters)}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

```bash
.venv/Scripts/python.exe util/learning/export_layout.py --help
```

Expected: `usage: export_layout.py [-h] [--fingers FINGERS] [-o OUT] keyboard`

(The repository holds no saved `GET /api/keyboard` reply to run it on; the worked example `docs/learning/examples/corne-sim-layout-export.json` was written by the script in phase 1 and carries the hash `sha256:e435c3da038f9048`, and `test_export_matches_the_worked_example` above proves the server's export of the simulated Corne matches it, hash included.)

- [ ] **Step 6: The whole suite still passes**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1269 passed, 6 skipped`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/server/learning_layout.py \
  src/main/python/test/test_learning_layout.py \
  util/learning/export_layout.py
git commit -m "learning: the finger proposal and the layout export move into the server" -m "server/learning_layout.py holds util/learning/export_layout.py's logic (proposal(), apply_fingers(), export()), with LM and the tri-layer keys as hold layer keys, and a rule for boards in one piece (ANSI, ortho): the hands part between the home row's middle letters, each row counts its fingers from the gap, the number row is typed up from the top row. The split-board path and the hash are unchanged: the example export comes out the same. The util script is a thin CLI over it with the same output." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: `server/learning_check.py`: the lesson set checker, shared by the server and the command line

A *lesson set* is the JSON file the generator writes (`docs/learning/lesson-format.md` section 3): lessons, each with the characters it teaches (`new`, each with the key, layer and way of typing it) and its exercises (`kind`, `lines`). Phase 1's `util/learning/check_lessons.py` checked such a file before the app could; the design (section 2) has the server run the same checks on import, so the checker's logic moves into `server/learning_check.py` and the script imports it: the app and the command line agree. Pure: no file is read but the JSON Schema (`docs/learning/lesson-set.schema.json`), and that only when `jsonschema` is installed, which it isn't in the repository's `.venv` (the structural checks cover what matters; the note says so).

- `Report` collects errors (the set can't be used) and warnings (it can, but the rules say otherwise), each "where: what". `load()` reads a JSON file into it (`utf-8-sig`: a byte order mark from Notepad is fine).
- Errors: the file isn't a lesson set (`check_header`: format, id, title, language, layout name/uid/hash, lessons), ids repeat, an exercise uses a character the course hasn't taught yet (a space is always known), a new key doesn't type that character in the layout export (`check_new`, only when an export is given), bad kinds, lines, leading or trailing space. Warnings (`check_exercise`, `check`): sizes outside `SIZES` (`lesson-rules.md` section 5), groups not doubled, too few new characters in a new-keys exercise, a lesson missing a kind (lesson 1 needs new-keys, keys, words; later ones blind and text too), main exercises out of order, a new character never drilled, a hash that isn't the export's (`export_keys`: "the set was made from another layout").
- `check(data, keys, report, known_before="", first_lesson=0)` checks a whole set; `known_before` and `first_lesson` serve the command line's `--known`, `--first-lesson` and `--course` options for a file holding part of a course. `check_set(data, export=None)` is the server's entry (Task 3): `(errors, warnings)`, the export checking the new keys when given.

The tests use a minimal set that passes with no warnings (`minimal_set()`, two keys a and b, and `EXPORT` with them; `test_learning.py` imports both) and the worked example against its export; one hides `jsonschema` to pin the note.

**Files:**
- Create: `src/main/python/server/learning_check.py`
- Replace: `util/learning/check_lessons.py`
- Test: `src/main/python/test/test_learning_check.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_learning_check.py`:

```python
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
```

- [ ] **Step 2: Run it: it fails**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning_check.py
```

Expected: `ImportError: cannot import name 'learning_check' from 'server'`

- [ ] **Step 3: The module**

Create `src/main/python/server/learning_check.py`:

```python
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
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning_check.py
```

Expected: `10 passed`.

- [ ] **Step 5: The script becomes a command line over the module**

Same usage, options and output as before (`--layout`, `--known`, `--first-lesson`, `--course`; the schema note, then `error:` and `warning:` lines, then the summary; exit 1 on errors).

Replace `util/learning/check_lessons.py` with:

```python
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
```

```bash
.venv/Scripts/python.exe util/learning/check_lessons.py docs/learning/examples/corne-sim-en.json --layout docs/learning/examples/corne-sim-layout-export.json
```

Expected: `schema: jsonschema not installed, structural checks only` and `docs/learning/examples/corne-sim-en.json: 2 lessons, 0 errors, 0 warnings`.

- [ ] **Step 6: The whole suite still passes**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1279 passed, 6 skipped`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/server/learning_check.py \
  src/main/python/test/test_learning_check.py \
  util/learning/check_lessons.py
git commit -m "learning: the lesson checker moves into the server" -m "server/learning_check.py holds check_lessons.py's checks plus check_set() for the server; the util script is a thin CLI over it with the same output, so the app and the command line agree." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: `server/learning.py`: the store of the Learning feature's files

The design keeps everything the feature saves in the app's config folder, per keyboard uid and written like `names.json`: `<config dir>/learning/<uid>/` holds `fingers.json` (the user's corrections, `vial-web-fingers/1`), `layout-export.json` (the last export), `sets/<id>.json` (the lesson sets, as imported), `progress/<id>.json` (`vial-web-progress/1`: the attempts at each exercise, `lesson-format.md` section 4) and `settings.json`. `LearningStore(root)` does the files; the routes (Task 4) call it. The root is created on first write, so the store exists before any folder does.

- **Writing as `NamesStore`**: `_save()` writes a new file (`.tmp`, fsync) and puts it in place of the old one, so a failure leaves the old file; `_load(path, for_write)` reads for display tolerantly (anything unreadable is "nothing saved") and reads for write strictly (an unparsable file is moved aside to `<file>.corrupt` instead of being overwritten silently; another I/O error propagates, so a failed read never wipes a file). Files are read as `utf-8-sig`. A lock serialises the store.
- **Ids stay inside the store**: a keyboard uid or a set id must match `ID` (`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`); a bad uid is a `ValueError`, a bad set id `NotFound` (404 in Task 4), so `../x` never leaves the folder.
- **Fingers**: `set_fingers()` validates `{"keys": {key id: {"finger", "reach"}}, "home": [key ids]}` (`FINGERS`, `REACHES`, `KEY_ID`; duplicates in `home` dropped) and saves it with the format; `fingers()` is `None` unless a saved file has the format; `clear_fingers()` is back to the proposal.
- **The export**: `export(uid, model_dict, language)` is `learning_layout.export` with the saved corrections, written to `layout-export.json` and returned.
- **Lesson sets**: `import_set(uid, data, export=None)` runs `learning_check.check_set` and raises `LessonSetInvalid(errors, warnings)` (422 in Task 4) on errors, else saves the set as `sets/<its id>.json`, replacing one of that id, and returns its listing entry with the warnings. `sets()` lists every `.json` in the folder by file name: `{id, title, language, lessons, layoutHash, error}`, where **a file dropped in by hand that isn't a lesson set is listed with the first thing wrong with it** (not JSON, the checker's first error, a file name that isn't an id, or an inner `id` that isn't the file name) and the file name as its title when the title can't be read. `set()` is the file whole (`NotFound`, or `ValueError` when it isn't a lesson set); `delete_set()` removes it, and **its progress stays** (a set imported again under the id finds it).
- **Progress**: `record(uid, set_id, exercise_id, attempt)` takes `{at, chars, errors, seconds}` from the page and computes `accuracy` (100 × (chars − errors) / chars, one decimal) and `wpm` (chars / 5 / minutes, one decimal) here; it **rejects `chars < 1`**, `errors < 0`, `seconds <= 0` and wrong types (`ValueError`, 422; `errors` may exceed `chars`, every wrong press counts, and accuracy floors at 0), refuses an exercise the set doesn't have (`NotFound`), keeps the last `ATTEMPTS_KEPT` = 50 attempts, and writes the set's `layout.hash` into the progress file as `layoutHash`. `progress()` reads the file through `_clean_progress()`, which **recomputes `done` and `best`** (the highest accuracy, then the highest WPM) from the attempts that are attempts, whatever a hand-edited file holds; a set never recorded has an empty progress.
- **Settings**: `settings()` is the defaults (`passAccuracy` 95, `targetWpm` 30, `pictureInWords` true) with whatever the saved file holds that is valid; `set_settings()` takes all three or raises (`passAccuracy` 50–100, `targetWpm` 1–300, whole numbers and not booleans; `pictureInWords` a boolean).

The tests here go through the store alone: the files under the uid, atomic writes (a failing `os.replace` leaves the old file and no temp file), corrupt files moved aside, the BOM, the ids, each area's round trip and validation, the listing of files dropped in by hand, the attempts' numbers and the last fifty, a hand-edited progress file, the settings' ranges. Task 4 adds the route tests to the same file (a diff), with the imports they need.

**Files:**
- Create: `src/main/python/server/learning.py`
- Test: `src/main/python/test/test_learning.py` (new; Task 4 adds the route tests)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_learning.py`:

```python
""" The Learning feature's store (server.learning) """
import json
import os

import pytest

from server import learning_layout
from server.learning import LearningStore, LessonSetInvalid, NotFound
from simulator.corne import make_corne
from test.test_learning_check import minimal_set, EXPORT as MINI_EXPORT
from test.test_learning_layout import model_of, EXAMPLES

UID = "5EEDC0DE00420042"
""" the simulated Corne's uid """


def example(name):
    with open(os.path.join(EXAMPLES, name), encoding="utf-8") as inf:
        return json.load(inf)


@pytest.fixture
def store(tmp_path):
    return LearningStore(str(tmp_path / "learning"))


@pytest.fixture
def root(tmp_path):
    return tmp_path / "learning"


def attempt(chars=100, errors=2, seconds=60, at="2026-10-22T07:40:12Z"):
    return {"at": at, "chars": chars, "errors": errors, "seconds": seconds}


# ---------- the store: files ----------

def test_files_live_under_the_keyboard_uid(store, root):
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": False})
    store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": ["r1c1"]})
    store.import_set(UID, minimal_set())
    store.record(UID, "mini", "01-n1", attempt())
    assert sorted(os.listdir(root / UID)) == ["fingers.json", "progress", "sets", "settings.json"]
    assert os.listdir(root / UID / "sets") == ["mini.json"] and os.listdir(root / UID / "progress") == ["mini.json"]
    assert store.settings("OTHER") == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    assert store.sets("OTHER") == [] and store.fingers("OTHER") is None


def test_writes_are_atomic_and_leave_no_temp_file(store, root, monkeypatch):
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": False})
    path = root / UID / "settings.json"
    before = path.read_bytes()

    def broken(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "replace", broken)
    with pytest.raises(OSError):
        store.set_settings(UID, {"passAccuracy": 99, "targetWpm": 25, "pictureInWords": False})
    assert path.read_bytes() == before
    assert sorted(os.listdir(root / UID)) == ["settings.json"]


def test_a_corrupt_file_is_moved_aside_on_write_and_ignored_on_read(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_text("{not json", encoding="utf-8")
    (folder / "fingers.json").write_text("[1, 2", encoding="utf-8")
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    assert store.fingers(UID) is None
    assert not (folder / "settings.json.corrupt").exists()
    store.set_settings(UID, {"passAccuracy": 90, "targetWpm": 25, "pictureInWords": True})
    assert (folder / "settings.json.corrupt").read_text(encoding="utf-8") == "{not json"
    assert store.settings(UID)["passAccuracy"] == 90
    store.set_fingers(UID, {"keys": {}, "home": []})
    assert (folder / "fingers.json.corrupt").exists()


def test_a_file_with_a_byte_order_mark_is_read(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_bytes(b"\xef\xbb\xbf" + json.dumps({"targetWpm": 40}).encode("utf-8"))
    assert store.settings(UID)["targetWpm"] == 40


def test_bad_uids_and_ids_stay_inside_the_store(store):
    with pytest.raises(ValueError):
        store.settings("../x")
    with pytest.raises(NotFound):
        store.set(UID, "../../etc")
    with pytest.raises(NotFound):
        store.progress(UID, "a/b")
    with pytest.raises(NotFound):
        store.delete_set(UID, "")


# ---------- the store: fingers ----------

def test_fingers_round_trip_and_reset(store):
    assert store.fingers(UID) is None
    saved = store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": ["r1c1", "r1c1"]})
    assert saved == {"format": "vial-web-fingers/1", "keys": {"r0c5": {"finger": "middle", "reach": "up"}},
                     "home": ["r1c1"]}
    assert store.fingers(UID) == saved
    store.clear_fingers(UID)
    assert store.fingers(UID) is None
    store.clear_fingers(UID)  # nothing to clear: fine


@pytest.mark.parametrize("data", [
    "x", {"keys": {}}, {"keys": [], "home": []}, {"keys": {"r0c5": {"finger": "thumb"}}, "home": []},
    {"keys": {"r0c5": {"finger": "hand", "reach": "up"}}, "home": []},
    {"keys": {"r0c5": {"finger": "index", "reach": "far"}}, "home": []},
    {"keys": {"../x": {"finger": "index", "reach": "up"}}, "home": []}, {"keys": {}, "home": ["r1"]},
])
def test_fingers_are_validated(store, data):
    with pytest.raises(ValueError):
        store.set_fingers(UID, data)
    assert store.fingers(UID) is None


def test_a_saved_file_of_another_format_counts_as_nothing_saved(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "fingers.json").write_text(json.dumps({"format": "other/9", "keys": {}}), encoding="utf-8")
    assert store.fingers(UID) is None


# ---------- the store: the export ----------

def test_export_is_saved_with_the_corrections(store, root):
    built = model_of(make_corne)
    store.set_fingers(UID, {"keys": {"r0c5": {"finger": "middle", "reach": "up"}}, "home": []})
    out = store.export(UID, built, "en-us")
    assert out["hash"] == example("corne-sim-layout-export.json")["hash"]
    key = next(k for k in out["keys"] if k["id"] == "r0c5")
    assert key["finger"] == "middle" and not any(k["home"] for k in out["keys"])
    saved = json.loads((root / UID / "layout-export.json").read_text(encoding="utf-8"))
    assert saved == out


# ---------- the store: lesson sets ----------

def test_import_list_get_and_delete(store, root):
    data = example("corne-sim-en.json")
    export = learning_layout.export(model_of(make_corne))
    entry = store.import_set(UID, data, export)
    assert entry == {"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
                     "layoutHash": export["hash"], "error": None, "warnings": []}
    assert store.sets(UID) == [{k: v for k, v in entry.items() if k != "warnings"}]
    assert store.set(UID, "corne-sim-en") == data
    assert json.loads((root / UID / "sets" / "corne-sim-en.json").read_text(encoding="utf-8")) == data
    store.record(UID, "corne-sim-en", data["lessons"][0]["exercises"][0]["id"], attempt())
    store.delete_set(UID, "corne-sim-en")
    assert store.sets(UID) == []
    with pytest.raises(NotFound):
        store.set(UID, "corne-sim-en")
    with pytest.raises(NotFound):
        store.delete_set(UID, "corne-sim-en")
    # the progress stays, for the set imported again
    assert store.progress(UID, "corne-sim-en")["exercises"] != {}


def test_import_refuses_a_bad_set_with_its_errors_and_warnings(store):
    data = minimal_set()
    data["lessons"][0]["exercises"][1]["lines"].append("ab cab")
    data["lessons"][0]["exercises"][2]["lines"] = ["abba baab"]
    with pytest.raises(LessonSetInvalid) as info:
        store.import_set(UID, data)
    assert info.value.errors == ["exercise 01-k1: uses characters not taught yet: 'c'"]
    assert info.value.warnings == ["exercise 01-w1: 9 characters; words should have 450-600"]
    assert "1 error" in str(info.value)
    assert store.sets(UID) == []


def test_import_keeps_warnings_and_checks_the_keys_against_the_export(store):
    data = minimal_set()
    data["lessons"][0]["exercises"][2]["lines"] = ["abba baab"]
    assert store.import_set(UID, data, MINI_EXPORT)["warnings"] == [
        "exercise 01-w1: 9 characters; words should have 450-600"]
    data["lessons"][0]["new"][0]["key"] = "r1c2"
    with pytest.raises(LessonSetInvalid) as info:
        store.import_set(UID, data, MINI_EXPORT)
    assert info.value.errors == ["lesson 01/new[0]: key r1c2 layer 0 tap types 'b', not 'a'"]


def test_files_dropped_in_by_hand_are_listed_with_their_error(store, root):
    folder = root / UID / "sets"
    folder.mkdir(parents=True)
    (folder / "broken.json").write_text("{", encoding="utf-8")
    bad = minimal_set()
    bad["id"], bad["title"] = "wrong", "Wrong id"
    (folder / "renamed.json").write_text(json.dumps(bad), encoding="utf-8")
    short = minimal_set()
    short["id"], short["lessons"] = "short", []
    (folder / "short.json").write_text(json.dumps(short), encoding="utf-8")
    (folder / "bad name.json").write_text(json.dumps(minimal_set()), encoding="utf-8")
    (folder / "notes.txt").write_text("not a set", encoding="utf-8")
    listed = {e["id"]: e for e in store.sets(UID)}
    assert set(listed) == {"broken", "renamed", "short", "bad name"}
    assert listed["broken"]["title"] == "broken" and listed["broken"]["error"].startswith("not a JSON file")
    assert listed["renamed"] == {"id": "renamed", "title": "Wrong id", "language": "en", "lessons": 1,
                                 "layoutHash": "sha256:0123456789abcdef", "error": "id: 'wrong' isn't the file name"}
    assert listed["short"]["error"] == "lessons: missing or empty" and listed["short"]["lessons"] == 0
    assert listed["bad name"]["error"] == "file name: letters, digits, - and _ only"
    with pytest.raises(ValueError):
        store.set(UID, "broken")
    with pytest.raises(ValueError):
        store.set(UID, "renamed")


# ---------- the store: progress ----------

def test_progress_is_empty_until_an_attempt_is_recorded(store):
    store.import_set(UID, minimal_set())
    assert store.progress(UID, "mini") == {"format": "vial-web-progress/1", "lessonSet": "mini", "layoutHash": None,
                                           "exercises": {}}
    assert store.progress(UID, "never") == {"format": "vial-web-progress/1", "lessonSet": "never",
                                            "layoutHash": None, "exercises": {}}


def test_record_computes_accuracy_wpm_and_best(store):
    store.import_set(UID, minimal_set())
    first = store.record(UID, "mini", "01-n1", attempt(chars=228, errors=3, seconds=88))
    assert first == {"done": True,
                     "best": {"at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7, "wpm": 31.1,
                              "seconds": 88},
                     "attempts": [{"at": "2026-10-22T07:40:12Z", "chars": 228, "errors": 3, "accuracy": 98.7,
                                   "wpm": 31.1, "seconds": 88}]}
    # the same accuracy and a higher speed: the new best; a lower accuracy at any speed: not
    second = store.record(UID, "mini", "01-n1", attempt(chars=228, errors=3, seconds=60, at="t2"))
    assert second["best"]["at"] == "t2" and second["best"]["wpm"] == 45.6
    third = store.record(UID, "mini", "01-n1", attempt(chars=100, errors=10, seconds=10, at="t3"))
    assert third["best"]["at"] == "t2" and len(third["attempts"]) == 3 and third["attempts"][-1]["wpm"] == 120.0
    progress = store.progress(UID, "mini")
    assert progress["layoutHash"] == "sha256:0123456789abcdef"
    assert progress["exercises"]["01-n1"] == third
    assert store.record(UID, "mini", "01-w1", attempt(chars=10, errors=0, seconds=7.5))["best"]["seconds"] == 7.5
    assert store.record(UID, "mini", "01-w1", attempt(chars=10, errors=0, seconds=4.0))["best"]["seconds"] == 4


def test_the_last_fifty_attempts_are_kept(store):
    store.import_set(UID, minimal_set())
    for i in range(55):
        entry = store.record(UID, "mini", "01-k1", attempt(chars=100, errors=i, seconds=60, at="t{}".format(i)))
    assert len(entry["attempts"]) == 50
    assert entry["attempts"][0]["at"] == "t5" and entry["attempts"][-1]["at"] == "t54"
    assert entry["best"]["at"] == "t5"  # the perfect attempts are gone


def test_record_refuses_unknown_exercises_and_bad_numbers(store):
    store.import_set(UID, minimal_set())
    with pytest.raises(NotFound):
        store.record(UID, "mini", "99-x", attempt())
    with pytest.raises(NotFound):
        store.record(UID, "other", "01-n1", attempt())
    for bad in (attempt(chars=0), attempt(errors=-1), attempt(errors=101), attempt(seconds=0),
                attempt(chars="100"), {"chars": 1, "errors": 0, "seconds": 1}):
        with pytest.raises(ValueError):
            store.record(UID, "mini", "01-n1", bad)
    assert store.progress(UID, "mini")["exercises"] == {}


def test_a_hand_edited_progress_file_is_cleaned_up(store, root):
    store.import_set(UID, minimal_set())
    folder = root / UID / "progress"
    folder.mkdir(parents=True)
    good = {"at": "t", "chars": 100, "errors": 0, "accuracy": 100.0, "wpm": 20.0, "seconds": 60}
    (folder / "mini.json").write_text(json.dumps({
        "format": "vial-web-progress/1", "lessonSet": "mini", "layoutHash": 5,
        "exercises": {"01-n1": {"done": False, "best": None, "attempts": [good, "junk", {"at": "x"}]},
                      "01-k1": "junk", "01-w1": {"attempts": "junk"}}}), encoding="utf-8")
    progress = store.progress(UID, "mini")
    assert progress["layoutHash"] is None
    assert progress["exercises"] == {"01-n1": {"done": True, "best": good, "attempts": [good]},
                                     "01-w1": {"done": False, "best": None, "attempts": []}}
    assert store.record(UID, "mini", "01-n1", attempt())["attempts"][0] == good


# ---------- the store: settings ----------

def test_settings_defaults_and_validation(store):
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
    saved = store.set_settings(UID, {"passAccuracy": 50, "targetWpm": 300, "pictureInWords": False})
    assert saved == {"passAccuracy": 50, "targetWpm": 300, "pictureInWords": False} == store.settings(UID)
    for bad in ({"passAccuracy": 49, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 101, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 0, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 301, "pictureInWords": True},
                {"passAccuracy": 95.5, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": True, "targetWpm": 30, "pictureInWords": True},
                {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": "yes"},
                {"passAccuracy": 95, "targetWpm": 30}, "x"):
        with pytest.raises(ValueError):
            store.set_settings(UID, bad)
    assert store.settings(UID) == saved


def test_settings_file_with_wrong_values_falls_back_to_the_defaults_for_them(store, root):
    folder = root / UID
    folder.mkdir(parents=True)
    (folder / "settings.json").write_text(json.dumps({"passAccuracy": 200, "targetWpm": 40, "extra": 1}),
                                          encoding="utf-8")
    assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 40, "pictureInWords": True}
```

- [ ] **Step 2: Run it: it fails**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning.py
```

Expected: `ModuleNotFoundError: No module named 'server.learning'`

- [ ] **Step 3: The store**

Create `src/main/python/server/learning.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" The Learning feature's files (docs/learning/lesson-format.md): the user's finger corrections, the layout export,
the lesson sets, progress and settings, per keyboard uid under <config dir>/learning/<uid>/. Every write is a new
file put in place of the old one (as NamesStore), every read tolerant: a missing file is empty, an unparsable one is
moved aside to <file>.corrupt when it is about to be written. """
import json
import os
import re
import threading

from server import learning_check, learning_layout

FINGERS_FORMAT = "vial-web-fingers/1"
PROGRESS_FORMAT = "vial-web-progress/1"
ATTEMPTS_KEPT = 50
""" the last attempts of an exercise that are kept """
DEFAULT_SETTINGS = {"passAccuracy": 95, "targetWpm": 30, "pictureInWords": True}
FINGERS = ("index", "middle", "ring", "pinky", "thumb")
REACHES = ("rest", "up", "down", "inner", "outer")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
""" a lesson set's id (its file name) and a keyboard uid: a file or folder name that stays inside the store """
KEY_ID = re.compile(r"^r[0-9]+c[0-9]+$")


class NotFound(LookupError):
    """ No such lesson set, or no such exercise in it (404) """


class LessonSetInvalid(ValueError):
    """ A lesson set the checker refuses (422): its errors and warnings """

    def __init__(self, errors, warnings):
        super().__init__("the lesson set has {} error{}: {}".format(len(errors), "" if len(errors) == 1 else "s",
                                                                    errors[0]))
        self.errors = errors
        self.warnings = warnings


def _read_json(path):
    """ The JSON in path; FileNotFoundError, ValueError (not JSON) or another OSError """
    # utf-8-sig: a file saved by Windows Notepad may start with a byte order mark
    with open(path, "r", encoding="utf-8-sig") as inf:
        return json.load(inf)


def _attempt_key(attempt):
    """ The best attempt has the highest accuracy, then the highest WPM """
    return attempt["accuracy"], attempt["wpm"]


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _clean_attempt(attempt):
    """ An attempt as the file should hold it, or None for one that isn't """
    if not isinstance(attempt, dict) or not isinstance(attempt.get("at"), str):
        return None
    if not all(_number(attempt.get(f)) for f in ("chars", "errors", "accuracy", "wpm", "seconds")):
        return None
    return {f: attempt[f] for f in ("at", "chars", "errors", "accuracy", "wpm", "seconds")}


def _exercise_entry(attempts):
    """ An exercise's progress from its attempts: done once there is one, best by _attempt_key """
    return {"done": bool(attempts), "best": max(attempts, key=_attempt_key) if attempts else None,
            "attempts": attempts}


class LearningStore:
    """ root: the learning folder; a folder per keyboard uid inside it """

    def __init__(self, root):
        self.root = root
        self.lock = threading.Lock()

    # ---------- files ----------

    def _dir(self, uid):
        if not isinstance(uid, str) or not ID.match(uid):
            raise ValueError("not a keyboard uid: {!r}".format(uid))
        return os.path.join(self.root, uid)

    def _set_path(self, uid, set_id):
        """ The lesson set's file; NotFound for an id that can't be one (so it never leaves the sets folder) """
        if not isinstance(set_id, str) or not ID.match(set_id):
            raise NotFound("no lesson set {!r}".format(set_id))
        return os.path.join(self._dir(uid), "sets", set_id + ".json")

    def _progress_path(self, uid, set_id):
        if not isinstance(set_id, str) or not ID.match(set_id):
            raise NotFound("no lesson set {!r}".format(set_id))
        return os.path.join(self._dir(uid), "progress", set_id + ".json")

    def _load(self, path, for_write=False):
        """ The JSON in path, or None when there is none. As NamesStore._load: reading for display treats any
        unreadable file as none; reading for write only treats a missing file as none, moves an unparsable one aside
        to <path>.corrupt and lets other I/O errors propagate, so a failed read never leads to wiping the file. """
        try:
            return _read_json(path)
        except FileNotFoundError:
            return None
        except ValueError:
            if for_write:
                os.replace(path, path + ".corrupt")
            return None
        except OSError:
            if for_write:
                raise
            return None

    def _save(self, path, data):
        """ Write the file whole: a new file put in place of the old one, so that a failure leaves the old one """
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as outf:
                json.dump(data, outf, indent=2, ensure_ascii=False)
                outf.flush()
                os.fsync(outf.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def _remove(self, path):
        """ Remove the file; False when there was none """
        try:
            os.remove(path)
        except FileNotFoundError:
            return False
        return True

    # ---------- fingers ----------

    def fingers(self, uid):
        """ The user's finger corrections (a vial-web-fingers/1 file as a dict), or None when none are saved """
        with self.lock:
            data = self._load(os.path.join(self._dir(uid), "fingers.json"))
        return data if isinstance(data, dict) and data.get("format") == FINGERS_FORMAT else None

    def set_fingers(self, uid, data):
        """ Save corrections: {"keys": {key id: {"finger", "reach"}}, "home": [key ids]}; ValueError when they aren't
        that. Returns what was saved. """
        if not isinstance(data, dict):
            raise ValueError("fingers must be an object")
        keys, home = data.get("keys"), data.get("home")
        if not isinstance(keys, dict) or not isinstance(home, list):
            raise ValueError("fingers need \"keys\" (an object) and \"home\" (a list of key ids)")
        clean = {}
        for kid, change in keys.items():
            if not isinstance(kid, str) or not KEY_ID.match(kid):
                raise ValueError("not a key id: {!r}".format(kid))
            if not isinstance(change, dict) or change.get("finger") not in FINGERS or change.get("reach") not in REACHES:
                raise ValueError("key {}: a finger ({}) and a reach ({}) are needed".format(
                    kid, ", ".join(FINGERS), ", ".join(REACHES)))
            clean[kid] = {"finger": change["finger"], "reach": change["reach"]}
        for kid in home:
            if not isinstance(kid, str) or not KEY_ID.match(kid):
                raise ValueError("not a key id in home: {!r}".format(kid))
        saved = {"format": FINGERS_FORMAT, "keys": clean, "home": list(dict.fromkeys(home))}
        with self.lock:
            path = os.path.join(self._dir(uid), "fingers.json")
            self._load(path, for_write=True)  # an unparsable file is moved aside, not silently overwritten
            self._save(path, saved)
        return saved

    def clear_fingers(self, uid):
        """ Back to the app's proposal """
        with self.lock:
            self._remove(os.path.join(self._dir(uid), "fingers.json"))

    # ---------- the export ----------

    def export(self, uid, model_dict, language):
        """ The layout export of the keyboard (learning_layout.export) with the saved finger corrections, written to
        layout-export.json and returned """
        out = learning_layout.export(model_dict, self.fingers(uid), language)
        with self.lock:
            path = os.path.join(self._dir(uid), "layout-export.json")
            self._load(path, for_write=True)
            self._save(path, out)
        return out

    # ---------- lesson sets ----------

    def _summary(self, set_id, data, error=None):
        """ A lesson set's listing entry: what can be read from the file, the file name when the title can't """
        is_dict = isinstance(data, dict)
        title = data.get("title") if is_dict and isinstance(data.get("title"), str) and data["title"] else set_id
        language = data.get("language") if is_dict and isinstance(data.get("language"), str) else ""
        lessons = len(data["lessons"]) if is_dict and isinstance(data.get("lessons"), list) else 0
        layout = data.get("layout") if is_dict else None
        layout_hash = layout.get("hash") if isinstance(layout, dict) and isinstance(layout.get("hash"), str) else None
        return {"id": set_id, "title": title, "language": language, "lessons": lessons, "layoutHash": layout_hash,
                "error": error}

    def _read_set(self, set_id, path):
        """ (data, error) of a lesson set file: the first thing wrong with it, or None """
        try:
            data = _read_json(path)
        except FileNotFoundError:
            raise NotFound("no lesson set {!r}".format(set_id))
        except ValueError as e:
            return None, "not a JSON file: {}".format(e)
        errors, _ = learning_check.check_set(data)
        if errors:
            return data, errors[0]
        if data["id"] != set_id:
            return data, "id: {!r} isn't the file name".format(data["id"])
        return data, None

    def sets(self, uid):
        """ The keyboard's lesson sets, by file name: [{id, title, language, lessons, layoutHash, error}]; a file that
        isn't a lesson set is listed with what is wrong with it (error) """
        folder = os.path.join(self._dir(uid), "sets")
        with self.lock:
            try:
                names = sorted(n for n in os.listdir(folder) if n.endswith(".json"))
            except FileNotFoundError:
                return []
            out = []
            for name in names:
                set_id = name[:-len(".json")]
                if not ID.match(set_id):
                    out.append(self._summary(set_id, None, "file name: letters, digits, - and _ only"))
                    continue
                try:
                    data, error = self._read_set(set_id, os.path.join(folder, name))
                except (NotFound, OSError) as e:
                    data, error = None, "can't be read: {}".format(e)
                out.append(self._summary(set_id, data, error))
        return out

    def set(self, uid, set_id):
        """ The lesson set, whole; NotFound when there is none, ValueError when the file isn't a lesson set """
        with self.lock:
            data, error = self._read_set(set_id, self._set_path(uid, set_id))
        if error:
            raise ValueError("lesson set {}: {}".format(set_id, error))
        return data

    def import_set(self, uid, data, export=None):
        """ Check a lesson set (the parsed file) and save it as sets/<its id>.json; LessonSetInvalid when the checker
        finds errors. The export, when given, checks its new keys. Returns its listing entry with the warnings. """
        errors, warnings = learning_check.check_set(data, export)
        if errors:
            raise LessonSetInvalid(errors, warnings)
        set_id = data["id"]  # check_set saw to it being a plain id
        with self.lock:
            path = self._set_path(uid, set_id)
            self._load(path, for_write=True)
            self._save(path, data)
        return {**self._summary(set_id, data), "warnings": warnings}

    def delete_set(self, uid, set_id):
        """ Remove the lesson set; its progress file stays (a set imported again under the id finds it). NotFound
        when there is none. """
        with self.lock:
            if not self._remove(self._set_path(uid, set_id)):
                raise NotFound("no lesson set {!r}".format(set_id))

    # ---------- progress ----------

    def _clean_progress(self, set_id, data):
        """ The progress file's content as vial-web-progress/1, whatever it holds: each exercise's attempts that are
        attempts, its best and done computed from them """
        exercises = {}
        if isinstance(data, dict) and isinstance(data.get("exercises"), dict):
            for eid, entry in data["exercises"].items():
                if not isinstance(eid, str) or not isinstance(entry, dict):
                    continue
                attempts = [a for a in (entry.get("attempts") or []) if _clean_attempt(a)] \
                    if isinstance(entry.get("attempts"), list) else []
                exercises[eid] = _exercise_entry([_clean_attempt(a) for a in attempts][-ATTEMPTS_KEPT:])
        layout_hash = data.get("layoutHash") if isinstance(data, dict) else None
        return {"format": PROGRESS_FORMAT, "lessonSet": set_id,
                "layoutHash": layout_hash if isinstance(layout_hash, str) else None, "exercises": exercises}

    def progress(self, uid, set_id):
        """ The progress on a lesson set (lesson-format.md section 4); empty when nothing was recorded yet """
        with self.lock:
            data = self._load(self._progress_path(uid, set_id))
        return self._clean_progress(set_id, data)

    def record(self, uid, set_id, exercise_id, attempt):
        """ An exercise typed to the end: attempt = {at, chars, errors, seconds}; accuracy and WPM are computed here,
        the exercise is done, its best attempt the one with the highest accuracy then WPM, and the last ATTEMPTS_KEPT
        attempts are kept. NotFound when the set has no such exercise; ValueError for numbers that can't be. Returns
        the exercise's progress entry. """
        chars, errors, seconds = attempt.get("chars"), attempt.get("errors"), attempt.get("seconds")
        if not all(_number(v) for v in (chars, errors, seconds)) or not isinstance(attempt.get("at"), str):
            raise ValueError("an attempt has at (a string), chars, errors and seconds (numbers)")
        if chars < 1 or errors < 0 or errors > chars or seconds <= 0:
            raise ValueError("an attempt has at least one character, no more errors than characters and some time")
        if isinstance(seconds, float) and seconds.is_integer():
            seconds = int(seconds)
        entry = {"at": attempt["at"], "chars": int(chars), "errors": int(errors),
                 "accuracy": round(100 * (chars - errors) / chars, 1), "wpm": round(chars / 5 / (seconds / 60), 1),
                 "seconds": seconds}
        with self.lock:
            lesson_set, error = self._read_set(set_id, self._set_path(uid, set_id))
            if error:
                raise ValueError("lesson set {}: {}".format(set_id, error))
            exercises = {ex["id"] for lesson in lesson_set["lessons"] for ex in lesson["exercises"]}
            if exercise_id not in exercises:
                raise NotFound("lesson set {} has no exercise {!r}".format(set_id, exercise_id))
            path = self._progress_path(uid, set_id)
            progress = self._clean_progress(set_id, self._load(path, for_write=True))
            attempts = progress["exercises"].get(exercise_id, {}).get("attempts", []) + [entry]
            progress["exercises"][exercise_id] = _exercise_entry(attempts[-ATTEMPTS_KEPT:])
            progress["layoutHash"] = lesson_set["layout"]["hash"]
            self._save(path, progress)
        return progress["exercises"][exercise_id]

    # ---------- settings ----------

    @staticmethod
    def _check_settings(data, partial):
        """ The settings in data that are valid (partial: a saved file, where anything else is left out) or all of
        them (not partial: a change, where anything wrong is a ValueError) """
        out = {}
        for name, check, what in (("passAccuracy", lambda v: isinstance(v, int) and not isinstance(v, bool) and 50 <= v <= 100,
                                   "a whole number from 50 to 100"),
                                  ("targetWpm", lambda v: isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 300,
                                   "a whole number from 1 to 300"),
                                  ("pictureInWords", lambda v: isinstance(v, bool), "true or false")):
            value = data.get(name) if isinstance(data, dict) else None
            if check(value):
                out[name] = value
            elif not partial:
                raise ValueError("{} must be {}".format(name, what))
        return out

    def settings(self, uid):
        """ {passAccuracy, targetWpm, pictureInWords}: what is saved, the defaults for the rest """
        with self.lock:
            data = self._load(os.path.join(self._dir(uid), "settings.json"))
        return {**DEFAULT_SETTINGS, **self._check_settings(data, partial=True)}

    def set_settings(self, uid, data):
        """ Save the settings (all three); ValueError when one is out of its range. Returns them. """
        clean = self._check_settings(data, partial=False)
        with self.lock:
            path = os.path.join(self._dir(uid), "settings.json")
            self._load(path, for_write=True)
            self._save(path, clean)
        return dict(clean)
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning.py
```

Expected: `27 passed`.

- [ ] **Step 5: The whole suite still passes**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1306 passed, 6 skipped`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/learning.py \
  src/main/python/test/test_learning.py
git commit -m "learning: the store of the Learning feature's files" -m "server/learning.py keeps the Learning feature's files under <config dir>/learning/<uid>/ (fingers, the layout export, lesson sets, progress, settings), written and read as names.json is: a new file put in place of the old one, an unparsable one moved aside to .corrupt before a write. record() computes accuracy and WPM and keeps the last 50 attempts; progress() recomputes best and done from them; sets() lists a file that isn't a lesson set with what is wrong with it." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: The `/api/learning` routes, their schemas, and the store wired into `vial_web.py`

The routes of the design's section 2, on the store of Task 3 and the modules of Tasks 1 and 2. `create_app(..., learning=None)` takes the store; **without one the routes answer 501** (`learning_store()`), as `POST /api/shutdown` does without `on_stop`, so the OpenAPI dump (`server.dump_openapi`, which builds the app with no store) still describes them. `vial_web.serve()` passes `LearningStore(learning_dir(args.fake))`, `learning_dir()` being `<config dir>/learning`, so `--data-dir` holds it along with `names.json` (the test in `test_vial_web.py` lists it with the other files of the data dir). Every route needs a keyboard open (503 otherwise): `keyboard_dict()` reads the uid and the model as a dict under the device lock through the existing `read()`, in the keyboard language `lang` where the characters matter (the export, the listing, the import).

| Route | Does |
|---|---|
| `GET /api/learning/fingers` | `schemas.Fingers`: the proposal with the saved corrections on top (`fingers_of`), the `home` list, and `proposal: true` when nothing is saved |
| `PUT /api/learning/fingers` | saves `FingersIn` (`keys` by id with `finger` and `reach`, `home`; `extra="forbid"` as every `Request`), answers as GET; a bad finger is 422 (`Finger`/`Reach` literals) |
| `DELETE /api/learning/fingers` | forgets the corrections, answers as GET |
| `GET /api/learning/export` | `LayoutExport` for `lang`, saved as `layout-export.json` |
| `GET /api/learning/sets` | `list[LessonSetSummary]`; `outOfDate` is each set's `layoutHash` against the keyboard's hash now, computed once per listing with the saved fingers (`summaries`) |
| `POST /api/learning/sets` | **the body is the raw JSON document** (not wrapped), read through `read_limited` with a 4 MiB guard (a 19-lesson course is about 130 KiB), decoded as `utf-8-sig`; `lang` is checked before the body is read; the set is checked against the keyboard's export in `lang` and saved under its own id; **answers 201** with `LessonSetImported` (the summary plus the checker's `warnings`); the check and the write run in a thread (`asyncio.to_thread`) since the route is async for the body |
| `GET /api/learning/sets/{set}` | the file whole (`LessonSet`, `extra="allow"`: fields the format doesn't require are kept); 404, or 422 when the file isn't a lesson set |
| `DELETE /api/learning/sets/{set}` | 204; 404 when there is none |
| `GET /api/learning/progress/{set}` | `Progress`, empty when nothing was recorded (also for a set that doesn't exist) |
| `PUT /api/learning/progress/{set}/{exercise}` | `AttemptIn` (`at`, `chars`, `errors`, `seconds`; `accuracy` in the body is 422) -> `ExerciseProgress`; 404 for an exercise the set doesn't have |
| `GET`/`PUT /api/learning/settings` | `LearningSettings`; `LearningSettingsIn` uses `StrictInt`/`StrictBool`, so `90.5` and `"no"` are 422 |

Two exception handlers map the store's exceptions: `learning.NotFound` -> 404, `LessonSetInvalid` -> 422 with `detail`, `errors` and `warnings`, for the page to list what the checker found. `ValueError` from the store (bad numbers, a file that isn't a set) is already 422 through the app's existing handler. The path parameters `SetId`/`ExerciseId` are at most 64 characters (the store's `ID`). `schemas.py` gets the response models (`FingerKey`, `Fingers`, `ExportKeyboard`, `LayoutExport`, `LessonSetSummary`, `LessonSetImported`, `LessonSet`, `Attempt`, `ExerciseProgress`, `Progress`, `LearningSettings`) and the requests (`FingerFix`, `FingersIn`, `AttemptIn`, `LearningSettingsIn`); `web/src/api/schema.d.ts` is regenerated from them in the same commit, which the web tasks build on.

The tests: the route tests join `test_learning.py` (a client on an app with a store under `tmp_path`), `test_dump_openapi.py` pins the routes and schema names in the dump, `test_vial_web.py` the data dir.

**Files:**
- Modify: `src/main/python/server/schemas.py`
- Modify: `src/main/python/server/app.py`
- Modify: `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_learning.py`, `src/main/python/test/test_dump_openapi.py`, `src/main/python/test/test_vial_web.py`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_learning.py` (against the file Task 3 created: the docstring, the imports and constants the routes need, and the route tests at the end):

```diff
diff --git a/src/main/python/test/test_learning.py b/src/main/python/test/test_learning.py
--- a/src/main/python/test/test_learning.py
+++ b/src/main/python/test/test_learning.py
@@ -1,17 +1,24 @@
-""" The Learning feature's store (server.learning) """
+""" The Learning feature's store (server.learning) and its routes """
 import json
 import os
 
 import pytest
+from fastapi.testclient import TestClient
 
 from server import learning_layout
+from server.app import create_app
+from server.device import DeviceManager, FakeBackend
 from server.learning import LearningStore, LessonSetInvalid, NotFound
+from server.names import NamesStore
 from simulator.corne import make_corne
 from test.test_learning_check import minimal_set, EXPORT as MINI_EXPORT
 from test.test_learning_layout import model_of, EXAMPLES
 
 UID = "5EEDC0DE00420042"
 """ the simulated Corne's uid """
+TOKEN = "test-token"
+PORT = 8766
+BASE = "http://127.0.0.1:{}".format(PORT)
 
 
 def example(name):
@@ -301,3 +308,184 @@ def test_settings_file_with_wrong_values_falls_back_to_the_defaults_for_them(sto
     (folder / "settings.json").write_text(json.dumps({"passAccuracy": 200, "targetWpm": 40, "extra": 1}),
                                           encoding="utf-8")
     assert store.settings(UID) == {"passAccuracy": 95, "targetWpm": 40, "pictureInWords": True}
+
+
+# ---------- the routes ----------
+
+@pytest.fixture
+def client(tmp_path):
+    """ A client with a session cookie, on an app with a learning store under tmp_path/learning """
+    manager = DeviceManager(FakeBackend(make_corne))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     learning=LearningStore(str(tmp_path / "learning")))
+    with TestClient(app, base_url=BASE) as client:
+        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
+        yield client
+
+
+def test_routes_refuse_without_a_store(tmp_path):
+    manager = DeviceManager(FakeBackend(make_corne))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN, follow_redirects=False)
+        assert client.get("/api/learning/fingers").status_code == 501
+        assert client.get("/api/learning/settings").status_code == 501
+        assert client.get("/api/learning/sets").status_code == 501
+
+
+def test_fingers_round_trip_and_reset_over_the_api(client, root):
+    proposal = client.get("/api/learning/fingers").json()
+    assert proposal["proposal"] is True and proposal["format"] == "vial-web-fingers/1"
+    assert proposal["keys"]["r1c4"] == {"hand": "left", "finger": "index", "row": "home", "reach": "rest", "home": True}
+    assert sorted(proposal["home"]) == ["r1c1", "r1c2", "r1c3", "r1c4", "r3c4", "r5c1", "r5c2", "r5c3", "r5c4", "r7c4"]
+    assert len(proposal["keys"]) == 42
+    home = [k for k in proposal["home"] if k != "r1c4"] + ["r1c5"]
+    response = client.put("/api/learning/fingers", json={"keys": {"r0c5": {"finger": "middle", "reach": "up"},
+                                                                  "r9c9": {"finger": "ring", "reach": "up"}},
+                                                         "home": home})
+    assert response.status_code == 200, response.text
+    fixed = response.json()
+    assert fixed["proposal"] is False
+    assert fixed["keys"]["r0c5"]["finger"] == "middle" and fixed["keys"]["r0c5"]["reach"] == "up"
+    assert fixed["keys"]["r1c5"]["home"] and fixed["keys"]["r1c5"]["reach"] == "rest"
+    assert not fixed["keys"]["r1c4"]["home"]
+    assert sorted(fixed["home"]) == sorted(home) and "r9c9" not in fixed["keys"]
+    assert client.get("/api/learning/fingers").json() == fixed
+    assert (root / UID / "fingers.json").exists()
+    assert client.put("/api/learning/fingers", json={"keys": {"r0c5": {"finger": "hand", "reach": "up"}},
+                                                     "home": []}).status_code == 422
+    assert client.put("/api/learning/fingers", json={"keys": {}, "home": [], "extra": 1}).status_code == 422
+    assert client.get("/api/learning/fingers").json() == fixed
+    reset = client.delete("/api/learning/fingers")
+    assert reset.status_code == 200 and reset.json() == proposal
+    assert not (root / UID / "fingers.json").exists()
+
+
+def test_export_is_saved_and_its_hash_stable(client, root):
+    first = client.get("/api/learning/export")
+    assert first.status_code == 200, first.text
+    export = first.json()
+    assert export["format"] == "vial-web-layout-export/1" and export["language"] == "en-us"
+    assert export["keyboard"] == {"name": "Simulated Corne", "uid": UID}
+    assert export["hash"] == example("corne-sim-layout-export.json")["hash"]
+    saved = json.loads((root / UID / "layout-export.json").read_text(encoding="utf-8"))
+    assert saved == export
+    second = client.get("/api/learning/export").json()
+    assert second["hash"] == export["hash"] and second["keys"] == export["keys"]
+    assert client.get("/api/learning/export?lang=klingon").status_code == 422
+    assert len(client.get("/api/learning/export?lang=en-us").json()["layers"]) == 4
+
+
+def test_import_list_get_and_delete_over_the_api(client, root):
+    data = example("corne-sim-en.json")
+    assert client.get("/api/learning/sets").json() == []
+    response = client.post("/api/learning/sets", json=data)
+    assert response.status_code == 201, response.text
+    assert response.json() == {"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
+                               "layoutHash": data["layout"]["hash"], "outOfDate": False, "error": None,
+                               "warnings": []}
+    listed = client.get("/api/learning/sets").json()
+    assert listed == [{"id": "corne-sim-en", "title": data["title"], "language": "en", "lessons": 2,
+                       "layoutHash": data["layout"]["hash"], "outOfDate": False, "error": None}]
+    assert client.get("/api/learning/sets/corne-sim-en").json() == data
+    assert (root / UID / "sets" / "corne-sim-en.json").exists()
+    assert client.delete("/api/learning/sets/corne-sim-en").status_code == 204
+    assert client.get("/api/learning/sets").json() == []
+    assert client.get("/api/learning/sets/corne-sim-en").status_code == 404
+    assert client.delete("/api/learning/sets/corne-sim-en").status_code == 404
+    assert client.get("/api/learning/sets/a%2Fb").status_code == 404
+
+
+def test_import_refuses_a_bad_file_with_the_checkers_errors(client):
+    data = example("corne-sim-en.json")
+    data["lessons"][0]["exercises"][0]["lines"].append("zq zq")
+    data["lessons"][1]["new"][0]["key"] = "r9c9"
+    response = client.post("/api/learning/sets", json=data)
+    assert response.status_code == 422, response.text
+    body = response.json()
+    assert body["errors"] == ["exercise 01-n1: uses characters not taught yet: 'q' 'z'",
+                              "lesson 02/new[0]: key r9c9 is not in the layout export"]
+    assert body["detail"].startswith("the lesson set has 2 errors")
+    assert isinstance(body["warnings"], list)
+    assert client.get("/api/learning/sets").json() == []
+    # not a lesson set at all
+    assert client.post("/api/learning/sets", json=[1, 2]).status_code == 422
+    assert client.post("/api/learning/sets", content=b"{not json").status_code == 422
+    assert client.post("/api/learning/sets", json={"format": "x"}).json()["errors"][0].startswith("format:")
+    assert client.post("/api/learning/sets?lang=klingon", json=data).status_code == 422
+
+
+def test_import_of_a_set_made_for_another_layout_is_out_of_date(client):
+    data = example("corne-sim-en.json")
+    data["layout"]["hash"] = "sha256:ffffffffffffffff"
+    response = client.post("/api/learning/sets", json=data)
+    assert response.status_code == 201, response.text
+    assert response.json()["outOfDate"] is True
+    assert response.json()["warnings"] == ["layout/hash: differs from the export's hash: the set was made from "
+                                           "another layout"]
+    assert client.get("/api/learning/sets").json()[0]["outOfDate"] is True
+
+
+def test_a_file_dropped_in_by_hand_is_listed_with_its_error(client, root):
+    folder = root / UID / "sets"
+    folder.mkdir(parents=True)
+    (folder / "broken.json").write_text("{", encoding="utf-8")
+    listed = client.get("/api/learning/sets").json()
+    assert len(listed) == 1 and listed[0]["id"] == "broken" and listed[0]["error"].startswith("not a JSON file")
+    assert listed[0]["outOfDate"] is False and listed[0]["layoutHash"] is None
+    assert client.get("/api/learning/sets/broken").status_code == 422
+
+
+def test_progress_over_the_api(client):
+    data = example("corne-sim-en.json")
+    assert client.post("/api/learning/sets", json=data).status_code == 201
+    empty = client.get("/api/learning/progress/corne-sim-en").json()
+    assert empty == {"format": "vial-web-progress/1", "lessonSet": "corne-sim-en", "layoutHash": None, "exercises": {}}
+    response = client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(chars=228, errors=3, seconds=88))
+    assert response.status_code == 200, response.text
+    entry = response.json()
+    assert entry["done"] is True and entry["best"]["accuracy"] == 98.7 and entry["best"]["wpm"] == 31.1
+    assert entry["attempts"] == [entry["best"]]
+    better = client.put("/api/learning/progress/corne-sim-en/01-n1",
+                        json=attempt(chars=228, errors=0, seconds=100, at="t2")).json()
+    assert better["best"]["at"] == "t2" and better["best"]["accuracy"] == 100.0 and len(better["attempts"]) == 2
+    progress = client.get("/api/learning/progress/corne-sim-en").json()
+    assert progress["exercises"] == {"01-n1": better} and progress["layoutHash"] == data["layout"]["hash"]
+    assert client.put("/api/learning/progress/corne-sim-en/99-x", json=attempt()).status_code == 404
+    assert client.put("/api/learning/progress/other-set/01-n1", json=attempt()).status_code == 404
+    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(chars=0)).status_code == 422
+    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(errors=300)).status_code == 422
+    assert client.put("/api/learning/progress/corne-sim-en/01-n1", json=attempt(seconds=0)).status_code == 422
+    assert client.put("/api/learning/progress/corne-sim-en/01-n1",
+                      json={**attempt(), "accuracy": 50}).status_code == 422
+    assert client.get("/api/learning/progress/corne-sim-en").json() == progress
+    assert client.get("/api/learning/progress/never").json()["exercises"] == {}
+
+
+def test_settings_over_the_api(client):
+    assert client.get("/api/learning/settings").json() == {"passAccuracy": 95, "targetWpm": 30,
+                                                           "pictureInWords": True}
+    response = client.put("/api/learning/settings", json={"passAccuracy": 90, "targetWpm": 40,
+                                                          "pictureInWords": False})
+    assert response.status_code == 200, response.text
+    assert response.json() == {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": False}
+    assert client.get("/api/learning/settings").json() == response.json()
+    for bad in ({"passAccuracy": 49, "targetWpm": 40, "pictureInWords": False},
+                {"passAccuracy": 90, "targetWpm": 301, "pictureInWords": False},
+                {"passAccuracy": 90.5, "targetWpm": 40, "pictureInWords": False},
+                {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": "no"},
+                {"passAccuracy": 90, "targetWpm": 40},
+                {"passAccuracy": 90, "targetWpm": 40, "pictureInWords": False, "more": 1}):
+        assert client.put("/api/learning/settings", json=bad).status_code == 422, bad
+    assert client.get("/api/learning/settings").json() == response.json()
+
+
+def test_learning_routes_need_a_keyboard(client):
+    client.put("/api/simulator/connection", json={"connected": False})
+    client.app.state.manager.check()  # the hot-plug poll (off in tests) notices
+    assert client.get("/api/learning/fingers").status_code == 503
+    assert client.get("/api/learning/sets").status_code == 503
+    assert client.get("/api/learning/settings").status_code == 503
+    assert client.post("/api/learning/sets", json=example("corne-sim-en.json")).status_code == 503
```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
index 03feba3..fa58f05 100644
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -22,6 +22,16 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
     assert {"/api/keyboards", "/api/keyboards/select"} <= set(schema["paths"])
     assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/bootloader", "/api/lighting/save",
             "/api/shutdown"} <= set(schema["paths"])
+    # the Learning feature (its store isn't configured for the dump: the routes are described all the same)
+    assert {"/api/learning/fingers", "/api/learning/export", "/api/learning/sets", "/api/learning/sets/{set}",
+            "/api/learning/progress/{set}", "/api/learning/progress/{set}/{exercise}",
+            "/api/learning/settings"} <= set(schema["paths"])
+    assert set(schema["paths"]["/api/learning/fingers"]) == {"get", "put", "delete"}
+    assert {"Fingers", "FingerKey", "FingersIn", "LayoutExport", "LessonSetSummary", "LessonSetImported",
+            "LessonSet", "Progress", "ExerciseProgress", "Attempt", "AttemptIn", "LearningSettings",
+            "LearningSettingsIn"} <= set(schema["components"]["schemas"])
+    imported = schema["paths"]["/api/learning/sets"]["post"]["responses"]["201"]["content"]["application/json"]
+    assert imported["schema"] == {"$ref": "#/components/schemas/LessonSetImported"}
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
```

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
index f6e3c0a..6c1dd9c 100644
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -1208,7 +1208,8 @@ def test_data_dir_option_is_made_absolute(tmp_path, monkeypatch):
 def test_data_dir_holds_every_file_of_its_mode(tmp_path, no_platform_dirs, fake):
     vial_web.use_data_dir(str(tmp_path))
     where = str(tmp_path / "fake") if fake else str(tmp_path)
-    for path in (vial_web.lock_file, vial_web.session_file, vial_web.log_file, vial_web.names_file):
+    for path in (vial_web.lock_file, vial_web.session_file, vial_web.log_file, vial_web.names_file,
+                 vial_web.learning_dir):
         assert os.path.dirname(path(fake)) == where
 
 
```

- [ ] **Step 2: Run them: they fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning.py test/test_dump_openapi.py
```

Expected: `TypeError: create_app() got an unexpected keyword argument 'learning'` and `AssertionError: assert 404 == 501` and `2 failed, 29 passed, 9 errors`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py -k data_dir_holds
```

Expected: `AttributeError: module 'vial_web' has no attribute 'learning_dir'` and `2 failed`.

- [ ] **Step 3: The schemas**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
index 53380ec..91c68c4 100644
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -2,7 +2,7 @@
 """ Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
 from typing import Annotated, Literal, Optional, Union
 
-from pydantic import BaseModel, ConfigDict, Field, StrictInt
+from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
 
 # ---------- responses ----------
 
@@ -503,6 +503,123 @@ class Names(BaseModel):
     macros: dict[str, str]
 
 
+# ---------- learning (docs/learning/lesson-format.md) ----------
+
+Hand = Literal["left", "right"]
+Finger = Literal["index", "middle", "ring", "pinky", "thumb"]
+Reach = Literal["rest", "up", "down", "inner", "outer"]
+KeyRow = Literal["number", "top", "home", "bottom", "thumb"]
+
+
+class FingerKey(BaseModel):
+    """ Which finger types a key, and from where (lesson-rules.md section 2) """
+    hand: Hand
+    finger: Finger
+    row: KeyRow
+    reach: Reach
+    home: bool
+    """ a resting key: the finger rests on it """
+
+
+class Fingers(BaseModel):
+    """ The app's finger proposal for the keyboard open, with the user's corrections on top """
+    format: str
+    keys: dict[str, FingerKey]
+    """ by key id ("r1c4": matrix row 1, column 4) """
+    home: list[str]
+    """ the resting keys' ids """
+    proposal: bool
+    """ nothing is saved: this is the app's proposal alone """
+
+
+class ExportKeyboard(BaseModel):
+    name: str
+    uid: str
+
+
+class LayoutExport(BaseModel):
+    """ The layout export the lesson generator reads (lesson-format.md section 2); layers, shiftKeys and keys are as
+    the format describes them """
+    format: str
+    keyboard: ExportKeyboard
+    hash: str
+    """ "sha256:…" over the character map: what a lesson set is valid for """
+    exportedAt: str
+    language: str
+    """ the keyboard language the characters are of (KeyboardLanguage.id) """
+    layers: list[dict]
+    shiftKeys: list[dict]
+    keys: list[dict]
+
+
+class LessonSetSummary(BaseModel):
+    """ A lesson set file of the keyboard open (learning/<uid>/sets/<id>.json) """
+    id: str
+    title: str
+    """ the file name when the file can't be read """
+    language: str
+    lessons: int
+    layoutHash: Optional[str] = None
+    """ the hash of the layout export it was made from """
+    outOfDate: bool
+    """ its layoutHash isn't the keyboard's now: a character moved since (it still opens) """
+    error: Optional[str] = None
+    """ the first thing wrong with the file, when it isn't a lesson set the app can open """
+
+
+class LessonSetImported(LessonSetSummary):
+    warnings: list[str]
+    """ what the checker would rather have otherwise (the set was saved all the same) """
+
+
+class LessonSet(BaseModel):
+    """ A lesson set, as its file has it (lesson-format.md section 3); fields the format doesn't require are kept """
+    model_config = ConfigDict(extra="allow")
+    format: str
+    id: str
+    title: str
+    language: str
+    layout: dict
+    lessons: list[dict]
+
+
+class Attempt(BaseModel):
+    """ An exercise typed to the end """
+    at: str
+    chars: int
+    errors: int
+    accuracy: float
+    """ 100 × (chars − errors) / chars, one decimal """
+    wpm: float
+    """ chars / 5 / minutes, one decimal """
+    seconds: float
+
+
+class ExerciseProgress(BaseModel):
+    done: bool
+    best: Optional[Attempt] = None
+    """ the attempt with the highest accuracy, then the highest WPM """
+    attempts: list[Attempt]
+    """ the last 50 """
+
+
+class Progress(BaseModel):
+    """ The progress on one lesson set (lesson-format.md section 4) """
+    format: str
+    lessonSet: str
+    layoutHash: Optional[str] = None
+    exercises: dict[str, ExerciseProgress]
+
+
+class LearningSettings(BaseModel):
+    passAccuracy: int
+    """ the accuracy, in percent, that passes an exercise """
+    targetWpm: int
+    """ the speed that earns a star """
+    pictureInWords: bool
+    """ show the keyboard picture in word exercises too """
+
+
 # ---------- requests ----------
 
 KEYCODE_MAX_LENGTH = 200
@@ -672,3 +789,38 @@ class SelectKeyboard(Request):
 
 class NameIn(Request):
     name: Optional[str] = Field(default=None, max_length=40)
+
+
+LEARNING_KEYS_MAX = 1000
+""" more keys than any keyboard has """
+
+
+class FingerFix(Request):
+    """ The user's say on one key """
+    finger: Finger
+    reach: Reach
+
+
+class FingersIn(Request):
+    """ The user's finger corrections (PUT /api/learning/fingers): replaces what was saved """
+    keys: dict[str, FingerFix] = Field(max_length=LEARNING_KEYS_MAX)
+    """ by key id; keys the keyboard doesn't have are ignored """
+    home: list[Annotated[str, Field(max_length=20)]] = Field(max_length=LEARNING_KEYS_MAX)
+    """ the resting keys' ids: these and no others """
+
+
+class AttemptIn(Request):
+    """ An exercise typed to the end (PUT /api/learning/progress/{set}/{exercise}); accuracy and WPM are computed by
+    the server """
+    at: str = Field(max_length=40)
+    """ when, as the page tells it (ISO 8601) """
+    chars: int = Field(ge=1, le=1_000_000)
+    errors: int = Field(ge=0, le=1_000_000)
+    """ wrong characters typed (a corrected mistake still counts one) """
+    seconds: float = Field(gt=0, le=86_400)
+
+
+class LearningSettingsIn(Request):
+    passAccuracy: StrictInt = Field(ge=50, le=100)
+    targetWpm: StrictInt = Field(ge=1, le=300)
+    pictureInWords: StrictBool
```

- [ ] **Step 4: The routes**

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
index 4978d46..1fd9e04 100644
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -10,15 +10,17 @@ import sys
 import urllib.parse
 from typing import Annotated, Literal
 
-from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
+from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Path, Query, Request, WebSocket, \
+    WebSocketDisconnect
 from fastapi.openapi.utils import get_openapi
 from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
 from fastapi.staticfiles import StaticFiles
 from starlette.requests import HTTPConnection
 
 from protocol.qmk_settings_codec import QmkSettingsCodec
-from server import arranger, device, edits, languages, model, schemas
+from server import arranger, device, edits, languages, learning_layout, model, schemas
 from server.describe import keyboard_language, parse
+from server.learning import FINGERS_FORMAT, LessonSetInvalid, NotFound as LearningNotFound
 from server.device import JumpUnanswered, KeyboardChanged, NotConnected, KeyboardLocked, KeyboardRefused, \
     UnknownKeyboard
 
@@ -26,6 +28,8 @@ log = logging.getLogger(__name__)
 
 MAX_LAYOUT_FILE = 1024 * 1024
 """ largest .vil upload, in bytes """
+MAX_LESSON_SET = 4 * 1024 * 1024
+""" largest lesson set import, in bytes (a 19-lesson course is about 130 KiB) """
 UNLOCK_POLL_INTERVAL = 0.2
 """ seconds between two readings of the unlock countdown, as upstream vial-gui's unlocker """
 MATRIX_POLL_INTERVAL = 0.05
@@ -340,13 +344,14 @@ class UnlockFollower:
 
 def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
                poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL,
-               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP, on_stop=None):
+               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP, on_stop=None, learning=None):
     """
     manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
     static_dir: built UI (web/dist) or None for a placeholder page
     on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
     on_stop: stops the server (uvicorn's should_exit), called once POST /api/shutdown has answered; None: that route
     refuses (501)
+    learning: learning.LearningStore, the Learning feature's files; None: the /api/learning routes refuse (501)
     poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
     matrix_interval, matrix_gap: the matrix tester's readings (MatrixWatcher)
     """
@@ -524,6 +529,15 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         log.error("%s", exc, exc_info=exc.__cause__)
         return JSONResponse({"detail": str(exc)}, status_code=507)
 
+    @app.exception_handler(LearningNotFound)
+    async def learning_not_found(request, exc):
+        return JSONResponse({"detail": str(exc)}, status_code=404)
+
+    @app.exception_handler(LessonSetInvalid)
+    async def lesson_set_invalid(request, exc):
+        # the checker's findings with the message, for the page to list them
+        return JSONResponse({"detail": str(exc), "errors": exc.errors, "warnings": exc.warnings}, status_code=422)
+
     @app.exception_handler(KeyboardRefused)
     async def refused(request, exc):
         # it answered, and can't take the change: the page shows the message (a 502 would read "didn't respond")
@@ -874,6 +888,139 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         return await arranging(lambda kb: arranger.resume(kb, manager.open_id, arrangements, names, finish=False),
                                lang)
 
+    # ---------- learning (docs/learning/lesson-format.md) ----------
+
+    def learning_store():
+        if learning is None:
+            raise HTTPException(501, "this server has no learning store")
+        return learning
+
+    def keyboard_dict(lang=languages.DEFAULT):
+        """ (uid, model) of the keyboard open, the model as a dict: what the learning export and the finger proposal
+        are built from. 503 when none is open. """
+        return read(lambda kb: (model.uid_of(kb), model.build(kb, names_for(kb), manager.unlocked).model_dump()), lang)
+
+    def fingers_of(store, uid, built):
+        """ The finger proposal of the keyboard with the user's corrections on top -> schemas.Fingers """
+        saved = store.fingers(uid)
+        keys = learning_layout.apply_fingers(learning_layout.proposal(built), saved)
+        return schemas.Fingers(format=FINGERS_FORMAT, keys=keys,
+                               home=[kid for kid, key in keys.items() if key["home"]], proposal=saved is None)
+
+    @app.get("/api/learning/fingers", response_model=schemas.Fingers)
+    def get_fingers():
+        """ Which finger types each key of the keyboard open: the app's proposal from the key positions and what layer
+        0 types (lesson-rules.md section 2), with the user's corrections (PUT) on top """
+        store = learning_store()
+        uid, built = keyboard_dict()
+        return fingers_of(store, uid, built)
+
+    @app.put("/api/learning/fingers", response_model=schemas.Fingers)
+    def set_fingers(body: schemas.FingersIn):
+        """ Save the user's corrections for this keyboard (learning/<uid>/fingers.json), replacing those saved before;
+        returns the result as GET does """
+        store = learning_store()
+        uid, built = keyboard_dict()
+        store.set_fingers(uid, body.model_dump())
+        return fingers_of(store, uid, built)
+
+    @app.delete("/api/learning/fingers", response_model=schemas.Fingers)
+    def clear_fingers():
+        """ Forget the user's corrections: back to the app's proposal """
+        store = learning_store()
+        uid, built = keyboard_dict()
+        store.clear_fingers(uid)
+        return fingers_of(store, uid, built)
+
+    @app.get("/api/learning/export", response_model=schemas.LayoutExport)
+    def learning_export(lang: Lang = languages.DEFAULT):
+        """ The layout export of the keyboard open for the lesson generator (lesson-format.md section 2), with the
+        user's finger corrections; also saved as learning/<uid>/layout-export.json """
+        store = learning_store()
+        uid, built = keyboard_dict(lang)
+        return store.export(uid, built, lang)
+
+    def summaries(store, uid, built, entries):
+        """ The listing entries with outOfDate: the keyboard's hash now, computed once, against each set's """
+        current = learning_layout.export(built, store.fingers(uid))["hash"]
+        return [schemas.LessonSetSummary(**entry, outOfDate=entry["layoutHash"] is not None
+                                         and entry["layoutHash"] != current) for entry in entries]
+
+    @app.get("/api/learning/sets", response_model=list[schemas.LessonSetSummary])
+    def lesson_sets(lang: Lang = languages.DEFAULT):
+        """ The lesson sets of the keyboard open (learning/<uid>/sets/*.json), each with whether it was made from
+        another character map than the keyboard has now (outOfDate, for the characters of the keyboard language lang);
+        a file that isn't a lesson set is listed with its error """
+        store = learning_store()
+        uid, built = keyboard_dict(lang)
+        return summaries(store, uid, built, store.sets(uid))
+
+    @app.post("/api/learning/sets", response_model=schemas.LessonSetImported, status_code=201)
+    async def import_lesson_set(request: Request, lang: Lang = languages.DEFAULT):
+        """ Import a lesson set (the body is the file): checked as util/learning/check_lessons.py checks it, against
+        the keyboard's export in the keyboard language lang, and saved as sets/<its id>.json (replacing one of that
+        id). 422 with the checker's errors (and warnings) when it fails; the warnings of one that passes come back
+        with its listing entry. """
+        languages.overrides(lang)  # an unknown language is refused before the file is read
+        store = learning_store()
+        raw = await read_limited(request, MAX_LESSON_SET)
+        data = json.loads(raw.decode("utf-8-sig"))  # ValueError (422) when it isn't JSON
+        if not isinstance(data, dict):
+            raise HTTPException(422, "the file isn't a JSON object")
+
+        def do():
+            uid, built = keyboard_dict(lang)
+            export = learning_layout.export(built, store.fingers(uid), lang)
+            entry = store.import_set(uid, data, export)
+            return schemas.LessonSetImported(**entry, outOfDate=entry["layoutHash"] != export["hash"])
+        return await asyncio.to_thread(do)
+
+    SetId = Annotated[str, Path(alias="set", max_length=64)]
+    ExerciseId = Annotated[str, Path(alias="exercise", max_length=64)]
+
+    @app.get("/api/learning/sets/{set}", response_model=schemas.LessonSet)
+    def lesson_set(set_id: SetId):
+        """ One lesson set, whole; 404 when there is none, 422 when the file isn't a lesson set """
+        store = learning_store()
+        uid = read(model.uid_of)
+        return store.set(uid, set_id)
+
+    @app.delete("/api/learning/sets/{set}", status_code=204, response_class=Response)
+    def delete_lesson_set(set_id: SetId):
+        """ Remove the lesson set; its progress stays (for the set imported again). 404 when there is none. """
+        store = learning_store()
+        uid = read(model.uid_of)
+        store.delete_set(uid, set_id)
+        return Response(status_code=204)
+
+    @app.get("/api/learning/progress/{set}", response_model=schemas.Progress)
+    def lesson_progress(set_id: SetId):
+        """ The progress on a lesson set (lesson-format.md section 4): empty when nothing was recorded (also for a set
+        that doesn't exist) """
+        store = learning_store()
+        uid = read(model.uid_of)
+        return store.progress(uid, set_id)
+
+    @app.put("/api/learning/progress/{set}/{exercise}", response_model=schemas.ExerciseProgress)
+    def record_attempt(set_id: SetId, exercise_id: ExerciseId, body: schemas.AttemptIn):
+        """ Record an attempt at an exercise typed to the end: the server computes accuracy and WPM, keeps the best
+        attempt and the last 50. 404 when the set has no such exercise. """
+        store = learning_store()
+        uid = read(model.uid_of)
+        return store.record(uid, set_id, exercise_id, body.model_dump())
+
+    @app.get("/api/learning/settings", response_model=schemas.LearningSettings)
+    def learning_settings():
+        store = learning_store()
+        uid = read(model.uid_of)
+        return store.settings(uid)
+
+    @app.put("/api/learning/settings", response_model=schemas.LearningSettings)
+    def set_learning_settings(body: schemas.LearningSettingsIn):
+        store = learning_store()
+        uid = read(model.uid_of)
+        return store.set_settings(uid, body.model_dump())
+
     @app.post("/api/unlock/start", response_model=schemas.UnlockState)
     async def start_unlock():
         """ Start unlocking the keyboard: the user then holds its unlock keys until the countdown ends, which "unlock"
```

- [ ] **Step 5: The store in `vial_web.py`**

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
index 0f53955..9f8d5d3 100644
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -130,6 +130,11 @@ def names_file(fake):
     return os.path.join(config_dir(fake), "names.json")
 
 
+def learning_dir(fake):
+    """ The Learning feature's files (server.learning.LearningStore), a folder per keyboard inside """
+    return os.path.join(config_dir(fake), "learning")
+
+
 def ensure_data_dir(fake):
     """ The data dir, created if needed. It holds the session token (server.json), so only the user may open it. """
     path = data_dir(fake)
@@ -558,6 +563,7 @@ def serve(args, manager, sock):
     is let go of before it returns. """
     import uvicorn
     from server.app import create_app
+    from server.learning import LearningStore
     from server.names import NamesStore
 
     port = sock.getsockname()[1]
@@ -596,7 +602,8 @@ def serve(args, manager, sock):
     # the page says the web UI isn't built whenever the console does: also when web/dist is there without its page
     web_ui = None if missing_ui else resources.path(resources.WEB_DIST)
     app = create_app(manager, names, token, port, static_dir=web_ui,
-                     on_all_clients_gone=all_tabs_closed, instance_id=instance, on_stop=quit_from_page)
+                     on_all_clients_gone=all_tabs_closed, instance_id=instance, on_stop=quit_from_page,
+                     learning=LearningStore(learning_dir(args.fake)))
     server = uvicorn.Server(uvicorn.Config(app, log_level="warning", log_config=UVICORN_LOGGING,
                                            timeout_graceful_shutdown=SHUTDOWN_GRACE))
 
```

- [ ] **Step 6: Run the tests: they pass**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_learning.py test/test_dump_openapi.py
```

Expected: `40 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `133 passed, 1 skipped`.

- [ ] **Step 7: Regenerate the API types**

`web/src/api/schema.d.ts` is never written by hand. The generator runs `server.dump_openapi` with the repository's `.venv` (or `VIAL_PYTHON`) and compares:

```bash
cd web && npm run gen:api && npm run check:api
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date`.

```bash
git status --short web/src/api/schema.d.ts
```

Expected: ` M web/src/api/schema.d.ts` (the new `Fingers`, `FingersIn`, `LayoutExport`, `LessonSetSummary`, `LessonSetImported`, `LessonSet`, `Progress`, `ExerciseProgress`, `Attempt`, `AttemptIn`, `LearningSettings` and `LearningSettingsIn` types and the `/api/learning/` paths; nothing else in `web/` changes in this task).

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 8: The whole suite and the command line**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1316 passed, 6 skipped`.

```bash
.venv/Scripts/python.exe util/learning/check_lessons.py docs/learning/examples/corne-sim-en.json --layout docs/learning/examples/corne-sim-layout-export.json
```

Expected: `docs/learning/examples/corne-sim-en.json: 2 lessons, 0 errors, 0 warnings`.

The example export `docs/learning/examples/corne-sim-layout-export.json` carries the hash `sha256:e435c3da038f9048`; `test_export_is_saved_and_its_hash_stable` (the route) and `test_export_is_saved_with_the_corrections` (the store) prove the server's export of the simulated Corne carries the same one, and `test_import_list_get_and_delete_over_the_api` that the example lesson set imports against it as not out of date.

- [ ] **Step 9: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/schemas.py \
  src/main/python/vial_web.py \
  src/main/python/test/test_learning.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_vial_web.py \
  web/src/api/schema.d.ts
git commit -m "learning: the /api/learning routes" -m "app.py gets the routes of the design's section 2 (fingers, export, sets, progress, settings) behind create_app(learning=...), 501 without a store; vial_web passes one from the config dir, so --data-dir holds it too. The schemas are in schemas.py and web/src/api/schema.d.ts is regenerated." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: The Learning formats as TypeScript, and the `#learning` route path

The web side starts with the formats of `docs/learning/lesson-format.md` as types, and with an address for the Learning views. A **lesson set** is the JSON file the generator writes for one keyboard (lessons, each with the characters it introduces and its exercises); a **layout export** is the JSON the app writes for the generator (every key, what it types on each layer, which finger types it); **progress** is what the app records per lesson set; the **fingers** reply is the app's finger proposal with the user's corrections on top.

- `learning/types.ts` holds them (`LessonSet`, `Lesson`, `Exercise`, `NewChar`, `LayoutExport`, `ExportKey`, `Progress`, `Attempt`, `LearningSettings`, `Fingers`, …) and `readLessonSet(json)`: the client's shape guard for a file the user imports, which throws an Error saying what is wrong (the format, the id, the lessons array, each exercise's kind and lines). The server's checker checks the content fully; this only guards the client, so that a wrong file says so before it is sent.
- The route (design § 1): the Learning section names its views by a path, not an entry number: `#learning` (the lesson list), `#learning/fingers`, `#learning/<set>/<lesson>` (a lesson), `#learning/<set>/<lesson>/<exercise>` (typing). `Route` gains `path: readonly string[]` ([] for every other section); `item` is always null for Learning. A name is `[A-Za-z0-9_-]{1,64}`, at most three of them; a path that can't be read is the lesson list, and the address is replaced to say so (no step back), as `#lighting/3` already was. `sameRoute()` compares two routes; `router.go(section, item, { replace, path })` passes the path, and drops one given to another section. The order of `SECTIONS` puts "learning" after "macros", where the left menu will show it (App.svelte, the pages task). The prototype made `path` readonly in a later commit; the diffs below are the final content, so it is readonly from the start.

Nothing else in `web/src` builds a `Route` by hand (only `route.ts`, `router.svelte.ts` and their tests do), so adding the field breaks no type-check.

**Files:**
- Create: `web/src/learning/types.ts`
- Test: `web/src/learning/types.test.ts` (new)
- Modify: `web/src/lib/route.ts`, `web/src/lib/router.svelte.ts`
- Test: `web/src/lib/route.test.ts`, `web/src/lib/router.test.ts`

- [ ] **Step 1: The failing tests**

Create `web/src/learning/types.test.ts` (it reads the worked example of phase 1, `docs/learning/examples/corne-sim-en.json`, which is already on the branch):

```ts
import { describe, expect, it } from "vitest";
import set from "../../../docs/learning/examples/corne-sim-en.json";
import { readLessonSet } from "./types";

describe("readLessonSet", () => {
  it("reads the worked example", () => {
    const read = readLessonSet(set);
    expect(read.id).toBe("corne-sim-en");
    expect(read.lessons).toHaveLength(2);
    expect(read.lessons[0].exercises[0].kind).toBe("new-keys");
    expect(read.lessons[0].new[0]).toEqual({ char: "s", key: "r1c1", layer: 0, via: "tap" });
  });

  it("says what is wrong with a file that isn't a lesson set", () => {
    expect(() => readLessonSet(null)).toThrow("not a lesson set");
    expect(() => readLessonSet("text")).toThrow("not a lesson set");
    expect(() => readLessonSet({ ...set, format: "vial-web-lessons/2" })).toThrow("format");
    expect(() => readLessonSet({ ...set, id: "" })).toThrow("id");
    expect(() => readLessonSet({ ...set, id: "bad id!" })).toThrow("id");
    expect(() => readLessonSet({ ...set, lessons: {} })).toThrow("lessons");
    expect(() => readLessonSet({ ...set, lessons: [{ id: "01" }] })).toThrow("lesson 01");
    const lesson = set.lessons[0];
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x" }] }] }))
      .toThrow("exercise x");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "song", lines: ["a"] }] }] }))
      .toThrow("kind");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "text", lines: [] }] }] }))
      .toThrow("lines");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "text", lines: [3] }] }] }))
      .toThrow("lines");
  });
});
```

Apply to `web/src/lib/route.test.ts`:

```diff
diff --git a/web/src/lib/route.test.ts b/web/src/lib/route.test.ts
--- a/web/src/lib/route.test.ts
+++ b/web/src/lib/route.test.ts
@@ -3,26 +3,44 @@ import { HOME, parseRoute, routeHash } from "./route";
 
 describe("parseRoute", () => {
   it("reads the section and the entry", () => {
-    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2 });
-    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null });
-    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0 });
-    expect(parseRoute("#key-overrides/2")).toEqual({ section: "key-overrides", item: 2 });
-    expect(parseRoute("#alt-repeat/0")).toEqual({ section: "alt-repeat", item: 0 });
+    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2, path: [] });
+    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null, path: [] });
+    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0, path: [] });
+    expect(parseRoute("#key-overrides/2")).toEqual({ section: "key-overrides", item: 2, path: [] });
+    expect(parseRoute("#alt-repeat/0")).toEqual({ section: "alt-repeat", item: 0, path: [] });
   });
 
   it("reads the sections that have no entries, an entry number left out", () => {
-    expect(parseRoute("#settings")).toEqual({ section: "settings", item: null });
-    expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null });
-    expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null });
-    expect(parseRoute("#keyboard/3")).toEqual({ section: "keyboard", item: null });
+    expect(parseRoute("#settings")).toEqual({ section: "settings", item: null, path: [] });
+    expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null, path: [] });
+    expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null, path: [] });
+    expect(parseRoute("#keyboard/3")).toEqual({ section: "keyboard", item: null, path: [] });
     for (const section of ["layout", "lighting", "matrix"] as const) {
-      expect(parseRoute(`#${section}`)).toEqual({ section, item: null });
-      expect(parseRoute(`#${section}/1`)).toEqual({ section, item: null });
+      expect(parseRoute(`#${section}`)).toEqual({ section, item: null, path: [] });
+      expect(parseRoute(`#${section}/1`)).toEqual({ section, item: null, path: [] });
     }
   });
 
+  it("reads the Learning section's path: the list, Fingers, a lesson, an exercise", () => {
+    expect(parseRoute("#learning")).toEqual({ section: "learning", item: null, path: [] });
+    expect(parseRoute("#learning/fingers")).toEqual({ section: "learning", item: null, path: ["fingers"] });
+    expect(parseRoute("#learning/corne-sim-en/01")).toEqual({ section: "learning", item: null, path: ["corne-sim-en", "01"] });
+    expect(parseRoute("#learning/corne-sim-en/01/01-n1"))
+      .toEqual({ section: "learning", item: null, path: ["corne-sim-en", "01", "01-n1"] });
+    expect(parseRoute("#learning/Set_A/2/x")).toEqual({ section: "learning", item: null, path: ["Set_A", "2", "x"] });
+  });
+
+  it("is the Learning list for a path it can't read", () => {
+    const list = { section: "learning", item: null, path: [] };
+    for (const hash of ["#learning/", "#learning//01", "#learning/a/b/c/d", "#learning/a b", "#learning/a.json",
+      "#learning/ą", `#learning/${"x".repeat(65)}`, "#learning/a/"]) {
+      expect(parseRoute(hash)).toEqual(list);
+    }
+    expect(parseRoute(`#learning/${"x".repeat(64)}`)).toEqual({ ...list, path: ["x".repeat(64)] });
+  });
+
   it("is the keymap for anything else", () => {
-    for (const hash of ["", "#", "#rgb", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
+    for (const hash of ["", "#", "#rgb", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3", "#combos/a/b"]) {
       expect(parseRoute(hash)).toEqual(HOME);
     }
   });
@@ -30,16 +48,26 @@ describe("parseRoute", () => {
 
 describe("routeHash", () => {
   it("is what parseRoute reads back", () => {
-    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null },
-      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }, { section: "alt-repeat", item: 2 },
-      { section: "settings", item: null }, { section: "lighting", item: null }, { section: "matrix", item: null },
-      { section: "layout", item: null }] as const) {
+    for (const route of [HOME, { section: "combos", item: 3, path: [] }, { section: "macros", item: null, path: [] },
+      { section: "key-overrides", item: 1, path: [] }, { section: "keyboard", item: null, path: [] },
+      { section: "alt-repeat", item: 2, path: [] }, { section: "settings", item: null, path: [] },
+      { section: "lighting", item: null, path: [] }, { section: "matrix", item: null, path: [] },
+      { section: "layout", item: null, path: [] }, { section: "learning", item: null, path: [] },
+      { section: "learning", item: null, path: ["fingers"] },
+      { section: "learning", item: null, path: ["corne-sim-en", "01", "01-n1"] }] as const) {
       expect(parseRoute(routeHash(route))).toEqual(route);
     }
   });
 
   it("never names an entry of a section that has none", () => {
-    expect(routeHash({ section: "settings", item: 2 })).toBe("#settings");
-    expect(routeHash({ section: "matrix", item: 0 })).toBe("#matrix");
+    expect(routeHash({ section: "settings", item: 2, path: [] })).toBe("#settings");
+    expect(routeHash({ section: "matrix", item: 0, path: [] })).toBe("#matrix");
+  });
+
+  it("writes the Learning path, and no entry number", () => {
+    expect(routeHash({ section: "learning", item: null, path: ["corne-sim-en", "01"] })).toBe("#learning/corne-sim-en/01");
+    expect(routeHash({ section: "learning", item: 3, path: ["fingers"] })).toBe("#learning/fingers");
+    // a path belongs to Learning only
+    expect(routeHash({ section: "combos", item: 2, path: ["x"] })).toBe("#combos/2");
   });
 });
```

Apply to `web/src/lib/router.test.ts`:

```diff
diff --git a/web/src/lib/router.test.ts b/web/src/lib/router.test.ts
--- a/web/src/lib/router.test.ts
+++ b/web/src/lib/router.test.ts
@@ -48,11 +48,11 @@ describe("Router", () => {
   it("starts on what the address says, and follows it until stopped", async () => {
     const address = fakeAddress("#combos/2");
     const router = new Router();
-    expect(router.route).toEqual({ section: "combos", item: 2 });
+    expect(router.route).toEqual({ section: "combos", item: 2, path: [] });
     const stop = router.start();
     address.visit("#macros");
     await settle();
-    expect(router.route).toEqual({ section: "macros", item: null });
+    expect(router.route).toEqual({ section: "macros", item: null, path: [] });
     stop();
     expect(address.listeners.size).toBe(0);
     address.visit("#tap-dance");
@@ -69,7 +69,7 @@ describe("Router", () => {
     await settle();
     expect(location.hash).toBe("#tap-dance/5");
     expect(address.counts()).toEqual({ pushes: 1, replaces: 1 });
-    expect(router.route).toEqual({ section: "tap-dance", item: 5 });
+    expect(router.route).toEqual({ section: "tap-dance", item: 5, path: [] });
   });
 
   it("doesn't set the route again when its own address change comes back", async () => {
@@ -128,7 +128,7 @@ describe("Router", () => {
     const address = fakeAddress("#lighting/3");
     const router = new Router();
     router.start();
-    expect(router.route).toEqual({ section: "lighting", item: null });
+    expect(router.route).toEqual({ section: "lighting", item: null, path: [] });
     expect(location.hash).toBe("#lighting");
     expect(address.counts()).toEqual({ pushes: 0, replaces: 1 });
     address.visit("#keyboard/0");
@@ -146,12 +146,42 @@ describe("Router", () => {
   it("keeps no entry for a section that shows one page", () => {
     const router = new Router();
     router.go("lighting", 3);
-    expect(router.route).toEqual({ section: "lighting", item: null });
+    expect(router.route).toEqual({ section: "lighting", item: null, path: [] });
+  });
+
+  it("goes to a Learning view by its path, and follows one from the address", async () => {
+    const address = fakeAddress("#learning/fingers");
+    const router = new Router();
+    router.start();
+    expect(router.route).toEqual({ section: "learning", item: null, path: ["fingers"] });
+    router.go("learning", null, { path: ["corne-sim-en", "01"] });
+    await settle();
+    expect(location.hash).toBe("#learning/corne-sim-en/01");
+    expect(router.route).toEqual({ section: "learning", item: null, path: ["corne-sim-en", "01"] });
+    // an entry number means nothing to it
+    router.go("learning", 3);
+    expect(router.route).toEqual({ section: "learning", item: null, path: [] });
+    expect(location.hash).toBe("#learning");
+    // its own address change changes nothing; a path that can't be read is the list, and the address says so
+    const shown = router.route;
+    await settle();
+    expect(router.route).toBe(shown);
+    address.visit("#learning/a/b/c/d");
+    await settle();
+    expect(router.route).toEqual({ section: "learning", item: null, path: [] });
+    expect(location.hash).toBe("#learning");
+    address.visit("#learning/corne-sim-en/01/01-n1");
+    await settle();
+    expect(router.route.path).toEqual(["corne-sim-en", "01", "01-n1"]);
+    expect(router.fromAddress).toBe(true);
+    // a path given to another section is dropped
+    router.go("combos", 2, { path: ["x"] });
+    expect(router.route).toEqual({ section: "combos", item: 2, path: [] });
   });
 
   it("keeps the route without an address", () => {
     const router = new Router();
     router.go("macros", 0);
-    expect(router.route).toEqual({ section: "macros", item: 0 });
+    expect(router.route).toEqual({ section: "macros", item: 0, path: [] });
   });
 });
```

- [ ] **Step 2: Run them: they fail**

```bash
cd web && npx vitest run src/learning/types.test.ts src/lib/route.test.ts src/lib/router.test.ts
```

Expected: `Error: Cannot find module './types'` and `Test Files  3 failed (3)` (the route tests fail on the missing `path`).

- [ ] **Step 3: The types, the route path, the router's `path` option**

Create `web/src/learning/types.ts`:

```ts
// The Learning feature's files as TypeScript: the lesson set the generator writes, the layout export the app writes
// for it, the progress the app keeps, and the fingers reply (docs/learning/lesson-format.md).

export type ExerciseKind = "new-keys" | "keys" | "words" | "blind" | "text" | "extra-keys" | "extra-words";

export const EXERCISE_KINDS: readonly ExerciseKind[] = [
  "new-keys", "keys", "words", "blind", "text", "extra-keys", "extra-words",
];

export type Via = "tap" | "shift" | "altGr";

/** A character a lesson introduces, and where it is */
export interface NewChar {
  /** one character */
  char: string;
  /** export key id, "r1c4" */
  key: string;
  layer: number;
  via: Via;
  /** a label for the way there, "hold Space" */
  path?: string;
}

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  title: string;
  /** one screen line per entry */
  lines: string[];
}

export interface Lesson {
  id: string;
  title: string;
  new: NewChar[];
  /** a lesson that adds nothing (All keys) */
  review?: boolean;
  /** the finger text, plain words */
  guidance: string;
  exercises: Exercise[];
}

export interface LessonSet {
  format: "vial-web-lessons/1";
  /** file name without .json: letters, digits, - and _ */
  id: string;
  title: string;
  /** BCP-47 primary tag: "en", "pl" */
  language: string;
  layout: { name: string; uid: string; hash: string };
  generatedBy?: { tool: string; model?: string; at: string };
  notes?: string;
  lessons: Lesson[];
}

export type Hand = "left" | "right";
export type Finger = "index" | "middle" | "ring" | "pinky" | "thumb";
export type Reach = "rest" | "up" | "down" | "inner" | "outer";
export type KeyRow = "top" | "home" | "bottom" | "thumb" | string;

/** What a key types on one layer; left out of a layer where it types nothing printable */
export interface LayerChars {
  tap?: string;
  shift?: string;
  altGr?: string;
  /** what holding does: "Shift", "Ctrl", "layer 2" */
  hold?: string;
}

export interface ExportKey {
  id: string;
  hand: Hand;
  finger: Finger;
  row: KeyRow;
  reach: Reach;
  /** a resting key */
  home: boolean;
  /** centre in key units */
  x: number;
  y: number;
  /** by layer index, as a string: "0", "1", … */
  chars: Record<string, LayerChars>;
  layerKey?: { layer: number; how: string };
}

export interface LayerAccess {
  key: string;
  how: "hold" | "oneShot" | "toggle" | string;
  /** "hold Space", "tap OSL 3" */
  label: string;
}

export interface ExportLayer {
  index: number;
  name: string;
  reachedBy: LayerAccess[];
}

export interface ShiftKey {
  key: string;
  hand: Hand;
  label: string;
}

export interface LayoutExport {
  format: "vial-web-layout-export/1";
  keyboard: { name: string; uid: string };
  /** over the character map only: a lesson set built from another hash is out of date */
  hash: string;
  exportedAt: string;
  language: string;
  layers: ExportLayer[];
  shiftKeys: ShiftKey[];
  keys: ExportKey[];
}

/** One finished attempt at an exercise */
export interface Attempt {
  at: string;
  chars: number;
  errors: number;
  accuracy: number;
  wpm: number;
  seconds: number;
}

export interface ExerciseProgress {
  done: boolean;
  /** the attempt with the highest accuracy, then the highest WPM */
  best?: Attempt | null;
  attempts: Attempt[];
}

export interface LearningSettings {
  /** a lesson passes when every main exercise reached this accuracy, in percent */
  passAccuracy: number;
  /** a star at this WPM */
  targetWpm: number;
  /** the keyboard picture in word exercises too */
  pictureInWords: boolean;
}

export interface Progress {
  format: "vial-web-progress/1";
  lessonSet: string;
  layoutHash: string;
  settings?: Partial<LearningSettings>;
  exercises: Record<string, ExerciseProgress>;
}

/** The fingers reply: the app's proposal merged with the user's corrections */
export interface Fingers {
  format: string;
  keys: Record<string, { hand: Hand; finger: Finger; row: KeyRow; reach: Reach; home: boolean }>;
  /** the resting keys */
  home: string[];
  /** all of it is the app's proposal: nothing corrected yet */
  proposal: boolean;
}

const ID = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The lesson set a parsed file holds, or an Error saying what is wrong with its shape (the format, the id, the lessons
 * array, each exercise's kind and lines). The server checks the content fully; this guards the client. */
export function readLessonSet(json: unknown): LessonSet {
  if (!isRecord(json)) throw new Error("not a lesson set: not a JSON object");
  if (json.format !== "vial-web-lessons/1") throw new Error(`not a lesson set: the format is ${String(json.format)}`);
  if (typeof json.id !== "string" || !ID.test(json.id)) {
    throw new Error("the lesson set's id must be letters, digits, - and _");
  }
  if (!Array.isArray(json.lessons)) throw new Error("the lesson set has no lessons array");
  json.lessons.forEach((lesson: unknown, i: number) => {
    const name = isRecord(lesson) && typeof lesson.id === "string" ? `lesson ${lesson.id}` : `lesson ${i + 1}`;
    if (!isRecord(lesson) || typeof lesson.id !== "string" || !Array.isArray(lesson.exercises)) {
      throw new Error(`${name} needs an id and an exercises array`);
    }
    if (!Array.isArray(lesson.new)) throw new Error(`${name} needs a new array (empty for a review lesson)`);
    lesson.exercises.forEach((exercise: unknown, j: number) => {
      const id = isRecord(exercise) && typeof exercise.id === "string" ? `exercise ${exercise.id}` : `exercise ${j + 1}`;
      if (!isRecord(exercise) || typeof exercise.id !== "string") throw new Error(`${name}: ${id} needs an id`);
      if (!EXERCISE_KINDS.includes(exercise.kind as ExerciseKind)) {
        throw new Error(`${name}: ${id} has the kind ${String(exercise.kind)}, not one of ${EXERCISE_KINDS.join(", ")}`);
      }
      if (!Array.isArray(exercise.lines) || exercise.lines.length === 0
        || exercise.lines.some((line: unknown) => typeof line !== "string")) {
        throw new Error(`${name}: ${id} needs lines, an array of strings`);
      }
    });
  });
  return json as unknown as LessonSet;
}
```

Apply to `web/src/lib/route.ts`:

```diff
diff --git a/web/src/lib/route.ts b/web/src/lib/route.ts
--- a/web/src/lib/route.ts
+++ b/web/src/lib/route.ts
@@ -1,18 +1,23 @@
 // Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
-// Combos page. A reload stays where it was, and the browser's back button goes back.
+// Combos page. A reload stays where it was, and the browser's back button goes back. The Learning section names its
+// views by a path instead: "#learning" (the lesson list), "#learning/fingers", "#learning/<set>/<lesson>" (a lesson),
+// "#learning/<set>/<lesson>/<exercise>" (typing).
 
 export type SectionId =
-  | "keymap" | "layout" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "lighting"
-  | "matrix" | "keyboard";
+  | "keymap" | "layout" | "tap-dance" | "combos" | "macros" | "learning" | "key-overrides" | "alt-repeat" | "settings"
+  | "lighting" | "matrix" | "keyboard";
 
 export const SECTIONS: readonly SectionId[] = [
-  "keymap", "layout", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "lighting", "matrix",
-  "keyboard",
+  "keymap", "layout", "tap-dance", "combos", "macros", "learning", "key-overrides", "alt-repeat", "settings", "lighting",
+  "matrix", "keyboard",
 ];
 
 /** sections that show one page of their own, with no entries for the address to name */
 const WHOLE: readonly SectionId[] = ["keymap", "layout", "settings", "lighting", "matrix", "keyboard"];
 
+/** the section whose address holds a path of names, not an entry number */
+const PATHED: SectionId = "learning";
+
 /** Whether a section shows one page of its own, with no entries */
 export function isWhole(section: SectionId): boolean {
   return WHOLE.includes(section);
@@ -22,20 +27,39 @@ export interface Route {
   section: SectionId;
   /** the entry to show (a tap dance, combo, macro, key override or alt-repeat key), or null */
   item: number | null;
+  /** the Learning view's path, up to three names ("corne-sim-en", "01", "01-n1"); [] for every other section */
+  path: readonly string[];
 }
 
-export const HOME: Route = { section: "keymap", item: null };
+export const HOME: Route = { section: "keymap", item: null, path: [] };
+
+/** one name of a Learning path: a set id, a lesson id, an exercise id or "fingers" */
+const NAME = /^[A-Za-z0-9_-]{1,64}$/;
+const PATH_MAX = 3;
 
-/** "#combos/2" -> combo 2 on the Combos page; a section with no entries leaves the number out; anything else is the
- * keymap */
+/** "#combos/2" -> combo 2 on the Combos page; a section with no entries leaves the number out; "#learning/<set>/<lesson>"
+ * -> the Learning section with that path (a path it can't read is the lesson list); anything else is the keymap */
 export function parseRoute(hash: string): Route {
-  const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
+  const m = /^#([a-z-]+)(?:\/(.*))?$/.exec(hash);
   const section = SECTIONS.find((s) => s === m?.[1]);
   if (!m || !section) return HOME;
-  return { section, item: m[2] === undefined || WHOLE.includes(section) ? null : Number(m[2]) };
+  if (section === PATHED) {
+    const path = m[2] === undefined ? [] : m[2].split("/");
+    const readable = path.length <= PATH_MAX && path.every((name) => NAME.test(name));
+    return { section, item: null, path: readable ? path : [] };
+  }
+  if (m[2] !== undefined && !/^\d{1,4}$/.test(m[2])) return HOME;
+  return { section, item: m[2] === undefined || WHOLE.includes(section) ? null : Number(m[2]), path: [] };
 }
 
-/** The address of a route; a section with no entries never names one */
+/** The address of a route; a section with no entries never names one, and only the Learning section writes a path */
 export function routeHash(route: Route): string {
+  if (route.section === PATHED) return ["#learning", ...route.path].join("/");
   return route.item === null || WHOLE.includes(route.section) ? `#${route.section}` : `#${route.section}/${route.item}`;
 }
+
+/** Whether two routes show the same thing */
+export function sameRoute(a: Route, b: Route): boolean {
+  return a.section === b.section && a.item === b.item && a.path.length === b.path.length
+    && a.path.every((name, i) => name === b.path[i]);
+}
```

Apply to `web/src/lib/router.svelte.ts`:

```diff
diff --git a/web/src/lib/router.svelte.ts b/web/src/lib/router.svelte.ts
--- a/web/src/lib/router.svelte.ts
+++ b/web/src/lib/router.svelte.ts
@@ -2,7 +2,7 @@
 // Outside a browser (unit tests without a DOM) there is no address: the route is only kept here.
 import { untrack } from "svelte";
 import type { Place } from "../analysis/find";
-import { HOME, isWhole, parseRoute, routeHash, type Route, type SectionId } from "./route";
+import { HOME, isWhole, parseRoute, routeHash, sameRoute, type Route, type SectionId } from "./route";
 
 export class Router {
   // what the address says from the start, so a reload doesn't show the keymap first
@@ -23,11 +23,11 @@ export class Router {
       // the route (scrolling to a card) run once
       const read = () => {
         const route = parseRoute(location.hash);
-        // an entry named for a section that shows one page ("#lighting/3") goes from the address too, as it does from
-        // the route: no step back
+        // an entry named for a section that shows one page ("#lighting/3"), or a Learning path that can't be read, goes
+        // from the address too, as it does from the route: no step back
         const hash = routeHash(route);
         if (location.hash !== hash && location.hash.startsWith(`#${route.section}/`)) location.replace(hash);
-        if (route.section !== this.route.section || route.item !== this.route.item) {
+        if (!sameRoute(route, this.route)) {
           this.fromAddress = true;
           this.route = route;
           this.visits++;
@@ -39,10 +39,15 @@ export class Router {
     });
   }
 
-  /** Show a section (and a card in it). `replace` changes the address without a new step back, for opening something
-   * on the page shown */
-  go(section: SectionId, item: number | null = null, { replace = false }: { replace?: boolean } = {}): void {
-    const route = { section, item: isWhole(section) ? null : item };
+  /** Show a section (and a card in it, or a Learning view by its `path`). `replace` changes the address without a new
+   * step back, for opening something on the page shown */
+  go(
+    section: SectionId, item: number | null = null,
+    { replace = false, path = [] }: { replace?: boolean; path?: readonly string[] } = {},
+  ): void {
+    const route: Route = section === "learning"
+      ? { section, item: null, path }
+      : { section, item: isWhole(section) ? null : item, path: [] };
     this.fromAddress = false;
     this.route = route;
     this.visits++;
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd web && npx vitest run src/learning/types.test.ts src/lib/route.test.ts src/lib/router.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  20 passed (20)`.

- [ ] **Step 5: Type-check and every unit test (the route is shared by the whole app)**

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  54 passed (54)` and `Tests  876 passed (876)` (one file and six tests more than before this task).

- [ ] **Step 6: Commit**

```bash
git add web/src/learning/types.ts \
  web/src/learning/types.test.ts \
  web/src/lib/route.ts \
  web/src/lib/route.test.ts \
  web/src/lib/router.svelte.ts \
  web/src/lib/router.test.ts
git commit -m "feat(web): Learning types and the #learning route path" \
  -m "types.ts holds the lesson set, layout export, progress and fingers formats as TypeScript, with readLessonSet as the client's shape guard. The route gains a path for the Learning section: #learning, #learning/fingers, #learning/<set>/<lesson>, #learning/<set>/<lesson>/<exercise>; router.go() passes it." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: The typing engine

`learning/engine.ts` is the typing view's state machine (design § 1, "Typing an exercise"), pure: no DOM, no clock (the caller passes `now` in milliseconds), and every press makes a new state, so the view can hold it in a `$state` and the tests can replay presses. What it decides:

- **What an exercise expects** (`expectedOf`): a group or word exercise (`new-keys`, `keys`, `words`, `blind`, `extra-*`) is its lines joined by one space, typed character by character, spaces included; a `text` exercise keeps its lines apart, each but the last ended by Enter, a `"\n"` (`LINE_END`) among the expected characters, which counts as one character.
- **A press** (`press(state, key, now)`): `key` is one character, `"Enter"` (a text line's end) or `"Backspace"`; any other key (Shift, Tab, ArrowLeft…) changes nothing, not even the clock. A wrong key counts an error and the position stays, with the key kept as `wrong` and `wrongNow` set, until the right one comes (the view shows the expected character struck out). Backspace with a wrong mark only clears the mark; otherwise it goes back one character, never past the start of the current group, word or line (R4 of `course-method.md`: Backspace corrects inside the current word only), and never takes an error away (`lesson-format.md` § 4: a corrected mistake still counts one error). The clock starts at the first press that the engine knows, a Backspace too; `finishedAt` is the press that typed the last character, after which presses change nothing.
- **The result** (`resultOf`): `chars`, `errors`, `accuracy` = 100 · (chars − errors) / chars to one decimal and never below 0, `wpm` = chars / 5 per minute to one decimal, `seconds` from the first press to the last, whole; the numbers the progress file records. It throws before the end (`"the exercise is not finished"`): the view never records a partial attempt.
- **The status line** (`progressOf(state, now)`): typed of all, errors, accuracy over the characters typed so far (100 before the first), WPM, seconds since the first press; the clock stops at `finishedAt`.
- **The view's runs** (`segments`): the typed part, the wrong character (the expected one, to be struck out), the next one (underlined), the rest, with a text line's end as a run of its own flagged `lineBreak`, so the view can break the line after it.

**Files:**
- Create: `web/src/learning/engine.ts`
- Test: `web/src/learning/engine.test.ts` (new)

- [ ] **Step 1: The failing tests**

Create `web/src/learning/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEngine, expectedOf, press, progressOf, resultOf, segments, type EngineState } from "./engine";
import type { Exercise } from "./types";

const groups: Exercise = { id: "01-n1", kind: "new-keys", title: "New key exercise 1", lines: ["sa sa", "ei ei"] };
const text: Exercise = { id: "02-t1", kind: "text", title: "Text exercise 1", lines: ["the sea", "a tide"] };

/** the state after typing `keys` one by one, a second apart from `from` */
function type(state: EngineState, keys: string[], from = 1000): EngineState {
  return keys.reduce((s, key, i) => press(s, key, from + i * 1000), state);
}

describe("createEngine", () => {
  it("joins the lines of a group or word exercise with one space", () => {
    expect(expectedOf(groups).join("")).toBe("sa sa ei ei");
    const state = createEngine(groups);
    expect(state.position).toBe(0);
    expect(state.done).toBe(false);
    expect(state.errors).toBe(0);
    expect(state.startedAt).toBeNull();
  });

  it("keeps the lines of a text exercise apart, each but the last ended by Enter", () => {
    expect(expectedOf(text)).toEqual([..."the sea", "\n", ..."a tide"]);
  });
});

describe("press", () => {
  it("types a group exercise through, timing from the first press", () => {
    let state = createEngine(groups);
    state = press(state, "s", 5000);
    expect(state.startedAt).toBe(5000);
    expect(state.position).toBe(1);
    state = type(state, [..."a sa ei e"], 6000);
    expect(state.position).toBe(10);
    expect(state.done).toBe(false);
    expect(state.finishedAt).toBeNull();
    state = press(state, "i", 20000);
    expect(state.done).toBe(true);
    expect(state.finishedAt).toBe(20000);
    expect(state.errors).toBe(0);
    // nothing more happens after the end
    expect(press(state, "x", 21000)).toBe(state);
  });

  it("types a text exercise, Enter ending a line", () => {
    let state = type(createEngine(text), [..."the sea"]);
    expect(state.position).toBe(7);
    state = press(state, " ", 9000);
    expect(state.errors).toBe(1);
    expect(state.wrongNow).toBe(true);
    expect(state.position).toBe(7);
    state = press(state, "Enter", 10000);
    expect(state.position).toBe(8);
    expect(state.wrongNow).toBe(false);
    state = type(state, [..."a tide"], 11000);
    expect(state.done).toBe(true);
    expect(state.errors).toBe(1);
  });

  it("counts a wrong character, and stays until the right one comes", () => {
    let state = type(createEngine(groups), ["s", "x"]);
    expect(state.errors).toBe(1);
    expect(state.position).toBe(1);
    expect(state.wrongNow).toBe(true);
    expect(state.wrong).toBe("x");
    state = press(state, "y", 3000);
    expect(state.errors).toBe(2);
    expect(state.position).toBe(1);
    state = press(state, "a", 4000);
    expect(state.errors).toBe(2);
    expect(state.position).toBe(2);
    expect(state.wrongNow).toBe(false);
    expect(state.wrong).toBeNull();
  });

  it("counts a space typed as the wrong key", () => {
    const state = type(createEngine(groups), [" "]);
    expect(state.errors).toBe(1);
    expect(state.position).toBe(0);
  });

  it("clears a wrong mark with Backspace, keeping the error", () => {
    let state = type(createEngine(groups), ["s", "x"]);
    state = press(state, "Backspace", 3000);
    expect(state.wrongNow).toBe(false);
    expect(state.position).toBe(1);
    expect(state.errors).toBe(1);
  });

  it("goes back within a group with Backspace, but not past the group's start", () => {
    let state = type(createEngine(groups), [..."sa s"]);
    expect(state.position).toBe(4);
    state = press(state, "Backspace", 5000);
    expect(state.position).toBe(3);
    // the start of "sa" (the second group): stays
    state = press(state, "Backspace", 6000);
    expect(state.position).toBe(3);
    expect(state.errors).toBe(0);
    // at the very start too
    expect(press(createEngine(groups), "Backspace", 1000).position).toBe(0);
  });

  it("doesn't go back past a line's start in a text exercise", () => {
    let state = type(createEngine(text), [..."the sea", "Enter", "a"]);
    expect(state.position).toBe(9);
    state = press(state, "Backspace", 10000);
    expect(state.position).toBe(8);
    state = press(state, "Backspace", 11000);
    expect(state.position).toBe(8);
  });

  it("starts the clock on a Backspace too, and ignores keys it doesn't know", () => {
    let state = press(createEngine(groups), "Backspace", 700);
    expect(state.startedAt).toBe(700);
    expect(press(state, "Shift", 800)).toBe(state);
    expect(press(state, "Tab", 800)).toBe(state);
    expect(press(createEngine(groups), "ArrowLeft", 1).startedAt).toBeNull();
  });
});

describe("resultOf", () => {
  it("has the chars, errors, accuracy, wpm and seconds of a finished exercise", () => {
    // 300 characters, 3 errors, 120 s
    const long: Exercise = { id: "x", kind: "keys", title: "", lines: ["a".repeat(300)] };
    let state = createEngine(long);
    state = press(state, "a", 0);
    state = type(state, ["b", "b", "b"], 100);
    state = type(state, Array(298).fill("a"), 1000);
    expect(state.done).toBe(false);
    state = press(state, "a", 120_000);
    expect(resultOf(state)).toEqual({ chars: 300, errors: 3, accuracy: 99, wpm: 30, seconds: 120 });
  });

  it("rounds to one decimal, and never says less than 0 %", () => {
    const short: Exercise = { id: "x", kind: "keys", title: "", lines: ["abc"] };
    let state = type(createEngine(short), ["a", "x", "x", "x", "x", "b", "c"], 0);
    // 3 chars, 4 errors, 6 s
    expect(resultOf(state)).toEqual({ chars: 3, errors: 4, accuracy: 0, wpm: 6, seconds: 6 });
    state = type(createEngine(short), ["a", "x", "b", "c"], 0);
    // 2 of 3 right: 66.7 %, 3 s
    expect(resultOf(state)).toEqual({ chars: 3, errors: 1, accuracy: 66.7, wpm: 12, seconds: 3 });
  });

  it("counts the Enter of a text line as a character", () => {
    const state = type(createEngine(text), [..."the sea", "Enter", ..."a tide"], 0);
    expect(resultOf(state).chars).toBe(14);
  });

  it("needs a finished exercise", () => {
    expect(() => resultOf(createEngine(groups))).toThrow("not finished");
    expect(() => resultOf(type(createEngine(groups), ["s"]))).toThrow("not finished");
  });
});

describe("progressOf", () => {
  it("is the status line's numbers while typing", () => {
    expect(progressOf(createEngine(groups), 5000)).toEqual({ typed: 0, of: 11, errors: 0, accuracy: 100, wpm: 0, seconds: 0 });
    let state = type(createEngine(groups), ["s", "x", "a", " ", "s"], 0);
    // 4 typed of 11 (the x didn't count), 1 error, 4 s: 75 %, 4/5 of a word in 4 s: 12 wpm
    expect(progressOf(state, 4000)).toEqual({ typed: 4, of: 11, errors: 1, accuracy: 75, wpm: 12, seconds: 4 });
    state = type(state, [..."a ei ei"], 5000);
    // finished at 11 s: the clock stops there
    expect(progressOf(state, 60_000)).toEqual({ typed: 11, of: 11, errors: 1, accuracy: 90.9, wpm: 12, seconds: 11 });
  });
});

describe("segments", () => {
  const runs = (state: EngineState) => segments(state).map((s) => [s.text, s.status, s.lineBreak ?? false]);

  it("marks the typed part, the next character, and the rest", () => {
    expect(runs(createEngine(groups))).toEqual([["s", "next", false], ["a sa ei ei", "todo", false]]);
    expect(runs(type(createEngine(groups), [..."sa s"]))).toEqual([
      ["sa s", "typed", false], ["a", "next", false], [" ei ei", "todo", false],
    ]);
  });

  it("marks a wrong character where the next one is expected", () => {
    expect(runs(type(createEngine(groups), ["s", "x"]))).toEqual([
      ["s", "typed", false], ["a", "wrong", false], [" sa ei ei", "todo", false],
    ]);
  });

  it("is all typed at the end", () => {
    expect(runs(type(createEngine(groups), [..."sa sa ei ei"]))).toEqual([["sa sa ei ei", "typed", false]]);
  });

  it("gives a text exercise's line end its own run", () => {
    expect(runs(createEngine(text))).toEqual([
      ["t", "next", false], ["he sea", "todo", false], ["\n", "todo", true], ["a tide", "todo", false],
    ]);
    expect(runs(type(createEngine(text), [..."the sea"]))).toEqual([
      ["the sea", "typed", false], ["\n", "next", true], ["a tide", "todo", false],
    ]);
    expect(runs(type(createEngine(text), [..."the sea", "Enter"]))).toEqual([
      ["the sea", "typed", false], ["\n", "typed", true], ["a", "next", false], [" tide", "todo", false],
    ]);
  });
});
```

- [ ] **Step 2: Run it: it fails**

```bash
cd web && npx vitest run src/learning/engine.test.ts
```

Expected: `Error: Cannot find module './engine'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The engine**

Create `web/src/learning/engine.ts`:

```ts
// The typing engine: what an exercise expects, what was typed so far, the errors, and the result. Pure: no DOM, no
// clock (the caller passes `now` in milliseconds), and every press makes a new state.
//
// A group or word exercise is its lines joined by one space, typed character by character, spaces included. A text
// exercise keeps its lines apart: each line but the last ends with Enter (a "\n" among the expected characters). A wrong
// key counts an error and the position stays until the right key comes (Backspace only clears the mark). Backspace
// otherwise goes back one character, but never past the start of the current group, word or line (R4 of
// course-method.md): a space or a line end ends a group. Going back doesn't take an error away.
import type { Exercise } from "./types";

/** the key of a line's end in a text exercise, typed with Enter */
export const LINE_END = "\n";

export interface EngineState {
  /** the characters to type, in order; LINE_END for a text line's end */
  readonly expected: readonly string[];
  /** index of the next character */
  readonly position: number;
  /** wrong keys pressed so far, corrected ones included */
  readonly errors: number;
  /** a wrong key is shown at the position, not yet corrected */
  readonly wrongNow: boolean;
  /** that wrong key, or null */
  readonly wrong: string | null;
  /** `now` of the first press; null before */
  readonly startedAt: number | null;
  /** `now` of the press that typed the last character; null before */
  readonly finishedAt: number | null;
  /** the last character is typed */
  readonly done: boolean;
}

/** The characters an exercise expects: its lines joined by one space, or kept apart by LINE_END for a text exercise */
export function expectedOf(exercise: Exercise): string[] {
  const separator = exercise.kind === "text" ? LINE_END : " ";
  return Array.from(exercise.lines.join(separator));
}

export function createEngine(exercise: Exercise): EngineState {
  return {
    expected: expectedOf(exercise), position: 0, errors: 0, wrongNow: false, wrong: null, startedAt: null,
    finishedAt: null, done: false,
  };
}

/** where the group, word or line the position is in starts: just after the last separator before it */
function groupStart(expected: readonly string[], position: number): number {
  for (let i = position - 1; i >= 0; i--) {
    if (expected[i] === " " || expected[i] === LINE_END) return i + 1;
  }
  return 0;
}

/** `key` is one character, "Backspace" or "Enter" (a text line's end); any other key changes nothing. `now` is the
 * press's time in milliseconds (performance.now() or Date.now(), the same throughout) */
export function press(state: EngineState, key: string, now: number): EngineState {
  if (state.done) return state;
  const char = key === "Enter" ? LINE_END : key;
  if (char !== "Backspace" && Array.from(char).length !== 1) return state;
  const startedAt = state.startedAt ?? now;
  if (char === "Backspace") {
    if (state.wrongNow) return { ...state, startedAt, wrongNow: false, wrong: null };
    const position = Math.max(state.position - 1, groupStart(state.expected, state.position));
    return { ...state, startedAt, position };
  }
  if (char !== state.expected[state.position]) {
    return { ...state, startedAt, errors: state.errors + 1, wrongNow: true, wrong: key };
  }
  const position = state.position + 1;
  const done = position === state.expected.length;
  return { ...state, startedAt, position, wrongNow: false, wrong: null, done, finishedAt: done ? now : null };
}

export interface Result {
  /** characters the exercise expects (a text line's Enter is one) */
  chars: number;
  errors: number;
  /** 100 · (chars − errors) / chars, one decimal, never below 0 */
  accuracy: number;
  /** chars / 5 per minute, one decimal */
  wpm: number;
  /** from the first press to the last, whole seconds */
  seconds: number;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function accuracyOf(chars: number, errors: number): number {
  return chars === 0 ? 100 : Math.max(0, tenths((100 * (chars - errors)) / chars));
}

function wpmOf(chars: number, ms: number): number {
  return ms <= 0 ? 0 : tenths(chars / 5 / (ms / 60_000));
}

/** The result of a finished exercise, as the progress file records it; throws before the end */
export function resultOf(state: EngineState): Result {
  if (!state.done || state.startedAt === null || state.finishedAt === null) throw new Error("the exercise is not finished");
  const chars = state.expected.length;
  const ms = state.finishedAt - state.startedAt;
  return { chars, errors: state.errors, accuracy: accuracyOf(chars, state.errors), wpm: wpmOf(chars, ms),
    seconds: Math.round(ms / 1000) };
}

export interface Progress {
  /** characters typed so far */
  typed: number;
  /** characters in all */
  of: number;
  errors: number;
  /** over the characters typed so far; 100 before the first */
  accuracy: number;
  wpm: number;
  /** since the first press, whole seconds; the clock stops at the end */
  seconds: number;
}

/** The status line's numbers while typing, at `now` */
export function progressOf(state: EngineState, now: number): Progress {
  const end = state.finishedAt ?? now;
  const ms = state.startedAt === null ? 0 : end - state.startedAt;
  return {
    typed: state.position, of: state.expected.length, errors: state.errors,
    accuracy: accuracyOf(state.position, state.errors), wpm: wpmOf(state.position, ms), seconds: Math.round(ms / 1000),
  };
}

export type SegmentStatus = "typed" | "wrong" | "next" | "todo";

export interface Segment {
  text: string;
  status: SegmentStatus;
  /** a text line's end: the run is its LINE_END, and the line breaks after it */
  lineBreak?: boolean;
}

/** The expected text as runs for the view: the typed part, the wrong character (the expected one, to be shown struck
 * out), the next character (to be underlined), the rest; a text line's end as a run of its own */
export function segments(state: EngineState): Segment[] {
  const runs: Segment[] = [];
  state.expected.forEach((char, i) => {
    const status: SegmentStatus = i < state.position ? "typed"
      : i > state.position ? "todo" : state.wrongNow ? "wrong" : "next";
    const last = runs[runs.length - 1];
    if (char === LINE_END) runs.push({ text: char, status, lineBreak: true });
    else if (last && !last.lineBreak && last.status === status) last.text += char;
    else runs.push({ text: char, status });
  });
  return runs;
}
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd web && npx vitest run src/learning/engine.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  19 passed (19)`.

- [ ] **Step 5: Commit**

```bash
git add web/src/learning/engine.ts \
  web/src/learning/engine.test.ts
git commit -m "feat(web): the Learning typing engine" \
  -m "Pure state transitions: the expected characters (lines joined by a space, or apart with Enter for a text exercise), press() for a character, Enter or Backspace (within the current group only, R4), the errors and the wrong mark, resultOf() with the progress file's accuracy and WPM, progressOf() for the status line, segments() for the view." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: The keyboard-picture arrays

The keyboard picture while typing (design § 3): `Keyboard.svelte` already takes `highlights`, `pressed` and `faded` arrays aligned with `placement.items`, and Learning adds nothing to it; `learning/picture.ts` computes the arrays. A key is named as the export names it, `"r1c4"`: the row and column of its geometry (`keyIdOf`; null for an item with none, an encoder, which the prototype added in a later commit and is in the content below). What it decides:

- `placeOfChars(set, export)`: where every character the lesson set teaches is, from the `new` entries of every lesson, the first listing of a character winning; the space from the export, as the layer-0 key that taps `" "` (a lesson set never lists the space). The design named `analysis/find.ts` as the lookup; the prototype uses the set's own `new` entries instead, because they are the places the generator taught (checked by the server's checker against the export), so the picture and the lesson agree.
- `pictureFor(char, places, placement, export, { fadeOthers })`: the character's key lit; the keys held for it pressed (`heldKeysFor`): the layer key the export lists first for a layer other than 0, the **other hand's** Shift for a shifted character as a touch typist does (R6 of `course-method.md`; any Shift when the other hand has none; none at all without Shift keys), and for `via: "altGr"` the layer-0 key whose hold is `"AltGr"`; everything else faded when `fadeOthers` (the new-key exercises, so the lit key stands out). A character `places` doesn't know, or a key the placement doesn't have, marks nothing: all-false arrays of the placement's length, never a crash mid-exercise.
- `pictureForAll(chars, …)`: the union of the pictures of several characters, for a lesson's new keys lit together on the lesson view; the rest faded when asked.
- `nextKeyLabel(place, export)`: the status line's name of the key to press, from the export's legends: `"S"` (a letter in capitals), `"Space"`, `","`, `"Shift + S"`, `"AltGr + S"`, and the way to a layer first, as the export labels it, `"hold Space → ("`, `"tap OSL 3 → 1"`; `"layer 7 → S"` for a layer the export doesn't list, the key id for a key it doesn't have.

The tests use the worked example export and lesson set of phase 1 and `analysis/testing.ts`'s `simulatedCorne()` placed by `keyboard/geometry.ts` (both already on the branch): S is on the left hand, so its Shift is the right-hand I (hold); `(` is on layer 1, reached by holding Space.

**Files:**
- Create: `web/src/learning/picture.ts`
- Test: `web/src/learning/picture.test.ts` (new)

- [ ] **Step 1: The failing tests**

Create `web/src/learning/picture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import exportJson from "../../../docs/learning/examples/corne-sim-layout-export.json";
import setJson from "../../../docs/learning/examples/corne-sim-en.json";
import { simulatedCorne } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { keyIndex, nextKeyLabel, pictureFor, pictureForAll, placeOfChars, type PlaceOf } from "./picture";
import { readLessonSet, type LayoutExport } from "./types";

const layout = exportJson as LayoutExport;
const set = readLessonSet(setJson);
const placement = placeKeyboard(simulatedCorne());
const places = placeOfChars(set, layout);

/** the key ids of the items marked true */
const marked = (flags: boolean[]) => flags.flatMap((on, i) => (on ? [keyId(i)] : []));
const keyId = (i: number) => `r${placement.items[i].geometry.row}c${placement.items[i].geometry.col}`;

describe("placeOfChars", () => {
  it("lists every new character of every lesson, the first listing winning", () => {
    expect(places.get("s")).toEqual({ key: "r1c1", layer: 0, via: "tap" });
    expect(places.get("r")).toEqual({ key: "r0c3", layer: 0, via: "tap" });
    expect(places.size).toBe(11);
    const twice = { ...set, lessons: [set.lessons[0], { ...set.lessons[1], new: [{ char: "s", key: "r9c9", layer: 2, via: "tap" as const }] }] };
    expect(placeOfChars(twice, layout).get("s")).toEqual({ key: "r1c1", layer: 0, via: "tap" });
  });

  it("knows the space from the export: the layer-0 key that taps it", () => {
    expect(places.get(" ")).toEqual({ key: "r3c4", layer: 0, via: "tap" });
    expect(placeOfChars(set, { ...layout, keys: [] }).has(" ")).toBe(false);
  });
});

describe("keyIndex", () => {
  it("is the placement's item for a key id, from its row and column", () => {
    expect(keyId(keyIndex(placement, "r1c4")!)).toBe("r1c4");
    expect(keyId(keyIndex(placement, "r7c3")!)).toBe("r7c3");
    expect(keyIndex(placement, "r9c9")).toBeNull();
    expect(keyIndex(placement, "junk")).toBeNull();
  });
});

describe("pictureFor", () => {
  it("lights the key of a plain letter, nothing pressed, the rest as it is", () => {
    const picture = pictureFor("s", places, placement, layout, { fadeOthers: false });
    expect(marked(picture.highlights)).toEqual(["r1c1"]);
    expect(marked(picture.pressed)).toEqual([]);
    expect(marked(picture.faded)).toEqual([]);
    expect(picture.highlights).toHaveLength(placement.items.length);
  });

  it("fades everything else when asked", () => {
    const picture = pictureFor("s", places, placement, layout, { fadeOthers: true });
    expect(marked(picture.faded)).toHaveLength(placement.items.length - 1);
    expect(marked(picture.faded)).not.toContain("r1c1");
  });

  it("presses the other hand's Shift for a capital", () => {
    const capitals = new Map<string, PlaceOf>([
      ["S", { key: "r1c1", layer: 0, via: "shift" }], ["A", { key: "r5c4", layer: 0, via: "shift" }],
    ]);
    // S is on the left: the export's first right-hand Shift is I (hold), r5c1
    let picture = pictureFor("S", capitals, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c1"]);
    expect(marked(picture.pressed)).toEqual(["r5c1"]);
    expect(marked(picture.faded)).not.toContain("r5c1");
    // A is on the right: the first left-hand Shift is T (hold), r1c4
    picture = pictureFor("A", capitals, placement, layout, { fadeOthers: false });
    expect(marked(picture.pressed)).toEqual(["r1c4"]);
  });

  it("falls back to any Shift key when the other hand has none", () => {
    const capitals = new Map<string, PlaceOf>([["S", { key: "r1c1", layer: 0, via: "shift" }]]);
    const oneShift = { ...layout, shiftKeys: [layout.shiftKeys[0]] };
    expect(marked(pictureFor("S", capitals, placement, oneShift, { fadeOthers: false }).pressed)).toEqual(["r1c4"]);
    expect(marked(pictureFor("S", capitals, placement, { ...layout, shiftKeys: [] }, { fadeOthers: false }).pressed))
      .toEqual([]);
  });

  it("presses the layer key for a layer character", () => {
    const symbols = new Map<string, PlaceOf>([
      ["(", { key: "r1c3", layer: 1, via: "tap" }], ["~", { key: "r1c1", layer: 1, via: "shift" }],
      ["1", { key: "r1c1", layer: 3, via: "tap" }],
    ]);
    let picture = pictureFor("(", symbols, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c3"]);
    expect(marked(picture.pressed)).toEqual(["r3c4"]);
    expect(marked(picture.faded)).not.toContain("r3c4");
    // shifted on a layer: the layer key and the other hand's Shift
    picture = pictureFor("~", symbols, placement, layout, { fadeOthers: false });
    expect(marked(picture.pressed).sort()).toEqual(["r3c4", "r5c1"]);
    // a one-shot layer key presses the same way
    expect(marked(pictureFor("1", symbols, placement, layout, { fadeOthers: false }).pressed)).toEqual(["r7c3"]);
  });

  it("presses the key that holds AltGr for an AltGr character", () => {
    const polish = new Map<string, PlaceOf>([["ą", { key: "r5c4", layer: 0, via: "altGr" }]]);
    const picture = pictureFor("ą", polish, placement, layout, { fadeOthers: false });
    expect(marked(picture.highlights)).toEqual(["r5c4"]);
    // E (hold) is AltGr in the export
    expect(marked(picture.pressed)).toEqual(["r5c3"]);
  });

  it("lights the space key", () => {
    const picture = pictureFor(" ", places, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r3c4"]);
    expect(marked(picture.pressed)).toEqual([]);
  });

  it("marks nothing for a character it doesn't know", () => {
    const picture = pictureFor("ą", places, placement, layout, { fadeOthers: true });
    expect(picture.highlights).not.toContain(true);
    expect(picture.pressed).not.toContain(true);
    expect(picture.faded).not.toContain(true);
    expect(picture.highlights).toHaveLength(placement.items.length);
  });
});

describe("nextKeyLabel", () => {
  it("names the key, with Shift, or with the way to its layer", () => {
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "tap" }, layout)).toBe("S");
    expect(nextKeyLabel({ key: "r3c4", layer: 0, via: "tap" }, layout)).toBe("Space");
    expect(nextKeyLabel({ key: "r1c5", layer: 0, via: "tap" }, layout)).toBe(",");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "shift" }, layout)).toBe("Shift + S");
    expect(nextKeyLabel({ key: "r1c5", layer: 0, via: "shift" }, layout)).toBe("Shift + ,");
    expect(nextKeyLabel({ key: "r1c3", layer: 1, via: "tap" }, layout)).toBe("hold Space → (");
    expect(nextKeyLabel({ key: "r1c1", layer: 1, via: "shift" }, layout)).toBe("hold Space → Shift + `");
    expect(nextKeyLabel({ key: "r1c1", layer: 3, via: "tap" }, layout)).toBe("tap OSL 3 → 1");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "altGr" }, layout)).toBe("AltGr + S");
  });

  it("says what it can about a key or layer the export doesn't have", () => {
    expect(nextKeyLabel({ key: "r9c9", layer: 0, via: "tap" }, layout)).toBe("r9c9");
    expect(nextKeyLabel({ key: "r1c1", layer: 7, via: "tap" }, layout)).toBe("layer 7 → S");
  });
});

describe("pictureForAll", () => {
  it("lights every character's key and presses every key held for them, fading the rest", () => {
    const capitals = new Map<string, PlaceOf>([
      ["s", { key: "r1c1", layer: 0, via: "tap" }], ["A", { key: "r5c4", layer: 0, via: "shift" }],
    ]);
    const picture = pictureForAll(["s", "A"], capitals, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c1", "r5c4"]);
    expect(marked(picture.pressed)).toEqual(["r1c4"]);
    expect(marked(picture.faded)).toHaveLength(placement.items.length - 3);
    expect(marked(pictureForAll([], capitals, placement, layout, { fadeOthers: true }).faded))
      .toHaveLength(placement.items.length);
    expect(marked(pictureForAll(["s"], capitals, placement, layout, { fadeOthers: false }).faded)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it: it fails**

```bash
cd web && npx vitest run src/learning/picture.test.ts
```

Expected: `Error: Cannot find module './picture'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The picture arrays**

Create `web/src/learning/picture.ts`:

```ts
// The keyboard picture while typing (design § 3): the next character's key lit, the Shift or layer key that reaches it
// pressed, the rest faded in the new-key exercises. Keyboard.svelte takes the three arrays as they are, aligned with
// placement.items. A key is named as the export names it, "r1c4": row and column of its geometry.
import type { Placement } from "../keyboard/geometry";
import type { ExportKey, LayoutExport, LessonSet, Via } from "./types";

/** where a character is: the export key id, the layer, and how (tap, with Shift, with AltGr) */
export interface PlaceOf {
  key: string;
  layer: number;
  via: Via;
}

/** the key's row and column as an export key id; null for a key with none (an encoder) */
export function keyIdOf(geometry: { row?: number | null; col?: number | null }): string | null {
  return geometry.row == null || geometry.col == null ? null : `r${geometry.row}c${geometry.col}`;
}

/** The placement's item that is the export key `id`, or null */
export function keyIndex(placement: Placement, id: string): number | null {
  const i = placement.items.findIndex((item) => item.kind === "key" && keyIdOf(item.geometry) === id);
  return i === -1 ? null : i;
}

/** Where every character a lesson set teaches is: the `new` entries of every lesson, the first listing of a character
 * winning; the space from the export, as the layer-0 key that taps it */
export function placeOfChars(set: LessonSet, layout: LayoutExport): Map<string, PlaceOf> {
  const places = new Map<string, PlaceOf>();
  const space = layout.keys.find((key) => key.chars["0"]?.tap === " ");
  if (space) places.set(" ", { key: space.id, layer: 0, via: "tap" });
  for (const lesson of set.lessons) {
    for (const { char, key, layer, via } of lesson.new) {
      if (!places.has(char)) places.set(char, { key, layer, via });
    }
  }
  return places;
}

export interface Picture {
  /** the next character's key */
  highlights: boolean[];
  /** the Shift and layer keys held for it */
  pressed: boolean[];
  /** everything else, when asked */
  faded: boolean[];
}

function exportKey(layout: LayoutExport, id: string): ExportKey | undefined {
  return layout.keys.find((key) => key.id === id);
}

/** the Shift key to hold for a character on `key`: the other hand's, as a touch typist does; failing that, any */
function shiftKeyFor(layout: LayoutExport, key: ExportKey | undefined): string | null {
  const other = key ? layout.shiftKeys.find((shift) => shift.hand !== key.hand) : undefined;
  return (other ?? layout.shiftKeys[0])?.key ?? null;
}

/** the key that reaches a layer, as the export lists it first */
function layerKeyFor(layout: LayoutExport, layer: number): string | null {
  return layout.layers.find((l) => l.index === layer)?.reachedBy[0]?.key ?? null;
}

/** the key held for AltGr: a layer-0 key the export says holds it */
function altGrKeyFor(layout: LayoutExport): string | null {
  return layout.keys.find((key) => key.chars["0"]?.hold === "AltGr")?.id ?? null;
}

/** the keys held to type a character at `place`, in the export's ids */
export function heldKeysFor(place: PlaceOf, layout: LayoutExport): string[] {
  const held: (string | null)[] = [];
  if (place.layer !== 0) held.push(layerKeyFor(layout, place.layer));
  if (place.via === "shift") held.push(shiftKeyFor(layout, exportKey(layout, place.key)));
  if (place.via === "altGr") held.push(altGrKeyFor(layout));
  return held.filter((id): id is string => id !== null);
}

/** The picture for the character to type next: its key lit, the keys held for it pressed, the rest faded when
 * `fadeOthers`. A character `places` doesn't know marks nothing. */
export function pictureFor(
  char: string, places: Map<string, PlaceOf>, placement: Placement, layout: LayoutExport,
  { fadeOthers }: { fadeOthers: boolean },
): Picture {
  const count = placement.items.length;
  const highlights = Array<boolean>(count).fill(false);
  const pressed = Array<boolean>(count).fill(false);
  const faded = Array<boolean>(count).fill(false);
  const place = places.get(char);
  if (!place) return { highlights, pressed, faded };
  const lit = keyIndex(placement, place.key);
  if (lit !== null) highlights[lit] = true;
  for (const id of heldKeysFor(place, layout)) {
    const i = keyIndex(placement, id);
    if (i !== null) pressed[i] = true;
  }
  if (fadeOthers) {
    for (let i = 0; i < count; i++) faded[i] = !highlights[i] && !pressed[i];
  }
  return { highlights, pressed, faded };
}

/** The picture for several characters at once (a lesson's new keys): every one's key lit and the keys held for them
 * pressed; the rest faded when `fadeOthers` */
export function pictureForAll(
  chars: string[], places: Map<string, PlaceOf>, placement: Placement, layout: LayoutExport,
  { fadeOthers }: { fadeOthers: boolean },
): Picture {
  const count = placement.items.length;
  const highlights = Array<boolean>(count).fill(false);
  const pressed = Array<boolean>(count).fill(false);
  for (const char of chars) {
    const one = pictureFor(char, places, placement, layout, { fadeOthers: false });
    one.highlights.forEach((on, i) => (highlights[i] ||= on));
    one.pressed.forEach((on, i) => (pressed[i] ||= on));
  }
  const faded = highlights.map((on, i) => fadeOthers && !on && !pressed[i]);
  return { highlights, pressed, faded };
}

/** a key's legend on a layer: "Space", a letter in capitals, or the character; the layer-0 one when the layer has none;
 * the key id when the export has no such key */
function legendOf(layout: LayoutExport, id: string, layer: number): string {
  const key = exportKey(layout, id);
  const tap = key?.chars[String(layer)]?.tap ?? key?.chars["0"]?.tap;
  if (tap === undefined) return id;
  if (tap === " ") return "Space";
  return /^\p{L}$/u.test(tap) ? tap.toUpperCase() : tap;
}

/** The status line's name of the key to press: "S", "Space", "Shift + S", "hold Space → (", "tap OSL 3 → Shift + 1" */
export function nextKeyLabel(place: PlaceOf, layout: LayoutExport): string {
  const legend = legendOf(layout, place.key, place.layer);
  const modified = place.via === "shift" ? `Shift + ${legend}` : place.via === "altGr" ? `AltGr + ${legend}` : legend;
  if (place.layer === 0) return modified;
  const how = layout.layers.find((l) => l.index === place.layer)?.reachedBy[0]?.label ?? `layer ${place.layer}`;
  return `${how} → ${modified}`;
}
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd web && npx vitest run src/learning/picture.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  14 passed (14)`.

- [ ] **Step 5: Commit**

```bash
git add web/src/learning/picture.ts \
  web/src/learning/picture.test.ts
git commit -m "feat(web): the Learning keyboard-picture arrays" \
  -m "placeOfChars() finds where every taught character is (the space from the export); pictureFor() lights the next key, presses the other hand's Shift, the layer key or the AltGr key, and fades the rest; pictureForAll() unions a lesson's new keys; nextKeyLabel() names the key for the status line (\"Shift + S\", \"hold Space → (\")." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: A lesson's state, the remembered set, the finger colours

Three small modules the views share, and the colour tokens the Fingers view will use.

- **`learning/state.ts`** (design § 1's lesson rows; the pass and star rules of `lesson-format.md` § 4). `MAIN_KINDS` are the exercises that count towards passing (`new-keys`, `keys`, `words`, `blind`, `text`; the extras don't). `lessonStatus(lesson, progress, settings)` is a row's state: `done` (main exercises finished at least once: a record marked `done`, or one with a `best`), `of`, `passed` (every main exercise has a best at `passAccuracy` or above; **false with no main exercise**, so an empty lesson never shows as passed), `star` (passed, and every best at `targetWpm` or above), `bestAccuracy` and `bestWpm` (the **mean** of the bests over the main exercises that have one, one decimal; null with none; the design's "best across" the exercises read as the mean, which says how the whole lesson went). Exactly the threshold passes. `exerciseResult(attempt, settings)` is the same for one attempt (the result card). `nextExercise(set, lesson, exercise)` is the next in the lesson, else the first of the next lesson, else null (the **Next exercise** button). `outOfDate(set, exportHash)`: the set was built from another character map than the keyboard's export has now; false with no export to compare with (nothing to say). `DEFAULT_SETTINGS` are the design's 95 %, 30 WPM, picture in word exercises on.
- **`learning/storage.ts`**: the lesson set last chosen on the Learning page, remembered by this browser per keyboard uid (`vial.learningSet.<uid>`), the way `keymap/view.ts` remembers the view. The storage is passed in (`LearningStorage`, `getItem`/`setItem`), null when there is none; a storage that throws (a private window, quota) reads as none and `saveChosenSet` says false, so the choice lasts until the page is closed.
- **`learning/fingers.ts`** and **`app.css`**: the fingers in the order a hand's keys are listed (from the outside in, then the thumb), each finger's colour as a CSS token `var(--finger-<finger>)`, and `fingerLabel` ("left index"). The tokens go next to `--find` in `app.css`, in the light palette and in both dark blocks (the `[data-theme="dark"]` one and the `prefers-color-scheme` one): at least 3:1 against every key face and the board, apart from one another, and off the combo colours' hues where the wheel allows (orange, cyan, green, rose, slate). The design said "eight colours plus thumbs"; the prototype colours by finger, not by hand and finger, because the two hands are told apart by their side of the board, and five colours stay distinguishable where ten don't.

**Files:**
- Create: `web/src/learning/state.ts`, `web/src/learning/storage.ts`, `web/src/learning/fingers.ts`
- Test: `web/src/learning/state.test.ts`, `web/src/learning/storage.test.ts`, `web/src/learning/fingers.test.ts` (new)
- Modify: `web/src/app.css`

- [ ] **Step 1: The failing tests**

Create `web/src/learning/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import setJson from "../../../docs/learning/examples/corne-sim-en.json";
import { DEFAULT_SETTINGS, exerciseResult, isMain, lessonStatus, MAIN_KINDS, nextExercise, outOfDate } from "./state";
import { readLessonSet, type Attempt, type Progress } from "./types";

const set = readLessonSet(setJson);
const [lesson1, lesson2] = set.lessons;
const settings = { passAccuracy: 95, targetWpm: 30 };

const attempt = (accuracy: number, wpm: number): Attempt =>
  ({ at: "2026-10-22T07:40:12Z", chars: 228, errors: 3, accuracy, wpm, seconds: 88 });

/** progress with a best for each exercise id given */
function progress(bests: Record<string, [accuracy: number, wpm: number]>): Progress {
  const exercises: Progress["exercises"] = {};
  for (const [id, [accuracy, wpm]] of Object.entries(bests)) {
    exercises[id] = { done: true, best: attempt(accuracy, wpm), attempts: [attempt(accuracy, wpm)] };
  }
  return { format: "vial-web-progress/1", lessonSet: set.id, layoutHash: set.layout.hash, exercises };
}

describe("MAIN_KINDS", () => {
  it("are the ten exercises of a lesson, not the extras", () => {
    expect(MAIN_KINDS).toEqual(["new-keys", "keys", "words", "blind", "text"]);
    expect(isMain({ id: "x", kind: "extra-keys", title: "", lines: ["a"] })).toBe(false);
    expect(isMain({ id: "x", kind: "blind", title: "", lines: ["a"] })).toBe(true);
    expect(DEFAULT_SETTINGS).toEqual({ passAccuracy: 95, targetWpm: 30, pictureInWords: true });
  });
});

describe("lessonStatus", () => {
  it("is empty without progress", () => {
    expect(lessonStatus(lesson1, null, settings))
      .toEqual({ done: 0, of: 7, passed: false, star: false, bestAccuracy: null, bestWpm: null });
    expect(lessonStatus(lesson2, progress({}), settings).of).toBe(10);
  });

  it("counts the main exercises done, with the mean of their bests", () => {
    const status = lessonStatus(lesson1, progress({ "01-n1": [98.7, 31.2], "01-k1": [96.1, 25] }), settings);
    expect(status).toEqual({ done: 2, of: 7, passed: false, star: false, bestAccuracy: 97.4, bestWpm: 28.1 });
  });

  it("is passed when every main exercise reached the pass accuracy, and starred at the target WPM too", () => {
    const all = Object.fromEntries(lesson1.exercises.map((e) => [e.id, [97, 31] as [number, number]]));
    expect(lessonStatus(lesson1, progress(all), settings)).toMatchObject({ done: 7, passed: true, star: true });
    expect(lessonStatus(lesson1, progress({ ...all, "01-w1": [97, 29.9] }), settings))
      .toMatchObject({ passed: true, star: false });
    expect(lessonStatus(lesson1, progress({ ...all, "01-n2": [94.9, 40] }), settings))
      .toMatchObject({ done: 7, passed: false, star: false });
    // exactly the threshold passes; the settings decide
    expect(lessonStatus(lesson1, progress({ ...all, "01-n2": [95, 30] }), settings)).toMatchObject({ passed: true, star: true });
    expect(lessonStatus(lesson1, progress(all), { passAccuracy: 98, targetWpm: 30 })).toMatchObject({ passed: false });
  });

  it("leaves the extras out, and a finished exercise with no best counts as done", () => {
    const withExtra = { ...lesson1, exercises: [...lesson1.exercises,
      { id: "01-x1", kind: "extra-keys" as const, title: "Extra key exercise", lines: ["sa sa"] }] };
    const all = Object.fromEntries(lesson1.exercises.map((e) => [e.id, [97, 31] as [number, number]]));
    const p = progress({ ...all, "01-x1": [10, 1] });
    expect(lessonStatus(withExtra, p, settings)).toEqual({ done: 7, of: 7, passed: true, star: true, bestAccuracy: 97, bestWpm: 31 });
    const noBest = progress({});
    noBest.exercises["01-n1"] = { done: true, attempts: [] };
    expect(lessonStatus(lesson1, noBest, settings)).toMatchObject({ done: 1, passed: false, bestAccuracy: null });
  });

  it("isn't passed with nothing to pass", () => {
    expect(lessonStatus({ ...lesson1, exercises: [] }, progress({}), settings))
      .toEqual({ done: 0, of: 0, passed: false, star: false, bestAccuracy: null, bestWpm: null });
  });
});

describe("exerciseResult", () => {
  it("says whether one attempt passed, and earned a star", () => {
    expect(exerciseResult(attempt(98.7, 31.2), settings)).toEqual({ passed: true, star: true });
    expect(exerciseResult(attempt(95, 29.9), settings)).toEqual({ passed: true, star: false });
    expect(exerciseResult(attempt(94.9, 50), settings)).toEqual({ passed: false, star: false });
  });
});

describe("nextExercise", () => {
  it("is the next in the lesson, then the first of the next lesson, then nothing", () => {
    expect(nextExercise(set, "01", "01-n1")).toEqual({ lessonId: "01", exerciseId: "01-n2" });
    expect(nextExercise(set, "01", "01-w1")).toEqual({ lessonId: "02", exerciseId: "02-n1" });
    expect(nextExercise(set, "02", "02-t2")).toBeNull();
  });

  it("is nothing for a lesson or exercise the set doesn't have", () => {
    expect(nextExercise(set, "09", "01-n1")).toBeNull();
    expect(nextExercise(set, "01", "02-n1")).toBeNull();
  });
});

describe("outOfDate", () => {
  it("is when the set was built from another character map", () => {
    expect(outOfDate(set, "sha256:e435c3da038f9048")).toBe(false);
    expect(outOfDate(set, "sha256:0000000000000000")).toBe(true);
    // no export to compare with: nothing to say
    expect(outOfDate(set, null)).toBe(false);
  });
});
```

Create `web/src/learning/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chosenSetKey, readChosenSet, saveChosenSet, type LearningStorage } from "./storage";

function storage(initial: Record<string, string> = {}): LearningStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: LearningStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("readChosenSet", () => {
  it("is the set remembered for the keyboard, or none", () => {
    expect(chosenSetKey("5EEDC0DE00420042")).toBe("vial.learningSet.5EEDC0DE00420042");
    const s = storage({ "vial.learningSet.5EEDC0DE00420042": "corne-sim-en" });
    expect(readChosenSet(s, "5EEDC0DE00420042")).toBe("corne-sim-en");
    expect(readChosenSet(s, "0")).toBeNull();
    expect(readChosenSet(storage({ "vial.learningSet.0": "" }), "0")).toBeNull();
  });

  it("is none when the storage can't be read, or isn't there", () => {
    expect(readChosenSet(broken, "0")).toBeNull();
    expect(readChosenSet(null, "0")).toBeNull();
  });
});

describe("saveChosenSet", () => {
  it("remembers the set per keyboard", () => {
    const s = storage();
    expect(saveChosenSet(s, "A", "corne-sim-en")).toBe(true);
    expect(saveChosenSet(s, "B", "other")).toBe(true);
    expect(s.data).toEqual({ "vial.learningSet.A": "corne-sim-en", "vial.learningSet.B": "other" });
    expect(readChosenSet(s, "A")).toBe("corne-sim-en");
  });

  it("says so when the storage refuses, or isn't there", () => {
    expect(saveChosenSet(broken, "A", "x")).toBe(false);
    expect(saveChosenSet(null, "A", "x")).toBe(false);
  });
});
```

Create `web/src/learning/fingers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FINGER_COLOURS, FINGERS, fingerLabel } from "./fingers";

describe("FINGER_COLOURS", () => {
  it("is a colour token for each finger", () => {
    expect(FINGERS).toEqual(["pinky", "ring", "middle", "index", "thumb"]);
    for (const finger of FINGERS) expect(FINGER_COLOURS[finger]).toBe(`var(--finger-${finger})`);
  });
});

describe("fingerLabel", () => {
  it("names the finger with its hand", () => {
    expect(fingerLabel("index", "left")).toBe("left index");
    expect(fingerLabel("pinky", "right")).toBe("right pinky");
    expect(fingerLabel("thumb", "left")).toBe("left thumb");
  });
});
```

- [ ] **Step 2: Run them: they fail**

```bash
cd web && npx vitest run src/learning/state.test.ts src/learning/storage.test.ts src/learning/fingers.test.ts
```

Expected: `Error: Cannot find module './state'` and `Test Files  3 failed (3)`.

- [ ] **Step 3: The three modules and the colour tokens**

Create `web/src/learning/state.ts`:

```ts
// A lesson's state for the list rows (design § 1) and the pass and star rules (lesson-format.md § 4).
import type { Attempt, Exercise, ExerciseKind, LearningSettings, Lesson, LessonSet, Progress } from "./types";

/** the exercises that count towards passing a lesson: the extras don't */
export const MAIN_KINDS: readonly ExerciseKind[] = ["new-keys", "keys", "words", "blind", "text"];

export const DEFAULT_SETTINGS: LearningSettings = { passAccuracy: 95, targetWpm: 30, pictureInWords: true };

export type PassSettings = Pick<LearningSettings, "passAccuracy" | "targetWpm">;

export function isMain(exercise: Exercise): boolean {
  return MAIN_KINDS.includes(exercise.kind);
}

export interface LessonStatus {
  /** main exercises finished at least once */
  done: number;
  /** main exercises in all */
  of: number;
  /** every main exercise has a best at the pass accuracy or above */
  passed: boolean;
  /** passed, and every best at the target WPM or above */
  star: boolean;
  /** the mean of the bests' accuracy over the main exercises that have one, one decimal; null with none */
  bestAccuracy: number | null;
  bestWpm: number | null;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : tenths(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Whether one attempt passed, and earned a star */
export function exerciseResult(attempt: Pick<Attempt, "accuracy" | "wpm">, settings: PassSettings): { passed: boolean; star: boolean } {
  const passed = attempt.accuracy >= settings.passAccuracy;
  return { passed, star: passed && attempt.wpm >= settings.targetWpm };
}

/** A lesson's row in the list: how many of its main exercises are done, whether it is passed (with a star), and the
 * mean of their best results */
export function lessonStatus(lesson: Lesson, progress: Progress | null | undefined, settings: PassSettings): LessonStatus {
  const main = lesson.exercises.filter(isMain);
  const records = main.map((exercise) => progress?.exercises[exercise.id]);
  const bests = records.flatMap((record) => (record?.best ? [record.best] : []));
  const done = records.filter((record) => record?.done || record?.best).length;
  const results = bests.map((best) => exerciseResult(best, settings));
  const passed = main.length > 0 && bests.length === main.length && results.every((r) => r.passed);
  return {
    done, of: main.length, passed, star: passed && results.every((r) => r.star),
    bestAccuracy: mean(bests.map((b) => b.accuracy)), bestWpm: mean(bests.map((b) => b.wpm)),
  };
}

/** The exercise after one: the next in its lesson, else the first of the next lesson, else null */
export function nextExercise(set: LessonSet, lessonId: string, exerciseId: string): { lessonId: string; exerciseId: string } | null {
  const l = set.lessons.findIndex((lesson) => lesson.id === lessonId);
  if (l === -1) return null;
  const lesson = set.lessons[l];
  const e = lesson.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (e === -1) return null;
  const after = lesson.exercises[e + 1];
  if (after) return { lessonId, exerciseId: after.id };
  const next = set.lessons[l + 1];
  const first = next?.exercises[0];
  return next && first ? { lessonId: next.id, exerciseId: first.id } : null;
}

/** Whether the set was built from another character map than the keyboard's export has now; false with no export */
export function outOfDate(set: LessonSet, exportHash: string | null | undefined): boolean {
  return !!exportHash && set.layout.hash !== exportHash;
}
```

Create `web/src/learning/storage.ts`:

```ts
// The lesson set last chosen on the Learning page, remembered by this browser per keyboard (like keymap/view.ts).
export type LearningStorage = Pick<Storage, "getItem" | "setItem">;

/** the storage key of a keyboard's chosen set */
export function chosenSetKey(uid: string): string {
  return `vial.learningSet.${uid}`;
}

/** The set id remembered for the keyboard; null if there is none, or the storage can't be read (private window) */
export function readChosenSet(storage: LearningStorage | null, uid: string): string | null {
  try {
    return storage?.getItem(chosenSetKey(uid)) || null;
  } catch {
    return null;
  }
}

/** Remember the set chosen for the keyboard; false if the storage refuses (it then lasts until the page is closed) */
export function saveChosenSet(storage: LearningStorage | null, uid: string, id: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(chosenSetKey(uid), id);
    return true;
  } catch {
    return false;
  }
}
```

Create `web/src/learning/fingers.ts`:

```ts
// The fingers as the Fingers view and the lesson guidance name and colour them (the tokens are in app.css).
import type { Finger, Hand } from "./types";

/** from the outside in, then the thumb: the order a hand's keys are listed */
export const FINGERS: readonly Finger[] = ["pinky", "ring", "middle", "index", "thumb"];

/** each finger's colour on the keyboard picture, as a CSS value */
export const FINGER_COLOURS: Record<Finger, string> = {
  index: "var(--finger-index)",
  middle: "var(--finger-middle)",
  ring: "var(--finger-ring)",
  pinky: "var(--finger-pinky)",
  thumb: "var(--finger-thumb)",
};

/** "left index", "right thumb" */
export function fingerLabel(finger: Finger, hand: Hand): string {
  return `${hand} ${finger}`;
}
```

Apply to `web/src/app.css`:

```diff
diff --git a/web/src/app.css b/web/src/app.css
--- a/web/src/app.css
+++ b/web/src/app.css
@@ -101,6 +101,14 @@
   --combo-5: #7b3fe4;
   /* keys that produce what the find box looks for: a dark amber, at least 3:1 against every key face and the board */
   --find: #9e6c00;
+  /* the finger each key belongs to, on the Learning page's Fingers view (learning/fingers.ts FINGER_COLOURS): at
+     least 3:1 against every key face and the board, apart from one another, and off the combo colours' hues where the
+     wheel allows. In order: orange, cyan, green, rose, slate */
+  --finger-index: #c25400;
+  --finger-middle: #0077a8;
+  --finger-ring: #2e7d32;
+  --finger-pinky: #c2185b;
+  --finger-thumb: #5b6478;
   /* how much of a kind's colour goes into a key's face and outline */
   --tone-fill: 15%;
   --tone-line: 62%;
@@ -168,6 +176,11 @@
   --combo-4: #a3d65a;
   --combo-5: #b69bff;
   --find: #ffcc33;
+  --finger-index: #ff9a4d;
+  --finger-middle: #4fc3f7;
+  --finger-ring: #6fcf6f;
+  --finger-pinky: #ff80b0;
+  --finger-thumb: #aab4c8;
   --tone-fill: 22%;
   --tone-line: 70%;
   --tone-text: 80%;
@@ -215,6 +228,11 @@
     --combo-4: #a3d65a;
     --combo-5: #b69bff;
     --find: #ffcc33;
+    --finger-index: #ff9a4d;
+    --finger-middle: #4fc3f7;
+    --finger-ring: #6fcf6f;
+    --finger-pinky: #ff80b0;
+    --finger-thumb: #aab4c8;
     --tone-fill: 22%;
     --tone-line: 70%;
     --tone-text: 80%;
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd web && npx vitest run src/learning/state.test.ts src/learning/storage.test.ts src/learning/fingers.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  16 passed (16)`.

- [ ] **Step 5: Type-check and every unit test (`app.css` is shared)**

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  59 passed (59)` and `Tests  925 passed (925)`.

- [ ] **Step 6: Commit**

```bash
git add web/src/learning/state.ts \
  web/src/learning/state.test.ts \
  web/src/learning/storage.ts \
  web/src/learning/storage.test.ts \
  web/src/learning/fingers.ts \
  web/src/learning/fingers.test.ts \
  web/src/app.css
git commit -m "feat(web): Learning lesson state, the remembered set, finger colours" \
  -m "state.ts: lessonStatus() for the list rows (done of main, passed, star, mean bests), exerciseResult(), nextExercise(), outOfDate(). storage.ts remembers the chosen set per keyboard uid. fingers.ts and app.css give each finger a colour token in both palettes (at least 3:1 on every key face and the board)." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: The page's texts, and the API client's `/api/learning` routes

The last of the pure web modules, and the client side of the routes Task 4 added to the server. **Task 4 regenerated the API types (`web/src/api/schema.d.ts`); `npm run check` fails before it**, because `api/types.ts` below names the Learning schemas and `api/api.ts` the `/api/learning/…` paths.

- **`learning/format.ts`**: the Learning page's texts in one place, so the views and the e2e tests agree on them: a lesson row's state (`"★ passed · 98 % · 34 wpm"`, `"passed · 96 % · 28 wpm"`, `"3 of 10 done"`, or `""` before anything was typed; whole percents for a row), an exercise's best (`"99.1 % · 31 wpm"`, `"—"` with none), the status line while typing (`"23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48"`, "errors" in the plural but for 1), `clockText` (`"0:48"`, `"12:05"`), the result card's four lines and `passText` (`"Passed"`, `"Not passed (needs ≥ 95 %)"`), `listedErrors` (the checker's findings on a refused import: at most ten, then `"and n more"`), and `exportFileName` (`"<keyboard name>-layout-export.json"` without the characters file systems refuse, at most 100 characters of name, `"keyboard"` when nothing is left).
- **The API client**: `Method` gains `delete` (the fingers reset and the set removal); `Reply` knows 201, which `POST /api/learning/sets` answers for a set made (the other routes answer 200 or 204); `ApiError` carries the server's `errors` list, the checker's findings one by one on a 422, read from the body by `errorsOf` (strings only, anything else ignored). `api.ts` adds the routes: the fingers (`learningFingers`, `setLearningFingers`, `resetLearningFingers`), the export, the sets (`learningSets`, `importLearningSet` — the raw JSON text as the body, through `request`'s existing `raw` option, so the server checks the document as the file holds it —, `learningSet`, `deleteLearningSet`), the progress (`learningProgress`, `recordAttempt`), the settings. `api/types.ts` names the schemas (`Fingers`, `FingersIn`, `LessonSetSummary`, `AttemptIn`, `LearningSettingsIn`, …); the lesson set and the layout export come as the server read them from their files, and `learning/types.ts` says their shape.

The format module imports the `Progress` and `Result` types of the engine (Task 6) and `LessonStatus` of the state (Task 8); nothing in this task references the page components of the next task, so the type-check passes here.

**Files:**
- Create: `web/src/learning/format.ts`
- Test: `web/src/learning/format.test.ts` (new)
- Modify: `web/src/api/client.ts`, `web/src/api/errors.ts`, `web/src/api/api.ts`, `web/src/api/types.ts`

- [ ] **Step 1: The failing tests**

Create `web/src/learning/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bestText, clockText, exportFileName, lessonStateText, listedErrors, passText, resultLines, statusText,
} from "./format";
import type { LessonStatus } from "./state";

const status = (over: Partial<LessonStatus>): LessonStatus =>
  ({ done: 0, of: 7, passed: false, star: false, bestAccuracy: null, bestWpm: null, ...over });

describe("lessonStateText", () => {
  it("says passed with a star, passed, how many are done, or nothing", () => {
    expect(lessonStateText(status({ done: 7, passed: true, star: true, bestAccuracy: 98.4, bestWpm: 34.2 })))
      .toBe("★ passed · 98 % · 34 wpm");
    expect(lessonStateText(status({ done: 7, passed: true, bestAccuracy: 96, bestWpm: 27.5 }))).toBe("passed · 96 % · 28 wpm");
    expect(lessonStateText(status({ done: 3, of: 10 }))).toBe("3 of 10 done");
    expect(lessonStateText(status({}))).toBe("");
  });
});

describe("bestText and statusText", () => {
  it("show one decimal of accuracy and whole words per minute", () => {
    expect(bestText({ accuracy: 99.1, wpm: 31.4 })).toBe("99.1 % · 31 wpm");
    expect(bestText(null)).toBe("—");
    expect(statusText({ typed: 23, of: 312, errors: 1, accuracy: 99.1, wpm: 31.2, seconds: 48 }))
      .toBe("23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48");
    expect(statusText({ typed: 0, of: 312, errors: 0, accuracy: 100, wpm: 0, seconds: 0 }))
      .toBe("0 of 312 · 0 errors · 100.0 % · 0 wpm · 0:00");
  });
});

describe("clockText", () => {
  it("is minutes and two digits of seconds", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(65)).toBe("1:05");
    expect(clockText(725)).toBe("12:05");
  });
});

describe("the result card", () => {
  it("lists accuracy, speed, time and errors, and says whether it passed", () => {
    expect(resultLines({ chars: 228, errors: 3, accuracy: 98.7, wpm: 31.2, seconds: 88 })).toEqual([
      { label: "Accuracy", value: "98.7 %" }, { label: "Speed", value: "31.2 wpm" }, { label: "Time", value: "1:28" },
      { label: "Errors", value: "3" },
    ]);
    expect(passText(true, 95)).toBe("Passed");
    expect(passText(false, 95)).toBe("Not passed (needs ≥ 95 %)");
  });
});

describe("listedErrors", () => {
  it("shows at most ten, then how many more", () => {
    const errors = Array.from({ length: 13 }, (_, i) => `error ${i + 1}`);
    expect(listedErrors(errors.slice(0, 10))).toHaveLength(10);
    const listed = listedErrors(errors);
    expect(listed).toHaveLength(11);
    expect(listed[10]).toBe("and 3 more");
  });
});

describe("exportFileName", () => {
  it("names the download after the keyboard, without characters file systems refuse", () => {
    expect(exportFileName("Simulated Corne")).toBe("Simulated Corne-layout-export.json");
    expect(exportFileName("W-CORNE: v2/3")).toBe("W-CORNE_ v2_3-layout-export.json");
    expect(exportFileName("")).toBe("keyboard-layout-export.json");
  });
});
```

- [ ] **Step 2: Run it: it fails**

```bash
cd web && npx vitest run src/learning/format.test.ts
```

Expected: `Error: Cannot find module './format'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The texts**

Create `web/src/learning/format.ts`:

```ts
// The Learning page's texts: a lesson row's state, an exercise's best, the status line while typing, the result card.
import type { Progress as TypingProgress, Result } from "./engine";
import type { LessonStatus } from "./state";
import type { Attempt } from "./types";

/** "0:48", "12:05" */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "98 %" (whole percents, for a lesson row) */
function percent(value: number): string {
  return `${Math.round(value)} %`;
}

/** "99.1 %" (one decimal, for one attempt) */
function percentTenths(value: number): string {
  return `${value.toFixed(1)} %`;
}

/** A lesson row's state: "★ passed · 98 % · 34 wpm", "passed · 96 % · 27 wpm", "3 of 10 done", or "" before anything
 * was typed */
export function lessonStateText(status: LessonStatus): string {
  if (status.passed) {
    const numbers = `${percent(status.bestAccuracy ?? 0)} · ${Math.round(status.bestWpm ?? 0)} wpm`;
    return `${status.star ? "★ " : ""}passed · ${numbers}`;
  }
  return status.done > 0 ? `${status.done} of ${status.of} done` : "";
}

/** An exercise's best: "99.1 % · 31 wpm", or "—" with none */
export function bestText(best: Pick<Attempt, "accuracy" | "wpm"> | null | undefined): string {
  return best ? `${percentTenths(best.accuracy)} · ${best.wpm.toFixed(0)} wpm` : "—";
}

/** The status line while typing: "23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48" */
export function statusText(progress: TypingProgress): string {
  const errors = `${progress.errors} ${progress.errors === 1 ? "error" : "errors"}`;
  return [`${progress.typed} of ${progress.of}`, errors, percentTenths(progress.accuracy), `${progress.wpm.toFixed(0)} wpm`,
    clockText(progress.seconds)].join(" · ");
}

/** The result card's lines: accuracy, speed, time, errors */
export function resultLines(result: Result): { label: string; value: string }[] {
  return [
    { label: "Accuracy", value: percentTenths(result.accuracy) },
    { label: "Speed", value: `${result.wpm.toFixed(1)} wpm` },
    { label: "Time", value: clockText(result.seconds) },
    { label: "Errors", value: String(result.errors) },
  ];
}

/** "Passed" or "Not passed (needs ≥ 95 %)" */
export function passText(passed: boolean, passAccuracy: number): string {
  return passed ? "Passed" : `Not passed (needs ≥ ${passAccuracy} %)`;
}

/** The checker's findings as the import shows them: at most `max` lines, then "and n more" */
export function listedErrors(errors: string[], max = 10): string[] {
  if (errors.length <= max) return errors;
  const more = errors.length - max;
  return [...errors.slice(0, max), `and ${more} more`];
}

/** "Simulated Corne-layout-export.json": the keyboard's name without the characters file systems refuse */
export function exportFileName(keyboardName: string): string {
  const name = keyboardName.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[\s._]+|[\s._]+$/g, "");
  return `${name.slice(0, 100) || "keyboard"}-layout-export.json`;
}
```

- [ ] **Step 4: Run the tests: they pass**

```bash
cd web && npx vitest run src/learning/format.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

- [ ] **Step 5: The API client: DELETE, 201, the errors list, the `/api/learning` routes**

Apply to `web/src/api/client.ts`:

```diff
diff --git a/web/src/api/client.ts b/web/src/api/client.ts
--- a/web/src/api/client.ts
+++ b/web/src/api/client.ts
@@ -2,11 +2,12 @@
 import { ApiError } from "./errors";
 import type { paths } from "./schema";
 
-type Method = "get" | "put" | "post";
+type Method = "get" | "put" | "post" | "delete";
 type Operation<P extends keyof paths, M extends Method> = paths[P][M];
 type Json<T> = T extends { content: { "application/json": infer R } } ? R : never;
-/** the reply's JSON; null for a route that answers nothing (204) */
+/** the reply's JSON (200, or 201 for a route that makes something); null for a route that answers nothing (204) */
 type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R>
+  : Op extends { responses: { 201: infer R } } ? Json<R>
   : Op extends { responses: { 204: unknown } } ? null : never;
 type Body<Op> = Op extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;
 type PathParams<Op> = Op extends { parameters: { path: infer P } } ? P : undefined;
@@ -48,6 +49,12 @@ function codeOf(body: unknown): string | undefined {
   return typeof code === "string" ? code : undefined;
 }
 
+/** The refusal's findings, one by one, when the server lists them (a lesson set the checker refuses) */
+function errorsOf(body: unknown): string[] | undefined {
+  const errors = (body as { errors?: unknown } | null)?.errors;
+  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : undefined;
+}
+
 export async function request<P extends keyof paths, M extends Method>(
   method: M,
   path: P,
@@ -68,7 +75,7 @@ export async function request<P extends keyof paths, M extends Method>(
     body,
   });
   const reply: unknown = await response.json().catch(() => null);
-  if (!response.ok) throw new ApiError(response.status, detailOf(reply), codeOf(reply));
+  if (!response.ok) throw new ApiError(response.status, detailOf(reply), codeOf(reply), errorsOf(reply));
   return reply as Reply<Operation<P, M>>;
 }
 
```

Apply to `web/src/api/errors.ts`:

```diff
diff --git a/web/src/api/errors.ts b/web/src/api/errors.ts
--- a/web/src/api/errors.ts
+++ b/web/src/api/errors.ts
@@ -6,13 +6,16 @@ export class ApiError extends Error {
   readonly detail: string | undefined;
   /** what the server calls this refusal, to tell it from others of its status: "layoutChanged" (409) */
   readonly code: string | undefined;
+  /** the refusal's findings one by one, when the server lists them (a lesson set the checker refuses, 422) */
+  readonly errors: string[] | undefined;
 
-  constructor(status: number, detail?: string, code?: string) {
+  constructor(status: number, detail?: string, code?: string, errors?: string[]) {
     super(errorMessage(status, detail));
     this.name = "ApiError";
     this.status = status;
     this.detail = detail;
     this.code = code;
+    this.errors = errors;
   }
 }
 
```

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -1,6 +1,9 @@
 // The server's routes the UI uses.
 import { download, request } from "./client";
-import type { AltRepeatKeyIn, ComboIn, KeyOverrideIn, LightingIn, MacroActionIn, Named, TapDanceIn } from "./types";
+import type {
+  AltRepeatKeyIn, AttemptIn, ComboIn, FingersIn, KeyOverrideIn, LearningSettingsIn, LightingIn, MacroActionIn, Named,
+  TapDanceIn,
+} from "./types";
 
 export const api = {
   session: () => request("get", "/api/session"),
@@ -57,6 +60,28 @@ export const api = {
   putBackArrange: () => request("post", "/api/layers/arrange/put-back"),
   setName: (kind: Named["kind"], index: number, name: string) =>
     request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
+  // Learning (docs/learning/lesson-format.md): the app's files for this keyboard, nothing on the keyboard
+  /** which finger types each key: the app's proposal with the user's corrections on top */
+  learningFingers: () => request("get", "/api/learning/fingers"),
+  /** saves the corrections (all of them: it replaces what was saved); answers as learningFingers does */
+  setLearningFingers: (body: FingersIn) => request("put", "/api/learning/fingers", { body }),
+  /** forgets the corrections: back to the proposal */
+  resetLearningFingers: () => request("delete", "/api/learning/fingers"),
+  /** the layout export for the lesson generator, in the keyboard language shown */
+  learningExport: () => request("get", "/api/learning/export"),
+  /** the lesson sets of this keyboard, each with whether it is out of date */
+  learningSets: () => request("get", "/api/learning/sets"),
+  /** a lesson set file, checked and saved (201); 422 lists what is wrong with it (ApiError.errors) */
+  importLearningSet: (text: string) => request("post", "/api/learning/sets", { raw: text }),
+  learningSet: (set: string) => request("get", "/api/learning/sets/{set}", { params: { set } }),
+  /** removes the set; its progress stays */
+  deleteLearningSet: (set: string) => request("delete", "/api/learning/sets/{set}", { params: { set } }),
+  learningProgress: (set: string) => request("get", "/api/learning/progress/{set}", { params: { set } }),
+  /** an exercise typed to the end; the server computes accuracy and WPM and keeps the best */
+  recordAttempt: (set: string, exercise: string, body: AttemptIn) =>
+    request("put", "/api/learning/progress/{set}/{exercise}", { params: { set, exercise }, body }),
+  learningSettings: () => request("get", "/api/learning/settings"),
+  setLearningSettings: (body: LearningSettingsIn) => request("put", "/api/learning/settings", { body }),
   unlockStart: () => request("post", "/api/unlock/start"),
   unlockCancel: () => request("post", "/api/unlock/cancel"),
   lock: () => request("post", "/api/lock"),
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -52,3 +52,18 @@ export type RgbLight = Schemas["RgbLight"];
 export type Backlight = Schemas["Backlight"];
 /** what /api/events sends */
 export type ServerEvent = Schemas["Event"];
+// the Learning feature's (docs/learning/lesson-format.md); the lesson set and the layout export come as the server
+// read them from their files, and learning/types.ts says their shape (readLessonSet, LayoutExport)
+export type Fingers = Schemas["Fingers"];
+export type FingerKey = Schemas["FingerKey"];
+export type FingersIn = Schemas["FingersIn"];
+export type LayoutExportReply = Schemas["LayoutExport"];
+export type LessonSetSummary = Schemas["LessonSetSummary"];
+export type LessonSetImported = Schemas["LessonSetImported"];
+export type LessonSetReply = Schemas["LessonSet"];
+export type Attempt = Schemas["Attempt"];
+export type AttemptIn = Schemas["AttemptIn"];
+export type ExerciseProgress = Schemas["ExerciseProgress"];
+export type Progress = Schemas["Progress"];
+export type LearningSettings = Schemas["LearningSettings"];
+export type LearningSettingsIn = Schemas["LearningSettingsIn"];
```

- [ ] **Step 6: Type-check, every unit test, and the generated API types still up to date**

```bash
cd web && npm run check && npm test && npm run check:api
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  60 passed (60)` and `Tests  931 passed (931)` and `src/api/schema.d.ts is up to date`. These are the prototype's final Vitest numbers: the pages task adds no unit test file (every Learning test file is in Tasks 5–9), so from here on `npm test` stays at 60 files and 931 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/learning/format.ts \
  web/src/learning/format.test.ts \
  web/src/api/client.ts \
  web/src/api/errors.ts \
  web/src/api/api.ts \
  web/src/api/types.ts
git commit -m "feat(web): the Learning page's texts, and the API client's /api/learning routes" \
  -m "format.ts: a lesson row's state, an exercise's best, the status line, the result card, the listed checker errors, the export's file name. The API client learns the /api/learning routes (201 replies, DELETE, the checker's errors list on a 422)." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: The Learning store, the lesson list and its settings dialog

Three words the web code uses from here on. A **lesson set** is a JSON file of lessons and exercises that the `generate-lessons` skill writes for one layout (`docs/learning/lesson-format.md`, section 3); the server keeps it in `learning/<uid>/sets/`, with the user's results in a progress file beside it. The **export** is the server's description of the layout (`learning/<uid>/layout-export.json`, section 2): which character each key types on each layer, with what held, and which finger reaches it; its `hash` is what a set was built for, so a set whose hash differs from the export's is "out of date". A **resting key** is the key a finger rests on (the home position); the server proposes the fingers and the resting keys from the key positions, and the Fingers view (Task 12) corrects them.

This task is the page's foundation, without a view in the app yet: the store, the lesson list with its two dialogs, and the card the keyboard picture sits on. The four web tasks are ordered by their imports, so that `npm run check` and `npm run build` are green at the end of each: the store and `LessonList` import only Task 9's modules and the UI library; `LessonView` and `TypingView` (Task 11) import those and `Board`; `FingersView` does too (Task 12); `LearningPage` imports all four views, and `App.svelte` imports `LearningPage`, so the page, the `App.svelte` diff and the e2e navigation line are the end of Task 12. Until then the new files compile (svelte-check reads every file under `src/`) but the build doesn't bundle them, and nothing shows in the app.

- `learning.svelte.ts`: `LearningState`, a class of runes with one instance, `learning`: the sets the keyboard has (as the server lists them, a file that isn't a lesson set with its `error`), the set `chosen` and the same set `open` whole with its `progress`, the `settings`, the `export`, the `fingers` (read when the Fingers view opens), and the flags `loading`/`loaded`/`opening`/`error`. `places` derives where every character the set teaches is (`placeOfChars`, Task 9). Decisions: the store is per keyboard *and keyboard language* (`follow(uid, language)` starts over for another one: the export's characters are the language's); every read is numbered (`#reads`) so a stale answer is dropped; the set chosen is remembered per keyboard in the browser's storage (`storage.ts`, Task 9), and when none is remembered or it can't be read, the first readable set opens; `importSet` returns the checker's `errors` on a 422 (`ApiError.errors`, Task 9) so the list can show them, any other failure is a toast; `deleteSet` leaves the progress on the server (the set imported again finds it); `recordAttempt` puts the server's record (best and attempts) in the progress; `saveFingers` reads the sets and the export again, so what is out of date follows. Nothing here reads or writes the keyboard: it is all the server's files.
- `LessonList.svelte`: the design's "Lesson list" mockup (section 1): the header with **Fingers…** and the gear, the set selector, **Import…** (a hidden file input) and **Remove** (a `ConfirmDialog`), the findings box, the out-of-date banner, the empty state that names the skill, and a row per lesson with `lessonStateText` (Task 9). Departures from the mockup: Import… and Remove sit by the selector, not in the header; the banner says "Built for another layout." without a count of moved characters (the hash is all the app compares, `outOfDate`); a file the server can't read is listed with " — error" and disabled in the selector (the `SelectField` change below), and its error shows under the selector when it is the one chosen; the 4 MiB guard (`app.MAX_LESSON_SET`) is checked before the upload too. A set file imported with warnings shows them; a file refused shows "wasn't imported:" and the checker's lines. The `note` prop is what `LearningPage` has to say about an address that led nowhere (Task 12). Focus: after Remove, the selector; after the settings dialog, the gear.
- `SettingsDialog.svelte`: the gear's dialog, a native `<dialog>` opened with `showModal`: pass accuracy, target speed, "Show the picture in word exercises". The fields are read from the saved settings each time it opens; the server's limits (`LearningSettingsIn`: 50–100 %, 1–300 wpm, whole numbers) are checked before the request with a sentence under the fields; Escape and cancel are blocked while saving; `onsave` resolves to whether the settings were saved and the dialog closes only then (a failure is the store's toast); `onclose` lets the list give the focus back to the gear.
- `Board.svelte`: the card the keyboard picture sits on, as the Matrix tester draws it (border, radius, `--board-bg`), with one column no wider than the page.
- `SelectField.svelte`: a choice can be `disabled` (listed, not to be chosen).
- `e2e/fixtures.ts`: `api(page).delete`, for Task 13's spec (it removes the set and the fingers after each test); one line, given here with the client code.

**Files:**
- Create: `web/src/learning/learning.svelte.ts`
- Create: `web/src/learning/Board.svelte`
- Create: `web/src/learning/SettingsDialog.svelte`
- Create: `web/src/learning/LessonList.svelte`
- Modify: `web/src/ui/SelectField.svelte`
- Modify: `web/e2e/fixtures.ts`

- [ ] **Step 1: The store**

Create `web/src/learning/learning.svelte.ts`:

```ts
// What the Learning page shows, kept while another page shows: the lesson sets of the keyboard, the set chosen (open,
// with its progress), the settings, the layout export (for where each character is, and whether a set is out of
// date), and the fingers while the Fingers view is open. All of it is the server's files for this keyboard
// (docs/learning/lesson-format.md); nothing is read from or written to the keyboard. Loaded when the page first
// shows, and again for another keyboard or another keyboard language (the export's characters are the language's).
import { api } from "../api/api";
import { ApiError, failureMessage } from "../api/errors";
import type { Fingers, FingersIn, LearningSettingsIn, LessonSetSummary } from "../api/types";
import { browserStorage } from "../lib/theme";
import { toasts } from "../lib/toasts.svelte";
import { placeOfChars, type PlaceOf } from "./picture";
import { DEFAULT_SETTINGS } from "./state";
import { readChosenSet, saveChosenSet } from "./storage";
import { readLessonSet, type LayoutExport, type LearningSettings, type LessonSet, type Progress } from "./types";

/** what an import came to: the set's listing entry, or the checker's findings */
export type ImportOutcome = { ok: true; entry: LessonSetSummary; warnings: string[] } | { ok: false; errors: string[] };

export class LearningState {
  /** the sets the keyboard has, as the server lists them (a file that isn't a lesson set with its error) */
  sets = $state.raw<LessonSetSummary[]>([]);
  /** the set chosen in the selector: open below once read */
  chosen = $state<string | null>(null);
  /** the set open, whole; null while none is chosen, or the chosen one can't be read (its listing entry says why) */
  set = $state.raw<LessonSet | null>(null);
  progress = $state.raw<Progress | null>(null);
  settings = $state.raw<LearningSettings>(DEFAULT_SETTINGS);
  export = $state.raw<LayoutExport | null>(null);
  /** the fingers, read when the Fingers view opens */
  fingers = $state.raw<Fingers | null>(null);
  /** the sets, settings and export are being read */
  loading = $state(false);
  /** they were read for this keyboard (or the read failed: `error` says why) */
  loaded = $state(false);
  /** the set chosen is being read */
  opening = $state(false);
  /** why the last read failed, for the page's banner */
  error = $state<string | null>(null);
  /** where every character the set teaches is, from the set's `new` entries and the export's space */
  places = $derived<Map<string, PlaceOf>>(this.set && this.export ? placeOfChars(this.set, this.export) : new Map());
  /** the keyboard (uid) and language this is for */
  #key: string | null = null;
  #uid: string | null = null;
  /** reads under way, so a stale one's answer is dropped */
  #reads = 0;

  /** Start over when the keyboard, or the keyboard language, isn't the one shown before */
  follow(uid: string, language: string): void {
    const key = `${uid}\n${language}`;
    if (this.#key === key) return;
    this.#key = key;
    this.#uid = uid;
    this.#reads++;
    this.sets = [];
    this.chosen = readChosenSet(browserStorage(), uid);
    this.set = null;
    this.progress = null;
    this.settings = DEFAULT_SETTINGS;
    this.export = null;
    this.fingers = null;
    this.loading = false;
    this.loaded = false;
    this.opening = false;
    this.error = null;
  }

  /** Reads the sets, the settings and the export, then opens the set chosen (or the first that can be read) */
  async load(): Promise<void> {
    if (this.loading) return;
    const read = ++this.#reads;
    this.loading = true;
    this.error = null;
    try {
      const [sets, settings, layout] = await Promise.all([api.learningSets(), api.learningSettings(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.sets = sets;
      this.settings = settings;
      this.export = layout as unknown as LayoutExport;
      this.loaded = true;
      const readable = (id: string | null) => id !== null && sets.some((s) => s.id === id && !s.error);
      const chosen = readable(this.chosen) ? this.chosen : (sets.find((s) => !s.error)?.id ?? null);
      await this.open(chosen);
    } catch (error) {
      if (read !== this.#reads) return;
      this.error = failureMessage("Reading the lessons", error);
      this.loaded = true;
    } finally {
      if (read === this.#reads) this.loading = false;
    }
  }

  /** Reads the sets and the export again (after Fingers changes: the export, and so what is out of date) */
  async refresh(): Promise<void> {
    const read = this.#reads;
    try {
      const [sets, layout] = await Promise.all([api.learningSets(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.sets = sets;
      this.export = layout as unknown as LayoutExport;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Reading the lessons", error));
    }
  }

  /** Opens a set: reads it whole with its progress; null closes the one open. Remembered for the keyboard. */
  async open(id: string | null): Promise<void> {
    const read = this.#reads;
    this.chosen = id;
    if (id !== null && this.#uid !== null) saveChosenSet(browserStorage(), this.#uid, id);
    if (id === null || this.sets.find((s) => s.id === id)?.error) {
      this.set = null;
      this.progress = null;
      return;
    }
    this.opening = true;
    try {
      const [set, progress] = await Promise.all([api.learningSet(id), api.learningProgress(id)]);
      if (read !== this.#reads || this.chosen !== id) return;
      this.set = readLessonSet(set);
      this.progress = progress as Progress;
    } catch (error) {
      if (read !== this.#reads || this.chosen !== id) return;
      this.set = null;
      this.progress = null;
      toasts.error(failureMessage(`Opening the lesson set ${id}`, error));
    } finally {
      if (read === this.#reads && this.chosen === id) this.opening = false;
    }
  }

  /** Imports a lesson set file (its text): checked and saved by the server, listed, and opened. The checker's
   * findings come back instead when it refuses the file; any other failure is a toast. */
  async importSet(text: string): Promise<ImportOutcome | null> {
    const read = this.#reads;
    try {
      const entry = await api.importLearningSet(text);
      if (read !== this.#reads) return null;
      this.sets = [...this.sets.filter((s) => s.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
      await this.open(entry.id);
      return { ok: true, entry, warnings: entry.warnings };
    } catch (error) {
      if (read !== this.#reads) return null;
      if (error instanceof ApiError && error.status === 422) {
        return { ok: false, errors: error.errors?.length ? error.errors : [error.detail ?? "the file isn't a lesson set"] };
      }
      toasts.error(failureMessage("Importing the lesson set", error));
      return null;
    }
  }

  /** Removes a set (its progress stays); the next readable set is opened */
  async deleteSet(id: string): Promise<boolean> {
    const read = this.#reads;
    try {
      await api.deleteLearningSet(id);
      if (read !== this.#reads) return true;
      this.sets = this.sets.filter((s) => s.id !== id);
      if (this.chosen === id) await this.open(this.sets.find((s) => !s.error)?.id ?? null);
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Removing the lesson set", error));
      return false;
    }
  }

  /** Records an exercise typed to the end; the server's best and attempts take the exercise's place in the progress */
  async recordAttempt(exercise: string, body: { at: string; chars: number; errors: number; seconds: number }): Promise<boolean> {
    const read = this.#reads;
    const set = this.chosen;
    if (set === null) return false;
    try {
      const record = await api.recordAttempt(set, exercise, body);
      if (read !== this.#reads || this.chosen !== set) return true;
      const progress = this.progress ?? { format: "vial-web-progress/1", lessonSet: set, layoutHash: "", exercises: {} };
      this.progress = { ...progress, exercises: { ...progress.exercises, [exercise]: record as Progress["exercises"][string] } };
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Saving the result", error));
      return false;
    }
  }

  async saveSettings(body: LearningSettingsIn): Promise<boolean> {
    const read = this.#reads;
    try {
      const settings = await api.setLearningSettings(body);
      if (read === this.#reads) this.settings = settings;
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Saving the settings", error));
      return false;
    }
  }

  /** Reads the fingers for the Fingers view; false (with a toast) when that fails */
  async loadFingers(): Promise<boolean> {
    const read = this.#reads;
    try {
      const fingers = await api.learningFingers();
      if (read === this.#reads) this.fingers = fingers;
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Reading the fingers", error));
      return false;
    }
  }

  /** Saves the fingers as they are now (every key, and the resting keys), or puts the proposal back (null); the
   * export follows, and so which sets are out of date */
  async saveFingers(body: FingersIn | null): Promise<boolean> {
    const read = this.#reads;
    try {
      const fingers = body === null ? await api.resetLearningFingers() : await api.setLearningFingers(body);
      if (read !== this.#reads) return true;
      this.fingers = fingers;
      void this.refresh();
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage(body === null ? "Resetting the fingers" : "Saving the fingers", error));
      return false;
    }
  }
}

export const learning = new LearningState();
```

- [ ] **Step 2: The board card and the settings dialog**

Create `web/src/learning/Board.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<!-- the card the keyboard picture sits on, as the Matrix tester draws it -->
<div class="board">
  {@render children()}
</div>

<style>
  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
    padding: 16px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }
</style>
```

Create `web/src/learning/SettingsDialog.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import type { LearningSettings } from "./types";

  interface Props {
    open: boolean;
    settings: LearningSettings;
    /** resolves to whether they were saved: the dialog then closes, or stays open (a toast says why) */
    onsave: (settings: LearningSettings) => Promise<boolean>;
    /** closed, saved or not: the caller gives the focus back to the gear */
    onclose: () => void;
  }

  let { open, settings, onsave, onclose }: Props = $props();

  /** the server's limits (schemas.LearningSettingsIn) */
  const ACCURACY = { min: 50, max: 100 };
  const WPM = { min: 1, max: 300 };

  let dialog = $state<HTMLDialogElement>();
  let first = $state<HTMLInputElement>();
  let working = $state(false);
  let passAccuracy = $state(95);
  let targetWpm = $state(30);
  let pictureInWords = $state(true);
  let problem = $state<string | null>(null);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      // what is saved, each time it opens
      passAccuracy = settings.passAccuracy;
      targetWpm = settings.targetWpm;
      pictureInWords = settings.pictureInWords;
      problem = null;
      working = false;
      dialog.showModal();
      void tick().then(() => first?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function whole(value: number, range: { min: number; max: number }): boolean {
    return Number.isInteger(value) && value >= range.min && value <= range.max;
  }

  async function save() {
    if (working) return;
    if (!whole(passAccuracy, ACCURACY)) {
      problem = `The pass accuracy is a whole number from ${ACCURACY.min} to ${ACCURACY.max}.`;
      return;
    }
    if (!whole(targetWpm, WPM)) {
      problem = `The target speed is a whole number from ${WPM.min} to ${WPM.max}.`;
      return;
    }
    problem = null;
    working = true;
    let done = false;
    try {
      done = await onsave({ passAccuracy, targetWpm, pictureInWords });
    } finally {
      working = false;
    }
    if (done) dialog?.close();
  }
</script>

<dialog bind:this={dialog} class="settings" aria-labelledby="{uid}-title" onclose={onclose}
  onkeydown={(event) => {
    if (event.key === "Escape" && working) event.preventDefault();
  }}
  oncancel={(event) => {
    if (working) event.preventDefault();
  }}>
  <h2 id="{uid}-title">Learning settings</h2>
  <p class="about">What passes a lesson, and what earns a star. Both apply to every lesson set of this keyboard.</p>
  <label class="field">
    <span>Pass accuracy</span>
    <span class="input"><input bind:this={first} type="number" min={ACCURACY.min} max={ACCURACY.max} step="1"
      bind:value={passAccuracy} readonly={working} /> %</span>
  </label>
  <label class="field">
    <span>Target speed</span>
    <span class="input"><input type="number" min={WPM.min} max={WPM.max} step="1" bind:value={targetWpm}
      readonly={working} /> wpm</span>
  </label>
  <Switch label="Show the picture in word exercises" checked={pictureInWords} busy={working}
    onchange={(checked) => (pictureInWords = checked)} />
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  <div class="buttons">
    <Button aria-disabled={working || undefined} onclick={() => {
      if (!working) dialog?.close();
    }}>Cancel</Button>
    <Button variant="primary" aria-disabled={working || undefined} onclick={() => void save()}>
      {working ? "Saving…" : "Save"}
    </Button>
  </div>
</dialog>

<style>
  .settings {
    width: min(420px, calc(100vw - 32px));
    max-width: none;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .settings::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }

  .about {
    margin: 0 0 14px;
    color: var(--text-2);
    font-size: 13px;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 550;
  }

  .input {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
    color: var(--text-2);
  }

  input {
    width: 72px;
    padding: 5px 8px;
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  .problem {
    margin: 10px 0 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
```

- [ ] **Step 3: A disabled choice in `SelectField`**

Apply to `web/src/ui/SelectField.svelte`:

```diff
diff --git a/web/src/ui/SelectField.svelte b/web/src/ui/SelectField.svelte
--- a/web/src/ui/SelectField.svelte
+++ b/web/src/ui/SelectField.svelte
@@ -2,6 +2,8 @@
   interface Choice {
     value: string;
     label: string;
+    /** listed, but not to be chosen (a lesson set file that can't be read) */
+    disabled?: boolean;
   }
 
   interface Props {
@@ -43,7 +45,7 @@
     }}
   >
     {#each choices as choice (choice.value)}
-      <option value={choice.value}>{choice.label}</option>
+      <option value={choice.value} disabled={choice.disabled || undefined}>{choice.label}</option>
     {/each}
   </select>
 </div>
```

- [ ] **Step 4: The lesson list**

Create `web/src/learning/LessonList.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { router } from "../lib/router.svelte";
  import Banner from "../shell/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import { lessonStateText, listedErrors } from "./format";
  import { learning } from "./learning.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import { lessonStatus, outOfDate } from "./state";

  interface Props {
    /** what the page has to say about the address it came back from, if anything */
    note: string | null;
    onnote: (note: string | null) => void;
  }

  let { note, onnote }: Props = $props();

  /** the largest file the server takes (app.MAX_LESSON_SET) */
  const MAX_BYTES = 4 * 1024 * 1024;

  const sets = $derived(learning.sets);
  const set = $derived(learning.set);
  const chosenEntry = $derived(sets.find((s) => s.id === learning.chosen) ?? null);
  const choices = $derived(sets.length === 0
    ? [{ value: "", label: "No lesson set yet" }]
    : sets.map((s) => ({ value: s.id, label: s.error ? `${s.title} — error` : s.title, disabled: !!s.error })));
  const stale = $derived(set !== null && outOfDate(set, learning.export?.hash));
  const rows = $derived(set
    ? set.lessons.map((lesson, i) => ({ lesson, number: i + 1,
      state: lessonStateText(lessonStatus(lesson, learning.progress, learning.settings)) }))
    : []);

  let fileInput = $state<HTMLInputElement>();
  /** a file is being read and checked */
  let importing = $state(false);
  /** the checker's findings on the file refused; the warnings on the one taken */
  let findings = $state<{ tone: "errors" | "warnings"; name: string; lines: string[] } | null>(null);
  let removing = $state(false);
  let settingsOpen = $state(false);

  async function importFile(file: File) {
    importing = true;
    findings = null;
    onnote(null);
    try {
      if (file.size > MAX_BYTES) {
        findings = { tone: "errors", name: file.name, lines: [`too large for a lesson set (at most ${MAX_BYTES / 1024 / 1024} MiB)`] };
        return;
      }
      const outcome = await learning.importSet(await file.text());
      if (!outcome) return;
      if (outcome.ok) {
        if (outcome.warnings.length > 0) findings = { tone: "warnings", name: file.name, lines: listedErrors(outcome.warnings) };
      } else {
        findings = { tone: "errors", name: file.name, lines: listedErrors(outcome.errors) };
      }
    } finally {
      importing = false;
    }
  }

  function openLesson(lessonId: string) {
    if (!set) return;
    router.go("learning", null, { path: [set.id, lessonId] });
  }
</script>

<PageHeader id="learning-title" title="Learning" description="A typing course for this keyboard, lesson by lesson."
  note="Results are kept on this computer, per keyboard.">
  {#snippet action()}
    <Button onclick={() => router.go("learning", null, { path: ["fingers"] })}>Fingers…</Button>
    <Button id="learning-settings" aria-label="Settings" title="Pass accuracy, target speed, the picture"
      onclick={() => (settingsOpen = true)}>
      <svg viewBox="0 0 20 20" aria-hidden="true" class="gear">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
      </svg>
    </Button>
  {/snippet}
</PageHeader>

{#if note}<p class="note" role="status">{note}</p>{/if}

<div class="row">
  <SelectField id="lesson-set" label="Lesson set" value={learning.chosen ?? ""} {choices}
    disabled={sets.length === 0} busy={learning.opening} onchange={(id) => void learning.open(id)} />
  <div class="buttons">
    <Button id="import-lessons" aria-disabled={importing || undefined} onclick={() => {
      if (!importing) fileInput?.click();
    }}>{importing ? "Importing…" : "Import…"}</Button>
    <input bind:this={fileInput} class="visually-hidden" type="file" accept=".json,application/json" tabindex="-1"
      aria-label="Lesson set file to import"
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) void importFile(file);
      }} />
    {#if chosenEntry}
      <Button variant="danger" onclick={() => (removing = true)}>Remove</Button>
    {/if}
  </div>
</div>

{#if findings}
  <div class="findings {findings.tone}" role={findings.tone === "errors" ? "alert" : "status"}>
    <strong>{findings.tone === "errors" ? `${findings.name} wasn't imported:` : `${findings.name} was imported, with warnings:`}</strong>
    <ul>
      {#each findings.lines as line, i (i)}<li>{line}</li>{/each}
    </ul>
  </div>
{/if}

{#if chosenEntry?.error}
  <p class="problem" role="alert">This file can't be opened: {chosenEntry.error}</p>
{/if}

{#if stale}
  <Banner tone="warning" title="Built for another layout." message="Export again and regenerate, or carry on." />
{/if}

{#if learning.loading}
  <p class="empty">Reading the lessons…</p>
{:else if sets.length === 0 && learning.loaded && !learning.error}
  <p class="empty">
    No lesson set yet? <strong>Fingers…</strong> → Export, then run the <code>generate-lessons</code> skill in Claude
    Code and <strong>Import</strong> the file it writes.
  </p>
{:else if set}
  <ol class="lessons" aria-label="Lessons of {set.title}">
    {#each rows as row (row.lesson.id)}
      <li>
        <button type="button" class="lesson" onclick={() => openLesson(row.lesson.id)}>
          <span class="number">{row.number}</span>
          <span class="title">{row.lesson.title}</span>
          <span class="state" class:star={row.state.startsWith("★")}>{row.state}</span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<ConfirmDialog open={removing} title="Remove {chosenEntry?.title ?? 'the lesson set'}?"
  message="The lesson set file is removed from this keyboard's lessons. Its results stay, for the set imported again."
  confirmLabel="Remove" danger
  onconfirm={() => (chosenEntry ? learning.deleteSet(chosenEntry.id) : Promise.resolve(true))}
  onclose={() => {
    removing = false;
    void tick().then(() => document.getElementById("lesson-set")?.focus());
  }} />

<SettingsDialog open={settingsOpen} settings={learning.settings} onsave={(s) => learning.saveSettings(s)}
  onclose={() => {
    settingsOpen = false;
    void tick().then(() => document.getElementById("learning-settings")?.focus());
  }} />

<style>
  .gear {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .note {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
  }

  /* the selector shrinks to the row (a long set title gets its ellipsis) rather than widening the page */
  .row > :global(.field) {
    flex: 1 1 280px;
    min-width: 0;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .findings {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid;
    border-radius: 8px;
    font-size: 13px;
  }

  .findings.errors {
    border-color: var(--danger-line);
    background: var(--danger-weak);
    color: var(--danger);
  }

  .findings.warnings {
    border-color: color-mix(in srgb, var(--warning-text) 30%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .findings ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }

  .problem {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
  }

  .empty {
    margin: 0;
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    color: var(--text-2);
    font-size: 13.5px;
    text-align: center;
  }

  .empty code {
    font-family: var(--mono);
  }

  .lessons {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lesson {
    display: grid;
    grid-template-columns: 2.2em minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .lesson:hover {
    background: var(--surface-2);
  }

  .number {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .state {
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .state.star {
    color: var(--ok);
  }

  @media (max-width: 480px) {
    .lesson {
      grid-template-columns: 2.2em minmax(0, 1fr);
    }

    .state {
      grid-column: 2;
      white-space: normal;
    }
  }
</style>
```

- [ ] **Step 5: `api(page).delete` for the e2e tests**

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -102,6 +102,7 @@ export function api(page: Page) {
     get: (path: string) => page.request.get(serverUrl(page, path), { headers }),
     put: (path: string, data: unknown) => page.request.put(serverUrl(page, path), { data, headers }),
     post: (path: string, data?: unknown) => page.request.post(serverUrl(page, path), { data, headers }),
+    delete: (path: string) => page.request.delete(serverUrl(page, path), { headers }),
   };
 }
 
```

- [ ] **Step 6: svelte-check and the build pass**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` (the `COMPLETED` line; `tsc -p tsconfig.node.json` after it prints nothing).

```bash
cd web && npm run build
```

Expected: `✓ built in`.

- [ ] **Step 7: Commit**

```bash
git add web/src/learning/learning.svelte.ts \
  web/src/learning/Board.svelte \
  web/src/learning/SettingsDialog.svelte \
  web/src/learning/LessonList.svelte \
  web/src/ui/SelectField.svelte \
  web/e2e/fixtures.ts
git commit -m "feat(web): the Learning store, the lesson list and its settings dialog" \
  -m "The LearningState store keeps the sets, the open set with its progress, the settings, the export and the fingers per keyboard and language; the lesson list has the set selector, Import, Remove, the settings dialog and the out-of-date banner. SelectField's choices can be disabled; the e2e api() fixture gets delete." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: The lesson view and the typing view

The two views of a set's content, as the design's section 1 draws them ("A lesson", "Typing an exercise"). Both take the keyboard `model` and `placement` the page has (Task 12) and the `set`, `lesson` and lesson `number` it resolved from the address; both draw the picture on a `Board` with `Keyboard.svelte` as it is (`interactive={false}`, `maxUnit={56}`, the layer-0 faces), with the arrays from `picture.ts` (Task 9), as the design's section 3 says.

- `LessonView.svelte`: the lesson's number and title, its `guidance` as the header description, **Back to lessons**. The picture lights every new key of the lesson at once and presses every key held for them (`pictureForAll`, the rest faded); under it, each new character with the way to its key, `( — hold Sym → (` or `A — Shift + A` (`nextKeyLabel`); a lesson with nothing new says "A review: nothing new, every key so far." Where the export doesn't place a character (the set is out of date), the lesson's own `key`/`layer`/`via` stand in. The exercise rows: the kind (the extra kinds in italics: they don't count for passing, `isMain`), the title, the best as `bestText` gives it, with ★ when the best reached the target speed (`exerciseResult`).
- `TypingView.svelte`: the "Typing an exercise" mockup. Decisions baked in:
  - one engine per exercise: the state is created once (`untrack`) and the page keys the view by set and exercise (Task 12), so another exercise is another view. The engine is pure (`press`, Task 9): a wrong key doesn't advance until the right one is typed and shows struck out; Backspace clears the wrong mark, else goes back but not past the group or word start; Enter is expected between `text` lines.
  - keys come from `keydown` alone (the design named `input`/`keypress` too): a printable key is `event.key` of one code point, Backspace and Enter are taken, Escape quits, every other key (Shift, Tab, arrows) is ignored by the engine; a browser shortcut (Ctrl or Meta) stays one, except Ctrl+Alt, which is how Windows sends AltGr characters.
  - Escape, or Back to the lesson, leaves mid-exercise: nothing is saved and nothing is asked.
  - the picture: hidden for `blind`, and for `words`, `extra-words` and `text` when the setting "picture in word exercises" is off; the next key is lit (the rest faded) only for `new-keys`, `keys` and `extra-keys` (lesson-format.md, section 3's table), so a word exercise with the picture on shows it with nothing lit; "Next: hold Space → (" in the status line when a key is lit.
  - the status line is `statusText(progressOf(engine, now))`, the clock ticking once a second while the exercise runs; six lines of text are in view, the line being typed scrolled into view; `text` shows its lines one under another (a `↵` run and a line break).
  - at the end, the result card: `passText` (passed at the pass accuracy), the star at the target speed, `resultLines`; the attempt goes to the server at once, with the elapsed time as exact seconds (`Math.max(ms / 1000, 0.001)`: the server takes some time, and a bot typing in under half a second is still an attempt); the card says Saving…/Saved./Not saved. **Again** (a new engine, the focus back on the area), **Next exercise** (disabled on the set's last one, with a title saying so, `nextExercise`), **Back to the lesson**.
  - the typing area is a focused `role="application"` with a hidden description; the view's own slim head (`h1#learning-title`) rather than a `PageHeader`, to leave the height to the text and the picture (the owner's 1920 × 950 window, Task 13's test).

**Files:**
- Create: `web/src/learning/LessonView.svelte`
- Create: `web/src/learning/TypingView.svelte`

- [ ] **Step 1: The lesson view**

Create `web/src/learning/LessonView.svelte`:

```svelte
<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { router } from "../lib/router.svelte";
  import Button from "../ui/Button.svelte";
  import Board from "./Board.svelte";
  import { bestText } from "./format";
  import { learning } from "./learning.svelte";
  import { nextKeyLabel, pictureForAll } from "./picture";
  import { exerciseResult, isMain } from "./state";
  import type { Lesson, LessonSet } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    set: LessonSet;
    lesson: Lesson;
    /** its number in the set, from 1 */
    number: number;
  }

  let { model, placement, set, lesson, number }: Props = $props();

  const layout = $derived(learning.export);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  const picture = $derived(layout
    ? pictureForAll(lesson.new.map((n) => n.char), learning.places, placement, layout, { fadeOthers: true })
    : null);
  /** each new character with the way to its key: "( — hold Sym → (" */
  const chars = $derived(lesson.new.map((n) => {
    const place = learning.places.get(n.char) ?? { key: n.key, layer: n.layer, via: n.via };
    return { char: n.char, how: layout ? nextKeyLabel(place, layout) : n.key };
  }));
  const exercises = $derived(lesson.exercises.map((exercise) => {
    const best = learning.progress?.exercises[exercise.id]?.best ?? null;
    return { exercise, best: bestText(best), star: best ? exerciseResult(best, learning.settings).star : false,
      main: isMain(exercise) };
  }));

  function open(exerciseId: string) {
    router.go("learning", null, { path: [set.id, lesson.id, exerciseId] });
  }
</script>

<PageHeader id="learning-title" title="{number} · {lesson.title}" description={lesson.guidance}>
  {#snippet action()}
    <Button onclick={() => router.go("learning")}>Back to lessons</Button>
  {/snippet}
</PageHeader>

{#if picture}
  <Board>
    <Keyboard {placement} {faces} labels={[]} highlights={picture.highlights} pressed={picture.pressed}
      faded={picture.faded} selected={-1} onselect={() => undefined} interactive={false} maxUnit={56} />
  </Board>
{/if}

{#if chars.length > 0}
  <ul class="chars" aria-label="New characters">
    {#each chars as c (c.char)}
      <li><kbd>{c.char === " " ? "Space" : c.char}</kbd> <span class="how">— {c.how}</span></li>
    {/each}
  </ul>
{:else}
  <p class="review">A review: nothing new, every key so far.</p>
{/if}

<ol class="exercises" aria-label="Exercises">
  {#each exercises as e (e.exercise.id)}
    <li>
      <button type="button" class="exercise" onclick={() => open(e.exercise.id)}>
        <span class="kind" class:extra={!e.main}>{e.exercise.kind}</span>
        <span class="title">{e.exercise.title}</span>
        <span class="best">{#if e.star}<span class="star" aria-label="reached the target speed">★</span> {/if}{e.best}</span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .chars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13.5px;
  }

  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 1px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    font-family: var(--mono);
    text-align: center;
  }

  .how,
  .review {
    color: var(--text-2);
  }

  .review {
    margin: 0;
    font-size: 13.5px;
  }

  .exercises {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .exercise {
    display: grid;
    grid-template-columns: 7em minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .exercise:hover {
    background: var(--surface-2);
  }

  .kind {
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 12px;
  }

  .kind.extra {
    font-style: italic;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .best {
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .star {
    color: var(--ok);
  }

  @media (max-width: 480px) {
    .exercise {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .kind {
      grid-column: 1 / -1;
    }
  }
</style>
```

- [ ] **Step 2: The typing view**

Create `web/src/learning/TypingView.svelte`:

```svelte
<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { router } from "../lib/router.svelte";
  import Button from "../ui/Button.svelte";
  import Board from "./Board.svelte";
  import { createEngine, press, progressOf, resultOf, segments, type EngineState, type Result } from "./engine";
  import { passText, resultLines, statusText } from "./format";
  import { learning } from "./learning.svelte";
  import { nextKeyLabel, pictureFor } from "./picture";
  import { exerciseResult, nextExercise } from "./state";
  import type { Exercise, ExerciseKind, Lesson, LessonSet } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    set: LessonSet;
    lesson: Lesson;
    /** the lesson's number in the set, from 1 */
    number: number;
    exercise: Exercise;
  }

  let { model, placement, set, lesson, number, exercise }: Props = $props();

  /** the kinds whose next key is lit, the rest faded (lesson-format.md section 3) */
  const LIT: readonly ExerciseKind[] = ["new-keys", "keys", "extra-keys"];
  /** the kinds the "picture in word exercises" setting is about */
  const WORDS: readonly ExerciseKind[] = ["words", "extra-words", "text"];

  // the page keys this view by the exercise: another exercise is another view, with an engine of its own
  let engine = $state.raw<EngineState>(untrack(() => createEngine(exercise)));
  /** the clock, for the status line: the last press, or the ticker's second */
  let now = $state(0);
  let area = $state<HTMLDivElement>();
  let text = $state<HTMLDivElement>();
  /** the finished exercise's result, and whether it was saved */
  let result = $state.raw<Result | null>(null);
  let saving = $state<"saving" | "saved" | "failed" | null>(null);

  const kind = $derived(exercise.kind);
  const lit = $derived(LIT.includes(kind));
  const pictureShown = $derived(kind !== "blind" && !(WORDS.includes(kind) && !learning.settings.pictureInWords));
  const layout = $derived(learning.export);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  const nextChar = $derived(engine.done ? null : engine.expected[engine.position]);
  const picture = $derived(layout && lit && nextChar !== null
    ? pictureFor(nextChar, learning.places, placement, layout, { fadeOthers: true })
    : null);
  const nextPlace = $derived(nextChar === null ? undefined : learning.places.get(nextChar));
  const nextLabel = $derived(layout && lit && nextPlace ? nextKeyLabel(nextPlace, layout) : null);
  const runs = $derived(segments(engine));
  const progress = $derived(progressOf(engine, now));
  const next = $derived(nextExercise(set, lesson.id, exercise.id));
  const verdict = $derived(result ? exerciseResult(result, learning.settings) : null);

  // a second at a time while the clock runs
  $effect(() => {
    if (engine.startedAt === null || engine.done) return;
    const timer = setInterval(() => (now = performance.now()), 1000);
    return () => clearInterval(timer);
  });

  // the line being typed stays in view (six lines show at a time)
  $effect(() => {
    void engine.position;
    void engine.wrongNow;
    void tick().then(() => text?.querySelector(".next, .wrong")?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  onMount(() => area?.focus());

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      quit();
      return;
    }
    if (engine.done) return;
    // a shortcut of the browser's (Ctrl+R) stays one; AltGr comes as Ctrl+Alt on Windows, and its characters are typed
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return;
    const key = event.key;
    const printable = Array.from(key).length === 1;
    if (!printable && key !== "Backspace" && key !== "Enter") return;
    event.preventDefault();
    const at = performance.now();
    now = at;
    engine = press(engine, key, at);
    if (engine.done) finish(engine);
  }

  function finish(state: EngineState) {
    const done = resultOf(state);
    result = done;
    void save(state, done);
  }

  /** the attempt goes to the server at once; the time as it was, not rounded to whole seconds, as the server takes
   * some time (a bot typing in under half a second is still an attempt) */
  async function save(state: EngineState, done: Result) {
    saving = "saving";
    const ms = (state.finishedAt ?? 0) - (state.startedAt ?? 0);
    const ok = await learning.recordAttempt(exercise.id, {
      at: new Date().toISOString(), chars: done.chars, errors: done.errors, seconds: Math.max(ms / 1000, 0.001),
    });
    saving = ok ? "saved" : "failed";
  }

  async function again() {
    engine = createEngine(exercise);
    result = null;
    saving = null;
    now = 0;
    await tick();
    area?.focus();
  }

  function quit() {
    router.go("learning", null, { path: [set.id, lesson.id] });
  }

  function goNext() {
    if (!next) return;
    router.go("learning", null, { path: [set.id, next.lessonId, next.exerciseId] });
  }
</script>

<div class="head">
  <h1 id="learning-title" tabindex="-1">{number} · {lesson.title} · {exercise.title}</h1>
  <Button size="sm" onclick={quit}>Back to the lesson</Button>
</div>

<!-- it takes the keys typed: the text is typed into it -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div bind:this={area} class="area" tabindex="0" role="application" aria-label="Typing area"
  aria-describedby="typing-help" onkeydown={onkeydown}>
  <p id="typing-help" class="visually-hidden">
    Type the text shown. Backspace goes back within the word. Escape leaves the exercise without saving.
  </p>
  <div bind:this={text} class="text" class:lines={kind === "text"} aria-hidden="true">
    {#each runs as run, i (i)}
      {#if run.lineBreak}<span class="run {run.status} end">↵</span><br />{:else}<span class="run {run.status}">{run.text}</span>{/if}
    {/each}
  </div>
  <p class="status">
    <span>{statusText(progress)}</span>
    {#if nextLabel && !engine.done}<span class="next-key">Next: {nextLabel}</span>{/if}
    <span class="hint">Esc quits</span>
  </p>
</div>

{#if pictureShown}
  <Board>
    <Keyboard {placement} {faces} labels={[]} highlights={picture?.highlights ?? []} pressed={picture?.pressed ?? []}
      faded={picture?.faded ?? []} selected={-1} onselect={() => undefined} interactive={false} maxUnit={56} />
  </Board>
{/if}

{#if result && verdict}
  <section class="result" aria-labelledby="result-title">
    <h2 id="result-title">{passText(verdict.passed, learning.settings.passAccuracy)}</h2>
    {#if verdict.star}<p class="star">★ reached the target speed</p>{/if}
    <dl>
      {#each resultLines(result) as line (line.label)}
        <div><dt>{line.label}</dt><dd>{line.value}</dd></div>
      {/each}
    </dl>
    <p class="saved" role="status">
      {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved." : saving === "failed" ? "Not saved: the message that came up says why." : ""}
    </p>
    <div class="buttons">
      <Button id="typing-again" variant="primary" onclick={() => void again()}>Again</Button>
      <Button disabled={next === null} title={next === null ? "This is the last exercise of the set" : undefined}
        onclick={goNext}>Next exercise</Button>
      <Button onclick={quit}>Back to the lesson</Button>
    </div>
  </section>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.01em;
  }

  h1:focus {
    outline: none;
  }

  .area {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .area:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .text {
    /* six lines show at a time; the line being typed is scrolled into view */
    max-height: calc(6 * 1.65em + 8px);
    overflow-y: auto;
    padding: 4px 0;
    font-family: var(--mono);
    font-size: 20px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-3);
  }

  .run.typed {
    color: var(--text);
  }

  .run.next {
    color: var(--text);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
    background: var(--accent-weak);
  }

  .run.wrong {
    color: var(--danger);
    text-decoration: line-through;
    background: var(--danger-weak);
  }

  .run.end {
    opacity: 0.6;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .next-key {
    color: var(--text);
    font-weight: 550;
  }

  .hint {
    margin-left: auto;
    color: var(--text-3);
  }

  .result {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .star {
    margin: 0;
    color: var(--ok);
    font-weight: 550;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin: 0;
  }

  dl div {
    display: flex;
    gap: 6px;
  }

  dt {
    color: var(--text-2);
  }

  dd {
    margin: 0;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }

  .saved {
    min-height: 1.3em;
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
```

- [ ] **Step 3: svelte-check and the build pass**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.

```bash
cd web && npm run build
```

Expected: `✓ built in`.

- [ ] **Step 4: Commit**

```bash
git add web/src/learning/LessonView.svelte \
  web/src/learning/TypingView.svelte
git commit -m "feat(web): the Learning lesson and typing views" \
  -m "A lesson shows its new keys lit on the picture, the way to each, and each exercise's best; typing an exercise runs the engine on keydown, lights the next key for the key kinds, keeps the status line, and saves the result card at once. Escape leaves without saving." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: The Fingers view, the Learning page, and the section in the app

The last view, the page shell that picks a view by the address, and the entry in the app's navigation: from here the Learning section shows on every keyboard. `LearningPage` imports all four views and `App.svelte` imports `LearningPage`, which is why both come last (Task 10's ordering note).

- `FingersView.svelte`: the design's "Fingers" paragraph and section 3. The picture is interactive (click a key), ringed by finger in the finger colours (`FINGER_COLOURS`, Task 9: pinky, ring, middle, index, thumb), with a legend under it. The resting keys are marked through `chosen` (the key's `aria-pressed`) plus a view-local fill, because `Keyboard.svelte` draws `pressed` only on non-interactive pictures; `Keyboard.svelte` itself is untouched (the design's section 3). Each key's accessible label says its finger, reach and whether it rests ("E: left middle, up"). The panel for the key clicked: **Finger** and **Reach** selectors, a **Resting key** switch, the hand and the row; every change sends all the keys with the one changed (the server stores the whole fingers file), and `learning.saveFingers` then reads the export again, so the lists' out-of-date state follows. An encoder has no finger. **Reset to proposal** asks first (`ConfirmDialog`) and is disabled while the fingers are the proposal; the header's note says whether they are the proposal or corrected. **Export** reads `/api/learning/export` (the server also saves it as `learning/<uid>/layout-export.json`) and downloads it as `<keyboard name>-layout-export.json` (`exportFileName`, Task 9) through a blob link, then says what to do with it (the skill, then Import). The fingers are read when the view opens.
- `LearningPage.svelte`: the section's shell. On mount and whenever the keyboard or its language changes, `learning.follow`; then `learning.load` once per keyboard. The address path (`router.route.path`, Task 9) names the view: nothing → the list, `fingers` → the Fingers view, `<set>/<lesson>` → a lesson, `<set>/<lesson>/<exercise>` → typing; any other one-segment path goes back to the list (`replace`). `shown` resolves the set, the lesson and the exercise from the store: "waiting" while the set named is being read (the page opens it when it isn't the chosen one), "missing" when the address names what isn't here (a set removed, a lesson of another set, a file that can't be opened) — then the page goes back to the list, with a note the list shows until the user goes somewhere. The typing view is keyed by set and exercise. A read failure is a `Banner` with Retry over whichever view. Widths, as the design asks: the list pages at `--list-max` (860 px), the typing view at `--content-max` (the keymap's 1100 px, for the picture and the text), the column `minmax(0, 1fr)` so a long set title shrinks instead of widening the page.
- `App.svelte`: the **Learning** entry on every keyboard (the lessons are the app's files, nothing of the firmware's), after Macros and before Key overrides, so a macropad's list reads Keymap, Layout, Macros, Learning, Matrix tester, Keyboard; the section renders `LearningPage`; the page `div` gets `learning` instead of `list`, since the page sets its own width per view, with `width: 100%; min-width: 0` so it is as wide as its column and never wider.
- `e2e/lighting.spec.ts`: the macropad's navigation now lists Learning (one expectation).

**Files:**
- Create: `web/src/learning/FingersView.svelte`
- Create: `web/src/learning/LearningPage.svelte`
- Modify: `web/src/App.svelte`
- Modify: `web/e2e/lighting.spec.ts`

- [ ] **Step 1: The Fingers view**

Create `web/src/learning/FingersView.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { FingersIn, KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { whereIs } from "../keyboard/refs";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import Switch from "../ui/Switch.svelte";
  import Board from "./Board.svelte";
  import { FINGER_COLOURS, FINGERS, fingerLabel } from "./fingers";
  import { exportFileName } from "./format";
  import { learning } from "./learning.svelte";
  import { keyIdOf } from "./picture";
  import type { Finger, Reach } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  const REACHES: readonly Reach[] = ["rest", "up", "down", "inner", "outer"];
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const fingerChoices = FINGERS.map((f) => ({ value: f, label: capital(f) }));
  const reachChoices = REACHES.map((r) => ({ value: r, label: capital(r) }));

  // read when the view opens
  $effect(() => {
    if (learning.fingers === null) void learning.loadFingers();
  });

  const fingers = $derived(learning.fingers);
  const names = $derived(namesOf(model));
  const faces = $derived(layerFaces(model, placement.items, 0, names));
  /** each placed item's export key id (null for an encoder) */
  const ids = $derived(placement.items.map((item) => (item.kind === "key" ? keyIdOf(item.geometry) : null)));
  const keyOf = (i: number) => (ids[i] === null ? undefined : fingers?.keys[ids[i]]);
  const rings = $derived(ids.map((_, i) => {
    const key = keyOf(i);
    return key ? FINGER_COLOURS[key.finger] : null;
  }));
  /** the resting keys: drawn filled (aria-pressed) */
  const home = $derived(ids.map((_, i) => keyOf(i)?.home ?? false));
  const labels = $derived(ids.map((_, i) => {
    const key = keyOf(i);
    const legend = faces[i]?.main || "key";
    return key ? `${legend}: ${fingerLabel(key.finger, key.hand)}, ${key.reach}${key.home ? ", resting" : ""}` : legend;
  }));

  let selected = $state(-1);
  const selectedId = $derived(selected >= 0 ? ids[selected] : null);
  const selectedKey = $derived(selectedId === null ? undefined : fingers?.keys[selectedId]);
  const where = $derived(selected >= 0 ? whereIs(model, placement.items[selected]) : null);
  let saving = $state(false);
  let resetting = $state(false);
  let exporting = $state(false);
  let exported = $state("");

  /** Saves every key as it is now, with one change: the server stores the whole of it */
  async function change(id: string, fix: Partial<{ finger: Finger; reach: Reach; home: boolean }>) {
    if (!fingers || saving) return;
    const keys: FingersIn["keys"] = {};
    const resting: string[] = [];
    for (const [kid, key] of Object.entries(fingers.keys)) {
      const changed = kid === id ? { ...key, ...fix } : key;
      keys[kid] = { finger: changed.finger, reach: changed.reach };
      if (changed.home) resting.push(kid);
    }
    saving = true;
    try {
      await learning.saveFingers({ keys, home: resting });
    } finally {
      saving = false;
    }
  }

  async function exportLayout() {
    if (exporting) return;
    exporting = true;
    exported = "";
    try {
      const layout = await api.learningExport();
      const name = exportFileName(model.name);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 1)], { type: "application/json" }));
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      exported = `Saved ${name}. Run the generate-lessons skill in Claude Code with this file, then Import the lesson set it writes.`;
    } catch (error) {
      toasts.error(`Exporting the layout failed: ${causeMessage(error)}`);
    } finally {
      exporting = false;
    }
  }
</script>

<PageHeader id="learning-title" title="Fingers"
  description="Which finger rests on and reaches each key. The export tells the lesson generator; correct the proposal where it is wrong."
  note={fingers?.proposal ? "This is the app's proposal from the key positions: nothing corrected yet." : fingers ? "Corrected by you; Reset to proposal forgets the corrections." : undefined}>
  {#snippet action()}
    <Button id="export-layout" variant="primary" aria-disabled={exporting || undefined} onclick={() => void exportLayout()}>
      {exporting ? "Exporting…" : "Export"}
    </Button>
    <Button onclick={() => (resetting = true)} disabled={!fingers || fingers.proposal}>Reset to proposal</Button>
    <Button onclick={() => router.go("learning")}>Back to lessons</Button>
  {/snippet}
</PageHeader>

{#if exported}<p class="exported" role="status">{exported}</p>{/if}

<Board>
  <div class="picture">
    <Keyboard {placement} {faces} {labels} {rings} chosen={home} {selected} onselect={(i) => (selected = i)}
      interactive={true} maxUnit={56} label="Keys, by finger" describedby="fingers-help" />
  </div>
  <p id="fingers-help" class="legend">
    {#each FINGERS as finger (finger)}
      <span><span class="swatch" style="border-color: {FINGER_COLOURS[finger]}"></span> {finger}</span>
    {/each}
    <span><span class="swatch home"></span> resting key</span>
    <span class="help">Click a key to change its finger.</span>
  </p>
</Board>

{#if selectedId !== null && selectedKey && where}
  <section class="panel" aria-labelledby="finger-key-title">
    <h2 id="finger-key-title">{faces[selected]?.main || "Key"} <span class="where">· {selectedId} ({where.where})</span></h2>
    <div class="fields">
      <SelectField label="Finger" value={selectedKey.finger} choices={fingerChoices} busy={saving}
        onchange={(finger) => void change(selectedId, { finger: finger as Finger })} />
      <SelectField label="Reach" value={selectedKey.reach} choices={reachChoices} busy={saving}
        onchange={(reach) => void change(selectedId, { reach: reach as Reach })} />
      <Switch label="Resting key" checked={selectedKey.home} busy={saving}
        onchange={(checked) => void change(selectedId, { home: checked })} />
    </div>
    <p class="hand">{capital(selectedKey.hand)} hand, {selectedKey.row} row.</p>
  </section>
{:else if selectedId === null && selected >= 0}
  <p class="hand">An encoder has no finger.</p>
{/if}

<ConfirmDialog open={resetting} title="Reset the fingers to the proposal?"
  message="Your corrections are forgotten: every key gets the finger the app proposes from its position."
  confirmLabel="Reset" danger onconfirm={() => learning.saveFingers(null)}
  onclose={() => {
    resetting = false;
    void tick().then(() => document.getElementById("export-layout")?.focus());
  }} />

<style>
  .exported {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--accent-weak);
    color: var(--text);
    font-size: 13px;
  }

  /* the resting keys are drawn filled (their aria-pressed, the Keyboard's chosen) */
  .picture :global(.key[aria-pressed="true"] .face) {
    fill: color-mix(in srgb, var(--key-bg) 60%, var(--accent));
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 3px solid;
    border-radius: 4px;
    background: var(--key-bg);
  }

  .swatch.home {
    border-color: var(--border);
    background: color-mix(in srgb, var(--key-bg) 60%, var(--accent));
  }

  .help {
    color: var(--text-3);
  }

  .panel {
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .where {
    color: var(--text-3);
    font-weight: 400;
    font-size: 13px;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px 24px;
    align-items: center;
  }

  .hand {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
```

- [ ] **Step 2: The page**

Create `web/src/learning/LearningPage.svelte`:

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Banner from "../shell/Banner.svelte";
  import FingersView from "./FingersView.svelte";
  import { learning } from "./learning.svelte";
  import LessonList from "./LessonList.svelte";
  import LessonView from "./LessonView.svelte";
  import type { Exercise, Lesson, LessonSet } from "./types";
  import TypingView from "./TypingView.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  // the store is for the keyboard shown, in the keyboard language shown (the export's characters are the language's)
  untrack(() => learning.follow(model.uid, keyboard.language));
  $effect.pre(() => learning.follow(model.uid, keyboard.language));
  // read when the page shows, once per keyboard
  $effect(() => {
    if (!learning.loaded && !learning.loading) void learning.load();
  });

  /** the view the address names: the lesson list, the Fingers view, a lesson or an exercise of a set */
  type Named = { kind: "list" } | { kind: "fingers" } | { kind: "lesson"; set: string; lesson: string }
    | { kind: "typing"; set: string; lesson: string; exercise: string };
  const path = $derived(router.route.path);
  const named = $derived.by<Named>(() => {
    if (path.length === 0) return { kind: "list" };
    if (path.length === 1) return path[0] === "fingers" ? { kind: "fingers" } : { kind: "list" };
    if (path.length === 2) return { kind: "lesson", set: path[0], lesson: path[1] };
    return { kind: "typing", set: path[0], lesson: path[1], exercise: path[2] };
  });

  /** what the address names isn't here (a set removed, a lesson of another set): said on the list */
  let note = $state<string | null>(null);

  /** the view with what it shows: null while the set it names is being read; "missing" when it names what isn't here */
  type Shown = { kind: "list" } | { kind: "fingers" } | { kind: "waiting" } | { kind: "missing"; what: string }
    | { kind: "lesson"; set: LessonSet; lesson: Lesson; number: number }
    | { kind: "typing"; set: LessonSet; lesson: Lesson; number: number; exercise: Exercise };
  const shown = $derived.by<Shown>(() => {
    if (named.kind === "list" || named.kind === "fingers") return named;
    if (!learning.loaded || learning.error) return { kind: "waiting" };
    const entry = learning.sets.find((s) => s.id === named.set);
    if (!entry) return { kind: "missing", what: `Lesson set ${named.set} isn't here.` };
    if (entry.error) return { kind: "missing", what: `Lesson set ${named.set} can't be opened: ${entry.error}` };
    const set = learning.set;
    if (learning.chosen !== named.set || !set || set.id !== named.set) return { kind: "waiting" };
    const l = set.lessons.findIndex((lesson) => lesson.id === named.lesson);
    const lesson = set.lessons[l];
    if (!lesson) return { kind: "missing", what: `Lesson ${named.lesson} isn't in ${set.title}.` };
    if (named.kind === "lesson") return { kind: "lesson", set, lesson, number: l + 1 };
    const exercise = lesson.exercises.find((e) => e.id === named.exercise);
    if (!exercise) return { kind: "missing", what: `Exercise ${named.exercise} isn't in lesson ${lesson.id} of ${set.title}.` };
    return { kind: "typing", set, lesson, number: l + 1, exercise };
  });

  // the set the address names is opened; what isn't here goes back to the list, with a note, and the address with it
  $effect(() => {
    const target = named;
    const view = shown;
    untrack(() => {
      if (path.length === 1 && target.kind === "list") {
        router.go("learning", null, { replace: true });
        return;
      }
      if (view.kind === "missing") {
        note = view.what;
        router.go("learning", null, { replace: true });
        return;
      }
      if (view.kind === "waiting" && (target.kind === "lesson" || target.kind === "typing") && learning.loaded
        && !learning.error && !learning.opening && learning.chosen !== target.set) {
        void learning.open(target.set);
      }
    });
  });

  // the note is for the list it came back to: it goes once the user goes somewhere
  $effect(() => {
    if (path.length > 0) note = null;
  });
</script>

<section class="page" class:wide={shown.kind === "typing"}>
  {#if learning.error}
    <Banner tone="danger" title="Couldn't read the lessons" message={learning.error} actionLabel="Retry"
      onaction={() => void learning.load()} />
  {/if}
  {#if shown.kind === "list"}
    <LessonList {note} onnote={(text) => (note = text)} />
  {:else if shown.kind === "fingers"}
    <FingersView {model} {placement} />
  {:else if shown.kind === "lesson"}
    <LessonView {model} {placement} set={shown.set} lesson={shown.lesson} number={shown.number} />
  {:else if shown.kind === "typing"}
    {#key `${shown.set.id}/${shown.exercise.id}`}
      <TypingView {model} {placement} set={shown.set} lesson={shown.lesson} number={shown.number} exercise={shown.exercise} />
    {/key}
  {:else if shown.kind === "waiting" && !learning.error}
    <p class="waiting" role="status">Reading the lessons…</p>
  {/if}
</section>

<style>
  /* a list page's width; the typing view takes the keymap's, for the picture and the text */
  .page {
    display: grid;
    /* one column no wider than the page: a long lesson set title shrinks to it */
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    width: 100%;
    max-width: var(--list-max);
    min-width: 0;
    margin: 0 auto;
  }

  .page.wide {
    max-width: var(--content-max);
  }

  .waiting {
    margin: 0;
    color: var(--text-2);
    font-size: 13.5px;
  }
</style>
```

- [ ] **Step 3: The section in the app**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -12,6 +12,7 @@
   import { namesOf } from "./keyboard/labels";
   import KeymapPage from "./keymap/KeymapPage.svelte";
   import LayoutPage from "./layout/LayoutPage.svelte";
+  import LearningPage from "./learning/LearningPage.svelte";
   import { hasLighting } from "./lighting/lighting";
   import LightingPage from "./lighting/LightingPage.svelte";
   import MatrixPage from "./matrix/MatrixPage.svelte";
@@ -50,6 +51,8 @@
     if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
     if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
     if (counts.macros !== null) list.push({ id: "macros", label: "Macros", count: counts.macros });
+    // every keyboard: the lessons are the app's files, nothing of the firmware's
+    list.push({ id: "learning", label: "Learning" });
     if (counts.keyOverrides !== null) list.push({ id: "key-overrides", label: "Key overrides", count: counts.keyOverrides });
     if (counts.altRepeat !== null) list.push({ id: "alt-repeat", label: "Alt-repeat", count: counts.altRepeat });
     if (model.settings.length > 0) list.push({ id: "settings", label: "Settings" });
@@ -280,13 +283,17 @@
       {#if keyboard.model && placement && analysis}
         <!-- made anew for another keyboard, even one alike (the same uid): an editor open was for the one before -->
         {#key keyboard.opened}
-          <div class="page" class:list={section !== "keymap"} class:blocked={greyed} inert={greyed}>
+          <!-- the Learning page sets its own width: a list, or the keymap's for the typing view -->
+          <div class="page" class:list={section !== "keymap" && section !== "learning"} class:learning={section === "learning"}
+            class:blocked={greyed} inert={greyed}>
             {#if section === "tap-dance"}
               <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
             {:else if section === "combos"}
               <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
             {:else if section === "macros"}
               <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
+            {:else if section === "learning"}
+              <LearningPage model={keyboard.model} {placement} />
             {:else if section === "key-overrides"}
               <KeyOverridesPage model={keyboard.model} item={router.route.item} />
             {:else if section === "alt-repeat"}
@@ -410,6 +417,13 @@
     margin: 0 auto;
   }
 
+  /* the Learning page is as wide as its column, never wider: its content (a long lesson set title in the selector)
+     shrinks to it, as the page sets its own width per view */
+  .page.learning {
+    width: 100%;
+    min-width: 0;
+  }
+
   .page.blocked {
     filter: grayscale(1);
     opacity: 0.55;
```

- [ ] **Step 4: The navigation test knows the entry**

Apply to `web/e2e/lighting.spec.ts`:

```diff
diff --git a/web/e2e/lighting.spec.ts b/web/e2e/lighting.spec.ts
--- a/web/e2e/lighting.spec.ts
+++ b/web/e2e/lighting.spec.ts
@@ -219,7 +219,7 @@ test("a keyboard without lighting has no Lighting page and says nothing of light
   // settings), the Keymap too: its keycode picker offers no lighting keys on a keyboard without lighting, though Qt's
   // always does. (Outside <main>, the theme switch's "Light" is no lighting either.)
   const names = await nav.locator("button > span").allTextContents();
-  expect(names).toEqual(["Keymap", "Layout", "Macros", "Matrix tester", "Keyboard"]);
+  expect(names).toEqual(["Keymap", "Layout", "Macros", "Learning", "Matrix tester", "Keyboard"]);
   for (const name of names) {
     await openSection(macropad, name);
     await expect(macropad.locator("main")).not.toContainText(/lighting|RGB|backlight/i);
```

- [ ] **Step 5: svelte-check and the build pass, with every file in**

```bash
cd web && npm run check
```

Expected: `COMPLETED 329 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.

```bash
cd web && npm run build
```

Expected: `✓ 348 modules transformed.` and `✓ built in`.

- [ ] **Step 6: Commit**

```bash
git add web/src/learning/FingersView.svelte \
  web/src/learning/LearningPage.svelte \
  web/src/App.svelte \
  web/e2e/lighting.spec.ts
git commit -m "feat(web): the Learning page: lesson list, lesson, typing and Fingers views" \
  -m "A Learning section on every keyboard, its views by the address path: the lesson list, a lesson, typing an exercise and Fingers (rings by finger, a panel per key, Reset, Export as a download). What the address names and isn't here goes back to the list with a note. The macropad's navigation lists Learning." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: The e2e tests, the README, and the whole picture

The page pinned end to end against the simulated Corne, then the README, then every check of the phase together. The spec imports the worked example (`docs/learning/examples/corne-sim-en.json`, the set the skill wrote for the simulated Corne) through the page's Import button and, in a `finally`, removes the set, the fingers and the settings through the API (`api(page).delete` from Task 10): the servers are shared by a worker's tests. Its nine tests: the example imports, lists its lessons with empty states and isn't out of date; lesson 1's first exercise typed with the keyboard passes, is recorded (the progress API agrees) and the row says "1 of n done"; a wrong key counts an error and the right one goes on; a `blind` exercise hides the picture while a `keys` exercise shows it with one key lit and the rest faded; a set is out of date after a key is moved (`setCodeAt`, put back); the Fingers view rings every key, a finger change saves, Reset puts the proposal back, and Export downloads `Simulated Corne-layout-export.json` in the export format; no sideways scroll at 800 × 900 and 375 × 812 on the list, the typing view and Fingers; and the typing view with the picture and six lines of `text` fits 1920 × 950. The test that moves a key is the only one that touches the (simulated) keyboard.

The README gets what CLAUDE.md asks for a phase: a **Learning** bullet under "What it does" (every sentence true for the code: the fingers proposal and its correction, the export for the skill, the import, the next key lit, accuracy and speed per keyboard, the pass accuracy and the star, nothing written to the keyboard), the phase 9 row of the status table, and the files table's column for `learning/<keyboard uid>/`. The diff below is the prototype's, except the status row: the status row says **done**, not the prototype's "prototype (branch proto-phase9)" wording, and the Learning bullet drops its "(prototype)".

Two commits, as the prototype has them: the tests, then the docs.

**Files:**
- Test: `web/e2e/learning.spec.ts` (new)
- Modify: `README.md`

- [ ] **Step 1: The spec**

Create `web/e2e/learning.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, expect, keyIndex, openSection, restoreAll, screenshots, setCodeAt, test } from "./fixtures";

// The Learning page on the simulated Corne: the worked example imported, a lesson typed with the keyboard, the
// picture per exercise kind, the out-of-date banner, the Fingers view and its export, and the widths. Nothing here
// touches the keyboard but the one key the out-of-date test moves and puts back; the lesson set, the fingers and the
// settings are the server's files, put back after each test (the servers are shared by a worker's tests).

const EXAMPLE = fileURLToPath(new URL("../../docs/learning/examples/corne-sim-en.json", import.meta.url));
const example = JSON.parse(readFileSync(EXAMPLE, "utf-8")) as {
  id: string; title: string;
  lessons: { id: string; title: string; exercises: { id: string; kind: string; title: string; lines: string[] }[] }[];
};
const SET = example.id;
const [lesson1, lesson2] = example.lessons;
const DEFAULT_SETTINGS = { passAccuracy: 95, targetWpm: 30, pictureInWords: true };

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Imports the example through the page's Import button */
async function importExample(page: Page) {
  await openSection(page, "Learning");
  await page.locator('input[type="file"]').setInputFiles(EXAMPLE);
  await expect(page.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET);
}

/** Removes the set, the fingers and the settings: what the tests change on the server */
async function putBack(page: Page) {
  await restoreAll(
    async () => {
      const response = await api(page).delete(`/api/learning/sets/${SET}`);
      if (response.status() !== 204 && response.status() !== 404) throw new Error(`delete: ${response.status()}`);
    },
    () => api(page).delete("/api/learning/fingers"),
    () => api(page).put("/api/learning/settings", DEFAULT_SETTINGS),
  );
}

/** Opens a lesson's exercise from the list */
async function openExercise(page: Page, lesson: { title: string }, exercise: { title: string }) {
  await page.getByRole("button", { name: new RegExp(`^\\d+\\s*${lesson.title}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`· ${lesson.title}$`) })).toBeVisible();
  // the row's name is its kind, title and best: the title alone tells the rows apart ("Key exercise 1" is in "New key
  // exercise 1" too)
  await page.locator(".exercise", { has: page.locator(".title", { hasText: new RegExp(`^${exercise.title}$`) }) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`· ${exercise.title}$`) })).toBeVisible();
  await expect(page.getByRole("application", { name: "Typing area" })).toBeFocused();
}

async function attemptsOf(page: Page, exercise: string): Promise<number> {
  const progress = await (await api(page).get(`/api/learning/progress/${SET}`)).json();
  return progress.exercises[exercise]?.attempts.length ?? 0;
}

test("the example imports, lists its lessons with empty states, and isn't out of date", async ({ app }) => {
  try {
    await importExample(app);
    await expect(app.getByRole("option", { name: example.title })).toHaveCount(1);
    const rows = app.getByRole("list", { name: `Lessons of ${example.title}` }).getByRole("button");
    await expect(rows).toHaveCount(example.lessons.length);
    for (const [i, lesson] of example.lessons.entries()) {
      await expect(rows.nth(i)).toHaveText(new RegExp(`^${i + 1}\\s*${lesson.title}\\s*$`));
    }
    await expect(app.getByText("Built for another layout.")).toHaveCount(0);
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-list");
  } finally {
    await putBack(app);
  }
});

test("typing lesson 1's first exercise passes it, records the attempt, and the lesson row says so", async ({ app }) => {
  const exercise = lesson1.exercises[0];
  try {
    await importExample(app);
    const before = await attemptsOf(app, exercise.id);
    await openExercise(app, lesson1, exercise);
    await expect(app.locator(".board")).toHaveCount(1);
    await app.keyboard.type(exercise.lines.join(" "));
    const result = app.getByRole("region", { name: "Passed" });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Accuracy100.0 %");
    await expect(result).toContainText("Errors0");
    await expect(result.getByRole("status")).toHaveText("Saved.");
    expect(await attemptsOf(app, exercise.id)).toBe(before + 1);
    const best = (await (await api(app).get(`/api/learning/progress/${SET}`)).json()).exercises[exercise.id].best;
    expect(best.accuracy).toBe(100);
    expect(best.chars).toBe(exercise.lines.join(" ").length);

    // back in the list: one of the lesson's main exercises is done
    const main = lesson1.exercises.filter((e) => ["new-keys", "keys", "words", "blind", "text"].includes(e.kind)).length;
    await app.getByRole("button", { name: "Back to the lesson" }).first().click();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await expect(app.getByRole("button", { name: new RegExp(`^1\\s*${lesson1.title}`) })).toContainText(`1 of ${main} done`);
  } finally {
    await putBack(app);
  }
});

test("a wrong key counts an error, and the right one goes on", async ({ app }) => {
  const exercise = lesson1.exercises[1];
  try {
    await importExample(app);
    await openExercise(app, lesson1, exercise);
    const text = exercise.lines.join(" ");
    const wrong = text[0] === "x" ? "q" : "x";
    await app.keyboard.type(wrong);
    await expect(app.locator(".run.wrong")).toHaveCount(1);
    await app.keyboard.type(text);
    const result = app.getByRole("region", { name: "Passed" });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Errors1");
    const accuracy = await result.locator("dd").first().textContent();
    expect(parseFloat(accuracy ?? "100")).toBeLessThan(100);
    expect(parseFloat(accuracy ?? "0")).toBeGreaterThan(95);
    await expect(result.getByRole("status")).toHaveText("Saved.");
  } finally {
    await putBack(app);
  }
});

test("a blind exercise hides the picture; a keys exercise shows it with the next key lit", async ({ app }) => {
  const blind = lesson2.exercises.find((e) => e.kind === "blind")!;
  const keys = lesson1.exercises.find((e) => e.kind === "keys")!;
  try {
    await importExample(app);
    await openExercise(app, lesson2, blind);
    await expect(app.locator(".board")).toHaveCount(0);
    await app.keyboard.press("Escape");
    await expect(app.getByRole("heading", { level: 1, name: new RegExp(`· ${lesson2.title}$`) })).toBeVisible();
    await app.getByRole("button", { name: "Back to lessons" }).click();

    await openExercise(app, lesson1, keys);
    await expect(app.locator(".board")).toHaveCount(1);
    await expect(app.locator(".board .key.found")).toHaveCount(1);
    await expect(app.locator(".board .key.faded").first()).toBeVisible();
    await expect(app.getByText(/^Next: /)).toBeVisible();
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-typing");
  } finally {
    await putBack(app);
  }
});

test("a set built for another character map is out of date", async ({ app }) => {
  const index = await keyIndex(app, 1, 1);
  const before = (await (await api(app).get("/api/keyboard")).json()).layers[0].keys[index].code as string;
  try {
    await importExample(app);
    await expect(app.getByText("Built for another layout.")).toHaveCount(0);
    await setCodeAt(app, 0, index, "KC_Q");
    await app.reload();
    await openSection(app, "Learning");
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET);
    await expect(app.getByText("Built for another layout.")).toBeVisible();
  } finally {
    await restoreAll(() => setCodeAt(app, 0, index, before), () => putBack(app));
  }
});

test("the Fingers view rings every key by finger, and the export downloads the layout", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    await app.getByRole("button", { name: "Fingers…" }).click();
    await expect(app.getByRole("heading", { level: 1, name: "Fingers" })).toBeVisible();
    const keys = app.locator(".board .key");
    await expect(keys.first()).toBeVisible();
    expect(await app.locator(".board .key.ringed").count()).toBe(await keys.count());
    expect(await app.locator('.board .key[aria-pressed="true"]').count()).toBeGreaterThan(0);

    // a key's finger changed, saved; back to the proposal
    await keys.first().click();
    await app.getByRole("combobox", { name: "Finger" }).selectOption("thumb");
    await expect.poll(async () => (await (await api(app).get("/api/learning/fingers")).json()).proposal).toBe(false);
    await app.getByRole("button", { name: "Reset to proposal" }).click();
    await app.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await expect.poll(async () => (await (await api(app).get("/api/learning/fingers")).json()).proposal).toBe(true);

    const waiting = app.waitForEvent("download");
    await app.getByRole("button", { name: "Export" }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe("Simulated Corne-layout-export.json");
    const text = readFileSync((await download.path())!, "utf-8");
    const layout = JSON.parse(text);
    expect(layout.format).toBe("vial-web-layout-export/1");
    expect(layout.keys.length).toBeGreaterThan(0);
    await expect(app.getByRole("status").filter({ hasText: "generate-lessons" })).toBeVisible();
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-fingers");
  } finally {
    await putBack(app);
  }
});

for (const [width, height] of [[800, 900], [375, 812]] as const) {
  test(`${width} x ${height}: the list and the typing view have no sideways scroll`, async ({ app }) => {
    const exercise = lesson1.exercises[0];
    try {
      await app.setViewportSize({ width, height });
      await importExample(app);
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
      await openExercise(app, lesson1, exercise);
      await expect(app.locator(".board")).toHaveCount(1);
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
      await app.getByRole("button", { name: "Back to the lesson" }).click();
      await app.getByRole("button", { name: "Back to lessons" }).click();
      await app.getByRole("button", { name: "Fingers…" }).click();
      await expect(app.locator(".board .key").first()).toBeVisible();
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    } finally {
      await putBack(app);
    }
  });
}

test("1920 x 950: the typing view with the picture and six lines of text fits the window", async ({ app }) => {
  const text = lesson2.exercises.find((e) => e.kind === "text")!;
  try {
    await app.setViewportSize({ width: 1920, height: 950 });
    await importExample(app);
    await openExercise(app, lesson2, text);
    const board = (await app.locator(".board").boundingBox())!;
    expect(board.y).toBeGreaterThanOrEqual(0);
    expect(board.y + board.height).toBeLessThanOrEqual(950);
    const area = (await app.getByRole("application", { name: "Typing area" }).boundingBox())!;
    expect(area.y + area.height).toBeLessThanOrEqual(950);
    // the text's lines one under another, at most six in view
    await expect(app.locator(".text br")).toHaveCount(text.lines.length - 1);
  } finally {
    await putBack(app);
  }
});
```

- [ ] **Step 2: Run it against a fresh build**

```bash
cd web && npm run build && npx playwright test e2e/learning.spec.ts
```

Expected: `9 passed`.

- [ ] **Step 3: The whole e2e suite**

```bash
cd web && npx playwright test
```

Expected: `221 passed`.

- [ ] **Step 4: Commit the tests**

```bash
git add web/e2e/learning.spec.ts
git commit -m "test(web): Learning e2e: import, typing, the picture per kind, out of date, Fingers, widths" \
  -m "Against the simulated Corne: the worked example imported through the page, lesson 1's first exercise typed with the keyboard (passed, recorded, the row says 1 of n done), a wrong key counted, the blind exercise without the picture and a keys exercise with the next key lit, the out-of-date banner after a key moved, the Fingers rings and the export download, no sideways scroll at 800 and 375 px and the typing view inside 1920 x 950." \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: The README**

Apply to `README.md`:

```diff
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -28,6 +28,12 @@ releases, see [get.vial.today](https://get.vial.today/).
 - **Tap dance, combos, macros, key overrides, alt-repeat:** a page each. Macros can be edited as text or recorded.
 - **QMK settings, lighting, layout options, matrix tester, reboot to bootloader.**
 - **Layout files:** save the whole layout to a `.vil` file and load one back, with a preview of what it changes.
+- **Learning:** a typing course for your own layout. The Fingers view proposes which finger rests on and
+  reaches each key (correct it where it is wrong) and exports the layout for the `generate-lessons` skill in Claude
+  Code, which writes a lesson set; import it, and type the lessons with the next key lit on the keyboard picture.
+  Accuracy and speed are recorded per keyboard; a lesson passes at the pass accuracy, a star at the target speed
+  ([design](docs/superpowers/specs/2026-10-21-learning-design.md), [file formats](docs/learning/lesson-format.md)).
+  Nothing is written to the keyboard.
 - Several keyboards plugged in: choose which one to edit. Unlocking, when the keyboard asks for it.
 - Light and dark themes; key legends in your keyboard language.
 
@@ -44,6 +50,7 @@ releases, see [get.vial.today](https://get.vial.today/).
 | 6 | One executable per system (PyInstaller); Qt and fbs removed; Quit Vial; CI on Windows, Linux and macOS | done |
 | 7 | Firmware flasher (its logic is in `src/main/python/protocol/flasher.py`, without a UI yet) | optional |
 | 8 | Arrange layers: move layers, every layer reference and name follows ([design](docs/superpowers/specs/2026-10-21-arrange-layers-design.md)) | done (0.9.0) |
+| 9 | Learning: a typing course generated from the layout ([design](docs/superpowers/specs/2026-10-21-learning-design.md), [file formats](docs/learning/lesson-format.md)) | done |
 
 Design: [`docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`](docs/superpowers/specs/2026-10-15-vial-web-ui-design.md).
 Roadmap: [`docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`](docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md).
@@ -123,7 +130,7 @@ printed link.
 
 Never next to the executable, and never in the folder the executable unpacks itself to while it runs:
 
-| System | Lock, session file, log (`vial.log`) | Layer, tap dance and macro names (`names.json`) |
+| System | Lock, session file, log (`vial.log`) | Layer, tap dance and macro names (`names.json`); Learning's lesson sets, progress and fingers (`learning/<keyboard uid>/`) |
 |---|---|---|
 | Windows | `%LOCALAPPDATA%\Vial` | `%LOCALAPPDATA%\Vial` |
 | Linux | `~/.local/share/Vial` | `~/.config/Vial` |
```

- [ ] **Step 6: Read the whole README against the phase**

CLAUDE.md's rule: before a phase counts as finished, read the whole of `README.md` section by section against what the phase changed, and say in the report what was updated or that a section needed no change. Go through its sections in order — the introduction, "What it does", "Status", "Download and run" with "Quit", "Command-line options" (the phase adds no option) and "Where Vial keeps its files" (the files table: the lesson sets, progress and fingers under `learning/<keyboard uid>/`), "Development" with "Tests" (the commands; any counts the README states) and "Building the executable" (the one-file build packs nothing new), "License" — and check each sentence that touches Learning against the code of Tasks 1–12 and `docs/learning/lesson-format.md`. Note what you updated beyond the diff (if anything) and which sections you checked and left; the report of this task says so.

- [ ] **Step 7: Commit the docs**

```bash
git add README.md
git commit -m "docs: README describes Learning, phase 9 and its files" \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: The whole picture**

Every check of the phase, from a clean build:

```bash
cd web && npm run check && npm test && npm run build && npm run check:api
```

Expected: `COMPLETED 329 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`, `Test Files  60 passed (60)`, `Tests  931 passed (931)`, `✓ 348 modules transformed.`, and `src/api/schema.d.ts is up to date` (exit 0).

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1316 passed, 6 skipped`.

```bash
git status --short
```

Expected: nothing but the untracked files that were there before (`STATUS.md`, `gh.txt`): every file of the phase is committed.
