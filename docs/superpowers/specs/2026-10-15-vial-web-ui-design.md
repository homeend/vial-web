# Vial Web UI: design

- **Date:** 2026-10-15
- **Status:** approved in brainstorming, pending spec review
- **Scope:** personal fork of `vial-kb/vial-gui` (not aimed at upstream)

## 1. Goal

Replace Vial's Qt user interface with a web interface that:

1. runs on a modern Python (3.13+) instead of Python 3.6;
2. is much clearer than the current UI, in the spirit of ZSA Oryx: you can see at a glance what every key, layer, tap dance, combo and macro does, and where it is used;
3. is easy for Claude to develop and verify (HTML that Playwright can drive and screenshot, instead of Qt widgets);
4. works on Windows, macOS and Linux in any browser.

### Non-goals

- Upstream compatibility or contribution. Upstream changes may get harder to merge in; that's accepted.
- A hosted, no-install web app (WebHID). The API boundary keeps that possible later, but it isn't built now.
- The firmware flasher and the keyboard unlock flow, until phase 7, and only if wanted (see §9).

### Hard rule: never touch the owner's keyboard

All development, tests and screenshots run against the simulated keyboard (§7). Development code must never enumerate or open real HID devices. Only the owner runs the app against real hardware.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Architecture | Local Python server + browser UI (option A) | Reuses the proven protocol code; works in every browser; fully testable against a simulator |
| Backend | Python 3.13+, FastAPI, uvicorn | Typed requests/responses; generated OpenAPI schema |
| Frontend | Svelte 5 (runes) + TypeScript, built with Vite | Short, readable components; simple reactive state; scoped CSS |
| Device access | `hidapi` from PyPI (replaces the `vial-kb/cython-hidapi` fork) | The fork is upstream 0.10.1 plus a Cython pin; no Vial-specific code |
| Qt | Kept runnable until the web UI reaches feature parity (end of phase 5), then removed with `fbs` and PyQt5 | Always have a working tool during the transition |
| Packaging | Plain PyInstaller spec (verified working on 3.13 with PyInstaller 6.22) | `fbs` is unmaintained |
| Editing model | Live writes: every edit goes to the keyboard immediately, like Vial today | Matches Vial's behaviour; no separate "flash" step |

## 3. Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│  Svelte UI  (web/)                                              │
│   keymap: Edit view + Inspector, Overview view                  │
│   behaviours: tap dance, combos, macros, key overrides, ...     │
└──────────────▲───────────────────────────────▲──────────────────┘
               │ HTTP JSON (reads, edits)      │ WebSocket (events)
┌──────────────┴───────────────────────────────┴──────────────────┐
│  API server  (src/main/python/server/)  FastAPI on 127.0.0.1    │
│   app.py · device.py · model.py · describe.py · names.py        │
├─────────────────────────────────────────────────────────────────┤
│  Core (existing, reused): protocol/, keycodes/, kle_serial.py   │
├──────────────────────────────┬──────────────────────────────────┤
│  hidapi → real keyboard      │  simulator/ → fake keyboard      │
│  (owner only)                │  (--fake: development and tests) │
└──────────────────────────────┴──────────────────────────────────┘
```

### Startup and lifecycle

1. `vial` (or `Vial.exe`) starts the server on a free port on `127.0.0.1`, generates a random session token, prints the URL with the token to stdout and `vial.log`, and opens the default browser at it.
2. `vial --fake [--definition FILE] [--layout FILE.vil]` does the same against the simulator. In this mode `hidapi` is never imported.
3. **Browser tab closed:** the server keeps running. When the last UI WebSocket disconnects and no tab reconnects within about 3 seconds, it prints:
   ```
   Browser window closed. Vial is still running. Reopen it at:
     http://127.0.0.1:<port>/?token=<token>
   Press Ctrl+C to stop.
   ```
4. **Second copy started:** it detects the running instance (lock file holding port and token), opens the browser at the existing session, and exits.
5. Ctrl+C stops the server and closes the device.

### Security of the local server

A localhost server that writes to a keyboard must not be callable by arbitrary websites:

- bind to `127.0.0.1` only;
- reject requests whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` (prevents DNS rebinding);
- reject API and WebSocket requests whose `Origin` isn't the server's own;
- require the session token. The opened URL carries it as `?token=`; the first page load turns it into an `HttpOnly`, `SameSite=Strict` cookie, and every API and WebSocket request must carry that cookie.

## 4. Backend components (`src/main/python/server/`)

