# Phase 5a: Key overrides, alt-repeat, QMK settings, layout files and About — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the web UI does what the Qt app's Key Overrides, Alt Repeat Key and QMK Settings tabs and its File and About menus do: a Key overrides page and an Alt-repeat page with plain-language cards and editors, a QMK settings form, and a Keyboard page that tells what the keyboard is and saves and loads `.vil` layout files, with a preview of what a file changes before anything is written.

**Architecture:**
- **Backend.**
  - A new route, `POST /api/layout-file/preview`, checks a `.vil` file exactly as `POST /api/layout-file` does (the same parsing, validation, 413 size limit, token and Origin checks) and returns what loading it would change, section by section (`LayoutFilePreview`). It writes nothing and also works on a locked keyboard.
  - Both routes refuse a file saved from another keyboard (another `uid`) with 422. `vial_web.py --layout` still takes any keyboard's file, as the simulator stands in for the keyboard that saved it.
  - QMK settings: an integer setting must lie in `qmk_settings.json`'s min and max, as Qt's form keeps it; a setting the keyboard rejects keeps its old value in the model; `GET /api/qmk-settings/definitions` is typed (`SettingsDefinitions`).
  - The layout download is named after the keyboard ("Simulated Corne.vil").
  - The simulated Corne gets a second key override and QMK's default settings for the groups the Settings page shows.
- **Web logic.** Pure modules with Vitest tests:
  - `src/behaviours/overrides.ts`: key override and alt-repeat masks and option bits, and their sentences;
  - `src/settings/qmkSettings.ts`: the settings form's groups, values, changes and number checks;
  - `src/about/about.ts` and `layoutFile.ts`: what the keyboard is, and a layout file's changes in words;
  - `src/api/client.ts`: raw JSON bodies, and downloads with the name the server gives.
- **Store.** `setKeyOverride`, `setAltRepeatKey`, `setSettings`, `resetSettings` and `loadLayoutFile`, all through `#edit` (busy and pending, 423 → unlock → one retry, disconnect handling).
- **UI.**
  - Key overrides and Alt-repeat pages: cards like the Tap dance, Combos and Macros pages, each edited in a draft with Save and Cancel; shared controls for modifiers, layers, options and keycodes.
  - A Settings page: a form with Save and Undo, and "Reset to defaults…" behind a confirmation dialog.
  - A Keyboard page: the layout file (save, load with a preview) and "About this keyboard".
  - Four new hash routes and navigation entries, with counts; the navigation wraps on narrow windows.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2, pytest with pytest-xdist.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0.
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependencies: `web/package.json` and `web/package-lock.json` don't change.

**Roadmap (phase 5 scope):** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`, "Phase 5". Phase 5 is split: **5a** is this plan (key overrides, alt-repeat, QMK settings, `.vil` save and load with a preview, About keyboard); **5b** (lighting, layout options, matrix tester, reboot to bootloader, the parity check) is a later plan. **Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md` (§4 API, §5 navigation and widths). **Visual language:** `docs/superpowers/specs/mockups/behaviours.html`.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `vial_web.py --fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e fixtures start it exactly like that.
   - Never start the Qt app (`src/main/python/main.py`).
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry.
   - Tests use simulated keyboards only. Layout files are saved and loaded on the simulated Corne, never on the real keyboard.
2. **Shell:** Git Bash on Windows; commands are written for it.
   - Every command block starts in the repository root. A `cd` inside a block applies to that block only.
   - On Linux/macOS, replace `.venv/Scripts/python.exe` with `.venv/bin/python`.
3. **Python:** the repository's `.venv` (Python 3.13, with `test-requirements.txt` installed, which brings pytest-xdist).
   - Tests run from `src/main/python`, because the code uses top-level imports. The whole suite runs on every core:

   ```
   cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
   ```

   - `QT_QPA_PLATFORM=offscreen` keeps the Qt tests' windows off the screen. A single test file runs without `-n auto --dist worksteal`.
   - The web scripts (`gen:api`, `check:api`, `e2e`) find this same `.venv` themselves, or the Python named by `VIAL_PYTHON`.
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **End-to-end tests run in parallel** (`web/README.md`, "End-to-end tests"): half the cores by default, `E2E_WORKERS=<n>` to choose. Each Playwright worker starts its own fake servers, so tests running at the same time never share a keyboard.
   - Every test is independent and puts back what it changed, in a `finally`.
   - `npm run e2e` builds first; `npx playwright test <spec>` runs against the last build.
7. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
8. **Line endings:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings (Git Bash's `sed -i` strips the CRs; use an editor, or Python with `newline=''`). `git apply` keeps them.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
9. **Commits:** one commit per task, on branch `phase5a-parity`.
   - Add the files the task names. Never `git add -A`, and leave the untracked `gh.txt` alone.
   - End every commit message with the trailer the session tells you to use.
10. **How code is given.**
    - "Create `X`:" is followed by the file's complete content.
    - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
    - A file changed by several tasks has one diff in each. The tasks are in order, so each diff applies to what the task before left.
    - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it (Tasks 3 and 4), in the same commit as the schema change.
    - Each "Expected:" lists text that the command's output contains.
11. **Standing rules (roadmap and owner):**
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the keymap's content is at most 1100 px, the list and settings pages at most 860 px (`--list-max`), both centred. At 800 px and at 375 px nothing scrolls sideways.
    - Heights: the owner uses a 1080p screen, which leaves about 1920 × 950 px for the page. Editors, previews and dialogs fit there; the e2e tests check it.
    - Anything the user typed (layer, tap dance and macro names) is cut short with "…" and a tooltip with the full name wherever it shows.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike. A `-webkit-` property comes with its standard twin.
    - Both themes, light and dark, must read well.
    - **Owner feedback from phase 4**, applied to every new page:
      - the card being edited keeps its accent border (`.behaviour-card.editing`), so it is obvious which entry is edited;
      - each page says how saving works (`PageHeader`'s `note`);
      - a new, still-empty entry says it isn't kept until it is filled in and saved.
    - While a save runs, controls stay focusable (`aria-disabled`, not `disabled`), so the focus never falls to `<body>`.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

Phase 4 and the test speed-ups are merged into `main` (at `6ad1038` or later), and `phase5a-parity` is branched from it. `.venv` exists and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `811 passed, 1 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  34 passed (34)` and `Tests  545 passed (545)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

```bash
cd web && npm run e2e
```

Expected: `84 passed`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/simulator/corne.py` | The sample: a second key override (Shift + Esc → `~`, Base only) and QMK's default settings for Grave Escape, Auto Shift, One Shot Keys, the mouse keys and Magic |
| `src/main/python/server/edits.py` | Integer settings within `qmk_settings.json`'s range; a rejected setting put back; `preview_layout_file`; `_layout_file_changes` shared by the preview and the upload; another keyboard's file refused (`OtherKeyboard`, `any_keyboard`); what a file has that the keyboard doesn't, as `ignored` |
| `src/main/python/server/schemas.py` | `SettingField`, `SettingsTab`, `SettingsDefinitions`; `LayoutFilePreview` and its change types (`KeyChange`, `EncoderChange`, `LayoutOptionsChange`, `TapDanceChange`, `ComboChange`, `KeyOverrideChange`, `AltRepeatKeyChange`, `MacroChange`, `SettingChange`) |
| `src/main/python/server/model.py` | `layout_file_name`; `macro()`, one macro from its actions, for the preview |
| `src/main/python/server/app.py` | `POST /api/layout-file/preview`; the typed definitions route; the download's `Content-Disposition` named after the keyboard (`content_disposition`) |
| `src/main/python/vial_web.py` | `--layout` takes another keyboard's file (`any_keyboard=True`) |
| `src/main/python/test/test_layout_file.py` | **new.** The preview, another keyboard's file, the locked-keyboard proof, the download's name, the typed definitions |
| `src/main/python/test/test_api_validation.py`, `test_api.py`, `test_simulator.py`, `test_vial_web.py` | Settings ranges and a rejected setting; tests that pinned the old sample; `--layout` with another keyboard's file |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` |
| `web/src/api/client.ts`, `api.ts`, `types.ts` | `request(..., { raw })` sends a JSON document as it is; `download()` and `attachmentName()`; the new routes; the new types |
| `web/src/lib/keyboard.svelte.ts` | `setKeyOverride`, `setAltRepeatKey`, `setSettings`, `resetSettings`, `loadLayoutFile` |
| `web/src/lib/route.ts` | `#key-overrides/n`, `#alt-repeat/n`, `#settings`, `#keyboard` |
| `web/src/behaviours/overrides.ts` | **new.** Modifier, layer and option bits of key overrides and alt-repeat keys; drafts and requests; their sentences, details and problems |
| `web/src/behaviours/entries.ts` | `behaviourCounts` counts the key overrides and alt-repeat keys set up |
| `web/src/ui/Switch.svelte` | **new.** An on/off switch (`role="switch"`) |
| `web/src/behaviours/ModToggles.svelte`, `LayerChips.svelte`, `OptionChecks.svelte`, `KeycodeButton.svelte` | **new.** The editors' controls: eight modifier toggles, layer chips with All and None, option checkboxes with a sentence each, a keycode that opens the picker |
| `web/src/behaviours/EntryHead.svelte` | the `override` tone for the cards' id badge |
| `web/src/behaviours/KeyOverridesPage.svelte`, `KeyOverrideCard.svelte`, `KeyOverrideEditor.svelte` | **new.** The Key overrides page |
| `web/src/behaviours/AltRepeatPage.svelte`, `AltRepeatCard.svelte`, `AltRepeatEditor.svelte` | **new.** The Alt-repeat page |
| `web/src/settings/qmkSettings.ts`, `definitions.ts` | **new.** The settings form's logic; the definitions, read once |
| `web/src/settings/SettingsPage.svelte`, `SettingRow.svelte`, `web/src/ui/ConfirmDialog.svelte` | **new.** The Settings page, one field, and a confirmation dialog |
| `web/src/about/about.ts`, `layoutFile.ts` | **new.** The keyboard's facts; a layout file's changes in words |
| `web/src/about/KeyboardPage.svelte`, `AboutCard.svelte`, `LayoutFileCard.svelte`, `LayoutPreview.svelte` | **new.** The Keyboard page |
| `web/src/App.svelte`, `web/src/shell/Nav.svelte` | the four new sections and pages; the navigation wraps below 1000 px |
| `web/src/behaviours/navigate.ts`, `UsedOn.svelte` | "used on" chips for key overrides and alt-repeat keys open their cards |
| `web/e2e/fixtures.ts` | key override, alt-repeat and settings helpers; `openSection` |
| `web/e2e/overrides.spec.ts`, `settings.spec.ts`, `layoutfile.spec.ts`, `feature-pages.spec.ts` | **new.** e2e for the pages, the layout files and the screenshots |
| `web/README.md` | the new specs and folders |

## Decisions

These come from the verified prototype. The owner may want to review them.

1. **How each page saves.**
   - **Key overrides and Alt-repeat:** a draft with Save and Cancel, like Combos and Macros, because one entry has many fields.
     - The page note says: "Edit one, then Save to send it to the keyboard; Cancel leaves it as it was."
     - The card being edited keeps its accent border (`.behaviour-card.editing`).
     - A new entry says: "nothing is kept until you save it. Cancel, and it is gone."
     - Save is disabled until there is a trigger (a key or modifiers) or a last key.
     - "Remove" writes the all-zero entry.
   - **Settings:** a form with Save and Undo, as Qt does. The note says: "Change what you like, then Save sends the changes to the keyboard; Undo puts back what it holds."
     - Changed fields are marked (a bar and "changed", a count per group), and a sticky Save bar says "N changes not saved yet".
     - Only the changed settings are sent, one PUT each, inside one `#edit`.
     - Save and Undo stay focusable (`aria-disabled`) when there is nothing to save, so the focus never drops to `<body>`.
     - "Reset to defaults…" opens `ui/ConfirmDialog.svelte`: Cancel is focused, Esc waits for a running reset, and the focus goes back to the button.
2. **The Keyboard page holds About and the layout files.** It is last in the navigation and always shown: the "Layout file" card first, then "About this keyboard". Both are about the keyboard as a whole, not about one behaviour; Qt has them in its File and About menus.
3. **The preview format.**
   - `POST /api/layout-file/preview` returns `LayoutFilePreview`: per section, before and after pairs (keys, encoders, layout options, tap dances, combos, key overrides, alt-repeat keys, macros, settings), plus `ignored` (what the keyboard has no room for: "layers 4 to 7", "tap dances 8 to 15", "QMK settings 8, 999") and `needsUnlock`.
   - `about/layoutFile.ts` turns that into one section per kind of change, each with a count; for the keys, a count per layer ("Base: 2, Layer 2: 1"); at most 5 changes in words, then "and N more".
     - Keys are named by their position ("Base, left top row, 1st from the outside: Z → Tab"); tap dances, key overrides and alt-repeat keys by their sentences; QMK settings field by field ("Tapping Term: 200 → 250", "Swap Caps Lock and Left Control: off → on").
     - Then "Left as they are: …", the ignored parts, a note when the file doesn't say which keyboard it is for, and a note when loading needs an unlock.
   - The preview is a panel inside the card, not a modal dialog, so a long preview never runs off a 1080p screen. Its heading takes the focus.
   - Confirming calls `keyboard.loadLayoutFile`. On a 423 the store opens the unlock dialog and sends the whole file again, once.
4. **Another keyboard's file is refused.** Qt asks "are you sure?" and loads it; here both routes answer 422, "this layout file is for another keyboard (ID …), not this one (ID …)", and nothing is written. Another keyboard's keycodes would land on the wrong keys. A file without a `uid` is taken, and the preview says so. `vial_web.py --layout` takes any keyboard's file.
5. **The navigation wraps** at every width below 1000 px: with eight sections it would otherwise scroll sideways at 800 px. New entries: Key overrides and Alt-repeat (with counts of the entries set up; hidden when the firmware has none), Settings (hidden when the keyboard reports no QMK settings) and Keyboard. Deep links (`#key-overrides/2`) open and highlight a card, and `document.title` names the section.
6. **Key override option labels follow the protocol and firmware names** (vial-qmk `vial.h`, `vial_ko_option_*`): bit 4 is `no_reregister_trigger`, "Don't press the trigger key again afterwards"; bit 5 is `no_unregister_on_other_key_down`, "Don't end when another key is pressed". Qt's checkboxes give these two each other's text.
7. **"Default to this alt key" is what the firmware does with it** (vial-qmk `vial.c`, `get_alt_repeat_key_keycode_user`): after any last key that no alt-repeat entry matches, Alt Repeat sends the alt key of the entry with this option (with only allowed modifiers held). The option's sentence and the card's sentence say so.
8. **Server fixes, each with pytest:**
   - an integer QMK setting must lie in `qmk_settings.json`'s min and max, as Qt's spin box keeps it; a value the keyboard already holds is still taken (firmware defaults can lie beyond the range). One existing assertion changes (65535 → 10000);
   - a setting the keyboard rejects is put back in the model (`qmk_settings_set` stores the value before it checks the reply);
   - `GET /api/qmk-settings/definitions` is typed, so the UI gets real types;
   - the download is named after the keyboard (RFC 5987 `filename*`, with an ASCII `filename` for older clients).

   Key override and alt-repeat writes needed no change: they match Qt (16-bit layer mask, 8-bit modifier masks, the option bits the protocol classes keep, an unlock for QK_BOOT).
9. **The locked keyboard.** A file whose writes need an unlocked keyboard (it changes the macros, or puts QK_BOOT on a key) is refused as a whole on a locked keyboard, before the first write. pytest proves it (`test_a_file_with_macros_writes_nothing_on_a_locked_keyboard`: 423, nothing written, then 200 once unlocked) and an e2e test runs the unlock dialog and the retry.

## Out of scope / later phases

- **Phase 5b:** lighting, layout options editing, the matrix tester, reboot to bootloader, and the parity check of every Qt tab and menu.
- **Not built in 5a:**
  - loading another keyboard's file after a confirmation (Qt's behaviour); it could come as `?anyKeyboard=true` behind an explicit confirm;
  - units for numeric settings: `qmk_settings.json` gives none, so only the range is shown (some titles already say "(in ms)");
  - picks made in the keycode picker while a save runs are ignored on these pages (Combos shows a message for them).
- **For a later plan to check:**
  - **Settings bits no field covers are kept.** Qt's settings form rebuilds each value from its fields, so it clears them; the web form keeps them.
  - **`protocol/dynamic.py`** doesn't reset `alt_repeat_key_entries` for firmware with `vial_protocol < 4`; it works only because `reload_alt_repeat_key` fills them later.
  - **The keyboard is read twice after a load.** `#edit` reloads after a layout load, and the server also broadcasts `reloaded`. Harmless, but redundant.
  - **A `.vil` setting out of range** (and not what the keyboard holds) refuses the whole file. That matches the API, but a firmware default above the JSON max, saved from another keyboard, would block loading.
  - **The preview can be stale** if the keyboard changes between the preview and the confirmation. The upload checks the file again, so nothing wrong is written.
  - **A trigger of KC_NO with trigger modifiers** is a modifiers-only key override in QMK, and the card says "Holding Left Shift sends …". Check that Vial's firmware passes it through the same way.
  - **Layers 16 and up** can't have key overrides (the mask has 16 bits); the layer chips say so on keyboards with more layers.

## Owner checklist (after the last task, on the W-CORNE)

The owner runs this, not you. Anything it finds becomes the first task of phase 5b.

1. Close the Qt Vial app. Build the UI (`cd web && npm ci && npm run build`), then run `python src/main/python/vial_web.py`.
2. **Every new page in Firefox at 1080p, in both themes.** Open Key overrides, Alt-repeat, Settings and Keyboard in a maximised Firefox window on the 1080p screen, light and dark. Nothing runs off the bottom or sideways; long names show "…" with a tooltip.
3. **Save the layout file first, and keep it.** On the Keyboard page, click "Save layout" and keep the downloaded `.vil` as a backup BEFORE trying any load.
4. **About.** "About this keyboard" shows the keyboard's real name, its ID, and the VIA and Vial protocol versions; Copy puts them on the clipboard.
5. **A key override.** On Key overrides, create one (for example Shift + Backspace → Delete), save it, and try it on the keyboard. Then remove it.
6. **An alt-repeat key.** If the keymap has an Alt Repeat key, check that an alt-repeat entry does what its card's sentence says. If not, the page says no key has Alt Repeat.
7. **A QMK setting.** On Settings, change one (for example the Tapping Term), Save, and feel the difference on the keyboard. Then put it back (change it back and Save, or Undo before saving).
8. **Load the file back.** On the Keyboard page, load the file saved in step 3. The preview says "It holds what the keyboard holds already: loading it changes nothing." Close it.

---

### Task 1: The simulated Corne gets a second key override and QMK's default settings

The Settings page shows only the settings the keyboard reports, and the simulated Corne reported six. Now it also reports QMK's defaults for Grave Escape (1), Auto Shift (3, 4), One Shot Keys (5, 6), the mouse keys (9 to 17) and Magic (21), so the page has groups to show. The legacy Tap-Hold bitfield (8) is still left out: 22 to 24 replace it.

A second key override, Shift (either side) + Esc → `~` on the Base layer only, gives the Key overrides page a card with a layer mask that isn't "every layer".

The keymap doesn't change, so no key holds Alt Repeat and the Alt-repeat page's warning shows.

**Files:**
- Modify: `src/main/python/simulator/corne.py`
- Test: `src/main/python/test/test_simulator.py`, `src/main/python/test/test_api.py`

- [ ] **Step 1: The sample**

Apply to `src/main/python/simulator/corne.py`:

```diff
diff --git a/src/main/python/simulator/corne.py b/src/main/python/simulator/corne.py
--- a/src/main/python/simulator/corne.py
+++ b/src/main/python/simulator/corne.py
@@ -142,13 +142,19 @@ def make_corne(layers=len(LAYERS)):
         combos=[(encode("KC_K"), encode("KC_Y"), 0, 0, encode("KC_ESC")),
                 (encode("KC_M"), encode("KC_C"), 0, 0, encode("KC_ENT"))] +
                [(0, 0, 0, 0, 0)] * 6,
-        key_overrides=[(encode("KC_BSPC"), encode("KC_DEL"), 0xFFFF, 0x02, 0, 0x02, ko_options_enabled)] +
-                      [(0, 0, 0, 0, 0, 0, 0)] * 3,
+        # Left Shift + Backspace sends Delete on every layer; Shift (either) + Esc sends ~ on the base layer, as QMK's
+        # ko_make_basic(MOD_MASK_SHIFT, KC_ESC, KC_TILD) would, but only there
+        key_overrides=[(encode("KC_BSPC"), encode("KC_DEL"), 0xFFFF, 0x02, 0, 0x02, ko_options_enabled),
+                       (encode("KC_ESC"), encode("LSFT(KC_GRV)"), 0x0001, 0x22, 0, 0x22, ko_options_enabled)] +
+                      [(0, 0, 0, 0, 0, 0, 0)] * 2,
         # Shift+Left then Alt Repeat gives Shift+Right, and the other way round
         alt_repeat_keys=[(encode("KC_LEFT"), encode("KC_RGHT"), 0x02, ark_options)] + [(0, 0, 0, 0)] * 3,
         # 22-24 are the separate Permissive Hold / Hold On Other Key Press / Retro Tapping settings. The legacy
-        # bitfield (8) also has Permissive Hold and Retro Tapping bits, so it is left out to avoid showing them twice
-        settings={2: 50, 7: 200, 22: 0, 23: 0, 24: 0, 25: 100},
+        # bitfield (8) also has Permissive Hold and Retro Tapping bits, so it is left out to avoid showing them twice.
+        # The others are QMK's defaults: Grave Escape (1), Auto Shift (3, 4), One Shot Keys (5, 6), the mouse keys
+        # (9-17) and Magic (21, N-key rollover off)
+        settings={1: 0, 2: 50, 3: 0, 4: 175, 5: 5, 6: 5000, 7: 200, 9: 10, 10: 16, 11: 8, 12: 10, 13: 30, 14: 10,
+                  15: 80, 16: 8, 17: 40, 21: 0, 22: 0, 23: 0, 24: 0, 25: 100},
         # unlocked, as nobody can hold its keys; tests lock it to try the unlock
         unlocked=True,
         unlock_keys=UNLOCK_KEYS,
```

- [ ] **Step 2: Run the tests that pinned the old sample, to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py test/test_api.py
```

Expected: `2 failed, 85 passed`: `test_sample_settings_have_no_legacy_bitfield` lists the settings, and `test_invalid_writes_are_rejected` writes qsid 1, which the Corne now has.

- [ ] **Step 3: The tests check what they mean**

The first checks that the legacy bitfield is left out and the Tap-Hold settings are there; the second writes a setting the Corne doesn't have, qsid 8.

Apply to `src/main/python/test/test_simulator.py`:

```diff
diff --git a/src/main/python/test/test_simulator.py b/src/main/python/test/test_simulator.py
--- a/src/main/python/test/test_simulator.py
+++ b/src/main/python/test/test_simulator.py
@@ -103,7 +103,8 @@ def test_reload_reads_macros_settings_and_lighting(corne):
 def test_sample_settings_have_no_legacy_bitfield(corne):
     vk, kb = corne
     # qsid 8 is the legacy bitfield for Permissive Hold / Retro Tapping, which 22-24 replace
-    assert kb.supported_settings == {2, 7, 22, 23, 24, 25}
+    assert 8 not in kb.supported_settings
+    assert {7, 22, 23, 24, 25} <= kb.supported_settings


 def test_writes_reach_the_simulator(corne):
```

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -212,7 +212,7 @@ def test_set_key_writes_to_keyboard(client, virtual):
     ("/api/keymap/0/0/0", {"code": "NOT_A_KEY"}),
     ("/api/tap-dance/99", {"tap": "KC_A", "hold": "KC_NO", "doubleTap": "KC_NO", "tapHold": "KC_NO",
                            "tappingTerm": 200}),
-    ("/api/qmk-settings/1", {"value": 1}),
+    ("/api/qmk-settings/8", {"value": 1}),  # a setting the simulated Corne doesn't have
 ])
 def test_invalid_writes_are_rejected(client, virtual, path, body):
     before = [row[:] for row in virtual.keymap[0]]
```

- [ ] **Step 4: Run them, then the whole suite and the e2e tests**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py test/test_api.py
```

Expected: `87 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `811 passed, 1 skipped`.

```bash
cd web && npm run e2e
```

Expected: `84 passed`: the pages so far don't depend on the settings or the second key override.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/simulator/corne.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_simulator.py
git commit -m "feat(simulator): the Corne has a second key override and QMK's default settings"
```

### Task 2: Number settings keep to their range; a setting the keyboard rejects keeps its value

Two fixes to `PUT /api/qmk-settings/{qsid}` (and so to the layout file, which checks its settings the same way):
- **The range.** `qmk_settings.json` gives every integer setting a min and a max, and Qt's spin box keeps to them. The server only checked that the value fits the setting's bytes, so it took a Tapping Term of 65535. Now an integer outside the range is refused with 422, "setting 7 (Tapping Term) must be from 0 to 10000". A value the keyboard already holds is still taken, because firmware defaults can lie beyond the range.
- **A rejected setting.** `qmk_settings_set` stores the value in `kb.settings` before it checks the keyboard's reply. A setting the keyboard refused stayed in the model as if it were set. Now `_write_setting` puts the value it held back (or removes it, when there was none) before it raises.

**Files:**
- Modify: `src/main/python/server/edits.py`
- Test: `src/main/python/test/test_api_validation.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_api_validation.py`:

```diff
diff --git a/src/main/python/test/test_api_validation.py b/src/main/python/test/test_api_validation.py
--- a/src/main/python/test/test_api_validation.py
+++ b/src/main/python/test/test_api_validation.py
@@ -6,6 +6,7 @@ import pytest
 from fastapi.testclient import TestClient

 import transport
+from protocol.constants import CMD_VIAL_QMK_SETTINGS_SET
 from protocol.unlock_hook import set_unlock_handler
 from server import edits
 from server.app import create_app
@@ -139,8 +140,42 @@ def test_setting_value_must_fit_the_setting(client, virtual):
     assert snapshot(virtual) == before
     settings = {s["qsid"]: s["value"] for s in client.get("/api/keyboard").json()["settings"]}
     assert settings[7] == 200
-    assert client.put("/api/qmk-settings/7", json={"value": 65535}).status_code == 200
-    assert virtual.settings[7] == 65535
+    assert client.put("/api/qmk-settings/7", json={"value": 10000}).status_code == 200
+    assert virtual.settings[7] == 10000
+
+
+def test_number_settings_stay_within_the_range_qt_allows(client, virtual):
+    """ qmk_settings.json gives each number setting a range, which Qt's form keeps to: the Tapping Term (7) is 0 to
+    10000 ms, the One Shot tap toggle (5) 0 to 50 """
+    before = snapshot(virtual)
+    response = client.put("/api/qmk-settings/7", json={"value": 10001})
+    assert response.status_code == 422 and "from 0 to 10000" in response.json()["detail"]
+    assert client.put("/api/qmk-settings/5", json={"value": 51}).status_code == 422
+    assert snapshot(virtual) == before
+    assert client.put("/api/qmk-settings/5", json={"value": 50}).status_code == 200
+
+
+def test_a_number_setting_the_keyboard_holds_beyond_its_range_is_kept(setup):
+    """ firmware defaults can lie beyond the range: what the keyboard holds is accepted back, as other values are """
+    client, virtual, app = setup
+    virtual.settings[7] = 20000
+    client.post("/api/reload")
+    assert client.put("/api/qmk-settings/7", json={"value": 20000}).status_code == 200
+    assert client.put("/api/qmk-settings/7", json={"value": 20001}).status_code == 422
+
+
+def test_a_setting_the_keyboard_rejects_keeps_its_value(client, virtual, monkeypatch):
+    """ the protocol layer keeps the value it sent even when the keyboard refuses it: the model mustn't show it """
+    real = virtual._vial
+
+    def refuse_settings(msg):
+        if msg[1] == CMD_VIAL_QMK_SETTINGS_SET:
+            return b"\x01"
+        return real(msg)
+    monkeypatch.setattr(virtual, "_vial", refuse_settings)
+    assert client.put("/api/qmk-settings/7", json={"value": 300}).status_code == 502
+    settings = {s["qsid"]: s["value"] for s in client.get("/api/keyboard").json()["settings"]}
+    assert settings[7] == 200


 @pytest.mark.parametrize("text", ["a\0b", "\x01\x04", "\u0105\u20ac", "bell\x07", "del\x7f"])
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api_validation.py
```

Expected: `3 failed, 117 passed`.

- [ ] **Step 3: The range, and the value put back**

Apply to `src/main/python/server/edits.py`:

```diff
diff --git a/src/main/python/server/edits.py b/src/main/python/server/edits.py
--- a/src/main/python/server/edits.py
+++ b/src/main/python/server/edits.py
@@ -191,13 +191,24 @@ def set_macros(kb, body, names):
 def _check_setting(kb, qsid, value):
     if qsid not in kb.supported_settings or not QmkSettingsCodec.is_qsid_supported(qsid):
         raise ValueError("setting {} is not supported by this keyboard".format(qsid))
-    width = QmkSettingsCodec.fields()[qsid][0].get("width", 1)
+    field = QmkSettingsCodec.fields()[qsid][0]
+    width = field.get("width", 1)
     if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 1 << (8 * width):
         raise ValueError("setting {} must be a number from 0 to {}".format(qsid, (1 << (8 * width)) - 1))
+    # a number takes what Qt's form takes (qmk_settings.json's min and max), unless the keyboard holds it already
+    if field["type"] == "integer" and value != kb.settings.get(qsid) and not field["min"] <= value <= field["max"]:
+        raise ValueError("setting {} ({}) must be from {} to {}".format(qsid, field["title"], field["min"],
+                                                                         field["max"]))


 def _write_setting(kb, qsid, value):
+    held = kb.settings.get(qsid)
     if kb.qmk_settings_set(qsid, value) != 0:
+        # the protocol layer keeps the value it sent: what the keyboard holds is still the one before
+        if held is None:
+            kb.settings.pop(qsid, None)
+        else:
+            kb.settings[qsid] = held
         raise RuntimeError("the keyboard rejected setting {}".format(qsid))


```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api_validation.py
```

Expected: `120 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `814 passed, 1 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/edits.py \
  src/main/python/test/test_api_validation.py
git commit -m "fix(server): number settings keep to qmk_settings.json's range; a setting the keyboard rejects keeps its value"
```

### Task 3: The layout download is named after the keyboard; the settings definitions are typed

- **The download's name.** `GET /api/layout-file` named every file "keyboard.vil". Now it is the keyboard's name (`model.layout_file_name`): "Simulated Corne.vil". Characters file systems refuse (`<>:"/\|?*` and control characters) become `_`, and the name is at most 100 characters. `content_disposition` gives the name as typed in RFC 5987's `filename*` (UTF-8, percent-encoded) and an ASCII `filename` for older clients.
- **Typed definitions.** `GET /api/qmk-settings/definitions` returned `qmk_settings.json` as it is, so the UI's types said nothing about it. Now its response model is `SettingsDefinitions`: tabs, each with its fields (`SettingField`: `type` boolean or integer, `title`, `qsid`, and `bit`, `width`, `min`, `max` where they apply).

The new test file, `test_layout_file.py`, starts with these. Its `knob` fixture is a small keyboard with an encoder and a layout option, whose name has characters a file can't have; Task 4 adds the layout file's tests to it.

**Files:**
- Modify: `src/main/python/server/app.py`, `src/main/python/server/model.py`, `src/main/python/server/schemas.py`
- Generated: `web/src/api/schema.d.ts`
- Test: `src/main/python/test/test_layout_file.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_layout_file.py`:

```python
""" .vil files: the download's name; and the QMK settings definitions, which the settings page is built from """
import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN, setup, client  # noqa: F401 (fixtures)

# 1 row x 2 columns, one encoder, and a layout option
OPTIONS = {"name": "Knob/Pad: \"mini\"", "matrix": {"rows": 1, "cols": 2},
           "layouts": {"labels": ["Split"],
                       "keymap": [["0,0", "0,1\n\n\n0,0", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


@pytest.fixture
def knob(tmp_path, monkeypatch):
    """ (client, simulated keyboard with an encoder and a layout option) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(lambda: VirtualKeyboard(OPTIONS, layers=2)))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        c.get("/?token=" + TOKEN, follow_redirects=False)
        yield c, manager.backend.virtual
    set_unlock_handler(None)


# ---------- downloading ----------

def test_the_download_is_named_after_the_keyboard(client):
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Simulated Corne.vil\"; filename*=UTF-8''Simulated%20Corne.vil"


def test_a_name_with_characters_files_cannot_have(knob):
    client, virtual = knob
    disposition = client.get("/api/layout-file").headers["content-disposition"]
    assert disposition == "attachment; filename=\"Knob_Pad_ _mini.vil\"; filename*=UTF-8''Knob_Pad_%20_mini.vil"


# ---------- QMK settings definitions ----------

def test_setting_definitions_are_typed(client):
    tabs = client.get("/api/qmk-settings/definitions").json()["tabs"]
    magic = next(t for t in tabs if t["name"] == "Magic")
    assert magic["fields"][0] == {"type": "boolean", "title": "Swap Caps Lock and Left Control", "qsid": 21,
                                  "bit": 0, "width": 4, "min": None, "max": None}
    tapping_term = next(f for t in tabs for f in t["fields"] if f["qsid"] == 7)
    assert (tapping_term["type"], tapping_term["min"], tapping_term["max"], tapping_term["width"]) == \
        ("integer", 0, 10000, 2)
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layout_file.py
```

