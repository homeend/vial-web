# Vial web UI

Svelte 5 (runes only) + TypeScript, built with Vite. `npm run build` writes `web/dist`, which
`vial_web.py` serves (and `vial.spec` bundles into the executable); without `dist`, `vial_web.py` says how to build
it and shows a placeholder page.

Where each tab, menu and dialog of the Qt app (removed in phase 6) lives here, or why it is left out:
`docs/parity.md`.

## Setup

Node 24 and npm 11. Every dependency is pinned to an exact version (`.npmrc` has `save-exact`).

```sh
cd web
npm ci
```

The scripts that run server code (`gen:api`, `check:api`, `e2e`) need the repository's Python
virtual environment (`.venv` or `venv` at the repository root, with `requirements.txt`
installed), or a Python named by `VIAL_PYTHON`.

## Developing

The server only answers its own origin (it checks `Host` and `Origin` and wants its session
cookie), so the UI is not served by Vite's dev server. Instead, rebuild on every change and let
Vial serve the result:

```sh
npm run dev                      # vite build --watch: rewrites web/dist on every change
# in another terminal, from src/main/python:
python vial_web.py --fake        # open the printed link; reload the page after a rebuild
```

`--fake` runs a simulated keyboard and never touches real hardware. Add `--data-dir DIR` to keep
its lock, log and names out of your user folders. With `--fake`, `--layers N` (1 to 32) gives the
simulated keyboard N layers (the sample keymap fills the first four, the others are empty),
`--definition FILE` simulates another keyboard, `--layout FILE` loads a `.vil` layout into it, and
`--lighting KIND` gives it other lighting (`none`, `qmk_backlight`, `qmk_rgblight`,
`qmk_backlight_rgblight` or `vialrgb`; the sample Corne has VialRGB). A fake server also has a
second simulated keyboard, unplugged until a test hook plugs it in (below): by default one like the
first, or the keyboard of `--second-definition FILE`. Each simulated keyboard has a serial number of
its own, so the keyboard selector remembers the choice across a replug as it does for real ones.

The simulated Corne starts unlocked, as nobody can hold its keys. Its unlock keys are the outermost
keys of both top rows (Tab and Backspace). A fake server has test hooks for the e2e tests, which
exist for no real keyboard and are left out of the OpenAPI schema (so of `schema.d.ts`):

- `PUT /api/simulator/unlock` with `{"locked": true}` locks the keyboard, as plugging it in
  again would, and sends an `unlock` event so the UI follows. `{"keysHeld": true}` (or `false`)
  holds its unlock keys down (or lets go). Held keys do nothing until an unlock is started
  (`POST /api/unlock/start`, or Unlock in the UI). It answers an error until the simulated keyboard
  has first been looked for.
- `PUT /api/simulator/connection` with `{"connected": false}` (or `true`) unplugs the keyboard
  (or plugs it back in). Plugged in again, it starts with the lighting it last saved, and out of its
  bootloader, as a real keyboard does.
- `PUT /api/simulator/matrix` with `{"row": 0, "col": 1, "pressed": true}` (or `false`) presses a key
  of its matrix (or lets go of it): the matrix tester shows it.
- `PUT /api/simulator/second-keyboard` with `{"connected": true}` (or `false`) plugs the second
  simulated keyboard in (or unplugs it); the top bar then shows the keyboard selector.
  `{"connected": true, "unreadable": true}` plugs it in with firmware this Vial can't read (a newer
  Vial protocol): it is listed, and fails to load until it is plugged in again without that.

The unlock, connection and matrix hooks act on the first simulated keyboard.

