# Phase 5b: Lighting, layout options, matrix tester, reboot to bootloader and the parity check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the web UI does everything else the Qt app does: a Lighting page (VialRGB, QMK RGB light, backlight) whose changes show at once and are kept once saved, a Layout page for the layout options, a Matrix tester that lights up the keys held, reboot to bootloader behind a confirmation, and `docs/parity.md`, which records where each Qt tab, menu and dialog lives in the web UI or why it is left out.

**Architecture:**
- **Simulator.** Lighting as vial-qmk runs it: an RGB light that is off takes no effect, colour or brightness; breathing keeps its brightness and the rainbow effects their hue; the backlight has a few brightness steps; VialRGB caps its brightness and turns off with "Disable". `vial_web.py --fake --lighting KIND` picks the lighting. A firmware built without the bootloader jump (VIAL_INSECURE) answers it as unhandled. Plugged in again, the keyboard starts with the lighting it saved, out of its bootloader.
- **Server.**
  - `PUT /api/lighting` shows a change and no longer keeps it; `POST /api/lighting/save` keeps it (Qt's Save). The reply is read back from the keyboard.
  - `DeviceManager.poll_matrix` reads the keys held (one request under the device lock); `KeyboardModel.matrixTester` says whether the keyboard can tell.
  - `MatrixWatcher`: on the existing `/api/events` socket a tab sends `{"type": "matrix", "watch": true}` and gets `matrix` events; one task reads about 20 times a second while any tab watches, leaving the keyboard alone at least 20 ms after each reading.
  - `PUT /api/simulator/matrix` (fake mode only, not in the schema) presses a simulated key.
  - `POST /api/bootloader`: 423 while locked, 422 for a firmware without the jump; after the jump the keyboard is closed with a `disconnected` event.
- **Web logic.** Pure modules with Vitest tests: `lighting/effects.ts`, `colour.ts`, `lighting.ts` (patches), `writer.ts` (`LatestWriter`: one write at a time, at most one every 80 ms, the last value last), `layout/options.ts`, `matrix/matrix.ts`, `lib/keyGuard.ts`, and `withLayoutChoice` and `layerFaces` in `keyboard/`.
- **Store.** `setLayoutOptions`, `setLighting`, `saveLighting`, `rebootToBootloader` through `#edit` (busy and pending, 423 → unlock → one retry); `watchMatrix()` and `matrix`; `inBootloader`.
- **UI.** Shared pieces first (the Save bar taken out of Settings, a list, a slider, lit keys, a banner that can take the focus), then the Lighting, Layout and Matrix tester pages, the Keyboard page's "Reboot to bootloader" card, and the navigation entries, each hidden when the keyboard lacks the feature.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2, pytest with pytest-xdist.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0.
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependencies: `web/package.json` and `web/package-lock.json` don't change. The colour picker is the browser's `<input type="color">` plus hue and saturation sliders.

**Roadmap (phase 5 scope):** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`, "Phase 5". Phase 5 is split: **5a** (key overrides, alt-repeat, QMK settings, `.vil` files, About) is done and on `main`; **5b** is this plan (lighting, layout options, the matrix tester, reboot to bootloader, the parity check). **Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md` (§4 API, §5 navigation and widths, §7 simulator).

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `vial_web.py --fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e fixtures start it exactly like that.
   - Never start the Qt app (`src/main/python/main.py`).
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry.
   - Tests use simulated keyboards only. The matrix tester is driven through the fake server's hook, and the bootloader jump is tried on the simulator only.
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
   - The fixtures' `app`, `macropad`, `eightLayers` and `qmkLighting` are one and the same Playwright page: a test uses one keyboard.
7. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
8. **Line endings and escapes:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings (Git Bash's `sed -i` strips the CRs; use an editor, or Python with `newline=''`). `git apply` keeps them.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
   - A script that writes code must write it as it is: a raw control byte once slipped into a test through an unescaped `\x01`. Check a written file with `git diff` before committing.
9. **Commits:** one commit per task, on branch `phase5b-parity`.
   - Add the files the task names. Never `git add -A`, and leave the untracked `gh.txt` alone.
   - End every commit message with the trailer the session tells you to use.
10. **How code is given.**
    - "Create `X`:" is followed by the file's complete content.
    - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
    - A file changed by several tasks has one diff in each. The tasks are in order, so each diff applies to what the task before left.
    - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it (Tasks 2 to 5), in the same commit as the schema change.
    - Each "Expected:" lists text that the command's output contains.
11. **Standing rules (roadmap and owner):**
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the keymap's content is at most 1100 px, the list and settings pages at most 860 px (`--list-max`), both centred. At 800 px and at 375 px nothing scrolls sideways.
    - Heights: the owner uses a 1080p screen, which leaves about 1920 × 950 px for the page. Pages, dialogs and the matrix tester's drawing with its grid fit there; the e2e tests check it.
    - Anything the user typed (layer, tap dance and macro names) is cut short with "…" and a tooltip with the full name wherever it shows.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike. A `-webkit-` property comes with its standard twin; range inputs are styled for both (`::-webkit-slider-thumb` and `::-moz-range-thumb`).
    - Both themes, light and dark, must read well.
    - **Owner feedback from phases 4 and 5a**, applied to every new page:
      - what is being edited keeps a visible border;
      - each page says how saving works (`PageHeader`'s `note`): the Lighting page keeps changes only once saved, the Layout page saves at once;
      - every sentence about what the keyboard does is true for the vial-qmk firmware (`vial` branch: `quantum/vial.c`, `via.c`, `vialrgb.c`, QMK's `rgblight.c`, `rgb_matrix.c`, `backlight.c`);
      - the simulator mirrors the real firmware's defaults and behaviour, so that what the tests see is what the keyboard does.
    - While a save runs, controls stay focusable (`aria-disabled`, not `disabled`), so the focus never falls to `<body>`.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

Phase 5a and the keymap's drag-to-swap are merged into `main` (at `425200f` or later), and `phase5b-parity` is branched from it. `.venv` exists and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `836 passed, 1 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  661 passed (661)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

```bash
cd web && npm run e2e
```

Expected: `118 passed`.

One phase 5a test is flaky under load: `overrides.spec.ts`, "a new key override: trigger, replacement, modifiers, an option and layers, saved", sometimes reads the key override before its second save has landed and fails with `expect(received).toBe(expected)` at `toBe(0x0f)`. It failed in 3 of the 22 full runs made while this plan was replayed (one of them on `main`, before Task 1), and never when run alone (80 of 80 with `--repeat-each 10`). If it is the only failure of a full run, run it again alone (`npx playwright test e2e/overrides.spec.ts`) and go on; this phase doesn't change it.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/protocol/constants.py` | `CMD_VIA_BOOTLOADER_JUMP` and `VIA_ID_UNHANDLED`, shared by the simulator and the server |
| `src/main/python/simulator/virtual_keyboard.py` | Lighting kept as each kind's firmware code keeps it (`_lighting_set`, `_rgblight_sethsv`), the backlight's levels and breathing, `lighting_saved` and `lighting_now()`, `bootloader_jump=False` (VIAL_INSECURE), `plug_in()` with the lighting saved (`lighting_kept`) |
| `src/main/python/simulator/corne.py` | `LIGHTING`, the kinds `vial.json` can name; `definition(lighting)` and `make_corne(lighting=…)` |
| `src/main/python/vial_web.py` | `--lighting KIND` (fake mode only), `LIGHTING_KINDS` |
| `src/main/python/server/edits.py` | `set_lighting` shows a change (VialRGB in one request, an RGB light effect sent twice after "off", the reply read back); `save_lighting` |
| `src/main/python/server/device.py` | `FakeBackend.set_connected` plugs the simulator in with `plug_in()`; `has_matrix_tester`, `matrix_pressed`, `MatrixReading`, `DeviceManager.poll_matrix`; `DeviceManager.reboot_to_bootloader` |
| `src/main/python/server/schemas.py` | `LightingIn` without `save`; `KeyboardModel.matrixTester`; `MatrixState`, the `matrix` event; `SimulatorPress` |
| `src/main/python/server/model.py` | `matrixTester` in the model |
| `src/main/python/server/app.py` | `POST /api/lighting/save`; `MatrixWatcher`, the events socket's messages, `PUT /api/simulator/matrix` (fake only); `POST /api/bootloader` |
| `src/main/python/protocol/keyboard_comm.py` | `check_protocol_version` says which protocols it found |
| `src/main/python/test/test_lighting.py` | **new.** Each lighting kind against the simulator: what is sent, what the firmware ignores, kept only once saved, a replug |
| `src/main/python/test/test_matrix.py` | **new.** Reading the matrix, watching it over the WebSocket, pacing, the fake hook, the bootloader |
| `src/main/python/test/test_simulator.py`, `test_vial_web.py`, `test_api.py`, `test_api_validation.py`, `test_dump_openapi.py`, `test_device_manager.py` | The simulator's lighting and bootloader options, `--lighting`, the routes in and out of the schema, an unknown protocol named |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` |
| `web/src/api/api.ts`, `types.ts` | the new routes and types |
| `web/src/api/events.ts` | `connectEvents` returns an `EventsLink` that can also send (`{"type": "matrix", "watch": …}`); `matrix` events |
| `web/src/analysis/testing.ts` | the test model has `matrixTester` |
| `web/src/lib/keyboard.svelte.ts` | `setLayoutOptions`, `setLighting`, `saveLighting`, `rebootToBootloader`, `inBootloader`, `watchMatrix()` and `matrix` |
| `web/src/lib/route.ts` | `#layout`, `#lighting`, `#matrix`; a section with no entries never gets a number |
| `web/src/keyboard/geometry.ts`, `labels.ts` | `choiceCount`, `withLayoutChoice`; `layerFaces` |
| `web/src/lib/keyGuard.ts` | **new.** `KeyGuard`: keys pressed do nothing on the page (the unlock dialog, the matrix tester) |
| `web/src/shell/UnlockDialog.svelte` | uses `layerFaces` and `KeyGuard` |
| `web/src/ui/SaveBar.svelte`, `SelectField.svelte`, `Slider.svelte` | **new.** The sticky Save bar (taken out of `settings/SettingsPage.svelte`), a labelled list, a labelled slider with its value in words |
| `web/src/keyboard/Key.svelte`, `Keyboard.svelte` | `pressed`: keys lit up as held |
| `web/src/shell/Banner.svelte` | an `id` and `tabindex="-1"`, so it can take the focus |
| `web/src/lighting/effects.ts`, `colour.ts`, `lighting.ts`, `writer.ts`, `state.svelte.ts` | **new.** Effects by name and what the firmware ignores under them; colours; patches; `LatestWriter`; the baseline Undo goes back to |
| `web/src/lighting/LightingPage.svelte`, `LightingCard.svelte`, `VialRgbCard.svelte`, `RgbLightCard.svelte`, `BacklightCard.svelte`, `ColourPicker.svelte` | **new.** The Lighting page |
| `web/src/layout/options.ts`, `LayoutPage.svelte` | **new.** The Layout page |
| `web/src/matrix/matrix.ts`, `state.svelte.ts`, `MatrixGrid.svelte`, `MatrixPage.svelte` | **new.** The Matrix tester page |
| `web/src/about/BootloaderCard.svelte`, `KeyboardPage.svelte` | **new** card: Reboot to bootloader, on the Keyboard page |
| `web/src/App.svelte` | the new sections and pages; the bootloader banner; a keyboard found but not read; the udev hint |
| `web/e2e/servers.ts`, `fixtures.ts` | the `qmkLighting` server (`--lighting qmk_backlight_rgblight`); `lightingOf`, `setLighting`, `pressKey`, `plugIn` |
| `web/e2e/lighting.spec.ts`, `layout.spec.ts`, `matrix.spec.ts`, `bootloader.spec.ts`, `p5b-pages.spec.ts` | **new.** e2e for the pages and the screenshots |
| `docs/parity.md` | **new.** Every Qt tab, menu and dialog, and where it is in the web UI or why not |
| `web/README.md` | `--lighting`, the new hooks, specs and folders, a link to `docs/parity.md` |

## Decisions

These come from the verified prototype. The owner may want to review them.

1. **Lighting is kept only after Save, as in Qt.**
   - Qt's Lighting tab sends each change at once with the firmware's `noeeprom` setters, and its Save button sends `id_lighting_save`. via.c's save updates the EEPROM copies of the backlight, the RGB light and VialRGB (`vialrgb_save` flushes the RGB matrix's). A change Qt hasn't saved is gone after a power cycle.
   - The server used to save on every `PUT /api/lighting` (`save: true` by default): a dragged slider would have written the EEPROM over and over. Now `PUT /api/lighting` shows a change and `POST /api/lighting/save` keeps it; the `save` field is gone.
   - The page says so: "Changes show on the keyboard at once, and it keeps them only once you Save: unplugged before that, it goes back to the lighting it had saved." Its sticky Save/Undo bar is the one Settings uses. Undo puts back the lighting saved here last, or what the keyboard showed when the page first opened (kept per keyboard while other pages show).
2. **The firmware's quirks, followed by the page and the simulator** (checked in vial-qmk's `vial` branch: via.c, vialrgb.c, rgblight.c, rgb_matrix.c, backlight.c):
   - **QMK RGB light:** a light that is off takes no effect (`rgblight_mode_noeeprom` returns early, and turning it on restarts the effect it had), so the server sends an effect chosen from "All Off" twice; Qt sends it once, which is a Qt bug. While it is off, colour and brightness are ignored. Breathing keeps its brightness, and Rainbow Mood and Rainbow Swirl keep their hue; the page says so under those effects. The speed is stored but no effect uses it, so the page doesn't show it, as Qt doesn't. Effect numbers shift when a firmware builds in only some effects (`rgblight_modes.h`); the page says so.
   - **VialRGB:** effect, speed and colour go in one request (the server now sends one packet instead of three). "Disable" turns the matrix off, and then colour and brightness are ignored. The brightness is capped at `RGB_MATRIX_MAXIMUM_BRIGHTNESS`: the slider stops there, and its percentage is of that maximum.
   - **Backlight:** a brightness becomes level = v × LEVELS / 255 and reads back as level × 255 / LEVELS (3 levels by default). Breathing works only with `BACKLIGHT_BREATHING`; without it the effect reads 0.
   - **Every reply is read back from the keyboard** (`reload_rgb`, as Qt does after a change), so the page shows only what the keyboard took.
3. **Slider writes are throttled.** `LatestWriter` sends one write at a time, at most one every 80 ms. Changes made meanwhile are merged, so the last value always arrives last. A burst of 100 slider moves makes 2 or 3 writes (checked in e2e). Controls aren't blocked while a write runs; Save and Undo are `aria-disabled` while anything is sending, and keep the focus.
4. **No lighting, no Lighting page, and no lighting text anywhere.** A keyboard without lighting has no Lighting entry, and `#lighting` falls back to the keymap. The e2e test on the macropad (no lighting) checks that no page mentions lighting, RGB or backlight. The owner's W-CORNE has no lighting, so only the simulator tests and the firmware source verify the lighting.
5. **Layout options are their own navigation entry, "Layout", saved at once.** It matches Qt's tab and appears only when the keyboard has layout options; the dense Keymap page stays as it is. via.c writes them straight to its EEPROM, so the page saves each change at once and says so. Every drawing (Keymap, Overview, the unlock dialog, the matrix tester) follows the model. `withLayoutChoice` packs a choice exactly as `layoutChoices` reads it and keeps the bits above the options as the keyboard holds them (Qt clears them; nothing reads them).
6. **The matrix tester.**
   - **Polling:** the existing `/api/events` socket. A tab sends `{"type": "matrix", "watch": true|false}`. One `MatrixWatcher` task reads while any tab watches and stops when none does. A reading every 50 ms (about 20 Hz), and at least 20 ms with the keyboard left alone after each one, however long it took: edits and the unlock countdown get the device lock in between (tested). A tab gets a `matrix` event at every change; a new watcher gets the last reading at once.
   - **Locked:** a locked keyboard, or one waiting for its unlock keys, isn't asked; the reading says `locked`. Start testing unlocks first, with the phase 4 dialog.
   - **Availability** follows Qt's `valid()`: Vial protocol 3 or later, and `(cols / 8 + 1) × rows ≤ 28` (`KeyboardModel.matrixTester`).
   - **Keys typed do nothing while testing** (`KeyGuard`, as Qt grabs the keyboard). Start and Stop are one button, so the focus stays on it.
   - **The drawing** shows the base layer in plain tones; held keys are filled with the accent colour, keys pressed before keep a green ring. **The switch-matrix grid** shows every row and column, so a position with no key is visible (dashed); held is filled, pressed before has a green dot. What was pressed is kept per keyboard while other pages show; Reset clears it.
7. **Reboot to bootloader is on the Keyboard page, behind a confirmation.** The ConfirmDialog has the focus on Cancel and says the keyboard "stops working as a keyboard and disappears from Vial until it is flashed, or unplugged and plugged back in". `POST /api/bootloader` checks `require_unlocked` first, as Qt runs `Unlocker.unlock` before `reset()`: a locked keyboard gets 423 and the store unlocks and sends it again. It is sent once, because a second send would reach the bootloader. A firmware built without the jump (VIAL_INSECURE) answers `id_unhandled`: 422 with the reason, and the keyboard stays. After the jump the page is greyed out and a banner, which takes the focus, says "The keyboard is in its bootloader".
8. **The parity document** (`docs/parity.md`, linked from `web/README.md`) lists every Qt tab, menu item and dialog. **Dropped:** Sideload VIA JSON and Download VIA definitions (roadmap decision 5), Load dummy JSON (`--fake --definition` replaces it), Qt's extra colour themes, the example-UID warning, and the menu shortcuts (Ctrl+O and Ctrl+S belong to the browser). **Later:** the firmware updater (phase 7) and About Vial (phase 6). **Gaps it found and this plan fixes** (Task 6): "Unsupported protocol" showed as "No keyboard found", and the Linux udev hint was missing.

## Out of scope / later phases