Expected: `3 failed`.

- [ ] **Step 3: The name and the types**

Apply to `src/main/python/server/model.py`:

```diff
diff --git a/src/main/python/server/model.py b/src/main/python/server/model.py
--- a/src/main/python/server/model.py
+++ b/src/main/python/server/model.py
@@ -1,5 +1,7 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
 """ Builds the API's view of a loaded keyboard. Reads only what the protocol layer already holds: no device I/O. """
+import re
+
 from keycodes.keycodes import KEYCODES_SPECIAL, KEYCODES_BASIC, KEYCODES_SHIFTED, KEYCODES_ISO, KEYCODES_LAYERS, \
     KEYCODES_BOOT, KEYCODES_MODIFIERS, KEYCODES_QUANTUM, KEYCODES_BACKLIGHT, KEYCODES_MEDIA, KEYCODES_TAP_DANCE, \
     KEYCODES_MACRO, KEYCODES_USER, KEYCODES_MIDI
@@ -161,6 +163,13 @@ def uid_of(kb):
     return "{:016X}".format(kb.keyboard_id & 0xFFFFFFFFFFFFFFFF)


+def layout_file_name(kb):
+    """ The name a downloaded .vil file gets: the keyboard's, e.g. "Simulated Corne.vil", without characters file
+    systems refuse """
+    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", kb.definition.get("name", "")).strip(" ._")
+    return "{}.vil".format(name[:100] or "keyboard")
+
+
 def catalogue_keycode(keycode):
     """ The keycode as the picker offers it; None when the keyboard's protocol has no such keycode: protocol 5's
     tables (also used before any keyboard is read) give those placeholders above 16 bits, e.g. QK_REPEAT_KEY """
```

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -146,6 +146,32 @@ class QmkSetting(BaseModel):
     value: int


+class SettingField(BaseModel):
+    """ One field of the QMK settings form, as qmk_settings.json defines it. Several boolean fields can share a qsid:
+    each is one bit of its value. """
+    type: Literal["boolean", "integer"]
+    title: str
+    qsid: int
+    bit: Optional[int] = None
+    """ boolean: the bit of the value it is (0 when not given) """
+    width: Optional[int] = None
+    """ bytes the value takes on the keyboard (1 when not given) """
+    min: Optional[int] = None
+    """ integer: the smallest value """
+    max: Optional[int] = None
+    """ integer: the largest value """
+
+
+class SettingsTab(BaseModel):
+    """ A group of QMK settings: Qt's tab """
+    name: str
+    fields: list[SettingField]
+
+
+class SettingsDefinitions(BaseModel):
+    tabs: list[SettingsTab]
+
+
 class VialRgb(BaseModel):
     mode: int
     speed: int
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -5,6 +5,7 @@ import contextlib
 import logging
 import os
 import secrets
+import urllib.parse
 from typing import Annotated, Literal

 from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
@@ -54,6 +55,12 @@ NEED_TOKEN_PAGE = """<!doctype html>
 Lang = Annotated[str, Query(description="keyboard language the keys are labelled in, from /api/keyboard-languages")]


+def content_disposition(filename):
+    """ An attachment's header: the name as typed (RFC 5987, UTF-8), and an ASCII one for older clients """
+    ascii_name = "".join(c if " " <= c <= "~" and c not in '"\\' else "_" for c in filename)
+    return "attachment; filename=\"{}\"; filename*=UTF-8''{}".format(ascii_name, urllib.parse.quote(filename))
+
+
 def cookie_name(port):
     """ The session cookie's name. Cookies don't keep ports apart, so two servers on 127.0.0.1 would overwrite each
     other's cookie under one name. """
@@ -433,8 +440,10 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     def set_macros(body: schemas.MacrosIn, lang: Lang = languages.DEFAULT):
         return run(lambda kb: edits.set_macros(kb, body, names_for(kb)), lang)

-    @app.get("/api/qmk-settings/definitions")
+    @app.get("/api/qmk-settings/definitions", response_model=schemas.SettingsDefinitions)
     def setting_definitions():
+        """ Every QMK setting Vial knows, grouped as qmk_settings.json has them; the keyboard's model lists those it
+        has (KeyboardModel.settings) """
         QmkSettingsCodec.fields()
         return QmkSettingsCodec.settings_defs

@@ -468,9 +477,9 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone

     @app.get("/api/layout-file")
     def download_layout():
-        data = read(lambda kb: kb.save_layout())
+        data, name = read(lambda kb: (kb.save_layout(), model.layout_file_name(kb)))
         return Response(data, media_type="application/json",
-                        headers={"Content-Disposition": 'attachment; filename="keyboard.vil"'})
+                        headers={"Content-Disposition": content_disposition(name)})

     async def read_limited(request, limit):
         """ The request body, refused with 413 as soon as it is known to be larger than limit """
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layout_file.py
```

Expected: `3 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `817 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types, and check the UI still type-checks**


```bash
cd web && npm run gen:api && npm run check:api && npm run check
```

Expected: `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/model.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_layout_file.py \
  web/src/api/schema.d.ts
git commit -m "feat(server): the layout download is named after the keyboard; the QMK settings definitions are typed"
```

### Task 4: Preview a .vil file before loading it; refuse another keyboard's file

**The preview.** `POST /api/layout-file/preview` takes a `.vil` file like `POST /api/layout-file` and answers what loading it would change, without writing anything:
- The upload and the preview share `_layout_file_changes`, so a file is checked the same way by both (the same 422 messages), with the same 413 size limit and the same token and Origin checks (the middleware covers every `/api` route).
- `preview_layout_file` compares the parsed changes with what the keyboard holds and returns `LayoutFilePreview`. Each list holds only what differs: keys, encoders, layout options, tap dances, combos, key overrides, alt-repeat keys, macros (`model.macro` turns one macro's actions into the model's `Macro`) and settings.
- `ignored` lists what the file has that the keyboard has no room for, which loading skips as Qt does: "layers 4 to 5", "macro 16", "tap dances 8 to 15", "QMK settings 8, 999".
- `needsUnlock` says whether loading needs the keyboard unlocked. The preview itself works on a locked keyboard.

**Another keyboard's file.** A file whose `uid` isn't this keyboard's is refused by both routes with 422 (`OtherKeyboard`, a `ValueError`): "this layout file is for another keyboard (ID 1122334455667788), not this one (ID …)". A `uid` that isn't a 64-bit number is a broken file. A file without a `uid` is taken. `vial_web.py --layout FILE` passes `any_keyboard=True`: the simulated keyboard stands in for the one that saved the file.

**The locked keyboard.** `prepare_layout_file` already asks for the unlock before the first write when the file changes the macros. `test_a_file_with_macros_writes_nothing_on_a_locked_keyboard` proves it: 423, the keyboard unchanged and `virtual.writes == []`; once unlocked, the same file loads.

**Files:**
- Modify: `src/main/python/server/edits.py`, `src/main/python/server/schemas.py`, `src/main/python/server/model.py`, `src/main/python/server/app.py`, `src/main/python/vial_web.py`
- Generated: `web/src/api/schema.d.ts`
- Test: `src/main/python/test/test_layout_file.py`, `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_layout_file.py`:

```diff
diff --git a/src/main/python/test/test_layout_file.py b/src/main/python/test/test_layout_file.py
--- a/src/main/python/test/test_layout_file.py
+++ b/src/main/python/test/test_layout_file.py
@@ -1,14 +1,20 @@
-""" .vil files: the download's name; and the QMK settings definitions, which the settings page is built from """
+""" .vil files: the preview of what loading one changes, files of another keyboard, the download's name, and a locked
+keyboard that must never be written in part """
+import json
+
 import pytest
 from fastapi.testclient import TestClient

 import transport
 from protocol.unlock_hook import set_unlock_handler
+from server import app as app_module
 from server.app import create_app
 from server.device import DeviceManager, FakeBackend, require_unlocked
 from server.names import NamesStore
+from simulator.corne import CORNE_UID, encode
 from simulator.virtual_keyboard import VirtualKeyboard
-from test.test_api import BASE, PORT, TOKEN, setup, client  # noqa: F401 (fixtures)
+from test.test_api import BASE, ORIGIN, PORT, TOKEN, setup, client, virtual  # noqa: F401 (fixtures)
+from test.test_api_validation import snapshot

 # 1 row x 2 columns, one encoder, and a layout option
 OPTIONS = {"name": "Knob/Pad: \"mini\"", "matrix": {"rows": 1, "cols": 2},
@@ -16,6 +22,19 @@ OPTIONS = {"name": "Knob/Pad: \"mini\"", "matrix": {"rows": 1, "cols": 2},
                        "keymap": [["0,0", "0,1\n\n\n0,0", "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"]]}}


+def preview(client, data):
+    return client.post("/api/layout-file/preview", content=data if isinstance(data, bytes) else json.dumps(data))
+
+
+def upload(client, data):
+    return client.post("/api/layout-file", content=data if isinstance(data, bytes) else json.dumps(data))
+
+
+@pytest.fixture
+def vil(client):
+    return json.loads(client.get("/api/layout-file").content)
+
+
 @pytest.fixture
 def knob(tmp_path, monkeypatch):
     """ (client, simulated keyboard with an encoder and a layout option) """
@@ -30,6 +49,150 @@ def knob(tmp_path, monkeypatch):
     set_unlock_handler(None)


+# ---------- the preview ----------
+
+def test_the_keyboards_own_file_changes_nothing(client, virtual, vil):
+    response = preview(client, vil)
+    assert response.status_code == 200, response.text
+    result = response.json()
+    assert result["uid"] == "{:016X}".format(CORNE_UID)
+    for section in ("keys", "encoders", "tapDance", "combos", "keyOverrides", "altRepeatKeys", "macros", "settings",
+                    "ignored"):
+        assert result[section] == [], section
+    assert (result["layoutOptions"], result["needsUnlock"]) == (None, False)
+
+
+def test_the_preview_lists_every_change_and_writes_none(client, virtual, vil):
+    vil["layout"][0][0][0] = "KC_Z"
+    vil["layout"][2][4][1] = "LCTL(KC_C)"
+    vil["tap_dance"][3] = ["KC_A", "KC_NO", "KC_B", "KC_NO", 180]
+    vil["combo"][1][4] = "KC_TAB"
+    vil["key_override"][2] = {"trigger": "KC_A", "replacement": "KC_B", "layers": 3, "trigger_mods": 2,
+                              "negative_mod_mask": 0, "suppressed_mods": 2, "options": 0x87}
+    vil["alt_repeat_key"][0]["alt_keycode"] = "KC_HOME"
+    vil["macro"][5] = [["text", "hello"]]
+    vil["settings"]["7"] = 250
+    before = snapshot(virtual)
+    response = preview(client, vil)
+    assert response.status_code == 200, response.text
+    result = response.json()
+    assert snapshot(virtual) == before
+
+    keys = [(k["layer"], k["row"], k["col"], k["before"]["code"], k["after"]["code"]) for k in result["keys"]]
+    assert keys == [(0, 0, 0, "KC_TAB", "KC_Z"), (2, 4, 1, "KC_NO", "LCTL(KC_C)")]
+    assert [(t["before"]["index"], t["after"]["tap"]["code"], t["after"]["tappingTerm"])
+            for t in result["tapDance"]] == [(3, "KC_A", 180)]
+    assert [(c["after"]["index"], c["before"]["output"]["code"], c["after"]["output"]["code"])
+            for c in result["combos"]] == [(1, "KC_ENTER", "KC_TAB")]
+    assert [(o["after"]["index"], o["after"]["trigger"]["code"], o["after"]["enabled"])
+            for o in result["keyOverrides"]] == [(2, "KC_A", True)]
+    assert [(a["after"]["index"], a["before"]["altKeycode"]["code"], a["after"]["altKeycode"]["code"])
+            for a in result["altRepeatKeys"]] == [(0, "KC_RIGHT", "KC_HOME")]
+    assert [(m["after"]["index"], m["before"]["actions"], m["after"]["actions"][0]["text"])
+            for m in result["macros"]] == [(5, [], "hello")]
+    assert result["settings"] == [{"qsid": 7, "before": 200, "after": 250}]
+    assert result["needsUnlock"] is True  # it changes the macros
+
+
+def test_the_preview_names_what_the_keyboard_has_no_room_for(client, virtual, vil):
+    vil["layout"] += [vil["layout"][0]] * 2  # layers 4 and 5
+    vil["tap_dance"] += [["KC_A", "KC_NO", "KC_NO", "KC_NO", 200]] * 8  # tap dances 8 to 15
+    vil["macro"] += [[]]  # macro 16
+    vil["settings"]["8"] = 1  # the legacy Tap-Hold bitfield, which this keyboard doesn't have
+    vil["settings"]["999"] = 1
+    result = preview(client, vil).json()
+    assert result["ignored"] == ["layers 4 to 5", "macro 16", "tap dances 8 to 15", "QMK settings 8, 999"]
+    assert result["keys"] == [] and result["tapDance"] == []
+
+
+def test_encoders_and_layout_options_in_the_preview(knob, monkeypatch):
+    client, virtual = knob
+    data = json.loads(client.get("/api/layout-file").content)
+    data["encoder_layout"][1][0] = ["KC_VOLU", "KC_VOLD"]
+    data["layout_options"] = 1
+    result = preview(client, data).json()
+    assert [(e["layer"], e["encoder"], e["direction"], e["after"]["code"]) for e in result["encoders"]] == \
+        [(1, 0, 0, "KC_VOLU"), (1, 0, 1, "KC_VOLD")]
+    assert result["layoutOptions"] == {"before": 0, "after": 1}
+
+
+@pytest.mark.parametrize("body", [b"not json", json.dumps({"layout": []}).encode()])
+def test_a_broken_file_is_refused_by_the_preview_as_by_loading(client, virtual, body):
+    before = snapshot(virtual)
+    previewed, uploaded = preview(client, body), upload(client, body)
+    assert previewed.status_code == uploaded.status_code == 422
+    assert previewed.json()["detail"] == uploaded.json()["detail"]
+    assert previewed.json()["detail"].startswith("not a valid Vial layout file")
+    assert snapshot(virtual) == before
+
+
+def test_the_preview_works_on_a_locked_keyboard(client, virtual, vil):
+    virtual.unlocked = False
+    vil["macro"][5] = [["text", "hello"]]
+    response = preview(client, vil)
+    assert response.status_code == 200
+    assert response.json()["needsUnlock"] is True
+
+
+def test_the_preview_keeps_the_size_limit_and_the_security_checks(client, virtual):
+    big = b" " * (app_module.MAX_LAYOUT_FILE + 1)
+    assert client.post("/api/layout-file/preview", content=big).status_code == 413
+    assert client.post("/api/layout-file/preview", content=b"{}",
+                       headers={"origin": "http://evil.example"}).status_code == 403
+    assert client.post("/api/layout-file/preview", content=b"{}", headers=ORIGIN).status_code == 422
+    client.cookies.clear()
+    assert client.post("/api/layout-file/preview", content=b"{}").status_code == 401
+
+
+# ---------- another keyboard's file ----------
+
+def test_another_keyboards_file_is_refused_and_nothing_is_written(client, virtual, vil):
+    vil["uid"] = 0x1122334455667788
+    vil["layout"][0][0][0] = "KC_Z"
+    before = snapshot(virtual)
+    for response in (preview(client, vil), upload(client, vil)):
+        assert response.status_code == 422
+        assert response.json()["detail"] == "this layout file is for another keyboard (ID 1122334455667788), " \
+                                            "not this one (ID {:016X})".format(CORNE_UID)
+    assert snapshot(virtual) == before
+
+
+@pytest.mark.parametrize("uid", ["5EEDC0DE00420042", True, -1, 1 << 64])
+def test_a_uid_that_is_not_a_keyboard_id_is_refused(client, virtual, vil, uid):
+    vil["uid"] = uid
+    before = snapshot(virtual)
+    response = upload(client, vil)
+    assert response.status_code == 422 and "uid must be a number" in response.json()["detail"]
+    assert snapshot(virtual) == before
+
+
+def test_a_file_that_does_not_say_its_keyboard_is_taken(client, virtual, vil):
+    del vil["uid"]
+    vil["layout"][0][0][0] = "KC_Z"
+    assert preview(client, vil).json()["uid"] is None
+    assert upload(client, vil).status_code == 200
+    assert virtual.keymap[0][0][0] == encode("KC_Z")
+
+
+# ---------- a locked keyboard ----------
+
+def test_a_file_with_macros_writes_nothing_on_a_locked_keyboard(client, virtual, vil):
+    """ the keys come first in a file, the macros later: a locked keyboard must refuse it before the first key """
+    virtual.unlocked = False
+    vil["layout"][0][0][0] = "KC_Z"
+    vil["macro"][5] = [["text", "hello"]]
+    before = snapshot(virtual)
+    response = upload(client, vil)
+    assert response.status_code == 423
+    assert snapshot(virtual) == before
+    assert virtual.writes == []
+
+    virtual.unlocked = True  # the user held the unlock keys; the UI sends the file again
+    assert upload(client, vil).status_code == 200
+    assert virtual.keymap[0][0][0] == encode("KC_Z")
+    assert virtual.macros()[5] == b"hello"
+
+
 # ---------- downloading ----------

 def test_the_download_is_named_after_the_keyboard(client):
```

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -589,6 +589,18 @@ def test_layout_file_is_loaded_into_the_simulator(tmp_path, corne_keyboard, simu
     assert simulated[0].keymap[0][0][0] == encode("KC_Q")


+def test_another_keyboards_layout_file_is_loaded_into_the_simulator(tmp_path, corne_keyboard, simulated):
+    """ the simulated keyboard stands in for the one that saved the file: the API refuses another keyboard's file,
+    --layout takes it """
+    data = json.loads(corne_keyboard[1].save_layout())
+    data["uid"] = 0x1234
+    data["layout"][0][0][0] = "KC_Q"
+    path = tmp_path / "other.vil"
+    path.write_text(json.dumps(data), encoding="utf-8")
+    assert vial_web.main(["--fake", "--layout", str(path), "--dry-run"]) == 0
+    assert simulated[0].keymap[0][0][0] == encode("KC_Q")
+
+
 def test_layout_file_is_checked_before_anything_is_written(tmp_path, corne_keyboard, simulated, capsys):
     data = json.loads(corne_keyboard[1].save_layout())
     data["layout"][0][0][0] = "KC_Q"
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layout_file.py test/test_vial_web.py
```

Expected: `14 failed, 113 passed, 1 skipped`.

- [ ] **Step 3: The preview's types**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -265,6 +265,78 @@ class KeyboardModel(BaseModel):
     unlocked: bool


+class KeyChange(BaseModel):
+    layer: int
+    row: int
+    col: int
+    before: Described
+    after: Described
+
+
+class EncoderChange(BaseModel):
+    layer: int
+    encoder: int
+    direction: int
+    before: Described
+    after: Described
+
+
+class LayoutOptionsChange(BaseModel):
+    before: int
+    after: int
+
+
+class TapDanceChange(BaseModel):
+    before: TapDance
+    after: TapDance
+
+
+class ComboChange(BaseModel):
+    before: Combo
+    after: Combo
+
+
+class KeyOverrideChange(BaseModel):
+    before: KeyOverride
+    after: KeyOverride
+
+
+class AltRepeatKeyChange(BaseModel):
+    before: AltRepeatKey
+    after: AltRepeatKey
+
+
+class MacroChange(BaseModel):
+    before: Macro
+    after: Macro
+
+
+class SettingChange(BaseModel):
+    qsid: int
+    before: int
+    after: int
+
+
+class LayoutFilePreview(BaseModel):
+    """ What loading a .vil file would change on the keyboard; nothing is written to find out. Each list holds only
+    what differs from what the keyboard holds now. """
+    uid: Optional[str] = None
+    """ the keyboard the file was saved from, as KeyboardModel.uid; None when the file doesn't say """
+    keys: list[KeyChange]
+    encoders: list[EncoderChange]
+    layoutOptions: Optional[LayoutOptionsChange] = None
+    tapDance: list[TapDanceChange]
+    combos: list[ComboChange]
+    keyOverrides: list[KeyOverrideChange]
+    altRepeatKeys: list[AltRepeatKeyChange]
+    macros: list[MacroChange]
+    settings: list[SettingChange]
+    ignored: list[str]
+    """ what the file has that this keyboard doesn't, and is left out (as the Qt app does): "layers 4 to 7" """
+    needsUnlock: bool
+    """ writing it needs an unlocked keyboard (it changes the macros, or puts QK_BOOT somewhere) """
+
+
 class Session(BaseModel):
     status: Literal["connected", "disconnected"]
     fake: bool
```

- [ ] **Step 4: One macro of the model, for the preview**

Apply to `src/main/python/server/model.py`:

```diff
diff --git a/src/main/python/server/model.py b/src/main/python/server/model.py
--- a/src/main/python/server/model.py
+++ b/src/main/python/server/model.py
@@ -98,13 +98,16 @@ def macro_action(action):
     raise ValueError("unknown macro action {!r}".format(action))


+def macro(index, actions, names):
+    """ A macro from its protocol actions """
+    converted = [macro_action(a) for a in actions]
+    custom = names["macros"].get(str(index))
+    return schemas.Macro(index=index, name=custom or suggest_macro_name([a.model_dump() for a in converted]),
+                         customName=bool(custom), actions=converted)
+
+
 def macros(kb, names):
-    items = []
-    for index, actions in enumerate(kb.macros_deserialize(kb.macro)):
-        converted = [macro_action(a) for a in actions]
-        custom = names["macros"].get(str(index))
-        items.append(schemas.Macro(index=index, name=custom or suggest_macro_name([a.model_dump() for a in converted]),
-                                   customName=bool(custom), actions=converted))
+    items = [macro(index, actions, names) for index, actions in enumerate(kb.macros_deserialize(kb.macro))]
     return schemas.Macros(count=kb.macro_count, memory=kb.macro_memory, used=len(kb.macro), items=items)


```

- [ ] **Step 5: The checks shared by the preview and the upload, the preview, and another keyboard's file**

Apply to `src/main/python/server/edits.py`:

```diff
diff --git a/src/main/python/server/edits.py b/src/main/python/server/edits.py
--- a/src/main/python/server/edits.py
+++ b/src/main/python/server/edits.py
@@ -325,11 +325,13 @@ def _vil_macro_action(kb, act):
     return _macro_action(kb, kind, keys=act[1:])


-def _vil_settings(kb, settings):
-    """ {qsid: value} to write; settings this keyboard doesn't have are skipped, as the Qt app does """
+def _vil_settings(kb, settings, ignored):
+    """ {qsid: value} to write; settings this keyboard doesn't have are skipped, as the Qt app does, and listed in
+    ignored """
     if not isinstance(settings, dict):
         raise _Invalid("settings must be an object")
     out = {}
+    skipped = []
     for key, value in settings.items():
         try:
             qsid = int(key)
@@ -338,11 +340,48 @@ def _vil_settings(kb, settings):
         if qsid in kb.supported_settings and QmkSettingsCodec.is_qsid_supported(qsid):
             _check_setting(kb, qsid, value)
             out[qsid] = value
+        else:
+            skipped.append(qsid)
+    if skipped:
+        ignored.append("QMK setting{} {}".format("s" if len(skipped) > 1 else "", ", ".join(map(str, sorted(skipped)))))
     return out


-def _parse_layout_file(kb, data):
-    """ Decode and check a whole .vil file against this keyboard, without writing. Returns the changes. """
+PLURALS = {"layer": "layers", "macro": "macros", "tap dance": "tap dances", "combo": "combos",
+           "key override": "key overrides", "alt-repeat key": "alt-repeat keys"}
+
+
+def _beyond(what, have, total):
+    """ The entries of a file beyond those the keyboard has, in words: "tap dances 8 to 15", "layer 4"; None if
+    there are none """
+    if total <= have:
+        return None
+    if total == have + 1:
+        return "{} {}".format(what, have)
+    return "{} {} to {}".format(PLURALS[what], have, total - 1)
+
+
+class OtherKeyboard(ValueError):
+    """ A .vil file saved from another keyboard """
+
+
+def _check_uid(kb, doc):
+    """ A file that says which keyboard it was saved from must be this one's: another keyboard's keycodes would land
+    on the wrong keys. (The Qt app asks first; here it is refused.) Returns the file's UID, or None. """
+    uid = doc.get("uid")
+    if uid is None:
+        return None
+    if isinstance(uid, bool) or not isinstance(uid, int) or not 0 <= uid <= 0xFFFFFFFFFFFFFFFF:
+        raise _Invalid("uid must be a number")
+    if uid != kb.keyboard_id:
+        raise OtherKeyboard("this layout file is for another keyboard (ID {:016X}), not this one (ID {})".format(
+            uid, model.uid_of(kb)))
+    return uid
+
+
+def _parse_layout_file(kb, data, any_keyboard=False):
+    """ Decode and check a whole .vil file against this keyboard, without writing. Returns the changes.
+    any_keyboard: a file saved from another keyboard is taken too """
     try:
         doc = json.loads(data)
     except RecursionError:
@@ -351,11 +390,16 @@ def _parse_layout_file(kb, data):
         raise _Invalid(str(e))
     if not isinstance(doc, dict):
         raise _Invalid("expected a JSON object")
+    uid = None if any_keyboard else _check_uid(kb, doc)
     for required in ("layout", "encoder_layout", "layout_options"):
         if required not in doc:
             raise _Invalid("missing {}".format(required))
+    ignored = []

     keys = {}
+    layer_beyond = _beyond("layer", kb.layers, len(_list(doc["layout"], "layout")))
+    if layer_beyond:
+        ignored.append(layer_beyond)
     for layer, rows in enumerate(_list(doc["layout"], "layout")):
         for row, cols in enumerate(_list(rows, "a layout layer")):
             for col, value in enumerate(_list(cols, "a layout row")):
@@ -383,6 +427,9 @@ def _parse_layout_file(kb, data):
         held = kb.save_macro()
         macros = []
         # macros beyond what the keyboard has are skipped, as the Qt app does
+        macro_beyond = _beyond("macro", kb.macro_count, len(_list(doc["macro"], "macro")))
+        if macro_beyond:
+            ignored.append(macro_beyond)
         for index, actions in enumerate(_list(doc["macro"], "macro")[:kb.macro_count]):
             if actions == held[index]:
                 macros.append(None)  # unchanged: keep the keyboard's bytes as they are
@@ -393,10 +440,15 @@ def _parse_layout_file(kb, data):
         macros += [[] for _ in range(kb.macro_count - len(macros))]
         macro_data = _at("macros", _macros_data, kb, macros)

-    def entries(section, count, convert):
-        """ (index, entry) of a section; entries beyond what the keyboard has are skipped, as the Qt app does """
+    def entries(section, what, count, convert):
+        """ (index, entry) of a section; entries beyond what the keyboard has are skipped, as the Qt app does, and
+        listed in ignored """
+        items = _list(doc.get(section, []), section)
+        beyond = _beyond(what, count, len(items))
+        if beyond:
+            ignored.append(beyond)
         return [(index, _at("{} {}".format(section, index), convert, index, entry))
-                for index, entry in enumerate(_list(doc.get(section, []), section)[:count])]
+                for index, entry in enumerate(items[:count])]

     # keycodes go through code() first: older files hold firmware integers, which the API's string fields refuse

@@ -430,17 +482,20 @@ def _parse_layout_file(kb, data):
             altKeycode=code(kb, _field(e, "alt_keycode", what), current.alt_keycode),
             allowedMods=_field(e, "allowed_mods", what), options=_field(e, "options", what))), current)

-    return {
+    changes = {
+        "uid": uid,
         "keys": keys,
         "encoders": encoders,
         "layout_options": layout_options,
         "macro": macro_data,
-        "tap_dance": entries("tap_dance", kb.tap_dance_count, tap_dance),
-        "combo": entries("combo", kb.combo_count, combo),
-        "key_override": entries("key_override", kb.key_override_count, key_override),
-        "alt_repeat_key": entries("alt_repeat_key", kb.alt_repeat_key_count, alt_repeat_key),
-        "settings": _at("settings", _vil_settings, kb, doc.get("settings", {})),
+        "tap_dance": entries("tap_dance", "tap dance", kb.tap_dance_count, tap_dance),
+        "combo": entries("combo", "combo", kb.combo_count, combo),
+        "key_override": entries("key_override", "key override", kb.key_override_count, key_override),
+        "alt_repeat_key": entries("alt_repeat_key", "alt-repeat key", kb.alt_repeat_key_count, alt_repeat_key),
+        "settings": _at("settings", _vil_settings, kb, doc.get("settings", {}), ignored),
     }
+    changes["ignored"] = ignored
+    return changes


 def _needs_unlock(kb, changes):
@@ -458,13 +513,69 @@ def _needs_unlock(kb, changes):
     ))


-def prepare_layout_file(kb, data):
-    """ Check a whole .vil file (bytes), including whether the keyboard must be unlocked for it, without writing
-    anything. Raises ValueError (or KeyboardLocked) if it can't be applied; returns apply(), which writes it. """
+def _layout_file_changes(kb, data, any_keyboard=False):
+    """ _parse_layout_file, with a problem in the file as a ValueError """
     try:
-        changes = _parse_layout_file(kb, data)
+        return _parse_layout_file(kb, data, any_keyboard)
     except _Invalid as e:
         raise ValueError("not a valid Vial layout file: {}".format(e))
+
+
+def _macro_changes(kb, data, names):
+    """ The macros a new macro buffer changes -> [MacroChange] """
+    if data is None or data == kb.macro:
+        return []
+    out = []
+    for index, (old, new) in enumerate(zip(kb.macros_deserialize(kb.macro), kb.macros_deserialize(data))):
+        before, after = model.macro(index, old, names), model.macro(index, new, names)
+        if before.actions != after.actions:
+            out.append(schemas.MacroChange(before=before, after=after))
+    return out
+
+
+def preview_layout_file(kb, data, names):
+    """ What loading a .vil file (bytes) would change, checked as prepare_layout_file checks it. Writes nothing, and
+    works on a locked keyboard too: needsUnlock says whether loading it needs the keyboard unlocked
+    -> LayoutFilePreview """
+    changes = _layout_file_changes(kb, data)
+    options = changes["layout_options"]
+    return schemas.LayoutFilePreview(
+        uid=None if changes["uid"] is None else "{:016X}".format(changes["uid"]),
+        keys=[schemas.KeyChange(layer=layer, row=row, col=col, before=model.d(kb.layout[(layer, row, col)]),
+                                after=model.d(keycode))
+              for (layer, row, col), keycode in sorted(changes["keys"].items())
+              if kb.layout[(layer, row, col)] != keycode],
+        encoders=[schemas.EncoderChange(layer=layer, encoder=index, direction=direction,
+                                        before=model.d(kb.encoder_layout[(layer, index, direction)]),
+                                        after=model.d(keycode))
+                  for (layer, index, direction), keycode in sorted(changes["encoders"].items())
+                  if kb.encoder_layout[(layer, index, direction)] != keycode],
+        layoutOptions=schemas.LayoutOptionsChange(before=kb.layout_options, after=options)
+        if options != -1 and options != kb.layout_options else None,
+        tapDance=[schemas.TapDanceChange(before=model.tap_dance(i, kb.tap_dance_entries[i], names),
+                                         after=model.tap_dance(i, e, names))
+                  for i, e in changes["tap_dance"] if kb.tap_dance_entries[i] != e],
+        combos=[schemas.ComboChange(before=model.combo(i, kb.combo_entries[i]), after=model.combo(i, e))
+                for i, e in changes["combo"] if kb.combo_entries[i] != e],
+        keyOverrides=[schemas.KeyOverrideChange(before=model.key_override(i, kb.key_override_entries[i]),
+                                                after=model.key_override(i, e))
+                      for i, e in changes["key_override"] if kb.key_override_entries[i] != e],
+        altRepeatKeys=[schemas.AltRepeatKeyChange(before=model.alt_repeat_key(i, kb.alt_repeat_key_entries[i]),
+                                                  after=model.alt_repeat_key(i, e))
+                       for i, e in changes["alt_repeat_key"] if kb.alt_repeat_key_entries[i] != e],
+        macros=_macro_changes(kb, changes["macro"], names),
+        settings=[schemas.SettingChange(qsid=qsid, before=kb.settings.get(qsid, 0), after=value)
+                  for qsid, value in sorted(changes["settings"].items()) if kb.settings.get(qsid) != value],
+        ignored=changes["ignored"],
+        needsUnlock=_needs_unlock(kb, changes),
+    )
+
+
+def prepare_layout_file(kb, data, any_keyboard=False):
+    """ Check a whole .vil file (bytes), including whether the keyboard must be unlocked for it, without writing
+    anything. Raises ValueError (or KeyboardLocked) if it can't be applied; returns apply(), which writes it.
+    any_keyboard: a file saved from another keyboard is taken too (the simulator loading someone's layout) """
+    changes = _layout_file_changes(kb, data, any_keyboard)
     if _needs_unlock(kb, changes):
         request_unlock(kb)

