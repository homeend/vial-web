# Phase 8: Arrange layers (move layers, references follow) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an **Arrange layers** dialog moves layers to other positions in one Apply. Every key that reaches a layer by its number follows it (keymap, encoders, tap dance, combos, key overrides and their layers, alt-repeat keys, macros), and so do the layer names. One Undo reverses it. An arrange that stops partway (a write fails) can be finished or put back, from the dialog or from a bar on the Keymap page.

**Architecture:**
- **One definition of the layer keycodes.** `describe.REFERENCES[protocol]` lists, for protocols 5 and 6, every keycode range that points at a layer, tap dance or macro, with the bits that hold the number (`Reference`). `describe.reference()` (validation), `describe._layer_mod()` and the new `layers.renumber()` all use it; `QK_LAYER_MOD` and `TRI_LAYER_KEYS` are derived from it.
- **`server/layers.py` is pure.** `arrange(state, order, protocol)` takes a `KeyboardState` (integers only) and an order (`order[new position] = old layer`) and returns an `Arrangement`: the target state, the moves, the counts, the tri-layer warning and the problems.
- **`server/arranger.py` does the I/O** under the device lock: it reads the loaded keyboard into a `KeyboardState`, plans only the writes that differ, in a fixed order (keymap, encoders, tap dance, combos, key overrides, alt-repeat keys, macros), and writes them. The layer names move last (`NamesStore.move_layers`), once every write succeeded. An arrange that stops partway is kept by keyboard UID while the server runs, for Finish or Put back.
- **Routes:** `POST /api/layers/arrange/preview`, `POST /api/layers/arrange`, `POST /api/layers/arrange/finish`, `POST /api/layers/arrange/put-back`; `Session.arrange` says whether an arrange of the loaded keyboard is unfinished. Fake mode adds `PUT /api/simulator/fail-write`, which makes a write fail, for the tests.
- **Web:** the store's `arrangeLayers` / `finishArrange` / `putBackArrange` go through `#edit` (busy, pending, 423 → unlock → resend). `keymap/arrange.ts` holds the order logic, the wording and the preview follower (300 ms pause, stale answers dropped); `arranging.svelte.ts` (`layerArranger`) opens the dialog, applies, offers Undo and keeps the Edit view on its layer. `ArrangeDialog.svelte` shows the rows, the summary and the stopped state; `ArrangeBar.svelte` stays on the Keymap page until Finish or Put back succeeds.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2.14.1, pytest 9.1.1 with pytest-xdist 3.8.0.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0 (`npm run gen:api`).
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependency: `requirements.txt`, `test-requirements.txt`, `web/package.json` and `web/package-lock.json` don't change.

**Design (scope contract):** `docs/superpowers/specs/2026-10-21-arrange-layers-design.md`, agreed with the owner on 2026-10-21. Phase 6 is done and on `main`; phase 7 (the flasher UI) stays optional.

**Source:** the verified prototype, branch `proto-phase8` (13 commits on `main` at `04968f7`, ending at `9767f1f`). Applied in order, the tasks below give exactly its code.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `--fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e fixtures start it exactly like that. pytest uses the in-process simulator.
   - This feature writes to the keyboard: the owner is the first to use it on real hardware (owner checklist). Never run Vial without `--fake`.
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry.
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
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency: `web/package.json` and `web/package-lock.json` don't change. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **Downloads:** only the pinned packages from PyPI (into this checkout's `.venv`) and from npm (inside `web/`). No other binaries, installers or scripts.
7. **End-to-end tests run in parallel** (`web/README.md`, "End-to-end tests"): half the cores by default, `E2E_WORKERS=<n>` to choose. Each Playwright worker starts its own fake servers.
   - Every test puts back what it changed, in a `finally`. An arrange moves layer names, so the arrange tests save and put back every layer's name, not only the ones they set.
   - `npm run e2e` builds first; `npx playwright test <spec>` runs against the last build.
8. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
9. **Line endings and encodings:** Windows checkouts use CRLF (`core.autocrlf=true`); the repository stores LF.
   - Edit with tools that keep the existing line endings. Git Bash's `sed -i` strips the CRs; use an editor, or Python with `newline=''`. `git apply` keeps them.
   - Python's default encoding here is cp1250: a script that writes files must open them with `encoding="utf-8"` and `newline=''`, or "…", "←" and "⚠" break.
   - Bash heredocs can mangle `\\` and some quoting: write code with an editor, not with `echo` or a heredoc.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
   - Check a written file with `git diff` before committing.
10. **Commits:** one commit per task, on branch `phase8-arrange-layers`.
    - Add the files the task names. Never `git add -A`. Leave the untracked `gh.txt` and `STATUS.md` alone.
    - End every commit message with the trailer the session tells you to use.
11. **How code is given.**
    - "Create `X`:" is followed by the file's complete content.
    - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
    - A file changed by several tasks has one diff in each (`test_layers.py`: Tasks 1, 2 and 3). The tasks are in order, so each diff applies to what the task before left.
    - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it in Task 5, in the same commit as the schema change.
    - Each "Expected:" lists text that the command's output contains.
12. **Standing rules (owner and earlier phases)**, for the dialog, its buttons and the bar:
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the keymap's content is at most 1100 px, the list and settings pages at most 860 px (`--list-max`), both centred. The dialog is at most 620 px wide and inside the window at every size.
    - Heights: the owner uses a 1080p screen, which leaves about 1920 × 950 px for the page; the dialog fits there, with its longest warning.
    - Nothing scrolls sideways at 800 px or at 375 px.
    - Anything the user typed (layer, tap dance and macro names) is cut short with "…" and a tooltip with the full name wherever it shows.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike. A disabled button shows no tooltip in Firefox, so the Arrange buttons use `aria-disabled` with a `title`.
    - Both themes, light and dark, must read well.
    - Focus is always visible, and it never falls to `<body>`: when a focused button goes, the focus moves to what replaces it or to the page heading.
    - Every sentence about what the keyboard or Vial does is true for the vial-qmk firmware and for this code (the firmware checks are in the Decisions).
    - Each page says how saving works: the dialog says "Nothing is written until you Apply.", its stopped state "Finish and Put back write to the keyboard at once."
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

Phase 6 is on `main` (at `04968f7` or later), and `phase8-arrange-layers` is branched from it. `.venv` exists (Python 3.13, `test-requirements.txt` installed), and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1114 passed, 6 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  817 passed (817)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

```bash
cd web && npm run e2e
```

Expected: `192 passed`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/server/describe.py` | `Reference` (`number`, `largest`, `with_number`), `REFERENCES[protocol]`, `reference_range()`: the one definition of the keycodes that point at a layer, tap dance or macro; `reference()` and `_layer_mod()` use it; `QK_LAYER_MOD` and `TRI_LAYER_KEYS` derived from it; `_protocol()` renamed `keycode_protocol()` |
| `src/main/python/server/layers.py` | **new.** Pure: `KeyboardState`, `Arrangement`, `Problem`, `check_order`, `mapping_of`, `reverse`, `renumber`, `move_mask`, `arrange`; `DoesNotFit`, `BadOrder`; `PLACES`, `KO_LAYER_BITS`, `TRI_LAYERS` |
| `src/main/python/server/names.py` | `NamesStore.move_layers(uid, order)`: the layer names follow their layers, in one write; the file write shared as `_save()` |
| `src/main/python/simulator/virtual_keyboard.py` | `VirtualKeyboard.fail_writes(after, unplug)`, `is_write()`, `SimulatedWriteFailure`: the Nth write fails, as a dead handle or an unplug |
| `src/main/python/server/device.py` | `FakeBackend.fail_writes()`: the hook on the first simulated keyboard |
| `src/main/python/server/arranger.py` | **new.** The I/O: `read_state`, `Plan` (`writes`, `needs_unlock`), `plan`, `write`, `preview`, `Job`, `begin`, `resume`, `Arrangements`, `Unfinished`; `ArrangeRefused` (409), `NothingUnfinished` (404) |
| `src/main/python/server/schemas.py` | `LayerMove`, `ArrangeReferences`, `ArrangePreview`, `UnfinishedArrange`, `ArrangeIn`, `SimulatorFailWrite`; `Session.arrange` |
| `src/main/python/server/app.py` | the routes preview, arrange, finish, put-back and (fake only) fail-write; the 409 and 404 handlers; `Session.arrange` |
| `src/main/python/test/test_layers.py` | **new.** `renumber` on every family and both protocols, orders, `move_mask`, `arrange` in every place, the tri-layer warning, problems, round trips with names; `describe.py`'s ranges pinned to the firmware's |
| `src/main/python/test/test_names.py` | `move_layers`: names move, nothing written when nothing moves, one write that keeps the old file on failure |
| `src/main/python/test/test_arrange.py` | **new.** The routes against the simulator: preview, Apply, round trips, a keyboard switch, unlock, problems, a write failing partway with Finish and Put back, an unplug, the fail-write hook, encoders |
| `src/main/python/test/test_api.py` | the session has `arrange: null` |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` (Task 5) |
| `web/src/api/api.ts`, `types.ts` | `previewArrange`, `arrangeLayers`, `finishArrange`, `putBackArrange`; `ArrangePreview`, `ArrangeReferences`, `UnfinishedArrange` |
| `web/src/lib/keyboard.svelte.ts` | `arrangeLayers`, `finishArrange`, `putBackArrange`, `refreshSession`, `unfinishedArrange`; `#edit` takes an optional `report` |
| `web/src/lib/toasts.svelte.ts` | `toasts.info` returns the toast's id |
| `web/src/keymap/arrange.ts` | **new.** The order logic (`moveTo`, `moveStep`, `canStep`, `reverseOrder`, `positionAfter`, `nameAfter`), the wording (`summaryText`, `triLayerWarning`, `writingLabel`, `stoppedText`, `arrangeBlocked`, `unsavedQuestion`) and `PreviewFollower` |
| `web/src/keymap/arrange.test.ts` | **new.** Vitest of the above |
| `web/src/keymap/arranging.svelte.ts` | **new.** `layerArranger`: the question about work not saved, opening, Apply, the Undo toast, Finish and Put back, the Edit view following its layer, the focus given back |
| `web/src/keymap/ArrangeDialog.svelte` | **new.** The dialog: rows with handle, ↑/↓, "← was N" and how the layer is reached; drag; the summary with its flags by the footer; the stopped state |
| `web/src/keymap/ArrangeBar.svelte` | **new.** The bar after a stop: Finish and Put back |
| `web/src/keymap/LayerTabs.svelte` | the "Arrange layers…" button after the tabs |
| `web/src/keymap/KeymapPage.svelte` | the Overview's button, the bar, the dialog and the question |
| `web/e2e/arrange.spec.ts` | **new.** Arrange layers end to end, at five window sizes, with screenshots |
| `web/e2e/servers.ts`, `fixtures.ts` | the 20-layer fake server and its `twentyLayers` fixture |
| `web/README.md` | the fail-write hook, the 20-layer server, the `arrange` spec |

## Decisions

These come from the design and the verified prototype (`proto-phase8`).

