# Vial Web UI: roadmap for phases 2–7

**Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`
**Done:** phase 0 (Python 3.13) and phase 1 (simulator + local API server), merged to `main` on 2026-10-15.

This roadmap is the contract for the remaining phases. It fixes each phase's scope, what "done" means, and the order. Each phase also gets a **detailed, step-by-step implementation plan**, written at the start of that phase, from the code as it exists then. A plan written months ahead would guess at components that don't exist yet. Phase 2's detailed plan is written now: `2026-10-15-phase2-web-ui-keymap.md`.

## How every phase is run

1. **Branch.** Create `phaseN-<name>` from `main`.
2. **Detailed plan.**
   - Prototype the phase in a scratch worktree until every check passes.
   - Write the plan from the verified code, with complete code, commands and expected results.
   - Replay the plan from a clean checkout to prove every expected result happens.
   - Commit the plan.
3. **Execute** the plan task by task: a fresh agent per task, then a spec review and a code-quality review of each task. Fix the findings, run a final review of the whole branch, and fix that review's findings.
4. **End-to-end.** Run Playwright against `vial_web.py --fake` with temp data dirs and look at screenshots at 800, 1280 and 2560 px.
5. **Merge and push.** Merge to `main` and push to `origin` (`homeend/vial-web`), unless the owner says otherwise. Never push to `upstream` (`vial-kb/vial-gui`).
6. **Owner checklist.** The owner tries the phase on the real keyboard. Anything found becomes the first task of the next phase.

**Standing rules for every phase:**
- Never touch the owner's keyboard: no HID enumeration or opening, the simulator only, `--fake` runs with temp data dirs.
- Leave `gh.txt` alone.
- Content width is capped: 1100 px for the keymap, 860 px for list pages.
- Svelte 5 runes only.
- Every check stays green: pytest, svelte-check, Vitest, build, e2e, and the generated API types up to date.

## Order and dependencies

```
2 Keymap editing ──► 3 Overview + analysis ──► 4 Behaviours + unlock ──► 5 Parity ──► 6 Packaging, Qt removed ──► 7 Flasher (optional)
```

- **3 needs 2** for the keyboard drawing, store and API client.
- **4 needs 3** for the analysis behind "used on" and combo positions.
- **5 needs 4** for the unlock flow, which the matrix tester and QK_BOOT need.
- **6 needs 5.** Qt is removed only once the web UI does everything Qt did.

---

## Phase 2: UI shell, keyboard drawing, Edit view, Inspector, keycode picker

**Result:** the first usable web UI. You can see and edit every key on every layer.

**Scope**
- `web/`: a Svelte 5 + TypeScript + Vite app, built to `web/dist`, which `vial_web.py` already serves.
- API types generated from the server's OpenAPI schema (`openapi-typescript`), with a check that they're up to date.
- **App shell:**
  - left navigation (only built sections are shown);
  - a top bar with the keyboard name and connection status, including a "simulated keyboard" badge;
  - a centred content area capped at 1100 px.
- **Connection and events:**
  - WebSocket `/api/events`, with reconnect.
  - Reload the keyboard on `connected` and `reloaded`.
  - On `disconnected`, a banner that greys the UI and blocks edits.
  - Error toasts that name the action and the cause, mapped from 422, 423, 502, 503 and 500.
- **Keyboard drawing from the geometry:**
  - rotation, ISO Enter / secondary rectangles, decals, the current layout options, encoders;
  - big label = tap action, small label = hold action;
  - colour by kind; transparent keys dashed;
  - scales to fit narrow windows.
- **Edit view:**
  - layer tabs with user names (rename in place);
  - click to select a key, with keyboard navigation.
- **Inspector** (sidebar on wide windows, below the keyboard on narrow ones):
  - keycode, tap and hold actions;
  - change key, change hold (LT/MT), transparent, clear;
  - what the same position does on the other layers.
- **Keycode picker:**
  - search, categories from `/api/keycodes`;
  - "any keycode" entry, checked live through `/api/keycodes/parse`.
- **Keyboard language labels** (e.g. Polish `ą` on A), the same languages as Qt's `keymaps.py` / `keymap/*.py`, chosen per browser.
- **Backend:** `vial_web.py --data-dir DIR`, for tests and e2e runs.
- **Tests and CI:**
  - Vitest for pure logic;
  - svelte-check with 0 errors and 0 warnings;
  - Playwright e2e against `--fake`: load, edit a key through the picker, any-keycode, layers, rename, disconnect banner, screenshots, width cap, narrow layout;
  - a CI job with Node 24.

**Not in phase 2:** "combos using this key" and "how this layer is reached" in the Inspector, the Overview view and the combo underline (all phase 3); the behaviour pages (phase 4).

**Owner checklist**
1. Build the UI once: `cd web && npm ci && npm run build`. Then run `python src/main/python/vial_web.py` (close the Qt app first).
2. The browser shows your W-CORNE with your real keymap.
3. Change one key and change it back.
4. Switch the language to Polish and check the labels.
5. Unplug the keyboard and see the banner; plug it back in and see the keymap return.

---

## Phase 3: Overview view and analysis

**Result:** you can see every layer at once, and why each one is reachable.

**Scope**
- **`web/src/analysis/`** (pure functions with Vitest tests):
  - for each layer, which keys reach it and how (MO, TG, TO, TT, OSL, DF, LT, tap dance slots), and from which layers;
  - combos whose output reaches a layer count as a way to reach it ("press MO(5) + OSL(3) together → layer 2"; the owner's W-CORNE has such a combo), and a tap dance slot used as a combo output counts too;
  - for each tap dance and macro, which keys use it;
  - combo member positions, found by looking up the combo's keycodes on the base layer, including the "several keys" and "no key" cases;
  - warnings for unused tap dances and macros, and for layers that nothing reaches.
- **Overview view:**
  - every layer as a small keyboard, labelled with how it's reached ("hold Space", "one-shot, right thumb", "combo: MO(5) + OSL(3)");
  - click a layer to open it in the Edit view;
  - an Edit/Overview switch at the top of the Keymap section.
- **Find a character or key** (owner's request, 2026-10-17): a search box in the Keymap section. Type a letter, symbol or key name ("ą", "@", "Esc", "MO(2)") and see everywhere it's produced:
  - on which layers and keys, using the legends of the chosen keyboard language, so a symbol typed with Shift or AltGr counts too ("@: Shift + 2 on Base, left top row");
  - inside tap dance slots, combo outputs, key overrides and macros;
  - results listed with a click to jump to the key in the Edit view, and matching keys highlighted in the Overview;
  - "not on your keymap" when nothing produces it.
- **Inspector additions:** combos using this key, with their partner keys and output ("with OSL(3) → layer 2"), and how this layer is reached, including by combos.
- **Keys:** a red underline on combo member keys.
- **e2e:**
  - the overview shows all 4 Corne layers with correct "reached by" labels;
  - a combo of two layer keys whose output is a layer key: the target layer's label names the combo, and the Inspector shows it on both member keys;
  - clicking a layer opens it;
  - finding "@" lists Shift + 2 and highlights it; finding a character that's nowhere says so;
  - an 8-layer keyboard (the owner's W-CORNE uses layers 0–7) fits the overview without horizontal scrolling within the width cap;
  - screenshots at all three widths.
- **Limit (shown in the UI's help text):** layer switching done in firmware C code (for example tri-layer or `layer_state_set_user`) isn't visible over the Vial protocol, so it can't be shown.

**Open decision:** whether the overview shows layers that nothing reaches (default: yes, with a warning).

**Owner checklist:** the overview of the real keymap matches what you know about your layers, and layer 2 shows that it's reached by the MO(5) + OSL(3) combo.

---

## Phase 4: Tap dance, combos, macros pages, and the unlock flow

**Result:** the confusing parts become clear, and macros can be edited on the real keyboard.

**Why unlock moved here (changed from the spec).** The spec put the unlock flow in optional phase 7. But Vial firmware refuses macro writes while the keyboard is locked: the protocol code requests an unlock before every macro change, and the simulator mirrors that. Without an unlock flow, macro editing would always fail on the owner's W-CORNE. Unlock is therefore part of this phase. The firmware flasher stays in phase 7.

**Scope**
- **Unlock flow:**
  - **Backend:**
    - `POST /api/unlock/start`;
    - unlock progress pushed over the WebSocket (the keys to hold, the counter, done);
    - `POST /api/lock`;
    - the device manager reports `unlocked`;
    - an interrupted unlock is finished on connect, as Qt does.
  - **UI:**
    - a dialog that highlights the unlock keys on the drawn keyboard and shows progress;
    - started automatically when an edit gets 423, or from a "Lock/Unlock" control.
  - **Simulator:** unlock keys can be configured. Tests "hold" them with `VirtualKeyboard.press()`.
- **Tap dance page**, one card per entry:
  - ID, name (editable), and a plain-language sentence ("Tap for Tab, double-tap for Caps Lock");
  - four slots (tap / hold / double tap / tap then hold; empty slots dashed);
  - the tapping term, and "used on" with click-to-jump;
  - a warning when no key uses it;
  - editing a slot opens the keycode picker;
  - completes the Inspector's "Turn into tap dance" action (pick a free slot, then open its card).
- **Combos page**, one card per entry:
  - a small keyboard with the member keys highlighted, an arrow to the output, and a sentence ("Press K + Y together for Esc");
  - a note when a keycode sits on several keys or on none;
  - edit the members and the output with the picker;
  - choose the members by clicking keys on the card's small keyboard (up to 4, as Vial allows; clicking a chosen key removes it);
  - a combo whose output reaches a layer says so with the Overview's wording ("MO(5) + OSL(3) → reaches layer 2");
  - each combo under the Inspector's "Combos using this key" opens its card on this page.
- **Combo colours on keys** (owner's remark on phase 3; replaces the single red underline):
  - every combo with keys on a layer gets its own colour from a fixed palette, so different combos on the same layer never share a colour (past the palette's size colours repeat, in a stated order);
  - a key in one combo keeps an underline, in that combo's colour;
  - a key in several combos shows a row of dots along its bottom edge instead, one per combo in its colour, so they all fit (past what fits, "+n");
  - the same colour marks the combo everywhere: the Edit keyboard, the Overview, the Inspector's "Combos using this key" entries and the Combos page cards;
  - the palette reads on the key colours in light and dark (at least 3:1), and never uses the find highlight's amber;
  - the aria labels keep naming the combos, so colour isn't the only cue.
- **Macros page:**
  - each macro as a readable chain of steps (type "…" → tap Enter → wait 50 ms → press Ctrl+L), with a name and "used on";
  - a step editor: add, remove, reorder; text, tap, down, up, delay;
  - a macro-memory usage bar that turns amber near full, and a refusal with byte counts;
  - **record from keyboard:** captures keystrokes typed into the browser window. This doesn't touch HID.
- **Navigation:** counts next to each entry; sections the firmware doesn't support are hidden.
- **e2e:**
  - edit a tap dance slot and see "used on" jump to the key;
  - create a combo by clicking its keys and see the highlights;
  - open a combo's card from the Inspector;
  - a combo of two layer keys shows which layer it reaches;
  - two combos sharing a key: the shared key shows two dots in two different colours, and each other member key is underlined in its own combo's colour;
  - build a macro with all step kinds;
  - try to edit a macro on a locked simulated keyboard, unlock by "holding" the unlock keys through a fake-only test hook, and see the edit saved.

**Open decision:** whether "record from keyboard" is wanted (default: yes, browser-only).

**Owner checklist:**
1. Unlock the W-CORNE through the UI.
2. Edit a macro and check that it types correctly.
3. Edit a tap dance and a combo and check them on the keyboard.
4. Lock it again.

---

## Phase 5: Feature parity with the Qt app

**Result:** everything the Qt app can do, the web UI can do.

**Scope**
- **Key overrides page:** cards with trigger + mods → replacement, the options as plain checkboxes with explanations, and the layer mask as layer chips.
- **Alt-repeat page:** cards showing keycode → alt keycode, the allowed mods and the options.
- **QMK settings page:**
  - grouped as `qmk_settings.json` defines them (`/api/qmk-settings/definitions`);
  - booleans, integers with min/max and the bitfield options;
  - reset to defaults, with a confirmation.
- **Lighting page:** QMK RGB light, backlight and VialRGB, with mode lists, speed, brightness and a colour picker; only the parts the keyboard supports.
- **Layout options:** edit them (Qt's "Layout" tab), with the keyboard drawing updating live.
- **Matrix tester:**
  - **Backend:** a WebSocket subscription that polls the matrix under the device lock at about 20 Hz while subscribed (needs unlock, from phase 4).
  - **UI:** pressed keys light up live, and keys that were ever pressed stay marked.
- **`.vil` files:** "Save layout" (download) and "Load layout" (upload with a preview of what changes and a confirmation), using the existing validated routes.
- **About keyboard:** name, UID, firmware protocol versions and features.
- **Parity check:** go through every Qt tab and menu (Keymap, Layout, Macros, Lighting, Tap Dance, Combos, Key Overrides, Alt Repeat Key, QMK Settings, Matrix tester; File menu; keyboard language; lock/unlock; reboot to bootloader) and record where each lives in the web UI, or why it's dropped.
- **e2e:** one test per page against the simulator; the matrix tester driven by `VirtualKeyboard.press()` through a fake-only test hook.

**Open decision:** VIA-only keyboards and "sideload VIA JSON". The spec says read-only with an explanation, but the server currently only finds Vial keyboards. The default is to leave them out unless the owner needs them; the owner's keyboard is Vial.

**Owner checklist:** a run through every page on the real keyboard, and the matrix tester with real key presses.

---

## Phase 6: Packaging, Qt removed, CI on three systems

**Result:** the whole app in one file: a single `Vial.exe` (plus single-file macOS and Linux builds) that starts the server and opens the browser. Nothing to install or unpack. No Qt left.

**Scope**
- **PyInstaller spec** (`vial.spec`), one-file mode (owner's goal: one big file containing the whole app):
  - bundles the Python runtime, `web/dist`, `qmk_settings.json`, the keymaps and certifi into the one executable;
  - `vial_web.py` is the entry point;
  - bundled files are read through `sys._MEIPASS` (one-file builds unpack to a temp folder at start); user data stays in the normal data dir, never next to the exe or in the temp folder;
  - Windows icon and version info.
- **Windows console:** keep the console window. It shows the URL and the reopen message, and closing it or pressing Ctrl+C stops the server. Add a "Quit Vial" button in the UI (`POST /api/shutdown`), so Vial can also be closed from the browser. A windowless build (background process, reopen by double-click, auto-quit when no tab is open) can be decided after all phases are finished.
- **Remove Qt and `fbs`:**
  - `main.py`, `main_window.py`, `editor/*`, `widgets/*`, `unlocker.py`, the Qt parts of `util.py`, `autorefresh/` (the device manager has its own hot-plug detection), `test_gui.py`, and the Qt-only tests;
  - except the flashing logic in `editor/firmware_flasher.py`, which moves to a Qt-free module (`protocol/flasher.py`) with its tests, so phase 7 can build on it;
  - PyQt5, fbs and `requirements-fbs.txt`;
  - `use-python.*` simplified.
- **CI** (`main.yml`):
  - re-enable Linux and macOS builds on Python 3.13 (new Linux base image, macOS universal or arm64 build);
  - Windows build without fbs;
  - build artifacts for all three.
- **CI** (`test.yml`): tests on Windows, Linux and macOS.
- **Docs:** a README for the fork, covering how to run, `--fake`, the dev workflow and building.

**Risk:** macOS and Linux builds can only be checked through CI runs; there's no local machine for them.

**Owner checklist:** copy the built `Vial.exe` (one file) to any folder on Windows, run it, and go through the phase 5 checklist again with it.

---

## Phase 7 (optional): firmware flasher

**Result:** flash Vial firmware from the web UI, as Qt's "Firmware updater" does.

**Scope**
- **Backend:**
  - reboot to bootloader (needs unlock);
  - find the Vial bootloader device;
  - stream a `.vfw` file with progress events over the WebSocket;
  - re-detect the keyboard afterwards;
  - built on the existing `editor/firmware_flasher.py` logic, moved out of Qt before phase 6 removes it. If phase 7 hasn't started by then, phase 6 keeps that logic as a Qt-free module.
- **UI:** a file picker, a compatibility check (keyboard UID against the firmware's UID), a progress bar, and a big warning.
- **Simulator:** a fake bootloader device for the tests.

**Only if the owner wants it.** Flashing can't be fully tested without real hardware, and a failed flash needs physical recovery. The owner does the first real flash with a recovery plan ready.

---

## Decisions already made in this roadmap (the owner can override)

| # | Decision | Default |
|---|---|---|
| 1 | Unlock flow moves from phase 7 into phase 4 | Yes: macros can't be edited on a locked keyboard without it |
| 2 | Keyboard language labels | Phase 2, as promised in the phase 1 plan |
| 3 | Merge and push to `origin` at the end of each phase | Yes |
| 4 | Macro "record from keyboard" | Yes, browser-only |
| 5 | VIA-only keyboards / sideload | Not built unless asked |
| 6 | Windows build | Console window plus a "Quit Vial" button. The owner's choice on 2026-10-15; revisit a windowless build after all phases |
| 7 | Overview shows unreached layers | Yes, with a warning |