```

- [ ] **Step 6: The route, and `--layout` taking any keyboard's file**

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -516,6 +516,13 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         await hub.broadcast({"type": "reloaded"})
         return result

+    @app.post("/api/layout-file/preview", response_model=schemas.LayoutFilePreview)
+    async def preview_layout(request: Request, lang: Lang = languages.DEFAULT):
+        """ What POST /api/layout-file would change with this file, checked the same way; nothing is written """
+        languages.overrides(lang)
+        data = await read_limited(request, MAX_LAYOUT_FILE)
+        return await asyncio.to_thread(read, lambda kb: edits.preview_layout_file(kb, data, names_for(kb)), lang)
+
     @app.post("/api/unlock/start", response_model=schemas.UnlockState)
     async def start_unlock():
         """ Start unlocking the keyboard: the user then holds its unlock keys until the countdown ends, which "unlock"
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -452,7 +452,8 @@ def load_layout_file(manager, path):
     except OSError as e:
         return e.strerror or str(e)
     try:
-        manager.run(lambda kb: edits.prepare_layout_file(kb, data)())
+        # any keyboard's: the simulated one stands in for the keyboard that saved the file
+        manager.run(lambda kb: edits.prepare_layout_file(kb, data, any_keyboard=True)())
     except Exception as e:
         return str(e) or e.__class__.__name__
     return None
```

- [ ] **Step 7: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_layout_file.py test/test_vial_web.py
```

Expected: `127 passed, 1 skipped`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `833 passed, 1 skipped`.

- [ ] **Step 8: Regenerate the API types, and check the UI still type-checks**


```bash
cd web && npm run gen:api && npm run check:api && npm run check
```

Expected: `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 9: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/edits.py \
  src/main/python/server/model.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_layout_file.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py \
  web/src/api/schema.d.ts
git commit -m "feat(server): preview a .vil file before loading it; refuse another keyboard's file"
```

### Task 5: API calls for key overrides, alt-repeat keys, QMK settings and layout files

`client.ts`:
- **`request(method, path, { raw })`** sends a JSON document as it is, for the routes that read the request body themselves (a `.vil` file). The fetch and its "can't reach Vial" error move into `send()`.
- **`download(path, fallback)`** GETs a file to save and returns `{ blob, name }`: the name the server gives in `Content-Disposition`, or `fallback`. A refusal is an `ApiError` with the server's reason, as for `request`.
- **`attachmentName(header)`** reads that name: the UTF-8 `filename*` first, then a quoted or plain `filename`; null when there is none. A `filename*` that isn't percent-encoded right falls back to `filename`.

`api.ts` gets `setKeyOverride`, `setAltRepeatKey`, `settingDefinitions`, `setSetting`, `resetSettings`, `layoutFile`, `previewLayoutFile` and `loadLayoutFile`; `types.ts` names the new schema types.

**Files:**
- Modify: `web/src/api/client.ts`, `web/src/api/api.ts`, `web/src/api/types.ts`
- Test: `web/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/api/client.test.ts`:

```diff
diff --git a/web/src/api/client.test.ts b/web/src/api/client.test.ts
--- a/web/src/api/client.test.ts
+++ b/web/src/api/client.test.ts
@@ -1,5 +1,5 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
-import { DEFAULT_LANGUAGE, request, setRequestLanguage } from "./client";
+import { attachmentName, DEFAULT_LANGUAGE, download, request, setRequestLanguage } from "./client";
 import { ApiError } from "./errors";

 function reply(status: number, body: unknown): Response {
@@ -96,3 +96,39 @@ describe("request", () => {
     expect(error.message).toBe("Can't reach Vial. Is it still running?");
   });
 });
+
+describe("raw bodies and downloads", () => {
+  it("sends a JSON document as it is", async () => {
+    fetchMock.mockResolvedValue(reply(200, { keys: [] }));
+    await request("post", "/api/layout-file/preview", { raw: '{"layout": []}' });
+    const { url, init } = sent();
+    expect(url).toBe("/api/layout-file/preview");
+    expect(init.method).toBe("POST");
+    expect(init.headers).toEqual({ "Content-Type": "application/json" });
+    expect(init.body).toBe('{"layout": []}');
+  });
+
+  it("downloads a file with the name the server gives it", async () => {
+    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: {
+      "Content-Disposition": "attachment; filename=\"Simulated Corne.vil\"; filename*=UTF-8''Simulated%20Corne.vil",
+    } }));
+    const file = await download("/api/layout-file", "keyboard.vil");
+    expect(file.name).toBe("Simulated Corne.vil");
+    expect(await file.blob.text()).toBe("{}");
+  });
+
+  it("fails a download the server refuses, with its reason", async () => {
+    fetchMock.mockResolvedValue(reply(503, { detail: "no keyboard" }));
+    const error = await failure(download("/api/layout-file", "keyboard.vil"));
+    expect(error.status).toBe(503);
+  });
+
+  it("reads the file name from a Content-Disposition header", () => {
+    expect(attachmentName("attachment; filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87.vil")).toBe("Zażółć.vil");
+    expect(attachmentName('attachment; filename="a b.vil"')).toBe("a b.vil");
+    expect(attachmentName("attachment; filename=plain.vil")).toBe("plain.vil");
+    expect(attachmentName("attachment; filename*=UTF-8''%E0%A4%A; filename=\"fallback.vil\"")).toBe("fallback.vil");
+    expect(attachmentName(null)).toBeNull();
+    expect(attachmentName("attachment")).toBeNull();
+  });
+});
```

```bash
cd web && npx vitest run src/api/client.test.ts
```

Expected: `download is not a function` and `Tests  4 failed | 7 passed (11)`.

- [ ] **Step 2: Raw bodies and downloads, the routes and the types**

Apply to `web/src/api/client.ts`:

```diff
diff --git a/web/src/api/client.ts b/web/src/api/client.ts
--- a/web/src/api/client.ts
+++ b/web/src/api/client.ts
@@ -35,19 +35,52 @@ function detailOf(body: unknown): string | undefined {
 export async function request<P extends keyof paths, M extends Method>(
   method: M,
   path: P,
-  options: { params?: PathParams<Operation<P, M>>; body?: Body<Operation<P, M>> } = {},
+  options: {
+    params?: PathParams<Operation<P, M>>;
+    body?: Body<Operation<P, M>>;
+    /** a JSON document sent as it is, for routes that read the request themselves (a .vil file) */
+    raw?: string;
+  } = {},
 ): Promise<Reply<Operation<P, M>>> {
-  let response: Response;
+  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
+  const response = await send(url(path, options.params as Record<string, string | number> | undefined), {
+    method: method.toUpperCase(),
+    headers: body === undefined ? {} : { "Content-Type": "application/json" },
+    body,
+  });
+  const reply: unknown = await response.json().catch(() => null);
+  if (!response.ok) throw new ApiError(response.status, detailOf(reply));
+  return reply as Reply<Operation<P, M>>;
+}
+
+async function send(target: string, init: RequestInit): Promise<Response> {
   try {
-    response = await fetch(url(path, options.params as Record<string, string | number> | undefined), {
-      method: method.toUpperCase(),
-      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
-      body: options.body === undefined ? undefined : JSON.stringify(options.body),
-    });
+    return await fetch(target, init);
   } catch {
     throw new ApiError(0);
   }
-  const body: unknown = await response.json().catch(() => null);
-  if (!response.ok) throw new ApiError(response.status, detailOf(body));
-  return body as Reply<Operation<P, M>>;
+}
+
+/** The file name a Content-Disposition header gives: the UTF-8 one (filename*) if there is one; null if none */
+export function attachmentName(disposition: string | null): string | null {
+  if (!disposition) return null;
+  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
+  if (encoded) {
+    try {
+      return decodeURIComponent(encoded[1].trim());
+    } catch {
+      // not percent-encoded right: the plain name, if any
+    }
+  }
+  return /filename\s*=\s*"([^"]*)"/i.exec(disposition)?.[1] ?? /filename\s*=\s*([^;\s]+)/i.exec(disposition)?.[1] ?? null;
+}
+
+/** A file the server sends to save (GET), with the name it gives it, or `fallback` */
+export async function download(path: keyof paths, fallback: string): Promise<{ blob: Blob; name: string }> {
+  const response = await send(url(path, undefined), { method: "GET" });
+  if (!response.ok) {
+    const reply: unknown = await response.json().catch(() => null);
+    throw new ApiError(response.status, detailOf(reply));
+  }
+  return { blob: await response.blob(), name: attachmentName(response.headers.get("Content-Disposition")) ?? fallback };
 }
```

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -1,6 +1,6 @@
 // The server's routes the UI uses.
-import { request } from "./client";
-import type { ComboIn, MacroActionIn, Named, TapDanceIn } from "./types";
+import { download, request } from "./client";
+import type { AltRepeatKeyIn, ComboIn, KeyOverrideIn, MacroActionIn, Named, TapDanceIn } from "./types";

 export const api = {
   session: () => request("get", "/api/session"),
@@ -15,8 +15,22 @@ export const api = {
   setTapDance: (index: number, body: TapDanceIn) =>
     request("put", "/api/tap-dance/{index}", { params: { index }, body }),
   setCombo: (index: number, body: ComboIn) => request("put", "/api/combos/{index}", { params: { index }, body }),
+  setKeyOverride: (index: number, body: KeyOverrideIn) =>
+    request("put", "/api/key-overrides/{index}", { params: { index }, body }),
+  setAltRepeatKey: (index: number, body: AltRepeatKeyIn) =>
+    request("put", "/api/alt-repeat/{index}", { params: { index }, body }),
   /** every macro: they share the keyboard's macro memory */
   setMacros: (items: MacroActionIn[][]) => request("put", "/api/macros", { body: { items } }),
+  settingDefinitions: () => request("get", "/api/qmk-settings/definitions"),
+  setSetting: (qsid: number, value: number) =>
+    request("put", "/api/qmk-settings/{qsid}", { params: { qsid }, body: { value } }),
+  resetSettings: () => request("post", "/api/qmk-settings/reset"),
+  /** the keyboard's layout as a .vil file, named after the keyboard */
+  layoutFile: () => download("/api/layout-file", "keyboard.vil"),
+  /** what loading a .vil file would change; nothing is written */
+  previewLayoutFile: (text: string) => request("post", "/api/layout-file/preview", { raw: text }),
+  /** writes a .vil file to the keyboard: the whole file, or nothing when it doesn't fit */
+  loadLayoutFile: (text: string) => request("post", "/api/layout-file", { raw: text }),
   setName: (kind: Named["kind"], index: number, name: string) =>
     request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
   unlockStart: () => request("post", "/api/unlock/start"),
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -26,6 +26,15 @@ export type Macro = Schemas["Macro"];
 export type Macros = Schemas["Macros"];
 export type MacroAction = Schemas["MacroAction"];
 export type MacroActionIn = Schemas["MacroActionIn"];
+export type KeyOverride = Schemas["KeyOverride"];
+export type KeyOverrideIn = Schemas["KeyOverrideIn"];
+export type AltRepeatKey = Schemas["AltRepeatKey"];
+export type AltRepeatKeyIn = Schemas["AltRepeatKeyIn"];
+export type QmkSetting = Schemas["QmkSetting"];
+export type SettingField = Schemas["SettingField"];
+export type SettingsTab = Schemas["SettingsTab"];
+export type SettingsDefinitions = Schemas["SettingsDefinitions"];
+export type LayoutFilePreview = Schemas["LayoutFilePreview"];
 export type UnlockState = Schemas["UnlockState"];
 export type MatrixPosition = Schemas["MatrixPosition"];
 /** what /api/events sends */
```

```bash
cd web && npx vitest run src/api/client.test.ts
```

Expected: `Tests  11 passed (11)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  34 passed (34)` and `Tests  549 passed (549)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/api.ts \
  web/src/api/client.test.ts \
  web/src/api/client.ts \
  web/src/api/types.ts
git commit -m "feat(web): API calls for key overrides, alt-repeat keys, QMK settings and layout files"
```

### Task 6: Store edits for key overrides, alt-repeat keys, QMK settings and layout files

The store's new methods all go through `#edit`, like the earlier ones: `pending` counts them, a 423 runs the unlock and sends the change again once, and a lost keyboard or connection ends them with a toast.
- **`setKeyOverride(index, body)`** and **`setAltRepeatKey(index, body)`** put the keyboard's reply into the model.
- **`setSettings(values)`** sends the settings one after another and puts each reply into the model. When one fails, those sent before it stay set and show so; the rest aren't sent.
- **`resetSettings()`** puts the firmware's defaults into the model: the reset route answers every setting as the keyboard holds it now.
- **`loadLayoutFile(text)`** sends the whole file. Its reply is the new model. A file a locked keyboard refused (it changes the macros) is sent again, whole, once the keyboard is unlocked.

**Files:**
- Modify: `web/src/lib/keyboard.svelte.ts`
- Test: `web/src/lib/keyboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -12,6 +12,11 @@ vi.mock("../api/api", () => ({
     setEncoder: vi.fn(),
     setTapDance: vi.fn(),
     setCombo: vi.fn(),
+    setKeyOverride: vi.fn(),
+    setAltRepeatKey: vi.fn(),
+    setSetting: vi.fn(),
+    resetSettings: vi.fn(),
+    loadLayoutFile: vi.fn(),
     setMacros: vi.fn(),
     setName: vi.fn(),
     unlockStart: vi.fn(),
@@ -414,6 +419,77 @@ describe("behaviour edits", () => {
   });
 });

+describe("key overrides, alt-repeat keys, QMK settings and layout files", () => {
+  const override = {
+    index: 0, trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 1, triggerMods: 2,
+    negativeModMask: 0, suppressedMods: 2, options: 0x87, enabled: true,
+  };
+  const body = { trigger: "KC_BSPC", replacement: "KC_DEL", layers: 1, triggerMods: 2, negativeModMask: 0,
+    suppressedMods: 2, options: 0x87 };
+
+  it("put the keyboard's key override and alt-repeat key into the model", async () => {
+    const { store } = await loaded();
+    store.model!.keyOverrides = [{ ...override, trigger: described("KC_NO") }];
+    mocked.setKeyOverride.mockResolvedValueOnce(override);
+    expect(await store.setKeyOverride(0, body)).toBe(true);
+    expect(mocked.setKeyOverride).toHaveBeenCalledWith(0, body);
+    expect(store.model!.keyOverrides[0].trigger.code).toBe("KC_BSPC");
+
+    const ark = { index: 0, keycode: described("KC_LEFT"), altKeycode: described("KC_RGHT"), allowedMods: 0, options: 8,
+      enabled: true };
+    store.model!.altRepeatKeys = [{ ...ark, keycode: described("KC_NO") }];
+    mocked.setAltRepeatKey.mockResolvedValueOnce(ark);
+    expect(await store.setAltRepeatKey(0, { keycode: "KC_LEFT", altKeycode: "KC_RGHT", allowedMods: 0, options: 8 }))
+      .toBe(true);
+    expect(store.model!.altRepeatKeys[0].keycode.code).toBe("KC_LEFT");
+  });
+
+  it("set QMK settings one after another; those set before one fails stay set", async () => {
+    const { store } = await loaded();
+    store.model!.settings = [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }, { qsid: 25, value: 100 }];
+    mocked.setSetting.mockResolvedValueOnce({ qsid: 7, value: 250 })
+      .mockRejectedValueOnce(new ApiError(422, "setting 22 must be a number from 0 to 255"));
+    expect(await store.setSettings([{ qsid: 7, value: 250 }, { qsid: 22, value: 300 }, { qsid: 25, value: 90 }]))
+      .toBe(false);
+    expect(mocked.setSetting).toHaveBeenCalledTimes(2);
+    expect(store.model!.settings).toEqual([{ qsid: 7, value: 250 }, { qsid: 22, value: 0 }, { qsid: 25, value: 100 }]);
+    expect(toasts.items.map((t) => t.message)).toEqual([
+      "Saving the settings failed: setting 22 must be a number from 0 to 255"]);
+  });
+
+  it("reset the QMK settings to what the keyboard says they are now", async () => {
+    const { store } = await loaded();
+    store.model!.settings = [{ qsid: 7, value: 250 }];
+    mocked.resetSettings.mockResolvedValueOnce([{ qsid: 7, value: 200 }]);
+    expect(await store.resetSettings()).toBe(true);
+    expect(store.model!.settings).toEqual([{ qsid: 7, value: 200 }]);
+  });
+
+  it("load a layout file: the model is the keyboard's reply", async () => {
+    const { store } = await loaded();
+    const after = model("KC_Z");
+    mocked.loadLayoutFile.mockResolvedValueOnce(after);
+    expect(await store.loadLayoutFile("{}")).toBe(true);
+    expect(mocked.loadLayoutFile).toHaveBeenCalledWith("{}");
+    expect(store.model!.layers[0].keys[0].code).toBe("KC_Z");
+  });
+
+  it("load a layout file a locked keyboard refused once it is unlocked: the whole file again", async () => {
+    const { store, send } = await loaded();
+    mocked.loadLayoutFile.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"))
+      .mockResolvedValueOnce(model("KC_Z"));
+    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
+    const loading = store.loadLayoutFile("{\"macro\": []}");
+    await settle();
+    expect(store.unlock.open).toBe(true);
+    send({ type: "unlock", unlock: UNLOCKED });
+    expect(await loading).toBe(true);
+    expect(mocked.loadLayoutFile.mock.calls).toEqual([["{\"macro\": []}"], ["{\"macro\": []}"]]);
+    expect(store.model!.layers[0].keys[0].code).toBe("KC_Z");
+    expect(toasts.items).toEqual([]);
+  });
+});
+
 describe("a locked keyboard", () => {
   const macros = { count: 1, memory: 100, used: 4, items: [] };

```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `store.setKeyOverride is not a function` and `Tests  6 failed | 35 passed (41)`.

- [ ] **Step 2: The store methods**

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -6,7 +6,8 @@ import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
 import { ApiError, causeMessage, failureMessage } from "../api/errors";
 import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
 import type {
-  KeyboardLanguage, KeyboardModel, KeycodeCategory, MacroActionIn, Named, Session, TapDanceIn,
+  AltRepeatKeyIn, KeyboardLanguage, KeyboardModel, KeycodeCategory, KeyOverrideIn, MacroActionIn, Named, QmkSetting,
+  Session, TapDanceIn,
 } from "../api/types";
 import { actionAt, type KeyRef } from "../keyboard/refs";
 import { freeTapDance } from "../keymap/tapdance";
@@ -237,6 +238,58 @@ export class KeyboardStore {
     });
   }