1. **The order format.** An order lists, for each new position, the layer that goes there: `order[new position] = old layer`. `[0, 3, 1, 2]` puts layer 3 at position 1, and layers 1 and 2 after it. The server answers 422 (`BadOrder` in `layers.py`) to an order that doesn't hold every layer once. **Layer 0 is fixed:** `order[0]` must be 0, as the keyboard starts on it. The preview gives the moves as `{layer, to}` (the layer's position now, its new position): `from` would be a Python keyword.
2. **What is renumbered, and where.** `layers.arrange` renumbers, through `describe.REFERENCES`:
   - the keymap and the encoders: each layer's keys go to the layer's new position, and every keycode in them is renumbered;
   - tap dance: tap, hold, double tap and tap-hold;
   - combos: the four keys and the output;
   - key overrides: the trigger and the replacement, and the bits of "active on layers" move with their layers;
   - alt-repeat keys: the keycode and the alt keycode;
   - macros: every keycode of every tap, down and up step (the firmware runs a macro's keycodes through `action_exec`, so a layer key in a macro really switches layers).
   - The keycodes renumbered are MO, TG, TO, TT, OSL, DF and PDF, LT and LM, with each protocol's bit layout. Only the number's field changes; every other bit is kept (LT's tapped key, LM's modifiers, protocol 5 TO's "when it acts" bits 4–5).
   - Nothing else holds layer numbers: QMK settings, lighting and layout options are left alone. A layer reference to a layer the keyboard doesn't have stays as it is.
   - `server/layers.py` is pure (integers in, integers out); `server/arranger.py` reads the keyboard into a `KeyboardState` and writes the target back.
3. **Names.** `NamesStore.move_layers` moves the names in one write of `names.json`, after every keyboard write succeeded. A layer that was never named has no name to take along: it shows its new position's default name. The dialog shows each row's name as it will be after Apply (`nameAfter`: "Layer 1 ← was 3"), so nothing changes by surprise.
4. **Writing.** Apply computes the target again from what the keyboard holds now (never from the preview) and writes only what differs, under one device lock, in this order: keymap, encoders, tap dance, combos, key overrides, alt-repeat keys, then the macro buffer (one write); the names last. A macro whose steps don't change keeps its exact bytes. `Plan.needs_unlock()` follows the protocol layer's rules (QK_BOOT written anywhere, or the macros changed): such an arrange answers 423 before anything is written, and the store's existing 423 → unlock → resend path runs. Every tab gets `{"type": "reloaded"}` afterwards.
5. **An arrange that stops partway.**
   - The server keeps its start state S and target T, by the keyboard's UID, while it runs (`Arrangements`), and reads the keyboard again (`resync()`).
   - **"May hold part of the new order":** even a failure at the first write keeps the arrange unfinished, because the keyboard may have taken the write and its answer been lost.
   - **Finish** writes what still differs from T, then moves the names; **Put back** writes what differs from S (the names never moved). Either can be retried as often as needed, and nothing is renumbered twice; each answers 404 when nothing is unfinished.
   - `Session.arrange` (`{order, done, total}`) tells every tab, also after a reload, so the dialog shows its stopped state and the Keymap page the bar. A new arrange is refused (409) meanwhile.
6. **Undo** arranges with the reverse order (`reverseOrder`), from the toast "Layers arranged." Because it renumbers rather than restores a copy, it stays right after keys were edited in between. It is also offered after Finish. The next arrange dismisses the previous Undo toast (`toasts.info` returns its id).
7. **Empty key overrides keep their mask.** An entry with no trigger and no replacement does nothing; the firmware's reset mask is 0xFFFF, which would make every move past position 15 a "problem" for it. Set key overrides follow the design exactly.
8. **The tri-layer keys** (FN_MO13, FN_MO23) are never renumbered: they hold no layer number of their own.
   - On protocol 5, `via.c` hard-codes `layer_on(1)`, `layer_on(2)` and `update_tri_layer(1, 2, 3)`.
   - On protocol 6 they are `QK_TRI_LAYER_LOWER`/`UPPER`, and `tri_layer.c` uses `TRI_LAYER_LOWER_LAYER 1`, `UPPER 2`, `ADJUST 3` by default; firmware code can change them (`set_tri_layer_layers()`).
   - When one is set anywhere and any of layers 1–3 moves, the preview's `triLayer` gives the layers that end up at positions 1, 2 and 3. The dialog warns, naming each change by where the layers were ("Fn1 turns on the layer that was 3 (“Num”) instead of the one that was 1"); on protocol 6 it adds "(the firmware's tri-layer layers, unless its code sets others)". The warning doesn't block Apply.
9. **Problems block Apply** (and the server answers 409): a layer number that doesn't fit the field of the key that must hold it. LT and LM hold layers 0 to 15 on both protocols (TO too on protocol 5); a key override's mask is 16 bits, so a layer in it can't go past position 15. Each problem says where ("layer 2, row 0, column 4: LT keys hold layers 0 to 15: layer 2 can't go to position 19").
10. **The summary stays in view.** The rows scroll on their own; the summary is a separate region between the rows and the footer (at most 40 % of the window's height, scrolling inside when longer). With a problem or the tri-layer warning it starts with a line of flags ("Can't apply: 3 layer numbers wouldn't fit", "⚠ Fn1 and Fn2 will reach other layers") that stays put; each flag scrolls its full text into view. The e2e tests check the flags, the summary's first line and Apply with `toBeInViewport` at 375 × 740, 800 × 900 and 1920 × 950, with 8 and with 20 layers.
11. **The fake fail-a-write hook:** `PUT /api/simulator/fail-write {"after": N, "unplug": bool}`, fake mode only and left out of the schema. The Nth write packet fails with `SimulatedWriteFailure`, a `ValueError` as hidapi raises for a dead handle, so the protocol's retries don't run. Without `unplug` the handle is broken and the next hot-plug poll opens the keyboard again; with it the keyboard is gone until the connection hook plugs it back in.
12. **The dialog's behaviour.**
    - Each row: the position, the drag handle (a `<button>`), the name as it will be, "← was N" once it moved, one line of how the layer is reached (the Overview's labels), and ↑/↓ buttons.
    - Alt+↑/↓ move a row (on its handle or its ↑/↓ buttons); plain ↑/↓ go from handle to handle. The first movable row's handle takes the focus on open.
    - The preview is asked for 300 ms after the last change; an answer is used only while its order is still shown and no later request's answer was used.
    - ↑/↓, Reset, Cancel and Apply use `aria-disabled`, so the focus is never dropped. While writing, Apply keeps the focus and reads "Writing 94 keys…" ("Writing 96 changes…" with other writes); Esc waits.
    - On close, the focus returns to the button that opened the dialog; when the bar goes after Finish or Put back, to the page heading.
    - Work not saved (`unsavedWork`) is asked about first ("Arrange the layers?").
    - The bar shows in the Overview as well as the Edit view. The Overview has its own "Arrange layers…" button above the cards, outside the Overview's region, so the Overview tests that count the buttons in that region still hold.
13. **Measured Apply time.** The design's example (layer 3 to position 1 on the simulated Corne: 94 writes, all keymap keys), measured in process over HTTP, 20 runs: Apply median 31.7 ms (28.2–58.3), Undo 32.1 ms, preview 15.7 ms. **The simulator has no USB latency:** a real keyboard answers each 32-byte request in about 1–8 ms, so 94 writes probably take about 0.1–0.8 s on the W-CORNE. Nothing was measured on hardware.

## Out of scope / later

- **Auto-scrolling the list while dragging.** With many layers the rows scroll inside the dialog, and a drag reaches only the visible rows; the keyboard and the ↑/↓ buttons reach every position.
- **An e2e test of the unlock flow for Apply.** pytest covers the 423 before any write (`test_unlock_comes_first_when_qk_boot_must_move`), and Apply goes through the store's existing 423 → unlock → resend path, which has no new code.
- **Other tabs don't follow the moved layer.** They reload and keep their Edit view on the same number; only the tab that arranged follows the layer.
- **The 502/503 detail.** `errorMessage()` ignores `detail` for 502 and 503, so the server's "the keyboard didn't respond: …" never reaches the page: the dialog shows "Arranging the layers failed: The keyboard didn't respond."
- **The session without the UID.** `Session` doesn't carry the loaded keyboard's UID, so the page can't tell which keyboard an unfinished arrange belongs to. It works because `Session.arrange` is computed for the loaded keyboard only; while that keyboard is unplugged, the dialog shows the 503 inline, and after the replug the stopped state and the bar come back.
- **The hot-plug-poll delay after a failed write.** Without `unplug`, the server answers 502, its `resync()` fails (the handle is broken), and the keyboard comes back through the hot-plug poll about a second later. The page copes (Finish and Put back wait for `canEdit`); the resync could reopen a broken handle itself.
- **The protocol 6 macro range.** `describe.REFERENCES` treats 0x7700–0x77FF as macros, as `describe.py` did before this phase. vial-qmk's `QK_MACRO_MAX` is 0x777F: 0x7780–0x77BF is `QK_CONNECTION` and 0x77C0–0x77FF `QK_COMMUNITY_MODULE`, so `reference()` reads such a keycode as "macro 128+" and `edits.code()` refuses it. Fixing it changes existing behaviour; it is not about layers.
- **`#edit`'s `report`** is new here; the other dialogs that act like `ConfirmDialog` could use it instead of a toast.
- **Not included by the design:** a live write counter, a general undo history, copying layers.

## Owner checklist (after the last task)

The owner runs this, not you, on the W-CORNE. It writes to the keyboard.

1. **First, save a backup:** Keyboard page → save the layout as a `.vil` file.
2. **Open Arrange layers** (the button after the layer tabs, or above the Overview's cards). Check the rows, the names, the "how reached" lines, the summary and any tri-layer warning.
3. **Move one layer one step,** Apply. Check the tabs, the names, and that the layer keys still reach the same layers on the real keyboard (type a little). Then Undo from the toast and check again.
4. **A larger reorder,** Apply, and try it on the keyboard. Then put it back, with Undo or with the dialog.
5. **Esc and Cancel write nothing:** open the dialog, move layers, close it with Esc, then with Cancel; the layers stay as they were.
6. **Firefox at 1080p, both themes:** the dialog fits, nothing scrolls sideways, long names are cut with "…" and their tooltip shows them whole.

---

### Task 1: One definition of the keycodes that point at a layer, tap dance or macro

`describe.py` had two private tables of the ranges that point at a layer, tap dance or macro (`_REFERENCES_V6`, `_REFERENCES_V5`), each with a lambda that read the number, plus its own copies of the LM range and the tri-layer keys. Arranging layers must also *write* a new number into the same field, so the field becomes data:

- `Reference(first, last, what, names, shift=0, width=8, base=0, fixed=None)`, frozen: the keycodes `first` to `last` point at a `what` ("layer", "tap dance" or "macro"); the number is `width` bits from bit `shift` of the keycode less `base`; `fixed` is the layer FN_MO13 and FN_MO23 always point at (3). `names` is how messages call the keycodes ("LT", "TO, MO, DF, TG and OSL").
  - `number(value)` reads the number; `largest` is the largest one the field holds; `with_number(value, number)` replaces only the field and keeps every other bit, and raises `ValueError` for a fixed or based range, or a number that doesn't fit.
- `REFERENCES = {6: (...), 5: (...)}`, as vial-qmk lays the keycodes out (the comment names the files). `reference_range(value, protocol)` finds the `Reference` a keycode is in.
- `reference()` (used by the validation in `edits.py`) and `_layer_mod()` (describing LM) use it. `QK_LAYER_MOD` and `TRI_LAYER_KEYS` are derived from it, so there is one definition.
- `_protocol()` is renamed `keycode_protocol()`: `arranger.py` (Task 5) needs it.

Nothing changes in behaviour. `test_describe.py`'s `test_reference` and the LM tests already pin `reference()` and `_layer_mod()`; a new test pins the derived `QK_LAYER_MOD` and `TRI_LAYER_KEYS` to the firmware's values. It goes in `test_layers.py`, which Task 2 fills with the tests of `layers.py`.

**Files:**
- Modify: `src/main/python/server/describe.py`
- Test: `src/main/python/test/test_layers.py` (new)

- [ ] **Step 1: Pin the values the refactor must keep**

Create `src/main/python/test/test_layers.py`:

```python
""" Layer numbers in keycodes: describe.py's ranges come from one definition (REFERENCES) """


def test_describes_ranges_come_from_the_one_definition():
    # describe.py's LM range and tri-layer keys are derived from REFERENCES: the firmware's values
    from server.describe import QK_LAYER_MOD, TRI_LAYER_KEYS
    assert QK_LAYER_MOD == {6: (0x5000, 0x51FF), 5: (0x5900, 0x59FF)}
    assert TRI_LAYER_KEYS == {6: {0x7C77: 1, 0x7C78: 2}, 5: {0x5F10: 1, 0x5F11: 2}}
```

- [ ] **Step 2: Run it and the describe tests on the code as it is: they pass, and must still pass after the change**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layers.py test/test_describe.py
```

Expected: `320 passed`.

- [ ] **Step 3: `Reference`, `REFERENCES`, `reference_range`; `reference()`, `_layer_mod()`, `QK_LAYER_MOD` and `TRI_LAYER_KEYS` from them**

Apply to `src/main/python/server/describe.py`:

```diff
diff --git a/src/main/python/server/describe.py b/src/main/python/server/describe.py
--- a/src/main/python/server/describe.py
+++ b/src/main/python/server/describe.py
@@ -6,7 +6,9 @@ All keycode knowledge comes from keycodes/ (and the keyboard languages of keymap
 """
 import contextlib
 import contextvars
+import dataclasses
 import re
+from typing import Optional
 
 from keycodes.keycodes import Keycode, RAWCODES_MAP, KEYCODES_MEDIA, KEYCODES_BACKLIGHT
 
@@ -38,14 +40,94 @@ QK_MOD_TAP = {6: (0x2000, 0x3FFF), 5: (0x6000, 0x7FFF)}
 """ mod-tap: modifiers on hold in bits 8-12, the tapped key in bits 0-7 """
 QK_ONE_SHOT_MOD = {6: (0x52A0, 0x52BF), 5: (0x5500, 0x55FF)}
 """ one-shot modifiers: modifiers in bits 0-4 """
-QK_LAYER_MOD = {6: (0x5000, 0x51FF), 5: (0x5900, 0x59FF)}
-""" LM(layer, mods): protocol 6 has the layer in bits 5-8 and the modifiers in bits 0-4; protocol 5 the layer in bits
-4-7 and the left-hand modifiers in bits 0-3 """
-TRI_LAYER_KEYS = {6: {0x7C77: 1, 0x7C78: 2}, 5: {0x5F10: 1, 0x5F11: 2}}
-""" FN_MO13 and FN_MO23: layer 1 or 2 while held, and layer 3 while both are held (Vial's tri-layer keys) """
 TRI_LAYER = 3
 BASIC = (0x00, 0xFF)
 """ basic keycodes, the ones a layer-tap or mod-tap can tap (both protocols) """
+
+
+@dataclasses.dataclass(frozen=True)
+class Reference:
+    """ Keycodes first to last point at a layer, tap dance or macro (`what`): its number is the `width` bits from bit
+    `shift` of the keycode less `base`. `fixed`: they always point at this layer instead (FN_MO13, FN_MO23). `names`:
+    the keycodes, as messages call them. """
+    first: int
+    last: int
+    what: str
+    names: str
+    shift: int = 0
+    width: int = 8
+    base: int = 0
+    fixed: Optional[int] = None
+
+    def number(self, value):
+        """ The number a keycode of this range holds """
+        if self.fixed is not None:
+            return self.fixed
+        return ((value - self.base) >> self.shift) & ((1 << self.width) - 1)
+
+    @property
+    def largest(self):
+        """ The largest number the keycode's field holds """
+        return (1 << self.width) - 1
+
+    def with_number(self, value, number):
+        """ The keycode with another number in its field, every other bit kept; ValueError when it doesn't fit """
+        if self.fixed is not None or self.base:
+            raise ValueError("{} hold no number of their own".format(self.names))
+        if not 0 <= number <= self.largest:
+            raise ValueError("{} hold numbers 0 to {}, not {}".format(self.names, self.largest, number))
+        mask = self.largest << self.shift
+        return (value & ~mask) | (number << self.shift)
+
+
+# Keycodes that point at a layer, tap dance or macro, as the firmware lays them out: vial-qmk's quantum/keycodes.h and
+# quantum_keycodes.h on protocol 6; on protocol 5 (before QMK's keycode change) quantum_keycodes.h, keymap_common.c's
+# action_for_keycode (which reads only bits 0-3 of TO: bits 4-5 say when it acts) and via.h. FN_MO13 and FN_MO23 point
+# at layer 3, not at 1 or 2 as describe() reports: this table says which layers a key needs the keyboard to have, and
+# they turn on layer 3 when both are held (describe() gives their own layer, triLayer 3). Their layers are numbers the
+# firmware fixes (protocol 5: via.c's layer_on(1), update_tri_layer(1, 2, 3); protocol 6: tri_layer.c's
+# TRI_LAYER_LOWER_LAYER 1, UPPER 2, ADJUST 3 by default), not a field of the keycode.
+REFERENCES = {
+    6: (
+        Reference(0x4000, 0x4FFF, "layer", "LT", shift=8, width=4),
+        Reference(0x5000, 0x51FF, "layer", "LM", shift=5, width=4),
+        Reference(0x5200, 0x529F, "layer", "TO, MO, DF, TG and OSL", width=5),
+        Reference(0x52C0, 0x52FF, "layer", "TT and PDF", width=5),
+        Reference(0x5700, 0x57FF, "tap dance", "TD"),
+        Reference(0x7700, 0x77FF, "macro", "M"),
+        Reference(0x7C77, 0x7C78, "layer", "FN_MO13 and FN_MO23", fixed=TRI_LAYER),
+    ),
+    5: (
+        Reference(0x4000, 0x4FFF, "layer", "LT", shift=8, width=4),
+        Reference(0x5000, 0x50FF, "layer", "TO", width=4),
+        Reference(0x5100, 0x54FF, "layer", "MO, DF, TG and OSL"),
+        Reference(0x5700, 0x57FF, "tap dance", "TD"),
+        Reference(0x5800, 0x58FF, "layer", "TT"),
+        Reference(0x5900, 0x59FF, "layer", "LM", shift=4, width=4),
+        Reference(0x5F10, 0x5F11, "layer", "FN_MO13 and FN_MO23", fixed=TRI_LAYER),
+        Reference(0x5F12, 0x5F7F, "macro", "M", base=0x5F12),
+    ),
+}
+
+
+def reference_range(value, protocol):
+    """ The Reference a firmware keycode of this protocol (5 or 6) is in, or None """
+    for ref in REFERENCES[protocol]:
+        if ref.first <= value <= ref.last:
+            return ref
+    return None
+
+
+def _reference_named(protocol, names):
+    return next(ref for ref in REFERENCES[protocol] if ref.names == names)
+
+
+QK_LAYER_MOD = {p: (r.first, r.last) for p, r in ((p, _reference_named(p, "LM")) for p in REFERENCES)}
+""" LM(layer, mods): protocol 6 has the layer in bits 5-8 and the modifiers in bits 0-4; protocol 5 the layer in bits
+4-7 and the left-hand modifiers in bits 0-3 (the layer's field: REFERENCES) """
+TRI_LAYER_KEYS = {p: {r.first + i: i + 1 for i in range(r.last - r.first + 1)}
+                  for p, r in ((p, _reference_named(p, "FN_MO13 and FN_MO23")) for p in REFERENCES)}
+""" FN_MO13 and FN_MO23: layer 1 or 2 while held, and layer 3 while both are held (Vial's tri-layer keys) """
 TAPPABLE_KINDS = {"basic", "modifier", "media", "mouse"}
 """ kinds of the named keycodes in the basic range; the others there are unnamed codes, KC_NO and KC_TRNS """
 
@@ -136,14 +218,14 @@ def mods_name(bits):
     return "+".join(names)
 
 
-def _protocol():
+def keycode_protocol():
     """ The keycode protocol in use: 6, or 5 for anything else. Keycode.protocol is 0 until a keyboard was read, and
     keycodes.py then uses its protocol 5 tables, so the integers are protocol 5 ones """
     return 6 if Keycode.protocol == 6 else 5
 
 
 def _in(value, ranges):
-    first, last = ranges[_protocol()] if isinstance(ranges, dict) else ranges
+    first, last = ranges[keycode_protocol()] if isinstance(ranges, dict) else ranges
     return first <= value <= last
 
 
@@ -161,10 +243,8 @@ def _result(code, kind, legend, tap=None, hold=None, layer=None, layer_action=No
 
 def _layer_mod(code, value):
     """ LM(layer, mods), e.g. 0x5022 (protocol 6): layer 1 with Shift, while held """
-    if _protocol() == 6:
-        layer, bits = (value >> 5) & 0xF, value & 0x1F
-    else:
-        layer, bits = (value >> 4) & 0xF, value & 0xF
+    layer = reference_range(value, keycode_protocol()).number(value)
+    bits = value & (0x1F if keycode_protocol() == 6 else 0xF)
     mods = mods_name(bits) or None
     description = "Turns on layer {} while held{}".format(layer, ", with {} held too".format(mods) if mods else "")
     return _result(code, "layer", _legend("LM {}".format(layer)), hold=mods, layer=layer,
@@ -244,7 +324,7 @@ def _describe(code, value):
         layer = int(m.group(1))
         return _result(code, "layer-tap", _keycode_legend(m.group(2)), hold="layer {}".format(layer), layer=layer,
                        layer_action=LAYER_ACTIONS["MO"])
-    tri = TRI_LAYER_KEYS[_protocol()].get(value)
+    tri = TRI_LAYER_KEYS[keycode_protocol()].get(value)
     if tri is not None:
         description = "Turns on layer {} while held, and layer {} while Fn{} is held too".format(
             tri, TRI_LAYER, 3 - tri)
@@ -309,33 +389,7 @@ def parse(expression):
     return describe(Keycode.serialize(parse_value(expression)))
 
 
-# (first, last, what, number) for keycodes that point at a layer, tap dance or macro; number(value) -> its number
-# FN_MO13 and FN_MO23 point at layer 3, not at 1 or 2 as describe() reports: this table says which layers a key needs
-# the keyboard to have, and they turn on layer 3 when both are held (describe() gives their own layer, triLayer 3)
-_REFERENCES_V6 = [
-    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
-    (0x5000, 0x51FF, "layer", lambda v: (v >> 5) & 0xF),  # LM
-    (0x5200, 0x529F, "layer", lambda v: v & 0x1F),  # TO, MO, DF, TG, OSL
-    (0x52C0, 0x52FF, "layer", lambda v: v & 0x1F),  # TT, PDF
-    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
-    (0x7700, 0x77FF, "macro", lambda v: v & 0xFF),
-    (0x7C77, 0x7C78, "layer", lambda v: 3),  # FN_MO13, FN_MO23
-]
-_REFERENCES_V5 = [
-    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
-    (0x5000, 0x50FF, "layer", lambda v: v & 0xF),  # TO
-    (0x5100, 0x54FF, "layer", lambda v: v & 0xFF),  # MO, DF, TG, OSL
-    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
-    (0x5800, 0x58FF, "layer", lambda v: v & 0xFF),  # TT
-    (0x5900, 0x59FF, "layer", lambda v: (v >> 4) & 0xF),  # LM
-    (0x5F10, 0x5F11, "layer", lambda v: 3),  # FN_MO13, FN_MO23
-    (0x5F12, 0x5F7F, "macro", lambda v: v - 0x5F12),
-]
-
-
 def reference(value):
     """ Firmware keycode -> ("layer" | "tap dance" | "macro", number) it points at, or None """
-    for first, last, what, number in (_REFERENCES_V5 if _protocol() == 5 else _REFERENCES_V6):
-        if first <= value <= last:
-            return what, number(value)
-    return None
+    ref = reference_range(value, keycode_protocol())
+    return None if ref is None else (ref.what, ref.number(value))
```

- [ ] **Step 4: Run them again, then the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layers.py test/test_describe.py
```

Expected: `320 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1115 passed, 6 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/describe.py \
  src/main/python/test/test_layers.py
git commit -m "refactor(server): one definition of the keycodes that point at a layer, tap dance or macro"
```

### Task 2: `server/layers.py`: renumbering layer keycodes and arranging a whole keyboard state

A pure module, no I/O: `server/arranger.py` (Task 5) reads the keyboard into a `KeyboardState` and writes the result back.

- `KeyboardState(layers, keys, encoders, tap_dance, combos, key_overrides, alt_repeat_keys, macros)`: everything of a keyboard that holds layer numbers, keycodes as firmware integers. Its docstring gives each field's shape.
- `check_order(order, layers)`: `BadOrder` unless the order holds each layer once, layer 0 first. `mapping_of(order)` gives `{old layer: new position}`; `reverse(order)` the order that puts the layers back.
- `renumber(code, mapping, protocol)`: the keycode with its layer number moved through the mapping, through `describe.reference_range` and `Reference.with_number`. A keycode that holds no layer number, a tri-layer key, or a layer the mapping doesn't have stays as it is. A new number past the field is `DoesNotFit`, whose message names the keys that hold it ("LT keys hold layers 0 to 15: layer 2 can't go to position 19").
- `move_mask(mask, mapping)`: a key override's "active on layers" with each bit at its layer's new position; `DoesNotFit` past bit 15 (`KO_LAYER_BITS`).
- `arrange(state, order, protocol)` → `Arrangement`:
  - `target`: the keymap and encoders at their new positions, every keycode renumbered in every place (`PLACES`: keymap, encoders, tapDance, combos, keyOverrides, altRepeatKeys, macros);
  - `moves` (old, new), `keys` (keymap positions and encoder directions that change), `references` (renumbered keycodes by place), `key_overrides` (masks that change);
  - `tri_layer`: when a tri-layer key is set anywhere and any of layers 1–3 moves, the old layers that end up at positions 1, 2 and 3; else `None`;
  - `problems`: a `Problem(place, where, text)` for each number that doesn't fit, instead of an exception, so that the preview can list them all.
  - A key override with no trigger and no replacement does nothing and keeps its mask (Decision 7).

The tests cover every family on both protocols and at the edges of its field, protocol 5 TO's "when it acts" bits, the tri-layer keys, the keycodes next to the ranges, bad orders, `move_mask`, every place, the warning, the problems, and 150 random states per protocol arranged and arranged back. Task 3 adds the layer names to that round trip.

**Files:**
- Create: `src/main/python/server/layers.py`
- Test: `src/main/python/test/test_layers.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_layers.py`:

```diff
diff --git a/src/main/python/test/test_layers.py b/src/main/python/test/test_layers.py
--- a/src/main/python/test/test_layers.py
+++ b/src/main/python/test/test_layers.py
@@ -1,4 +1,241 @@
-""" Layer numbers in keycodes: describe.py's ranges come from one definition (REFERENCES) """
+""" server.layers: renumbering layer keycodes on both protocols, and arranging a whole keyboard state """
+import random
+
+import pytest
+
+from server.layers import BadOrder, DoesNotFit, KeyboardState, arrange, check_order, move_mask, renumber, reverse
+
+# protocol 6 (vial-qmk quantum/keycodes.h, quantum_keycodes.h)
+V6 = {
+    "LT": lambda layer, kc=0x2C: 0x4000 | (layer << 8) | kc,
+    "LM": lambda layer, mods=0x02: 0x5000 | (layer << 5) | mods,
+    "TO": lambda layer: 0x5200 | layer,
+    "MO": lambda layer: 0x5220 | layer,
+    "DF": lambda layer: 0x5240 | layer,
+    "TG": lambda layer: 0x5260 | layer,
+    "OSL": lambda layer: 0x5280 | layer,
+    "TT": lambda layer: 0x52C0 | layer,
+    "PDF": lambda layer: 0x52E0 | layer,
+}
+# protocol 5 (vial-qmk before QMK's keycode change: quantum_keycodes.h; TO has ON_PRESS in bit 4)
+V5 = {
+    "LT": lambda layer, kc=0x2C: 0x4000 | (layer << 8) | kc,
+    "LM": lambda layer, mods=0x02: 0x5900 | (layer << 4) | mods,
+    "TO": lambda layer: 0x5010 | layer,
+    "MO": lambda layer: 0x5100 | layer,
+    "DF": lambda layer: 0x5200 | layer,
+    "TG": lambda layer: 0x5300 | layer,
+    "OSL": lambda layer: 0x5400 | layer,
+    "TT": lambda layer: 0x5800 | layer,
+}
+TABLES = {6: V6, 5: V5}
+LARGEST = {6: {"LT": 15, "LM": 15}, 5: {"LT": 15, "LM": 15, "TO": 15}}
+FN_MO = {6: (0x7C77, 0x7C78), 5: (0x5F10, 0x5F11)}
+
+FAMILIES = [(protocol, name) for protocol, table in TABLES.items() for name in table]
+
+
+def largest(protocol, name):
+    return LARGEST[protocol].get(name, 31)
+
+
+@pytest.mark.parametrize("protocol,name", FAMILIES)
+def test_each_family_follows_its_layer(protocol, name):
+    make = TABLES[protocol][name]
+    assert renumber(make(1), {1: 2, 2: 1}, protocol) == make(2)
+    assert renumber(make(2), {1: 2, 2: 1}, protocol) == make(1)
+
+
+@pytest.mark.parametrize("protocol,name", FAMILIES)
+def test_each_family_at_its_edge(protocol, name):
+    make = TABLES[protocol][name]
+    top = largest(protocol, name)
+    assert renumber(make(top), {top: 1, 1: top}, protocol) == make(1)
+    assert renumber(make(1), {top: 1, 1: top}, protocol) == make(top)
+
+
+@pytest.mark.parametrize("protocol,name", FAMILIES)
+def test_a_number_past_the_field_is_a_problem(protocol, name):
+    make = TABLES[protocol][name]
+    top = largest(protocol, name)
+    if top >= 31:  # MO and the others hold any layer a keyboard can have (32 at most)
+        return
+    with pytest.raises(DoesNotFit, match="keys hold layers 0 to {}".format(top)):
+        renumber(make(2), {2: top + 1}, protocol)
+
+
+@pytest.mark.parametrize("protocol", [5, 6])
+def test_the_rest_of_the_keycode_stays(protocol):
+    table = TABLES[protocol]
+    assert renumber(table["LT"](1, 0x04), {1: 3}, protocol) == table["LT"](3, 0x04)
+    assert renumber(table["LM"](1, 0x05), {1: 3}, protocol) == table["LM"](3, 0x05)
+
+
+def test_protocol_5_to_keeps_when_it_acts():
+    # bits 4-5 of protocol 5's TO say when it acts (keymap_common.c): kept
+    assert renumber(0x5021, {1: 2}, 5) == 0x5022
+
+
+@pytest.mark.parametrize("protocol", [5, 6])
+def test_tri_layer_keys_are_not_renumbered(protocol):
+    for code in FN_MO[protocol]:
+        assert renumber(code, {1: 3, 2: 1, 3: 2}, protocol) == code
+
+
+@pytest.mark.parametrize("protocol,code", [
+    (6, 0x3FFF), (6, 0x52A0), (6, 0x52BF), (6, 0x5300), (6, 0x7C76), (6, 0x7C79), (6, 0x5700), (6, 0x0004),
+    (5, 0x5500), (5, 0x56FF), (5, 0x5A00), (5, 0x5F0F), (5, 0x5F12), (5, 0x5700),
+])
+def test_keycodes_next_to_the_ranges_are_unchanged(protocol, code):
+    assert renumber(code, {n: 31 - n for n in range(32)}, protocol) == code
+
+
+def test_a_layer_the_mapping_does_not_have_stays():
+    assert renumber(V6["MO"](9), {0: 0, 1: 2, 2: 1}, 6) == V6["MO"](9)
+
+
+# ---------- orders ----------
+
+@pytest.mark.parametrize("order", [[0, 1, 1, 2], [0, 1, 2], [0, 1, 2, 4], [1, 0, 2, 3], [0, 1, 2, 3, 4]])
+def test_bad_orders_are_refused(order):
+    with pytest.raises(BadOrder):
+        check_order(order, 4)
+
+
+def test_reverse_puts_layers_back():
+    order = [0, 3, 1, 2]
+    back = reverse(order)
+    assert back == [0, 2, 3, 1]
+    assert [order[i] for i in back] == [0, 1, 2, 3]
+
+
+def test_move_mask():
+    assert move_mask(0b0110, {0: 0, 1: 2, 2: 1}) == 0b0110
+    assert move_mask(0b0010, {0: 0, 1: 3, 2: 1, 3: 2}) == 0b1000
+    assert move_mask(0xFFF0, {0: 0, 1: 1, 2: 2, 3: 3}) == 0xFFF0
+    with pytest.raises(DoesNotFit):
+        move_mask(0b0100, {2: 16})
+
+
+# ---------- arranging a state ----------
+
+def state(**fields):
+    base = dict(layers=4, keys={}, encoders={}, tap_dance=(), combos=(), key_overrides=(), alt_repeat_keys=(),
+                macros=())
+    base.update(fields)
+    return KeyboardState(**base)
+
+
+def test_keymap_and_encoders_move_and_renumber():
+    s = state(keys={(0, 0, 0): V6["MO"](3), (1, 0, 0): 0x04, (2, 0, 0): 0x05, (3, 0, 0): V6["TO"](0)},
+              encoders={(0, 0, 0): V6["TG"](1), (3, 0, 1): 0x06, (1, 0, 0): 0, (2, 0, 0): 0, (0, 0, 1): 0,
+                        (1, 0, 1): 0, (2, 0, 1): 0, (3, 0, 0): 0})
+    result = arrange(s, [0, 3, 1, 2], 6)
+    t = result.target
+    assert t.keys == {(0, 0, 0): V6["MO"](1), (1, 0, 0): V6["TO"](0), (2, 0, 0): 0x04, (3, 0, 0): 0x05}
+    assert t.encoders[(0, 0, 0)] == V6["TG"](2)
+    assert t.encoders[(1, 0, 1)] == 0x06
+    assert result.moves == ((3, 1), (1, 2), (2, 3))
+    assert result.references["keymap"] == 1 and result.references["encoders"] == 1
+    assert result.keys == 4 + 3  # four keys and three encoder directions hold something else
+    assert result.problems == ()
+
+
+def test_every_place_with_layer_numbers():
+    s = state(
+        keys={(0, 0, 0): 0x04},
+        tap_dance=((V6["MO"](1), V6["LT"](2, 0x04), 0x05, V6["OSL"](3), 200),),
+        combos=((0x04, V6["TT"](1), 0, 0, V6["DF"](2)),),
+        key_overrides=((V6["MO"](1), V6["TG"](3), 0b0110, 0, 0, 0, 0x87),),
+        alt_repeat_keys=((V6["LM"](1), V6["PDF"](2), 0, 0x08),),
+        macros=((("text", "hi"), ("tap", (0x04, V6["MO"](3))), ("delay", 50)), ()),
+    )
+    result = arrange(s, [0, 2, 3, 1], 6)  # 2 -> 1, 3 -> 2, 1 -> 3
+    t = result.target
+    assert t.tap_dance == ((V6["MO"](3), V6["LT"](1, 0x04), 0x05, V6["OSL"](2), 200),)
+    assert t.combos == ((0x04, V6["TT"](3), 0, 0, V6["DF"](1)),)
+    assert t.key_overrides == ((V6["MO"](3), V6["TG"](2), 0b1010, 0, 0, 0, 0x87),)
+    assert t.alt_repeat_keys == ((V6["LM"](3), V6["PDF"](1), 0, 0x08),)
+    assert t.macros == ((("text", "hi"), ("tap", (0x04, V6["MO"](2))), ("delay", 50)), ())
+    assert result.references == {"keymap": 0, "encoders": 0, "tapDance": 3, "combos": 2, "keyOverrides": 2,
+                                 "altRepeatKeys": 2, "macros": 1}
+    assert result.key_overrides == 1
+
+
+def test_an_empty_key_override_keeps_its_mask():
+    s = state(key_overrides=((0, 0, 0xFFFF, 0, 0, 0, 0x07),))
+    assert arrange(s, [0, 2, 1, 3], 6).target.key_overrides == s.key_overrides
+
+
+def test_tri_layer_warning():
+    s = state(keys={(0, 0, 0): FN_MO[6][0]})
+    assert arrange(s, [0, 3, 1, 2], 6).tri_layer == (3, 1, 2)
+    assert arrange(s, [0, 1, 2, 3], 6).tri_layer is None
+    # anywhere: a tap dance has it
+    s = state(tap_dance=((FN_MO[6][1], 0, 0, 0, 200),))
+    assert arrange(s, [0, 2, 1, 3], 6).tri_layer == (2, 1, 3)
+    # no tri-layer key: nothing to say
+    assert arrange(state(), [0, 2, 1, 3], 6).tri_layer is None
+    # layers 1 to 3 stay: nothing to say
+    s = state(layers=6, keys={(0, 0, 0): FN_MO[6][0]})
+    assert arrange(s, [0, 1, 2, 3, 5, 4], 6).tri_layer is None
+
+
+def test_problems_block_and_say_where():
+    s = state(layers=20, keys={(2, 0, 4): V6["LT"](2)}, key_overrides=((0x04, 0x05, 1 << 3, 0, 0, 0, 0x87),))
+    order = [0, 1] + list(range(4, 20)) + [2, 3]  # layers 2 and 3 go to positions 18 and 19
+    result = arrange(s, order, 6)
+    places = {(p.place, p.where) for p in result.problems}
+    assert places == {("keymap", "layer 2, row 0, column 4"), ("keyOverrides", "key override 0")}
+    assert all("can't go to position" in p.text for p in result.problems)
+
+
+def test_nothing_to_change():
+    s = state(keys={(1, 0, 0): V6["MO"](2)})
+    result = arrange(s, [0, 1, 2, 3], 6)
+    assert result.moves == () and result.keys == 0 and result.target == s
+
+
+# ---------- round trips ----------
+
+def random_code(rng, layers, protocol):
+    table = TABLES[protocol]
+    kind = rng.randrange(6)
+    if kind == 0:
+        return rng.randrange(0x00, 0xFF)
+    if kind == 1:
+        return FN_MO[protocol][rng.randrange(2)]
+    name = rng.choice(sorted(table))
+    top = min(layers - 1, largest(protocol, name))
+    return table[name](rng.randrange(top + 1))
+
+
+def random_state(rng, protocol):
+    layers = rng.randrange(3, 13)
+    code = lambda: random_code(rng, layers, protocol)  # noqa: E731
+    keys = {(layer, row, col): code() for layer in range(layers) for row in range(2) for col in range(3)}
+    encoders = {(layer, 0, d): code() for layer in range(layers) for d in range(2)}
+    return KeyboardState(
+        layers=layers, keys=keys, encoders=encoders,
+        tap_dance=tuple((code(), code(), code(), code(), rng.randrange(500)) for _ in range(3)),
+        combos=tuple(tuple(code() for _ in range(5)) for _ in range(3)),
+        key_overrides=tuple((code(), code(), rng.randrange(1 << 16), 2, 0, 2, 0x87) for _ in range(3)),
+        alt_repeat_keys=tuple((code(), code(), 0, 8) for _ in range(2)),
+        macros=tuple((("text", "x"), ("tap", (code(), code())), ("down", (code(),))) for _ in range(2)),
+    )
+
+
+@pytest.mark.parametrize("protocol", [5, 6])
+def test_arranging_then_the_reverse_order_gives_the_start_back(protocol):
+    rng = random.Random(8)
+    for attempt in range(150):
+        s = random_state(rng, protocol)
+        order = [0] + rng.sample(range(1, s.layers), s.layers - 1)
+        there = arrange(s, order, protocol)
+        assert there.problems == ()
+        back = arrange(there.target, reverse(order), protocol)
+        assert back.problems == ()
+        assert back.target == s, (order, attempt)
 
 
 def test_describes_ranges_come_from_the_one_definition():
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layers.py
```

Expected: `ModuleNotFoundError: No module named 'server.layers'` and `1 error`.

- [ ] **Step 3: The module**

Create `src/main/python/server/layers.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Moving layers to other positions, every reference to a layer following it. Pure functions over a KeyboardState:
no I/O (server.arranger reads the keyboard into one and writes one back).

An order lists, for each new position, the layer that goes there: order[new position] = old layer. [0, 3, 1, 2] puts
layer 3 at position 1, and layers 1 and 2 after it. Layer 0 never moves: the keyboard starts on it.
"""
import dataclasses
from typing import Optional

from server.describe import TRI_LAYER, reference_range

KO_LAYER_BITS = 16
""" a key override's "active on layers" is 16 bits, one per layer 0 to 15 (vial-qmk vial.h, vial_key_override_entry_t's
uint16_t layers) """
TRI_LAYERS = (1, 2, TRI_LAYER)
""" the layers FN_MO13 and FN_MO23 use, by number """
PLACES = ("keymap", "encoders", "tapDance", "combos", "keyOverrides", "altRepeatKeys", "macros")
""" where keycodes are, in the order they are written """


@dataclasses.dataclass(frozen=True)
class KeyboardState:
    """ Everything of a keyboard that holds layer numbers, keycodes as firmware integers.

    keys: {(layer, row, col): keycode}; encoders: {(layer, encoder, direction): keycode}
    tap_dance: (tap, hold, double tap, tap-hold, tapping term) each
    combos: (key 1, key 2, key 3, key 4, output) each
    key_overrides: (trigger, replacement, layers, trigger mods, negative mod mask, suppressed mods, options) each
    alt_repeat_keys: (keycode, alt keycode, allowed mods, options) each
    macros: each macro's steps: ("text", str), ("delay", ms) or ("tap" | "down" | "up", (keycode, ...))
    """
    layers: int
    keys: dict
    encoders: dict
    tap_dance: tuple = ()
    combos: tuple = ()
    key_overrides: tuple = ()
    alt_repeat_keys: tuple = ()
    macros: tuple = ()


@dataclasses.dataclass(frozen=True)
class Problem:
    """ Why an order can't be written: a layer number that doesn't fit where it must go """
    place: str
    """ one of PLACES """
    where: str
    """ "layer 2, row 0, column 4", "tap dance 3, hold", "key override 1" """
    text: str


@dataclasses.dataclass(frozen=True)
class Arrangement:
    """ What an order does to a keyboard """
    target: KeyboardState
    moves: tuple
    """ (old position, new position) of each layer that moves """
    keys: int
    """ keymap positions and encoder directions that change """
    references: dict
    """ by place (PLACES): the keycodes whose layer number changes """
    key_overrides: int
    """ key overrides whose "active on layers" changes """
    tri_layer: Optional[tuple]
    """ a tri-layer key is set and layers 1-3 change: the old layers at positions 1, 2 and 3 after the order (they were
    1, 2 and 3); None otherwise """
    problems: tuple


class DoesNotFit(ValueError):
    """ A layer number that doesn't fit the field of the keycode that must hold it """


class BadOrder(ValueError):
    """ An order that isn't one of the keyboard's layers """


def check_order(order, layers):
    """ ValueError unless order holds every layer 0 to layers - 1 once, layer 0 first """
    order = list(order)
    if len(order) != layers or sorted(order) != list(range(layers)):
        raise BadOrder("the order must list each of the {} layers (0 to {}) once".format(layers, layers - 1))
    if order[0] != 0:
        raise BadOrder("layer 0 stays first: the keyboard starts on it")
    return order


def mapping_of(order):
    """ order -> {old layer: new position} """
    return {old: new for new, old in enumerate(order)}


def reverse(order):
    """ The order that puts layers back where they were before `order` """
    back = [0] * len(order)
    for new, old in enumerate(order):
        back[old] = new
    return back


def renumber(code, mapping, protocol):
    """ The keycode with its layer number moved through mapping ({old layer: new layer}), or the same keycode when it
    holds no layer number of its own (FN_MO13 and FN_MO23 use fixed layers) or one mapping doesn't have (a layer the
    keyboard doesn't have). DoesNotFit when the new number doesn't fit the keycode's field (LT and LM hold layers 0 to
    15). protocol: 5 or 6. """
    ref = reference_range(code, protocol)
    if ref is None or ref.what != "layer" or ref.fixed is not None:
        return code
    layer = ref.number(code)
    if layer not in mapping:
        return code
    new = mapping[layer]
    if new > ref.largest:
        raise DoesNotFit("{} keys hold layers 0 to {}: layer {} can't go to position {}".format(
            ref.names, ref.largest, layer, new))
    return ref.with_number(code, new)


def is_tri_layer_key(code, protocol):
    ref = reference_range(code, protocol)
    return ref is not None and ref.what == "layer" and ref.fixed is not None


def move_mask(mask, mapping):
    """ A key override's layer mask with each layer's bit at its new position; bits of layers mapping doesn't have stay.
    DoesNotFit when a layer in it would go past bit 15. """
    out = 0
    for bit in range(KO_LAYER_BITS):
        if not mask & (1 << bit):
            continue
        new = mapping.get(bit, bit)
        if new >= KO_LAYER_BITS:
            raise DoesNotFit("a key override's layers are 0 to {}: layer {} can't go to position {}".format(
                KO_LAYER_BITS - 1, bit, new))
        out |= 1 << new
    return out


class _Renumbering:
    """ Renumbers keycodes, counting by place those that change and keeping the problems met """

    def __init__(self, mapping, protocol):
        self.mapping = mapping
        self.protocol = protocol
        self.counts = {place: 0 for place in PLACES}
        self.problems = []
        self.tri_layer = False

    def code(self, value, place, where):
        if is_tri_layer_key(value, self.protocol):
            self.tri_layer = True
        try:
            new = renumber(value, self.mapping, self.protocol)
        except DoesNotFit as e:
            self.problems.append(Problem(place, where, str(e)))
            return value
        if new != value:
            self.counts[place] += 1
        return new


TAP_DANCE_SLOTS = ("tap", "hold", "double tap", "tap-hold")
COMBO_SLOTS = ("key 1", "key 2", "key 3", "key 4", "output")


def _set(key_override):
    """ A key override that is set: an empty one (no trigger, no replacement) does nothing, and keeps its mask """
    return key_override[0] != 0 or key_override[1] != 0


def arrange(state, order, protocol):
    """ The keyboard after moving its layers to `order` (see the module), every layer reference following, as an
    Arrangement. BadOrder for an order that isn't the keyboard's layers with layer 0 first. protocol: 5 or 6. """
    order = check_order(order, state.layers)
    mapping = mapping_of(order)
    r = _Renumbering(mapping, protocol)

    keys = {}
    for (layer, row, col), value in state.keys.items():
        keys[(mapping[layer], row, col)] = r.code(value, "keymap", "layer {}, row {}, column {}".format(layer, row, col))
    encoders = {}
    for (layer, index, direction), value in state.encoders.items():
        encoders[(mapping[layer], index, direction)] = r.code(
            value, "encoders", "layer {}, encoder {}, direction {}".format(layer, index, direction))

    tap_dance = tuple(
        tuple(r.code(v, "tapDance", "tap dance {}, {}".format(i, TAP_DANCE_SLOTS[n])) for n, v in enumerate(e[:4]))
        + (e[4],) for i, e in enumerate(state.tap_dance))
    combos = tuple(tuple(r.code(v, "combos", "combo {}, {}".format(i, COMBO_SLOTS[n])) for n, v in enumerate(e))
                   for i, e in enumerate(state.combos))

    key_overrides = []
    masks_moved = 0
    for i, e in enumerate(state.key_overrides):
        where = "key override {}".format(i)
        trigger = r.code(e[0], "keyOverrides", where)
        replacement = r.code(e[1], "keyOverrides", where)
        mask = e[2]
        if _set(e):
            try:
                mask = move_mask(e[2], mapping)
            except DoesNotFit as problem:
                r.problems.append(Problem("keyOverrides", where, str(problem)))
        masks_moved += mask != e[2]
        key_overrides.append((trigger, replacement, mask) + tuple(e[3:]))

    alt_repeat_keys = tuple(
        (r.code(e[0], "altRepeatKeys", "alt-repeat key {}".format(i)),
         r.code(e[1], "altRepeatKeys", "alt-repeat key {}".format(i))) + tuple(e[2:])
        for i, e in enumerate(state.alt_repeat_keys))

    macros = tuple(
        tuple(step if step[0] not in ("tap", "down", "up") else
              (step[0], tuple(r.code(v, "macros", "macro {}, step {}".format(i, s)) for v in step[1]))
              for s, step in enumerate(steps))
        for i, steps in enumerate(state.macros))

    target = KeyboardState(state.layers, keys, encoders, tap_dance, combos, tuple(key_overrides), alt_repeat_keys,
                           macros)
    tri_moves = any(len(order) > n and order[n] != n for n in TRI_LAYERS)
    tri_layer = tuple(order[n] if n < len(order) else None for n in TRI_LAYERS) if r.tri_layer and tri_moves else None
    return Arrangement(
        target=target,
        moves=tuple((old, new) for new, old in enumerate(order) if old != new),
        keys=sum(keys.get(pos) != value for pos, value in state.keys.items())
        + sum(encoders.get(pos) != value for pos, value in state.encoders.items()),
        references=r.counts,
        key_overrides=masks_moved,
        tri_layer=tri_layer,
        problems=tuple(r.problems),
    )
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layers.py
```

Expected: `87 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1201 passed, 6 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/layers.py \
  src/main/python/test/test_layers.py
git commit -m "feat(server): layers.arrange moves layers and renumbers every layer reference"
```

### Task 3: `NamesStore.move_layers`: the layer names follow their layers, in one write

`move_layers(uid, order)` moves the layer names of one keyboard to their layers' new positions, in one write of `names.json`:
- a layer that had no name has none at its new position either (it shows that position's default name);
- names of layers past the order, and tap dance and macro names, stay where they are;
- nothing is written when no name moves.

The file write that `set()` did is now `_save()`, shared by both: a new file put in place of the old one, so that a failure leaves the old one.

`test_layers.py`'s round trip now names random layers too, and checks that moving the names there and back gives the same names.

**Files:**
- Modify: `src/main/python/server/names.py`
- Test: `src/main/python/test/test_names.py`
- Test: `src/main/python/test/test_layers.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_names.py`:

```diff
diff --git a/src/main/python/test/test_names.py b/src/main/python/test/test_names.py
--- a/src/main/python/test/test_names.py
+++ b/src/main/python/test/test_names.py
@@ -1,5 +1,6 @@
 import codecs
 import json
+import os
 
 import pytest
 
@@ -122,3 +123,40 @@ def test_file_with_a_byte_order_mark_is_read(tmp_path):
     assert store.get("ABC")["layers"] == {"0": "base"}
     assert store.set("ABC", "layers", 1, "nav")["layers"] == {"0": "base", "1": "nav"}
     assert not (tmp_path / "names.json.corrupt").exists()
+
+
+# ---------- moving layer names (Arrange layers) ----------
+
+def test_move_layers_moves_names_with_their_layers(tmp_path):
+    store = NamesStore(str(tmp_path / "names.json"))
+    store.set("K", "layers", 1, "Sym")
+    store.set("K", "layers", 3, "Num")
+    store.set("K", "layers", 9, "Past the order")
+    store.set("K", "macros", 1, "Mail")
+    names = store.move_layers("K", [0, 3, 1, 2])
+    # layer 2 had no name: position 3 has none either; names past the order and of other kinds stay
+    assert names["layers"] == {"1": "Num", "2": "Sym", "9": "Past the order"}
+    assert names["macros"] == {"1": "Mail"}
+    assert store.move_layers("K", [0, 2, 3, 1])["layers"] == {"1": "Sym", "3": "Num", "9": "Past the order"}
+
+
+def test_move_layers_writes_nothing_when_no_name_moves(tmp_path):
+    path = tmp_path / "names.json"
+    store = NamesStore(str(path))
+    assert store.move_layers("K", [0, 2, 1]) == {"layers": {}, "tapDance": {}, "macros": {}}
+    assert not path.exists()
+
+
+def test_move_layers_is_one_write_that_keeps_the_old_file_on_failure(tmp_path, monkeypatch):
+    path = tmp_path / "names.json"
+    store = NamesStore(str(path))
+    store.set("K", "layers", 1, "Sym")
+    before = path.read_bytes()
+
+    def broken(src, dst):
+        raise OSError("disk full")
+    monkeypatch.setattr(os, "replace", broken)
+    with pytest.raises(OSError):
+        store.move_layers("K", [0, 2, 1])
+    assert path.read_bytes() == before
+    assert not (tmp_path / "names.json.tmp").exists()
```

Apply to `src/main/python/test/test_layers.py`:

```diff
diff --git a/src/main/python/test/test_layers.py b/src/main/python/test/test_layers.py
--- a/src/main/python/test/test_layers.py
+++ b/src/main/python/test/test_layers.py
@@ -4,6 +4,7 @@ import random
 import pytest
 
 from server.layers import BadOrder, DoesNotFit, KeyboardState, arrange, check_order, move_mask, renumber, reverse
+from server.names import NamesStore
 
 # protocol 6 (vial-qmk quantum/keycodes.h, quantum_keycodes.h)
 V6 = {
@@ -226,16 +227,24 @@ def random_state(rng, protocol):
 
 
 @pytest.mark.parametrize("protocol", [5, 6])
-def test_arranging_then_the_reverse_order_gives_the_start_back(protocol):
+def test_arranging_then_the_reverse_order_gives_the_start_back(protocol, tmp_path):
     rng = random.Random(8)
+    names = NamesStore(str(tmp_path / "names.json"))
     for attempt in range(150):
         s = random_state(rng, protocol)
         order = [0] + rng.sample(range(1, s.layers), s.layers - 1)
+        uid = "K{}".format(attempt)
+        for layer in rng.sample(range(s.layers), rng.randrange(s.layers)):
+            names.set(uid, "layers", layer, "name {}".format(layer))
+        named = names.get(uid)
         there = arrange(s, order, protocol)
         assert there.problems == ()
+        names.move_layers(uid, order)
         back = arrange(there.target, reverse(order), protocol)
         assert back.problems == ()
         assert back.target == s, (order, attempt)
+        names.move_layers(uid, reverse(order))
+        assert names.get(uid) == named
 
 
 def test_describes_ranges_come_from_the_one_definition():
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_names.py test/test_layers.py
```

Expected: `AttributeError: 'NamesStore' object has no attribute 'move_layers'` and `5 failed, 102 passed`: the three names tests and the round trip on both protocols.

- [ ] **Step 3: `move_layers` and `_save`**

Apply to `src/main/python/server/names.py`:

```diff
diff --git a/src/main/python/server/names.py b/src/main/python/server/names.py
--- a/src/main/python/server/names.py
+++ b/src/main/python/server/names.py
@@ -60,19 +60,41 @@ class NamesStore:
                 entry[str(index)] = name
             else:
                 entry.pop(str(index), None)
-            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
-            tmp = self.path + ".tmp"
-            try:
-                with open(tmp, "w", encoding="utf-8") as outf:
-                    json.dump(data, outf, indent=2, ensure_ascii=False)
-                    outf.flush()
-                    os.fsync(outf.fileno())
-                os.replace(tmp, self.path)
-            finally:
-                if os.path.exists(tmp):
-                    os.remove(tmp)
+            self._save(data)
         return self.get(uid)
 
+    def move_layers(self, uid, order):
+        """ The layer names follow their layers to new positions, in one write: order[new position] = old layer (see
+        server.layers). A layer that had no name has none at its new position either; names of layers past the order
+        stay where they are. """
+        with self.lock:
+            data = self._load(for_write=True)
+            old = data.get(uid, {}).get("layers", {})
+            moved = {k: v for k, v in old.items() if not (k.isdigit() and int(k) < len(order))}
+            for new, layer in enumerate(order):
+                name = old.get(str(layer))
+                if name:
+                    moved[str(new)] = name
+            if moved != old:
+                data.setdefault(uid, {})["layers"] = moved
+                self._save(data)
+        return self.get(uid)
+
+    def _save(self, data):
+        """ Write the names file whole: a new file put in place of the old one, so that a failure leaves the old one
+        """
+        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
+        tmp = self.path + ".tmp"
+        try:
+            with open(tmp, "w", encoding="utf-8") as outf:
+                json.dump(data, outf, indent=2, ensure_ascii=False)
+                outf.flush()
+                os.fsync(outf.fileno())
+            os.replace(tmp, self.path)
+        finally:
+            if os.path.exists(tmp):
+                os.remove(tmp)
+
 
 def suggest_tap_dance_name(described_slots):
     """ "Tab / Caps" from the described (tap, hold, double tap, tap-hold) slots; "" when all are empty """
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_names.py test/test_layers.py
```

Expected: `107 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1204 passed, 6 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/names.py \
  src/main/python/test/test_layers.py \
  src/main/python/test/test_names.py
git commit -m "feat(server): NamesStore.move_layers moves the layer names with their layers, in one write"
```

### Task 4: The simulator can be told to fail a write

The arrange failure tests (Task 5 in pytest, Task 9 end to end) need a write that fails partway, in the middle of an arrange. The simulated keyboard gets a hook for it:

- `VirtualKeyboard.fail_writes(after, unplug=False)`: the `after`th write from now (1: the next one) fails, without changing anything; `None`: none does.
  - A write is a request that changes the keyboard (`is_write`): the VIA keycode, keyboard value, lighting and macro buffer writes, and Vial's encoder, QMK settings and dynamic entry sets. Each packet counts: a macro buffer takes several.
  - The failing request raises `SimulatedWriteFailure`, a `ValueError` as hidapi raises for a handle that no longer works. The transport retries only an `OSError`, a short write or an empty reply, so the failure isn't tried again.
  - `unplug=True`: the keyboard drops off the bus at that write. Otherwise it stays plugged in, and only that write fails; the server then finds the handle broken and opens it again on its next look for keyboards.
- `FakeBackend.fail_writes(after, unplug)` sets it on the first simulated keyboard (as `set_connected` does), under the backend's lock. Task 5 adds the fake-only route `PUT /api/simulator/fail-write` on top of it.

This is test machinery; Task 5's failure tests are its tests. Here a short check shows that it fails exactly the write it was told to, counts only writes, and unplugs when asked.

**Files:**
- Modify: `src/main/python/simulator/virtual_keyboard.py`
- Modify: `src/main/python/server/device.py`

- [ ] **Step 1: The check, before the hook exists**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -c "
from server.device import FakeBackend
from simulator.corne import make_corne
from simulator.virtual_keyboard import SimulatedWriteFailure
backend = FakeBackend(make_corne)
backend.fail_writes(2)
kb = backend.virtual
write = bytes([0x05, 1, 0, 0, 0x00, 0x04]) + bytes(26)
kb.process(bytes([0x01]) + bytes(31))
kb.process(write)
try:
    kb.process(write)
except SimulatedWriteFailure as e:
    print('write 2 failed:', e)
kb.process(write)
print('write 3 went through:', len(kb.writes) == 2, 'plugged in:', kb.connected)
backend.fail_writes(1, unplug=True)
try:
    kb.process(write)
except ValueError:
    print('unplugged at the failed write:', not kb.connected)
"
```

Expected: `ImportError: cannot import name 'SimulatedWriteFailure' from 'simulator.virtual_keyboard'`.

- [ ] **Step 2: The hook**

Apply to `src/main/python/simulator/virtual_keyboard.py`:

```diff
diff --git a/src/main/python/simulator/virtual_keyboard.py b/src/main/python/simulator/virtual_keyboard.py
--- a/src/main/python/simulator/virtual_keyboard.py
+++ b/src/main/python/simulator/virtual_keyboard.py
@@ -66,6 +66,19 @@ class SimulatorError(RuntimeError):
     pass
 
 
+class SimulatedWriteFailure(ValueError):
+    """ A write the simulated keyboard was told to fail (fail_writes): a ValueError, as hidapi raises for a handle that
+    no longer works, so that the protocol's retries don't repeat it """
+
+
+WRITE_COMMANDS = {CMD_VIA_SET_KEYCODE, CMD_VIA_SET_KEYBOARD_VALUE, CMD_VIA_LIGHTING_SET_VALUE, CMD_VIA_MACRO_SET_BUFFER}
+""" VIA commands that change the keyboard """
+VIAL_WRITE_COMMANDS = {CMD_VIAL_SET_ENCODER, CMD_VIAL_QMK_SETTINGS_SET, CMD_VIAL_QMK_SETTINGS_RESET}
+""" Vial commands that change the keyboard (and the dynamic entry sets, DYNAMIC_SETS) """
+DYNAMIC_SETS = {DYNAMIC_VIAL_TAP_DANCE_SET, DYNAMIC_VIAL_COMBO_SET, DYNAMIC_VIAL_KEY_OVERRIDE_SET,
+                DYNAMIC_VIAL_ALT_REPEAT_KEY_SET}
+
+
 class VirtualKeyboard:
 
     def __init__(self, definition, layers=4, keymap=None, uid=0xF00DFACEDEADBEEF, vial_protocol=6,
@@ -175,6 +188,9 @@ class VirtualKeyboard:
         self.connected = True
         self.bootloader_requested = False
         self.writes = []
+        self.fail_write_in = None
+        """ fail_writes(): the writes left before the one that fails (1: the next one), or None """
+        self.fail_unplugs = False
 
     # --- helpers for tests and the fake server ---
 
@@ -184,6 +200,33 @@ class VirtualKeyboard:
     def release(self, row, col):
         self.pressed.discard((row, col))
 
+    def fail_writes(self, after, unplug=False):
+        """ The `after`th write from now (1: the next one) fails, without changing anything; None: none does. A write is
+        a request that changes the keyboard (one packet: a macro buffer takes several). unplug: the keyboard drops off
+        the bus at that write, as if unplugged; else it stays plugged in and only that write fails, as on a handle that
+        stopped working. """
+        self.fail_write_in = after
+        self.fail_unplugs = unplug
+
+    @staticmethod
+    def is_write(msg):
+        """ Whether a request changes the keyboard """
+        if msg[0] == CMD_VIA_VIAL_PREFIX:
+            return msg[1] in VIAL_WRITE_COMMANDS or (msg[1] == CMD_VIAL_DYNAMIC_ENTRY_OP and msg[2] in DYNAMIC_SETS)
+        return msg[0] in WRITE_COMMANDS
+
+    def _check_failure(self, msg):
+        """ Fail this request, if it is the write fail_writes() named """
+        if self.fail_write_in is None or not self.is_write(msg):
+            return
+        self.fail_write_in -= 1
+        if self.fail_write_in > 0:
+            return
+        self.fail_write_in = None
+        if self.fail_unplugs:
+            self.connected = False
+        raise SimulatedWriteFailure("the simulated keyboard failed this write, as it was told to")
+
     def hold_unlock_keys(self, held):
         """ The user presses (True) or lets go of (False) every unlock key """
         for row, col in self.unlock_keys:
@@ -213,6 +256,7 @@ class VirtualKeyboard:
         cmd = msg[0]
         if self.unlock_in_progress and not (cmd == CMD_VIA_VIAL_PREFIX and msg[1] in ALLOWED_DURING_UNLOCK):
             return msg
+        self._check_failure(msg)
         if cmd == CMD_VIA_VIAL_PREFIX:
             return self._vial(msg)
         handler = {
```

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -333,6 +333,11 @@ class FakeBackend:
                 virtual.plug_in()
             virtual.connected = connected
 
+    def fail_writes(self, after, unplug=False):
+        """ The `after`th write from now to the first keyboard fails (VirtualKeyboard.fail_writes); None: none does """
+        with self.lock:
+            self._first().fail_writes(after, unplug=unplug)
+
     def set_second_connected(self, connected, unreadable=False):
         """ Simulate plugging the second keyboard in (True) or unplugging it (False); the hot-plug poll notices.
         unreadable: plugged in with firmware of a Vial protocol this Vial doesn't know, so it is listed but fails to
```

- [ ] **Step 3: The check again, then the simulator's tests and the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -c "
from server.device import FakeBackend
from simulator.corne import make_corne
from simulator.virtual_keyboard import SimulatedWriteFailure
backend = FakeBackend(make_corne)
backend.fail_writes(2)
kb = backend.virtual
write = bytes([0x05, 1, 0, 0, 0x00, 0x04]) + bytes(26)
kb.process(bytes([0x01]) + bytes(31))
kb.process(write)
try:
    kb.process(write)
except SimulatedWriteFailure as e:
    print('write 2 failed:', e)
kb.process(write)
print('write 3 went through:', len(kb.writes) == 2, 'plugged in:', kb.connected)
backend.fail_writes(1, unplug=True)
try:
    kb.process(write)
except ValueError:
    print('unplugged at the failed write:', not kb.connected)
"
```

Expected: `write 2 failed: the simulated keyboard failed this write, as it was told to` and `write 3 went through: True plugged in: True` and `unplugged at the failed write: True`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py test/test_device_manager.py
```

Expected: `84 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1204 passed, 6 skipped`.

- [ ] **Step 4: Commit**

```bash
git add src/main/python/server/device.py \
  src/main/python/simulator/virtual_keyboard.py
git commit -m "feat(simulator): a write can be told to fail, for the arrange failure tests"
```

### Task 5: The routes: preview, Apply, Finish and Put back; the unfinished arrange in the session

**`server/arranger.py`** does the I/O; the functions that take the loaded `Keyboard` run under the device lock (`DeviceManager.run`):
- `read_state(kb)`: the loaded keyboard as a `KeyboardState` (no device I/O). Macros become steps: `("text", str)`, `("delay", ms)`, `("tap" | "down" | "up", keycodes)`.
- `plan(kb, target)` → `Plan`: only what differs from what the keyboard holds, in the write order (keymap, encoders, tap dance, combos, key overrides, alt-repeat keys, the macro buffer). A macro whose steps don't change keeps its exact bytes; `ValueError` when the macros wouldn't fit. `Plan.writes` counts the writes; `Plan.needs_unlock()` follows the protocol layer's rules (QK_BOOT written anywhere, or the macros changed).
- `write(kb, plan, written)`: writes it in order, appending to `written` once per write, so that a failure tells how far it got.
- `preview(kb, order)` → `schemas.ArrangePreview`; nothing is written, and it works on a locked keyboard too.
- `Job`: made with the plan and unlocked for (`request_unlock` raises 423 before any write), then `run()` writes it and calls `done()`. A failure keeps the arrange as `Unfinished(start, target, order, done, total)` in `Arrangements` (by UID, thread-safe) and raises again.
- `begin(kb, order, arrangements, names)`: `ArrangeRefused` while an arrange of this keyboard is unfinished or when the order has problems; the names move in `done()`. `resume(kb, arrangements, names, finish)`: Finish writes towards the target and then moves the names, Put back towards the start; `NothingUnfinished` when there is none.

**Routes** (`server/app.py`), with the token and Host/Origin checks and the `X-Vial-Keyboard` check of every keyboard route (a keyboard switch in between answers 409):
- `POST /api/layers/arrange/preview {order}` → `ArrangePreview` (`moves` as `{layer, to}`, `keys`, `references` by place, `keyOverrides`, `triLayer`, `problems`, `writes`, `needsUnlock`).
- `POST /api/layers/arrange {order}`, `POST /api/layers/arrange/finish`, `POST /api/layers/arrange/put-back` → the new `KeyboardModel`. They share `arranging()`, which follows the `.vil` pattern: one device lock; when a write fails, `resync()` reads the keyboard again (only once writing started) and the error goes on as 502 or 503; on success every tab gets `{"type": "reloaded"}`.
- `ArrangeRefused` answers 409, `NothingUnfinished` 404. A bad order is a 422.
- `GET /api/session` has `arrange`: `{order, done, total}` for the loaded keyboard's unfinished arrange, or `null`.
- Fake mode only, left out of the schema: `PUT /api/simulator/fail-write {"after": N, "unplug": false}` (`SimulatorFailWrite`).

The request and response models go in `schemas.py`, and `schema.d.ts` is regenerated in the same commit. `test_api.py`'s session now has `"arrange": None`.

**Files:**
- Create: `src/main/python/server/arranger.py`
- Modify: `src/main/python/server/schemas.py`
- Modify: `src/main/python/server/app.py`
- Test: `src/main/python/test/test_arrange.py` (new)
- Test: `src/main/python/test/test_api.py`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_arrange.py`:

```python
""" Arranging the layers through the API, against the simulator: the preview, Apply, the unlock, a keyboard switch, a
write that fails partway with Finish and Put back, and a keyboard with encoders """
import copy
import random
import urllib.parse

import pytest
from fastapi.testclient import TestClient

import transport
from keycodes.keycodes import Keycode
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.layers import reverse
from server.names import NamesStore
from simulator.corne import encode, make_corne
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN
from test.test_api_validation import snapshot

ORDER = [0, 3, 1, 2]
""" the design's example: layer 3 to position 1 """


def make_app(tmp_path, monkeypatch, factory=make_corne, second=None):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(factory, second))
    manager.connect()
    names = NamesStore(str(tmp_path / "names.json"))
    return manager, names, create_app(manager, names, TOKEN, PORT, poll_interval=0)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """ (client, manager, names) """
    manager, names, app = make_app(tmp_path, monkeypatch)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        yield client, manager, names
    set_unlock_handler(None)


def preview(client, order=ORDER):
    response = client.post("/api/layers/arrange/preview", json={"order": order})
    assert response.status_code == 200, response.text
    return response.json()


def arrange(client, order=ORDER, **kwargs):
    return client.post("/api/layers/arrange", json={"order": order}, **kwargs)


def layer_codes(client):
    return [[k["code"] for k in layer["keys"]] for layer in client.get("/api/keyboard").json()["layers"]]


def name_layers(client, names):
    for index, name in names.items():
        assert client.put("/api/names/layers/{}".format(index), json={"name": name}).status_code == 200


def arranged_elsewhere(tmp_path, monkeypatch, prepare, order):
    """ What a fresh simulated Corne holds after prepare(client) and an arrange that goes through """
    manager, _, app = make_app(tmp_path / "elsewhere", monkeypatch)
    (tmp_path / "elsewhere").mkdir(exist_ok=True)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        prepare(client)
        assert arrange(client, order).status_code == 200
        return snapshot(manager.backend.virtual)


# ---------- the preview ----------

def test_the_preview_writes_nothing(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    before = snapshot(virtual)
    virtual.writes.clear()
    result = preview(client)
    assert virtual.writes == [] and snapshot(virtual) == before
    assert result["moves"] == [{"layer": 3, "to": 1}, {"layer": 1, "to": 2}, {"layer": 2, "to": 3}]
    # LT1(Space), LT2(B), LT2(S) and OSL(3) on the base layer; TO(0) on layer 3 stays as it is
    assert result["references"]["keymap"] == 4
    assert result["writes"] == result["keys"] > 0
    assert result["problems"] == [] and result["triLayer"] is None and not result["needsUnlock"]


def test_the_current_order_changes_nothing(setup):
    client, manager, _ = setup
    result = preview(client, [0, 1, 2, 3])
    assert (result["moves"], result["keys"], result["writes"]) == ([], 0, 0)
    virtual = manager.backend.virtual
    virtual.writes.clear()
    assert arrange(client, [0, 1, 2, 3]).status_code == 200
    assert virtual.writes == []


@pytest.mark.parametrize("order", [[0, 1, 1, 2], [0, 1, 2], [1, 0, 2, 3], [0, 1, 2, 3, 4], []])
def test_orders_that_are_not_the_layers_are_refused(setup, order):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    virtual.writes.clear()
    assert client.post("/api/layers/arrange/preview", json={"order": order}).status_code == 422
    assert arrange(client, order).status_code == 422
    assert virtual.writes == []


def test_the_tri_layer_warning(setup):
    client, _, _ = setup
    assert client.put("/api/keymap/0/3/3", json={"code": "FN_MO13"}).status_code == 200
    assert preview(client)["triLayer"] == [3, 1, 2]
    assert preview(client, [0, 1, 2, 3])["triLayer"] is None


# ---------- Apply ----------

def test_apply_writes_only_the_differences_and_moves_the_names(setup):
    client, manager, names = setup
    name_layers(client, {1: "Sym", 3: "Num"})
    virtual = manager.backend.virtual
    before = layer_codes(client)
    expected = preview(client)
    virtual.writes.clear()
    response = arrange(client)
    assert response.status_code == 200, response.text
    assert len(virtual.writes) == expected["writes"]
    # every write changed something
    assert all(w[0] == "keycode" for w in virtual.writes)
    layers = response.json()["layers"]
    assert [(layer["name"], layer["customName"]) for layer in layers] == [
        ("Base", False), ("Num", True), ("Sym", True), ("Layer 3", False)]
    after = [[k["code"] for k in layer["keys"]] for layer in layers]
    renumbered = {"LT1(KC_SPACE)": "LT2(KC_SPACE)", "LT2(KC_B)": "LT3(KC_B)", "LT2(KC_S)": "LT3(KC_S)", "OSL(3)": "OSL(1)"}
    assert after[0] == [renumbered.get(code, code) for code in before[0]]
    assert after[1:] == [before[3], before[1], before[2]]
    assert client.get("/api/names").json()["layers"] == {"1": "Num", "2": "Sym"}


def test_the_reverse_order_puts_everything_back(setup, tmp_path):
    client, manager, _ = setup
    name_layers(client, {2: "Nav"})
    assert client.put("/api/macros", json={"items": [[{"type": "tap", "keys": ["MO(2)", "KC_A"]}]] + [[]] * 15}) \
        .status_code == 200
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    named = client.get("/api/names").json()
    assert arrange(client).status_code == 200
    macro = client.get("/api/keyboard").json()["macros"]["items"][0]["actions"][0]["keys"]
    assert [k["code"] for k in macro] == ["MO(3)", "KC_A"]
    assert snapshot(virtual) != start
    assert arrange(client, reverse(ORDER)).status_code == 200
    assert snapshot(virtual) == start
    assert client.get("/api/names").json() == named


def test_random_orders_round_trip_on_the_keyboard(tmp_path, monkeypatch):
    rng = random.Random(4)
    manager, _, app = make_app(tmp_path, monkeypatch, factory=lambda: make_corne(layers=8))
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        layer_keys = ["MO({})", "TG({})", "TO({})", "OSL({})", "TT({})", "LT{}(KC_A)", "LM({}, MOD_LSFT)", "DF({})"]
        for _ in range(20):
            layer, row, col = rng.randrange(8), rng.randrange(4), rng.randrange(3, 6)
            code = rng.choice(layer_keys).format(rng.randrange(8))
            assert client.put("/api/keymap/{}/{}/{}".format(layer, row, col), json={"code": code}).status_code == 200
        virtual = manager.backend.virtual
        start = snapshot(virtual)
        for _ in range(5):
            order = [0] + rng.sample(range(1, 8), 7)
            assert arrange(client, order).status_code == 200
            assert arrange(client, reverse(order)).status_code == 200
            assert snapshot(virtual) == start, order


def test_a_keyboard_switch_in_between_is_refused(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, second=make_corne)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        manager.backend.set_second_connected(True)
        manager.check()
        first, second = (e.info.id for e in manager.keyboard_list().entries)
        assert client.post("/api/keyboards/select", json={"id": second}).status_code == 200
        writes = len(manager.backend.second.writes)
        meant = {"x-vial-keyboard": urllib.parse.quote(first, safe="")}
        for path in ("/api/layers/arrange", "/api/layers/arrange/preview"):
            assert client.post(path, json={"order": ORDER}, headers=meant).status_code == 409
        assert len(manager.backend.second.writes) == writes


def test_unlock_comes_first_when_qk_boot_must_move(setup):
    client, manager, _ = setup
    assert client.put("/api/keymap/1/0/1", json={"code": "QK_BOOT"}).status_code == 200
    virtual = manager.backend.virtual
    virtual.unlocked = False
    assert preview(client)["needsUnlock"]
    before = snapshot(virtual)
    virtual.writes.clear()
    response = arrange(client)
    assert response.status_code == 423
    assert virtual.writes == [] and snapshot(virtual) == before
    virtual.unlocked = True
    assert arrange(client).status_code == 200
    assert manager.run(lambda kb: kb.layout[(2, 0, 1)]) == "QK_BOOT"


def test_problems_refuse_apply(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, factory=lambda: make_corne(layers=20))
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        order = [0, 1, 3] + list(range(4, 20)) + [2]  # layer 2 to position 19: LT2(KC_B) can't hold it
        result = preview(client, order)
        assert result["problems"] and all("can't go to position 19" in p for p in result["problems"])
        virtual = manager.backend.virtual
        virtual.writes.clear()
        response = arrange(client, order)
        assert response.status_code == 409 and "can't go to position 19" in response.json()["detail"]
        assert virtual.writes == []


# ---------- a write that fails partway ----------

def test_a_failure_partway_then_finish(setup, tmp_path, monkeypatch):
    client, manager, _ = setup
    name_layers(client, {3: "Num"})
    target = arranged_elsewhere(tmp_path, monkeypatch, lambda c: None, ORDER)
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    total = preview(client)["writes"]
    virtual.fail_writes(10)
    response = arrange(client)
    assert response.status_code == 502
    assert snapshot(virtual) not in (start, target)
    # the handle stopped working: the hot-plug poll opens the keyboard again
    manager.check()
    assert client.get("/api/session").json()["arrange"] == {"order": ORDER, "done": 9, "total": total}
    # names don't move until it is finished; nothing else is arranged meanwhile
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    assert arrange(client, [0, 2, 1, 3]).status_code == 409
    # Finish fails too, and is tried again
    virtual.fail_writes(3)
    assert client.post("/api/layers/arrange/finish").status_code == 502
    manager.check()
    left = client.get("/api/session").json()["arrange"]
    assert left["done"] == 2 and left["total"] == total - 9
    response = client.post("/api/layers/arrange/finish")
    assert response.status_code == 200, response.text
    assert snapshot(virtual) == target
    assert client.get("/api/session").json()["arrange"] is None
    assert client.get("/api/names").json()["layers"] == {"1": "Num"}
    assert client.post("/api/layers/arrange/finish").status_code == 404
    assert client.post("/api/layers/arrange/put-back").status_code == 404


def test_a_failure_partway_then_put_back(setup):
    client, manager, _ = setup
    name_layers(client, {3: "Num"})
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    virtual.fail_writes(20)
    assert arrange(client).status_code == 502
    manager.check()
    assert client.post("/api/layers/arrange/put-back").status_code == 200
    assert snapshot(virtual) == start
    assert client.get("/api/names").json()["layers"] == {"3": "Num"}
    assert client.get("/api/session").json()["arrange"] is None


def test_unplugged_partway_then_finished_after_a_replug(setup, tmp_path, monkeypatch):
    client, manager, _ = setup
    target = arranged_elsewhere(tmp_path, monkeypatch, lambda c: None, ORDER)
    virtual = manager.backend.virtual
    virtual.fail_writes(5, unplug=True)
    assert arrange(client).status_code == 503
    assert not manager.connected
    assert client.get("/api/session").json()["arrange"] is None  # no keyboard loaded to say it of
    assert client.post("/api/layers/arrange/finish").status_code == 503
    manager.backend.set_connected(True)
    manager.check()
    assert client.get("/api/session").json()["arrange"]["done"] == 4
    assert client.post("/api/layers/arrange/finish").status_code == 200
    assert snapshot(virtual) == target


def test_a_failure_at_the_first_write_can_be_put_back(setup):
    client, manager, _ = setup
    virtual = manager.backend.virtual
    start = snapshot(virtual)
    virtual.fail_writes(1)
    assert arrange(client).status_code == 502
    manager.check()
    assert client.get("/api/session").json()["arrange"]["done"] == 0
    virtual.writes.clear()
    assert client.post("/api/layers/arrange/put-back").status_code == 200
    assert virtual.writes == [] and snapshot(virtual) == start


def test_the_fail_write_hook_is_fake_only_and_not_in_the_schema(setup):
    client, manager, _ = setup
    assert "/api/simulator/fail-write" not in client.get("/openapi.json").json()["paths"]
    assert client.put("/api/simulator/fail-write", json={"after": 2}).status_code == 200
    assert manager.backend.virtual.fail_write_in == 2
    assert client.put("/api/simulator/fail-write", json={"after": None}).status_code == 200
    assert manager.backend.virtual.fail_write_in is None


# ---------- encoders ----------

KNOB = {"name": "Knob", "matrix": {"rows": 1, "cols": 2},
        "layouts": {"keymap": [["0,0", "0,1", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


def knob():
    virtual = VirtualKeyboard(KNOB, layers=3, keymap={(0, 0, 0): encode("MO(2)"), (2, 0, 1): encode("KC_A")})
    virtual.encoders = {(0, 0, 0): encode("TG(1)"), (0, 0, 1): encode("KC_VOLU"), (1, 0, 0): encode("KC_B"),
                        (2, 0, 1): encode("TO(2)")}
    return virtual


def test_encoders_move_and_follow(tmp_path, monkeypatch):
    manager, _, app = make_app(tmp_path, monkeypatch, factory=knob)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        result = preview(client, [0, 2, 1])
        assert result["references"] == {"keymap": 1, "encoders": 2, "tapDance": 0, "combos": 0, "keyOverrides": 0,
                                        "altRepeatKeys": 0, "macros": 0}
        assert arrange(client, [0, 2, 1]).status_code == 200
        held = manager.run(lambda kb: dict(kb.encoder_layout))
        assert held[(0, 0, 0)] == "TG(2)" and held[(0, 0, 1)] == "KC_VOLU"
        assert held[(2, 0, 0)] == "KC_B" and held[(1, 0, 1)] == "TO(1)"
        assert manager.run(lambda kb: (kb.layout[(0, 0, 0)], kb.layout[(1, 0, 1)])) == ("MO(1)", "KC_A")
        virtual = manager.backend.virtual
        assert Keycode.serialize(virtual.encoders[(1, 0, 1)]) == "TO(1)"
        assert copy.deepcopy(virtual.keymap[1][0]) == [0, encode("KC_A")]
```

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -120,7 +120,7 @@ def test_session_and_keyboard(client):
     assert client.get("/api/session").json() == \
         {"status": "connected", "fake": True, "device": "Simulated: Simulated Corne", "error": None, "errorKind": None,
          "keyboard": "f00d:cafe:serial:SIM0001#1", "platform": sys.platform,
-         "unlock": {"state": "unlocked", "keys": [], "remaining": 0, "total": 0}}
+         "unlock": {"state": "unlocked", "keys": [], "remaining": 0, "total": 0}, "arrange": None}
     kb = client.get("/api/keyboard").json()
     assert (kb["name"], len(kb["layers"]), len(kb["keys"])) == ("Simulated Corne", 4, 42)
 
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_arrange.py test/test_api.py
```

Expected: `FAILED test/test_api.py::test_session_and_keyboard` and `21 failed, 58 passed`: the routes answer 404, and the session has no arrange yet.

- [ ] **Step 3: The models, the arranger and the routes**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -352,6 +352,54 @@ class LayoutFilePreview(BaseModel):
     """ writing it needs an unlocked keyboard (it changes the macros, or puts QK_BOOT somewhere) """
 
 
+class LayerMove(BaseModel):
+    """ A layer that an arrange moves: from position `layer` to position `to` """
+    layer: int
+    to: int
+
+
+class ArrangeReferences(BaseModel):
+    """ By place: the keycodes whose layer number an arrange changes """
+    keymap: int
+    encoders: int
+    tapDance: int
+    combos: int
+    keyOverrides: int
+    altRepeatKeys: int
+    macros: int
+
+
+class ArrangePreview(BaseModel):
+    """ What arranging the layers in an order would change; nothing is written to find out """
+    moves: list[LayerMove]
+    """ the layers that move, by their position now """
+    keys: int
+    """ keymap keys and encoder directions rewritten """
+    references: ArrangeReferences
+    keyOverrides: int
+    """ key overrides whose "active on layers" changes """
+    triLayer: Optional[list[Optional[int]]] = None
+    """ a tri-layer key (FN_MO13, FN_MO23) is set and layers 1 to 3 change: they use layers 1, 2 and 3 by number,
+    which then hold the layers that are now at these positions (null for one the keyboard doesn't have) """
+    problems: list[str]
+    """ why the order can't be written (a layer number that doesn't fit where it must go); none: it can """
+    writes: int
+    """ the writes it takes: one per key, encoder direction and entry, and one for the macros """
+    needsUnlock: bool
+    """ writing it needs an unlocked keyboard (it moves QK_BOOT, or changes the macros) """
+
+
+class UnfinishedArrange(BaseModel):
+    """ Arranging the layers stopped partway (a write failed): the keyboard may hold part of the new order, until
+    POST /api/layers/arrange/finish or /put-back succeeds """
+    order: list[int]
+    """ the order being written (ArrangeIn.order) """
+    done: int
+    """ the writes the last attempt did before it stopped """
+    total: int
+    """ the writes it had to do """
+
+
 class Session(BaseModel):
     status: Literal["connected", "disconnected"]
     fake: bool
@@ -366,6 +414,8 @@ class Session(BaseModel):
     """ the server's operating system, as Python's sys.platform names it: "win32", "linux", "darwin"... """
     unlock: UnlockState
     """ a keyboard that is unlocking while not connected waits for an unlock started earlier, before it is read """
+    arrange: Optional[UnfinishedArrange] = None
+    """ arranging the layers of the keyboard loaded stopped partway, and hasn't been finished or put back """
 
 
 class KeyboardEntry(BaseModel):
@@ -566,6 +616,20 @@ class SimulatorUnlock(Request):
     """ true: lock it, as plugging it in again would """
 
 
+class SimulatorFailWrite(Request):
+    """ Fake mode only: the `after`th write from now to the simulated keyboard fails (1: the next one); null: none does.
+    unplug: the keyboard drops off the bus at that write (plugged back in with SimulatorConnection), else it stays
+    plugged in and its connection stops working (the server opens it again, as after a USB reset) """
+    after: Optional[int] = Field(default=None, ge=1, le=100_000)
+    unplug: bool = False
+
+
+class ArrangeIn(Request):
+    order: list[Byte] = Field(min_length=1, max_length=256)
+    """ for each new position, the layer that goes there: [0, 3, 1, 2] puts layer 3 at position 1. Every layer once,
+    layer 0 first. """
+
+
 class SelectKeyboard(Request):
     id: str = Field(max_length=1000)
     """ KeyboardEntry.id of the keyboard to use """
```

Create `src/main/python/server/arranger.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Arranging a keyboard's layers (server.layers) on the keyboard itself: its loaded state read into a KeyboardState,
and a KeyboardState written back, only what differs, in a fixed order. An arrange stopped partway is kept, by the
keyboard's UID, while the server runs: Finish writes the rest of it, Put back writes the state from before.

The functions that take the loaded Keyboard are called by DeviceManager.run, which holds the device lock.
"""
import dataclasses
import threading

from keycodes.keycodes import Keycode, RESET_KEYCODE
from macro.macro_action import ActionDelay, ActionSequence, ActionText, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.key_override import KeyOverrideEntry
from protocol.unlock_hook import request_unlock
from server import layers, model, schemas
from server.describe import keycode_protocol


def _value(code):
    return Keycode.deserialize(code)


def _code(value):
    """ A firmware keycode as the protocol layer keeps it """
    return Keycode.normalize(Keycode.serialize(value))


def _steps(actions):
    """ A macro's protocol actions -> its steps, as KeyboardState has them """
    out = []
    for action in actions:
        if isinstance(action, ActionText):
            out.append(("text", action.text))
        elif isinstance(action, ActionDelay):
            out.append(("delay", action.delay))
        elif isinstance(action, ActionSequence):
            out.append((action.tag, tuple(_value(code) for code in action.sequence)))
    return tuple(out)


def _actions(steps):
    """ A macro's steps -> protocol actions """
    out = []
    for step in steps:
        if step[0] == "text":
            out.append(ActionText(step[1]))
        elif step[0] == "delay":
            out.append(ActionDelay(step[1]))
        else:
            out.append(tag_to_action[step[0]]([_code(value) for value in step[1]]))
    return out


def read_state(kb):
    """ The loaded keyboard -> KeyboardState (no device I/O) """
    return layers.KeyboardState(
        layers=kb.layers,
        keys={pos: _value(code) for pos, code in kb.layout.items()},
        encoders={pos: _value(code) for pos, code in kb.encoder_layout.items()},
        tap_dance=tuple(tuple(_value(c) for c in e[:4]) + (e[4],) for e in kb.tap_dance_entries),
        combos=tuple(tuple(_value(c) for c in e) for e in kb.combo_entries),
        key_overrides=tuple((_value(e.trigger), _value(e.replacement), e.layers, e.trigger_mods, e.negative_mod_mask,
                             e.suppressed_mods, e.options.serialize()) for e in kb.key_override_entries),
        alt_repeat_keys=tuple((_value(e.keycode), _value(e.alt_keycode), e.allowed_mods, e.options.serialize())
                              for e in kb.alt_repeat_key_entries),
        macros=tuple(_steps(actions) for actions in kb.macros_deserialize(kb.macro)),
    )


def _macro_data(kb, macros):
    """ The macro buffer for these macros' steps: the bytes the keyboard holds for each macro whose steps don't change
    (so a macro that reads back otherwise than it was written stays as it is), the others written anew. ValueError when
    it doesn't fit the macro memory. """
    held = (kb.macro.split(b"\x00") + [b""] * kb.macro_count)[:kb.macro_count]
    current = [_steps(actions) for actions in kb.macros_deserialize(kb.macro)]
    data = b"".join((held[i] if steps == current[i] else kb.macro_serialize(_actions(steps))) + b"\x00"
                    for i, steps in enumerate(macros))
    if len(data) > kb.macro_memory:
        raise ValueError("the macros would need {} bytes but the keyboard has {}".format(len(data), kb.macro_memory))
    return data


@dataclasses.dataclass
class Plan:
    """ What writing a KeyboardState to the keyboard takes: each write, in order. Built from what the keyboard holds;
    nothing is written to build it. """
    keys: list
    """ ((layer, row, col), keycode string) """
    encoders: list
    tap_dance: list
    """ (index, entry as the protocol layer keeps it) """
    combos: list
    key_overrides: list
    alt_repeat_keys: list
    macro: bytes = None
    """ the macro buffer, when it changes """

    @property
    def writes(self):
        """ How many writes it takes: one per key, encoder direction and entry, and one for the macro buffer """
        return (len(self.keys) + len(self.encoders) + len(self.tap_dance) + len(self.combos) + len(self.key_overrides)
                + len(self.alt_repeat_keys) + (self.macro is not None))

    def needs_unlock(self):
        """ Whether the keyboard must be unlocked for it, by the protocol layer's rules: QK_BOOT written anywhere, or the
        macros (which the protocol always writes unlocked) """
        def boot(code):
            return code == RESET_KEYCODE
        return any((
            any(boot(c) for _, c in self.keys), any(boot(c) for _, c in self.encoders),
            any(any(boot(c) for c in e[:4]) for _, e in self.tap_dance),
            any(boot(e[4]) for _, e in self.combos),
            any(boot(e.replacement) for _, e in self.key_overrides),
            any(boot(e.keycode) or boot(e.alt_keycode) for _, e in self.alt_repeat_keys),
            self.macro is not None,
        ))


def plan(kb, target):
    """ The writes that make the keyboard hold `target` (a KeyboardState of its layers): only what differs. ValueError
    when the target's macros don't fit. """
    keys = [(pos, _code(value)) for pos, value in sorted(target.keys.items())
            if pos in kb.layout and _value(kb.layout[pos]) != value]
    encoders = [(pos, _code(value)) for pos, value in sorted(target.encoders.items())
                if pos in kb.encoder_layout and _value(kb.encoder_layout[pos]) != value]

    def differing(entries, held, convert):
        out = []
        for index, entry in enumerate(entries):
            new = convert(entry)
            if index < len(held) and new != held[index]:
                out.append((index, new))
        return out

    state = read_state(kb)
    tap_dance = differing(target.tap_dance, kb.tap_dance_entries,
                          lambda e: tuple(_code(c) for c in e[:4]) + (e[4],))
    combos = differing(target.combos, kb.combo_entries, lambda e: tuple(_code(c) for c in e))
    key_overrides = differing(target.key_overrides, kb.key_override_entries,
                              lambda e: KeyOverrideEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    alt_repeat_keys = differing(target.alt_repeat_keys, kb.alt_repeat_key_entries,
                                lambda e: AltRepeatKeyEntry((_code(e[0]), _code(e[1])) + tuple(e[2:])))
    macro = None
    if tuple(target.macros) != state.macros:
        data = _macro_data(kb, target.macros)
        macro = data if data != kb.macro else None
    return Plan(keys, encoders, tap_dance, combos, key_overrides, alt_repeat_keys, macro)


def write(kb, todo, written):
    """ Write a Plan, in its order: keymap and encoders; tap dance, combos, key overrides, alt-repeat keys; then the
    macros. written: a list that gets one item per write done, so that a failure partway tells how far it got. """
    for (layer, row, col), code in todo.keys:
        kb.set_key(layer, row, col, code)
        written.append(1)
    for (layer, index, direction), code in todo.encoders:
        kb.set_encoder(layer, index, direction, code)
        written.append(1)
    for setter, entries in ((kb.tap_dance_set, todo.tap_dance), (kb.combo_set, todo.combos),
                            (kb.key_override_set, todo.key_overrides),
                            (kb.alt_repeat_key_set, todo.alt_repeat_keys)):
        for index, entry in entries:
            setter(index, entry)
            written.append(1)
    if todo.macro is not None:
        request_unlock(kb)
        kb.set_macro(todo.macro)
        written.append(1)


def preview(kb, order):
    """ What arranging the layers to `order` would change -> schemas.ArrangePreview. Nothing is written; it works on a
    locked keyboard too (needsUnlock says whether writing it needs the keyboard unlocked). ValueError for an order
    that isn't the keyboard's layers with layer 0 first. """
    result = layers.arrange(read_state(kb), order, keycode_protocol())
    try:
        todo = plan(kb, result.target)
    except ValueError as e:
        todo = None
        problems = [str(e)]
    else:
        problems = []
    return schemas.ArrangePreview(
        moves=[schemas.LayerMove(layer=old, to=new) for old, new in result.moves],
        keys=result.keys,
        references=schemas.ArrangeReferences(**result.references),
        keyOverrides=result.key_overrides,
        triLayer=None if result.tri_layer is None else list(result.tri_layer),
        problems=["{}: {}".format(p.where, p.text) for p in result.problems] + problems,
        writes=0 if todo is None else todo.writes,
        needsUnlock=False if todo is None else todo.needs_unlock(),
    )


class ArrangeRefused(Exception):
    """ An arrange that can't be written now: one of this keyboard is unfinished, or the order has problems """


class NothingUnfinished(LookupError):
    """ Finish or Put back with no arrange of this keyboard left unfinished """


@dataclasses.dataclass
class Unfinished:
    """ An arrange that stopped partway: the keyboard holds part of `target`, and of `start` """
    start: layers.KeyboardState
    target: layers.KeyboardState
    order: list
    done: int
    """ writes done by the last attempt before it stopped """
    total: int
    """ writes the last attempt had to do """


class Arrangements:
    """ The arranges left unfinished, by keyboard UID, while the server runs; safe across threads """

    def __init__(self):
        self._unfinished = {}
        self._lock = threading.Lock()

    def get(self, uid):
        with self._lock:
            return self._unfinished.get(uid)

    def keep(self, uid, unfinished):
        with self._lock:
            self._unfinished[uid] = unfinished

    def drop(self, uid):
        with self._lock:
            self._unfinished.pop(uid, None)


class Job:
    """ Writing a state to the keyboard as part of an arrange (start -> target, by order), under the device lock.
    Planned and unlocked for when made: nothing is written before run(), which writes `writing`, then calls done(). A
    failure once something was written keeps the arrange as Unfinished, for Finish or Put back. """

    def __init__(self, kb, writing, start, target, order, arrangements, done):
        self.kb = kb
        self.uid = model.uid_of(kb)
        self.start, self.target, self.order = start, target, list(order)
        self.arrangements = arrangements
        self.done = done
        self.todo = plan(kb, writing)
        self.written = []
        if self.todo.needs_unlock():
            request_unlock(kb)

    def run(self):
        try:
            write(self.kb, self.todo, self.written)
        except Exception:
            # even the first write may have reached the keyboard, its answer lost: it may hold part of either state
            self.arrangements.keep(self.uid, Unfinished(self.start, self.target, self.order, len(self.written),
                                                        self.todo.writes))
            raise
        self.done()


def begin(kb, order, arrangements, names):
    """ A Job arranging the keyboard's layers to `order`, computed from what it holds now. ArrangeRefused while an
    arrange of it is unfinished, or when the order has problems; ValueError for a bad order. The names move once every
    write has succeeded. """
    uid = model.uid_of(kb)
    if arrangements.get(uid) is not None:
        raise ArrangeRefused("arranging this keyboard's layers stopped partway: finish it or put it back first")
    start = read_state(kb)
    result = layers.arrange(start, order, keycode_protocol())
    if result.problems:
        raise ArrangeRefused("the layers can't be arranged so: " + "; ".join(
            "{}: {}".format(p.where, p.text) for p in result.problems))
    return Job(kb, result.target, start, result.target, order, arrangements, lambda: names.move_layers(uid, order))


def resume(kb, arrangements, names, finish):
    """ A Job writing the unfinished arrange of this keyboard to its end (finish: its target, then the names), or back
    to where it started (its start state; the names were never moved). NothingUnfinished when there is none. """
    uid = model.uid_of(kb)
    unfinished = arrangements.get(uid)
    if unfinished is None:
        raise NothingUnfinished("no arrange of this keyboard's layers is unfinished")

    def done():
        if finish:
            names.move_layers(uid, unfinished.order)
        arrangements.drop(uid)
    writing = unfinished.target if finish else unfinished.start
    return Job(kb, writing, unfinished.start, unfinished.target, unfinished.order, arrangements, done)
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -17,7 +17,7 @@ from fastapi.staticfiles import StaticFiles
 from starlette.requests import HTTPConnection
 
 from protocol.qmk_settings_codec import QmkSettingsCodec
-from server import device, edits, languages, model, schemas
+from server import arranger, device, edits, languages, model, schemas
 from server.describe import keyboard_language, parse
 from server.device import JumpUnanswered, KeyboardChanged, NotConnected, KeyboardLocked, KeyboardRefused, \
     UnknownKeyboard
@@ -436,6 +436,9 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     app.state.manager = manager
     app.state.unlock_follower = follower
     app.state.matrix = matrix
+    arrangements = arranger.Arrangements()
+    """ arranges of the layers left unfinished, by keyboard UID """
+    app.state.arrangements = arrangements
 
     def openapi():
         # WebSocket messages have no place in OpenAPI's paths: the event shape is added as a component, so the UI's
@@ -501,6 +504,14 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     async def too_deep(request, exc):
         return JSONResponse({"detail": "the request is nested too deeply"}, status_code=422)
 
+    @app.exception_handler(arranger.ArrangeRefused)
+    async def arrange_refused(request, exc):
+        return JSONResponse({"detail": str(exc)}, status_code=409)
+
+    @app.exception_handler(arranger.NothingUnfinished)
+    async def nothing_unfinished(request, exc):
+        return JSONResponse({"detail": str(exc)}, status_code=404)
+
     @app.exception_handler(KeyboardRefused)
     async def refused(request, exc):
         # it answered, and can't take the change: the page shows the message (a 502 would read "didn't respond")
@@ -561,15 +572,24 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         # fake: a second launch only attaches to an instance of its own mode (see vial_web.FAKE_SUBDIR)
         return {"app": "vial", "instance": instance_id, "fake": manager.backend.fake}
 
+    def unfinished_arrange():
+        """ The arrange of the keyboard loaded left unfinished, as the API has it; the device lock held """
+        kb = manager.keyboard
+        unfinished = None if kb is None else arrangements.get(model.uid_of(kb))
+        if unfinished is None:
+            return None
+        return schemas.UnfinishedArrange(order=unfinished.order, done=unfinished.done, total=unfinished.total)
+
     @app.get("/api/session", response_model=schemas.Session)
     def session():
         with manager.lock:  # read together
             status = manager.status()
             unlock = unlock_model(manager.unlock_state())
             error_kind, open_id = manager.error_kind, manager.open_id
+            arrange = unfinished_arrange()
         return schemas.Session(status="connected" if status.connected else "disconnected",
                                fake=manager.backend.fake, device=status.title, error=status.error, errorKind=error_kind,
-                               keyboard=open_id, platform=sys.platform, unlock=unlock)
+                               keyboard=open_id, platform=sys.platform, unlock=unlock, arrange=arrange)
 
     def keyboard_list():
         listed = manager.keyboard_list()
@@ -762,6 +782,54 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         data = await read_limited(request, MAX_LAYOUT_FILE)
         return await asyncio.to_thread(read, lambda kb: edits.preview_layout_file(kb, data, names_for(kb)), lang)
 
+    @app.post("/api/layers/arrange/preview", response_model=schemas.ArrangePreview)
+    def preview_arrange(body: schemas.ArrangeIn):
+        """ What POST /api/layers/arrange would change with this order, checked the same way; nothing is written. It
+        works on a locked keyboard too: needsUnlock says whether writing it needs the keyboard unlocked. """
+        return read(lambda kb: arranger.preview(kb, body.order))
+
+    async def arranging(begin, lang):
+        """ begin(kb) -> arranger.Job, checked and unlocked for (nothing written yet), run under the device lock. A
+        failure while it writes leaves the arrange unfinished (the Job keeps it): the keyboard is read again, every tab
+        told. On success, every tab is told the keyboard changed; returns its new model. """
+        languages.overrides(lang)  # an unknown language is refused before anything is written
+        writing = []
+
+        def go(kb):
+            job = begin(kb)
+            writing.append(True)
+            job.run()
+            return model.build(kb, names_for(kb), manager.unlocked)
+        try:
+            result = await asyncio.to_thread(run, go, lang)
+        except Exception:
+            if writing:
+                await resync()
+            raise
+        await hub.broadcast({"type": "reloaded"})
+        return result
+
+    @app.post("/api/layers/arrange", response_model=schemas.KeyboardModel)
+    async def arrange_layers(body: schemas.ArrangeIn, lang: Lang = languages.DEFAULT):
+        """ Move the layers to this order: every layer reference renumbered (keymap, encoders, tap dance, combos, key
+        overrides and their layers, alt-repeat keys, macros), the layer names moved once everything was written.
+        Computed again from what the keyboard holds now; only what differs is written, under one device lock. 409 when
+        the order has problems, or an arrange of this keyboard is unfinished; 423 when it needs the keyboard unlocked
+        (nothing was written). A write that fails leaves the arrange unfinished (Session.arrange). """
+        return await arranging(lambda kb: arranger.begin(kb, body.order, arrangements, names), lang)
+
+    @app.post("/api/layers/arrange/finish", response_model=schemas.KeyboardModel)
+    async def finish_arrange(lang: Lang = languages.DEFAULT):
+        """ Write what the unfinished arrange of this keyboard still has to (what differs from its new order), then move
+        the names. 404 when none is unfinished. It can be asked again after a failure. """
+        return await arranging(lambda kb: arranger.resume(kb, arrangements, names, finish=True), lang)
+
+    @app.post("/api/layers/arrange/put-back", response_model=schemas.KeyboardModel)
+    async def put_back_arrange(lang: Lang = languages.DEFAULT):
+        """ Write back what the unfinished arrange of this keyboard changed (what differs from the state before it); the
+        names never moved. 404 when none is unfinished. It can be asked again after a failure. """
+        return await arranging(lambda kb: arranger.resume(kb, arrangements, names, finish=False), lang)
+
     @app.post("/api/unlock/start", response_model=schemas.UnlockState)
     async def start_unlock():
         """ Start unlocking the keyboard: the user then holds its unlock keys until the countdown ends, which "unlock"
@@ -906,6 +974,14 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                 manager.backend.set_connected(body.connected)
             return {"connected": body.connected}
 
+        # for UI tests: a write to the first simulated keyboard fails (arranging stopped partway). Never exists for real
+        # keyboards.
+        @app.put("/api/simulator/fail-write", include_in_schema=False)
+        def set_simulator_fail_write(body: schemas.SimulatorFailWrite):
+            with manager.lock:
+                manager.backend.fail_writes(body.after, unplug=body.unplug)
+            return {"after": body.after, "unplug": body.unplug}
+
         # for UI tests: plug a second simulated keyboard in, or unplug it. Never exists for real keyboards.
         @app.put("/api/simulator/second-keyboard", include_in_schema=False)
         def set_simulator_second_keyboard(body: schemas.SimulatorSecondKeyboard):
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_arrange.py test/test_api.py
```

Expected: `79 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1224 passed, 6 skipped`.

- [ ] **Step 5: The API types regenerated, and every web check**

```bash
cd web && npm run gen:api && npm run check:api && npm run check && npm test
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  817 passed (817)`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/arranger.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_arrange.py \
  web/src/api/schema.d.ts
git commit -m "feat(server): arrange layers routes: preview, apply, finish and put back an arrange stopped partway"
```

### Task 6: The store arranges layers, and finishes or puts back an arrange stopped partway

- **`api.ts`:** `previewArrange(order)`, `arrangeLayers(order)`, `finishArrange()`, `putBackArrange()`. **`types.ts`:** `ArrangePreview`, `ArrangeReferences`, `UnfinishedArrange`.
- **`toasts.info`** returns the toast's id, so the previous Undo toast can be dismissed when the next arrange is made.
- **`KeyboardStore`** (`keyboard.svelte.ts`):
  - `unfinishedArrange`: the session's `arrange`, or `null`.
  - `arrangeLayers(order, report?, action?)`, `finishArrange(report?)`, `putBackArrange(report?)` go through `#arrange`, which goes through `#edit` (busy and pending; a 423 unlocks the keyboard and sends it again, once; the new model replaces the old one if it is still shown). Then `refreshSession()` reads the session again, done or not, so a stop shows at once.
  - `#edit` takes an optional `report(message)`: the dialog shows a failure inline instead of a toast.

Nothing calls these yet; Task 7's arranger and Task 8's dialog do, and Task 9's e2e tests run them end to end. `keyboard.test.ts` already covers `#edit`'s busy, pending and 423 handling, which these share.

**Files:**
- Modify: `web/src/api/api.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/lib/toasts.svelte.ts`
- Modify: `web/src/lib/keyboard.svelte.ts`

- [ ] **Step 1: The routes, the types, the toast's id**

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -44,6 +44,14 @@ export const api = {
   previewLayoutFile: (text: string) => request("post", "/api/layout-file/preview", { raw: text }),
   /** writes a .vil file to the keyboard: the whole file, or nothing when it doesn't fit */
   loadLayoutFile: (text: string) => request("post", "/api/layout-file", { raw: text }),
+  /** what arranging the layers in this order would change (order[position] = layer now); nothing is written */
+  previewArrange: (order: number[]) => request("post", "/api/layers/arrange/preview", { body: { order } }),
+  /** moves the layers to this order, every layer reference following, and their names; answers the new model */
+  arrangeLayers: (order: number[]) => request("post", "/api/layers/arrange", { body: { order } }),
+  /** writes the rest of an arrange that stopped partway, then moves the names */
+  finishArrange: () => request("post", "/api/layers/arrange/finish"),
+  /** writes back what an arrange that stopped partway changed */
+  putBackArrange: () => request("post", "/api/layers/arrange/put-back"),
   setName: (kind: Named["kind"], index: number, name: string) =>
     request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
   unlockStart: () => request("post", "/api/unlock/start"),
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -37,6 +37,9 @@ export type SettingField = Schemas["SettingField"];
 export type SettingsTab = Schemas["SettingsTab"];
 export type SettingsDefinitions = Schemas["SettingsDefinitions"];
 export type LayoutFilePreview = Schemas["LayoutFilePreview"];
+export type ArrangePreview = Schemas["ArrangePreview"];
+export type ArrangeReferences = Schemas["ArrangeReferences"];
+export type UnfinishedArrange = Schemas["UnfinishedArrange"];
 export type UnlockState = Schemas["UnlockState"];
 export type MatrixPosition = Schemas["MatrixPosition"];
 export type MatrixState = Schemas["MatrixState"];
```

Apply to `web/src/lib/toasts.svelte.ts`:

```diff
diff --git a/web/src/lib/toasts.svelte.ts b/web/src/lib/toasts.svelte.ts
--- a/web/src/lib/toasts.svelte.ts
+++ b/web/src/lib/toasts.svelte.ts
@@ -38,9 +38,10 @@ export class Toasts {
     this.#add({ message, tone: "error" });
   }
 
-  /** What was done, maybe with an action (Undo) */
-  info(message: string, action?: ToastAction): void {
-    this.#add({ message, tone: "info", action });
+  /** What was done, maybe with an action (Undo). Returns the toast's id (to dismiss it once its action no longer
+   * applies). */
+  info(message: string, action?: ToastAction): number {
+    return this.#add({ message, tone: "info", action });
   }
 
   /** Runs a toast's action, unless the toast has gone or its action is running already */
@@ -55,11 +56,12 @@ export class Toasts {
     }
   }
 
-  #add(toast: Omit<Toast, "id">): void {
+  #add(toast: Omit<Toast, "id">): number {
     const id = this.#next++;
     this.items.push({ id, ...toast });
     this.#holds.set(id, new Set());
     this.#countDown(id);
+    return id;
   }
 
   dismiss(id: number): void {
```

- [ ] **Step 2: The store**

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -7,7 +7,7 @@ import { ApiError, causeMessage, failureMessage } from "../api/errors";
 import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "../api/events";
 import type {
   AltRepeatKeyIn, KeyboardLanguage, KeyboardList, KeyboardModel, KeycodeCategory, KeyOverrideIn, LightingIn,
-  MacroActionIn, MatrixState, Named, QmkSetting, Session, TapDanceIn,
+  MacroActionIn, MatrixState, Named, QmkSetting, Session, TapDanceIn, UnfinishedArrange,
 } from "../api/types";
 import { keyTitle, namesOf } from "../keyboard/labels";
 import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
@@ -143,6 +143,11 @@ export class KeyboardStore {
     return this.#modelKeyboard;
   }
 
+  /** arranging the layers of the keyboard loaded stopped partway, as the session last said; null for none */
+  get unfinishedArrange(): UnfinishedArrange | null {
+    return this.session?.arrange ?? null;
+  }
+
   /** Load the language list, then follow the server's events (which start with the keyboard's state) */
   start(): () => void {
     // called from an effect, it must not run again when the state it reads or writes changes
@@ -698,6 +703,48 @@ export class KeyboardStore {
     });
   }
 
+  /** Move the layers to `order` (order[position] = layer now): the server renumbers every layer reference and moves
+   * the names, writing only what differs. A keyboard that must be unlocked for it (QK_BOOT moves, or the macros change)
+   * is unlocked first, as nothing was written. A write that fails leaves the arrange unfinished (unfinishedArrange).
+   * report: says why it wasn't done, instead of a toast. Returns whether it was done. */
+  arrangeLayers(order: number[], report?: (message: string) => void, action = "Arranging the layers"):
+    Promise<boolean> {
+    return this.#arrange(action, () => api.arrangeLayers(order), report);
+  }
+
+  /** Write the rest of an arrange that stopped partway, then move the names */
+  finishArrange(report?: (message: string) => void): Promise<boolean> {
+    return this.#arrange("Finishing the arrange", () => api.finishArrange(), report);
+  }
+
+  /** Write back what an arrange that stopped partway changed */
+  putBackArrange(report?: (message: string) => void): Promise<boolean> {
+    return this.#arrange("Putting the layers back", () => api.putBackArrange(), report);
+  }
+
+  /** An arrange's request; the session (which says whether one is unfinished) is read again afterwards, done or not */
+  async #arrange(action: string, send: () => Promise<KeyboardModel>, report?: (message: string) => void):
+    Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return false;
+    const done = await this.#edit(action, model, async () => {
+      const arranged = await send();
+      if (this.model === model) this.model = arranged;
+    }, undefined, report);
+    await this.refreshSession();
+    return done;
+  }
+
+  /** Read the session again (whether an arrange is unfinished, the unlock state) */
+  async refreshSession(): Promise<void> {
+    const at = ++this.#sessionReads;
+    try {
+      this.#useSession(await api.session(), at);
+    } catch {
+      // read again with the next load
+    }
+  }
+
   /** Name a layer, tap dance or macro; an empty name gives it its default one back */
   rename(kind: Named["kind"], index: number, name: string): Promise<boolean> {
     const model = this.model;
@@ -718,10 +765,11 @@ export class KeyboardStore {
    * it (the user holds its unlock keys) and is sent again, once, unless the keyboard was unplugged or another one
    * plugged in meanwhile: the change was for the one that went. When it fails, putBack (if given) undoes what write
    * got done, unless the keyboard was unplugged or replaced meanwhile (sameKeyboard), and says what it did or why it
-   * didn't: that follows the failure's message. */
+   * didn't: that follows the failure's message. report: where the failure's message goes, instead of a toast (a dialog
+   * that shows it). */
   async #edit(
     action: string, model: KeyboardModel, write: () => Promise<void>,
-    putBack?: (sameKeyboard: boolean) => Promise<string>,
+    putBack?: (sameKeyboard: boolean) => Promise<string>, report?: (message: string) => void,
   ): Promise<boolean> {
     this.pending++;
     const loads = this.#loads;
@@ -730,7 +778,7 @@ export class KeyboardStore {
     let changed = false;
     const fail = async (message: string) => {
       const note = putBack ? await putBack(this.#plugs === plugs && !changed) : "";
-      toasts.error(note ? `${message} ${note}` : message);
+      (report ?? ((text: string) => toasts.error(text)))(note ? `${message} ${note}` : message);
       return false;
     };
     try {
```

- [ ] **Step 3: Type-check and the unit tests**

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  817 passed (817)`.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/api.ts \
  web/src/api/types.ts \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/toasts.svelte.ts
git commit -m "feat(web): the keyboard store arranges layers, finishes or puts back an arrange stopped partway"
```

### Task 7: The order logic, the wording and the preview follower; the arranger around the dialog

**`keymap/arrange.ts`** (pure, tested with Vitest):
- **The order:** `currentOrder`, `isCurrent`, `moveTo` (the layers between shift by one; position 0 stays), `moveStep` and `canStep` (↑/↓ and Alt+↑/↓), `reverseOrder` (what Undo arranges), `positionAfter` (where a layer is afterwards), `orderKey`.
- **Names:** `nameAfter(layer, position)`: the layer's own name, or its new position's default name ("Layer 1"; "Base" for 0), as the server will show it.
- **Words:**
  - `summaryText`: "Will change: 3 layers move · 94 keys rewritten · 4 layer keys renumbered (4 in the keymap) · the layers of 1 key override." (keys and encoder directions with encoders), or "Nothing to change.";
  - `triLayerWarning`: names each change by where the layers were, with their own names; on protocol 6 adds "(the firmware's tri-layer layers, unless its code sets others)";
  - `writingLabel` ("Writing 94 keys…", "Writing 96 changes…"), `stoppedText` ("Arranging the layers stopped after 9 of 94 writes. The keyboard may hold part of the new order: …"), `arrangeBlocked` (fewer than 3 layers, or the keyboard can't be changed), `unsavedQuestion`.
- **`PreviewFollower`:** asks for the preview `PREVIEW_PAUSE_MS` (300 ms) after the last change, so quick moves make one request; `refresh()` asks at once; `stop()` ends it. An answer is used only while its order is still shown and if no later request's answer was used (the stale-answer rule). The timers can be passed in, for the tests.

**`keymap/arranging.svelte.ts`** (`layerArranger`) works around the dialog on the Keymap page:
- `blocked` (why the buttons do nothing), `start(opener)` (work not saved is asked about first), `confirm()`, `questionClosed()`, `closed()` and `dropped()` (another keyboard makes the page anew); the focus goes back to the opener, or to `#keymap-title`.
- `apply(order, report)`, `finish(report?)`, `putBack(report?)`. After Apply or Finish, `keymapState.layer` follows the layer the Edit view showed (`positionAfter`), and the toast "Layers arranged." offers Undo with the reverse order. Undo refuses, with a toast that says why, when another keyboard is shown, an arrange is unfinished, a change is still being saved, or the keyboard can't be changed. Put back says "The layers were put back as they were."

**Files:**
- Test: `web/src/keymap/arrange.test.ts` (new)
- Create: `web/src/keymap/arrange.ts`
- Create: `web/src/keymap/arranging.svelte.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/keymap/arrange.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrangePreview } from "../api/types";
import {
  arrangeBlocked, canStep, currentOrder, isCurrent, moveStep, moveTo, nameAfter, positionAfter, PREVIEW_PAUSE_MS,
  PreviewFollower,
  reverseOrder, stoppedText, summaryText, triLayerWarning, unsavedQuestion, writingLabel, type PreviewState,
} from "./arrange";

const NONE = { keymap: 0, encoders: 0, tapDance: 0, combos: 0, keyOverrides: 0, altRepeatKeys: 0, macros: 0 };

function preview(fields: Partial<ArrangePreview> = {}): ArrangePreview {
  return {
    moves: [{ layer: 3, to: 1 }, { layer: 1, to: 2 }, { layer: 2, to: 3 }], keys: 94, references: { ...NONE },
    keyOverrides: 0, triLayer: null, problems: [], writes: 94, needsUnlock: false, ...fields,
  };
}

describe("the order", () => {
  it("moves a layer, the ones between shifting by one", () => {
    expect(moveTo([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
    expect(moveTo([0, 1, 2, 3], 1, 3)).toEqual([0, 2, 3, 1]);
    expect(moveTo([0, 1, 2, 3], 2, 2)).toEqual([0, 1, 2, 3]);
  });

  it("never moves layer 0, nor anything into its place", () => {
    expect(moveTo([0, 1, 2, 3], 0, 2)).toEqual([0, 1, 2, 3]);
    expect(moveTo([0, 1, 2, 3], 2, 0)).toEqual([0, 2, 1, 3]);
    expect(moveTo([0, 1, 2, 3], 2, -5)).toEqual([0, 2, 1, 3]);
    expect(moveTo([0, 1, 2, 3], 1, 99)).toEqual([0, 2, 3, 1]);
  });

  it("goes one step with ↑ and ↓ (and Alt+↑, Alt+↓), not past either end", () => {
    expect(moveStep([0, 1, 2, 3], 2, -1)).toEqual([0, 2, 1, 3]);
    expect(moveStep([0, 1, 2, 3], 2, 1)).toEqual([0, 1, 3, 2]);
    expect(moveStep([0, 1, 2, 3], 1, -1)).toEqual([0, 1, 2, 3]);
    expect(moveStep([0, 1, 2, 3], 3, 1)).toEqual([0, 1, 2, 3]);
    expect([canStep([0, 1, 2, 3], 1, -1), canStep([0, 1, 2, 3], 1, 1)]).toEqual([false, true]);
    expect([canStep([0, 1, 2, 3], 3, -1), canStep([0, 1, 2, 3], 3, 1)]).toEqual([true, false]);
    expect([canStep([0, 1, 2, 3], 0, -1), canStep([0, 1, 2, 3], 0, 1)]).toEqual([false, false]);
  });

  it("is reset to the current order", () => {
    expect(currentOrder(4)).toEqual([0, 1, 2, 3]);
    expect(isCurrent(currentOrder(5))).toBe(true);
    expect(isCurrent([0, 2, 1])).toBe(false);
  });

  it("is undone by the reverse order", () => {
    for (const order of [[0, 3, 1, 2], [0, 2, 3, 1], [0, 4, 3, 2, 1], [0, 1, 2]]) {
      const back = reverseOrder(order);
      // the layer at each position after the order, then the reverse, is the one that was there
      expect(back.map((position) => order[position])).toEqual(currentOrder(order.length));
    }
    expect(reverseOrder([0, 3, 1, 2])).toEqual([0, 2, 3, 1]);
  });

  it("tells where a layer goes, for the Edit view to follow it", () => {
    expect(positionAfter([0, 3, 1, 2], 3)).toBe(1);
    expect(positionAfter([0, 3, 1, 2], 1)).toBe(2);
    expect(positionAfter([0, 3, 1, 2], 0)).toBe(0);
  });
});

describe("the summary", () => {
  it("says what moves, how many keys and references change, and the key overrides", () => {
    expect(summaryText(preview({ references: { ...NONE, keymap: 8, combos: 2, tapDance: 2 }, keyOverrides: 1 })))
      .toBe("Will change: 3 layers move · 94 keys rewritten · 12 layer keys renumbered (8 in the keymap, 2 in tap " +
        "dances, 2 in combos) · the layers of 1 key override.");
    expect(summaryText(preview({ references: { ...NONE, macros: 1, encoders: 1 }, keys: 1, keyOverrides: 2 }), true))
      .toBe("Will change: 3 layers move · 1 key or encoder direction rewritten · 2 layer keys renumbered (1 on an " +
        "encoder, 1 in a macro) · the layers of 2 key overrides.");
  });

  it("says when there is nothing to change", () => {
    expect(summaryText(preview({ moves: [], keys: 0, writes: 0 }))).toBe("Nothing to change.");
  });

  it("warns that the tri-layer keys keep their layer numbers, naming the layers they reach", () => {
    const names = [null, "Sym", null, "Num"];
    expect(triLayerWarning([3, 1, 2], (l) => names[l], false)).toBe(
      "Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow their layers: they use layers 1, 2 and 3 by number. After " +
      "this, Fn1 turns on the layer that was 3 (“Num”) instead of the one that was 1 (“Sym”); Fn2 turns on the " +
      "layer that was 1 (“Sym”) instead of the one that was 2; both held turn on the layer that was 2 instead of " +
      "the one that was 3 (“Num”).");
    // a layer that stays isn't named; the keyboard may have no layer 3
    expect(triLayerWarning([2, 1, null], (l) => names[l], true)).toContain(
      "(the firmware's tri-layer layers, unless its code sets others). After this, Fn1 turns on the layer that " +
      "was 2 instead of the one that was 1 (“Sym”); Fn2 turns on the layer that was 1 (“Sym”) instead of the one " +
      "that was 2.");
    expect(triLayerWarning([1, 3, 2], (l) => names[l], false)).toMatch(/After this, Fn2 turns on the layer that was 3/);
  });

  it("names each row as it will be named: its own name, else its new position's default name", () => {
    expect(nameAfter({ name: "Num", customName: true }, 1)).toBe("Num");
    // "Layer 3", never named, moved to position 1 is "Layer 1" after Apply
    expect(nameAfter({ name: "Layer 3", customName: false }, 1)).toBe("Layer 1");
    expect(nameAfter({ name: "Base", customName: false }, 0)).toBe("Base");
    expect(nameAfter(undefined, 2)).toBe("Layer 2");
  });

  it("says what Apply writes", () => {
    expect(writingLabel(preview())).toBe("Writing 94 keys…");
    expect(writingLabel(preview({ keys: 1, writes: 1 }))).toBe("Writing 1 key…");
    expect(writingLabel(preview({ writes: 97 }))).toBe("Writing 97 changes…");
    expect(writingLabel(null)).toBe("Writing…");
  });

  it("says how far an arrange got before it stopped", () => {
    expect(stoppedText({ order: [0, 3, 1, 2], done: 40, total: 96 })).toMatch(
      /^Arranging the layers stopped after 40 of 96 writes\. The keyboard may hold part of the new order/);
    expect(stoppedText({ order: [0, 3, 1, 2], done: 0, total: 96 })).toMatch(/stopped at its first write\./);
  });
});

describe("PreviewFollower", () => {
  let shown: PreviewState<string>[];
  let asked: { order: number[]; answer: (text: string) => void; fail: (error: unknown) => void }[];
  let follower: PreviewFollower<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    asked = [];
    follower = new PreviewFollower<string>(
      (order) => new Promise((answer, fail) => asked.push({ order, answer, fail })),
      (state) => shown.push(state),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const last = () => shown.at(-1);

  it("asks once after the pause, however many quick moves came", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS - 1);
    follower.follow([0, 2, 3, 1]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS - 1);
    expect(asked).toEqual([]);
    expect(last()).toEqual({ state: "waiting" });
    vi.advanceTimersByTime(1);
    expect(asked.map((a) => a.order)).toEqual([[0, 2, 3, 1]]);
    asked[0].answer("A");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "A" });
  });

  it("drops an answer for an order no longer shown", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 1, 3, 2]);
    asked[0].answer("old order");
    await vi.runAllTimersAsync();
    expect(shown.some((s) => s.state === "ready" && s.preview === "old order")).toBe(false);
    asked[1].answer("new order");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "new order" });
  });

  it("keeps a newer answer over an older one for the same order", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.refresh([0, 2, 1, 3]);
    asked[1].answer("newer");
    await vi.runAllTimersAsync();
    asked[0].answer("older");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "newer" });
    expect(shown.filter((s) => s.state === "ready")).toHaveLength(1);
  });

  it("shows a failure, and nothing once stopped", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    asked[0].fail(new Error("gone"));
    await vi.runAllTimersAsync();
    expect(last()?.state).toBe("failed");
    follower.follow([0, 1, 3, 2]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.stop();
    asked[1].answer("late");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "waiting" });
    follower.follow([0, 3, 2, 1]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    expect(asked).toHaveLength(2);
  });
});

describe("around the dialog", () => {
  it("says why the button does nothing", () => {
    expect(arrangeBlocked(2, true)).toMatch(/3 layers or more/);
    expect(arrangeBlocked(4, false)).toBe("The keyboard can't be changed just now.");
    expect(arrangeBlocked(3, true)).toBeNull();
  });

  it("asks about the work not saved", () => {
    expect(unsavedQuestion(["the changes on the Settings page"])).toBe(
      "Not saved yet: the changes on the Settings page. Arranging the layers doesn't save it and doesn't change it: " +
      "a layer named there by its number keeps that number, whichever layer is at it afterwards.");
    expect(unsavedQuestion(["a", "b"])).toMatch(/^Not saved yet: a and b\. Arranging the layers doesn't save them/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/keymap/arrange.test.ts
```

Expected: `Error: Cannot find module './arrange'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: The order logic, the words and the follower**

Create `web/src/keymap/arrange.ts`:

```ts
// Arrange layers: the order the dialog shows, the server's preview of it in words, and asking for that preview
// without flooding the server. An order lists, for each position, the layer that goes there (order[position] = layer
// now): [0, 3, 1, 2] puts layer 3 at position 1. Layer 0 never moves.
import type { ArrangePreview, ArrangeReferences, UnfinishedArrange } from "../api/types";

/** The fewest layers a keyboard needs for anything to be arranged: layer 0 stays first */
export const ARRANGE_MIN_LAYERS = 3;

/** How long (ms) the dialog waits after a change before it asks for the preview: quick moves make one request */
export const PREVIEW_PAUSE_MS = 300;

/** The order layers are in now: 0, 1, 2… */
export function currentOrder(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** Whether an order is the current one (nothing moves) */
export function isCurrent(order: number[]): boolean {
  return order.every((layer, position) => layer === position);
}

/** The order with the layer at `from` moved to `to` (the layers between shift by one); position 0 stays */
export function moveTo(order: number[], from: number, to: number): number[] {
  const target = Math.max(1, Math.min(order.length - 1, to));
  if (from < 1 || from >= order.length || target === from) return order;
  const next = [...order];
  const [layer] = next.splice(from, 1);
  next.splice(target, 0, layer);
  return next;
}

/** One step up (towards position 1) or down; unchanged at the end it is already at */
export function moveStep(order: number[], from: number, step: -1 | 1): number[] {
  return moveTo(order, from, from + step);
}

/** Whether the layer at a position can go one step up (towards position 1) or down */
export function canStep(order: number[], position: number, step: -1 | 1): boolean {
  const to = position + step;
  return position >= 1 && to >= 1 && to < order.length;
}

/** The order that puts layers back where they were before `order` was applied: what Undo arranges */
export function reverseOrder(order: number[]): number[] {
  const back = new Array<number>(order.length);
  order.forEach((layer, position) => {
    back[layer] = position;
  });
  return back;
}

/** Where a layer is after `order` was applied */
export function positionAfter(order: number[], layer: number): number {
  const at = order.indexOf(layer);
  return at < 0 ? layer : at;
}

/** The name a layer shows once the order is applied: its own name if it has one, else the default name of its new
 * position ("Layer 1"; "Base" for layer 0), as a layer never named has no name to take along */
export function nameAfter(layer: { name: string; customName: boolean } | undefined, position: number): string {
  if (layer?.customName) return layer.name;
  return position === 0 ? "Base" : `Layer ${position}`;
}

/** An order as a key, to tell answers apart */
export function orderKey(order: number[]): string {
  return order.join(",");
}

// ---- the preview in words ----

const PLACES: [keyof ArrangeReferences, string, string][] = [
  ["keymap", "in the keymap", "in the keymap"],
  ["encoders", "on an encoder", "on encoders"],
  ["tapDance", "in a tap dance", "in tap dances"],
  ["combos", "in a combo", "in combos"],
  ["keyOverrides", "in a key override", "in key overrides"],
  ["altRepeatKeys", "in an alt-repeat key", "in alt-repeat keys"],
  ["macros", "in a macro", "in macros"],
];

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What Apply would change, in one sentence: "Will change: 3 layers move · 94 keys rewritten · 4 layer keys renumbered
 * (4 in the keymap) · the layers of 1 key override". encoders: the keyboard has encoders (the keys count their
 * directions too). "Nothing to change" for the current order. */
export function summaryText(preview: ArrangePreview, encoders = false): string {
  if (preview.moves.length === 0) return "Nothing to change.";
  const parts = [count(preview.moves.length, "layer moves", "layers move")];
  if (preview.keys > 0) {
    parts.push(`${count(preview.keys, encoders ? "key or encoder direction" : "key",
      encoders ? "keys and encoder directions" : "keys")} rewritten`);
  }
  const places = PLACES.filter(([place]) => preview.references[place] > 0)
    .map(([place, one, many]) => `${preview.references[place]} ${preview.references[place] === 1 ? one : many}`);
  const references = PLACES.reduce((sum, [place]) => sum + preview.references[place], 0);
  if (references > 0) {
    parts.push(`${count(references, "layer key", "layer keys")} renumbered (${places.join(", ")})`);
  }
  if (preview.keyOverrides > 0) {
    parts.push(`the layers of ${count(preview.keyOverrides, "key override", "key overrides")}`);
  }
  return `Will change: ${parts.join(" · ")}.`;
}

/** "Nav, Sym and Num" */
function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The tri-layer warning: FN_MO13 and FN_MO23 turn on layers 1, 2 and 3 by number, which hold other layers after the
 * order. triLayer: the layers (by their position now) that end up at positions 1, 2 and 3. Layers are called by their
 * position now, as the rows' "← was N" does, with their own name if they have one (ownName: null for none).
 * protocol6: on Vial protocol 6 these layers are the firmware's tri-layer setting, 1, 2 and 3 unless the firmware's
 * code sets others (protocol 5 fixes them). */
export function triLayerWarning(triLayer: (number | null)[], ownName: (layer: number) => string | null,
  protocol6: boolean): string {
  const which = protocol6 ? "layers 1, 2 and 3 by number (the firmware's tri-layer layers, unless its code sets others)"
    : "layers 1, 2 and 3 by number";
  const keys = ["Fn1 turns on", "Fn2 turns on", "both held turn on"];
  const was = (layer: number) => {
    const name = ownName(layer);
    return name ? `${layer} (“${name}”)` : `${layer}`;
  };
  const changes = triLayer.flatMap((layer, i) => (layer === null || layer === i + 1 ? [] :
    [`${keys[i]} the layer that was ${was(layer)} instead of the one that was ${was(i + 1)}`]));
  return `Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow their layers: they use ${which}. After this, ` +
    `${changes.join("; ")}.`;
}

/** What Apply's button says while it writes: "Writing 94 keys…", or with other writes, "Writing 96 changes…" */
export function writingLabel(preview: ArrangePreview | null): string {
  if (!preview || preview.writes === 0) return "Writing…";
  if (preview.writes === preview.keys) return `Writing ${count(preview.keys, "key", "keys")}…`;
  return `Writing ${count(preview.writes, "change", "changes")}…`;
}

/** What an arrange stopped partway did, and what is left to do */
export function stoppedText(unfinished: UnfinishedArrange): string {
  const done = unfinished.done === 0 ? "at its first write" : `after ${unfinished.done} of ${unfinished.total} writes`;
  return `Arranging the layers stopped ${done}. The keyboard may hold part of the new order: finish it, or put it ` +
    "back as it was. Names move once it is finished.";
}

// ---- asking for the preview ----

/** What the preview follower says about the order shown */
export type PreviewState<T> =
  | { state: "waiting" }
  | { state: "ready"; preview: T }
  | { state: "failed"; error: unknown };

interface Timers {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Asks for the preview of the order shown, PREVIEW_PAUSE_MS after its last change, so that quick moves make one
 * request. An answer is used only while its order is still the one shown, and only if no answer asked for later was
 * used already: a newer answer replaces an older one, an answer for an order no longer shown is dropped. */
export class PreviewFollower<T> {
  #fetch: (order: number[]) => Promise<T>;
  #show: (state: PreviewState<T>) => void;
  #timers: Timers;
  #pause: number;
  #timer: unknown = null;
  /** the order shown, as a key */
  #shown = "";
  /** requests sent so far, and the one (by that count) whose answer is shown */
  #sent = 0;
  #used = 0;
  #stopped = false;

  constructor(fetch: (order: number[]) => Promise<T>, show: (state: PreviewState<T>) => void,
    timers: Timers = browserTimers, pause = PREVIEW_PAUSE_MS) {
    this.#fetch = fetch;
    this.#show = show;
    this.#timers = timers;
    this.#pause = pause;
  }

  /** The order shown changed (or is shown first): its preview is asked for after the pause */
  follow(order: number[]): void {
    if (this.#stopped) return;
    this.#shown = orderKey(order);
    this.#show({ state: "waiting" });
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    const asked = [...order];
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      void this.#ask(asked);
    }, this.#pause);
  }

  /** Ask again now for the order shown (after the keyboard changed) */
  refresh(order: number[]): void {
    if (this.#stopped) return;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#shown = orderKey(order);
    void this.#ask([...order]);
  }

  /** Nothing more is asked or shown (the dialog closed) */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
  }

  async #ask(order: number[]): Promise<void> {
    const at = ++this.#sent;
    const key = orderKey(order);
    let state: PreviewState<T>;
    try {
      state = { state: "ready", preview: await this.#fetch(order) };
    } catch (error) {
      state = { state: "failed", error };
    }
    if (!this.#usable(key, at)) return;
    this.#used = at;
    this.#show(state);
  }

  /** The stale-answer rule */
  #usable(key: string, at: number): boolean {
    return !this.#stopped && key === this.#shown && at > this.#used;
  }
}

// ---- around the dialog ----

/** Why the Arrange layers button does nothing, or null when it opens the dialog */
export function arrangeBlocked(layers: number, canEdit: boolean): string | null {
  if (layers < ARRANGE_MIN_LAYERS) {
    return "Layer 0 always stays first, so a keyboard needs 3 layers or more for anything to be arranged.";
  }
  if (!canEdit) return "The keyboard can't be changed just now.";
  return null;
}

/** What the question before the dialog says about the work not saved (lib/unsaved): arranging neither saves it nor
 * changes it, so a layer it names by number keeps that number */
export function unsavedQuestion(work: string[]): string {
  return `Not saved yet: ${andList(work)}. Arranging the layers doesn't save ${work.length === 1 ? "it" : "them"} ` +
    "and doesn't change " + (work.length === 1 ? "it" : "them") + ": a layer named there by its number keeps " +
    "that number, whichever layer is at it afterwards.";
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd web && npx vitest run src/keymap/arrange.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  18 passed (18)`.

- [ ] **Step 5: The arranger, then type-check and every unit test**

Create `web/src/keymap/arranging.svelte.ts`:

```ts
// Arrange layers around its dialog, for the Keymap page: opening it (asking first about work not saved), Apply with its
// toast and Undo, Finish and Put back after an arrange stopped partway, and the Edit view following the layer it showed
// to its new position. The order logic and the words are in arrange.ts.
import { tick } from "svelte";
import { keyboard } from "../lib/keyboard.svelte";
import { toasts } from "../lib/toasts.svelte";
import { unsavedWork } from "../lib/unsaved";
import { arrangeBlocked, positionAfter, reverseOrder, unsavedQuestion } from "./arrange";
import { keymapState } from "./state.svelte";

const UNDO = "Undoing the arrange";

export class LayerArranger {
  /** the dialog shows */
  open = $state(false);
  /** the question about work not saved, while it is asked */
  asking = $state<string | null>(null);
  /** the element (by id) that opened the dialog: it gets the focus back */
  #opener: string | null = null;
  /** the toast offering to undo the last arrange: it goes once another arrange is made */
  #undoToast: number | null = null;

  /** Why the Arrange layers button does nothing just now, or null */
  get blocked(): string | null {
    return arrangeBlocked(keyboard.model?.layers.length ?? 0, keyboard.canEdit);
  }

  /** The Arrange layers button (its id: the focus goes back to it): work not saved is asked about first */
  start(opener: string): void {
    if (this.blocked !== null || this.open || this.asking !== null) return;
    this.#opener = opener;
    const work = unsavedWork(keyboard.model);
    if (work.length > 0) this.asking = unsavedQuestion(work);
    else this.open = true;
  }

  /** The question's answer: arrange all the same */
  confirm(): void {
    this.asking = null;
    this.open = true;
  }

  /** The question closed; the focus goes back unless the dialog opened */
  questionClosed(): void {
    this.asking = null;
    if (!this.open) void this.#focusOpener();
  }

  /** The dialog closed (applied or not) */
  closed(): void {
    this.open = false;
    void this.#focusOpener();
  }

  /** The Keymap page went (another keyboard is shown, which makes it anew): its dialog and question go with it, and
   * nothing gets the focus back */
  dropped(): void {
    this.open = false;
    this.asking = null;
    this.#opener = null;
  }

  /** Apply in the dialog. report: the failure's message, which the dialog shows */
  async apply(order: number[], report: (message: string) => void): Promise<boolean> {
    const shown = keymapState.layer;
    const done = await keyboard.arrangeLayers(order, report);
    if (done) this.#arranged(order, shown);
    return done;
  }

  /** Finish an arrange that stopped partway: the Edit view follows its layer, and Undo is offered */
  async finish(report?: (message: string) => void): Promise<boolean> {
    const order = keyboard.unfinishedArrange?.order;
    const shown = keymapState.layer;
    const done = await keyboard.finishArrange(report);
    if (done && order) this.#arranged(order, shown);
    return done;
  }

  /** Put back an arrange that stopped partway */
  async putBack(report?: (message: string) => void): Promise<boolean> {
    const done = await keyboard.putBackArrange(report);
    if (done) toasts.info("The layers were put back as they were.");
    return done;
  }

  #arranged(order: number[], shown: number): void {
    keymapState.layer = positionAfter(order, shown);
    if (this.#undoToast !== null) toasts.dismiss(this.#undoToast);
    const opened = keyboard.opened;
    this.#undoToast = toasts.info("Layers arranged.", {
      label: "Undo", run: () => this.#undo(order, opened), onKeyboardShown: true,
    });
  }

  /** Arranges with the reverse order. Resolves to whether its toast can go. */
  async #undo(order: number[], opened: number): Promise<boolean> {
    if (keyboard.opened !== opened) {
      toasts.error(`${UNDO} failed: another keyboard is shown now.`);
      return true;
    }
    if (keyboard.unfinishedArrange) {
      toasts.error(`${UNDO} failed: an arrange is unfinished. Finish it or put it back first.`);
      return true;
    }
    if (keyboard.pending > 0) {
      toasts.error(`${UNDO} failed: another change was still being saved. Try again.`);
      return false;
    }
    if (!keyboard.canEdit) {
      toasts.error(`${UNDO} failed: the keyboard can't be changed just now.`);
      return false;
    }
    const back = reverseOrder(order);
    const shown = keymapState.layer;
    const done = await keyboard.arrangeLayers(back, undefined, UNDO);
    if (done) {
      keymapState.layer = positionAfter(back, shown);
      this.#undoToast = null;
    }
    // stopped partway: the bar offers Finish and Put back from now on
    return done || keyboard.unfinishedArrange !== null;
  }

  async #focusOpener(): Promise<void> {
    await tick();
    const opener = this.#opener ? document.getElementById(this.#opener) : null;
    (opener ?? document.getElementById("keymap-title"))?.focus();
  }
}

export const layerArranger = new LayerArranger();
```

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  52 passed (52)` and `Tests  835 passed (835)`.

- [ ] **Step 6: Commit**

```bash
git add web/src/keymap/arrange.test.ts \
  web/src/keymap/arrange.ts \
  web/src/keymap/arranging.svelte.ts
git commit -m "feat(web): arrange layers' order logic, preview follower and wording; the arranger around the dialog"
```

### Task 8: The Arrange layers dialog, its buttons, and the bar after a stop

**`ArrangeDialog.svelte`** (a modal `<dialog>`, at most 620 px wide and inside the window at every size):
- **Header:** "Arrange layers", what it does ("Keys that reach a layer follow it to its new position, and so does its name. Layer 0 stays first."), and the keys ("Drag a layer by its handle, or use ↑ and ↓. On a handle, Alt+↑ and Alt+↓ move the layer.").
- **Rows** (an `<ol>` that scrolls on its own): layer 0 first with a lock, "always first: the keyboard starts on it". Every other row has its position, the handle (a `<button>`, dragged with the pointer followed on the window, or moved with Alt+↑/↓), the name it will have (`nameAfter`, cut with "…" and a tooltip), "← was N" once it moved, how it is reached (the Overview's `wayLabel` and `unreachedReason`), and ↑/↓ buttons. Esc during a drag puts the row back.
- **The summary**, a region between the rows and the footer: the flags line ("Can't apply: …", "⚠ Fn1 and Fn2 will reach other layers", each scrolling its text into view), `summaryText`, the problems list, the tri-layer warning, and a note when Apply will ask for an unlock. "Checking…" while the next preview is on its way, the last one shown faint meanwhile. A failure of Apply is shown here (`report`).
- **Footer:** "Nothing is written until you Apply.", Reset, Cancel, Apply ("Writing 94 keys…" while it writes, the focus kept). Apply is off for the current order, with problems, while editing is blocked or a change is pending.
- **Stopped state** (`keyboard.unfinishedArrange`, so a reloaded or other tab shows it too): `stoppedText`, a note while the keyboard can't be changed, then "Finish and Put back write to the keyboard at once." with Close, Put back and Finish. The focus goes to the stopped text when the focused button went.

**`ArrangeBar.svelte`:** a region "Arranging the layers stopped" with `stoppedText`, Put back and Finish ("Putting back…", "Finishing…" while they run), until one succeeds.

**`LayerTabs.svelte`:** an "Arrange layers…" button with an up-down arrows icon after every tab (`arrangeBlocked`, `onarrange`), `aria-disabled` with a `title` that says why when blocked.

**`KeymapPage.svelte`:** the bar above the views while an arrange is unfinished (its Finish and Put back give the focus to `#keymap-title` once the bar goes); the Overview's "Arrange layers…" button above the cards; the dialog and the "Arrange the layers?" question; `layerArranger.dropped()` when the page goes.

The dialog's behaviour is tested end to end in Task 9. Here the type-check, the build and the existing e2e tests (the Keymap page's tabs, views and Overview among them) show that nothing else changed.

**Files:**
- Create: `web/src/keymap/ArrangeDialog.svelte`
- Create: `web/src/keymap/ArrangeBar.svelte`
- Modify: `web/src/keymap/LayerTabs.svelte`
- Modify: `web/src/keymap/KeymapPage.svelte`

- [ ] **Step 1: The dialog and the bar**

Create `web/src/keymap/ArrangeDialog.svelte`:

```svelte
<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { ArrangePreview, KeyboardModel } from "../api/types";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import {
    canStep, currentOrder, isCurrent, moveStep, moveTo, nameAfter, PreviewFollower, stoppedText, summaryText,
    triLayerWarning, writingLabel, type PreviewState,
  } from "./arrange";

  interface Props {
    open: boolean;
    model: KeyboardModel;
    analysis: Analysis;
    phrases: PhraseContext;
    /** Apply: resolves to whether it was done (the dialog then closes); report says why not */
    onapply: (order: number[], report: (message: string) => void) => Promise<boolean>;
    onfinish: (report: (message: string) => void) => Promise<boolean>;
    onputback: (report: (message: string) => void) => Promise<boolean>;
    /** closed, applied or not: the caller gives the focus back */
    onclose: () => void;
  }

  let { open, model, analysis, phrases, onapply, onfinish, onputback, onclose }: Props = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let list = $state<HTMLOListElement>();
  /** the layer (by its position now) at each position */
  let order = $state<number[]>([]);
  let previewState = $state<PreviewState<ArrangePreview>>({ state: "waiting" });
  /** the last preview read, shown (faint) while the next one is asked for */
  let lastPreview = $state<ArrangePreview | null>(null);
  /** Apply, Finish or Put back is being written */
  let working = $state<"apply" | "finish" | "put-back" | null>(null);
  let workingLabel = $state("");
  /** why the last Apply, Finish or Put back wasn't done */
  let failure = $state<string | null>(null);
  /** a row dragged by its handle */
  let drag = $state<{ layer: number; pointerId: number; before: number[] } | null>(null);
  let follower: PreviewFollower<ArrangePreview> | null = null;

  const unfinished = $derived(keyboard.unfinishedArrange);
  const canEdit = $derived(keyboard.canEdit);
  const preview = $derived(previewState.state === "ready" ? previewState.preview : null);
  const shownPreview = $derived(preview ?? lastPreview);
  const canApply = $derived(
    working === null && drag === null && preview !== null && preview.moves.length > 0 &&
      preview.problems.length === 0 && canEdit && keyboard.pending === 0,
  );
  const hasEncoders = $derived(model.encoders.length > 0);

  // opened: the current order, its preview asked for at once; closed: nothing more is asked
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      untrack(() => start());
      dialog.showModal();
      void tick().then(() => focusFirst());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // the keyboard read again (an edit, another tab, a reload): the preview is asked for again; another number of
  // layers starts over
  $effect(() => {
    const layers = model.layers.length;
    void model;
    untrack(() => {
      if (!follower || working !== null) return;
      if (order.length !== layers) order = currentOrder(layers);
      follower.refresh(order);
    });
  });

  // an arrange that stopped while the focus was on a button that went: the focus goes to what it says
  $effect(() => {
    if (unfinished && dialog?.open) {
      untrack(() => {
        void tick().then(() => {
          const focused = document.activeElement;
          if (!focused || focused === document.body || !dialog?.contains(focused)) {
            document.getElementById(`${uid}-stopped`)?.focus();
          }
        });
      });
    }
  });

  function start() {
    follower?.stop();
    order = currentOrder(model.layers.length);
    previewState = { state: "waiting" };
    lastPreview = null;
    working = null;
    failure = null;
    drag = null;
    follower = new PreviewFollower(api.previewArrange, (state) => {
      previewState = state;
      if (state.state === "ready") lastPreview = state.preview;
    });
    follower.refresh(order);
  }

  function focusFirst() {
    if (unfinished) document.getElementById(`${uid}-stopped`)?.focus();
    else if (order.length > 1) document.getElementById(rowId(order[1]))?.focus();
  }

  const rowId = (layer: number) => `${uid}-row-${layer}`;
  const stepId = (layer: number, step: -1 | 1) => `${uid}-${step < 0 ? "up" : "down"}-${layer}`;

  /** A new order shown: its preview is asked for after the pause */
  function show(next: number[]) {
    if (next === order) return;
    order = next;
    failure = null;
    follower?.follow(next);
  }

  /** ↑ or ↓ (or Alt+↑, Alt+↓) on the row at a position; the focus stays on what had it, in the row moved */
  async function step(position: number, direction: -1 | 1, keep: string) {
    if (working !== null || drag !== null || !canStep(order, position, direction)) return;
    show(moveStep(order, position, direction));
    await tick();
    document.getElementById(keep)?.focus();
  }

  function rowKeys(event: KeyboardEvent, position: number) {
    const layer = order[position];
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (direction === 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.altKey) {
      event.preventDefault();
      const target = event.target as HTMLElement;
      void step(position, direction, target.id || rowId(layer));
    } else if ((event.target as HTMLElement).classList.contains("handle")) {
      // plain arrows go from handle to handle
      event.preventDefault();
      const next = order[position + direction];
      if (next !== undefined && position + direction >= 1) document.getElementById(rowId(next))?.focus();
    }
  }

  // ---- dragging a row by its handle ----

  function grab(event: PointerEvent, layer: number) {
    if (event.button !== 0 || working !== null || drag !== null) return;
    // the row moves among the others as the pointer goes: its events are followed on the window (a pointer captured
    // by the handle would lose it as the handle moves in the page)
    event.preventDefault();
    drag = { layer, pointerId: event.pointerId, before: order };
  }

  function dragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId || !list) return;
    const from = order.indexOf(drag.layer);
    // the position the pointer is at: after every other row whose middle it has passed
    let to = 1;
    for (const row of list.querySelectorAll<HTMLElement>("li[data-layer]")) {
      if (Number(row.dataset.layer) === drag.layer) continue;
      const box = row.getBoundingClientRect();
      if (event.clientY > box.top + box.height / 2) to++;
    }
    if (to !== from) order = moveTo(order, from, to);
  }

  function drop(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const layer = drag.layer;
    const before = drag.before;
    drag = null;
    const next = order;
    order = before;
    show(next);
    document.getElementById(rowId(layer))?.focus();
  }

  function dragCancel(event: PointerEvent) {
    if (drag && event.pointerId === drag.pointerId) {
      order = drag.before;
      drag = null;
    }
  }

  // ---- the buttons ----

  function reset() {
    if (working !== null) return;
    show(currentOrder(model.layers.length));
    if (order.length > 1) document.getElementById(rowId(order[1]))?.focus();
  }

  async function run(kind: "apply" | "finish" | "put-back", label: string, act: () => Promise<boolean>) {
    if (working !== null) return;
    working = kind;
    workingLabel = label;
    failure = null;
    let done = false;
    try {
      done = await act();
    } finally {
      working = null;
    }
    if (done) {
      dialog?.close();
    } else {
      follower?.refresh(order);
    }
  }

  function apply() {
    if (!canApply || !preview) return;
    const chosen = [...order];
    void run("apply", writingLabel(preview), () => onapply(chosen, (message) => (failure = message)));
  }

  function finish() {
    if (!canEdit) return;
    void run("finish", "Finishing…", () => onfinish((message) => (failure = message)));
  }

  function putBack() {
    if (!canEdit) return;
    void run("put-back", "Putting back…", () => onputback((message) => (failure = message)));
  }

  /** A layer's own name, or null when it was never named */
  function ownName(layer: number): string | null {
    const shown = model.layers[layer];
    return shown?.customName ? shown.name : null;
  }

  /** Scrolls a part of the summary into view (the summary scrolls when it is longer than its room) */
  function reveal(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }

  /** How a layer is reached, in one line: the Overview's labels */
  function reachOf(layer: number): string {
    const reach = analysis.reach[layer];
    if (!reach) return "";
    const warning = unreachedReason(reach);
    const ways = reach.ways.map((w) => wayLabel(w, phrases)).join("; ");
    return warning ? `${warning}${ways ? `: ${ways}` : ""}` : ways;
  }
</script>

<svelte:window onpointermove={dragMove} onpointerup={drop} onpointercancel={dragCancel} />

<dialog
  bind:this={dialog}
  class="arrange-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-about"
  oncancel={(event) => {
    // Esc waits for a write; during a drag it only puts the row back
    if (working !== null) event.preventDefault();
    else if (drag !== null) {
      event.preventDefault();
      order = drag.before;
      drag = null;
    }
  }}
  onclose={() => {
    follower?.stop();
    follower = null;
    onclose();
  }}
>
  <header class="head">
    <h2 id="{uid}-title">Arrange layers</h2>
    <p id="{uid}-about">
      {#if unfinished}
        The last arrange didn't finish.
      {:else}
        Keys that reach a layer follow it to its new position, and so does its name. Layer 0 stays first.
      {/if}
    </p>
    {#if !unfinished}
      <p id="{uid}-keys" class="keys">Drag a layer by its handle, or use ↑ and ↓. On a handle, Alt+↑ and Alt+↓ move
        the layer.</p>
    {/if}
  </header>

  {#if unfinished}
    <div class="body">
      <div class="stopped" id="{uid}-stopped" tabindex="-1" role="group" aria-labelledby="{uid}-stopped-text">
        <p id="{uid}-stopped-text">{stoppedText(unfinished)}</p>
        {#if !canEdit}
          <p class="note">The keyboard can't be changed just now: once it is back, Finish and Put back work.</p>
        {/if}
      </div>
      {#if failure}<p class="problem" role="alert">{failure}</p>{/if}
    </div>
    <footer class="foot">
      <p class="saving">Finish and Put back write to the keyboard at once.</p>
      <Button aria-disabled={working !== null || undefined} onclick={() => {
        if (working === null) dialog?.close();
      }}>Close</Button>
      <Button aria-disabled={working !== null || !canEdit || undefined} onclick={putBack}>
        {working === "put-back" ? workingLabel : "Put back"}
      </Button>
      <Button variant="primary" aria-disabled={working !== null || !canEdit || undefined} onclick={finish}>
        {working === "finish" ? workingLabel : "Finish"}
      </Button>
    </footer>
  {:else}
    <div class="body rows-body">
      <ol class="rows" bind:this={list} aria-label="Layers, in their new order">
        <li class="row fixed">
          <span class="position">0</span>
          <svg class="lock" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
            <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
          </svg>
          <span class="text">
            <span class="line"><span class="name" title={nameAfter(model.layers[0], 0)}>{nameAfter(model.layers[0], 0)}</span></span>
            <span class="reach">always first: the keyboard starts on it</span>
          </span>
        </li>
        {#each order.slice(1) as layer, i (layer)}
          {@const position = i + 1}
          <!-- the name it will have: a layer never named takes its new position's default name -->
          {@const name = nameAfter(model.layers[layer], position)}
          {@const reach = reachOf(layer)}
          <li class="row" class:dragging={drag?.layer === layer} class:moved={layer !== position} data-layer={layer}>
            <span class="position">{position}</span>
            <!-- the row's handle: dragged, or with the focus, Alt+↑ and Alt+↓ move the row; ↑ and ↓ go to the next -->
            <button
              type="button"
              id={rowId(layer)}
              class="handle"
              aria-label="{name}, position {position}{layer !== position ? `, was ${layer}` : ""}"
              aria-describedby="{uid}-keys"
              title="Drag to move {name}"
              onkeydown={(e) => rowKeys(e, position)}
              onpointerdown={(e) => grab(e, layer)}
            >
              <svg viewBox="0 0 10 16" aria-hidden="true">
                {#each [3, 8, 13] as y (y)}<circle cx="3" cy={y} r="1.3" /><circle cx="7" cy={y} r="1.3" />{/each}
              </svg>
            </button>
            <span class="text">
              <span class="line">
                <span class="name" title={name}>{name}</span>
                {#if layer !== position}<span class="was">← was {layer}</span>{/if}
              </span>
              <span class="reach" title={reach || undefined}>{reach || "nothing reaches it"}</span>
            </span>
            <span class="steps">
              <button type="button" id={stepId(layer, -1)} class="step" aria-label="Move {name} up"
                aria-disabled={!canStep(order, position, -1) || working !== null || undefined}
                onkeydown={(e) => rowKeys(e, position)}
                onclick={() => void step(position, -1, stepId(layer, -1))}>↑</button>
              <button type="button" id={stepId(layer, 1)} class="step" aria-label="Move {name} down"
                aria-disabled={!canStep(order, position, 1) || working !== null || undefined}
                onkeydown={(e) => rowKeys(e, position)}
                onclick={() => void step(position, 1, stepId(layer, 1))}>↓</button>
            </span>
          </li>
        {/each}
      </ol>
    </div>

    <!-- by the footer, whatever the list's length: why Apply is off, or what it warns of, is always in view. Longer
         than its room, it scrolls, its first line (the flags) staying put. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that can scroll takes the focus, for the keys) -->
    <section class="summary" class:waiting={previewState.state === "waiting"} aria-label="What Apply changes"
      tabindex="0">
      <div aria-live="polite">
        {#if previewState.state === "failed"}
          <p class="problem">Couldn't check this order: {causeMessage(previewState.error)}</p>
        {:else if shownPreview}
          {@const p = shownPreview}
          {#if p.problems.length > 0 || p.triLayer}
            <p class="flags">
              {#if p.problems.length > 0}
                <button type="button" class="flag bad" onclick={() => reveal(`${uid}-problems`)}>
                  Can't apply: {p.problems.length === 1 ? "a layer number wouldn't fit" :
                    `${p.problems.length} layer numbers wouldn't fit`}
                </button>
              {/if}
              {#if p.triLayer}
                <button type="button" class="flag warn" onclick={() => reveal(`${uid}-warning`)}>
                  ⚠ Fn1 and Fn2 will reach other layers
                </button>
              {/if}
            </p>
          {/if}
          <p class="will">{previewState.state === "waiting" ? "Checking… " : ""}{summaryText(p, hasEncoders)}</p>
          {#if p.problems.length > 0}
            <div class="problem" id="{uid}-problems">
              <p>This order can't be written: a layer number wouldn't fit where it must go.</p>
              <ul>
                {#each p.problems as problem, n (n)}<li>{problem}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if p.triLayer}
            <p class="warning" id="{uid}-warning">{triLayerWarning(p.triLayer, ownName, model.vialProtocol >= 6)}</p>
          {/if}
          {#if p.needsUnlock && p.moves.length > 0 && keyboard.unlock.state.state !== "unlocked"}
            <p class="note">Apply asks for the keyboard to be unlocked first: it moves QK_BOOT or changes macros.</p>
          {/if}
        {:else}
          <p class="will">Checking what this order changes…</p>
        {/if}
      </div>
      {#if failure}<p class="problem" role="alert">{failure}</p>{/if}
    </section>

    <footer class="foot">
      <p class="saving">Nothing is written until you Apply.</p>
      <div class="buttons">
        <Button aria-disabled={working !== null || isCurrent(order) || undefined} onclick={reset}>Reset</Button>
        <Button aria-disabled={working !== null || undefined} onclick={() => {
          if (working === null) dialog?.close();
        }}>Cancel</Button>
        <Button variant="primary" class={!canApply && working === null ? "off" : undefined}
          aria-disabled={!canApply || undefined} onclick={apply}>
          {working === "apply" ? workingLabel : "Apply"}
        </Button>
      </div>
    </footer>
  {/if}
</dialog>

<style>
  /* fits the window, whatever the number of layers: the rows and the summary scroll inside it */
  .arrange-dialog {
    width: min(620px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100vh - 32px);
    max-height: calc(100dvh - 32px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .arrange-dialog[open] {
    display: flex;
    flex-direction: column;
  }

  .arrange-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .head {
    padding: 18px 20px 10px;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 17px;
  }

  .head p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .head .keys {
    margin-top: 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .body {
    display: grid;
    gap: 12px;
    min-height: 0;
    padding: 4px 20px 12px;
    overflow-y: auto;
  }

  .rows {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 2px;
    list-style: none;
  }

  .row {
    display: grid;
    grid-template-columns: 26px 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 8px 7px 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .row.fixed {
    background: var(--surface-2);
  }

  .row.moved {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .row.dragging {
    border-color: var(--accent);
    background: var(--accent-weak);
    box-shadow: var(--shadow-lg);
  }

  .position {
    display: inline-grid;
    place-items: center;
    height: 22px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tone-layer) 14%, transparent);
    color: var(--tone-layer);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .lock {
    width: 15px;
    height: 15px;
    justify-self: center;
    fill: none;
    stroke: var(--text-3);
    stroke-width: 1.4;
  }

  .handle {
    display: grid;
    place-items: center;
    height: 30px;
    border-radius: 6px;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }

  .handle {
    width: 18px;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .handle:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .row:focus-within {
    border-color: var(--border-strong);
  }

  .row.dragging .handle {
    cursor: grabbing;
  }

  .handle svg {
    width: 10px;
    height: 16px;
    fill: currentColor;
  }

  .text {
    display: grid;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  /* a long name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .was {
    flex: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }

  .reach {
    overflow: hidden;
    color: var(--text-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .steps {
    display: flex;
    gap: 4px;
  }

  .step {
    width: 30px;
    height: 30px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 14px;
    cursor: pointer;
  }

  .step:hover:not([aria-disabled="true"]) {
    background: var(--surface-2);
  }

  .step[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
  }

  /* the rows scroll; the summary below them keeps its place by the footer */
  .rows-body {
    flex: 1 1 auto;
    min-height: 120px;
  }

  .summary {
    display: grid;
    flex: 0 0 auto;
    gap: 8px;
    max-height: 40vh;
    max-height: 40dvh;
    padding: 10px 20px 12px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }

  .summary > div {
    display: grid;
    gap: 8px;
  }

  .summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* why Apply is off, or what it warns of, in one line that stays while the summary scrolls */
  .flags {
    position: sticky;
    top: -10px;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -10px -4px 0;
    padding: 10px 4px 4px;
    background: var(--surface);
  }

  .flag {
    padding: 3px 9px;
    border: 1px solid;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .flag.bad {
    border-color: var(--danger-line);
    background: var(--danger-weak);
    color: var(--danger);
  }

  .flag.warn {
    border-color: color-mix(in srgb, var(--warning-text) 30%, var(--border));
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .summary p,
  .stopped p {
    margin: 0;
  }

  .summary.waiting .will {
    color: var(--text-3);
  }

  .warning {
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
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

  .problem p {
    margin: 0;
  }

  .problem ul {
    margin: 4px 0 0;
    padding-left: 18px;
    overflow-wrap: anywhere;
  }

  .note {
    color: var(--text-2);
  }

  .stopped {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .stopped:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px 12px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
  }

  .saving {
    flex: 1 1 auto;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  /* Apply that can't be used: it keeps the focus (aria-disabled), and looks off */
  .foot :global(.off) {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
```

Create `web/src/keymap/ArrangeBar.svelte`:

```svelte
<script lang="ts">
  import type { UnfinishedArrange } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { stoppedText } from "./arrange";

  interface Props {
    unfinished: UnfinishedArrange;
    canEdit: boolean;
    onfinish: () => Promise<boolean>;
    onputback: () => Promise<boolean>;
  }

  let { unfinished, canEdit, onfinish, onputback }: Props = $props();

  let working = $state<"finish" | "put-back" | null>(null);

  async function run(kind: "finish" | "put-back", act: () => Promise<boolean>) {
    if (working !== null || !canEdit) return;
    working = kind;
    try {
      await act();
    } finally {
      working = null;
    }
  }
</script>

<!-- until Finish or Put back succeeds: the keyboard may hold part of the new order. The buttons stay (keeping the
     focus) while one runs; the bar goes once it is done, and the focus with it goes to the page's heading. -->
<div class="bar" role="region" aria-label="Arranging the layers stopped">
  <p>{stoppedText(unfinished)}</p>
  <div class="buttons">
    <Button aria-disabled={working !== null || !canEdit || undefined} onclick={() => void run("put-back", onputback)}>
      {working === "put-back" ? "Putting back…" : "Put back"}
    </Button>
    <Button variant="primary" aria-disabled={working !== null || !canEdit || undefined}
      onclick={() => void run("finish", onfinish)}>
      {working === "finish" ? "Finishing…" : "Finish"}
    </Button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  p {
    flex: 1 1 320px;
    min-width: 0;
    margin: 0;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
```

- [ ] **Step 2: The buttons and the page**

Apply to `web/src/keymap/LayerTabs.svelte`:

```diff
diff --git a/web/src/keymap/LayerTabs.svelte b/web/src/keymap/LayerTabs.svelte
--- a/web/src/keymap/LayerTabs.svelte
+++ b/web/src/keymap/LayerTabs.svelte
@@ -9,9 +9,13 @@
     onselect: (index: number) => void;
     /** an empty name gives the layer its default name back; resolves to whether it worked */
     onrename: (index: number, name: string) => Promise<boolean>;
+    /** why Arrange layers does nothing just now, or null */
+    arrangeBlocked: string | null;
+    /** opens Arrange layers */
+    onarrange: () => void;
   }
 
-  let { layers, active, canRename, onselect, onrename }: Props = $props();
+  let { layers, active, canRename, onselect, onrename, arrangeBlocked, onarrange }: Props = $props();
 
   /** the layer being renamed, in the dialog */
   let renaming = $state<number | null>(null);
@@ -104,6 +108,23 @@
       </svg>
     </button>
   {/if}
+  <!-- after every tab; aria-disabled rather than disabled, so that its tooltip says why it does nothing -->
+  <button
+    id="arrange-layers"
+    type="button"
+    class="arrange"
+    style="order: {layers.length * 2 + 1}"
+    aria-disabled={arrangeBlocked !== null || undefined}
+    title={arrangeBlocked ?? "Move layers to other positions; keys that reach them follow"}
+    onclick={() => {
+      if (arrangeBlocked === null) onarrange();
+    }}
+  >
+    <svg viewBox="0 0 16 16" aria-hidden="true">
+        <path d="M4.5 2.5v10M2.5 10.5l2 2 2-2M11.5 13.5v-10M9.5 5.5l2-2 2 2" />
+      </svg>
+    Arrange layers…
+  </button>
 </div>
 
 <NameDialog {subject} onsave={(name) => (renaming === null ? Promise.resolve(true) : save(renaming, name))} onclose={closed} />
@@ -189,6 +210,34 @@
     color: var(--text);
   }
 
+  .arrange {
+    display: inline-flex;
+    align-items: center;
+    gap: 6px;
+    min-height: 30px;
+    margin-left: auto;
+    padding: 4px 10px;
+    border: 1px solid transparent;
+    border-radius: 8px;
+    background: transparent;
+    color: var(--text-2);
+    font-size: 13px;
+    font-weight: 550;
+    cursor: pointer;
+  }
+
+  .arrange:hover:not([aria-disabled="true"]) {
+    border-color: var(--border);
+    background: var(--surface);
+    color: var(--text);
+  }
+
+  .arrange[aria-disabled="true"] {
+    opacity: 0.5;
+    cursor: not-allowed;
+  }
+
+  .arrange svg,
   .rename svg {
     width: 15px;
     height: 15px;
```

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -14,6 +14,11 @@
   import { router } from "../lib/router.svelte";
   import { browserStorage } from "../lib/theme";
   import Picker from "../picker/Picker.svelte";
+  import Button from "../ui/Button.svelte";
+  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
+  import ArrangeBar from "./ArrangeBar.svelte";
+  import ArrangeDialog from "./ArrangeDialog.svelte";
+  import { layerArranger } from "./arranging.svelte";
   import DropMenu from "./DropMenu.svelte";
   import Inspector from "./Inspector.svelte";
   import FindBox from "./FindBox.svelte";
@@ -128,6 +133,9 @@
     if (kept.selection) document.querySelector<HTMLElement>(`[data-ref="${refId(kept.selection)}"]`)?.focus();
   }
 
+  // Arrange layers is for the keyboard this page shows: another one makes the page anew, without it
+  $effect(() => () => layerArranger.dropped());
+
   // a key dragged onto another, or chosen after the Inspector's Swap or Copy (move.svelte.ts)
   const mover = new KeyMover({
     placement: () => placement,
@@ -207,6 +215,15 @@
       ? combosUsing(analysis.combos, model, analysis.codes[kept.layer] ?? new Map(), kept.layer, kept.selection)
       : [],
   );
+  /** Finish or Put back from the bar: the bar goes once it is done, and the focus, if it was on it, to the heading */
+  async function fromBar(run: () => Promise<boolean>): Promise<boolean> {
+    const done = await run();
+    await tick();
+    const focused = document.activeElement;
+    if (done && (!focused || focused === document.body)) document.getElementById("keymap-title")?.focus();
+    return done;
+  }
+
   const subject = $derived.by(() => {
     if (!kept.selection) return "";
     const { what, where } = whereIs(model, kept.selection);
@@ -242,8 +259,24 @@
     <FindBox bind:text={kept.findText} results={foundResults} onopen={(place) => void openKey(place)} />
   {/snippet}
 
+  {#if keyboard.unfinishedArrange}
+    <ArrangeBar
+      unfinished={keyboard.unfinishedArrange}
+      canEdit={keyboard.canEdit}
+      onfinish={() => fromBar(() => layerArranger.finish())}
+      onputback={() => fromBar(() => layerArranger.putBack())}
+    />
+  {/if}
+
   {#if kept.view === "overview"}
     {@render find()}
+    <!-- above the layer cards; aria-disabled rather than disabled, so that its tooltip says why it does nothing -->
+    <div class="arrange-tools">
+      <Button id="arrange-layers-overview" size="sm" class={layerArranger.blocked !== null ? "off" : undefined}
+        aria-disabled={layerArranger.blocked !== null || undefined}
+        title={layerArranger.blocked ?? "Move layers to other positions; keys that reach them follow"}
+        onclick={() => layerArranger.start("arrange-layers-overview")}>Arrange layers…</Button>
+    </div>
     <Overview
       {model} {phrases} {placement} {analysis} {highlighted} current={kept.layer} onopen={(i) => void openLayer(i)}
     />
@@ -258,6 +291,8 @@
           canRename={keyboard.canEdit}
           onselect={(i) => (kept.layer = i)}
           onrename={(i, name) => keyboard.rename("layers", i, name)}
+          arrangeBlocked={layerArranger.blocked}
+          onarrange={() => layerArranger.start("arrange-layers")}
         />
         <div class="layer" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{kept.layer}">
           {#if analysis.reach[kept.layer]}
@@ -346,6 +381,28 @@
   </div>
 {/if}
 
+<ArrangeDialog
+  open={layerArranger.open}
+  {model}
+  {analysis}
+  {phrases}
+  onapply={(order, report) => layerArranger.apply(order, report)}
+  onfinish={(report) => layerArranger.finish(report)}
+  onputback={(report) => layerArranger.putBack(report)}
+  onclose={() => layerArranger.closed()}
+/>
+<ConfirmDialog
+  open={layerArranger.asking !== null}
+  title="Arrange the layers?"
+  message={layerArranger.asking ?? ""}
+  confirmLabel="Arrange layers"
+  onconfirm={async () => {
+    layerArranger.confirm();
+    return true;
+  }}
+  onclose={() => layerArranger.questionClosed()}
+/>
+
 {#if kept.view === "edit" && kept.selection && current}
   <Picker
     bind:open={pickerOpen}
@@ -390,6 +447,17 @@
     color: var(--text-2);
   }
 
+  .arrange-tools {
+    display: flex;
+    justify-content: flex-end;
+    margin-bottom: -6px;
+  }
+
+  .arrange-tools :global(.off) {
+    opacity: 0.5;
+    cursor: not-allowed;
+  }
+
   .workspace {
     display: grid;
     grid-template-columns: minmax(0, 1fr);
```

- [ ] **Step 3: Type-check, unit tests, build**

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  52 passed (52)` and `Tests  835 passed (835)` and `built in`.

- [ ] **Step 4: The existing e2e suite, against this build**

```bash
cd web && npx playwright test
```

Expected: `192 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keymap/ArrangeBar.svelte \
  web/src/keymap/ArrangeDialog.svelte \
  web/src/keymap/KeymapPage.svelte \
  web/src/keymap/LayerTabs.svelte
git commit -m "feat(web): Arrange layers dialog, its buttons in the Edit view and the Overview, and the bar after a stop"
```

### Task 9: Arrange layers end to end; a 20-layer fake server; the README

**e2e** (`web/e2e/arrange.spec.ts`, 12 tests, against `--fake` servers):
- layers reordered with the keyboard, applied, then undone: the tabs, the names and the keys follow, and the Edit view stays on its layer;
- a layer dragged by its handle, then applied;
- Esc and Cancel write nothing; Reset goes back to the current order;
- an arrange stopped partway (the fail-write hook) is finished from the dialog;
- an arrange cut short by an unplug is put back from the bar, after a replug and a reload;
- work not saved is asked about first;
- the Overview's button, and why it does nothing with the keyboard unplugged;
- the dialog with the tri-layer warning (8 layers, a 40-character name cut short), at five window sizes;
- a problem (20 layers, layer 2 at position 19) turns Apply off;
- the flags, the summary's first line and Apply stay in view by the footer: 20 layers with a warning and a problem together, and 8 layers with the warning, at 375 × 740, 800 × 900 and 1920 × 950;
- the stopped dialog and the bar at five window sizes.

Every size checks that the dialog lies inside the window and that nothing scrolls sideways. Screenshots in both themes go to `e2e/screenshots/`. Each test's `keep()` puts back the layout (a `.vil` file), every layer's name (an arrange moves names, so a name could stay at another position) and any arrange left unfinished.

**Servers:** `SERVERS.twentyLayers` (`--layers 20`, more layers than LT and LM can reach) and its `twentyLayers` fixture. **`web/README.md`:** the fail-write hook, the 20-layer server, the `arrange` spec.

**Files:**
- Modify: `web/e2e/servers.ts`
- Modify: `web/e2e/fixtures.ts`
- Test: `web/e2e/arrange.spec.ts` (new)
- Modify: `web/README.md`

- [ ] **Step 1: The 20-layer server and the tests**

Apply to `web/e2e/servers.ts`:

```diff
diff --git a/web/e2e/servers.ts b/web/e2e/servers.ts
--- a/web/e2e/servers.ts
+++ b/web/e2e/servers.ts
@@ -36,13 +36,14 @@ const UNLOCK_COUNTER = ["--unlock-counter", "10"];
 
 /** Vial's arguments (vial_web.py's, or the executable's) for each simulated keyboard: the default simulated Corne
  * (VialRGB lighting), a macropad with encoders, rotated keys, an ISO Enter, a decal, a layout option and no lighting,
- * the Corne with 8 layers, as the owner's W-CORNE has, the Corne with QMK's RGB light and backlight instead of VialRGB,
- * and the Corne with the macropad as the second keyboard, which the test hook PUT /api/simulator/second-keyboard plugs
- * in */
+ * the Corne with 8 layers, as the owner's W-CORNE has, the Corne with 20 layers (more than LT and LM can reach), the
+ * Corne with QMK's RGB light and backlight instead of VialRGB, and the Corne with the macropad as the second keyboard,
+ * which the test hook PUT /api/simulator/second-keyboard plugs in */
 export const SERVERS = {
   corne: [...UNLOCK_COUNTER],
   macropad: ["--definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
   eightLayers: ["--layers", "8", ...UNLOCK_COUNTER],
+  twentyLayers: ["--layers", "20", ...UNLOCK_COUNTER],
   qmkLighting: ["--lighting", "qmk_backlight_rgblight", ...UNLOCK_COUNTER],
   twoKeyboards: ["--second-definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
 } satisfies Record<string, string[]>;
```

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -33,18 +33,26 @@ function serverOf(
 }
 
 /** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
- * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty), `qmkLighting` the
+ * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty), `twentyLayers` with 20
+ * layers (4-19 empty), `qmkLighting` the
  * simulated Corne with QMK's RGB light and backlight, `twoKeyboards` the simulated Corne of a server whose second
  * keyboard (the macropad) is plugged in by secondKeyboard(). `corneUrl` is the simulated Corne's link, for a test that
  * opens it itself. `ownServer` is a simulated Corne's server of the test's own, started for it and stopped after it,
  * for a test that ends it (Quit Vial). */
 export const test = base.extend<
-  { app: Page; macropad: Page; eightLayers: Page; qmkLighting: Page; twoKeyboards: Page; ownServer: TestServer },
-  { corneUrl: string; macropadUrl: string; eightLayersUrl: string; qmkLightingUrl: string; twoKeyboardsUrl: string }
+  {
+    app: Page; macropad: Page; eightLayers: Page; twentyLayers: Page; qmkLighting: Page; twoKeyboards: Page;
+    ownServer: TestServer;
+  },
+  {
+    corneUrl: string; macropadUrl: string; eightLayersUrl: string; twentyLayersUrl: string; qmkLightingUrl: string;
+    twoKeyboardsUrl: string;
+  }
 >({
   corneUrl: serverOf(SERVERS.corne),
   macropadUrl: serverOf(SERVERS.macropad),
   eightLayersUrl: serverOf(SERVERS.eightLayers),
+  twentyLayersUrl: serverOf(SERVERS.twentyLayers),
   qmkLightingUrl: serverOf(SERVERS.qmkLighting),
   twoKeyboardsUrl: serverOf(SERVERS.twoKeyboards),
   app: async ({ page, corneUrl }, use) => {
@@ -56,6 +64,9 @@ export const test = base.extend<
   eightLayers: async ({ page, eightLayersUrl }, use) => {
     await use(await open(page, eightLayersUrl));
   },
+  twentyLayers: async ({ page, twentyLayersUrl }, use) => {
+    await use(await open(page, twentyLayersUrl));
+  },
   qmkLighting: async ({ page, qmkLightingUrl }, use) => {
     await use(await open(page, qmkLightingUrl));
   },
```

Create `web/e2e/arrange.spec.ts`:

```ts
import type { Locator, Page } from "@playwright/test";
import {
  api, codeAt, expect, keyIndex, layerNameOf, openSection, plugIn, restoreAll, screenshots, setCodeAt, setLayerName,
  setSettings, settingsOf, test,
} from "./fixtures";

// Arrange layers: the dialog (reordered by keyboard and by drag), Apply and its Undo, Esc, an arrange that stops
// partway (the fake server's PUT /api/simulator/fail-write) with Finish and Put back, the question about work not saved,
// and the dialog and the bar at five window sizes in both themes. Each test puts back the keyboard (its .vil file), the
// layer names and whatever arrange it left unfinished.

/** The Corne's base layer: LT1(Space) on the left middle thumb (row 3, column 4) */
const SPACE = { row: 3, col: 4 };

/** What the test changes, put back afterwards: the layout (a .vil file holds every key, tap dance, combo, macro…),
 * every layer's name (an arrange moves them), and an arrange left unfinished */
async function keep(page: Page) {
  const vil = await (await api(page).get("/api/layout-file")).text();
  const count = (await (await api(page).get("/api/keyboard")).json()).layers.length;
  const layers = Array.from({ length: count }, (_, i) => i);
  const names = await Promise.all(layers.map((l) => layerNameOf(page, l)));
  return async () => {
    await plugIn(page, true);
    await api(page).put("/api/simulator/fail-write", { after: null });
    await expect.poll(async () => (await (await api(page).get("/api/session")).json()).status).toBe("connected");
    const session = await (await api(page).get("/api/session")).json();
    if (session.arrange) await api(page).post("/api/layers/arrange/put-back");
    const loaded = await api(page).post("/api/layout-file", vil);
    if (!loaded.ok()) throw new Error(`putting the layout back failed: ${await loaded.text()}`);
    for (const [i, layer] of layers.entries()) await setLayerName(page, layer, names[i]);
  };
}

function toast(page: Page, text: string): Locator {
  return page.getByRole("region", { name: "Notifications" }).getByText(text);
}

function dialogOf(page: Page): Locator {
  return page.getByRole("dialog", { name: "Arrange layers" });
}

/** The handle of a layer's row, by its name and position */
function handle(dialog: Locator, name: string): Locator {
  return dialog.getByRole("button", { name: new RegExp(`^${name}, position`) });
}

async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Arrange layers…" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".summary")).toContainText("Nothing to change.");
  return dialog;
}

async function tabNames(page: Page): Promise<string[]> {
  return page.getByRole("tab").locator(".name").allTextContents();
}

test("layers reordered with the keyboard, applied, then undone: tabs, names and keys follow", async ({ app }) => {
  const restore = await keep(app);
  try {
    await setLayerName(app, 3, "Num");
    await app.reload();
    const space = await keyIndex(app, SPACE.row, SPACE.col);
    // the Edit view shows Num: it still does after the arrange, at its new position
    await app.getByRole("tab", { name: /Num/ }).click();
    const dialog = await openDialog(app);
    await expect(handle(dialog, "Layer 1")).toBeFocused();
    await expect(dialog).toContainText("Nothing is written until you Apply.");
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");

    await handle(dialog, "Num").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await app.keyboard.press("Alt+ArrowUp");
    await expect(handle(dialog, "Num")).toBeFocused();
    await expect(handle(dialog, "Num")).toHaveAccessibleName("Num, position 1, was 3");
    await expect(dialog.locator(".row").nth(1)).toContainText("← was 3");
    await expect(dialog.locator(".summary")).toContainText(
      "Will change: 3 layers move · 94 keys rewritten · 4 layer keys renumbered (4 in the keymap).");
    const apply = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(apply).not.toHaveAttribute("aria-disabled");
    await apply.click();
    await expect(dialog).toBeHidden();
    await expect(app.locator("#arrange-layers")).toBeFocused();
    await expect(toast(app, "Layers arranged.")).toBeVisible();
    expect(await tabNames(app)).toEqual(["Base", "Num", "Layer 2", "Layer 3"]);
    await expect(app.getByRole("tab", { selected: true })).toContainText("Num");
    expect(await codeAt(app, 0, space)).toBe("LT2(KC_SPACE)");
    expect(await layerNameOf(app, 1)).toBe("Num");

    await app.getByRole("button", { name: "Undo" }).click();
    await expect(toast(app, "Layers arranged.")).toBeHidden();
    expect(await tabNames(app)).toEqual(["Base", "Layer 1", "Layer 2", "Num"]);
    await expect(app.getByRole("tab", { selected: true })).toContainText("Num");
    expect(await codeAt(app, 0, space)).toBe("LT1(KC_SPACE)");
    expect([await layerNameOf(app, 1), await layerNameOf(app, 3)]).toEqual([null, "Num"]);
  } finally {
    await restore();
  }
});

test("a layer dragged by its handle, then applied", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    const from = await handle(dialog, "Layer 1").boundingBox();
    const to = await dialog.locator(".row").nth(3).boundingBox();
    if (!from || !to) throw new Error("rows not drawn");
    await app.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await app.mouse.down();
    await app.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 12 });
    await app.mouse.up();
    // never named, each layer shows its new position's name, and where it was
    await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
    await expect(dialog.locator(".row .was")).toHaveText(["← was 2", "← was 3", "← was 1"]);
    await expect(dialog.locator(".summary")).toContainText("Will change: 3 layers move");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toBeHidden();
    // layer 1 (hold Space) is at position 3 now
    expect(await codeAt(app, 0, await keyIndex(app, SPACE.row, SPACE.col))).toBe("LT3(KC_SPACE)");
  } finally {
    await restore();
  }
});

test("Esc and Cancel write nothing; Reset goes back to the current order", async ({ app }) => {
  const before = await (await api(app).get("/api/layout-file")).text();
  let dialog = await openDialog(app);
  await handle(dialog, "Layer 2").focus();
  await app.keyboard.press("Alt+ArrowDown");
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(dialog.locator(".row .was")).toHaveText(["← was 3", "← was 2"]);
  await expect(handle(dialog, "Layer 2")).toHaveAccessibleName("Layer 2, position 2, was 3");
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(handle(dialog, "Layer 1")).toBeFocused();
  await handle(dialog, "Layer 2").focus();
  await app.keyboard.press("Alt+ArrowDown");
  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(app.locator("#arrange-layers")).toBeFocused();
  // opened again, it starts from the current order
  dialog = await openDialog(app);
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await (await api(app).get("/api/layout-file")).text()).toBe(before);
});

test("an arrange that stops partway is finished from the dialog", async ({ app }) => {
  const restore = await keep(app);
  try {
    await setLayerName(app, 3, "Num");
    await app.reload();
    const dialog = await openDialog(app);
    await handle(dialog, "Num").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("94 keys rewritten");
    await api(app).put("/api/simulator/fail-write", { after: 10 });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const stopped = dialog.locator(".stopped");
    await expect(stopped).toContainText("Arranging the layers stopped after 9 of 94 writes.", { timeout: 15_000 });
    await expect(stopped).toBeFocused();
    // the server opens the keyboard again (a USB reset): then Finish works
    const finish = dialog.getByRole("button", { name: "Finish" });
    await expect(finish).not.toHaveAttribute("aria-disabled", { timeout: 15_000 });
    await screenshots(app, "arrange-stopped-1280");
    await finish.click();
    await expect(dialog).toBeHidden();
    await expect(toast(app, "Layers arranged.")).toBeVisible();
    expect(await tabNames(app)).toEqual(["Base", "Num", "Layer 2", "Layer 3"]);
    expect(await codeAt(app, 0, await keyIndex(app, SPACE.row, SPACE.col))).toBe("LT2(KC_SPACE)");
  } finally {
    await restore();
  }
});

test("an arrange cut short by an unplug is put back from the bar, after a replug and a reload", async ({ app }) => {
  const restore = await keep(app);
  try {
    const before = await (await api(app).get("/api/layout-file")).text();
    const space = await keyIndex(app, SPACE.row, SPACE.col);
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
    await api(app).put("/api/simulator/fail-write", { after: 20, unplug: true });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Arranging the layers failed");
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await plugIn(app, true);
    const bar = app.getByRole("region", { name: "Arranging the layers stopped" });
    await expect(bar).toContainText("stopped after 19 of", { timeout: 15_000 });
    await app.reload();
    await expect(bar).toBeVisible();
    await screenshots(app, "arrange-bar-1280");
    await bar.getByRole("button", { name: "Put back" }).click();
    await expect(bar).toBeHidden();
    await expect(app.locator("#keymap-title")).toBeFocused();
    expect(await codeAt(app, 0, space)).toBe("LT1(KC_SPACE)");
    expect(await (await api(app).get("/api/layout-file")).text()).toBe(before);
  } finally {
    await restore();
  }
});

test("work not saved is asked about first", async ({ app }) => {
  const settings = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    await app.getByRole("textbox", { name: "Tapping Term" }).fill("250");
    await openSection(app, "Keymap");
    const button = app.locator("#arrange-layers");
    await button.click();
    const question = app.getByRole("dialog", { name: "Arrange the layers?" });
    await expect(question).toContainText("Not saved yet: the changes on the Settings page.");
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect(question).toBeHidden();
    await expect(button).toBeFocused();
    await expect(dialogOf(app)).toBeHidden();
    await button.click();
    await question.getByRole("button", { name: "Arrange layers" }).click();
    await expect(dialogOf(app)).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(button).toBeFocused();
  } finally {
    await openSection(app, "Settings");
    await app.locator(".savebar").getByRole("button", { name: "Undo" }).click();
    await setSettings(app, settings);
  }
});

test("the button is in the Overview too, and says why it does nothing with the keyboard unplugged", async ({ app }) => {
  try {
    await app.getByRole("radio", { name: "Overview" }).check();
    const button = app.locator("#arrange-layers-overview");
    await screenshots(app, "arrange-overview-button-1280");
    await button.click();
    await expect(dialogOf(app)).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await plugIn(app, false);
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAttribute("title", "The keyboard can't be changed just now.");
  } finally {
    await plugIn(app, true);
    await expect(app.locator("#arrange-layers-overview")).not.toHaveAttribute("aria-disabled");
    await app.getByRole("radio", { name: "Edit" }).check();
  }
});

// ---- the dialog in every window, with a warning, a problem, and stopped ----

/** The window sizes the owner's checks name: a phone, a small window, and the 1080p screen */
const SHORT_SIZES = [{ width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1920, height: 950 }];

const SIZES = [
  { width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1280, height: 800 },
  { width: 1920, height: 950 }, { width: 2560, height: 1300 },
];

/** The dialog is inside the window, and the page doesn't scroll sideways */
/** Why Apply is off, or what it warns of, is in view by the footer, however long the list: the flags line, and the
 * summary's first line */
async function reasonsInView(dialog: Locator, flags: string[]) {
  await expect(dialog.locator(".flag")).toHaveText(flags);
  for (const flag of await dialog.locator(".flag").all()) await expect(flag).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator(".will")).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport({ ratio: 1 });
}

async function fits(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

test("the dialog with the tri-layer warning, 8 layers and long names, at five window sizes", async ({ eightLayers }) => {
  const page = eightLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await setLayerName(page, 2, "Navigation, arrows and the page keys");
    await setLayerName(page, 5, "A very long layer name of forty chars..");
    await page.reload();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      await handle(dialog, "Layer 3").focus();
      await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press("Alt+ArrowUp");
      await expect(dialog.locator(".warning")).toContainText("Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow");
      await fits(page, dialog);
      await reasonsInView(dialog, ["⚠ Fn1 and Fn2 will reach other layers"]);
      // the flag shows the whole warning
      await dialog.locator(".flag.warn").click();
      await expect(dialog.locator(".warning")).toBeInViewport({ ratio: 1 });
      // a long name is cut short, and whole in its tooltip
      const name = dialog.locator(".row .name", { hasText: /^A very long/ });
      await expect(name).toHaveAttribute("title", "A very long layer name of forty chars..");
      await screenshots(page, `arrange-warning-${size.width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("a problem: a layer number that wouldn't fit turns Apply off", async ({ twentyLayers }) => {
  const page = twentyLayers;
  const dialog = await openDialog(page);
  // layer 2 (LT2 on the base layer) to position 19: LT holds layers 0 to 15
  await handle(dialog, "Layer 2").focus();
  for (let i = 0; i < 17; i++) await page.keyboard.press("Alt+ArrowDown");
  await expect(dialog.locator(".problem")).toContainText("This order can't be written");
  await expect(dialog.locator(".problem")).toContainText("LT keys hold layers 0 to 15: layer 2 can't go to position 19");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await fits(page, dialog);
    await reasonsInView(dialog, ["Can't apply: 3 layer numbers wouldn't fit"]);
    await screenshots(page, `arrange-problem-${size.width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("20 layers: a warning and a problem at once stay in view by the footer", async ({ twentyLayers }) => {
  const page = twentyLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await page.reload();
    for (const size of SHORT_SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      await handle(dialog, "Layer 2").focus();
      for (let i = 0; i < 17; i++) await page.keyboard.press("Alt+ArrowDown");
      await fits(page, dialog);
      await reasonsInView(dialog, ["Can't apply: 3 layer numbers wouldn't fit", "⚠ Fn1 and Fn2 will reach other layers"]);
      await dialog.locator(".flag.bad").click();
      await expect(dialog.locator(".problem").first()).toBeInViewport();
      await screenshots(page, `arrange-both20-${size.width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("8 layers: the warning stays in view by the footer at the owner's sizes", async ({ eightLayers }) => {
  const page = eightLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await page.reload();
    for (const size of SHORT_SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      // the last layer first: the list is as long as it gets
      await handle(dialog, "Layer 1").focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press("Alt+ArrowDown");
      await fits(page, dialog);
      await reasonsInView(dialog, ["⚠ Fn1 and Fn2 will reach other layers"]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("the stopped dialog and the bar at five window sizes", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change");
    await api(app).put("/api/simulator/fail-write", { after: 5 });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Finish" })).not.toHaveAttribute("aria-disabled",
      { timeout: 15_000 });
    for (const size of SIZES) {
      await app.setViewportSize(size);
      await fits(app, dialog);
      await screenshots(app, `arrange-stopped-${size.width}`);
    }
    await dialog.getByRole("button", { name: "Close" }).click();
    const bar = app.getByRole("region", { name: "Arranging the layers stopped" });
    for (const size of SIZES) {
      await app.setViewportSize(size);
      await expect(bar).toBeVisible();
      await screenshots(app, `arrange-bar-${size.width}`);
      expect(await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);
    }
  } finally {
    await app.setViewportSize({ width: 1280, height: 800 });
    await restoreAll(restore);
  }
});
```

- [ ] **Step 2: Run the new spec**

```bash
cd web && npm run check && npx playwright test e2e/arrange.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `12 passed`.

- [ ] **Step 3: The README**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -61,7 +61,13 @@ exist for no real keyboard and are left out of the OpenAPI schema (so of `schema
   `{"connected": true, "unreadable": true}` plugs it in with firmware this Vial can't read (a newer
   Vial protocol): it is listed, and fails to load until it is plugged in again without that.
 
-The unlock, connection and matrix hooks act on the first simulated keyboard.
+- `PUT /api/simulator/fail-write` with `{"after": 10}` makes the 10th write from now to the keyboard fail (a write
+  is a request that changes it; a macro buffer takes several), without changing anything; `{"after": null}` makes none
+  fail. With `"unplug": true` the keyboard drops off the bus at that write (plug it back in with the connection hook);
+  without, it stays plugged in and its connection stops working, which the server opens again on its next look for
+  keyboards, as after a USB reset. It is how the tests stop an arrange of the layers partway.
+
+The unlock, connection, matrix and fail-write hooks act on the first simulated keyboard.
 
 `--fake` keeps the firmware's unlock timing: the countdown (50 steps) only goes down on a poll that
 comes more than 100 ms after the start or the last step (a sooner one starts it over), and the
@@ -91,7 +97,8 @@ CI runs `npm run check:api`.
 
 `e2e/servers.ts` starts `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
 default Corne, with VialRGB; `e2e/fixtures/macropad.vial.json` with encoders, a layout option and no
-lighting; the Corne with `--layers 8`, as the owner's keyboard has; the Corne with
+lighting; the Corne with `--layers 8`, as the owner's keyboard has; the Corne with `--layers 20`, more layers than
+LT and LM can reach; the Corne with
 `--lighting qmk_backlight_rgblight`; and the Corne with the macropad as its second keyboard,
 `--second-definition`), reads the links with the session token from their output, and at the end asks each to quit
 (`POST /api/shutdown`, as Quit Vial does), ending it if it is still running afterwards. One that refuses it, doesn't
@@ -111,6 +118,7 @@ in the page.
 | Spec | What it tests |
 |---|---|
 | `keymap`, `find`, `overview`, `display`, `theme` | The Keymap's Edit and Overview views, the find box, sizes and fonts, the theme |
+| `arrange` | Arrange layers: layers reordered with the keyboard and by drag, applied (tabs, names and keys following, the Edit view staying on its layer) and undone; Esc, Cancel and Reset writing nothing; an arrange stopped partway (the fail-write hook) finished from the dialog, and one cut short by an unplug put back from the bar after a replug and a reload; work not saved asked about first; the Overview's button; the dialog with the tri-layer warning (8 layers, long names), with a problem (20 layers) and stopped, and the bar, at five window sizes |
 | `move` | Dragging a key onto another with the mouse (Replace, Swap both, Undo, Esc), the Inspector's Copy and Swap without a mouse, the drop menu in a 1080p window |
 | `macropad` | Another keyboard: encoders, rotated keys, an ISO Enter, a decal, a layout option |
 | `behaviours` | The Tap dance, Combos and Macros pages end to end, the top bar's Lock/Unlock, the pages at four window sizes and at 375 px |
```

- [ ] **Step 4: Run every check**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1224 passed, 6 skipped`.

```bash
cd web && npm run check && npm test && npm run build && npm run check:api
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  52 passed (52)` and `Tests  835 passed (835)` and `built in` and `src/api/schema.d.ts is up to date`.

- [ ] **Step 5: Commit**

```bash
git add web/README.md \
  web/e2e/arrange.spec.ts \
  web/e2e/fixtures.ts \
  web/e2e/servers.ts
git commit -m "test(e2e): arrange layers end to end; a 20-layer fake server; the fail-write hook documented"
```

- [ ] **Step 6 (final): The whole e2e suite, with the screenshots copied for review.** `screenshots/` is excluded from git through `.git/info/exclude` (pattern `/screenshots/`). Run this from the main working tree, or replace `/t/others/vial-gui` with its path.

```bash
cd web && npm run e2e && rm -rf /t/others/vial-gui/screenshots/phase8 && mkdir -p /t/others/vial-gui/screenshots/phase8 && cp e2e/screenshots/arrange-* /t/others/vial-gui/screenshots/phase8/ && echo "$(ls /t/others/vial-gui/screenshots/phase8 | wc -l) screenshots copied" && git -C /t/others/vial-gui check-ignore screenshots/phase8/arrange-warning-1920-light.png
```

Expected: `204 passed` and `48 screenshots copied` and `screenshots/phase8/arrange-warning-1920-light.png`.

Look at the screenshots, each in `-light` and `-dark`:
- `arrange-warning-375`, `-800`, `-1280`, `-1920`, `-2560`: 8 layers, the tri-layer warning flagged by the footer, a 40-character name cut short with "…";
- `arrange-problem-375` … `-2560`: 20 layers, layer 2 at position 19, three problems listed, Apply off;
- `arrange-both20-375`, `-800`, `-1920`: 20 layers with a warning and a problem at once, both flags by the footer;
- `arrange-stopped-375` … `-2560`: the dialog after a write failed, with Close, Put back and Finish;
- `arrange-bar-375` … `-2560`: the bar above the find box in the Edit view;
- `arrange-overview-button-1280`: the Overview's button above the cards.

At 1920 × 950 the 8-layer dialog fits with its warning; at 375 px the rows and the summary scroll inside the dialog and the footer stays visible; nothing scrolls sideways. Then hand over to the owner checklist above.

## Design coverage

| Design item (`2026-10-21-arrange-layers-design.md`) | Task |
|---|---|
| Move a layer; the layers between shift; no separate swap, no copy | 2 (`arrange`), 7 (`moveTo`) |
| Keys that point at a layer follow it; the names move with their layers | 2, 3, 5 |
| A dialog: reorder freely, see what changes, Apply once, one Undo | 7, 8 |
| Layer 0 fixed, first, with a lock | 2 (`check_order`), 7 (`moveTo`), 8 (the row) |
| The server computes and writes the new state; the page chooses the order and shows the preview | 5, 7, 8 |
| Opening: a button after the layer tabs and above the Overview's cards; off with a tooltip when editing is blocked or with fewer than 3 layers | 7 (`arrangeBlocked`), 8 |
| Work not saved asked about first | 7 (`unsavedQuestion`, `layerArranger.start`), 8, 9 |
| Rows: position, name, "← was N", how the layer is reached | 7 (`nameAfter`), 8 |
| Drag by the handle, ↑/↓ buttons, Alt+↑/↓ | 7 (`moveStep`, `canStep`), 8, 9 |
| The preview after about 300 ms, newer answers replacing older, stale ones dropped | 7 (`PreviewFollower`) |
| Warnings don't block; problems disable Apply and say why; "Nothing to change" for the current order | 2, 5, 7 (`summaryText`, `triLayerWarning`), 8, 9 |
| Reset; Cancel or Esc writes nothing | 8, 9 |
| Apply: "Writing 96 keys…", then "Layers arranged" with Undo; the Edit view stays on the same layer | 7 (`writingLabel`, `layerArranger`), 8, 9 |
| Unlock first when `needsUnlock` | 5 (423 before any write), 6 (the store's 423 path) |
| The owner's layout rules: 1080p, 375 px, both themes, focus, "…" with tooltips, Firefox-safe CSS | 8, 9 (e2e at five sizes, screenshots) |
| `renumber` defined once with `describe.py`'s ranges; LM's bit layout per protocol; a number that doesn't fit is a problem; FN_MO13 / FN_MO23 not renumbered | 1, 2 |
| `arrange`: keymap, encoders, tap dance, combos, key overrides and their masks, alt-repeat, macros; the summary; the tri-layer warning | 2 |
| Nothing else holds layer numbers (QMK settings, lighting, layout options, the default layer) | 2 (only `PLACES` are read), Decision 2 |
| Routes: preview (writes nothing), apply (computed again, 409 on problems), `X-Vial-Keyboard` checked; models in `schemas.py`, `schema.d.ts` regenerated | 5 |
| `NamesStore.move_layers` in one atomic write; never-named layers show their new position's default name | 3, 7 (`nameAfter`) |
| Writing: only what differs, one device lock, keymap and encoders, then the entries, then macros, names last; every tab told | 5 |
| A write failing partway: S and T kept by UID; the dialog's Finish and Put back; the bar after closing; the session says so | 4, 5, 6, 7, 8, 9 |
| Undo by the reverse order | 7 (`reverseOrder`, `layerArranger`), 9 |
| pytest: `renumber`, `arrange`, round trips with names, the routes, failures, encoders | 1, 2, 3, 5 |
| Vitest: the order logic, the stale-answer rule, the wording | 7 |
| Playwright: drag and keyboard, Apply, tabs, names and keys, Undo, Esc, Finish and Put back; a fake-only switch to fail a write | 4, 5 (the hook), 9 |
| Screenshots in both themes, 375 → 2560 px, in `screenshots/phase8/` | 9 (final step) |
| Agents never use the owner's keyboard; the owner's checklist starts with a harmless move and Undo | ground rules, owner checklist |

## Self-review

- **Design coverage:** every item of the design maps to a task in the table above. Where the prototype differs from the design, the Decisions say how and why: the preview's shape (`{layer, to}`, `triLayer` instead of words, `writes` added), "may hold part of the new order" instead of "has", empty key overrides keeping their mask, the tri-layer layers on protocol 6 (the firmware's default 1, 2 and 3), Undo also after Finish, and the bar shown in the Overview too. The three fixes made after the prototype's first review are folded into the tasks they belong to: `QK_LAYER_MOD` and `TRI_LAYER_KEYS` derived from `REFERENCES` (Task 1), the names shown as they will be after Apply and the warning calling layers by where they were (Task 7), and the summary kept by the footer with its flags (Task 8, tested in Task 9). So are the "doesn't fit" message naming its keys (Task 2) and the e2e tests putting back every layer's name (Task 9).
- **Placeholder scan:** every code step gives the complete file or an exact diff against what the task before left. Every command has its expected output, taken from a mechanical replay of this plan from `main`. Nothing is left to be filled in later; the deferred items are listed under "Out of scope / later" and are simply not built.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `describe.Reference` (`number`, `largest`, `with_number`), `REFERENCES`, `reference_range`, `keycode_protocol`, `TRI_LAYER` (Task 1), used by `layers.py` (Task 2) and `arranger.py` (Task 5);
  - `layers.KeyboardState`, `Arrangement`, `Problem`, `PLACES`, `check_order`, `mapping_of`, `reverse`, `renumber`, `move_mask`, `arrange`, `DoesNotFit`, `BadOrder` (Task 2), used by `test_layers.py` (Tasks 2, 3), `arranger.py` and `test_arrange.py` (Task 5);
  - `NamesStore.move_layers(uid, order)` and `_save` (Task 3), used by `arranger.begin` and `resume` (Task 5);
  - `VirtualKeyboard.fail_writes(after, unplug)`, `fail_write_in`, `SimulatedWriteFailure`, `FakeBackend.fail_writes` (Task 4), used by `app.py`'s fail-write route and `test_arrange.py` (Task 5), and through the route by `arrange.spec.ts` (Task 9);
  - `arranger.preview`, `begin`, `resume`, `Arrangements`, `Unfinished`, `ArrangeRefused`, `NothingUnfinished`; `schemas.ArrangeIn`, `ArrangePreview`, `ArrangeReferences`, `LayerMove`, `UnfinishedArrange`, `SimulatorFailWrite`, `Session.arrange`; the four routes and `PUT /api/simulator/fail-write` (Task 5), used by `api.ts` and `types.ts` (Task 6) and the e2e tests (Task 9);
  - `api.previewArrange`, `arrangeLayers`, `finishArrange`, `putBackArrange`; `KeyboardStore.arrangeLayers`, `finishArrange`, `putBackArrange`, `refreshSession`, `unfinishedArrange`; `toasts.info` returning an id (Task 6), used by `arranging.svelte.ts` (Task 7) and `ArrangeDialog.svelte` (Task 8);
  - `arrange.ts`'s functions and `PreviewFollower` (Task 7), used by `ArrangeDialog.svelte` and `ArrangeBar.svelte` (Task 8); `layerArranger` (`blocked`, `start`, `confirm`, `questionClosed`, `closed`, `dropped`, `apply`, `finish`, `putBack`) (Task 7), used by `KeymapPage.svelte` (Task 8);
  - `LayerTabs`' `arrangeBlocked` and `onarrange`, and the ids `arrange-layers`, `arrange-layers-overview` and `keymap-title` (Task 8), used by `arranging.svelte.ts` (Task 7) and the e2e tests (Task 9);
  - `SERVERS.twentyLayers` and the `twentyLayers` fixture (Task 9).
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase8` at `9767f1f`). The plan was replayed mechanically from `main`, and the result was compared with the prototype.