`--fake` keeps the firmware's unlock timing: the countdown (50 steps) only goes down on a poll that
comes more than 100 ms after the start or the last step (a sooner one starts it over), and the
server polls every 200 ms, so an unlock with the keys held takes about 10 s. `--unlock-counter N` (1 to 255)
starts the countdown at N instead, as firmware built with another `VIAL_UNLOCK_COUNTER_MAX` does.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Build into `dist/` |
| `npm run dev` | Build, then rebuild on every change |
| `npm run check` | `svelte-check` (types, Svelte 5 runes-only syntax; fails on warnings), then `tsc` for the configs, e2e tests and scripts |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run e2e` | Build, then run the Playwright tests (`e2e/`) against `vial_web.py --fake` (or the executable `$E2E_VIAL_CMD` names) |
| `npm run gen:api` | Regenerate `src/api/schema.d.ts` from the server's OpenAPI schema |
| `npm run check:api` | Fail if `src/api/schema.d.ts` is out of date |

## API types

`src/api/schema.d.ts` is generated: `npm run gen:api` runs `python -m server.dump_openapi`
(which builds the app around a never-connected simulator and writes its OpenAPI schema) and
`openapi-typescript` on the result. Regenerate and commit it whenever the server's schemas change;
CI runs `npm run check:api`.

## End-to-end tests

`e2e/servers.ts` starts `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
default Corne, with VialRGB; `e2e/fixtures/macropad.vial.json` with encoders, a layout option and no
lighting; the Corne with `--layers 8`, as the owner's keyboard has; the Corne with
`--lighting qmk_backlight_rgblight`; and the Corne with the macropad as its second keyboard,
`--second-definition`), reads the links with the session token from their output, and at the end asks each to quit
(`POST /api/shutdown`, as Quit Vial does; one that takes it and doesn't exit within 5 s fails the run), ending it
only if it can't be asked. Each Playwright worker starts the ones its tests use (fixtures in `e2e/fixtures.ts`) and
stops them when it ends; a test that ends its server (Quit Vial) gets one of its own (`ownServer`).

`E2E_VIAL_CMD=dist/Vial.exe npx playwright test` runs the same tests against a built executable (a path relative to
the repository, or absolute) instead of `python vial_web.py`, with the same arguments; CI does so on Windows and
Linux. Screenshots, each in the
light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed); a
full-page one is taken from the top, with the sticky top bar and macro editor footer drawn where they are in the
page.

| Spec | What it tests |
|---|---|
| `keymap`, `find`, `overview`, `display`, `theme` | The Keymap's Edit and Overview views, the find box, sizes and fonts, the theme |
| `move` | Dragging a key onto another with the mouse (Replace, Swap both, Undo, Esc), the Inspector's Copy and Swap without a mouse, the drop menu in a 1080p window |
| `macropad` | Another keyboard: encoders, rotated keys, an ISO Enter, a decal, a layout option |
| `behaviours` | The Tap dance, Combos and Macros pages end to end, the top bar's Lock/Unlock, the pages at four window sizes and at 375 px |
| `tapdance`, `combos`, `macros` | Editing on those pages: where the focus goes, saves that are slow or fail, recording keys (adding to the end, or replacing the steps: undone by Cancel); removing a macro: at once when nothing uses it, else asked first, Cancel keeping it |
| `macro-text` | The macro text editor: Qt's JSON shown, Esc and Cancel changing nothing, what can't be read said and not applied, Apply then the page's Save, a `.vim` file saved and loaded; steps not finished going and coming as text; a text too long refused before it is sent; a text being applied dropped when the dialog closes; Ctrl+S on a layout whose letters aren't Latin; the dialog and the record buttons at 1920 and 375 px |
| `unlock` | The unlock dialog |
| `quit` | Quit Vial: every tab showing that Vial stopped (the heading taking the focus) and reconnecting no more, the server exiting by itself; asked first with work not saved (Cancel keeping Vial running); the button and the stopped page from 375 px to 1080p, in both themes |
| `overrides` | The Key overrides and Alt-repeat pages: a new key override built and saved, switched off, removed; an alt-repeat key edited |
| `settings` | The QMK settings form: a change undone, a number out of range, Save, Reset to defaults with its confirmation |
| `layoutfile` | Saving the layout, loading it back with its preview; another keyboard's file and a broken one; a file with macros on a locked keyboard |
| `feature-pages` | The Key overrides, Alt-repeat, Settings and Keyboard pages at four window sizes and at 375 px, their editors and dialogs in a 1080p window |
| `navigation` | The address and the back button, page titles, the focus, what the Keymap keeps while another page shows |
| `lighting` | The Lighting page: VialRGB, QMK RGB light and backlight changed, undone and saved (a replug tells what was kept), backlight breathing kept at once without a Save, a slider dragged, a keyboard without lighting having no Lighting page, and no Lighting category or lighting keys in its keycode picker (Any keycode still taking one) |
| `layout` | The Layout page on the macropad: an option changed, every drawing following; a change the keyboard didn't take putting the switch back, keeping the focus; a keyboard without layout options having no Layout page |
| `matrix` | The matrix tester: unlocking first, keys pressed through the test hook, keys typed doing nothing meanwhile; the test stopping when the page is left, the keyboard is unplugged, the window loses the focus or the tab is hidden |
| `bootloader` | Reboot to bootloader: the confirmation (Cancel and Esc send nothing), the unlock, the jump sent to the keyboard once, the keyboard shown gone and back (no Keyboard unplugged banner meanwhile); a cancelled unlock sending nothing more, and a firmware without the bootloader jump, closing the confirmation; a reboot not answered shown as most likely done; the focus when the keyboard goes while the confirmation is open |
| `bootloader-focus` | The focus going to the page heading when the bootloader banner goes |
| `p5b-pages` | The Lighting, Layout, Matrix tester and Keyboard pages at five window sizes, in both themes |
| `keyboards` | The keyboard selector (`PUT /api/simulator/second-keyboard`): none with one keyboard; switching to the second and back, the selector going when it is unplugged; work not saved asked about first (Cancel keeps the keyboard); the chosen keyboard unplugged, unreadable and back; another keyboard opened in place of one unplugged, without the page shown (the Keymap's heading takes the focus); the empty page's error appearing and clearing (in a live region, pointing to get.vial.today for a newer protocol); the top bar at 1920 and 375 px; the About card's USB device (Qt's About keyboard), following the keyboard shown, and a long device path cut short, over lines at 375 px |