- **Not built in 5b:**
  - **Choosing among several Vial keyboards plugged in at once** (Qt's keyboard list). The server uses the first one found. It needs a list in the session and a route to pick one, and the owner's decision; `docs/parity.md` records it as a gap.
  - **"In its bootloader" is known only to the tab that rebooted the keyboard.** Other tabs, and the top bar's status, say "Keyboard unplugged". An event type for it would fix this.
  - **The simulator doesn't lock again after a replug**, as real firmware does.
  - **QMK RGB light Undo can't restore a brightness while the current effect is breathing,** because the firmware ignores it; the page then still shows the change, truthfully. Sending colour, then effect, then colour again would fix it.
- **Earlier code a later plan should fix:**
  - `MatrixWatcher` sends through `EventHub._send`, a private method, to reach one tab and drop it on failure: `EventHub` should have a public `send_to(ws, event)`.
  - The generated `Event` type marks `unlock` and `matrix` as required but nullable, while the server leaves them out; tests fill them in (`keyboard.test.ts`'s `send`). Optional pydantic fields without defaults, or `exclude_none`, would make the types honest.
  - The model has no backlight level count or RGB light limit, because the protocol doesn't report them: the page can only say "a few brightness steps (3, unless its firmware sets another number)".
  - `RgbLightIn.speed` stays in the API though nothing uses it: vial-qmk's RGB light effects ignore it.
  - `set_lighting` reads all the lighting back after every write: 1 request for VialRGB, up to 6 for RGB light plus backlight. At about 12 writes a second that is fine; a targeted readback would be lighter.
  - The fixtures' `app`, `macropad`, `eightLayers` and `qmkLighting` are the same Playwright page, so a test can use only one keyboard (`p5b-pages.spec.ts` splits its tests per keyboard for this). A comment in `fixtures.ts`, or separate pages, would help.
  - The phase 5a e2e test `overrides.spec.ts`, "a new key override: …", reads the key override right after "Off" shows, before the save has always landed: its `expect((await keyOverrideAt(app, 2)).options).toBe(0x0f)` should be an `expect.poll`.
  - The phase 5a follow-ups in `route.ts` are fixed here (Task 8): `routeHash` no longer builds `#settings/2`, `WHOLE` and `SECTIONS` are read-only, the redundant HOME branch is gone, and the tests cover `#keyboard/3` and the round trips.

## Owner checklist (after the last task, on the W-CORNE)

The owner runs this, not you. The W-CORNE has **no lighting**.

1. Close the Qt Vial app. Build the UI (`cd web && npm ci && npm run build`), then run `python src/main/python/vial_web.py`.
2. **No lighting anywhere.** The navigation has no Lighting entry, and no page mentions lighting, RGB or backlight.
3. **Layout.** If the keyboard has layout options, the navigation has "Layout": change one, see the Keymap drawing follow, then put it back. If it has none, check that the entry is hidden.
4. **Matrix tester.** Click Start testing and unlock with the keys the dialog shows. Press every key: each lights up while held and keeps its green ring afterwards; the summary counts them. Click Stop testing, then check that keys typed work on the page again.
5. **Reboot to bootloader**, only if you want to (the keyboard stops working until it is replugged or flashed). At least open the confirmation on the Keyboard page and Cancel it: the focus returns to the button.
6. **Parity.** Read `docs/parity.md` and confirm that nothing you use in Qt is missing.
7. **Every new page in Firefox at 1080p, in both themes:** Layout (if shown), Matrix tester and the Keyboard page's new card, in a maximised Firefox window on the 1080p screen, light and dark. Nothing runs off the bottom or sideways.

---

### Task 1: The simulator runs lighting as vial-qmk does; `--lighting`; firmware without the bootloader jump

The simulated keyboard kept whatever lighting values it was sent. Real firmware doesn't, and the Lighting page must show what the keyboard really does, so the simulator now keeps each kind of lighting as its firmware code in vial-qmk does (the server and the page come later):

- **QMK RGB light** (`rgblight.c`, via.c): it is on or off, with a mode, hue, saturation, brightness ("val") and speed. A mode sent while it is off isn't taken (`rgblight_mode_noeeprom` returns early), and 0 turns it off; any other mode turns it on with the mode it had. Colour and brightness are ignored while it is off; breathing (modes 2 to 5) keeps its brightness and the rainbows (6 to 14) their hue. Reading the effect gives 0 while it is off.
- **Backlight** (`backlight.c`, via.c): a level from 0 to `BACKLIGHT_LEVELS` (3 by default): a brightness v becomes level v × levels / 255, read back as level × 255 / levels. Breathing only with `BACKLIGHT_BREATHING`.
- **VialRGB** (`vialrgb.c`): effect 0 ("Disable") turns the matrix off and reads back as 0; colour is ignored while it is off; the brightness is capped at the maximum.
- **Saving** (`id_lighting_save`) keeps a copy of each kind: `lighting_saved` (None before a save) and `lighting_now()` let tests compare.
- **`bootloader_jump=False`** is a firmware built with VIAL_INSECURE: via.c doesn't handle the jump and answers `id_unhandled` (0xFF).

`make_corne(lighting=…)` and `vial_web.py --fake --lighting KIND` give the simulated Corne any lighting `vial.json` can name (`none`, `qmk_backlight`, `qmk_rgblight`, `qmk_backlight_rgblight`, `vialrgb`); with `--definition`, `--lighting` replaces the file's.

**Files:**
- Modify: `src/main/python/protocol/constants.py`
- Modify: `src/main/python/simulator/corne.py`
- Modify: `src/main/python/simulator/virtual_keyboard.py`
- Modify: `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_simulator.py`
- Test: `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_simulator.py`:

```diff
diff --git a/src/main/python/test/test_simulator.py b/src/main/python/test/test_simulator.py
--- a/src/main/python/test/test_simulator.py
+++ b/src/main/python/test/test_simulator.py
@@ -459,3 +459,30 @@ def test_unknown_qsid_lookup_does_not_make_it_supported(lookup):
         lookup(60000)
     assert not QmkSettingsCodec.is_qsid_supported(60000)
     assert 60000 not in QmkSettingsCodec.fields()
+
+
+def test_firmware_without_the_bootloader_jump_answers_it_unhandled():
+    vk = VirtualKeyboard(make_corne().definition, bootloader_jump=False)
+    reply = send(vk, bytes([CMD_VIA_BOOTLOADER_JUMP]))
+    assert reply[0] == 0xFF
+    assert vk.connected and not vk.bootloader_requested
+
+
+@pytest.mark.parametrize("levels", [0, 32])
+def test_backlight_levels_are_checked(levels):
+    with pytest.raises(SimulatorError):
+        VirtualKeyboard(make_corne(lighting="qmk_backlight").definition, backlight_levels=levels)
+
+
+def test_backlight_brightness_steps_follow_the_levels():
+    vk = VirtualKeyboard(make_corne(lighting="qmk_backlight").definition, backlight_levels=5)
+    kb = Keyboard(SimulatedHidDevice(vk))
+    kb.reload()
+    kb.set_qmk_backlight_brightness(160)  # 160 * 5 / 255 = level 3
+    kb.reload_rgb()
+    assert vk.backlight["level"] == 3 and kb.backlight_brightness == 153
+
+
+def test_unknown_lighting_is_refused():
+    with pytest.raises(ValueError):
+        make_corne(lighting="rgb_matrix")
```

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -15,7 +15,7 @@ import vial_web
 from protocol.unlock_hook import set_unlock_handler
 from server import device as device_module
 from server.device import DeviceManager, HidBackend
-from simulator.corne import encode
+from simulator.corne import LIGHTING, definition, encode
 from simulator.device import SimulatedHidDevice
 from test.test_core_isolation import run_isolated
 
@@ -915,3 +915,27 @@ def test_launch_without_data_dir_uses_the_user_dirs_again(tmp_path, home, fake_s
     assert vial_web.main(["--fake", "--no-browser"]) == 0
     assert vial_web.data_dir(True) != str(tmp_path / "elsewhere" / "fake")
     assert not os.path.exists(tmp_path / "elsewhere")
+
+
+@pytest.mark.parametrize("lighting", ["none", "qmk_backlight", "qmk_rgblight", "qmk_backlight_rgblight", "vialrgb"])
+def test_fake_lighting_of_the_corne_and_of_a_definition(lighting, tmp_path):
+    vk = vial_web.make_backend(vial_web.parse_args(["--fake", "--lighting", lighting])).keyboard_factory()
+    assert vk.definition["lighting"] == lighting
+    assert (vk.rgblight is not None) == ("rgblight" in lighting)
+    assert (vk.backlight is not None) == ("backlight" in lighting)
+    assert (vk.vialrgb is not None) == (lighting == "vialrgb")
+    path = tmp_path / "vial.json"
+    path.write_text(json.dumps(dict(definition(), lighting="none")), encoding="utf-8")
+    other = vial_web.make_backend(vial_web.parse_args(["--fake", "--definition", str(path), "--lighting", lighting]))
+    assert other.keyboard_factory().definition["lighting"] == lighting
+
+
+def test_fake_lighting_defaults_to_the_definitions_and_is_checked(capsys):
+    assert vial_web.make_backend(vial_web.parse_args(["--fake"])).keyboard_factory().definition["lighting"] == \
+        "vialrgb"
+    assert vial_web.LIGHTING_KINDS == LIGHTING
+    with pytest.raises(SystemExit):
+        vial_web.parse_args(["--fake", "--lighting", "rgb_matrix"])
+    with pytest.raises(SystemExit):
+        vial_web.parse_args(["--lighting", "vialrgb"])
+    assert "only work with --fake" in capsys.readouterr().err
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py test/test_vial_web.py
```

Expected: `ImportError: cannot import name 'LIGHTING' from 'simulator.corne'` and `1 error`: the tests need the simulator's new names.

- [ ] **Step 3: The constants, the simulated Corne and `--lighting`**

Apply to `src/main/python/protocol/constants.py`:

```diff
diff --git a/src/main/python/protocol/constants.py b/src/main/python/protocol/constants.py
--- a/src/main/python/protocol/constants.py
+++ b/src/main/python/protocol/constants.py
@@ -8,6 +8,7 @@ CMD_VIA_SET_KEYCODE = 0x05
 CMD_VIA_LIGHTING_SET_VALUE = 0x07
 CMD_VIA_LIGHTING_GET_VALUE = 0x08
 CMD_VIA_LIGHTING_SAVE = 0x09
+CMD_VIA_BOOTLOADER_JUMP = 0x0B
 CMD_VIA_MACRO_GET_COUNT = 0x0C
 CMD_VIA_MACRO_GET_BUFFER_SIZE = 0x0D
 CMD_VIA_MACRO_GET_BUFFER = 0x0E
@@ -23,6 +24,7 @@ QMK_RGBLIGHT_BRIGHTNESS = 0x80
 QMK_RGBLIGHT_EFFECT = 0x81
 QMK_RGBLIGHT_EFFECT_SPEED = 0x82
 QMK_RGBLIGHT_COLOR = 0x83
+VIA_ID_UNHANDLED = 0xFF
 VIALRGB_GET_INFO = 0x40
 VIALRGB_GET_MODE = 0x41
 VIALRGB_GET_SUPPORTED = 0x42
```

Apply to `src/main/python/simulator/corne.py`:

```diff
diff --git a/src/main/python/simulator/corne.py b/src/main/python/simulator/corne.py
--- a/src/main/python/simulator/corne.py
+++ b/src/main/python/simulator/corne.py
@@ -18,8 +18,13 @@ UNLOCK_KEYS = [LEFT[0][0], RIGHT[0][5]]
 """ held to unlock the keyboard: the outermost keys of both top rows (Tab and Backspace) """
 
 
-def definition():
-    """ vial.json for the simulated keyboard (KLE layout, matrix 8x6, VialRGB lighting) """
+LIGHTING = ("none", "qmk_backlight", "qmk_rgblight", "qmk_backlight_rgblight", "vialrgb")
+""" what vial.json's "lighting" can say, as the protocol code reads it (keyboard_comm.reload_persistent_rgb) """
+
+
+def definition(lighting="vialrgb"):
+    """ vial.json for the simulated keyboard (KLE layout, matrix 8x6); VialRGB lighting unless `lighting` (one of
+    LIGHTING) says otherwise """
     rows = []
     for r in range(3):
         rows.append(["{},{}".format(*rc) for rc in LEFT[r]] + [{"x": 3}] + ["{},{}".format(*rc) for rc in RIGHT[r]])
@@ -29,7 +34,7 @@ def definition():
         "name": "Simulated Corne",
         "vendorId": "0xFEED",
         "productId": "0x0042",
-        "lighting": "vialrgb",
+        "lighting": lighting,
         "matrix": {"rows": 8, "cols": 6},
         "layouts": {"keymap": rows},
     }
@@ -122,13 +127,15 @@ def macros():
     return b"\x00".join(data) + b"\x00"
 
 
-def make_corne(layers=len(LAYERS)):
+def make_corne(layers=len(LAYERS), lighting="vialrgb"):
     """ A fresh simulated Corne; nothing is shared between calls. With more layers than the sample keymap has, the
-    others are empty (KC_NO); with fewer, the sample's last layers are left out. """
+    others are empty (KC_NO); with fewer, the sample's last layers are left out. `lighting`: one of LIGHTING """
+    if lighting not in LIGHTING:
+        raise ValueError("unknown lighting {!r}".format(lighting))
     ko_options_enabled = 0b1000_0111  # enabled, activates on trigger down / required mod down / negative mod up
     ark_options = 0b1110  # enabled, ignore mod handedness, bidirectional
     return VirtualKeyboard(
-        definition(),
+        definition(lighting),
         layers=layers,
         keymap=keymap(layers),
         uid=CORNE_UID,
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -37,6 +37,9 @@ MAX_FAKE_LAYERS = 32
 """ --layers: Vial keyboards have at most 32 layers, as many as MO, TG, DF and OSL can name (LT, LM and protocol 5's
 TO only reach the first 16) """
 MAX_UNLOCK_COUNTER = 255
+LIGHTING_KINDS = ("none", "qmk_backlight", "qmk_rgblight", "qmk_backlight_rgblight", "vialrgb")
+""" --lighting: what vial.json's "lighting" can say (simulator.corne.LIGHTING; not imported, as a real launch never
+loads the simulator) """
 """ --unlock-counter: the firmware's VIAL_UNLOCK_COUNTER_MAX fits in one byte of the unlock poll's reply """
 UVICORN_LOGGING = {
     "version": 1,
@@ -291,9 +294,12 @@ def make_backend(args):
             from simulator.virtual_keyboard import VirtualKeyboard
             with open(args.definition, "r", encoding="utf-8") as inf:
                 definition = json.load(inf)
+            if args.lighting is not None:
+                definition["lighting"] = args.lighting
             return FakeBackend(lambda: firmware_timed(VirtualKeyboard(definition, **layers)))
         from simulator.corne import make_corne
-        return FakeBackend(lambda: firmware_timed(make_corne(**layers)))
+        lighting = {} if args.lighting is None else {"lighting": args.lighting}
+        return FakeBackend(lambda: firmware_timed(make_corne(**layers, **lighting)))
     from server.device import HidBackend
     return HidBackend()
 
@@ -339,6 +345,9 @@ def parse_args(argv):
     parser.add_argument("--unlock-counter", type=unlock_counter,
                         help="with --fake: how many polls the unlock keys must be held for, about 0.2 s each (1 to "
                              "{}; default: the firmware's 50, about 10 s)".format(MAX_UNLOCK_COUNTER))
+    parser.add_argument("--lighting", choices=LIGHTING_KINDS,
+                        help="with --fake: the lighting the simulated keyboard has (default: what its definition says; "
+                             "VialRGB for the sample Corne)")
     parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
     parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
     parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
@@ -346,8 +355,8 @@ def parse_args(argv):
                         help="keep the instance lock, session file, log and names in this folder instead of the "
                              "user's data and config folders (for tests and development)")
     args = parser.parse_args(argv)
-    if (args.definition or args.layout or args.layers or args.unlock_counter) and not args.fake:
-        parser.error("--definition, --layout, --layers and --unlock-counter only work with --fake")
+    if (args.definition or args.layout or args.layers or args.unlock_counter or args.lighting) and not args.fake:
+        parser.error("--definition, --layout, --layers, --unlock-counter and --lighting only work with --fake")
     return args
 
 
```

- [ ] **Step 4: The lighting as the firmware keeps it, and the jump a VIAL_INSECURE build lacks**

Apply to `src/main/python/simulator/virtual_keyboard.py`:

```diff
diff --git a/src/main/python/simulator/virtual_keyboard.py b/src/main/python/simulator/virtual_keyboard.py
--- a/src/main/python/simulator/virtual_keyboard.py
+++ b/src/main/python/simulator/virtual_keyboard.py
@@ -23,13 +23,13 @@ from protocol.constants import CMD_VIA_GET_PROTOCOL_VERSION, CMD_VIA_GET_KEYBOAR
     CMD_VIAL_QMK_SETTINGS_SET, CMD_VIAL_QMK_SETTINGS_RESET, CMD_VIAL_DYNAMIC_ENTRY_OP, \
     DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES, DYNAMIC_VIAL_TAP_DANCE_GET, DYNAMIC_VIAL_TAP_DANCE_SET, \
     DYNAMIC_VIAL_COMBO_GET, DYNAMIC_VIAL_COMBO_SET, DYNAMIC_VIAL_KEY_OVERRIDE_GET, DYNAMIC_VIAL_KEY_OVERRIDE_SET, \
-    DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, BUFFER_FETCH_CHUNK
+    DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, DYNAMIC_VIAL_ALT_REPEAT_KEY_SET, BUFFER_FETCH_CHUNK, CMD_VIA_BOOTLOADER_JUMP, \
+    VIA_ID_UNHANDLED
 from keycodes.keycodes_v5 import keycodes_v5
 from keycodes.keycodes_v6 import keycodes_v6
 from kle_serial import Serial as KleSerial
 from protocol.qmk_settings_codec import QmkSettingsCodec
 
-CMD_VIA_BOOTLOADER_JUMP = 0x0B
 # polls the firmware wants the unlock keys held for (VIAL_UNLOCK_COUNTER_MAX). The firmware counts down only on a poll
 # that comes MORE than 100 ms after the unlock start or the last count-down; a poll within 100 ms starts the count
 # again, even with the keys held. Hosts must therefore poll slower than that (Qt and our server poll every 200 ms).
@@ -48,6 +48,16 @@ UNKNOWN_SETTING_WIDTH = 4
 FEATURE_CAPS_WORD = 1 << 0
 FEATURE_LAYER_LOCK = 1 << 1
 NO_MORE = 0xFFFF
+# QMK RGB light (quantum/rgblight): the effects as numbered with every one of them built in (rgblight_modes.h): Vial's
+# list (Qt's rgb_configurator.py) ends at 36, then Twinkle takes 37 to 42. Breathing (2-5) keeps its own brightness and
+# the rainbow effects (6-14) their own hue: the firmware ignores those when it is sent a colour.
+RGBLIGHT_MODES = 42
+RGBLIGHT_BREATHING = range(2, 6)
+RGBLIGHT_RAINBOW = range(6, 15)
+# QMK backlight: the firmware's default number of brightness steps above off (BACKLIGHT_LEVELS)
+BACKLIGHT_LEVELS = 3
+# VialRGB's "off" effect, which turns the RGB matrix off (vialrgb.c)
+VIALRGB_EFFECT_OFF = 0
 
 
 class SimulatorError(RuntimeError):
@@ -60,7 +70,8 @@ class VirtualKeyboard:
                  via_protocol=9, macro_count=8, macro_memory=512, macros=b"", tap_dance=None, combos=None,
                  key_overrides=None, alt_repeat_keys=None, settings=None, unlocked=True, unlock_keys=(),
                  unlock_counter_max=UNLOCK_COUNTER_MAX, unlock_poll_gap=0.0, clock=time.monotonic,
-                 features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK):
+                 features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK, backlight_levels=BACKLIGHT_LEVELS,
+                 backlight_breathing=True, bootloader_jump=True):
         """
         definition: vial.json as a dict or JSON string
         keymap: optional {(layer, row, col): keycode}; unset keys are KC_NO
@@ -79,6 +90,11 @@ class VirtualKeyboard:
                          last count-down (and the keys are held), otherwise the countdown starts again. 0 (default):
                          every poll counts. FIRMWARE_UNLOCK_POLL_GAP is the real firmware's 100 ms.
         clock: seconds as a float, like time.monotonic; tests inject a fake one for unlock_poll_gap
+        backlight_levels: the backlight's brightness steps above off (BACKLIGHT_LEVELS, 1 to 31)
+        backlight_breathing: the firmware is built with BACKLIGHT_BREATHING; without it the effect reads 0 and a change
+                             of it does nothing
+        bootloader_jump: the firmware jumps to its bootloader when asked (a secure Vial build); False: built with
+                         VIAL_INSECURE, whose via.c doesn't handle the command
         """
         if isinstance(definition, str):
             definition = json.loads(definition)
@@ -131,13 +147,19 @@ class VirtualKeyboard:
         self.unlock_counter = 0
 
         lighting = definition.get("lighting", "none")
-        self.rgblight = {"brightness": 128, "effect": 1, "speed": 2, "color": (0, 255)} \
+        # what the firmware runs with, kept as each kind's lighting code keeps it (see _lighting_set)
+        self.rgblight = {"enable": True, "mode": 1, "hue": 0, "sat": 255, "val": 128, "speed": 0} \
             if lighting in ["qmk_rgblight", "qmk_backlight_rgblight"] else None
-        self.backlight = {"brightness": 128, "effect": 0} \
+        if not 1 <= backlight_levels <= 31:
+            raise SimulatorError("the backlight has 1 to 31 levels")
+        self.backlight = {"level": 2, "breathing": False, "levels": backlight_levels,
+                          "has_breathing": backlight_breathing} \
             if lighting in ["qmk_backlight", "qmk_backlight_rgblight"] else None
-        self.vialrgb = {"mode": 2, "speed": 128, "hsv": (0, 255, 128), "max_brightness": 200,
+        self.vialrgb = {"enable": True, "mode": 2, "speed": 128, "hsv": (0, 255, 128), "max_brightness": 200,
                         "supported": [1, 2, 3, 4, 5, 6, 7, 8]} if lighting == "vialrgb" else None
-        self.lighting_saved = False
+        self.lighting_saved = None
+        """ what the last lighting save kept (each kind's state, as its EEPROM copy would hold it); None before one """
+        self.bootloader_jump = bootloader_jump
 
         self.pressed = set()
         self.connected = True
@@ -275,22 +297,28 @@ class VirtualKeyboard:
     def _lighting_get(self, msg):
         sub = msg[1]
         head = msg[0:2]
-        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
-                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
+        rgb = self.rgblight
+        if rgb is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT_SPEED,
+                                       QMK_RGBLIGHT_COLOR]:
             if sub == QMK_RGBLIGHT_COLOR:
-                return head + bytes(self.rgblight["color"])
-            key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
-                   QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
-            return head + bytes([self.rgblight[key]])
+                return head + bytes([rgb["hue"], rgb["sat"]])
+            if sub == QMK_RGBLIGHT_EFFECT:
+                # rgblight_get_mode(): 0 while the light is off
+                return head + bytes([rgb["mode"] if rgb["enable"] else 0])
+            return head + bytes([rgb["val" if sub == QMK_RGBLIGHT_BRIGHTNESS else "speed"]])
         if self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
-            key = "brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"
-            return head + bytes([self.backlight[key]])
+            bl = self.backlight
+            if sub == QMK_BACKLIGHT_BRIGHTNESS:
+                # via.c: level * 255 / BACKLIGHT_LEVELS
+                return head + bytes([bl["level"] * 255 // bl["levels"]])
+            return head + bytes([int(bl["has_breathing"] and bl["breathing"])])
         if self.vialrgb is not None:
             if sub == VIALRGB_GET_INFO:
                 return head + struct.pack("<HB", 1, self.vialrgb["max_brightness"])
             if sub == VIALRGB_GET_MODE:
-                return head + struct.pack("<HBBBB", self.vialrgb["mode"], self.vialrgb["speed"],
-                                          *self.vialrgb["hsv"])
+                # vialrgb.c get_mode(): "off" while the matrix is off
+                mode = self.vialrgb["mode"] if self.vialrgb["enable"] else VIALRGB_EFFECT_OFF
+                return head + struct.pack("<HBBBB", mode, self.vialrgb["speed"], *self.vialrgb["hsv"])
             if sub == VIALRGB_GET_SUPPORTED:
                 after = struct.unpack_from("<H", msg, 2)[0]
                 effects = [e for e in sorted(self.vialrgb["supported"]) if e > after][:15]
@@ -300,29 +328,72 @@ class VirtualKeyboard:
 
     def _lighting_set(self, msg):
         sub = msg[1]
-        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
-                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
-            if sub == QMK_RGBLIGHT_COLOR:
-                self.rgblight["color"] = (msg[2], msg[3])
+        rgb = self.rgblight
+        if rgb is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT_SPEED,
+                                       QMK_RGBLIGHT_COLOR]:
+            if sub == QMK_RGBLIGHT_BRIGHTNESS:
+                self._rgblight_sethsv(rgb["hue"], rgb["sat"], msg[2])
+            elif sub == QMK_RGBLIGHT_COLOR:
+                self._rgblight_sethsv(msg[2], msg[3], rgb["val"])
+            elif sub == QMK_RGBLIGHT_EFFECT:
+                # via.c: rgblight_mode_noeeprom, then off for 0 and on for anything else. A light that is off changes
+                # no mode, and turning it on starts the mode it had: from off, an effect takes two sends.
+                if rgb["enable"]:
+                    rgb["mode"] = min(max(msg[2], 1), RGBLIGHT_MODES)
+                rgb["enable"] = msg[2] != 0
             else:
-                key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
-                       QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
-                self.rgblight[key] = msg[2]
+                rgb["speed"] = msg[2]
         elif self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
-            self.backlight["brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"] = msg[2]
+            bl = self.backlight
+            if sub == QMK_BACKLIGHT_BRIGHTNESS:
+                # via.c: value * BACKLIGHT_LEVELS / 255, rounded down
+                bl["level"] = msg[2] * bl["levels"] // 255
+            elif bl["has_breathing"]:
+                bl["breathing"] = msg[2] != 0
         elif self.vialrgb is not None and sub == VIALRGB_SET_MODE:
             mode, speed, h, s, v = struct.unpack_from("<HBBBB", msg, 2)
-            self.vialrgb["mode"], self.vialrgb["speed"], self.vialrgb["hsv"] = mode, speed, (h, s, v)
+            vr = self.vialrgb
+            # vialrgb.c set_mode: "off" turns the matrix off; any other effect turns it on
+            if mode == VIALRGB_EFFECT_OFF:
+                vr["enable"] = False
+            else:
+                vr["enable"] = True
+                vr["mode"] = mode
+            vr["speed"] = speed
+            # rgb_matrix_sethsv_noeeprom: nothing while off; the brightness at most RGB_MATRIX_MAXIMUM_BRIGHTNESS
+            if vr["enable"]:
+                vr["hsv"] = (h, s, min(v, vr["max_brightness"]))
         else:
             raise SimulatorError("unsupported lighting change 0x{:02X}".format(sub))
         self.writes.append(("lighting", sub))
         return msg[0:2]
 
+    def _rgblight_sethsv(self, hue, sat, val):
+        """ rgblight_sethsv_noeeprom: nothing while the light is off; breathing keeps its brightness and the rainbow
+        effects their hue """
+        rgb = self.rgblight
+        if not rgb["enable"]:
+            return
+        if rgb["mode"] in RGBLIGHT_BREATHING:
+            val = rgb["val"]
+        elif rgb["mode"] in RGBLIGHT_RAINBOW:
+            hue = rgb["hue"]
+        rgb["hue"], rgb["sat"], rgb["val"] = hue, sat, val
+
     def _lighting_save(self, msg):
-        self.lighting_saved = True
+        # via.c id_lighting_save: each kind's EEPROM copy is updated from what it runs with
+        self.lighting_saved = copy.deepcopy({"rgblight": self.rgblight, "backlight": self.backlight,
+                                             "vialrgb": self.vialrgb})
         return msg[0:1]
 
+    def lighting_now(self):
+        """ What a lighting save would keep now: compare with lighting_saved """
+        return {"rgblight": self.rgblight, "backlight": self.backlight, "vialrgb": self.vialrgb}
+
     def _bootloader(self, msg):
+        if not self.bootloader_jump:
+            # built with VIAL_INSECURE: via.c has no bootloader jump, and answers it as unhandled
+            return bytes([VIA_ID_UNHANDLED]) + msg[1:]
         if not self.unlocked:
             return msg
         # the firmware answers first, then jumps to the bootloader: the keyboard drops off the bus
```

- [ ] **Step 5: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py test/test_vial_web.py
```

Expected: `166 passed, 1 skipped`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `847 passed, 1 skipped`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/protocol/constants.py \
  src/main/python/simulator/corne.py \
  src/main/python/simulator/virtual_keyboard.py \
  src/main/python/test/test_simulator.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py
git commit -m "feat(simulator): lighting as vial-qmk runs it, --lighting, firmware without the bootloader jump"
```

### Task 2: Lighting changes show at once and are kept only when saved

`PUT /api/lighting` saved every change to the keyboard's EEPROM (`save: true` by default). Qt doesn't: each change is shown at once, and its Save button keeps them. Now:

- `PUT /api/lighting` shows a change and doesn't keep it; the `save` field is gone. `POST /api/lighting/save` keeps what the keyboard shows (one `id_lighting_save` keeps every kind). A keyboard without lighting refuses both (422).
- VialRGB's effect, speed and colour go in one request, as `vialrgb_set_mode` takes them, with the brightness at most the keyboard's maximum.
- An RGB light effect chosen while the light is off is sent twice: the first turns it on with its old effect, the second sets the new one.
- The reply is read back from the keyboard (`reload_rgb`, as Qt does after a change), so it says what the keyboard took.

The simulator gets `plug_in()`: plugged in again (`PUT /api/simulator/connection`), it starts with the lighting it saved (`lighting_kept`), and out of its bootloader, as a real keyboard does. The replug test proves that a change not saved is gone.

`test_lighting.py` checks each kind against the simulator: the bytes sent, as Qt sends them; what the firmware ignores; nothing kept until saved.

**Files:**
- Modify: `src/main/python/server/edits.py`
- Modify: `src/main/python/server/app.py`
- Modify: `src/main/python/server/schemas.py`
- Modify: `src/main/python/server/device.py`
- Modify: `src/main/python/simulator/virtual_keyboard.py`
- Test: `src/main/python/test/test_lighting.py` (new)
- Test: `src/main/python/test/test_api.py`
- Test: `src/main/python/test/test_api_validation.py`
- Test: `src/main/python/test/test_dump_openapi.py`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_lighting.py`:

```python
""" Lighting against the simulated keyboard, each kind as its firmware code in vial-qmk works (vialrgb.c, via.c,
rgblight.c, backlight.c): changes are shown at once and kept only once saved, as Qt's Lighting tab does """
import struct

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.constants import CMD_VIA_LIGHTING_SAVE, CMD_VIA_LIGHTING_SET_VALUE, \
    QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT, QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_COLOR, QMK_RGBLIGHT_EFFECT, \
    VIALRGB_SET_MODE
from protocol.keyboard_comm import Keyboard
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import LIGHTING, make_corne
from simulator.device import SimulatedHidDevice
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN


def api_for(tmp_path, factory):
    manager = DeviceManager(FakeBackend(factory))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    client = TestClient(app, base_url=BASE)
    return client, manager


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


@pytest.fixture
def lit(tmp_path, request):
    """ (client, virtual keyboard) of a Corne with the lighting the test is parametrized with """
    client, manager = api_for(tmp_path, lambda: make_corne(lighting=request.param))
    with client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager.backend.virtual


def sent(virtual):
    """ The lighting requests the simulated keyboard is sent from now on: (command, value id, the bytes after) """
    log = []
    process = virtual.process

    def recording(msg):
        if msg[0] in (CMD_VIA_LIGHTING_SET_VALUE, CMD_VIA_LIGHTING_SAVE):
            log.append((msg[0], msg[1], bytes(msg[2:8])))
        return process(msg)
    virtual.process = recording
    return log


# ---------- what the model says ----------

@pytest.mark.parametrize("lit", LIGHTING, indirect=True)
def test_only_the_kinds_the_keyboard_has_are_in_the_model(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    lighting = client.get("/api/keyboard").json()["lighting"]
    assert (lighting["vialrgb"] is not None) == (kind == "vialrgb")
    assert (lighting["rgblight"] is not None) == ("rgblight" in kind)
    assert (lighting["backlight"] is not None) == ("backlight" in kind)


@pytest.mark.parametrize("lit", ["none"], indirect=True)
def test_a_keyboard_without_lighting_refuses_lighting_changes_and_saves(lit):
    client, virtual = lit
    log = sent(virtual)
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 1}}).status_code == 422
    assert client.put("/api/lighting", json={"rgblight": {"effect": 1}}).status_code == 422
    assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).status_code == 422
    assert client.post("/api/lighting/save").status_code == 422
    assert log == []


# ---------- VialRGB ----------

@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_sends_effect_speed_and_colour_in_one_request(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"vialrgb": {"mode": 5, "speed": 40, "hsv": [10, 20, 30]}}).json()
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, VIALRGB_SET_MODE, struct.pack("<HBBBB", 5, 40, 10, 20, 30))]
    assert reply["vialrgb"] == {"mode": 5, "speed": 40, "hsv": [10, 20, 30], "maxBrightness": 200,
                                "supportedEffects": [0, 1, 2, 3, 4, 5, 6, 7, 8]}
    # a change of one keeps the others
    reply = client.put("/api/lighting", json={"vialrgb": {"speed": 41}}).json()
    assert log[-1] == (CMD_VIA_LIGHTING_SET_VALUE, VIALRGB_SET_MODE, struct.pack("<HBBBB", 5, 41, 10, 20, 30))
    assert reply["vialrgb"]["hsv"] == [10, 20, 30]


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_brightness_is_capped_at_the_keyboards_maximum(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": [1, 2, 255]}}).json()["vialrgb"]["hsv"] == [1, 2, 200]
    assert virtual.vialrgb["hsv"] == (1, 2, 200)


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_off_keeps_its_colour_and_the_reply_says_what_the_keyboard_shows(lit):
    client, virtual = lit
    off = client.put("/api/lighting", json={"vialrgb": {"mode": 0}}).json()["vialrgb"]
    assert off["mode"] == 0
    # rgb_matrix_sethsv_noeeprom does nothing while the matrix is off: the reply shows the colour unchanged
    assert client.put("/api/lighting", json={"vialrgb": {"hsv": [99, 99, 99]}}).json()["vialrgb"]["hsv"] == \
        off["hsv"]
    on = client.put("/api/lighting", json={"vialrgb": {"mode": 2, "hsv": [99, 99, 99]}}).json()["vialrgb"]
    assert (on["mode"], on["hsv"]) == (2, [99, 99, 99])


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_vialrgb_effects_the_keyboard_lacks_are_refused(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 9}}).status_code == 422
    assert virtual.vialrgb["mode"] == 2


# ---------- QMK RGB light ----------

@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_brightness_and_colour_as_qt_sends_them(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 15}}).json()["rgblight"]
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_EFFECT, bytes([15, 0, 0, 0, 0, 0]))]
    assert reply["effect"] == 15
    log.clear()
    reply = client.put("/api/lighting", json={"rgblight": {"hue": 100, "saturation": 200, "brightness": 50}}).json()
    # Qt's set_qmk_rgblight_color: the brightness, then hue and saturation
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_BRIGHTNESS, bytes([50, 0, 0, 0, 0, 0])),
                   (CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_COLOR, bytes([100, 200, 0, 0, 0, 0]))]
    assert {k: reply["rgblight"][k] for k in ("hue", "saturation", "brightness")} == \
        {"hue": 100, "saturation": 200, "brightness": 50}
    log.clear()
    assert client.put("/api/lighting", json={"rgblight": {"brightness": 70}}).json()["rgblight"]["brightness"] == 70
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_RGBLIGHT_BRIGHTNESS, bytes([70, 0, 0, 0, 0, 0]))]


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_from_off_is_sent_twice_so_the_keyboard_takes_it(lit):
    client, virtual = lit
    assert client.put("/api/lighting", json={"rgblight": {"effect": 0}}).json()["rgblight"]["effect"] == 0
    assert not virtual.rgblight["enable"]
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 20}}).json()["rgblight"]
    # once turns it on with the effect it had before (via.c: rgblight_mode_noeeprom ignores a light that is off)
    assert [entry[1] for entry in log] == [QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT]
    assert reply["effect"] == 20


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_effect_once_when_it_is_on(lit):
    client, virtual = lit
    log = sent(virtual)
    client.put("/api/lighting", json={"rgblight": {"effect": 3}})
    assert len(log) == 1


@pytest.mark.parametrize("lit", ["qmk_rgblight"], indirect=True)
def test_rgblight_reply_shows_what_the_firmware_ignores(lit):
    client, virtual = lit
    # off: no colour is taken
    client.put("/api/lighting", json={"rgblight": {"effect": 0}})
    off = client.put("/api/lighting", json={"rgblight": {"hue": 10, "saturation": 10, "brightness": 10}}).json()
    assert (off["rgblight"]["hue"], off["rgblight"]["brightness"]) == (0, 128)
    # breathing keeps its brightness
    client.put("/api/lighting", json={"rgblight": {"effect": 3}})
    breathing = client.put("/api/lighting", json={"rgblight": {"brightness": 10}}).json()["rgblight"]
    assert breathing["brightness"] == 128
    # a rainbow keeps its hue, takes the saturation
    client.put("/api/lighting", json={"rgblight": {"effect": 7}})
    rainbow = client.put("/api/lighting", json={"rgblight": {"hue": 77, "saturation": 33}}).json()["rgblight"]
    assert (rainbow["hue"], rainbow["saturation"]) == (0, 33)


# ---------- backlight ----------

@pytest.mark.parametrize("lit", ["qmk_backlight"], indirect=True)
def test_backlight_brightness_settles_on_one_of_the_keyboards_steps(lit):
    client, virtual = lit
    log = sent(virtual)
    reply = client.put("/api/lighting", json={"backlight": {"brightness": 200}}).json()["backlight"]
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_BRIGHTNESS, bytes([200, 0, 0, 0, 0, 0]))]
    # 3 levels: 200 * 3 / 255 = level 2, read back as 2 * 255 / 3
    assert reply["brightness"] == 170
    assert client.put("/api/lighting", json={"backlight": {"brightness": 255}}).json()["backlight"]["brightness"] \
        == 255
    assert client.put("/api/lighting", json={"backlight": {"brightness": 84}}).json()["backlight"]["brightness"] == 0


@pytest.mark.parametrize("lit", ["qmk_backlight"], indirect=True)
def test_backlight_breathing(lit):
    client, virtual = lit
    log = sent(virtual)
    assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]["effect"] == 1
    assert log == [(CMD_VIA_LIGHTING_SET_VALUE, QMK_BACKLIGHT_EFFECT, bytes([1, 0, 0, 0, 0, 0]))]
    assert client.put("/api/lighting", json={"backlight": {"effect": 0}}).json()["backlight"]["effect"] == 0


def test_backlight_without_breathing_reads_it_off(tmp_path):
    definition = make_corne(lighting="qmk_backlight").definition
    client, manager = api_for(tmp_path, lambda: VirtualKeyboard(definition, backlight_breathing=False))
    with client:
        client.get("/?token=" + TOKEN)
        assert client.put("/api/lighting", json={"backlight": {"effect": 1}}).json()["backlight"]["effect"] == 0


@pytest.mark.parametrize("lit", ["qmk_backlight_rgblight"], indirect=True)
def test_both_kinds_change_in_one_request(lit):
    client, virtual = lit
    reply = client.put("/api/lighting", json={"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}).json()
    assert (reply["rgblight"]["effect"], reply["backlight"]["brightness"]) == (4, 255)


# ---------- kept only once saved ----------

@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_changes_are_kept_only_once_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    change = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
              "qmk_backlight": {"backlight": {"brightness": 255}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}}[kind]
    log = sent(virtual)
    shown = client.put("/api/lighting", json=change).json()
    assert virtual.lighting_saved is None
    assert all(entry[0] != CMD_VIA_LIGHTING_SAVE for entry in log)
    saved = client.post("/api/lighting/save").json()
    assert saved == shown
    # one save request keeps every kind (via.c id_lighting_save)
    assert [entry[0] for entry in log].count(CMD_VIA_LIGHTING_SAVE) == 1
    assert virtual.lighting_saved == virtual.lighting_now()


@pytest.mark.parametrize("lit", ["vialrgb"], indirect=True)
def test_saving_needs_a_connected_keyboard(lit):
    client, virtual = lit
    virtual.connected = False
    assert client.post("/api/lighting/save").status_code == 503


@pytest.mark.parametrize("kind", LIGHTING)
def test_lighting_reads_back_with_the_protocol_code(kind):
    """ The protocol code (keyboard_comm.reload_persistent_rgb and reload_rgb) reads what the simulator shows """
    kb = Keyboard(SimulatedHidDevice(make_corne(lighting=kind)))
    kb.reload()
    assert (kb.lighting_vialrgb, kb.lighting_qmk_rgblight, kb.lighting_qmk_backlight) == \
        (kind == "vialrgb", "rgblight" in kind, "backlight" in kind)
    if kb.lighting_qmk_rgblight:
        assert (kb.underglow_effect, kb.underglow_brightness, kb.underglow_color) == (1, 128, (0, 255))
    if kb.lighting_qmk_backlight:
        # level 2 of 3
        assert (kb.backlight_brightness, kb.backlight_effect) == (170, 0)
    if kb.lighting_vialrgb:
        assert (kb.rgb_mode, kb.rgb_speed, kb.rgb_hsv, kb.rgb_maximum_brightness) == (2, 128, (0, 255, 128), 200)


@pytest.mark.parametrize("lit", LIGHTING[1:], indirect=True)
def test_plugged_in_again_the_keyboard_has_the_lighting_saved(lit):
    client, virtual = lit
    kind = virtual.definition["lighting"]
    first = {"vialrgb": {"vialrgb": {"mode": 4}}, "qmk_rgblight": {"rgblight": {"effect": 4}},
             "qmk_backlight": {"backlight": {"brightness": 255}},
             "qmk_backlight_rgblight": {"rgblight": {"effect": 4}, "backlight": {"brightness": 255}}}[kind]
    second = {"vialrgb": {"vialrgb": {"mode": 5}}, "qmk_rgblight": {"rgblight": {"effect": 5}},
              "qmk_backlight": {"backlight": {"brightness": 0}},
              "qmk_backlight_rgblight": {"rgblight": {"effect": 5}, "backlight": {"brightness": 0}}}[kind]
    before = client.get("/api/keyboard").json()["lighting"]
    # not saved: gone after a replug
    client.put("/api/lighting", json=first)
    replug(client)
    assert client.get("/api/keyboard").json()["lighting"] == before
    # saved: kept, a later change not
    saved = client.put("/api/lighting", json=first).json()
    client.post("/api/lighting/save")
    client.put("/api/lighting", json=second)
    replug(client)
    assert client.get("/api/keyboard").json()["lighting"] == saved


def replug(client):
    manager = client.app.state.manager
    client.put("/api/simulator/connection", json={"connected": False})
    assert manager.check() == ["disconnected"]
    client.put("/api/simulator/connection", json={"connected": True})
    assert manager.check() == ["connected"]
```

The earlier tests expected a save with every change:

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -266,7 +266,9 @@ def test_settings_and_lighting(client, virtual):
     lighting = client.put("/api/lighting", json={"vialrgb": {"mode": 3, "hsv": [10, 20, 255]}}).json()
     assert lighting["vialrgb"]["mode"] == 3
     assert virtual.vialrgb["hsv"] == (10, 20, 200)  # clamped to the keyboard's maximum brightness
-    assert virtual.lighting_saved
+    assert virtual.lighting_saved is None  # shown, not kept: Save keeps it
+    assert client.post("/api/lighting/save").json()["vialrgb"]["mode"] == 3
+    assert virtual.lighting_saved["vialrgb"]["mode"] == 3
     assert client.put("/api/lighting", json={"vialrgb": {"mode": 99}}).status_code == 422
     assert client.put("/api/lighting", json={"backlight": {"brightness": 1}}).status_code == 422
 
```

Apply to `src/main/python/test/test_api_validation.py`:

```diff
diff --git a/src/main/python/test/test_api_validation.py b/src/main/python/test/test_api_validation.py
--- a/src/main/python/test/test_api_validation.py
+++ b/src/main/python/test/test_api_validation.py
@@ -251,7 +251,7 @@ def test_lighting_is_checked_before_writing(client, virtual):
     response = client.put("/api/lighting", json={"vialrgb": {"mode": 3}, "rgblight": {"effect": 1}})
     assert response.status_code == 422
     assert snapshot(virtual) == before
-    assert not virtual.lighting_saved
+    assert virtual.lighting_saved is None
 
 
 # ---------- size limits and unknown fields ----------
```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -18,7 +18,7 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
                         "title": "Response Keycodes Api Keycodes Get"}
     # test aids of fake mode, not part of the API
     assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
-    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock"} <= set(schema["paths"])
+    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/lighting/save"} <= set(schema["paths"])
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_lighting.py test/test_api.py test/test_api_validation.py test/test_dump_openapi.py
```

Expected: `21 failed, 177 passed`: every change is still saved, there is no save route yet, and a replug keeps what was shown.

- [ ] **Step 3: The simulator plugged in again**

Apply to `src/main/python/simulator/virtual_keyboard.py`:

```diff
diff --git a/src/main/python/simulator/virtual_keyboard.py b/src/main/python/simulator/virtual_keyboard.py
--- a/src/main/python/simulator/virtual_keyboard.py
+++ b/src/main/python/simulator/virtual_keyboard.py
@@ -159,6 +159,8 @@ class VirtualKeyboard:
                         "supported": [1, 2, 3, 4, 5, 6, 7, 8]} if lighting == "vialrgb" else None
         self.lighting_saved = None
         """ what the last lighting save kept (each kind's state, as its EEPROM copy would hold it); None before one """
+        self.lighting_kept = copy.deepcopy(self.lighting_now())
+        """ what the lighting starts with when the keyboard is plugged in: its EEPROM copy """
         self.bootloader_jump = bootloader_jump
 
         self.pressed = set()
@@ -382,14 +384,23 @@ class VirtualKeyboard:
 
     def _lighting_save(self, msg):
         # via.c id_lighting_save: each kind's EEPROM copy is updated from what it runs with
-        self.lighting_saved = copy.deepcopy({"rgblight": self.rgblight, "backlight": self.backlight,
-                                             "vialrgb": self.vialrgb})
+        self.lighting_saved = copy.deepcopy(self.lighting_now())
+        self.lighting_kept = copy.deepcopy(self.lighting_now())
         return msg[0:1]
 
     def lighting_now(self):
         """ What a lighting save would keep now: compare with lighting_saved """
         return {"rgblight": self.rgblight, "backlight": self.backlight, "vialrgb": self.vialrgb}
 
+    def plug_in(self):
+        """ The keyboard is plugged in again: its firmware starts over with what it keeps (the lighting saved, which
+        changes made since without saving don't reach), and out of its bootloader. Everything else the simulator keeps
+        as it was. """
+        kept = copy.deepcopy(self.lighting_kept)
+        self.rgblight, self.backlight, self.vialrgb = kept["rgblight"], kept["backlight"], kept["vialrgb"]
+        self.bootloader_requested = False
+        self.connected = True
+
     def _bootloader(self, msg):
         if not self.bootloader_jump:
             # built with VIAL_INSECURE: via.c has no bootloader jump, and answers it as unhandled
```

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -163,9 +163,12 @@ class FakeBackend:
         return self.virtual is not None and self.virtual.connected
 
     def set_connected(self, connected):
-        """ Simulate unplugging the keyboard (False) or plugging it back in (True); the hot-plug poll notices """
+        """ Simulate unplugging the keyboard (False) or plugging it back in (True, VirtualKeyboard.plug_in); the
+        hot-plug poll notices """
         if self.virtual is None:
             self.virtual = self.keyboard_factory()
+        if connected and not self.virtual.connected:
+            self.virtual.plug_in()
         self.virtual.connected = connected
 
 
```

- [ ] **Step 4: Showing, saving, and the save route**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -473,10 +473,11 @@ class BacklightIn(Request):
 
 
 class LightingIn(Request):
+    """ A change the keyboard shows at once and forgets when it is unplugged, as Qt's Lighting tab makes it: POST
+    /api/lighting/save keeps it """
     vialrgb: Optional[VialRgbIn] = None
     rgblight: Optional[RgbLightIn] = None
     backlight: Optional[BacklightIn] = None
-    save: bool = True
 
 
 class SimulatorConnection(Request):
```

Apply to `src/main/python/server/edits.py`:

```diff
diff --git a/src/main/python/server/edits.py b/src/main/python/server/edits.py
--- a/src/main/python/server/edits.py
+++ b/src/main/python/server/edits.py
@@ -247,17 +247,22 @@ def set_lighting(kb, body):
         raise ValueError("this keyboard has no backlight")
 
     if body.vialrgb is not None:
-        if body.vialrgb.mode is not None:
-            kb.set_vialrgb_mode(body.vialrgb.mode)
-        if body.vialrgb.speed is not None:
-            kb.set_vialrgb_speed(body.vialrgb.speed)
-        if body.vialrgb.hsv is not None:
-            h, s, v = body.vialrgb.hsv
-            kb.set_vialrgb_color(h, s, min(v, kb.rgb_maximum_brightness))
+        v = body.vialrgb
+        # VialRGB sets effect, speed and colour in one request (vialrgb_set_mode): one is sent with all three, the
+        # brightness at most the keyboard's maximum, as Qt's slider allows
+        h, s, value = kb.rgb_hsv if v.hsv is None else v.hsv
+        kb.rgb_mode = kb.rgb_mode if v.mode is None else v.mode
+        kb.rgb_speed = kb.rgb_speed if v.speed is None else v.speed
+        kb.set_vialrgb_color(h, s, min(value, kb.rgb_maximum_brightness))
     if body.rgblight is not None:
         r = body.rgblight
         if r.effect is not None:
+            was_off = kb.underglow_effect == 0
             kb.set_qmk_rgblight_effect(r.effect)
+            if was_off and r.effect != 0:
+                # a light that is off takes no effect: via.c turns it on after setting the effect, and it starts the
+                # one it had before. Sent again, the effect is taken.
+                kb.set_qmk_rgblight_effect(r.effect)
         if r.speed is not None:
             kb.set_qmk_rgblight_effect_speed(r.speed)
         if r.hue is not None or r.saturation is not None:
@@ -272,8 +277,17 @@ def set_lighting(kb, body):
             kb.set_qmk_backlight_brightness(body.backlight.brightness)
         if body.backlight.effect is not None:
             kb.set_qmk_backlight_effect(body.backlight.effect)
-    if body.save:
-        kb.save_rgb()
+    # the reply is what the keyboard shows now, read back as Qt does after a change: the firmware can take a value
+    # otherwise (the backlight's few brightness steps, a colour while the light is off, breathing it doesn't have)
+    kb.reload_rgb()
+    return model.lighting(kb)
+
+
+def save_lighting(kb):
+    """ Keep the lighting the keyboard shows now when it is unplugged (Qt's Save on its Lighting tab) """
+    if not (kb.lighting_vialrgb or kb.lighting_qmk_rgblight or kb.lighting_qmk_backlight):
+        raise ValueError("this keyboard has no lighting")
+    kb.save_rgb()
     return model.lighting(kb)
 
 
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -468,6 +468,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     def set_lighting(body: schemas.LightingIn):
         return run(lambda kb: edits.set_lighting(kb, body))
 
+    @app.post("/api/lighting/save", response_model=schemas.Lighting)
+    def save_lighting():
+        """ Keep the lighting the keyboard shows now when it is unplugged (changes are only shown until then) """
+        return run(edits.save_lighting)
+
     @app.get("/api/names", response_model=schemas.Names)
     def get_names():
         return read(lambda kb: names_for(kb))
```

- [ ] **Step 5: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_lighting.py test/test_api.py test/test_api_validation.py test/test_dump_openapi.py
```

Expected: `198 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `879 passed, 1 skipped`.

- [ ] **Step 6: Regenerate the API types, and check the UI still type-checks**

```bash
cd web && npm run gen:api && npm run check:api && npm run check && npm test
```

Expected: `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  661 passed (661)`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/device.py \
  src/main/python/server/edits.py \
  src/main/python/server/schemas.py \
  src/main/python/simulator/virtual_keyboard.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_api_validation.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_lighting.py \
  web/src/api/schema.d.ts
git commit -m "feat(server): lighting changes are shown at once and kept only when saved; a replugged simulator starts with what it saved"
```

### Task 3: Read which keys are held, and say whether the keyboard can tell

Vial firmware answers `id_get_keyboard_value` / `id_switch_matrix_state` with the keys held, once the keyboard is unlocked. `DeviceManager.poll_matrix()` asks for them with one request under the device lock and decodes them as Qt's matrix tester does (`matrix_pressed`: after the request's 2 bytes, each row takes ceil(cols / 8) bytes, the highest columns first). It returns a `MatrixReading`:

- `"testing"` with the keys held;
- `"locked"` without asking: a locked keyboard answers nothing useful, and one waiting for its unlock keys answers nothing but its identity and the unlock;
- `"unsupported"` when the keyboard can't tell (`has_matrix_tester`, Qt's `valid()`: Vial protocol 3 or later, and `(cols / 8 + 1) × rows ≤ 28`, via.c's own limit for one reply).

The model gets `matrixTester`, so the UI shows the Matrix tester only when it works. The web test model (`analysis/testing.ts`) gets the field too.

**Files:**
- Modify: `src/main/python/server/device.py`
- Modify: `src/main/python/server/model.py`
- Modify: `src/main/python/server/schemas.py`
- Test: `src/main/python/test/test_matrix.py` (new)
- Modify: `web/src/analysis/testing.ts`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_matrix.py`:

```python
""" The matrix tester (the keys held), against the simulated keyboard """
import time

import pytest
from fastapi.testclient import TestClient

import transport
from protocol.constants import CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, MatrixReading, has_matrix_tester, matrix_pressed, \
    require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from simulator.virtual_keyboard import VirtualKeyboard
from test.test_api import BASE, PORT, TOKEN


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    yield
    set_unlock_handler(None)


def connected(factory=make_corne):
    manager = DeviceManager(FakeBackend(factory))
    assert manager.connect()
    manager.take_events()
    return manager


def locked_corne():
    vk = make_corne()
    vk.unlocked = False
    vk.unlock_counter_max = 2
    return vk


def matrix_requests(vk):
    """ When the simulated keyboard is asked for its switch matrix from now on (time.monotonic seconds) """
    times = []
    process = vk.process

    def recording(msg):
        if msg[0] == CMD_VIA_GET_KEYBOARD_VALUE and msg[1] == VIA_SWITCH_MATRIX_STATE:
            times.append(time.monotonic())
        return process(msg)
    vk.process = recording
    return times


@pytest.fixture
def served(tmp_path):
    """ (client with a session cookie, manager) serving a Corne """
    manager = connected()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     unlock_interval=0.01)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager


# ---------- reading the matrix ----------

def test_the_reply_is_read_as_qt_reads_it():
    # 2 bytes of request, then each row: ceil(cols / 8) bytes, the highest columns first
    data = bytes([2, 3]) + bytes([0b0000_0010, 0b1000_0001]) + bytes([0, 0]) + bytes([0b0000_0001, 0])
    assert matrix_pressed(data, 3, 10) == [(0, 0), (0, 7), (0, 9), (2, 8)]


def test_a_wide_matrix_is_read_from_the_simulator():
    definition = {"name": "Wide", "matrix": {"rows": 2, "cols": 12}, "lighting": "none",
                  "layouts": {"keymap": [["0,0", "0,11"], ["1,3", "1,8"]]}}
    manager = connected(lambda: VirtualKeyboard(definition))
    vk = manager.backend.virtual
    vk.press(0, 11)
    vk.press(1, 3)
    assert manager.poll_matrix() == MatrixReading("testing", ((0, 11), (1, 3)))


def test_the_corne_tells_its_keys_held():
    manager = connected()
    assert manager.poll_matrix() == MatrixReading("testing")
    manager.backend.virtual.press(4, 5)
    manager.backend.virtual.press(7, 3)
    assert manager.poll_matrix() == MatrixReading("testing", ((4, 5), (7, 3)))


def test_a_locked_keyboard_is_not_asked():
    manager = connected(locked_corne)
    times = matrix_requests(manager.backend.virtual)
    assert manager.poll_matrix() == MatrixReading("locked")
    manager.start_unlock()
    assert manager.poll_matrix() == MatrixReading("locked")  # waiting for its unlock keys: it answers nothing else
    assert times == []


def test_keyboards_that_cant_tell():
    old = connected(lambda: VirtualKeyboard(make_corne().definition, vial_protocol=2))
    assert not has_matrix_tester(old.keyboard)
    assert old.poll_matrix() == MatrixReading("unsupported")
    # via.c leaves a matrix out that may not fit in a reply: (cols / 8 + 1) * rows > 28
    big = {"name": "Big", "matrix": {"rows": 15, "cols": 8}, "lighting": "none", "layouts": {"keymap": [["0,0"]]}}
    assert not has_matrix_tester(connected(lambda: VirtualKeyboard(big)).keyboard)
    fits = dict(big, matrix={"rows": 14, "cols": 8})
    assert has_matrix_tester(connected(lambda: VirtualKeyboard(fits)).keyboard)


def test_the_model_says_whether_the_matrix_tester_works(served):
    client, manager = served
    assert client.get("/api/keyboard").json()["matrixTester"] is True
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py
```

Expected: `ImportError: cannot import name 'MatrixReading' from 'server.device'` and `1 error`.

- [ ] **Step 3: The reading, and the model's field**

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -7,7 +7,7 @@ import time
 from collections import namedtuple
 from dataclasses import dataclass
 
-from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID
+from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID, VIAL_PROTOCOL_MATRIX_TESTER
 from protocol.keyboard_comm import Keyboard
 from simulator.device import SimulatedHidDevice
 
@@ -53,6 +53,34 @@ def require_unlocked(keyboard):
     return True
 
 
+def has_matrix_tester(keyboard):
+    """ Whether the keyboard tells which of its keys are held (Qt's matrix tester): Vial protocol 3 or later, and a
+    matrix that fits in one reply by the firmware's own estimate (via.c: (MATRIX_COLS / 8 + 1) * MATRIX_ROWS <= 28;
+    a larger one leaves the reply empty) """
+    return keyboard.vial_protocol >= VIAL_PROTOCOL_MATRIX_TESTER and (keyboard.cols // 8 + 1) * keyboard.rows <= 28
+
+
+def matrix_pressed(data, rows, cols):
+    """ The (row, col) of each key held, from the reply to a switch matrix request, as Qt's matrix tester reads it:
+    after the 2 bytes of the request, each row takes ceil(cols / 8) bytes, the highest columns first """
+    row_size = (cols + 7) // 8
+    pressed = []
+    for row in range(rows):
+        start = 2 + row * row_size
+        bits = int.from_bytes(bytes(data[start:start + row_size]), byteorder="big")
+        pressed += [(row, col) for col in range(cols) if bits >> col & 1]
+    return pressed
+
+
+@dataclass(frozen=True)
+class MatrixReading:
+    """ One reading of the switch matrix (schemas.MatrixState) """
+    state: str
+    """ "testing": `pressed` is what is held now; "locked": the firmware shows nothing until the keyboard is unlocked;
+    "unsupported": this keyboard can't tell (has_matrix_tester) """
+    pressed: tuple = ()
+
+
 def interrupted_unlock_keys(keyboard):
     """ The unlock keys, if the keyboard is still waiting for an unlock started earlier (by a Vial closed meanwhile),
     else None. Asked before anything else is read: while it waits, the keyboard answers only its identity and unlock
@@ -505,6 +533,23 @@ class DeviceManager:
                 self.pending_events.append("unlock")
             return self.unlock_state()
 
+    # ---------- matrix tester ----------
+
+    def poll_matrix(self):
+        """ Read which keys are held: one request, under the device lock. The firmware hides them (a would-be
+        keylogger) until the keyboard is unlocked, and answers nothing while it waits for its unlock keys: then the
+        keyboard isn't asked, and the reading says "locked". Returns a MatrixReading. """
+        with self.lock:
+            keyboard = self.keyboard
+            if keyboard is None:
+                raise NotConnected("no keyboard connected")
+            if not has_matrix_tester(keyboard):
+                return MatrixReading("unsupported")
+            if self.unlocking is not None or not self.unlocked:
+                return MatrixReading("locked")
+            data = self._io(keyboard, lambda kb: kb.matrix_poll())
+            return MatrixReading("testing", tuple(matrix_pressed(data, keyboard.rows, keyboard.cols)))
+
     # ---------- hot-plug ----------
 
     def check(self):
```

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -263,6 +263,8 @@ class KeyboardModel(BaseModel):
     lighting: Lighting
     features: list[str]
     unlocked: bool
+    matrixTester: bool
+    """ the keyboard tells which of its keys are held (Vial protocol 3 and later, and a matrix small enough) """
 
 
 class KeyChange(BaseModel):
```

Apply to `src/main/python/server/model.py`:

```diff
diff --git a/src/main/python/server/model.py b/src/main/python/server/model.py
--- a/src/main/python/server/model.py
+++ b/src/main/python/server/model.py
@@ -8,6 +8,7 @@ from keycodes.keycodes import KEYCODES_SPECIAL, KEYCODES_BASIC, KEYCODES_SHIFTED
 from macro.macro_action import ActionText, ActionDelay, ActionSequence
 from server import schemas
 from server.describe import describe
+from server.device import has_matrix_tester
 from server.names import suggest_tap_dance_name, suggest_macro_name
 
 KEYCODE_CATEGORIES = [
@@ -159,6 +160,7 @@ def build(kb, names, unlocked):
         lighting=lighting(kb),
         features=sorted(kb.supported_features),
         unlocked=unlocked,
+        matrixTester=has_matrix_tester(kb),
     )
 
 
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py
```

Expected: `6 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `885 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types; the web test model gets the field**

Apply to `web/src/analysis/testing.ts`:

```diff
diff --git a/web/src/analysis/testing.ts b/web/src/analysis/testing.ts
--- a/web/src/analysis/testing.ts
+++ b/web/src/analysis/testing.ts
@@ -143,7 +143,7 @@ export function corne(setup: Setup): KeyboardModel {
         actions: Array.from({ length: steps }, () => ({ type: "tap" as const, keys: [described("KC_A")] })),
       })),
     },
-    settings: [], lighting: {}, features: [], unlocked: true,
+    settings: [], lighting: {}, features: [], unlocked: true, matrixTester: true,
   };
 }
 
```

```bash
cd web && npm run gen:api && npm run check:api && npm run check && npm test
```

Expected: `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  661 passed (661)`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/device.py \
  src/main/python/server/model.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_matrix.py \
  web/src/analysis/testing.ts \
  web/src/api/schema.d.ts
git commit -m "feat(server): read which keys are held, and say whether the keyboard can tell"
```

### Task 4: The matrix tester subscription on the events socket, paced; a fake-only key press hook

The matrix tester needs the keys held about 20 times a second, but only while a tab tests, and without starving the other requests. It uses the existing `/api/events` WebSocket:

- A tab sends `{"type": "matrix", "watch": true}` (or `false`). Anything else it sends is ignored.
- `MatrixWatcher` runs one task while any tab watches and stops when none does (a tab that closes stops watching). It reads with `poll_matrix` in a worker thread, every `MATRIX_POLL_INTERVAL` (50 ms), and always leaves the keyboard alone for `MATRIX_POLL_GAP` (20 ms) after a reading, however long that took: edits and the unlock countdown take the device lock in between.
- Each watching tab gets `{"type": "matrix", "matrix": {"state": …, "pressed": […]}}` at every change; a tab that starts watching gets the last reading at once. An unplugged keyboard reads `"disconnected"`. A failed reading is logged once, and reading goes on.
- `PUT /api/simulator/matrix {row, col, pressed}` presses a key of the simulated keyboard (or lets it go), only in fake mode and outside the schema, like the other simulator hooks.

On the web side, `connectEvents` returns an `EventsLink` with `close()` and `send(message)`: a message is sent only while the link is open, and a link opened again starts with nothing asked (the store asks again, Task 7). `matrix` events must carry the keys held. The store keeps the link (`#link`).

**Files:**
- Modify: `src/main/python/server/app.py`
- Modify: `src/main/python/server/schemas.py`
- Test: `src/main/python/test/test_matrix.py`
- Test: `src/main/python/test/test_api.py`
- Test: `src/main/python/test/test_dump_openapi.py`
- Modify: `web/src/api/events.ts`
- Test: `web/src/api/events.test.ts`
- Modify: `web/src/lib/keyboard.svelte.ts`
- Test: `web/src/lib/keyboard.test.ts`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_matrix.py`:

```diff
diff --git a/src/main/python/test/test_matrix.py b/src/main/python/test/test_matrix.py
--- a/src/main/python/test/test_matrix.py
+++ b/src/main/python/test/test_matrix.py
@@ -1,4 +1,5 @@
-""" The matrix tester (the keys held), against the simulated keyboard """
+""" The matrix tester (the keys held, read while a tab watches), against the simulated keyboard """
+import asyncio
 import time
 
 import pytest
@@ -7,13 +8,17 @@ from fastapi.testclient import TestClient
 import transport
 from protocol.constants import CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE
 from protocol.unlock_hook import set_unlock_handler
-from server.app import create_app
+from server.app import MatrixWatcher, create_app
 from server.device import DeviceManager, FakeBackend, MatrixReading, has_matrix_tester, matrix_pressed, \
     require_unlocked
 from server.names import NamesStore
-from simulator.corne import make_corne
+from simulator.corne import UNLOCK_KEYS, make_corne
 from simulator.virtual_keyboard import VirtualKeyboard
-from test.test_api import BASE, PORT, TOKEN
+from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN
+from test.test_api_server import pause, wait_until
+
+INTERVAL = 0.03
+GAP = 0.015
 
 
 @pytest.fixture(autouse=True)
@@ -53,15 +58,33 @@ def matrix_requests(vk):
 
 @pytest.fixture
 def served(tmp_path):
-    """ (client with a session cookie, manager) serving a Corne """
+    """ (client with a session cookie, manager) serving a Corne; the matrix is read every 30 ms while watched """
     manager = connected()
     app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
-                     unlock_interval=0.01)
+                     unlock_interval=0.01, matrix_interval=INTERVAL, matrix_gap=GAP)
     with TestClient(app, base_url=BASE) as client:
         assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
         yield client, manager
 
 
+def matrix_events(ws, until):
+    """ The "matrix" states sent up to the first that `until` takes """
+    seen = []
+    while True:
+        event = ws.receive_json()
+        if event["type"] != "matrix":
+            continue
+        seen.append(event["matrix"])
+        if until(event["matrix"]):
+            return seen
+
+
+def press(client, row, col, pressed=True):
+    response = client.put("/api/simulator/matrix", json={"row": row, "col": col, "pressed": pressed})
+    assert response.status_code == 200
+    return response.json()
+
+
 # ---------- reading the matrix ----------
 
 def test_the_reply_is_read_as_qt_reads_it():
@@ -111,3 +134,210 @@ def test_keyboards_that_cant_tell():
 def test_the_model_says_whether_the_matrix_tester_works(served):
     client, manager = served
     assert client.get("/api/keyboard").json()["matrixTester"] is True
+
+
+# ---------- watching it ----------
+
+def test_a_tab_watching_gets_the_keys_held_at_every_change(served):
+    client, manager = served
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        assert ws.receive_json() == {"type": "connected"}
+        ws.send_json({"type": "matrix", "watch": True})
+        assert matrix_events(ws, lambda m: True) == [{"state": "testing", "pressed": []}]
+        assert press(client, 0, 0) == {"pressed": [[0, 0]]}
+        assert matrix_events(ws, lambda m: m["pressed"])[-1] == {"state": "testing", "pressed": [{"row": 0, "col": 0}]}
+        press(client, 4, 5)
+        press(client, 0, 0, False)
+        states = matrix_events(ws, lambda m: m["pressed"] == [{"row": 4, "col": 5}])
+        assert all(m["state"] == "testing" for m in states)
+        press(client, 4, 5, False)
+        assert matrix_events(ws, lambda m: not m["pressed"])
+        ws.send_json({"type": "matrix", "watch": False})
+        assert wait_until(lambda: client.app.state.matrix.task is None)
+
+
+def test_reading_stops_when_no_tab_watches(served):
+    client, manager = served
+    watcher = client.app.state.matrix
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        ws.send_json({"type": "matrix", "watch": True})
+        matrix_events(ws, lambda m: True)
+        assert watcher.task is not None
+    # the tab closed: no more readings
+    assert wait_until(lambda: watcher.task is None)
+    times = matrix_requests(manager.backend.virtual)
+    pause(INTERVAL * 5)
+    assert times == []
+
+
+def test_two_tabs_share_one_reader_and_a_late_one_gets_the_last_reading(served):
+    client, manager = served
+    watcher = client.app.state.matrix
+    press(client, 1, 1)
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as first, \
+            client.websocket_connect(EVENTS, headers=ORIGIN) as second:
+        first.receive_json()
+        second.receive_json()
+        first.send_json({"type": "matrix", "watch": True})
+        assert matrix_events(first, lambda m: True)[-1]["pressed"] == [{"row": 1, "col": 1}]
+        task = watcher.task
+        second.send_json({"type": "matrix", "watch": True})
+        assert matrix_events(second, lambda m: True) == [{"state": "testing", "pressed": [{"row": 1, "col": 1}]}]
+        assert watcher.task is task
+        first.send_json({"type": "matrix", "watch": False})
+        pause(INTERVAL * 3)
+        assert watcher.task is task  # the second still watches
+    press(client, 1, 1, False)
+
+
+def test_messages_that_arent_asking_to_watch_are_ignored(served):
+    client, manager = served
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        for text in ["not json", "[1]", '{"type": "matrix"}', '{"type": "matrix", "watch": 1}', '{"type": "x"}']:
+            ws.send_text(text)
+        pause(INTERVAL * 3)
+        assert client.app.state.matrix.task is None
+        assert client.get("/api/session").status_code == 200
+
+
+def test_readings_are_paced(served):
+    client, manager = served
+    times = matrix_requests(manager.backend.virtual)
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        ws.send_json({"type": "matrix", "watch": True})
+        pause(INTERVAL * 12)
+    gaps = [b - a for a, b in zip(times, times[1:])]
+    assert len(gaps) >= 5
+    # about every INTERVAL, never back to back
+    assert min(gaps) > INTERVAL * 0.7, gaps
+
+
+def test_readings_leave_the_keyboard_alone_for_a_while_even_when_slow(tmp_path):
+    manager = connected()
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     matrix_interval=0.01, matrix_gap=0.05)
+    poll = manager.poll_matrix
+
+    def slow_poll():
+        pause(0.03)  # longer than the interval
+        return poll()
+    manager.poll_matrix = slow_poll
+    times = matrix_requests(manager.backend.virtual)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+            ws.receive_json()
+            ws.send_json({"type": "matrix", "watch": True})
+            pause(0.5)
+    gaps = [b - a for a, b in zip(times, times[1:])]
+    assert gaps and min(gaps) > 0.05 + 0.03 * 0.7, gaps
+
+
+def test_edits_are_not_held_up_while_the_matrix_is_read(served):
+    client, manager = served
+    readings = []
+    poll = manager.poll_matrix
+
+    def counting_poll():
+        readings.append(True)
+        return poll()
+    manager.poll_matrix = counting_poll
+    slowest = 0
+    edits = 0
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        ws.send_json({"type": "matrix", "watch": True})
+        matrix_events(ws, lambda m: True)
+        until = time.monotonic() + INTERVAL * 10
+        while time.monotonic() < until:
+            started = time.monotonic()
+            assert client.put("/api/keymap/0/0/0", json={"code": ["KC_A", "KC_TAB"][edits % 2]}).status_code == 200
+            slowest = max(slowest, time.monotonic() - started)
+            edits += 1
+    assert len(readings) >= 5 and edits >= 10
+    # an edit waits at most for one reading to end
+    assert slowest < 0.5, slowest
+
+
+def test_a_locked_keyboard_says_so_then_shows_the_keys_once_unlocked(tmp_path):
+    manager = connected(locked_corne)
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
+                     unlock_interval=0.01, matrix_interval=INTERVAL, matrix_gap=GAP)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+            ws.receive_json()
+            ws.send_json({"type": "matrix", "watch": True})
+            assert matrix_events(ws, lambda m: True) == [{"state": "locked", "pressed": []}]
+            # the unlock runs (the countdown is read meanwhile), then the keys show
+            client.put("/api/simulator/unlock", json={"keysHeld": True})
+            client.post("/api/unlock/start")
+            states = matrix_events(ws, lambda m: m["state"] == "testing")
+            # the unlock keys are held: they show
+            assert states[-1]["pressed"] == [{"row": r, "col": c} for r, c in sorted(UNLOCK_KEYS)]
+            client.post("/api/lock")
+            assert matrix_events(ws, lambda m: m["state"] == "locked")[-1] == {"state": "locked", "pressed": []}
+
+
+def test_an_unplugged_keyboard_is_reported_and_followed_again_when_back(served):
+    client, manager = served
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        ws.send_json({"type": "matrix", "watch": True})
+        matrix_events(ws, lambda m: True)
+        client.put("/api/simulator/connection", json={"connected": False})
+        manager.check()
+        assert matrix_events(ws, lambda m: m["state"] == "disconnected")[-1] == {"state": "disconnected", "pressed": []}
+        client.put("/api/simulator/connection", json={"connected": True})
+        manager.check()
+        assert matrix_events(ws, lambda m: m["state"] == "testing")
+
+
+def test_a_failed_reading_is_logged_once_and_reading_goes_on(served, caplog):
+    client, manager = served
+    poll = manager.poll_matrix
+    failures = []
+
+    def failing_poll():
+        if len(failures) < 3:
+            failures.append(True)
+            raise RuntimeError("failed to communicate with the device")
+        return poll()
+    manager.poll_matrix = failing_poll
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        ws.receive_json()
+        ws.send_json({"type": "matrix", "watch": True})
+        assert matrix_events(ws, lambda m: True) == [{"state": "testing", "pressed": []}]
+    assert [r.message for r in caplog.records].count(
+        "reading the switch matrix failed: failed to communicate with the device") == 1
+
+
+def test_stopping_the_server_while_watched_leaves_no_task():
+    manager = connected()
+    sent = []
+
+    async def send(ws, event):
+        sent.append(event)
+
+    async def watch_then_stop():
+        watcher = MatrixWatcher(manager, send, INTERVAL, GAP)
+        await watcher.watch("tab")
+        task = watcher.task
+        await asyncio.sleep(INTERVAL * 3)
+        await watcher.shutdown()
+        await watcher.watch("another tab")  # nothing starts once stopping
+        return watcher, task
+    watcher, task = asyncio.run(watch_then_stop())
+    assert task.done() and watcher.task is None
+    assert sent == [{"type": "matrix", "matrix": {"state": "testing", "pressed": []}}]
+
+
+def test_the_simulator_hook_presses_and_lets_go(served):
+    client, manager = served
+    assert press(client, 2, 3) == {"pressed": [[2, 3]]}
+    assert manager.backend.virtual.pressed == {(2, 3)}
+    assert press(client, 2, 3, False) == {"pressed": []}
+    assert client.put("/api/simulator/matrix", json={"row": 256, "col": 0, "pressed": True}).status_code == 422
```

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -379,6 +379,7 @@ def test_simulator_controls_need_the_session(tmp_path):
     with TestClient(app, base_url=BASE) as c:
         assert c.put("/api/simulator/connection", json={"connected": False}).status_code == 401
         assert c.put("/api/simulator/unlock", json={"keysHeld": True}).status_code == 401
+        assert c.put("/api/simulator/matrix", json={"row": 0, "col": 0, "pressed": True}).status_code == 401
 
 
 def test_simulator_controls_do_not_exist_for_real_keyboards(tmp_path):
@@ -390,6 +391,8 @@ def test_simulator_controls_do_not_exist_for_real_keyboards(tmp_path):
         assert "/api/simulator/connection" not in c.get("/openapi.json").text
         assert c.put("/api/simulator/unlock", json={"keysHeld": True}).status_code in (404, 405)
         assert "/api/simulator/unlock" not in c.get("/openapi.json").text
+        assert c.put("/api/simulator/matrix", json={"row": 0, "col": 0, "pressed": True}).status_code in (404, 405)
+        assert "/api/simulator/matrix" not in c.get("/openapi.json").text
 
 
 def test_the_simulator_unlock_hook_before_the_simulated_keyboard_is_made(tmp_path):
```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -18,12 +18,13 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
                         "title": "Response Keycodes Api Keycodes Get"}
     # test aids of fake mode, not part of the API
     assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