| Module | Responsibility | Depends on |
|---|---|---|
| `app.py` | FastAPI app: routes, security middleware, serving the built UI (`web/dist`), WebSocket hub, tab-closed detection | everything below |
| `device.py` | `DeviceManager`: find and open the Vial keyboard (or the simulator), hot-plug detection (reusing the `autorefresh` logic), and **one lock around all device I/O** so requests never interleave on the device | `protocol/`, `hidproxy`, `simulator/` |
| `model.py` | Converts the `Keyboard` object into JSON-ready models (pydantic): geometry, layers, keymap, encoders, layout options, tap dance, combos, macros, key overrides, alt-repeat, QMK settings, lighting, supported features | `protocol/`, `kle_serial.py`, `describe.py` |
| `describe.py` | Keycode → display description, e.g. `LT(2,KC_S)` → `{tap: "S", hold: "layer 2", kind: "layer-tap", layer: 2}`. Also parses free-form "any keycode" expressions. Single source of keycode knowledge, built on `keycodes/` and `any_keycode.py` | `keycodes/` |
| `names.py` | User names for layers, tap dances and macros, stored per keyboard UID in a JSON file in the user config directory (the firmware can't store names). Unnamed items get a generated name (e.g. "Tab / Caps") | none |

Key `kind` values: `basic`, `modifier`, `mod-tap`, `layer-tap`, `layer` (MO/TG/TO/TT/DF/OSL), `one-shot-mod`, `tap-dance`, `macro`, `transparent`, `none`, `mouse`, `media`, `lighting`, `other`.

### API (sketch)

| Method and path | Purpose |
|---|---|
| `GET /api/session` | Connection status, device info, fake or real |
| `GET /api/keyboard` | Full keyboard model (geometry + all state, described) |
| `PUT /api/keymap/{layer}/{row}/{col}` | Set a key → returns the described key |
| `PUT /api/encoders/{layer}/{index}/{direction}` | Set an encoder action |
| `PUT /api/layout-options` | Set layout options |
| `GET /api/keycodes` | Keycode catalogue for the picker (categories, labels, tooltips) |
| `POST /api/keycodes/parse` | Parse an "any keycode" expression → code + description, or an error |
| `PUT /api/tap-dance/{i}`, `/api/combos/{i}`, `/api/key-overrides/{i}`, `/api/alt-repeat/{i}` | Set one entry |
| `PUT /api/macros` | Set all macros (they share one buffer); refused with byte counts if too big |
| `PUT /api/qmk-settings/{id}`, `POST /api/qmk-settings/reset` | QMK settings |
| `PUT /api/lighting` | Lighting state |
| `GET/PUT /api/names` | User names |
| `GET /api/layout-file`, `POST /api/layout-file` | Download / restore a `.vil` file |
| `WS /api/events` | `connected`, `disconnected`, `reloaded`, matrix-tester state (while subscribed) |

## 5. Frontend (`web/`)

Svelte 5 with runes only (`$state`, `$derived`, `$props`, `$effect`). Svelte 4 syntax (`export let`, `$:`) is not allowed and `svelte-check` enforces that.

| Folder | Responsibility |
|---|---|
| `src/api/` | Typed HTTP client and WebSocket; types generated from the OpenAPI schema |
| `src/keyboard/` | Draws any keyboard from its geometry (including rotation and ISO Enter); `Key` component |
| `src/keymap/` | Edit view (layer tabs + keyboard + Inspector) and Overview view |
| `src/picker/` | Keycode picker: search, categories, any-keycode entry |
| `src/behaviours/` | Tap dance, combos, macros, key overrides, alt-repeat pages |
| `src/settings/` | QMK settings, lighting, matrix tester |
| `src/analysis/` | Pure functions: "used on", "layer reached by", "combo key positions", "unused" warnings |

### UI design

Approved mockups are in `docs/superpowers/specs/mockups/` (`keymap-layout.html`, `behaviours.html`). They are content fragments written for the brainstorming companion, so styling is incomplete when opened on their own.

**Width.** All content sits in a centred container with a maximum width: 1100 px for the Keymap section, 860 px for list pages (tap dance, combos, macros, key overrides, alt-repeat, settings). Extra screen space stays empty and nothing stretches across a large monitor. The keyboard scales down to fit narrow windows.

**Key style (everywhere).** Big label = tap action, small label = hold action. Colour = kind: normal, mod on hold (green), layer (blue), tap dance (purple), macro (orange). Combo member keys get a red underline; transparent keys are dashed and dimmed.

**Main navigation** (left menu): Keymap · Tap dance · Combos · Macros · Key overrides · Alt-repeat · Settings · Lighting · Matrix tester. Counts are shown next to each entry. Sections the keyboard's firmware doesn't support are hidden.

**Keymap section, two views switchable at the top:**

- **Edit view:** layer tabs (with user layer names), one layer at full size, and the **Inspector**: a sidebar on wide windows, below the keyboard on narrow ones. For the selected key it shows the keycode; tap, hold and double-tap; actions (change tap, change hold, turn into tap dance, make transparent); what the same key does on the other layers; combos using it; and how its layer is reached.
- **Overview view:** every layer as a small keyboard, each labelled with how it's reached ("hold Space", "one-shot, right thumb"). Click a layer to open it in the Edit view.

**Tap dance:** one card per entry: ID, name, a plain-language sentence ("Tap for Tab, double-tap for Caps Lock"), four slots (tap / hold / double tap / tap then hold; empty slots dashed), tapping term, and "used on" with click-to-jump. A warning appears when it isn't on any key.

**Combos:** one card per entry: a small keyboard with the member keys highlighted, an arrow to the output, and a sentence ("Press K + Y together for Esc"). Combos are defined by keycodes, not positions, so highlights come from where those keycodes sit on the base layer. If a keycode appears on several keys, or on none, the card says so.

**Macros:** steps as a readable chain (type "…" → tap Enter → wait 50 ms → press Ctrl+L), "used on", and a macro-memory usage bar that turns amber near full.

## 6. Data flow

1. **Connect:** `DeviceManager` opens the device and reads everything once. The UI loads `GET /api/keyboard`.
2. **Edit:** the UI calls the matching `PUT`. The backend writes to the device under the device lock, then returns the described result. The UI shows only what the keyboard confirmed.
3. **Events:** the WebSocket pushes `connected`, `disconnected` and `reloaded`; the UI reloads its state on `connected` and `reloaded`.
4. **Derived info** (used-on, reached-by, combo positions) is computed in the browser by `src/analysis/` from the loaded model, so it updates instantly after each edit.

## 7. Simulator (`src/main/python/simulator/`)

Fake mode uses a **byte-level simulated Vial keyboard**: it answers the real HID packets, so the real `protocol/` code runs unchanged and only the USB cable is simulated.

- Start from `VirtualKeyboard` and `MockDevice` in `src/main/python/test/test_gui.py`, moved into this package (tests then import it from here).
- Fill in the commands the current version doesn't answer: key overrides, alt-repeat, macro writes, QMK settings get/set/reset, lighting (QMK RGB light, backlight, VialRGB), encoders, layout options, unlock status, matrix state.
- Ship a realistic default keyboard: a 42-key Corne definition with sample tap dances, combos, macros and lighting. Load other definitions with `--definition` and saved layouts with `--layout`.
- Keeps all state in memory; nothing is persisted.

## 8. Error handling

| Situation | Behaviour |
|---|---|
| Keyboard unplugged | `disconnected` event; the UI greys out with a banner and blocks edits (no queued replays). On reconnect, a full reload from the device |
| Write fails (timeout, protocol error) | API error; the UI rolls the change back and shows a toast naming the action and the cause |
| Feature unsupported by the firmware | Section hidden or labelled "not supported by this keyboard's firmware" |
| VIA (non-Vial) or locked keyboard | Read-only with an explanation, as Vial does today, until unlock exists |
| Macro too big | Refused before writing, with the byte counts |
| Port in use | Another free port is chosen |
| Browser tab closed | The server keeps running and prints the reopen URL (§3) |
| Second instance | Opens the existing session and exits |
| Unexpected backend error | Logged to `vial.log`; the UI shows a short message pointing to the log, never a raw stack trace |

## 9. Testing

- **Backend:** pytest. Existing protocol tests, plus `describe`, `model`, `names` and every API route through FastAPI's test client against the simulator.
- **Frontend logic:** Vitest for `src/analysis/`; `svelte-check` for types and Svelte 5 syntax.
- **End-to-end:** Playwright drives the built UI against `vial --fake`. Example: select a key, pick a keycode, then check that the simulator received the write. It also takes screenshots at 1280 px and 2560 px viewports and checks the content width cap.
- **Real hardware:** only the owner. Each phase ends with a short manual checklist for the owner's keyboard.
- **Guard:** a test makes sure fake mode never imports `hid` or `hidraw`.

## 10. Build order

Each phase ends with something working and gets its own implementation plan.

| # | Phase | Result |
|---|---|---|
| 0 | Core to Python 3.13: update `requirements.txt` (PyQt5 5.15.11, PyInstaller 6.x, PyPI `hidapi`, simpleeval 1.x, pywin32 31x; drop `future`, `sip`, the `altgraph`/`macholib`/`pefile` pins), fix the invalid escape in `keymap/polish.py:21`, wrap float `QPoint` arguments in `test_gui.py` (`:483`, `:573`) in `int()`, make the Windows autorefresh window-class registration safe to repeat | The current Qt app and the tests run on 3.13 |
| 1 | Simulator + backend + API, with tests | `vial --fake` serves the keyboard as JSON |
| 2 | UI shell, keyboard drawing, Edit view, Inspector, keycode picker | First usable version: edit keymaps |
| 3 | Overview view + analysis | See every layer at once |
| 4 | Tap dance, combos, macros pages | The confusing parts become clear |
| 5 | Key overrides, alt-repeat, QMK settings, lighting, matrix tester, `.vil` save/load | Feature parity with Vial |
| 6 | PyInstaller packaging (UI included), remove Qt and `fbs`, update CI (Windows/Linux/macOS) | One `Vial.exe`, plus macOS and Linux builds |
| 7 | *Optional:* firmware flasher, unlock flow | Only if wanted; the owner tests them on hardware |

## 11. Risks

- **macOS and Linux builds can't be tested here.** The CI changes in phase 6 (new Linux base image, macOS 10.13+ Python) are verified only by CI runs.
- **Moving to Python 3.13 drops old systems.** It requires Windows 10+ and macOS 10.13+.
- **Combos are keycode-based,** so position highlighting is approximate when keycodes repeat (handled in the UI, see §5).
- **Simulator fidelity.** Behaviour the simulator doesn't model (timing, firmware quirks) shows up only on real hardware, hence the per-phase owner checklist.
