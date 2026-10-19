# Vial web UI

Svelte 5 (runes only) + TypeScript, built with Vite. `npm run build` writes `web/dist`, which
`vial_web.py` serves; without `dist` it shows a placeholder page.

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
simulated keyboard N layers (the sample keymap fills the first four, the others are empty), and
`--definition FILE` simulates another keyboard.

The simulated Corne starts unlocked, as nobody can hold its keys. Its unlock keys are the outermost
keys of both top rows (Tab and Backspace). A fake server has a test hook for them:
`PUT /api/simulator/unlock` with `{"locked": true}` locks the keyboard, and `{"keysHeld": true}`
(or `false`) holds its unlock keys down (or lets go); the e2e tests unlock it that way.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Build into `dist/` |
| `npm run dev` | Build, then rebuild on every change |
| `npm run check` | `svelte-check` (types, Svelte 5 runes-only syntax; fails on warnings), then `tsc` for the configs, e2e tests and scripts |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run e2e` | Build, then run the Playwright tests (`e2e/`) against `vial_web.py --fake` |
| `npm run gen:api` | Regenerate `src/api/schema.d.ts` from the server's OpenAPI schema |
| `npm run check:api` | Fail if `src/api/schema.d.ts` is out of date |

## API types

`src/api/schema.d.ts` is generated: `npm run gen:api` runs `python -m server.dump_openapi`
(which builds the app around a never-connected simulator and writes its OpenAPI schema) and
`openapi-typescript` on the result. Regenerate and commit it whenever the server's schemas change;
CI runs `npm run check:api`.

## End-to-end tests

`e2e/global-setup.ts` starts three `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
default Corne; `e2e/fixtures/macropad.vial.json` with encoders; and the Corne with `--layers 8`, as the
owner's keyboard has),
reads the links with the session token from their output and stops them afterwards. Screenshots, each in the
light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed).

`@playwright/test` is pinned to the version whose Chromium is already installed on the
development machine, so no browser is downloaded there. CI installs that Chromium with
`npx playwright install --with-deps chromium`.

## Layout

| Folder | What |
|---|---|
| `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
| `src/lib/` | The keyboard store (loaded model, connection, edits), unlocking, the section shown (the address's `#combos/2`), toasts, and the theme (System, Light, Dark) |
| `src/keyboard/` | Drawing any keyboard from its geometry; key labels |
| `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo keys, tap dance and macro usage, finding a character or key, and the phrases for them |
| `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, layer cards, find box |
| `src/behaviours/` | The Tap dance, Combos and Macros pages: their cards, the combo key chooser, the macro step editor and recorder, and the plain-language sentences |
| `src/picker/` | Keycode picker: search, categories, any-keycode entry |
| `src/shell/` | Top bar (with the Lock/Unlock control), navigation, banners, toasts, the unlock dialog |
| `src/ui/` | Small shared controls, and the name dialog (layers, tap dances, macros) |