+    assert "/api/simulator/matrix" not in schema["paths"]
     assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/lighting/save"} <= set(schema["paths"])
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
-    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded", "unlock"}
-    assert "UnlockState" in schema["components"]["schemas"]
+    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded", "unlock", "matrix"}
+    assert "UnlockState" in schema["components"]["schemas"] and "MatrixState" in schema["components"]["schemas"]
     options = schema["paths"]["/api/layout-options"]["put"]["responses"]["200"]["content"]["application/json"]
     assert options["schema"] == {"$ref": "#/components/schemas/LayoutOptionsValue"}
     named = schema["paths"]["/api/names/{kind}/{index}"]["put"]["responses"]["200"]["content"]["application/json"]
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py test/test_api.py test/test_dump_openapi.py
```

Expected: `ImportError: cannot import name 'MatrixWatcher' from 'server.app'` and `1 error`.

- [ ] **Step 3: The event, the watcher, the socket's messages and the hook**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -230,11 +230,22 @@ class UnlockState(BaseModel):
     """ where the countdown started: the highest it was seen at """
 
 
+class MatrixState(BaseModel):
+    """ Which keys of the switch matrix are held, read about 20 times a second while a tab asks for it """
+    state: Literal["testing", "locked", "unsupported", "disconnected"]
+    """ testing: `pressed` is what is held now; locked: Vial firmware shows nothing until the keyboard is unlocked;
+    unsupported: this keyboard can't tell (KeyboardModel.matrixTester); disconnected: no keyboard """
+    pressed: list[MatrixPosition]
+
+
 class Event(BaseModel):
-    """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed """
-    type: Literal["connected", "disconnected", "reloaded", "unlock"]
+    """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed; and,
+    to a tab that asked for it ({"type": "matrix", "watch": true}), the keys held, at every change """
+    type: Literal["connected", "disconnected", "reloaded", "unlock", "matrix"]
     unlock: Optional[UnlockState] = None
     """ with "unlock": the new state; sent at every change, and with each reading of the countdown """
+    matrix: Optional[MatrixState] = None
+    """ with "matrix": the keys held now """
 
 
 class LayoutOptions(BaseModel):
@@ -487,6 +498,13 @@ class SimulatorConnection(Request):
     connected: bool
 
 
+class SimulatorPress(Request):
+    """ Fake mode only: a key of the simulated keyboard's matrix is pressed, or let go """
+    row: Byte
+    col: Byte
+    pressed: bool
+
+
 class SimulatorUnlock(Request):
     """ Fake mode only: the user holds the simulated keyboard's unlock keys (or lets go of them), or it is locked """
     keysHeld: Optional[bool] = None
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -2,6 +2,7 @@
 """ The local web server: security checks, API routes, live events and the built UI. """
 import asyncio
 import contextlib
+import json
 import logging
 import os
 import secrets
@@ -24,6 +25,12 @@ MAX_LAYOUT_FILE = 1024 * 1024
 """ largest .vil upload, in bytes """
 UNLOCK_POLL_INTERVAL = 0.2
 """ seconds between two readings of the unlock countdown, as Qt's unlocker """
+MATRIX_POLL_INTERVAL = 0.05
+""" seconds from one reading of the switch matrix to the next while a tab watches it: 20 a second (Qt's tester reads
+it every 20 ms, and the unlock state as well each time) """
+MATRIX_POLL_GAP = 0.02
+""" seconds the keyboard is left alone at least after each reading of the matrix, however long that took: other
+requests (edits, the unlock countdown) take the device lock in between """
 SECURITY_HEADERS = {
     "X-Frame-Options": "DENY",
     "Content-Security-Policy": "frame-ancestors 'none'",
@@ -134,6 +141,89 @@ class EventHub:
         await asyncio.gather(*tasks, return_exceptions=True)
 
 
+class MatrixWatcher:
+    """ Reads the switch matrix every `interval` seconds while at least one tab watches it, and sends each tab what is
+    held whenever that changes (a tab that starts watching gets the last reading at once). One task reads it, and stops
+    when no tab watches any more. After each reading the keyboard is left alone for at least `gap` seconds, so that
+    other requests get the device lock between two readings. `send(ws, event)` sends to one tab; a tab it drops is no
+    longer watching. """
+
+    def __init__(self, manager, send, interval, gap):
+        self.manager = manager
+        self.send = send
+        self.interval = interval
+        self.gap = gap
+        self.watchers = set()
+        self.task = None
+        self.last = None
+        """ the last reading sent (schemas.MatrixState), while the task runs """
+        self.stopping = False
+        self.failing = False
+        """ the last reading failed: the next failure isn't logged again """
+
+    async def watch(self, ws):
+        """ The tab starts watching (again: nothing changes); nothing once the server is stopping """
+        if ws in self.watchers or self.stopping:
+            return
+        self.watchers.add(ws)
+        if self.last is not None:
+            await self._send_to([ws], self.last)
+        if self.task is None:
+            self.task = asyncio.get_running_loop().create_task(self._read())
+
+    def unwatch(self, ws):
+        """ The tab stops watching, or has gone; the task stops before its next reading once none watches """
+        self.watchers.discard(ws)
+
+    async def shutdown(self):
+        """ The server is stopping: cancel the task, and start none from now on """
+        self.stopping = True
+        self.watchers.clear()
+        self.last = None
+        task, self.task = self.task, None
+        if task is not None:
+            task.cancel()
+            with contextlib.suppress(asyncio.CancelledError):
+                await task
+
+    def _reading(self):
+        """ One reading, as the tabs get it, or None when it failed (run in a worker thread: the device lock may be
+        held for a while) """
+        try:
+            reading = self.manager.poll_matrix()
+        except NotConnected:
+            return schemas.MatrixState(state="disconnected", pressed=[])
+        except Exception as e:
+            # the keyboard didn't answer this time: the tabs keep what they have
+            if not self.failing:
+                log.warning("reading the switch matrix failed: %s", e)
+            self.failing = True
+            return None
+        self.failing = False
+        return schemas.MatrixState(state=reading.state,
+                                   pressed=[schemas.MatrixPosition(row=r, col=c) for r, c in reading.pressed])
+
+    async def _read(self):
+        me = asyncio.current_task()
+        loop = asyncio.get_running_loop()
+        try:
+            while self.watchers and self.task is me and not self.stopping:
+                started = loop.time()
+                state = await asyncio.to_thread(self._reading)
+                if state is not None and state != self.last and self.task is me:
+                    self.last = state
+                    await self._send_to(list(self.watchers), state)
+                await asyncio.sleep(max(self.interval - (loop.time() - started), self.gap))
+        finally:
+            if self.task is me:
+                self.task = None
+                self.last = None
+
+    async def _send_to(self, tabs, state):
+        event = {"type": "matrix", "matrix": state.model_dump()}
+        await asyncio.gather(*(self.send(ws, event) for ws in tabs))
+
+
 def unlock_model(state):
     """ device.UnlockState -> schemas.UnlockState """
     return schemas.UnlockState(state=state.state, keys=[schemas.MatrixPosition(row=r, col=c) for r, c in state.keys],
@@ -202,12 +292,14 @@ class UnlockFollower:
 
 
 def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
-               poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL):
+               poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL,
+               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP):
     """
     manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
     static_dir: built UI (web/dist) or None for a placeholder page
     on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
     poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
+    matrix_interval, matrix_gap: the matrix tester's readings (MatrixWatcher)
     """
     allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
     allowed_origins = {"http://" + h for h in allowed_hosts}
@@ -230,6 +322,13 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
 
     follower = UnlockFollower(manager, broadcast_events, unlock_interval)
 
+    async def send_to_watcher(ws, event):
+        await hub._send(ws, event)
+        if ws not in hub.clients:  # dropped: it no longer watches either
+            matrix.unwatch(ws)
+
+    matrix = MatrixWatcher(manager, send_to_watcher, matrix_interval, matrix_gap)
+
     @contextlib.asynccontextmanager
     async def lifespan(app):
         async def poll():
@@ -255,12 +354,14 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                 with contextlib.suppress(asyncio.CancelledError):
                     await task
             await follower.shutdown()
+            await matrix.shutdown()
             await hub.shutdown()
 
     app = FastAPI(title="Vial", lifespan=lifespan)
     app.state.hub = hub
     app.state.manager = manager
     app.state.unlock_follower = follower
+    app.state.matrix = matrix
 
     def openapi():
         # WebSocket messages have no place in OpenAPI's paths: the event shape is added as a component, so the UI's
@@ -570,12 +671,26 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         try:
             await ws.send_json({"type": "connected" if manager.connected else "disconnected"})
             while True:
-                await ws.receive_text()
+                await on_message(ws, await ws.receive_text())
         except WebSocketDisconnect:
             pass
         finally:
+            matrix.unwatch(ws)
             await hub.remove(ws)
 
+    async def on_message(ws, text):
+        """ What a tab asks for: {"type": "matrix", "watch": true} (or false) to get the keys held, or not. Anything
+        else is ignored. """
+        try:
+            message = json.loads(text)
+        except (ValueError, RecursionError):
+            return
+        if isinstance(message, dict) and message.get("type") == "matrix" and isinstance(message.get("watch"), bool):
+            if message["watch"]:
+                await matrix.watch(ws)
+            else:
+                matrix.unwatch(ws)
+
     if manager.backend.fake:
         # for UI tests: unplug and replug the simulated keyboard. Never exists for real keyboards.
         @app.put("/api/simulator/connection", include_in_schema=False)
@@ -584,6 +699,17 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                 manager.backend.set_connected(body.connected)
             return {"connected": body.connected}
 
+        # for UI tests: a key of the simulated keyboard's matrix is pressed or let go (the matrix tester shows it). Never
+        # exists for real keyboards.
+        @app.put("/api/simulator/matrix", include_in_schema=False)
+        def set_simulator_press(body: schemas.SimulatorPress):
+            with manager.lock:
+                virtual = manager.backend.virtual
+                if virtual is None:  # nothing has looked for the keyboard yet
+                    raise NotConnected("no simulated keyboard yet")
+                (virtual.press if body.pressed else virtual.release)(body.row, body.col)
+                return {"pressed": sorted(virtual.pressed)}
+
         # for UI tests: the user holds the simulated keyboard's unlock keys, or lets go of them; or it is locked, as
         # plugging it in again would. Never exists for real keyboards.
         @app.put("/api/simulator/unlock", include_in_schema=False)
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py test/test_api.py test/test_dump_openapi.py
```

Expected: `63 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `897 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types, and write the failing tests of the events link**

```bash
cd web && npm run gen:api && npm run check:api
```

Expected: `src/api/schema.d.ts is up to date`.

Apply to `web/src/api/events.test.ts`:

```diff
diff --git a/web/src/api/events.test.ts b/web/src/api/events.test.ts
--- a/web/src/api/events.test.ts
+++ b/web/src/api/events.test.ts
@@ -1,5 +1,5 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
-import { connectEvents, type LinkState, type ServerEvent } from "./events";
+import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "./events";
 
 /** Stands in for the browser's WebSocket: the test opens, closes and sends on it by hand */
 class FakeSocket {
@@ -27,8 +27,11 @@ class FakeSocket {
     this.onopen?.();
   }
 
+  /** What the page sent */
+  sent: string[] = [];
+
   /** The server sent a frame */
-  send(data: string): void {
+  deliver(data: string): void {
     if (!this.closed) this.onmessage?.({ data });
   }
 
@@ -39,6 +42,11 @@ class FakeSocket {
     this.onclose?.();
   }
 
+  /** Called by the page */
+  send(data: string): void {
+    this.sent.push(data);
+  }
+
   /** Called by the page; like the browser, it ends with a close event */
   close(): void {
     this.drop();
@@ -47,10 +55,11 @@ class FakeSocket {
 
 let events: ServerEvent[];
 let links: LinkState[];
-let stop: (() => void) | undefined;
+let link: EventsLink | undefined;
+const stop = () => link?.close();
 
 function connect(): void {
-  stop = connectEvents((event) => events.push(event), (state) => links.push(state));
+  link = connectEvents((event) => events.push(event), (state) => links.push(state));
 }
 
 beforeEach(() => {
@@ -58,13 +67,13 @@ beforeEach(() => {
   FakeSocket.all = [];
   events = [];
   links = [];
-  stop = undefined;
+  link = undefined;
   vi.stubGlobal("WebSocket", FakeSocket);
   vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8000" });
 });
 
 afterEach(() => {
-  stop?.();
+  stop();
   vi.unstubAllGlobals();
   vi.useRealTimers();
 });
@@ -89,10 +98,10 @@ describe("connectEvents", () => {
     connect();
     FakeSocket.latest.accept();
     for (const type of ["connected", "disconnected", "reloaded"]) {
-      FakeSocket.latest.send(JSON.stringify({ type }));
+      FakeSocket.latest.deliver(JSON.stringify({ type }));
     }
     const unlock = { state: "unlocking", keys: [{ row: 0, col: 0 }], remaining: 3, total: 50 };
-    FakeSocket.latest.send(JSON.stringify({ type: "unlock", unlock }));
+    FakeSocket.latest.deliver(JSON.stringify({ type: "unlock", unlock }));
     expect(events).toEqual([{ type: "connected" }, { type: "disconnected" }, { type: "reloaded" },
       { type: "unlock", unlock }]);
   });
@@ -103,18 +112,18 @@ describe("connectEvents", () => {
     const frames = [{ type: "toString" }, { type: "constructor" }, { type: "other" }, { type: 1 }, {}, { type: "unlock" },
       { type: "unlock", unlock: null }];
     for (const frame of frames) {
-      FakeSocket.latest.send(JSON.stringify(frame));
+      FakeSocket.latest.deliver(JSON.stringify(frame));
     }
-    FakeSocket.latest.send("null");
-    FakeSocket.latest.send("42");
+    FakeSocket.latest.deliver("null");
+    FakeSocket.latest.deliver("42");
     expect(events).toEqual([]);
   });
 
   it("ignores frames that aren't JSON and keeps listening", () => {
     connect();
     FakeSocket.latest.accept();
-    expect(() => FakeSocket.latest.send("not json {")).not.toThrow();
-    FakeSocket.latest.send(JSON.stringify({ type: "reloaded" }));
+    expect(() => FakeSocket.latest.deliver("not json {")).not.toThrow();
+    FakeSocket.latest.deliver(JSON.stringify({ type: "reloaded" }));
     expect(events).toEqual([{ type: "reloaded" }]);
     expect(FakeSocket.all).toHaveLength(1);
   });
@@ -155,7 +164,7 @@ describe("connectEvents", () => {
     expect(vi.getTimerCount()).toBe(0);
     vi.advanceTimersByTime(60_000);
     for (const socket of FakeSocket.all) {
-      socket.send(JSON.stringify({ type: "reloaded" }));
+      socket.deliver(JSON.stringify({ type: "reloaded" }));
       socket.drop();
     }
     vi.advanceTimersByTime(60_000);
@@ -167,7 +176,7 @@ describe("connectEvents", () => {
 
   it("stops for good while connecting", () => {
     connect();
-    stop?.();
+    stop();
     expect(FakeSocket.all).toHaveLength(1);
     expectSilenceAfterStop();
     expect(FakeSocket.all).toHaveLength(1);
@@ -176,7 +185,7 @@ describe("connectEvents", () => {
   it("stops for good while open", () => {
     connect();
     FakeSocket.latest.accept();
-    stop?.();
+    stop();
     expectSilenceAfterStop();
     expect(FakeSocket.all).toHaveLength(1);
   });
@@ -185,7 +194,7 @@ describe("connectEvents", () => {
     connect();
     FakeSocket.latest.drop();
     expect(vi.getTimerCount()).toBe(1);
-    stop?.();
+    stop();
     expectSilenceAfterStop();
     expect(FakeSocket.all).toHaveLength(1);
   });
@@ -196,9 +205,38 @@ describe("connectEvents", () => {
     const socket = FakeSocket.latest;
     // A browser fires the close event later; simulate a socket whose close() does nothing yet
     socket.close = () => {};
-    stop?.();
+    stop();
     socket.close = FakeSocket.prototype.close;
     socket.drop();
     expectSilenceAfterStop();
   });
 });
+
+describe("the matrix tester on the events link", () => {
+  it("passes on the keys held, and ignores a matrix event without them", () => {
+    connect();
+    FakeSocket.latest.accept();
+    const matrix = { state: "testing", pressed: [{ row: 1, col: 2 }] };
+    FakeSocket.latest.deliver(JSON.stringify({ type: "matrix", matrix }));
+    for (const frame of [{ type: "matrix" }, { type: "matrix", matrix: null }, { type: "matrix", matrix: {} }]) {
+      FakeSocket.latest.deliver(JSON.stringify(frame));
+    }
+    expect(events).toEqual([{ type: "matrix", matrix }]);
+  });
+
+  it("sends what the page asks for only while the link is open", () => {
+    connect();
+    link!.send({ type: "matrix", watch: true });
+    expect(FakeSocket.latest.sent).toEqual([]);
+    FakeSocket.latest.accept();
+    link!.send({ type: "matrix", watch: true });
+    expect(FakeSocket.latest.sent).toEqual(['{"type":"matrix","watch":true}']);
+    FakeSocket.latest.drop();
+    link!.send({ type: "matrix", watch: false });
+    vi.advanceTimersByTime(500);
+    // a new link: nothing is sent again by itself
+    expect(FakeSocket.all).toHaveLength(2);
+    FakeSocket.latest.accept();
+    expect(FakeSocket.latest.sent).toEqual([]);
+  });
+});
```

```bash
cd web && npx vitest run src/api/events.test.ts
```

Expected: `link?.close is not a function` and `Tests  13 failed (13)`.

- [ ] **Step 6: The link that sends, and the store that keeps it**

Apply to `web/src/api/events.ts`:

```diff
diff --git a/web/src/api/events.ts b/web/src/api/events.ts
--- a/web/src/api/events.ts
+++ b/web/src/api/events.ts
@@ -1,40 +1,61 @@
-// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed.
+// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed; and,
+// while the page asks for them, the keys held (the matrix tester).
 import type { ServerEvent } from "./types";
 
 export type { ServerEvent };
 export type LinkState = "connecting" | "open" | "closed";
 
+/** What the page can ask the server for on the events link */
+export type ClientMessage = { type: "matrix"; watch: boolean };
+
+/** The events link: close() ends it for good; send() asks the server for something, if the link is open (a link
+ * opened again starts with nothing asked: whoever asked asks again when it opens) */
+export interface EventsLink {
+  close(): void;
+  send(message: ClientMessage): void;
+}
+
 const RETRY_FIRST_MS = 500;
 const RETRY_MAX_MS = 5000;
 
-const EVENTS: Record<ServerEvent["type"], true> = { connected: true, disconnected: true, reloaded: true, unlock: true };
+const EVENTS: Record<ServerEvent["type"], true> = {
+  connected: true, disconnected: true, reloaded: true, unlock: true, matrix: true,
+};
 
-/** An event of a known type; an "unlock" one must carry the unlock state */
+/** An event of a known type; an "unlock" one must carry the unlock state, a "matrix" one the keys held */
 function isServerEvent(frame: unknown): frame is ServerEvent {
-  const { type, unlock } = (frame ?? {}) as { type?: unknown; unlock?: unknown };
+  const { type, unlock, matrix } = (frame ?? {}) as { type?: unknown; unlock?: unknown; matrix?: unknown };
   if (typeof type !== "string" || !Object.hasOwn(EVENTS, type)) return false;
-  return type !== "unlock" || (typeof unlock === "object" && unlock !== null);
+  if (type === "unlock") return typeof unlock === "object" && unlock !== null;
+  if (type === "matrix") {
+    const pressed = (matrix as { pressed?: unknown } | null)?.pressed;
+    return typeof matrix === "object" && matrix !== null && Array.isArray(pressed);
+  }
+  return true;
 }
 
-/** Keeps a WebSocket to /api/events open, reconnecting when it drops. Returns a function that closes it for good. */
+/** Keeps a WebSocket to /api/events open, reconnecting when it drops */
 export function connectEvents(
   onEvent: (event: ServerEvent) => void,
   onLink: (state: LinkState) => void,
-): () => void {
+): EventsLink {
   let socket: WebSocket | null = null;
   let retry = RETRY_FIRST_MS;
   let timer: ReturnType<typeof setTimeout> | undefined;
   let stopped = false;
+  let open = false;
 
-  function open() {
+  function connect() {
     onLink("connecting");
     const scheme = location.protocol === "https:" ? "wss:" : "ws:";
-    socket = new WebSocket(`${scheme}//${location.host}/api/events`);
-    socket.onopen = () => {
+    const current = new WebSocket(`${scheme}//${location.host}/api/events`);
+    socket = current;
+    current.onopen = () => {
       retry = RETRY_FIRST_MS;
+      open = true;
       onLink("open");
     };
-    socket.onmessage = (message) => {
+    current.onmessage = (message) => {
       let frame: unknown;
       try {
         frame = JSON.parse(String(message.data));
@@ -43,19 +64,25 @@ export function connectEvents(
       }
       if (isServerEvent(frame)) onEvent(frame);
     };
-    socket.onclose = () => {
+    current.onclose = () => {
       socket = null;
+      open = false;
       if (stopped) return;
       onLink("closed");
-      timer = setTimeout(open, retry);
+      timer = setTimeout(connect, retry);
       retry = Math.min(retry * 2, RETRY_MAX_MS);
     };
   }
 
-  open();
-  return () => {
-    stopped = true;
-    clearTimeout(timer);
-    socket?.close();
+  connect();
+  return {
+    close() {
+      stopped = true;
+      clearTimeout(timer);
+      socket?.close();
+    },
+    send(message) {
+      if (open && socket) socket.send(JSON.stringify(message));
+    },
   };
 }
```

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -4,7 +4,7 @@ import { untrack } from "svelte";
 import { api } from "../api/api";
 import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
 import { ApiError, causeMessage, failureMessage } from "../api/errors";
-import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
+import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "../api/events";
 import type {
   AltRepeatKeyIn, KeyboardLanguage, KeyboardModel, KeycodeCategory, KeyOverrideIn, MacroActionIn, Named, QmkSetting,
   Session, TapDanceIn,
@@ -82,6 +82,7 @@ export class KeyboardStore {
   #opening = false;
   /** the language list, or null when it couldn't be read */
   #languageList: Promise<KeyboardLanguage[] | null> = Promise.resolve(null);
+  #link: EventsLink | null = null;
 
   /** Load the language list, then follow the server's events (which start with the keyboard's state) */
   start(): () => void {
@@ -96,7 +97,12 @@ export class KeyboardStore {
         },
         () => null,
       );
-      return connectEvents((event) => this.#onEvent(event), (state) => this.#onLink(state));
+      const link = connectEvents((event) => this.#onEvent(event), (state) => this.#onLink(state));
+      this.#link = link;
+      return () => {
+        link.close();
+        if (this.#link === link) this.#link = null;
+      };
     });
   }
 
```

The store's tests: the mocked link has `close` and `send`, and a test event has every field the generated type asks for (the server leaves out what an event doesn't carry):

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -24,7 +24,7 @@ vi.mock("../api/api", () => ({
     lock: vi.fn(),
   },
 }));
-vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => () => undefined) }));
+vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })) }));
 vi.mock("../api/client", () => ({ DEFAULT_LANGUAGE: "en-us", setRequestLanguage: vi.fn() }));
 
 const { api } = await import("../api/api");