The tests run in parallel: half the cores by default, or `E2E_WORKERS=<n> npx playwright test`
(`E2E_WORKERS=1` runs them one after another). A worker runs its tests one at a time on its own servers,
so tests running at the same time never share a keyboard; each test puts back what it changed. The
tests that unlock the keyboard keep the firmware's timing with a short countdown
(`--unlock-counter 10`): about 2 s each.

`@playwright/test` is pinned to the version whose Chromium is already installed on the
development machine, so no browser is downloaded there. CI installs that Chromium with
`npx playwright install --with-deps chromium`.

## Layout

| Folder | What |
|---|---|
| `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
| `src/lib/` | The keyboard store (loaded model, connection, edits, the keys held for the matrix tester, switching keyboards), the keyboard selector's choices and why a keyboard can't be read (`keyboards.ts`), the work not saved that switching asks about (`unsaved.ts`), unlocking, keys doing nothing on the page (`keyGuard.ts`), the section shown (the address's `#combos/2`), toasts, sentence helpers (`text.ts`), and the theme (System, Light, Dark) |
| `src/keyboard/` | Drawing any keyboard from its geometry (and the layout options' choices, `geometry.ts`); key labels; combo marks on keys (`marks.ts`: underlines and dots) |
| `src/layout/` | The Layout page: the keyboard's layout options |
| `src/lighting/` | The Lighting page: effects by name, colours, changes sent without flooding the keyboard (`writer.ts`), Save and Undo |
| `src/matrix/` | The Matrix tester page: the keys held and pressed, the switch matrix |
| `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo marks and colours (`comboMarksOn`, `comboColours`), tap dance and macro usage, finding a character or key, and the phrases for them |
| `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, moving a key onto another (a drag and its drop menu, or Copy and Swap in the Inspector), layer cards, find box; what the page keeps while another one shows (`state.svelte.ts`) |
| `src/behaviours/` | The Tap dance, Combos, Macros, Key overrides and Alt-repeat pages: their cards and editors, the combo key chooser, the macro step editor, recorder and text editor (Qt's JSON), the modifier, layer and option controls, and the plain-language sentences |
| `src/settings/` | The QMK settings form (Settings): the groups `qmk_settings.json` defines, what changed, Save, Undo and Reset; what the page keeps while another one shows (`state.svelte.ts`) |
| `src/about/` | The Keyboard page: what the keyboard is (Qt's About keyboard), saving and loading `.vil` layout files with a preview of what changes, and reboot to bootloader |
| `src/picker/` | Keycode picker: search, categories (no Lighting category on a keyboard without lighting, `offered.ts`), any-keycode entry |
| `src/shell/` | Top bar (with the keyboard selector, shown while there is more than one keyboard to choose from, the Lock/Unlock control and Quit Vial), navigation, banners, toasts, the unlock dialog, the page shown once Vial has stopped |
| `src/ui/` | Small shared controls (a switch, a list, a slider, the Save bar), the name dialog (layers, tap dances, macros) and a confirmation dialog |