+  /** Set a key override: its trigger and replacement, layers, modifiers and options */
+  setKeyOverride(index: number, body: KeyOverrideIn, action = "Saving the key override"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      model.keyOverrides[index] = await api.setKeyOverride(index, body);
+    });
+  }
+
+  /** Set an alt-repeat key: its keycode and alt keycode, allowed modifiers and options */
+  setAltRepeatKey(index: number, body: AltRepeatKeyIn, action = "Saving the alt-repeat key"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      model.altRepeatKeys[index] = await api.setAltRepeatKey(index, body);
+    });
+  }
+
+  /** Set QMK settings, one after another. Those the keyboard took before one failed stay set, and show so. */
+  setSettings(values: QmkSetting[], action = "Saving the settings"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      for (const { qsid, value } of values) {
+        const set = await api.setSetting(qsid, value);
+        const at = model.settings.findIndex((s) => s.qsid === set.qsid);
+        if (at >= 0) model.settings[at] = set;
+        else model.settings.push(set);
+      }
+    });
+  }
+
+  /** Put every QMK setting back to the firmware's default */
+  resetSettings(): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit("Resetting the settings", model, async () => {
+      model.settings = await api.resetSettings();
+    });
+  }
+
+  /** Write a .vil file to the keyboard: all of it, or nothing when it doesn't fit. A file that needs the keyboard
+   * unlocked (it changes the macros) is refused as a whole on a locked one, unlocked for and sent again. */
+  loadLayoutFile(text: string): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit("Loading the layout file", model, async () => {
+      const loaded = await api.loadLayoutFile(text);
+      if (this.model === model) this.model = loaded;
+    });
+  }
+
   /** Set every macro: they share the macro memory (the keyboard keeps the bytes of those that didn't change) */
   setMacros(items: MacroActionIn[][], action = "Saving the macro"): Promise<boolean> {
     const model = this.model;
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `Tests  41 passed (41)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  34 passed (34)` and `Tests  554 passed (554)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts
git commit -m "feat(web): store edits for key overrides, alt-repeat keys, QMK settings and layout files"
```

### Task 7: Addresses for the Key overrides, Alt-repeat, Settings and Keyboard pages

`#key-overrides/2` and `#alt-repeat/0` name an entry, as `#combos/2` does. `#settings` and `#keyboard` are whole pages, like `#keymap`: a number after them is dropped (`#settings/3` is `#settings`), and `#keymap/3` is still the keymap. Anything else (`#lighting`) is the keymap.

Nothing shows the new sections yet: `App.svelte` shows the keymap for a section it doesn't list, until Task 16.

**Files:**
- Modify: `web/src/lib/route.ts`
- Test: `web/src/lib/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/lib/route.test.ts`:

```diff
diff --git a/web/src/lib/route.test.ts b/web/src/lib/route.test.ts
--- a/web/src/lib/route.test.ts
+++ b/web/src/lib/route.test.ts
@@ -6,10 +6,18 @@ describe("parseRoute", () => {
     expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2 });
     expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null });
     expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0 });
+    expect(parseRoute("#key-overrides/2")).toEqual({ section: "key-overrides", item: 2 });
+    expect(parseRoute("#alt-repeat/0")).toEqual({ section: "alt-repeat", item: 0 });
+  });
+
+  it("reads the sections that have no entries, an entry number left out", () => {
+    expect(parseRoute("#settings")).toEqual({ section: "settings", item: null });
+    expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null });
+    expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null });
   });

   it("is the keymap for anything else", () => {
-    for (const hash of ["", "#", "#settings", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
+    for (const hash of ["", "#", "#lighting", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
       expect(parseRoute(hash)).toEqual(HOME);
     }
   });
@@ -17,7 +25,8 @@ describe("parseRoute", () => {

 describe("routeHash", () => {
   it("is what parseRoute reads back", () => {
-    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null }] as const) {
+    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null },
+      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }] as const) {
       expect(parseRoute(routeHash(route))).toEqual(route);
     }
   });
```

```bash
cd web && npx vitest run src/lib/route.test.ts
```

Expected: `Tests  3 failed | 1 passed (4)`.

- [ ] **Step 2: The sections**

Apply to `web/src/lib/route.ts`:

```diff
diff --git a/web/src/lib/route.ts b/web/src/lib/route.ts
--- a/web/src/lib/route.ts
+++ b/web/src/lib/route.ts
@@ -1,13 +1,19 @@
 // Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
 // Combos page. A reload stays where it was, and the browser's back button goes back.

-export type SectionId = "keymap" | "tap-dance" | "combos" | "macros";
+export type SectionId =
+  | "keymap" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "keyboard";

-export const SECTIONS: SectionId[] = ["keymap", "tap-dance", "combos", "macros"];
+export const SECTIONS: SectionId[] = [
+  "keymap", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "keyboard",
+];
+
+/** sections that show one page of their own, with no entries for the address to name */
+const WHOLE: SectionId[] = ["keymap", "settings", "keyboard"];

 export interface Route {
   section: SectionId;
-  /** the entry to show (a tap dance, combo or macro), or null */
+  /** the entry to show (a tap dance, combo, macro, key override or alt-repeat key), or null */
   item: number | null;
 }

@@ -18,7 +24,8 @@ export function parseRoute(hash: string): Route {
   const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
   const section = SECTIONS.find((s) => s === m?.[1]);
   if (!m || !section) return HOME;
-  return { section, item: m[2] === undefined || section === "keymap" ? null : Number(m[2]) };
+  if (m[2] !== undefined && WHOLE.includes(section)) return section === "keymap" ? HOME : { section, item: null };
+  return { section, item: m[2] === undefined ? null : Number(m[2]) };
 }

 export function routeHash(route: Route): string {
```

```bash
cd web && npx vitest run src/lib/route.test.ts
```

Expected: `Tests  4 passed (4)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  34 passed (34)` and `Tests  555 passed (555)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/route.test.ts \
  web/src/lib/route.ts
git commit -m "feat(web): addresses for the Key overrides, Alt-repeat, Settings and Keyboard pages"
```

### Task 8: Key overrides and alt-repeat keys in plain sentences, and their counts

`behaviours/overrides.ts` holds what the two pages know about the protocol's bits (`protocol/key_override.py`, `protocol/alt_repeat_key.py`):
- **Modifiers:** an 8-bit mask, left Ctrl, Shift, Alt, Gui then the right ones (`modBit`, `toggled`). `modNames` says a modifier set on both sides by its name ("Shift": either one) and one set on one side with its side ("Left Shift"); an alt-repeat key that ignores the side says only the name.
- **Layers:** a key override's 16-bit layer mask (`MASK_LAYERS`, `allLayers`, `layersIn`). `layerPhrase` says where it works: "on every layer", "on Base only", "on Base and Layer 2", "on no layer". Bits of layers the keyboard doesn't have don't count.
- **Options:** `KEY_OVERRIDE_OPTIONS` (bits 0 to 5, `vial_ko_option_*`) and `ALT_REPEAT_OPTIONS` (bits 0 to 2, `vial_arep_option_*`), each with a label and a sentence; the enabled bit (`KO_ENABLED` = bit 7, `AR_ENABLED` = bit 3) is a switch of its own. Bits 4 and 5 of a key override are labelled by their protocol names (Decisions, 6); "Default to this alt key" says what the firmware does with it (Decisions, 7).
- **Entries:** `keyOverrideIsSet` and `altRepeatIsSet` (anything not zero), `freeKeyOverride` and `freeAltRepeat`; `newKeyOverride` (on every layer, switched on, started all three ways: QMK's `ko_options_default`) and `newAltRepeat`; `clearedKeyOverride` and `clearedAltRepeat` (all zero: saving one removes it); `keyOverrideRequest` and `altRepeatRequest` (the body the server takes, only the option bits the protocol keeps, with the enabled bit from the switch).
- **Sentences:**
  - `keyOverrideSentence`: "Left Shift + Bksp sends Del, on every layer.", "Ctrl or Alt + Q sends Esc, on Base only." (with "any one trigger modifier"), "Holding Left Shift sends Caps Lock, on every layer." (no trigger key: the modifiers alone);
  - `keyOverrideDetails`: the parts that aren't QMK's usual ("Not while Ctrl is held", "Left Shift is hidden from the computer while it works", the options set, "Starts only: …");
  - `keyOverrideProblems`: why one can never work (no trigger, no layer of this keyboard, no way to start it);
  - `altRepeatSentence`: "After Left (alone, or with Left Shift), Alt Repeat sends Right, and the other way round.", and for the default alt key "After any other key that no alt-repeat key covers, it sends Right too.";
  - `pressable`: whether a keycode is somewhere it can be pressed (a key, an encoder, a tap dance, a combo's output), for the Alt-repeat page's warning.

`entries.ts`: `behaviourCounts` also counts the key overrides and alt-repeat keys set up (null when the firmware has none), for the navigation.

**Files:**
- Create: `web/src/behaviours/overrides.ts`
- Modify: `web/src/behaviours/entries.ts`
- Test: `web/src/behaviours/overrides.test.ts` (new), `web/src/behaviours/entries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/behaviours/overrides.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { corne, described, layer } from "../analysis/testing";
import { namesOf } from "../keyboard/labels";
import {
  allLayers, altRepeatIsSet, altRepeatRequest, altRepeatSentence, AR_ENABLED, clearedKeyOverride,
  freeAltRepeat, freeKeyOverride, keyOverrideDetails, keyOverrideIsSet, keyOverrideProblems, keyOverrideRequest,
  keyOverrideSentence, KO_ACTIVATIONS, KO_ENABLED, layerPhrase, layersIn, modBit, modNames, newAltRepeat,
  newKeyOverride, orList, pressable, toggled, type AltRepeatDraft, type KeyOverrideDraft,
} from "./overrides";

const model = corne({
  layers: [layer({ 0: "QK_ALT_REPEAT_KEY" }, "KC_NO"), layer({}), layer({}), layer({})],
  tapDances: [["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"]],
  combos: [{ keys: ["KC_K", "KC_Y"], output: "KC_ESC" }, { keys: [], output: "KC_ENT" }],
  keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_DEL" }, { trigger: "KC_NO", replacement: "KC_NO" }],
  altRepeatKeys: [{ keycode: "KC_LEFT", altKeycode: "KC_RGHT" }, { keycode: "KC_NO", altKeycode: "KC_NO" }],
});
const names = namesOf(model);
const NONE = described("KC_NO");
const LSFT = 0x02;
const RSFT = 0x20;
const LCTL = 0x01;

function override(change: Partial<KeyOverrideDraft> = {}): KeyOverrideDraft {
  return {
    trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 0xffff, triggerMods: LSFT,
    negativeModMask: 0, suppressedMods: LSFT, options: KO_ENABLED | KO_ACTIVATIONS, enabled: true, ...change,
  };
}

function altRepeat(change: Partial<AltRepeatDraft> = {}): AltRepeatDraft {
  return { keycode: described("KC_LEFT"), altKeycode: described("KC_RIGHT"), allowedMods: 0, options: AR_ENABLED,
    enabled: true, ...change };
}

describe("modifier masks", () => {
  it("has Qt's bit order: the left Ctrl, Shift, Alt, Gui, then the right ones", () => {
    expect(modBit("Left", "Ctrl")).toBe(0x01);
    expect(modBit("Left", "Gui")).toBe(0x08);
    expect(modBit("Right", "Shift")).toBe(0x20);
    expect(modBit("Right", "Gui")).toBe(0x80);
  });

  it("names a modifier set on both sides by its name, one set on one side with its side", () => {
    expect(modNames(LSFT)).toEqual(["Left Shift"]);
    expect(modNames(LSFT | RSFT)).toEqual(["Shift"]);
    expect(modNames(LCTL | RSFT | 0x80)).toEqual(["Left Ctrl", "Right Shift", "Right Gui"]);
    expect(modNames(0)).toEqual([]);
  });

  it("leaves the side out when it doesn't matter", () => {
    expect(modNames(RSFT | LCTL, true)).toEqual(["Ctrl", "Shift"]);
  });

  it("switches one bit", () => {
    expect(toggled(0b101, 0b100)).toBe(0b001);
    expect(toggled(0b001, 0b100)).toBe(0b101);
  });

  it("lists with or", () => {
    expect(orList(["A"])).toBe("A");
    expect(orList(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("layer masks", () => {
  it("names only the layers the keyboard has, at most 16", () => {
    expect(layersIn(0xffff, 4)).toEqual([0, 1, 2, 3]);
    expect(layersIn(0b10010, 4)).toEqual([1]);
    expect(layersIn(0xffff, 20)).toHaveLength(16);
    expect(allLayers(4)).toBe(0b1111);
    expect(allLayers(20)).toBe(0xffff);
  });

  it("says where in words", () => {
    expect(layerPhrase(0xffff, 4, names)).toBe("on every layer");
    expect(layerPhrase(0b1111, 4, names)).toBe("on every layer");
    expect(layerPhrase(0b0001, 4, names)).toBe("on Base only");
    expect(layerPhrase(0b0101, 4, names)).toBe("on Base and Layer 2");
    expect(layerPhrase(0b1110000, 4, names)).toBe("on no layer");
  });
});

describe("key overrides", () => {
  it("is set up when anything in it isn't empty; the first one that isn't is free", () => {
    const empty = { ...clearedKeyOverride(NONE), index: 1 };
    const set = { ...override(), index: 0 };
    expect([set, empty].map(keyOverrideIsSet)).toEqual([true, false]);
    expect(keyOverrideIsSet({ ...empty, layers: 1 })).toBe(true);
    expect(freeKeyOverride([set, empty])).toBe(1);
    expect(freeKeyOverride([set])).toBeNull();
  });

  it("starts a new one on every layer, switched on, started all three ways", () => {
    const draft = newKeyOverride(NONE, 4);
    expect(draft.layers).toBe(0b1111);
    expect(draft.enabled).toBe(true);
    expect(keyOverrideRequest(draft).options).toBe(0x87);
  });

  it("sends the options with the enabled bit as the switch says, and only the bits the protocol has", () => {
    expect(keyOverrideRequest(override({ options: 0xff, enabled: false })).options).toBe(0x3f);
    expect(keyOverrideRequest(override({ options: 0x01, enabled: true })).options).toBe(0x81);
    expect(keyOverrideRequest(override())).toEqual({
      trigger: "KC_BSPC", replacement: "KC_DEL", layers: 0xffff, triggerMods: LSFT, negativeModMask: 0,
      suppressedMods: LSFT, options: 0x87,
    });
  });

  it("clears every field to remove it", () => {
    expect(keyOverrideRequest(clearedKeyOverride(NONE))).toEqual({
      trigger: "KC_NO", replacement: "KC_NO", layers: 0, triggerMods: 0, negativeModMask: 0, suppressedMods: 0,
      options: 0,
    });
  });

  it("says what it does", () => {
    expect(keyOverrideSentence(override(), 4, names)).toBe("Left Shift + BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ triggerMods: LCTL | 0x04, layers: 1 }), 4, names))
      .toBe("Left Ctrl + Left Alt + BSPC sends DEL, on Base only.");
    expect(keyOverrideSentence(override({ triggerMods: LCTL | 0x04, options: 0x88 }), 4, names))
      .toBe("Left Ctrl or Left Alt + BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ triggerMods: 0 }), 4, names)).toBe("BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ replacement: NONE }), 4, names)).toBe("Left Shift + BSPC sends nothing, on every layer.");
  });

  it("with no trigger key, the modifiers alone trigger it; with neither, it says so", () => {
    expect(keyOverrideSentence(override({ trigger: NONE, replacement: described("KC_CAPS") }), 4, names))
      .toBe("Holding Left Shift sends Caps Lock, on every layer.");
    expect(keyOverrideSentence(override({ trigger: NONE, triggerMods: 0 }), 4, names))
      .toBe("No trigger yet: choose a trigger key, or modifiers.");
  });

  it("lists what isn't QMK's usual", () => {
    expect(keyOverrideDetails(override())).toEqual(["Left Shift is hidden from the computer while it works"]);
    expect(keyOverrideDetails(override({ negativeModMask: LCTL | 0x10, suppressedMods: 0, options: 0x81 | 0x30 }))).toEqual([
      "Not while Ctrl is held", "Don't press the trigger key again afterwards", "Don't end when another key is pressed",
      "Starts only: when the trigger key goes down",
    ]);
    expect(keyOverrideDetails(override({ suppressedMods: LSFT | RSFT | LCTL, options: 0x8f }))).toEqual([
      "Left Ctrl and Shift are hidden from the computer while it works", "Any one trigger modifier is enough",
    ]);
  });

  it("says why it can never work", () => {
    expect(keyOverrideProblems(override(), 4)).toEqual([]);
    expect(keyOverrideProblems(override({ trigger: NONE, triggerMods: 0 }), 4)).toEqual([
      "It has no trigger key and no trigger modifiers, so it never works."]);
    expect(keyOverrideProblems(override({ trigger: NONE }), 4)).toEqual([]);
    // layers 4 and up: this keyboard has only 4
    expect(keyOverrideProblems(override({ layers: 0xfff0 }), 4)).toEqual([
      "It is on no layer of this keyboard, so it never works."]);
    expect(keyOverrideProblems(override({ options: 0x88 }), 4)).toEqual([
      "None of the three ways to start it is on, so it never starts."]);
  });
});

describe("alt-repeat keys", () => {
  it("is set up when anything in it isn't empty", () => {
    expect(model.altRepeatKeys.map(altRepeatIsSet)).toEqual([true, false]);
    expect(freeAltRepeat(model.altRepeatKeys)).toBe(1);
  });

  it("starts a new one switched on, and sends the enabled bit as the switch says", () => {
    expect(altRepeatRequest(newAltRepeat(NONE))).toEqual({ keycode: "KC_NO", altKeycode: "KC_NO", allowedMods: 0, options: 8 });
    expect(altRepeatRequest(altRepeat({ options: 0xff, enabled: false })).options).toBe(0x07);
  });

  it("says what it does", () => {
    expect(altRepeatSentence(altRepeat(), names)).toBe("After LEFT, Alt Repeat sends RIGHT.");
    expect(altRepeatSentence(altRepeat({ allowedMods: LSFT, options: AR_ENABLED | 0x02 }), names))
      .toBe("After LEFT (alone, or with Left Shift), Alt Repeat sends RIGHT, and the other way round.");
    expect(altRepeatSentence(altRepeat({ allowedMods: RSFT | LCTL, options: AR_ENABLED | 0x04 }), names))
      .toBe("After LEFT (alone, or with Ctrl or Shift), Alt Repeat sends RIGHT.");
    expect(altRepeatSentence(altRepeat({ altKeycode: NONE, options: 0x0a }), names)).toBe("After LEFT, Alt Repeat sends nothing.");
    // the default alt key: also after any key no other entry covers (vial.c get_alt_repeat_key_keycode_user)
    expect(altRepeatSentence(altRepeat({ options: AR_ENABLED | 0x01 }), names))
      .toBe("After LEFT, Alt Repeat sends RIGHT. After any other key that no alt-repeat key covers, it sends RIGHT too.");
    expect(altRepeatSentence(altRepeat({ keycode: NONE }), names))
      .toBe("No key chosen yet: choose the last key, and what Alt Repeat sends after it.");
  });
});

describe("pressable", () => {
  it("finds a keycode on a key, in a tap dance slot, or as the output of a combo that has keys", () => {
    expect(pressable("QK_ALT_REPEAT_KEY", model)).toBe(true);
    expect(pressable("KC_CAPS", model)).toBe(true);
    expect(pressable("KC_ESC", model)).toBe(true);
    expect(pressable("KC_ENT", model)).toBe(false); // combo 1 has no keys
    expect(pressable("QK_REPEAT_KEY", model)).toBe(false);
  });
});
```

Apply to `web/src/behaviours/entries.test.ts`:

```diff
diff --git a/web/src/behaviours/entries.test.ts b/web/src/behaviours/entries.test.ts
--- a/web/src/behaviours/entries.test.ts
+++ b/web/src/behaviours/entries.test.ts
@@ -39,8 +39,21 @@ describe("behaviourCounts", () => {
     const model = simulatedCorne();
     expect(model.tapDance.filter(tapDanceIsSet)).toHaveLength(2);
     expect(model.macros.items.filter(macroIsSet)).toHaveLength(2);
-    expect(behaviourCounts(model)).toEqual({ tapDance: 2, combos: 2, macros: 2 });
-    expect(behaviourCounts(corne({ layers: [] }))).toEqual({ tapDance: null, combos: null, macros: null });
+    expect(behaviourCounts(model)).toEqual({ tapDance: 2, combos: 2, macros: 2, keyOverrides: null, altRepeat: null });
+    expect(behaviourCounts(corne({ layers: [] }))).toEqual({
+      tapDance: null, combos: null, macros: null, keyOverrides: null, altRepeat: null,
+    });
+  });
+
+  it("count the key overrides and alt-repeat keys set up", () => {
+    const model = corne({
+      layers: [],
+      keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_DEL" }, { trigger: "KC_A", replacement: "KC_B" }],
+      altRepeatKeys: [{ keycode: "KC_LEFT", altKeycode: "KC_RGHT" }, { keycode: "KC_NO", altKeycode: "KC_NO" }],
+    });
+    model.keyOverrides[1] = { ...model.keyOverrides[1], trigger: model.altRepeatKeys[1].keycode,
+      replacement: model.altRepeatKeys[1].keycode, layers: 0, enabled: false };
+    expect(behaviourCounts(model)).toMatchObject({ keyOverrides: 1, altRepeat: 1 });
   });

   it("go by the entries the keyboard lists, as tap dances and combos do", () => {
```

```bash
cd web && npx vitest run src/behaviours/overrides.test.ts src/behaviours/entries.test.ts
```

Expected: `Cannot find module './overrides'` and `Test Files  2 failed (2)`.

- [ ] **Step 2: The bits and the sentences, and the counts**

Create `web/src/behaviours/overrides.ts`:

```ts
// Key overrides and alt-repeat keys: their modifier masks, layer masks and option bits, and what they do in words.
// The bits are the Vial protocol's (protocol/key_override.py, protocol/alt_repeat_key.py), as the Qt app sends them.
import type { AltRepeatKey, AltRepeatKeyIn, Described, KeyOverride, KeyOverrideIn } from "../api/types";
import { andList, memberName } from "../analysis/phrases";
import type { Names } from "../keyboard/labels";

/** KC_NO, as the server describes it: an empty trigger, replacement or key */
export const NO_KEY: Described = {
  code: "KC_NO", value: 0, kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null,
  index: null, description: null, tapCode: null, triLayer: null,
};

// ---------- modifiers ----------

export type ModName = "Ctrl" | "Shift" | "Alt" | "Gui";
export const MOD_NAMES: ModName[] = ["Ctrl", "Shift", "Alt", "Gui"];
export type Side = "Left" | "Right";

/** The bit of a modifier in an 8-bit mask: LCtrl, LShift, LAlt, LGui, then the same on the right */
export function modBit(side: Side, mod: ModName): number {
  return 1 << (MOD_NAMES.indexOf(mod) + (side === "Right" ? 4 : 0));
}

/** The mask with a bit switched */
export function toggled(mask: number, bit: number): number {
  return mask & bit ? mask & ~bit : mask | bit;
}

/** A mask's modifiers in words: a modifier set on both sides is just its name ("Shift": either one), one set on one
 * side says which ("Left Shift"). ignoreSide: the side doesn't matter (an alt-repeat key that ignores it). */
export function modNames(mask: number, ignoreSide = false): string[] {
  return MOD_NAMES.flatMap((mod) => {
    const left = (mask & modBit("Left", mod)) !== 0;
    const right = (mask & modBit("Right", mod)) !== 0;
    if (ignoreSide || (left && right)) return left || right ? [mod] : [];
    return left ? [`Left ${mod}`] : right ? [`Right ${mod}`] : [];
  });
}

/** "Q", "Q or W", "Q, W or E" */
export function orList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// ---------- layers ----------

/** Layers a key override's mask can name: the firmware's mask has 16 bits */
export const MASK_LAYERS = 16;

/** The mask of every layer the keyboard has (up to 16) */
export function allLayers(count: number): number {
  return 2 ** Math.min(count, MASK_LAYERS) - 1;
}

/** The keyboard's layers (only those it has) a mask names */
export function layersIn(mask: number, count: number): number[] {
  return Array.from({ length: Math.min(count, MASK_LAYERS) }, (_, l) => l).filter((l) => (mask & (1 << l)) !== 0);
}

/** Where a layer mask applies, after the action: "on every layer", "on Base only", "on Base and Layer 2", "on no
 * layer". Bits of layers the keyboard doesn't have don't count. */
export function layerPhrase(mask: number, count: number, names: Names): string {
  const layers = layersIn(mask, count);
  if (layers.length === 0) return "on no layer";
  if (layers.length === Math.min(count, MASK_LAYERS)) return count > 1 ? "on every layer" : `on ${names.layer(0)}`;
  if (layers.length === 1) return `on ${names.layer(layers[0])} only`;
  return `on ${andList(layers.map((l) => names.layer(l)))}`;
}

// ---------- options ----------

export interface OptionInfo {
  bit: number;
  label: string;
  /** what it does, in a sentence */
  explanation: string;
}

/** Vial's key override option bits (vial_ko_option_*), in Qt's order. Bits 4 and 5 are labelled by their names:
 * Qt's checkboxes give each the other one's text. */
export const KEY_OVERRIDE_OPTIONS: OptionInfo[] = [
  { bit: 1 << 0, label: "Start when the trigger key goes down",
    explanation: "Pressing the trigger key while the modifiers are held starts it." },
  { bit: 1 << 1, label: "Start when a trigger modifier goes down",
    explanation: "Pressing a trigger modifier while the trigger key is held starts it too." },
  { bit: 1 << 2, label: "Start when a blocking modifier is let go",
    explanation: "Letting go of a modifier that blocks it, while the rest is held, starts it too." },
  { bit: 1 << 3, label: "Any one trigger modifier is enough",
    explanation: "One of the trigger modifiers starts it, instead of all of them together." },
  { bit: 1 << 4, label: "Don't press the trigger key again afterwards",
    explanation: "When it ends while the trigger key is still held, the trigger key isn't sent again." },
  { bit: 1 << 5, label: "Don't end when another key is pressed",
    explanation: "Pressing another key while it is on doesn't end it." },
];

export const KO_ENABLED = 1 << 7;
/** the three ways to start it: QMK's default (ko_options_default) */
export const KO_ACTIVATIONS = 0b111;
/** the option bits the protocol keeps, enabled left out */
const KO_OPTION_BITS = KEY_OVERRIDE_OPTIONS.reduce((all, o) => all | o.bit, 0);

/** Vial's alt-repeat key option bits (vial_arep_option_*), in Qt's order */
export const ALT_REPEAT_OPTIONS: OptionInfo[] = [
  { bit: 1 << 0, label: "Default to this alt key",
    explanation: "After any other key that no alt-repeat key covers, Alt Repeat sends this alt key too (with only allowed modifiers held)." },
  { bit: 1 << 1, label: "Both ways",
    explanation: "Also the other way round: after the alt key, Alt Repeat sends the key." },
  { bit: 1 << 2, label: "Either side's modifiers",
    explanation: "Left and right modifiers count as the same: Right Shift matches an allowed Left Shift." },
];

export const AR_ENABLED = 1 << 3;
const AR_OPTION_BITS = ALT_REPEAT_OPTIONS.reduce((all, o) => all | o.bit, 0);

// ---------- key overrides ----------

/** A key override as it is edited: the model's, enabled kept apart from the other options */
export type KeyOverrideDraft = Omit<KeyOverride, "index">;

export function keyOverrideIsSet(o: KeyOverride): boolean {
  return o.trigger.value !== 0 || o.replacement.value !== 0 || o.layers !== 0 || o.triggerMods !== 0 ||
    o.negativeModMask !== 0 || o.suppressedMods !== 0 || o.options !== 0;
}

/** The first key override that isn't set up, or null */
export function freeKeyOverride(overrides: KeyOverride[]): number | null {
  return overrides.find((o) => !keyOverrideIsSet(o))?.index ?? null;
}

/** What a new key override starts as: on every layer, on, started all three ways (QMK's defaults) */
export function newKeyOverride(none: Described, layerCount: number): KeyOverrideDraft {
  return {
    trigger: none, replacement: none, layers: allLayers(layerCount), triggerMods: 0, negativeModMask: 0,
    suppressedMods: 0, options: KO_ENABLED | KO_ACTIVATIONS, enabled: true,
  };
}

export function keyOverrideRequest(o: KeyOverrideDraft): KeyOverrideIn {
  return {
    trigger: o.trigger.code, replacement: o.replacement.code, layers: o.layers & 0xffff, triggerMods: o.triggerMods,
    negativeModMask: o.negativeModMask, suppressedMods: o.suppressedMods,
    options: (o.options & KO_OPTION_BITS) | (o.enabled ? KO_ENABLED : 0),
  };
}

/** What every field of an empty key override holds: saving it removes the key override */
export function clearedKeyOverride(none: Described): KeyOverrideDraft {
  return {
    trigger: none, replacement: none, layers: 0, triggerMods: 0, negativeModMask: 0, suppressedMods: 0, options: 0,
    enabled: false,
  };
}

function keyName(d: Described, names: Names): string {
  return memberName(d, names);
}

/** "Left Shift + Bksp sends Del, on every layer.", "Ctrl or Alt + Q sends Esc, on Base only.", "Holding Left Shift
 * sends Caps Lock, on every layer." (no trigger key: the modifiers alone), "Bksp sends nothing, on Base only." */
export function keyOverrideSentence(o: KeyOverrideDraft, layerCount: number, names: Names): string {
  const mods = modNames(o.triggerMods);
  const join = o.options & KEY_OVERRIDE_OPTIONS[3].bit ? orList : (m: string[]) => m.join(" + ");
  const hasKey = o.trigger.kind !== "none";
  if (!hasKey && mods.length === 0) return "No trigger yet: choose a trigger key, or modifiers.";
  const trigger = hasKey
    ? (mods.length > 0 ? `${join(mods)} + ${keyName(o.trigger, names)}` : keyName(o.trigger, names))
    : `Holding ${join(mods)}`;
  const sends = o.replacement.kind === "none" ? "sends nothing" : `sends ${keyName(o.replacement, names)}`;
  return `${trigger} ${sends}, ${layerPhrase(o.layers, layerCount, names)}.`;
}

/** The parts that aren't QMK's usual, in short: "Not while Ctrl is held", "Left Shift is hidden from the computer" */
export function keyOverrideDetails(o: KeyOverrideDraft): string[] {
  const details: string[] = [];
  const negative = modNames(o.negativeModMask);
  if (negative.length > 0) details.push(`Not while ${orList(negative)} is held`);
  const hidden = modNames(o.suppressedMods);
  if (hidden.length > 0) details.push(`${andList(hidden)} ${hidden.length === 1 ? "is" : "are"} hidden from the computer while it works`);
  for (const option of KEY_OVERRIDE_OPTIONS.slice(3)) {
    if (o.options & option.bit) details.push(option.label);
  }
  const starts = KEY_OVERRIDE_OPTIONS.slice(0, 3).filter((option) => o.options & option.bit);
  if (starts.length > 0 && starts.length < 3) details.push(`Starts only: ${starts.map((s) => s.label.replace(/^Start /, "")).join("; ")}`);
  return details;
}

/** Why it can never work, or nothing */
export function keyOverrideProblems(o: KeyOverrideDraft, layerCount: number): string[] {
  const problems: string[] = [];
  if (o.trigger.kind === "none" && o.triggerMods === 0) problems.push("It has no trigger key and no trigger modifiers, so it never works.");
  if (layersIn(o.layers, layerCount).length === 0) problems.push("It is on no layer of this keyboard, so it never works.");
  if ((o.options & KO_ACTIVATIONS) === 0) problems.push("None of the three ways to start it is on, so it never starts.");
  return problems;
}

// ---------- alt-repeat keys ----------

export type AltRepeatDraft = Omit<AltRepeatKey, "index">;

export function altRepeatIsSet(a: AltRepeatKey): boolean {
  return a.keycode.value !== 0 || a.altKeycode.value !== 0 || a.allowedMods !== 0 || a.options !== 0;
}

export function freeAltRepeat(keys: AltRepeatKey[]): number | null {
  return keys.find((a) => !altRepeatIsSet(a))?.index ?? null;
}

export function newAltRepeat(none: Described): AltRepeatDraft {
  return { keycode: none, altKeycode: none, allowedMods: 0, options: AR_ENABLED, enabled: true };
}

export function clearedAltRepeat(none: Described): AltRepeatDraft {
  return { keycode: none, altKeycode: none, allowedMods: 0, options: 0, enabled: false };
}

export function altRepeatRequest(a: AltRepeatDraft): AltRepeatKeyIn {
  return {
    keycode: a.keycode.code, altKeycode: a.altKeycode.code, allowedMods: a.allowedMods,
    options: (a.options & AR_OPTION_BITS) | (a.enabled ? AR_ENABLED : 0),
  };
}

/** "After Left, Alt Repeat sends Right.", "After Left (alone, or with Left Shift), Alt Repeat sends Right, and the
 * other way round." */
export function altRepeatSentence(a: AltRepeatDraft, names: Names): string {
  if (a.keycode.kind === "none") return "No key chosen yet: choose the last key, and what Alt Repeat sends after it.";
  const mods = modNames(a.allowedMods, (a.options & ALT_REPEAT_OPTIONS[2].bit) !== 0);
  const after = mods.length > 0 ? `${keyName(a.keycode, names)} (alone, or with ${orList(mods)})` : keyName(a.keycode, names);
  const sends = a.altKeycode.kind === "none" ? "sends nothing" : `sends ${keyName(a.altKeycode, names)}`;
  const back = a.options & ALT_REPEAT_OPTIONS[1].bit && a.altKeycode.kind !== "none" ? ", and the other way round" : "";
  // the default alt key: the firmware also sends it after any last key no entry matches
  const fallback = a.options & ALT_REPEAT_OPTIONS[0].bit && a.altKeycode.kind !== "none"
    ? ` After any other key that no alt-repeat key covers, it sends ${keyName(a.altKeycode, names)} too.` : "";
  return `After ${after}, Alt Repeat ${sends}${back}.${fallback}`;
}

/** Whether a keycode is on a key, in a tap dance or as a combo's output: somewhere it can be pressed */
export function pressable(code: string, model: {
  layers: { keys: Described[]; encoders: Described[] }[];
  tapDance: { tap: Described; hold: Described; doubleTap: Described; tapHold: Described }[];
  combos: { keys: Described[]; output: Described }[];
}): boolean {
  return model.layers.some((l) => l.keys.some((k) => k.code === code) || l.encoders.some((k) => k.code === code)) ||
    model.tapDance.some((td) => [td.tap, td.hold, td.doubleTap, td.tapHold].some((d) => d.code === code)) ||
    model.combos.some((c) => c.keys.some((k) => k.kind !== "none") && c.output.code === code);
}
```

Apply to `web/src/behaviours/entries.ts`:

```diff
diff --git a/web/src/behaviours/entries.ts b/web/src/behaviours/entries.ts
--- a/web/src/behaviours/entries.ts
+++ b/web/src/behaviours/entries.ts
@@ -4,6 +4,7 @@ import type { Usage } from "../analysis/usage";
 import type { KeyboardModel, Macro, TapDance } from "../api/types";
 import { tapDanceSlots } from "../keymap/tapdance";
 import { isSet as comboIsSet } from "./members";
+import { altRepeatIsSet, keyOverrideIsSet } from "./overrides";

 export function tapDanceIsSet(td: TapDance): boolean {
   return tapDanceSlots(td).some((slot) => slot.action.kind !== "none");
@@ -32,11 +33,16 @@ export function freeMacro(model: Pick<KeyboardModel, "macros">, usage: Usage): n
 /** How many of each are set up, for the navigation; null where the firmware has none (the section is hidden). Only
  * those set up count, though a page also shows those used but empty (a macro on a key with no steps): the count says
  * how many there are, the page where they are used. */
-export function behaviourCounts(model: Pick<KeyboardModel, "tapDance" | "combos" | "macros">):
-  { tapDance: number | null; combos: number | null; macros: number | null } {
+export function behaviourCounts(model: Pick<KeyboardModel, "tapDance" | "combos" | "macros" | "keyOverrides" |
+  "altRepeatKeys">): {
+  tapDance: number | null; combos: number | null; macros: number | null; keyOverrides: number | null;
+  altRepeat: number | null;
+} {
   return {
     tapDance: model.tapDance.length > 0 ? model.tapDance.filter(tapDanceIsSet).length : null,
     combos: model.combos.length > 0 ? model.combos.filter(comboIsSet).length : null,
     macros: model.macros.items.length > 0 ? model.macros.items.filter(macroIsSet).length : null,
+    keyOverrides: model.keyOverrides.length > 0 ? model.keyOverrides.filter(keyOverrideIsSet).length : null,
+    altRepeat: model.altRepeatKeys.length > 0 ? model.altRepeatKeys.filter(altRepeatIsSet).length : null,
   };
 }
```

```bash
cd web && npx vitest run src/behaviours/overrides.test.ts src/behaviours/entries.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  26 passed (26)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  35 passed (35)` and `Tests  575 passed (575)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/behaviours/entries.test.ts \
  web/src/behaviours/entries.ts \
  web/src/behaviours/overrides.test.ts \
  web/src/behaviours/overrides.ts
git commit -m "feat(web): key overrides and alt-repeat keys in plain sentences, and their counts"
```

### Task 9: The editors' controls: a switch, modifiers, layers, options and a keycode

Small components the Key overrides and Alt-repeat editors share (and the Settings page, for the switch). Each takes `busy`: while a change is saved, it keeps the focus (`aria-disabled`) but takes nothing.
- **`ui/Switch.svelte`:** an on/off switch: a checkbox with `role="switch"` inside its label, drawn as a track and a thumb.
- **`ModToggles.svelte`:** a fieldset of eight toggle buttons (`aria-pressed`), Left and Right Ctrl, Shift, Alt and Gui, with a one-sentence hint under the legend.
- **`LayerChips.svelte`:** one chip per layer (up to 16), named as the keymap names them and cut short with a tooltip, with All and None. Bits of layers the keyboard doesn't have stay as they are; a keyboard with more than 16 layers is told that the rest can't have key overrides.
- **`OptionChecks.svelte`:** a fieldset of checkboxes, each with its label and its sentence.
- **`KeycodeButton.svelte`:** a keycode as a key face (and its hold, if it has one), under the label of what it is for ("Trigger"); a click opens the keycode picker.

`EntryHead` gets the `override` tone: the id badge in the accent colour.

Nothing uses them yet, so the checks are the type check and the build.

**Files:**
- Create: `web/src/ui/Switch.svelte`, `web/src/behaviours/ModToggles.svelte`, `web/src/behaviours/LayerChips.svelte`, `web/src/behaviours/OptionChecks.svelte`, `web/src/behaviours/KeycodeButton.svelte`
- Modify: `web/src/behaviours/EntryHead.svelte`

- [ ] **Step 1: The switch**

Create `web/src/ui/Switch.svelte`:

```svelte
<script lang="ts">
  interface Props {
    id?: string;
    label: string;
    checked: boolean;
    /** a change is being saved: the switch keeps the focus, but takes nothing until it is done */
    busy?: boolean;
    disabled?: boolean;
    describedby?: string;
    onchange: (checked: boolean) => void;
  }

  let { id, label, checked, busy = false, disabled = false, describedby, onchange }: Props = $props();
  const uid = $props.id();
</script>

<label class="switch" for={id ?? uid}>
  <input
    id={id ?? uid}
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-checked={checked}
    aria-describedby={describedby}
    aria-disabled={busy || undefined}
    onclick={(event) => {
      if (busy) event.preventDefault();
    }}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  <span class="text">{label}</span>
</label>

<style>
  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  /* the real checkbox, invisible over the track: it takes the clicks and the focus */
  input {
    position: absolute;
    z-index: 1;
    width: 34px;
    height: 20px;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  input:disabled {
    cursor: not-allowed;
  }

  input[aria-disabled="true"] {
    cursor: progress;
  }

  .track {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background-color 0.12s;
  }

  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    transition: transform 0.12s;
  }

  input:checked + .track {
    background: var(--accent);
  }

  input:checked + .track .thumb {
    transform: translateX(14px);
  }

  input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  input:disabled + .track {
    opacity: 0.45;
  }
</style>
```

- [ ] **Step 2: Modifier toggles, layer chips and option checkboxes**

Create `web/src/behaviours/ModToggles.svelte`:

```svelte
<script lang="ts">
  import { MOD_NAMES, modBit, toggled, type Side } from "./overrides";

  interface Props {
    /** the group's name: "Trigger modifiers" */
    legend: string;
    /** what the modifiers do, in a sentence */
    hint: string;
    /** 8 bits: the left Ctrl, Shift, Alt, Gui, then the right ones */
    mask: number;
    /** a change is being saved: the toggles keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (mask: number) => void;
  }

  let { legend, hint, mask, busy, onchange }: Props = $props();
  const uid = $props.id();
  const SIDES: Side[] = ["Left", "Right"];
</script>

<fieldset class="mods" aria-describedby="{uid}-hint">
  <legend>{legend}</legend>
  <p class="hint" id="{uid}-hint">{hint}</p>
  {#each SIDES as side (side)}
    <div class="row">
      <span class="side" aria-hidden="true">{side}</span>
      {#each MOD_NAMES as mod (mod)}
        {@const bit = modBit(side, mod)}
        <button
          type="button"
          class="mod"
          aria-pressed={(mask & bit) !== 0}
          aria-label="{side} {mod}"
          aria-disabled={busy || undefined}
          onclick={() => {
            if (!busy) onchange(toggled(mask, bit));
          }}
        >{mod}</button>
      {/each}
    </div>
  {/each}
</fieldset>

<style>
  .mods {
    display: grid;
    gap: 5px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    font-size: 13px;
    font-weight: 650;
  }

  .hint {
    margin: 0 0 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .side {
    width: 36px;
    color: var(--text-3);
    font-size: 11.5px;
  }

  .mod {
    min-width: 46px;
    padding: 3px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }

  .mod:hover {
    border-color: var(--accent);
  }

  .mod[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--tone-mod) 70%, var(--border));
    background: color-mix(in srgb, var(--tone-mod) 16%, var(--surface));
    color: var(--text);
    font-weight: 650;
  }

  .mod[aria-disabled="true"] {
    cursor: progress;
  }
</style>
```

Create `web/src/behaviours/LayerChips.svelte`:

```svelte
<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import { allLayers, MASK_LAYERS, toggled } from "./overrides";

  interface Props {
    /** 16 bits, one per layer; bits of layers the keyboard doesn't have are kept as they are */
    mask: number;
    /** how many layers the keyboard has */
    count: number;
    names: Names;
    /** a change is being saved: the chips keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (mask: number) => void;
  }

  let { mask, count, names, busy, onchange }: Props = $props();
  const uid = $props.id();
  const shown = $derived(Array.from({ length: Math.min(count, MASK_LAYERS) }, (_, l) => l));
  /** the bits of layers the keyboard doesn't have: "All" and "None" leave them as they are */
  const beyond = $derived(mask & ~allLayers(count) & 0xffff);

  function change(next: number) {
    if (!busy) onchange(next);
  }
</script>

<fieldset class="layers" aria-describedby="{uid}-hint">
  <legend>Layers</legend>
  <p class="hint" id="{uid}-hint">
    It works only while one of these layers is on.{#if count > MASK_LAYERS} Layers {MASK_LAYERS} and up can't have
      key overrides: the firmware keeps {MASK_LAYERS} layers in its mask.{/if}
  </p>
  <div class="chips">
    {#each shown as layer (layer)}
      {@const name = names.layer(layer)}
      <button type="button" class="chip" aria-pressed={(mask & (1 << layer)) !== 0} aria-disabled={busy || undefined}
        title={name} onclick={() => change(toggled(mask, 1 << layer))}>
        <span class="number" aria-hidden="true">{layer}</span><span class="name">{name}</span>
      </button>
    {/each}
    <span class="shortcuts">
      <button type="button" class="link" aria-disabled={busy || undefined} onclick={() => change(beyond | allLayers(count))}>
        All layers
      </button>
      <button type="button" class="link" aria-disabled={busy || undefined} onclick={() => change(beyond)}>None</button>
    </span>
  </div>
</fieldset>

<style>
  .layers {
    display: grid;
    gap: 5px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    font-size: 13px;
    font-weight: 650;
  }

  .hint {
    margin: 0 0 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 180px;
    padding: 3px 9px 3px 4px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--accent);
  }

  .chip[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--tone-layer) 65%, var(--border));
    background: color-mix(in srgb, var(--tone-layer) 14%, var(--surface));
    color: var(--text);
    font-weight: 600;
  }

  .number {
    display: inline-grid;
    flex: none;
    place-items: center;
    min-width: 19px;
    height: 19px;
    border-radius: 999px;
    background: var(--surface-2);
    font: 650 11px/1 var(--mono);
  }

  .chip[aria-pressed="true"] .number {
    background: color-mix(in srgb, var(--tone-layer) 30%, var(--surface));
  }

  /* a long layer name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shortcuts {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
  }

  .link {
    padding: 3px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .link:hover {
    background: var(--accent-weak);
  }

  .chip[aria-disabled="true"],
  .link[aria-disabled="true"] {
    cursor: progress;
  }
</style>
```

Create `web/src/behaviours/OptionChecks.svelte`:

```svelte
<script lang="ts">
  import type { OptionInfo } from "./overrides";

  interface Props {
    legend: string;
    options: OptionInfo[];
    /** the option bits */
    value: number;
    /** a change is being saved: the boxes keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (value: number) => void;
  }

  let { legend, options, value, busy, onchange }: Props = $props();
  const uid = $props.id();
</script>

<fieldset class="options">
  <legend>{legend}</legend>
  <ul>
    {#each options as option, i (option.bit)}
      <li>
        <input
          id="{uid}-{i}"
          type="checkbox"
          checked={(value & option.bit) !== 0}
          aria-describedby="{uid}-{i}-why"
          aria-disabled={busy || undefined}
          onclick={(event) => {
            // while busy the box stays as it was: the change would be lost
            if (busy) event.preventDefault();
          }}
          onchange={(event) => onchange(event.currentTarget.checked ? value | option.bit : value & ~option.bit)}
        />
        <label for="{uid}-{i}">{option.label}</label>
        <span class="why" id="{uid}-{i}-why">{option.explanation}</span>
      </li>
    {/each}
  </ul>
</fieldset>

<style>
  .options {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 650;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 6px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0 8px;
    align-items: start;
  }

  input {
    margin: 3px 0 0;
    accent-color: var(--accent);
  }

  input[aria-disabled="true"] {
    cursor: progress;
  }

  label {
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .why {
    grid-column: 2;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 3: The keycode button, and the cards' tone**

Create `web/src/behaviours/KeycodeButton.svelte`:

```svelte
<script lang="ts">
  import type { Described } from "../api/types";
  import { actionSummary, keyFace, type Names } from "../keyboard/labels";

  interface Props {
    id?: string;
    /** what the keycode is for: "Trigger" */
    label: string;
    action: Described;
    names: Names;
    /** a change is being saved: the button keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** opens the keycode picker */
    onpick: () => void;
  }

  let { id, label, action, names, busy, onpick }: Props = $props();
  const set = $derived(action.kind !== "none");
  const face = $derived(keyFace(action, names));
  const what = $derived(set ? actionSummary(action, names).tap : "nothing");
</script>

<button
  {id}
  type="button"
  class="slot"
  class:set
  aria-label="{label}: {what} · change it"
  title="{label}: {set ? `${what} (${action.code})` : 'nothing'} · click to change"
  aria-disabled={busy || undefined}
  onclick={() => {
    if (!busy) onpick();
  }}
>
  <span class="how">{label}</span>
  <span class="what tone-{face.tone}" data-tone={face.tone}>{set ? face.main || action.code : "nothing"}</span>
  {#if set && face.hold}<span class="hold">{face.hold}</span>{/if}
</button>

<style>
  /* as a tap dance's slots */
  .slot {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 3px;
    width: 100%;
    min-width: 0;
    min-height: 68px;
    padding: 7px 8px 9px;
    border: 1px dashed var(--border-strong);
    border-radius: 9px;
    background: transparent;
    text-align: center;
    cursor: pointer;
  }

  .slot.set {
    border-style: solid;
    border-color: var(--border);
    background: var(--board-bg);
  }

  .slot:hover {
    border-color: var(--accent);
  }

  .slot[aria-disabled="true"] {
    cursor: progress;
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
</style>
```

Apply to `web/src/behaviours/EntryHead.svelte`:

```diff
diff --git a/web/src/behaviours/EntryHead.svelte b/web/src/behaviours/EntryHead.svelte
--- a/web/src/behaviours/EntryHead.svelte
+++ b/web/src/behaviours/EntryHead.svelte
@@ -8,7 +8,7 @@
     headingId: string;
     /** the name, cut short with a tooltip when it is long; null for an entry without names (a combo) */
     name: string | null;
-    tone: "tap-dance" | "macro" | "combo";
+    tone: "tap-dance" | "macro" | "combo" | "override";
     /** renames it, when it can be named */
     onrename?: () => void;
     renameLabel?: string;
@@ -76,6 +76,12 @@
     color: color-mix(in srgb, var(--colour, var(--combo-0)) 75%, var(--text));
   }

+  /* key overrides and alt-repeat keys */
+  .id.override {
+    background: var(--accent-weak);
+    color: var(--accent);
+  }
+
   /* a long name is cut short; the tooltip has all of it */
   .name {
     min-width: 0;
```

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 5: Commit**

```bash
git add web/src/behaviours/EntryHead.svelte \
  web/src/behaviours/KeycodeButton.svelte \
  web/src/behaviours/LayerChips.svelte \
  web/src/behaviours/ModToggles.svelte \
  web/src/behaviours/OptionChecks.svelte \
  web/src/ui/Switch.svelte
git commit -m "feat(web): controls for key overrides and alt-repeat keys: a switch, modifiers, layers, options, a keycode"
```

### Task 10: The Key overrides page

One card per key override that is set up, plus one opened from the address or with "New key override" (the first free one), as the other list pages do (`shownEntries`). The page says how many more are free.
- **`KeyOverrideCard.svelte`:** the id ("KO 2"), the sentence, then the trigger's modifiers + the trigger key → the replacement as key faces, the details, and the problems (not for an empty one, nor when the sentence already says it has no trigger). A switched-off one is faded and says "Off". While it is edited it shows the editor and keeps its accent border; a new one says it isn't kept until it is saved.
- **`KeyOverrideEditor.svelte`:** the trigger and the replacement (keycode buttons that open the picker), the trigger modifiers, the blocking ("negative") modifiers and the hidden ("suppressed") modifiers, each with a sentence, the layers as chips, the options as checkboxes, and an on/off switch. Save is disabled until it has a trigger key or trigger modifiers, and says why. "Remove" (for one set up on the keyboard) saves the all-zero entry.
- **`KeyOverridesPage.svelte`:** the draft (one at a time), the picker for the trigger or the replacement, the focus (the trigger when the editor opens, the card's heading when it closes, or "New key override" when the card went), and the drafts and opened cards forgotten when another keyboard is plugged in (`model.uid` changes). `busy = keyboard.pending > 0` with `aria-disabled`, so the focus is never lost while a save runs.

The page isn't in the navigation until Task 16; the e2e tests come in Task 17.

**Files:**
- Create: `web/src/behaviours/KeyOverrideCard.svelte`, `web/src/behaviours/KeyOverrideEditor.svelte`, `web/src/behaviours/KeyOverridesPage.svelte`

- [ ] **Step 1: The card**

Create `web/src/behaviours/KeyOverrideCard.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Described, KeyOverride } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import {
    keyOverrideDetails, keyOverrideIsSet, keyOverrideProblems, keyOverrideSentence, modNames, type KeyOverrideDraft,
  } from "./overrides";
  import { replayed } from "./target.svelte";

  interface Props {
    override: KeyOverride;
    /** while it is edited: what the editor holds */
    draft: KeyOverrideDraft | null;
    layerCount: number;
    names: Names;
    canEdit: boolean;
    /** a change is being saved: Edit keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** the editor, while it is edited */
    editor?: Snippet;
    onedit: () => void;
  }

  let { override, draft, layerCount, names, canEdit, busy, target, editor, onedit }: Props = $props();

  const headingId = $derived(`key-override-${override.index}-title`);
  /** what is shown: the editor's version while editing */
  const shown = $derived<KeyOverrideDraft>(draft ?? override);
  const sentence = $derived(keyOverrideSentence(shown, layerCount, names));
  const details = $derived(keyOverrideDetails(shown));
  const problems = $derived(keyOverrideProblems(shown, layerCount));
  /** a new one: nothing of it is on the keyboard yet */
  const isNew = $derived(!keyOverrideIsSet(override));
  const mods = $derived(modNames(shown.triggerMods));
  /** why it can't work: not for an empty one not being edited, nor when the sentence says it has no trigger yet */
  const showProblems = $derived(problems.length > 0 && (!isNew || draft !== null) &&
    !(shown.trigger.kind === "none" && shown.triggerMods === 0));

  function face(d: Described) {
    const f = keyFace(d, names);
    return { tone: f.tone, text: d.kind === "none" ? "nothing" : f.main || d.code };
  }
  const trigger = $derived(face(shown.trigger));
  const replacement = $derived(face(shown.replacement));
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing={draft !== null}
  class:off={!shown.enabled} id="key-override-{override.index}" aria-labelledby={headingId}>
  <EntryHead id="KO {override.index}" {headingId} name={null} tone="override" {canEdit}>
    {#snippet actions()}
      {#if !shown.enabled && !isNew}<span class="state" title="Switched off: it does nothing until it is switched on">Off</span>{/if}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>
  {#if isNew && draft}
    <p class="new">
      <strong>New key override:</strong> nothing is kept until you save it. Cancel, and it is gone.
    </p>
  {/if}

  {#if editor}
    {@render editor()}
  {:else}
    <div class="row" aria-hidden="true">
      <span class="from">
        {#each mods as mod (mod)}<span class="mod">{mod}</span><span class="plus">+</span>{/each}
        <span class="out tone-{trigger.tone}" data-tone={trigger.tone} title={trigger.text}>{trigger.text}</span>
      </span>
      <span class="arrow">→</span>
      <span class="out tone-{replacement.tone}" data-tone={replacement.tone} title={replacement.text}>{replacement.text}</span>
    </div>
    {#if details.length > 0}
      <ul class="details">
        {#each details as detail (detail)}<li>{detail}</li>{/each}
      </ul>
    {/if}
  {/if}
  {#if showProblems}
    <ul class="problems">
      {#each problems as problem (problem)}<li>{problem}</li>{/each}
    </ul>
  {/if}
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css) */
  .card {
    --card-accent: var(--accent);
  }

  .sentence {
    margin: 0;
    color: var(--text-2);
  }

  .off:not(.editing) .row {
    opacity: 0.55;
  }

  .state {
    align-self: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
  }

  .new {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 8px;
    background: var(--accent-weak);
    color: var(--text);
    font-size: 13px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }

  .from {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .mod {
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--tone-mod) 60%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--tone-mod) 12%, var(--surface));
    font-size: 13px;
    font-weight: 650;
    white-space: nowrap;
  }

  .plus,
  .arrow {
    color: var(--text-3);
  }

  .arrow {
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

  .details {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-3);
    font-size: 12.5px;
  }

  .details li + li::before {
    content: "·";
    margin: 0 8px 0 -10px;
  }

  .problems {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 6px 10px 6px 26px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

</style>
```

- [ ] **Step 2: The editor**

Create `web/src/behaviours/KeyOverrideEditor.svelte`:

```svelte
<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import KeycodeButton from "./KeycodeButton.svelte";
  import LayerChips from "./LayerChips.svelte";
  import ModToggles from "./ModToggles.svelte";
  import OptionChecks from "./OptionChecks.svelte";
  import { KEY_OVERRIDE_OPTIONS, type KeyOverrideDraft } from "./overrides";

  interface Props {
    index: number;
    draft: KeyOverrideDraft;
    layerCount: number;
    names: Names;
    /** the key override is set up on the keyboard: it can be removed */
    removable: boolean;
    canSave: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (change: Partial<KeyOverrideDraft>) => void;
    onpick: (part: "trigger" | "replacement") => void;
    onsave: () => void;
    oncancel: () => void;
    onremove: () => void;
  }

  let {
    index, draft, layerCount, names, removable, canSave, busy, onchange, onpick, onsave, oncancel, onremove,
  }: Props = $props();

  /** it needs something to trigger it before it is worth saving */
  const noTrigger = $derived(draft.trigger.kind === "none" && draft.triggerMods === 0);
</script>

<div class="editor">
  <div class="keys">
    <KeycodeButton id="key-override-{index}-trigger" label="Trigger" action={draft.trigger} {names} {busy}
      onpick={() => onpick("trigger")} />
    <span class="arrow" aria-hidden="true">→</span>
    <KeycodeButton label="Replacement" action={draft.replacement} {names} {busy} onpick={() => onpick("replacement")} />
  </div>

  <div class="mods">
    <ModToggles legend="Trigger modifiers" hint="Held with the trigger key to start it. Set on both sides, either one does."
      mask={draft.triggerMods} {busy} onchange={(triggerMods) => onchange({ triggerMods })} />
    <ModToggles legend="Blocking modifiers" hint="None of these may be held: holding one stops it (negative mods)."
      mask={draft.negativeModMask} {busy} onchange={(negativeModMask) => onchange({ negativeModMask })} />
    <ModToggles legend="Hidden modifiers" hint="Hidden from the computer while it sends the replacement (suppressed mods)."
      mask={draft.suppressedMods} {busy} onchange={(suppressedMods) => onchange({ suppressedMods })} />
  </div>

  <LayerChips mask={draft.layers} count={layerCount} {names} {busy} onchange={(layers) => onchange({ layers })} />

  <OptionChecks legend="Options" options={KEY_OVERRIDE_OPTIONS} value={draft.options} {busy}
    onchange={(options) => onchange({ options })} />

  <div class="foot">
    <Switch label={draft.enabled ? "On" : "Off: it does nothing until it is switched on"} checked={draft.enabled}
      {busy} onchange={(enabled) => onchange({ enabled })} />
    <span class="spacer"></span>
    {#if removable}
      <Button variant="danger" disabled={!canSave} aria-disabled={busy || undefined} onclick={onremove}>
        Remove
      </Button>
    {/if}
    {#if noTrigger}<span class="needs" id="key-override-{index}-needs">Choose a trigger key or modifiers</span>{/if}
    <Button aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
    <Button variant="primary" disabled={!canSave || noTrigger} aria-disabled={busy || undefined}
      aria-describedby={noTrigger ? `key-override-${index}-needs` : undefined} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 16px;
  }

  .keys {
    display: grid;
    grid-template-columns: minmax(0, 200px) auto minmax(0, 200px);
    justify-content: start;
    align-items: center;
    gap: 10px;
  }

  .arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  .mods {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
    gap: 14px 20px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  .needs {
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 3: The page**

Create `web/src/behaviours/KeyOverridesPage.svelte`:

```svelte
<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import { shownEntries } from "./entries";
  import KeyOverrideCard from "./KeyOverrideCard.svelte";
  import KeyOverrideEditor from "./KeyOverrideEditor.svelte";
  import {
    clearedKeyOverride, freeKeyOverride, keyOverrideIsSet, keyOverrideRequest, newKeyOverride, NO_KEY,
    type KeyOverrideDraft,
  } from "./overrides";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    /** the key override to show (from the address), or null */
    item: number | null;
  }

  let { model, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but the key override being
   * edited takes no change until it is done (a change made meanwhile would be lost when the save closes the editor) */
  const busy = $derived(keyboard.pending > 0);
  /** key overrides opened that would not show otherwise: a new one */
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.keyOverrides.length, (i) => keyOverrideIsSet(model.keyOverrides[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeKeyOverride(model.keyOverrides));
  const unshown = $derived(model.keyOverrides.length - shown.length);

  useTarget(() => (item === null ? null : `key-override-${item}-title`));

  /** the key override being edited: one at a time */
  let draft = $state<{ index: number; value: KeyOverrideDraft } | null>(null);

  // another keyboard (or none of the key override being edited): what was being edited or opened was the one before's
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    const gone = draft !== null && model.keyOverrides[draft.index] === undefined;
    untrack(() => {
      if (uid !== shownUid) {
        shownUid = uid;
        opened = [];
        draft = null;
        pickerOpen = false;
      } else if (gone) {
        draft = null;
      }
    });
  });

  function edit(index: number) {
    const override = model.keyOverrides[index];
    if (!override || busy) return;
    const { index: _, ...value } = override;
    // a new one starts as QMK's usual: on every layer, switched on
    draft = { index, value: keyOverrideIsSet(override) ? value : newKeyOverride(NO_KEY, model.layers.length) };
    void focusEditor(index);
  }

  /** The Edit button goes: the focus goes to the trigger, once it is drawn, after the card opened from the address
   * took the focus */
  async function focusEditor(index: number) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (draft?.index === index) document.getElementById(`key-override-${index}-trigger`)?.focus();
  }

  /** After the editor closes: the card's heading, or (the card went) the New key override button */
  async function focusCard(index: number) {
    await tick();
    (document.getElementById(`key-override-${index}-title`) ?? document.getElementById("new-key-override"))?.focus();
  }

  async function save(value: KeyOverrideDraft, action: string) {
    if (!draft || busy) return;
    const index = draft.index;
    if (await keyboard.setKeyOverride(index, keyOverrideRequest(value), action)) {
      if (draft?.index === index) draft = null;
      // removed: its card goes, unless the address names it
      if (!keyOverrideIsSet(model.keyOverrides[index])) opened = opened.filter((i) => i !== index);
      await focusCard(index);
    }
  }

  function cancel() {
    if (!draft || busy) return;
    const index = draft.index;
    draft = null;
    // a new one, never saved: its card goes
    if (!keyOverrideIsSet(model.keyOverrides[index])) opened = opened.filter((i) => i !== index);
    void focusCard(index);
  }

  function newOverride() {
    if (free === null || busy || draft !== null) return;
    opened = [...opened, free];
    // on the page shown: no step back, which would look like it did nothing
    router.go("key-overrides", free, { replace: true });
    edit(free);
  }

  // the keycode picker: the trigger or the replacement
  let pickerOpen = $state(false);
  let picking = $state<"trigger" | "replacement">("trigger");

  function pick(part: "trigger" | "replacement") {
    if (busy) return;
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="key-overrides-title">
  <PageHeader
    id="key-overrides-title"
    title="Key overrides"
    description="A key pressed with certain modifiers sends another key instead: Shift + Backspace sends Delete. Each one works on the layers you choose."
    note="Edit one, then Save to send it to the keyboard; Cancel leaves it as it was."
  >
    {#snippet action()}
      <Button id="new-key-override" variant="primary" disabled={!canEdit || free === null || draft !== null}
        aria-disabled={busy || undefined}
        title={free === null ? "Every key override is in use" : `Sets up key override ${free}`} onclick={newOverride}>
        New key override
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No key override is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    {@const override = model.keyOverrides[index]}
    <KeyOverrideCard
      {override}
      draft={draft?.index === index ? draft.value : null}
      layerCount={model.layers.length}
      {names}
      canEdit={canEdit && draft === null}
      {busy}
      target={index === item}
      onedit={() => edit(index)}
      editor={draft?.index === index ? editor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "key override is" : "key overrides are"} free, of {model.keyOverrides.length}.</p>
  {/if}
</section>

{#snippet editor()}
  {#if draft}
    <KeyOverrideEditor
      index={draft.index}
      draft={draft.value}
      layerCount={model.layers.length}
      {names}
      removable={keyOverrideIsSet(model.keyOverrides[draft.index])}
      canSave={canEdit}
      {busy}
      onchange={(change) => {
        if (draft && !busy) draft.value = { ...draft.value, ...change };
      }}
      onpick={pick}
      onsave={() => draft && void save(draft.value, "Saving the key override")}
      oncancel={cancel}
      onremove={() => void save(clearedKeyOverride(NO_KEY), "Removing the key override")}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="{picking === 'trigger' ? 'Trigger' : 'Replacement'} of key override {draft.index}"
    categories={keyboard.catalogue}
    current={draft.value[picking].code}
    {names}
    onpick={(_, d) => {
      if (draft && !busy) draft.value = { ...draft.value, [picking]: d };
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

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 5: Commit**

```bash
git add web/src/behaviours/KeyOverrideCard.svelte \
  web/src/behaviours/KeyOverrideEditor.svelte \
  web/src/behaviours/KeyOverridesPage.svelte
git commit -m "feat(web): the Key overrides page"
```

### Task 11: The Alt-repeat page

The same shape as the Key overrides page, for alt-repeat keys:
- **`AltRepeatCard.svelte`:** the id ("AR 0"), the sentence, the last key → the alt key as key faces, the allowed modifiers and the options set.
- **`AltRepeatEditor.svelte`:** the last key and the alt key (keycode buttons), the allowed modifiers, the options as checkboxes, and an on/off switch. Save is disabled until a last key is chosen; "Remove" saves the all-zero entry.
- **`AltRepeatPage.svelte`:** its description says what Repeat (`QK_REPEAT_KEY`) and Alt Repeat (`QK_ALT_REPEAT_KEY`) do, and a warning says when no key, tap dance or combo holds Alt Repeat, so the entries do nothing yet. Drafts, the picker, the focus and another keyboard are handled as on the Key overrides page.

**Files:**
- Create: `web/src/behaviours/AltRepeatCard.svelte`, `web/src/behaviours/AltRepeatEditor.svelte`, `web/src/behaviours/AltRepeatPage.svelte`

- [ ] **Step 1: The card**

Create `web/src/behaviours/AltRepeatCard.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AltRepeatKey, Described } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import {
    ALT_REPEAT_OPTIONS, altRepeatIsSet, altRepeatSentence, type AltRepeatDraft,
  } from "./overrides";
  import { replayed } from "./target.svelte";

  interface Props {
    entry: AltRepeatKey;
    /** while it is edited: what the editor holds */
    draft: AltRepeatDraft | null;
    names: Names;
    canEdit: boolean;
    /** a change is being saved: Edit keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** the editor, while it is edited */
    editor?: Snippet;
    onedit: () => void;
  }

  let { entry, draft, names, canEdit, busy, target, editor, onedit }: Props = $props();

  const headingId = $derived(`alt-repeat-${entry.index}-title`);
  const shown = $derived<AltRepeatDraft>(draft ?? entry);
  const sentence = $derived(altRepeatSentence(shown, names));
  const isNew = $derived(!altRepeatIsSet(entry));
  /** the options set, by their labels */
  const options = $derived(ALT_REPEAT_OPTIONS.filter((o) => shown.options & o.bit).map((o) => o.label));

  function face(d: Described) {
    const f = keyFace(d, names);
    return { tone: f.tone, text: d.kind === "none" ? "nothing" : f.main || d.code };
  }
  const from = $derived(face(shown.keycode));
  const to = $derived(face(shown.altKeycode));
  const both = $derived((shown.options & ALT_REPEAT_OPTIONS[1].bit) !== 0);
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing={draft !== null}
  class:off={!shown.enabled} id="alt-repeat-{entry.index}" aria-labelledby={headingId}>
  <EntryHead id="AR {entry.index}" {headingId} name={null} tone="override" {canEdit}>
    {#snippet actions()}
      {#if !shown.enabled && !isNew}<span class="state" title="Switched off: it does nothing until it is switched on">Off</span>{/if}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>
  {#if isNew && draft}
    <p class="new"><strong>New alt-repeat key:</strong> nothing is kept until you save it. Cancel, and it is gone.</p>
  {/if}

  {#if editor}
    {@render editor()}
  {:else}
    <div class="row" aria-hidden="true">
      <span class="out tone-{from.tone}" data-tone={from.tone} title={from.text}>{from.text}</span>
      <span class="arrow">{both ? "⇄" : "→"}</span>
      <span class="out tone-{to.tone}" data-tone={to.tone} title={to.text}>{to.text}</span>
    </div>
    {#if options.length > 0}
      <p class="details">{options.join(" · ")}</p>
    {/if}
  {/if}
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css) */
  .card {
    --card-accent: var(--accent);
  }

  .sentence {
    margin: 0;
    color: var(--text-2);
  }

  .off:not(.editing) .row {
    opacity: 0.55;
  }

  .state {
    align-self: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
  }

  .new {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 8px;
    background: var(--accent-weak);
    color: var(--text);
    font-size: 13px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
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

  .details {
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 2: The editor**

Create `web/src/behaviours/AltRepeatEditor.svelte`:

```svelte
<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import Switch from "../ui/Switch.svelte";
  import KeycodeButton from "./KeycodeButton.svelte";
  import ModToggles from "./ModToggles.svelte";
  import OptionChecks from "./OptionChecks.svelte";
  import { ALT_REPEAT_OPTIONS, type AltRepeatDraft } from "./overrides";

  interface Props {
    index: number;
    draft: AltRepeatDraft;
    names: Names;
    /** the alt-repeat key is set up on the keyboard: it can be removed */
    removable: boolean;
    canSave: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (change: Partial<AltRepeatDraft>) => void;
    onpick: (part: "keycode" | "altKeycode") => void;
    onsave: () => void;
    oncancel: () => void;
    onremove: () => void;
  }

  let { index, draft, names, removable, canSave, busy, onchange, onpick, onsave, oncancel, onremove }: Props = $props();

  const noKey = $derived(draft.keycode.kind === "none");
</script>

<div class="editor">
  <div class="top">
    <div class="keys">
      <KeycodeButton id="alt-repeat-{index}-keycode" label="Last key" action={draft.keycode} {names} {busy}
        onpick={() => onpick("keycode")} />
      <span class="arrow" aria-hidden="true">→</span>
      <KeycodeButton label="Alt key" action={draft.altKeycode} {names} {busy} onpick={() => onpick("altKeycode")} />
    </div>
    <ModToggles legend="Allowed modifiers"
      hint="It also counts when these were held with the last key. With none, only the key pressed alone counts."
      mask={draft.allowedMods} {busy} onchange={(allowedMods) => onchange({ allowedMods })} />
  </div>

  <OptionChecks legend="Options" options={ALT_REPEAT_OPTIONS} value={draft.options} {busy}
    onchange={(options) => onchange({ options })} />

  <div class="foot">
    <Switch label={draft.enabled ? "On" : "Off: it does nothing until it is switched on"} checked={draft.enabled}
      {busy} onchange={(enabled) => onchange({ enabled })} />
    <span class="spacer"></span>
    {#if removable}
      <Button variant="danger" disabled={!canSave} aria-disabled={busy || undefined} onclick={onremove}>Remove</Button>
    {/if}
    {#if noKey}<span class="needs" id="alt-repeat-{index}-needs">Choose the last key</span>{/if}
    <Button aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
    <Button variant="primary" disabled={!canSave || noKey} aria-disabled={busy || undefined}
      aria-describedby={noKey ? `alt-repeat-${index}-needs` : undefined} onclick={onsave}>Save</Button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 16px;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 16px 32px;
  }

  .keys {
    display: grid;
    grid-template-columns: minmax(0, 170px) auto minmax(0, 170px);
    justify-content: start;
    align-items: center;
    gap: 10px;
    flex: 1 1 360px;
    max-width: 400px;
  }

  .arrow {
    color: var(--text-3);
    font-size: 20px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  .needs {
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 3: The page**

Create `web/src/behaviours/AltRepeatPage.svelte`:

```svelte
<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import AltRepeatCard from "./AltRepeatCard.svelte";
  import AltRepeatEditor from "./AltRepeatEditor.svelte";
  import { shownEntries } from "./entries";
  import {
    altRepeatIsSet, altRepeatRequest, clearedAltRepeat, freeAltRepeat, newAltRepeat, NO_KEY, pressable,
    type AltRepeatDraft,
  } from "./overrides";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    /** the alt-repeat key to show (from the address), or null */
    item: number | null;
  }

  let { model, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but the alt-repeat key being
   * edited takes no change until it is done */
  const busy = $derived(keyboard.pending > 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.altRepeatKeys.length, (i) => altRepeatIsSet(model.altRepeatKeys[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeAltRepeat(model.altRepeatKeys));
  const unshown = $derived(model.altRepeatKeys.length - shown.length);
  /** the entries only matter with Alt Repeat somewhere it can be pressed */
  const noAltRepeatKey = $derived(!pressable("QK_ALT_REPEAT_KEY", model));

  useTarget(() => (item === null ? null : `alt-repeat-${item}-title`));

  let draft = $state<{ index: number; value: AltRepeatDraft } | null>(null);

  // another keyboard (or none of the entry being edited): what was being edited or opened was the one before's
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    const gone = draft !== null && model.altRepeatKeys[draft.index] === undefined;
    untrack(() => {
      if (uid !== shownUid) {
        shownUid = uid;
        opened = [];
        draft = null;
        pickerOpen = false;
      } else if (gone) {
        draft = null;
      }
    });
  });

  function edit(index: number) {
    const entry = model.altRepeatKeys[index];
    if (!entry || busy) return;
    const { index: _, ...value } = entry;
    draft = { index, value: altRepeatIsSet(entry) ? value : newAltRepeat(NO_KEY) };
    void focusEditor(index);
  }

  /** The Edit button goes: the focus goes to the last key, once it is drawn, after the card opened from the address
   * took the focus */
  async function focusEditor(index: number) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (draft?.index === index) document.getElementById(`alt-repeat-${index}-keycode`)?.focus();
  }

  async function focusCard(index: number) {
    await tick();
    (document.getElementById(`alt-repeat-${index}-title`) ?? document.getElementById("new-alt-repeat"))?.focus();
  }

  async function save(value: AltRepeatDraft, action: string) {
    if (!draft || busy) return;
    const index = draft.index;
    if (await keyboard.setAltRepeatKey(index, altRepeatRequest(value), action)) {
      if (draft?.index === index) draft = null;
      if (!altRepeatIsSet(model.altRepeatKeys[index])) opened = opened.filter((i) => i !== index);
      await focusCard(index);
    }
  }

  function cancel() {
    if (!draft || busy) return;
    const index = draft.index;
    draft = null;
    if (!altRepeatIsSet(model.altRepeatKeys[index])) opened = opened.filter((i) => i !== index);
    void focusCard(index);
  }

  function newEntry() {
    if (free === null || busy || draft !== null) return;
    opened = [...opened, free];
    router.go("alt-repeat", free, { replace: true });
    edit(free);
  }

  let pickerOpen = $state(false);
  let picking = $state<"keycode" | "altKeycode">("keycode");

  function pick(part: "keycode" | "altKeycode") {
    if (busy) return;
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="alt-repeat-title">
  <PageHeader
    id="alt-repeat-title"
    title="Alt-repeat"
    description="Repeat (QK_REPEAT_KEY) sends the last key again; Alt Repeat (QK_ALT_REPEAT_KEY) sends its opposite. Each entry here says what Alt Repeat sends after a key, on top of the firmware's own pairs."
    note="Edit one, then Save to send it to the keyboard; Cancel leaves it as it was."
  >
    {#snippet action()}
      <Button id="new-alt-repeat" variant="primary" disabled={!canEdit || free === null || draft !== null}
        aria-disabled={busy || undefined}
        title={free === null ? "Every alt-repeat key is in use" : `Sets up alt-repeat key ${free}`} onclick={newEntry}>
        New alt-repeat key
      </Button>
    {/snippet}
  </PageHeader>

  {#if noAltRepeatKey}
    <p class="warning" role="note">
      No key has Alt Repeat (<code>QK_ALT_REPEAT_KEY</code>), so these do nothing yet: put it on a key in the Keymap.
    </p>
  {/if}

  {#if shown.length === 0}
    <p class="empty">No alt-repeat key is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    <AltRepeatCard
      entry={model.altRepeatKeys[index]}
      draft={draft?.index === index ? draft.value : null}
      {names}
      canEdit={canEdit && draft === null}
      {busy}
      target={index === item}
      onedit={() => edit(index)}
      editor={draft?.index === index ? editor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "alt-repeat key is" : "alt-repeat keys are"} free, of {model.altRepeatKeys.length}.</p>
  {/if}
</section>

{#snippet editor()}
  {#if draft}
    <AltRepeatEditor
      index={draft.index}
      draft={draft.value}
      {names}
      removable={altRepeatIsSet(model.altRepeatKeys[draft.index])}
      canSave={canEdit}
      {busy}
      onchange={(change) => {
        if (draft && !busy) draft.value = { ...draft.value, ...change };
      }}
      onpick={pick}
      onsave={() => draft && void save(draft.value, "Saving the alt-repeat key")}
      oncancel={cancel}
      onremove={() => void save(clearedAltRepeat(NO_KEY), "Removing the alt-repeat key")}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="{picking === 'keycode' ? 'Last key' : 'Alt key'} of alt-repeat key {draft.index}"
    categories={keyboard.catalogue}
    current={draft.value[picking].code}
    {names}
    onpick={(_, d) => {
      if (draft && !busy) draft.value = { ...draft.value, [picking]: d };
    }}
  />
{/if}

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .warning {
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
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

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 5: Commit**

```bash
git add web/src/behaviours/AltRepeatCard.svelte \
  web/src/behaviours/AltRepeatEditor.svelte \
  web/src/behaviours/AltRepeatPage.svelte
git commit -m "feat(web): the Alt-repeat page"
```

### Task 12: The QMK settings form's groups, values and changes

`settings/qmkSettings.ts`, the form's logic, as Qt's `qmk_settings.py` does it:
- **`settingGroups`:** the tabs of `qmk_settings.json`, each with only the settings the keyboard has, in the definitions' order; a tab with none is left out.
- **Values:** `valuesOf` (by qsid); a boolean field is one bit of its setting (`isOn`, `withBit`). Bits no field covers are kept as they are (Qt's form clears them).
- **`numberProblem`:** why a number typed into an integer field can't be saved ("Not a whole number from 0 to 10000."), or null. What the keyboard holds is always fine, as the server sees it.
- **Changes:** `changed` (the settings whose value differs from the keyboard's, in qsid order), `fieldChanged`, `groupChanges`, `changeCount` ("1 change", "3 changes"), and `settingChanges`, a setting's change field by field ("Tapping Term: 200 → 250"), which the layout file's preview uses.

`settings/definitions.ts` reads the definitions once (they are the same for every keyboard); a failed read is tried again the next time.

**Files:**
- Create: `web/src/settings/qmkSettings.ts`, `web/src/settings/definitions.ts`
- Test: `web/src/settings/qmkSettings.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/settings/qmkSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SettingField, SettingsDefinitions } from "../api/types";
import {
  changeCount, changed, fieldChanged, fieldText, groupChanges, isOn, numberProblem, settingChanges, settingGroups,
  valuesOf, withBit,
} from "./qmkSettings";

const bool = (title: string, qsid: number, bit?: number): SettingField =>
  ({ type: "boolean", title, qsid, bit: bit ?? null, width: bit === undefined ? null : 4, min: null, max: null });
const int = (title: string, qsid: number, min: number, max: number): SettingField =>
  ({ type: "integer", title, qsid, bit: null, width: 2, min, max });

/** a part of qmk_settings.json */
const DEFINITIONS: SettingsDefinitions = {
  tabs: [
    { name: "Magic", fields: [bool("Swap Caps Lock and Left Control", 21, 0), bool("Treat Caps Lock as Control", 21, 1),
      bool("Enable N-key rollover", 21, 7)] },
    { name: "Grave Escape", fields: [bool("Always send Escape if Alt is pressed", 1, 0)] },
    { name: "Tap-Hold", fields: [int("Tapping Term", 7, 0, 10000), bool("Permissive Hold", 8, 0),
      bool("Permissive Hold", 22), int("Quick Tap Term", 25, 0, 10000)] },
  ],
};
const MAGIC = DEFINITIONS.tabs[0].fields;
const TERM = DEFINITIONS.tabs[2].fields[0];

describe("settingGroups", () => {
  it("keeps the groups and settings the keyboard has, in the definitions' order", () => {
    const groups = settingGroups(DEFINITIONS, [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }, { qsid: 21, value: 0 }]);
    expect(groups.map((g) => [g.name, g.fields.map((f) => f.qsid)])).toEqual([
      ["Magic", [21, 21, 21]], ["Tap-Hold", [7, 22]],
    ]);
  });
});

describe("boolean fields", () => {
  it("are one bit of their setting", () => {
    expect(isOn(MAGIC[1], 0b10)).toBe(true);
    expect(isOn(MAGIC[0], 0b10)).toBe(false);
    expect(isOn(MAGIC[2], 0x80)).toBe(true);
  });

  it("switch their bit and keep the others, those no field covers too", () => {
    expect(withBit(MAGIC[0], 0b10, true)).toBe(0b11);
    expect(withBit(MAGIC[1], 0b11, false)).toBe(0b01);
    expect(withBit(MAGIC[1], 0b10, true)).toBe(0b10);
    expect(withBit(MAGIC[0], 0x400, true)).toBe(0x401); // bit 10: Qt's form would clear it
  });

  it("read in words", () => {
    expect(fieldText(MAGIC[2], 0x80)).toBe("on");
    expect(fieldText(MAGIC[0], 0x80)).toBe("off");
    expect(fieldText(TERM, 180)).toBe("180");
  });
});

describe("numberProblem", () => {
  it("takes a whole number in the field's range", () => {
    expect(numberProblem(TERM, "250", 200)).toBeNull();
    expect(numberProblem(TERM, " 0 ", 200)).toBeNull();
    expect(numberProblem(TERM, "10000", 200)).toBeNull();
  });

  it("refuses anything else", () => {
    for (const text of ["", "abc", "1.5", "-1", "10001", "1e3"]) {
      expect(numberProblem(TERM, text, 200), text).toBe("Not a whole number from 0 to 10000.");
    }
  });

  it("takes what the keyboard holds, even beyond the range", () => {
    expect(numberProblem(TERM, "20000", 20000)).toBeNull();
  });
});

describe("changes", () => {
  const held = valuesOf([{ qsid: 7, value: 200 }, { qsid: 21, value: 0 }, { qsid: 22, value: 0 }]);

  it("are the settings whose value differs, in qsid order", () => {
    const form = new Map(held).set(21, 0b10).set(7, 250).set(22, 0);
    expect(changed(held, form)).toEqual([{ qsid: 7, value: 250 }, { qsid: 21, value: 2 }]);
    expect(changed(held, held)).toEqual([]);
  });

  it("are counted by field, a boolean only when its own bit changed", () => {
    const form = new Map(held).set(21, 0b10).set(7, 250);
    expect(fieldChanged(MAGIC[0], held, form)).toBe(false);
    expect(fieldChanged(MAGIC[1], held, form)).toBe(true);
    expect(fieldChanged(TERM, held, form)).toBe(true);
    expect(groupChanges({ name: "Magic", fields: MAGIC }, held, form)).toBe(1);
    expect(changeCount(1)).toBe("1 change");
    expect(changeCount(3)).toBe("3 changes");
  });

  it("are told field by field, for a layout file's preview", () => {
    expect(settingChanges(DEFINITIONS, 7, 200, 250)).toEqual(["Tapping Term: 200 → 250"]);
    expect(settingChanges(DEFINITIONS, 21, 0b10, 0b1)).toEqual([
      "Swap Caps Lock and Left Control: off → on", "Treat Caps Lock as Control: on → off",
    ]);
    expect(settingChanges(DEFINITIONS, 30, 1, 2)).toEqual(["Setting 30: 1 → 2"]);
    expect(settingChanges(null, 7, 1, 2)).toEqual(["Setting 7: 1 → 2"]);
  });
});
```

```bash
cd web && npx vitest run src/settings/qmkSettings.test.ts
```

Expected: `Cannot find module './qmkSettings'`.

- [ ] **Step 2: The form's logic, and the definitions read once**

Create `web/src/settings/qmkSettings.ts`:

```ts
// The QMK settings form: the groups qmk_settings.json defines, with only the settings the keyboard has; each field's
// value (a boolean is one bit of its setting), what changed, and why a number can't be saved. As the Qt app does it,
// but a setting's bits no field covers are kept as they are (Qt's form clears them).
import type { QmkSetting, SettingField, SettingsDefinitions } from "../api/types";

export interface SettingGroup {
  name: string;
  fields: SettingField[];
}

/** The groups that have a setting the keyboard has, with only those settings, in the definitions' order */
export function settingGroups(definitions: SettingsDefinitions, settings: QmkSetting[]): SettingGroup[] {
  const have = new Set(settings.map((s) => s.qsid));
  return definitions.tabs
    .map((tab) => ({ name: tab.name, fields: tab.fields.filter((f) => have.has(f.qsid)) }))
    .filter((group) => group.fields.length > 0);
}

/** Settings by qsid */
export type Values = ReadonlyMap<number, number>;

export function valuesOf(settings: QmkSetting[]): Map<number, number> {
  return new Map(settings.map((s) => [s.qsid, s.value]));
}

function bitOf(field: SettingField): number {
  return 2 ** (field.bit ?? 0);
}

/** Whether a boolean field is on in its setting's value */
export function isOn(field: SettingField, value: number): boolean {
  return Math.floor(value / bitOf(field)) % 2 === 1;
}

/** The setting's value with a boolean field switched on or off; its other bits stay */
export function withBit(field: SettingField, value: number, on: boolean): number {
  return isOn(field, value) === on ? value : on ? value + bitOf(field) : value - bitOf(field);
}

/** Why a number typed into an integer field can't be saved, or null. What the keyboard holds is always fine (firmware
 * defaults can lie outside the range), as the server sees it. */
export function numberProblem(field: SettingField, text: string, held: number | undefined): string | null {
  const range = `a whole number from ${field.min ?? 0} to ${field.max ?? 0}`;
  if (!/^\s*\d+\s*$/.test(text)) return `Not ${range}.`;
  const value = Number(text);
  if (value === held) return null;
  return value < (field.min ?? 0) || value > (field.max ?? 0) ? `Not ${range}.` : null;
}

/** The settings whose value in the form differs from the keyboard's, in qsid order */
export function changed(held: Values, form: Values): QmkSetting[] {
  return [...form]
    .filter(([qsid, value]) => held.has(qsid) && held.get(qsid) !== value)
    .sort(([a], [b]) => a - b)
    .map(([qsid, value]) => ({ qsid, value }));
}

/** Whether a field shows another value in the form than the keyboard holds */
export function fieldChanged(field: SettingField, held: Values, form: Values): boolean {
  const before = held.get(field.qsid);
  const now = form.get(field.qsid);
  if (before === undefined || now === undefined || before === now) return false;
  return field.type === "boolean" ? isOn(field, before) !== isOn(field, now) : true;
}

/** How many fields of a group were changed */
export function groupChanges(group: SettingGroup, held: Values, form: Values): number {
  return group.fields.filter((f) => fieldChanged(f, held, form)).length;
}

/** "1 change", "3 changes" */
export function changeCount(n: number): string {
  return `${n} ${n === 1 ? "change" : "changes"}`;
}

/** A field's value in words, for lists of changes: "on", "off", "200" */
export function fieldText(field: SettingField, value: number): string {
  return field.type === "boolean" ? (isOn(field, value) ? "on" : "off") : String(value);
}

/** The changes from one value of a setting to another, field by field: "Tapping Term: 200 → 250", "Swap Caps Lock and
 * Left Control: off → on"; "Setting 30: 1 → 2" for one the definitions don't have */
export function settingChanges(definitions: SettingsDefinitions | null, qsid: number, before: number,
  after: number): string[] {
  const fields = definitions?.tabs.flatMap((t) => t.fields).filter((f) => f.qsid === qsid) ?? [];
  if (fields.length === 0) return [`Setting ${qsid}: ${before} → ${after}`];
  return fields
    .filter((f) => fieldText(f, before) !== fieldText(f, after))
    .map((f) => `${f.title}: ${fieldText(f, before)} → ${fieldText(f, after)}`);
}
```

Create `web/src/settings/definitions.ts`:

```ts
// The QMK settings Vial knows (qmk_settings.json): the same for every keyboard, so read once.
import { api } from "../api/api";
import type { SettingsDefinitions } from "../api/types";

let cached: Promise<SettingsDefinitions> | null = null;

/** The definitions, read from the server the first time; a failed read is tried again next time */
export function settingDefinitions(): Promise<SettingsDefinitions> {
  cached ??= api.settingDefinitions().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
```

```bash
cd web && npx vitest run src/settings/qmkSettings.test.ts
```

Expected: `Tests  10 passed (10)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  36 passed (36)` and `Tests  585 passed (585)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/settings/definitions.ts \
  web/src/settings/qmkSettings.test.ts \
  web/src/settings/qmkSettings.ts
git commit -m "feat(web): the QMK settings form's groups, values and changes"
```

### Task 13: The QMK settings page, and a confirmation dialog

- **`ui/ConfirmDialog.svelte`:** a modal `<dialog>` that asks before something that can't be undone. Cancel has the focus. Confirm runs `onconfirm` and closes only when it succeeds; Esc and Cancel wait while it runs. `onclose` lets the page give the focus back to what opened it.
- **`settings/SettingRow.svelte`:** one field. A boolean is a switch; an integer is a number box with its range beside it, and a problem in red under it. A changed field has a bar and says "changed".
- **`settings/SettingsPage.svelte`:** the groups of the keyboard's settings, two columns of switches where there is room. The form keeps the edits apart from what the keyboard holds, so a reload or another keyboard shows at once what it holds; Undo drops the edits. A sticky bar at the bottom says how many changes aren't saved, or why a number can't be, with Undo and Save. Save sends only the changed settings (`keyboard.setSettings`). "Reset to defaults…" asks in the dialog first (`keyboard.resetSettings`). When the definitions can't be read, the page says so, with "Try again".

**Files:**
- Create: `web/src/ui/ConfirmDialog.svelte`, `web/src/settings/SettingRow.svelte`, `web/src/settings/SettingsPage.svelte`

- [ ] **Step 1: The confirmation dialog**

Create `web/src/ui/ConfirmDialog.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";

  interface Props {
    /** whether it shows */
    open: boolean;
    title: string;
    message: string;
    /** the confirm button's text: "Reset" */
    confirmLabel: string;
    /** what confirming does can't be undone: the confirm button is red */
    danger?: boolean;
    /** resolves to whether it worked: the dialog then closes, or stays open (a toast says why) */
    onconfirm: () => Promise<boolean>;
    /** closed, confirmed or not: the caller gives the focus back to whatever opened it */
    onclose: () => void;
  }

  let { open, title, message, confirmLabel, danger = false, onconfirm, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let working = $state(false);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      working = false;
      dialog.showModal();
      // the safe choice has the focus: Enter doesn't confirm by accident
      void tick().then(() => cancelButton?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function confirm() {
    if (working) return;
    working = true;
    const done = await onconfirm();
    working = false;
    if (done) dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-message"
  oncancel={(event) => {
    // Esc waits for what is being done, as Cancel does
    if (working) event.preventDefault();
  }}
  onclose={onclose}
>
  <h2 id="{uid}-title">{title}</h2>
  <p id="{uid}-message">{message}</p>
  <div class="buttons">
    <!-- a plain button: Button doesn't hand out its element, and this one takes the focus first -->
    <button bind:this={cancelButton} type="button" class="cancel" aria-disabled={working || undefined}
      onclick={() => {
        if (!working) dialog?.close();
      }}>Cancel</button>
    <Button variant={danger ? "danger" : "primary"} aria-disabled={working || undefined} onclick={() => void confirm()}>
      {working ? `${confirmLabel}…` : confirmLabel}
    </Button>
  </div>
</dialog>

<style>
  .confirm-dialog {
    width: min(440px, calc(100vw - 32px));
    max-width: none;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .confirm-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }

  p {
    margin: 0;
    color: var(--text-2);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .cancel {
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--surface-2);
  }

  .cancel[aria-disabled="true"] {
    cursor: progress;
  }
</style>
```

- [ ] **Step 2: One setting**

Create `web/src/settings/SettingRow.svelte`:

```svelte
<script lang="ts">
  import type { SettingField } from "../api/types";
  import Switch from "../ui/Switch.svelte";
  import { isOn } from "./qmkSettings";

  interface Props {
    field: SettingField;
    /** the setting's value in the form */
    value: number;
    /** what an integer field's box holds, while it differs from value (being typed, or not a number it takes) */
    text: string | null;
    /** why the number typed can't be saved, or null */
    problem: string | null;
    /** the form shows another value than the keyboard holds */
    changed: boolean;
    disabled: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    /** a boolean switched */
    ontoggle: (on: boolean) => void;
    /** a number typed */
    ontext: (text: string) => void;
  }

  let { field, value, text, problem, changed, disabled, busy, ontoggle, ontext }: Props = $props();
  const uid = $props.id();
</script>

<div class="row" class:changed class:invalid={problem !== null} class:wide={field.type === "integer"}>
  {#if field.type === "boolean"}
    <Switch id="{uid}-input" label={field.title} checked={isOn(field, value)} {disabled} {busy}
      describedby={changed ? `${uid}-changed` : undefined} onchange={ontoggle} />
  {:else}
    <label class="title" for="{uid}-input">{field.title}</label>
    <span class="number">
      <input
        id="{uid}-input"
        type="text"
        inputmode="numeric"
        value={text ?? String(value)}
        {disabled}
        readonly={busy}
        aria-invalid={problem !== null}
        aria-describedby="{uid}-range{problem ? ` ${uid}-problem` : ''}{changed ? ` ${uid}-changed` : ''}"
        oninput={(e) => ontext(e.currentTarget.value)}
      />
      <span class="range" id="{uid}-range">{field.min ?? 0}–{field.max ?? 0}</span>
    </span>
    {#if problem}<p class="problem" id="{uid}-problem">{problem}</p>{/if}
  {/if}
  {#if changed}<span class="mark" id="{uid}-changed">changed</span>{/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 14px;
    min-height: 40px;
    padding: 6px 12px 6px 14px;
    border-radius: 8px;
  }

  /* a number's title can be long: its row takes the whole width of the group */
  .row.wide {
    grid-column: 1 / -1;
  }

  .row.changed {
    background: var(--accent-weak);
  }

  /* a bar on the left edge marks a changed setting */
  .row.changed::before {
    content: "";
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 3px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .title {
    flex: 1 1 240px;
    min-width: 0;
    font-size: 13px;
    font-weight: 550;
  }

  .number {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  input {
    width: 88px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface-2);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  input[aria-invalid="true"] {
    border-color: var(--danger);
  }

  .range {
    min-width: 72px;
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .problem {
    flex-basis: 100%;
    margin: 0;
    color: var(--danger);
    font-size: 12.5px;
    text-align: right;
  }

  .mark {
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 650;
  }

  /* a switch's row: the label is the switch's own, the mark goes at the end */
  .row :global(.switch) {
    flex: 1 1 auto;
  }
</style>
```

- [ ] **Step 3: The page**

Create `web/src/settings/SettingsPage.svelte`:

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import { causeMessage } from "../api/errors";
  import type { KeyboardModel, SettingField, SettingsDefinitions } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import { settingDefinitions } from "./definitions";
  import {
    changeCount, changed, fieldChanged, groupChanges, numberProblem, settingGroups, valuesOf, withBit,
  } from "./qmkSettings";
  import SettingRow from "./SettingRow.svelte";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but take nothing until it
   * is done */
  const busy = $derived(keyboard.pending > 0);

  let definitions = $state.raw<SettingsDefinitions | null>(null);
  let loadProblem = $state<string | null>(null);

  function loadDefinitions() {
    loadProblem = null;
    settingDefinitions().then(
      (d) => (definitions = d),
      (error: unknown) => (loadProblem = causeMessage(error)),
    );
  }
  $effect(() => untrack(loadDefinitions));

  const groups = $derived(definitions ? settingGroups(definitions, model.settings) : []);
  /** what the keyboard holds */
  const held = $derived(valuesOf(model.settings));
  /** the values changed in the form, by qsid (a boolean changes a bit of its setting's value) */
  let edits = $state<Record<number, number>>({});
  /** what the number boxes hold while it isn't the value: being typed, or not a number they take */
  let texts = $state<Record<number, string>>({});
  /** the form: what the keyboard holds, with the changes made here */
  const form = $derived(new Map([...held, ...Object.entries(edits).map(([q, v]) => [Number(q), v] as const)]));
  const changes = $derived(changed(held, form));
  const problems = $derived(groups.flatMap((g) => g.fields)
    .filter((f) => f.type === "integer" && texts[f.qsid] !== undefined)
    .map((f) => ({ qsid: f.qsid, problem: numberProblem(f, texts[f.qsid], held.get(f.qsid)) }))
    .filter((p) => p.problem !== null));
  const blocked = $derived(problems.length > 0);
  /** nothing to undo */
  const idle = $derived(changes.length === 0 && Object.keys(texts).length === 0);

  // another keyboard: the changes were for the one before
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    untrack(() => {
      if (uid === shownUid) return;
      shownUid = uid;
      edits = {};
      texts = {};
    });
  });

  function toggle(field: SettingField, on: boolean) {
    if (busy) return;
    const value = form.get(field.qsid);
    if (value !== undefined) edits[field.qsid] = withBit(field, value, on);
  }

  function type(field: SettingField, text: string) {
    texts[field.qsid] = text;
    if (numberProblem(field, text, held.get(field.qsid)) === null) edits[field.qsid] = Number(text);
  }

  function undo() {
    if (busy) return;
    edits = {};
    texts = {};
  }

  async function save() {
    if (busy || blocked || changes.length === 0) return;
    const sent = changes;
    await keyboard.setSettings(sent);
    // what the keyboard took is what it holds now: those changes are done (a failed one stays, and says so)
    for (const { qsid, value } of sent) {
      if (held.get(qsid) === value && edits[qsid] === value) {
        delete edits[qsid];
        delete texts[qsid];
      }
    }
  }

  let confirming = $state(false);
</script>

<section class="page" aria-labelledby="settings-title">
  <PageHeader
    id="settings-title"
    title="Settings"
    description="QMK's own settings, kept on the keyboard: tap-hold timing, Auto Shift, one-shot keys, mouse keys and more. Only those this keyboard's firmware has are shown."
    note="Change what you like, then Save sends the changes to the keyboard; Undo puts back what it holds."
  >
    {#snippet action()}
      <Button id="reset-settings" variant="danger" disabled={!canEdit || groups.length === 0}
        aria-disabled={busy || undefined} onclick={() => {
          if (!busy) confirming = true;
        }}>
        Reset to defaults…
      </Button>
    {/snippet}
  </PageHeader>

  {#if loadProblem}
    <p class="problem" role="alert">
      The list of settings couldn't be read: {loadProblem}
      <Button size="sm" onclick={loadDefinitions}>Try again</Button>
    </p>
  {:else if !definitions}
    <p class="loading" aria-busy="true">Reading the settings…</p>
  {:else}
    {#each groups as group (group.name)}
      {@const count = groupChanges(group, held, form)}
      {@const headingId = `settings-${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      <section class="group" aria-labelledby={headingId}>
        <h2 id={headingId}>
          {group.name}
          {#if count > 0}<span class="count">{changeCount(count)}</span>{/if}
        </h2>
        <div class="fields">
          {#each group.fields as field, i (`${field.qsid}:${field.bit ?? i}`)}
            {@const value = form.get(field.qsid) ?? 0}
            <SettingRow
              {field}
              {value}
              text={field.type === "integer" ? (texts[field.qsid] ?? null) : null}
              problem={field.type === "integer" ? (problems.find((p) => p.qsid === field.qsid)?.problem ?? null) : null}
              changed={fieldChanged(field, held, form) && !(field.type === "integer" && texts[field.qsid] !== undefined &&
                problems.some((p) => p.qsid === field.qsid))}
              disabled={!canEdit}
              {busy}
              ontoggle={(on) => toggle(field, on)}
              ontext={(text) => type(field, text)}
            />
          {/each}
        </div>
      </section>
    {/each}

    <div class="savebar">
      <span class="status" role="status">
        {#if blocked}
          A number can't be saved: see the field marked in red.
        {:else if changes.length > 0}
          {changeCount(changes.length)} not saved yet
        {:else}
          No changes: the form shows what the keyboard holds.
        {/if}
      </span>
      <span class="spacer"></span>
      <!-- with nothing to undo or save they look disabled, but keep the focus (Save, once it has saved) -->
      <Button class={idle ? "idle" : undefined} aria-disabled={busy || idle || undefined} disabled={!canEdit}
        onclick={undo}>Undo</Button>
      <Button class={blocked || changes.length === 0 ? "idle" : undefined} variant="primary" disabled={!canEdit}
        aria-disabled={busy || blocked || changes.length === 0 || undefined} onclick={() => void save()}>Save</Button>
    </div>
  {/if}
</section>

<ConfirmDialog
  open={confirming}
  title="Reset every setting?"
  message="All of this keyboard's QMK settings go back to its firmware's defaults. Changes not saved here are dropped too."
  confirmLabel="Reset"
  danger
  onconfirm={async () => {
    const done = await keyboard.resetSettings();
    if (done) {
      edits = {};
      texts = {};
    }
    return done;
  }}
  onclose={() => {
    confirming = false;
    document.getElementById("reset-settings")?.focus();
  }}
/>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .group {
    min-width: 0;
    padding: 12px 10px 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 6px 6px;
    font-size: 15px;
  }

  .count {
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
  }

  /* switches side by side where there is room; numbers take a row each (SettingRow) */
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 2px 8px;
  }

  .problem,
  .loading {
    margin: 0;
    color: var(--text-2);
  }

  .problem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--danger);
  }

  /* Save and Undo stay in sight at the window's bottom */
  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    background: var(--surface);
    box-shadow: 0 -4px 12px rgb(16 24 40 / 8%);
  }

  .status {
    color: var(--text-2);
    font-size: 13px;
  }

  .spacer {
    flex: 1;
  }

  .savebar :global(.btn.idle[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }
</style>
```

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 5: Commit**

```bash
git add web/src/settings/SettingRow.svelte \
  web/src/settings/SettingsPage.svelte \
  web/src/ui/ConfirmDialog.svelte
git commit -m "feat(web): the QMK settings page, and a confirmation dialog"
```

### Task 14: What the keyboard is, and what a layout file changes, in words

- **`about/about.ts`:** `aboutFacts` gives what Qt's "About keyboard" dialog says, in three groups: the keyboard (name, ID, protocols, matrix, keys and encoders, layers), memory and entries (macros and their memory, delays and two-byte keycodes in macros, tap dances, combos, key overrides, alt-repeat keys, QMK settings) and features (Caps Word, Layer Lock, Repeat Key, Persistent default layer, and any other the firmware reports). A missing one says why, as Qt does: "no (the Vial firmware is too old)" or "no (turned off in the firmware)". `aboutText` is all of it as text, to paste into a bug report.
- **`about/layoutFile.ts`:** `previewSections` turns the server's preview into one section per kind of change (Decisions, 3), with `LISTED` (5) changes in words and "and N more". Keys and encoders are named by their position on the drawing; layout options by their labels and choices (`layoutOptionChanges`); tap dances, key overrides and alt-repeat keys by their sentences; macros by their name and steps; settings field by field. `unchangedSections` lists what the keyboard has that the file leaves as it is, `changeTotal` counts the changes, and `layoutFileName` names a file when the server gives no name.

**Files:**
- Create: `web/src/about/about.ts`, `web/src/about/layoutFile.ts`
- Test: `web/src/about/about.test.ts` (new), `web/src/about/layoutFile.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/about/about.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { simulatedCorne } from "../analysis/testing";
import type { KeyboardModel } from "../api/types";
import { aboutFacts, aboutText } from "./about";

function corne(change: Partial<KeyboardModel> = {}): KeyboardModel {
  return {
    ...simulatedCorne(), uid: "5EEDC0DE00420042", features: ["caps_word", "layer_lock", "persistent_default_layer"],
    settings: [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }], ...change,
  };
}

const value = (model: KeyboardModel, label: string) =>
  aboutFacts(model).flatMap((g) => g.facts).find((f) => f.label === label)?.value;

describe("aboutFacts", () => {
  it("says what Qt's About keyboard says", () => {
    const model = corne();
    expect(aboutFacts(model).map((g) => g.title)).toEqual(["Keyboard", "Memory and entries", "Features"]);
    expect(value(model, "Name")).toBe("Test Corne");
    expect(value(model, "Keyboard ID")).toBe("5EEDC0DE00420042");
    expect(value(model, "Protocols")).toBe("VIA 9, Vial 6");
    expect(value(model, "Matrix")).toBe("8 rows × 6 columns");
    expect(value(model, "Keys")).toBe("42");
    expect(value(model, "Layers")).toBe("4");
    expect(value(model, "Macros")).toBe("3, sharing 900 bytes (0 used)");
    expect(value(model, "Delays in macros")).toBe("yes");
    expect(value(model, "Tap dances")).toBe("3");
    expect(value(model, "QMK settings")).toBe("2");
    expect(value(model, "Caps Word")).toBe("yes");
    expect(value(model, "Repeat Key")).toBe("no (turned off in the firmware)");
  });

  it("says why something is missing: old firmware, or turned off", () => {
    const old = corne({ vialProtocol: 3, keyOverrides: [], altRepeatKeys: [], settings: [], features: [] });
    expect(value(old, "Key overrides")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "Two-byte keycodes in macros")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "QMK settings")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "Caps Word")).toBe("no (the Vial firmware is too old)");
    expect(value(corne({ keyOverrides: [] }), "Key overrides")).toBe("no (turned off in the firmware)");
  });

  it("counts encoders by number, not by direction, and lists features it doesn't know by name", () => {
    const geometry = { ...simulatedCorne().keys[0], row: null, col: null };
    const model = corne({
      encoders: [{ ...geometry, encoder: 0, direction: 0 }, { ...geometry, encoder: 0, direction: 1 }],
      features: ["caps_word", "new_thing"],
    });
    expect(value(model, "Keys")).toBe("42, and 1 encoder");
    expect(value(model, "new_thing")).toBe("yes");
  });

  it("is text to paste, one fact a line", () => {
    const text = aboutText(aboutFacts(corne()));
    expect(text.split("\n").slice(0, 3)).toEqual(["Keyboard", "  Name: Test Corne", "  Keyboard ID: 5EEDC0DE00420042"]);
  });
});
```

Create `web/src/about/layoutFile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { positionNames } from "../analysis/positions";
import { described, simulatedCorne } from "../analysis/testing";
import type { KeyboardModel, LayoutFilePreview, SettingsDefinitions } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import {
  changeTotal, layoutFileName, layoutOptionChanges, LISTED, previewSections, shortAction, unchangedSections,
  type PreviewContext,
} from "./layoutFile";

const model: KeyboardModel = {
  ...simulatedCorne(),
  keyOverrides: [{ index: 0, trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 0xffff,
    triggerMods: 2, negativeModMask: 0, suppressedMods: 2, options: 0x87, enabled: true }],
  altRepeatKeys: [{ index: 0, keycode: described("KC_LEFT"), altKeycode: described("KC_RGHT"), allowedMods: 0,
    options: 8, enabled: true }],
  settings: [{ qsid: 7, value: 200 }, { qsid: 21, value: 0 }],
};
const names = namesOf(model);
const definitions: SettingsDefinitions = {
  tabs: [{ name: "Magic", fields: [
    { type: "boolean", title: "Swap Caps Lock and Left Control", qsid: 21, bit: 0, width: 4, min: null, max: null },
    { type: "integer", title: "Tapping Term", qsid: 7, bit: null, width: 2, min: 0, max: 10000 },
  ] }],
};
const ctx: PreviewContext = { model, names, positions: positionNames(placeKeyboard(model)), definitions };

function preview(change: Partial<LayoutFilePreview> = {}): LayoutFilePreview {
  return {
    uid: "5EEDC0DE00420042", keys: [], encoders: [], layoutOptions: null, tapDance: [], combos: [], keyOverrides: [],
    altRepeatKeys: [], macros: [], settings: [], ignored: [], needsUnlock: false, ...change,
  };
}

const key = (layer: number, row: number, col: number, before: string, after: string) =>
  ({ layer, row, col, before: described(before), after: described(after) });

describe("previewSections", () => {
  it("is nothing for a file that changes nothing; every section the keyboard has is unchanged", () => {
    expect(previewSections(preview(), ctx)).toEqual([]);
    expect(unchangedSections(preview(), ctx)).toEqual([
      "keys", "tap dances", "combos", "key overrides", "alt-repeat keys", "macros", "QMK settings",
    ]);
  });

  it("lists the keys changed, where they are, and how many on each layer", () => {
    const sections = previewSections(preview({
      keys: [key(0, 0, 0, "KC_TAB", "KC_Z"), key(0, 4, 0, "KC_BSPC", "KC_NO"), key(2, 1, 1, "KC_TRNS", "LT2(KC_B)")],
    }), ctx);
    expect(sections).toEqual([{
      id: "keys", title: "Keys", count: 3, summary: "Base: 2, Layer 2: 1", more: 0,
      items: [
        "Base, left top row, 1st from the outside: Tab → Z",
        "Base, right top row, 1st from the outside: BSPC → nothing",
        "Layer 2, left home row, 2nd from the outside: transparent → B (hold: Layer 2)",
      ],
    }]);
  });

  it("lists the first few changes of a long section, and how many more there are", () => {
    const keys = Array.from({ length: LISTED + 3 }, (_, c) => key(0, c % 3, c % 6, "KC_A", "KC_B"));
    const [section] = previewSections(preview({ keys }), ctx);
    expect(section.items).toHaveLength(LISTED);
    expect([section.count, section.more]).toEqual([LISTED + 3, 3]);
    expect(changeTotal([section, section])).toBe(2 * (LISTED + 3));
  });

  it("says what each changed entry does after loading", () => {
    const td = model.tapDance[2];
    const combo = model.combos[2];
    const ko = model.keyOverrides[0];
    const ark = model.altRepeatKeys[0];
    const macro = { index: 2, name: "hello", customName: false,
      actions: [{ type: "text" as const, text: "hello", keys: [], delay: null }] };
    const sections = previewSections(preview({
      tapDance: [{ before: td, after: { ...td, tap: described("KC_A"), doubleTap: described("KC_B") } }],
      combos: [{ before: combo, after: { ...combo, keys: [described("KC_J"), described("KC_K"), described("KC_NO"),
        described("KC_NO")], output: described("KC_ESC") } }],
      keyOverrides: [{ before: ko, after: { ...ko, enabled: false } }],
      altRepeatKeys: [{ before: ark, after: { ...ark, keycode: described("KC_NO"), altKeycode: described("KC_NO"),
        options: 0, enabled: false } }],
      macros: [{ before: { ...macro, actions: [] }, after: macro }],
      settings: [{ qsid: 7, before: 200, after: 250 }, { qsid: 21, before: 0, after: 1 }],
    }), ctx);
    expect(sections.map((s) => [s.title, s.items])).toEqual([
      ["Tap dances", ["Tap dance 2: Tap for A, double-tap for B."]],
      ["Combos", ["Combo 2: J + K → Esc"]],
      ["Key overrides", ["Key override 0: Left Shift + BSPC sends DEL, on every layer. Switched off."]],
      ["Alt-repeat keys", ["Alt-repeat key 0: cleared"]],
      ["Macros", ["Macro 2: hello (1 step)"]],
      ["QMK settings", ["Tapping Term: 200 → 250", "Swap Caps Lock and Left Control: off → on"]],
    ]);
    expect(unchangedSections(preview({ macros: [{ before: { ...macro, actions: [] }, after: macro }] }), ctx))
      .not.toContain("macros");
  });

  it("names the layout options that change", () => {
    const options = { value: 0, labels: ["Split Backspace", ["Bottom row", "6.25U", "7U", "Split"]] as (string | string[])[] };
    // the first option is in the highest bits: Split Backspace is bit 2, Bottom row bits 0-1
    expect(layoutOptionChanges(options, 0b000, 0b101)).toEqual(["Split Backspace: off → on", "Bottom row: 6.25U → 7U"]);
    expect(layoutOptionChanges(null, 0, 1)).toEqual(["0 → 1"]);
    const sections = previewSections(preview({ layoutOptions: { before: 0, after: 4 } }), { ...ctx,
      model: { ...model, layoutOptions: options } });
    expect(sections[0].items).toEqual(["Split Backspace: off → on"]);
  });
});

describe("shortAction", () => {
  it("is a keycode in a few words", () => {
    expect(shortAction(described("KC_NO"), names)).toBe("nothing");
    expect(shortAction(described("KC_ESC"), names)).toBe("Esc");
    expect(shortAction(described("LT1(KC_SPC)"), names)).toBe("Space (hold: Layer 1)");
  });
});

describe("layoutFileName", () => {
  it("is the keyboard's name, without what file systems refuse", () => {
    expect(layoutFileName("Simulated Corne")).toBe("Simulated Corne.vil");
    expect(layoutFileName('Knob/Pad: "mini"')).toBe("Knob_Pad_ _mini.vil");
    expect(layoutFileName("...")).toBe("keyboard.vil");
  });
});
```

```bash
cd web && npx vitest run src/about
```

Expected: `Cannot find module './about'` and `Cannot find module './layoutFile'`.

- [ ] **Step 2: The facts and the preview in words**

Create `web/src/about/about.ts`:

```ts
// What the Keyboard page says about the keyboard: what Qt's "About keyboard" dialog says, from the loaded model.
import type { KeyboardModel } from "../api/types";

/** Vial protocol versions that brought each feature (protocol/constants.py), for why a keyboard lacks one */
const ADVANCED_MACROS = 2;
const DYNAMIC = 4;
const QMK_SETTINGS = 4;
const EXT_MACROS = 5;
const KEY_OVERRIDE = 5;

export interface Fact {
  label: string;
  value: string;
  /** worth copying on its own: the name, the ID */
  copy?: boolean;
  /** monospaced: an ID */
  code?: boolean;
}

export interface FactGroup {
  title: string;
  facts: Fact[];
}

/** Features the firmware reports (KeyboardModel.features), by name */
const FEATURES: [string, string][] = [
  ["caps_word", "Caps Word"],
  ["layer_lock", "Layer Lock"],
  ["repeat_key", "Repeat Key"],
  ["persistent_default_layer", "Persistent default layer"],
];

type Model = Pick<KeyboardModel, "name" | "uid" | "viaProtocol" | "vialProtocol" | "rows" | "cols" | "keys" |
  "encoders" | "layers" | "macros" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "settings" | "features">;

/** Why a keyboard has none of something, as Qt says it: its firmware is too old, or it was left out of it */
function missing(model: Model, since: number): string {
  return model.vialProtocol < since ? "no (the Vial firmware is too old)" : "no (turned off in the firmware)";
}

function count(model: Model, n: number, since: number): string {
  return n > 0 ? String(n) : missing(model, since);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function aboutFacts(model: Model): FactGroup[] {
  const encoders = new Set(model.encoders.map((e) => e.encoder)).size;
  const features = new Set(model.features);
  const known = new Set(FEATURES.map(([id]) => id));
  return [
    {
      title: "Keyboard",
      facts: [
        { label: "Name", value: model.name, copy: true },
        { label: "Keyboard ID", value: model.uid, copy: true, code: true },
        { label: "Protocols", value: `VIA ${model.viaProtocol}, Vial ${model.vialProtocol}`, copy: true },
        { label: "Matrix", value: `${plural(model.rows, "row", "rows")} × ${plural(model.cols, "column", "columns")}` },
        { label: "Keys", value: `${model.keys.length}${encoders > 0 ? `, and ${plural(encoders, "encoder", "encoders")}` : ""}` },
        { label: "Layers", value: String(model.layers.length) },
      ],
    },
    {
      title: "Memory and entries",
      facts: [
        { label: "Macros", value: model.macros.count > 0
          ? `${model.macros.count}, sharing ${model.macros.memory} bytes (${model.macros.used} used)` : "none" },
        { label: "Delays in macros", value: model.vialProtocol >= ADVANCED_MACROS ? "yes" : missing(model, ADVANCED_MACROS) },
        { label: "Two-byte keycodes in macros", value: model.vialProtocol >= EXT_MACROS ? "yes" : missing(model, EXT_MACROS) },
        { label: "Tap dances", value: count(model, model.tapDance.length, DYNAMIC) },
        { label: "Combos", value: count(model, model.combos.length, DYNAMIC) },
        { label: "Key overrides", value: count(model, model.keyOverrides.length, KEY_OVERRIDE) },
        { label: "Alt-repeat keys", value: count(model, model.altRepeatKeys.length, KEY_OVERRIDE) },
        { label: "QMK settings", value: model.settings.length > 0 ? String(model.settings.length) : missing(model, QMK_SETTINGS) },
      ],
    },
    {
      title: "Features",
      facts: [
        ...FEATURES.map(([id, label]) => ({ label, value: features.has(id) ? "yes" : missing(model, DYNAMIC) })),
        ...[...features].filter((id) => !known.has(id)).sort().map((id) => ({ label: id, value: "yes" })),
      ],
    },
  ];
}

/** All of it as text, one fact a line, to paste into a bug report */
export function aboutText(groups: FactGroup[]): string {
  return groups.map((g) => [g.title, ...g.facts.map((f) => `  ${f.label}: ${f.value}`)].join("\n")).join("\n");
}
```

Create `web/src/about/layoutFile.ts`:

```ts
// What loading a .vil file changes, section by section, in words: from the server's preview (POST
// /api/layout-file/preview), with the page's own names for keys, layers and settings.
import type { Described, KeyboardModel, LayoutFilePreview, LayoutOptions, SettingsDefinitions } from "../api/types";
import { layoutChoices } from "../keyboard/geometry";
import { memberName } from "../analysis/phrases";
import type { Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import { tapDanceIsSet } from "../behaviours/entries";
import { isSet as comboIsSet } from "../behaviours/members";
import { altRepeatIsSet, altRepeatSentence, keyOverrideIsSet, keyOverrideSentence } from "../behaviours/overrides";
import { tapDanceSentence } from "../behaviours/sentences";
import { settingChanges } from "../settings/qmkSettings";

/** How many changes a section lists before "and N more" */
export const LISTED = 5;

export interface PreviewSection {
  id: "keys" | "encoders" | "layoutOptions" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "macros" |
    "settings";
  title: string;
  /** how many changes */
  count: number;
  /** for the keys: how many on each layer, "Base: 2, Layer 2: 1" */
  summary: string | null;
  /** the first few changes, in words */
  items: string[];
  /** how many more there are */
  more: number;
}

export interface PreviewContext {
  model: Pick<KeyboardModel, "keys" | "encoders" | "layers" | "layoutOptions" | "tapDance" | "combos" | "keyOverrides" |
    "altRepeatKeys" | "macros" | "settings">;
  names: Names;
  /** every placed key's position in words, by refId */
  positions: Map<string, string>;
  definitions: SettingsDefinitions | null;
}

/** A keycode in a few words, as combos name their keys: "Z", "B (hold: Layer 2)", "MO(3)", "nothing" */
export function shortAction(d: Described, names: Names): string {
  if (d.kind === "none") return "nothing";
  if (d.kind === "transparent") return "transparent";
  return memberName(d, names);
}

function change(before: Described, after: Described, names: Names): string {
  return `${shortAction(before, names)} → ${shortAction(after, names)}`;
}

/** Where a matrix position is, in words: the position of the key drawn there ("left, top row, outer"), else its row
 * and column */
function keyPlace(ctx: PreviewContext, row: number, col: number): string {
  const indexes = ctx.model.keys.flatMap((k, i) => (k.row === row && k.col === col ? [i] : []));
  const placed = indexes.map((i) => ctx.positions.get(refId({ kind: "key", index: i }))).find((p) => p !== undefined);
  return placed ?? `row ${row}, column ${col}`;
}

function encoderPlace(ctx: PreviewContext, encoder: number, direction: number): string {
  const index = ctx.model.encoders.findIndex((e) => e.encoder === encoder && e.direction === direction);
  const placed = index >= 0 ? ctx.positions.get(refId({ kind: "encoder", index })) : undefined;
  return placed ?? `encoder ${encoder}, ${direction === 1 ? "clockwise" : "counter-clockwise"}`;
}

/** Each layout option whose choice differs: "Split Backspace: off → on", "Bottom row: 6.25U → 7U" */
export function layoutOptionChanges(options: LayoutOptions | null | undefined, before: number, after: number): string[] {
  if (!options) return [`${before} → ${after}`];
  const was = layoutChoices({ ...options, value: before });
  const now = layoutChoices({ ...options, value: after });
  return options.labels.flatMap((label, i) => {
    if (was[i] === now[i]) return [];
    const name = typeof label === "string" ? label : label[0];
    const choice = (c: number) => (typeof label === "string" ? (c ? "on" : "off") : (label[c + 1] ?? `choice ${c}`));
    return [`${name}: ${choice(was[i])} → ${choice(now[i])}`];
  });
}

function section(id: PreviewSection["id"], title: string, items: string[], summary: string | null = null,
  count = items.length): PreviewSection {
  return { id, title, count, summary, items: items.slice(0, LISTED), more: Math.max(0, items.length - LISTED) };
}

function layerCounts(layers: number[], names: Names): string {
  const counts = new Map<number, number>();
  for (const l of layers) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([l, n]) => `${names.layer(l)}: ${n}`).join(", ");
}

/** The sections the file changes, each with its changes in words; a section the file leaves as it is isn't one */
export function previewSections(preview: LayoutFilePreview, ctx: PreviewContext): PreviewSection[] {
  const { names, model } = ctx;
  const layerCount = model.layers.length;
  const sections: PreviewSection[] = [
    section("keys", "Keys",
      preview.keys.map((k) => `${names.layer(k.layer)}, ${keyPlace(ctx, k.row, k.col)}: ${change(k.before, k.after, names)}`),
      preview.keys.length > 0 ? layerCounts(preview.keys.map((k) => k.layer), names) : null),
    section("encoders", "Encoders",
      preview.encoders.map((e) => `${names.layer(e.layer)}, ${encoderPlace(ctx, e.encoder, e.direction)}: ${change(e.before, e.after, names)}`)),
  ];
  if (preview.layoutOptions) {
    const items = layoutOptionChanges(model.layoutOptions, preview.layoutOptions.before, preview.layoutOptions.after);
    sections.push(section("layoutOptions", "Layout options", items));
  }
  sections.push(
    section("tapDance", "Tap dances", preview.tapDance.map(({ after }) =>
      `Tap dance ${after.index}: ${tapDanceIsSet(after) ? tapDanceSentence(after, names, model) : "cleared"}`)),
    section("combos", "Combos", preview.combos.map(({ after }) => {
      if (!comboIsSet(after)) return `Combo ${after.index}: cleared`;
      const keys = after.keys.filter((k) => k.kind !== "none").map((k) => shortAction(k, names)).join(" + ");
      return `Combo ${after.index}: ${keys || "no keys"} → ${shortAction(after.output, names)}`;
    })),
    section("keyOverrides", "Key overrides", preview.keyOverrides.map(({ after }) =>
      `Key override ${after.index}: ${keyOverrideIsSet(after)
        ? `${keyOverrideSentence(after, layerCount, names)}${after.enabled ? "" : " Switched off."}` : "cleared"}`)),
    section("altRepeatKeys", "Alt-repeat keys", preview.altRepeatKeys.map(({ after }) =>
      `Alt-repeat key ${after.index}: ${altRepeatIsSet(after)
        ? `${altRepeatSentence(after, names)}${after.enabled ? "" : " Switched off."}` : "cleared"}`)),
    section("macros", "Macros", preview.macros.map(({ after }) => {
      const steps = after.actions.length;
      return `Macro ${after.index}: ${steps === 0 ? "cleared" : `${after.name} (${steps} ${steps === 1 ? "step" : "steps"})`}`;
    })),
  );
  const settings = preview.settings.flatMap((s) => settingChanges(ctx.definitions, s.qsid, s.before, s.after));
  sections.push(section("settings", "QMK settings", settings));
  return sections.filter((s) => s.count > 0);
}

/** The sections the keyboard has that the file leaves as they are: "encoders", "combos" */
export function unchangedSections(preview: LayoutFilePreview, ctx: PreviewContext): string[] {
  const changed = new Set(previewSections(preview, ctx).map((s) => s.id));
  const { model } = ctx;
  const has: [PreviewSection["id"], string, boolean][] = [
    ["keys", "keys", true],
    ["encoders", "encoders", model.encoders.length > 0],
    ["layoutOptions", "layout options", (model.layoutOptions?.labels.length ?? 0) > 0],
    ["tapDance", "tap dances", model.tapDance.length > 0],
    ["combos", "combos", model.combos.length > 0],
    ["keyOverrides", "key overrides", model.keyOverrides.length > 0],
    ["altRepeatKeys", "alt-repeat keys", model.altRepeatKeys.length > 0],
    ["macros", "macros", model.macros.items.length > 0],
    ["settings", "QMK settings", model.settings.length > 0],
  ];
  return has.filter(([id, , present]) => present && !changed.has(id)).map(([, label]) => label);
}

/** How many changes in all */
export function changeTotal(sections: PreviewSection[]): number {
  return sections.reduce((n, s) => n + s.count, 0);
}

/** The name to save a layout under when the server gives none: the keyboard's, without characters file systems
 * refuse */
export function layoutFileName(keyboardName: string): string {
  const name = keyboardName.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[\s._]+|[\s._]+$/g, "");
  return `${name.slice(0, 100) || "keyboard"}.vil`;
}
```

```bash
cd web && npx vitest run src/about
```

Expected: `Test Files  2 passed (2)` and `Tests  11 passed (11)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  38 passed (38)` and `Tests  596 passed (596)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/about/about.test.ts \
  web/src/about/about.ts \
  web/src/about/layoutFile.test.ts \
  web/src/about/layoutFile.ts
git commit -m "feat(web): what the keyboard is, and what a layout file changes, in words"
```

### Task 15: The Keyboard page: about the keyboard, and saving and loading layout files

- **`about/AboutCard.svelte`:** "About this keyboard": the facts in groups, each value cut short with a tooltip, a copy button on each value worth copying, and "Copy all". A status line says what was copied; a toast says when the browser didn't allow it.
- **`about/LayoutFileCard.svelte`:** "Layout file". "Save layout" downloads the `.vil` with the name the server gives ("Saved Simulated Corne.vil."). "Load layout…" opens a file chooser (`.vil`, JSON); a file larger than the server takes (1 MiB) is refused at once. The file is checked with the preview route and the setting names (for the settings' changes), then shown in the preview panel. "Load it" calls `keyboard.loadLayoutFile` and says how many changes were written; a refusal (another keyboard's file, a broken one) shows in the card (`role="alert"`) and nothing is written. Another keyboard plugged in drops a preview made for the one before.
- **`about/LayoutPreview.svelte`:** the preview: "Load saved.vil?" as a heading that takes the focus, "Loading it makes N changes" (or "changes nothing"), the sections with their counts and changes, "Left as they are: …", the ignored parts, the notes (a file that doesn't say its keyboard, an unlock needed), then "Load it" and Cancel.
- **`about/KeyboardPage.svelte`:** the page header and the two cards, the layout file first.

**Files:**
- Create: `web/src/about/AboutCard.svelte`, `web/src/about/LayoutPreview.svelte`, `web/src/about/LayoutFileCard.svelte`, `web/src/about/KeyboardPage.svelte`

- [ ] **Step 1: About this keyboard**

Create `web/src/about/AboutCard.svelte`:

```svelte
<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import { toasts } from "../lib/toasts.svelte";
  import Button from "../ui/Button.svelte";
  import { aboutFacts, aboutText } from "./about";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  const groups = $derived(aboutFacts(model));
  /** what was copied last, said for a moment */
  let copied = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toasts.error(`Copying ${what} failed: the browser didn't allow it. Select the text and copy it instead.`);
      return;
    }
    copied = `Copied ${what}.`;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = ""), 3000);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<section class="card" aria-labelledby="about-title">
  <header>
    <h2 id="about-title">About this keyboard</h2>
    <Button size="sm" onclick={() => void copy(aboutText(groups), "everything")}>Copy all</Button>
  </header>
  <div class="groups">
    {#each groups as group (group.title)}
      <div class="group">
        <h3>{group.title}</h3>
        <dl>
          {#each group.facts as fact (fact.label)}
            <div class="fact">
              <dt>{fact.label}</dt>
              <dd>
                <span class="value" class:code={fact.code} title={fact.value}>{fact.value}</span>
                {#if fact.copy}
                  <button type="button" class="copy" aria-label="Copy the {fact.label.toLowerCase()}" title="Copy"
                    onclick={() => void copy(fact.value, `the ${fact.label.toLowerCase()}`)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
                    </svg>
                  </button>
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </div>
    {/each}
  </div>
  <p class="copied" role="status">{copied}</p>
</section>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    gap: 12px 24px;
  }

  .group {
    min-width: 0;
  }

  h3 {
    margin: 0 0 4px;
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  dl {
    display: grid;
    gap: 2px;
    margin: 0;
  }

  .fact {
    display: grid;
    grid-template-columns: minmax(0, 13em) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 28px;
    font-size: 13px;
  }

  dt {
    color: var(--text-2);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin: 0;
  }

  /* a long value (the keyboard's name) is cut short; the tooltip has all of it */
  .value {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.code {
    font-family: var(--mono);
    font-size: 12.5px;
  }

  .copy {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .copy:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .copy svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }

  .copied {
    min-height: 1.4em;
    margin: 0;
    color: var(--ok);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 2: The preview**

Create `web/src/about/LayoutPreview.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { LayoutFilePreview } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { changeTotal, previewSections, unchangedSections, type PreviewContext } from "./layoutFile";

  interface Props {
    /** the file's name */
    name: string;
    preview: LayoutFilePreview;
    context: PreviewContext;
    /** the keyboard is unlocked */
    unlocked: boolean;
    canLoad: boolean;
    /** a change is being saved: the buttons keep the focus, but take nothing until it is done */
    busy: boolean;
    onload: () => void;
    oncancel: () => void;
  }

  let { name, preview, context, unlocked, canLoad, busy, onload, oncancel }: Props = $props();

  const sections = $derived(previewSections(preview, context));
  const total = $derived(changeTotal(sections));
  const unchanged = $derived(unchangedSections(preview, context));
  let heading = $state<HTMLHeadingElement>();

  // opened from the Load button, which stays: the focus comes here, to what to read next
  onMount(() => heading?.focus());
</script>

<div class="preview" role="group" aria-labelledby="layout-preview-title">
  <h3 id="layout-preview-title" tabindex="-1" bind:this={heading}>
    <span class="file" title={name}>Load {name}?</span>
  </h3>
  {#if total === 0}
    <p class="lead">It holds what the keyboard holds already: loading it changes nothing.</p>
  {:else}
    <p class="lead">
      Loading it makes {total} {total === 1 ? "change" : "changes"} on the keyboard. Nothing is written until you
      choose Load it.
    </p>
    <ul class="sections">
      {#each sections as section (section.id)}
        <li>
          <h4>{section.title} <span class="count">{section.count}</span></h4>
          {#if section.summary}<p class="summary">{section.summary}</p>{/if}
          <ul class="items">
            {#each section.items as item, i (i)}<li>{item}</li>{/each}
            {#if section.more > 0}<li class="more">and {section.more} more</li>{/if}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
  {#if unchanged.length > 0 && total > 0}
    <p class="unchanged">Left as they are: {unchanged.join(", ")}.</p>
  {/if}
  {#if preview.ignored.length > 0}
    <p class="note">This keyboard has no room for some of the file, which is left out: {preview.ignored.join("; ")}.</p>
  {/if}
  {#if !preview.uid}
    <p class="note">The file doesn't say which keyboard it was saved from.</p>
  {/if}
  {#if preview.needsUnlock && !unlocked}
    <p class="note">
      It changes what only an unlocked keyboard takes (the macros, or a bootloader key): the keyboard asks to be
      unlocked first, and nothing is written until it is.
    </p>
  {/if}
  <div class="buttons">
    <Button aria-disabled={busy || undefined} onclick={() => {
      if (!busy) oncancel();
    }}>{total === 0 ? "Close" : "Cancel"}</Button>
    {#if total > 0}
      <Button variant="primary" disabled={!canLoad} aria-disabled={busy || undefined} onclick={() => {
        if (!busy) onload();
      }}>Load it</Button>
    {/if}
  </div>
</div>

<style>
  .preview {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    box-shadow: 0 0 0 1px var(--accent);
    background: var(--surface);
  }

  h3 {
    display: flex;
    min-width: 0;
    margin: 0;
    font-size: 15px;
  }

  h3:focus {
    outline: none;
  }

  .file {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lead,
  .unchanged {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 10px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .sections > li {
    min-width: 0;
  }

  h4 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    font-size: 13px;
  }

  .count {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .items {
    display: grid;
    gap: 1px;
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 12.5px;
  }

  .items li {
    overflow-wrap: anywhere;
  }

  .more {
    color: var(--text-3);
    list-style: none;
  }

  .note {
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
```

- [ ] **Step 3: The layout file card**

Create `web/src/about/LayoutFileCard.svelte`:

```svelte
<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { KeyboardModel, LayoutFilePreview, SettingsDefinitions } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import { settingDefinitions } from "../settings/definitions";
  import Button from "../ui/Button.svelte";
  import { changeTotal, layoutFileName, previewSections, type PreviewContext } from "./layoutFile";
  import LayoutPreview from "./LayoutPreview.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
  }

  let { model, analysis }: Props = $props();

  /** the largest file the server takes (app.MAX_LAYOUT_FILE) */
  const MAX_BYTES = 1024 * 1024;

  const canEdit = $derived(keyboard.canEdit);
  const busy = $derived(keyboard.pending > 0);
  let fileInput = $state<HTMLInputElement>();
  /** the file chosen, and what loading it would change */
  let chosen = $state<{ name: string; text: string; preview: LayoutFilePreview } | null>(null);
  /** reading or checking a file, or saving one */
  let working = $state(false);
  /** why the file chosen can't be loaded */
  let problem = $state<string | null>(null);
  /** what was done last: "Saved Simulated Corne.vil." */
  let done = $state("");
  let definitions = $state.raw<SettingsDefinitions | null>(null);

  const context = $derived<PreviewContext>({
    model, names: namesOf(model), positions: analysis.positions, definitions,
  });

  // another keyboard: a file checked against the one before isn't checked against it
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    untrack(() => {
      if (uid === shownUid) return;
      shownUid = uid;
      chosen = null;
      problem = null;
      done = "";
    });
  });

  async function saveFile() {
    if (working) return;
    working = true;
    done = "";
    try {
      const { blob, name } = await api.layoutFile();
      const fileName = name || layoutFileName(model.name);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      done = `Saved ${fileName}.`;
    } catch (error) {
      toasts.error(`Saving the layout failed: ${causeMessage(error)}`);
    } finally {
      working = false;
    }
  }

  async function check(file: File) {
    working = true;
    problem = null;
    done = "";
    chosen = null;
    try {
      if (file.size > MAX_BYTES) {
        problem = `${file.name} can't be loaded: it is too large for a layout file (at most ${MAX_BYTES / 1024} KiB).`;
        return;
      }
      const text = await file.text();
      // the setting names, for the changes to them (the preview says "Setting 7" without them)
      const [preview] = await Promise.all([api.previewLayoutFile(text),
        settingDefinitions().then((d) => (definitions = d), () => undefined)]);
      chosen = { name: file.name, text, preview };
    } catch (error) {
      problem = `${file.name} can't be loaded: ${causeMessage(error)}`;
    } finally {
      working = false;
    }
  }

  async function load() {
    if (!chosen || busy) return;
    const { name, preview } = chosen;
    const total = changeTotal(previewSections(preview, context));
    if (await keyboard.loadLayoutFile(chosen.text)) {
      chosen = null;
      done = `Loaded ${name}: ${total} ${total === 1 ? "change" : "changes"} written to the keyboard.`;
      await tick();
      document.getElementById("load-layout")?.focus();
    }
  }

  async function cancel() {
    chosen = null;
    await tick();
    document.getElementById("load-layout")?.focus();
  }
</script>

<section class="card" aria-labelledby="layout-file-title">
  <h2 id="layout-file-title">Layout file</h2>
  <p class="about">
    A <code>.vil</code> file holds everything on these pages: the keymap, tap dances, combos, macros, key overrides,
    alt-repeat keys and QMK settings. Save one to keep a copy; load one to put a copy back. Loading shows what changes
    first.
  </p>
  <div class="buttons">
    <Button id="save-layout" aria-disabled={working || undefined} onclick={() => void saveFile()}>Save layout</Button>
    <!-- never disabled: it takes the focus back after a load, while the keyboard is read again (and can't be edited) -->
    <Button id="load-layout" aria-disabled={working || busy || !canEdit || undefined} onclick={() => {
      if (!working && !busy && canEdit) fileInput?.click();
    }}>Load layout…</Button>
    <input
      bind:this={fileInput}
      class="visually-hidden"
      type="file"
      accept=".vil,application/json"
      tabindex="-1"
      aria-label="Layout file to load"
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) void check(file);
      }}
    />
  </div>
  <p class="status" role="status">{working && !chosen ? "Reading the file…" : done}</p>
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  {#if chosen}
    <LayoutPreview name={chosen.name} preview={chosen.preview} {context} unlocked={keyboard.unlock.state.state === "unlocked"}
      canLoad={canEdit} {busy} onload={() => void load()} oncancel={() => void cancel()} />
  {/if}
</section>

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
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .about {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .status {
    min-height: 1.4em;
    margin: -4px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
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
</style>
```

- [ ] **Step 4: The page**

Create `web/src/about/KeyboardPage.svelte`:

```svelte
<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import AboutCard from "./AboutCard.svelte";
  import LayoutFileCard from "./LayoutFileCard.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
  }

  let { model, analysis }: Props = $props();
</script>

<section class="page" aria-labelledby="keyboard-title">
  <PageHeader
    id="keyboard-title"
    title="Keyboard"
    description="What the keyboard is and what its firmware can do, and its layout saved to a file or loaded from one."
  />
  <LayoutFileCard {model} {analysis} />
  <AboutCard {model} />
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }
</style>
```

- [ ] **Step 5: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 6: Commit**

```bash
git add web/src/about/AboutCard.svelte \
  web/src/about/KeyboardPage.svelte \
  web/src/about/LayoutFileCard.svelte \
  web/src/about/LayoutPreview.svelte
git commit -m "feat(web): the Keyboard page: about the keyboard, and saving and loading layout files"
```

### Task 16: Key overrides, Alt-repeat, Settings and Keyboard in the navigation

- **`App.svelte`:** the four sections after Macros: Key overrides and Alt-repeat with the counts of entries set up (left out when the firmware has none), Settings (left out when the keyboard reports no QMK settings) and Keyboard (always). It shows their pages, and `document.title` names them ("Keyboard · Vial"), as for the other sections.
- **`Nav.svelte`:** the sections wrap onto more rows in any window too narrow for them, not only on a phone: eight sections would scroll sideways at 800 px.
- **`navigate.ts` and `UsedOn.svelte`:** a "used on" chip for a key override or an alt-repeat key (a keycode used there) is now a button that opens its card, like the others.

**Files:**
- Modify: `web/src/App.svelte`, `web/src/shell/Nav.svelte`, `web/src/behaviours/navigate.ts`, `web/src/behaviours/UsedOn.svelte`

- [ ] **Step 1: The sections and their pages**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -1,8 +1,11 @@
 <script lang="ts">
   import { tick, untrack } from "svelte";
+  import KeyboardPage from "./about/KeyboardPage.svelte";
   import { analyse } from "./analysis/analysis";
+  import AltRepeatPage from "./behaviours/AltRepeatPage.svelte";
   import CombosPage from "./behaviours/CombosPage.svelte";
   import { behaviourCounts } from "./behaviours/entries";
+  import KeyOverridesPage from "./behaviours/KeyOverridesPage.svelte";
   import MacrosPage from "./behaviours/MacrosPage.svelte";
   import TapDancePage from "./behaviours/TapDancePage.svelte";
   import { placeKeyboard } from "./keyboard/geometry";
@@ -17,6 +20,7 @@
   import Toasts from "./shell/Toasts.svelte";
   import TopBar from "./shell/TopBar.svelte";
   import UnlockDialog from "./shell/UnlockDialog.svelte";
+  import SettingsPage from "./settings/SettingsPage.svelte";

   $effect(() => keyboard.start());
   $effect(() => router.start());
@@ -26,7 +30,8 @@
   const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
   const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);

-  // sections the keyboard's firmware doesn't have (no tap dances, combos or macros) are left out
+  // sections the keyboard's firmware doesn't have (no tap dances, combos, macros, key overrides, alt-repeat keys or
+  // QMK settings) are left out
   const sections = $derived.by<Section[]>(() => {
     const model = keyboard.model;
     const list: Section[] = [{ id: "keymap", label: "Keymap", count: model?.layers.length }];
@@ -35,6 +40,10 @@
     if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
     if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
     if (counts.macros !== null) list.push({ id: "macros", label: "Macros", count: counts.macros });
+    if (counts.keyOverrides !== null) list.push({ id: "key-overrides", label: "Key overrides", count: counts.keyOverrides });
+    if (counts.altRepeat !== null) list.push({ id: "alt-repeat", label: "Alt-repeat", count: counts.altRepeat });
+    if (model.settings.length > 0) list.push({ id: "settings", label: "Settings" });
+    list.push({ id: "keyboard", label: "Keyboard" });
     return list;
   });
   // a section this keyboard doesn't have shows the keymap
@@ -137,6 +146,14 @@
           <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
         {:else if section === "macros"}
           <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
+        {:else if section === "key-overrides"}
+          <KeyOverridesPage model={keyboard.model} item={router.route.item} />
+        {:else if section === "alt-repeat"}
+          <AltRepeatPage model={keyboard.model} item={router.route.item} />
+        {:else if section === "settings"}
+          <SettingsPage model={keyboard.model} />
+        {:else if section === "keyboard"}
+          <KeyboardPage model={keyboard.model} {analysis} />
         {:else}
           <KeymapPage model={keyboard.model} {placement} {analysis} />
         {/if}
@@ -181,7 +198,7 @@
     max-width: var(--content-max);
   }

-  /* list pages (tap dance, combos, macros) are narrower than the keymap, centred in its column */
+  /* list pages (all but the keymap) are narrower than the keymap, centred in its column */
   .page.list {
     width: 100%;
     max-width: var(--list-max);
```

- [ ] **Step 2: The navigation wraps**

Apply to `web/src/shell/Nav.svelte`:

```diff
diff --git a/web/src/shell/Nav.svelte b/web/src/shell/Nav.svelte
--- a/web/src/shell/Nav.svelte
+++ b/web/src/shell/Nav.svelte
@@ -38,8 +38,10 @@
 </nav>

 <style>
+  /* a narrow window: the sections take as many rows as they need rather than widen the page */
   ul {
     display: flex;
+    flex-wrap: wrap;
     gap: 4px;
     margin: 0;
     padding: 0;
@@ -80,12 +82,7 @@
     opacity: 0.7;
   }

-  /* a phone: the four sections fit on one row, or wrap onto a second one rather than widen the page */
   @media (max-width: 600px) {
-    ul {
-      flex-wrap: wrap;
-    }
-
     button {
       gap: 8px;
       padding: 8px 10px;
```

- [ ] **Step 3: "Used on" opens key overrides and alt-repeat keys**

Apply to `web/src/behaviours/navigate.ts`:

```diff
diff --git a/web/src/behaviours/navigate.ts b/web/src/behaviours/navigate.ts
--- a/web/src/behaviours/navigate.ts
+++ b/web/src/behaviours/navigate.ts
@@ -1,4 +1,5 @@
-// Going to where something is used: the key in the Keymap, or the combo, tap dance or macro on its page. One on the
+// Going to where something is used: the key in the Keymap, or the combo, tap dance, macro, key override or alt-repeat
+// key on its page. One on the
 // page shown (a tap dance another one runs) opens without a step back, which would look like it did nothing.
 import type { Use } from "../analysis/usage";
 import type { SectionId } from "../lib/route";
@@ -22,7 +23,11 @@ export function openUse(use: Use): void {
     case "macro":
       open("macros", use.macro);
       break;
-    default:
-      break; // key overrides and alt-repeat keys have no page yet
+    case "key-override":
+      open("key-overrides", use.keyOverride);
+      break;
+    case "alt-repeat":
+      open("alt-repeat", use.altRepeat);
+      break;
   }
 }
```

Apply to `web/src/behaviours/UsedOn.svelte`:

```diff
diff --git a/web/src/behaviours/UsedOn.svelte b/web/src/behaviours/UsedOn.svelte
--- a/web/src/behaviours/UsedOn.svelte
+++ b/web/src/behaviours/UsedOn.svelte
@@ -10,14 +10,11 @@
     positions: Map<string, string>;
     /** what to put on a key to use it, for the warning when nothing does: "TD(3)" */
     keycode: string;
-    /** go to a use: the key in the Keymap, or the combo, tap dance or macro on its page */
+    /** go to a use: the key in the Keymap, or the combo, tap dance, macro, key override or alt-repeat key on its page */
     onopen: (use: Use) => void;
   }

   let { uses, names, positions, keycode, onopen }: Props = $props();
-
-  /** key overrides and alt-repeat keys have no page yet */
-  const openable = (use: Use) => use.type !== "key-override" && use.type !== "alt-repeat";
 </script>

 {#if uses.length === 0}
@@ -29,11 +26,7 @@
       {#each uses as use, i (i)}
         {@const label = useLabel(use, names, positions)}
         <li>
-          {#if openable(use)}
-            <button type="button" title="{label} · go there" onclick={() => onopen(use)}>{label}</button>
-          {:else}
-            <span class="plain">{label}</span>
-          {/if}
+          <button type="button" title="{label} · go there" onclick={() => onopen(use)}>{label}</button>
         </li>
       {/each}
     </ul>
@@ -64,8 +57,7 @@
     list-style: none;
   }

-  button,
-  .plain {
+  button {
     display: inline-block;
     max-width: 100%;
     padding: 1px 9px;
@@ -90,10 +82,6 @@
     background: var(--accent-weak);
   }

-  .plain {
-    border-style: dashed;
-  }
-
   .unused {
     margin: 0;
     padding: 6px 10px;
```

- [ ] **Step 4: Type-check, test, and run the e2e tests**

```bash
cd web && npm run check && npm test && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  38 passed (38)` and `Tests  596 passed (596)` and `84 passed`: the earlier tests pass with eight sections.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.svelte \
  web/src/behaviours/UsedOn.svelte \
  web/src/behaviours/navigate.ts \
  web/src/shell/Nav.svelte
git commit -m "feat(web): Key overrides, Alt-repeat, Settings and Keyboard in the navigation"
```

### Task 17: End-to-end tests for key overrides, alt-repeat keys, settings and layout files

The fixtures get helpers that read and put back what these tests change, through the API: `keyOverrideAt` and `setKeyOverride`, `altRepeatAt` and `setAltRepeat`, `settingsOf` and `setSettings` (only those that differ), and `openSection` (a section from the navigation, then its heading).

- **`overrides.spec.ts`:**
  - a new key override built in the editor (trigger, replacement, trigger modifiers, an option, layers) and saved: the card's sentence and the keyboard agree; then switched off, and removed;
  - one on no layer, or with no way to start it, says it never works, and Cancel keeps it as it was;
  - `#key-overrides/1` opens and highlights its card;
  - an alt-repeat key edited (its alt key and allowed modifiers) and saved; the page warns that no key has Alt Repeat.
- **`settings.spec.ts`:** two settings changed (a count per group, and in the Save bar) and undone, a number out of range refused, a change saved (Save keeps the focus), then everything reset to the defaults through the confirmation dialog (Cancel has the focus).
- **`layoutfile.spec.ts`:**
  - the layout saved ("Simulated Corne.vil"), a key changed, the file loaded back: the preview lists the change ("Base, left top row, 1st from the outside: Z → Tab") and confirming puts it back;
  - another keyboard's file and a broken one are refused with a clear error, and nothing changes;
  - a file that changes the macros, loaded on a locked keyboard: the unlock dialog shows, holding the keys through the fake-only hook (`simulatorUnlock`) unlocks it, and the whole file is loaded.

Each test puts back what it changed in a `finally`.

**Files:**
- Modify: `web/e2e/fixtures.ts`
- Test: `web/e2e/overrides.spec.ts`, `web/e2e/settings.spec.ts`, `web/e2e/layoutfile.spec.ts` (new)

- [ ] **Step 1: The fixtures**

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -290,3 +290,46 @@ export async function unlockAgain(page: Page): Promise<void> {
   await expect.poll(() => unlockState(page), { timeout: 20_000 }).toBe("unlocked");
   await simulatorUnlock(page, { keysHeld: false });
 }
+
+/** A key override as the server takes it */
+export async function keyOverrideAt(page: Page, index: number) {
+  const o = (await keyboardModel(page)).keyOverrides[index];
+  return { trigger: o.trigger.code, replacement: o.replacement.code, layers: o.layers, triggerMods: o.triggerMods,
+    negativeModMask: o.negativeModMask, suppressedMods: o.suppressedMods, options: o.options };
+}
+
+/** Sets a key override through the API */
+export async function setKeyOverride(page: Page, index: number, body: Awaited<ReturnType<typeof keyOverrideAt>>) {
+  await put(page, `/api/key-overrides/${index}`, body);
+}
+
+/** An alt-repeat key as the server takes it */
+export async function altRepeatAt(page: Page, index: number) {
+  const a = (await keyboardModel(page)).altRepeatKeys[index];
+  return { keycode: a.keycode.code, altKeycode: a.altKeycode.code, allowedMods: a.allowedMods, options: a.options };
+}
+
+/** Sets an alt-repeat key through the API */
+export async function setAltRepeat(page: Page, index: number, body: Awaited<ReturnType<typeof altRepeatAt>>) {
+  await put(page, `/api/alt-repeat/${index}`, body);
+}
+
+/** The keyboard's QMK settings, by qsid */
+export async function settingsOf(page: Page): Promise<Record<number, number>> {
+  const settings: { qsid: number; value: number }[] = (await keyboardModel(page)).settings;
+  return Object.fromEntries(settings.map((s) => [s.qsid, s.value]));
+}
+
+/** Puts QMK settings back through the API, those that differ */
+export async function setSettings(page: Page, settings: Record<number, number>): Promise<void> {
+  const now = await settingsOf(page);
+  for (const [qsid, value] of Object.entries(settings)) {
+    if (now[Number(qsid)] !== value) await put(page, `/api/qmk-settings/${qsid}`, { value });
+  }
+}
+
+/** Shows a section from the navigation and waits for its heading */
+export async function openSection(page: Page, name: string): Promise<void> {
+  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
+  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
+}
```

- [ ] **Step 2: Key overrides and alt-repeat keys**

Create `web/e2e/overrides.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import {
  altRepeatAt, expect, keyOverrideAt, openSection, restoreAll, setAltRepeat, setKeyOverride, test,
} from "./fixtures";

// The Key overrides and Alt-repeat pages: each entry is edited in a draft and saved with Save. Every test puts back
// what it changed (the worker's server is shared by its tests).

const EMPTY_OVERRIDE = { trigger: "KC_NO", replacement: "KC_NO", layers: 0, triggerMods: 0, negativeModMask: 0,
  suppressedMods: 0, options: 0 };

/** The picker's any-keycode box: type a keycode and use it */
async function pickAnyKeycode(page: Page, code: string) {
  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Any keycode").fill(code);
  await expect(picker.locator("#any-keycode-result")).toContainText(code);
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
}

test("a new key override: trigger, replacement, modifiers, an option and layers, saved", async ({ app }) => {
  const before = await keyOverrideAt(app, 2);
  try {
    await openSection(app, "Key overrides");
    await expect(app).toHaveTitle("Key overrides · Vial");
    await app.getByRole("button", { name: "New key override" }).click();
    await expect(app).toHaveURL(/#key-overrides\/2$/);
    const card = app.locator("#key-override-2");
    await expect(card).toHaveClass(/editing/);
    await expect(card).toContainText("nothing is kept until you save it");
    // the focus goes to the trigger
    const trigger = card.getByRole("button", { name: /^Trigger: nothing/ });
    await expect(trigger).toBeFocused();
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

    await trigger.click();
    await pickAnyKeycode(app, "KC_A");
    await card.getByRole("button", { name: /^Replacement:/ }).click();
    await pickAnyKeycode(app, "KC_B");
    await card.getByRole("group", { name: "Trigger modifiers" }).getByRole("button", { name: "Left Ctrl" }).click();
    await card.getByRole("group", { name: "Trigger modifiers" }).getByRole("button", { name: "Left Alt" }).click();
    await card.getByRole("checkbox", { name: "Any one trigger modifier is enough" }).check();
    const layers = card.getByRole("group", { name: "Layers" });
    await layers.getByRole("button", { name: "None" }).click();
    await layers.getByRole("button", { name: "Layer 2", exact: true }).click();
    await expect(layers.getByRole("button", { name: "Layer 2", exact: true })).toHaveAttribute("aria-pressed", "true");
    // the sentence follows the draft
    await expect(card.locator(".sentence")).toHaveText("Left Ctrl or Left Alt + A sends B, on Layer 2 only.");
    // nothing is on the keyboard yet
    expect(await keyOverrideAt(app, 2)).toEqual(before);

    const save = card.getByRole("button", { name: "Save" });
    await save.click();
    await expect(card).not.toHaveClass(/editing/);
    await expect(card.getByRole("heading", { name: "KO 2" })).toBeFocused();
    expect(await keyOverrideAt(app, 2)).toEqual({ trigger: "KC_A", replacement: "KC_B", layers: 0b100,
      triggerMods: 0b101, negativeModMask: 0, suppressedMods: 0, options: 0x8f });
    await expect(app.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Key overrides/ }))
      .toContainText("3");

    // edited again: switched off, then removed
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("switch", { name: "On" }).uncheck();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    expect((await keyOverrideAt(app, 2)).options).toBe(0x0f);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Remove" }).click();
    expect(await keyOverrideAt(app, 2)).toEqual(EMPTY_OVERRIDE);
  } finally {
    await setKeyOverride(app, 2, before);
  }
});

test("a key override on no layer, or with nothing to start it, says it never works; Cancel keeps it", async ({ app }) => {
  const before = await keyOverrideAt(app, 1);
  await openSection(app, "Key overrides");
  const card = app.locator("#key-override-1");
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("group", { name: "Layers" }).getByRole("button", { name: "None" }).click();
  await expect(card.locator(".problems")).toHaveText("It is on no layer of this keyboard, so it never works.");
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.locator(".problems")).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "KO 1" })).toBeFocused();
  expect(await keyOverrideAt(app, 1)).toEqual(before);
});

test("a key override's address opens and highlights its card", async ({ app }) => {
  await app.goto(new URL("#key-overrides/1", app.url()).toString());
  const card = app.locator("#key-override-1");
  await expect(card).toHaveClass(/target/);
  await expect(card.getByRole("heading", { name: "KO 1" })).toBeFocused();
  await expect(app).toHaveTitle("Key overrides · Vial");
});

test("an alt-repeat key is edited and saved", async ({ app }) => {
  const before = await altRepeatAt(app, 0);
  try {
    await openSection(app, "Alt-repeat");
    await expect(app).toHaveTitle("Alt-repeat · Vial");
    // the simulated keyboard has no Alt Repeat key
    await expect(app.getByRole("note")).toContainText("No key has Alt Repeat");
    const card = app.locator("#alt-repeat-0");
    await expect(card.locator(".sentence")).toHaveText(
      "After Left (alone, or with Shift), Alt Repeat sends Right, and the other way round.");
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(card.getByRole("button", { name: /^Last key: Left/ })).toBeFocused();
    await card.getByRole("button", { name: /^Alt key:/ }).click();
    await pickAnyKeycode(app, "KC_HOME");
    await card.getByRole("checkbox", { name: "Both ways" }).uncheck();
    await card.getByRole("group", { name: "Allowed modifiers" }).getByRole("button", { name: "Left Shift" }).click();
    await expect(card.locator(".sentence")).toHaveText("After Left, Alt Repeat sends Home.");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card).not.toHaveClass(/editing/);
    expect(await altRepeatAt(app, 0)).toEqual({ keycode: "KC_LEFT", altKeycode: "KC_HOME", allowedMods: 0, options: 0x0c });
  } finally {
    await restoreAll(() => setAltRepeat(app, 0, before));
  }
});
```

- [ ] **Step 3: Settings**

Create `web/e2e/settings.spec.ts`:

```ts
import { expect, openSection, setSettings, settingsOf, test } from "./fixtures";

// The QMK settings form: changes stay in the form until Save; Undo puts back what the keyboard holds; Reset to defaults
// asks first. The test puts the settings back as they were.

test("a setting is changed, undone, changed again and saved; then everything is reset", async ({ app }) => {
  const before = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    await expect(app).toHaveTitle("Settings · Vial");
    const term = app.getByRole("textbox", { name: "Tapping Term" });
    const permissive = app.getByRole("switch", { name: "Permissive Hold" });
    const status = app.locator(".savebar [role=status]");
    const save = app.locator(".savebar").getByRole("button", { name: "Save" });
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    await expect(term).toHaveValue("200");
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");

    await term.fill("250");
    await permissive.check();
    await expect(status).toHaveText("2 changes not saved yet");
    await expect(app.getByRole("heading", { name: /^Tap-Hold/ })).toContainText("2 changes");
    await undo.click();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");

    // a number out of its range can't be saved
    await term.fill("99999");
    await expect(term).toHaveAttribute("aria-invalid", "true");
    await expect(app.getByText("Not a whole number from 0 to 10000.")).toBeVisible();
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await term.fill("250");
    await permissive.check();
    await save.click();
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");
    // Save keeps the focus, though it has nothing left to save
    await expect(save).toBeFocused();
    const saved = await settingsOf(app);
    expect([saved[7], saved[22]]).toEqual([250, 1]);

    await app.getByRole("button", { name: "Reset to defaults…" }).click();
    const dialog = app.getByRole("dialog", { name: "Reset every setting?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Reset" }).click();
    await expect(dialog).toBeHidden();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    const reset = await settingsOf(app);
    expect([reset[7], reset[22]]).toEqual([200, 0]);
  } finally {
    await setSettings(app, before);
  }
});
```

- [ ] **Step 4: Layout files**

Create `web/e2e/layoutfile.spec.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  codeAt, expect, keyIndex, macrosOf, openSection, restoreAll, screenshots, setCodeAt, setMacros, simulatorUnlock,
  test, unlockAgain,
} from "./fixtures";

// Saving the layout to a .vil file and loading it back, with the preview of what changes. Every test puts back what it
// changed.

/** Saves the layout from the Keyboard page; returns the file's path */
async function saveLayout(page: Page, path: string): Promise<string> {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save layout" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Simulated Corne.vil");
  await download.saveAs(path);
  return path;
}

async function chooseFile(page: Page, path: string) {
  await page.getByLabel("Layout file to load").setInputFiles(path);
}

test("a saved layout loaded back shows what changes, and confirming puts it back", async ({ app }, info) => {
  const key = await keyIndex(app, 0, 0);
  const before = await codeAt(app, 0, key);
  try {
    await openSection(app, "Keyboard");
    await expect(app).toHaveTitle("Keyboard · Vial");
    const file = await saveLayout(app, info.outputPath("saved.vil"));
    await expect(app.getByText("Saved Simulated Corne.vil.")).toBeVisible();

    await setCodeAt(app, 0, key, "KC_Z");
    await chooseFile(app, file);
    const preview = app.getByRole("group", { name: /^Load saved\.vil\?/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(preview).toContainText("Loading it makes 1 change");
    await expect(preview).toContainText("Base, left top row, 1st from the outside: Z → Tab");
    await expect(preview).toContainText("Left as they are: tap dances, combos");
    await screenshots(app, "layout-file-preview", { fullPage: true });
    // nothing was written yet
    expect(await codeAt(app, 0, key)).toBe("KC_Z");

    await preview.getByRole("button", { name: "Load it" }).click();
    await expect(preview).toBeHidden();
    await expect(app.getByText("Loaded saved.vil: 1 change written to the keyboard.")).toBeVisible();
    await expect(app.getByRole("button", { name: "Load layout…" })).toBeFocused();
    expect(await codeAt(app, 0, key)).toBe(before);
  } finally {
    await setCodeAt(app, 0, key, before);
  }
});

test("another keyboard's file, or a broken one, is refused with a clear error", async ({ app }, info) => {
  await openSection(app, "Keyboard");
  const saved = await saveLayout(app, info.outputPath("mine.vil"));
  // another keyboard's ID (the file's own is 64 bits, more than a JavaScript number keeps: it is replaced as text)
  writeFileSync(info.outputPath("other.vil"), readFileSync(saved, "utf-8").replace(/"uid": \d+/, '"uid": 4660'));
  await chooseFile(app, info.outputPath("other.vil"));
  await expect(app.getByRole("alert")).toHaveText(
    "other.vil can't be loaded: this layout file is for another keyboard (ID 0000000000001234), not this one (ID 5EEDC0DE00420042)");

  writeFileSync(info.outputPath("broken.vil"), "{ not json");
  await chooseFile(app, info.outputPath("broken.vil"));
  await expect(app.getByRole("alert")).toContainText("broken.vil can't be loaded: not a valid Vial layout file");
  await expect(app.getByRole("group", { name: /^Load / })).toHaveCount(0);
});

test("a file that changes the macros, loaded on a locked keyboard, asks to unlock it first", async ({ app }, info) => {
  test.setTimeout(60_000);
  const before = await macrosOf(app);
  try {
    await app.setViewportSize({ width: 1920, height: 950 });
    await openSection(app, "Keyboard");
    const file = await saveLayout(app, info.outputPath("macros.vil"));
    await setMacros(app, before.map((m, i) => (i === 0 ? [{ type: "text", text: "changed" }] : m)));
    await simulatorUnlock(app, { locked: true });
    await app.reload();
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
    await expect(app.getByRole("heading", { level: 1, name: "Keyboard" })).toBeVisible();

    await chooseFile(app, file);
    const preview = app.getByRole("group", { name: /^Load macros\.vil\?/ });
    await expect(preview).toContainText("Macro 0: git status (2 steps)");
    await expect(preview).toContainText("the keyboard asks to be unlocked first");
    await preview.getByRole("button", { name: "Load it" }).click();

    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    // nothing was written while it is locked
    expect((await macrosOf(app))[0]).toEqual([{ type: "text", text: "changed", keys: [], delay: null }]);
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(app.getByText("Loaded macros.vil: 1 change written to the keyboard.")).toBeVisible();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await restoreAll(() => unlockAgain(app), () => setMacros(app, before));
  }
});
```

- [ ] **Step 5: Type-check, then build and run the new tests, then all of them**

```bash
cd web && npm run check && npm run build && npx playwright test e2e/overrides.spec.ts e2e/settings.spec.ts e2e/layoutfile.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `8 passed`.

```bash
cd web && npx playwright test
```

Expected: `92 passed`.

- [ ] **Step 6: Commit**

```bash
git add web/e2e/fixtures.ts \
  web/e2e/layoutfile.spec.ts \
  web/e2e/overrides.spec.ts \
  web/e2e/settings.spec.ts
git commit -m "test(web): end-to-end tests for key overrides, alt-repeat keys, settings and layout files"
```

### Task 18: Screenshots of the new pages, the README, and the final check

**The screenshot tests** (`feature-pages.spec.ts`) open the Key overrides, Alt-repeat, Settings and Keyboard pages at 800 × 900, 1280 × 800, 2560 × 1440 and 1920 × 950, in both themes. On each they check that nothing scrolls sideways and that the page is at most 860 px wide. At 1920 × 950 the key override and alt-repeat editors and the reset dialog fit in the window. At 375 px (a phone) the pages and the key override editor don't scroll sideways. Nothing in it changes the keyboard.

**The README** lists the new specs and the new folders (`src/settings/`, `src/about/`).

**Files:**
- Modify: `web/README.md`
- Test: `web/e2e/feature-pages.spec.ts` (new)

- [ ] **Step 1: The screenshot tests**

Create `web/e2e/feature-pages.spec.ts`:

```ts
import type { Locator, Page } from "@playwright/test";
import { expect, openSection, screenshots, test } from "./fixtures";

// The Key overrides, Alt-repeat, Settings and Keyboard pages at every window size, in both themes: no sideways scroll,
// at most 860 px wide, editors and dialogs inside a 1080p window. Nothing here changes the keyboard.

const PAGES = [
  ["Key overrides", "key-overrides"], ["Alt-repeat", "alt-repeat"], ["Settings", "settings"], ["Keyboard", "keyboard"],
] as const;

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function expectInWindow(page: Page, element: Locator) {
  const box = (await element.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

/** Every page settled: the settings read, so the screenshot shows them */
async function settled(page: Page, id: string) {
  if (id === "settings") await expect(page.getByRole("heading", { level: 2, name: /^Tap-Hold/ })).toBeVisible();
}

test.describe("screenshots of the feature pages", () => {
  for (const [width, height] of [[800, 900], [1280, 800], [2560, 1440], [1920, 950]]) {
    test(`${width} x ${height}: no sideways scroll, at most 860 px wide`, async ({ app }) => {
      await app.setViewportSize({ width, height });
      for (const [name, id] of PAGES) {
        await openSection(app, name);
        await settled(app, id);
        expect(await sidewaysScroll(app), name).toBeLessThanOrEqual(0);
        const page = (await app.locator(".page.list").boundingBox())!;
        expect(page.width).toBeLessThanOrEqual(860);
        await screenshots(app, `${id}-${width}x${height}`, { fullPage: true });
      }
    });
  }

  test("1920 x 950: the editors and the reset dialog fit the window", async ({ app }) => {
    await app.setViewportSize({ width: 1920, height: 950 });
    await openSection(app, "Key overrides");
    const card = app.locator("#key-override-0");
    await card.getByRole("button", { name: "Edit" }).click();
    const editor = card.locator(".editor");
    await expect(editor).toBeVisible();
    // the card scrolled into view takes no more than the window
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(950 - 80);
    await card.scrollIntoViewIfNeeded();
    await screenshots(app, "key-override-editor-1920x950");
    await card.getByRole("button", { name: "Cancel" }).click();

    await openSection(app, "Alt-repeat");
    const ark = app.locator("#alt-repeat-0");
    await ark.getByRole("button", { name: "Edit" }).click();
    await expect(ark.locator(".editor")).toBeVisible();
    await screenshots(app, "alt-repeat-editor-1920x950");
    await ark.getByRole("button", { name: "Cancel" }).click();

    await openSection(app, "Settings");
    await settled(app, "settings");
    await app.getByRole("button", { name: "Reset to defaults…" }).click();
    const dialog = app.getByRole("dialog", { name: "Reset every setting?" });
    await expect(dialog).toBeVisible();
    await expectInWindow(app, dialog);
    await screenshots(app, "settings-reset-dialog-1920x950");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(app.getByRole("button", { name: "Reset to defaults…" })).toBeFocused();
    // the Save bar stays at the window's bottom on a long form
    const bar = app.locator(".savebar");
    await expectInWindow(app, bar);
  });
});

test("375 px wide (a phone): the feature pages and their editors don't scroll sideways", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 812 });
  for (const [name, id] of PAGES) {
    await openSection(app, name);
    await settled(app, id);
    expect(await sidewaysScroll(app), name).toBeLessThanOrEqual(0);
    await screenshots(app, `${id}-375`, { fullPage: true });
  }
  await openSection(app, "Key overrides");
  await app.locator("#key-override-0").getByRole("button", { name: "Edit" }).click();
  await expect(app.locator("#key-override-0 .editor")).toBeVisible();
  expect(await sidewaysScroll(app), "the key override editor").toBeLessThanOrEqual(0);
  await screenshots(app, "key-override-editor-375", { fullPage: true });
  await app.locator("#key-override-0").getByRole("button", { name: "Cancel" }).click();
  await openSection(app, "Alt-repeat");
  await app.locator("#alt-repeat-0").getByRole("button", { name: "Edit" }).click();
  expect(await sidewaysScroll(app), "the alt-repeat editor").toBeLessThanOrEqual(0);
  await app.locator("#alt-repeat-0").getByRole("button", { name: "Cancel" }).click();
});
```

```bash
cd web && npx playwright test e2e/feature-pages.spec.ts
```

Expected: `6 passed`.

- [ ] **Step 2: The README**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -86,6 +86,10 @@ page.
 | `behaviours` | The Tap dance, Combos and Macros pages end to end, the top bar's Lock/Unlock, the pages at four window sizes and at 375 px |
 | `tapdance`, `combos`, `macros` | Editing on those pages: where the focus goes, saves that are slow or fail, recording keys |
 | `unlock` | The unlock dialog |
+| `overrides` | The Key overrides and Alt-repeat pages: a new key override built and saved, switched off, removed; an alt-repeat key edited |
+| `settings` | The QMK settings form: a change undone, a number out of range, Save, Reset to defaults with its confirmation |
+| `layoutfile` | Saving the layout, loading it back with its preview; another keyboard's file and a broken one; a file with macros on a locked keyboard |
+| `feature-pages` | The Key overrides, Alt-repeat, Settings and Keyboard pages at four window sizes and at 375 px, their editors and dialogs in a 1080p window |
 | `navigation` | The address and the back button, page titles, the focus, what the Keymap keeps while another page shows |

 The tests run in parallel: half the cores by default, or `E2E_WORKERS=<n> npx playwright test`
@@ -107,7 +111,9 @@ development machine, so no browser is downloaded there. CI installs that Chromiu
 | `src/keyboard/` | Drawing any keyboard from its geometry; key labels; combo marks on keys (`marks.ts`: underlines and dots) |
 | `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo marks and colours (`comboMarksOn`, `comboColours`), tap dance and macro usage, finding a character or key, and the phrases for them |
 | `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, layer cards, find box; what the page keeps while another one shows (`state.svelte.ts`) |
-| `src/behaviours/` | The Tap dance, Combos and Macros pages: their cards, the combo key chooser, the macro step editor and recorder, and the plain-language sentences |
+| `src/behaviours/` | The Tap dance, Combos, Macros, Key overrides and Alt-repeat pages: their cards and editors, the combo key chooser, the macro step editor and recorder, the modifier, layer and option controls, and the plain-language sentences |
+| `src/settings/` | The QMK settings form (Settings): the groups `qmk_settings.json` defines, what changed, Save, Undo and Reset |
+| `src/about/` | The Keyboard page: what the keyboard is (Qt's About keyboard), and saving and loading `.vil` layout files with a preview of what changes |
 | `src/picker/` | Keycode picker: search, categories, any-keycode entry |
 | `src/shell/` | Top bar (with the Lock/Unlock control), navigation, banners, toasts, the unlock dialog |
-| `src/ui/` | Small shared controls, and the name dialog (layers, tap dances, macros) |
+| `src/ui/` | Small shared controls (a switch), the name dialog (layers, tap dances, macros) and a confirmation dialog |
```

- [ ] **Step 3: Run every check**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `833 passed, 1 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  38 passed (38)` and `Tests  596 passed (596)` and `built in` and `src/api/schema.d.ts is up to date`.

- [ ] **Step 4: Commit**

```bash
git add web/README.md \
  web/e2e/feature-pages.spec.ts
git commit -m "test(web): screenshots of the phase 5a pages; README"
```

- [ ] **Step 5 (final): The whole e2e suite, with the screenshots copied for review.** `screenshots/` is excluded from git through `.git/info/exclude` (pattern `/screenshots/`). Run this from the main working tree, or replace `/t/others/vial-gui` with its path.

```bash
cd web && npm run e2e && rm -rf /t/others/vial-gui/screenshots/phase5 && mkdir -p /t/others/vial-gui/screenshots/phase5 && cp e2e/screenshots/key-override* e2e/screenshots/alt-repeat* e2e/screenshots/settings-* e2e/screenshots/keyboard-* e2e/screenshots/layout-file-preview-* /t/others/vial-gui/screenshots/phase5/ && echo "$(ls /t/others/vial-gui/screenshots/phase5 | wc -l) screenshots copied" && git -C /t/others/vial-gui check-ignore screenshots/phase5/settings-1280x800-light.png
```

Expected: `98 passed` and `50 screenshots copied` and `screenshots/phase5/settings-1280x800-light.png`.

Look at the new screenshots, each in `-light` and `-dark`:
- **The pages:** `key-overrides-`, `alt-repeat-`, `settings-` and `keyboard-` at `800x900`, `1280x800`, `2560x1440`, `1920x950` and `375`:
  - at most 860 px wide and centred, the navigation wrapped where it must;
  - the cards like those of the Tap dance, Combos and Macros pages;
  - the Settings page's groups, with switches in two columns where there is room;
  - nothing off the bottom at 1920x950, nothing sideways at 375.
- **Editors and dialogs:** `key-override-editor-1920x950` and `-375`, `alt-repeat-editor-1920x950`, `settings-reset-dialog-1920x950`: the editing card keeps its accent border; the dialog inside the window, Cancel focused.
- **The preview:** `layout-file-preview`: one change, "Base, left top row, 1st from the outside: Z → Tab", then "Left as they are: …".

Then hand over to the owner checklist above.

## Roadmap coverage

| Roadmap phase 5 item (5a part) | Task |
|---|---|
| Key overrides page: cards with trigger + mods → replacement | 8, 10; e2e in 17 |
| The options as plain checkboxes with explanations | 8 (`KEY_OVERRIDE_OPTIONS`), 9, 10 |
| The layer mask as layer chips | 8, 9, 10 |
| Alt-repeat page: keycode → alt keycode, the allowed mods and the options | 8, 9, 11; e2e in 17 |
| QMK settings page: grouped as `qmk_settings.json` defines them, from `/api/qmk-settings/definitions` | 3 (typed), 12, 13 |
| Booleans, integers with min/max, the bitfield options | 2 (the range on the server), 12, 13 |
| Reset to defaults, with a confirmation | 6, 13; e2e in 17 |
| `.vil` files: "Save layout" (download) | 3 (the name), 5, 15; e2e in 17 |
| "Load layout": upload with a preview of what changes and a confirmation | 4, 5, 6, 14, 15; e2e in 17 |
| A locked keyboard is never written in part; the UI unlocks and retries | 4 (pytest proof), 6, 15; e2e in 17 |
| About keyboard: name, UID, protocol versions, features | 14, 15 |
| e2e: one test per page against the simulator | 17, 18 |
| Navigation: the new sections with counts, hidden when the firmware has none; deep links; page titles | 7, 8, 16 |
| Owner's rules: widths (860 px), 1920 × 950, 375 px, names cut short with tooltips, Firefox-safe CSS, both themes | 9–15, 16 (the navigation wraps), 18 |
| Phase 4 owner feedback: the edited card's border, how saving works, a new entry not kept until saved | 10, 11, 13 |

The rest of phase 5 (lighting, layout options, the matrix tester, reboot to bootloader, the parity check) is phase 5b.

## Self-review

- **Spec coverage:** every 5a item of the roadmap's phase 5 scope maps to a task in the table above. The prototype brief's extra points are covered too: another keyboard's file refused (Task 4), the locked-upload proof (Task 4) and its e2e (Task 17), drafts and opened cards reset when `model.uid` changes (Tasks 10, 11, 13, 15), counts that update at once after an edit (Tasks 8, 16), layer bits beyond the keyboard's layers (Tasks 8, 9), and tests that put back what they change (Task 17).
- **Placeholder scan:** every code step gives the complete file or an exact diff. Every command has its expected output. Nothing is left to be filled in later. The deferred items are listed under "Out of scope / later phases" and are simply not built.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `content_disposition` and `layout_file_name` (Task 3); `SettingField`, `SettingsTab` and `SettingsDefinitions` (Task 3) by Tasks 5, 12 and 14;
  - `preview_layout_file`, `_layout_file_changes`, `OtherKeyboard`, `any_keyboard` and `model.macro` (Task 4); `LayoutFilePreview` (Task 4) by Tasks 5, 14 and 15;
  - `request(..., { raw })`, `download` and `attachmentName` (Task 5); `api.setKeyOverride`, `setAltRepeatKey`, `settingDefinitions`, `setSetting`, `resetSettings`, `layoutFile`, `previewLayoutFile` and `loadLayoutFile` (Task 5) by Tasks 6, 12 and 15;
  - `keyboard.setKeyOverride`, `setAltRepeatKey`, `setSettings`, `resetSettings` and `loadLayoutFile` (Task 6) by Tasks 10, 11, 13 and 15;
  - the `SectionId`s `key-overrides`, `alt-repeat`, `settings` and `keyboard` (Task 7) by Tasks 10, 11 and 16;
  - `MOD_NAMES`, `modBit`, `toggled`, `MASK_LAYERS`, `allLayers`, `OptionInfo`, `KEY_OVERRIDE_OPTIONS`, `ALT_REPEAT_OPTIONS`, `KeyOverrideDraft`, `AltRepeatDraft`, `NO_KEY`, the `*IsSet`, `free*`, `new*`, `cleared*` and `*Request` functions and the sentences (Task 8) by Tasks 9, 10, 11 and 14; `behaviourCounts`' `keyOverrides` and `altRepeat` (Task 8) by Task 16;
  - `Switch`, `ModToggles`, `LayerChips`, `OptionChecks` and `KeycodeButton` (Task 9) by Tasks 10, 11 and 13; the `override` tone (Task 9) by Tasks 10 and 11;
  - `settingGroups`, `valuesOf`, `isOn`, `withBit`, `numberProblem`, `changed`, `fieldChanged`, `groupChanges`, `changeCount` and `settingChanges`, and `settingDefinitions` (Task 12) by Tasks 13, 14 and 15;
  - `ConfirmDialog` (Task 13) by the Settings page, and its e2e checks in Tasks 17 and 18;
  - `aboutFacts`, `aboutText`, `previewSections`, `unchangedSections`, `changeTotal`, `layoutFileName` and `PreviewContext` (Task 14) by Task 15;
  - `KeyOverridesPage`, `AltRepeatPage`, `SettingsPage` and `KeyboardPage` (Tasks 10, 11, 13, 15) by Task 16;
  - `openSection`, `keyOverrideAt`, `setKeyOverride`, `altRepeatAt`, `setAltRepeat`, `settingsOf` and `setSettings` (Task 17) by Tasks 17 and 18.
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase5a` at `32eb6ae`). The plan was replayed mechanically from `main` and the result compared with it.