@@ -104,8 +104,12 @@ function started() {
   const store = new KeyboardStore();
   store.start();
   const [onEvent, onLink] = vi.mocked(connectEvents).mock.calls.at(-1)!;
+  const events = vi.mocked(connectEvents).mock.results.at(-1)!.value as { send: ReturnType<typeof vi.fn> };
   onLink("open");
-  return { store, emit: (type: ServerEvent["type"]) => onEvent({ type, unlock: null }), send: onEvent, link: onLink };
+  // the server leaves out what an event doesn't carry
+  const send = (event: Pick<ServerEvent, "type"> & Partial<ServerEvent>) => onEvent({ unlock: null, matrix: null, ...event });
+  return { store, emit: (type: ServerEvent["type"]) => send({ type }), send, link: onLink,
+    sent: events.send };
 }
 
 /** A started store that has loaded model("KC_A") and can edit */
```

```bash
cd web && npx vitest run src/api/events.test.ts src/lib/keyboard.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  68 passed (68)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  663 passed (663)`.

- [ ] **Step 7: Run the e2e tests: the page still follows the keyboard over the changed link**

```bash
cd web && npm run e2e
```

Expected: `118 passed`.

- [ ] **Step 8: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_matrix.py \
  web/src/api/events.test.ts \
  web/src/api/events.ts \
  web/src/api/schema.d.ts \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts
git commit -m "feat(server): the matrix tester subscription on the events socket, paced, and a fake-only key press hook"
```

### Task 5: Reboot to bootloader, refused while the keyboard is locked

Qt's Security > Reboot to bootloader runs `Unlocker.unlock`, then `keyboard.reset()`. `DeviceManager.reboot_to_bootloader()` does the same in the server's way:

- the keyboard must be unlocked (`require_unlocked`): a locked one raises `KeyboardLocked` (423), and the UI unlocks it and asks again;
- the request is sent **once**: the firmware answers, waits 100 ms and jumps, so a second send would reach the bootloader;
- a reply of `id_unhandled` is a firmware built with VIAL_INSECURE, which has no jump: `KeyboardRefused` (422) with the reason, and the keyboard stays;
- after the jump the keyboard is closed with a `disconnected` event. The hot-plug poll doesn't find it again, because in its bootloader it is no Vial keyboard.

`POST /api/bootloader` answers the session (now without the keyboard).

**Files:**
- Modify: `src/main/python/server/device.py`
- Modify: `src/main/python/server/app.py`
- Test: `src/main/python/test/test_matrix.py`
- Test: `src/main/python/test/test_dump_openapi.py`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_matrix.py`:

```diff
diff --git a/src/main/python/test/test_matrix.py b/src/main/python/test/test_matrix.py
--- a/src/main/python/test/test_matrix.py
+++ b/src/main/python/test/test_matrix.py
@@ -1,5 +1,7 @@
-""" The matrix tester (the keys held, read while a tab watches), against the simulated keyboard """
+""" The matrix tester (the keys held, read while a tab watches) and the reboot to the bootloader, against the simulated
+keyboard """
 import asyncio
+import threading
 import time
 
 import pytest
@@ -9,8 +11,8 @@ import transport
 from protocol.constants import CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE
 from protocol.unlock_hook import set_unlock_handler
 from server.app import MatrixWatcher, create_app
-from server.device import DeviceManager, FakeBackend, MatrixReading, has_matrix_tester, matrix_pressed, \
-    require_unlocked
+from server.device import DeviceManager, FakeBackend, KeyboardLocked, KeyboardRefused, MatrixReading, \
+    has_matrix_tester, matrix_pressed, require_unlocked
 from server.names import NamesStore
 from simulator.corne import UNLOCK_KEYS, make_corne
 from simulator.virtual_keyboard import VirtualKeyboard
@@ -341,3 +343,89 @@ def test_the_simulator_hook_presses_and_lets_go(served):
     assert manager.backend.virtual.pressed == {(2, 3)}
     assert press(client, 2, 3, False) == {"pressed": []}
     assert client.put("/api/simulator/matrix", json={"row": 256, "col": 0, "pressed": True}).status_code == 422
+
+
+# ---------- reboot to the bootloader ----------
+
+def test_rebooting_needs_an_unlocked_keyboard(tmp_path):
+    manager = connected(locked_corne)
+    with pytest.raises(KeyboardLocked):
+        manager.reboot_to_bootloader()
+    vk = manager.backend.virtual
+    assert vk.connected and not vk.bootloader_requested
+    assert manager.connected
+
+
+def test_rebooting_drops_the_keyboard():
+    manager = connected()
+    manager.reboot_to_bootloader()
+    assert manager.backend.virtual.bootloader_requested
+    assert not manager.connected
+    assert manager.take_events() == ["disconnected"]
+    # it isn't found again: in its bootloader it is no Vial keyboard
+    assert manager.check() == []
+
+
+def test_firmware_without_the_jump_says_so_and_stays():
+    manager = connected(lambda: VirtualKeyboard(make_corne().definition, bootloader_jump=False))
+    with pytest.raises(KeyboardRefused, match="can't restart into its bootloader"):
+        manager.reboot_to_bootloader()
+    assert manager.connected
+    assert manager.run(lambda kb: kb.get_unlock_status()) == 1
+
+
+def test_the_bootloader_route(served):
+    client, manager = served
+    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
+        assert ws.receive_json() == {"type": "connected"}
+        session = client.post("/api/bootloader").json()
+        assert (session["status"], session["device"], session["error"]) == ("disconnected", None, None)
+        assert ws.receive_json() == {"type": "disconnected"}
+    assert manager.backend.virtual.bootloader_requested
+    assert client.get("/api/keyboard").status_code == 503
+
+
+def test_the_bootloader_route_refuses_a_locked_keyboard(tmp_path):
+    manager = connected(locked_corne)
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        response = client.post("/api/bootloader")
+        assert response.status_code == 423
+        assert response.json()["detail"] == "the keyboard is locked: unlock it to make this change"
+        assert client.get("/api/session").json()["status"] == "connected"
+        assert not manager.backend.virtual.bootloader_requested
+
+
+def test_the_bootloader_route_with_firmware_without_the_jump(tmp_path):
+    manager = connected(lambda: VirtualKeyboard(make_corne().definition, bootloader_jump=False))
+    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
+    with TestClient(app, base_url=BASE) as client:
+        client.get("/?token=" + TOKEN)
+        response = client.post("/api/bootloader")
+        assert response.status_code == 422
+        assert "built without that" in response.json()["detail"]
+        assert client.get("/api/session").json()["status"] == "connected"
+
+
+def test_waiting_reboot_requests_wait_for_the_device_lock():
+    """ A reboot sent while another request holds the keyboard waits for it, then jumps """
+    manager = connected()
+    release = threading.Event()
+    holding = threading.Event()
+
+    def hold(kb):
+        holding.set()
+        release.wait(5)
+    worker = threading.Thread(target=manager.run, args=(hold,))
+    worker.start()
+    assert holding.wait(5)
+    done = []
+    rebooter = threading.Thread(target=lambda: done.append(manager.reboot_to_bootloader()))
+    rebooter.start()
+    pause(0.05)
+    assert not done and not manager.backend.virtual.bootloader_requested
+    release.set()
+    worker.join(5)
+    rebooter.join(5)
+    assert manager.backend.virtual.bootloader_requested
```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -19,7 +19,8 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
     # test aids of fake mode, not part of the API
     assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
     assert "/api/simulator/matrix" not in schema["paths"]
-    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/lighting/save"} <= set(schema["paths"])
+    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/bootloader", "/api/lighting/save"} <= set(
+        schema["paths"])
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py test/test_dump_openapi.py
```

Expected: `'DeviceManager' object has no attribute 'reboot_to_bootloader'` and `8 failed, 20 passed`.

- [ ] **Step 3: The jump and its route**

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -7,7 +7,8 @@ import time
 from collections import namedtuple
 from dataclasses import dataclass
 
-from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID, VIAL_PROTOCOL_MATRIX_TESTER
+from protocol.constants import CMD_VIA_BOOTLOADER_JUMP, CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID, \
+    VIA_ID_UNHANDLED, VIAL_PROTOCOL_MATRIX_TESTER
 from protocol.keyboard_comm import Keyboard
 from simulator.device import SimulatedHidDevice
 
@@ -533,7 +534,7 @@ class DeviceManager:
                 self.pending_events.append("unlock")
             return self.unlock_state()
 
