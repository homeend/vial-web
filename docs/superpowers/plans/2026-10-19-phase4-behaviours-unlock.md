# Phase 4: Tap dance, combos, macros and the unlock flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the confusing parts of a keymap become clear, and macros can be edited on the real keyboard: Tap dance, Combos and Macros pages with plain-language cards, each combo in its own colour on its keys, and an unlock flow that speaks the same protocol as Qt's unlocker.

**Architecture:**
- **Backend.**
  - The device manager unlocks the keyboard as Qt's unlocker does: `unlock_start`, then `unlock_poll` about every 200 ms until the firmware says it is unlocked.
  - The server offers `POST /api/unlock/start`, `POST /api/unlock/cancel` and `POST /api/lock`. A task follows the countdown and pushes `unlock` events over `/api/events`; `GET /api/session` carries the unlock state.
  - A keyboard found waiting for an unlock started earlier is finished on connect, before it is read.
  - A fake-only hook, `PUT /api/simulator/unlock`, holds the simulated unlock keys or locks the keyboard, for the e2e tests.
  - `Described` gains `value`, the 16-bit keycode, which the macro sizes need.
- **Web logic.** Pure modules with Vitest tests:
  - `src/behaviours/`: sentences, macro steps and sizes, recording from the browser, choosing combo keys, which entries a page shows, keycodes described;
  - `src/analysis/combos.ts`: a colour for each combo;
  - `src/keyboard/marks.ts`: an underline or a row of dots;
  - `src/lib/route.ts`: the section in the address.
- **Store.** `setTapDance`, `setCombo`, `setMacros` and `rename` update the model, and with it the analysis, which `App.svelte` now works out once for every page. A change refused with 423 runs the unlock (`Unlocker`) and is sent again.
- **UI.**
  - Three list pages with one card per entry. They reuse the keyboard drawing, the keycode picker and a name dialog shared with the layers.
  - An unlock dialog, and a Lock/Unlock control in the top bar.
  - Hash routing (`#combos/2`), and navigation counts.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0.
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependencies: `web/package.json` and `web/package-lock.json` don't change.

**Roadmap (phase 4 scope):** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`. **Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md` (§4 API and unlock, §5 the tap dance, combos and macros pages). **Visual language:** `docs/superpowers/specs/mockups/behaviours.html`.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `vial_web.py --fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e global setup starts it exactly like that.
   - Never start the Qt app (`src/main/python/main.py`).
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry.
   - Tests use simulated keyboards only. The unlock is tried on the simulated Corne, never on the real keyboard.
2. **Shell:** Git Bash on Windows; commands are written for it.
   - Every command block starts in the repository root. A `cd` inside a block applies to that block only.
   - On Linux/macOS, replace `.venv/Scripts/python.exe` with `.venv/bin/python`.
3. **Python:** the repository's `.venv` (Python 3.13, with `test-requirements.txt` installed).
   - Tests run from `src/main/python`, because the code uses top-level imports:

   ```
   cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
   ```

   - `QT_QPA_PLATFORM=offscreen` keeps the Qt tests' windows off the screen.
   - The web scripts (`gen:api`, `check:api`, `e2e`) find this same `.venv` themselves, or the Python named by `VIAL_PYTHON`.
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
7. **Line endings:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings. `git apply` keeps them too.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
8. **Commits:** one commit per task, on branch `phase4-behaviours`.
   - Add the files the task names. Never `git add -A`, and leave the untracked `gh.txt` alone.
   - End every commit message with the trailer the session tells you to use.
9. **How code is given.**
   - "Create `X`:" is followed by the file's complete content.
   - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
   - A file changed by several tasks has one diff in each. The tasks are in order, so each diff applies to what the task before left.
   - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it (Tasks 3 and 4).
   - Each "Expected:" lists text that the command's output contains.
10. **Standing rules (roadmap and owner):**
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the keymap's content is at most 1100 px, the list pages (tap dance, combos, macros) at most 860 px, both centred. At 800 px nothing scrolls sideways.
    - Heights: the owner also uses a 1080p screen, which leaves about 1920 × 950 px for the page. Panels and dialogs fit there; the e2e tests check it.
    - Names typed by the user (layers, tap dances, macros, up to 40 characters) are cut short with "…" and a tooltip with the full name wherever they show. They are edited in the name dialog, which is wide enough for the longest.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike. A `-webkit-` property comes with its standard twin (`line-clamp` next to `-webkit-line-clamp`).
    - Both themes, light and dark, must read well.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

Phase 3 is merged into `main` (at `b8a19ab` or later), and `phase4-behaviours` is branched from it. `.venv` exists and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `744 passed, 1 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  381 passed (381)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/simulator/virtual_keyboard.py` | `unlock_counter_max`: each `UNLOCK_POLL` with every unlock key held counts down by one; letting go starts it again, as the firmware does. `hold_unlock_keys(held)` |
| `src/main/python/simulator/corne.py` | `UNLOCK_KEYS`: the outermost keys of both top rows, Tab (0,0) and Backspace (4,0). The Corne still starts unlocked |
| `src/main/python/server/device.py` | `start_unlock`, `poll_unlock`, `cancel_unlock`, `lock_keyboard`, `read_unlocked`, `unlock_state`, `read()`, `take_events()`, `interrupted_unlock_keys()`; `run()` refuses every request while the keyboard waits for its unlock keys |
| `src/main/python/server/schemas.py` | `UnlockState`, `MatrixPosition`, `Event.unlock`, `Session.unlock`, `SimulatorUnlock`; `Described.value` |
| `src/main/python/server/app.py` | `POST /api/unlock/start`, `/api/unlock/cancel`, `/api/lock`; the task that follows the countdown; `unlock` events; `PUT /api/simulator/unlock` (fake only, not in the schema); `Event`'s `$defs` hoisted into the components |
| `src/main/python/server/describe.py` | `value`: the keycode as the keyboard stores it |
| `src/main/python/test/test_unlock.py` | **new.** The unlock against the simulated Corne: device manager and API |
| `src/main/python/test/test_simulator.py`, `test_api.py`, `test_dump_openapi.py`, `test_describe.py` | tests for the above |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` |
| `web/src/api/api.ts`, `types.ts`, `events.ts`, `errors.ts` | the new routes and types; events are objects (an `unlock` one carries the state); the 423 message |
| `web/src/lib/unlock.svelte.ts` | **new.** `Unlocker`: the unlock state from events and the session; opens the dialog while unlocking; `unlock()`, `start()`, `cancel()`, `lock()` |
| `web/src/lib/keyboard.svelte.ts` | the store: `unlock`, a change refused with 423 sent again once unlocked; `setTapDance`, `setCombo`, `setMacros`, `rename`; `turnIntoTapDance` returns the index |
| `web/src/lib/route.ts`, `router.svelte.ts` | **new.** `#keymap`, `#tap-dance`, `#combos`, `#macros`, with an optional `/n`; `router.go`, `router.openKey` |
| `web/src/analysis/combos.ts`, `analysis.ts` | `comboMarksOn` (replaces `comboKeysOn`), `comboColours`, `COMBO_COLOURS`; `comboMarksOf` |
| `web/src/analysis/phrases.ts` | `comboMarkLabel`; `andList` and `layerList` exported; LM members keep their modifiers |
| `web/src/analysis/reach.ts` | encoder directions never hold a layer |
| `web/src/analysis/effective.ts`, `find.ts`, `positions.ts`, `testing.ts`, `usage.ts` | unused exports gone; `testing.ts` gives keycodes a value; a comment reworded |
| `web/src/keyboard/marks.ts` | **new.** A key's combo marks: an underline, or dots that fit, then "+n" |
| `web/src/keyboard/Key.svelte`, `Keyboard.svelte`, `Encoder.svelte` | combo marks in each combo's colour, the legends kept above them; a coloured ring, faded keys, chosen keys (`aria-pressed`) |
| `web/src/app.css` | the combo palette `--combo-0` to `--combo-5`, light and dark; `--list-max: 860px` |
| `web/src/keymap/KeymapPage.svelte`, `Overview.svelte`, `LayerCard.svelte`, `KindLegend.svelte` | combo colours and dots; the analysis comes from `App.svelte`; a key shown from another page; "Turn into tap dance" opens the card |
| `web/src/keymap/Inspector.svelte`, `ComboList.svelte` | each combo entry in its colour, a button that opens its card; "still fire" only for combos that can; the title cut short after two lines |
| `web/src/keymap/LayerTabs.svelte`, `web/src/ui/NameDialog.svelte` | **moved and generalised** from `keymap/LayerNameDialog.svelte`: one name dialog for layers, tap dances and macros |
| `web/src/picker/Picker.svelte`, `AnyKeycode.svelte` | `onpick` also gives the described keycode |
| `web/src/behaviours/sentences.ts`, `macro.ts`, `recorder.ts`, `members.ts`, `entries.ts`, `codes.ts` | **new.** The pages' logic, each with its `*.test.ts` |
| `web/src/behaviours/PageHeader.svelte`, `EntryHead.svelte`, `UsedOn.svelte`, `navigate.ts`, `target.svelte.ts` | **new.** Shared by the pages: the header, a card's head (id, name cut short, rename), "used on" chips, going to a use, the card opened from the address |
| `web/src/behaviours/TapDancePage.svelte`, `TapDanceCard.svelte` | **new.** The Tap dance page |
| `web/src/behaviours/CombosPage.svelte`, `ComboCard.svelte`, `ComboKeys.svelte` | **new.** The Combos page; the small keyboard that shows a combo's keys or chooses them |
| `web/src/behaviours/MacrosPage.svelte`, `MacroCard.svelte`, `MacroEditor.svelte`, `StepChain.svelte`, `MemoryBar.svelte` | **new.** The Macros page: steps as a chain, the step editor and recorder, the memory bar |
| `web/src/shell/UnlockDialog.svelte`, `TopBar.svelte` | **new:** the unlock dialog. The top bar's Lock/Unlock control |
| `web/src/App.svelte` | the router, the analysis for every page, the sections with counts, the pages, the unlock dialog and banner |
| `web/e2e/behaviours.spec.ts`, `fixtures.ts`, `overview.spec.ts` | **new:** e2e for the pages and the unlock. Fixtures for tap dances, macros and the unlock hook; the Overview test checks the combo colours |
| `web/README.md` | the unlock keys and the test hook; `src/behaviours/` |
| `docs/superpowers/plans/2026-10-17-phase3-overview-analysis.md` | trailing whitespace removed |

## Decisions

These come from the verified prototype. The owner may want to review them.

1. **The unlock mirrors Qt's unlocker** (`src/main/python/unlocker.py`):
   - `unlock_start`, then `unlock_poll` every 200 ms (`UNLOCK_POLL_INTERVAL`);
   - the bar shows the highest countdown seen, less what remains;
   - it is done when the reply's first byte is 1.

   Real firmware counts down at most once every 100 ms, so an unlock takes about 10 s. The simulator counts down once per poll.
2. **An interrupted unlock** is detected *before* `Keyboard.reload()`, through GET_KEYBOARD_ID and the unlock status, which the firmware answers while it waits.
   - Qt reloads first. The firmware answers that with echoes, so the reload would likely fail its protocol check (via_protocol 0).
   - The keyboard is kept open but not read. The server sends `unlock_start`, follows the countdown, and only then reads the keyboard ("connected").
   - The UI shows the dialog without a drawing then, and names the keys by their matrix positions.
3. **Cancel can't stop the firmware**, which keeps waiting and echoes every other request.
   - So "cancelled" is a state of its own. The server stops polling, `run()` refuses every change with 423, and a banner offers "Unlock".
   - Unplugging the keyboard also ends the wait.
4. **While the keyboard waits for its keys**, everything that does no I/O still works, through `manager.read()`: the model, names, the layout download and renaming. Everything else gets 423, "waiting for its unlock keys".
5. **Key presses do nothing while the dialog is open**, as in Qt. The unlock keys are on the keyboard in use, so held Enter or Space would otherwise press Cancel, and Escape may be one of them. Cancel therefore works with the pointer only. This is an accessibility trade-off for the owner to judge.
6. **The fake Corne starts unlocked**, since nobody can hold its keys in a manual `--fake` run. The e2e tests lock it through the hook.
7. **Combo colours:**
   - **Palette** (`--combo-0` to `--combo-5`: red, blue, teal, magenta, green, violet):
     - light: `#d0103a #1d5bd8 #00796b #b0168f #4c7d0a #7b3fe4`, at worst 4.02:1 on any key face;
     - dark: `#ff6685 #6aa8ff #2fd3c0 #f472d0 #a3d65a #b69bff`, at worst 3.17:1 (on the macro fill);
     - no amber or orange in either, so the find highlight stays unique.
   - **Assignment** (`comboColours`), greedy in combo order: each combo takes the first colour that no earlier combo sharing a layer with it has. When every colour is taken, combo number k (counting the set combos) gets colour `k % 6`.
   - **Marks** (`marks.ts`):
     - a key in one combo is underlined in its colour;
     - a key in several gets one dot per combo, `max(4px, 0.11u)` wide with a gap of 0.6 dot, centred along the bottom edge;
     - when the dots don't fit, as many as fit come before "+n".
   - The marks keep their own space at the bottom of the key, so a legend never covers them.
   - Aria labels say " · in combo 0" or " · in combos 0 and 2", so colour is never the only cue.
8. **Hash routing:** `#keymap`, `#tap-dance`, `#combos`, `#macros`, with an optional `/n` that opens and focuses a card. A reload stays on the page, and the back button goes back.
9. **Record from keyboard** (the roadmap's open decision: yes, browser-only):
   - Capture-phase window listeners, only while recording.
   - A character becomes text only when the US layout types it with that physical key (and Shift). Otherwise the physical key is tapped, wrapped in its modifiers (`LCTL(KC_L)`; `RALT(KC_A)` for AltGr, without the Ctrl that Windows adds). So a German "z" replays correctly.
   - Not recorded: a modifier pressed alone, auto-repeat, waits, and unknown keys (they are counted and reported).
   - Esc or the Stop button ends a recording.
10. **Macro sizes** (`macro.ts`, as `macro/macro_action.py` encodes them):
    - text: 1 byte a character;
    - a key action: a prefix byte (protocol 2 or later), the action byte, then 1 byte for a keycode under 256 or 2 bytes otherwise;
    - a delay: 4 bytes;
    - plus a 0 byte that ends each macro.

    The bar turns amber at 85 % and red past full, with "Needs N bytes, but the keyboard has M". Save is then disabled, and the server still refuses with byte counts.
11. **List pages show** the entries that are set up or used, plus those opened (with a "New …" button, or from a link), and say how many are free.

## Out of scope / later phases

- **Recorded waits.** "Record from keyboard" records no delays; a wait is added by hand.
- **Key overrides and alt-repeat keys have no pages** (phase 5). In "used on" lists their chips are plain text.
- **The Overview's "Not used" notes** don't link to the cards yet.
- **No e2e test for an unlock interrupted at startup:** it needs a server started in that state. pytest covers it (`test_unlock.py`).
- **Read the definition during an interrupted unlock.** `Keyboard.reload()` can't read only the definition while an unlock waits. A `reload_layout` without the VIA protocol check would let the dialog draw the keyboard then, instead of naming matrix positions.
- **`KeyboardModel.unlocked` duplicates `Session.unlock`.** The UI uses the session's; the model's field could go.
- **`Event.unlock` typing.** openapi-typescript makes every field with a default required (`unlock: UnlockState | null`), so the UI's event type claims `unlock` is always there. `events.ts` checks it instead.
- **`Described.value` exists only for the macro sizes.** A `POST /api/macros/size` would keep the encoding in one place, at the cost of a round trip on every keystroke.
- **The unlock e2e tests are slow,** about 12 s each: the simulated Corne counts down from 50 at 200 ms.
- **Older screenshots don't scroll to the top.** A full-page screenshot draws the sticky top bar where the page was scrolled to. The phase 4 tests scroll to the top first; the phase 3 ones don't.

---

### Task 1: The simulated keyboard counts down while its unlock keys are held

Vial firmware unlocks only after the user has held every unlock key through a countdown (`VIAL_UNLOCK_COUNTER_MAX`, 50): each `UNLOCK_POLL` with all the keys held counts down by one, and letting go of one starts it again. The simulator unlocked on the first poll with the keys held. Now it counts down as the firmware does, so the server's unlock flow can be tested:
- `VirtualKeyboard(unlock_counter_max=50)` sets where the countdown starts; it must be 1 or more.
- `hold_unlock_keys(held)` presses or lets go of every unlock key.
- The simulated Corne gets `UNLOCK_KEYS`: Tab (row 0, column 0) and Backspace (row 4, column 0), the outermost keys of both top rows. It still starts unlocked, as nobody can hold its keys in a manual `--fake` run.

**Files:**
- Modify: `src/main/python/simulator/virtual_keyboard.py`, `src/main/python/simulator/corne.py`
- Test: `src/main/python/test/test_simulator.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_simulator.py`:

```diff
diff --git a/src/main/python/test/test_simulator.py b/src/main/python/test/test_simulator.py
--- a/src/main/python/test/test_simulator.py
+++ b/src/main/python/test/test_simulator.py
@@ -243,21 +243,44 @@ def test_unlock_poll_needs_unlock_start(locked):
     assert kb.get_unlock_status() == 0
     kb.unlock_start()
     assert kb.get_unlock_in_progress() == 1
-    assert kb.unlock_poll()[0:2] == b"\x01\x00"
+    vk.hold_unlock_keys(True)
+    for remaining in range(49, 0, -1):
+        assert kb.unlock_poll()[0:3] == bytes([0, 1, remaining])
+    assert kb.unlock_poll()[0:3] == bytes([1, 0, 0])
     assert kb.get_unlock_status() == 1


-def test_unlock_needs_the_unlock_keys_held():
-    vk = VirtualKeyboard(TINY, unlocked=False, unlock_keys=[(0, 0), (0, 1)])
+def test_without_unlock_keys_every_poll_counts_down():
+    vk = VirtualKeyboard(TINY, unlocked=False, unlock_counter_max=2)
+    kb = Keyboard(SimulatedHidDevice(vk))
+    kb.reload()
+    kb.unlock_start()
+    assert [kb.unlock_poll()[0:3] for _ in range(2)] == [bytes([0, 1, 1]), bytes([1, 0, 0])]
+
+
+def test_unlock_counts_down_while_the_unlock_keys_are_held():
+    vk = VirtualKeyboard(TINY, unlocked=False, unlock_keys=[(0, 0), (0, 1)], unlock_counter_max=3)
     kb = Keyboard(SimulatedHidDevice(vk))
     kb.reload()
     assert kb.get_unlock_keys() == [(0, 0), (0, 1)]
     kb.unlock_start()
     vk.press(0, 0)
-    assert kb.unlock_poll()[0:3] == bytes([0, 1, 50])
+    assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
     vk.press(0, 1)
-    assert kb.unlock_poll()[0:3] == bytes([1, 0, 0])
+    assert kb.unlock_poll()[0:3] == bytes([0, 1, 2])
+    # letting go starts the countdown again
+    vk.release(0, 1)
+    assert kb.unlock_poll()[0:3] == bytes([0, 1, 3])
+    vk.hold_unlock_keys(True)
+    assert [kb.unlock_poll()[0:3] for _ in range(3)] == [bytes([0, 1, 2]), bytes([0, 1, 1]), bytes([1, 0, 0])]
     assert kb.get_unlock_status() == 1
+    vk.hold_unlock_keys(False)
+    assert vk.pressed == set()
+
+
+def test_unlock_countdown_starts_at_one_or_more():
+    with pytest.raises(SimulatorError):
+        VirtualKeyboard(TINY, unlock_counter_max=0)


 def test_unlock_in_progress_only_answers_unlock_and_identity_commands(locked):
@@ -267,7 +290,9 @@ def test_unlock_in_progress_only_answers_unlock_and_identity_commands(locked):
     assert send(vk, request) == request + b"\x00" * (MSG_LEN - len(request))
     assert vk.keymap[0][0][0] == encode("KC_TAB")
     assert kb.get_uid() == struct.pack("<Q", 0x5EEDC0DE00420042)
-    kb.unlock_poll()
+    vk.hold_unlock_keys(True)
+    while kb.unlock_poll()[1]:
+        pass
     kb.set_key(0, 0, 0, "KC_A")
     assert vk.keymap[0][0][0] == encode("KC_A")

```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py
```

Expected: `5 failed, 34 passed`: `hold_unlock_keys` and `unlock_counter_max` don't exist yet.

- [ ] **Step 3: The countdown, and the Corne's unlock keys**

Apply to `src/main/python/simulator/virtual_keyboard.py`:

```diff
diff --git a/src/main/python/simulator/virtual_keyboard.py b/src/main/python/simulator/virtual_keyboard.py
--- a/src/main/python/simulator/virtual_keyboard.py
+++ b/src/main/python/simulator/virtual_keyboard.py
@@ -29,7 +29,8 @@ from kle_serial import Serial as KleSerial
 from protocol.qmk_settings_codec import QmkSettingsCodec

 CMD_VIA_BOOTLOADER_JUMP = 0x0B
-# polls the firmware wants the unlock keys held for (VIAL_UNLOCK_COUNTER_MAX)
+# polls the firmware wants the unlock keys held for (VIAL_UNLOCK_COUNTER_MAX). The firmware counts down at most once
+# every 100 ms; the simulator counts down on every poll, so tests needn't wait.
 UNLOCK_COUNTER_MAX = 50
 # the firmware has room for this many unlock keys in the unlock status reply
 MAX_UNLOCK_KEYS = 15
@@ -53,7 +54,7 @@ class VirtualKeyboard:
     def __init__(self, definition, layers=4, keymap=None, uid=0xF00DFACEDEADBEEF, vial_protocol=6,
                  via_protocol=9, macro_count=8, macro_memory=512, macros=b"", tap_dance=None, combos=None,
                  key_overrides=None, alt_repeat_keys=None, settings=None, unlocked=True, unlock_keys=(),
-                 features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK):
+                 unlock_counter_max=UNLOCK_COUNTER_MAX, features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK):
         """
         definition: vial.json as a dict or JSON string
         keymap: optional {(layer, row, col): keycode}; unset keys are KC_NO
@@ -64,8 +65,9 @@ class VirtualKeyboard:
         alt_repeat_keys: list of 4-int tuples (keycode, alt_keycode, allowed_mods, options)
         settings: {qsid: int} of supported QMK settings; None means the firmware has no QMK settings
         unlocked: start unlocked; a locked keyboard refuses security-sensitive writes like Vial firmware does
-        unlock_keys: [(row, col)] the user must press() for UNLOCK_POLL to unlock; none means any poll after
-                     UNLOCK_START unlocks
+        unlock_keys: [(row, col)] the user must press(); every UNLOCK_POLL while all of them are held counts down by
+                     one, and the keyboard unlocks at zero. None: no key needs holding, the polls alone count down.
+        unlock_counter_max: where the countdown starts (VIAL_UNLOCK_COUNTER_MAX); a key let go starts it again
         """
         if isinstance(definition, str):
             definition = json.loads(definition)
@@ -104,7 +106,10 @@ class VirtualKeyboard:

         if len(unlock_keys) > MAX_UNLOCK_KEYS:
             raise SimulatorError("at most {} unlock keys fit into the unlock status".format(MAX_UNLOCK_KEYS))
+        if unlock_counter_max < 1:
+            raise SimulatorError("the unlock countdown must start at 1 or more")
         self.unlock_keys = list(unlock_keys)
+        self.unlock_counter_max = unlock_counter_max
         self.unlocked = unlocked
         self.unlock_in_progress = False
         self.unlock_counter = 0
@@ -131,6 +136,11 @@ class VirtualKeyboard:
     def release(self, row, col):
         self.pressed.discard((row, col))

+    def hold_unlock_keys(self, held):
+        """ The user presses (True) or lets go of (False) every unlock key """
+        for row, col in self.unlock_keys:
+            (self.press if held else self.release)(row, col)
+
     def macros(self):
         """ Macro buffer split into macro_count byte strings """
         return bytes(self.macro_buffer).split(b"\x00")[:self.macro_count]
@@ -333,15 +343,17 @@ class VirtualKeyboard:
             return bytes([int(self.unlocked), int(self.unlock_in_progress)]) + keys + b"\xFF" * (30 - len(keys))
         if sub == CMD_VIAL_UNLOCK_START:
             self.unlock_in_progress = True
-            self.unlock_counter = UNLOCK_COUNTER_MAX
+            self.unlock_counter = self.unlock_counter_max
             return b""
         if sub == CMD_VIAL_UNLOCK_POLL:
             if self.unlock_in_progress:
                 if all(rc in self.pressed for rc in self.unlock_keys):
-                    # the firmware counts down while the keys stay held; the simulated user holds them long enough
-                    self.unlocked, self.unlock_in_progress, self.unlock_counter = True, False, 0
+                    # counts down while every unlock key stays held
+                    self.unlock_counter -= 1
+                    if self.unlock_counter == 0:
+                        self.unlocked, self.unlock_in_progress = True, False
                 else:
-                    self.unlock_counter = UNLOCK_COUNTER_MAX
+                    self.unlock_counter = self.unlock_counter_max
             return bytes([int(self.unlocked), int(self.unlock_in_progress), self.unlock_counter])
         if sub == CMD_VIAL_LOCK:
             self.unlocked = False
```

Apply to `src/main/python/simulator/corne.py`:

```diff
diff --git a/src/main/python/simulator/corne.py b/src/main/python/simulator/corne.py
--- a/src/main/python/simulator/corne.py
+++ b/src/main/python/simulator/corne.py
@@ -14,6 +14,8 @@ LEFT = [[(r, c) for c in range(6)] for r in range(3)]
 RIGHT = [[(r + 4, 5 - c) for c in range(6)] for r in range(3)]
 LEFT_THUMBS = [(3, 3), (3, 4), (3, 5)]
 RIGHT_THUMBS = [(7, 5), (7, 4), (7, 3)]
+UNLOCK_KEYS = [LEFT[0][0], RIGHT[0][5]]
+""" held to unlock the keyboard: the outermost keys of both top rows (Tab and Backspace) """


 def definition():
@@ -147,5 +149,7 @@ def make_corne(layers=len(LAYERS)):
         # 22-24 are the separate Permissive Hold / Hold On Other Key Press / Retro Tapping settings. The legacy
         # bitfield (8) also has Permissive Hold and Retro Tapping bits, so it is left out to avoid showing them twice
         settings={2: 50, 7: 200, 22: 0, 23: 0, 24: 0, 25: 100},
+        # unlocked, as nobody can hold its keys; tests lock it to try the unlock
         unlocked=True,
+        unlock_keys=UNLOCK_KEYS,
     )
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py
```

Expected: `39 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `746 passed, 1 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/simulator/corne.py \
  src/main/python/simulator/virtual_keyboard.py \
  src/main/python/test/test_simulator.py
git commit -m "feat(simulator): the unlock countdown runs while the unlock keys are held; the Corne has unlock keys"
```

### Task 2: The device manager unlocks the keyboard, as Qt's unlocker does

`require_unlocked` refused every security-sensitive write (a macro, QK_BOOT) and pointed at the Qt app. The device manager now runs the unlock itself, all of it under the device lock:
- **`start_unlock()`** asks whether the keyboard is unlocked; if not, it reads the unlock keys and sends `unlock_start`. An unlocked keyboard is left alone.
- **`poll_unlock()`** sends one `unlock_poll` and keeps the countdown (`remaining`, and `total`, the highest seen). When the firmware says it is unlocked (or no longer waiting), the unlock is over.
- **`cancel_unlock()`** stops following. The firmware can't be told to stop waiting, so the state becomes "cancelled": the keyboard takes no changes until it is unlocked (`start_unlock()` again) or plugged in again.
- **`lock_keyboard()`** sends `lock`; **`read_unlocked()`** asks the keyboard again (it may have been locked meanwhile).
- **`unlock_state()`** returns an `UnlockState`: "locked", "unlocking", "cancelled" or "unlocked", the keys to hold, and the countdown.
- **While the keyboard waits** it answers only its identity and unlock requests. So `run()` refuses everything with `KeyboardLocked` (423). The new `read()` still works for what only reads the loaded keyboard.
- **A write refused** as the keyboard is locked (`require_unlocked` raised) marks it locked.
- **An unlock interrupted earlier** (a Vial closed while the keyboard waited) is found on connect, *before* the keyboard is read:
  - `interrupted_unlock_keys()` asks GET_KEYBOARD_ID and the unlock status, which the firmware answers while it waits;
  - the keyboard is kept open but not read, and `unlock_start` is sent, as Qt does for every unlock;
  - once the countdown is over, the keyboard is read ("connected");
  - unplugging it meanwhile ends the unlock.
- **Events.** Each change of the unlock state (started, done, cancelled, locked) is an "unlock" event, collected with the others by `take_events()`. The countdown's readings are not events: the server sends them on (Task 3).
- `run()` now goes through `_io()`, which closes a keyboard that is gone.

**Files:**
- Modify: `src/main/python/server/device.py`
- Test: `src/main/python/test/test_unlock.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_unlock.py`:

```python
""" Unlocking the keyboard: the device manager follows the protocol as Qt's unlocker does, against the simulated Corne
(unlock keys: Tab at row 0 column 0, Backspace at row 4 column 0) """
import pytest

import transport
from protocol.keyboard_comm import Keyboard
from protocol.unlock_hook import request_unlock, set_unlock_handler
from server.device import DeviceManager, FakeBackend, KeyboardLocked, NotConnected, UnlockState, require_unlocked
from simulator.corne import UNLOCK_KEYS, make_corne
from simulator.device import SimulatedHidDevice

COUNTDOWN = 3
""" the simulated keyboards here count down from 3, so that a few polls unlock them """
KEYS = tuple(UNLOCK_KEYS)


def locked_corne(**kwargs):
    vk = make_corne(**kwargs)
    vk.unlocked = False
    vk.unlock_counter_max = COUNTDOWN
    return vk


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


@pytest.fixture
def manager():
    m = DeviceManager(FakeBackend(locked_corne))
    assert m.connect()
    m.take_events()
    return m


def virtual(manager):
    return manager.backend.virtual


def write_macro(kb):
    """ A macro change, as the API makes it: the protocol asks for the keyboard to be unlocked first """
    request_unlock(kb)
    kb.set_macro(b"hi\x00" + b"\x00" * 15)


# ---------- device manager ----------

def test_a_locked_keyboard_is_reported_locked(manager):
    assert not manager.unlocked
    assert manager.unlock_state() == UnlockState("locked")


def test_start_sends_unlock_start_and_names_the_keys(manager):
    state = manager.start_unlock()
    assert state == UnlockState("unlocking", KEYS)
    assert virtual(manager).unlock_in_progress
    assert manager.take_events() == ["unlock"]


def test_the_countdown_runs_while_the_keys_are_held(manager):
    manager.start_unlock()
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN, COUNTDOWN)  # not held: starts over
    virtual(manager).hold_unlock_keys(True)
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN - 1, COUNTDOWN)
    virtual(manager).release(*KEYS[0])
    assert manager.poll_unlock() == UnlockState("unlocking", KEYS, COUNTDOWN, COUNTDOWN)
    assert manager.take_events() == ["unlock"]  # the start; readings of the countdown aren't events


def test_holding_the_keys_until_the_end_unlocks(manager):
    manager.start_unlock()
    virtual(manager).hold_unlock_keys(True)
    states = [manager.poll_unlock().state for _ in range(COUNTDOWN)]
    assert states == ["unlocking"] * (COUNTDOWN - 1) + ["unlocked"]
    assert manager.unlocked and virtual(manager).unlocked
    assert manager.status().unlocked
    assert manager.take_events() == ["unlock", "unlock"]
    # the writes that needed it go through now
    manager.run(write_macro)
    assert virtual(manager).macros()[0] == b"hi"


def test_an_unlocked_keyboard_is_left_alone():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    assert m.start_unlock() == UnlockState("unlocked")
    assert not m.backend.virtual.unlock_in_progress
    assert m.take_events() == []


def test_while_unlocking_the_keyboard_takes_no_requests_but_can_be_read(manager):
    manager.start_unlock()
    with pytest.raises(KeyboardLocked, match="waiting for its unlock keys"):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_A"))
    assert manager.read(lambda kb: kb.layout[(0, 0, 0)]) == "KC_TAB"


def test_cancel_stops_following_but_the_keyboard_keeps_waiting(manager):
    manager.start_unlock()
    assert manager.cancel_unlock() == UnlockState("cancelled", KEYS)
    assert virtual(manager).unlock_in_progress
    virtual(manager).hold_unlock_keys(True)
    assert manager.poll_unlock().state == "cancelled"  # not followed: nothing is sent
    assert virtual(manager).unlock_counter == COUNTDOWN
    with pytest.raises(KeyboardLocked):
        manager.run(write_macro)
    assert manager.take_events() == ["unlock", "unlock"]
    # started again, it counts down from the top
    assert manager.start_unlock().state == "unlocking"
    assert [manager.poll_unlock().state for _ in range(COUNTDOWN)][-1] == "unlocked"


def test_lock(manager):
    manager.start_unlock()
    virtual(manager).hold_unlock_keys(True)
    for _ in range(COUNTDOWN):
        manager.poll_unlock()
    manager.take_events()
    assert manager.lock_keyboard() == UnlockState("locked")
    assert not virtual(manager).unlocked and not manager.unlocked
    assert manager.take_events() == ["unlock"]


def test_lock_waits_until_an_unlock_is_over(manager):
    manager.start_unlock()
    with pytest.raises(KeyboardLocked):
        manager.lock_keyboard()


def test_a_write_refused_while_locked_reports_the_keyboard_locked():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    assert m.unlocked
    m.backend.virtual.unlocked = False  # locked behind Vial's back (plugged in again, in reality)
    with pytest.raises(KeyboardLocked):
        m.run(write_macro)
    assert m.unlock_state() == UnlockState("locked")
    assert m.take_events() == ["unlock"]


def test_read_unlocked_follows_the_keyboard():
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    m.backend.virtual.unlocked = False
    assert m.read_unlocked() == UnlockState("locked")
    assert m.take_events() == ["unlock"]
    assert m.read_unlocked() == UnlockState("locked")
    assert m.take_events() == []


def interrupted_corne():
    """ A locked Corne still waiting for an unlock started by a Vial that was closed meanwhile """
    vk = locked_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    kb.unlock_start()
    assert vk.unlock_in_progress
    return vk


def test_an_interrupted_unlock_is_finished_on_connect_before_the_keyboard_is_read():
    m = DeviceManager(FakeBackend(interrupted_corne))
    assert not m.connect()
    assert not m.connected and m.status().title == "Simulated: Simulated Corne"
    assert m.unlock_state() == UnlockState("unlocking", KEYS)
    assert m.take_events() == ["unlock"]
    with pytest.raises(NotConnected):
        m.run(lambda kb: None)
    assert m.check() == []  # the hot-plug poll leaves it to the unlock

    m.backend.virtual.hold_unlock_keys(True)
    states = [m.poll_unlock().state for _ in range(COUNTDOWN)]
    assert states[-1] == "unlocked"
    assert m.connected and m.unlocked
    assert m.take_events() == ["unlock", "connected"]
    assert m.run(lambda kb: kb.layout[(0, 0, 0)]) == "KC_TAB"


def test_unplugging_a_keyboard_that_waits_for_its_unlock_ends_it():
    m = DeviceManager(FakeBackend(interrupted_corne))
    m.connect()
    m.take_events()
    m.backend.virtual.connected = False
    assert m.check() == ["unlock"]
    assert m.unlock_state() == UnlockState("locked")
    assert m.status().title is None
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_unlock.py
```

Expected: `cannot import name 'UnlockState' from 'server.device'` and `1 error`: `server.device` has no `UnlockState` yet.

- [ ] **Step 3: The unlock in the device manager**

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -1,10 +1,13 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
 """ Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
 import logging
+import struct
 import threading
 import time
 from collections import namedtuple
+from dataclasses import dataclass

+from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID
 from protocol.keyboard_comm import Keyboard
 from simulator.device import SimulatedHidDevice

@@ -33,12 +36,50 @@ class DeviceIOError(RuntimeError):


 def require_unlocked(keyboard):
-    """ Unlock handler for the server: the web UI can't run the unlock flow yet, so refuse instead """
+    """ Unlock handler for the server (protocol.unlock_hook). The protocol calls it before a security-sensitive write
+    (a macro, QK_BOOT). Unlocking needs the user to hold keys, which the UI asks for, so a locked keyboard refuses the
+    write (KeyboardLocked, 423): the UI then unlocks it (POST /api/unlock/start) and sends the change again. """
     if keyboard.get_unlock_status() != 1:
-        raise KeyboardLocked("the keyboard is locked; unlock it in the Qt app to change security-sensitive keys")
+        raise KeyboardLocked("the keyboard is locked: unlock it to make this change")
     return True


+def interrupted_unlock_keys(keyboard):
+    """ The unlock keys, if the keyboard is still waiting for an unlock started earlier (by a Vial closed meanwhile),
+    else None. Asked before anything else is read: while it waits, the keyboard answers only its identity and unlock
+    requests, and sends every other request back unanswered. """
+    data = keyboard.usb_send(keyboard.dev, struct.pack("BB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID),
+                             retries=20)
+    # what the unlock requests check, as Keyboard.reload_layout sets it
+    keyboard.vial_protocol = struct.unpack("<I", data[0:4])[0]
+    return keyboard.get_unlock_keys() if keyboard.get_unlock_in_progress() else None
+
+
+@dataclass(frozen=True)
+class UnlockState:
+    """ Whether the keyboard is unlocked, and how far an unlock has got (schemas.UnlockState) """
+    state: str
+    """ "locked", "unlocking", "cancelled" (no longer followed, but the keyboard still waits for its keys) or
+    "unlocked" """
+    keys: tuple = ()
+    """ (row, col) of each key to hold, while unlocking or cancelled """
+    remaining: int = 0
+    """ the keyboard's countdown: polls with every key held that it still wants (0 before the first poll) """
+    total: int = 0
+    """ where the countdown started: the highest it was seen at """
+
+
+@dataclass
+class _Unlock:
+    """ An unlock the keyboard is waiting for: it takes no other request until it is unlocked or plugged in again """
+    keys: list
+    remaining: int = 0
+    total: int = 0
+    following: bool = True
+    """ polled (unlock_poll) until done; False once cancelled """
+
+
+
 class CheckedDevice:
     """
     Wraps an open HID handle for the protocol layer.
@@ -150,7 +191,7 @@ def candidate_key(candidate):

 class DeviceManager:
     """
-    Owns the open keyboard. All access goes through run() (or reload()), which hold the device lock.
+    Owns the open keyboard. All access goes through run() or read() (or reload()), which hold the device lock.

     check() is the hot-plug poll (about once a second) and the one place where the connection is repaired:
     - an unplugged keyboard is closed ("disconnected");
@@ -161,6 +202,14 @@ class DeviceManager:
     - a keyboard whose presence can't be checked (the backend raises) is kept as it is;
     - with no keyboard, the first one found is opened and loaded ("connected"). One that fails to load is not tried
       again for RETRY_FIRST seconds, doubling up to RETRY_MAX, unless it is unplugged and plugged back in.
+
+    Unlocking works as Qt's unlocker does: start_unlock() sends unlock_start, then poll_unlock() (called about every
+    200 ms while the state is "unlocking") reads the keyboard's countdown, which runs while the user holds the unlock
+    keys, until it is unlocked. While the keyboard waits for its unlock keys it answers nothing else, so run() refuses
+    every request then (KeyboardLocked); read() still works. A keyboard found waiting for an unlock started earlier (by
+    a Vial closed meanwhile) is opened but not read: that unlock is finished first, as Qt does, then the keyboard is
+    read ("connected"). The unlock state changing (started, done, cancelled, locked) is an "unlock" event; the readings
+    of the countdown are not events, whoever follows the unlock (the server app) sends them on.
     """

     def __init__(self, backend, clock=time.monotonic):
@@ -174,6 +223,10 @@ class DeviceManager:
         self.title = None
         self.error = None
         self.unlocked = False
+        self.unlocking = None
+        """ _Unlock while the keyboard waits for its unlock keys """
+        self.waiting = None
+        """ the Keyboard opened but not read yet, while an unlock started earlier is finished first """
         self.pending_events = []
         self.failures = {}
         """ candidate key -> (failed attempts, clock time of the next attempt) """
@@ -212,12 +265,17 @@ class DeviceManager:
                 if wait_after_failures and key in self.failures and self.clock() < self.failures[key][1]:
                     continue
                 dev = None
+                unlocked = False
                 try:
                     dev, title = self.backend.open(candidate)
                     handle = CheckedDevice(dev)
                     keyboard = Keyboard(handle)
-                    keyboard.reload()
-                    unlocked = keyboard.get_unlock_status() == 1
+                    unlock_keys = interrupted_unlock_keys(keyboard)
+                    if unlock_keys is not None:
+                        keyboard.unlock_start()  # as Qt's unlocker does for every unlock
+                    else:
+                        keyboard.reload()
+                        unlocked = keyboard.get_unlock_status() == 1
                 except Exception as e:
                     log.warning("could not load keyboard %s: %s", candidate, e)
                     self.error = str(e) or e.__class__.__name__
@@ -226,9 +284,14 @@ class DeviceManager:
                         self._close_device(dev)
                     continue
                 self.failures.pop(key, None)
-                self.keyboard, self.device, self.handle = keyboard, dev, handle
-                self.candidate, self.title = candidate, title
-                self.unlocked, self.error = unlocked, None
+                self.device, self.handle, self.candidate, self.title, self.error = dev, handle, candidate, title, None
+                if unlock_keys is not None:
+                    log.info("%s is waiting to be unlocked: finishing that before reading it", title)
+                    self.waiting = keyboard
+                    self.unlocking = _Unlock(unlock_keys)
+                    self.pending_events.append("unlock")
+                    return False
+                self.keyboard, self.unlocked = keyboard, unlocked
                 log.info("connected to %s", title)
                 return True
             return False
@@ -247,7 +310,7 @@ class DeviceManager:
         with self.lock:
             try:
                 self.run(do_reload)
-            except NotConnected:
+            except (NotConnected, KeyboardLocked):
                 raise
             except Exception as e:
                 log.warning("could not reload the keyboard: %s", e)
@@ -257,39 +320,169 @@ class DeviceManager:
                 raise

     def run(self, fn):
-        """ Call fn(keyboard) while holding the device lock """
+        """ Call fn(keyboard) while holding the device lock. Refused while the keyboard waits for its unlock keys. """
         with self.lock:
             if self.keyboard is None:
                 raise NotConnected("no keyboard connected")
+            if self.unlocking is not None:
+                raise KeyboardLocked("the keyboard is waiting for its unlock keys: it takes no changes until it is "
+                                     "unlocked")
             try:
-                return fn(self.keyboard)
-            except (OSError, RuntimeError) as e:
-                if isinstance(e, (NotConnected, KeyboardLocked)) or self._present() is not False:
-                    # still plugged in (or the backend can't tell): if the handle itself stopped working, later
-                    # requests fail at once until check() reopens it
-                    if self.handle is not None and not self.handle.healthy:
-                        self.handle.broken = True
-                    raise
-                self._close()
-                self.pending_events.append("disconnected")
-                raise NotConnected("keyboard disconnected") from e
+                return self._io(self.keyboard, fn)
+            except KeyboardLocked:
+                # the unlock handler found it locked
+                if self.unlocked:
+                    self.unlocked = False
+                    self.pending_events.append("unlock")
+                raise
+
+    def read(self, fn):
+        """ Call fn(keyboard) while holding the device lock, for what only reads what was loaded (no device I/O): it
+        works while the keyboard waits for its unlock keys too """
+        with self.lock:
+            if self.keyboard is None:
+                raise NotConnected("no keyboard connected")
+            return fn(self.keyboard)
+
+    def _io(self, keyboard, fn):
+        """ fn(keyboard), the lock held; a failure that means the keyboard is gone closes it (NotConnected) """
+        try:
+            return fn(keyboard)
+        except (OSError, RuntimeError) as e:
+            if isinstance(e, (NotConnected, KeyboardLocked)) or self._present() is not False:
+                # still plugged in (or the backend can't tell): if the handle itself stopped working, later
+                # requests fail at once until check() reopens it
+                if self.handle is not None and not self.handle.healthy:
+                    self.handle.broken = True
+                raise
+            self._close_reporting()
+            raise NotConnected("keyboard disconnected") from e
+
+    # ---------- unlocking ----------
+
+    def unlock_state(self):
+        """ UnlockState of the keyboard """
+        with self.lock:
+            u = self.unlocking
+            if u is not None:
+                return UnlockState("unlocking" if u.following else "cancelled", tuple(u.keys), u.remaining, u.total)
+            return UnlockState("unlocked" if self.unlocked else "locked")
+
+    def _unlock_target(self):
+        """ The keyboard an unlock talks to: the loaded one, or one waiting to be read until it is unlocked """
+        keyboard = self.keyboard or self.waiting
+        if keyboard is None:
+            raise NotConnected("no keyboard connected")
+        return keyboard
+
+    def start_unlock(self):
+        """ Start unlocking as Qt's unlocker does: unlock_start, after which poll_unlock() follows the countdown. A
+        cancelled unlock is followed again (the keyboard starts its countdown over). An unlocked keyboard is left
+        alone. Returns unlock_state(). """
+        with self.lock:
+            keyboard = self._unlock_target()
+            if self.unlocking is None:
+                if self._io(keyboard, lambda kb: kb.get_unlock_status()) == 1:
+                    self.unlocked = True
+                    return self.unlock_state()
+                keys = self._io(keyboard, lambda kb: kb.get_unlock_keys())
+            else:
+                keys = self.unlocking.keys
+            self._io(keyboard, lambda kb: kb.unlock_start())
+            self.unlocking = _Unlock(keys)
+            self.pending_events.append("unlock")
+            return self.unlock_state()
+
+    def poll_unlock(self):
+        """ One poll of the unlock being followed: the keyboard counts down while every unlock key is held, and starts
+        again when one is let go. Once it is unlocked, a keyboard that waited for that is read ("connected").
+        Returns unlock_state(). """
+        with self.lock:
+            u = self.unlocking
+            if u is None or not u.following:
+                return self.unlock_state()
+            data = self._io(self._unlock_target(), lambda kb: kb.unlock_poll())
+            unlocked, in_progress, counter = data[0], data[1], data[2]
+            u.remaining, u.total = counter, max(u.total, counter)
+            if unlocked == 1 or not in_progress:
+                self.unlocking = None
+                self.unlocked = unlocked == 1
+                self.pending_events.append("unlock")
+                if self.waiting is not None:
+                    self._read_waiting()
+            return self.unlock_state()
+
+    def _read_waiting(self):
+        """ Read the keyboard that waited for its unlock, now that it answers again """
+        keyboard, self.waiting = self.waiting, None
+        try:
+            keyboard.reload()
+        except Exception as e:
+            log.warning("could not load keyboard %s: %s", self.candidate, e)
+            self._failed(candidate_key(self.candidate))
+            self._close()
+            self.error = str(e) or e.__class__.__name__
+            return
+        self.keyboard = keyboard
+        log.info("connected to %s", self.title)
+        self.pending_events.append("connected")
+
+    def cancel_unlock(self):
+        """ Stop following the unlock. The keyboard can't be told to stop waiting for its unlock keys: it takes no
+        changes until it is unlocked (start_unlock again) or plugged in again. Returns unlock_state(). """
+        with self.lock:
+            if self.unlocking is not None and self.unlocking.following:
+                self.unlocking.following = False
+                self.pending_events.append("unlock")
+            return self.unlock_state()
+
+    def lock_keyboard(self):
+        """ Lock the keyboard again (Qt's Security > Lock). Returns unlock_state(). """
+        with self.lock:
+            def lock(kb):
+                kb.lock()
+                return kb.get_unlock_status() == 1
+            self.unlocked = self.run(lock)
+            self.pending_events.append("unlock")
+            return self.unlock_state()
+
+    def read_unlocked(self):
+        """ Ask the keyboard whether it is unlocked: it may have been locked meanwhile. Returns unlock_state(). """
+        with self.lock:
+            unlocked = self.run(lambda kb: kb.get_unlock_status()) == 1
+            if unlocked != self.unlocked:
+                self.unlocked = unlocked
+                self.pending_events.append("unlock")
+            return self.unlock_state()
+
+    # ---------- hot-plug ----------

     def check(self):
         """ Hot-plug poll, called about once a second. Returns the events since the last call. """
         with self.lock:
-            if self.keyboard is not None:
+            if self.device is not None:
                 if self._present() is False:
-                    self._close()
-                    self.pending_events.append("disconnected")
+                    self._close_reporting()
                 elif not self.handle.healthy:
                     log.warning("%s stopped answering; reopening it", self.title)
-                    self._close()
-                    self.pending_events.append("disconnected")
-            if self.keyboard is None and self._connect(wait_after_failures=True):
+                    self._close_reporting()
+            if self.device is None and self._connect(wait_after_failures=True):
                 self.pending_events.append("connected")
+            return self.take_events()
+
+    def take_events(self):
+        """ The events since the last call, in order: "connected", "disconnected", "unlock" """
+        with self.lock:
             events, self.pending_events = self.pending_events, []
             return events

+    def _close_reporting(self):
+        """ Close the keyboard, with the event that says so: "disconnected" for a loaded one; "unlock" for one that
+        waited for its unlock (the UI never had it), whose unlock is over """
+        was_loaded = self.keyboard is not None
+        self._close()
+        self.pending_events.append("disconnected" if was_loaded else "unlock")
+
     def _present(self):
         """ Whether the open keyboard is still plugged in, or None when the backend can't tell (it raised). Unknown
         keeps the keyboard: treating it as unplugged would close and reload it on every poll while it works. An
@@ -318,5 +511,8 @@ class DeviceManager:
     def _close(self):
         if self.device is not None:
             self._close_device(self.device)
-        self.keyboard = self.device = self.handle = self.candidate = self.title = None
+        self.keyboard = self.device = self.handle = self.candidate = self.title = self.waiting = None
+        self.unlocking = None
         self.unlocked = False
+
+
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_unlock.py test/test_device_manager.py
```

Expected: `37 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `759 passed, 1 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/device.py \
  src/main/python/test/test_unlock.py
git commit -m "feat(server): the device manager unlocks the keyboard as Qt's unlocker does"
```

### Task 3: Unlock routes, events and the fake-only hook

The server lets the UI run the unlock:
- **Routes.** `POST /api/unlock/start`, `POST /api/unlock/cancel` and `POST /api/lock` each return the `UnlockState`.
- **Following the countdown.** While the state is "unlocking", a task reads it every `UNLOCK_POLL_INTERVAL` (0.2 s, as Qt's unlocker). The interval can be changed for tests (`create_app(unlock_interval=…)`). An unlock found on connect, or started from another tab, is followed too.
- **Events.** `unlock` events carry the state (`Event.unlock`): at every change, and with each reading of the countdown. `GET /api/session` carries `unlock` too.
- **Reads while waiting.** The model, the names, renaming and the layout download use `read()`, so they work while the keyboard waits for its keys.
- **The fake-only hook** `PUT /api/simulator/unlock {keysHeld?, locked?}` holds the simulated unlock keys (or lets go), or locks the keyboard, for the e2e tests. Like `PUT /api/simulator/connection`, it exists only with `--fake` and is left out of the schema.
- **Schema.** `Event`'s `$defs` are hoisted into the components, so the generated TypeScript has no `$defs`.

In the browser, events become objects (`{ type, unlock }`), and an `unlock` event must carry the state. The store ignores `unlock` events until Task 8 gives it the unlock state.

**Files:**
- Modify: `src/main/python/server/schemas.py`, `src/main/python/server/app.py`, `web/src/api/events.ts`, `web/src/api/types.ts`, `web/src/lib/keyboard.svelte.ts`
- Test: `src/main/python/test/test_unlock.py`, `src/main/python/test/test_api.py`, `src/main/python/test/test_dump_openapi.py`, `web/src/api/events.test.ts`, `web/src/lib/keyboard.test.ts`
- Generated: `web/src/api/schema.d.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_unlock.py`:

```diff
diff --git a/src/main/python/test/test_unlock.py b/src/main/python/test/test_unlock.py
--- a/src/main/python/test/test_unlock.py
+++ b/src/main/python/test/test_unlock.py
@@ -1,17 +1,23 @@
-""" Unlocking the keyboard: the device manager follows the protocol as Qt's unlocker does, against the simulated Corne
-(unlock keys: Tab at row 0 column 0, Backspace at row 4 column 0) """
+""" Unlocking the keyboard: the device manager follows the protocol as Qt's unlocker does, and the API lets the UI run
+it, against the simulated Corne (unlock keys: Tab at row 0 column 0, Backspace at row 4 column 0) """
 import pytest
+from fastapi.testclient import TestClient

 import transport
 from protocol.keyboard_comm import Keyboard
 from protocol.unlock_hook import request_unlock, set_unlock_handler
+from server.app import create_app
 from server.device import DeviceManager, FakeBackend, KeyboardLocked, NotConnected, UnlockState, require_unlocked
+from server.names import NamesStore
 from simulator.corne import UNLOCK_KEYS, make_corne
 from simulator.device import SimulatedHidDevice
+from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN
+from test.test_api_server import wait_until

 COUNTDOWN = 3
 """ the simulated keyboards here count down from 3, so that a few polls unlock them """
 KEYS = tuple(UNLOCK_KEYS)
+STEPS = [{"type": "text", "text": "hi"}]


 def locked_corne(**kwargs):
@@ -188,3 +194,109 @@ def test_unplugging_a_keyboard_that_waits_for_its_unlock_ends_it():
     assert m.check() == ["unlock"]
     assert m.unlock_state() == UnlockState("locked")
     assert m.status().title is None
+
+
+# ---------- API ----------
+
+@pytest.fixture
+def api(tmp_path):
+    """ (client with a session cookie, manager) of a locked Corne; the countdown is read every 10 ms """
+    manager = DeviceManager(FakeBackend(locked_corne))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     unlock_interval=0.01)
+    with TestClient(app, base_url=BASE) as client:
+        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
+        yield client, manager
+
+
+def unlock_events(ws, until):
+    """ The "unlock" events up to the first whose state is `until` """
+    seen = []
+    while True:
+        event = ws.receive_json()
+        if event["type"] != "unlock":
+            continue
+        seen.append(event["unlock"])
+        if event["unlock"]["state"] == until:
+            return seen
+
+
+def test_session_and_model_say_whether_the_keyboard_is_unlocked(api):
+    client, manager = api
+    assert client.get("/api/session").json()["unlock"] == {"state": "locked", "keys": [], "remaining": 0, "total": 0}
+    assert client.get("/api/keyboard").json()["unlocked"] is False
+
+
+def test_a_macro_change_is_refused_while_locked_then_saved_once_unlocked(api):
+    client, manager = api
+    body = {"items": [STEPS] + [[]] * 15}
+    refused = client.put("/api/macros", json=body)
+    assert refused.status_code == 423
+    assert refused.json()["detail"] == "the keyboard is locked: unlock it to make this change"
+
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        assert ws.receive_json() == {"type": "connected"}
+        started = client.post("/api/unlock/start").json()
+        assert started == {"state": "unlocking", "keys": [{"row": 0, "col": 0}, {"row": 4, "col": 0}],
+                           "remaining": 0, "total": 0}
+        # the countdown is read until the keys are held all through it
+        progress = unlock_events(ws, "unlocking")
+        assert progress[0]["state"] == "unlocking"
+        assert client.put("/api/macros", json=body).status_code == 423  # still waiting
+        manager.backend.virtual.hold_unlock_keys(True)
+        states = unlock_events(ws, "unlocked")
+        assert [s["remaining"] for s in states if s["state"] == "unlocking" and s["remaining"] < COUNTDOWN]
+        assert states[-1] == {"state": "unlocked", "keys": [], "remaining": 0, "total": 0}
+
+    assert client.get("/api/session").json()["unlock"]["state"] == "unlocked"
+    saved = client.put("/api/macros", json=body)
+    assert saved.status_code == 200
+    assert saved.json()["items"][0]["actions"] == [{"type": "text", "text": "hi", "keys": [], "delay": None}]
+
+
+def test_cancel_and_lock(api):
+    client, manager = api
+    client.post("/api/unlock/start")
+    assert client.post("/api/unlock/cancel").json()["state"] == "cancelled"
+    manager.backend.virtual.hold_unlock_keys(True)
+    assert manager.backend.virtual.unlock_counter == COUNTDOWN  # nothing reads the countdown any more
+    assert client.post("/api/lock").status_code == 423  # the keyboard still waits for its unlock keys
+    # started again and finished
+    assert client.post("/api/unlock/start").json()["state"] == "unlocking"
+    assert wait_until(lambda: client.get("/api/session").json()["unlock"]["state"] == "unlocked")
+    assert client.post("/api/lock").json() == {"state": "locked", "keys": [], "remaining": 0, "total": 0}
+    assert not manager.backend.virtual.unlocked
+
+
+def test_the_simulator_hook_holds_the_keys_and_locks_the_keyboard(tmp_path):
+    manager = DeviceManager(FakeBackend(lambda: make_corne()))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     unlock_interval=0.01)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        assert client.get("/api/session").json()["unlock"]["state"] == "unlocked"
+        assert client.put("/api/simulator/unlock", json={"locked": True}).json()["state"] == "locked"
+        assert not manager.unlocked
+        assert client.put("/api/simulator/unlock", json={"keysHeld": True}).status_code == 200
+        assert manager.backend.virtual.pressed == set(UNLOCK_KEYS)
+        client.post("/api/unlock/start")
+        assert wait_until(lambda: client.get("/api/session").json()["unlock"]["state"] == "unlocked", timeout=5)
+        client.put("/api/simulator/unlock", json={"keysHeld": False})
+        assert manager.backend.virtual.pressed == set()
+
+
+def test_an_interrupted_unlock_is_followed_from_the_start(tmp_path):
+    manager = DeviceManager(FakeBackend(interrupted_corne))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     unlock_interval=0.01)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        session = client.get("/api/session").json()
+        assert (session["status"], session["unlock"]["state"]) == ("disconnected", "unlocking")
+        assert client.get("/api/keyboard").status_code == 503
+        manager.backend.virtual.hold_unlock_keys(True)
+        assert wait_until(lambda: client.get("/api/session").json()["status"] == "connected")
+        assert client.get("/api/keyboard").json()["unlocked"] is True
```

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -117,7 +117,8 @@ def test_foreign_host_and_origin_are_refused(client):

 def test_session_and_keyboard(client):
     assert client.get("/api/session").json() == \
-        {"status": "connected", "fake": True, "device": "Simulated: Simulated Corne", "error": None}
+        {"status": "connected", "fake": True, "device": "Simulated: Simulated Corne", "error": None,
+         "unlock": {"state": "unlocked", "keys": [], "remaining": 0, "total": 0}}
     kb = client.get("/api/keyboard").json()
     assert (kb["name"], len(kb["layers"]), len(kb["keys"])) == ("Simulated Corne", 4, 42)

```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -16,11 +16,14 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
     keycodes = schema["paths"]["/api/keycodes"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
     assert keycodes == {"type": "array", "items": {"$ref": "#/components/schemas/KeycodeCategory"},
                         "title": "Response Keycodes Api Keycodes Get"}
-    assert "/api/simulator/connection" not in schema["paths"]  # a test aid of fake mode, not part of the API
+    # test aids of fake mode, not part of the API
+    assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
+    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock"} <= set(schema["paths"])
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
-    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded"}
+    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded", "unlock"}
+    assert "UnlockState" in schema["components"]["schemas"]
     options = schema["paths"]["/api/layout-options"]["put"]["responses"]["200"]["content"]["application/json"]
     assert options["schema"] == {"$ref": "#/components/schemas/LayoutOptionsValue"}
     named = schema["paths"]["/api/names/{kind}/{index}"]["put"]["responses"]["200"]["content"]["application/json"]
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_unlock.py test/test_api.py test/test_dump_openapi.py
```

Expected: `4 failed, 55 passed, 3 errors`.

- [ ] **Step 3: The schema and the routes**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -183,9 +183,30 @@ class Named(BaseModel):
     customName: bool


+class MatrixPosition(BaseModel):
+    row: int
+    col: int
+
+
+class UnlockState(BaseModel):
+    """ Whether the keyboard is unlocked, and how far an unlock has got """
+    state: Literal["locked", "unlocking", "cancelled", "unlocked"]
+    """ unlocking: the keyboard waits for its unlock keys to be held, and Vial follows its countdown; cancelled: Vial
+    stopped following, but the keyboard keeps waiting (it can't be called off) and takes no changes until it is unlocked
+    or plugged in again """
+    keys: list[MatrixPosition]
+    """ the keys to hold, while unlocking or cancelled """
+    remaining: int
+    """ the keyboard's countdown: how many more polls it wants every key held for (0 before the first poll) """
+    total: int
+    """ where the countdown started: the highest it was seen at """
+
+
 class Event(BaseModel):
-    """ What /api/events sends: the keyboard was plugged in, unplugged, or read again """
-    type: Literal["connected", "disconnected", "reloaded"]
+    """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed """
+    type: Literal["connected", "disconnected", "reloaded", "unlock"]
+    unlock: Optional[UnlockState] = None
+    """ with "unlock": the new state; sent at every change, and with each reading of the countdown """


 class LayoutOptions(BaseModel):
@@ -221,6 +242,8 @@ class Session(BaseModel):
     fake: bool
     device: Optional[str] = None
     error: Optional[str] = None
+    unlock: UnlockState
+    """ a keyboard that is unlocking while not connected waits for an unlock started earlier, before it is read """


 class CatalogueKeycode(Described):
@@ -361,5 +384,12 @@ class SimulatorConnection(Request):
     connected: bool


+class SimulatorUnlock(Request):
+    """ Fake mode only: the user holds the simulated keyboard's unlock keys (or lets go of them), or it is locked """
+    keysHeld: Optional[bool] = None
+    locked: Optional[bool] = None
+    """ true: lock it, as plugging it in again would """
+
+
 class NameIn(Request):
     name: Optional[str] = Field(default=None, max_length=40)
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -21,6 +21,8 @@ log = logging.getLogger(__name__)

 MAX_LAYOUT_FILE = 1024 * 1024
 """ largest .vil upload, in bytes """
+UNLOCK_POLL_INTERVAL = 0.2
+""" seconds between two readings of the unlock countdown, as Qt's unlocker """
 SECURITY_HEADERS = {
     "X-Frame-Options": "DENY",
     "Content-Security-Policy": "frame-ancestors 'none'",
@@ -125,12 +127,19 @@ class EventHub:
         await asyncio.gather(*tasks, return_exceptions=True)


+def unlock_model(state):
+    """ device.UnlockState -> schemas.UnlockState """
+    return schemas.UnlockState(state=state.state, keys=[schemas.MatrixPosition(row=r, col=c) for r, c in state.keys],
+                               remaining=state.remaining, total=state.total)
+
+
 def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
-               poll_interval=1.0, close_grace=3.0, instance_id=None):
+               poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL):
     """
     manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
     static_dir: built UI (web/dist) or None for a placeholder page
     on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
+    poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
     """
     allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
     allowed_origins = {"http://" + h for h in allowed_hosts}
@@ -138,6 +147,56 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     instance_id = instance_id or secrets.token_hex(8)
     cookie = cookie_name(port)

+    following = {"task": None}
+    """ the task reading an unlock's countdown, while there is one """
+
+    async def broadcast_events(events, progress=False):
+        """ Send the device manager's events to every tab, an "unlock" one with the unlock state. progress: send the
+        unlock state even if it didn't change (a new reading of the countdown). An unlock to follow is followed. """
+        # read in a thread: the device lock may be held for a while
+        state = await asyncio.to_thread(manager.unlock_state)
+        unlock = {"type": "unlock", "unlock": unlock_model(state).model_dump()}
+        for event in events:
+            await hub.broadcast(unlock if event == "unlock" else {"type": event})
+        if progress and "unlock" not in events:
+            await hub.broadcast(unlock)
+        if state.state == "unlocking":
+            follow_unlock()
+
+    async def follow():
+        """ Read the countdown of the unlock being followed until it ends, as Qt's unlocker does """
+        try:
+            while True:
+                await asyncio.sleep(unlock_interval)
+                try:
+                    state = await asyncio.to_thread(manager.poll_unlock)
+                except NotConnected:
+                    state = None
+                except Exception:
+                    log.exception("reading the unlock countdown failed")
+                    state = await asyncio.to_thread(manager.cancel_unlock)
+                events = await asyncio.to_thread(manager.take_events)
+                if state is None or state.state != "unlocking":
+                    following["task"] = None  # done: an unlock started from here on is followed anew
+                await broadcast_events(events, progress=state is not None)
+                if state is None or state.state != "unlocking":
+                    return
+        finally:
+            if following["task"] is asyncio.current_task():
+                following["task"] = None
+
+    def follow_unlock():
+        """ Follow the unlock's countdown, unless that is being done already """
+        if following["task"] is None:
+            following["task"] = asyncio.get_running_loop().create_task(follow())
+
+    async def stop_following():
+        task, following["task"] = following["task"], None
+        if task is not None:
+            task.cancel()
+            with contextlib.suppress(asyncio.CancelledError):
+                await task
+
     @contextlib.asynccontextmanager
     async def lifespan(app):
         async def poll():
@@ -148,13 +207,16 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                 except Exception:
                     log.exception("checking for the keyboard failed")
                     continue
-                for event in events:
-                    await hub.broadcast({"type": event})
+                await broadcast_events(events)
         task = app.state.poll_task = asyncio.create_task(poll()) if poll_interval else None
+        # a keyboard found waiting for an unlock started earlier: that is finished first
+        if (await asyncio.to_thread(manager.unlock_state)).state == "unlocking":
+            follow_unlock()
         try:
             yield
         finally:
             await hub.shutdown()
+            await stop_following()
             if task:
                 task.cancel()
                 with contextlib.suppress(asyncio.CancelledError):
@@ -170,7 +232,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         if app.openapi_schema is None:
             schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
             components = schema.setdefault("components", {}).setdefault("schemas", {})
-            components["Event"] = schemas.Event.model_json_schema(ref_template="#/components/schemas/{model}")
+            event = schemas.Event.model_json_schema(ref_template="#/components/schemas/{model}")
+            # the models it is made of are components like any other (the routes use them too)
+            for name, definition in event.pop("$defs", {}).items():
+                components.setdefault(name, definition)
+            components["Event"] = event
             app.openapi_schema = schema
         return app.openapi_schema
     app.openapi = openapi
@@ -237,6 +303,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         with keyboard_language(languages.overrides(lang)):
             return manager.run(fn)

+    def read(fn, lang=languages.DEFAULT):
+        """ run(), for what only reads what was loaded: it works while the keyboard waits for its unlock keys too """
+        with keyboard_language(languages.overrides(lang)):
+            return manager.read(fn)
+
     def offline(fn, lang=languages.DEFAULT):
         """ fn() for what needs no keyboard (the keycode tables are those of the last keyboard read, or the
         defaults before the first): under the device lock, as a keyboard being read rebuilds those tables """
@@ -265,9 +336,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone

     @app.get("/api/session", response_model=schemas.Session)
     def session():
-        status = manager.status()
+        with manager.lock:  # read together
+            status = manager.status()
+            unlock = unlock_model(manager.unlock_state())
         return schemas.Session(status="connected" if status.connected else "disconnected",
-                               fake=manager.backend.fake, device=status.title, error=status.error)
+                               fake=manager.backend.fake, device=status.title, error=status.error, unlock=unlock)

     @app.get("/api/keyboard-languages", response_model=list[schemas.KeyboardLanguage])
     def keyboard_languages():
@@ -275,7 +348,7 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone

     @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
     def keyboard(lang: Lang = languages.DEFAULT):
-        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)
+        return read(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)

     @app.post("/api/reload", response_model=schemas.KeyboardModel)
     async def reload(lang: Lang = languages.DEFAULT):
@@ -353,7 +426,7 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone

     @app.get("/api/names", response_model=schemas.Names)
     def get_names():
-        return run(lambda kb: names_for(kb))
+        return read(lambda kb: names_for(kb))

     @app.put("/api/names/{kind}/{index}", response_model=schemas.Named)
     def set_name(kind: Literal["layers", "tapDance", "macros"], index: int, body: schemas.NameIn,
@@ -362,11 +435,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
             edits.check_name(kb, kind, index)
             stored = names.set(model.uid_of(kb), kind, index, body.name)
             return model.display_name(kb, stored, kind, index)
-        return run(do, lang)
+        return read(do, lang)

     @app.get("/api/layout-file")
     def download_layout():
-        data = run(lambda kb: kb.save_layout())
+        data = read(lambda kb: kb.save_layout())
         return Response(data, media_type="application/json",
                         headers={"Content-Disposition": 'attachment; filename="keyboard.vil"'})

@@ -405,6 +478,30 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         await hub.broadcast({"type": "reloaded"})
         return result

+    @app.post("/api/unlock/start", response_model=schemas.UnlockState)
+    async def start_unlock():
+        """ Start unlocking the keyboard: the user then holds its unlock keys until the countdown ends, which "unlock"
+        events follow. An unlocked keyboard stays as it is. """
+        state = await asyncio.to_thread(manager.start_unlock)
+        await broadcast_events(await asyncio.to_thread(manager.take_events))
+        return unlock_model(state)
+
+    @app.post("/api/unlock/cancel", response_model=schemas.UnlockState)
+    async def cancel_unlock():
+        """ Stop following an unlock. The keyboard keeps waiting for its unlock keys (it can't be called off) and takes
+        no changes until it is unlocked or plugged in again. """
+        await stop_following()
+        state = await asyncio.to_thread(manager.cancel_unlock)
+        await broadcast_events(await asyncio.to_thread(manager.take_events))
+        return unlock_model(state)
+
+    @app.post("/api/lock", response_model=schemas.UnlockState)
+    async def lock_keyboard():
+        """ Lock the keyboard again """
+        state = await asyncio.to_thread(manager.lock_keyboard)
+        await broadcast_events(await asyncio.to_thread(manager.take_events))
+        return unlock_model(state)
+
     @app.websocket("/api/events")
     async def events(ws: WebSocket):
         if ws.headers.get("host") not in allowed_hosts or \
@@ -430,6 +527,22 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                 manager.backend.set_connected(body.connected)
             return {"connected": body.connected}

+        # for UI tests: the user holds the simulated keyboard's unlock keys, or lets go of them; or it is locked, as
+        # plugging it in again would. Never exists for real keyboards.
+        @app.put("/api/simulator/unlock", include_in_schema=False)
+        async def set_simulator_unlock(body: schemas.SimulatorUnlock):
+            def change():
+                with manager.lock:
+                    if body.keysHeld is not None:
+                        manager.backend.virtual.hold_unlock_keys(body.keysHeld)
+                    if body.locked:
+                        manager.backend.virtual.unlocked = False
+                        manager.read_unlocked()
+                    return manager.unlock_state()
+            state = await asyncio.to_thread(change)
+            await broadcast_events(await asyncio.to_thread(manager.take_events))
+            return unlock_model(state)
+
     if static_dir and os.path.isdir(static_dir):
         app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
     else:
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_unlock.py test/test_api.py test/test_dump_openapi.py
```

Expected: `62 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `764 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types**

The schema changed, so the check fails first:

```bash
cd web && npm run check:api
```

Expected: `src/api/schema.d.ts is out of date: run`.

```bash
cd web && npm run gen:api && npm run check:api
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date`.

`schema.d.ts` now has `UnlockState` and `MatrixPosition`, the three routes, `"unlock"` among the event types, and `unlock` in `Event` and `Session`. The type-check fails on `events.ts`, which still takes an event's type for the event:

```bash
cd web && npm run check
```

Expected: `1 ERRORS`.

- [ ] **Step 6: Write the failing event tests**

Apply to `web/src/api/events.test.ts`:

```diff
diff --git a/web/src/api/events.test.ts b/web/src/api/events.test.ts
--- a/web/src/api/events.test.ts
+++ b/web/src/api/events.test.ts
@@ -91,13 +91,18 @@ describe("connectEvents", () => {
     for (const type of ["connected", "disconnected", "reloaded"]) {
       FakeSocket.latest.send(JSON.stringify({ type }));
     }
-    expect(events).toEqual(["connected", "disconnected", "reloaded"]);
+    const unlock = { state: "unlocking", keys: [{ row: 0, col: 0 }], remaining: 3, total: 50 };
+    FakeSocket.latest.send(JSON.stringify({ type: "unlock", unlock }));
+    expect(events).toEqual([{ type: "connected" }, { type: "disconnected" }, { type: "reloaded" },
+      { type: "unlock", unlock }]);
   });

   it("ignores events of unknown type", () => {
     connect();
     FakeSocket.latest.accept();
-    for (const frame of [{ type: "toString" }, { type: "constructor" }, { type: "other" }, { type: 1 }, {}]) {
+    const frames = [{ type: "toString" }, { type: "constructor" }, { type: "other" }, { type: 1 }, {}, { type: "unlock" },
+      { type: "unlock", unlock: null }];
+    for (const frame of frames) {
       FakeSocket.latest.send(JSON.stringify(frame));
     }
     FakeSocket.latest.send("null");
@@ -110,7 +115,7 @@ describe("connectEvents", () => {
     FakeSocket.latest.accept();
     expect(() => FakeSocket.latest.send("not json {")).not.toThrow();
     FakeSocket.latest.send(JSON.stringify({ type: "reloaded" }));
-    expect(events).toEqual(["reloaded"]);
+    expect(events).toEqual([{ type: "reloaded" }]);
     expect(FakeSocket.all).toHaveLength(1);
   });

```

```bash
cd web && npx vitest run src/api/events.test.ts
```

Expected: `Test Files  1 failed (1)` and `Tests  2 failed | 9 passed (11)`: the events are still passed on as their types.

- [ ] **Step 7: Events as objects**

Apply to `web/src/api/events.ts`:

```diff
diff --git a/web/src/api/events.ts b/web/src/api/events.ts
--- a/web/src/api/events.ts
+++ b/web/src/api/events.ts
@@ -1,4 +1,4 @@
-// Live events from the server: the keyboard was plugged in, unplugged, or read again.
+// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed.
 import type { ServerEvent } from "./types";

 export type { ServerEvent };
@@ -7,10 +7,13 @@ export type LinkState = "connecting" | "open" | "closed";
 const RETRY_FIRST_MS = 500;
 const RETRY_MAX_MS = 5000;

-const EVENTS: Record<ServerEvent, true> = { connected: true, disconnected: true, reloaded: true };
+const EVENTS: Record<ServerEvent["type"], true> = { connected: true, disconnected: true, reloaded: true, unlock: true };

-function isServerEvent(type: unknown): type is ServerEvent {
-  return typeof type === "string" && Object.hasOwn(EVENTS, type);
+/** An event of a known type; an "unlock" one must carry the unlock state */
+function isServerEvent(frame: unknown): frame is ServerEvent {
+  const { type, unlock } = (frame ?? {}) as { type?: unknown; unlock?: unknown };
+  if (typeof type !== "string" || !Object.hasOwn(EVENTS, type)) return false;
+  return type !== "unlock" || (typeof unlock === "object" && unlock !== null);
 }

 /** Keeps a WebSocket to /api/events open, reconnecting when it drops. Returns a function that closes it for good. */
@@ -38,8 +41,7 @@ export function connectEvents(
       } catch {
         return; // not JSON: not an event
       }
-      const type = (frame as { type?: unknown } | null)?.type;
-      if (isServerEvent(type)) onEvent(type);
+      if (isServerEvent(frame)) onEvent(frame);
     };
     socket.onclose = () => {
       socket = null;
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -20,5 +20,7 @@ export type TapDance = Schemas["TapDance"];
 export type TapDanceIn = Schemas["TapDanceIn"];
 export type Legend = Schemas["Legend"];
 export type Named = Schemas["Named"];
+export type UnlockState = Schemas["UnlockState"];
+export type MatrixPosition = Schemas["MatrixPosition"];
 /** what /api/events sends */
-export type ServerEvent = Schemas["Event"]["type"];
+export type ServerEvent = Schemas["Event"];
```

The store reads `event.type`, and leaves the unlock events to Task 8:

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -70,7 +70,8 @@ export class KeyboardStore {
   }

   #onEvent(event: ServerEvent): void {
-    this.connected = event !== "disconnected";
+    if (event.type === "unlock") return; // the unlock state: the unlock dialog follows it
+    this.connected = event.type !== "disconnected";
     this.stale = true;
     if (this.connected) {
       void this.load();
```

Its tests send events as objects (`send` sends one as it is, for Task 8's tests):

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -1,6 +1,6 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 import { ApiError } from "../api/errors";
-import type { Described, KeyboardLanguage, KeyboardModel } from "../api/types";
+import type { Described, KeyboardLanguage, KeyboardModel, ServerEvent } from "../api/types";

 vi.mock("../api/api", () => ({
   api: {
@@ -91,7 +91,7 @@ function started() {
   store.start();
   const [onEvent, onLink] = vi.mocked(connectEvents).mock.calls.at(-1)!;
   onLink("open");
-  return { store, emit: onEvent };
+  return { store, emit: (type: ServerEvent["type"]) => onEvent({ type, unlock: null }), send: onEvent };
 }

 /** A started store that has loaded model("KC_A") and can edit */
```

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  381 passed (381)`.

- [ ] **Step 8: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_unlock.py \
  web/src/api/events.test.ts \
  web/src/api/events.ts \
  web/src/api/schema.d.ts \
  web/src/api/types.ts \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts
git commit -m "feat: unlock routes and events, and a fake-only hook to hold the simulated unlock keys"
```

### Task 4: A described keycode carries the value the keyboard stores

The macro memory bar (Task 19) counts the bytes each step takes, as the protocol encodes them. A key step takes one byte more for a keycode of 256 or more, so the browser needs each keycode's 16-bit value: `Described.value` ("KC_A" is 0x04, "LCTL(KC_C)" 0x0106, "M0" 0x7700).

The schema change and the regenerated `schema.d.ts` go in this task. So do the web test fixtures that build `Described` objects, which now need a `value`. `testing.ts` gives plain `KC_` keycodes a value under 256 and the others one above.

**Files:**
- Modify: `src/main/python/server/describe.py`, `src/main/python/server/schemas.py`, `web/src/analysis/testing.ts`
- Test: `src/main/python/test/test_describe.py`, `web/src/keyboard/labels.test.ts`, `web/src/keyboard/refs.test.ts`, `web/src/keymap/tapdance.test.ts`, `web/src/picker/search.test.ts`, `web/src/lib/keyboard.test.ts`
- Generated: `web/src/api/schema.d.ts`

- [ ] **Step 1: Write the failing test**

Apply to `src/main/python/test/test_describe.py`:

```diff
diff --git a/src/main/python/test/test_describe.py b/src/main/python/test/test_describe.py
--- a/src/main/python/test/test_describe.py
+++ b/src/main/python/test/test_describe.py
@@ -45,6 +45,11 @@ def test_describe(code, kind, tap, hold, layer, index):
         (kind, tap, hold, layer, index)


+@pytest.mark.parametrize("code, value", [("KC_NO", 0), ("KC_A", 0x04), ("LCTL(KC_C)", 0x0106), ("M0", 0x7700)])
+def test_describe_gives_the_value_the_keyboard_stores(code, value):
+    assert describe(code)["value"] == value
+
+
 def test_describe_normalizes_aliases():
     assert describe("KC_ENT")["code"] == "KC_ENTER"

```

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_describe.py
```

Expected: `KeyError: 'value'` and `4 failed, 305 passed`.

- [ ] **Step 2: The value**

Apply to `src/main/python/server/describe.py`:

```diff
diff --git a/src/main/python/server/describe.py b/src/main/python/server/describe.py
--- a/src/main/python/server/describe.py
+++ b/src/main/python/server/describe.py
@@ -217,6 +217,7 @@ def describe(code):
     value = Keycode.deserialize(code)
     result = _describe(code, value)
     result["tapCode"] = _tap_code(result, value)
+    result["value"] = value
     return result


```

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -27,6 +27,8 @@ class Legend(BaseModel):
 class Described(BaseModel):
     """ A keycode as the UI shows it """
     code: str
+    value: int
+    """ the keycode as the keyboard stores it (16 bits): a macro step takes more bytes for one of 256 or more """
     kind: KeyKind
     tap: str
     """ what a tap does, in a few words, e.g. "1", "Caps Lock", "Ctrl+C", "TD 0" """
```

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_describe.py
```

Expected: `309 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `768 passed, 1 skipped`.

- [ ] **Step 3: Regenerate the API types**

```bash
cd web && npm run gen:api && npm run check:api
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date`.

Both described-key types in `schema.d.ts` now have `value: number`, so the test fixtures without it fail the type-check:

```bash
cd web && npm run check
```

Expected: `6 ERRORS`.

- [ ] **Step 4: Values in the test fixtures**

Apply to `web/src/analysis/testing.ts`:

```diff
diff --git a/web/src/analysis/testing.ts b/web/src/analysis/testing.ts
--- a/web/src/analysis/testing.ts
+++ b/web/src/analysis/testing.ts
@@ -13,10 +13,19 @@ function label(code: string): string {
   return LABELS[name] ?? name;
 }

+/** Roughly the value the keyboard stores: what matters is that plain KC_ keycodes are under 256 (one byte in a macro)
+ * and the others aren't */
+function valueOf(code: string): number {
+  if (code === "KC_NO") return 0;
+  if (code === "KC_TRNS") return 1;
+  return /^KC_\w+$/.test(code) ? 0x04 : 0x5200;
+}
+
 /** A keycode described as the server would, for the kinds the analysis looks at */
 export function described(code: string): Described {
   const base = {
-    code, hold: null, layer: null, layerAction: null, index: null, description: null, tapCode: null, triLayer: null,
+    code, value: valueOf(code), hold: null, layer: null, layerAction: null, index: null, description: null,
+    tapCode: null, triLayer: null,
   };
   const plain = (kind: Described["kind"], tap: string, extra: Partial<Described> = {}): Described =>
     ({ ...base, kind, tap, legend: { main: tap }, ...extra });
```

Apply to `web/src/keyboard/labels.test.ts`:

```diff
diff --git a/web/src/keyboard/labels.test.ts b/web/src/keyboard/labels.test.ts
--- a/web/src/keyboard/labels.test.ts
+++ b/web/src/keyboard/labels.test.ts
@@ -9,7 +9,7 @@ type Fields = Partial<Described> & Pick<Described, "code" | "kind" | "tap">;

 function d(fields: Fields): Described {
   return {
-    hold: null, layer: null, layerAction: null, index: null, description: null,
+    value: 0, hold: null, layer: null, layerAction: null, index: null, description: null,
     legend: { main: fields.tap, shifted: null, altGr: null },
     ...fields,
   };
```

Apply to `web/src/keyboard/refs.test.ts`:

```diff
diff --git a/web/src/keyboard/refs.test.ts b/web/src/keyboard/refs.test.ts
--- a/web/src/keyboard/refs.test.ts
+++ b/web/src/keyboard/refs.test.ts
@@ -3,7 +3,7 @@ import type { Described, KeyGeometry, KeyboardModel } from "../api/types";
 import { actionAt, positionLine, refId, whereIs } from "./refs";

 const d = (code: string): Described => ({
-  code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
+  code, value: 4, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
   description: null,
 });
 const g = (fields: Partial<KeyGeometry>) => ({ x: 0, y: 0, w: 1, h: 1, ...fields }) as KeyGeometry;
```

Apply to `web/src/keymap/tapdance.test.ts`:

```diff
diff --git a/web/src/keymap/tapdance.test.ts b/web/src/keymap/tapdance.test.ts
--- a/web/src/keymap/tapdance.test.ts
+++ b/web/src/keymap/tapdance.test.ts
@@ -3,10 +3,10 @@ import type { Described, KeyboardModel, TapDance } from "../api/types";
 import { freeTapDance, tapDanceSlots } from "./tapdance";

 const none: Described = {
-  code: "KC_NO", kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null, index: null,
+  code: "KC_NO", value: 0, kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null, index: null,
   description: null,
 };
-const tab: Described = { ...none, code: "KC_TAB", kind: "basic", tap: "Tab", legend: { main: "Tab" } };
+const tab: Described = { ...none, code: "KC_TAB", value: 0x2b, kind: "basic", tap: "Tab", legend: { main: "Tab" } };

 function td(index: number, tap: Described): TapDance {
   return { index, name: "", customName: false, tap, hold: none, doubleTap: none, tapHold: none, tappingTerm: 200 };
```

Apply to `web/src/picker/search.test.ts`:

```diff
diff --git a/web/src/picker/search.test.ts b/web/src/picker/search.test.ts
--- a/web/src/picker/search.test.ts
+++ b/web/src/picker/search.test.ts
@@ -5,7 +5,7 @@ import { codesNamed, searchKeycodes, searchTemplates, searchText } from "./searc
 function k(code: string, tap: string, aliases: string[] = [], description: string | null = null,
   shifted: string | null = null, kind: CatalogueKeycode["kind"] = "basic"): CatalogueKeycode {
   return {
-    code, kind, tap, legend: { main: tap, shifted, altGr: null }, hold: null, layer: null, layerAction: null,
+    code, value: 4, kind, tap, legend: { main: tap, shifted, altGr: null }, hold: null, layer: null, layerAction: null,
     index: null, description, aliases,
   };
 }
```

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -41,7 +41,7 @@ const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

 function described(code: string): Described {
   return {
-    code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
+    code, value: 4, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
     description: null,
   };
 }
```

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  381 passed (381)`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/describe.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_describe.py \
  web/src/analysis/testing.ts \
  web/src/api/schema.d.ts \
  web/src/keyboard/labels.test.ts \
  web/src/keyboard/refs.test.ts \
  web/src/keymap/tapdance.test.ts \
  web/src/lib/keyboard.test.ts \
  web/src/picker/search.test.ts
git commit -m "feat: a described keycode carries the value the keyboard stores"
```

### Task 5: Phase 3 review follow-ups

The final review of phase 3 found these; each is small:
- **Encoders never hold a layer.** Turning a knob taps its direction's keycode, so a layer held while the key is down (MO, LT, LM, a tap dance's held slots) is never on, and TT only toggles. `reach.ts` drops those ways for encoders (`tapped`).
- **An LM member keeps its modifiers:** "LM 1 (with Shift)" instead of "LM 1".
- **Unused exports go:** `KEY_COUNT` (`testing.ts`) and the types `Via`, `ComboMember`, `Effective`, `Match`, `RunBy`, `Query` and `Side`.
- **The comment in `usage.ts`** on empty combos is reworded.
- **The phase 3 plan** loses its trailing whitespace.

Two other follow-ups are fixed where their code changes anyway: in Task 14, a combo that lists a keycode twice marks no keys, and the Inspector says "still fire" only for combos that can.

**Files:**
- Modify: `web/src/analysis/reach.ts`, `web/src/analysis/phrases.ts`, `web/src/analysis/combos.ts`, `web/src/analysis/effective.ts`, `web/src/analysis/find.ts`, `web/src/analysis/positions.ts`, `web/src/analysis/testing.ts`, `web/src/analysis/usage.ts`, `docs/superpowers/plans/2026-10-17-phase3-overview-analysis.md`
- Test: `web/src/analysis/reach.test.ts`, `web/src/analysis/phrases.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/analysis/reach.test.ts`:

```diff
diff --git a/web/src/analysis/reach.test.ts b/web/src/analysis/reach.test.ts
--- a/web/src/analysis/reach.test.ts
+++ b/web/src/analysis/reach.test.ts
@@ -251,6 +251,24 @@ describe("layerReach", () => {
     expect(layers[2].ways).toEqual([]);
   });

+  it("never holds a layer from an encoder, which is only ever tapped: TT toggles, MO, LT and held slots do nothing", () => {
+    const model: KeyboardModel = corne({
+      layers: [layer({}, "KC_NO"), layer({}), layer({}), layer({}), layer({})],
+      tapDances: [["KC_A", "MO(3)", "TG(4)", "MO(3)"]],
+    });
+    const codes = ["MO(1)", "TT(2)", "LT3(KC_A)", "TD(0)", "LM(1, MOD_LSFT)"];
+    model.encoders = codes.map((_, i) => ({ ...model.keys[0], row: null, col: null, encoder: i, direction: 1, x: 20 + 2 * i }));
+    for (const l of model.layers) l.encoders = codes.map((code) => described(l.index === 0 ? code : "KC_TRNS"));
+    const layers = layerReach(model, placeKeyboard(model));
+    expect(layers.map((l) => l.ways.map(brief))).toEqual([
+      ["default"],
+      [],
+      ["encoder 1 on 0: toggle from 0,1,3,4"],
+      [],
+      ["encoder 3 on 0 TD 0 Double tap: toggle from 0,1,2,3"],
+    ]);
+  });
+
   it("works for 8 layers, each reached from the one before", () => {
     const layers = reach({
       layers: Array.from({ length: 8 }, (_, i) => layer(i < 7 ? { [AT.leftInnerThumb]: `TO(${i + 1})` } : {}, "KC_NO")),
```

Apply to `web/src/analysis/phrases.test.ts`:

```diff
diff --git a/web/src/analysis/phrases.test.ts b/web/src/analysis/phrases.test.ts
--- a/web/src/analysis/phrases.test.ts
+++ b/web/src/analysis/phrases.test.ts
@@ -67,8 +67,9 @@ describe("memberName and comboName", () => {
     expect(memberName({ ...described("LT1(KC_NO)"), tap: "" }, names)).toBe("nothing (hold: Layer 1)");
   });

-  it("names a layer key without a keycode name (LM) and the tri-layer keys by their label", () => {
-    expect(memberName({ ...described("LM(1, MOD_LSFT)"), code: "0x5022" }, names)).toBe("LM 1");
+  it("names a layer key without a keycode name (LM, with its modifiers) and the tri-layer keys by their label", () => {
+    expect(memberName({ ...described("LM(1, MOD_LSFT)"), code: "0x5022" }, names)).toBe("LM 1 (with Shift)");
+    expect(memberName({ ...described("LM(1, 0)"), code: "0x5020" }, names)).toBe("LM 1");
     expect(memberName(described("FN_MO13"), names)).toBe("Fn1 (Fn3)");
   });

```

```bash
cd web && npx vitest run src/analysis/reach.test.ts src/analysis/phrases.test.ts
```

Expected: `Test Files  2 failed (2)` and `Tests  2 failed | 52 passed (54)`.

- [ ] **Step 2: Encoders, and LM members**

Apply to `web/src/analysis/reach.ts`:

```diff
diff --git a/web/src/analysis/reach.ts b/web/src/analysis/reach.ts
--- a/web/src/analysis/reach.ts
+++ b/web/src/analysis/reach.ts
@@ -16,7 +16,7 @@ export interface ViaSlot {
   slot: SlotLabel;
 }

-export type Via =
+type Via =
   /** layer 0: where the keyboard starts */
   | { type: "default" }
   /** a key (or encoder direction) set on a layer: a layer key, a layer-tap, or a tap dance with a layer in a slot */
@@ -67,6 +67,15 @@ export function layerTargets(model: Pick<KeyboardModel, "layers" | "tapDance">,
       : []);
 }

+/** What a target does when its key can only be tapped, as an encoder direction is (turning the knob taps it): it is
+ * never held, so a layer held while the key is down (MO, LT, LM, a tap dance's held slots) is never on, and TT only
+ * toggles. null: never reached that way. */
+function tapped(target: Target): Target | null {
+  if (target.slot && (target.slot.slot === "Hold" || target.slot.slot === "Tap, then hold")) return null;
+  if (target.action === "while held" || target.action === "while held, with modifiers") return null;
+  return target.action === "hold, or tap to toggle" ? { ...target, action: "toggle" } : target;
+}
+
 type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos">;

 /** A tri-layer key (FN_MO13, FN_MO23) on the keymap */
@@ -116,6 +125,7 @@ function triLayerWays(keys: FnKey[]): { target: number; way: Way }[] {
  *   the active layers), transparent keys falling through to the base layer.
  * - Tri-layer keys: FN_MO13 and FN_MO23 held together turn on layer 3 (see triLayerWays).
  * - LM (a layer with modifiers) counts as a key held for its layer.
+ * - Encoder directions are only ever tapped: they never hold a layer (see tapped).
  * - Layer 0 is where the keyboard starts. A layer is reachable when a way to it works on a reachable layer; DF (a new
  *   default layer) counts like any other way.
  */
@@ -137,7 +147,9 @@ export function layerReach(model: Model, placement: Placement): LayerReach[] {
       if (d.kind === "layer" && isLayer(model, d.layer) && isLayer(model, d.triLayer)) {
         fnKeys.push({ ref, layer, own: d.layer, tri: d.triLayer, worksOn });
       }
-      for (const target of layerTargets(model, action.action)) {
+      for (const found of layerTargets(model, action.action)) {
+        const target = ref.kind === "encoder" ? tapped(found) : found;
+        if (!target) continue;
         const from = worksOn.filter((l) => l !== target.layer);
         if (from.length === 0) continue;
         ways[target.layer].push({
```

Apply to `web/src/analysis/phrases.ts`:

```diff
diff --git a/web/src/analysis/phrases.ts b/web/src/analysis/phrases.ts
--- a/web/src/analysis/phrases.ts
+++ b/web/src/analysis/phrases.ts
@@ -82,12 +82,14 @@ export function tapName(d: Described, model: Pick<KeyboardModel, "tapDance">): s
 }

 /** A combo's keycode as a label: what it types, with a short note of what holding it does ("Space (hold: Layer 1)",
- * "T (hold: Shift)"); layer keys by their keycode ("MO(5)", or "LM 1" for one that has no name); tap dance and macro
- * keys by their keycode ("TD(0)", "M1"); else what it types ("K", "Esc") */
+ * "T (hold: Shift)"); layer keys by their keycode ("MO(5)", or for one that has no name its label, with the modifiers
+ * LM holds: "LM 1 (with Shift)"); tap dance and macro keys by their keycode ("TD(0)", "M1"); else what it types ("K",
+ * "Esc") */
 export function memberName(d: Described, names: Names): string {
   switch (d.kind) {
     case "layer":
-      return /^[A-Z]+\(\d+\)$/.test(d.code) ? d.code : d.tap;
+      if (/^[A-Z]+\(\d+\)$/.test(d.code)) return d.code;
+      return d.layerAction === "while held, with modifiers" && d.hold ? `${d.tap} (with ${d.hold})` : d.tap;
     case "tap-dance":
     case "macro":
       return d.code;
```

```bash
cd web && npx vitest run src/analysis/reach.test.ts src/analysis/phrases.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  54 passed (54)`.

- [ ] **Step 3: Unused exports, and the comment**

Apply to `web/src/analysis/combos.ts`:

```diff
diff --git a/web/src/analysis/combos.ts b/web/src/analysis/combos.ts
--- a/web/src/analysis/combos.ts
+++ b/web/src/analysis/combos.ts
@@ -7,7 +7,7 @@ import { effectiveAt } from "./effective";

 type Model = Pick<KeyboardModel, "layers" | "combos">;

-export interface ComboMember {
+interface ComboMember {
   action: Described;
   /** the keys with this keycode on the base layer: none, one, or several */
   keys: KeyRef[];
```

Apply to `web/src/analysis/effective.ts`:

```diff
diff --git a/web/src/analysis/effective.ts b/web/src/analysis/effective.ts
--- a/web/src/analysis/effective.ts
+++ b/web/src/analysis/effective.ts
@@ -2,7 +2,7 @@
 import type { Described, KeyboardModel } from "../api/types";
 import { actionAt, type KeyRef } from "../keyboard/refs";

-export interface Effective {
+interface Effective {
   /** the layer the action is set on: the layer itself, or the base layer for a transparent key */
   layer: number;
   action: Described;
```

Apply to `web/src/analysis/find.ts`:

```diff
diff --git a/web/src/analysis/find.ts b/web/src/analysis/find.ts
--- a/web/src/analysis/find.ts
+++ b/web/src/analysis/find.ts
@@ -12,7 +12,7 @@ import type { Usage } from "./usage";
 /** How a keycode produces what was searched for: tapped, with Shift, with AltGr, or by its name ("Esc", "MO(2)") */
 export type How = "tap" | "shift" | "altgr" | "name";

-export interface Match {
+interface Match {
   how: How;
   action: Described;
 }
@@ -25,7 +25,7 @@ export interface Place {

 /** The keys that run a result that isn't on a key: all of them (`keys`, highlighted), and the first (`key`, the one
  * the result opens), or null when no key does */
-export interface RunBy {
+interface RunBy {
   key: Place | null;
   keys: Place[];
 }
@@ -38,7 +38,7 @@ export type Found =
   | ({ type: "macro"; macro: number; how: How | "text"; text: string | null; action: Described | null } & RunBy);

 /** What the search compares a keycode with, folded once per search */
-export interface Query {
+interface Query {
   /** folded: case and spaces don't count */
   text: string;
   /** as typed, less the spaces around it: macro text is matched with case */
```

Apply to `web/src/analysis/positions.ts`:

```diff
diff --git a/web/src/analysis/positions.ts b/web/src/analysis/positions.ts
--- a/web/src/analysis/positions.ts
+++ b/web/src/analysis/positions.ts
@@ -44,7 +44,7 @@ const UNDER_DOWN = 0.5;
 /** keys less than this far apart (in key units) touch */
 const TOUCH = 0.05;

-export type Side = "left" | "right";
+type Side = "left" | "right";

 /** The vertical line between the halves of a split keyboard (in key units), or null for a keyboard in one piece: the
  * widest gap of at least SPLIT_GAP across which no key reaches, with at least a quarter of the keys on each side.
```

Apply to `web/src/analysis/testing.ts`:

```diff
diff --git a/web/src/analysis/testing.ts b/web/src/analysis/testing.ts
--- a/web/src/analysis/testing.ts
+++ b/web/src/analysis/testing.ts
@@ -72,7 +72,7 @@ export function corneKeys(): KeyGeometry[] {
   return keys;
 }

-export const KEY_COUNT = 42;
+const KEY_COUNT = 42;
 /** where the Corne's keys are, by index */
 export const AT = {
   grid: (row: number, col: number) => row * 12 + col,
```

Apply to `web/src/analysis/usage.ts`:

```diff
diff --git a/web/src/analysis/usage.ts b/web/src/analysis/usage.ts
--- a/web/src/analysis/usage.ts
+++ b/web/src/analysis/usage.ts
@@ -27,7 +27,7 @@ type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverride

 /** Which keys (on the keyboard as drawn: the chosen layout options), combos, tap dances, macros, key overrides and
  * alt repeat keys use each tap dance and macro.
- * - A combo with no keys never fires, so its output isn't a use (as combosOf, which leaves it out).
+ * - A combo with no keycodes is an unused entry, not a combo: its output isn't a use (combosOf leaves it out too).
  * - A tap dance running itself from one of its slots doesn't count, nor does a macro running itself from a step.
  * - A disabled key override or alt repeat key still counts: it is set up, only switched off. */
 export function usageOf(model: Model, placement: Placement): Usage {
```

- [ ] **Step 4: Trailing whitespace in the phase 3 plan** (the `\r` is kept for CRLF checkouts)

```bash
F=docs/superpowers/plans/2026-10-17-phase3-overview-analysis.md
sed -i -E 's/[[:blank:]]+(\r?)$/\1/' "$F"
echo "changed ignoring whitespace: $(git diff -w --numstat -- "$F" | wc -l), lines ending in a blank: $(grep -cE '[[:blank:]]\r?$' "$F")"
```

Expected: `changed ignoring whitespace: 0, lines ending in a blank: 0`.

- [ ] **Step 5: Type-check and the unit tests**

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  382 passed (382)`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-10-17-phase3-overview-analysis.md \
  web/src/analysis/combos.ts \
  web/src/analysis/effective.ts \
  web/src/analysis/find.ts \
  web/src/analysis/phrases.test.ts \
  web/src/analysis/phrases.ts \
  web/src/analysis/positions.ts \
  web/src/analysis/reach.test.ts \
  web/src/analysis/reach.ts \
  web/src/analysis/testing.ts \
  web/src/analysis/usage.ts
git commit -m "fix(web): phase 3 review follow-ups: encoders never hold a layer, LM members keep their modifiers, unused exports"
```

### Task 6: One name dialog for layers, tap dances and macros

The tap dance and macro cards (Tasks 17 and 19) name their entries in the same dialog as the layers. `keymap/LayerNameDialog.svelte` becomes `ui/NameDialog.svelte`:
- It takes a `subject`: the title, the field's label, what an empty name gives, the placeholder, and the text to start with. It is null while the dialog is closed.
- `NAME_MAX = 40`, the server's limit (`schemas.NameIn`), is exported.
- Its ids come from `$props.id()`, so two dialogs on one page never share one.

The layer tabs build their subject; nothing they show changes.

**Files:**
- Create: `web/src/ui/NameDialog.svelte`
- Modify: `web/src/keymap/LayerTabs.svelte`
- Delete: `web/src/keymap/LayerNameDialog.svelte`

- [ ] **Step 1: The dialog**

Create `web/src/ui/NameDialog.svelte`:

```svelte
<script lang="ts" module>
  /** the longest name a layer, tap dance or macro can have, the same as the server's (schemas.NameIn) */
  export const NAME_MAX = 40;

  /** What the dialog names */
  export interface NameSubject {
    /** "Rename layer 2" */
    title: string;
    /** the field's name for screen readers: "Name of layer 2" */
    label: string;
    /** what an empty name gives, after "Leave it empty for": "the default name, Layer 2" */
    empty: string;
    placeholder: string;
    /** what the field starts with: the own name, "" for a default one, or what a failed save had */
    text: string;
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";

  interface Props {
    /** what is being named, or null while the dialog is closed */
    subject: NameSubject | null;
    /** resolves to whether it worked: the dialog then closes, or stays open with what was typed (a toast says why) */
    onsave: (name: string) => Promise<boolean>;
    /** closed, saved or not: whatever opened it gets the focus back */
    onclose: () => void;
  }

  let { subject, onsave, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let saving = $state(false);
  /** what the dialog is open for: kept while it closes */
  let shown = $state<NameSubject | null>(null);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (subject !== null && !dialog.open) {
      shown = subject;
      draft = subject.text;
      saving = false;
      dialog.showModal();
      void tick().then(() => input?.select());
    } else if (subject === null && dialog.open) {
      dialog.close();
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (shown === null || saving) return;
    saving = true;
    const done = await onsave(draft.trim());
    saving = false;
    if (done) dialog?.close();
    else void tick().then(() => input?.focus());
  }
</script>

<dialog
  bind:this={dialog}
  class="name-dialog"
  aria-labelledby="{uid}-title"
  onclose={() => {
    if (shown !== null) onclose();
    shown = null;
  }}
>
  <form onsubmit={save}>
    <h2 id="{uid}-title">{shown?.title ?? ""}</h2>
    <label>
      <span class="visually-hidden">{shown?.label ?? ""}</span>
      <input
        bind:this={input}
        bind:value={draft}
        maxlength={NAME_MAX}
        placeholder={shown?.placeholder ?? ""}
        aria-describedby="{uid}-hint"
        spellcheck="false"
        autocomplete="off"
        disabled={saving}
      />
    </label>
    <p id="{uid}-hint" class="hint">
      <span>Leave it empty for {shown?.empty ?? "the default name"}.</span>
      <span class="count" class:full={draft.length >= NAME_MAX}>{draft.length} / {NAME_MAX}</span>
    </p>
    <div class="buttons">
      <Button onclick={() => dialog?.close()}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={saving}>Save</Button>
    </div>
  </form>
</dialog>

<style>
  /* wide enough for the longest name (40 characters) without scrolling */
  .name-dialog {
    width: min(calc(40ch + 90px), calc(100vw - 32px));
    max-width: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .name-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  form {
    display: grid;
    gap: 10px;
    padding: 18px 20px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface-2);
    font-size: 14px;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hint {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .count.full {
    color: var(--warning-text);
    font-weight: 600;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
```

- [ ] **Step 2: The layer tabs use it, and the old dialog goes**

Apply to `web/src/keymap/LayerTabs.svelte`:

```diff
diff --git a/web/src/keymap/LayerTabs.svelte b/web/src/keymap/LayerTabs.svelte
--- a/web/src/keymap/LayerTabs.svelte
+++ b/web/src/keymap/LayerTabs.svelte
@@ -1,6 +1,6 @@
 <script lang="ts">
   import type { Layer } from "../api/types";
-  import LayerNameDialog from "./LayerNameDialog.svelte";
+  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";

   interface Props {
     layers: Layer[];
@@ -30,9 +30,18 @@
     return name === ownName(index) ? Promise.resolve(true) : onrename(index, name);
   }

-  function closed(index: number) {
+  const subject = $derived<NameSubject | null>(renaming === null ? null : {
+    title: `Rename layer ${renaming}`,
+    label: `Name of layer ${renaming}`,
+    empty: `the default name, ${renaming === 0 ? "Base" : `Layer ${renaming}`}`,
+    placeholder: renaming === 0 ? "Base" : `Layer ${renaming}`,
+    text: ownName(renaming),
+  });
+
+  function closed() {
+    const index = renaming;
     renaming = null;
-    document.getElementById(tabId(index))?.focus();
+    if (index !== null) document.getElementById(tabId(index))?.focus();
   }

   /** the tabs pattern: arrows, Home and End move along the layers and select; F2 renames */
@@ -97,12 +106,7 @@
   {/if}
 </div>

-<LayerNameDialog
-  layer={renaming}
-  text={renaming === null ? "" : ownName(renaming)}
-  onsave={save}
-  onclose={closed}
-/>
+<NameDialog {subject} onsave={(name) => (renaming === null ? Promise.resolve(true) : save(renaming, name))} onclose={closed} />

 <style>
   .tabs {
```

```bash
git rm -q web/src/keymap/LayerNameDialog.svelte
```

- [ ] **Step 3: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 4: The e2e tests** (the layer rename tests use the dialog)

```bash
cd web && npm run e2e
```

Expected: `38 passed`: the e2e tests already on main.

- [ ] **Step 5: Commit**

```bash
git add web/src/keymap/LayerTabs.svelte \
  web/src/ui/NameDialog.svelte
git commit -m "refactor(web): one name dialog for layers, tap dances and macros"
```

### Task 7: The Unlocker

`lib/unlock.svelte.ts` keeps the keyboard's unlock state in the browser:
- **`update(state)`** takes it from an event or a session read. While the state is "unlocking", the dialog shows (`open`), whatever started the unlock: this tab, another one, or an unlock found on connect. Any other state closes it and tells the callers waiting in `unlock()` whether it worked.
- **`unlock()`** resolves true once the keyboard is unlocked, or false if the user cancelled or the unlock couldn't start. It starts an unlock unless one runs already.
- **`start()`, `cancel()` and `lock()`** send their request (`busy` meanwhile). Only the latest answer is taken, so an unlock cancelled while it was starting stays cancelled. A failure shows a toast.
- **`unlockProgress(state)`** is how far the countdown has got, from 0 to 1. **`isWaiting(state)`** says whether the keyboard waits for its keys, followed or not.

`api.ts` gets the three routes.

**Files:**
- Create: `web/src/lib/unlock.svelte.ts`
- Modify: `web/src/api/api.ts`
- Test: `web/src/lib/unlock.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/unlock.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockState } from "../api/types";

vi.mock("../api/api", () => ({ api: { unlockStart: vi.fn(), unlockCancel: vi.fn(), lock: vi.fn() } }));

const { api } = await import("../api/api");
const { isWaiting, LOCKED, unlockProgress, Unlocker } = await import("./unlock.svelte");
const { toasts } = await import("./toasts.svelte");
const mocked = vi.mocked(api);

const state = (fields: Partial<UnlockState>): UnlockState => ({ ...LOCKED, ...fields });
const UNLOCKING = state({ state: "unlocking", keys: [{ row: 0, col: 0 }, { row: 4, col: 0 }] });

beforeEach(() => {
  vi.clearAllMocks();
  toasts.items = [];
});

describe("unlockProgress", () => {
  it("is how much of the countdown has passed", () => {
    expect(unlockProgress(state({ state: "unlocking", remaining: 50, total: 50 }))).toBe(0);
    expect(unlockProgress(state({ state: "unlocking", remaining: 20, total: 50 }))).toBe(0.6);
    expect(unlockProgress(state({ state: "unlocked" }))).toBe(1);
  });

  it("is nothing before the keyboard's first reading, or when it is locked", () => {
    expect(unlockProgress(UNLOCKING)).toBe(0);
    expect(unlockProgress(LOCKED)).toBe(0);
  });
});

describe("isWaiting", () => {
  it("is true while the keyboard waits for its unlock keys, followed or not", () => {
    expect([LOCKED, UNLOCKING, state({ state: "cancelled" }), state({ state: "unlocked" })].map(isWaiting))
      .toEqual([false, true, true, false]);
  });
});

describe("Unlocker", () => {
  it("starts an unlock, shows the dialog and tells once the keyboard is unlocked", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const unlocking = unlocker.unlock();
    expect(unlocker.open).toBe(true);
    await vi.waitFor(() => expect(unlocker.state).toEqual(UNLOCKING));
    unlocker.update(state({ state: "unlocking", remaining: 10, total: 50 }));
    expect(unlocker.open).toBe(true);
    unlocker.update(state({ state: "unlocked" }));
    expect(await unlocking).toBe(true);
    expect(unlocker.open).toBe(false);
  });

  it("tells at once when the keyboard is unlocked already", async () => {
    const unlocker = new Unlocker();
    unlocker.update(state({ state: "unlocked" }));
    expect(await unlocker.unlock()).toBe(true);
    expect(mocked.unlockStart).not.toHaveBeenCalled();
  });

  it("tells false when cancelled, or when the unlock can't start", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
    const cancelled = unlocker.unlock();
    await vi.waitFor(() => expect(unlocker.state).toEqual(UNLOCKING));
    await unlocker.cancel();
    expect(await cancelled).toBe(false);
    expect(unlocker.open).toBe(false);

    mocked.unlockStart.mockRejectedValueOnce(new Error("no"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await unlocker.unlock()).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual(["Unlocking the keyboard failed: Unexpected error in the page."]);
  });

  it("shows the dialog for an unlock started elsewhere (another tab, or one interrupted earlier)", () => {
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKING);
    expect(unlocker.open).toBe(true);
    unlocker.update(LOCKED); // unplugged meanwhile
    expect(unlocker.open).toBe(false);
  });
});
```

```bash
cd web && npx vitest run src/lib/unlock.test.ts
```

Expected: `Cannot find module '/src/lib/unlock.svelte'` and `Test Files  1 failed (1)`.

- [ ] **Step 2: The routes, and the Unlocker**

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -16,4 +16,7 @@ export const api = {
     request("put", "/api/tap-dance/{index}", { params: { index }, body }),
   setLayerName: (index: number, name: string) =>
     request("put", "/api/names/{kind}/{index}", { params: { kind: "layers", index }, body: { name } }),
+  unlockStart: () => request("post", "/api/unlock/start"),
+  unlockCancel: () => request("post", "/api/unlock/cancel"),
+  lock: () => request("post", "/api/lock"),
 };
```

Create `web/src/lib/unlock.svelte.ts`:

```ts
// Unlocking the keyboard. Vial firmware takes security-sensitive changes (macros, the bootloader key) only while it is
// unlocked, and unlocking needs the user to hold the keyboard's unlock keys until its countdown ends: the server follows
// that countdown and reports it in "unlock" events, which keep `state` here. The dialog shows while it runs.
import { api } from "../api/api";
import { failureMessage } from "../api/errors";
import type { UnlockState } from "../api/types";
import { toasts } from "./toasts.svelte";

export const LOCKED: UnlockState = { state: "locked", keys: [], remaining: 0, total: 0 };

/** How far the countdown has got, from 0 to 1: none before the keyboard's first reading */
export function unlockProgress(state: UnlockState): number {
  if (state.state === "unlocked") return 1;
  if (state.total <= 0) return 0;
  return Math.min(1, Math.max(0, (state.total - state.remaining) / state.total));
}

/** Whether the keyboard waits for its unlock keys (and takes nothing else meanwhile), followed or not */
export function isWaiting(state: UnlockState): boolean {
  return state.state === "unlocking" || state.state === "cancelled";
}

export class Unlocker {
  state = $state<UnlockState>(LOCKED);
  /** the unlock dialog shows */
  open = $state(false);
  /** a request to the server is on its way */
  busy = $state(false);
  /** callers of unlock(): told whether the keyboard got unlocked */
  #waiting: ((unlocked: boolean) => void)[] = [];
  /** requests sent to the server so far */
  #sent = 0;

  /** The keyboard's unlock state changed (an event, or a session read): an unlock that runs shows the dialog, wherever
   * it was started; one that ends closes it */
  update(state: UnlockState): void {
    this.state = state;
    if (state.state === "unlocking") {
      this.open = true;
    } else {
      this.open = false;
      this.#settle(state.state === "unlocked");
    }
  }

  /** Unlock the keyboard (a change was refused as it is locked): resolves true once it is unlocked, false if the user
   * cancelled or it couldn't start */
  unlock(): Promise<boolean> {
    if (this.state.state === "unlocked") return Promise.resolve(true);
    const done = new Promise<boolean>((resolve) => this.#waiting.push(resolve));
    if (this.state.state !== "unlocking") void this.start();
    this.open = true;
    return done;
  }

  start(): Promise<void> {
    return this.#send("Unlocking the keyboard", api.unlockStart, () => {
      this.open = false;
      this.#settle(false);
    });
  }

  cancel(): Promise<void> {
    return this.#send("Cancelling the unlock", api.unlockCancel);
  }

  lock(): Promise<void> {
    return this.#send("Locking the keyboard", api.lock);
  }

  /** Sends a request that answers with the unlock state. Only the latest one's answer is taken: an unlock cancelled
   * while it was starting stays cancelled. */
  async #send(action: string, request: () => Promise<UnlockState>, failed?: () => void): Promise<void> {
    const sent = ++this.#sent;
    this.busy = true;
    try {
      const state = await request();
      if (sent === this.#sent) this.update(state);
    } catch (error) {
      toasts.error(failureMessage(action, error));
      if (sent === this.#sent) failed?.();
    } finally {
      if (sent === this.#sent) this.busy = false;
    }
  }

  #settle(unlocked: boolean): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const resolve of waiting) resolve(unlocked);
  }
}
```

```bash
cd web && npx vitest run src/lib/unlock.test.ts
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 3: Type-check and the unit tests**

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  24 passed (24)` and `Tests  389 passed (389)`.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/api.ts \
  web/src/lib/unlock.svelte.ts \
  web/src/lib/unlock.test.ts
git commit -m "feat(web): the Unlocker follows the keyboard's unlock state and starts, cancels and locks"
```

### Task 8: Store edits for the behaviour pages, and a change refused while locked

The store (`lib/keyboard.svelte.ts`) gets what the pages need. Each edit puts the keyboard's reply into the model, so the analysis follows at once:
- **`setTapDance(index, body)`**: the four slots and the tapping term.
- **`setCombo(index, keys, output)`**: at most 4 keycodes; the empty slots are filled with KC_NO.
- **`setMacros(items)`**: every macro at once, as they share the macro memory.
- **`rename(kind, index, name)`**: a layer, tap dance or macro. It replaces `renameLayer`, and `api.setName` replaces `api.setLayerName`.
- **`turnIntoTapDance`** returns the tap dance's index (or null), so the Inspector can open its card (Task 17).
- **`unlock`**, an `Unlocker`, takes the unlock state from the session and the events.
- **A change refused with 423** (the keyboard is locked) runs `unlock.unlock()` and is sent again once, if the keyboard got unlocked. If it didn't, the change fails with "The keyboard is locked, and it wasn't unlocked."

Store edits return the `#edit` promise directly, without being `async`. With an extra await, a reload landing in between would let `turnIntoTapDance` see `canEdit` again, and a test depends on that timing.

`KeymapPage` follows the two changed signatures.

**Files:**
- Modify: `web/src/lib/keyboard.svelte.ts`, `web/src/api/api.ts`, `web/src/api/types.ts`, `web/src/api/errors.ts`, `web/src/keymap/KeymapPage.svelte`
- Test: `web/src/lib/keyboard.test.ts`, `web/src/api/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -1,6 +1,6 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 import { ApiError } from "../api/errors";
-import type { Described, KeyboardLanguage, KeyboardModel, ServerEvent } from "../api/types";
+import type { Described, KeyboardLanguage, KeyboardModel, ServerEvent, UnlockState } from "../api/types";

 vi.mock("../api/api", () => ({
   api: {
@@ -11,7 +11,12 @@ vi.mock("../api/api", () => ({
     setKey: vi.fn(),
     setEncoder: vi.fn(),
     setTapDance: vi.fn(),
-    setLayerName: vi.fn(),
+    setCombo: vi.fn(),
+    setMacros: vi.fn(),
+    setName: vi.fn(),
+    unlockStart: vi.fn(),
+    unlockCancel: vi.fn(),
+    lock: vi.fn(),
   },
 }));
 vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => () => undefined) }));
@@ -61,6 +66,10 @@ function model(code: string): KeyboardModel {
   } as unknown as KeyboardModel;
 }

+const LOCKED: UnlockState = { state: "locked", keys: [], remaining: 0, total: 0 };
+const UNLOCKING: UnlockState = { state: "unlocking", keys: [{ row: 0, col: 0 }], remaining: 0, total: 0 };
+const UNLOCKED: UnlockState = { state: "unlocked", keys: [], remaining: 0, total: 0 };
+
 const LANGUAGES: KeyboardLanguage[] = [{ id: "en-us", name: "English (US)" }, { id: "pl", name: "Polish (QWERTY)" }];

 let storage: Record<string, string>;
@@ -75,7 +84,7 @@ beforeEach(() => {
       storage[key] = value;
     },
   });
-  mocked.session.mockResolvedValue({ fake: true } as never);
+  mocked.session.mockResolvedValue({ fake: true, unlock: LOCKED } as never);
   mocked.keycodes.mockResolvedValue([]);
   mocked.languages.mockResolvedValue(LANGUAGES);
   mocked.keyboard.mockResolvedValue(model("KC_A"));
@@ -347,8 +356,83 @@ describe("refused edits", () => {
     mocked.keyboard.mockReturnValueOnce(new Promise(() => undefined)); // still reading when the tap dance is made
     emit("reloaded");
     made.resolve({ ...free, tap: described("KC_A") } as never);
-    expect(await turning).toBe(false);
+    expect(await turning).toBeNull();
     expect(mocked.setKey).not.toHaveBeenCalled();
     expect(toasts.items.map((t) => t.message).join()).toContain("couldn't be changed");
   });
 });
+
+describe("behaviour edits", () => {
+  it("fill a combo's empty slots and put the keyboard's reply into the model", async () => {
+    const { store } = await loaded();
+    store.model!.combos = [{ index: 0, keys: [], output: described("KC_NO") }] as never;
+    const reply = { index: 0, keys: ["KC_K", "KC_Y", "KC_NO", "KC_NO"].map(described), output: described("KC_ESC") };
+    mocked.setCombo.mockResolvedValueOnce(reply);
+    expect(await store.setCombo(0, ["KC_K", "KC_Y"], "KC_ESC")).toBe(true);
+    expect(mocked.setCombo).toHaveBeenCalledWith(0, { keys: ["KC_K", "KC_Y", "KC_NO", "KC_NO"], output: "KC_ESC" });
+    expect(store.model!.combos[0].output.code).toBe("KC_ESC");
+  });
+
+  it("name a tap dance or a macro", async () => {
+    const { store } = await loaded();
+    store.model!.macros = { count: 1, memory: 100, used: 1, items: [{ index: 0, name: "", customName: false, actions: [] }] };
+    mocked.setName.mockResolvedValueOnce({ kind: "macros", index: 0, name: "git status", customName: true });
+    expect(await store.rename("macros", 0, "git status")).toBe(true);
+    expect(mocked.setName).toHaveBeenCalledWith("macros", 0, "git status");
+    expect(store.model!.macros.items[0]).toMatchObject({ name: "git status", customName: true });
+  });
+});
+
+describe("a locked keyboard", () => {
+  const macros = { count: 1, memory: 100, used: 4, items: [] };
+
+  it("follows the unlock state from the session and the events", async () => {
+    const { store, send } = await loaded();
+    expect(store.unlock.state).toEqual(LOCKED);
+    send({ type: "unlock", unlock: UNLOCKING });
+    expect(store.unlock.state).toEqual(UNLOCKING);
+    expect(store.unlock.open).toBe(true);
+    send({ type: "unlock", unlock: UNLOCKED });
+    expect(store.unlock.open).toBe(false);
+    expect(mocked.keyboard).toHaveBeenCalledTimes(1); // an unlock event doesn't read the keyboard again
+  });
+
+  it("is unlocked when a change is refused, and the change is sent again once it is", async () => {
+    const { store, send } = await loaded();
+    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked")).mockResolvedValueOnce(macros);
+    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
+    const saving = store.setMacros([[]]);
+    await settle();
+    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
+    expect(store.unlock.open).toBe(true);
+    send({ type: "unlock", unlock: UNLOCKED });
+    expect(await saving).toBe(true);
+    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
+    expect(store.model!.macros).toEqual(macros);
+    expect(toasts.items).toEqual([]);
+  });
+
+  it("fails the change when the unlock is cancelled", async () => {
+    const { store } = await loaded();
+    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
+    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
+    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
+    const saving = store.setMacros([[]]);
+    await settle();
+    await store.unlock.cancel();
+    expect(await saving).toBe(false);
+    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
+    expect(toasts.items.map((t) => t.message)).toEqual(["Saving the macro failed: The keyboard is locked, and it wasn't unlocked."]);
+  });
+
+  it("sends a change refused while another unlock runs again once that one ends", async () => {
+    const { store, send } = await loaded();
+    send({ type: "unlock", unlock: UNLOCKING });
+    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "waiting for its unlock keys")).mockResolvedValueOnce(macros);
+    const saving = store.setMacros([[]]);
+    await settle();
+    expect(mocked.unlockStart).not.toHaveBeenCalled();
+    send({ type: "unlock", unlock: UNLOCKED });
+    expect(await saving).toBe(true);
+  });
+});
```

Apply to `web/src/api/errors.test.ts`:

```diff
diff --git a/web/src/api/errors.test.ts b/web/src/api/errors.test.ts
--- a/web/src/api/errors.test.ts
+++ b/web/src/api/errors.test.ts
@@ -4,7 +4,7 @@ import { ApiError, errorMessage, failureMessage } from "./errors";
 describe("errorMessage", () => {
   it.each([
     [503, "no keyboard connected", "The keyboard isn't connected."],
-    [423, "locked", "This change needs the keyboard unlocked; unlocking isn't supported yet."],
+    [423, "locked", "The keyboard is locked, and it wasn't unlocked."],
     [422, "not a valid keycode: FOO", "not a valid keycode: FOO"],
     [502, "the keyboard didn't respond: timeout", "The keyboard didn't respond."],
     [500, "unexpected error, see vial.log", "Unexpected error, see vial.log."],
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts src/api/errors.test.ts
```

Expected: `Test Files  2 failed (2)` and `Tests  8 failed | 27 passed (35)`.

- [ ] **Step 2: The routes, the types and the 423 message**

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -1,6 +1,6 @@
 // The server's routes the UI uses.
 import { request } from "./client";
-import type { TapDanceIn } from "./types";
+import type { ComboIn, MacroActionIn, Named, TapDanceIn } from "./types";

 export const api = {
   session: () => request("get", "/api/session"),
@@ -14,8 +14,11 @@ export const api = {
     request("put", "/api/encoders/{layer}/{index}/{direction}", { params: { layer, index, direction }, body: { code } }),
   setTapDance: (index: number, body: TapDanceIn) =>
     request("put", "/api/tap-dance/{index}", { params: { index }, body }),
-  setLayerName: (index: number, name: string) =>
-    request("put", "/api/names/{kind}/{index}", { params: { kind: "layers", index }, body: { name } }),
+  setCombo: (index: number, body: ComboIn) => request("put", "/api/combos/{index}", { params: { index }, body }),
+  /** every macro: they share the keyboard's macro memory */
+  setMacros: (items: MacroActionIn[][]) => request("put", "/api/macros", { body: { items } }),
+  setName: (kind: Named["kind"], index: number, name: string) =>
+    request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
   unlockStart: () => request("post", "/api/unlock/start"),
   unlockCancel: () => request("post", "/api/unlock/cancel"),
   lock: () => request("post", "/api/lock"),
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -20,6 +20,12 @@ export type TapDance = Schemas["TapDance"];
 export type TapDanceIn = Schemas["TapDanceIn"];
 export type Legend = Schemas["Legend"];
 export type Named = Schemas["Named"];
+export type Combo = Schemas["Combo"];
+export type ComboIn = Schemas["ComboIn"];
+export type Macro = Schemas["Macro"];
+export type Macros = Schemas["Macros"];
+export type MacroAction = Schemas["MacroAction"];
+export type MacroActionIn = Schemas["MacroActionIn"];
 export type UnlockState = Schemas["UnlockState"];
 export type MatrixPosition = Schemas["MatrixPosition"];
 /** what /api/events sends */
```

Apply to `web/src/api/errors.ts`:

```diff
diff --git a/web/src/api/errors.ts b/web/src/api/errors.ts
--- a/web/src/api/errors.ts
+++ b/web/src/api/errors.ts
@@ -20,7 +20,7 @@ export function errorMessage(status: number, detail?: string): string {
     case 401:
       return "This page's session has ended. Open Vial again from the link in its terminal.";
     case 423:
-      return "This change needs the keyboard unlocked; unlocking isn't supported yet.";
+      return "The keyboard is locked, and it wasn't unlocked.";
     case 422:
       return detail || "The keyboard can't take this change.";
     case 500:
```

- [ ] **Step 3: The store**

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -5,10 +5,13 @@ import { api } from "../api/api";
 import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
 import { ApiError, failureMessage } from "../api/errors";
 import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
-import type { KeyboardLanguage, KeyboardModel, KeycodeCategory, Session } from "../api/types";
+import type {
+  KeyboardLanguage, KeyboardModel, KeycodeCategory, MacroActionIn, Named, Session, TapDanceIn,
+} from "../api/types";
 import { actionAt, type KeyRef } from "../keyboard/refs";
 import { freeTapDance } from "../keymap/tapdance";
 import { toasts } from "./toasts.svelte";
+import { Unlocker } from "./unlock.svelte";

 const LANGUAGE_KEY = "vial.keyboardLanguage";

@@ -45,6 +48,8 @@ export class KeyboardStore {
   loadError = $state<string | null>(null);
   /** edits waiting for the keyboard */
   pending = $state(0);
+  /** whether the keyboard is unlocked, and the unlock dialog */
+  readonly unlock = new Unlocker();

   canEdit = $derived(this.model !== null && !this.stale && this.connected && this.link === "open");

@@ -70,7 +75,10 @@ export class KeyboardStore {
   }

   #onEvent(event: ServerEvent): void {
-    if (event.type === "unlock") return; // the unlock state: the unlock dialog follows it
+    if (event.type === "unlock") {
+      if (event.unlock) this.unlock.update(event.unlock);
+      return;
+    }
     this.connected = event.type !== "disconnected";
     this.stale = true;
     if (this.connected) {
@@ -78,7 +86,7 @@ export class KeyboardStore {
     } else {
       this.#loads++; // a load in flight is for the keyboard that went away
       this.loadError = null;
-      api.session().then((s) => (this.session = s), () => undefined);
+      api.session().then((s) => this.#useSession(s), () => undefined);
     }
   }

@@ -88,7 +96,7 @@ export class KeyboardStore {
     try {
       const [session, model, catalogue] = await Promise.all([api.session(), api.keyboard(), api.keycodes()]);
       if (load !== this.#loads) return;
-      this.session = session;
+      this.#useSession(session);
       this.model = model;
       this.catalogue = catalogue;
       this.loadError = null;
@@ -109,6 +117,11 @@ export class KeyboardStore {
     }
   }

+  #useSession(session: Session): void {
+    this.session = session;
+    this.unlock.update(session.unlock);
+  }
+
   async setLanguage(lang: string): Promise<void> {
     this.#useLanguage(lang);
     saveLanguage(lang);
@@ -162,44 +175,81 @@ export class KeyboardStore {
     return false;
   }

-  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key */
-  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<boolean> {
+  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key. Returns the
+   * tap dance's index, or null when it didn't work. */
+  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<number | null> {
     const model = this.model;
     const current = model ? actionAt(model, layer, ref) : undefined;
     const index = model ? freeTapDance(model) : null;
-    if (!model || !current || index === null || !this.canEdit) return false;
+    if (!model || !current || index === null || !this.canEdit) return null;
     const entry = model.tapDance[index];
-    const created = await this.#edit("Making a tap dance", model, async () => {
-      model.tapDance[index] = await api.setTapDance(index, {
-        tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
-      });
-    });
-    if (!created) return false;
+    const created = await this.setTapDance(index, {
+      tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
+    }, "Making a tap dance");
+    if (!created) return null;
     if (!this.canEdit) {
       // setCode reports its own failures, but would refuse this one without a word
       toasts.error(`Tap dance ${index} was made, but the key couldn't be changed to TD(${index}).`);
-      return false;
+      return null;
     }
-    return this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key");
+    return (await this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key")) ? index : null;
   }

-  async renameLayer(index: number, name: string): Promise<boolean> {
+  /** Set a tap dance's four slots and its tapping term */
+  setTapDance(index: number, body: TapDanceIn, action = "Changing the tap dance"): Promise<boolean> {
     const model = this.model;
-    if (!model || !this.canEdit) return false;
-    return this.#edit("Renaming the layer", model, async () => {
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      model.tapDance[index] = await api.setTapDance(index, body);
+    });
+  }
+
+  /** Set a combo: its keycodes (at most 4; the empty slots are filled in) and its output */
+  setCombo(index: number, keys: string[], output: string, action = "Changing the combo"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    const slots = [...keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4);
+    return this.#edit(action, model, async () => {
+      model.combos[index] = await api.setCombo(index, { keys: slots, output });
+    });
+  }
+
+  /** Set every macro: they share the macro memory (the keyboard keeps the bytes of those that didn't change) */
+  setMacros(items: MacroActionIn[][], action = "Saving the macro"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      model.macros = await api.setMacros(items);
+    });
+  }
+
+  /** Name a layer, tap dance or macro; an empty name gives it its default one back */
+  rename(kind: Named["kind"], index: number, name: string): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    const what = { layers: "layer", tapDance: "tap dance", macros: "macro" }[kind];
+    return this.#edit(`Renaming the ${what}`, model, async () => {
       // the reply is the name to show: the new one, or the default name when it was cleared
-      const named = await api.setLayerName(index, name);
-      model.layers[index].name = named.name;
-      model.layers[index].customName = named.customName;
+      const named = await api.setName(kind, index, name);
+      const item = kind === "layers" ? model.layers[index]
+        : kind === "tapDance" ? model.tapDance[index] : model.macros.items[index];
+      item.name = named.name;
+      item.customName = named.customName;
     });
   }

-  /** Runs write, which puts the keyboard's reply into model */
+  /** Runs write, which puts the keyboard's reply into model. A change refused because the keyboard is locked unlocks
+   * it (the user holds its unlock keys) and is sent again, once. */
   async #edit(action: string, model: KeyboardModel, write: () => Promise<void>): Promise<boolean> {
     this.pending++;
     const loads = this.#loads;
     try {
-      await write();
+      try {
+        await write();
+      } catch (error) {
+        if (!(error instanceof ApiError && error.status === 423) || !(await this.unlock.unlock())) throw error;
+        await write();
+      }
       // a load started or landed meanwhile and may have read the keyboard before this edit (it can land after it,
       // too): read it again, unless the keyboard is gone
       if ((this.#loads !== loads || this.model !== model) && this.connected) void this.load();
```

- [ ] **Step 4: The Keymap page follows**

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -129,7 +129,7 @@
   }

   function turnIntoTapDance() {
-    return selection ? keyboard.turnIntoTapDance(layer, selection) : Promise.resolve(false);
+    return selection ? keyboard.turnIntoTapDance(layer, selection).then((index) => index !== null) : Promise.resolve(false);
   }

   const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
@@ -210,7 +210,7 @@
           active={layer}
           canRename={keyboard.canEdit}
           onselect={(i) => (layer = i)}
-          onrename={(i, name) => keyboard.renameLayer(i, name)}
+          onrename={(i, name) => keyboard.rename("layers", i, name)}
         />
         <div class="layer" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{layer}">
           {#if analysis.reach[layer]}
```

- [ ] **Step 5: Run the tests, type-check and build**

```bash
cd web && npx vitest run src/lib/keyboard.test.ts src/api/errors.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  35 passed (35)`.

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  24 passed (24)` and `Tests  395 passed (395)` and `built in`.

- [ ] **Step 6: The e2e tests** (renaming a layer, turning a key into a tap dance)

```bash
cd web && npm run e2e
```

Expected: `38 passed`.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/api.ts \
  web/src/api/errors.test.ts \
  web/src/api/errors.ts \
  web/src/api/types.ts \
  web/src/keymap/KeymapPage.svelte \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts
git commit -m "feat(web): store edits for tap dances, combos, macros and names; a change refused while locked unlocks the keyboard and is sent again"
```

### Task 9: Tap dances, combos and "used on" in plain sentences

`behaviours/sentences.ts` writes the cards' sentences:
- **`tapDanceSentence`:** "Tap for Tab, double-tap for Caps Lock." Empty slots are left out, and an empty tap dance says so.
- **`comboSentence`:** "Press K + Y together for Esc." A combo whose output reaches a layer uses the Overview's wording: "Press MO(5) + OSL(3) together → reaches Layer 2, while held."
- **`comboNotes`:** why a combo can't fire (a keycode listed twice, or on no key), the layers it fires on when a keycode isn't on the base layer, and a keycode on several keys ("either one works").
- **`outcome`:** what a keycode does, after the gesture that runs it ("for Tab", "to toggle Layer 2").
- **`useLabel`:** a "used on" chip: "Base, left inner thumb", "combo 1's output", "tap dance 0, double tap", "macro 2, step 3".

`phrases.ts` exports `andList` and `layerList` for it.

**Files:**
- Create: `web/src/behaviours/sentences.ts`
- Modify: `web/src/analysis/phrases.ts`
- Test: `web/src/behaviours/sentences.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/behaviours/sentences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codesOn, combosOf } from "../analysis/combos";
import { AT, corne, described, layer } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { comboNotes, comboSentence, outcome, tapDanceSentence, useLabel } from "./sentences";

const model = corne({
  layers: [layer({}, "KC_NO"), layer({}), layer({}), layer({})],
  tapDances: [
    ["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"],
    ["KC_ESC", "KC_LCTL", "MO(2)", "TG(3)"],
    ["KC_NO", "KC_NO", "KC_NO", "KC_NO"],
  ],
});
const names = namesOf(model);

describe("tapDanceSentence", () => {
  it("says what each way of pressing does, leaving out the empty ones", () => {
    expect(tapDanceSentence(model.tapDance[0], names)).toBe("Tap for Tab, double-tap for Caps Lock.");
    expect(tapDanceSentence(model.tapDance[1], names)).toBe(
      "Tap for Esc, hold for LCTL, double-tap for Layer 2, tap then hold to toggle Layer 3.");
  });

  it("says when it does nothing yet", () => {
    expect(tapDanceSentence(model.tapDance[2], names)).toBe("Does nothing yet: choose what each way of pressing it does.");
  });
});

describe("outcome", () => {
  it("names what a layer key does with its layer", () => {
    expect(["MO(1)", "TG(1)", "TO(1)", "OSL(1)", "TT(1)", "DF(1)", "PDF(1)", "LM(1, MOD_LSFT)"]
      .map((c) => outcome(described(c), names))).toEqual([
      "for Layer 1", "to toggle Layer 1", "to switch to Layer 1", "for Layer 1 on the next key",
      "to hold or toggle Layer 1", "to make Layer 1 the default layer", "to make Layer 1 the default layer for good",
      "for Layer 1 with Shift",
    ]);
  });

  it("names a key with a hold action with both", () => {
    expect(outcome(described("LT1(KC_SPC)"), names)).toBe("for Space (hold: Layer 1)");
    expect(outcome(described("LSFT_T(KC_T)"), names)).toBe("for T (hold: Shift)");
  });
});

describe("comboSentence", () => {
  const combos = corne({
    layers: [layer({ [AT.grid(2, 9)]: "KC_K", [AT.grid(2, 10)]: "KC_Y", [AT.leftInnerThumb]: "MO(5)",
      [AT.rightOuterThumb]: "OSL(3)" }, "KC_NO"), ...Array.from({ length: 5 }, () => layer({}))],
    tapDances: [["KC_A", "MO(1)", "KC_NO", "KC_NO"]],
    combos: [
      { keys: ["KC_K", "KC_Y"], output: "KC_ESC" },
      { keys: ["MO(5)", "OSL(3)"], output: "MO(2)" },
      { keys: ["KC_K", "KC_Y"], output: "LT1(KC_SPC)" },
      { keys: ["KC_K"], output: "TD(0)" },
      { keys: ["KC_K"], output: "KC_NO" },
      { keys: [], output: "KC_ESC" },
      { keys: ["KC_K", "KC_Y"], output: "TG(4)" },
    ],
  });
  const placement = placeKeyboard(combos);
  const info = combosOf(combos, placement);
  const sentence = (index: number) => {
    const combo = info.find((c) => c.index === index) ?? { members: [], output: combos.combos[index].output };
    return comboSentence(combo, combos, namesOf(combos));
  };

  it("says which keys to press together, and what for", () => {
    expect(sentence(0)).toBe("Press K + Y together for Esc.");
  });

  it("says which layer a combo of layer keys reaches, as the Overview does", () => {
    expect(sentence(1)).toBe("Press MO(5) + OSL(3) together → reaches Layer 2, while held.");
    expect(sentence(6)).toBe("Press K + Y together → reaches Layer 4, toggled on or off.");
  });

  it("says when the output reaches a layer when held, or from a tap dance slot", () => {
    expect(sentence(2)).toBe("Press K + Y together for Space, or hold them → reaches Layer 1.");
    expect(sentence(3)).toBe("Press K together for Tap dance 0, which reaches Layer 1 when held.");
  });

  it("says when there is nothing to press or nothing it does", () => {
    expect(sentence(4)).toBe("Press K together: it does nothing yet.");
    expect(sentence(5)).toBe("No keys chosen yet.");
  });
});

describe("comboNotes", () => {
  const notesOf = (keys: string[], layers: string[][]) => {
    const m = corne({ layers, combos: [{ keys, output: "KC_ESC" }] });
    const p = placeKeyboard(m);
    const codes = m.layers.map((_, l) => codesOn(m, p, l));
    return comboNotes(combosOf(m, p)[0], codes, namesOf(m));
  };

  it("has nothing to say about a combo whose keys are each on one key of the base layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A", 1: "KC_B" }, "KC_NO")])).toEqual([]);
  });

  it("says when a keycode is on several keys: either one works", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A", 1: "KC_B", 2: "KC_B" }, "KC_NO")]))
      .toEqual(["B is on 2 keys of the base layer: either one works."]);
  });

  it("says when it can't fire: a keycode on no key, or not all on one layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO")])).toEqual(["B isn't on any key, so it can't fire."]);
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO"), layer({ 0: "KC_NO", 1: "KC_B" }, "KC_NO")]))
      .toEqual(["Its keys aren't all on one layer, so it can't fire."]);
  });

  it("says where it fires when its keys aren't on the base layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO"), layer({ 1: "KC_B" })]))
      .toEqual(["B isn't on the base layer: it fires on Layer 1."]);
  });

  it("says a combo that has a keycode twice never fires", () => {
    expect(notesOf(["KC_A", "KC_A"], [layer({ 0: "KC_A", 1: "KC_A" }, "KC_NO")]))
      .toEqual(["It has A twice, so it never fires."]);
  });
});

describe("useLabel", () => {
  const positions = new Map([["key:38", "left inner thumb"]]);
  it("names each kind of use", () => {
    expect([
      { type: "key", layer: 0, ref: { kind: "key", index: 38 } },
      { type: "combo", combo: 1, part: "output" },
      { type: "combo", combo: 1, part: "key" },
      { type: "tap-dance", tapDance: 0, slot: "Double tap" },
      { type: "macro", macro: 2, step: 0 },
      { type: "key-override", keyOverride: 0, part: "replacement" },
      { type: "alt-repeat", altRepeat: 1, part: "alt keycode" },
    ].map((use) => useLabel(use as never, names, positions))).toEqual([
      "Base, left inner thumb", "combo 1's output", "combo 1's keys", "tap dance 0, double tap", "macro 2, step 1",
      "key override 0's replacement", "alt-repeat key 1's alt keycode",
    ]);
  });
});
```

```bash
cd web && npx vitest run src/behaviours/sentences.test.ts
```

Expected: `Cannot find module './sentences'`.

- [ ] **Step 2: The sentences**

Apply to `web/src/analysis/phrases.ts`:

```diff
diff --git a/web/src/analysis/phrases.ts b/web/src/analysis/phrases.ts
--- a/web/src/analysis/phrases.ts
+++ b/web/src/analysis/phrases.ts
@@ -110,12 +110,12 @@ export function comboName(members: { action: Described }[], names: Names): strin
 }

 /** "Base", "Layer 1, Nav" */
-function layerList(layers: number[], names: Names): string {
+export function layerList(layers: number[], names: Names): string {
   return layers.map((l) => names.layer(l)).join(", ");
 }

 /** "Q", "Q and W", "Q, W and E" */
-function andList(items: string[]): string {
+export function andList(items: string[]): string {
   return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
 }

```

Create `web/src/behaviours/sentences.ts`:

```ts
// Tap dances and combos in plain words, for their cards: "Tap for Tab, double-tap for Caps Lock.", "Press K + Y
// together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held."
import { comboLayers, repeatedCodes, type ComboInfo } from "../analysis/combos";
import { andList, comboName, layerList, memberName } from "../analysis/phrases";
import { layerTargets } from "../analysis/reach";
import type { Use } from "../analysis/usage";
import type { Described, KeyboardModel, LayerAction, TapDance } from "../api/types";
import { actionSummary, layerLabel, type Names } from "../keyboard/labels";
import { refId, type KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

/** How a tap dance slot is pressed, at the start of a sentence's part: "double-tap for Caps Lock" */
const GESTURES: Record<SlotLabel, string> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "double-tap",
  "Tap, then hold": "tap then hold",
};

/** The same, after a combo's layer: "reaches Layer 2 when double-tapped" */
const PARTICIPLES: Record<SlotLabel, string> = {
  Tap: "when tapped",
  Hold: "when held",
  "Double tap": "when double-tapped",
  "Tap, then hold": "when tapped then held",
};

/** What a layer key does with its layer, after "reaches Layer 2" */
const LAYER_WAYS: Record<LayerAction, string> = {
  "while held": ", while held",
  toggle: ", toggled on or off",
  "switch to": ", switched to",
  "one-shot": ", for the next key",
  "hold, or tap to toggle": ", held or toggled",
  default: ", as the default layer",
  "default (saved)": ", as the default layer for good",
  "while held, with modifiers": ", while held",
};

/** What a keycode does, after the gesture that runs it: "for Tab", "to toggle Layer 2", "for Space (hold: Shift)" */
export function outcome(d: Described, names: Names): string {
  if (d.kind === "layer" && d.layer != null) {
    const layer = layerLabel(d.layer, names);
    switch (d.layerAction) {
      case "toggle":
        return `to toggle ${layer}`;
      case "switch to":
        return `to switch to ${layer}`;
      case "one-shot":
        return `for ${layer} on the next key`;
      case "hold, or tap to toggle":
        return `to hold or toggle ${layer}`;
      case "default":
        return `to make ${layer} the default layer`;
      case "default (saved)":
        return `to make ${layer} the default layer for good`;
      case "while held, with modifiers":
        return d.hold ? `for ${layer} with ${d.hold}` : `for ${layer}`;
      default:
        return `for ${layer}`;
    }
  }
  if (d.kind === "layer-tap" || d.kind === "mod-tap") return `for ${memberName(d, names)}`;
  return `for ${actionSummary(d, names).tap}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Tap for Tab, double-tap for Caps Lock." */
export function tapDanceSentence(td: TapDance, names: Names): string {
  const parts = tapDanceSlots(td)
    .filter((slot) => slot.action.kind !== "none")
    .map((slot) => `${GESTURES[slot.label]} ${outcome(slot.action, names)}`);
  return parts.length === 0 ? "Does nothing yet: choose what each way of pressing it does." : `${capitalised(parts.join(", "))}.`;
}

/** The layers a combo's output reaches, in words: "reaches Layer 2, while held", "reaches Layer 1 when held" */
function reaches(model: Pick<KeyboardModel, "layers" | "tapDance">, output: Described, names: Names): string | null {
  const targets = layerTargets(model, output);
  if (targets.length === 0) return null;
  return targets
    .map((t) => {
      const layer = layerLabel(t.layer, names);
      if (t.slot) return `reaches ${layer} ${PARTICIPLES[t.slot.slot]}`;
      if (output.kind === "layer-tap") return `reaches ${layer} when held`;
      const mods = t.action === "while held, with modifiers" && output.hold ? `, with ${output.hold}` : "";
      return `reaches ${layer}${LAYER_WAYS[t.action]}${mods}`;
    })
    .join("; ");
}

/** "Press K + Y together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held." */
export function comboSentence(combo: Pick<ComboInfo, "members" | "output">, model: Pick<KeyboardModel, "layers" | "tapDance">,
  names: Names): string {
  if (combo.members.length === 0) return "No keys chosen yet.";
  const keys = comboName(combo.members, names);
  const output = combo.output;
  if (output.kind === "none") return `Press ${keys} together: it does nothing yet.`;
  const reached = reaches(model, output, names);
  if (output.kind === "layer" && reached) return `Press ${keys} together → ${reached}.`;
  if (output.kind === "layer-tap" && output.layer != null && reached) {
    return `Press ${keys} together for ${output.tap || "nothing"}, or hold them → reaches ${layerLabel(output.layer, names)}.`;
  }
  return `Press ${keys} together ${outcome(output, names)}${reached ? `, which ${reached}` : ""}.`;
}

/** Why a combo can't fire, or how its keys are found: "It has A twice, so it never fires.", "Y isn't on any key, so
 * it can't fire.", "K is on 2 keys of the base layer: either one works." layerCodes: by layer, codesOn's maps. */
export function comboNotes(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[], names: Names): string[] {
  const repeated = repeatedCodes(combo).map((d) => memberName(d, names));
  if (repeated.length > 0) return [`It has ${andList(repeated)} twice, so it never fires.`];
  const notes: string[] = [];
  const fires = comboLayers(combo, layerCodes);
  const offBase = combo.members.filter((m) => m.keys.length === 0).map((m) => memberName(m.action, names));
  const be = (items: string[]) => (items.length === 1 ? "isn't" : "aren't");
  if (fires.length === 0) {
    const nowhere = combo.members
      .filter((m) => !layerCodes.some((codes) => codes.has(m.action.code)))
      .map((m) => memberName(m.action, names));
    notes.push(nowhere.length > 0
      ? `${andList(nowhere)} ${be(nowhere)} on any key, so it can't fire.`
      : "Its keys aren't all on one layer, so it can't fire.");
  } else if (offBase.length > 0) {
    notes.push(`${andList(offBase)} ${be(offBase)} on the base layer: it fires on ${layerList(fires, names)}.`);
  }
  for (const m of combo.members) {
    if (m.keys.length > 1) notes.push(`${memberName(m.action, names)} is on ${m.keys.length} keys of the base layer: either one works.`);
  }
  return notes;
}

/** Something that uses a tap dance or macro, in words: "Base, left inner thumb", "combo 1's output", "tap dance 0,
 * double tap", "macro 2, step 3", "key override 0's replacement" */
export function useLabel(use: Use, names: Names, positions: Map<string, string>): string {
  switch (use.type) {
    case "key":
      return `${names.layer(use.layer)}, ${positions.get(refId(use.ref)) ?? "a key"}`;
    case "combo":
      return use.part === "output" ? `combo ${use.combo}'s output` : `combo ${use.combo}'s keys`;
    case "tap-dance":
      return `tap dance ${use.tapDance}, ${use.slot.toLowerCase()}`;
    case "macro":
      return `macro ${use.macro}, step ${use.step + 1}`;
    case "key-override":
      return `key override ${use.keyOverride}'s ${use.part}`;
    case "alt-repeat":
      return `alt-repeat key ${use.altRepeat}'s ${use.part}`;
  }
}
```

```bash
cd web && npx vitest run src/behaviours/sentences.test.ts
```

Expected: `Tests  14 passed (14)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  25 passed (25)` and `Tests  409 passed (409)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/analysis/phrases.ts \
  web/src/behaviours/sentences.test.ts \
  web/src/behaviours/sentences.ts
git commit -m "feat(web): tap dances, combos and \"used on\" in plain sentences"
```

### Task 10: Macro steps, and the bytes they take

`behaviours/macro.ts` handles a macro as a list of steps (text, tap, down, up, delay):
- **In words:** `stepVerb` and `stepWhat` ("type" "ls -la", "tap" "Enter", "wait" "30 ms"), and `macroSentence`.
- **Sizes**, as `src/main/python/macro/macro_action.py` encodes them:
  - text: 1 byte a character;
  - a key action: a prefix byte (protocol 2 or later), the action byte, then 1 byte for a keycode under 256 (`Described.value`) or 2;
  - a delay: 4 bytes;
  - a 0 byte ends each macro.

  `stepBytes`, `macroBytes` and `memoryUsed` count them. `memoryLevel` is "ok", "near" (85 % or more) or "over".
- **Problems:** `stepProblem` gives an empty text or one the keyboard can't type (plain ASCII, tabs and line breaks only), a key step without a key, a wait out of range (0 to 64000 ms), or a wait on firmware without waits (protocol before 2).
- **Editing:** `newStep`, `changeKind`, `moveStep`, `stepRequest` (what the server takes) and `sameSteps`.

**Files:**
- Create: `web/src/behaviours/macro.ts`
- Test: `web/src/behaviours/macro.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/behaviours/macro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { described } from "../analysis/testing";
import type { Described } from "../api/types";
import {
  changeKind, macroBytes, macroSentence, memoryLevel, memoryUsed, moveStep, newStep, sameSteps, stepBytes, stepProblem,
  stepRequest, stepWhat, type Step,
} from "./macro";

const key = (code: string, value: number, tap: string): Described => ({ ...described(code), value, tap });
const ENTER = key("KC_ENTER", 0x28, "Enter");
const HOME = key("KC_HOME", 0x4a, "Home");
const END = key("KC_END", 0x4d, "End");
const SHIFT = key("KC_LSHIFT", 0xe1, "LShift");
const CTRL_C = key("LCTL(KC_C)", 0x0106, "Ctrl+C");

const text = (t: string): Step => ({ type: "text", text: t, keys: [], delay: null });
const keys = (type: "tap" | "down" | "up", ...k: Described[]): Step => ({ type, text: null, keys: k, delay: null });
const wait = (ms: number): Step => ({ type: "delay", text: null, keys: [], delay: ms });

// the simulated Corne's two macros (simulator/corne.py)
const M0 = [text("git status"), keys("tap", ENTER)];
const M1 = [keys("tap", HOME), keys("down", SHIFT), keys("tap", END), keys("up", SHIFT), wait(50), keys("tap", CTRL_C)];

describe("macro sizes", () => {
  it("count a byte a character, three a key (four for a keycode of 256 or more) and four a wait", () => {
    expect(stepBytes(text("git status"), 6)).toBe(10);
    expect(stepBytes(keys("tap", ENTER), 6)).toBe(3);
    expect(stepBytes(keys("tap", CTRL_C), 6)).toBe(4);
    expect(stepBytes(keys("tap", HOME, END), 6)).toBe(6);
    expect(stepBytes(wait(50), 6)).toBe(4);
  });

  it("have no prefix byte before protocol 2", () => {
    expect(stepBytes(keys("tap", ENTER), 1)).toBe(2);
    expect(stepBytes(keys("tap", CTRL_C), 1)).toBe(3);
  });

  it("add up as the server counts the macro memory: a 0 byte ends each macro", () => {
    expect(macroBytes(M0, 6)).toBe(13);
    expect(macroBytes(M1, 6)).toBe(20);
    // 16 macros, as the simulated Corne has
    expect(memoryUsed([M0, M1, ...Array.from({ length: 14 }, () => [])], 6)).toBe(13 + 1 + 20 + 1 + 14);
  });
});

describe("memoryLevel", () => {
  it("turns amber near full, and says when it is over", () => {
    expect(memoryLevel(50, 900)).toBe("ok");
    expect(memoryLevel(765, 900)).toBe("near");
    expect(memoryLevel(900, 900)).toBe("near");
    expect(memoryLevel(901, 900)).toBe("over");
  });
});

describe("macro steps in words", () => {
  it("chain the steps", () => {
    expect(macroSentence(M0)).toBe("type “git status” → tap Enter");
    expect(macroSentence(M1)).toBe("tap Home → press LShift → tap End → release LShift → wait 50 ms → tap Ctrl+C");
    expect(macroSentence([])).toBe("Does nothing yet.");
  });

  it("show line breaks and tabs in text", () => {
    expect(stepWhat(text("a\tb\n"))).toBe("“a⇥b⏎”");
    expect(stepWhat(keys("tap", HOME, END))).toBe("Home, End");
  });
});

describe("stepProblem", () => {
  it("wants text the keyboard can type, a key, and a wait it can do", () => {
    expect(stepProblem(text(""), 6)).toBe("Type the text to send.");
    expect(stepProblem(text("zażółć"), 6)).toMatch(/plain ASCII/);
    expect(stepProblem(text("ok\n"), 6)).toBeNull();
    expect(stepProblem(keys("tap"), 6)).toBe("Choose a key.");
    expect(stepProblem(wait(64001), 6)).toBe("Wait 0 to 64000 ms.");
    expect(stepProblem(wait(10), 1)).toMatch(/no waits/);
    expect(stepProblem(wait(0), 6)).toBeNull();
  });
});

describe("editing steps", () => {
  it("makes new steps of each kind", () => {
    expect(newStep("text")).toEqual(text(""));
    expect(newStep("delay")).toEqual(wait(100));
    expect(newStep("up")).toEqual(keys("up"));
  });

  it("keeps the keys when a step changes between tap, press and release", () => {
    expect(changeKind(keys("tap", ENTER), "down")).toEqual(keys("down", ENTER));
    expect(changeKind(keys("tap", ENTER), "text")).toEqual(text(""));
  });

  it("moves a step", () => {
    expect(moveStep(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveStep(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveStep(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("sends the steps as the server takes them, and compares them so", () => {
    expect(M1.map(stepRequest)[5]).toEqual({ type: "tap", text: null, keys: ["LCTL(KC_C)"], delay: null });
    expect(stepRequest(text("hi"))).toEqual({ type: "text", text: "hi", keys: [], delay: null });
    expect(sameSteps(M0, [text("git status"), keys("tap", { ...ENTER, tap: "Return" })])).toBe(true);
    expect(sameSteps(M0, [text("git status")])).toBe(false);
  });
});
```

```bash
cd web && npx vitest run src/behaviours/macro.test.ts
```

Expected: `Cannot find module './macro'`.

- [ ] **Step 2: The steps**

Create `web/src/behaviours/macro.ts`:

```ts
// Macros as steps: what each step says, how many bytes of the keyboard's macro memory it takes, and editing them.
// The sizes follow the protocol's encoding (src/main/python/macro/macro_action.py): the keyboard stores all macros in
// one buffer, each ended by a 0 byte.
import type { Described, MacroAction, MacroActionIn } from "../api/types";

export type Step = MacroAction;
export type StepKind = Step["type"];

export const STEP_KINDS: { kind: StepKind; label: string }[] = [
  { kind: "text", label: "Type text" },
  { kind: "tap", label: "Tap a key" },
  { kind: "down", label: "Press a key" },
  { kind: "up", label: "Release a key" },
  { kind: "delay", label: "Wait" },
];

/** Vial protocol 2 brought delays, and a prefix byte before every key action */
export const ADVANCED_MACROS = 2;
/** the longest delay a step can have, in ms (as the server's MACRO_DELAY_MAX) */
export const DELAY_MAX = 64000;
/** the most steps a macro can have (as the server's MACRO_STEPS_MAX) */
export const STEPS_MAX = 256;
/** the share of the macro memory from which its bar turns amber */
export const NEAR_FULL = 0.85;
/** what a text step may hold: printable ASCII, tabs and line breaks (as the server's MACRO_TEXT) */
const TEXT = /^[\t\n\x20-\x7e]*$/;

/** Bytes a step takes: text one a character; a key action a byte for the action (and a prefix byte with protocol 2),
 * and one byte for a keycode under 256 or two for the others; a delay four */
export function stepBytes(step: Step, vialProtocol: number): number {
  const advanced = vialProtocol >= ADVANCED_MACROS;
  switch (step.type) {
    case "text":
      return new TextEncoder().encode(step.text ?? "").length;
    case "delay":
      return 4;
    default:
      return step.keys.reduce((sum, key) => sum + (advanced ? 1 : 0) + 1 + (key.value < 256 ? 1 : 2), 0);
  }
}

export function macroBytes(steps: Step[], vialProtocol: number): number {
  return steps.reduce((sum, step) => sum + stepBytes(step, vialProtocol), 0);
}

/** Bytes all macros take in the keyboard's memory, the 0 byte that ends each one included */
export function memoryUsed(macros: Step[][], vialProtocol: number): number {
  return macros.reduce((sum, steps) => sum + macroBytes(steps, vialProtocol) + 1, 0);
}

export type MemoryLevel = "ok" | "near" | "over";

export function memoryLevel(used: number, memory: number): MemoryLevel {
  if (used > memory) return "over";
  return memory > 0 && used >= memory * NEAR_FULL ? "near" : "ok";
}

/** What a step does, as a verb: "type", "tap", "press", "release", "wait" */
export function stepVerb(step: Step): string {
  return { text: "type", tap: "tap", down: "press", up: "release", delay: "wait" }[step.type];
}

function keyName(d: Described): string {
  return d.tap || d.code;
}

/** What it does it to: "“git status”", "Enter", "Home, End" (each in turn), "50 ms" */
export function stepWhat(step: Step): string {
  switch (step.type) {
    case "text":
      return `“${(step.text ?? "").replace(/\n/g, "⏎").replace(/\t/g, "⇥")}”`;
    case "delay":
      return `${step.delay ?? 0} ms`;
    default:
      return step.keys.length > 0 ? step.keys.map(keyName).join(", ") : "no key yet";
  }
}

/** The whole macro in words: 'type “git status” → tap Enter' */
export function macroSentence(steps: Step[]): string {
  return steps.length === 0 ? "Does nothing yet." : steps.map((s) => `${stepVerb(s)} ${stepWhat(s)}`).join(" → ");
}

/** Why a step can't be saved, or null */
export function stepProblem(step: Step, vialProtocol: number): string | null {
  switch (step.type) {
    case "text":
      if (!step.text) return "Type the text to send.";
      return TEXT.test(step.text) ? null : "The keyboard can only type plain ASCII characters, tabs and line breaks.";
    case "delay": {
      if (vialProtocol < ADVANCED_MACROS) return "This keyboard's firmware has no waits in macros.";
      const delay = step.delay ?? -1;
      return Number.isInteger(delay) && delay >= 0 && delay <= DELAY_MAX ? null : `Wait 0 to ${DELAY_MAX} ms.`;
    }
    default:
      return step.keys.length > 0 ? null : "Choose a key.";
  }
}

/** A new step of a kind: empty text, no keys yet, or a wait of 100 ms */
export function newStep(kind: StepKind): Step {
  return { type: kind, text: kind === "text" ? "" : null, keys: [], delay: kind === "delay" ? 100 : null };
}

/** The step turned into another kind, keeping its keys between tap, press and release */
export function changeKind(step: Step, kind: StepKind): Step {
  if (kind === step.type) return step;
  const keyed = (k: StepKind) => k === "tap" || k === "down" || k === "up";
  return keyed(kind) && keyed(step.type) ? { ...step, type: kind } : newStep(kind);
}

/** The steps with the one at `from` moved to `to` */
export function moveStep<T>(steps: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps;
  const out = [...steps];
  const [step] = out.splice(from, 1);
  out.splice(to, 0, step);
  return out;
}

/** A step as the server takes it */
export function stepRequest(step: Step): MacroActionIn {
  switch (step.type) {
    case "text":
      return { type: "text", text: step.text ?? "", keys: [], delay: null };
    case "delay":
      return { type: "delay", text: null, keys: [], delay: step.delay ?? 0 };
    default:
      return { type: step.type, text: null, keys: step.keys.map((k) => k.code), delay: null };
  }
}

/** Whether two step lists say the same */
export function sameSteps(a: Step[], b: Step[]): boolean {
  return JSON.stringify(a.map(stepRequest)) === JSON.stringify(b.map(stepRequest));
}
```

```bash
cd web && npx vitest run src/behaviours/macro.test.ts
```

Expected: `Tests  11 passed (11)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  26 passed (26)` and `Tests  420 passed (420)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/behaviours/macro.test.ts \
  web/src/behaviours/macro.ts
git commit -m "feat(web): macro steps in words, and the bytes they take in the keyboard's memory"
```

### Task 11: Recording a macro from keys typed into the browser

`behaviours/recorder.ts` (`Recording`) turns the keys typed into the browser window into steps. It never touches HID:
- A character becomes text (and runs of characters one text step) only when the US layout types it with that physical key, with or without Shift. The keyboard types macro text as the US layout places it.
- Otherwise the physical key is tapped, wrapped in its modifiers: `LCTL(KC_L)`, `LSFT(KC_TAB)`; `RALT(KC_A)` for AltGr, without the Ctrl that Windows adds. So a German "z" replays correctly.
- Not recorded: a modifier pressed alone, auto-repeat, and unknown keys (they are counted, for the editor to report).

The page side (capture listeners, Esc to stop) is in the macro editor, Task 19.

**Files:**
- Create: `web/src/behaviours/recorder.ts`
- Test: `web/src/behaviours/recorder.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/behaviours/recorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Recording, type KeyPress } from "./recorder";

const press = (code: string, key: string, more: Partial<KeyPress> = {}): KeyPress =>
  ({ code, key, repeat: false, altGraph: false, ...more });

/** Types `text` as a US keyboard would: each character pressed and released */
function type(recording: Recording, text: string) {
  for (const char of text) {
    const code = char === " " ? "Space" : /[a-z]/.test(char) ? `Key${char.toUpperCase()}` : "";
    recording.keydown(press(code, char));
    recording.keyup(press(code, char));
  }
}

describe("Recording", () => {
  it("turns characters into text, other keys and shortcuts into taps", () => {
    const r = new Recording();
    type(r, "git status");
    r.keydown(press("Enter", "Enter"));
    r.keyup(press("Enter", "Enter"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyL", "l"));
    r.keyup(press("KeyL", "l"));
    r.keyup(press("ControlLeft", "Control"));
    type(r, "ls");
    expect(r.steps).toEqual([
      { type: "text", text: "git status" }, { type: "tap", code: "KC_ENTER" }, { type: "tap", code: "LCTL(KC_L)" },
      { type: "text", text: "ls" },
    ]);
  });

  it("types shifted characters as text, and taps Shift with other keys", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keydown(press("Digit1", "!"));
    r.keydown(press("KeyA", "A"));
    r.keydown(press("Tab", "Tab"));
    r.keyup(press("ShiftLeft", "Shift"));
    expect(r.steps).toEqual([{ type: "text", text: "!A" }, { type: "tap", code: "LSFT(KC_TAB)" }]);
  });

  it("taps the key itself when another layout puts another character there", () => {
    // German: the key the US layout has Y on types z
    const r = new Recording();
    r.keydown(press("KeyY", "z"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_Y" }]);
  });

  it("taps AltGr characters as right Alt with the key, without the Ctrl Windows adds", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("AltRight", "AltGraph"));
    r.keydown(press("KeyA", "ą", { altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RALT(KC_A)" }]);
  });

  it("wraps several modifiers in a fixed order", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyT", "T"));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(LSFT(KC_T))" }]);
  });

  it("leaves out modifiers pressed on their own, held keys repeating, and keys it doesn't know", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keyup(press("ShiftLeft", "Shift"));
    r.keydown(press("KeyA", "a"));
    r.keydown(press("KeyA", "a", { repeat: true }));
    r.keydown(press("F20", "F20"));
    r.keydown(press("MediaPlayPause", "MediaPlayPause"));
    expect(r.steps).toEqual([{ type: "text", text: "a" }]);
    expect(r.skipped).toBe(2);
  });
});
```

```bash
cd web && npx vitest run src/behaviours/recorder.test.ts
```

Expected: `Cannot find module './recorder'`.

- [ ] **Step 2: The recording**

Create `web/src/behaviours/recorder.ts`:

```ts
// Recording a macro from the keys typed into the browser window (never from the keyboard's own HID interface).
// Each key pressed becomes a step: characters as text, other keys and shortcuts as taps (Ctrl+L, Shift+Tab).
//
// The keyboard types text as the US layout places it, so a character becomes text only when the US layout types it
// with that key; otherwise (another keyboard layout, AltGr) the key itself is tapped, which the computer then reads as
// it read the recorded key. A modifier pressed on its own is not a step, and waits between keys aren't recorded.

/** The keys a recording knows, by KeyboardEvent.code: the keycode, and for those that type a character with the US
 * layout, that character and the shifted one */
const KEYS: Record<string, [code: string, plain?: string, shifted?: string]> = {
  Enter: ["KC_ENTER"], Escape: ["KC_ESCAPE"], Backspace: ["KC_BSPACE"], Tab: ["KC_TAB"], Space: ["KC_SPACE", " ", " "],
  Minus: ["KC_MINUS", "-", "_"], Equal: ["KC_EQUAL", "=", "+"], BracketLeft: ["KC_LBRACKET", "[", "{"],
  BracketRight: ["KC_RBRACKET", "]", "}"], Backslash: ["KC_BSLASH", "\\", "|"], Semicolon: ["KC_SCOLON", ";", ":"],
  Quote: ["KC_QUOTE", "'", "\""], Backquote: ["KC_GRAVE", "`", "~"], Comma: ["KC_COMMA", ",", "<"],
  Period: ["KC_DOT", ".", ">"], Slash: ["KC_SLASH", "/", "?"], CapsLock: ["KC_CAPSLOCK"], IntlBackslash: ["KC_NONUS_BSLASH"],
  PrintScreen: ["KC_PSCREEN"], ScrollLock: ["KC_SCROLLLOCK"], Pause: ["KC_PAUSE"], Insert: ["KC_INSERT"],
  Home: ["KC_HOME"], PageUp: ["KC_PGUP"], Delete: ["KC_DELETE"], End: ["KC_END"], PageDown: ["KC_PGDOWN"],
  ArrowRight: ["KC_RIGHT"], ArrowLeft: ["KC_LEFT"], ArrowDown: ["KC_DOWN"], ArrowUp: ["KC_UP"], NumLock: ["KC_NUMLOCK"],
  NumpadDivide: ["KC_KP_SLASH"], NumpadMultiply: ["KC_KP_ASTERISK"], NumpadSubtract: ["KC_KP_MINUS"],
  NumpadAdd: ["KC_KP_PLUS"], NumpadEnter: ["KC_KP_ENTER"], NumpadDecimal: ["KC_KP_DOT"], NumpadEqual: ["KC_KP_EQUAL"],
  ContextMenu: ["KC_APPLICATION"],
};
for (const letter of "abcdefghijklmnopqrstuvwxyz") KEYS[`Key${letter.toUpperCase()}`] = [`KC_${letter.toUpperCase()}`, letter, letter.toUpperCase()];
"1234567890".split("").forEach((digit, i) => (KEYS[`Digit${digit}`] = [`KC_${digit}`, digit, "!@#$%^&*()"[i]]));
for (let n = 0; n <= 9; n++) KEYS[`Numpad${n}`] = [`KC_KP_${n}`];
for (let n = 1; n <= 12; n++) KEYS[`F${n}`] = [`KC_F${n}`];

type Modifier = "LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI";

const MODIFIERS: Record<string, Modifier> = {
  ControlLeft: "LCTL", ShiftLeft: "LSFT", AltLeft: "LALT", MetaLeft: "LGUI",
  ControlRight: "RCTL", ShiftRight: "RSFT", AltRight: "RALT", MetaRight: "RGUI",
};
/** the order modifiers wrap a keycode in: LCTL(LSFT(KC_A)) */
const WRAP_ORDER: Modifier[] = ["LCTL", "RCTL", "LSFT", "RSFT", "LALT", "RALT", "LGUI", "RGUI"];

export type Recorded = { type: "text"; text: string } | { type: "tap"; code: string };

/** What a recording reads of a key event */
export type KeyPress = Pick<KeyboardEvent, "code" | "key" | "repeat"> & { altGraph: boolean };

export class Recording {
  readonly steps: Recorded[] = [];
  /** keys pressed that have no keycode here */
  skipped = 0;
  #held = new Set<Modifier>();

  keydown(press: KeyPress): void {
    const modifier = MODIFIERS[press.code];
    if (modifier) {
      this.#held.add(modifier);
      return;
    }
    if (press.repeat) return;
    const known = KEYS[press.code];
    if (!known) {
      this.skipped++;
      return;
    }
    const [code, plain, shifted] = known;
    // AltGr is reported as Ctrl and right Alt on Windows: it is right Alt to the keyboard
    const held = new Set(press.altGraph ? [...this.#held].filter((m) => m !== "LCTL" && m !== "RCTL").concat("RALT") : this.#held);
    const shift = held.has("LSFT") || held.has("RSFT");
    const others = [...held].filter((m) => m !== "LSFT" && m !== "RSFT");
    const us = shift ? shifted : plain;
    if (others.length === 0 && us !== undefined && press.key === us) {
      const last = this.steps.at(-1);
      if (last?.type === "text") last.text += us;
      else this.steps.push({ type: "text", text: us });
      return;
    }
    const wrapped = WRAP_ORDER.filter((m) => held.has(m)).reduceRight((inner, m) => `${m}(${inner})`, code);
    this.steps.push({ type: "tap", code: wrapped });
  }

  keyup(press: Pick<KeyboardEvent, "code">): void {
    const modifier = MODIFIERS[press.code];
    if (modifier) this.#held.delete(modifier);
  }
}
```

```bash
cd web && npx vitest run src/behaviours/recorder.test.ts
```

Expected: `Tests  6 passed (6)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  27 passed (27)` and `Tests  426 passed (426)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/behaviours/recorder.test.ts \
  web/src/behaviours/recorder.ts
git commit -m "feat(web): record a macro from keys typed into the browser"
```

### Task 12: Combo members, the entries a page shows, keycodes described

Three small modules for the pages:
- **`members.ts`:** choosing a combo's keys means choosing the keycodes they have on the base layer.
  - `toggleMember` adds a keycode, or takes it out if it is one already. It refuses an empty or transparent key, and a fifth key (`MAX_COMBO_KEYS = 4`, as Vial allows), saying why.
  - `membersOf` gives a combo's keycodes without its empty slots; `isSet` says whether a combo is set up.
- **`entries.ts`:**
  - `shownEntries`: a page shows the entries set up or used, plus those opened;
  - `freeCombo` and `freeMacro`: the first free entry for "New …" (`freeTapDance` exists already);
  - `behaviourCounts`: the navigation's counts, null where the firmware has none (that section is hidden).
- **`codes.ts`:** `describeCode` describes a recorded keycode from the catalogue, or else asks the server (`LCTL(KC_L)`).

**Files:**
- Create: `web/src/behaviours/members.ts`, `web/src/behaviours/entries.ts`, `web/src/behaviours/codes.ts`
- Test: `web/src/behaviours/members.test.ts`, `web/src/behaviours/entries.test.ts`, `web/src/behaviours/codes.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/behaviours/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { described } from "../analysis/testing";
import { isSet, MAX_COMBO_KEYS, memberProblem, membersOf, toggleMember } from "./members";

const codes = (list: { code: string }[]) => list.map((d) => d.code);

describe("toggleMember", () => {
  it("adds a keycode, and takes it out when chosen again", () => {
    const added = toggleMember([described("KC_K")], described("KC_Y"));
    expect(codes(added.members)).toEqual(["KC_K", "KC_Y"]);
    expect(added.problem).toBeNull();
    expect(codes(toggleMember(added.members, described("KC_K")).members)).toEqual(["KC_Y"]);
  });

  it(`takes at most ${MAX_COMBO_KEYS} keys`, () => {
    const four = ["KC_A", "KC_B", "KC_C", "KC_D"].map(described);
    const refused = toggleMember(four, described("KC_E"));
    expect(codes(refused.members)).toEqual(codes(four));
    expect(refused.problem).toBe("A combo has at most 4 keys: take one out first.");
    // taking one out still works
    expect(toggleMember(four, described("KC_B")).members).toHaveLength(3);
  });

  it("refuses an empty or transparent key", () => {
    expect(toggleMember([], described("KC_NO")).problem).toBe("An empty key can't be part of a combo.");
    expect(toggleMember([], described("KC_TRNS")).problem).toBe("A transparent key can't be part of a combo.");
    expect(memberProblem(undefined)).toBe("An empty key can't be part of a combo.");
    expect(memberProblem(described("MO(1)"))).toBeNull();
  });
});

describe("a combo's members", () => {
  const combo = { index: 0, keys: ["KC_K", "KC_NO", "KC_Y", "KC_NO"].map(described), output: described("KC_ESC") };

  it("leave out its empty slots", () => {
    expect(codes(membersOf(combo))).toEqual(["KC_K", "KC_Y"]);
  });

  it("make it set up, as an output does", () => {
    expect(isSet(combo)).toBe(true);
    expect(isSet({ ...combo, keys: combo.keys.map(() => described("KC_NO")) })).toBe(true);
    expect(isSet({ ...combo, keys: combo.keys.map(() => described("KC_NO")), output: described("KC_NO") })).toBe(false);
  });
});
```

Create `web/src/behaviours/entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { usageOf } from "../analysis/usage";
import { corne, layer, simulatedCorne } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { behaviourCounts, freeCombo, freeMacro, macroIsSet, shownEntries, tapDanceIsSet } from "./entries";

describe("shownEntries", () => {
  it("are those set up or used, and those opened, in order", () => {
    expect(shownEntries(6, (i) => i === 1 || i === 4, [5, 1])).toEqual([1, 4, 5]);
    expect(shownEntries(3, () => false, [])).toEqual([]);
  });
});

describe("free entries", () => {
  const model = simulatedCorne();

  it("are the first combo with nothing in it", () => {
    expect(freeCombo(model)).toBe(2);
    expect(freeCombo({ combos: model.combos.slice(0, 2) })).toBeNull();
  });

  it("are the first macro with no steps that nothing uses", () => {
    const usage = usageOf(model, placeKeyboard(model));
    expect(freeMacro(model, usage)).toBe(2);
    // M2 on a key: in use, though empty
    const used = corne({ layers: [layer({ 0: "M2" }, "KC_NO")], macros: [2, 6, 0, 0] });
    expect(freeMacro(used, usageOf(used, placeKeyboard(used)))).toBe(3);
  });
});

describe("behaviourCounts", () => {
  it("count what is set up, and are null for what the firmware doesn't have", () => {
    const model = simulatedCorne();
    expect(model.tapDance.filter(tapDanceIsSet)).toHaveLength(2);
    expect(model.macros.items.filter(macroIsSet)).toHaveLength(2);
    expect(behaviourCounts(model)).toEqual({ tapDance: 2, combos: 2, macros: 2 });
    expect(behaviourCounts(corne({ layers: [] }))).toEqual({ tapDance: null, combos: null, macros: null });
  });
});
```

Create `web/src/behaviours/codes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { described } from "../analysis/testing";
import type { KeycodeCategory } from "../api/types";
import { catalogued, describeCode } from "./codes";

const catalogue: KeycodeCategory[] = [
  { name: "Basic", templates: [], keycodes: [{ ...described("KC_ENTER"), aliases: ["KC_ENT"] }] },
];

describe("keycodes made in the browser", () => {
  it("are found in the catalogue by name or alias", () => {
    expect(catalogued(catalogue, "KC_ENT")?.code).toBe("KC_ENTER");
    expect(catalogued(catalogue, "KC_ENTER")?.code).toBe("KC_ENTER");
    expect(catalogued(catalogue, "LCTL(KC_L)")).toBeUndefined();
  });

  it("are described by the server when the catalogue doesn't have them", async () => {
    const parse = vi.fn(async (code: string) => described(code));
    expect((await describeCode(catalogue, "KC_ENTER", parse)).code).toBe("KC_ENTER");
    expect(parse).not.toHaveBeenCalled();
    expect((await describeCode(catalogue, "LCTL(KC_L)", parse)).code).toBe("LCTL(KC_L)");
    expect(parse).toHaveBeenCalledWith("LCTL(KC_L)");
  });
});
```

```bash
cd web && npx vitest run src/behaviours/members.test.ts src/behaviours/entries.test.ts src/behaviours/codes.test.ts
```

Expected: `Test Files  3 failed (3)` and `Cannot find module './members'`.

- [ ] **Step 2: The modules**

Create `web/src/behaviours/members.ts`:

```ts
// Choosing a combo's keys. A combo is a list of keycodes (Vial has room for 4), so choosing a key means choosing the
// keycode it has on the base layer; choosing it again takes it out.
import type { Combo, Described } from "../api/types";

export const MAX_COMBO_KEYS = 4;

/** Why a keycode can't be one of a combo's, or null: an empty or transparent key does nothing to press */
export function memberProblem(d: Described | undefined): string | null {
  if (!d || d.kind === "none") return "An empty key can't be part of a combo.";
  if (d.kind === "transparent") return "A transparent key can't be part of a combo.";
  return null;
}

/** The members with the keycode added, or taken out if it is one already; refused past MAX_COMBO_KEYS */
export function toggleMember(members: Described[], d: Described): { members: Described[]; problem: string | null } {
  if (members.some((m) => m.code === d.code)) return { members: members.filter((m) => m.code !== d.code), problem: null };
  const problem = memberProblem(d) ?? (members.length >= MAX_COMBO_KEYS
    ? `A combo has at most ${MAX_COMBO_KEYS} keys: take one out first.` : null);
  return problem ? { members, problem } : { members: [...members, d], problem: null };
}

/** A combo's keycodes, its empty slots left out */
export function membersOf(combo: Combo): Described[] {
  return combo.keys.filter((k) => k.kind !== "none");
}

/** Whether a combo is set up: it has a keycode or an output */
export function isSet(combo: Combo): boolean {
  return combo.output.kind !== "none" || combo.keys.some((k) => k.kind !== "none");
}
```

Create `web/src/behaviours/entries.ts`:

```ts
// Which tap dances, combos and macros their pages show, and which are free for a new one. The keyboard has a fixed
// number of each (often many more than are used): a page shows those set up or used, and those opened.
import type { Usage } from "../analysis/usage";
import type { KeyboardModel, Macro, TapDance } from "../api/types";
import { tapDanceSlots } from "../keymap/tapdance";
import { isSet as comboIsSet } from "./members";

export function tapDanceIsSet(td: TapDance): boolean {
  return tapDanceSlots(td).some((slot) => slot.action.kind !== "none");
}

export function macroIsSet(macro: Macro): boolean {
  return macro.actions.length > 0;
}

/** The indexes of the entries to show as cards, in order: those `shown` says, and those opened */
export function shownEntries(count: number, shown: (index: number) => boolean, opened: Iterable<number>): number[] {
  const open = new Set(opened);
  return Array.from({ length: count }, (_, i) => i).filter((i) => shown(i) || open.has(i));
}

/** The first combo with no keycode and no output, or null */
export function freeCombo(model: Pick<KeyboardModel, "combos">): number | null {
  return model.combos.find((c) => !comboIsSet(c))?.index ?? null;
}

/** The first macro with no steps that nothing uses, or null */
export function freeMacro(model: Pick<KeyboardModel, "macros">, usage: Usage): number | null {
  return model.macros.items.find((m) => !macroIsSet(m) && (usage.macros[m.index]?.length ?? 0) === 0)?.index ?? null;
}

/** How many of each are set up, for the navigation; null where the firmware has none (the section is hidden) */
export function behaviourCounts(model: Pick<KeyboardModel, "tapDance" | "combos" | "macros">):
  { tapDance: number | null; combos: number | null; macros: number | null } {
  return {
    tapDance: model.tapDance.length > 0 ? model.tapDance.filter(tapDanceIsSet).length : null,
    combos: model.combos.length > 0 ? model.combos.filter(comboIsSet).length : null,
    macros: model.macros.count > 0 ? model.macros.items.filter(macroIsSet).length : null,
  };
}
```

Create `web/src/behaviours/codes.ts`:

```ts
// Keycodes as the server describes them, for steps and members made in the browser (a recorded key).
import type { Described, KeycodeCategory } from "../api/types";

/** The catalogue's description of a keycode, by its name or one of its aliases, or undefined */
export function catalogued(catalogue: KeycodeCategory[], code: string): Described | undefined {
  for (const category of catalogue) {
    const found = category.keycodes.find((k) => k.code === code || k.aliases.includes(code));
    if (found) return found;
  }
  return undefined;
}

/** A keycode described: from the catalogue, or else by the server (`parse`, e.g. for "LCTL(KC_L)") */
export async function describeCode(
  catalogue: KeycodeCategory[],
  code: string,
  parse: (expression: string) => Promise<Described>,
): Promise<Described> {
  return catalogued(catalogue, code) ?? parse(code);
}
```

```bash
cd web && npx vitest run src/behaviours/members.test.ts src/behaviours/entries.test.ts src/behaviours/codes.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  11 passed (11)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  30 passed (30)` and `Tests  437 passed (437)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/behaviours/codes.test.ts \
  web/src/behaviours/codes.ts \
  web/src/behaviours/entries.test.ts \
  web/src/behaviours/entries.ts \
  web/src/behaviours/members.test.ts \
  web/src/behaviours/members.ts
git commit -m "feat(web): choosing a combo's keys, the entries each page shows, keycodes described in the browser"
```

### Task 13: A key's combo marks: an underline, or dots that fit

`keyboard/marks.ts` decides how a key shows the combos it is part of, along its bottom edge:
- in one combo, an underline in that combo's colour;
- in several, one dot per combo in its colour, as many as fit, then "+n" for the rest.

`dotSizes(u)` keeps the dots at least 4 px wide on the smallest keys: `max(4, 0.11u)`, with a gap of 0.6 dot.

**Files:**
- Create: `web/src/keyboard/marks.ts`
- Test: `web/src/keyboard/marks.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/keyboard/marks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { comboMarks, dotSizes } from "./marks";

const sizes = { dot: 6, gap: 4, more: 14 };

describe("comboMarks", () => {
  it("is nothing for a key in no combo, and an underline in the combo's colour for a key in one", () => {
    expect(comboMarks([], 40, sizes)).toEqual({ type: "none" });
    expect(comboMarks([3], 40, sizes)).toEqual({ type: "line", colour: 3 });
  });

  it("is a dot per combo for a key in several", () => {
    expect(comboMarks([0, 2], 40, sizes)).toEqual({ type: "dots", colours: [0, 2], more: 0 });
    // 40 px hold four dots of 6 px with 4 px between them, exactly
    expect(comboMarks([0, 1, 2, 3], 36, sizes)).toEqual({ type: "dots", colours: [0, 1, 2, 3], more: 0 });
  });

  it("shows as many dots as fit next to \"+n\" for the others", () => {
    // 36 px: four dots fit, but not five; with "+n" (14 px) two dots fit
    expect(comboMarks([0, 1, 2, 3, 4], 36, sizes)).toEqual({ type: "dots", colours: [0, 1], more: 3 });
    expect(comboMarks([0, 1, 2], 12, sizes)).toEqual({ type: "dots", colours: [], more: 3 });
  });
});

describe("dotSizes", () => {
  it("grows with the key, never below 4 px a dot", () => {
    expect(dotSizes(20).dot).toBe(4);
    expect(dotSizes(72).dot).toBeCloseTo(7.92);
    expect(dotSizes(72).gap).toBeCloseTo(4.752);
  });
});
```

```bash
cd web && npx vitest run src/keyboard/marks.test.ts
```

Expected: `Cannot find module './marks'`.

- [ ] **Step 2: The marks**

Create `web/src/keyboard/marks.ts`:

```ts
// How a key shows the combos it is part of, along its bottom edge: one combo, an underline in the combo's colour;
// several, a row of dots, one per combo in its colour, as many as fit, then "+n" for the rest.

export type ComboMarks =
  | { type: "none" }
  | { type: "line"; colour: number }
  | { type: "dots"; colours: number[]; more: number };

export interface DotSizes {
  /** a dot's diameter, in pixels */
  dot: number;
  /** the space between two dots */
  gap: number;
  /** the width "+n" takes, its space before it included */
  more: number;
}

/** The marks of a key in the combos of these colours (palette indexes, one per combo, in combo order), along a bottom
 * edge `width` pixels wide */
export function comboMarks(colours: number[], width: number, sizes: DotSizes): ComboMarks {
  if (colours.length === 0) return { type: "none" };
  if (colours.length === 1) return { type: "line", colour: colours[0] };
  const step = sizes.dot + sizes.gap;
  const fit = Math.max(0, Math.floor((width + sizes.gap) / step));
  if (colours.length <= fit) return { type: "dots", colours, more: 0 };
  const shown = Math.max(0, Math.floor((width - sizes.more + sizes.gap) / step));
  return { type: "dots", colours: colours.slice(0, shown), more: colours.length - shown };
}

/** Dot sizes for a key of `u` pixels a key unit: the dots stay at least 4 px wide on the smallest keys */
export function dotSizes(u: number): DotSizes {
  const dot = Math.max(4, u * 0.11);
  return { dot, gap: dot * 0.6, more: Math.max(12, u * 0.32) };
}
```

```bash
cd web && npx vitest run src/keyboard/marks.test.ts
```

Expected: `Tests  4 passed (4)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  31 passed (31)` and `Tests  441 passed (441)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/keyboard/marks.test.ts \
  web/src/keyboard/marks.ts
git commit -m "feat(web): a key's combo marks: an underline, or a row of dots that fits the key"
```

### Task 14: Each combo in its own colour on its keys

This replaces the single red underline everywhere:
- **Analysis.**
  - `comboMarksOn` replaces `comboKeysOn`: each key that is part of a combo on a layer, with the combos it is part of, in combo order. A combo that lists a keycode twice never fires, so it marks no keys (a phase 3 follow-up).
  - `comboColours` gives each combo a palette index, greedy in combo order: the first colour no earlier combo sharing a layer with it has; past the palette, combo number k gets `k % 6`.
  - `analyse()` keeps `comboMarks` and `comboColours`. `comboMarksOf` gives each placed key its combos and their colours on a layer.
  - `comboMarkLabel` is what a key's label says: " · in combo 2", " · in combos 0 and 2".
- **Palette.** `app.css` defines `--combo-0` to `--combo-5` (red, blue, teal, magenta, green, violet) for light and dark: at least 3:1 on every key face, and no amber, the find box's colour.
- **The drawing.**
  - `Key.svelte` draws the marks (`marks.ts`) in their colours and keeps their space at the bottom, so a legend never covers them.
  - It also gains what Tasks 16 and 18 use: a coloured `ring` (drawn as the find ring is), `faded` keys, and `chosen`, which sets `aria-pressed` on a key to choose.
  - `Keyboard.svelte` passes these on, aligned with the placement. `Encoder.svelte` can be faded too.
- **Where the colours show:** the Edit view, the Overview's cards, the legend (an underline, and two dots for "in several combos"), and the Inspector's combo entries.
  - The Inspector's entries are buttons from Task 18 on.
  - `ComboList` also says "still fire" only for combos that can (a phase 3 follow-up).

The Overview's e2e test now checks one colour a combo and a different one for each.

**Files:**
- Modify: `web/src/analysis/combos.ts`, `web/src/analysis/analysis.ts`, `web/src/analysis/phrases.ts`, `web/src/app.css`, `web/src/keyboard/Key.svelte`, `web/src/keyboard/Keyboard.svelte`, `web/src/keyboard/Encoder.svelte`, `web/src/keymap/KindLegend.svelte`, `web/src/keymap/LayerCard.svelte`, `web/src/keymap/Overview.svelte`, `web/src/keymap/ComboList.svelte`, `web/src/keymap/Inspector.svelte`, `web/src/keymap/KeymapPage.svelte`
- Test: `web/src/analysis/combos.test.ts`, `web/src/analysis/analysis.test.ts`, `web/src/analysis/phrases.test.ts`, `web/e2e/overview.spec.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/analysis/combos.test.ts`:

```diff
diff --git a/web/src/analysis/combos.test.ts b/web/src/analysis/combos.test.ts
--- a/web/src/analysis/combos.test.ts
+++ b/web/src/analysis/combos.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import { placeKeyboard } from "../keyboard/geometry";
-import { codesOn, comboKeysOn, comboLayers, combosOf, combosUsing } from "./combos";
+import { codesOn, comboColours, comboLayers, comboMarksOn, combosOf, combosUsing } from "./combos";
 import { effectiveAt } from "./effective";
 import { AT, corne, layer, simulatedCorne } from "./testing";

@@ -60,21 +60,41 @@ describe("combo keys on a layer", () => {
   const combos = combosOf(model, placement);
   const codes = model.layers.map((_, l) => codesOn(model, placement, l));

-  it("are the keys with a combo's keycode", () => {
-    const members = [AT.grid(2, 9), AT.grid(2, 10), AT.grid(2, 2), AT.grid(2, 3)].map((i) => `key:${i}`).sort();
-    expect([...comboKeysOn(combos, codes[0], model, 0)].sort()).toEqual(members);
+  it("are the keys with a combo's keycode, each with its combos", () => {
+    const marks = comboMarksOn(combos, codes[0], model, 0);
+    expect(marks).toEqual(new Map([
+      [`key:${AT.grid(2, 9)}`, [0]], [`key:${AT.grid(2, 10)}`, [0]], [`key:${AT.grid(2, 2)}`, [1]],
+      [`key:${AT.grid(2, 3)}`, [1]],
+    ]));
+  });
+
+  it("list every combo a key is part of, in combo order", () => {
+    const shared = corne({
+      layers: [layer({ 0: "KC_A", 1: "KC_B", 2: "KC_C" }, "KC_NO")],
+      combos: [{ keys: ["KC_B", "KC_C"], output: "KC_X" }, { keys: ["KC_A", "KC_B"], output: "KC_Y" }],
+    });
+    const p = placeKeyboard(shared);
+    const marks = comboMarksOn(combosOf(shared, p), codesOn(shared, p, 0), shared, 0);
+    expect(marks.get("key:1")).toEqual([0, 1]);
+    expect(marks.get("key:0")).toEqual([1]);
+  });
+
+  it("leave out the keys of a combo that never fires, as it lists a keycode twice", () => {
+    const twice = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO")], combos: [{ keys: ["KC_A", "KC_A"], output: "KC_B" }] });
+    const p = placeKeyboard(twice);
+    expect(comboMarksOn(combosOf(twice, p), codesOn(twice, p, 0), twice, 0).size).toBe(0);
   });

   it("leave out transparent keys, though the combo goes through them", () => {
     // layer 1 is transparent there: the keycodes fall through, but the keys aren't marked
     expect(codes[1].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
-    expect(comboKeysOn(combos, codes[1], model, 1).size).toBe(0);
+    expect(comboMarksOn(combos, codes[1], model, 1).size).toBe(0);
     const own = corne({
       layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({ 0: "KC_A" })],
       combos: [{ keys: ["KC_A", "KC_B"], output: "KC_X" }],
     });
     const p = placeKeyboard(own);
-    expect([...comboKeysOn(combosOf(own, p), codesOn(own, p, 1), own, 1)]).toEqual(["key:0"]);
+    expect([...comboMarksOn(combosOf(own, p), codesOn(own, p, 1), own, 1).keys()]).toEqual(["key:0"]);
   });

   it("can fire on the layers that have all its keycodes", () => {
@@ -98,6 +118,50 @@ describe("combo keys on a layer", () => {
   });
 });

+describe("comboColours", () => {
+  /** combos of two keycodes each, KC_A + KC_B and so on, all on the base layer; `on` gives a combo's keys layer 1 */
+  function colours(count: number, size: number, on: number[] = []) {
+    const letters = "ABCDEFGHIJKLMNOPQRST";
+    const codes = (i: number) => [`KC_${letters[2 * i]}`, `KC_${letters[2 * i + 1]}`];
+    const base: Record<number, string> = {};
+    const upper: Record<number, string> = {};
+    for (let i = 0; i < count; i++) {
+      codes(i).forEach((code, k) => {
+        base[2 * i + k] = on.includes(i) ? "KC_NO" : code;
+        upper[2 * i + k] = on.includes(i) ? code : "KC_NO";
+      });
+    }
+    const model = corne({
+      layers: [layer(base, "KC_NO"), layer(upper, "KC_NO")],
+      combos: Array.from({ length: count }, (_, i) => ({ keys: codes(i), output: "KC_X" })),
+    });
+    const p = placeKeyboard(model);
+    const combos = combosOf(model, p);
+    const marks = model.layers.map((_, l) => comboMarksOn(combos, codesOn(model, p, l), model, l));
+    return [...comboColours(combos, marks, size).values()];
+  }
+
+  it("gives combos on the same layer different colours, in palette order", () => {
+    expect(colours(3, 6)).toEqual([0, 1, 2]);
+  });
+
+  it("lets combos on different layers share a colour", () => {
+    // combos 1 and 2 have their keys on layer 1 only: they start the palette again
+    expect(colours(4, 6, [1, 2])).toEqual([0, 0, 1, 1]);
+  });
+
+  it("repeats colours in palette order once they are all taken", () => {
+    expect(colours(5, 3)).toEqual([0, 1, 2, 0, 1]);
+  });
+
+  it("gives a combo with no keys anywhere the first colour", () => {
+    const model = corne({ layers: [layer({}, "KC_NO")], combos: [{ keys: ["KC_Q"], output: "KC_X" }] });
+    const p = placeKeyboard(model);
+    const combos = combosOf(model, p);
+    expect([...comboColours(combos, [comboMarksOn(combos, codesOn(model, p, 0), model, 0)])]).toEqual([[0, 0]]);
+  });
+});
+
 describe("combosUsing", () => {
   const model = corne({
     layers: [
```

Apply to `web/src/analysis/analysis.test.ts`:

```diff
diff --git a/web/src/analysis/analysis.test.ts b/web/src/analysis/analysis.test.ts
--- a/web/src/analysis/analysis.test.ts
+++ b/web/src/analysis/analysis.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import { placeKeyboard } from "../keyboard/geometry";
-import { analyse } from "./analysis";
+import { analyse, comboMarksOf } from "./analysis";
 import { AT, corne, layer, simulatedCorne } from "./testing";

 describe("analyse", () => {
@@ -11,7 +11,8 @@ describe("analyse", () => {
     expect(analysis.combos.map((c) => c.index)).toEqual([0, 1]);
     expect(analysis.codes).toHaveLength(4);
     expect(analysis.codes[0].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
-    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([4, 0, 0, 0]);
+    expect(analysis.comboMarks.map((keys) => keys.size)).toEqual([4, 0, 0, 0]);
+    expect([...analysis.comboColours]).toEqual([[0, 0], [1, 1]]);
     expect(analysis.positions.get(`key:${AT.rightOuterThumb}`)).toBe("right outer thumb");
     expect(analysis.usage.tapDances[0]).toEqual([{ type: "key", layer: 0, ref: { kind: "key", index: AT.leftInnerThumb } }]);
     expect(analysis.unused).toEqual({ tapDances: [1], macros: [1] });
@@ -27,7 +28,7 @@ describe("analyse", () => {
     expect(analysis.reach[1].ways.map((w) => w.via.type === "key" && w.via.action.code)).toEqual(["LT1(KC_SPC)"]);
     expect(analysis.reach.flatMap((r) => r.ways.flatMap((w) => w.from)).every((l) => l < 2)).toBe(true);
     expect(analysis.codes).toHaveLength(2);
-    expect(analysis.comboKeys).toHaveLength(2);
+    expect(analysis.comboMarks).toHaveLength(2);
   });

   it("covers 8 layers, as the owner's W-CORNE has, with layers that nothing reaches", () => {
@@ -43,6 +44,18 @@ describe("analyse", () => {
     expect(analysis.reach).toHaveLength(8);
     expect(analysis.reach.map((r) => r.reachable)).toEqual([true, true, true, true, false, true, false, false]);
     expect(analysis.reach[2].ways.map((w) => w.via.type)).toEqual(["combo"]);
-    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
+    expect(analysis.comboMarks.map((keys) => keys.size)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
+  });
+});
+
+describe("comboMarksOf", () => {
+  it("gives each placed key its combos and their colours on a layer", () => {
+    const model = simulatedCorne();
+    const placement = placeKeyboard(model);
+    const marks = comboMarksOf(analyse(model, placement), placement, 0);
+    const k = placement.items.findIndex((i) => i.index === AT.grid(2, 9));
+    const m = placement.items.findIndex((i) => i.index === AT.grid(2, 2));
+    expect([marks.combos[k], marks.colours[k], marks.combos[m], marks.colours[m]]).toEqual([[0], [0], [1], [1]]);
+    expect(marks.combos.filter((c) => c.length > 0)).toHaveLength(4);
   });
 });
```

Apply to `web/src/analysis/phrases.test.ts`:

```diff
diff --git a/web/src/analysis/phrases.test.ts b/web/src/analysis/phrases.test.ts
--- a/web/src/analysis/phrases.test.ts
+++ b/web/src/analysis/phrases.test.ts
@@ -4,7 +4,7 @@ import { placeKeyboard } from "../keyboard/geometry";
 import { namesOf } from "../keyboard/labels";
 import { codesOn, combosOf, combosUsing } from "./combos";
 import {
-  comboName, comboUseLabel, memberName, missingPartners, tapName, unreachedReason, wayDetail, wayLabel,
+  comboMarkLabel, comboName, comboUseLabel, memberName, missingPartners, tapName, unreachedReason, wayDetail, wayLabel,
   type PhraseContext,
 } from "./phrases";
 import { positionNames } from "./positions";
@@ -331,3 +331,11 @@ describe("comboUseLabel and missingPartners", () => {
     ]);
   });
 });
+
+describe("comboMarkLabel", () => {
+  it("names the combos a key is part of", () => {
+    expect(comboMarkLabel([])).toBe("");
+    expect(comboMarkLabel([2])).toBe(" · in combo 2");
+    expect(comboMarkLabel([0, 1, 3])).toBe(" · in combos 0, 1 and 3");
+  });
+});
```

```bash
cd web && npx vitest run src/analysis/combos.test.ts src/analysis/analysis.test.ts src/analysis/phrases.test.ts
```

Expected: `Test Files  3 failed (3)` and `Tests  13 failed | 39 passed (52)` and `comboMarksOn is not a function`.

- [ ] **Step 2: Marks and colours in the analysis**

Apply to `web/src/analysis/combos.ts`:

```diff
diff --git a/web/src/analysis/combos.ts b/web/src/analysis/combos.ts
--- a/web/src/analysis/combos.ts
+++ b/web/src/analysis/combos.ts
@@ -71,24 +71,55 @@ export function comboLayers(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[
   return layerCodes.flatMap((codes, layer) => (combo.members.every((m) => codes.has(m.action.code)) ? [layer] : []));
 }

-/** The keys (by refId) that are part of a combo on a layer: those whose keycode there is one of a combo's. A
- * transparent key isn't marked (it would mark every empty layer); the combo goes through it all the same.
- * codes must be the same layer's: codesOn(model, placement, layer). */
-export function comboKeysOn(
+/** The keys that are part of a combo on a layer, by refId, each with the combos (their indexes, in order) it is part
+ * of: the keys whose keycode there is one of a combo's. A transparent key isn't marked (it would mark every empty
+ * layer); the combo goes through it all the same. Nor are the keys of a combo that lists a keycode twice: it never
+ * fires (see repeatedCodes). codes must be the same layer's: codesOn(model, placement, layer). */
+export function comboMarksOn(
   combos: ComboInfo[],
   codes: Map<string, KeyRef[]>,
   model: Pick<KeyboardModel, "layers">,
   layer: number,
-): Set<string> {
-  const keys = new Set<string>();
+): Map<string, number[]> {
+  const marks = new Map<string, number[]>();
   for (const combo of combos) {
+    if (repeatedCodes(combo).length > 0) continue;
     for (const member of combo.members) {
       for (const ref of codes.get(member.action.code) ?? []) {
-        if (actionAt(model, layer, ref)?.kind !== "transparent") keys.add(refId(ref));
+        if (actionAt(model, layer, ref)?.kind === "transparent") continue;
+        const id = refId(ref);
+        const on = marks.get(id) ?? [];
+        if (!on.includes(combo.index)) on.push(combo.index);
+        marks.set(id, on);
       }
     }
   }
-  return keys;
+  return marks;
+}
+
+/** How many colours combos are marked in (app.css: --combo-0 to --combo-5) */
+export const COMBO_COLOURS = 6;
+
+/** The colour of each combo (an index into the palette), by combo index: the same everywhere it is shown. Different
+ * combos with keys on the same layer get different colours: in combo order, each takes the palette's first colour
+ * that no combo before it with keys on one of its layers has. With more such combos than colours, colours repeat
+ * in palette order: the combo takes the colour at its place among the set combos, round the palette. marks: by
+ * layer, as comboMarksOn gives them. */
+export function comboColours(combos: ComboInfo[], marks: Map<string, number[]>[], size = COMBO_COLOURS): Map<number, number> {
+  const layersOf = new Map<number, Set<number>>(combos.map((c) => [c.index, new Set<number>()]));
+  marks.forEach((onLayer, layer) => {
+    for (const indexes of onLayer.values()) for (const index of indexes) layersOf.get(index)?.add(layer);
+  });
+  const colours = new Map<number, number>();
+  combos.forEach((combo, rank) => {
+    const layers = layersOf.get(combo.index) ?? new Set<number>();
+    const taken = new Set(combos.slice(0, rank)
+      .filter((other) => [...(layersOf.get(other.index) ?? [])].some((l) => layers.has(l)))
+      .map((other) => colours.get(other.index)));
+    const free = Array.from({ length: size }, (_, c) => c).find((c) => !taken.has(c));
+    colours.set(combo.index, free ?? rank % size);
+  });
+  return colours;
 }

 export interface ComboUse {
```

Apply to `web/src/analysis/analysis.ts`:

```diff
diff --git a/web/src/analysis/analysis.ts b/web/src/analysis/analysis.ts
--- a/web/src/analysis/analysis.ts
+++ b/web/src/analysis/analysis.ts
@@ -2,8 +2,8 @@
 // so it follows every edit at once.
 import type { KeyboardModel } from "../api/types";
 import type { Placement } from "../keyboard/geometry";
-import type { KeyRef } from "../keyboard/refs";
-import { codesOn, comboKeysOn, combosOf, type ComboInfo } from "./combos";
+import { refId, type KeyRef } from "../keyboard/refs";
+import { codesOn, comboColours, comboMarksOn, combosOf, type ComboInfo } from "./combos";
 import { positionNames } from "./positions";
 import { layerReach, type LayerReach } from "./reach";
 import { unusedOf, usageOf, type Unused, type Usage } from "./usage";
@@ -17,8 +17,10 @@ export interface Analysis {
   combos: ComboInfo[];
   /** by layer: each keycode and the keys that have it there */
   codes: Map<string, KeyRef[]>[];
-  /** by layer: the keys (refIds) that are part of a combo there */
-  comboKeys: Set<string>[];
+  /** by layer: the keys (refIds) that are part of a combo there, each with the combos (indexes) it is part of */
+  comboMarks: Map<string, number[]>[];
+  /** each set combo's colour (a palette index), by combo index */
+  comboColours: Map<number, number>;
   usage: Usage;
   unused: Unused;
 }
@@ -27,13 +29,22 @@ export function analyse(model: KeyboardModel, placement: Placement): Analysis {
   const combos = combosOf(model, placement);
   const codes = model.layers.map((_, layer) => codesOn(model, placement, layer));
   const usage = usageOf(model, placement);
+  const comboMarks = codes.map((c, layer) => comboMarksOn(combos, c, model, layer));
   return {
     positions: positionNames(placement),
     reach: layerReach(model, placement),
     combos,
     codes,
-    comboKeys: codes.map((c, layer) => comboKeysOn(combos, c, model, layer)),
+    comboMarks,
+    comboColours: comboColours(combos, comboMarks),
     usage,
     unused: unusedOf(model, usage),
   };
 }
+
+/** For each placed key, the combos it is part of on a layer (their indexes) and their colours */
+export function comboMarksOf(analysis: Pick<Analysis, "comboMarks" | "comboColours">, placement: Placement, layer: number):
+  { combos: number[][]; colours: number[][] } {
+  const combos = placement.items.map((item) => analysis.comboMarks[layer]?.get(refId(item)) ?? []);
+  return { combos, colours: combos.map((list) => list.map((i) => analysis.comboColours.get(i) ?? 0)) };
+}
```

Apply to `web/src/analysis/phrases.ts`:

```diff
diff --git a/web/src/analysis/phrases.ts b/web/src/analysis/phrases.ts
--- a/web/src/analysis/phrases.ts
+++ b/web/src/analysis/phrases.ts
@@ -264,3 +264,9 @@ export function foundLabel(found: Found, ctx: PhraseContext): string {
       return `macro ${found.macro} presses ${howText(found.how, found.action)}`;
   }
 }
+
+/** What a key's combo marks say, after its name: " · in combo 0", " · in combos 0 and 2", or "" */
+export function comboMarkLabel(combos: number[]): string {
+  if (combos.length === 0) return "";
+  return combos.length === 1 ? ` · in combo ${combos[0]}` : ` · in combos ${andList(combos.map(String))}`;
+}
```

```bash
cd web && npx vitest run src/analysis/combos.test.ts src/analysis/analysis.test.ts src/analysis/phrases.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  52 passed (52)`.

- [ ] **Step 3: The palette**

Apply to `web/src/app.css`:

```diff
diff --git a/web/src/app.css b/web/src/app.css
--- a/web/src/app.css
+++ b/web/src/app.css
@@ -33,8 +33,14 @@
   --tone-layer: #1872e8;
   --tone-tap-dance: #9a43cf;
   --tone-macro: #e07f00;
-  /* the underline of a key that is part of a combo */
-  --combo: #e8264a;
+  /* each combo's colour, on the keys it is made of (analysis/combos.ts comboColours): at least 3:1 on every key
+     face, and never the find box's amber. In order: red, blue, teal, magenta, green, violet */
+  --combo-0: #d0103a;
+  --combo-1: #1d5bd8;
+  --combo-2: #00796b;
+  --combo-3: #b0168f;
+  --combo-4: #4c7d0a;
+  --combo-5: #7b3fe4;
   /* keys that produce what the find box looks for: a dark amber, at least 3:1 against every key face and the board */
   --find: #9e6c00;
   /* how much of a kind's colour goes into a key's face and outline */
@@ -88,7 +94,12 @@
   --tone-layer: #5ba2ff;
   --tone-tap-dance: #c98af2;
   --tone-macro: #ffaa3d;
-  --combo: #ff6685; /* 3:1 or more on every key fill, macro and modifier keys included */
+  --combo-0: #ff6685;
+  --combo-1: #6aa8ff;
+  --combo-2: #2fd3c0;
+  --combo-3: #f472d0;
+  --combo-4: #a3d65a;
+  --combo-5: #b69bff;
   --find: #ffcc33;
   --tone-fill: 22%;
   --tone-line: 70%;
@@ -130,7 +141,12 @@
     --tone-layer: #5ba2ff;
     --tone-tap-dance: #c98af2;
     --tone-macro: #ffaa3d;
-    --combo: #ff6685; /* 3:1 or more on every key fill, macro and modifier keys included */
+    --combo-0: #ff6685;
+    --combo-1: #6aa8ff;
+    --combo-2: #2fd3c0;
+    --combo-3: #f472d0;
+    --combo-4: #a3d65a;
+    --combo-5: #b69bff;
     --find: #ffcc33;
     --tone-fill: 22%;
     --tone-line: 70%;
```

- [ ] **Step 4: The drawing**

Apply to `web/src/keyboard/Key.svelte`:

```diff
diff --git a/web/src/keyboard/Key.svelte b/web/src/keyboard/Key.svelte
--- a/web/src/keyboard/Key.svelte
+++ b/web/src/keyboard/Key.svelte
@@ -1,6 +1,7 @@
 <script lang="ts">
   import type { PlacedKey } from "./geometry";
   import { compactLegendSize, legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
+  import { comboMarks, dotSizes } from "./marks";
   import { refId } from "./refs";
   import { legendFont } from "./textWidth.svelte";

@@ -14,10 +15,17 @@
     label: string;
     /** reaches the key with Tab (the selected one, or the first) */
     focusable: boolean;
-    /** part of a combo: underlined */
-    combo?: boolean;
+    /** the colours (palette indexes) of the combos it is part of, in combo order: one is an underline, several a row
+     * of dots */
+    combos?: number[];
     /** produces what the find box looks for: highlighted */
     found?: boolean;
+    /** a ring around the key in this colour (a CSS colour), as the found ring is drawn: marks the keys of a combo */
+    ring?: string | null;
+    /** drawn faintly: a key that doesn't matter here */
+    faded?: boolean;
+    /** a key to choose (pressed) or not: aria-pressed says this instead of whether it is selected */
+    chosen?: boolean;
     /** a key to click; otherwise only a picture (the keyboard as a whole is labelled) */
     interactive?: boolean;
     /** a small key showing its main legend only, as large as it fits */
@@ -26,9 +34,12 @@
   }

   let {
-    item, face, u, selected, label, focusable, combo = false, found = false, interactive = true, compact = false, onselect,
+    item, face, u, selected, label, focusable, combos = [], found = false, ring = null, faded = false, chosen,
+    interactive = true, compact = false, onselect,
   }: Props = $props();

+  const combo = $derived(combos.length > 0);
+
   const GAP = 0.09;
   /** space around the labels, in key units */
   const PAD = 0.04;
@@ -54,12 +65,38 @@
     return shapes.map((s) => ({ x: s.x * u + g / 2, y: s.y * u + g / 2, w: s.w * u - g, h: s.h * u - g }));
   });

-  // the legends fit inside the primary rectangle, less the gap between keys and the padding
+  // a line along the bottom of the primary rectangle, inside its outline: where the combo marks go
+  const underline = $derived.by(() => {
+    const r = rects[0];
+    const thickness = Math.max(2, u * 0.07);
+    const inset = Math.max(2, u * 0.12);
+    const bottom = r.y + r.h - Math.max(1.5, u * 0.05);
+    return { x: r.x + inset, y: bottom - thickness, w: Math.max(0, r.w - 2 * inset), h: thickness, bottom };
+  });
+  const dots = $derived(dotSizes(u));
+  const marks = $derived(comboMarks(combos, underline.w, dots));
+  // the marks keep their own space at the bottom of the key, which the legends don't go into
+  const markSpace = $derived(
+    marks.type === "none" ? 0 : rects[0].y + rects[0].h - (marks.type === "line" ? underline.y : underline.bottom - dots.dot),
+  );
+  const dotRow = $derived.by(() => {
+    if (marks.type !== "dots") return null;
+    const step = dots.dot + dots.gap;
+    const width = marks.colours.length * step - dots.gap + (marks.more > 0 ? dots.more : 0);
+    const left = underline.x + (underline.w - width) / 2;
+    const cy = underline.bottom - dots.dot / 2;
+    return {
+      dots: marks.colours.map((colour, i) => ({ cx: left + i * step + dots.dot / 2, cy, colour })),
+      more: marks.more > 0 ? { x: left + width, y: cy, text: `+${marks.more}` } : null,
+    };
+  });
+
+  // the legends fit inside the primary rectangle, less the gap between keys, the padding and the combo marks
   // a small key keeps less space around its only legend
   const pad = $derived(compact ? COMPACT_PAD : PAD);
   const sizes = $derived.by(() => {
     const width = (item.w - GAP - 2 * pad) * u;
-    const height = (item.h - GAP - 2 * pad) * u;
+    const height = (item.h - GAP - 2 * pad) * u - markSpace;
     return compact
       ? { main: compactLegendSize(face.main, width, height, u, legendFont.width), shifted: 0, hold: 0, holdLines: 0 }
       : legendSizes(face, width, height, u, legendFont.width);
@@ -68,7 +105,7 @@
   // a found key also gets a ring outside its outline, apart from it: found shows by shape as well as colour, on keys
   // of any kind and next to the selection's outline (5 px wide, so 2.5 px out). One shape: the key grown by the gap
   // and the ring, less the key grown by the gap (a mask), so that the two rectangles of an ISO Enter get one ring
-  const ring = $derived.by(() => {
+  const ringShape = $derived.by(() => {
     const grow = (r: { x: number; y: number; w: number; h: number }, by: number) => ({
       x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by, rx: ROUND * u + by,
     });
@@ -97,35 +134,29 @@
     ].filter(Boolean).join("; "),
   );

-  // a line along the bottom of the primary rectangle, inside its outline
-  const underline = $derived.by(() => {
-    const r = rects[0];
-    const thickness = Math.max(2, u * 0.07);
-    const inset = Math.max(2, u * 0.12);
-    const bottom = r.y + r.h - Math.max(1.5, u * 0.05);
-    return { x: r.x + inset, y: bottom - thickness, w: Math.max(0, r.w - 2 * inset), h: thickness };
-  });
-
   const legendStyle = $derived(
-    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h}px; ` +
+    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h - markSpace}px; ` +
       `padding: ${pad * u}px`,
   );
+
+  const ringColour = $derived(found ? "var(--find)" : ring);
 </script>

 {#snippet cap()}
   <svg class="cap" width={box.width * u} height={box.height * u} aria-hidden="true">
-    {#if found}
+    {#if ringColour}
       <!-- white keeps, black cuts away: mask values, not colours that show -->
       <mask id={ringMask}>
-        {#each ring.outer as r, i (i)}
+        {#each ringShape.outer as r, i (i)}
           <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="white" />
         {/each}
-        {#each ring.inner as r, i (i)}
+        {#each ringShape.inner as r, i (i)}
           <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="black" />
         {/each}
       </mask>
-      {#each ring.outer as r, i (i)}
-        <rect class="find-ring" x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} mask="url(#{ringMask})" />
+      {#each ringShape.outer as r, i (i)}
+        <rect class="ring" x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} mask="url(#{ringMask})"
+          style="fill: {ringColour}" />
       {/each}
     {/if}
     <!-- outlines first, then the fills over them: two rectangles read as one key (ISO Enter) -->
@@ -135,9 +166,17 @@
     {#each rects as r, i (i)}
       <rect class="face" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
     {/each}
-    {#if combo}
+    {#if marks.type === "line"}
       <rect class="combo-mark" x={underline.x} y={underline.y} width={underline.w} height={underline.h}
-        rx={underline.h / 2} />
+        rx={underline.h / 2} style="fill: var(--combo-{marks.colour})" />
+    {:else if dotRow}
+      {#each dotRow.dots as d, i (i)}
+        <circle class="combo-dot" cx={d.cx} cy={d.cy} r={dots.dot / 2} style="fill: var(--combo-{d.colour})" />
+      {/each}
+      {#if dotRow.more}
+        <text class="combo-more" x={dotRow.more.x} y={dotRow.more.y} text-anchor="end" dominant-baseline="central"
+          font-size={Math.max(8, dots.dot * 1.5)}>{dotRow.more.text}</text>
+      {/if}
     {/if}
   </svg>
   <span class="legend" style={legendStyle}>
@@ -157,10 +196,12 @@
     class:notched={item.hasSecond}
     class:combo
     class:found
+    class:ringed={ringColour !== null}
+    class:faded
     {style}
     aria-label={label}
     title={label}
-    aria-pressed={selected}
+    aria-pressed={chosen ?? selected}
     tabindex={focusable ? 0 : -1}
     data-ref={refId(item)}
     onclick={onselect}
@@ -168,7 +209,8 @@
     {@render cap()}
   </button>
 {:else}
-  <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found {style}>
+  <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found class:ringed={ringColour !== null}
+    class:faded {style}>
     {@render cap()}
   </div>
 {/if}
@@ -224,8 +266,13 @@
     fill: color-mix(in srgb, var(--key-bg) 55%, var(--board-bg));
   }

-  .combo-mark {
-    fill: var(--combo);
+  .combo-more {
+    fill: var(--text-2);
+    font-weight: 700;
+  }
+
+  .faded {
+    opacity: 0.38;
   }

   .static {
@@ -246,15 +293,11 @@
     filter: drop-shadow(0 0 calc(var(--u) * 0.12) color-mix(in srgb, var(--find) 70%, transparent));
   }

-  /* the ring reaches into the gap between keys (past it, on small keys): a found key sits above its neighbours */
-  .found {
+  /* the ring reaches into the gap between keys (past it, on small keys): a ringed key sits above its neighbours */
+  .ringed {
     z-index: 1;
   }

-  .find-ring {
-    fill: var(--find);
-  }
-
   .selected .edge {
     stroke: var(--accent);
     stroke-width: 5;
@@ -269,7 +312,7 @@
     outline-offset: 2px;
   }

-  .found:focus-visible {
+  .ringed:focus-visible {
     outline-offset: max(2px, var(--ring-clear));
   }

```

Apply to `web/src/keyboard/Keyboard.svelte`:

```diff
diff --git a/web/src/keyboard/Keyboard.svelte b/web/src/keyboard/Keyboard.svelte
--- a/web/src/keyboard/Keyboard.svelte
+++ b/web/src/keyboard/Keyboard.svelte
@@ -16,8 +16,9 @@
     onselect: (index: number) => void;
     /** largest key size, in pixels */
     maxUnit?: number;
-    /** which placed keys are part of a combo (underlined), aligned with placement.items */
-    combos?: boolean[];
+    /** for each placed key, the colours of the combos it is part of (an underline, or dots), aligned with
+     * placement.items */
+    combos?: number[][];
     /** keys to click and move between; otherwise a picture, hidden from screen readers (what shows it says what it
      * is) */
     interactive?: boolean;
@@ -25,11 +26,17 @@
     compact?: boolean;
     /** which placed keys produce what the find box looks for (highlighted), aligned with placement.items */
     highlights?: boolean[];
+    /** a ring in a colour (CSS) around some keys, aligned with placement.items */
+    rings?: (string | null)[];
+    /** which placed keys are drawn faintly, aligned with placement.items */
+    faded?: boolean[];
+    /** keys to choose: whether each is chosen (its aria-pressed), aligned with placement.items */
+    chosen?: boolean[];
   }

   let {
     placement, faces, labels, selected, onselect, maxUnit = 72, combos = [], interactive = true, compact = false,
-    highlights = [],
+    highlights = [], rings = [], faded = [], chosen,
   }: Props = $props();

   let width = $state(0);
@@ -60,10 +67,11 @@
       {#each placement.items as item, i (refId(item))}
         {#if item.kind === "key"}
           <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
-            combo={combos[i] ?? false} found={highlights[i] ?? false} {interactive} {compact} onselect={() => onselect(i)} />
+            combos={combos[i] ?? []} found={highlights[i] ?? false} ring={rings[i] ?? null} faded={faded[i] ?? false}
+            chosen={chosen?.[i]} {interactive} {compact} onselect={() => onselect(i)} />
         {:else}
           <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
-            found={highlights[i] ?? false} {interactive} {compact} onselect={() => onselect(i)} />
+            found={highlights[i] ?? false} faded={faded[i] ?? false} {interactive} {compact} onselect={() => onselect(i)} />
         {/if}
       {/each}
     {/if}
```

Apply to `web/src/keyboard/Encoder.svelte`:

```diff
diff --git a/web/src/keyboard/Encoder.svelte b/web/src/keyboard/Encoder.svelte
--- a/web/src/keyboard/Encoder.svelte
+++ b/web/src/keyboard/Encoder.svelte
@@ -14,6 +14,8 @@
     focusable: boolean;
     /** produces what the find box looks for: highlighted */
     found?: boolean;
+    /** drawn faintly: a knob that doesn't matter here */
+    faded?: boolean;
     /** a knob to click; otherwise only a picture (the keyboard as a whole is labelled) */
     interactive?: boolean;
     /** a small knob showing its main legend only, as large as it fits */
@@ -22,7 +24,8 @@
   }

   let {
-    item, face, u, selected, label, focusable, found = false, interactive = true, compact = false, onselect,
+    item, face, u, selected, label, focusable, found = false, faded = false, interactive = true, compact = false,
+    onselect,
   }: Props = $props();

   const clockwise = $derived(item.geometry.direction === 1);
@@ -68,6 +71,7 @@
     class="encoder tone-{face.tone}" data-tone={face.tone}
     class:selected
     class:found
+    class:faded
     {style}
     aria-label={label}
     title={label}
@@ -79,7 +83,7 @@
     {@render knob()}
   </button>
 {:else}
-  <div class="encoder static tone-{face.tone}" data-tone={face.tone} class:found {style}>
+  <div class="encoder static tone-{face.tone}" data-tone={face.tone} class:found class:faded {style}>
     {@render knob()}
   </div>
 {/if}
@@ -204,4 +208,8 @@
     text-align: center;
     overflow-wrap: anywhere;
   }
+
+  .faded {
+    opacity: 0.38;
+  }
 </style>
```

- [ ] **Step 5: The Keymap section: Edit view, Overview, legend and Inspector**

Apply to `web/src/keymap/KindLegend.svelte`:

```diff
diff --git a/web/src/keymap/KindLegend.svelte b/web/src/keymap/KindLegend.svelte
--- a/web/src/keymap/KindLegend.svelte
+++ b/web/src/keymap/KindLegend.svelte
@@ -5,7 +5,8 @@
   <li><i class="tap-dance"></i>tap dance</li>
   <li><i class="macro"></i>macro</li>
   <li><i class="transparent"></i>transparent (falls through)</li>
-  <li><i class="combo"></i>part of a combo</li>
+  <li><i class="combo"></i>in a combo (each combo its colour)</li>
+  <li><i class="combos"><b></b><b></b></i>in several combos</li>
 </ul>

 <style>
@@ -61,6 +62,25 @@
   }

   .combo {
-    box-shadow: inset 0 -3px 0 var(--combo);
+    box-shadow: inset 0 -3px 0 var(--combo-0);
+  }
+
+  .combos {
+    display: inline-flex;
+    align-items: flex-end;
+    justify-content: center;
+    gap: 2px;
+    padding-bottom: 1px;
+  }
+
+  .combos b {
+    width: 4px;
+    height: 4px;
+    border-radius: 50%;
+    background: var(--combo-0);
+  }
+
+  .combos b + b {
+    background: var(--combo-1);
   }
 </style>
```

Apply to `web/src/keymap/LayerCard.svelte`:

```diff
diff --git a/web/src/keymap/LayerCard.svelte b/web/src/keymap/LayerCard.svelte
--- a/web/src/keymap/LayerCard.svelte
+++ b/web/src/keymap/LayerCard.svelte
@@ -13,7 +13,8 @@
     warning: string | null;
     placement: Placement;
     faces: KeyFace[];
-    combos: boolean[];
+    /** the colours of the combos each key is part of */
+    combos: number[][];
     /** keys the find box highlights */
     highlights: boolean[];
     /** the layer the Edit view shows */
```

Apply to `web/src/keymap/Overview.svelte`:

```diff
diff --git a/web/src/keymap/Overview.svelte b/web/src/keymap/Overview.svelte
--- a/web/src/keymap/Overview.svelte
+++ b/web/src/keymap/Overview.svelte
@@ -1,5 +1,5 @@
 <script lang="ts">
-  import type { Analysis } from "../analysis/analysis";
+  import { comboMarksOf, type Analysis } from "../analysis/analysis";
   import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
   import type { KeyboardModel } from "../api/types";
   import type { Placement } from "../keyboard/geometry";
@@ -38,7 +38,7 @@
           const d = actionAt(model, layer.index, item);
           return d ? keyFace(d, names) : EMPTY_FACE;
         }),
-        combos: placement.items.map((item) => analysis.comboKeys[layer.index]?.has(refId(item)) ?? false),
+        combos: comboMarksOf(analysis, placement, layer.index).colours,
       };
     }),
   );
```

Apply to `web/src/keymap/ComboList.svelte`:

```diff
diff --git a/web/src/keymap/ComboList.svelte b/web/src/keymap/ComboList.svelte
--- a/web/src/keymap/ComboList.svelte
+++ b/web/src/keymap/ComboList.svelte
@@ -8,20 +8,30 @@
     /** the combos the selected key is part of, on the layer shown */
     uses: ComboUse[];
     names: Names;
+    /** each combo's colour (a palette index), by combo index */
+    colours: Map<number, number>;
     /** the key is transparent: the combos are those of the key below, which it falls through to */
     through?: boolean;
   }

-  let { uses, names, through = false }: Props = $props();
+  let { uses, names, colours, through = false }: Props = $props();
+
+  const entries = $derived(uses.map((use) => ({ use, missing: missingPartners(use, names) })));
+  // a transparent key lets the combos of the key below through: those that can fire at all
+  const firing = $derived(entries.filter((e) => e.missing === null).length);
 </script>

 <section class="combos" aria-labelledby="combos-title">
   <SectionTitle id="combos-title">Combos with this key</SectionTitle>
-  {#if through}<p class="through">It falls through to the base layer's key, so these combos still fire.</p>{/if}
+  {#if through && firing > 0}
+    <p class="through">
+      It falls through to the base layer's key, so {firing === entries.length ? "these combos still fire"
+        : "the combos that can fire still do"}.
+    </p>
+  {/if}
   <ul>
-    {#each uses as use (use.combo.index)}
-      {@const missing = missingPartners(use, names)}
-      <li>
+    {#each entries as { use, missing } (use.combo.index)}
+      <li style="--colour: var(--combo-{colours.get(use.combo.index) ?? 0})">
         <span class="what">{comboUseLabel(use, names)}</span>
         <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
       </li>
@@ -48,7 +58,7 @@
     display: grid;
     gap: 1px;
     padding-left: 10px;
-    border-left: 3px solid var(--combo);
+    border-left: 3px solid var(--colour);
   }

   .what {
```

Apply to `web/src/keymap/Inspector.svelte`:

```diff
diff --git a/web/src/keymap/Inspector.svelte b/web/src/keymap/Inspector.svelte
--- a/web/src/keymap/Inspector.svelte
+++ b/web/src/keymap/Inspector.svelte
@@ -19,6 +19,8 @@
     canEdit: boolean;
     /** the combos the key is part of on the layer */
     comboUses: ComboUse[];
+    /** each combo's colour (a palette index), by combo index */
+    comboColours: Map<number, number>;
     onchangekey: () => void;
     onsetcode: (code: string, action: string) => Promise<boolean>;
     ontapdance: () => void;
@@ -26,7 +28,7 @@
   }

   let {
-    model, names, layer, selection, canEdit, comboUses, onchangekey, onsetcode, ontapdance, onjump,
+    model, names, layer, selection, canEdit, comboUses, comboColours, onchangekey, onsetcode, ontapdance, onjump,
   }: Props = $props();

   let editingHold = $state(false);
@@ -181,7 +183,7 @@
   {/if}

   {#if comboUses.length > 0}
-    <ComboList uses={comboUses} {names} through={current.kind === "transparent"} />
+    <ComboList uses={comboUses} {names} colours={comboColours} through={current.kind === "transparent"} />
   {/if}
 </aside>

```

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -1,9 +1,9 @@
 <script lang="ts">
   import { tick } from "svelte";
-  import { analyse } from "../analysis/analysis";
+  import { analyse, comboMarksOf } from "../analysis/analysis";
   import { combosUsing } from "../analysis/combos";
   import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
-  import { foundLabel, type PhraseContext } from "../analysis/phrases";
+  import { comboMarkLabel, foundLabel, type PhraseContext } from "../analysis/phrases";
   import type { KeyboardModel } from "../api/types";
   import { placeKeyboard } from "../keyboard/geometry";
   import Keyboard from "../keyboard/Keyboard.svelte";
@@ -58,14 +58,14 @@
   const highlighted = $derived(foundKeys(found, model.layers.length));
   const actions = $derived(placement.items.map((item) => actionAt(model, layer, item)));
   const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY_FACE)));
-  const combos = $derived(placement.items.map((item) => analysis.comboKeys[layer]?.has(refId(item)) ?? false));
+  const comboMarks = $derived(comboMarksOf(analysis, placement, layer));
   const highlights = $derived(placement.items.map((item) => highlighted[layer]?.has(refId(item)) ?? false));
   // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
   const labels = $derived(
     placement.items.map((item, i) => {
       const { what, where } = whereIs(model, item);
       const label = keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
-      return `${label}${combos[i] ? " · part of a combo" : ""}${highlights[i] ? " · matches the search" : ""}`;
+      return `${label}${comboMarkLabel(comboMarks.combos[i])}${highlights[i] ? " · matches the search" : ""}`;
     }),
   );
   const selectedIndex = $derived(
@@ -225,7 +225,8 @@
             />
           {/if}
           <div class="board">
-            <Keyboard {placement} {faces} {labels} {combos} {highlights} selected={selectedIndex} onselect={select} />
+            <Keyboard {placement} {faces} {labels} combos={comboMarks.colours} {highlights} selected={selectedIndex}
+              onselect={select} />
             <KindLegend />
           </div>
         </div>
@@ -240,6 +241,7 @@
             {selection}
             canEdit={keyboard.canEdit && keyboard.pending === 0}
             {comboUses}
+            comboColours={analysis.comboColours}
             onchangekey={() => (pickerOpen = true)}
             onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
             ontapdance={() => fromInspector(turnIntoTapDance)}
```

- [ ] **Step 6: Type-check, unit tests and build**

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  31 passed (31)` and `Tests  449 passed (449)` and `built in`.

- [ ] **Step 7: The Overview's e2e test checks the colours**

Apply to `web/e2e/overview.spec.ts`:

```diff
diff --git a/web/e2e/overview.spec.ts b/web/e2e/overview.spec.ts
--- a/web/e2e/overview.spec.ts
+++ b/web/e2e/overview.spec.ts
@@ -95,18 +95,23 @@ test("a combo of two layer keys whose output is a layer key reaches that layer",
   }
 });

-test("combo keys are underlined, in the Edit view and the Overview", async ({ app }) => {
-  // K + Y and M + C on the base layer
+test("combo keys are underlined in their combo's colour, in the Edit view and the Overview", async ({ app }) => {
+  // K + Y (combo 0) and M + C (combo 1) on the base layer
   const members = await Promise.all([[6, 2], [6, 1], [2, 2], [2, 3]].map(([r, c]) => keyIndex(app, r, c)));
-  for (const index of members) {
+  const fills: string[] = [];
+  for (const [i, index] of members.entries()) {
     const key = app.locator(`[data-ref="key:${index}"]`);
     await expect(key).toHaveClass(/\bcombo\b/);
-    await expect(key).toHaveAccessibleName(/· part of a combo$/);
+    await expect(key).toHaveAccessibleName(i < 2 ? /· in combo 0$/ : /· in combo 1$/);
     await expect(key.locator(".combo-mark")).toHaveCount(1);
+    fills.push(await key.locator(".combo-mark").evaluate((r) => getComputedStyle(r).fill));
   }
   await expect(app.locator("button.key.combo")).toHaveCount(4);
-  const fill = await app.locator("button.key.combo .combo-mark").first().evaluate((r) => getComputedStyle(r).fill);
-  expect(fill).toMatch(/^rgb\((2[0-5]\d), \d{1,2}, \d{2,3}\)$/); // red
+  // one colour a combo, a different one for each
+  expect(fills[0]).toBe(fills[1]);
+  expect(fills[2]).toBe(fills[3]);
+  expect(fills[0]).not.toBe(fills[2]);
+  expect(fills[0]).toMatch(/^rgb\((2[0-5]\d), \d{1,2}, \d{2,3}\)$/); // red, the palette's first
   await app.locator(`[data-ref="key:${members[0]}"]`).click();
   await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText("with Y → Esc");

```

```bash
cd web && npm run e2e
```

Expected: `38 passed`: the e2e tests already on main, the Overview one now checking the colours.

- [ ] **Step 8: Commit**

```bash
git add web/e2e/overview.spec.ts \
  web/src/analysis/analysis.test.ts \
  web/src/analysis/analysis.ts \
  web/src/analysis/combos.test.ts \
  web/src/analysis/combos.ts \
  web/src/analysis/phrases.test.ts \
  web/src/analysis/phrases.ts \
  web/src/app.css \
  web/src/keyboard/Encoder.svelte \
  web/src/keyboard/Key.svelte \
  web/src/keyboard/Keyboard.svelte \
  web/src/keymap/ComboList.svelte \
  web/src/keymap/Inspector.svelte \
  web/src/keymap/KeymapPage.svelte \
  web/src/keymap/KindLegend.svelte \
  web/src/keymap/LayerCard.svelte \
  web/src/keymap/Overview.svelte
git commit -m "feat(web): each combo its own colour on its keys, dots on a key in several, in the Edit view, the Overview and the Inspector"
```

### Task 15: The section in the address, and the analysis for every page

- **`lib/route.ts`:** `parseRoute` and `routeHash` turn `#keymap`, `#tap-dance`, `#combos` and `#macros`, with an optional `/n` (an entry to open), into a `Route` and back. Anything else is the keymap.
- **`lib/router.svelte.ts`:**
  - `router.route` is read from the address before the first render, so a reload doesn't show the keymap first;
  - `start()` follows the address, the back button too;
  - `go(section, item)` changes it;
  - `openKey(place)` asks the keymap to select a key, which it takes once (`takeKeyTarget`, Task 17).
- **`App.svelte`:**
  - the navigation goes through the router;
  - a section this keyboard doesn't have shows the keymap;
  - the placement and the analysis are worked out here, once for every page, and again after every edit.

  `KeymapPage` takes them as props.

**Files:**
- Create: `web/src/lib/route.ts`, `web/src/lib/router.svelte.ts`
- Modify: `web/src/App.svelte`, `web/src/keymap/KeymapPage.svelte`
- Test: `web/src/lib/route.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOME, parseRoute, routeHash } from "./route";

describe("parseRoute", () => {
  it("reads the section and the entry", () => {
    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2 });
    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null });
    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0 });
  });

  it("is the keymap for anything else", () => {
    for (const hash of ["", "#", "#settings", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
      expect(parseRoute(hash)).toEqual(HOME);
    }
  });
});

describe("routeHash", () => {
  it("is what parseRoute reads back", () => {
    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });
});
```

```bash
cd web && npx vitest run src/lib/route.test.ts
```

Expected: `Cannot find module './route'`.

- [ ] **Step 2: Routes and the router**

Create `web/src/lib/route.ts`:

```ts
// Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
// Combos page. A reload stays where it was, and the browser's back button goes back.

export type SectionId = "keymap" | "tap-dance" | "combos" | "macros";

export const SECTIONS: SectionId[] = ["keymap", "tap-dance", "combos", "macros"];

export interface Route {
  section: SectionId;
  /** the entry to show (a tap dance, combo or macro), or null */
  item: number | null;
}

export const HOME: Route = { section: "keymap", item: null };

/** "#combos/2" -> combo 2 on the Combos page; anything else is the keymap */
export function parseRoute(hash: string): Route {
  const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!m || !section) return HOME;
  return { section, item: m[2] === undefined || section === "keymap" ? null : Number(m[2]) };
}

export function routeHash(route: Route): string {
  return route.item === null ? `#${route.section}` : `#${route.section}/${route.item}`;
}
```

Create `web/src/lib/router.svelte.ts`:

```ts
// The section shown, kept in the page's address (see route.ts), and a key the keymap is to show when it opens.
import { untrack } from "svelte";
import type { Place } from "../analysis/find";
import { HOME, parseRoute, routeHash, type Route, type SectionId } from "./route";

export class Router {
  // what the address says from the start, so a reload doesn't show the keymap first
  route = $state<Route>(typeof location === "undefined" ? HOME : parseRoute(location.hash));
  /** a key to select in the keymap's Edit view: the keymap takes it when it shows */
  keyTarget = $state<Place | null>(null);

  /** Follow the address (the back button too); returns a function that stops */
  start(): () => void {
    return untrack(() => {
      const read = () => (this.route = parseRoute(location.hash));
      read();
      window.addEventListener("hashchange", read);
      return () => window.removeEventListener("hashchange", read);
    });
  }

  go(section: SectionId, item: number | null = null): void {
    const route = { section, item };
    this.route = route;
    const hash = routeHash(route);
    if (location.hash !== hash) location.hash = hash;
  }

  /** The key, selected in the keymap's Edit view */
  openKey(place: Place): void {
    this.keyTarget = place;
    this.go("keymap");
  }

  /** The key to show, once: null when there is none */
  takeKeyTarget(): Place | null {
    const target = this.keyTarget;
    this.keyTarget = null;
    return target;
  }
}

export const router = new Router();
```

```bash
cd web && npx vitest run src/lib/route.test.ts
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 3: The app follows the router, and works out the analysis**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -1,16 +1,28 @@
 <script lang="ts">
+  import { analyse } from "./analysis/analysis";
+  import { placeKeyboard } from "./keyboard/geometry";
   import KeymapPage from "./keymap/KeymapPage.svelte";
   import { keyboard } from "./lib/keyboard.svelte";
+  import type { SectionId } from "./lib/route";
+  import { router } from "./lib/router.svelte";
   import Banner from "./shell/Banner.svelte";
   import Nav, { type Section } from "./shell/Nav.svelte";
   import Toasts from "./shell/Toasts.svelte";
   import TopBar from "./shell/TopBar.svelte";

   $effect(() => keyboard.start());
+  $effect(() => router.start());

-  // only the sections that are built; later phases add theirs
+  // worked out once for every page, again after every edit
+  const placement = $derived(keyboard.model ? placeKeyboard(keyboard.model) : null);
+  const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
+
+  // only the sections that are built; later tasks add theirs
   const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
-  let section = $state("keymap");
+  // a section this keyboard doesn't have shows the keymap
+  const section = $derived<SectionId>(
+    sections.some((s) => s.id === router.route.section) ? router.route.section : "keymap",
+  );

   const status = $derived(
     keyboard.link === "closed"
@@ -35,7 +47,7 @@
 />

 <div class="shell">
-  <Nav {sections} active={section} onselect={(id) => (section = id)} />
+  <Nav {sections} active={section} onselect={(id) => router.go(id as SectionId)} />

   <main class="content">
     {#if status === "offline"}
@@ -57,9 +69,9 @@
       />
     {/if}

-    {#if keyboard.model}
+    {#if keyboard.model && placement && analysis}
       <div class="page" class:blocked inert={blocked}>
-        <KeymapPage model={keyboard.model} />
+        <KeymapPage model={keyboard.model} {placement} {analysis} />
       </div>
     {:else if status === "disconnected"}
       <div class="empty">
```

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -1,11 +1,11 @@
 <script lang="ts">
   import { tick } from "svelte";
-  import { analyse, comboMarksOf } from "../analysis/analysis";
+  import { comboMarksOf, type Analysis } from "../analysis/analysis";
   import { combosUsing } from "../analysis/combos";
   import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
   import { comboMarkLabel, foundLabel, type PhraseContext } from "../analysis/phrases";
   import type { KeyboardModel } from "../api/types";
-  import { placeKeyboard } from "../keyboard/geometry";
+  import type { Placement } from "../keyboard/geometry";
   import Keyboard from "../keyboard/Keyboard.svelte";
   import { EMPTY_FACE, keyFace, keyLabel, layerLabel, namesOf } from "../keyboard/labels";
   import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
@@ -24,9 +24,12 @@

   interface Props {
     model: KeyboardModel;
+    placement: Placement;
+    /** layers reached, combo keys, usage: worked out again from the model after every edit */
+    analysis: Analysis;
   }

-  let { model }: Props = $props();
+  let { model, placement, analysis }: Props = $props();

   let view = $state<KeymapView>(readView(browserStorage()));
   let reachOpen = $state(readReachOpen(browserStorage()));
@@ -40,9 +43,6 @@
   });

   const names = $derived(namesOf(model));
-  const placement = $derived(placeKeyboard(model));
-  // layers reached, combo keys, usage: worked out again from the model after every edit
-  const analysis = $derived(analyse(model, placement));
   const phrases = $derived<PhraseContext>({ model, names, positions: analysis.positions });
   // what the find box looks for, everywhere the keymap produces it (in the keyboard language's legends)
   const found = $derived(
```

- [ ] **Step 4: Type-check, unit tests, build and e2e**

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  32 passed (32)` and `Tests  452 passed (452)` and `built in`.

```bash
cd web && npm run e2e
```

Expected: `38 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.svelte \
  web/src/keymap/KeymapPage.svelte \
  web/src/lib/route.test.ts \
  web/src/lib/route.ts \
  web/src/lib/router.svelte.ts
git commit -m "feat(web): the address keeps the section shown; the analysis is worked out once for every page"
```

### Task 16: The unlock dialog, and Lock/Unlock in the top bar

- **`shell/UnlockDialog.svelte`** opens whenever the Unlocker's state is "unlocking", whatever started it:
  - It draws the base layer with the unlock keys highlighted (the find ring) and the other keys faded, and names the keys' matrix positions ("row 0, column 0 and row 4, column 0"). During an unlock found on connect there is no model yet, so only the positions show.
  - A progress bar (`role=progressbar`) and a live status line ("Not held yet", "Keep holding… 60 %") follow the countdown. The dialog closes when the keyboard is unlocked.
  - **Cancel** stops following the unlock. Key presses do nothing while the dialog is open, as in Qt's unlocker: the unlock keys are on the keyboard in use, and held Enter or Space would otherwise press Cancel. Escape doesn't close it either.
  - It is drawn only while open, and fits a 1920 × 950 window.
- **The top bar** gets a Lock/Unlock control next to the connection status. "Locked" starts an unlock; "Unlocked" locks the keyboard again.
- **`App.svelte`:**
  - a warning banner for a cancelled unlock ("The keyboard still waits to be unlocked"), with an "Unlock" action;
  - a waiting page while an unlock found on connect runs;
  - the dialog itself.

The first e2e test of `behaviours.spec.ts` locks and unlocks from the top bar, through the fake-only hook. Every test there puts back what it changes in its `finally`, the unlock state too (`unlockAgain`).

**Files:**
- Create: `web/src/shell/UnlockDialog.svelte`, `web/e2e/behaviours.spec.ts`
- Modify: `web/src/shell/TopBar.svelte`, `web/src/App.svelte`, `web/e2e/fixtures.ts`

- [ ] **Step 1: The dialog**

Create `web/src/shell/UnlockDialog.svelte`:

```svelte
<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, type Names } from "../keyboard/labels";
  import { actionAt } from "../keyboard/refs";
  import { unlockProgress, type Unlocker } from "../lib/unlock.svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    unlocker: Unlocker;
    /** the keyboard, to show the keys to hold on it; null while it can't be read yet (an unlock started earlier) */
    model: KeyboardModel | null;
    placement: Placement | null;
    names: Names | null;
  }

  let { unlocker, model, placement, names }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (unlocker.open && !dialog.open) {
      dialog.showModal();
      // its only control: the focus is on it, as nothing else is to be done there
      dialog.querySelector<HTMLButtonElement>(".buttons button")?.focus();
    } else if (!unlocker.open && dialog.open) {
      dialog.close();
    }
  });

  // The unlock keys are held on the keyboard in use, which types them into this page: while it waits, key presses do
  // nothing here (as in Qt's unlocker). Held Enter or Space would otherwise press Cancel, held Tab move the focus.
  $effect(() => {
    if (!unlocker.open) return;
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const kinds = ["keydown", "keypress", "keyup"] as const;
    for (const kind of kinds) window.addEventListener(kind, swallow, true);
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, swallow, true);
    };
  });

  const unlock = $derived(unlocker.state);
  const keys = $derived(unlock.keys);
  const progress = $derived(unlockProgress(unlock));
  const percent = $derived(Math.round(progress * 100));
  const held = $derived(unlock.total > 0 && unlock.remaining < unlock.total);

  // the keyboard as it is on the base layer: the keys to hold ringed, the others faint
  const drawing = $derived.by(() => {
    if (!model || !placement || !names) return null;
    const unlockKey = placement.items.map((item) => item.kind === "key" &&
      keys.some((k) => k.row === item.geometry.row && k.col === item.geometry.col));
    return {
      faces: placement.items.map((item) => {
        const d = actionAt(model, 0, item);
        return d ? keyFace(d, names) : EMPTY_FACE;
      }),
      highlights: unlockKey,
      faded: unlockKey.map((u) => !u),
      labels: placement.items.map(() => ""),
    };
  });

  const where = $derived(keys.map((k) => `row ${k.row}, column ${k.col}`).join(" and "));
</script>

<dialog
  bind:this={dialog}
  class="unlock"
  aria-labelledby="unlock-title"
  aria-describedby="unlock-help"
  oncancel={(event) => {
    // never closed by a key: Escape may be one of the unlock keys
    event.preventDefault();
  }}
>
  <!-- drawn only while open: its keyboard isn't one of the page's -->
  {#if unlocker.open}
  <div class="panel">
    <h2 id="unlock-title">Unlock the keyboard</h2>
    <p id="unlock-help">
      Vial firmware changes macros and the bootloader key only while the keyboard is unlocked. Unlock it only on a
      computer you trust.
    </p>

    <p class="instruction">
      {#if keys.length === 0}
        Waiting for the keyboard…
      {:else}
        Press and hold {keys.length === 1 ? "the highlighted key" : `the ${keys.length} highlighted keys`} until the
        bar fills.
      {/if}
    </p>

    {#if drawing && placement}
      <div class="drawing">
        <Keyboard
          {placement}
          faces={drawing.faces}
          labels={drawing.labels}
          highlights={drawing.highlights}
          faded={drawing.faded}
          selected={-1}
          onselect={() => undefined}
          interactive={false}
          compact
          maxUnit={44}
        />
      </div>
    {/if}
    {#if keys.length > 0}
      <p class="where">The keys at {where} of the keyboard's matrix.</p>
    {/if}

    <div
      class="bar"
      role="progressbar"
      aria-label="Unlocking"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={held ? `${percent} %, keep holding` : "not held yet"}
    >
      <span style="width: {percent}%"></span>
    </div>
    <p class="status" aria-live="polite">{held ? `Keep holding… ${percent} %` : "Not held yet"}</p>

    <p class="note">
      Keys pressed do nothing here meanwhile. To lock it again later, click “Unlocked” in the top bar, or unplug the
      keyboard.
    </p>
    <div class="buttons">
      <!-- never disabled: it has the focus -->
      <Button onclick={() => void unlocker.cancel()}>Cancel</Button>
    </div>
  </div>
  {/if}
</dialog>

<style>
  .unlock {
    width: min(720px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100vh - 32px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .unlock::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .panel {
    display: grid;
    gap: 12px;
    padding: 20px 22px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  #unlock-help,
  .note,
  .where {
    color: var(--text-2);
    font-size: 13px;
  }

  .instruction {
    font-weight: 600;
  }

  .drawing {
    padding: 14px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
  }

  .bar {
    height: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.18s linear;
  }

  .status {
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
  }
</style>
```

- [ ] **Step 2: The top bar's control, and the app**

Apply to `web/src/shell/TopBar.svelte`:

```diff
diff --git a/web/src/shell/TopBar.svelte b/web/src/shell/TopBar.svelte
--- a/web/src/shell/TopBar.svelte
+++ b/web/src/shell/TopBar.svelte
@@ -10,9 +10,15 @@
     languages: KeyboardLanguage[];
     language: string;
     onlanguage: (lang: string) => void;
+    /** whether the keyboard is locked or unlocked; null while there is none to lock or unlock */
+    lock: "locked" | "unlocked" | null;
+    /** an unlock or a lock is being sent */
+    lockBusy: boolean;
+    onunlock: () => void;
+    onlock: () => void;
   }

-  let { name, status, fake, languages, language, onlanguage }: Props = $props();
+  let { name, status, fake, languages, language, onlanguage, lock, lockBusy, onunlock, onlock }: Props = $props();

   const STATUS_TEXT = {
     connected: "Connected",
@@ -43,6 +49,25 @@
       <span class="badge status {status}" role="status">
         <i aria-hidden="true"></i>{STATUS_TEXT[status]}
       </span>
+      {#if lock}
+        <!-- next to the connection: what the keyboard lets Vial change -->
+        <button
+          type="button"
+          class="badge lock {lock}"
+          disabled={lockBusy}
+          aria-label={lock === "unlocked" ? "Keyboard unlocked: lock it" : "Keyboard locked: unlock it"}
+          title={lock === "unlocked"
+            ? "Unlocked: macros and the bootloader key can be changed. Click to lock it again."
+            : "Locked: changing macros or the bootloader key needs it unlocked. Click to unlock it."}
+          onclick={lock === "unlocked" ? onlock : onunlock}
+        >
+          <svg viewBox="0 0 16 16" aria-hidden="true">
+            <rect x="3" y="7" width="10" height="7" rx="1.5" />
+            <path d={lock === "unlocked" ? "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"} />
+          </svg>
+          {lock === "unlocked" ? "Unlocked" : "Locked"}
+        </button>
+      {/if}
       <ThemeSwitch />
       <label class="language">
         <span>Keyboard language</span>
@@ -154,6 +179,35 @@
     background: var(--danger);
   }

+  .lock {
+    cursor: pointer;
+  }
+
+  .lock:hover:not(:disabled) {
+    border-color: var(--border-strong);
+    color: var(--text);
+  }
+
+  .lock.unlocked {
+    border-color: color-mix(in srgb, var(--warning-text) 40%, transparent);
+    background: var(--warning-weak);
+    color: var(--warning-text);
+  }
+
+  .lock:disabled {
+    cursor: progress;
+    opacity: 0.6;
+  }
+
+  .lock svg {
+    width: 13px;
+    height: 13px;
+    fill: none;
+    stroke: currentColor;
+    stroke-width: 1.5;
+    stroke-linecap: round;
+  }
+
   .language {
     display: inline-flex;
     align-items: center;
```

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -1,14 +1,17 @@
 <script lang="ts">
   import { analyse } from "./analysis/analysis";
   import { placeKeyboard } from "./keyboard/geometry";
+  import { namesOf } from "./keyboard/labels";
   import KeymapPage from "./keymap/KeymapPage.svelte";
   import { keyboard } from "./lib/keyboard.svelte";
   import type { SectionId } from "./lib/route";
   import { router } from "./lib/router.svelte";
+  import { isWaiting } from "./lib/unlock.svelte";
   import Banner from "./shell/Banner.svelte";
   import Nav, { type Section } from "./shell/Nav.svelte";
   import Toasts from "./shell/Toasts.svelte";
   import TopBar from "./shell/TopBar.svelte";
+  import UnlockDialog from "./shell/UnlockDialog.svelte";

   $effect(() => keyboard.start());
   $effect(() => router.start());
@@ -16,6 +19,7 @@
   // worked out once for every page, again after every edit
   const placement = $derived(keyboard.model ? placeKeyboard(keyboard.model) : null);
   const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
+  const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

   // only the sections that are built; later tasks add theirs
   const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
@@ -35,6 +39,10 @@
   );
   // the loaded keyboard stays on screen, greyed out, while it can't be edited
   const blocked = $derived(keyboard.model !== null && status !== "connected");
+  const unlock = $derived(keyboard.unlock.state);
+  const lock = $derived(
+    status !== "connected" || !keyboard.model ? null : unlock.state === "unlocked" ? "unlocked" : "locked",
+  );
 </script>

 <TopBar
@@ -44,6 +52,10 @@
   languages={keyboard.languages}
   language={keyboard.language}
   onlanguage={(lang) => keyboard.setLanguage(lang)}
+  {lock}
+  lockBusy={keyboard.unlock.busy}
+  onunlock={() => void keyboard.unlock.unlock()}
+  onlock={() => void keyboard.unlock.lock()}
 />

 <div class="shell">
@@ -59,6 +71,15 @@
         message="Changes are blocked until it is plugged back in. It is then read again."
       />
     {/if}
+    {#if unlock.state === "cancelled"}
+      <Banner
+        tone="warning"
+        title="The keyboard still waits to be unlocked"
+        message="It takes no changes until its unlock keys are held, or it is unplugged and plugged back in."
+        actionLabel="Unlock"
+        onaction={() => void keyboard.unlock.start()}
+      />
+    {/if}
     {#if keyboard.loadError}
       <Banner
         tone="danger"
@@ -73,6 +94,11 @@
       <div class="page" class:blocked inert={blocked}>
         <KeymapPage model={keyboard.model} {placement} {analysis} />
       </div>
+    {:else if status === "disconnected" && isWaiting(unlock)}
+      <div class="empty">
+        <h1>The keyboard waits to be unlocked</h1>
+        <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
+      </div>
     {:else if status === "disconnected"}
       <div class="empty">
         <h1>No keyboard found</h1>
@@ -86,6 +112,7 @@
   </main>
 </div>

+<UnlockDialog unlocker={keyboard.unlock} model={keyboard.model} {placement} {names} />
 <Toasts />

 <style>
```

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 3: e2e: lock and unlock from the top bar**

The fixtures reach the hook and the unlock state:

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -140,3 +140,13 @@ export async function labelsCutOff(page: Page): Promise<string[]> {
   }).map((l) => l.textContent ?? ""));
   return cut;
 }
+
+/** The fake server's test hook: the user holds the simulated keyboard's unlock keys (or lets go), or it is locked */
+export async function simulatorUnlock(page: Page, change: { keysHeld?: boolean; locked?: boolean }): Promise<void> {
+  await put(page, "/api/simulator/unlock", change);
+}
+
+/** The keyboard's unlock state, as the server tells */
+export async function unlockState(page: Page): Promise<string> {
+  return (await (await page.request.get(serverUrl(page, "/api/session"))).json()).unlock.state;
+}
```

Create `web/e2e/behaviours.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect, simulatorUnlock, test, unlockState } from "./fixtures";

// The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

/** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't, as the server started */
async function unlockAgain(page: Page) {
  await simulatorUnlock(page, { keysHeld: false });
  if ((await unlockState(page)) === "unlocked") return;
  // the simulator counts down while the keys are held
  await simulatorUnlock(page, { keysHeld: true });
  await page.request.post(new URL("/api/unlock/start", page.url()).toString());
  await expect.poll(() => unlockState(page), { timeout: 20_000 }).toBe("unlocked");
  await simulatorUnlock(page, { keysHeld: false });
}

test("the top bar locks and unlocks the keyboard; a cancelled unlock can be taken up again", async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await app.getByRole("button", { name: "Keyboard unlocked: lock it" }).click();
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
    expect(await unlockState(app)).toBe("locked");

    await app.getByRole("button", { name: "Keyboard locked: unlock it" }).click();
    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    // the keyboard still waits for its keys, and says so
    const banner = app.getByRole("status").filter({ hasText: "The keyboard still waits to be unlocked" });
    await expect(banner).toBeVisible();
    expect(await unlockState(app)).toBe("cancelled");

    await banner.getByRole("button", { name: "Unlock" }).click();
    await expect(dialog).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(app.getByRole("button", { name: "Keyboard unlocked: lock it" })).toBeVisible();
    await expect(banner).toBeHidden();
  } finally {
    await unlockAgain(app);
  }
});
```

```bash
cd web && npm run check && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `39 passed`: the 38 from main and the top-bar test.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/behaviours.spec.ts \
  web/e2e/fixtures.ts \
  web/src/App.svelte \
  web/src/shell/TopBar.svelte \
  web/src/shell/UnlockDialog.svelte
git commit -m "feat(web): the unlock dialog, and Lock/Unlock in the top bar"
```

### Task 17: The Tap dance page

- **Shared by the three pages:**
  - `PageHeader`: the title, what the page is for, and its action ("New tap dance");
  - `EntryHead`: a card's head, with its id ("TD 0"), its name cut short with a tooltip, and a rename button;
  - `UsedOn`: the "used on" chips, or a warning when nothing uses the entry ("Nothing uses it yet: put TD(1) on a key");
  - `navigate.ts`: `openUse` goes to a use: the key in the Keymap (`router.openKey`), or the combo, tap dance or macro on its page;
  - `target.svelte.ts`: `useTarget` scrolls to the card the address names and focuses its heading.
- **`TapDanceCard`:**
  - the sentence ("Tap for Tab, double-tap for Caps Lock.");
  - four slots (tap, hold, double tap, tap then hold), empty ones dashed. Clicking a slot opens the keycode picker, and a filled slot can be cleared;
  - the tapping term, a number in ms, saved when it changes (Enter, or leaving the field);
  - "used on".
- **`TapDancePage`:**
  - one card per tap dance set up or used;
  - "New tap dance" opens the first free one;
  - renaming goes through the name dialog;
  - "N more tap dances are free, of M".
- **The Keymap page:**
  - takes a key from another page (`router.keyTarget`) and selects it on its layer;
  - "Turn into tap dance" opens the new tap dance's card.
- **`App.svelte`:**
  - Tap dance joins the navigation with its count, unless the firmware has no tap dances;
  - list pages are at most 860 px wide (`--list-max`), centred in the content column, so the navigation doesn't move.

**Files:**
- Create: `web/src/behaviours/PageHeader.svelte`, `web/src/behaviours/EntryHead.svelte`, `web/src/behaviours/UsedOn.svelte`, `web/src/behaviours/navigate.ts`, `web/src/behaviours/target.svelte.ts`, `web/src/behaviours/TapDanceCard.svelte`, `web/src/behaviours/TapDancePage.svelte`
- Modify: `web/src/app.css`, `web/src/App.svelte`, `web/src/keymap/KeymapPage.svelte`, `web/e2e/fixtures.ts`, `web/e2e/behaviours.spec.ts`

- [ ] **Step 1: The pieces the pages share**

Create `web/src/behaviours/PageHeader.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** what the page is for, in a sentence or two */
    description: string;
    /** the page's own action, e.g. "New tap dance" */
    action?: Snippet;
    id: string;
  }

  let { title, description, action, id }: Props = $props();
</script>

<header class="head">
  <div class="title">
    <h1 {id}>{title}</h1>
    <p>{description}</p>
  </div>
  {#if action}<div class="action">{@render action()}</div>{/if}
</header>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px 16px;
  }

  .title {
    flex: 1 1 320px;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
```

Create `web/src/behaviours/EntryHead.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** "TD 3", "Combo 2", "M 0" */
    id: string;
    /** the heading's id, for the card's aria-labelledby */
    headingId: string;
    /** the name, cut short with a tooltip when it is long; null for an entry without names (a combo) */
    name: string | null;
    tone: "tap-dance" | "macro" | "combo";
    /** renames it, when it can be named */
    onrename?: () => void;
    renameLabel?: string;
    canEdit: boolean;
    /** on the right: the card's own controls */
    actions?: Snippet;
  }

  let { id, headingId, name, tone, onrename, renameLabel, canEdit, actions }: Props = $props();
</script>

<header class="head">
  <h2 id={headingId} tabindex="-1">
    <span class="id {tone}">{id}</span>
    {#if name !== null}<span class="name" title={name}>{name}</span>{/if}
  </h2>
  {#if onrename}
    <button type="button" class="rename" aria-label={renameLabel} title="Rename" disabled={!canEdit} onclick={onrename}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" /></svg>
    </button>
  {/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px 8px;
    min-width: 0;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin: 0;
    font-size: 15px;
  }

  h2:focus {
    outline: none;
  }

  .id {
    flex: none;
    padding: 2px 7px;
    border-radius: 5px;
    font: 650 11.5px/1.4 var(--mono);
  }

  .id.tap-dance {
    background: color-mix(in srgb, var(--tone-tap-dance) 16%, transparent);
    color: color-mix(in srgb, var(--tone-tap-dance) 75%, var(--text));
  }

  .id.macro {
    background: color-mix(in srgb, var(--tone-macro) 18%, transparent);
    color: color-mix(in srgb, var(--tone-macro) 60%, var(--text));
  }

  .id.combo {
    background: color-mix(in srgb, var(--colour, var(--combo-0)) 16%, transparent);
    color: color-mix(in srgb, var(--colour, var(--combo-0)) 75%, var(--text));
  }

  /* a long name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .rename:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .rename:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .rename svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }
</style>
```

Create `web/src/behaviours/UsedOn.svelte`:

```svelte
<script lang="ts">
  import type { Use } from "../analysis/usage";
  import type { Names } from "../keyboard/labels";
  import { useLabel } from "./sentences";

  interface Props {
    uses: Use[];
    names: Names;
    /** every placed key's position in words, by refId */
    positions: Map<string, string>;
    /** what to put on a key to use it, for the warning when nothing does: "TD(3)" */
    keycode: string;
    /** go to a use: the key in the Keymap, or the combo, tap dance or macro on its page */
    onopen: (use: Use) => void;
  }

  let { uses, names, positions, keycode, onopen }: Props = $props();

  /** key overrides and alt-repeat keys have no page yet */
  const openable = (use: Use) => use.type !== "key-override" && use.type !== "alt-repeat";
</script>

{#if uses.length === 0}
  <p class="unused">Nothing uses it yet: put <code>{keycode}</code> on a key in the Keymap to use it.</p>
{:else}
  <div class="used">
    <span class="label">Used on</span>
    <ul>
      {#each uses as use, i (i)}
        {@const label = useLabel(use, names, positions)}
        <li>
          {#if openable(use)}
            <button type="button" title="{label} · go there" onclick={() => onopen(use)}>{label}</button>
          {:else}
            <span class="plain">{label}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .used {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    font-size: 12.5px;
  }

  .label {
    color: var(--text-3);
    font-weight: 600;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button,
  .plain {
    display: inline-block;
    max-width: 100%;
    padding: 1px 9px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--accent);
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-weak);
  }

  .plain {
    border-style: dashed;
  }

  .unused {
    margin: 0;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }
</style>
```

Create `web/src/behaviours/navigate.ts`:

```ts
// Going to where something is used: the key in the Keymap, or the combo, tap dance or macro on its page.
import type { Use } from "../analysis/usage";
import { router } from "../lib/router.svelte";

export function openUse(use: Use): void {
  switch (use.type) {
    case "key":
      router.openKey({ layer: use.layer, ref: use.ref });
      break;
    case "combo":
      router.go("combos", use.combo);
      break;
    case "tap-dance":
      router.go("tap-dance", use.tapDance);
      break;
    case "macro":
      router.go("macros", use.macro);
      break;
    default:
      break; // key overrides and alt-repeat keys have no page yet
  }
}
```

Create `web/src/behaviours/target.svelte.ts`:

```ts
// A card opened from elsewhere (the address names it): scrolled to, with the focus on its heading.
import { tick } from "svelte";

/** Each time `id` names another element, scroll to it and focus it, once it is drawn */
export function useTarget(id: () => string | null): void {
  $effect(() => {
    const target = id();
    if (target === null) return;
    void tick().then(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ block: "center" });
      element?.focus({ preventScroll: true });
    });
  });
}
```

- [ ] **Step 2: The card and the page**

Create `web/src/behaviours/TapDanceCard.svelte`:

```svelte
<script lang="ts">
  import type { Use } from "../analysis/usage";
  import type { Described, TapDance } from "../api/types";
  import { actionSummary, keyFace, type Names } from "../keyboard/labels";
  import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
  import EntryHead from "./EntryHead.svelte";
  import { tapDanceSentence } from "./sentences";
  import UsedOn from "./UsedOn.svelte";

  interface Props {
    td: TapDance;
    names: Names;
    positions: Map<string, string>;
    uses: Use[];
    canEdit: boolean;
    /** the card opened from elsewhere: drawn out for a moment */
    target: boolean;
    /** choose what a slot does (with the keycode picker) */
    onpickslot: (slot: SlotLabel) => void;
    onclearslot: (slot: SlotLabel) => void;
    /** resolves to whether the keyboard took it */
    onterm: (ms: number) => Promise<boolean>;
    onrename: () => void;
    onopenuse: (use: Use) => void;
  }

  let { td, names, positions, uses, canEdit, target, onpickslot, onclearslot, onterm, onrename, onopenuse }: Props =
    $props();

  /** the longest tapping term the server takes (schemas.TAPPING_TERM_MAX) */
  const TERM_MAX = 10000;

  const slots = $derived(tapDanceSlots(td));
  const sentence = $derived(tapDanceSentence(td, names));
  const headingId = $derived(`tap-dance-${td.index}-title`);
  let termProblem = $state<string | null>(null);

  function what(d: Described): string {
    return actionSummary(d, names).tap;
  }

  async function changeTerm(input: HTMLInputElement) {
    const ms = input.valueAsNumber;
    if (!Number.isInteger(ms) || ms < 0 || ms > TERM_MAX) {
      termProblem = `A tapping term from 0 to ${TERM_MAX} ms.`;
      return;
    }
    termProblem = null;
    if (ms === td.tappingTerm) return;
    if (!(await onterm(ms))) input.value = String(td.tappingTerm);
  }
</script>

<article class="card" class:target id="tap-dance-{td.index}" aria-labelledby={headingId}>
  <EntryHead id="TD {td.index}" {headingId} name={td.name} tone="tap-dance" {canEdit} {onrename}
    renameLabel="Rename tap dance {td.index}" />

  <p class="plain">{sentence}</p>

  <ul class="slots" aria-label="What each press of tap dance {td.index} does">
    {#each slots as slot (slot.label)}
      {@const set = slot.action.kind !== "none"}
      {@const face = keyFace(slot.action, names)}
      <li class="slot" class:set>
        <button
          type="button"
          class="choose"
          disabled={!canEdit}
          aria-label="{slot.label}: {set ? what(slot.action) : 'nothing'} · change it"
          title="{slot.label}: {set ? `${what(slot.action)} (${slot.action.code})` : 'nothing'} · click to change"
          onclick={() => onpickslot(slot.label)}
        >
          <span class="how">{slot.label}</span>
          <span class="what tone-{face.tone}" data-tone={face.tone}>{set ? face.main || slot.action.code : "nothing"}</span>
          {#if set && face.hold}<span class="hold">{face.hold}</span>{/if}
        </button>
        {#if set}
          <button
            type="button"
            class="clear"
            disabled={!canEdit}
            aria-label="Clear the {slot.label.toLowerCase()} of tap dance {td.index}"
            title="Clear"
            onclick={() => onclearslot(slot.label)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="foot">
    <label class="term">
      <span>Decides after</span>
      <input
        type="number"
        min="0"
        max={TERM_MAX}
        step="10"
        value={td.tappingTerm}
        disabled={!canEdit}
        aria-describedby={termProblem ? `tap-dance-${td.index}-term-problem` : undefined}
        onchange={(e) => void changeTerm(e.currentTarget)}
      />
      <span>ms <span class="muted">(tapping term)</span></span>
    </label>
    {#if termProblem}<p class="problem" id="tap-dance-{td.index}-term-problem" role="alert">{termProblem}</p>{/if}
  </div>

  <UsedOn {uses} {names} {positions} keycode="TD({td.index})" onopen={onopenuse} />
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    scroll-margin-top: 80px;
  }

  .card.target {
    border-color: var(--tone-tap-dance);
    box-shadow: 0 0 0 1px var(--tone-tap-dance), var(--shadow);
  }

  .plain {
    margin: 0;
    color: var(--text-2);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (max-width: 640px) {
    .slots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .slot {
    position: relative;
    min-width: 0;
  }

  .choose {
    display: grid;
    justify-items: center;
    gap: 3px;
    width: 100%;
    min-height: 74px;
    padding: 8px 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: 9px;
    background: transparent;
    text-align: center;
    cursor: pointer;
  }

  .set .choose {
    border-style: solid;
    border-color: var(--border);
    background: var(--board-bg);
  }

  .choose:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .choose:disabled {
    cursor: not-allowed;
  }

  .how {
    color: var(--text-3);
    font-size: 11.5px;
    font-weight: 600;
  }

  .what {
    max-width: 100%;
    overflow: hidden;
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--fill);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot:not(.set) .what {
    border: 0;
    background: none;
    color: var(--text-3);
    font-size: 12.5px;
    font-weight: 450;
  }

  .hold {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clear {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .clear:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--danger);
  }

  .clear svg {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .foot {
    display: grid;
    gap: 4px;
  }

  .term {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13px;
  }

  .term input {
    width: 88px;
    padding: 3px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface-2);
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--text-3);
  }

  .problem {
    margin: 0;
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
```

Create `web/src/behaviours/TapDancePage.svelte`:

```svelte
<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import type { KeyboardModel, TapDance, TapDanceIn } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { freeTapDance, type SlotLabel } from "../keymap/tapdance";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";
  import { shownEntries, tapDanceIsSet } from "./entries";
  import { openUse } from "./navigate";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";
  import TapDanceCard from "./TapDanceCard.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the tap dance to show (from the address), or null */
    item: number | null;
  }

  let { model, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit && keyboard.pending === 0);
  /** tap dances opened that would not show otherwise: a new one, or one opened from elsewhere */
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.tapDance.length,
    (i) => tapDanceIsSet(model.tapDance[i]) || (analysis.usage.tapDances[i]?.length ?? 0) > 0,
    item === null ? opened : [...opened, item]));
  const free = $derived(freeTapDance(model));
  const unshown = $derived(model.tapDance.length - shown.length);

  useTarget(() => (item === null ? null : `tap-dance-${item}-title`));

  const FIELDS: Record<SlotLabel, "tap" | "hold" | "doubleTap" | "tapHold"> = {
    Tap: "tap", Hold: "hold", "Double tap": "doubleTap", "Tap, then hold": "tapHold",
  };

  function body(td: TapDance, change: Partial<TapDanceIn> = {}): TapDanceIn {
    return {
      tap: td.tap.code, hold: td.hold.code, doubleTap: td.doubleTap.code, tapHold: td.tapHold.code,
      tappingTerm: td.tappingTerm, ...change,
    };
  }

  function setSlot(index: number, slot: SlotLabel, code: string) {
    const td = model.tapDance[index];
    if (td) void keyboard.setTapDance(index, body(td, { [FIELDS[slot]]: code }), `Changing the ${slot.toLowerCase()}`);
  }

  // the keycode picker, for one slot at a time
  let pickerOpen = $state(false);
  let picking = $state<{ index: number; slot: SlotLabel } | null>(null);
  const pickingCurrent = $derived(picking ? model.tapDance[picking.index]?.[FIELDS[picking.slot]]?.code ?? "KC_NO" : "KC_NO");

  function pickSlot(index: number, slot: SlotLabel) {
    picking = { index, slot };
    pickerOpen = true;
  }

  // naming, in the name dialog
  let renaming = $state<number | null>(null);
  const subject = $derived<NameSubject | null>(renaming === null ? null : {
    title: `Rename tap dance ${renaming}`,
    label: `Name of tap dance ${renaming}`,
    empty: "a name made from what it does",
    placeholder: "",
    text: model.tapDance[renaming]?.customName ? model.tapDance[renaming].name : "",
  });

  function newTapDance() {
    if (free === null) return;
    opened = [...opened, free];
    router.go("tap-dance", free);
  }
</script>

<section class="page" aria-labelledby="tap-dance-title">
  <PageHeader
    id="tap-dance-title"
    title="Tap dance"
    description="One key, up to four actions: tapped, held, tapped twice, or tapped then held. Click a slot to change it."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null}
        title={free === null ? "Every tap dance is in use" : `Sets up tap dance ${free}`} onclick={newTapDance}>
        New tap dance
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No tap dance is set up yet. Make one here, or with “Turn into tap dance” on a key.</p>
  {/if}
  {#each shown as index (index)}
    {@const td = model.tapDance[index]}
    <TapDanceCard
      {td}
      {names}
      positions={analysis.positions}
      uses={analysis.usage.tapDances[index] ?? []}
      {canEdit}
      target={index === item}
      onpickslot={(slot) => pickSlot(index, slot)}
      onclearslot={(slot) => setSlot(index, slot, "KC_NO")}
      onterm={(ms) => keyboard.setTapDance(index, body(td, { tappingTerm: ms }), "Changing the tapping term")}
      onrename={() => (renaming = index)}
      onopenuse={openUse}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "tap dance is" : "tap dances are"} free, of {model.tapDance.length}.</p>
  {/if}
</section>

{#if picking}
  <Picker
    bind:open={pickerOpen}
    subject="Tap dance {picking.index}, {picking.slot.toLowerCase()}"
    categories={keyboard.catalogue}
    current={pickingCurrent}
    {names}
    onpick={(code) => {
      if (picking) setSlot(picking.index, picking.slot, code);
    }}
  />
{/if}

<NameDialog
  {subject}
  onsave={(name) => {
    const index = renaming;
    if (index === null) return Promise.resolve(true);
    const td = model.tapDance[index];
    return name === (td?.customName ? td.name : "") ? Promise.resolve(true) : keyboard.rename("tapDance", index, name);
  }}
  onclose={() => {
    const index = renaming;
    renaming = null;
    if (index !== null) document.getElementById(`tap-dance-${index}`)?.querySelector<HTMLElement>(".rename")?.focus();
  }}
/>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .empty,
  .more {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .empty {
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    text-align: center;
  }
</style>
```

- [ ] **Step 3: The page's width, the navigation, and the Keymap page**

Apply to `web/src/app.css`:

```diff
diff --git a/web/src/app.css b/web/src/app.css
--- a/web/src/app.css
+++ b/web/src/app.css
@@ -51,6 +51,8 @@
   /* layout: the navigation plus a content column of at most 1100 px, centred on wide screens */
   --nav-width: 190px;
   --content-max: 1100px;
+  /* list pages (tap dance, combos, macros) are at most 860 px wide */
+  --list-max: 860px;
   --shell-gap: 28px;
   --shell-gutter: 24px;
   --shell-width: calc(var(--nav-width) + var(--shell-gap) + var(--content-max) + 2 * var(--shell-gutter));
```

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -1,5 +1,7 @@
 <script lang="ts">
   import { analyse } from "./analysis/analysis";
+  import { behaviourCounts } from "./behaviours/entries";
+  import TapDancePage from "./behaviours/TapDancePage.svelte";
   import { placeKeyboard } from "./keyboard/geometry";
   import { namesOf } from "./keyboard/labels";
   import KeymapPage from "./keymap/KeymapPage.svelte";
@@ -21,8 +23,15 @@
   const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
   const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

-  // only the sections that are built; later tasks add theirs
-  const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
+  // sections the keyboard's firmware doesn't have (no tap dances, combos or macros) are left out
+  const sections = $derived.by<Section[]>(() => {
+    const model = keyboard.model;
+    const list: Section[] = [{ id: "keymap", label: "Keymap", count: model?.layers.length }];
+    if (!model) return list;
+    const counts = behaviourCounts(model);
+    if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
+    return list;
+  });
   // a section this keyboard doesn't have shows the keymap
   const section = $derived<SectionId>(
     sections.some((s) => s.id === router.route.section) ? router.route.section : "keymap",
@@ -91,8 +100,12 @@
     {/if}

     {#if keyboard.model && placement && analysis}
-      <div class="page" class:blocked inert={blocked}>
-        <KeymapPage model={keyboard.model} {placement} {analysis} />
+      <div class="page" class:list={section !== "keymap"} class:blocked inert={blocked}>
+        {#if section === "tap-dance"}
+          <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
+        {:else}
+          <KeymapPage model={keyboard.model} {placement} {analysis} />
+        {/if}
       </div>
     {:else if status === "disconnected" && isWaiting(unlock)}
       <div class="empty">
@@ -127,12 +140,20 @@

   .content {
     display: grid;
+    align-content: start;
     gap: 14px;
     min-width: 0;
     width: 100%;
     max-width: var(--content-max);
   }

+  /* list pages (tap dance, combos, macros) are narrower than the keymap, centred in its column */
+  .page.list {
+    width: 100%;
+    max-width: var(--list-max);
+    margin: 0 auto;
+  }
+
   .page.blocked {
     filter: grayscale(1);
     opacity: 0.55;
```

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -1,5 +1,5 @@
 <script lang="ts">
-  import { tick } from "svelte";
+  import { tick, untrack } from "svelte";
   import { comboMarksOf, type Analysis } from "../analysis/analysis";
   import { combosUsing } from "../analysis/combos";
   import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
@@ -10,6 +10,7 @@
   import { EMPTY_FACE, keyFace, keyLabel, layerLabel, namesOf } from "../keyboard/labels";
   import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
   import { keyboard } from "../lib/keyboard.svelte";
+  import { router } from "../lib/router.svelte";
   import { browserStorage } from "../lib/theme";
   import Picker from "../picker/Picker.svelte";
   import Inspector from "./Inspector.svelte";
@@ -94,7 +95,17 @@
     document.getElementById(`layer-tab-${index}`)?.focus();
   }

-  /** From a find result: the key, selected in the Edit view on its layer */
+  // a key to show, from another page ("used on" of a tap dance or macro)
+  $effect(() => {
+    if (router.keyTarget) {
+      untrack(() => {
+        const place = router.takeKeyTarget();
+        if (place) void openKey(place);
+      });
+    }
+  });
+
+  /** From a find result or another page: the key, selected in the Edit view on its layer */
   async function openKey(place: Place) {
     layer = place.layer;
     selection = place.ref;
@@ -128,8 +139,11 @@
     return done;
   }

-  function turnIntoTapDance() {
-    return selection ? keyboard.turnIntoTapDance(layer, selection).then((index) => index !== null) : Promise.resolve(false);
+  /** The tap dance made opens on its page */
+  async function turnIntoTapDance() {
+    const index = selection ? await keyboard.turnIntoTapDance(layer, selection) : null;
+    if (index !== null) router.go("tap-dance", index);
+    return index !== null;
   }

   const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
```

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 4: e2e: a slot, "used on", the tapping term, a long name, "Turn into tap dance"**

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -141,6 +141,18 @@ export async function labelsCutOff(page: Page): Promise<string[]> {
   return cut;
 }

+/** A tap dance's slots and tapping term, as the server takes them */
+export async function tapDanceAt(page: Page, index: number) {
+  const td = (await keyboardModel(page)).tapDance[index];
+  return { tap: td.tap.code, hold: td.hold.code, doubleTap: td.doubleTap.code, tapHold: td.tapHold.code,
+    tappingTerm: td.tappingTerm };
+}
+
+/** Sets a tap dance through the API */
+export async function setTapDance(page: Page, index: number, body: Awaited<ReturnType<typeof tapDanceAt>>) {
+  await put(page, `/api/tap-dance/${index}`, body);
+}
+
 /** The fake server's test hook: the user holds the simulated keyboard's unlock keys (or lets go), or it is locked */
 export async function simulatorUnlock(page: Page, change: { keysHeld?: boolean; locked?: boolean }): Promise<void> {
   await put(page, "/api/simulator/unlock", change);
```

Apply to `web/e2e/behaviours.spec.ts`:

```diff
diff --git a/web/e2e/behaviours.spec.ts b/web/e2e/behaviours.spec.ts
--- a/web/e2e/behaviours.spec.ts
+++ b/web/e2e/behaviours.spec.ts
@@ -1,8 +1,25 @@
 import type { Page } from "@playwright/test";
-import { expect, simulatorUnlock, test, unlockState } from "./fixtures";
+import { expect, keyIndex, setTapDance, simulatorUnlock, tapDanceAt, test, unlockState } from "./fixtures";

 // The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

+async function openSection(page: Page, name: "Tap dance" | "Combos" | "Macros") {
+  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
+  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
+}
+
+const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);
+
+/** The picker's any-keycode box: type a keycode and use it */
+async function pickAnyKeycode(page: Page, code: string) {
+  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
+  await expect(picker).toBeVisible();
+  await picker.getByLabel("Any keycode").fill(code);
+  await expect(picker.locator("#any-keycode-result")).toContainText(code);
+  await picker.getByRole("button", { name: "Use", exact: true }).click();
+  await expect(picker).toBeHidden();
+}
+
 /** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't, as the server started */
 async function unlockAgain(page: Page) {
   await simulatorUnlock(page, { keysHeld: false });
@@ -14,6 +31,75 @@ async function unlockAgain(page: Page) {
   await simulatorUnlock(page, { keysHeld: false });
 }

+test.describe("tap dance", () => {
+  test("a slot is changed with the picker, and \"used on\" goes to the key", async ({ app }) => {
+    const before = await tapDanceAt(app, 0);
+    try {
+      await openSection(app, "Tap dance");
+      const card = tapDanceCard(app, 0);
+      await expect(card).toContainText("Tap for Tab, double-tap for Caps Lock.");
+      await card.getByRole("button", { name: /^Hold: nothing/ }).click();
+      await pickAnyKeycode(app, "KC_LSHIFT");
+      await expect(card).toContainText("Tap for Tab, hold for LShift, double-tap for Caps Lock.");
+      expect((await tapDanceAt(app, 0)).hold).toBe("KC_LSHIFT");
+
+      // TD 1 isn't on any key
+      await expect(tapDanceCard(app, 1)).toContainText("Nothing uses it yet: put TD(1) on a key");
+
+      await card.getByRole("button", { name: "Base, left inner thumb" }).click();
+      await expect(app).toHaveURL(/#keymap$/);
+      const key = app.locator(`[data-ref="key:${await keyIndex(app, 3, 5)}"]`);
+      await expect(key).toHaveAttribute("aria-pressed", "true");
+      await expect(key).toBeFocused();
+      await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("Tap dance 0");
+    } finally {
+      await setTapDance(app, 0, before);
+    }
+  });
+
+  test("the tapping term, and a long name cut short with a tooltip", async ({ app }) => {
+    const before = await tapDanceAt(app, 1);
+    const long = "Escape on a tap, Control held, save twice";
+    try {
+      await openSection(app, "Tap dance");
+      const card = tapDanceCard(app, 1);
+      const term = card.getByRole("spinbutton");
+      await term.fill("250");
+      await term.press("Enter");
+      await expect.poll(async () => (await tapDanceAt(app, 1)).tappingTerm).toBe(250);
+
+      await card.getByRole("button", { name: "Rename tap dance 1" }).click();
+      const dialog = app.getByRole("dialog", { name: "Rename tap dance 1" });
+      await dialog.getByLabel("Name of tap dance 1").fill(long);
+      await dialog.getByRole("button", { name: "Save" }).click();
+      await expect(dialog).toBeHidden();
+      const name = card.locator(".name");
+      await expect(name).toHaveAttribute("title", long.slice(0, 40));
+      await expect(card.getByRole("button", { name: "Rename tap dance 1" })).toBeFocused();
+    } finally {
+      await setTapDance(app, 1, before);
+      await app.request.put(new URL("/api/names/tapDance/1", app.url()).toString(), { data: { name: null } });
+    }
+  });
+
+  test("turning a key into a tap dance opens its card", async ({ app }) => {
+    const index = await keyIndex(app, 0, 2); // base layer: L
+    const before = await tapDanceAt(app, 2);
+    try {
+      await app.locator(`[data-ref="key:${index}"]`).click();
+      await app.getByRole("button", { name: "Turn into tap dance" }).click();
+      await expect(app).toHaveURL(/#tap-dance\/2$/);
+      const card = tapDanceCard(app, 2);
+      await expect(card).toHaveClass(/\btarget\b/);
+      await expect(card).toContainText("Tap for L.");
+      await expect(card.getByRole("heading", { level: 2 })).toBeFocused();
+    } finally {
+      await app.request.put(new URL("/api/keymap/0/0/2", app.url()).toString(), { data: { code: "KC_L" } });
+      await setTapDance(app, 2, before);
+    }
+  });
+});
+
 test("the top bar locks and unlocks the keyboard; a cancelled unlock can be taken up again", async ({ app }) => {
   test.setTimeout(60_000);
   try {
```

```bash
cd web && npm run check && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `42 passed`: three tap dance tests more.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/behaviours.spec.ts \
  web/e2e/fixtures.ts \
  web/src/App.svelte \
  web/src/app.css \
  web/src/behaviours/EntryHead.svelte \
  web/src/behaviours/PageHeader.svelte \
  web/src/behaviours/TapDanceCard.svelte \
  web/src/behaviours/TapDancePage.svelte \
  web/src/behaviours/UsedOn.svelte \
  web/src/behaviours/navigate.ts \
  web/src/behaviours/target.svelte.ts \
  web/src/keymap/KeymapPage.svelte
git commit -m "feat(web): the Tap dance page"
```

### Task 18: The Combos page

- **`ComboKeys`:** the card's small keyboard (the base layer).
  - As a picture, the combo's keys are ringed in its colour and the others faded.
  - While editing, the keys are buttons: clicking one adds its keycode, or takes it out (`aria-pressed`, " · in the combo" in its label). Keys that can't be in a combo (empty, transparent) are faded. The arrow keys move between the keys.
- **`ComboCard`:**
  - the small keyboard, an arrow to the output, and the sentence; a note when a keycode sits on several keys or on none, or when the combo can't fire;
  - editing: members chosen by clicking keys (up to 4), or added by keycode with the picker, each shown as a chip that can be taken out; the output changed with the picker; Save, Cancel, and "Remove the combo";
  - the card in the combo's colour.
- **`CombosPage`:**
  - one card per combo set up; one combo is edited at a time;
  - "New combo" opens the first free one for editing.
- **The picker's `onpick`** also gives the described keycode, as a member or a macro key needs it.
- **The Inspector:**
  - each "Combos with this key" entry is a button that opens its card (`#combos/n`);
  - its title is cut short after two lines, with a tooltip, as a tap dance or macro name can be long.
- **`App.svelte`:** Combos joins the navigation.

**Files:**
- Create: `web/src/behaviours/ComboKeys.svelte`, `web/src/behaviours/ComboCard.svelte`, `web/src/behaviours/CombosPage.svelte`
- Modify: `web/src/picker/Picker.svelte`, `web/src/picker/AnyKeycode.svelte`, `web/src/keymap/ComboList.svelte`, `web/src/keymap/Inspector.svelte`, `web/src/keymap/KeymapPage.svelte`, `web/src/App.svelte`, `web/e2e/behaviours.spec.ts`

- [ ] **Step 1: The picker gives the described keycode**

Apply to `web/src/picker/AnyKeycode.svelte`:

```diff
diff --git a/web/src/picker/AnyKeycode.svelte b/web/src/picker/AnyKeycode.svelte
--- a/web/src/picker/AnyKeycode.svelte
+++ b/web/src/picker/AnyKeycode.svelte
@@ -8,7 +8,8 @@
   interface Props {
     /** the expression typed so far; a template click fills it in */
     value: string;
-    onpick: (code: string) => void;
+    /** the keycode, and what it is */
+    onpick: (code: string, described: Described) => void;
   }

   let { value = $bindable(), onpick }: Props = $props();
@@ -55,7 +56,7 @@

   function submit(event: SubmitEvent) {
     event.preventDefault();
-    if (result) onpick(result.code);
+    if (result) onpick(result.code, result);
   }
 </script>

```

Apply to `web/src/picker/Picker.svelte`:

```diff
diff --git a/web/src/picker/Picker.svelte b/web/src/picker/Picker.svelte
--- a/web/src/picker/Picker.svelte
+++ b/web/src/picker/Picker.svelte
@@ -1,6 +1,6 @@
 <script lang="ts">
   import { tick } from "svelte";
-  import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
+  import type { CatalogueKeycode, Described, KeycodeCategory } from "../api/types";
   import { keyFace, type Names } from "../keyboard/labels";
   import AnyKeycode from "./AnyKeycode.svelte";
   import { searchKeycodes, searchTemplates } from "./search";
@@ -14,7 +14,8 @@
     /** the keycode the key has now */
     current: string;
     names: Names;
-    onpick: (code: string) => void;
+    /** the keycode picked, and what it is */
+    onpick: (code: string, described: Described) => void;
   }

   let { open = $bindable(), subject, categories, current, names, onpick }: Props = $props();
@@ -50,9 +51,9 @@
   /** a click closes the picker only if it started on the backdrop too: a drag out of the panel doesn't */
   let pressedOnBackdrop = false;

-  function pick(code: string) {
+  function pick(code: string, described: Described) {
     open = false;
-    onpick(code);
+    onpick(code, described);
   }

   function useTemplate(template: string) {
@@ -72,7 +73,7 @@
       // the top result; an empty search has none (a double or held Enter on opening must not fill a template)
       if (!results) return;
       event.preventDefault();
-      if (results?.[0]) pick(results[0].code);
+      if (results?.[0]) pick(results[0].code, results[0]);
       else if (templates[0]) useTemplate(templates[0]);
     } else if (event.key === "ArrowDown") {
       const first = gridArea?.querySelector<HTMLButtonElement>("button");
@@ -180,7 +181,7 @@
             title={k.description ? `${k.code}: ${k.description}` : k.code}
             aria-label="{k.tap || k.code} ({k.code})"
             aria-describedby={k.description ? `picker-description-${i}` : undefined}
-            onclick={() => pick(k.code)}
+            onclick={() => pick(k.code, k)}
           >
             {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
             {#if face.shifted}<span class="kc-shifted">{face.shifted}</span>{/if}
```

- [ ] **Step 2: The small keyboard, the card and the page**

Create `web/src/behaviours/ComboKeys.svelte`:

```svelte
<script lang="ts">
  // A combo's keys drawn on the base layer: a picture with its keys ringed in the combo's colour, or (choosing) keys
  // to click, arrow keys moving between them, each click adding a key or taking it out.
  import { tick } from "svelte";
  import type { Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, keyLabel, type Names } from "../keyboard/labels";
  import { actionAt, refId, whereIs } from "../keyboard/refs";
  import { neighbour, type Direction } from "../keymap/navigation";
  import { memberProblem } from "./members";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    names: Names;
    /** the combo's keycodes */
    members: Described[];
    /** the combo's colour: a palette index */
    colour: number;
    /** keys to click (choosing the members); otherwise a picture */
    choosing?: boolean;
    /** a key clicked while choosing: its keycode on the base layer */
    onchoose?: (d: Described) => void;
    maxUnit?: number;
    /** what the picture is called, for screen readers (choosing, the keys say it themselves) */
    label?: string;
  }

  let { model, placement, names, members, colour, choosing = false, onchoose, maxUnit = 24, label = "" }: Props = $props();

  let root = $state<HTMLDivElement>();
  let cursor = $state(0);
  /** the keys have the focus: the one the arrow keys move from is outlined */
  let focused = $state(false);

  const codes = $derived(new Set(members.map((m) => m.code)));
  const actions = $derived(placement.items.map((item) => (item.kind === "key" ? actionAt(model, 0, item) : undefined)));
  const isMember = $derived(actions.map((d) => d !== undefined && codes.has(d.code)));
  const usable = $derived(actions.map((d) => memberProblem(d) === null));
  const faces = $derived(placement.items.map((item) => {
    const d = actionAt(model, 0, item);
    return d ? keyFace(d, names) : EMPTY_FACE;
  }));
  const rings = $derived(isMember.map((m) => (m ? `var(--combo-${colour})` : null)));
  const faded = $derived(choosing ? usable.map((u) => !u) : isMember.map((m) => !m));
  const labels = $derived(placement.items.map((item, i) => {
    if (!choosing) return "";
    const { what, where } = whereIs(model, item);
    const state = isMember[i] ? "in the combo" : usable[i] ? "not in the combo" : "can't be in a combo";
    return `${keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`)} · ${state}`;
  }));

  function choose(index: number) {
    cursor = index;
    const d = actions[index];
    if (d) onchoose?.(d);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  async function onkeydown(event: KeyboardEvent) {
    const direction = ARROWS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    cursor = neighbour(placement.items, cursor, direction);
    await tick();
    const item = placement.items[cursor];
    if (item) root?.querySelector<HTMLElement>(`[data-ref="${refId(item)}"]`)?.focus();
  }
</script>

{#if choosing}
  <!-- the arrow keys move between the keys, as in the keymap -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="keys choosing"
    bind:this={root}
    {onkeydown}
    onfocusin={() => (focused = true)}
    onfocusout={(e) => (focused = root?.contains(e.relatedTarget as Node | null) ?? false)}
  >
    <Keyboard {placement} {faces} {labels} {rings} {faded} chosen={isMember} selected={focused ? cursor : -1}
      onselect={choose} {maxUnit} />
  </div>
{:else}
  <div class="keys" role="img" aria-label={label}>
    <Keyboard {placement} {faces} {labels} {rings} {faded} selected={-1} onselect={() => undefined} interactive={false}
      compact {maxUnit} />
  </div>
{/if}

<style>
  .keys {
    min-width: 0;
  }
</style>
```

Create `web/src/behaviours/ComboCard.svelte`:

```svelte
<script lang="ts">
  import type { Combo, Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import ComboKeys from "./ComboKeys.svelte";
  import EntryHead from "./EntryHead.svelte";
  import { MAX_COMBO_KEYS } from "./members";

  interface Props {
    combo: Combo;
    model: KeyboardModel;
    placement: Placement;
    names: Names;
    /** its colour: a palette index */
    colour: number;
    /** what it does, in words, and why it may not fire */
    sentence: string;
    notes: string[];
    canEdit: boolean;
    target: boolean;
    /** being edited: the keycodes and output chosen so far */
    draft: { members: Described[]; output: Described } | null;
    /** why the last key clicked wasn't taken, while editing */
    problem: string | null;
    onedit: () => void;
    onchoose: (d: Described) => void;
    onremove: (code: string) => void;
    onaddbycode: () => void;
    onpickoutput: () => void;
    onsave: () => void;
    oncancel: () => void;
    onclear: () => void;
  }

  let {
    combo, model, placement, names, colour, sentence, notes, canEdit, target, draft, problem, onedit, onchoose, onremove,
    onaddbycode, onpickoutput, onsave, oncancel, onclear,
  }: Props = $props();

  const headingId = $derived(`combo-${combo.index}-title`);
  const members = $derived(draft ? draft.members : combo.keys.filter((k) => k.kind !== "none"));
  const output = $derived(draft ? draft.output : combo.output);
  const outputFace = $derived(keyFace(output, names));
</script>

<article class="card" class:target class:editing={draft !== null} id="combo-{combo.index}" aria-labelledby={headingId}
  style="--colour: var(--combo-{colour})">
  <EntryHead id="Combo {combo.index}" {headingId} name={null} tone="combo" {canEdit}>
    {#snippet actions()}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>

  {#if draft}
    <div class="editor">
      <p class="hint" id="combo-{combo.index}-hint">
        Click keys to add them to the combo, or click them again to take them out (at most {MAX_COMBO_KEYS}). Arrow keys
        move between them.
      </p>
      <div class="board" aria-describedby="combo-{combo.index}-hint">
        <ComboKeys {model} {placement} {names} {members} {colour} choosing {onchoose} maxUnit={44} />
      </div>
      <p class="problem" role="status">{problem ?? ""}</p>
      <div class="parts">
        <div class="part">
          <span class="part-label">Keys</span>
          <ul class="chips">
            {#each members as m (m.code)}
              <li>
                <span class="chip">{m.tap || m.code}</span>
                <button type="button" class="remove" aria-label="Take {m.tap || m.code} out of the combo"
                  onclick={() => onremove(m.code)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </li>
            {/each}
          </ul>
          <Button size="sm" disabled={members.length >= MAX_COMBO_KEYS} onclick={onaddbycode}>Add by keycode…</Button>
        </div>
        <div class="part">
          <span class="part-label">Output</span>
          <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone}>{output.kind === "none" ? "nothing" : outputFace.main || output.code}</span>
          <Button size="sm" onclick={onpickoutput}>Change output…</Button>
        </div>
      </div>
      <div class="buttons">
        <Button variant="danger" disabled={!canEdit} onclick={onclear}>Remove the combo</Button>
        <span class="spacer"></span>
        <Button onclick={oncancel}>Cancel</Button>
        <Button variant="primary" disabled={!canEdit} onclick={onsave}>Save</Button>
      </div>
    </div>
  {:else}
    <div class="row">
      <ComboKeys {model} {placement} {names} {members} {colour} label="Keys of combo {combo.index}: {sentence}" />
      <span class="arrow" aria-hidden="true">→</span>
      <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone}>{output.kind === "none" ? "nothing" : outputFace.main || output.code}</span>
    </div>
    {#if notes.length > 0}
      <ul class="notes">
        {#each notes as note (note)}<li>{note}</li>{/each}
      </ul>
    {/if}
  {/if}
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px 14px 18px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--colour);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    scroll-margin-top: 80px;
  }

  .card.target {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--colour) 55%, transparent), var(--shadow);
  }

  .sentence {
    margin: 0;
    color: var(--text-2);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 360px) auto auto;
    align-items: center;
    justify-content: start;
    gap: 14px;
  }

  @media (max-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
  }

  .arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  .out {
    max-width: 220px;
    overflow: hidden;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--fill);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notes {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 6px 10px 6px 26px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .editor {
    display: grid;
    gap: 10px;
  }

  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .board {
    padding: 14px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
  }

  .problem {
    min-height: 1.4em;
    margin: -4px 0 0;
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 28px;
  }

  .part {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .part-label {
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chips li {
    display: inline-flex;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--colour) 50%, var(--border));
    border-radius: 7px;
    background: color-mix(in srgb, var(--colour) 8%, var(--surface));
  }

  .chip {
    padding: 2px 4px 2px 9px;
    font-weight: 650;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .remove:hover {
    color: var(--danger);
  }

  .remove svg {
    width: 11px;
    height: 11px;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .spacer {
    flex: 1;
  }
</style>
```

Create `web/src/behaviours/CombosPage.svelte`:

```svelte
<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import { COMBO_COLOURS, type ComboInfo } from "../analysis/combos";
  import type { Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import ComboCard from "./ComboCard.svelte";
  import { freeCombo, shownEntries } from "./entries";
  import { isSet, membersOf, toggleMember } from "./members";
  import PageHeader from "./PageHeader.svelte";
  import { comboNotes, comboSentence } from "./sentences";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    analysis: Analysis;
    /** the combo to show (from the address), or null */
    item: number | null;
  }

  let { model, placement, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit && keyboard.pending === 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.combos.length, (i) => isSet(model.combos[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeCombo(model));
  const unshown = $derived(model.combos.length - shown.length);

  useTarget(() => (item === null ? null : `combo-${item}-title`));

  /** the combo being edited: one at a time */
  let draft = $state<{ index: number; members: Described[]; output: Described } | null>(null);
  let problem = $state<string | null>(null);

  /** a combo as the analysis sees it: its keycodes with their keys on the base layer */
  function infoOf(index: number, members: Described[], output: Described): ComboInfo {
    return { index, members: members.map((action) => ({ action, keys: analysis.codes[0]?.get(action.code) ?? [] })), output };
  }

  const cards = $derived(shown.map((index) => {
    const combo = model.combos[index];
    const editing = draft?.index === index ? draft : null;
    const info = editing ? infoOf(index, editing.members, editing.output)
      : analysis.combos.find((c) => c.index === index) ?? infoOf(index, [], combo.output);
    return {
      combo,
      info,
      editing,
      colour: analysis.comboColours.get(index) ?? analysis.comboColours.size % COMBO_COLOURS,
      sentence: comboSentence(info, model, names),
      notes: info.members.length > 0 ? comboNotes(info, analysis.codes, names) : [],
    };
  }));

  function edit(index: number) {
    const combo = model.combos[index];
    draft = { index, members: membersOf(combo), output: combo.output };
    problem = null;
  }

  function choose(d: Described) {
    if (!draft) return;
    const result = toggleMember(draft.members, d);
    draft.members = result.members;
    problem = result.problem;
  }

  async function save(keys: string[], output: string, action: string) {
    if (!draft) return;
    const index = draft.index;
    if (await keyboard.setCombo(index, keys, output, action)) {
      draft = null;
      document.getElementById(`combo-${index}-title`)?.focus();
    }
  }

  function newCombo() {
    if (free === null) return;
    opened = [...opened, free];
    router.go("combos", free);
    edit(free);
  }

  // the keycode picker: a key to add by its keycode, or the output
  let pickerOpen = $state(false);
  let picking = $state<"member" | "output">("output");

  function pick(part: "member" | "output") {
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="combos-title">
  <PageHeader
    id="combos-title"
    title="Combos"
    description="Keys pressed together for another key. Each combo has its colour, which marks its keys in the keymap too."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null || draft !== null}
        title={free === null ? "Every combo is in use" : `Sets up combo ${free}`} onclick={newCombo}>
        New combo
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No combo is set up yet.</p>
  {/if}
  {#each cards as card (card.combo.index)}
    <ComboCard
      combo={card.combo}
      {model}
      {placement}
      {names}
      colour={card.colour}
      sentence={card.sentence}
      notes={card.notes}
      canEdit={canEdit && (draft === null || card.editing !== null)}
      target={card.combo.index === item}
      draft={card.editing}
      problem={card.editing ? problem : null}
      onedit={() => edit(card.combo.index)}
      onchoose={choose}
      onremove={(code) => {
        if (draft) draft.members = draft.members.filter((m) => m.code !== code);
        problem = null;
      }}
      onaddbycode={() => pick("member")}
      onpickoutput={() => pick("output")}
      onsave={() => draft && void save(draft.members.map((m) => m.code), draft.output.code, "Saving the combo")}
      oncancel={() => {
        const index = draft?.index;
        draft = null;
        if (index !== undefined) document.getElementById(`combo-${index}-title`)?.focus();
      }}
      onclear={() => void save([], "KC_NO", "Removing the combo")}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "combo is" : "combos are"} free, of {model.combos.length}.</p>
  {/if}
</section>

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject={picking === "output" ? `Output of combo ${draft.index}` : `A key of combo ${draft.index}`}
    categories={keyboard.catalogue}
    current={picking === "output" ? draft.output.code : "KC_NO"}
    {names}
    onpick={(_, d) => {
      if (!draft) return;
      if (picking === "output") draft.output = d;
      else if (draft.members.some((m) => m.code === d.code)) problem = `${d.tap || d.code} is in the combo already.`;
      else choose(d);
    }}
  />
{/if}

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .empty,
  .more {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .empty {
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    text-align: center;
  }
</style>
```

- [ ] **Step 3: A combo opens from the Inspector, and the navigation**

Apply to `web/src/keymap/ComboList.svelte`:

```diff
diff --git a/web/src/keymap/ComboList.svelte b/web/src/keymap/ComboList.svelte
--- a/web/src/keymap/ComboList.svelte
+++ b/web/src/keymap/ComboList.svelte
@@ -12,9 +12,11 @@
     colours: Map<number, number>;
     /** the key is transparent: the combos are those of the key below, which it falls through to */
     through?: boolean;
+    /** open the combo's card on the Combos page */
+    onopen: (index: number) => void;
   }

-  let { uses, names, colours, through = false }: Props = $props();
+  let { uses, names, colours, through = false, onopen }: Props = $props();

   const entries = $derived(uses.map((use) => ({ use, missing: missingPartners(use, names) })));
   // a transparent key lets the combos of the key below through: those that can fire at all
@@ -32,8 +34,10 @@
   <ul>
     {#each entries as { use, missing } (use.combo.index)}
       <li style="--colour: var(--combo-{colours.get(use.combo.index) ?? 0})">
-        <span class="what">{comboUseLabel(use, names)}</span>
-        <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
+        <button type="button" title="Open combo {use.combo.index} on the Combos page" onclick={() => onopen(use.combo.index)}>
+          <span class="what">{comboUseLabel(use, names)}</span>
+          <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
+        </button>
       </li>
     {/each}
   </ul>
@@ -48,17 +52,27 @@

   ul {
     display: grid;
-    gap: 6px;
+    gap: 4px;
     margin: 0;
     padding: 0;
     list-style: none;
   }

-  li {
+  button {
     display: grid;
     gap: 1px;
-    padding-left: 10px;
+    width: 100%;
+    padding: 4px 8px 4px 10px;
+    border: 0;
     border-left: 3px solid var(--colour);
+    border-radius: 0 8px 8px 0;
+    background: transparent;
+    text-align: left;
+    cursor: pointer;
+  }
+
+  button:hover {
+    background: var(--surface-2);
   }

   .what {
```

Apply to `web/src/keymap/Inspector.svelte`:

```diff
diff --git a/web/src/keymap/Inspector.svelte b/web/src/keymap/Inspector.svelte
--- a/web/src/keymap/Inspector.svelte
+++ b/web/src/keymap/Inspector.svelte
@@ -21,6 +21,8 @@
     comboUses: ComboUse[];
     /** each combo's colour (a palette index), by combo index */
     comboColours: Map<number, number>;
+    /** open a combo's card on the Combos page */
+    onopencombo: (index: number) => void;
     onchangekey: () => void;
     onsetcode: (code: string, action: string) => Promise<boolean>;
     ontapdance: () => void;
@@ -28,7 +30,8 @@
   }

   let {
-    model, names, layer, selection, canEdit, comboUses, comboColours, onchangekey, onsetcode, ontapdance, onjump,
+    model, names, layer, selection, canEdit, comboUses, comboColours, onopencombo, onchangekey, onsetcode, ontapdance,
+    onjump,
   }: Props = $props();

   let editingHold = $state(false);
@@ -82,7 +85,7 @@
   <header>
     <KeyCap {face} size={68} round={selection.kind === "encoder"} />
     <div class="heading">
-      <h2>{keyTitle(current, names)}</h2>
+      <h2 title={keyTitle(current, names)}>{keyTitle(current, names)}</h2>
       <p class="position" title={position}>{position}</p>
     </div>
   </header>
@@ -183,7 +186,8 @@
   {/if}

   {#if comboUses.length > 0}
-    <ComboList uses={comboUses} {names} colours={comboColours} through={current.kind === "transparent"} />
+    <ComboList uses={comboUses} {names} colours={comboColours} through={current.kind === "transparent"}
+      onopen={onopencombo} />
   {/if}
 </aside>

@@ -214,8 +218,14 @@
     min-width: 0;
   }

+  /* a long tap dance or macro name is cut short after two lines; the tooltip has all of it */
   h2 {
+    display: -webkit-box;
     margin: 0;
+    overflow: hidden;
+    -webkit-box-orient: vertical;
+    -webkit-line-clamp: 2;
+    line-clamp: 2;
     font-size: 17px;
     line-height: 1.25;
     letter-spacing: -0.01em;
```

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -256,6 +256,7 @@
             canEdit={keyboard.canEdit && keyboard.pending === 0}
             {comboUses}
             comboColours={analysis.comboColours}
+            onopencombo={(index) => router.go("combos", index)}
             onchangekey={() => (pickerOpen = true)}
             onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
             ontapdance={() => fromInspector(turnIntoTapDance)}
```

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -1,5 +1,6 @@
 <script lang="ts">
   import { analyse } from "./analysis/analysis";
+  import CombosPage from "./behaviours/CombosPage.svelte";
   import { behaviourCounts } from "./behaviours/entries";
   import TapDancePage from "./behaviours/TapDancePage.svelte";
   import { placeKeyboard } from "./keyboard/geometry";
@@ -30,6 +31,7 @@
     if (!model) return list;
     const counts = behaviourCounts(model);
     if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
+    if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
     return list;
   });
   // a section this keyboard doesn't have shows the keymap
@@ -103,6 +105,8 @@
       <div class="page" class:list={section !== "keymap"} class:blocked inert={blocked}>
         {#if section === "tap-dance"}
           <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
+        {:else if section === "combos"}
+          <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
         {:else}
           <KeymapPage model={keyboard.model} {placement} {analysis} />
         {/if}
```

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 4: e2e: a combo made by clicking keys, opened from the Inspector, reaching a layer, two combos sharing a key**

Apply to `web/e2e/behaviours.spec.ts`:

```diff
diff --git a/web/e2e/behaviours.spec.ts b/web/e2e/behaviours.spec.ts
--- a/web/e2e/behaviours.spec.ts
+++ b/web/e2e/behaviours.spec.ts
@@ -1,14 +1,19 @@
-import type { Page } from "@playwright/test";
-import { expect, keyIndex, setTapDance, simulatorUnlock, tapDanceAt, test, unlockState } from "./fixtures";
+import type { Locator, Page } from "@playwright/test";
+import {
+  comboAt, expect, keyIndex, screenshots, setCombo, setTapDance, simulatorUnlock, tapDanceAt, test, unlockState,
+} from "./fixtures";

 // The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

+const EMPTY_COMBO = { keys: ["KC_NO", "KC_NO", "KC_NO", "KC_NO"], output: "KC_NO" };
+
 async function openSection(page: Page, name: "Tap dance" | "Combos" | "Macros") {
   await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
   await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
 }

 const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);
+const comboCard = (page: Page, index: number) => page.locator(`#combo-${index}`);

 /** The picker's any-keycode box: type a keycode and use it */
 async function pickAnyKeycode(page: Page, code: string) {
@@ -20,6 +25,12 @@ async function pickAnyKeycode(page: Page, code: string) {
   await expect(picker).toBeHidden();
 }

+/** A full-page screenshot from the top: the sticky top bar is drawn where the page was scrolled to */
+async function pageShots(page: Page, name: string) {
+  await page.evaluate(() => window.scrollTo(0, 0));
+  await screenshots(page, name, { fullPage: true });
+}
+
 /** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't, as the server started */
 async function unlockAgain(page: Page) {
   await simulatorUnlock(page, { keysHeld: false });
@@ -31,6 +42,18 @@ async function unlockAgain(page: Page) {
   await simulatorUnlock(page, { keysHeld: false });
 }

+/** The computed fill of an SVG shape */
+const fillOf = (shape: Locator) => shape.evaluate((e) => getComputedStyle(e).fill);
+/** A combo colour as the page computes it */
+const comboColour = (page: Page, colour: number) => page.evaluate((c) => {
+  const probe = document.createElement("i");
+  probe.style.color = `var(--combo-${c})`;
+  document.body.append(probe);
+  const value = getComputedStyle(probe).color;
+  probe.remove();
+  return value;
+}, colour);
+
 test.describe("tap dance", () => {
   test("a slot is changed with the picker, and \"used on\" goes to the key", async ({ app }) => {
     const before = await tapDanceAt(app, 0);
@@ -100,6 +123,95 @@ test.describe("tap dance", () => {
   });
 });

+test.describe("combos", () => {
+  test("a combo made by clicking its keys is marked on them", async ({ app }) => {
+    try {
+      await openSection(app, "Combos");
+      await app.getByRole("button", { name: "New combo" }).click();
+      await expect(app).toHaveURL(/#combos\/2$/);
+      const card = comboCard(app, 2);
+      const l = card.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
+      const r = card.locator(`[data-ref="key:${await keyIndex(app, 0, 3)}"]`);
+      await l.click();
+      await r.click();
+      await expect(l).toHaveAttribute("aria-pressed", "true");
+      await expect(r).toHaveAccessibleName(/· in the combo$/);
+      await expect(card).toContainText("Press L + R together: it does nothing yet.");
+      // clicking a chosen key takes it out; the arrow keys move between keys
+      await r.click();
+      await expect(r).toHaveAttribute("aria-pressed", "false");
+      await r.press("Enter");
+      await expect(r).toHaveAttribute("aria-pressed", "true");
+      await pageShots(app, "combo-editor");
+      await card.getByRole("button", { name: "Change output…" }).click();
+      await pickAnyKeycode(app, "KC_TAB");
+      await card.getByRole("button", { name: "Save" }).click();
+      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
+      expect(await comboAt(app, 2)).toEqual({ keys: ["KC_L", "KC_R", "KC_NO", "KC_NO"], output: "KC_TAB" });
+      await expect(card).toContainText("Press L + R together for Tab.");
+      await expect(card.locator(".key.ringed")).toHaveCount(2);
+
+      // the keymap marks them in the combo's colour: the third combo on the base layer, the third colour
+      await app.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Keymap/ }).click();
+      const key = app.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
+      await expect(key).toHaveAccessibleName(/· in combo 2$/);
+      expect(await fillOf(key.locator(".combo-mark"))).toBe(await comboColour(app, 2));
+    } finally {
+      await setCombo(app, 2, EMPTY_COMBO);
+    }
+  });
+
+  test("a combo's card opens from the Inspector", async ({ app }) => {
+    await app.locator(`[data-ref="key:${await keyIndex(app, 6, 2)}"]`).click(); // K
+    await app.getByRole("region", { name: "Combos with this key" }).getByRole("button", { name: /with Y → Esc/ }).click();
+    await expect(app).toHaveURL(/#combos\/0$/);
+    await expect(comboCard(app, 0)).toHaveClass(/\btarget\b/);
+    await expect(comboCard(app, 0).getByRole("heading", { level: 2 })).toBeFocused();
+    await expect(comboCard(app, 0)).toContainText("Press K + Y together for Esc.");
+    // the reload keeps the page
+    await app.reload();
+    await expect(app.getByRole("heading", { level: 1, name: "Combos" })).toBeVisible();
+  });
+
+  test("a combo of two layer keys says which layer it reaches", async ({ app }) => {
+    const before = await comboAt(app, 2);
+    try {
+      await setCombo(app, 2, { keys: ["LT1(KC_SPC)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
+      await app.reload();
+      await openSection(app, "Combos");
+      await expect(comboCard(app, 2)).toContainText(
+        "Press Space (hold: Layer 1) + OSL(3) together → reaches Layer 2, while held.");
+    } finally {
+      await setCombo(app, 2, before);
+    }
+  });
+
+  test("two combos sharing a key: dots in both colours on it, an underline in its own on each other key", async ({ app }) => {
+    const before = await comboAt(app, 2);
+    try {
+      await setCombo(app, 2, { keys: ["KC_K", "KC_L", "KC_NO", "KC_NO"], output: "KC_X" });
+      await app.reload();
+      await expect(app.locator("button.key").first()).toBeVisible();
+      const k = app.locator(`[data-ref="key:${await keyIndex(app, 6, 2)}"]`);
+      const y = app.locator(`[data-ref="key:${await keyIndex(app, 6, 1)}"]`);
+      const l = app.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
+      await expect(k).toHaveAccessibleName(/· in combos 0 and 2$/);
+      const dots = k.locator(".combo-dot");
+      await expect(dots).toHaveCount(2);
+      const [first, second] = [await fillOf(dots.nth(0)), await fillOf(dots.nth(1))];
+      expect(first).not.toBe(second);
+      expect(first).toBe(await comboColour(app, 0));
+      expect(second).toBe(await comboColour(app, 2));
+      await expect(k.locator(".combo-mark")).toHaveCount(0);
+      expect(await fillOf(y.locator(".combo-mark"))).toBe(first);
+      expect(await fillOf(l.locator(".combo-mark"))).toBe(second);
+      await screenshots(app, "combo-dots");
+    } finally {
+      await setCombo(app, 2, before);
+    }
+  });
+});
+
 test("the top bar locks and unlocks the keyboard; a cancelled unlock can be taken up again", async ({ app }) => {
   test.setTimeout(60_000);
   try {
```

```bash
cd web && npm run check && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `46 passed`: four combo tests more.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/behaviours.spec.ts \
  web/src/App.svelte \
  web/src/behaviours/ComboCard.svelte \
  web/src/behaviours/ComboKeys.svelte \
  web/src/behaviours/CombosPage.svelte \
  web/src/keymap/ComboList.svelte \
  web/src/keymap/Inspector.svelte \
  web/src/keymap/KeymapPage.svelte \
  web/src/picker/AnyKeycode.svelte \
  web/src/picker/Picker.svelte
git commit -m "feat(web): the Combos page: a combo's keys chosen by clicking them, and its card opened from the Inspector"
```

### Task 19: The Macros page

- **`StepChain`:** a macro's steps as a chain: type "ls -la" → tap Enter → press LCtrl → wait 30 ms.
- **`MemoryBar`:** "Uses N of M bytes". The bar turns amber at 85 % and red when the macros don't fit: "Needs N bytes, but the keyboard has M".
- **`MacroEditor`:**
  - steps added (text, tap, press, release, wait), removed, moved up or down, and changed in kind;
  - a key step's keys chosen with the picker;
  - "Record from keyboard" (`Recording`, Task 11): capture-phase listeners while it records; Esc or "Stop recording" ends it, and it says how many steps it recorded and how many keys have no keycode;
  - Save is disabled while a step has a problem or the memory is over.
- **`MacroCard`:** the chain, its size, "used on", Edit and rename.
- **`MacrosPage`:**
  - one card per macro set up or used; one macro is edited at a time;
  - "New macro" opens the first free one;
  - the memory bar counts what is being edited;
  - saving sends every macro (`setMacros`). On a locked keyboard the server refuses it, the unlock dialog opens, and the macros are sent again once unlocked.
- **`App.svelte`:** Macros joins the navigation.

**Files:**
- Create: `web/src/behaviours/StepChain.svelte`, `web/src/behaviours/MemoryBar.svelte`, `web/src/behaviours/MacroEditor.svelte`, `web/src/behaviours/MacroCard.svelte`, `web/src/behaviours/MacrosPage.svelte`
- Modify: `web/src/App.svelte`, `web/e2e/fixtures.ts`, `web/e2e/behaviours.spec.ts`

- [ ] **Step 1: The chain, the memory bar and the editor**

Create `web/src/behaviours/StepChain.svelte`:

```svelte
<script lang="ts">
  import { stepVerb, stepWhat, type Step } from "./macro";

  interface Props {
    steps: Step[];
  }

  // a macro's steps as a chain: type “git status” → tap Enter → wait 50 ms
  let { steps }: Props = $props();
</script>

{#if steps.length === 0}
  <p class="none">No steps yet.</p>
{:else}
  <ol class="chain">
    {#each steps as step, i (i)}
      <li class="step {step.type}">
        <i>{stepVerb(step)}</i>
        <span title={stepWhat(step)}>{stepWhat(step)}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .chain {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: inline-grid;
    max-width: 100%;
    padding: 3px 9px 4px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--board-bg);
  }

  /* an arrow between two steps */
  .step + .step::before {
    content: "→";
    position: absolute;
    margin-left: -18px;
    color: var(--text-3);
  }

  .step + .step {
    position: relative;
    margin-left: 14px;
  }

  .step.tap,
  .step.down,
  .step.up {
    border-color: color-mix(in srgb, var(--tone-macro) 45%, var(--border));
    background: color-mix(in srgb, var(--tone-macro) 10%, var(--surface));
  }

  i {
    color: var(--text-3);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 600;
    line-height: 1.2;
  }

  span {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .none {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }
</style>
```

Create `web/src/behaviours/MemoryBar.svelte`:

```svelte
<script lang="ts">
  import { memoryLevel } from "./macro";

  interface Props {
    /** bytes the macros take, with what is being edited */
    used: number;
    /** bytes the keyboard has for them */
    memory: number;
  }

  let { used, memory }: Props = $props();

  const level = $derived(memoryLevel(used, memory));
  const share = $derived(memory > 0 ? Math.min(1, used / memory) : 1);
</script>

<div class="memory {level}">
  <div class="text">
    <span class="title" id="macro-memory-title">Macro memory</span>
    <span class="count" aria-live="polite">
      {#if level === "over"}
        Needs {used} bytes, but the keyboard has {memory}: take {used - memory} out.
      {:else}
        Uses {used} of {memory} bytes{level === "near" ? ": nearly full" : ""}
      {/if}
    </span>
  </div>
  <div
    class="bar"
    role="meter"
    aria-labelledby="macro-memory-title"
    aria-valuemin={0}
    aria-valuemax={memory}
    aria-valuenow={Math.min(used, memory)}
    aria-valuetext="{used} of {memory} bytes"
  >
    <span style="width: {share * 100}%"></span>
  </div>
</div>

<style>
  .memory {
    display: grid;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }

  .text {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 13px;
  }

  .title {
    font-weight: 650;
  }

  .count {
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .bar {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .near .bar span {
    background: var(--tone-macro);
  }

  .near .count {
    color: var(--warning-text);
    font-weight: 600;
  }

  .over {
    border-color: var(--danger-line);
    background: var(--danger-weak);
  }

  .over .bar span {
    background: var(--danger);
  }

  .over .count {
    color: var(--danger);
    font-weight: 650;
  }
</style>
```

Create `web/src/behaviours/MacroEditor.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import type { Described } from "../api/types";
  import Button from "../ui/Button.svelte";
  import {
    changeKind, DELAY_MAX, macroBytes, moveStep, newStep, STEP_KINDS, stepBytes, stepProblem, STEPS_MAX, type Step,
    type StepKind,
  } from "./macro";
  import { Recording, type Recorded } from "./recorder";

  interface Props {
    /** the macro's number, for the labels */
    index: number;
    /** the steps being edited: changed here */
    steps: Step[];
    vialProtocol: number;
    /** choose a key for a step (with the keycode picker): the step's index */
    onpickkey: (step: number) => void;
    /** a recorded keycode, described as the server does */
    describe: (code: string) => Promise<Described>;
    /** why it can't be saved, beyond its steps (the macro memory is full), or null */
    blocked: string | null;
    canSave: boolean;
    onsave: () => void;
    oncancel: () => void;
  }

  let { index, steps = $bindable(), vialProtocol, onpickkey, describe, blocked, canSave, onsave, oncancel }: Props =
    $props();

  let list = $state<HTMLOListElement>();
  const problems = $derived(steps.map((s) => stepProblem(s, vialProtocol)));
  const bytes = $derived(macroBytes(steps, vialProtocol));
  const kinds = $derived(STEP_KINDS.filter((k) => k.kind !== "delay" || vialProtocol >= 2));
  const tooMany = $derived(steps.length > STEPS_MAX);
  const ready = $derived(canSave && !tooMany && blocked === null && problems.every((p) => p === null));

  async function focusStep(i: number, part = "select") {
    await tick();
    list?.querySelectorAll<HTMLLIElement>(":scope > li")[i]?.querySelector<HTMLElement>(part)?.focus();
  }

  function add(kind: StepKind) {
    steps.push(newStep(kind));
    const i = steps.length - 1;
    if (kind === "tap" || kind === "down" || kind === "up") onpickkey(i);
    else void focusStep(i, "input");
  }

  function move(i: number, to: number) {
    steps = moveStep(steps, i, to);
    void focusStep(to, `button.${to < i ? "up" : "down"}`);
  }

  function remove(i: number) {
    steps.splice(i, 1);
    if (steps.length > 0) void focusStep(Math.min(i, steps.length - 1));
  }

  // recording keys typed into the browser window
  let recording = $state<Recording | null>(null);
  /** what has been recorded so far: shown while recording */
  let recorded = $state<Recorded[]>([]);
  let recordedSkipped = $state(0);
  let recordNote = $state<string | null>(null);

  function startRecording() {
    recording = new Recording();
    recorded = [];
    recordedSkipped = 0;
    recordNote = null;
  }

  async function stopRecording() {
    const done = recording;
    recording = null;
    if (!done) return;
    try {
      const made = await Promise.all(done.steps.map(async (r): Promise<Step> => r.type === "text"
        ? { type: "text", text: r.text, keys: [], delay: null }
        : { type: "tap", text: null, keys: [await describe(r.code)], delay: null }));
      steps.push(...made);
      recordNote = `${made.length} ${made.length === 1 ? "step" : "steps"} recorded` +
        (done.skipped > 0 ? `; ${done.skipped} ${done.skipped === 1 ? "key has" : "keys have"} no keycode here` : "") + ".";
    } catch {
      recordNote = "The keys recorded couldn't all be read: nothing was added.";
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      void stopRecording();
      return;
    }
    recording.keydown({ code: event.code, key: event.key, repeat: event.repeat, altGraph: event.getModifierState("AltGraph") });
    recorded = [...recording.steps];
    recordedSkipped = recording.skipped;
  }

  function onkeyup(event: KeyboardEvent) {
    if (!recording) return;
    event.preventDefault();
    recording.keyup({ code: event.code });
  }

  // while recording, every key typed into the window is the macro's (before anything else on the page sees it)
  $effect(() => {
    if (!recording) return;
    window.addEventListener("keydown", onkeydown, true);
    window.addEventListener("keyup", onkeyup, true);
    return () => {
      window.removeEventListener("keydown", onkeydown, true);
      window.removeEventListener("keyup", onkeyup, true);
    };
  });
</script>

<div class="editor">
  {#if steps.length > 0}
    <ol class="steps" bind:this={list} aria-label="Steps of macro {index}">
      {#each steps as step, i (i)}
        {@const problem = problems[i]}
        <li class="step" class:bad={problem !== null}>
          <span class="n" aria-hidden="true">{i + 1}</span>
          <select
            aria-label="Step {i + 1}: what it does"
            value={step.type}
            onchange={(e) => (steps[i] = changeKind(step, e.currentTarget.value as StepKind))}
          >
            {#each kinds as k (k.kind)}<option value={k.kind}>{k.label}</option>{/each}
          </select>
          <div class="value">
            {#if step.type === "text"}
              <input
                class="text"
                aria-label="Step {i + 1}: the text to type"
                aria-invalid={problem !== null}
                value={step.text ?? ""}
                spellcheck="false"
                autocomplete="off"
                oninput={(e) => (step.text = e.currentTarget.value)}
              />
            {:else if step.type === "delay"}
              <label class="delay">
                <input
                  type="number"
                  min="0"
                  max={DELAY_MAX}
                  step="10"
                  aria-label="Step {i + 1}: how long to wait, in ms"
                  value={step.delay ?? 0}
                  oninput={(e) => (step.delay = e.currentTarget.valueAsNumber)}
                />
                <span>ms</span>
              </label>
            {:else}
              <ul class="keys">
                {#each step.keys as key, k (k)}
                  <li>
                    <span class="key">{key.tap || key.code}</span>
                    <button type="button" class="icon" aria-label="Take {key.tap || key.code} out of step {i + 1}"
                      onclick={() => step.keys.splice(k, 1)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                    </button>
                  </li>
                {/each}
              </ul>
              <Button size="sm" onclick={() => onpickkey(i)}>{step.keys.length === 0 ? "Choose key…" : "Add key…"}</Button>
            {/if}
          </div>
          <span class="bytes" title="Bytes of macro memory this step takes">{stepBytes(step, vialProtocol)} B</span>
          <div class="order">
            <button type="button" class="icon up" aria-label="Move step {i + 1} up" disabled={i === 0} onclick={() => move(i, i - 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
            </button>
            <button type="button" class="icon down" aria-label="Move step {i + 1} down" disabled={i === steps.length - 1}
              onclick={() => move(i, i + 1)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
            </button>
            <button type="button" class="icon remove" aria-label="Remove step {i + 1}" onclick={() => remove(i)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
            </button>
          </div>
          {#if problem}<p class="problem">{problem}</p>{/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="none">No steps yet: add some, or record them.</p>
  {/if}

  <div class="add" role="group" aria-label="Add a step">
    <span class="label">Add</span>
    {#each kinds as k (k.kind)}
      <Button size="sm" disabled={recording !== null} onclick={() => add(k.kind)}>{k.label}</Button>
    {/each}
    {#if recording}
      <Button size="sm" variant="primary" onclick={() => void stopRecording()}>Stop recording</Button>
    {:else}
      <Button size="sm" onclick={startRecording}>
        <span class="dot" aria-hidden="true"></span>Record from keyboard
      </Button>
    {/if}
  </div>

  {#if recording}
    <div class="recording" role="status">
      <strong>Recording: type the keys of the macro.</strong>
      <span>Esc or Stop recording ends it. Only this browser window hears them, never the keyboard itself.</span>
      {#if recorded.length > 0 || recordedSkipped > 0}
        <span class="so-far">
          {recorded.map((r) => (r.type === "text" ? `“${r.text}”` : r.code)).join(" → ")}
          {recordedSkipped > 0 ? ` (${recordedSkipped} not recorded)` : ""}
        </span>
      {/if}
    </div>
  {:else if recordNote}
    <p class="note" role="status">{recordNote}</p>
  {/if}

  <div class="foot">
    <span class="size">
      {bytes} {bytes === 1 ? "byte" : "bytes"}{tooMany ? ` · at most ${STEPS_MAX} steps` : ""}
    </span>
    {#if blocked}<span class="blocked">{blocked}</span>{/if}
    <span class="spacer"></span>
    <Button onclick={oncancel} disabled={recording !== null}>Cancel</Button>
    <Button variant="primary" disabled={!ready || recording !== null} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 10px;
  }

  .steps {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: grid;
    grid-template-columns: 22px 130px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--board-bg);
  }

  .step.bad {
    border-color: color-mix(in srgb, var(--warning-text) 45%, var(--border));
  }

  @media (max-width: 640px) {
    .step {
      grid-template-columns: 22px minmax(0, 1fr) auto;
    }

    .value {
      grid-column: 1 / -1;
    }
  }

  .n {
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  select,
  input {
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 13px;
  }

  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .text {
    flex: 1;
    width: 100%;
    font-family: var(--mono);
  }

  .delay {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
  }

  .delay input {
    width: 96px;
    font-variant-numeric: tabular-nums;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .keys li {
    display: inline-flex;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--tone-macro) 45%, var(--border));
    border-radius: 7px;
    background: color-mix(in srgb, var(--tone-macro) 10%, var(--surface));
  }

  .key {
    padding: 1px 2px 1px 8px;
    font-weight: 650;
  }

  .bytes {
    color: var(--text-3);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .order {
    display: flex;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .icon:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .icon.remove:hover:not(:disabled) {
    color: var(--danger);
  }

  .icon:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .icon svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .problem {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--warning-text);
    font-size: 12px;
  }

  .none,
  .note {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .label {
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }

  .recording {
    display: grid;
    gap: 2px;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 9px;
    background: var(--danger-weak);
    font-size: 13px;
  }

  .so-far {
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: 12px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .size {
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .blocked {
    color: var(--danger);
    font-size: 13px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }
</style>
```

- [ ] **Step 2: The card and the page**

Create `web/src/behaviours/MacroCard.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Use } from "../analysis/usage";
  import type { Macro } from "../api/types";
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import { macroBytes } from "./macro";
  import StepChain from "./StepChain.svelte";
  import UsedOn from "./UsedOn.svelte";

  interface Props {
    macro: Macro;
    names: Names;
    positions: Map<string, string>;
    uses: Use[];
    vialProtocol: number;
    canEdit: boolean;
    target: boolean;
    /** the step editor, while this macro is edited */
    editor?: Snippet;
    onedit: () => void;
    onrename: () => void;
    onopenuse: (use: Use) => void;
  }

  let { macro, names, positions, uses, vialProtocol, canEdit, target, editor, onedit, onrename, onopenuse }: Props =
    $props();

  const headingId = $derived(`macro-${macro.index}-title`);
  const bytes = $derived(macroBytes(macro.actions, vialProtocol));
</script>

<article class="card" class:target id="macro-{macro.index}" aria-labelledby={headingId}>
  <EntryHead id="M {macro.index}" {headingId} name={macro.name} tone="macro" {canEdit} {onrename}
    renameLabel="Rename macro {macro.index}">
    {#snippet actions()}
      {#if !editor}
        <span class="bytes">{bytes} {bytes === 1 ? "byte" : "bytes"}</span>
        <Button size="sm" disabled={!canEdit} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  {#if editor}
    {@render editor()}
  {:else}
    <StepChain steps={macro.actions} />
  {/if}

  <UsedOn {uses} {names} {positions} keycode="M{macro.index}" onopen={onopenuse} />
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    scroll-margin-top: 80px;
  }

  .card.target {
    border-color: var(--tone-macro);
    box-shadow: 0 0 0 1px var(--tone-macro), var(--shadow);
  }

  .bytes {
    align-self: center;
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
</style>
```

Create `web/src/behaviours/MacrosPage.svelte`:

```svelte
<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import { api } from "../api/api";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";
  import { describeCode } from "./codes";
  import { freeMacro, macroIsSet, shownEntries } from "./entries";
  import { memoryUsed, stepRequest, type Step } from "./macro";
  import MacroCard from "./MacroCard.svelte";
  import MacroEditor from "./MacroEditor.svelte";
  import MemoryBar from "./MemoryBar.svelte";
  import { openUse } from "./navigate";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the macro to show (from the address), or null */
    item: number | null;
  }

  let { model, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit && keyboard.pending === 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.macros.items.length,
    (i) => macroIsSet(model.macros.items[i]) || (analysis.usage.macros[i]?.length ?? 0) > 0,
    item === null ? opened : [...opened, item]));
  const free = $derived(freeMacro(model, analysis.usage));
  const unshown = $derived(model.macros.items.length - shown.length);

  useTarget(() => (item === null ? null : `macro-${item}-title`));

  /** the macro being edited: one at a time */
  let draft = $state<{ index: number; steps: Step[] } | null>(null);

  /** every macro's steps, the one being edited as it is now */
  const items = $derived(model.macros.items.map((m) => (draft?.index === m.index ? draft.steps : m.actions)));
  // while editing, worked out from the steps (as the keyboard will count them); else as the keyboard said
  const used = $derived(draft ? memoryUsed(items, model.vialProtocol) : model.macros.used);
  const blocked = $derived(used > model.macros.memory
    ? `The macros need ${used} bytes, but the keyboard has ${model.macros.memory}.` : null);

  function edit(index: number) {
    const macro = model.macros.items[index];
    // a copy: nothing changes on the card until the keyboard took it
    draft = { index, steps: macro.actions.map((a) => ({ ...a, keys: [...a.keys] })) };
  }

  async function save() {
    if (!draft) return;
    const index = draft.index;
    if (await keyboard.setMacros(items.map((steps) => steps.map(stepRequest)))) {
      draft = null;
      document.getElementById(`macro-${index}-title`)?.focus();
    }
  }

  function cancel() {
    const index = draft?.index;
    draft = null;
    if (index !== undefined) document.getElementById(`macro-${index}-title`)?.focus();
  }

  function newMacro() {
    if (free === null) return;
    opened = [...opened, free];
    router.go("macros", free);
    edit(free);
  }

  // the keycode picker, for a step's keys
  let pickerOpen = $state(false);
  let pickingStep = $state(0);

  // naming, in the name dialog
  let renaming = $state<number | null>(null);
  const subject = $derived<NameSubject | null>(renaming === null ? null : {
    title: `Rename macro ${renaming}`,
    label: `Name of macro ${renaming}`,
    empty: "a name made from what it types",
    placeholder: "",
    text: model.macros.items[renaming]?.customName ? model.macros.items[renaming].name : "",
  });
</script>

<section class="page" aria-labelledby="macros-title">
  <PageHeader
    id="macros-title"
    title="Macros"
    description="One key types text, taps keys and waits, step by step. All macros share the keyboard's macro memory."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null || draft !== null}
        title={free === null ? "Every macro is in use" : `Sets up macro ${free}`} onclick={newMacro}>
        New macro
      </Button>
    {/snippet}
  </PageHeader>

  <MemoryBar {used} memory={model.macros.memory} />

  {#if shown.length === 0}
    <p class="empty">No macro is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    {@const macro = model.macros.items[index]}
    <MacroCard
      {macro}
      {names}
      positions={analysis.positions}
      uses={analysis.usage.macros[index] ?? []}
      vialProtocol={model.vialProtocol}
      canEdit={canEdit && draft === null}
      target={index === item}
      onedit={() => edit(index)}
      onrename={() => (renaming = index)}
      onopenuse={openUse}
      editor={draft?.index === index ? stepEditor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "macro is" : "macros are"} free, of {model.macros.items.length}.</p>
  {/if}
</section>

{#snippet stepEditor()}
  {#if draft}
    <MacroEditor
      index={draft.index}
      bind:steps={draft.steps}
      vialProtocol={model.vialProtocol}
      onpickkey={(step) => {
        pickingStep = step;
        pickerOpen = true;
      }}
      describe={(code) => describeCode(keyboard.catalogue, code, api.parse)}
      {blocked}
      canSave={canEdit}
      onsave={() => void save()}
      oncancel={cancel}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="Macro {draft.index}, step {pickingStep + 1}"
    categories={keyboard.catalogue}
    current={draft.steps[pickingStep]?.keys.at(-1)?.code ?? "KC_NO"}
    {names}
    onpick={(_, d) => draft?.steps[pickingStep]?.keys.push(d)}
  />
{/if}

<NameDialog
  {subject}
  onsave={(name) => {
    const index = renaming;
    if (index === null) return Promise.resolve(true);
    const macro = model.macros.items[index];
    return name === (macro?.customName ? macro.name : "") ? Promise.resolve(true) : keyboard.rename("macros", index, name);
  }}
  onclose={() => {
    const index = renaming;
    renaming = null;
    if (index !== null) document.getElementById(`macro-${index}`)?.querySelector<HTMLElement>(".rename")?.focus();
  }}
/>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .empty,
  .more {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .empty {
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    text-align: center;
  }
</style>
```

- [ ] **Step 3: The navigation**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -2,6 +2,7 @@
   import { analyse } from "./analysis/analysis";
   import CombosPage from "./behaviours/CombosPage.svelte";
   import { behaviourCounts } from "./behaviours/entries";
+  import MacrosPage from "./behaviours/MacrosPage.svelte";
   import TapDancePage from "./behaviours/TapDancePage.svelte";
   import { placeKeyboard } from "./keyboard/geometry";
   import { namesOf } from "./keyboard/labels";
@@ -32,6 +33,7 @@
     const counts = behaviourCounts(model);
     if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
     if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
+    if (counts.macros !== null) list.push({ id: "macros", label: "Macros", count: counts.macros });
     return list;
   });
   // a section this keyboard doesn't have shows the keymap
@@ -107,6 +109,8 @@
           <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
         {:else if section === "combos"}
           <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
+        {:else if section === "macros"}
+          <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
         {:else}
           <KeymapPage model={keyboard.model} {placement} {analysis} />
         {/if}
```

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 4: e2e: a macro of every kind of step and recorded keys, and a macro saved on a locked keyboard once it is unlocked**

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -153,6 +153,18 @@ export async function setTapDance(page: Page, index: number, body: Awaited<Retur
   await put(page, `/api/tap-dance/${index}`, body);
 }

+/** Every macro's steps, as the server takes them */
+export async function macrosOf(page: Page): Promise<unknown[][]> {
+  const model = await keyboardModel(page);
+  return model.macros.items.map((m: { actions: { type: string; text: string | null; keys: { code: string }[];
+    delay: number | null }[] }) => m.actions.map((a) => ({ ...a, keys: a.keys.map((k) => k.code) })));
+}
+
+/** Sets every macro through the API (the simulated keyboard must be unlocked) */
+export async function setMacros(page: Page, items: unknown[][]): Promise<void> {
+  await put(page, "/api/macros", { items });
+}
+
 /** The fake server's test hook: the user holds the simulated keyboard's unlock keys (or lets go), or it is locked */
 export async function simulatorUnlock(page: Page, change: { keysHeld?: boolean; locked?: boolean }): Promise<void> {
   await put(page, "/api/simulator/unlock", change);
```

Apply to `web/e2e/behaviours.spec.ts`:

```diff
diff --git a/web/e2e/behaviours.spec.ts b/web/e2e/behaviours.spec.ts
--- a/web/e2e/behaviours.spec.ts
+++ b/web/e2e/behaviours.spec.ts
@@ -1,6 +1,7 @@
 import type { Locator, Page } from "@playwright/test";
 import {
-  comboAt, expect, keyIndex, screenshots, setCombo, setTapDance, simulatorUnlock, tapDanceAt, test, unlockState,
+  comboAt, expect, keyIndex, macrosOf, screenshots, setCombo, setMacros, setTapDance, simulatorUnlock, tapDanceAt, test,
+  unlockState,
 } from "./fixtures";

 // The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`
@@ -14,6 +15,7 @@ async function openSection(page: Page, name: "Tap dance" | "Combos" | "Macros")

 const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);
 const comboCard = (page: Page, index: number) => page.locator(`#combo-${index}`);
+const macroCard = (page: Page, index: number) => page.locator(`#macro-${index}`);

 /** The picker's any-keycode box: type a keycode and use it */
 async function pickAnyKeycode(page: Page, code: string) {
@@ -31,6 +33,13 @@ async function pageShots(page: Page, name: string) {
   await screenshots(page, name, { fullPage: true });
 }

+/** The element ends inside the window: nothing to scroll to */
+async function expectInWindow(page: Page, element: Locator) {
+  const box = (await element.boundingBox())!;
+  expect(box.y).toBeGreaterThanOrEqual(0);
+  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
+}
+
 /** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't, as the server started */
 async function unlockAgain(page: Page) {
   await simulatorUnlock(page, { keysHeld: false });
@@ -212,6 +221,98 @@ test.describe("combos", () => {
   });
 });

+test.describe("macros", () => {
+  test("a macro is built from every kind of step, and from keys recorded in the browser", async ({ app }) => {
+    const before = await macrosOf(app);
+    try {
+      await openSection(app, "Macros");
+      await expect(app.locator(".memory")).toContainText(/Uses \d+ of 900 bytes/);
+      await app.getByRole("button", { name: "New macro" }).click();
+      await expect(app).toHaveURL(/#macros\/2$/);
+      const card = macroCard(app, 2);
+      const add = card.getByRole("group", { name: "Add a step" });
+
+      await add.getByRole("button", { name: "Type text" }).click();
+      await card.getByLabel("Step 1: the text to type").fill("ls -la");
+      await add.getByRole("button", { name: "Tap a key" }).click();
+      await pickAnyKeycode(app, "KC_ENTER");
+      await add.getByRole("button", { name: "Press a key" }).click();
+      await pickAnyKeycode(app, "KC_LCTRL");
+      await add.getByRole("button", { name: "Wait" }).click();
+      await card.getByLabel("Step 4: how long to wait, in ms").fill("30");
+      await add.getByRole("button", { name: "Release a key" }).click();
+      await pickAnyKeycode(app, "KC_LCTRL");
+      // moved: release before the wait
+      await card.getByRole("button", { name: "Move step 5 up" }).click();
+
+      await add.getByRole("button", { name: "Record from keyboard" }).click();
+      await expect(card.getByRole("status")).toContainText("Recording");
+      await app.keyboard.type("cd");
+      await app.keyboard.press("Control+L");
+      await app.keyboard.press("Escape");
+      await expect(card).toContainText("2 steps recorded.");
+      await pageShots(app, "macro-editor");
+
+      await card.getByRole("button", { name: "Save" }).click();
+      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
+      const saved = (await macrosOf(app))[2];
+      expect(saved).toEqual([
+        { type: "text", text: "ls -la", keys: [], delay: null },
+        { type: "tap", text: null, keys: ["KC_ENTER"], delay: null },
+        { type: "down", text: null, keys: ["KC_LCTRL"], delay: null },
+        { type: "up", text: null, keys: ["KC_LCTRL"], delay: null },
+        { type: "delay", text: null, keys: [], delay: 30 },
+        { type: "text", text: "cd", keys: [], delay: null },
+        { type: "tap", text: null, keys: ["LCTL(KC_L)"], delay: null },
+      ]);
+      await expect(card.locator(".chain")).toContainText("type “ls -la”tap Enterpress LCtrlrelease LCtrlwait 30 ms");
+      // the memory the page counts is the keyboard's
+      const used = await app.locator(".memory .count").textContent();
+      const model = await (await app.request.get(new URL("/api/keyboard", app.url()).toString())).json();
+      expect(used).toContain(`Uses ${model.macros.used} of 900 bytes`);
+    } finally {
+      await setMacros(app, before);
+    }
+  });
+
+  test("a macro changed on a locked keyboard is saved once the keyboard is unlocked", async ({ app }) => {
+    test.setTimeout(60_000);
+    const before = await macrosOf(app);
+    try {
+      await app.setViewportSize({ width: 1920, height: 950 }); // a 1080p screen, less the browser's own bars
+      await simulatorUnlock(app, { locked: true });
+      await app.reload();
+      await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
+      await openSection(app, "Macros");
+      const card = macroCard(app, 0);
+      await card.getByRole("button", { name: "Edit" }).click();
+      await card.getByLabel("Step 1: the text to type").fill("git log");
+      await card.getByRole("button", { name: "Save" }).click();
+
+      const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
+      await expect(dialog).toBeVisible();
+      await expect(dialog).toContainText("Press and hold the 2 highlighted keys");
+      await expect(dialog.locator(".key.found")).toHaveCount(2);
+      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
+      await expectInWindow(app, dialog);
+      // the unlock keys type into the page too: no key press cancels or closes it
+      for (const key of ["Enter", "Space", "Escape", "Tab"]) await app.keyboard.press(key);
+      await expect(dialog).toBeVisible();
+      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
+      await screenshots(app, "unlock-dialog");
+      await simulatorUnlock(app, { keysHeld: true });
+      await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /keep holding/, { timeout: 5000 });
+      await expect(dialog).toBeHidden({ timeout: 20_000 });
+      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
+      expect((await macrosOf(app))[0][0]).toEqual({ type: "text", text: "git log", keys: [], delay: null });
+      await expect(app.getByRole("button", { name: "Keyboard unlocked: lock it" })).toBeVisible();
+    } finally {
+      await unlockAgain(app);
+      await setMacros(app, before);
+    }
+  });
+});
+
 test("the top bar locks and unlocks the keyboard; a cancelled unlock can be taken up again", async ({ app }) => {
   test.setTimeout(60_000);
   try {
```

```bash
cd web && npm run check && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `48 passed`: two macro tests more.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/behaviours.spec.ts \
  web/e2e/fixtures.ts \
  web/src/App.svelte \
  web/src/behaviours/MacroCard.svelte \
  web/src/behaviours/MacroEditor.svelte \
  web/src/behaviours/MacrosPage.svelte \
  web/src/behaviours/MemoryBar.svelte \
  web/src/behaviours/StepChain.svelte
git commit -m "feat(web): the Macros page: a step editor, the memory bar, recording from the browser"
```

### Task 20: Screenshots at four sizes, the README, and the final check

**The screenshot tests** open every behaviour page at 800 × 900, 1280 × 800, 2560 × 1440 and 1920 × 950, in both themes. On each they check:
- no sideways scroll;
- the page at most 860 px wide;
- the keycode picker, opened from a card, inside the window.

**The README** documents the simulated Corne's unlock keys and the test hook, and the new folders' roles.

**Files:**
- Modify: `web/e2e/behaviours.spec.ts`, `web/README.md`

- [ ] **Step 1: The screenshot tests**

Apply to `web/e2e/behaviours.spec.ts`:

```diff
diff --git a/web/e2e/behaviours.spec.ts b/web/e2e/behaviours.spec.ts
--- a/web/e2e/behaviours.spec.ts
+++ b/web/e2e/behaviours.spec.ts
@@ -340,3 +340,26 @@ test("the top bar locks and unlocks the keyboard; a cancelled unlock can be take
     await unlockAgain(app);
   }
 });
+
+test.describe("screenshots of the behaviour pages", () => {
+  for (const [width, height] of [[800, 900], [1280, 800], [2560, 1440], [1920, 950]]) {
+    test(`${width} x ${height}: no sideways scroll, at most 860 px wide, nothing off the bottom`, async ({ app }) => {
+      await app.setViewportSize({ width, height });
+      for (const [name, id] of [["Tap dance", "tap-dance"], ["Combos", "combos"], ["Macros", "macros"]] as const) {
+        await openSection(app, name);
+        const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
+        expect(overflow).toBeLessThanOrEqual(0);
+        const page = (await app.locator(".page.list").boundingBox())!;
+        expect(page.width).toBeLessThanOrEqual(860);
+        await pageShots(app, `${id}-${width}x${height}`);
+      }
+      // the picker, opened from a card, fits the window
+      await openSection(app, "Tap dance");
+      await tapDanceCard(app, 0).getByRole("button", { name: /^Tap, then hold:/ }).click();
+      const picker = app.getByRole("dialog", { name: "Choose a keycode" });
+      await expect(picker).toBeVisible();
+      await expectInWindow(app, picker);
+      await picker.getByRole("button", { name: "Close" }).click();
+    });
+  }
+});
```

- [ ] **Step 2: The README**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -33,6 +33,11 @@ its lock, log and names out of your user folders. With `--fake`, `--layers N` (1
 simulated keyboard N layers (the sample keymap fills the first four, the others are empty), and
 `--definition FILE` simulates another keyboard.

+The simulated Corne starts unlocked, as nobody can hold its keys. Its unlock keys are the outermost
+keys of both top rows (Tab and Backspace). A fake server has a test hook for them:
+`PUT /api/simulator/unlock` with `{"locked": true}` locks the keyboard, and `{"keysHeld": true}`
+(or `false`) holds its unlock keys down (or lets go); the e2e tests unlock it that way.
+
 ## Scripts

 | Script | What it does |
@@ -69,10 +74,11 @@ development machine, so no browser is downloaded there. CI installs that Chromiu
 | Folder | What |
 |---|---|
 | `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
-| `src/lib/` | The keyboard store (loaded model, connection, edits), toasts, and the theme (System, Light, Dark) |
+| `src/lib/` | The keyboard store (loaded model, connection, edits), unlocking, the section shown (the address's `#combos/2`), toasts, and the theme (System, Light, Dark) |
 | `src/keyboard/` | Drawing any keyboard from its geometry; key labels |
 | `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo keys, tap dance and macro usage, finding a character or key, and the phrases for them |
 | `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, layer cards, find box |
+| `src/behaviours/` | The Tap dance, Combos and Macros pages: their cards, the combo key chooser, the macro step editor and recorder, and the plain-language sentences |
 | `src/picker/` | Keycode picker: search, categories, any-keycode entry |
-| `src/shell/` | Top bar, navigation, banners, toasts |
-| `src/ui/` | Small shared controls |
+| `src/shell/` | Top bar (with the Lock/Unlock control), navigation, banners, toasts, the unlock dialog |
+| `src/ui/` | Small shared controls, and the name dialog (layers, tap dances, macros) |
```

- [ ] **Step 3: Type-check, then build and run the e2e tests**

```bash
cd web && npm run check && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `52 passed`: four screenshot tests more, 14 in `behaviours.spec.ts`.

- [ ] **Step 4: Copy the screenshots for review.** `screenshots/` is excluded from git through `.git/info/exclude` (pattern `/screenshots/`).

```bash
rm -rf /t/others/vial-gui/screenshots/phase4 && mkdir -p /t/others/vial-gui/screenshots/phase4 && cp web/e2e/screenshots/*.png /t/others/vial-gui/screenshots/phase4/ && ls /t/others/vial-gui/screenshots/phase4 | wc -l && git -C /t/others/vial-gui check-ignore screenshots/phase4/combos-1280x800-light.png
```

Expected: `96` (32 new in this phase and 64 from the earlier tests, light and dark) and `screenshots/phase4/combos-1280x800-light.png`.

Look at the new screenshots, each in `-light` and `-dark`:
- **The pages:** `tap-dance-`, `combos-` and `macros-` at `800x900`, `1280x800`, `2560x1440` and `1920x950`:
  - at most 860 px wide and centred;
  - the navigation in the same place as on the Keymap;
  - long names cut short;
  - nothing off the bottom at 1920x950.
- **Editors:** `combo-editor` (the keys to click, L and R chosen) and `macro-editor` (every kind of step, and the recorded ones).
- **Colours:** `combo-dots`: K in combos 0 and 2 shows a red and a teal dot; Y is underlined red, L teal.
- **The dialog:** `unlock-dialog`: Tab and Backspace highlighted, the bar, Cancel focused, all inside the 1920x950 window.

- [ ] **Step 5: Run every check once more**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `768 passed, 1 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api && npx playwright test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  32 passed (32)` and `Tests  452 passed (452)` and `built in` and `src/api/schema.d.ts is up to date` and `52 passed`.

- [ ] **Step 6: Commit**

```bash
git add web/README.md \
  web/e2e/behaviours.spec.ts
git commit -m "test(web): screenshots of the behaviour pages at four sizes; README"
```

- [ ] **Step 7: Owner checklist (the owner runs this, not you).** This is the roadmap's phase 4 checklist, made concrete for the W-CORNE. Anything it finds becomes the first task of phase 5.
  1. Close the Qt Vial app. Build the UI (`cd web && npm ci && npm run build`), then run `python src/main/python/vial_web.py`.
  2. **Unlock.** Click "Locked" in the top bar. The dialog highlights the W-CORNE's unlock keys and names their matrix positions. Hold exactly those keys until the bar fills (about 10 s on real firmware). The dialog closes, and the top bar says "Unlocked".
  3. **A macro.** On the Macros page, edit a macro (for example, type "git status", then tap Enter) and save it. Put its keycode (M0, …) on a key if none has it, and check in a text editor that the key types exactly that.
  4. **A tap dance.** On the Tap dance page, change a slot (for example, hold for LCtrl) and the tapping term. Check on the keyboard that a tap, a hold and a double tap each do what the card's sentence says.
  5. **A combo.** On the Combos page, choose two keys by clicking them, pick an output, and save. Press the two keys together and check the output. In the Keymap, both keys show the combo's colour.
  6. **Lock it again.** Click "Unlocked" in the top bar: it says "Locked". Saving a macro now opens the unlock dialog first.
  7. **Firefox at 1080p.** Look at the Keymap, Tap dance, Combos and Macros pages and the unlock dialog in a maximised Firefox window on the 1080p screen, in both themes. Nothing runs off the bottom or sideways, and long names show "…" with a tooltip.

## Roadmap coverage

| Roadmap phase 4 item | Task |
|---|---|
| Unlock backend: `POST /api/unlock/start`, progress over the WebSocket (keys, counter, done), `POST /api/lock`, the device manager reports `unlocked`, an interrupted unlock finished on connect | 2, 3 |
| Unlock UI: a dialog highlighting the unlock keys with progress, started on a 423 or from a Lock/Unlock control | 7, 8, 16; e2e in 16 and 19 |
| Simulator: configurable unlock keys, "held" in tests | 1; the fake-only hook in 3 |
| Tap dance page: id, editable name, sentence, four slots (empty ones dashed), tapping term, "used on" with click-to-jump, a warning when unused, the picker for a slot | 6, 9, 17; e2e in 17 |
| "Turn into tap dance" picks a free slot and opens its card | 8, 17; e2e in 17 |
| Combos page: small keyboard with the members, an arrow to the output, a sentence, notes for a keycode on several keys or none | 9, 18 |
| Members and output edited with the picker; members chosen by clicking keys (up to 4, a click removes) | 12, 18; e2e in 18 |
| A combo reaching a layer says so ("→ reaches Layer 2") | 9; e2e in 18 |
| Each combo under the Inspector's "Combos with this key" opens its card | 18; e2e in 18 |
| Combo colours: a palette, different on a layer, repeating in a stated order; an underline for one combo, dots for several, "+n"; the same colour everywhere; 3:1 in both themes, no amber; aria labels name the combos | 13, 14; e2e in 14 and 18 |
| Macros page: a chain of steps, name, "used on"; a step editor (add, remove, reorder; text, tap, down, up, delay) | 10, 19; e2e in 19 |
| Macro memory bar, amber near full, a refusal with byte counts | 4 (`value`), 10, 19 |
| Record from keyboard, browser-only (open decision: yes) | 11, 19; e2e in 19 |
| Navigation: counts, sections the firmware lacks hidden | 12 (`behaviourCounts`), 15, 17–19 |
| Store methods for tap dances, combos and macros (the phase 3 plan deferred `setCombo`) | 8 |
| e2e: a tap dance slot and "used on"; a combo by clicking; a combo from the Inspector; a combo of two layer keys; two combos sharing a key (dots and underlines); a macro of every step kind; a macro on a locked keyboard unlocked through the hook | 17, 18, 19 |
| Owner's rules: widths (1100/860 px), 1920 × 950, names cut short with tooltips and edited in the dialog, Firefox-safe CSS | 6, 14, 17, 18, 20 |
| Phase 3 review follow-ups | 5, 14 |

## Self-review

- **Spec coverage:** every item of the roadmap's phase 4 scope, including the owner's additions (combo colours and dots, choosing combo keys by clicking, the layer wording, opening a combo from the Inspector), maps to a task in the table above. None is left without one. The phase 3 follow-ups are Tasks 5 and 14.
- **Placeholder scan:** every code step gives the complete file or an exact diff. Every command has its expected output. Nothing is left to be filled in later. The deferred items are listed under "Out of scope / later phases" and are simply not built.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `UnlockState`, `start_unlock`, `poll_unlock`, `cancel_unlock`, `lock_keyboard`, `read_unlocked` and `read` (Task 2) are used by the routes and the hook (Task 3);
  - `hold_unlock_keys` and `UNLOCK_KEYS` (Task 1) by Tasks 2, 3 and the hook;
  - `Unlocker`, `unlockProgress` and `isWaiting` (Task 7) by the store (Task 8), `UnlockDialog` and `App` (Task 16);
  - `setTapDance`, `setCombo`, `setMacros` and `rename` (Task 8) by Tasks 17, 18 and 19;
  - `tapDanceSentence`, `comboSentence`, `comboNotes` and `useLabel` (Task 9) by Tasks 17 and 18;
  - `stepBytes`, `macroBytes`, `memoryUsed`, `memoryLevel` and `stepRequest` (Task 10), and `Recording` (Task 11), by Task 19;
  - `toggleMember`, `membersOf`, `isSet`, `shownEntries`, `freeCombo`, `freeMacro`, `behaviourCounts` and `describeCode` (Task 12) by Tasks 17, 18 and 19;
  - `comboMarks` and `dotSizes` (Task 13) by `Key.svelte` (Task 14);
  - `comboMarksOn`, `comboColours`, `COMBO_COLOURS`, `comboMarksOf` and `comboMarkLabel` (Task 14) by Tasks 14 and 18;
  - the `Key` props `combos`, `ring`, `faded` and `chosen` (Task 14) by Tasks 16 and 18;
  - `router.go`, `router.openKey`, `takeKeyTarget` and `parseRoute` (Task 15) by Tasks 17, 18 and 19;
  - `NameDialog`, `NameSubject` and `NAME_MAX` (Task 6) by Tasks 17 and 19.
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase4` at `959ee07`). The plan was replayed mechanically from `main` and the result compared with it.