-    # ---------- matrix tester ----------
+    # ---------- matrix tester, bootloader ----------
 
     def poll_matrix(self):
         """ Read which keys are held: one request, under the device lock. The firmware hides them (a would-be
@@ -550,6 +551,23 @@ class DeviceManager:
             data = self._io(keyboard, lambda kb: kb.matrix_poll())
             return MatrixReading("testing", tuple(matrix_pressed(data, keyboard.rows, keyboard.cols)))
 
+    def reboot_to_bootloader(self):
+        """ Restart the keyboard into its bootloader, as Qt's Security > Reboot to bootloader does: the keyboard must
+        be unlocked (KeyboardLocked otherwise), and then jumps (via.c id_bootloader_jump), leaving Vial: it is closed,
+        with a "disconnected" event. A firmware built without the jump (VIAL_INSECURE) answers that it doesn't know the
+        command: KeyboardRefused, and the keyboard stays. """
+        with self.lock:
+            def jump(kb):
+                require_unlocked(kb)
+                # one try: the firmware answers, waits 100 ms and jumps; sent again, it would reach the bootloader
+                return kb.usb_send(kb.dev, struct.pack("B", CMD_VIA_BOOTLOADER_JUMP))
+            reply = self.run(jump)
+            if reply[0] == VIA_ID_UNHANDLED:
+                raise KeyboardRefused("this keyboard's firmware can't restart into its bootloader from Vial (it is "
+                                      "built without that)")
+            log.info("%s restarted into its bootloader", self.title)
+            self._close_reporting()
+
     # ---------- hot-plug ----------
 
     def check(self):
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -660,6 +660,16 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         await broadcast_events(await asyncio.to_thread(manager.take_events))
         return unlock_model(state)
 
+    @app.post("/api/bootloader", response_model=schemas.Session)
+    async def reboot_to_bootloader():
+        """ Restart the keyboard into its bootloader (to flash it): it stops working as a keyboard and leaves Vial until
+        it is flashed or plugged in again. Refused (423) while it is locked. Returns the session, without it. """
+        try:
+            await asyncio.to_thread(manager.reboot_to_bootloader)
+        finally:
+            await broadcast_events(await asyncio.to_thread(manager.take_events))
+        return session()
+
     @app.websocket("/api/events")
     async def events(ws: WebSocket):
         if ws.headers.get("host") not in allowed_hosts or \
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_matrix.py test/test_dump_openapi.py
```

Expected: `28 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `904 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types, and check the UI still type-checks**

```bash
cd web && npm run gen:api && npm run check:api && npm run check && npm test
```

Expected: `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  663 passed (663)`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/device.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_matrix.py \
  web/src/api/schema.d.ts
git commit -m "feat(server): reboot to bootloader, refused while the keyboard is locked"
```

### Task 6: A keyboard found but not read says why; the empty page has the Linux udev hint

The parity check found two gaps against Qt. Qt says "Unsupported protocol version!" for a keyboard whose firmware speaks a newer protocol; the web UI said "No keyboard found", because `check_protocol_version` raised a `ProtocolError` without a message. Now the error names the protocols, the session carries it, and the page says "A keyboard was found, but couldn't be read" with the reason. Qt's "No devices detected" also tells Linux users about the udev rule; the web UI's "No keyboard found" page now links to Vial's udev instructions.

**Files:**
- Modify: `src/main/python/protocol/keyboard_comm.py`
- Test: `src/main/python/test/test_device_manager.py`
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Write the failing test**

Apply to `src/main/python/test/test_device_manager.py`:

```diff
diff --git a/src/main/python/test/test_device_manager.py b/src/main/python/test/test_device_manager.py
--- a/src/main/python/test/test_device_manager.py
+++ b/src/main/python/test/test_device_manager.py
@@ -334,3 +334,15 @@ def test_hid_backend_present_only_lists_the_keyboards_ids(monkeypatch):
     assert HidBackend().present(desc)
     assert not HidBackend().present(dict(desc, path=b"other"))
     assert calls == [(0x55D4, 0x0461)] * 2
+
+
+def test_a_keyboard_of_an_unknown_protocol_is_reported_with_why():
+
+    def newer():
+        vk = make_corne()
+        vk.vial_protocol = 99
+        return vk
+    manager = DeviceManager(FakeBackend(newer))
+    assert not manager.connect()
+    assert manager.status().error == ("its firmware speaks a protocol this Vial doesn't know (VIA 9, Vial 99): a newer "
+                                      "Vial may read it")
```

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_device_manager.py
```

Expected: `1 failed, 24 passed`: the error says only ProtocolError.

- [ ] **Step 2: The reason**

Apply to `src/main/python/protocol/keyboard_comm.py`:

```diff
diff --git a/src/main/python/protocol/keyboard_comm.py b/src/main/python/protocol/keyboard_comm.py
--- a/src/main/python/protocol/keyboard_comm.py
+++ b/src/main/python/protocol/keyboard_comm.py
@@ -110,7 +110,8 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
 
     def check_protocol_version(self):
         if self.via_protocol not in SUPPORTED_VIA_PROTOCOL or self.vial_protocol not in SUPPORTED_VIAL_PROTOCOL:
-            raise ProtocolError()
+            raise ProtocolError("its firmware speaks a protocol this Vial doesn't know (VIA {}, Vial {}): a newer "
+                                "Vial may read it".format(self.via_protocol, self.vial_protocol))
 
     def reload_layout(self, sideload_json=None):
         """ Requests layout data from the current device """
```

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_device_manager.py
```

Expected: `25 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `905 passed, 1 skipped`.

- [ ] **Step 3: The page says why, and has the udev hint**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -163,10 +163,20 @@
         <h1>The keyboard waits to be unlocked</h1>
         <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
       </div>
+    {:else if status === "disconnected" && keyboard.session?.error}
+      <div class="empty">
+        <h1>A keyboard was found, but couldn't be read</h1>
+        <p>{keyboard.session.error}</p>
+        <p>Vial tries again by itself, and when it is plugged in again.</p>
+      </div>
     {:else if status === "disconnected"}
       <div class="empty">
         <h1>No keyboard found</h1>
         <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
+        <p class="hint">
+          On Linux, Vial needs a udev rule to see keyboards:
+          <a href="https://get.vial.today/manual/linux-udev.html" target="_blank" rel="noreferrer">how to add it</a>.
+        </p>
       </div>
     {:else if !keyboard.loadError}
       <div class="empty" aria-busy="true">
@@ -228,6 +238,18 @@
     margin: 0;
   }
 
+  .empty p + p {
+    margin-top: 6px;
+  }
+
+  .empty .hint {
+    font-size: 13px;
+  }
+
+  .empty a {
+    color: var(--accent);
+  }
+
   @media (min-width: 1000px) {
     .shell {
       grid-template-columns: var(--nav-width) minmax(0, var(--content-max));
```

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 4: Commit**

```bash
git add src/main/python/protocol/keyboard_comm.py \
  src/main/python/test/test_device_manager.py \
  web/src/App.svelte
git commit -m "fix: a keyboard found but not read says why, and the empty page has the Linux udev hint"
```

### Task 7: API calls and store methods for layout options, lighting, the matrix tester and the bootloader

The routes from Tasks 2 to 5, and the existing `PUT /api/layout-options`, get their calls in `api.ts`, and the store gets methods for the pages:

- `setLayoutOptions(value)`: through `#edit`; the model keeps what the keyboard answered.
- `setLighting(body, action?)` and `saveLighting()`: through `#edit`; the model's `lighting` becomes what the keyboard answered (it can differ from what was asked).
- `rebootToBootloader()`: through `#edit`, so a 423 opens the unlock dialog and sends it once more after the unlock. Afterwards `inBootloader` is true and the keyboard is shown gone; a `connected` event clears it. A keyboard that can't be changed now (unplugged, being read) gets a toast and no request.
- `watchMatrix()`: returns a function that stops watching. The first watcher sends `{"type": "matrix", "watch": true}`, the last one to stop sends `false` and clears `matrix`. A link opened again asks again. A `matrix` event fills `matrix` only while something watches.

**Files:**
- Modify: `web/src/api/api.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/lib/keyboard.svelte.ts`
- Test: `web/src/lib/keyboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -22,6 +22,10 @@ vi.mock("../api/api", () => ({
     unlockStart: vi.fn(),
     unlockCancel: vi.fn(),
     lock: vi.fn(),
+    setLayoutOptions: vi.fn(),
+    setLighting: vi.fn(),
+    saveLighting: vi.fn(),
+    rebootToBootloader: vi.fn(),
   },
 }));
 vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })) }));
@@ -860,3 +864,79 @@ describe("moving keycodes between keys", () => {
     expect(mocked.setKey).not.toHaveBeenCalled();
   });
 });
+
+describe("the phase 5b changes", () => {
+  it("sets the layout options and keeps what the keyboard answered", async () => {
+    const { store } = await loaded();
+    store.model!.layoutOptions = { value: 0, labels: ["Split"] };
+    mocked.setLayoutOptions.mockResolvedValueOnce({ value: 1 });
+    expect(await store.setLayoutOptions(1)).toBe(true);
+    expect(mocked.setLayoutOptions).toHaveBeenCalledWith(1);
+    expect(store.model!.layoutOptions!.value).toBe(1);
+  });
+
+  it("changes and saves the lighting, showing what the keyboard answered", async () => {
+    const { store } = await loaded();
+    const shown = { vialrgb: { mode: 3, speed: 9, hsv: [1, 2, 3], maxBrightness: 200, supportedEffects: [0, 3] } };
+    mocked.setLighting.mockResolvedValueOnce(shown as never);
+    expect(await store.setLighting({ vialrgb: { mode: 3 } })).toBe(true);
+    expect(store.model!.lighting).toEqual(shown);
+    mocked.saveLighting.mockResolvedValueOnce(shown as never);
+    expect(await store.saveLighting()).toBe(true);
+    mocked.setLighting.mockRejectedValueOnce(new ApiError(502));
+    expect(await store.setLighting({ vialrgb: { mode: 4 } }, "Choosing the effect")).toBe(false);
+    expect(toasts.items.map((t) => t.message)).toEqual(["Choosing the effect failed: The keyboard didn't respond."]);
+  });
+
+  it("restarts the keyboard into its bootloader after unlocking it, and shows it gone", async () => {
+    const { store, send, emit } = await loaded();
+    mocked.rebootToBootloader.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"))
+      .mockResolvedValueOnce({ status: "disconnected", fake: true, unlock: LOCKED } as never);
+    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
+    const rebooting = store.rebootToBootloader();
+    await settle();
+    expect(store.unlock.open).toBe(true);
+    send({ type: "unlock", unlock: UNLOCKED });
+    expect(await rebooting).toBe(true);
+    expect(mocked.rebootToBootloader).toHaveBeenCalledTimes(2);
+    expect(store.inBootloader).toBe(true);
+    expect(store.connected).toBe(false);
+    expect(store.canEdit).toBe(false);
+    emit("disconnected");
+    expect(store.inBootloader).toBe(true);
+    // flashed or plugged in again: back
+    emit("connected");
+    expect(store.inBootloader).toBe(false);
+  });
+
+  it("says why a keyboard that can't be changed isn't restarted", async () => {
+    const { store, emit } = await loaded();
+    emit("disconnected");
+    expect(await store.rebootToBootloader()).toBe(false);
+    expect(mocked.rebootToBootloader).not.toHaveBeenCalled();
+    expect(toasts.items.map((t) => t.message))
+      .toEqual(["Restarting the keyboard into its bootloader failed: the keyboard can't be changed just now."]);
+  });
+
+  it("asks for the keys held while a page watches, and again on a new link", async () => {
+    const { store, sent, link, send } = await loaded();
+    const stopFirst = store.watchMatrix();
+    const stopSecond = store.watchMatrix();
+    expect(sent.mock.calls).toEqual([[{ type: "matrix", watch: true }]]);
+    const matrix = { state: "testing" as const, pressed: [{ row: 0, col: 1 }] };
+    send({ type: "matrix", matrix });
+    expect(store.matrix).toEqual(matrix);
+    link("closed");
+    link("open");
+    expect(sent.mock.calls.at(-1)).toEqual([{ type: "matrix", watch: true }]);
+    stopFirst();
+    stopFirst();
+    expect(sent.mock.calls.filter(([m]) => !m.watch)).toEqual([]);
+    stopSecond();
+    expect(sent.mock.calls.at(-1)).toEqual([{ type: "matrix", watch: false }]);
+    expect(store.matrix).toBeNull();
+    // a late reading after the page stopped watching is dropped
+    send({ type: "matrix", matrix });
+    expect(store.matrix).toBeNull();
+  });
+});
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `store.setLayoutOptions is not a function` and `Tests  5 failed | 55 passed (60)`.

- [ ] **Step 2: The calls, the types and the store**

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -1,6 +1,6 @@
 // The server's routes the UI uses.
 import { download, request } from "./client";
-import type { AltRepeatKeyIn, ComboIn, KeyOverrideIn, MacroActionIn, Named, TapDanceIn } from "./types";
+import type { AltRepeatKeyIn, ComboIn, KeyOverrideIn, LightingIn, MacroActionIn, Named, TapDanceIn } from "./types";
 
 export const api = {
   session: () => request("get", "/api/session"),
@@ -12,6 +12,8 @@ export const api = {
     request("put", "/api/keymap/{layer}/{row}/{col}", { params: { layer, row, col }, body: { code } }),
   setEncoder: (layer: number, index: number, direction: number, code: string) =>
     request("put", "/api/encoders/{layer}/{index}/{direction}", { params: { layer, index, direction }, body: { code } }),
+  /** saved on the keyboard at once (via.c keeps them in its EEPROM) */
+  setLayoutOptions: (value: number) => request("put", "/api/layout-options", { body: { value } }),
   setTapDance: (index: number, body: TapDanceIn) =>
     request("put", "/api/tap-dance/{index}", { params: { index }, body }),
   setCombo: (index: number, body: ComboIn) => request("put", "/api/combos/{index}", { params: { index }, body }),
@@ -25,6 +27,10 @@ export const api = {
   setSetting: (qsid: number, value: number) =>
     request("put", "/api/qmk-settings/{qsid}", { params: { qsid }, body: { value } }),
   resetSettings: () => request("post", "/api/qmk-settings/reset"),
+  /** shown at once, forgotten when the keyboard is unplugged unless saved; answers what the keyboard shows */
+  setLighting: (body: LightingIn) => request("put", "/api/lighting", { body }),
+  /** keeps the lighting the keyboard shows when it is unplugged */
+  saveLighting: () => request("post", "/api/lighting/save"),
   /** the keyboard's layout as a .vil file, named after the keyboard */
   layoutFile: () => download("/api/layout-file", "keyboard.vil"),
   /** what loading a .vil file would change; nothing is written */
@@ -36,4 +42,6 @@ export const api = {
   unlockStart: () => request("post", "/api/unlock/start"),
   unlockCancel: () => request("post", "/api/unlock/cancel"),
   lock: () => request("post", "/api/lock"),
+  /** the keyboard restarts into its bootloader and leaves; answers the session without it */
+  rebootToBootloader: () => request("post", "/api/bootloader"),
 };
```

Apply to `web/src/api/types.ts`:

```diff
diff --git a/web/src/api/types.ts b/web/src/api/types.ts
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -37,5 +37,11 @@ export type SettingsDefinitions = Schemas["SettingsDefinitions"];
 export type LayoutFilePreview = Schemas["LayoutFilePreview"];
 export type UnlockState = Schemas["UnlockState"];
 export type MatrixPosition = Schemas["MatrixPosition"];
+export type MatrixState = Schemas["MatrixState"];
+export type Lighting = Schemas["Lighting"];
+export type LightingIn = Schemas["LightingIn"];
+export type VialRgb = Schemas["VialRgb"];
+export type RgbLight = Schemas["RgbLight"];
+export type Backlight = Schemas["Backlight"];
 /** what /api/events sends */
 export type ServerEvent = Schemas["Event"];
```

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -6,8 +6,8 @@ import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
 import { ApiError, causeMessage, failureMessage } from "../api/errors";
 import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "../api/events";
 import type {
-  AltRepeatKeyIn, KeyboardLanguage, KeyboardModel, KeycodeCategory, KeyOverrideIn, MacroActionIn, Named, QmkSetting,
-  Session, TapDanceIn,
+  AltRepeatKeyIn, KeyboardLanguage, KeyboardModel, KeycodeCategory, KeyOverrideIn, LightingIn, MacroActionIn,
+  MatrixState, Named, QmkSetting, Session, TapDanceIn,
 } from "../api/types";
 import { keyTitle, namesOf } from "../keyboard/labels";
 import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
@@ -71,6 +71,11 @@ export class KeyboardStore {
   pending = $state(0);
   /** whether the keyboard is unlocked, and the unlock dialog */
   readonly unlock = new Unlocker();
+  /** the keys held, as the server last read them, while the matrix tester watches (watchMatrix); null before the
+   * first reading */
+  matrix = $state.raw<MatrixState | null>(null);
+  /** this page restarted the keyboard into its bootloader, and it hasn't come back since */
+  inBootloader = $state(false);
 
   canEdit = $derived(this.model !== null && !this.stale && this.connected && this.link === "open");
 
@@ -83,6 +88,8 @@ export class KeyboardStore {
   /** the language list, or null when it couldn't be read */
   #languageList: Promise<KeyboardLanguage[] | null> = Promise.resolve(null);
   #link: EventsLink | null = null;
+  /** pages watching the keys held */
+  #matrixWatchers = 0;
 
   /** Load the language list, then follow the server's events (which start with the keyboard's state) */
   start(): () => void {
@@ -106,9 +113,30 @@ export class KeyboardStore {
     });
   }
 
+  /** Get the keys held, about 20 times a second while the keyboard is unlocked (in `matrix`), until the function it
+   * returns is called. The server reads them while any page of any tab watches. */
+  watchMatrix(): () => void {
+    this.#matrixWatchers++;
+    if (this.#matrixWatchers === 1) this.#link?.send({ type: "matrix", watch: true });
+    let watching = true;
+    return () => {
+      if (!watching) return;
+      watching = false;
+      this.#matrixWatchers--;
+      if (this.#matrixWatchers === 0) {
+        this.#link?.send({ type: "matrix", watch: false });
+        this.matrix = null;
+      }
+    };
+  }
+
   #onLink(state: LinkState): void {
     this.link = state;
-    if (state === "open") this.#opening = true;
+    if (state === "open") {
+      this.#opening = true;
+      // a link opened again starts with nothing asked for
+      if (this.#matrixWatchers > 0) this.#link?.send({ type: "matrix", watch: true });
+    }
   }
 
   #onEvent(event: ServerEvent): void {
@@ -116,6 +144,10 @@ export class KeyboardStore {
       if (event.unlock) this.unlock.update(event.unlock);
       return;
     }
+    if (event.type === "matrix") {
+      if (event.matrix && this.#matrixWatchers > 0) this.matrix = event.matrix;
+      return;
+    }
     // the server's first event on a link (re)opened says how the keyboard is: a "connected" there, when it was
     // connected already, is no plug, unless the load it brings finds another keyboard (see load)
     const opening = this.#opening;
@@ -123,6 +155,7 @@ export class KeyboardStore {
     const unchanged = event.type === "reloaded" || (opening && event.type === "connected" && this.connected);
     if (!unchanged) this.#plugs++;
     this.connected = event.type !== "disconnected";
+    if (event.type === "connected") this.inBootloader = false;
     this.stale = true;
     if (this.connected) {
       void this.load();
@@ -292,6 +325,53 @@ export class KeyboardStore {
     return (await this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key")) ? index : null;
   }
 
+  /** Choose the keyboard's layout options (all of them, as one number): the keyboard keeps them at once */
+  setLayoutOptions(value: number, action = "Changing the layout"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      const set = await api.setLayoutOptions(value);
+      if (model.layoutOptions) model.layoutOptions.value = set.value;
+    });
+  }
+
+  /** Change the lighting: the keyboard shows it at once, and keeps it only once saved (saveLighting). The model gets
+   * what the keyboard shows afterwards, which can differ (its brightness steps, a change it ignores). */
+  setLighting(body: LightingIn, action = "Changing the lighting"): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit(action, model, async () => {
+      model.lighting = await api.setLighting(body);
+    });
+  }
+
+  /** Keep the lighting the keyboard shows when it is unplugged */
+  saveLighting(): Promise<boolean> {
+    const model = this.model;
+    if (!model || !this.canEdit) return Promise.resolve(false);
+    return this.#edit("Saving the lighting", model, async () => {
+      model.lighting = await api.saveLighting();
+    });
+  }
+
+  /** Restart the keyboard into its bootloader, to flash it: it leaves Vial. A locked keyboard is unlocked first (the
+   * firmware takes it only then). */
+  rebootToBootloader(): Promise<boolean> {
+    const model = this.model;
+    if (!model) return Promise.resolve(false);
+    if (!this.canEdit) {
+      toasts.error("Restarting the keyboard into its bootloader failed: the keyboard can't be changed just now.");
+      return Promise.resolve(false);
+    }
+    return this.#edit("Restarting the keyboard into its bootloader", model, async () => {
+      const session = await api.rebootToBootloader();
+      this.inBootloader = true;
+      // it is gone: the "disconnected" event says so too, maybe after this reply
+      this.connected = session.status === "connected";
+      this.#useSession(session);
+    });
+  }
+
   /** Set a tap dance's four slots and its tapping term */
   setTapDance(index: number, body: TapDanceIn, action = "Changing the tap dance"): Promise<boolean> {
     const model = this.model;
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `Tests  60 passed (60)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  668 passed (668)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/api.ts \
  web/src/api/types.ts \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts
git commit -m "feat(web): API calls and store methods for layout options, lighting, the matrix tester and the bootloader"
```

### Task 8: Addresses for the new pages, a layout option's choice, and a layer's faces

Three small pieces the pages share:

- **`route.ts`:** the sections `layout`, `lighting` and `matrix`, each a whole page (`#lighting/1` is `#lighting`). This also fixes the phase 5a follow-ups: `routeHash` never names an entry of a whole-page section (`#settings/2` was possible), `SECTIONS` and `WHOLE` are read-only, and the redundant HOME branch is gone.
- **`geometry.ts`:** `choiceCount(label)` and `withLayoutChoice(options, index, choice)`, the layout options' value with one choice changed, packed exactly as `layoutChoices` reads it: the first option in the highest bits, an on/off option one bit, a list as many bits as its highest choice needs, at least one. Bits above the options are kept. A choice that doesn't exist throws a `RangeError`.
- **`labels.ts`:** `layerFaces(model, keys, layer, names)`, what each placed key shows on a layer, with an empty face where the layer has no keycode. The unlock dialog drew its keys this way; the Layout and Matrix tester pages draw theirs with it too.

**Files:**
- Modify: `web/src/lib/route.ts`
- Test: `web/src/lib/route.test.ts`
- Modify: `web/src/keyboard/geometry.ts`
- Test: `web/src/keyboard/geometry.test.ts`
- Modify: `web/src/keyboard/labels.ts`
- Test: `web/src/keyboard/labels.test.ts`
- Modify: `web/src/shell/UnlockDialog.svelte`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/lib/route.test.ts`:

```diff
diff --git a/web/src/lib/route.test.ts b/web/src/lib/route.test.ts
--- a/web/src/lib/route.test.ts
+++ b/web/src/lib/route.test.ts
@@ -14,10 +14,15 @@ describe("parseRoute", () => {
     expect(parseRoute("#settings")).toEqual({ section: "settings", item: null });
     expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null });
     expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null });
+    expect(parseRoute("#keyboard/3")).toEqual({ section: "keyboard", item: null });
+    for (const section of ["layout", "lighting", "matrix"] as const) {
+      expect(parseRoute(`#${section}`)).toEqual({ section, item: null });
+      expect(parseRoute(`#${section}/1`)).toEqual({ section, item: null });
+    }
   });
 
   it("is the keymap for anything else", () => {
-    for (const hash of ["", "#", "#lighting", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
+    for (const hash of ["", "#", "#rgb", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
       expect(parseRoute(hash)).toEqual(HOME);
     }
   });
@@ -26,8 +31,15 @@ describe("parseRoute", () => {
 describe("routeHash", () => {
   it("is what parseRoute reads back", () => {
     for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null },
-      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }] as const) {
+      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }, { section: "alt-repeat", item: 2 },
+      { section: "settings", item: null }, { section: "lighting", item: null }, { section: "matrix", item: null },
+      { section: "layout", item: null }] as const) {
       expect(parseRoute(routeHash(route))).toEqual(route);
     }
   });
+
+  it("never names an entry of a section that has none", () => {
+    expect(routeHash({ section: "settings", item: 2 })).toBe("#settings");
+    expect(routeHash({ section: "matrix", item: 0 })).toBe("#matrix");
+  });
 });
```

Apply to `web/src/keyboard/geometry.test.ts`:

```diff
diff --git a/web/src/keyboard/geometry.test.ts b/web/src/keyboard/geometry.test.ts
--- a/web/src/keyboard/geometry.test.ts
+++ b/web/src/keyboard/geometry.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import type { KeyGeometry, KeyboardModel } from "../api/types";
-import { boundsOf, encoderKnobs, layoutChoices, placeKeyboard } from "./geometry";
+import { boundsOf, choiceCount, encoderKnobs, layoutChoices, placeKeyboard, withLayoutChoice } from "./geometry";
 
 function key(fields: Partial<KeyGeometry>): KeyGeometry {
   return {
@@ -192,3 +192,32 @@ describe("boundsOf", () => {
     close((box.top + box.bottom) / 2, turned.cy);
   });
 });
+
+describe("withLayoutChoice", () => {
+  const labels = ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL", "HHKB"], ["Enter", "ANSI", "ISO", "Big"]];
+
+  it("changes one option's bits and leaves the others", () => {
+    const options = { value: 0, labels };
+    expect(withLayoutChoice(options, 0, 1)).toBe(0b1_00_00);
+    expect(withLayoutChoice({ value: 0b1_00_00, labels }, 1, 3)).toBe(0b1_11_00);
+    expect(withLayoutChoice({ value: 0b1_11_00, labels }, 2, 2)).toBe(0b1_11_10);
+    expect(withLayoutChoice({ value: 0b1_11_10, labels }, 0, 0)).toBe(0b0_11_10);
+    expect(layoutChoices({ value: 0b0_11_10, labels })).toEqual([0, 3, 2]);
+  });
+
+  it("keeps the bits above the options", () => {
+    expect(withLayoutChoice({ value: 0b1011_0_00_00, labels }, 1, 1)).toBe(0b1011_0_01_00);
+    expect(withLayoutChoice({ value: 0xfffffffe, labels: ["Flag"] }, 0, 1)).toBe(0xffffffff);
+  });
+
+  it("refuses an option or a choice that doesn't exist", () => {
+    expect(() => withLayoutChoice({ value: 0, labels }, 3, 0)).toThrow(RangeError);
+    expect(() => withLayoutChoice({ value: 0, labels }, 0, 2)).toThrow(RangeError);
+    expect(() => withLayoutChoice({ value: 0, labels }, 2, 3)).toThrow(RangeError); // 2 bits, 3 choices
+    expect(() => withLayoutChoice({ value: 0, labels }, 1, 1.5)).toThrow(RangeError);
+  });
+
+  it("counts the choices of each kind of option", () => {
+    expect(labels.map(choiceCount)).toEqual([2, 4, 3]);
+  });
+});
```

Apply to `web/src/keyboard/labels.test.ts`:

```diff
diff --git a/web/src/keyboard/labels.test.ts b/web/src/keyboard/labels.test.ts
--- a/web/src/keyboard/labels.test.ts
+++ b/web/src/keyboard/labels.test.ts
@@ -2,7 +2,7 @@ import { describe, expect, it } from "vitest";
 import type { Described, KeyboardModel } from "../api/types";
 import {
   actionSummary, compactLegendSize, HOLD_MAX_LINES, holdLines, holdSize, keyFace, keyLabel, keyTitle, legendScale, legendSizes, legendWords, MAIN_LINE, mainLines,
-  namesOf, toneOf, estimatedWidth, type Names, type TextWidth,
+  layerFaces, namesOf, toneOf, estimatedWidth, EMPTY_FACE, type Names, type TextWidth,
 } from "./labels";
 
 type Fields = Partial<Described> & Pick<Described, "code" | "kind" | "tap">;
@@ -533,3 +533,13 @@ describe("compactLegendSize", () => {
     expect(compactLegendSize("Bootloader", 12, 12, 14)).toBe(7);
   });
 });
+
+describe("layerFaces", () => {
+  it("gives each key its face on the layer, and an empty one where the layer has no keycode", () => {
+    const model = { layers: [{ keys: [modTap], encoders: [layerTap] }] } as unknown as KeyboardModel;
+    const faces = layerFaces(model, [{ kind: "key", index: 0 }, { kind: "encoder", index: 0 }, { kind: "key", index: 5 }],
+      0, names);
+    expect(faces).toEqual([keyFace(modTap, names), keyFace(layerTap, names), EMPTY_FACE]);
+    expect(layerFaces(model, [{ kind: "key", index: 0 }], 3, names)).toEqual([EMPTY_FACE]);
+  });
+});
```

```bash
cd web && npx vitest run src/lib/route.test.ts src/keyboard/geometry.test.ts src/keyboard/labels.test.ts
```

Expected: `withLayoutChoice is not a function` and `layerFaces is not a function` and `Tests  8 failed | 110 passed (118)`.

- [ ] **Step 2: The sections, the packing and the faces**

Apply to `web/src/lib/route.ts`:

```diff
diff --git a/web/src/lib/route.ts b/web/src/lib/route.ts
--- a/web/src/lib/route.ts
+++ b/web/src/lib/route.ts
@@ -2,14 +2,16 @@
 // Combos page. A reload stays where it was, and the browser's back button goes back.
 
 export type SectionId =
-  | "keymap" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "keyboard";
+  | "keymap" | "layout" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "lighting"
+  | "matrix" | "keyboard";
 
-export const SECTIONS: SectionId[] = [
-  "keymap", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "keyboard",
+export const SECTIONS: readonly SectionId[] = [
+  "keymap", "layout", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "lighting", "matrix",
+  "keyboard",
 ];
 
 /** sections that show one page of their own, with no entries for the address to name */
-const WHOLE: SectionId[] = ["keymap", "settings", "keyboard"];
+const WHOLE: readonly SectionId[] = ["keymap", "layout", "settings", "lighting", "matrix", "keyboard"];
 
 export interface Route {
   section: SectionId;
@@ -19,15 +21,16 @@ export interface Route {
 
 export const HOME: Route = { section: "keymap", item: null };
 
-/** "#combos/2" -> combo 2 on the Combos page; anything else is the keymap */
+/** "#combos/2" -> combo 2 on the Combos page; a section with no entries leaves the number out; anything else is the
+ * keymap */
 export function parseRoute(hash: string): Route {
   const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
   const section = SECTIONS.find((s) => s === m?.[1]);
   if (!m || !section) return HOME;
-  if (m[2] !== undefined && WHOLE.includes(section)) return section === "keymap" ? HOME : { section, item: null };
-  return { section, item: m[2] === undefined ? null : Number(m[2]) };
+  return { section, item: m[2] === undefined || WHOLE.includes(section) ? null : Number(m[2]) };
 }
 
+/** The address of a route; a section with no entries never names one */
 export function routeHash(route: Route): string {
-  return route.item === null ? `#${route.section}` : `#${route.section}/${route.item}`;
+  return route.item === null || WHOLE.includes(route.section) ? `#${route.section}` : `#${route.section}/${route.item}`;
 }
```

Apply to `web/src/keyboard/geometry.ts`:

```diff
diff --git a/web/src/keyboard/geometry.ts b/web/src/keyboard/geometry.ts
--- a/web/src/keyboard/geometry.ts
+++ b/web/src/keyboard/geometry.ts
@@ -34,6 +34,19 @@ export interface Placement {
 
 type Board = Pick<KeyboardModel, "keys" | "encoders" | "layoutOptions">;
 
+/** How many choices a layout option has: an on/off option (a name) two, a list (its name, then its choices) as many as
+ * it lists */
+export function choiceCount(label: string | string[]): number {
+  return typeof label === "string" ? 2 : label.length - 1;
+}
+
+/** The values each option's bits can hold: Vial pads to (count - 1).bit_length() bits but never below one, so a lone or
+ * missing choice still takes one */
+function optionSize(label: string | string[]): number {
+  const count = choiceCount(label);
+  return 2 ** (count <= 2 ? 1 : (count - 1).toString(2).length);
+}
+
 /** The chosen choice of each layout option. Vial packs them into one number, the first option in the highest bits:
  * an on/off option takes one bit, a list of choices as many bits as its highest choice needs, and at least one. */
 export function layoutChoices(options: LayoutOptions | null | undefined): number[] {
@@ -41,16 +54,32 @@ export function layoutChoices(options: LayoutOptions | null | undefined): number
   let value = options.value;
   const choices: number[] = [];
   for (const label of [...options.labels].reverse()) {
-    const count = typeof label === "string" ? 2 : label.length - 1;
-    // Vial pads to (count - 1).bit_length() but never below one bit, so a lone or missing choice still takes one
-    const bits = count <= 2 ? 1 : (count - 1).toString(2).length;
-    const size = 2 ** bits;
+    const size = optionSize(label);
     choices.unshift(value % size);
     value = Math.floor(value / size);
   }
   return choices;
 }
 
+/** The layout options' value with one option's choice changed, packed as layoutChoices reads it. Bits above those of
+ * the options (which nothing reads) are kept as the keyboard holds them. */
+export function withLayoutChoice(options: LayoutOptions, index: number, choice: number): number {
+  const choices = layoutChoices(options);
+  if (index < 0 || index >= choices.length) throw new RangeError(`there is no layout option ${index}`);
+  if (!Number.isInteger(choice) || choice < 0 || choice >= choiceCount(options.labels[index])) {
+    throw new RangeError(`layout option ${index} has no choice ${choice}`);
+  }
+  choices[index] = choice;
+  let span = 1;
+  let packed = 0;
+  options.labels.forEach((label, i) => {
+    const size = optionSize(label);
+    packed = packed * size + choices[i];
+    span *= size;
+  });
+  return Math.floor(options.value / span) * span + packed;
+}
+
 function rotate(x: number, y: number, r: number, rx: number, ry: number): [number, number] {
   if (!r) return [x, y];
   const a = (r * Math.PI) / 180;
```

Apply to `web/src/keyboard/labels.ts`:

```diff
diff --git a/web/src/keyboard/labels.ts b/web/src/keyboard/labels.ts
--- a/web/src/keyboard/labels.ts
+++ b/web/src/keyboard/labels.ts
@@ -1,5 +1,6 @@
 // What a key shows: on the key itself (keyFace) and in words in the Inspector (actionSummary, keyTitle).
 import type { Described, KeyKind, KeyboardModel } from "../api/types";
+import { actionAt, type KeyRef } from "./refs";
 
 /** The colour family of a key */
 export type Tone = "normal" | "mod" | "layer" | "tap-dance" | "macro" | "transparent" | "none";
@@ -69,6 +70,15 @@ export function keyFace(d: Described, names: Names): KeyFace {
   return { main: d.legend.main, shifted: d.legend.shifted ?? null, altGr: d.legend.altGr ?? null, hold, tone: toneOf(d.kind) };
 }
 
+/** What each key shows on a layer, aligned with `keys` (a drawing's placed keys): an empty face where the layer has no
+ * keycode */
+export function layerFaces(model: Pick<KeyboardModel, "layers">, keys: KeyRef[], layer: number, names: Names): KeyFace[] {
+  return keys.map((key) => {
+    const d = actionAt(model, layer, key);
+    return d ? keyFace(d, names) : EMPTY_FACE;
+  });
+}
+
 /** "Layer 1 · Symbols" for a named layer, "Layer 2" for an unnamed one */
 export function layerLabel(index: number, names: Names): string {
   return names.layerIsNamed(index) ? `Layer ${index} · ${names.layer(index)}` : names.layer(index);
```

```bash
cd web && npx vitest run src/lib/route.test.ts src/keyboard/geometry.test.ts src/keyboard/labels.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  118 passed (118)`.

- [ ] **Step 3: The unlock dialog draws its keys with `layerFaces`**

Apply to `web/src/shell/UnlockDialog.svelte`:

```diff
diff --git a/web/src/shell/UnlockDialog.svelte b/web/src/shell/UnlockDialog.svelte
--- a/web/src/shell/UnlockDialog.svelte
+++ b/web/src/shell/UnlockDialog.svelte
@@ -2,10 +2,9 @@
   import type { KeyboardModel } from "../api/types";
   import type { Placement } from "../keyboard/geometry";
   import Keyboard from "../keyboard/Keyboard.svelte";
-  import { EMPTY_FACE, keyFace, type Names } from "../keyboard/labels";
+  import { layerFaces, type Names } from "../keyboard/labels";
   import { onDestroy } from "svelte";
   import { andList } from "../analysis/phrases";
-  import { actionAt } from "../keyboard/refs";
   import { keyboard } from "../lib/keyboard.svelte";
   import { unlockProgress, type Unlocker } from "../lib/unlock.svelte";
   import Button from "../ui/Button.svelte";
@@ -118,10 +117,7 @@
     const unlockKey = placement.items.map((item) => item.kind === "key" &&
       keys.some((k) => k.row === item.geometry.row && k.col === item.geometry.col));
     return {
-      faces: placement.items.map((item) => {
-        const d = actionAt(model, 0, item);
-        return d ? keyFace(d, names) : EMPTY_FACE;
-      }),
+      faces: layerFaces(model, placement.items, 0, names),
       highlights: unlockKey,
       faded: unlockKey.map((u) => !u),
       labels: placement.items.map(() => ""),
```

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  40 passed (40)` and `Tests  674 passed (674)` and `built in`.

- [ ] **Step 4: Commit**

```bash
git add web/src/keyboard/geometry.test.ts \
  web/src/keyboard/geometry.ts \
  web/src/keyboard/labels.test.ts \
  web/src/keyboard/labels.ts \
  web/src/lib/route.test.ts \
  web/src/lib/route.ts \
  web/src/shell/UnlockDialog.svelte
git commit -m "refactor(web): addresses for the new pages, a layout option's choice, a layer's faces"
```

### Task 9: KeyGuard: keys pressed do nothing on the page

The unlock dialog swallows every key while it waits, because the unlock keys are held on the keyboard in use, which types them into the page; keys still held when it closes do nothing until they are let go. The matrix tester needs the same while it tests (Qt's tester grabs the keyboard). The code moves out of `UnlockDialog.svelte` into `lib/keyGuard.ts`, a class with `start()`, `stop()` (keys still held go on doing nothing until let go) and `dispose()`. It listens on `window` in the capture phase and stops every key event there; a blur or a hidden page forgets the keys held. The window and document are injected, so Vitest tests it without a browser.

**Files:**
- Create: `web/src/lib/keyGuard.ts`
- Test: `web/src/lib/keyGuard.test.ts` (new)
- Modify: `web/src/shell/UnlockDialog.svelte`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/keyGuard.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { KeyGuard } from "./keyGuard";

/** A key event as the browser sends it */
function key(type: string, code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: code });
  return event;
}

function setup() {
  const win = new EventTarget();
  const doc = new EventTarget();
  const guard = new KeyGuard(win, doc);
  // what the page itself listens to: it only sees what the guard lets through (a test window has no capture phase, so
  // the page listens after the guard, as listeners added after it on the window would)
  const seen: string[] = [];
  const listen = () => {
    for (const type of ["keydown", "keyup"]) win.addEventListener(type, (e) => seen.push(`${e.type} ${(e as KeyboardEvent).code}`));
  };
  const send = (type: string, code: string) => {
    const event = key(type, code);
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { win, doc, guard, seen, send, listen };
}

describe("KeyGuard", () => {
  it("lets keys through until it starts", () => {
    const { send, seen, listen } = setup();
    listen();
    expect(send("keydown", "Enter")).toBe(false);
    expect(seen).toEqual(["keydown Enter"]);
  });

  it("swallows every key while it is on", () => {
    const { guard, send, seen, listen } = setup();
    guard.start();
    listen();
    expect(guard.on).toBe(true);
    expect(send("keydown", "Tab")).toBe(true);
    expect(send("keyup", "Tab")).toBe(true);
    expect(seen).toEqual([]);
  });

  it("once stopped, swallows only the keys still held until they are let go", () => {
    const { guard, send, seen, listen } = setup();
    guard.start();
    listen();
    send("keydown", "Enter");
    guard.stop();
    expect(send("keydown", "KeyA")).toBe(false);
    expect(send("keydown", "Enter")).toBe(true); // repeats
    expect(send("keyup", "Enter")).toBe(true);
    expect(send("keydown", "Enter")).toBe(false);
    expect(seen).toEqual(["keydown KeyA", "keydown Enter"]);
  });

  it("forgets the keys held when the page loses the keyboard", () => {
    const { guard, send, win } = setup();
    guard.start();
    send("keydown", "Enter");
    guard.stop();
    win.dispatchEvent(new Event("blur"));
    expect(send("keydown", "Enter")).toBe(false);
  });

  it("goes on swallowing after a blur while it is on, and stops listening when disposed", () => {
    const { guard, send, doc, win } = setup();
    const remove = vi.spyOn(win, "removeEventListener");
    guard.start();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(send("keydown", "Space")).toBe(true);
    guard.dispose();
    expect(remove).toHaveBeenCalled();
    expect(send("keydown", "Space")).toBe(false);
    guard.dispose();
  });
});
```

```bash
cd web && npx vitest run src/lib/keyGuard.test.ts
```

Expected: `Cannot find module './keyGuard'`.

- [ ] **Step 2: The guard**

Create `web/src/lib/keyGuard.ts`:

```ts
// Keys pressed on the keyboard doing nothing on the page: while the unlock dialog waits for the unlock keys to be held,
// and while the matrix tester tests keys (as Qt's tester grabs the keyboard). Held Enter or Space would otherwise press
// a button, held Tab move the focus. Keys still held when it ends would repeat or be let go on whatever has the focus
// then (Enter on the top bar's Lock, Tab then Backspace on a key): those keys do nothing until they are let go.

const KINDS = ["keydown", "keypress", "keyup"] as const;

interface Listened {
  addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}

export class KeyGuard {
  /** the keys pressed while it was on and not let go since (event.code) */
  readonly #pressed = new Set<string>();
  /** the listeners are on */
  #listening = false;
  /** every key does nothing */
  #on = false;
  readonly #window: Listened;
  readonly #document: Listened;

  constructor(win: Listened = window, doc: Listened = document) {
    this.#window = win;
    this.#document = doc;
  }

  /** whether keys do nothing now */
  get on(): boolean {
    return this.#on;
  }

  /** From now on every key does nothing */
  start(): void {
    this.#on = true;
    if (this.#listening) return;
    this.#listening = true;
    for (const kind of KINDS) this.#window.addEventListener(kind, this.#swallow, true);
    this.#window.addEventListener("blur", this.#forget);
    this.#document.addEventListener("visibilitychange", this.#forget);
  }

  /** Keys work again, but those still held from before do nothing until they are let go */
  stop(): void {
    this.#on = false;
    if (this.#pressed.size === 0) this.dispose();
  }

  /** Keys work again at once, those held too */
  dispose(): void {
    this.#on = false;
    this.#pressed.clear();
    if (!this.#listening) return;
    this.#listening = false;
    for (const kind of KINDS) this.#window.removeEventListener(kind, this.#swallow, true);
    this.#window.removeEventListener("blur", this.#forget);
    this.#document.removeEventListener("visibilitychange", this.#forget);
  }

  readonly #swallow = (event: Event): void => {
    const key = event as KeyboardEvent;
    const code = key.code || key.key;
    // once it is off, only the keys still held from before
    if (!this.#on && !this.#pressed.has(code)) return;
    if (event.type === "keydown" && this.#on) this.#pressed.add(code);
    else if (event.type === "keyup") this.#pressed.delete(code);
    event.preventDefault();
    // nothing else sees them, not even listeners on the window added after these ones. The macro recorder's, added
    // before them when a recording started first, leaves the keys alone while the unlock dialog shows (it stops
    // recording).
    event.stopImmediatePropagation();
    if (!this.#on && this.#pressed.size === 0) this.dispose();
  };

  /** The page lost the keyboard: a key let go meanwhile isn't told, and keys pressed afterwards work again */
  readonly #forget = (): void => {
    this.#pressed.clear();
    if (!this.#on) this.dispose();
  };
}
```

```bash
cd web && npx vitest run src/lib/keyGuard.test.ts
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 3: The unlock dialog uses it**

Apply to `web/src/shell/UnlockDialog.svelte`:

```diff
diff --git a/web/src/shell/UnlockDialog.svelte b/web/src/shell/UnlockDialog.svelte
--- a/web/src/shell/UnlockDialog.svelte
+++ b/web/src/shell/UnlockDialog.svelte
@@ -5,6 +5,7 @@
   import { layerFaces, type Names } from "../keyboard/labels";
   import { onDestroy } from "svelte";
   import { andList } from "../analysis/phrases";
+  import { KeyGuard } from "../lib/keyGuard";
   import { keyboard } from "../lib/keyboard.svelte";
   import { unlockProgress, type Unlocker } from "../lib/unlock.svelte";
   import Button from "../ui/Button.svelte";
@@ -42,62 +43,12 @@
   }
 
   // The unlock keys are held on the keyboard in use, which types them into this page: while it waits, key presses do
-  // nothing here (as in Qt's unlocker). Held Enter or Space would otherwise press Cancel, held Tab move the focus. They
-  // are still held when it closes, and repeat or are let go on whatever has the focus then (Enter on the top bar's
-  // Lock, Tab then Backspace on a key): the keys pressed while it showed do nothing until they are let go.
-  const KINDS = ["keydown", "keypress", "keyup"] as const;
-  /** the keys pressed while the dialog showed and not let go since (event.code) */
-  const pressed = new Set<string>();
-  /** the listeners are on */
-  let guarding = false;
-  /** the dialog shows: every key does nothing */
-  let showing = false;
+  // nothing here (as in Qt's unlocker), and those still held when it closes do nothing until they are let go (KeyGuard)
+  const keyGuard = new KeyGuard();
+  const guard = () => keyGuard.start();
+  const release = () => keyGuard.stop();
 
-  function swallow(event: KeyboardEvent) {
-    const code = event.code || event.key;
-    // once it closed, only the keys still held from it
-    if (!showing && !pressed.has(code)) return;
-    if (event.type === "keydown" && showing) pressed.add(code);
-    else if (event.type === "keyup") pressed.delete(code);
-    event.preventDefault();
-    // nothing else sees them, not even listeners on the window added after these ones. The macro recorder's, added
-    // before them when a recording started first, leaves the keys alone while the dialog shows (it stops recording).
-    event.stopImmediatePropagation();
-    if (!showing && pressed.size === 0) unguard();
-  }
-
-  /** The page lost the keyboard: a key let go meanwhile isn't told, and keys pressed afterwards work again */
-  function forget() {
-    pressed.clear();
-    if (!showing) unguard();
-  }
-
-  function guard() {
-    showing = true;
-    if (guarding) return;
-    guarding = true;
-    for (const kind of KINDS) window.addEventListener(kind, swallow, true);
-    window.addEventListener("blur", forget);
-    document.addEventListener("visibilitychange", forget);
-  }
-
-  /** The dialog closed: the keys still held from it go on doing nothing until they are let go */
-  function release() {
-    showing = false;
-    if (pressed.size === 0) unguard();
-  }
-
-  function unguard() {
-    showing = false;
-    pressed.clear();
-    if (!guarding) return;
-    guarding = false;
-    for (const kind of KINDS) window.removeEventListener(kind, swallow, true);
-    window.removeEventListener("blur", forget);
-    document.removeEventListener("visibilitychange", forget);
-  }
-
-  onDestroy(unguard);
+  onDestroy(() => keyGuard.dispose());
 
   const unlock = $derived(unlocker.state);
   const keys = $derived(unlock.keys);
```

```bash
cd web && npm run check && npm test && npm run build && npx playwright test e2e/unlock.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  41 passed (41)` and `Tests  679 passed (679)` and `2 passed`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/keyGuard.test.ts \
  web/src/lib/keyGuard.ts \
  web/src/shell/UnlockDialog.svelte
git commit -m "refactor(web): KeyGuard, keys that do nothing on the page, taken out of the unlock dialog"
```

### Task 10: A shared Save bar, a list, a slider, lit keys, and a banner that can take the focus

The Lighting, Layout and Matrix tester pages need controls the earlier pages don't have, or have inline:

- **`ui/SaveBar.svelte`:** the sticky bar with a status and the Save and Undo buttons, taken out of the Settings page as it was (it keeps room at the window's bottom with `scroll-padding-bottom`, so a field the focus moves to is never under it). The Settings page uses it.
- **`ui/SelectField.svelte`:** a labelled `<select>`; while a change is saved it keeps the focus but takes nothing (`aria-disabled`).
- **`ui/Slider.svelte`:** a labelled range input with its value in words beside the label and in `aria-valuetext` ("75 %", "210°"), an optional painted track (the hues, a brightness ramp), styled for Firefox and Chromium alike.
- **`keyboard/Key.svelte`, `Keyboard.svelte`:** `pressed`, keys filled with the accent colour while held.
- **`shell/Banner.svelte`:** an `id` and `tabindex="-1"`, so a banner can take the focus when what had it goes away (the bootloader banner, Task 16).

**Files:**
- Create: `web/src/ui/SaveBar.svelte`
- Modify: `web/src/settings/SettingsPage.svelte`
- Create: `web/src/ui/SelectField.svelte`
- Create: `web/src/ui/Slider.svelte`
- Modify: `web/src/keyboard/Key.svelte`
- Modify: `web/src/keyboard/Keyboard.svelte`
- Modify: `web/src/shell/Banner.svelte`

- [ ] **Step 1: The Save bar, and the Settings page using it**

Create `web/src/ui/SaveBar.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** what the page's changes are: "2 changes not saved yet" (announced when it changes) */
    status: string;
    /** the bar's buttons (Undo, Save) */
    children: Snippet;
  }

  let { status, children }: Props = $props();

  /** The bar's height: the window keeps that much room at its bottom when it scrolls a field into view (the focus moved
   * there with Tab), so the bar never covers the field. scroll-padding on the root element applies to the window's
   * scrolling, in Firefox and Chromium alike. */
  let barHeight = $state(0);
  $effect(() => {
    if (barHeight === 0) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${barHeight + 12}px`;
    return () => root.style.removeProperty("scroll-padding-bottom");
  });
</script>

<!-- stays in sight at the window's bottom -->
<div class="savebar" bind:clientHeight={barHeight}>
  <span class="status" role="status">{status}</span>
  <span class="spacer"></span>
  {@render children()}
</div>

<style>
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

  /* with nothing to do they look disabled, but keep the focus */
  .savebar :global(.btn.idle[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }
</style>
```

Apply to `web/src/settings/SettingsPage.svelte`:

```diff
diff --git a/web/src/settings/SettingsPage.svelte b/web/src/settings/SettingsPage.svelte
--- a/web/src/settings/SettingsPage.svelte
+++ b/web/src/settings/SettingsPage.svelte
@@ -6,6 +6,7 @@
   import { keyboard } from "../lib/keyboard.svelte";
   import Button from "../ui/Button.svelte";
   import ConfirmDialog from "../ui/ConfirmDialog.svelte";
+  import SaveBar from "../ui/SaveBar.svelte";
   import { settingDefinitions } from "./definitions";
   import {
     changeCount, changed, fieldChanged, groupChanges, numberProblem, settingGroups, valuesOf, type Values,
@@ -86,16 +87,9 @@
 
   let confirming = $state(false);
 
-  /** the Save bar's height: the window keeps that much room at its bottom when it scrolls a field into view (the
-   * focus moved there with Tab), so the bar never covers the field. scroll-padding on the root element applies to the
-   * window's scrolling, in Firefox and Chromium alike. */
-  let barHeight = $state(0);
-  $effect(() => {
-    if (barHeight === 0) return;
-    const root = document.documentElement;
-    root.style.scrollPaddingBottom = `${barHeight + 12}px`;
-    return () => root.style.removeProperty("scroll-padding-bottom");
-  });
+  const status = $derived(blocked ? "A number can't be saved: see the field marked in red."
+    : changes.length > 0 ? `${changeCount(changes.length)} not saved yet`
+    : "No changes: the form shows what the keyboard holds.");
 </script>
 
 <section class="page" aria-labelledby="settings-title">
@@ -150,23 +144,13 @@
       </section>
     {/each}
 
-    <div class="savebar" bind:clientHeight={barHeight}>
-      <span class="status" role="status">
-        {#if blocked}
-          A number can't be saved: see the field marked in red.
-        {:else if changes.length > 0}
-          {changeCount(changes.length)} not saved yet
-        {:else}
-          No changes: the form shows what the keyboard holds.
-        {/if}
-      </span>
-      <span class="spacer"></span>
+    <SaveBar {status}>
       <!-- with nothing to undo or save they look disabled, but keep the focus (Save, once it has saved) -->
       <Button class={idle ? "idle" : undefined} aria-disabled={busy || idle || undefined} disabled={!canEdit}
         onclick={undo}>Undo</Button>
       <Button class={blocked || changes.length === 0 ? "idle" : undefined} variant="primary" disabled={!canEdit}
         aria-disabled={busy || blocked || changes.length === 0 || undefined} onclick={() => void save()}>Save</Button>
-    </div>
+    </SaveBar>
   {/if}
 </section>
 
@@ -236,34 +220,4 @@
     gap: 8px;
     color: var(--danger);
   }
-
-  /* Save and Undo stay in sight at the window's bottom */
-  .savebar {
-    position: sticky;
-    bottom: 0;
-    z-index: 1;
-    display: flex;
-    flex-wrap: wrap;
-    align-items: center;
-    gap: 8px;
-    padding: 10px 14px;
-    border: 1px solid var(--border);
-    border-radius: 12px 12px 0 0;
-    background: var(--surface);
-    box-shadow: 0 -4px 12px rgb(16 24 40 / 8%);
-  }
-
-  .status {
-    color: var(--text-2);
-    font-size: 13px;
-  }
-
-  .spacer {
-    flex: 1;
-  }
-
-  .savebar :global(.btn.idle[aria-disabled="true"]) {
-    opacity: 0.45;
-    cursor: default;
-  }
 </style>
```

- [ ] **Step 2: A list and a slider**

Create `web/src/ui/SelectField.svelte`:

```svelte
<script lang="ts">
  interface Choice {
    value: string;
    label: string;
  }

  interface Props {
    id?: string;
    /** what is chosen, said before the list */
    label: string;
    value: string;
    choices: Choice[];
    disabled?: boolean;
    /** a change is being saved: the list keeps the focus, but takes nothing until it is done */
    busy?: boolean;
    describedby?: string;
    onchange: (value: string) => void;
  }

  let { id, label, value, choices, disabled = false, busy = false, describedby, onchange }: Props = $props();
  const uid = $props.id();
  const inputId = $derived(id ?? `${uid}-select`);
</script>

<div class="field">
  <label for={inputId}>{label}</label>
  <select
    id={inputId}
    {value}
    {disabled}
    aria-disabled={busy || undefined}
    aria-describedby={describedby}
    onchange={(event) => {
      const chosen = event.currentTarget.value;
      // a list can't refuse a choice: while busy it goes back to what is chosen
      if (busy) {
        event.currentTarget.value = value;
        return;
      }
      onchange(chosen);
    }}
  >
    {#each choices as choice (choice.value)}
      <option value={choice.value}>{choice.label}</option>
    {/each}
  </select>
</div>

<style>
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 14px;
    min-width: 0;
  }

  label {
    font-size: 13px;
    font-weight: 550;
  }

  select {
    min-width: min(100%, 220px);
    max-width: 100%;
    padding: 5px 8px;
    /* its edge stands out from the card (3:1, WCAG 1.4.11) */
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 7px;
    background: var(--surface-2);
    text-overflow: ellipsis;
  }

  select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  select[aria-disabled="true"] {
    cursor: progress;
  }
</style>
```

Create `web/src/ui/Slider.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    id?: string;
    label: string;
    value: number;
    min?: number;
    max: number;
    step?: number;
    /** the value in words, shown beside the label and said by screen readers: "75 %", "210°" */
    valueText: string;
    disabled?: boolean;
    describedby?: string;
    /** a move of the thumb (dragged, or with the keyboard): every value it passes */
    oninput: (value: number) => void;
    /** drawn behind the track, e.g. the hues a hue slider goes through (a CSS background) */
    track?: string;
    /** after the label, e.g. a note on what the keyboard takes */
    extra?: Snippet;
  }

  let {
    id, label, value, min = 0, max, step = 1, valueText, disabled = false, describedby, oninput, track, extra,
  }: Props = $props();
  const uid = $props.id();
  const inputId = $derived(id ?? `${uid}-range`);
</script>

<div class="slider" class:painted={track !== undefined}>
  <div class="head">
    <label for={inputId}>{label}</label>
    <output for={inputId} aria-hidden="true">{valueText}</output>
    {@render extra?.()}
  </div>
  <input
    id={inputId}
    type="range"
    {min}
    {max}
    {step}
    {value}
    {disabled}
    aria-valuetext={valueText}
    aria-describedby={describedby}
    style={track ? `--track: ${track}` : undefined}
    oninput={(event) => oninput(Number(event.currentTarget.value))}
  />
</div>

<style>
  .slider {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }

  label {
    font-size: 13px;
    font-weight: 550;
  }

  output {
    color: var(--text-2);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  input {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* a painted track (the hues): the native track made see-through over it, in Firefox and Chromium alike */
  .painted input {
    height: 18px;
    border-radius: 999px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    appearance: none;
  }

  .painted input::-webkit-slider-runnable-track {
    background: transparent;
  }

  .painted input::-moz-range-track {
    background: transparent;
  }

  .painted input::-moz-range-progress {
    background: transparent;
  }

  .painted input::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 1px var(--text);
    appearance: none;
  }

  .painted input::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 1px var(--text);
  }

  .painted input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
</style>
```

- [ ] **Step 3: Lit keys, and a banner that can take the focus**

Apply to `web/src/keyboard/Key.svelte`:

```diff
diff --git a/web/src/keyboard/Key.svelte b/web/src/keyboard/Key.svelte
--- a/web/src/keyboard/Key.svelte
+++ b/web/src/keyboard/Key.svelte
@@ -24,6 +24,8 @@
     ring?: string | null;
     /** drawn faintly: a key that doesn't matter here */
     faded?: boolean;
+    /** lit up: held down on the keyboard right now (the matrix tester) */
+    pressed?: boolean;
     /** a key to choose (pressed) or not: aria-pressed says this instead of whether it is selected */
     chosen?: boolean;
     /** a key to click; otherwise only a picture (the keyboard as a whole is labelled) */
@@ -34,8 +36,8 @@
   }
 
   let {
-    item, face, u, selected, label, focusable, combos = [], found = false, ring = null, faded = false, chosen,
-    interactive = true, compact = false, onselect,
+    item, face, u, selected, label, focusable, combos = [], found = false, ring = null, faded = false, pressed = false,
+    chosen, interactive = true, compact = false, onselect,
   }: Props = $props();
 
   const combo = $derived(combos.length > 0);
@@ -210,7 +212,7 @@
   </button>
 {:else}
   <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found class:ringed={ringColour !== null}
-    class:faded {style}>
+    class:faded class:pressed {style}>
     {@render cap()}
   </div>
 {/if}
@@ -275,6 +277,21 @@
     opacity: 0.38;
   }
 
+  /* held down: filled with the accent colour, whatever its kind */
+  .pressed .face {
+    fill: var(--accent);
+  }
+
+  .pressed .edge {
+    stroke: var(--accent);
+  }
+
+  .key.pressed,
+  .pressed .shifted,
+  .pressed .hold {
+    color: var(--accent-text);
+  }
+
   .static {
     cursor: inherit;
   }
```

Apply to `web/src/keyboard/Keyboard.svelte`:

```diff
diff --git a/web/src/keyboard/Keyboard.svelte b/web/src/keyboard/Keyboard.svelte
--- a/web/src/keyboard/Keyboard.svelte
+++ b/web/src/keyboard/Keyboard.svelte
@@ -30,6 +30,8 @@
     rings?: (string | null)[];
     /** which placed keys are drawn faintly, aligned with placement.items */
     faded?: boolean[];
+    /** which placed keys are lit up as held down, aligned with placement.items */
+    pressed?: boolean[];
     /** keys to choose: whether each is chosen (its aria-pressed), aligned with placement.items */
     chosen?: boolean[];
     /** the key reached with Tab, when it isn't the selected one (a cursor shown only while the keys have the focus) */
@@ -42,7 +44,7 @@
 
   let {
     placement, faces, labels, selected, onselect, maxUnit = 72, combos = [], interactive = true, compact = false,
-    highlights = [], rings = [], faded = [], chosen, tabStop, label = "Keyboard", describedby,
+    highlights = [], rings = [], faded = [], pressed = [], chosen, tabStop, label = "Keyboard", describedby,
   }: Props = $props();
 
   let width = $state(0);
@@ -77,7 +79,7 @@
         {#if item.kind === "key"}
           <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
             combos={combos[i] ?? []} found={highlights[i] ?? false} ring={rings[i] ?? null} faded={faded[i] ?? false}
-            chosen={chosen?.[i]} {interactive} {compact} onselect={() => onselect(i)} />
+            pressed={pressed[i] ?? false} chosen={chosen?.[i]} {interactive} {compact} onselect={() => onselect(i)} />
         {:else}
           <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
             found={highlights[i] ?? false} faded={faded[i] ?? false} chosen={chosen?.[i]} {interactive} {compact}
```

Apply to `web/src/shell/Banner.svelte`:

```diff
diff --git a/web/src/shell/Banner.svelte b/web/src/shell/Banner.svelte
--- a/web/src/shell/Banner.svelte
+++ b/web/src/shell/Banner.svelte
@@ -7,13 +7,15 @@
     message: string;
     actionLabel?: string;
     onaction?: () => void;
+    /** an id for the banner, so that it can take the focus from script (when what had it went away) */
+    id?: string;
   }
 
-  let { tone, title, message, actionLabel, onaction }: Props = $props();
+  let { tone, title, message, actionLabel, onaction, id }: Props = $props();
 </script>
 
 <!-- danger interrupts (the keyboard is unplugged, or couldn't be read); warning waits its turn -->
-<div class="banner {tone}" role={tone === "danger" ? "alert" : "status"}>
+<div class="banner {tone}" role={tone === "danger" ? "alert" : "status"} {id} tabindex="-1">
   <svg viewBox="0 0 20 20" aria-hidden="true">
     <path d="M10 3l8 14H2z" />
     <path d="M10 8.5v3.5M10 14.5v.01" />
```

- [ ] **Step 4: Type-check, build, and run the Settings page's e2e tests**

```bash
cd web && npm run check && npm run build && npx playwright test e2e/settings.spec.ts e2e/feature-pages.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `built in` and `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keyboard/Key.svelte \
  web/src/keyboard/Keyboard.svelte \
  web/src/settings/SettingsPage.svelte \
  web/src/shell/Banner.svelte \
  web/src/ui/SaveBar.svelte \
  web/src/ui/SelectField.svelte \
  web/src/ui/Slider.svelte
git commit -m "refactor(web): a shared Save bar, list, slider, lit keys, and a banner that can take the focus"
```

### Task 11: Lighting effects by name, colours, changes as patches, and writes that don't flood the keyboard

The Lighting page's logic, in pure modules:

- **`effects.ts`:** the VialRGB effects by their VialRGB number and the QMK RGB light effects by number, named as Qt names them; `vialRgbChoices` (the effects the keyboard has, and the one it runs) and `rgbLightChoices`; `vialRgbNote` and `rgbLightNote`, what the firmware ignores under an effect ("Breathing keeps its brightness: …").
- **`colour.ts`:** QMK's hue, saturation and brightness (0 to 255 each) to RGB and back, as Qt converts them; hex colours; `pickedHueSat` (a grey keeps the hue); degrees and percentages; the slider tracks.
- **`lighting.ts`:** a change is a patch (only what changed): `mergePatch`, `withPatch` (what the page shows while it is on its way), `patchRequest` (only the kinds the keyboard has), `sameLighting`, `restorePatch` (Undo), `lightingKinds` and `hasLighting`.
- **`writer.ts`:** `LatestWriter`: one write at a time, at most one every `gapMs` from start to start; values pushed meanwhile are merged, so the latest of each is written last; `busy` and `idle()`; a failed write doesn't stop the next. The clock is injected for the tests.
- **`state.svelte.ts`:** `LightingBaseline`, what Undo goes back to: what the keyboard showed when the page first showed it, or what was saved here since, kept per keyboard while other pages show.

**Files:**
- Create: `web/src/lighting/effects.ts`
- Create: `web/src/lighting/colour.ts`
- Create: `web/src/lighting/lighting.ts`
- Create: `web/src/lighting/writer.ts`
- Create: `web/src/lighting/state.svelte.ts`
- Test: `web/src/lighting/lighting.test.ts` (new)
- Test: `web/src/lighting/state.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lighting/lighting.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Lighting } from "../api/types";
import {
  brightnessTrack, degrees, hexToRgb, hsvToRgb, HUE_TRACK, percent, percentOf, pickedHueSat, rgbToHex, rgbToHsv,
  saturationTrack,
} from "./colour";
import {
  RGBLIGHT_EFFECTS, rgbLightChoices, rgbLightNote, VIALRGB_EFFECTS, vialRgbChoices, vialRgbNote,
} from "./effects";
import {
  hasLighting, lightingKinds, mergePatch, patchRequest, restorePatch, sameLighting, withPatch,
} from "./lighting";
import { LatestWriter, type Clock } from "./writer";

const ALL: Lighting = {
  vialrgb: { mode: 2, speed: 128, hsv: [0, 255, 128], maxBrightness: 200, supportedEffects: [0, 1, 2, 3] },
  rgblight: { effect: 1, speed: 0, hue: 0, saturation: 255, brightness: 128 },
  backlight: { brightness: 170, effect: 0 },
};

describe("effects", () => {
  it("names effects as Qt does, by number", () => {
    expect(VIALRGB_EFFECTS).toHaveLength(45);
    expect(VIALRGB_EFFECTS[44]).toBe("Pixel Fractal");
    expect(RGBLIGHT_EFFECTS).toHaveLength(37);
    expect(RGBLIGHT_EFFECTS[36]).toBe("Alternating");
  });

  it("lists the VialRGB effects the keyboard has, and the one it runs", () => {
    expect(vialRgbChoices([0, 2, 1], 2)).toEqual([
      { value: 0, label: "Disable" }, { value: 1, label: "Direct Control" }, { value: 2, label: "Solid Color" }]);
    expect(vialRgbChoices([0, 50], 7).map((c) => c.label)).toEqual(["Disable", "Band Sat", "Effect 50"]);
  });

  it("lists every RGB light effect, and one beyond them the keyboard runs", () => {
    expect(rgbLightChoices(3)).toHaveLength(37);
    expect(rgbLightChoices(40).at(-1)).toEqual({ value: 40, label: "Effect 40" });
  });

  it("says what the firmware ignores under some effects", () => {
    expect(vialRgbNote(0)).toMatch(/off/);
    expect(vialRgbNote(2)).toBeNull();
    expect(rgbLightNote(0)).toMatch(/off/);
    expect(rgbLightNote(1)).toBeNull();
    expect([2, 5].map(rgbLightNote).every((n) => n?.includes("brightness"))).toBe(true);
    expect([6, 14].map(rgbLightNote).every((n) => n?.includes("hue"))).toBe(true);
    expect(rgbLightNote(15)).toBeNull();
  });
});

describe("colours", () => {
  it("converts QMK's hue, saturation and brightness to RGB as Qt does", () => {
    expect(hsvToRgb(0, 255, 255)).toEqual([255, 0, 0]);
    expect(hsvToRgb(85, 255, 255)).toEqual([0, 255, 0]);
    expect(hsvToRgb(170, 255, 255)).toEqual([0, 0, 255]);
    expect(hsvToRgb(255, 255, 255)).toEqual([255, 0, 0]); // 360°
    expect(hsvToRgb(40, 0, 128)).toEqual([128, 128, 128]);
    expect(hsvToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("converts back, a grey with hue 0", () => {
    expect(rgbToHsv([255, 0, 0])).toEqual([0, 255, 255]);
    expect(rgbToHsv([0, 0, 255])).toEqual([170, 255, 255]);
    expect(rgbToHsv([255, 0, 255])).toEqual([213, 255, 255]);
    expect(rgbToHsv([90, 90, 90])).toEqual([0, 0, 90]);
    for (const [h, s, v] of [[10, 200, 255], [128, 255, 200], [200, 100, 255]]) {
      const [h2, s2, v2] = rgbToHsv(hsvToRgb(h, s, v));
      expect(Math.abs(h2 - h)).toBeLessThanOrEqual(2);
      expect(Math.abs(s2 - s)).toBeLessThanOrEqual(2);
      expect(v2).toBe(v);
    }
  });

  it("reads and writes hex colours", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(hexToRgb("#FF8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("red")).toBeNull();
  });

  it("takes the hue and saturation of a colour picked; a grey keeps the hue", () => {
    expect(pickedHueSat("#0000ff", 10)).toEqual({ hue: 170, saturation: 255 });
    expect(pickedHueSat("#808080", 10)).toEqual({ hue: 10, saturation: 0 });
    expect(pickedHueSat("nope", 10)).toBeNull();
  });

  it("says hues in degrees and levels in percent", () => {
    expect(degrees(0)).toBe("0°");
    expect(degrees(128)).toBe("181°");
    expect(degrees(255)).toBe("0°");
    expect(percent(255)).toBe("100 %");
    expect(percent(200)).toBe("78 %");
  });

  it("says a brightness as a share of the keyboard's most", () => {
    expect(percentOf(128, 200)).toBe("64 %");
    expect(percentOf(200, 200)).toBe("100 %");
    expect(percentOf(0, 0)).toBe("0 %");
  });

  it("paints the slider tracks", () => {
    expect(HUE_TRACK).toContain("hsl(0 100% 50%)");
    expect(saturationTrack(0)).toBe("linear-gradient(to right, #ffffff, #ff0000)");
    expect(brightnessTrack(0, 255)).toBe("linear-gradient(to right, #000000, #ff0000)");
    expect(brightnessTrack(0, 255, 128)).toBe("linear-gradient(to right, #000000, #800000)");
  });
});

describe("patches", () => {
  it("names the kinds the keyboard has", () => {
    expect(lightingKinds(ALL)).toEqual(["RGB matrix", "RGB light", "backlight"]);
    expect(lightingKinds({ backlight: ALL.backlight })).toEqual(["backlight"]);
    expect(hasLighting({})).toBe(false);
    expect(hasLighting({ vialrgb: null, rgblight: null, backlight: null })).toBe(false);
  });

  it("merges newer changes over older ones, kind by kind", () => {
    expect(mergePatch({ vialrgb: { mode: 1, speed: 2 } }, { vialrgb: { speed: 3 }, backlight: { effect: 1 } }))
      .toEqual({ vialrgb: { mode: 1, speed: 3 }, backlight: { effect: 1 } });
  });

  it("shows a patch over the lighting, and asks only for the kinds the keyboard has", () => {
    const shown = withPatch({ vialrgb: ALL.vialrgb }, { vialrgb: { hsv: [1, 2, 3] }, backlight: { effect: 1 } });
    expect(shown).toEqual({ vialrgb: { ...ALL.vialrgb, hsv: [1, 2, 3] } });
    expect(patchRequest({ vialrgb: { mode: 1 }, rgblight: { effect: 2 } }, { vialrgb: ALL.vialrgb }))
      .toEqual({ vialrgb: { mode: 1 } });
  });

  it("compares what can be set, and brings it back", () => {
    expect(sameLighting(ALL, structuredClone(ALL))).toBe(true);
    expect(sameLighting(ALL, { ...ALL, backlight: { brightness: 255, effect: 0 } })).toBe(false);
    // the keyboard's maximum and effect list aren't settings
    expect(sameLighting(ALL, { ...ALL, vialrgb: { ...ALL.vialrgb!, supportedEffects: [] } })).toBe(true);
    expect(restorePatch(ALL)).toEqual({
      vialrgb: { mode: 2, speed: 128, hsv: [0, 255, 128] },
      rgblight: { effect: 1, hue: 0, saturation: 255, brightness: 128 },
      backlight: { brightness: 170, effect: 0 },
    });
    expect(restorePatch({ backlight: ALL.backlight })).toEqual({ backlight: { brightness: 170, effect: 0 } });
  });
});

/** A clock the test moves by hand */
function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const clock: Clock = {
    now: () => now,
    setTimeout: (run, ms) => {
      timers.push({ at: now + ms, run, id: ++ids });
      return ids;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.run();
      }
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LatestWriter", () => {
  function writer(gap = 100) {
    const { clock, advance } = fakeClock();
    const writes: { value: Record<string, number>; done: () => void; fail: () => void }[] = [];
    const busy: boolean[] = [];
    const w = new LatestWriter<Record<string, number>>(
      (value) => new Promise<void>((resolve, reject) => writes.push({ value, done: resolve, fail: () => reject(new Error("no")) })),
      (a, b) => ({ ...a, ...b }), gap, (b) => busy.push(b), clock,
    );
    return { w, writes, busy, advance };
  }

  it("sends the first change at once", () => {
    const { w, writes, busy } = writer();
    w.push({ a: 1 });
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }]);
    expect(w.busy).toBe(true);
    expect(busy).toEqual([true]);
  });

  it("merges what comes while a write is on its way, and sends the latest of each once it is done", async () => {
    const { w, writes, advance } = writer();
    w.push({ a: 1 });
    w.push({ a: 2 });
    w.push({ b: 5 });
    w.push({ a: 3 });
    expect(writes).toHaveLength(1);
    advance(150);
    writes[0].done();
    await flush();
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 3, b: 5 }]);
  });

  it("leaves at least the gap between the starts of two writes", async () => {
    const { w, writes, advance } = writer(100);
    w.push({ a: 1 });
    writes[0].done();
    await flush();
    w.push({ a: 2 });
    expect(writes).toHaveLength(1);
    advance(99);
    expect(writes).toHaveLength(1);
    advance(1);
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("goes on after a failed write, and tells when it is idle", async () => {
    const { w, writes, busy, advance } = writer();
    const idle = vi.fn();
    w.push({ a: 1 });
    w.push({ a: 2 });
    void w.idle().then(idle);
    writes[0].fail();
    await flush();
    advance(100);
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(idle).not.toHaveBeenCalled();
    writes[1].done();
    await flush();
    expect(idle).toHaveBeenCalled();
    expect(w.busy).toBe(false);
    expect(busy).toEqual([true, false]);
    await expect(w.idle()).resolves.toBeUndefined();
  });

  it("sends a burst of slider moves as a handful of writes, the last value last", async () => {
    const { w, writes, advance } = writer(100);
    for (let v = 0; v <= 255; v++) {
      w.push({ v });
      advance(4);
      // each write takes 30 ms
      if (writes.length && !("ended" in writes.at(-1)!)) {
        const last = writes.at(-1)!;
        Object.assign(last, { ended: true });
        setTimeout(last.done, 0);
        await flush();
      }
    }
    advance(200);
    await flush();
    writes.at(-1)!.done();
    await flush();
    advance(200);
    await flush();
    for (const x of writes) x.done();
    await flush();
    expect(writes.length).toBeLessThan(20);
    expect(writes.at(-1)!.value).toEqual({ v: 255 });
  });
});
```

Create `web/src/lighting/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LightingBaseline } from "./state.svelte";

const A = { backlight: { brightness: 0, effect: 0 } };
const B = { backlight: { brightness: 255, effect: 1 } };

describe("LightingBaseline", () => {
  it("keeps what a keyboard showed first, until it is saved, and starts over for another keyboard", () => {
    const baseline = new LightingBaseline();
    baseline.follow("one", A);
    baseline.follow("one", B);
    expect(baseline.lighting).toBe(A);
    expect(baseline.saved).toBe(false);
    baseline.save(B);
    expect([baseline.lighting, baseline.saved]).toEqual([B, true]);
    baseline.follow("two", A);
    expect([baseline.lighting, baseline.saved]).toEqual([A, false]);
  });
});
```

```bash
cd web && npx vitest run src/lighting
```

Expected: `Cannot find module './colour'` and `Cannot find module './state.svelte'`.

- [ ] **Step 2: Effects, colours, patches, the writer and the baseline**

Create `web/src/lighting/effects.ts`:

```ts
// The lighting effects by name, as Qt's Lighting tab names them (editor/rgb_configurator.py), and what the firmware
// does with the colour under some of them (vial-qmk quantum/rgblight/rgblight.c, quantum/rgb_matrix/rgb_matrix.c).

/** VialRGB effects by their VialRGB number (vialrgb_effects.inc: never reordered, only added to) */
export const VIALRGB_EFFECTS = [
  "Disable", "Direct Control", "Solid Color", "Alphas Mods", "Gradient Up Down", "Gradient Left Right", "Breathing",
  "Band Sat", "Band Val", "Band Pinwheel Sat", "Band Pinwheel Val", "Band Spiral Sat", "Band Spiral Val", "Cycle All",
  "Cycle Left Right", "Cycle Up Down", "Rainbow Moving Chevron", "Cycle Out In", "Cycle Out In Dual", "Cycle Pinwheel",
  "Cycle Spiral", "Dual Beacon", "Rainbow Beacon", "Rainbow Pinwheels", "Raindrops", "Jellybean Raindrops",
  "Hue Breathing", "Hue Pendulum", "Hue Wave", "Typing Heatmap", "Digital Rain", "Solid Reactive Simple",
  "Solid Reactive", "Solid Reactive Wide", "Solid Reactive Multiwide", "Solid Reactive Cross",
  "Solid Reactive Multicross", "Solid Reactive Nexus", "Solid Reactive Multinexus", "Splash", "Multisplash",
  "Solid Splash", "Solid Multisplash", "Pixel Rain", "Pixel Fractal",
] as const;

/** VialRGB's "Disable": the RGB matrix is off */
export const VIALRGB_OFF = 0;

/** QMK RGB light effects by number, as Qt lists them: the numbers they have with every effect built in */
export const RGBLIGHT_EFFECTS = [
  "All Off", "Solid Color", "Breathing 1", "Breathing 2", "Breathing 3", "Breathing 4", "Rainbow Mood 1",
  "Rainbow Mood 2", "Rainbow Mood 3", "Rainbow Swirl 1", "Rainbow Swirl 2", "Rainbow Swirl 3", "Rainbow Swirl 4",
  "Rainbow Swirl 5", "Rainbow Swirl 6", "Snake 1", "Snake 2", "Snake 3", "Snake 4", "Snake 5", "Snake 6", "Knight 1",
  "Knight 2", "Knight 3", "Christmas", "Gradient 1", "Gradient 2", "Gradient 3", "Gradient 4", "Gradient 5",
  "Gradient 6", "Gradient 7", "Gradient 8", "Gradient 9", "Gradient 10", "RGB Test", "Alternating",
] as const;

export interface EffectChoice {
  value: number;
  label: string;
}

function nameOf(list: readonly string[], value: number): string {
  return list[value] ?? `Effect ${value}`;
}

/** The VialRGB effects the keyboard has, in order, by name; the one it runs is listed even if it isn't among them */
export function vialRgbChoices(supported: number[], current: number): EffectChoice[] {
  const values = [...new Set([...supported, current])].sort((a, b) => a - b);
  return values.map((value) => ({ value, label: nameOf(VIALRGB_EFFECTS, value) }));
}

/** Every QMK RGB light effect Vial names; one the keyboard runs beyond them is added by its number */
export function rgbLightChoices(current: number): EffectChoice[] {
  const values = RGBLIGHT_EFFECTS.map((_, value) => value);
  if (!values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: nameOf(RGBLIGHT_EFFECTS, value) }));
}

/** What the keyboard does with colour changes under a VialRGB effect, when it ignores some; null otherwise */
export function vialRgbNote(mode: number): string | null {
  // rgb_matrix_sethsv_noeeprom does nothing while the matrix is off
  if (mode === VIALRGB_OFF) return "The lights are off: the keyboard takes no colour or brightness until an effect is chosen.";
  return null;
}

/** What the keyboard does with colour changes under a QMK RGB light effect, when it ignores some; null otherwise.
 * By the numbers of a keyboard with every effect built in (rgblight_sethsv_eeprom_helper). */
export function rgbLightNote(effect: number): string | null {
  if (effect === 0) return "The light is off: the keyboard takes no colour or brightness until an effect is chosen.";
  if (effect >= 2 && effect <= 5) return "Breathing keeps its brightness: the keyboard ignores brightness changes while it runs.";
  if (effect >= 6 && effect <= 14) return "This effect runs through the hues itself: the keyboard ignores hue changes while it runs.";
  return null;
}
```

Create `web/src/lighting/colour.ts`:

```ts
// Colours as the keyboard takes them: hue, saturation and brightness each from 0 to 255 (QMK's HSV), as Qt converts
// them (QColor.fromHsvF(h / 255, s / 255, v / 255)), and as the page shows them: degrees and percentages.

export type Rgb = [number, number, number];

/** A QMK hue, saturation and brightness (0-255 each) as red, green and blue (0-255 each) */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h / 255) * 360) % 360;
  const sat = s / 255;
  const val = v / 255;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

/** Red, green and blue (0-255 each) as a QMK hue, saturation and brightness (0-255 each); a grey has hue 0 */
export function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return [Math.round((hue / 360) * 255) % 256, max === 0 ? 0 : Math.round((d / max) * 255), max];
}

/** "#ff8000" */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** "#ff8000" -> [255, 128, 0]; null for anything else */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** The hue and saturation of a colour picked (e.g. from the browser's colour picker); a grey keeps `hue`, as it has
 * none of its own. Its brightness is left to the brightness slider. */
export function pickedHueSat(hex: string, hue: number): { hue: number; saturation: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s] = rgbToHsv(rgb);
  return { hue: s === 0 ? hue : h, saturation: s };
}

/** A hue in degrees: "210°" */
export function degrees(h: number): string {
  return `${Math.round((h / 255) * 360) % 360}°`;
}

/** A level (saturation, brightness, speed) as a percentage of 255: "75 %" */
export function percent(n: number): string {
  return `${Math.round((n / 255) * 100)} %`;
}

/** The track of a hue slider: every hue, as a CSS gradient */
export const HUE_TRACK = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((d) => `hsl(${d} 100% 50%)`).join(", ")})`;

/** A brightness as a percentage of the most the keyboard allows: "64 %" */
export function percentOf(n: number, most: number): string {
  return most > 0 ? `${Math.round((n / most) * 100)} %` : "0 %";
}

/** The track of a brightness slider for a colour, up to the most the keyboard allows: from black to the colour */
export function brightnessTrack(h: number, s: number, most = 255): string {
  return `linear-gradient(to right, #000000, ${rgbToHex(hsvToRgb(h, s, most))})`;
}

/** The track of a saturation slider for a hue: from grey to the full colour */
export function saturationTrack(h: number): string {
  return `linear-gradient(to right, ${rgbToHex(hsvToRgb(h, 0, 255))}, ${rgbToHex(hsvToRgb(h, 255, 255))})`;
}
```

Create `web/src/lighting/lighting.ts`:

```ts
// Changes to the lighting as the page makes them (a patch: only what changed), what the page shows while they are on
// their way, and whether the keyboard shows what was saved.
import type { Backlight, Lighting, LightingIn, RgbLight, VialRgb } from "../api/types";

type VialRgbPatch = { mode?: number; speed?: number; hsv?: [number, number, number] };
type RgbLightPatch = { effect?: number; hue?: number; saturation?: number; brightness?: number };
type BacklightPatch = { brightness?: number; effect?: number };

export interface LightingPatch {
  vialrgb?: VialRgbPatch;
  rgblight?: RgbLightPatch;
  backlight?: BacklightPatch;
}

/** The kinds of lighting the keyboard has, as the page names them */
export function lightingKinds(lighting: Lighting): string[] {
  return [
    lighting.vialrgb ? "RGB matrix" : null,
    lighting.rgblight ? "RGB light" : null,
    lighting.backlight ? "backlight" : null,
  ].filter((k): k is string => k !== null);
}

/** Whether the keyboard has any lighting the page can change */
export function hasLighting(lighting: Lighting): boolean {
  return lightingKinds(lighting).length > 0;
}

/** `older` with `newer`'s changes put over it */
export function mergePatch(older: LightingPatch, newer: LightingPatch): LightingPatch {
  const out: LightingPatch = {};
  for (const kind of ["vialrgb", "rgblight", "backlight"] as const) {
    if (older[kind] || newer[kind]) Object.assign(out, { [kind]: { ...older[kind], ...newer[kind] } });
  }
  return out;
}

/** The lighting with a patch put over it: what the page shows while the patch is on its way */
export function withPatch(lighting: Lighting, patch: LightingPatch): Lighting {
  const out: Lighting = { ...lighting };
  if (lighting.vialrgb && patch.vialrgb) out.vialrgb = { ...lighting.vialrgb, ...patch.vialrgb } as VialRgb;
  if (lighting.rgblight && patch.rgblight) out.rgblight = { ...lighting.rgblight, ...patch.rgblight } as RgbLight;
  if (lighting.backlight && patch.backlight) out.backlight = { ...lighting.backlight, ...patch.backlight } as Backlight;
  return out;
}

/** The request for a patch: only the kinds the keyboard has */
export function patchRequest(patch: LightingPatch, lighting: Lighting): LightingIn {
  const out: LightingIn = {};
  if (lighting.vialrgb && patch.vialrgb) out.vialrgb = patch.vialrgb;
  if (lighting.rgblight && patch.rgblight) out.rgblight = patch.rgblight;
  if (lighting.backlight && patch.backlight) out.backlight = patch.backlight;
  return out;
}

/** What the keyboard shows that a patch can set: the same in both means the same lighting */
function settable(lighting: Lighting): LightingPatch {
  const { vialrgb: v, rgblight: r, backlight: b } = lighting;
  return {
    vialrgb: v ? { mode: v.mode, speed: v.speed, hsv: [v.hsv[0], v.hsv[1], v.hsv[2]] } : undefined,
    rgblight: r ? { effect: r.effect, hue: r.hue, saturation: r.saturation, brightness: r.brightness } : undefined,
    backlight: b ? { brightness: b.brightness, effect: b.effect } : undefined,
  };
}

export function sameLighting(a: Lighting, b: Lighting): boolean {
  return JSON.stringify(settable(a)) === JSON.stringify(settable(b));
}

/** The patch that brings `lighting` back: every value it can set */
export function restorePatch(lighting: Lighting): LightingPatch {
  const all = settable(lighting);
  const out: LightingPatch = {};
  if (all.vialrgb) out.vialrgb = all.vialrgb;
  if (all.rgblight) out.rgblight = all.rgblight;
  if (all.backlight) out.backlight = all.backlight;
  return out;
}
```

Create `web/src/lighting/writer.ts`:

```ts
// Sending changes that come quickly (a slider dragged) without flooding the keyboard: one write at a time, at most one
// every `gapMs`; changes made meanwhile are merged, so the latest value of each always reaches the keyboard last.

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class LatestWriter<T> {
  #pending: T | null = null;
  #writing = false;
  #timer: unknown = null;
  #lastStart = Number.NEGATIVE_INFINITY;
  #idle: (() => void)[] = [];
  readonly #write: (value: T) => Promise<unknown>;
  readonly #merge: (older: T, newer: T) => T;
  readonly #gapMs: number;
  readonly #onBusy: (busy: boolean) => void;
  readonly #clock: Clock;

  /**
   * write: sends one value (a failure is the writer's to report: the next value is sent all the same)
   * merge: one value with the changes of a newer one put over it
   * gapMs: the least time from the start of one write to the start of the next
   * onBusy: told whenever `busy` changes
   */
  constructor(write: (value: T) => Promise<unknown>, merge: (older: T, newer: T) => T, gapMs: number,
    onBusy: (busy: boolean) => void = () => undefined, clock: Clock = realClock) {
    this.#write = write;
    this.#merge = merge;
    this.#gapMs = gapMs;
    this.#onBusy = onBusy;
    this.#clock = clock;
  }

  /** a write is on its way, or a value waits to be sent */
  get busy(): boolean {
    return this.#writing || this.#pending !== null;
  }

  /** Send a value: at once if nothing is being written and the last write started long enough ago, else later, merged
   * with whatever else comes meanwhile */
  push(value: T): void {
    const was = this.busy;
    this.#pending = this.#pending === null ? value : this.#merge(this.#pending, value);
    this.#schedule();
    if (!was) this.#onBusy(true);
  }

  /** Resolves once everything pushed so far has been written (at once if nothing is) */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  #schedule(): void {
    if (this.#writing || this.#timer !== null || this.#pending === null) return;
    const wait = this.#lastStart + this.#gapMs - this.#clock.now();
    if (wait <= 0) {
      this.#send();
      return;
    }
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      this.#schedule();
    }, wait);
  }

  #send(): void {
    const value = this.#pending as T;
    this.#pending = null;
    this.#writing = true;
    this.#lastStart = this.#clock.now();
    void this.#write(value).catch(() => undefined).finally(() => {
      this.#writing = false;
      this.#schedule();
      if (!this.busy) {
        this.#onBusy(false);
        const waiting = this.#idle;
        this.#idle = [];
        for (const resolve of waiting) resolve();
      }
    });
  }
}
```

Create `web/src/lighting/state.svelte.ts`:

```ts
// What the Lighting page compares the keyboard's lighting with: the lighting it showed when the page first showed it,
// or the lighting saved here since. Kept while another page shows (the page is made anew when it comes back), for one
// keyboard (its uid): another one starts over.
import type { Lighting } from "../api/types";

export class LightingBaseline {
  /** the lighting to compare with, or null before the page first showed this keyboard */
  lighting = $state.raw<Lighting | null>(null);
  /** it was saved here (rather than being what the keyboard showed at first, which may not be what it keeps) */
  saved = $state(false);
  #uid: string | null = null;

  /** The keyboard shown: one that isn't the one followed so far starts over from what it shows now */
  follow(uid: string, now: Lighting): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.lighting = now;
    this.saved = false;
  }

  /** The keyboard keeps `now` from here on */
  save(now: Lighting): void {
    this.lighting = now;
    this.saved = true;
  }
}

export const lightingBaseline = new LightingBaseline();
```

```bash
cd web && npx vitest run src/lighting
```

Expected: `Test Files  2 passed (2)` and `Tests  21 passed (21)`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  43 passed (43)` and `Tests  700 passed (700)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lighting/colour.ts \
  web/src/lighting/effects.ts \
  web/src/lighting/lighting.test.ts \
  web/src/lighting/lighting.ts \
  web/src/lighting/state.svelte.ts \
  web/src/lighting/state.test.ts \
  web/src/lighting/writer.ts
git commit -m "feat(web): lighting effects by name, colours, changes as patches, writes that don't flood the keyboard"
```

### Task 12: The Lighting page

One card per kind of lighting the keyboard has, each with a note on what the keyboard does with its controls:

- **`ColourPicker.svelte`:** the browser's colour picker as the swatch (a picked colour sets hue and saturation), then hue and saturation sliders with painted tracks.
- **`LightingCard.svelte`:** a card with a title and a sentence on what it is.
- **`VialRgbCard.svelte`:** the effects the keyboard has (a list), speed, the colour, and the brightness up to the keyboard's maximum (its percentage is of that maximum).
- **`RgbLightCard.svelte`:** the effects as Qt lists them (with a note that a firmware with fewer effects numbers them otherwise), the colour and the brightness. No speed: no RGB light effect of vial-qmk uses it.
- **`BacklightCard.svelte`:** brightness (with a note on its few steps) and breathing.
- **`LightingPage.svelte`:** a change is shown at once (`withPatch`) and sent through a `LatestWriter` (80 ms apart); the reply replaces it. The note says changes are kept only once saved; the Save bar says whether the keyboard shows changes not saved. Save waits for the writes, then saves; Undo sends `restorePatch` of the baseline. Save and Undo stay focusable while anything is sending.

The page isn't reachable until Task 16; svelte-check and the build check it now, the e2e tests in Task 17.

**Files:**
- Create: `web/src/lighting/ColourPicker.svelte`
- Create: `web/src/lighting/LightingCard.svelte`
- Create: `web/src/lighting/VialRgbCard.svelte`
- Create: `web/src/lighting/RgbLightCard.svelte`
- Create: `web/src/lighting/BacklightCard.svelte`
- Create: `web/src/lighting/LightingPage.svelte`

- [ ] **Step 1: The colour picker and the card**

Create `web/src/lighting/ColourPicker.svelte`:

```svelte
<script lang="ts">
  import Slider from "../ui/Slider.svelte";
  import { degrees, HUE_TRACK, hsvToRgb, percent, pickedHueSat, rgbToHex, saturationTrack } from "./colour";

  interface Props {
    /** QMK's hue and saturation, 0-255 */
    hue: number;
    saturation: number;
    disabled: boolean;
    onchange: (colour: { hue: number; saturation: number }) => void;
  }

  let { hue, saturation, disabled, onchange }: Props = $props();
  const uid = $props.id();

  /** the colour at full brightness: the swatch, what the browser's picker starts from, and what it sets */
  const full = $derived(rgbToHex(hsvToRgb(hue, saturation, 255)));
</script>

<fieldset class="colour" aria-describedby="{uid}-help">
  <legend>Colour</legend>
  <!-- the browser's own colour picker is the swatch: a click opens it -->
  <label class="pick">
    <input type="color" value={full} {disabled}
      oninput={(event) => {
        const picked = pickedHueSat(event.currentTarget.value, hue);
        if (picked) onchange(picked);
      }} />
    <span>Pick a colour…</span>
  </label>
  <p class="help" id="{uid}-help">A colour picked sets the hue and saturation; the brightness has a slider of its own.</p>
  <Slider label="Hue" value={hue} max={255} valueText={degrees(hue)} {disabled} track={HUE_TRACK}
    oninput={(value) => onchange({ hue: value, saturation })} />
  <Slider label="Saturation" value={saturation} max={255} valueText={percent(saturation)} {disabled}
    track={saturationTrack(hue)} oninput={(value) => onchange({ hue, saturation: value })} />
</fieldset>

<style>
  .colour {
    display: grid;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 550;
  }

  .pick {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 10px;
    font-size: 13px;
    cursor: pointer;
  }

  input {
    width: 56px;
    height: 34px;
    padding: 2px;
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 8px;
    background: var(--surface-2);
    cursor: pointer;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .help {
    margin: -4px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
```

Create `web/src/lighting/LightingCard.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** what it is, in a sentence */
    about: string;
    children: Snippet;
  }

  let { title, about, children }: Props = $props();
  const uid = $props.id();
</script>

<!-- the controls of one kind of lighting; a .note inside says what the keyboard does with them -->
<section class="card" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{title}</h2>
  <p class="about">{about}</p>
  {@render children()}
</section>

<style>
  .card {
    display: grid;
    gap: 12px;
    min-width: 0;
    padding: 14px 16px 16px;
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
    margin: -8px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .card :global(.note) {
    margin: -6px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 2: The cards of each kind**

Create `web/src/lighting/VialRgbCard.svelte`:

```svelte
<script lang="ts">
  import type { VialRgb } from "../api/types";
  import SelectField from "../ui/SelectField.svelte";
  import Slider from "../ui/Slider.svelte";
  import { brightnessTrack, percent, percentOf } from "./colour";
  import ColourPicker from "./ColourPicker.svelte";
  import { vialRgbChoices, vialRgbNote } from "./effects";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: VialRgb;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();

  const hue = $derived(value.hsv[0]);
  const saturation = $derived(value.hsv[1]);
  const brightness = $derived(value.hsv[2]);
  const note = $derived(vialRgbNote(value.mode));
  const capped = $derived(value.maxBrightness < 255);
  const choices = $derived(vialRgbChoices(value.supportedEffects, value.mode)
    .map((c) => ({ value: String(c.value), label: c.label })));

  function colour(hsv: [number, number, number]) {
    onchange({ vialrgb: { hsv } });
  }
</script>

<LightingCard title="RGB matrix" about="The per-key lights (VialRGB): an effect, how fast it runs, and its colour.">
  <SelectField label="Effect" value={String(value.mode)} {choices} {disabled}
    describedby={note ? `${uid}-note` : undefined} onchange={(mode) => onchange({ vialrgb: { mode: Number(mode) } })} />
  {#if note}<p class="note" id="{uid}-note">{note}</p>{/if}
  <Slider label="Speed" value={value.speed} max={255} valueText={percent(value.speed)} {disabled}
    oninput={(speed) => onchange({ vialrgb: { speed } })} />
  <ColourPicker {hue} {saturation} {disabled} onchange={(c) => colour([c.hue, c.saturation, brightness])} />
  <Slider label="Brightness" value={brightness} max={value.maxBrightness}
    valueText={percentOf(brightness, value.maxBrightness)} {disabled} track={brightnessTrack(hue, saturation, value.maxBrightness)}
    describedby={capped ? `${uid}-cap` : undefined} oninput={(v) => colour([hue, saturation, v])} />
  {#if capped}
    <p class="note" id="{uid}-cap">
      100 % is the brightest this keyboard's firmware allows: {percent(value.maxBrightness)} of what its lights can do.
    </p>
  {/if}
</LightingCard>
```

Create `web/src/lighting/RgbLightCard.svelte`:

```svelte
<script lang="ts">
  import type { RgbLight } from "../api/types";
  import SelectField from "../ui/SelectField.svelte";
  import Slider from "../ui/Slider.svelte";
  import { brightnessTrack, percent } from "./colour";
  import ColourPicker from "./ColourPicker.svelte";
  import { rgbLightChoices, rgbLightNote } from "./effects";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: RgbLight;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();

  const note = $derived(rgbLightNote(value.effect));
  const choices = $derived(rgbLightChoices(value.effect).map((c) => ({ value: String(c.value), label: c.label })));
</script>

<LightingCard title="RGB light" about="QMK's RGB light (often underglow): an effect, its colour and its brightness.">
  <SelectField label="Effect" value={String(value.effect)} {choices} {disabled}
    describedby="{uid}-numbers{note ? ` ${uid}-note` : ''}"
    onchange={(effect) => onchange({ rgblight: { effect: Number(effect) } })} />
  {#if note}<p class="note" id="{uid}-note">{note}</p>{/if}
  <p class="note" id="{uid}-numbers">
    These are Vial's names for the effects' numbers. A keyboard built with only some effects numbers the rest
    differently, so a name may start another effect.
  </p>
  <ColourPicker hue={value.hue} saturation={value.saturation} {disabled}
    onchange={(c) => onchange({ rgblight: { hue: c.hue, saturation: c.saturation } })} />
  <Slider label="Brightness" value={value.brightness} max={255} valueText={percent(value.brightness)} {disabled}
    track={brightnessTrack(value.hue, value.saturation)} oninput={(brightness) => onchange({ rgblight: { brightness } })} />
</LightingCard>
```

Create `web/src/lighting/BacklightCard.svelte`:

```svelte
<script lang="ts">
  import type { Backlight } from "../api/types";
  import Slider from "../ui/Slider.svelte";
  import Switch from "../ui/Switch.svelte";
  import { percent } from "./colour";
  import LightingCard from "./LightingCard.svelte";
  import type { LightingPatch } from "./lighting";

  interface Props {
    /** what the keyboard shows, with the changes on their way put over it */
    value: Backlight;
    disabled: boolean;
    onchange: (patch: LightingPatch) => void;
  }

  let { value, disabled, onchange }: Props = $props();
  const uid = $props.id();
</script>

<LightingCard title="Backlight" about="QMK's single-colour backlight: its brightness, and whether it breathes.">
  <Slider label="Brightness" value={value.brightness} max={255} valueText={percent(value.brightness)} {disabled}
    describedby="{uid}-steps" oninput={(brightness) => onchange({ backlight: { brightness } })} />
  <p class="note" id="{uid}-steps">
    The backlight has a few brightness steps (3, unless its firmware sets another number): it takes the step at or
    below the one chosen, and the slider then shows it.
  </p>
  <Switch label="Breathing" checked={value.effect !== 0} {disabled} describedby="{uid}-breathing"
    onchange={(on) => onchange({ backlight: { effect: on ? 1 : 0 } })} />
  <p class="note" id="{uid}-breathing">
    Only a keyboard whose firmware is built with breathing can breathe; on another, the switch turns back off.
  </p>
</LightingCard>
```

- [ ] **Step 3: The page**

Create `web/src/lighting/LightingPage.svelte`:

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import SaveBar from "../ui/SaveBar.svelte";
  import BacklightCard from "./BacklightCard.svelte";
  import {
    lightingKinds, mergePatch, patchRequest, restorePatch, sameLighting, withPatch, type LightingPatch,
  } from "./lighting";
  import RgbLightCard from "./RgbLightCard.svelte";
  import { lightingBaseline as baseline } from "./state.svelte";
  import VialRgbCard from "./VialRgbCard.svelte";
  import { LatestWriter } from "./writer";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  /** the least time from one change sent to the next: a slider dragged sends about 12 a second */
  const WRITE_GAP_MS = 80;

  const canEdit = $derived(keyboard.canEdit);
  /** the changes not yet confirmed by the keyboard: shown meanwhile, then what it confirmed is */
  let draft = $state<LightingPatch>({});
  /** changes are on their way */
  let sending = $state(false);
  const writer = new LatestWriter<LightingPatch>(
    (patch) => keyboard.setLighting(patchRequest(patch, model.lighting)),
    mergePatch,
    WRITE_GAP_MS,
    (busy) => {
      sending = busy;
      if (!busy) draft = {};
    },
  );
  /** Save or Undo are being done: they take nothing more meanwhile (the focus stays on them) */
  const busy = $derived(sending || keyboard.pending > 0);

  const shown = $derived(withPatch(model.lighting, draft));
  const kinds = $derived(lightingKinds(model.lighting));

  // what the keyboard showed when this page first showed it, or what was saved here since (for this keyboard)
  untrack(() => baseline.follow(model.uid, model.lighting));
  $effect.pre(() => {
    const [uid, lighting] = [model.uid, model.lighting];
    untrack(() => baseline.follow(uid, lighting));
  });
  const changed = $derived(baseline.lighting !== null && !sameLighting(model.lighting, baseline.lighting));

  function change(patch: LightingPatch) {
    if (!canEdit) return;
    draft = mergePatch(draft, patch);
    writer.push(patch);
  }

  /** nothing to save: what the keyboard shows was saved here */
  const saved = $derived(baseline.saved && !changed);

  async function save() {
    if (busy || saved || !canEdit) return;
    await writer.idle();
    if (await keyboard.saveLighting()) baseline.save(model.lighting);
  }

  function undo() {
    if (busy || !changed || !baseline.lighting) return;
    change(restorePatch(baseline.lighting));
  }

  const status = $derived(sending ? "Sending the change to the keyboard…"
    : changed ? "The keyboard shows changes not saved: unplugged, it goes back to the lighting saved before."
    : baseline.saved ? "Saved: the keyboard keeps this lighting when it is unplugged."
    : "No changes since this page first showed the keyboard's lighting.");
</script>

<section class="page" aria-labelledby="lighting-title">
  <PageHeader
    id="lighting-title"
    title="Lighting"
    description="This keyboard's {kinds.join(' and ')}. Only what its firmware has is shown."
    note="Changes show on the keyboard at once, and it keeps them only once you Save: unplugged before that, it goes back to the lighting it had saved. Undo puts back the lighting saved here last, or what it showed when this page first opened."
  />

  {#if shown.vialrgb}
    <VialRgbCard value={shown.vialrgb} disabled={!canEdit} onchange={change} />
  {/if}
  {#if shown.rgblight}
    <RgbLightCard value={shown.rgblight} disabled={!canEdit} onchange={change} />
  {/if}
  {#if shown.backlight}
    <BacklightCard value={shown.backlight} disabled={!canEdit} onchange={change} />
  {/if}

  <SaveBar {status}>
    <Button class={!changed ? "idle" : undefined} aria-disabled={busy || !changed || undefined} disabled={!canEdit}
      onclick={undo}>Undo</Button>
    <!-- what the keyboard shows may not be what it keeps until it is saved here once -->
    <Button class={saved ? "idle" : undefined} variant="primary" disabled={!canEdit}
      aria-disabled={busy || saved || undefined} onclick={() => void save()}>Save</Button>
  </SaveBar>
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
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
git add web/src/lighting/BacklightCard.svelte \
  web/src/lighting/ColourPicker.svelte \
  web/src/lighting/LightingCard.svelte \
  web/src/lighting/LightingPage.svelte \
  web/src/lighting/RgbLightCard.svelte \
  web/src/lighting/VialRgbCard.svelte
git commit -m "feat(web): the Lighting page"
```

### Task 13: The Layout page

Qt's Layout tab, as its own page: one row per layout option of the keyboard's `vial.json`, an on/off option as a switch and a list of choices as a list (`SelectField`), then the base layer drawn with the keys that belong to an option ringed. Each change goes to the keyboard at once (`keyboard.setLayoutOptions(withLayoutChoice(…))`), as via.c keeps them in its EEPROM, and the page says so. Every drawing follows the model, so the Keymap and the other pages show the new layout. `optionRows` (`layout/options.ts`) turns the options into rows; a choice the keyboard holds beyond its list is named by its number.

**Files:**
- Create: `web/src/layout/options.ts`
- Test: `web/src/layout/options.test.ts` (new)
- Create: `web/src/layout/LayoutPage.svelte`

- [ ] **Step 1: Write the failing tests**

Create `web/src/layout/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { optionRows } from "./options";

describe("optionRows", () => {
  it("makes a switch of a name and a list of a name with choices, with what the keyboard holds", () => {
    const labels = ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL"]];
    expect(optionRows({ value: 0b1_10, labels })).toEqual([
      { index: 0, name: "Split Backspace", kind: "switch", choice: 1, choices: [] },
      { index: 1, name: "Bottom row", kind: "list", choice: 2, choices: ["ANSI", "Tsangan", "WKL"] },
    ]);
  });

  it("names a choice the keyboard holds beyond the list by its number", () => {
    const rows = optionRows({ value: 3, labels: [["Enter", "ANSI", "ISO", "Big"]] });
    expect(rows[0].choices).toEqual(["ANSI", "ISO", "Big", "Choice 3 (not one of the keyboard's)"]);
    expect(optionRows({ value: 1, labels: [["Lonely"]] })[0].choices).toEqual([
      "Choice 0 (not one of the keyboard's)", "Choice 1 (not one of the keyboard's)",
    ]);
  });
});
```

```bash
cd web && npx vitest run src/layout/options.test.ts
```

Expected: `Cannot find module './options'`.

- [ ] **Step 2: The rows**

Create `web/src/layout/options.ts`:

```ts
// The layout options form: one row per option of the keyboard's vial.json, as Qt's Layout tab shows them.
import type { LayoutOptions } from "../api/types";
import { layoutChoices } from "../keyboard/geometry";

export interface OptionRow {
  index: number;
  /** the option's name, as vial.json gives it */
  name: string;
  /** "switch": on or off (a name alone); "list": one of its choices */
  kind: "switch" | "list";
  /** what the keyboard holds: 0 or 1 for a switch, the choice's number for a list */
  choice: number;
  /** a list's choices; one the keyboard holds beyond them is added, named by its number */
  choices: string[];
}

export function optionRows(options: LayoutOptions): OptionRow[] {
  const held = layoutChoices(options);
  return options.labels.map((label, index) => {
    const choice = held[index] ?? 0;
    if (typeof label === "string") return { index, name: label, kind: "switch", choice, choices: [] };
    const [name = `Option ${index + 1}`, ...listed] = label;
    const choices = choice < listed.length ? listed : [...listed, ...Array.from(
      { length: choice - listed.length + 1 }, (_, i) => `Choice ${listed.length + i} (not one of the keyboard's)`,
    )];
    return { index, name, kind: "list", choice, choices };
  });
}
```

```bash
cd web && npx vitest run src/layout/options.test.ts
```

Expected: `Tests  2 passed (2)`.

- [ ] **Step 3: The page**

Create `web/src/layout/LayoutPage.svelte`:

```svelte
<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { withLayoutChoice, type Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import Switch from "../ui/Switch.svelte";
  import { optionRows, type OptionRow } from "./options";

  interface Props {
    model: KeyboardModel;
    /** the keys as the layout options chosen place them */
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls keep the focus, but take nothing until it is done */
  const busy = $derived(keyboard.pending > 0);
  const options = $derived(model.layoutOptions);
  const rows = $derived(options ? optionRows(options) : []);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  const keyCount = $derived(placement.items.filter((i) => i.kind === "key").length);
  /** the keys that belong to an option, ringed */
  const rings = $derived(placement.items.map((i) => (i.geometry.layoutIndex !== -1 ? "var(--accent)" : null)));

  function choose(row: OptionRow, choice: number) {
    if (!options || busy || choice === row.choice) return;
    void keyboard.setLayoutOptions(withLayoutChoice(options, row.index, choice), `Changing “${row.name}”`);
  }
</script>

<section class="page" aria-labelledby="layout-title">
  <PageHeader
    id="layout-title"
    title="Layout"
    description="Which of the layouts its design allows this keyboard is built with: a split Backspace, another bottom row and the like. The keymap then draws the keys it has."
    note="Each change is saved to the keyboard at once, and kept when it is unplugged."
  />

  <section class="card" aria-labelledby="layout-options-title">
    <h2 id="layout-options-title">Layout options</h2>
    <ul class="options">
      {#each rows as row (row.index)}
        <li class="option">
          {#if row.kind === "switch"}
            <Switch label={row.name} checked={row.choice === 1} disabled={!canEdit} {busy}
              onchange={(on) => choose(row, on ? 1 : 0)} />
          {:else}
            <SelectField label={row.name} value={String(row.choice)} disabled={!canEdit} {busy}
              choices={row.choices.map((label, i) => ({ value: String(i), label }))}
              onchange={(value) => choose(row, Number(value))} />
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <div class="board">
    <Keyboard {placement} {faces} labels={[]} {rings} selected={-1} onselect={() => undefined} interactive={false}
      maxUnit={56} />
    <p class="caption">
      The base layer, as drawn with the options above: {keyCount} {keyCount === 1 ? "key" : "keys"}. The keys ringed
      change with them.
    </p>
  </div>
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 16px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  .caption {
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
    text-align: center;
  }

  .card {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px 16px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .options {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .option {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 4px 0;
    border-top: 1px solid var(--border);
  }

  .option:first-child {
    border-top: 0;
  }

  .option > :global(*) {
    flex: 1;
  }
</style>
```

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  44 passed (44)` and `Tests  702 passed (702)` and `built in`.

- [ ] **Step 4: Commit**

```bash
git add web/src/layout/LayoutPage.svelte \
  web/src/layout/options.test.ts \
  web/src/layout/options.ts
git commit -m "feat(web): the Layout page"
```

### Task 14: The Matrix tester page

- **`matrix/matrix.ts`:** positions as `"row,col"`; `layoutPositions` (where the layout has keys, every option's included); `withPressed` (what was pressed, plus what is held; the same set when nothing is new, so nothing redraws); `matrixCells` (every position of the matrix, held, pressed before or not yet, with or without a key); `testSummary` and `summaryText` ("12 of 42 keys pressed so far.", and the positions pressed that have no key).
- **`matrix/state.svelte.ts`:** `MatrixTest`, what was pressed, kept per keyboard while other pages show; Reset clears it.
- **`MatrixGrid.svelte`:** the switch matrix as a table, every row and column: a position with no key is dashed, held is filled, pressed before has a green dot (shape as well as colour), with a legend.
- **`MatrixPage.svelte`:** Start testing watches the keys (`keyboard.watchMatrix()`), turns on a `KeyGuard` and unlocks first when needed; Stop testing (the same button, so the focus stays) or leaving the page ends it. The drawing shows the base layer in plain tones (the kinds' colours would read as test states): held keys lit, keys pressed before ringed green. A locked keyboard gets a line with Unlock….

**Files:**
- Create: `web/src/matrix/matrix.ts`
- Test: `web/src/matrix/matrix.test.ts` (new)
- Create: `web/src/matrix/state.svelte.ts`
- Create: `web/src/matrix/MatrixGrid.svelte`
- Create: `web/src/matrix/MatrixPage.svelte`

- [ ] **Step 1: Write the failing tests**

Create `web/src/matrix/matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed } from "./matrix";

const keys = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: null, col: null }];

describe("the matrix tester", () => {
  it("knows where the layout has keys", () => {
    expect(layoutPositions({ keys } as never)).toEqual(new Set(["0,0", "0,1", "1,0"]));
    expect(positionId({ row: 3, col: 12 })).toBe("3,12");
  });

  it("adds what is held to what was pressed, the same set when nothing is new", () => {
    const none = new Set<string>();
    const one = withPressed(none, [{ row: 0, col: 1 }]);
    expect([...one]).toEqual(["0,1"]);
    expect(withPressed(one, [{ row: 0, col: 1 }])).toBe(one);
    expect([...withPressed(one, [{ row: 1, col: 1 }])]).toEqual(["0,1", "1,1"]);
  });

  it("lays out every position, held, pressed before or not yet, with or without a key", () => {
    const layout = layoutPositions({ keys } as never);
    const cells = matrixCells(2, 2, layout, new Set(["0,0"]), new Set(["0,0", "1,1"]));
    expect(cells.map((r) => r.map((c) => `${c.state}${c.inLayout ? "" : " (no key)"}`))).toEqual([
      ["held", "untested"],
      ["untested", "tested (no key)"],
    ]);
  });

  it("counts the keys pressed, and the positions without a key that were", () => {
    const layout = layoutPositions({ keys } as never);
    const summary = testSummary(layout, new Set(["1,1", "0,0", "0,5"]));
    expect(summary).toEqual({ keysTested: 1, keys: 3, strays: [{ row: 0, col: 5 }, { row: 1, col: 1 }] });
    expect(summaryText(summary)).toBe("1 of 3 keys pressed so far.");
    expect(summaryText(testSummary(layout, new Set(["0,0", "0,1", "1,0"])))).toBe("Every key has been pressed (3).");
    expect(summaryText({ keysTested: 0, keys: 1, strays: [] })).toBe("0 of 1 key pressed so far.");
  });
});
```

```bash
cd web && npx vitest run src/matrix/matrix.test.ts
```

Expected: `Cannot find module './matrix'`.

- [ ] **Step 2: The positions, and what was pressed**

Create `web/src/matrix/matrix.ts`:

```ts
// The matrix tester's picture of the keyboard: which matrix positions are held now, which were held since the test
// started (or was reset), and which have no key in the keyboard's layout.
import type { KeyboardModel, MatrixPosition } from "../api/types";

/** "2,3": a matrix position as one string */
export function positionId(p: MatrixPosition): string {
  return `${p.row},${p.col}`;
}

/** The positions the keyboard's layout has keys at, every layout option's included */
export function layoutPositions(model: Pick<KeyboardModel, "keys">): Set<string> {
  return new Set(model.keys.filter((k) => k.row != null && k.col != null)
    .map((k) => positionId({ row: k.row as number, col: k.col as number })));
}

/** The positions pressed so far, with those held now added; the same set when nothing is new */
export function withPressed(tested: ReadonlySet<string>, pressed: MatrixPosition[]): ReadonlySet<string> {
  const ids = pressed.map(positionId);
  if (ids.every((id) => tested.has(id))) return tested;
  return new Set([...tested, ...ids]);
}

export type CellState = "held" | "tested" | "untested";

export interface MatrixCell {
  row: number;
  col: number;
  /** a key of the layout is at this position */
  inLayout: boolean;
  state: CellState;
}

/** Every position of the matrix, row by row */
export function matrixCells(rows: number, cols: number, layout: ReadonlySet<string>, held: ReadonlySet<string>,
  tested: ReadonlySet<string>): MatrixCell[][] {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
    const id = positionId({ row, col });
    const state: CellState = held.has(id) ? "held" : tested.has(id) ? "tested" : "untested";
    return { row, col, inLayout: layout.has(id), state };
  }));
}

export interface TestSummary {
  /** keys of the layout pressed so far, and how many it has */
  keysTested: number;
  keys: number;
  /** positions with no key in the layout that were pressed: a key there isn't in the layout, or the matrix has a fault */
  strays: MatrixPosition[];
}

export function testSummary(layout: ReadonlySet<string>, tested: ReadonlySet<string>): TestSummary {
  const strays = [...tested].filter((id) => !layout.has(id)).map((id) => {
    const [row, col] = id.split(",").map(Number);
    return { row, col };
  }).sort((a, b) => a.row - b.row || a.col - b.col);
  return { keysTested: [...tested].filter((id) => layout.has(id)).length, keys: layout.size, strays };
}

/** "12 of 42 keys pressed so far", "Every key has been pressed (42)." */
export function summaryText(summary: TestSummary): string {
  const { keysTested, keys } = summary;
  if (keys > 0 && keysTested === keys) return `Every key has been pressed (${keys}).`;
  return `${keysTested} of ${keys} ${keys === 1 ? "key" : "keys"} pressed so far.`;
}
```

Create `web/src/matrix/state.svelte.ts`:

```ts
// What the matrix tester has seen pressed, kept while another page shows (the page is made anew when it comes back),
// for one keyboard (its uid): another one starts over, as does Reset.

export class MatrixTest {
  /** the matrix positions pressed since the test started or was reset ("2,3") */
  tested = $state.raw<ReadonlySet<string>>(new Set());
  #uid: string | null = null;

  follow(uid: string): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.reset();
  }

  reset(): void {
    this.tested = new Set();
  }
}

export const matrixTest = new MatrixTest();
```

```bash
cd web && npx vitest run src/matrix/matrix.test.ts
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 3: The grid and the page**

Create `web/src/matrix/MatrixGrid.svelte`:

```svelte
<script lang="ts">
  import type { MatrixCell } from "./matrix";

  interface Props {
    cells: MatrixCell[][];
  }

  let { cells }: Props = $props();
  const uid = $props.id();

  const STATES = { held: "held now", tested: "pressed before", untested: "not pressed yet" } as const;
  const cols = $derived(cells[0]?.length ?? 0);
</script>

<!-- the switch matrix as the firmware reads it: every row and column, keys of the layout or not -->
<div class="scroll">
  <table aria-describedby="{uid}-legend">
    <thead>
      <tr>
        <td></td>
        {#each Array.from({ length: cols }, (_, c) => c) as col (col)}
          <th scope="col"><span class="visually-hidden">Column </span>{col}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each cells as row, r (r)}
        <tr>
          <th scope="row"><span class="visually-hidden">Row </span>{r}</th>
          {#each row as cell (cell.col)}
            <td>
              <span class="cell {cell.state}" class:nokey={!cell.inLayout}>
                <span class="visually-hidden">{cell.inLayout ? "" : "no key in the layout, "}{STATES[cell.state]}</span>
              </span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<ul class="legend" id="{uid}-legend">
  <li><span class="cell untested" aria-hidden="true"></span> a key, not pressed yet</li>
  <li><span class="cell tested" aria-hidden="true"></span> pressed before</li>
  <li><span class="cell held" aria-hidden="true"></span> held now</li>
  <li><span class="cell untested nokey" aria-hidden="true"></span> no key in the layout</li>
</ul>

<style>
  /* a wide matrix scrolls on its own; the page never does */
  .scroll {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    border-collapse: separate;
    border-spacing: 4px;
    margin: 0 auto;
  }

  th {
    min-width: 18px;
    color: var(--text-2);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 550;
  }

  td {
    padding: 0;
  }

  .cell {
    position: relative;
    display: block;
    width: 22px;
    height: 22px;
    border: 2px solid var(--key-border);
    border-radius: 5px;
    background: var(--key-bg);
  }

  .cell.tested {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 22%, var(--key-bg));
  }

  /* a dot: pressed before, told by shape as well as colour */
  .cell.tested::after {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--ok);
  }

  .cell.held {
    border-color: var(--accent);
    background: var(--accent);
  }

  /* no key there: dashed, as the keymap draws an empty key */
  .cell.nokey {
    border-style: dashed;
    background: transparent;
  }

  .cell.nokey.tested {
    background: color-mix(in srgb, var(--ok) 22%, transparent);
  }

  .cell.nokey.held {
    background: var(--accent);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    color: var(--text-2);
    font-size: 12.5px;
    list-style: none;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend .cell {
    width: 16px;
    height: 16px;
  }

  .legend .cell.tested::after {
    inset: 3px;
  }
</style>
```

Create `web/src/matrix/MatrixPage.svelte`:

```svelte
<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { KeyGuard } from "../lib/keyGuard";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import MatrixGrid from "./MatrixGrid.svelte";
  import {
    layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed,
  } from "./matrix";
  import { matrixTest as kept } from "./state.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  // what was pressed so far is kept while another page shows, for this keyboard
  untrack(() => kept.follow(model.uid));
  $effect.pre(() => kept.follow(model.uid));

  /** the test runs: the keys held are read, and keys pressed do nothing on the page */
  let testing = $state(false);
  const keyGuard = new KeyGuard();
  let unwatch: (() => void) | null = null;

  function start() {
    if (testing) return;
    testing = true;
    unwatch = keyboard.watchMatrix();
    keyGuard.start();
    // the firmware shows the keys held only once it is unlocked: the unlock runs first
    if (keyboard.unlock.state.state !== "unlocked") void keyboard.unlock.start();
  }

  function stop() {
    testing = false;
    unwatch?.();
    unwatch = null;
    keyGuard.stop();
  }

  onDestroy(() => {
    unwatch?.();
    keyGuard.dispose();
  });

  const reading = $derived(testing ? keyboard.matrix : null);
  const locked = $derived(testing && (reading?.state === "locked" || keyboard.unlock.state.state !== "unlocked"));
  const held = $derived(new Set(reading?.state === "testing" ? reading.pressed.map(positionId) : []));
  // what is held is pressed: kept for the keyboard
  $effect(() => {
    if (reading?.state === "testing") {
      const pressed = reading.pressed;
      untrack(() => (kept.tested = withPressed(kept.tested, pressed)));
    }
  });

  const layout = $derived(layoutPositions(model));
  // plain keys: the kinds' colours would read as states of the test
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model))
    .map((face) => ({ ...face, tone: face.tone === "none" || face.tone === "transparent" ? face.tone : "normal" as const })));
  const ids = $derived(placement.items.map((item) => item.kind === "key" && item.geometry.row != null
    && item.geometry.col != null ? positionId({ row: item.geometry.row, col: item.geometry.col }) : null));
  const lit = $derived(ids.map((id) => id !== null && held.has(id)));
  const rings = $derived(ids.map((id) => (id !== null && kept.tested.has(id) && !held.has(id) ? "var(--ok)" : null)));
  const cells = $derived(matrixCells(model.rows, model.cols, layout, held, kept.tested));
  const summary = $derived(testSummary(layout, kept.tested));

  const status = $derived(!testing ? "Not testing."
    : reading === null ? "Starting…"
    : reading.state === "locked" ? "Waiting for the keyboard to be unlocked…"
    : reading.state === "disconnected" ? "The keyboard is unplugged."
    : reading.state === "unsupported" ? "This keyboard can't tell which keys are held."
    : held.size > 0 ? `Testing: ${held.size} held now.` : "Testing: press keys on the keyboard.");
</script>

<section class="page" aria-labelledby="matrix-title">
  <PageHeader
    id="matrix-title"
    title="Matrix tester"
    description="Press each key on the keyboard to check that it works: a key lights up while it is held, and keeps a green ring once it has been pressed."
    note="Vial firmware tells which keys are held only while the keyboard is unlocked, so the test unlocks it first. While it runs, keys pressed do nothing on this page: click Stop testing to use them again."
  >
    {#snippet action()}
      <!-- one button, so that the focus stays on it when the test starts or stops -->
      <Button variant="primary" disabled={!testing && !keyboard.canEdit}
        onclick={() => (testing ? stop() : start())}>{testing ? "Stop testing" : "Start testing"}</Button>
      <Button disabled={kept.tested.size === 0} onclick={() => kept.reset()}>Reset</Button>
    {/snippet}
  </PageHeader>

  <p class="status" class:active={testing} role="status">
    <span>{status}</span>
    <span>{summaryText(summary)}</span>
  </p>
  {#if locked}
    <p class="locked">
      The keyboard is locked: hold its unlock keys when asked.
      <Button size="sm" onclick={() => void keyboard.unlock.start()}>Unlock…</Button>
    </p>
  {/if}

  <div class="board" class:testing>
    <Keyboard {placement} {faces} labels={[]} pressed={lit} {rings} selected={-1} onselect={() => undefined}
      interactive={false} maxUnit={64} />
    <p class="legend" aria-hidden="true">
      <span><span class="swatch held"></span> held now</span>
      <span><span class="swatch ring"></span> pressed before</span>
    </p>
  </div>

  <section class="card" aria-labelledby="matrix-grid-title">
    <h2 id="matrix-grid-title">Switch matrix</h2>
    <p class="about">
      Every row and column the firmware reads, {model.rows} × {model.cols}. A position with no key in the layout that
      lights up has a key the layout doesn't show, or a fault in the wiring.
    </p>
    <MatrixGrid {cells} />
    {#if summary.strays.length > 0}
      <p class="strays">
        Pressed without a key in the layout: {summary.strays.map((p) => `row ${p.row}, column ${p.col}`).join("; ")}.
      </p>
    {/if}
  </section>
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px;
  }

  .status.active {
    border-color: var(--accent);
    color: var(--text);
  }

  .locked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 16px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  /* the thing being tested keeps a visible border */
  .board.testing {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow);
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
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }

  .swatch.held {
    background: var(--accent);
  }

  .swatch.ring {
    border: 2px solid var(--ok);
    background: var(--key-bg);
  }

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

  .about,
  .strays {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .strays {
    color: var(--text);
  }
</style>
```

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  45 passed (45)` and `Tests  706 passed (706)` and `built in`.

- [ ] **Step 4: Commit**

```bash
git add web/src/matrix/MatrixGrid.svelte \
  web/src/matrix/MatrixPage.svelte \
  web/src/matrix/matrix.test.ts \
  web/src/matrix/matrix.ts \
  web/src/matrix/state.svelte.ts
git commit -m "feat(web): the Matrix tester page"
```

### Task 15: Reboot to bootloader on the Keyboard page

A "Reboot to bootloader" card at the end of the Keyboard page, with the danger border: what it does and that a locked keyboard is unlocked first. Its button opens a `ConfirmDialog` (Cancel focused) that says the keyboard "stops working as a keyboard and disappears from Vial until it is flashed, or unplugged and plugged back in". Confirming calls `keyboard.rebootToBootloader()`. When the dialog closes, the focus goes to the bootloader banner (Task 16) if the keyboard is gone, or back to the button.

**Files:**
- Create: `web/src/about/BootloaderCard.svelte`
- Modify: `web/src/about/KeyboardPage.svelte`

- [ ] **Step 1: The card, and the Keyboard page showing it**

Create `web/src/about/BootloaderCard.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  let confirming = $state(false);
  const busy = $derived(keyboard.pending > 0);
</script>

<!-- the Keyboard page's danger zone: what can't be undone from Vial -->
<section class="card" aria-labelledby="bootloader-title">
  <h2 id="bootloader-title">Reboot to bootloader</h2>
  <p>
    Restarts the keyboard into its bootloader, to flash new firmware with a flashing tool. Until it is flashed, or
    unplugged and plugged back in, it doesn't work as a keyboard and Vial can't see it. Vial firmware does this only
    for an unlocked keyboard: a locked one is unlocked first.
  </p>
  <div>
    <Button id="reboot-bootloader" variant="danger" disabled={!keyboard.canEdit} aria-disabled={busy || undefined}
      onclick={() => {
        if (!busy) confirming = true;
      }}>Reboot to bootloader…</Button>
  </div>
</section>

<ConfirmDialog
  open={confirming}
  title="Restart the keyboard into its bootloader?"
  message="It stops working as a keyboard and disappears from Vial until it is flashed, or unplugged and plugged back in. If it is locked, you hold its unlock keys first."
  confirmLabel="Reboot"
  danger
  onconfirm={() => keyboard.rebootToBootloader()}
  onclose={() => {
    confirming = false;
    // gone: the page can't be used, and the banner that says so takes the focus
    void tick().then(() => document.getElementById(keyboard.inBootloader ? "bootloader-banner" : "reboot-bootloader")
      ?.focus());
  }}
/>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--danger-line);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
```

Apply to `web/src/about/KeyboardPage.svelte`:

```diff
diff --git a/web/src/about/KeyboardPage.svelte b/web/src/about/KeyboardPage.svelte
--- a/web/src/about/KeyboardPage.svelte
+++ b/web/src/about/KeyboardPage.svelte
@@ -3,6 +3,7 @@
   import type { KeyboardModel } from "../api/types";
   import PageHeader from "../behaviours/PageHeader.svelte";
   import AboutCard from "./AboutCard.svelte";
+  import BootloaderCard from "./BootloaderCard.svelte";
   import LayoutFileCard from "./LayoutFileCard.svelte";
 
   interface Props {
@@ -17,10 +18,11 @@
   <PageHeader
     id="keyboard-title"
     title="Keyboard"
-    description="What the keyboard is and what its firmware can do, and its layout saved to a file or loaded from one."
+    description="What the keyboard is and what its firmware can do, its layout saved to a file or loaded from one, and a restart into its bootloader to flash it."
   />
   <LayoutFileCard {model} {analysis} />
   <AboutCard {model} />
+  <BootloaderCard />
 </section>
 
 <style>
```

- [ ] **Step 2: Type-check and build**

```bash
cd web && npm run check && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `built in`.

- [ ] **Step 3: Commit**

```bash
git add web/src/about/BootloaderCard.svelte \
  web/src/about/KeyboardPage.svelte
git commit -m "feat(web): reboot to bootloader on the Keyboard page"
```

### Task 16: Layout, Lighting and Matrix tester in the navigation; the bootloader banner

The navigation gets Layout (after Keymap, when the keyboard has layout options), Lighting (when it has any: `hasLighting`) and Matrix tester (when `matrixTester`), before Keyboard. Each shows its page. While the keyboard is in its bootloader (this tab rebooted it), the page is greyed out under a warning banner, "The keyboard is in its bootloader", instead of "Keyboard unplugged".

**Files:**
- Modify: `web/src/App.svelte`

- [ ] **Step 1: The sections, their pages and the banner**

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -11,6 +11,10 @@
   import { placeKeyboard } from "./keyboard/geometry";
   import { namesOf } from "./keyboard/labels";
   import KeymapPage from "./keymap/KeymapPage.svelte";
+  import LayoutPage from "./layout/LayoutPage.svelte";
+  import { hasLighting } from "./lighting/lighting";
+  import LightingPage from "./lighting/LightingPage.svelte";
+  import MatrixPage from "./matrix/MatrixPage.svelte";
   import { keyboard } from "./lib/keyboard.svelte";
   import type { SectionId } from "./lib/route";
   import { router } from "./lib/router.svelte";
@@ -30,12 +34,13 @@
   const analysis = $derived(keyboard.model && placement ? analyse(keyboard.model, placement) : null);
   const names = $derived(keyboard.model ? namesOf(keyboard.model) : null);
 
-  // sections the keyboard's firmware doesn't have (no tap dances, combos, macros, key overrides, alt-repeat keys or
-  // QMK settings) are left out
+  // sections the keyboard's firmware doesn't have (no layout options, tap dances, combos, macros, key overrides,
+  // alt-repeat keys, QMK settings, lighting or matrix tester) are left out
   const sections = $derived.by<Section[]>(() => {
     const model = keyboard.model;
     const list: Section[] = [{ id: "keymap", label: "Keymap", count: model?.layers.length }];
     if (!model) return list;
+    if (model.layoutOptions) list.push({ id: "layout", label: "Layout" });
     const counts = behaviourCounts(model);
     if (counts.tapDance !== null) list.push({ id: "tap-dance", label: "Tap dance", count: counts.tapDance });
     if (counts.combos !== null) list.push({ id: "combos", label: "Combos", count: counts.combos });
@@ -43,6 +48,8 @@
     if (counts.keyOverrides !== null) list.push({ id: "key-overrides", label: "Key overrides", count: counts.keyOverrides });
     if (counts.altRepeat !== null) list.push({ id: "alt-repeat", label: "Alt-repeat", count: counts.altRepeat });
     if (model.settings.length > 0) list.push({ id: "settings", label: "Settings" });
+    if (hasLighting(model.lighting)) list.push({ id: "lighting", label: "Lighting" });
+    if (model.matrixTester) list.push({ id: "matrix", label: "Matrix tester" });
     list.push({ id: "keyboard", label: "Keyboard" });
     return list;
   });
@@ -112,6 +119,13 @@
   <main class="content">
     {#if status === "offline"}
       <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
+    {:else if blocked && keyboard.inBootloader}
+      <Banner
+        id="bootloader-banner"
+        tone="warning"
+        title="The keyboard is in its bootloader"
+        message="It doesn't work as a keyboard until it is flashed, or unplugged and plugged back in. It shows up here again then."
+      />
     {:else if blocked}
       <Banner
         tone="danger"
@@ -152,6 +166,12 @@
           <AltRepeatPage model={keyboard.model} item={router.route.item} />
         {:else if section === "settings"}
           <SettingsPage model={keyboard.model} />
+        {:else if section === "layout"}
+          <LayoutPage model={keyboard.model} {placement} />
+        {:else if section === "lighting"}
+          <LightingPage model={keyboard.model} />
+        {:else if section === "matrix"}
+          <MatrixPage model={keyboard.model} {placement} />
         {:else if section === "keyboard"}
           <KeyboardPage model={keyboard.model} {analysis} />
         {:else}
```

- [ ] **Step 2: Type-check, test, and run the e2e tests**

```bash
cd web && npm run check && npm test && npm run e2e
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  45 passed (45)` and `Tests  706 passed (706)` and `118 passed`: the earlier tests pass with the new sections.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.svelte
git commit -m "feat(web): Layout, Lighting and Matrix tester in the navigation, and the bootloader banner"
```

### Task 17: End-to-end tests for the Lighting page; fixtures for the phase 5b pages

**The fixtures:** a fourth server, `qmkLighting` (the Corne with `--lighting qmk_backlight_rgblight`), and helpers: `lightingOf` and `setLighting` (through the API, shown and not saved), `pressKey` (the matrix hook) and `plugIn` (the connection hook).

**`lighting.spec.ts`:**
- VialRGB: an effect and a colour show at once and the Save bar says they aren't saved; a replug brings back the lighting saved before; saved, they survive a replug, and Save keeps the focus.
- VialRGB: the brightness slider stops at the keyboard's maximum and says so; speed and brightness changed, Undo puts back the lighting and keeps the focus; "Disable" says the keyboard takes no colour.
- A slider dragged quickly (100 moves) makes at most 3 writes, the last value last.
- QMK RGB light and backlight: effect and colour; the backlight's brightness settling on one of its 3 steps; breathing; an effect chosen after "All Off" (sent twice by the server); kept once saved, through a replug.
- The macropad, which has no lighting: no Lighting entry, `#lighting` shows the keymap, and none of its other pages mentions lighting, RGB or backlight.

Each test puts back the lighting it changed and saves it, in a `finally`.

**Files:**
- Modify: `web/e2e/servers.ts`
- Modify: `web/e2e/fixtures.ts`
- Test: `web/e2e/lighting.spec.ts` (new)

- [ ] **Step 1: The fourth server and the helpers**

Apply to `web/e2e/servers.ts`:

```diff
diff --git a/web/e2e/servers.ts b/web/e2e/servers.ts
--- a/web/e2e/servers.ts
+++ b/web/e2e/servers.ts
@@ -19,12 +19,14 @@ const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtu
  * VIAL_UNLOCK_COUNTER_MAX): the polls keep the firmware's timing */
 const UNLOCK_COUNTER = ["--unlock-counter", "10"];
 
-/** vial_web.py's arguments for each simulated keyboard: the default simulated Corne, a macropad with encoders, rotated
- * keys, an ISO Enter, a decal and a layout option, and the Corne with 8 layers, as the owner's W-CORNE has */
+/** vial_web.py's arguments for each simulated keyboard: the default simulated Corne (VialRGB lighting), a macropad
+ * with encoders, rotated keys, an ISO Enter, a decal, a layout option and no lighting, the Corne with 8 layers, as the
+ * owner's W-CORNE has, and the Corne with QMK's RGB light and backlight instead of VialRGB */
 export const SERVERS = {
   corne: [...UNLOCK_COUNTER],
   macropad: ["--definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
   eightLayers: ["--layers", "8", ...UNLOCK_COUNTER],
+  qmkLighting: ["--lighting", "qmk_backlight_rgblight", ...UNLOCK_COUNTER],
 } satisfies Record<string, string[]>;
 
 /** Long enough to start a server, on a busy machine too */
```

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -32,15 +32,17 @@ function serverOf(
 }
 
 /** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
- * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty). `corneUrl` is the
- * simulated Corne's link, for a test that opens it itself. */
+ * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty), `qmkLighting` the
+ * simulated Corne with QMK's RGB light and backlight. `corneUrl` is the simulated Corne's link, for a test that opens
+ * it itself. */
 export const test = base.extend<
-  { app: Page; macropad: Page; eightLayers: Page },
-  { corneUrl: string; macropadUrl: string; eightLayersUrl: string }
+  { app: Page; macropad: Page; eightLayers: Page; qmkLighting: Page },
+  { corneUrl: string; macropadUrl: string; eightLayersUrl: string; qmkLightingUrl: string }
 >({
   corneUrl: serverOf(SERVERS.corne),
   macropadUrl: serverOf(SERVERS.macropad),
   eightLayersUrl: serverOf(SERVERS.eightLayers),
+  qmkLightingUrl: serverOf(SERVERS.qmkLighting),
   app: async ({ page, corneUrl }, use) => {
     await use(await open(page, corneUrl));
   },
@@ -50,6 +52,9 @@ export const test = base.extend<
   eightLayers: async ({ page, eightLayersUrl }, use) => {
     await use(await open(page, eightLayersUrl));
   },
+  qmkLighting: async ({ page, qmkLightingUrl }, use) => {
+    await use(await open(page, qmkLightingUrl));
+  },
 });
 
 export { expect };
@@ -328,6 +333,26 @@ export async function setSettings(page: Page, settings: Record<number, number>):
   }
 }
 
+/** The keyboard's lighting, as the server reports it */
+export async function lightingOf(page: Page) {
+  return (await keyboardModel(page)).lighting;
+}
+
+/** Changes the lighting through the API (shown, not saved): tests put back what they changed */
+export async function setLighting(page: Page, body: unknown): Promise<void> {
+  await put(page, "/api/lighting", body);
+}
+
+/** The fake server's test hook: a key of the simulated keyboard's matrix is pressed, or let go */
+export async function pressKey(page: Page, row: number, col: number, pressed = true): Promise<void> {
+  await put(page, "/api/simulator/matrix", { row, col, pressed });
+}
+
+/** The fake server's test hook: the simulated keyboard is plugged in, or unplugged */
+export async function plugIn(page: Page, connected: boolean): Promise<void> {
+  await put(page, "/api/simulator/connection", { connected });
+}
+
 /** Shows a section from the navigation and waits for its heading */
 export async function openSection(page: Page, name: string): Promise<void> {
   await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
```

- [ ] **Step 2: The Lighting page's tests**

Create `web/e2e/lighting.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { api, expect, lightingOf, openSection, plugIn, restoreAll, setLighting, test } from "./fixtures";

// The Lighting page against the simulated keyboards: the Corne's VialRGB, and QMK's RGB light and backlight on the
// other Corne. Changes show at once and are kept only once saved: a replug (the simulator starts over with what its
// firmware keeps) tells. Each test puts back the lighting it changed, and saves it, so the next one finds it as before.

type Lighting = Awaited<ReturnType<typeof lightingOf>>;

/** The lighting as a request puts it back */
function restoreBody(l: Lighting) {
  return {
    ...(l.vialrgb ? { vialrgb: { mode: l.vialrgb.mode, speed: l.vialrgb.speed, hsv: l.vialrgb.hsv } } : {}),
    ...(l.rgblight ? { rgblight: { effect: l.rgblight.effect, hue: l.rgblight.hue, saturation: l.rgblight.saturation,
      brightness: l.rgblight.brightness } } : {}),
    ...(l.backlight ? { backlight: { brightness: l.backlight.brightness, effect: l.backlight.effect } } : {}),
  };
}

/** Puts the lighting back and keeps it so */
async function putBack(page: Page, l: Lighting) {
  await setLighting(page, restoreBody(l));
  const saved = await api(page).post("/api/lighting/save");
  if (!saved.ok()) throw new Error(`saving the lighting failed: ${saved.status()}`);
}

/** Unplugs the simulated keyboard and plugs it back in, and waits until the page has read it again */
async function replug(page: Page) {
  await plugIn(page, false);
  await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeVisible();
  await plugIn(page, true);
  await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeHidden({ timeout: 10_000 });
}

const status = (page: Page) => page.locator(".savebar [role=status]");

test("VialRGB: an effect and a colour show at once, and are kept once saved", async ({ app }) => {
  const before = await lightingOf(app);
  try {
    await openSection(app, "Lighting");
    const effect = app.getByLabel("Effect");
    await expect(effect).toHaveValue(String(before.vialrgb.mode));
    await effect.selectOption({ label: "Gradient Up Down" });
    await expect.poll(async () => (await lightingOf(app)).vialrgb.mode).toBe(4);
    await app.getByRole("slider", { name: "Hue" }).fill("170");
    await expect.poll(async () => (await lightingOf(app)).vialrgb.hsv[0]).toBe(170);
    await expect(app.getByRole("slider", { name: "Hue" })).toHaveAttribute("aria-valuetext", "240°");
    await expect(status(app)).toContainText("not saved");

    // not saved yet: a replug brings back what the keyboard kept
    await replug(app);
    await expect.poll(async () => (await lightingOf(app)).vialrgb.mode).toBe(before.vialrgb.mode);
    await expect(effect).toHaveValue(String(before.vialrgb.mode));

    await effect.selectOption({ label: "Gradient Up Down" });
    await app.getByRole("slider", { name: "Hue" }).fill("170");
    await expect(status(app)).toContainText("not saved");
    const save = app.locator(".savebar").getByRole("button", { name: "Save" });
    await save.click();
    await expect(status(app)).toHaveText("Saved: the keyboard keeps this lighting when it is unplugged.");
    await expect(save).toBeFocused();
    await replug(app);
    const after = await lightingOf(app);
    expect([after.vialrgb.mode, after.vialrgb.hsv[0]]).toEqual([4, 170]);
    await expect(effect).toHaveValue("4");
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("VialRGB: Undo puts back the lighting, and the brightness stops at the keyboard's most", async ({ app }) => {
  const before = await lightingOf(app);
  try {
    await openSection(app, "Lighting");
    const brightness = app.getByRole("slider", { name: "Brightness" });
    await expect(brightness).toHaveAttribute("max", "200");
    await expect(app.getByText("100 % is the brightest this keyboard's firmware allows: 78 % of what its lights can do.")).toBeVisible();
    await expect(brightness).toHaveAttribute("aria-valuetext", "64 %");
    await app.getByRole("slider", { name: "Speed" }).fill("10");
    await brightness.fill("200");
    await expect.poll(async () => (await lightingOf(app)).vialrgb.hsv[2]).toBe(200);
    expect((await lightingOf(app)).vialrgb.speed).toBe(10);
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    await undo.click();
    await expect.poll(async () => (await lightingOf(app)).vialrgb).toEqual(before.vialrgb);
    await expect(status(app)).toHaveText(/^No changes|^Saved/);
    await expect(undo).toBeFocused();
    // off: the keyboard takes no colour, and the page says so
    await app.getByLabel("Effect").selectOption({ label: "Disable" });
    await expect(app.getByText("The lights are off: the keyboard takes no colour or brightness")).toBeVisible();
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("a slider dragged quickly sends a few changes, the last one last", async ({ app }) => {
  const before = await lightingOf(app);
  const puts: string[] = [];
  app.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/lighting")) puts.push(r.postData() ?? "");
  });
  try {
    await openSection(app, "Lighting");
    const speed = app.getByRole("slider", { name: "Speed" });
    // a drag: 100 moves at once, as fast as the browser sends them
    await speed.evaluate((input: HTMLInputElement, from: number) => {
      for (let i = 1; i <= 100; i++) {
        input.value = String(from - i);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, before.vialrgb.speed);
    await expect.poll(async () => (await lightingOf(app)).vialrgb.speed).toBe(before.vialrgb.speed - 100);
    await expect(status(app)).not.toHaveText(/Sending/);
    // the first move at once, then the last: nothing in between
    expect(puts.length).toBeLessThanOrEqual(3);
    expect(JSON.parse(puts.at(-1)!)).toEqual({ vialrgb: { speed: before.vialrgb.speed - 100 } });
    await expect(speed).toHaveValue(String(before.vialrgb.speed - 100));
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("QMK RGB light and backlight: effect, colour, brightness steps and breathing, kept once saved", async ({ qmkLighting: page }) => {
  const before = await lightingOf(page);
  try {
    await openSection(page, "Lighting");
    await expect(page.getByRole("heading", { level: 2, name: "RGB light" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Backlight" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "RGB matrix" })).toHaveCount(0);

    await page.getByLabel("Effect").selectOption({ label: "Snake 1" });
    await page.getByRole("slider", { name: "Hue" }).fill("85");
    await page.getByRole("slider", { name: "Saturation" }).fill("200");
    await expect.poll(async () => {
      const l = (await lightingOf(page)).rgblight;
      return [l.effect, l.hue, l.saturation];
    }).toEqual([15, 85, 200]);

    // the backlight's three steps: 200 settles on 170
    const backlight = page.getByRole("region", { name: "Backlight" });
    await backlight.getByRole("slider", { name: "Brightness" }).fill("200");
    await expect.poll(async () => (await lightingOf(page)).backlight.brightness).toBe(170);
    await expect(backlight.getByRole("slider", { name: "Brightness" })).toHaveValue("170");
    await backlight.getByRole("switch", { name: "Breathing" }).check();
    await expect.poll(async () => (await lightingOf(page)).backlight.effect).toBe(1);

    // the RGB light turned off and on again takes the effect chosen (sent twice by the server)
    await page.getByLabel("Effect").selectOption({ label: "All Off" });
    await expect(page.getByText("The light is off: the keyboard takes no colour or brightness")).toBeVisible();
    await page.getByLabel("Effect").selectOption({ label: "Knight 1" });
    await expect.poll(async () => (await lightingOf(page)).rgblight.effect).toBe(21);

    await page.locator(".savebar").getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toHaveText("Saved: the keyboard keeps this lighting when it is unplugged.");
    await replug(page);
    const after = await lightingOf(page);
    expect([after.rgblight.effect, after.rgblight.hue, after.backlight.brightness, after.backlight.effect])
      .toEqual([21, 85, 170, 1]);
  } finally {
    await restoreAll(() => putBack(page, before));
  }
});

test("a keyboard without lighting has no Lighting page and says nothing of lighting", async ({ macropad }) => {
  const nav = macropad.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button", { name: /^Keyboard/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Lighting/ })).toHaveCount(0);
  // its address shows the keymap instead
  await macropad.goto(macropad.url().replace(/#.*$/, "") + "#lighting");
  await expect(macropad.getByRole("heading", { level: 1, name: "Keymap" })).toBeVisible();
  for (const name of ["Keyboard", "Layout", "Matrix tester"]) {
    await openSection(macropad, name);
    await expect(macropad.locator("main")).not.toContainText(/lighting|RGB|backlight/i);
  }
});
```

- [ ] **Step 3: Type-check, then build and run the new tests, then all of them**

```bash
cd web && npm run check && npm run build && npx playwright test e2e/lighting.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `5 passed`.

```bash
cd web && npx playwright test
```

Expected: `123 passed`.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/fixtures.ts \
  web/e2e/lighting.spec.ts \
  web/e2e/servers.ts
git commit -m "test(web): end-to-end tests for the Lighting page; fixtures for the phase 5b pages"
```

### Task 18: End-to-end tests for the Layout page, the matrix tester and reboot to bootloader

- **`layout.spec.ts`:** on the macropad, "Split Backspace" switched on is saved at once (the keyboard's value changes) and keeps the focus; the Layout page's drawing and the Keymap's go from 13 to 14 keys, a reload keeps it, and it is switched off again. The Corne, which has no layout options, has no Layout entry.
- **`matrix.spec.ts`:** on a locked Corne, Start testing opens the unlock dialog; once unlocked, a key pressed through the hook lights up in the drawing and the grid, and keeps its ring once let go; a position with no key shows in the grid and is named in words; Reset clears it all. While testing, Tab and Enter do nothing on the page and the focus stays on Stop testing; stopped, keys work again. Leaving the page stops the test: keys work on the Keymap again.
- **`bootloader.spec.ts`:** a locked Corne. The confirmation has the focus on Cancel, and Cancel gives it back to the button. Confirmed, the unlock runs first; then the banner "The keyboard is in its bootloader" takes the focus, the page is greyed out and the session says the keyboard is gone. Plugged in again, the keyboard comes back.

**Files:**
- Test: `web/e2e/layout.spec.ts` (new)
- Test: `web/e2e/matrix.spec.ts` (new)
- Test: `web/e2e/bootloader.spec.ts` (new)

- [ ] **Step 1: The Layout page**

Create `web/e2e/layout.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { api, expect, openSection, restoreAll, test } from "./fixtures";

// The Layout page on the simulated macropad, whose 2u key splits in two (its layout option "Split Backspace").

async function layoutOptions(page: Page): Promise<number> {
  return (await (await api(page).get("/api/keyboard")).json()).layoutOptions.value;
}

async function setLayoutOptions(page: Page, value: number): Promise<void> {
  const response = await api(page).put("/api/layout-options", { value });
  if (!response.ok()) throw new Error(`setting the layout options failed: ${response.status()}`);
}

test("a layout option changed is saved at once, and every drawing of the keyboard follows", async ({ macropad }) => {
  const before = await layoutOptions(macropad);
  expect(before).toBe(0);
  try {
    // the Keymap draws 13 keys (and 4 encoder directions): the 2u key, not the two 1u ones
    await expect(macropad.locator("button.key")).toHaveCount(13);
    await openSection(macropad, "Layout");
    await expect(macropad.getByText("Each change is saved to the keyboard at once")).toBeVisible();
    const board = macropad.locator(".board");
    await expect(board.locator(".key")).toHaveCount(13);
    await expect(board).toContainText("13 keys");
    const split = macropad.getByRole("switch", { name: "Split Backspace" });
    await expect(split).not.toBeChecked();
    await split.check();
    await expect.poll(() => layoutOptions(macropad)).toBe(1);
    await expect(split).toBeChecked();
    await expect(split).toBeFocused();
    await expect(board.locator(".key")).toHaveCount(14);
    await expect(board).toContainText("14 keys");
    await openSection(macropad, "Keymap");
    await expect(macropad.locator("button.key")).toHaveCount(14);
    // read again from the keyboard: kept
    await macropad.reload();
    await expect(macropad.locator("button.key")).toHaveCount(14);
    await openSection(macropad, "Layout");
    await expect(macropad.getByRole("switch", { name: "Split Backspace" })).toBeChecked();
    await macropad.getByRole("switch", { name: "Split Backspace" }).uncheck();
    await expect.poll(() => layoutOptions(macropad)).toBe(0);
    await expect(board.locator(".key")).toHaveCount(13);
  } finally {
    await restoreAll(() => setLayoutOptions(macropad, before));
  }
});

test("a keyboard without layout options has no Layout page", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button", { name: /^Keyboard/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Layout/ })).toHaveCount(0);
});
```

- [ ] **Step 2: The matrix tester**

Create `web/e2e/matrix.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect, keyIndex, openSection, pressKey, restoreAll, simulatorUnlock, test, unlockAgain, unlockState } from "./fixtures";

// The matrix tester on the simulated Corne: keys are pressed through the fake server's hook. Its unlock keys are Tab
// (row 0, column 0) and Backspace (row 4, column 0); row 3, column 0 has no key in its layout.

/** The key of the drawing at a matrix position (the drawing's keys are in the model's order: placement follows it) */
async function drawnKey(page: Page, row: number, col: number) {
  return page.locator(".board .key").nth(await keyIndex(page, row, col));
}

function cell(page: Page, row: number, col: number) {
  return page.locator("table tbody tr").nth(row).locator("td").nth(col).locator(".cell");
}

test("a locked keyboard is unlocked, then a key lights up while held and stays marked", async ({ app }) => {
  try {
    await simulatorUnlock(app, { locked: true });
    await openSection(app, "Matrix tester");
    const start = app.getByRole("button", { name: "Start testing" });
    await start.click();
    // the firmware hides the matrix until it is unlocked: the unlock runs first
    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(await unlockState(app)).toBe("unlocked");
    await simulatorUnlock(app, { keysHeld: false });
    await expect(app.locator(".board .key.pressed")).toHaveCount(0);

    const w = await drawnKey(app, 0, 1);
    await pressKey(app, 0, 1);
    await expect(w).toHaveClass(/pressed/);
    await expect(cell(app, 0, 1)).toHaveClass(/held/);
    await expect(app.getByRole("status").filter({ hasText: "Testing: 1 held now." })).toBeVisible();
    await pressKey(app, 0, 1, false);
    await expect(w).not.toHaveClass(/pressed/);
    await expect(w).toHaveClass(/ringed/);
    await expect(cell(app, 0, 1)).toHaveClass(/tested/);

    // a position with no key in the layout shows in the matrix
    await pressKey(app, 3, 0);
    await expect(cell(app, 3, 0)).toHaveClass(/held/);
    await expect(cell(app, 3, 0)).toHaveClass(/nokey/);
    await pressKey(app, 3, 0, false);
    await expect(app.getByText("Pressed without a key in the layout: row 3, column 0.")).toBeVisible();

    // Reset forgets what was pressed
    await app.getByRole("button", { name: "Reset" }).click();
    await expect(w).not.toHaveClass(/ringed/);
    await expect(cell(app, 0, 1)).toHaveClass(/untested/);
    await expect(app.getByText("0 of 42 keys pressed so far.")).toBeVisible();
  } finally {
    await restoreAll(() => pressKey(app, 0, 1, false), () => pressKey(app, 3, 0, false), () => unlockAgain(app));
  }
});

test("while testing, keys typed do nothing on the page; stopped, they work again", async ({ app }) => {
  await openSection(app, "Matrix tester");
  const button = app.getByRole("button", { name: "Start testing" });
  await button.focus();
  await app.keyboard.press("Enter");
  const stop = app.getByRole("button", { name: "Stop testing" });
  await expect(stop).toBeFocused();
  await expect(app.locator(".board.testing")).toBeVisible();
  // Tab doesn't move the focus, Enter doesn't press the button
  await app.keyboard.press("Tab");
  await app.keyboard.press("Enter");
  await expect(stop).toBeFocused();
  await expect(app.locator(".board.testing")).toBeVisible();
  await stop.click();
  await expect(button).toBeFocused();
  await app.keyboard.press("Tab");
  await expect(button).not.toBeFocused();
});

test("leaving the page stops the test", async ({ app }) => {
  await openSection(app, "Matrix tester");
  await app.getByRole("button", { name: "Start testing" }).click();
  await expect(app.getByRole("button", { name: "Stop testing" })).toBeVisible();
  await openSection(app, "Keymap");
  // keys work on the Keymap again: an arrow moves the selection
  const first = app.locator("button.key").first();
  await first.click();
  await app.keyboard.press("ArrowRight");
  await expect(first).not.toBeFocused();
  await openSection(app, "Matrix tester");
  await expect(app.getByRole("button", { name: "Start testing" })).toBeVisible();
});
```

- [ ] **Step 3: Reboot to bootloader**

Create `web/e2e/bootloader.spec.ts`:

```ts
import { api, expect, openSection, plugIn, restoreAll, screenshots, simulatorUnlock, test, unlockAgain } from "./fixtures";

// Reboot to bootloader on the simulated Corne, which drops off the bus when it jumps. The test plugs it back in.

test("the keyboard is unlocked, restarts into its bootloader and is shown gone until it comes back", async ({ app }) => {
  try {
    await simulatorUnlock(app, { locked: true });
    await openSection(app, "Keyboard");
    const reboot = app.getByRole("button", { name: "Reboot to bootloader…" });
    await reboot.click();
    const confirm = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await expect(confirm).toContainText("disappears from Vial until it is flashed, or unplugged and plugged back in");
    // the safe choice has the focus
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(reboot).toBeFocused();

    await reboot.click();
    await confirm.getByRole("button", { name: "Reboot" }).click();
    // locked: the unlock runs first, then the change is sent again
    const unlock = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(unlock).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    const banner = app.locator("#bootloader-banner");
    await expect(banner).toContainText("The keyboard is in its bootloader", { timeout: 20_000 });
    await expect(confirm).toBeHidden();
    await expect(banner).toBeFocused();
    await expect(app.locator(".page.blocked")).toBeVisible();
    const session = await (await api(app).get("/api/session")).json();
    expect(session.status).toBe("disconnected");
    await screenshots(app, "bootloader-gone-1280x800");

    // plugged back in: it is read again, and works
    await simulatorUnlock(app, { keysHeld: false });
    await plugIn(app, true);
    await expect(banner).toBeHidden({ timeout: 10_000 });
    await expect(app.locator(".page.blocked")).toHaveCount(0);
  } finally {
    await restoreAll(() => plugIn(app, true), () => simulatorUnlock(app, { keysHeld: false }), async () => {
      await expect.poll(async () => (await (await api(app).get("/api/session")).json()).status, { timeout: 10_000 })
        .toBe("connected");
    }, () => unlockAgain(app));
  }
});
```

- [ ] **Step 4: Type-check, then run the new tests, then all of them**

```bash
cd web && npm run check && npx playwright test e2e/layout.spec.ts e2e/matrix.spec.ts e2e/bootloader.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `6 passed`.

```bash
cd web && npx playwright test
```

Expected: `129 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/bootloader.spec.ts \
  web/e2e/layout.spec.ts \
  web/e2e/matrix.spec.ts
git commit -m "test(web): end-to-end tests for the Layout page, the matrix tester and reboot to bootloader"
```

### Task 19: The parity document, screenshots of the new pages, the README, and the final check

**The screenshot tests** (`p5b-pages.spec.ts`) open Lighting (VialRGB on the Corne, QMK RGB light and backlight on `qmkLighting`), Layout (the macropad), Matrix tester and Keyboard at 800 × 900, 1280 × 800, 2560 × 1440, 1920 × 950 and 375 × 812, in both themes: nothing scrolls sideways, the page is at most 860 px wide. At 1920 × 950 the matrix tester's drawing and grid fit the window while testing, and so does the reboot confirmation. Nothing in it changes the keyboard for good.

**`docs/parity.md`:** every Qt tab, the keyboard list, every menu item and every dialog, with where it lives in the web UI, or why it is dropped or comes later. Each claim was checked in the code.

**The README:** a link to `docs/parity.md`, `--lighting`, the plug-in and matrix hooks, the new specs and folders.

**Files:**
- Test: `web/e2e/p5b-pages.spec.ts` (new)
- Create: `docs/parity.md`
- Modify: `web/README.md`

- [ ] **Step 1: The screenshot tests**

Create `web/e2e/p5b-pages.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect, openSection, pressKey, restoreAll, screenshots, test } from "./fixtures";

// The Lighting, Layout and Matrix tester pages, and the Keyboard page's reboot, at every window size and in both
// themes: no sideways scroll, at most 860 px wide, dialogs inside a 1080p window. Nothing here changes the keyboard.

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const SIZES = [[800, 900], [1280, 800], [2560, 1440], [1920, 950], [375, 812]] as const;

async function check(page: Page, name: string, shot: string) {
  await openSection(page, name);
  expect(await sidewaysScroll(page), name).toBeLessThanOrEqual(0);
  const box = (await page.locator(".page.list").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(860);
  await screenshots(page, shot, { fullPage: true });
}

// one keyboard per test: the fixtures' pages are one and the same page
for (const [width, height] of SIZES) {
  test(`${width} x ${height}: Lighting (VialRGB), Matrix tester and Keyboard on the Corne`, async ({ app }) => {
    await app.setViewportSize({ width, height });
    await check(app, "Lighting", `lighting-vialrgb-${width}x${height}`);
    await check(app, "Matrix tester", `matrix-${width}x${height}`);
    await check(app, "Keyboard", `keyboard-${width}x${height}`);
  });

  test(`${width} x ${height}: Lighting (QMK RGB light and backlight)`, async ({ qmkLighting }) => {
    await qmkLighting.setViewportSize({ width, height });
    await check(qmkLighting, "Lighting", `lighting-qmk-${width}x${height}`);
  });

  test(`${width} x ${height}: Layout on the macropad`, async ({ macropad }) => {
    await macropad.setViewportSize({ width, height });
    await check(macropad, "Layout", `layout-${width}x${height}`);
  });
}

test("1920 x 950: the matrix tester while testing, and the reboot confirmation, fit the window", async ({ app }) => {
  await app.setViewportSize({ width: 1920, height: 950 });
  try {
    await openSection(app, "Matrix tester");
    await app.getByRole("button", { name: "Start testing" }).click();
    await pressKey(app, 0, 1);
    await pressKey(app, 2, 2);
    await expect(app.locator(".board .key.pressed")).toHaveCount(2);
    await pressKey(app, 2, 2, false);
    await pressKey(app, 3, 0);
    await expect(app.locator(".board .key.pressed")).toHaveCount(1);
    // the drawing and the switch matrix together in one window
    const grid = (await app.locator("table").boundingBox())!;
    expect(grid.y + grid.height).toBeLessThanOrEqual(950 + (await app.evaluate(() => window.scrollY)));
    await screenshots(app, "matrix-testing-1920x950", { fullPage: true });
    await app.getByRole("button", { name: "Stop testing" }).click();

    await openSection(app, "Keyboard");
    await app.getByRole("button", { name: "Reboot to bootloader…" }).click();
    const dialog = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(950);
    await screenshots(app, "bootloader-confirm-1920x950");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await restoreAll(() => pressKey(app, 0, 1, false), () => pressKey(app, 2, 2, false), () => pressKey(app, 3, 0, false));
  }
});
```

```bash
cd web && npx playwright test e2e/p5b-pages.spec.ts
```

Expected: `16 passed`.

- [ ] **Step 2: The parity document**

Create `docs/parity.md`:

```markdown
# Parity with the Qt app

Every tab, menu and dialog of the Qt app (`src/main/python/main_window.py`, `editor/`, `unlocker.py`,
`about_keyboard.py`) and where it lives in the web UI (`web/src/`), or why it is left out. Phase 5's contract: once
phase 5b is done, the web UI does all of this except what is marked **dropped** or **later**. Checked against the code
on 2026-10-19.

Addresses are the web UI's (`#lighting`); a section the keyboard's firmware doesn't have is left out of the
navigation, as Qt hides the tabs whose `valid()` is false.

## Tabs

| Qt tab | Web UI | Notes |
|---|---|---|
| Keymap (`keymap_editor.py`, keycode tray `tabbed_keycodes.py`) | Keymap, `#keymap` (`keymap/KeymapPage.svelte`, `picker/Picker.svelte`) | Layer tabs, the Inspector, the keycode picker with search and "any keycode". Qt's +/- size buttons: the drawing scales to the window instead. The Overview view is new. |
| Layout (`layout_editor.py`) | Layout, `#layout` (`layout/LayoutPage.svelte`) | On/off options as switches, lists of choices as lists; saved at once (`PUT /api/layout-options`; via.c keeps them in its EEPROM). Every drawing of the keyboard follows. |
| Macros (`macro_recorder.py`) | Macros, `#macros` (`behaviours/MacrosPage.svelte`, `MacroEditor.svelte`) | Steps as a chain, recording keys typed in the page (Qt's recorder on Windows and Linux records system-wide; the page records what the browser lets it see, and says so). Memory bar. |
| Lighting (`rgb_configurator.py`) | Lighting, `#lighting` (`lighting/LightingPage.svelte`) | VialRGB, QMK RGB light and backlight, only what the keyboard has; effects by Qt's names. Changes show at once and are kept once saved, as Qt's Save does (`POST /api/lighting/save`). QMK RGB light's speed isn't shown, as in Qt: no RGB light effect of vial-qmk uses it. |
| Tap Dance (`tap_dance.py`) | Tap dance, `#tap-dance` | |
| Combos (`combos.py`) | Combos, `#combos` | |
| Key Overrides (`key_override.py`) | Key overrides, `#key-overrides` | Option bits follow the firmware (vial.h); Qt's labels of bits 4 and 5 are swapped. |
| Alt Repeat Key (`alt_repeat_key.py`) | Alt-repeat, `#alt-repeat` | |
| QMK Settings (`qmk_settings.py`) | Settings, `#settings` (`settings/SettingsPage.svelte`) | Grouped as Qt's tabs; Save/Undo; Reset to defaults with a confirmation. |
| Matrix tester (`matrix_test.py`) | Matrix tester, `#matrix` (`matrix/MatrixPage.svelte`) | Shown when Qt's would be (Vial protocol 3+, a matrix that fits one reply: `server/device.py has_matrix_tester`). Start testing unlocks first, as Qt's Unlock button; keys pressed do nothing on the page meanwhile, as Qt grabs the keyboard. The switch matrix grid (positions without a key) and Reset are there too. |
| Firmware updater (`firmware_flasher.py`) | **Later** (phase 7) | The roadmap's optional phase 7. Qt shows it only for keyboards with Vial's own bootloader (`vibl`). Reboot to bootloader (below) is there for flashing with another tool. |

## Above the tabs

| Qt | Web UI | Notes |
|---|---|---|
| Keyboard list and Refresh | **Dropped for now**: the first Vial keyboard found is used | Hot-plug is automatic (`DeviceManager.check`), so Refresh isn't needed. Choosing among several Vial keyboards plugged in at once isn't built: the owner has one. It would need a keyboard list in the session and a route to pick one. |
| "No devices detected", the Linux udev hint | The "No keyboard found" page (`App.svelte`), with the udev link | |

## Menus

| Qt menu item | Web UI | Notes |
|---|---|---|
| File > Load saved layout… (Ctrl+O) | Keyboard page, Load layout… (`about/LayoutFileCard.svelte`) | Shows what changes before anything is written. A file saved from another keyboard is refused (Qt asks whether to load it anyway). |
| File > Save current layout… (Ctrl+S) | Keyboard page, Save layout | Downloads `<keyboard name>.vil`. |
| File > Sideload VIA JSON… | **Dropped** | Roadmap decision 5: VIA-only keyboards aren't supported (the server only finds Vial keyboards). |
| File > Download VIA definitions | **Dropped** | Same decision. |
| File > Load dummy JSON… | **Dropped** | A developer tool; `vial_web.py --fake --definition FILE` simulates a keyboard from its `vial.json` instead. |
| File > Exit (Ctrl+Q) | Ctrl+C in Vial's terminal | Closing the tab leaves Vial running (it prints the link to reopen it). |
| Keyboard layout (QWERTY, AZERTY, …) | Top bar, Keyboard language (`shell/TopBar.svelte`) | Remembered in the browser. |
| Security > Unlock (Ctrl+U) | Top bar, the Locked/Unlocked control; the unlock dialog (`shell/UnlockDialog.svelte`) | A change the firmware refuses while locked starts the unlock too, then is sent again. |
| Security > Lock (Ctrl+L) | Top bar, the Locked/Unlocked control | |
| Security > Reboot to bootloader (Ctrl+B) | Keyboard page, Reboot to bootloader… (`about/BootloaderCard.svelte`) | With a confirmation; unlocks first, as Qt does; then a banner says the keyboard is in its bootloader. A firmware built without the jump (VIAL_INSECURE) says so instead. |
| Theme (System, Light, Dark, Arc, Nord, …) | Top bar, System / Light / Dark | **Dropped**: Qt's other colour themes. |
| About > About *keyboard*… (`about_keyboard.py`) | Keyboard page, About this keyboard (`about/AboutCard.svelte`) | |
| About > About Vial… | **Later** (phase 6) | Vial's version comes with the packaging. |

The menus' keyboard shortcuts aren't kept: in a browser, Ctrl+O, Ctrl+S and Ctrl+Q are the browser's.

## Dialogs and messages

| Qt | Web UI | Notes |
|---|---|---|
| Unlocker | Unlock dialog | Same protocol (`DeviceManager.start_unlock`, `poll_unlock`, polled every 200 ms). |
| An unlock left unfinished, found when connecting | Finished first, as Qt does; the page says the keyboard waits to be unlocked | `DeviceManager._connect` |
| Any keycode dialog (`any_keycode_dialog.py`) | The picker's "any keycode" entry (`picker/AnyKeycode.svelte`) | |
| "Unsupported protocol version!" | "A keyboard was found, but couldn't be read", with the protocols | `keyboard_comm.check_protocol_version` |
| "An example keyboard UID was detected" | **Dropped** | A warning for keyboard makers shipping firmware; no user can act on it. |
| "Restart to apply the theme" | Not needed | The web UI changes theme at once. |
```

- [ ] **Step 3: The README**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -3,6 +3,8 @@
 Svelte 5 (runes only) + TypeScript, built with Vite. `npm run build` writes `web/dist`, which
 `vial_web.py` serves; without `dist` it shows a placeholder page.
 
+Where each tab, menu and dialog of the Qt app lives here, or why it is left out: `docs/parity.md`.
+
 ## Setup
 
 Node 24 and npm 11. Every dependency is pinned to an exact version (`.npmrc` has `save-exact`).
@@ -31,7 +33,9 @@ python vial_web.py --fake        # open the printed link; reload the page after
 `--fake` runs a simulated keyboard and never touches real hardware. Add `--data-dir DIR` to keep
 its lock, log and names out of your user folders. With `--fake`, `--layers N` (1 to 32) gives the
 simulated keyboard N layers (the sample keymap fills the first four, the others are empty),
-`--definition FILE` simulates another keyboard, and `--layout FILE` loads a `.vil` layout into it.
+`--definition FILE` simulates another keyboard, `--layout FILE` loads a `.vil` layout into it, and
+`--lighting KIND` gives it other lighting (`none`, `qmk_backlight`, `qmk_rgblight`,
+`qmk_backlight_rgblight` or `vialrgb`; the sample Corne has VialRGB).
 
 The simulated Corne starts unlocked, as nobody can hold its keys. Its unlock keys are the outermost
 keys of both top rows (Tab and Backspace). A fake server has test hooks for the e2e tests, which
@@ -43,7 +47,10 @@ exist for no real keyboard and are left out of the OpenAPI schema (so of `schema
   (`POST /api/unlock/start`, or Unlock in the UI). It answers an error until the simulated keyboard
   has first been looked for.
 - `PUT /api/simulator/connection` with `{"connected": false}` (or `true`) unplugs the keyboard
-  (or plugs it back in).
+  (or plugs it back in). Plugged in again, it starts with the lighting it last saved, and out of its
+  bootloader, as a real keyboard does.
+- `PUT /api/simulator/matrix` with `{"row": 0, "col": 1, "pressed": true}` (or `false`) presses a key
+  of its matrix (or lets go of it): the matrix tester shows it.
 
 `--fake` keeps the firmware's unlock timing: the countdown (50 steps) only goes down on a poll that
 comes more than 100 ms after the start or the last step (a sooner one starts it over), and the
@@ -72,8 +79,9 @@ CI runs `npm run check:api`.
 ## End-to-end tests
 
 `e2e/servers.ts` starts `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
-default Corne; `e2e/fixtures/macropad.vial.json` with encoders; and the Corne with `--layers 8`, as the
-owner's keyboard has), reads the links with the session token from their output and stops them. Each
+default Corne, with VialRGB; `e2e/fixtures/macropad.vial.json` with encoders, a layout option and no
+lighting; the Corne with `--layers 8`, as the owner's keyboard has; and the Corne with
+`--lighting qmk_backlight_rgblight`), reads the links with the session token from their output and stops them. Each
 Playwright worker starts the ones its tests use (fixtures in `e2e/fixtures.ts`) and stops them when it ends. Screenshots, each in the
 light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed); a
 full-page one is taken from the top, with the sticky top bar and macro editor footer drawn where they are in the
@@ -92,6 +100,11 @@ page.
 | `layoutfile` | Saving the layout, loading it back with its preview; another keyboard's file and a broken one; a file with macros on a locked keyboard |
 | `feature-pages` | The Key overrides, Alt-repeat, Settings and Keyboard pages at four window sizes and at 375 px, their editors and dialogs in a 1080p window |
 | `navigation` | The address and the back button, page titles, the focus, what the Keymap keeps while another page shows |
+| `lighting` | The Lighting page: VialRGB, QMK RGB light and backlight changed, undone and saved (a replug tells what was kept), a slider dragged, a keyboard without lighting |
+| `layout` | The Layout page on the macropad: an option changed, every drawing following |
+| `matrix` | The matrix tester: unlocking first, keys pressed through the test hook, keys typed doing nothing meanwhile |
+| `bootloader` | Reboot to bootloader: the confirmation, the unlock, the keyboard shown gone and back |
+| `p5b-pages` | The Lighting, Layout, Matrix tester and Keyboard pages at five window sizes, in both themes |
 
 The tests run in parallel: half the cores by default, or `E2E_WORKERS=<n> npx playwright test`
 (`E2E_WORKERS=1` runs them one after another). A worker runs its tests one at a time on its own servers,
@@ -108,13 +121,16 @@ development machine, so no browser is downloaded there. CI installs that Chromiu
 | Folder | What |
 |---|---|
 | `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
-| `src/lib/` | The keyboard store (loaded model, connection, edits), unlocking, the section shown (the address's `#combos/2`), toasts, and the theme (System, Light, Dark) |
-| `src/keyboard/` | Drawing any keyboard from its geometry; key labels; combo marks on keys (`marks.ts`: underlines and dots) |
+| `src/lib/` | The keyboard store (loaded model, connection, edits, the keys held for the matrix tester), unlocking, keys doing nothing on the page (`keyGuard.ts`), the section shown (the address's `#combos/2`), toasts, and the theme (System, Light, Dark) |
+| `src/keyboard/` | Drawing any keyboard from its geometry (and the layout options' choices, `geometry.ts`); key labels; combo marks on keys (`marks.ts`: underlines and dots) |
+| `src/layout/` | The Layout page: the keyboard's layout options |
+| `src/lighting/` | The Lighting page: effects by name, colours, changes sent without flooding the keyboard (`writer.ts`), Save and Undo |
+| `src/matrix/` | The Matrix tester page: the keys held and pressed, the switch matrix |
 | `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo marks and colours (`comboMarksOn`, `comboColours`), tap dance and macro usage, finding a character or key, and the phrases for them |
 | `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, moving a key onto another (a drag and its drop menu, or Copy and Swap in the Inspector), layer cards, find box; what the page keeps while another one shows (`state.svelte.ts`) |
 | `src/behaviours/` | The Tap dance, Combos, Macros, Key overrides and Alt-repeat pages: their cards and editors, the combo key chooser, the macro step editor and recorder, the modifier, layer and option controls, and the plain-language sentences |
 | `src/settings/` | The QMK settings form (Settings): the groups `qmk_settings.json` defines, what changed, Save, Undo and Reset; what the page keeps while another one shows (`state.svelte.ts`) |
-| `src/about/` | The Keyboard page: what the keyboard is (Qt's About keyboard), and saving and loading `.vil` layout files with a preview of what changes |
+| `src/about/` | The Keyboard page: what the keyboard is (Qt's About keyboard), saving and loading `.vil` layout files with a preview of what changes, and reboot to bootloader |
 | `src/picker/` | Keycode picker: search, categories, any-keycode entry |
 | `src/shell/` | Top bar (with the Lock/Unlock control), navigation, banners, toasts, the unlock dialog |
-| `src/ui/` | Small shared controls (a switch), the name dialog (layers, tap dances, macros) and a confirmation dialog |
+| `src/ui/` | Small shared controls (a switch, a list, a slider, the Save bar), the name dialog (layers, tap dances, macros) and a confirmation dialog |
```

- [ ] **Step 4: Run every check**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `905 passed, 1 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  45 passed (45)` and `Tests  706 passed (706)` and `built in` and `src/api/schema.d.ts is up to date`.

- [ ] **Step 5: Commit**

```bash
git add docs/parity.md \
  web/README.md \
  web/e2e/p5b-pages.spec.ts
git commit -m "docs: parity with the Qt app, screenshots of the phase 5b pages, and the README"
```

- [ ] **Step 6 (final): The whole e2e suite, with the screenshots copied for review.** `screenshots/` is excluded from git through `.git/info/exclude` (pattern `/screenshots/`). Run this from the main working tree, or replace `/t/others/vial-gui` with its path.

```bash
cd web && npm run e2e && rm -rf /t/others/vial-gui/screenshots/phase5b && mkdir -p /t/others/vial-gui/screenshots/phase5b && cp e2e/screenshots/lighting-* e2e/screenshots/layout-* e2e/screenshots/matrix-* e2e/screenshots/keyboard-* e2e/screenshots/bootloader-* /t/others/vial-gui/screenshots/phase5b/ && echo "$(ls /t/others/vial-gui/screenshots/phase5b | wc -l) screenshots copied" && git -C /t/others/vial-gui check-ignore screenshots/phase5b/matrix-1280x800-light.png
```

Expected: `145 passed` and `60 screenshots copied` and `screenshots/phase5b/matrix-1280x800-light.png`.

Look at the new screenshots, each in `-light` and `-dark`:
- **The pages:** `lighting-vialrgb-`, `lighting-qmk-`, `layout-`, `matrix-` and `keyboard-` at `800x900`, `1280x800`, `2560x1440`, `1920x950` and `375x812`:
  - at most 860 px wide and centred, the navigation wrapped where it must;
  - the Lighting cards: the effect list, the colour picker's swatch and painted sliders, the notes in plain text, the Save bar at the bottom;
  - the Layout page: the options first, then the drawing with the options' keys ringed;
  - the Matrix tester: the drawing in plain tones, the grid below it;
  - the Keyboard page's last card, Reboot to bootloader, with the danger border;
  - nothing off the bottom at 1920x950, nothing sideways at 375.
- **While testing and the dialogs:** `matrix-testing-1920x950` (two keys held, one pressed before, a position with no key held), `bootloader-confirm-1920x950` (inside the window, Cancel focused), `bootloader-gone-1280x800` (the banner).

Then hand over to the owner checklist above.

## Roadmap coverage

| Roadmap phase 5 item (5b part), and the prototype brief's scope | Task |
|---|---|
| Lighting page: VialRGB, QMK RGB light and backlight, only the parts the keyboard has | 1 (the simulator), 2, 11, 12, 16; e2e in 17 |
| Effect lists by Qt's names, speed, brightness, a colour picker with a swatch; brightness capped at VialRGB's maximum | 11, 12; e2e in 17 |
| Changes shown live; kept as Qt keeps them, and the page says so | 2, 7, 12; e2e in 17 |
| Busy handling (aria-disabled, focus kept); a dragged slider doesn't flood the keyboard, the last value wins | 11 (`LatestWriter`), 12; e2e in 17 |
| Layout options edited, every drawing updating live; saved at once, and the page says so | 7, 8, 13, 16; e2e in 18 |
| Matrix tester backend: a WebSocket subscription polling under the device lock at about 20 Hz while subscribed, stopping when none is, paced, not starving other requests, unlock first | 3, 4, 7; pytest in 3 and 4 |
| Fake-only key press hook, outside the schema | 4; used in 18 and 19 |
| Matrix tester UI: keys lit while held, marked once pressed, Reset, positions with no key shown, keys typed doing nothing while testing | 9, 10, 14, 16; e2e in 18 |
| Reboot to bootloader: on the Keyboard page, a confirmation saying what happens, unlock first, 423 while locked, the keyboard shown gone | 5, 7, 15, 16; e2e in 18 |
| Parity check: every Qt tab, menu and dialog, where it lives or why it is dropped | 19 (`docs/parity.md`); the gaps it found fixed in 6 |
| Navigation: new entries with titles and hash routes, hidden when the firmware lacks the feature | 8, 16; e2e in 17 and 18 |
| Store methods through `#edit` (pending, busy, 423 → unlock → retry) | 7 |
| `schema.d.ts` regenerated with each schema change | 2, 3, 4, 5 |
| Owner's rules: widths (860 px), 1920 × 950, 800 and 375 px, Firefox-safe CSS, both themes | 10 (the slider), 12–15, 19 |
| Owner feedback: a visible border on what is edited, each page says how saving works, sentences true for vial-qmk, the simulator mirrors the firmware | 1, 2, 12, 13, 14, 15 |

## Self-review

- **Spec coverage:** every 5b item of the roadmap's phase 5 scope and of the prototype brief maps to a task in the table above. The brief's tests are there: pytest for the matrix subscription (start, stop, pacing, locked, unplugged, a failed reading), the fake hook, the bootloader route and the lighting kept only when saved (Tasks 2 to 5); Vitest for effects, colours, patches, the throttling, the matrix state, the layout options, the key guard and the routes (Tasks 7 to 14); e2e for each page and the screenshots at every size in both themes (Tasks 17 to 19).
- **Placeholder scan:** every code step gives the complete file or an exact diff. Every command has its expected output. Nothing is left to be filled in later. The deferred items are listed under "Out of scope / later phases" and are simply not built.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `LIGHTING`, `definition(lighting)`, `make_corne(lighting=…)` and `LIGHTING_KINDS` (Task 1) by Tasks 2 and 17; `VirtualKeyboard`'s `lighting_saved`, `lighting_now()`, `backlight_levels`, `backlight_breathing` and `bootloader_jump` (Task 1) by Tasks 2 and 5; `plug_in()` and `lighting_kept` (Task 2) by `FakeBackend.set_connected` (Task 2);
  - `CMD_VIA_BOOTLOADER_JUMP` and `VIA_ID_UNHANDLED` (Task 1) by Task 5;
  - `edits.save_lighting` and `POST /api/lighting/save` (Task 2) by `api.saveLighting` (Task 7);
  - `has_matrix_tester`, `matrix_pressed`, `MatrixReading`, `DeviceManager.poll_matrix` and `KeyboardModel.matrixTester` (Task 3) by Tasks 4, 14 and 16;
  - `MatrixWatcher`, `MATRIX_POLL_INTERVAL`, `MATRIX_POLL_GAP`, `create_app(…, matrix_interval, matrix_gap)`, `MatrixState`, `SimulatorPress` and `PUT /api/simulator/matrix` (Task 4) by Tasks 7 (the types and the store) and 17 to 19 (`pressKey`); `EventsLink` and `ClientMessage` (Task 4) by Task 7;
  - `DeviceManager.reboot_to_bootloader` and `POST /api/bootloader` (Task 5) by `api.rebootToBootloader` (Task 7);
  - `api.setLayoutOptions`, `setLighting`, `saveLighting` and `rebootToBootloader`, the types `MatrixState`, `Lighting`, `LightingIn`, `VialRgb`, `RgbLight` and `Backlight`, and the store's `setLayoutOptions`, `setLighting`, `saveLighting`, `rebootToBootloader`, `inBootloader`, `watchMatrix` and `matrix` (Task 7) by Tasks 11 to 16;
  - the `SectionId`s `layout`, `lighting` and `matrix`, `choiceCount`, `withLayoutChoice` and `layerFaces` (Task 8) by Tasks 13, 14 and 16;
  - `KeyGuard` (Task 9) by the unlock dialog (Task 9) and the Matrix tester (Task 14);
  - `SaveBar`, `SelectField`, `Slider`, `Key`'s and `Keyboard`'s `pressed`, and `Banner`'s `id` (Task 10) by Tasks 12 to 16;
  - `VIALRGB_EFFECTS`, `RGBLIGHT_EFFECTS`, `vialRgbChoices`, `rgbLightChoices`, `vialRgbNote`, `rgbLightNote`, the colour functions, `LightingPatch`, `mergePatch`, `withPatch`, `patchRequest`, `sameLighting`, `restorePatch`, `lightingKinds`, `hasLighting`, `LatestWriter` and `lightingBaseline` (Task 11) by Tasks 12 and 16;
  - `optionRows` and `OptionRow` (Task 13); `positionId`, `layoutPositions`, `withPressed`, `matrixCells`, `MatrixCell`, `testSummary`, `summaryText` and `matrixTest` (Task 14);
  - `LightingPage`, `LayoutPage` and `MatrixPage` (Tasks 12 to 14) by Task 16, and `BootloaderCard` (Task 15) by the Keyboard page (Task 15); the banner's id `bootloader-banner` (Task 16) by `BootloaderCard` (Task 15) and the e2e test (Task 18);
  - the fixtures `qmkLighting`, `lightingOf`, `setLighting`, `pressKey` and `plugIn` (Task 17) by Tasks 17, 18 and 19.
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase5b` at `a7a73f3`). The plan was replayed mechanically from `main` and the result compared with it.
