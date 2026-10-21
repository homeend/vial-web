# Phase 6: One executable, Quit Vial, Qt and fbs removed, CI on three systems — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vial becomes one executable file per system (`Vial.exe` on Windows, `vial` on Linux and macOS) that starts the server and opens the browser. Vial can be quit from the page and stops cleanly when its console closes. The Qt app, fbs and the installer are gone. The firmware updater's logic is kept, without Qt, for phase 7. CI builds and smoke-tests the executable on Windows, Linux and macOS and runs the tests on all three. The fork gets its own README.

**Architecture:**
- **Bundled files.** `resources.py` gives the path of each file Vial ships: the built web UI and `qmk_settings.json`. From source it reads them from the repository, and frozen from `sys._MEIPASS`. `vial.spec` takes its `datas` from the same table. User data stays in the platformdirs data dir.
- **Quit.**
  - On the server, `POST /api/shutdown` stops the unlock follower and the matrix tester, then closes the keyboard; from then on `DeviceManager` opens none. It sends every tab a `stopped` event, answers 204, and then sets uvicorn's `should_exit`.
  - In the web UI, a "Quit Vial" button sits in the top bar. It asks first when there is unsaved work. Afterwards `StoppedPage` replaces the app, and the events link isn't opened again.
- **The console.** `console.py` handles a closed console window, log-off, shutdown and Ctrl+Break on Windows (`SetConsoleCtrlHandler`), and SIGHUP elsewhere. Each asks the server to stop and holds the process until the keyboard is closed. Ctrl+C stays Python's `KeyboardInterrupt`. uvicorn waits at most `SHUTDOWN_GRACE` (2 s) for the tabs' connections.
- **Qt removed.** The Qt modules, their tests and the dead code they leave go, and so do PyQt5, keyboard, pywin32, certifi, pytest-qt and pytest-xvfb. The firmware updater's logic moves to `protocol/flasher.py`. `test_core_isolation` now checks that no source imports Qt.
- **The executable.** `vial.spec` builds a PyInstaller one-file console executable with hidden imports for uvicorn, no UPX, and Windows version info from `version.py`. `vial --self-check` checks a build without looking for any keyboard. `util/smoke_test.py` starts a build with `--fake`, reads the session and quits it.
- **e2e against the executable.** With `E2E_VIAL_CMD`, the e2e servers are the built executable instead of `vial_web.py`. Every server is asked to quit first.
- **CI.** `main.yml` builds, smoke-tests and uploads the executable on Windows (`windows-2025`), Linux (`ubuntu-22.04`) and macOS (`macos-15`, arm64), and runs e2e against it on Windows and Linux. `test.yml` runs pytest on all three systems, and the web checks and e2e on Linux and Windows.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, uvicorn 0.54.0, hidapi 0.15.0, pydantic 2, pytest with pytest-xdist.
- Packaging: PyInstaller 6.22.3, already pinned in `requirements.txt` (no new Python dependency).
- Frontend: Node 24, Svelte 5 (runes only), TypeScript, Vite, svelte-check, Vitest, as on `main`.
- API types: openapi-typescript (`npm run gen:api`).
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- CI: GitHub Actions, official actions only: `actions/checkout@v4`, `actions/setup-python@v5`, `actions/setup-node@v4`, `actions/upload-artifact@v4`.
- No new npm dependency: `web/package.json` and `web/package-lock.json` don't change.

**Roadmap:** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`, "Phase 6", as adjusted by the owner on 2026-10-20:
- the owner uses Windows and Linux and checks both by hand; macOS is built in CI "as is", arm64, unsigned;
- no installer, no docker, nothing downloaded but pinned PyPI and npm packages, and only official `actions/*` in CI.

Phase 5 (5a and 5b) is done and on `main`.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard** (a Vial W-CORNE, VID 0x55D4). Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` and the built executable only as `--fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e fixtures and `util/smoke_test.py` start them exactly like that.
   - The one other run allowed is `--self-check` (Task 8): it loads hidapi but never lists or opens a device. Never run Vial without `--fake` otherwise; the owner checks real use by hand (owner checklist).
   - Never start a Qt app. Before Task 6 the Qt tests run off screen (`QT_QPA_PLATFORM=offscreen`), and after Task 6 there is no Qt.
   - Never write into `%LOCALAPPDATA%\Vial`, the user config folder or the registry.
   - Stop every server and executable you start, with `POST /api/shutdown` first. The e2e fixtures and the smoke test do this. A one-file executable that is killed leaves its `%TEMP%\_MEI…` unpack folder behind (about 25 MB). Leave no stray processes.
2. **Shell:** Git Bash on Windows; the commands are written for it.
   - Every command block starts in the repository root. A `cd` inside a block applies to that block only.
   - On Linux/macOS, replace `.venv/Scripts/python.exe` with `.venv/bin/python` and `dist/Vial.exe` with `dist/vial`.
3. **Python:** the repository's own `.venv`, Python 3.13, with `test-requirements.txt` installed (it includes `requirements.txt`, so PyInstaller too).
   - Tests run from `src/main/python`, because the code uses top-level imports. The whole suite runs on every core:

   ```
   cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
   ```

   - Until Task 6 the command starts with `QT_QPA_PLATFORM=offscreen` (after `&&`), so the Qt tests' windows stay off the screen. A single test file runs without `-n auto --dist worksteal`.
   - **Task 6 recreates the venv** from the new requirement files, so that no Qt package is left in it. It reads the base Python from the old venv (`sys._base_executable`), deletes `.venv`, creates it again with that Python and installs `test-requirements.txt`. The exact command is in Task 6, Step 7.
   - The web scripts (`gen:api`, `check:api`, e2e) find this same `.venv` themselves, or the Python named by `VIAL_PYTHON`.
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency: `web/package.json` and `web/package-lock.json` don't change. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally. Only CI does, as `npx playwright install --with-deps chromium`.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **Downloads.**
   - Only the pinned packages from PyPI, into this checkout's `.venv` (PyInstaller included), and from npm, inside `web/`.
   - No other binaries, installers or scripts.
   - In CI, GitHub Actions only as official `actions/*` at pinned major versions.
7. **End-to-end tests run in parallel** (`web/README.md`, "End-to-end tests"): half the cores by default, `E2E_WORKERS=<n>` to choose. Each Playwright worker starts its own fake servers.
   - From Task 4 on, every server is asked to quit (`POST /api/shutdown`) when its worker ends. One that takes Quit and doesn't exit within 5 s fails the run.
   - `npm run e2e` builds first; `npx playwright test <spec>` runs against the last build.
   - From Task 9 on, `E2E_VIAL_CMD=dist/Vial.exe npx playwright test` runs the same suite against the built executable.
8. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
9. **Line endings and escapes:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings. Git Bash's `sed -i` strips the CRs; use an editor, or Python with `newline=''`. `git apply` keeps them.
   - Python's default encoding here is cp1250: a script that writes files must open them with `encoding="utf-8"` and `newline=''`, or "…" and similar characters break.
   - Bash heredocs can mangle `\\` and some quoting: write code with an editor, not with `echo` or a heredoc.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
   - Check a written file with `git diff` before committing.
10. **Commits:** one commit per task, on branch `phase6-standalone`.
    - Add the files the task names; Tasks 6 and 7 also stage their deletions with `git rm`. Never `git add -A`. Leave the untracked `gh.txt` and `STATUS.md` alone.
    - End every commit message with the trailer the session tells you to use.
11. **How code is given.**
    - "Create `X`:" is followed by the file's complete content.
    - "Replace the whole of `X` with:" is followed by the file's new complete content. It is used where a file is rewritten: `.github/workflows/main.yml` and the root `README.md`.
    - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
    - A file changed by several tasks has one diff in each. The tasks are in order, so each diff applies to what the task before left.
    - Deleted files are listed in a `git rm` command, not shown.
    - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it in Task 2, in the same commit as the schema change.
    - Each "Expected:" lists text that the command's output contains.
12. **Standing rules (roadmap and owner)**, for the Quit button and the stopped page:
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Widths: the keymap's content is at most 1100 px, the list and settings pages at most 860 px (`--list-max`), both centred.
    - Nothing scrolls sideways at 800 px or at 375 px.
    - Heights: the owner uses a 1080p screen, which leaves about 1920 × 950 px for the page; everything fits there.
    - Anything the user typed (layer, tap dance and macro names) is cut short with "…" and a tooltip with the full name wherever it shows.
    - The owner uses Firefox: only CSS that works in Firefox and Chromium alike.
    - Both themes, light and dark, must read well.
    - Focus is always visible, and it never falls to `<body>`: the stopped page's heading takes it.
    - **Owner feedback from earlier phases:**
      - every sentence about what the keyboard or Vial does is true for the vial-qmk firmware and for this code;
      - each page says how saving works;
      - the console messages say how to stop Vial.
    - **The Windows build keeps its console window:** it shows the link and the reopen message, and closing it stops Vial.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and the e2e tests where the task names them.

## Prerequisite

Phase 5 is on `main` (at `3072c47` or later), and `phase6-standalone` is branched from it. `.venv` exists (Python 3.13, `test-requirements.txt` installed: on `main` that still includes PyQt5 and pytest-qt), and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1012 passed, 1 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  810 passed (810)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright" && .venv/Scripts/python.exe -m PyInstaller --version
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237` and `6.22.3`.

```bash
cd web && npm run e2e
```

Expected: `185 passed`.

One phase 5b Python test is flaky under load: `test_keyboards.py::test_the_poll_tells_when_a_keyboard_is_plugged_in_or_the_error_changes` sometimes fails at `assert "disconnected" in wait_for(ws, "keyboards")` with `AssertionError: assert 'disconnected' in ['keyboards']`. Its hot-plug poll runs every 10 ms, and a `keyboards` event from the poll can arrive after the select and before the select's own events. It failed once in about 50 full runs of the suite made while this plan was written and replayed (in Task 8, on a slow run), and not in 11 runs on `main` (6 of them three at a time) or 9 runs on the final code three at a time. If it is the only failure of a full run, run it again (`cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_keyboards.py`) and go on; this phase doesn't change it.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/resources.py` | **new.** `Resource`, `WEB_DIST`, `QMK_SETTINGS`, `BUNDLED`; `path()` from source or from `sys._MEIPASS`; `web_ui_missing()` with the build command; `pyinstaller_datas()` for `vial.spec`, refusing to build without the web UI |
| `src/main/python/protocol/qmk_settings_codec.py` | reads `qmk_settings.json` through `resources` |
| `src/main/python/server/app.py` | the placeholder page says how to build the UI; `POST /api/shutdown` (`create_app(…, on_stop=…)`, 501 without it), the `stopped` event |
| `src/main/python/server/device.py` | `DeviceManager.stopped`: after `close()` no keyboard is looked for or opened |
| `src/main/python/server/schemas.py` | the `stopped` event type |
| `src/main/python/console.py` | **new.** `ConsoleStop`, `StopOnConsoleClose`: a closed console window, log-off, shutdown or Ctrl+Break (Windows) or SIGHUP (elsewhere) stops the server and waits until the keyboard is closed; Ctrl+C turned back on if inherited as ignored |
| `src/main/python/vial_web.py` | the web UI through `resources`, and a hint when it isn't built; `quit_from_page`, `QUIT_MESSAGE`, `SHUTDOWN_GRACE`; the console handler and the keyboard closed in `serve()`; the console messages; `--version`; `--self-check` |
| `src/main/python/version.py` | **new.** `VERSION = "0.8.0"`, `PRODUCT = "Vial (web)"` |
| `src/main/python/selfcheck.py` | **new.** `problems()`, `main()`: hidapi loads, the server and uvicorn's run-time modules import, the web UI and the QMK settings are there |
| `src/main/python/protocol/flasher.py` | **new.** The firmware updater's logic without Qt, for phase 7: `read_firmware`, `check_firmware_for`, `is_bootloader`, `bootloader_title`, `bootloader_uid`, `find_bootloader`, `Bootloader`, `flash` |
| `src/main/python/test/test_resources.py`, `test_shutdown.py`, `test_console.py`, `test_flasher.py`, `test_selfcheck.py` | **new.** Tests of the above |
| `src/main/python/test/test_vial_web.py`, `test_device_manager.py`, `test_dump_openapi.py` | the web UI missing, Quit, the shutdown grace, `--version`; a stopped manager; `/api/shutdown` and `stopped` in the schema |
| `src/main/python/test/test_core_isolation.py` | `test_no_source_imports_qt`; the blocker also blocks every Qt binding and `fbs_runtime`; the flasher imports without hidapi |
| `src/main/python/test/dummy_keyboard.py` | moved from `protocol/`: only the macro tests use it |
| `src/main/python/test/test_macro.py`, `test_keyboard.py` | the recorder helpers' tests removed; imports from `test.dummy_keyboard` and `transport` |
| `src/main/python/protocol/unlock_hook.py` | raises when no handler is installed, instead of opening Qt's dialog |
| `src/main/python/hidproxy.py`, `keycodes/keycodes.py` | the `emscripten` branches and the recorder aliases removed |
| `src/main/python/protocol/alt_repeat_key.py`, `combo.py`, `key_override.py`, `keyboard_comm.py`, `macro.py`, `tap_dance.py` | helpers only the Qt editors called, removed |
| `src/main/python/main.py`, `main_window.py`, `webmain.py`, `editor/*` (13), `widgets/*` (10), `autorefresh/*` (4), `about_keyboard.py`, `any_keycode_dialog.py`, `constants.py`, `linux_keystroke_recorder.py`, `tabbed_keycodes.py`, `textbox_window.py`, `themes.py`, `unlocker.py`, `util.py`, `vial_device.py`, `macro/macro_action_ui.py`, `macro_key.py`, `macro_line.py`, `macro_optimizer.py`, `macro_recorder_linux.py`, `macro_recorder_windows.py`, `macro_tab.py`, `test/test_gui.py`, `test/test_autorefresh_win.py` | **deleted** (Task 6) |
| `requirements.txt`, `test-requirements.txt` | without PyQt5, keyboard, pywin32, certifi; without pytest-qt, pytest-xvfb |
| `requirements-fbs.txt`, `util/fbs_build.py`, `util/linux-builder/*` (4), `util/setup_python36.sh`, `util/prepare-release.sh`, `src/build/settings/*.json` (3), `src/installer/windows/Installer.nsi`, `misc/Vial.yml`, `src/main/icons/README.md`, `src/main/icons/{base,linux,mac}/*.png` (13) | **deleted** (Task 7). `src/main/icons/Icon.ico` stays, for `Vial.exe` |
| `use-python.sh`, `use-python.ps1`, `use-python.cmd` | create, install and activate the venv, without fbs |
| `.python-version` | `3.13` |
| `vial.spec` | **new.** The PyInstaller one-file build: datas from `resources`, hidden imports, excludes, no UPX, console, `Icon.ico` and version info on Windows |
| `util/smoke_test.py` | **new.** `--self-check`, then start with `--fake --no-browser --data-dir <temp>`, `GET /api/session`, `POST /api/shutdown`, exit code 0 |
| `.gitignore` | PyInstaller's `/build/` and `/dist/` instead of fbs' `target` |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` (Task 2) |
| `web/src/api/events.ts` | a `stopped` event closes the link for good |
| `web/src/api/api.ts`, `client.ts` | `api.shutdown()`; a 204 reply is `null` |
| `web/src/lib/keyboard.svelte.ts` | `quit()`, `quitting`, `stopped` |
| `web/src/shell/TopBar.svelte` | the "Quit Vial" button |
| `web/src/shell/StoppedPage.svelte` | **new.** "Vial has stopped. You can close this tab." |
| `web/src/App.svelte` | the stopped page instead of the app; the unsaved-work confirmation; the page title |
| `web/e2e/servers.ts` | `TestServer` (`exited`, `output`); every server asked to quit first, a hang fails the run; `E2E_VIAL_CMD` |
| `web/e2e/fixtures.ts` | `ownServer`: a server of the test's own |
| `web/e2e/quit.spec.ts` | **new.** e2e of Quit, the confirmation, the button at every width |
| `web/playwright.config.ts` | says how to run against the executable |
| `.github/workflows/main.yml` | build, smoke test, upload on three systems; e2e against the executable on Windows and Linux |
| `.github/workflows/test.yml` | pytest on three systems; web checks on Linux; e2e on Linux and Windows |
| `README.md` | the fork's README |
| `web/README.md`, `docs/parity.md` | after phase 6 |

## Decisions

These come from the verified prototype (`proto-phase6`).

1. **Quit lives in the top bar**, at its right end after the language list: a "Quit Vial" button with a power icon.
   - The top bar is on every page. It is there even when no keyboard is found, when the navigation offers only Keymap and the Keyboard page doesn't exist, and Quit doesn't need a keyboard.
   - With no unsaved work (`lib/unsaved.ts`) it quits at once. With unsaved work a danger `ConfirmDialog` ("Quit Vial?") names what would be lost. Its focus starts on Cancel, Cancel gives the focus back to the button, and "Quit Vial" quits.
   - The tab that quit gets the 204; every other tab gets a `stopped` event. Each closes its events link and doesn't reconnect.
   - Afterwards `StoppedPage` replaces the whole app: "Vial has stopped", "You can close this tab.", "To use Vial again, start it again." Its heading takes the focus, and the page title becomes "Vial has stopped".
   - It was checked at 375, 800, 1280 and 1920 px in both themes: no sideways scroll, a visible focus ring, and no CSS Firefox lacks.
   - On the server, `POST /api/shutdown` has the token and Host/Origin checks of every route. It stops the unlock follower and the matrix watcher and closes the keyboard; `DeviceManager.close()` sets `stopped`, so `check`, `connect` and `select` open nothing afterwards. Then it broadcasts `stopped`, answers 204, and a `BackgroundTask` sets uvicorn's `should_exit`. Calls made at the same time share one close. A server created without `on_stop` (the tests, the schema dump) answers 501.
2. **The console.**
   - **Windows:** `SetConsoleCtrlHandler` takes the close, log-off and shutdown events and Ctrl+Break. It asks uvicorn to stop and holds the process, at most `CLOSE_WAIT` = 4.5 s (Windows ends it 5 s after the event), until `serve()` has closed the keyboard. Ctrl+C stays Python's `KeyboardInterrupt`, which uvicorn stops on.
   - Windows passes "ignore Ctrl+C" on to child processes. The handler therefore turns Ctrl+C processing back on (`SetConsoleCtrlHandler(NULL, FALSE)`, called with `routine()` because ctypes needs a NULL routine).
   - **Linux and macOS:** SIGHUP (the terminal closed) does the same.
   - `serve()` closes the keyboard in its own `finally`, inside that window.
   - **`SHUTDOWN_GRACE` = 2 s** (uvicorn's `timeout_graceful_shutdown`). Without it, about 5 of 34 e2e servers took Quit and never exited. The cause is Python 3.13's Proactor `_call_connection_lost`: it calls `sock.shutdown()` on a socket the browser had reset, which raises before `server._detach()`, so uvicorn's `Server.wait_closed()` waits forever. The grace is shorter than `CLOSE_WAIT`, so a closed console still closes the keyboard. The e2e servers' guard (a server that takes Quit and doesn't exit within 5 s fails the run) keeps it honest.
   - Checked on the frozen `Vial.exe --fake` from a scratch harness: Ctrl+C in Windows Terminal and in conhost, and closing the conhost window. Each exited within 0.5–0.8 s with the keyboard closed and `server.json` removed. Closing a Windows Terminal tab can't be scripted: the owner checks it.
3. **One-file PyInstaller** (`vial.spec`).
   - **Hidden imports:** uvicorn's loops, protocols, logging and lifespan, `websockets`, and `hid` (`hidraw` on Linux).
   - **Excludes:** tkinter, PyQt5, pytest, setuptools, pkg_resources and PyInstaller. Excluding setuptools, which the build's Python pulled in, shrank the exe from 17.3 MB to 15.8 MB (15.1 MiB).
   - **No UPX, no strip,** nothing that looks like packing.
   - **The web UI is required:** `resources.pyinstaller_datas()` refuses to build without `web/dist`.
   - **Windows:** a console app with `Icon.ico` and version info ("Vial (web)", 0.8.0.0) from `version.py`.
   - **The `_MEI` folders:** a one-file executable unpacks itself to `%TEMP%\_MEIxxxx` at start and removes it at exit, but not when it is killed. So the e2e servers and the smoke test quit through `POST /api/shutdown` first, and end the process only if it can't be asked.
4. **`--self-check`** is a new, user-visible flag. It loads hidapi (never asking it for a device), imports the server and uvicorn's run-time modules, and checks that the web UI and `qmk_settings.json` are there. It exits 1 and lists what is missing otherwise. It looks for no keyboard and touches no data dir, so CI can prove hidapi works in each frozen build.
5. **The version:** `src/main/python/version.py`, `VERSION = "0.8.0"`, the first fork release after upstream's 0.7.5; the owner confirmed it on 2026-10-21. `vial --version` prints "Vial (web) 0.8.0", and `vial.spec` builds the Windows version info from it. The page doesn't show it (`docs/parity.md` says so).
6. **Linux and macOS builds.**
   - **Linux:** built on `ubuntu-22.04`, the oldest Ubuntu runner, so it runs on glibc 2.35 or newer. It is one plain binary, `dist/vial`, with no AppImage. `libusb-1.0-0-dev` and `libudev-dev` come from apt, as in the test job. The README links get.vial.today's udev rule instructions. GitHub's artifact zip drops the execute bit, so the README says `chmod +x vial`.
   - **macOS:** built on `macos-15` (arm64) as a plain one-file console binary `dist/vial`, as is: no `.app`, no icon (that would need an `.icns`) and no signing. The README gives the `xattr -d com.apple.quarantine vial` step. It is tested only by the CI smoke test.
7. **The flasher has no UI** (phase 7 builds one) and was never run against a device: 25 tests use a stand-in bootloader. The caller lists and opens the HID devices (`find_bootloader(devices, open_device, uid)`), so the module never imports hidapi. It differs from Qt's `firmware_flasher.py` in three ways:
   - every check passes before anything is written;
   - a command the bootloader doesn't take raises `FlashError`, where Qt went on;
   - a firmware of more than 65535 chunks is refused.
8. **What was removed, and why.**
   - **The Qt app:** `main.py`, `main_window.py`, `webmain.py`, `editor/`, `widgets/`, `autorefresh/`, and the Qt-only modules. All of `util.py` was Qt or Qt-only; `transport` has `chunks` and `MSG_LEN`. `vial_device.py` was used only by Qt and the old flasher, and `constants.py` holds Qt widget sizes.
   - **The macro recorder:** `macro_key.py` and `macro_optimizer.py` are Qt-free, but only the Qt recorder used them (the web recorder runs in the browser). Their 3 tests go with them.
   - **Dead code** found by a scan for helpers with no callers once Qt was gone:
     - the keycodes' 86 `recorder_alias=` arguments, with `recorder_alias_to_keycode` and `find_by_recorder_alias`;
     - the `emscripten` branches of `hidproxy.py` and `keycodes.py`, which were for the Qt app's web build;
     - the protocol helpers `combo_get`, `tap_dance_get`, `key_override_get`, `alt_repeat_key_get`, `reload_macros`, `set_vialrgb_brightness` and `set_vialrgb_speed`.
     - `set_vialrgb_mode` and `keyboard_comm.get_uid` stay: tests use them, and phase 7 needs the UID.
   - **The removed tests:** `test_gui.py` (7 tests) tested the Qt GUI, and `test_autorefresh_win.py` (5) the Qt app's Windows hot-plug thread.
   - **certifi:** only the Qt `main.py` used it.
   - **keyboard and pywin32:** they were for the Windows macro recorder and autorefresh.
   - **`prepare-release.sh`:** deleted. It only renamed the AppImage, dmg and NSIS installer; CI now names the artifacts `vial-windows`, `vial-linux` and `vial-macos`.
9. **`test_core_isolation` gets a new meaning.**
   - `test_no_source_imports_qt` scans every source file's imports (AST) for PyQt5, PyQt6, PySide2, PySide6, qtpy and `fbs_runtime`.
   - The hidapi blocker (`run_isolated`) still proves that fake mode, the protocol core, the flasher and the API schema dump load no hidapi.
   - **`use-python.*` stay**, simplified: they create the venv, install `test-requirements.txt` and activate it, without the fbs install and with `requirements-fbs.txt` out of the hash. This plan doesn't run them, because they run an unpinned `pip install --upgrade pip`.
10. **Action versions:** the majors the repository already used, `actions/checkout@v4`, `actions/setup-python@v5`, `actions/setup-node@v4`, `actions/upload-artifact@v4`. No third-party action.

## Out of scope / later

- **What only CI can prove** (the executor pushes `phase6-standalone` and iterates on CI):
  - the Linux and macOS builds as a whole: PyInstaller, hidapi's `hidraw` extension on Linux, the smoke test, and the binaries running;
  - the e2e suite against the Linux binary, and e2e on the Windows runner. The time is unknown: about 1.5 min here with 8 workers, maybe 5 to 8 min on 4-core runners;
  - pytest on Linux and macOS: the SIGHUP test runs only there, and the Windows-only console test is skipped there;
  - that `ubuntu-22.04`, `macos-15` and `windows-2025` are still offered, and that the v4/v5 actions still run on GitHub's current Node runtime;
  - that `npx playwright install --with-deps chromium` gets the pinned alpha's Chromium on Linux and Windows;
  - that a single-file artifact uploads as the README describes (a zip, the execute bit lost);
  - closing a Windows Terminal tab (not scriptable), and the owner's double-click from Explorer.
- **Unpinned transitive packages.** `requirements.txt` pins only the top-level packages. Transitive ones (anyio, h11, click, and what FastAPI pulls in) float, so a build months later may bundle different versions. A lock file (`pip-compile` or `pip freeze` into a constraints file) would fix it; it is not part of this phase.
- **A flaky phase 5b test** (see the Prerequisite): `test_the_poll_tells_when_a_keyboard_is_plugged_in_or_the_error_changes` should wait for the `disconnected` event itself (or poll `GET /api/session`) instead of stopping at the first `keyboards` event.
- **Phase 7:** a firmware flasher UI on `protocol/flasher.py` (the roadmap's optional phase).
- **Backlog:** "swap layers", the owner's next iteration.
- **A windowless build** (a background process, reopened by double-click, quitting when no tab is open): the roadmap leaves it until after all phases.

## Owner checklist (after the last task)

The owner runs this, not you, on the W-CORNE.

1. **Windows.** Copy `Vial.exe` from the CI artifact `vial-windows` (or the local `dist/Vial.exe`) into any folder and double-click it.
   - The console opens, the browser opens, and the W-CORNE shows.
   - Use it as usual, then click "Quit Vial": the tab says Vial has stopped, and the console closes.
   - Run it again and close the console window instead: Vial stops (the next start works at once and finds no Vial running).
2. **Linux.** Download the CI artifact `vial-linux`, then `chmod +x vial`. Add Vial's udev rule if it isn't set yet (the README links the instructions). Run `./vial`: check that the keyboard shows and that Quit works.
3. **A short phase 5 check in the executable:** change a key and put it back; open a macro and close it; run the Matrix tester.
4. **Read the README.**

---

### Task 1: `resources.py` finds the bundled files, from source and in the one-file executable

`vial_web.py` found the built web UI by path arithmetic from its own file, and `qmk_settings_codec.py` found `qmk_settings.json` the same way. Neither works inside a one-file executable, which unpacks itself to a temporary folder (`sys._MEIPASS`). `resources.py` now holds one table of what Vial ships:

- `Resource(source, bundled)`: where it is in the repository, and where `vial.spec` (Task 8) puts it in the bundle. `WEB_DIST` is `web/dist` → `web`, and `QMK_SETTINGS` is `src/main/resources/base/qmk_settings.json` → `qmk_settings.json`.
- `path(resource)` reads the repository from source, or `sys._MEIPASS` when frozen (`is_frozen()`: `sys.frozen` and `sys._MEIPASS` both set).
- `web_ui_missing()` says why the web UI can't be served, with the command that builds it. From source, `serve()` prints it to the console, and the placeholder page shows the command too.
- `pyinstaller_datas()` gives `vial.spec` its `datas`, and refuses (`FileNotFoundError`) when anything is missing, so an executable is never built without the web UI.

The keymaps are Python modules, so PyInstaller bundles them as code; user data stays in the platformdirs data dir, never next to the executable and never in the unpack folder.

**Files:**
- Create: `src/main/python/resources.py`
- Test: `src/main/python/test/test_resources.py` (new)
- Modify: `src/main/python/protocol/qmk_settings_codec.py`
- Modify: `src/main/python/server/app.py`
- Modify: `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_resources.py`:

```python
import json
import os
import sys

import pytest

import resources
from protocol.qmk_settings_codec import QmkSettingsCodec

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))


@pytest.fixture
def frozen(monkeypatch, tmp_path):
    """ Running as the one-file executable, unpacked to tmp_path """
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    return tmp_path


@pytest.fixture
def from_source(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)


@pytest.fixture
def source_root(monkeypatch, tmp_path):
    """ A repository at tmp_path holding the resources, but no web UI built """
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(tmp_path))
    settings = tmp_path / "src" / "main" / "resources" / "base"
    settings.mkdir(parents=True)
    (settings / "qmk_settings.json").write_text('{"tabs": []}', encoding="utf-8")
    return tmp_path


def build_web_ui(root):
    dist = root / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("", encoding="utf-8")


def test_source_root_is_the_repository():
    assert os.path.normcase(resources.SOURCE_ROOT) == os.path.normcase(REPO)
    assert os.path.isfile(os.path.join(resources.SOURCE_ROOT, "src", "main", "python", "resources.py"))


def test_from_source_the_repository_files_are_read(from_source):
    assert not resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(REPO, "web", "dist")
    settings = resources.path(resources.QMK_SETTINGS)
    assert settings == os.path.join(REPO, "src", "main", "resources", "base", "qmk_settings.json")
    assert os.path.isfile(settings)


def test_frozen_the_unpacked_folder_is_read(frozen):
    assert resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(str(frozen), "web")
    assert resources.path(resources.QMK_SETTINGS) == os.path.join(str(frozen), "qmk_settings.json")


def test_frozen_by_another_tool_without_an_unpacked_folder_reads_the_repository(monkeypatch):
    # sys.frozen alone (another freezer, or a one-folder build that sets no _MEIPASS) is not PyInstaller's one-file
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    assert not resources.is_frozen()
    assert resources.path(resources.WEB_DIST) == os.path.join(REPO, "web", "dist")


def test_settings_definitions_are_read_from_the_unpacked_folder_when_frozen(frozen, monkeypatch):
    with open(os.path.join(REPO, "src", "main", "resources", "base", "qmk_settings.json"), encoding="utf-8") as inf:
        definitions = json.load(inf)
    definitions["tabs"] = definitions["tabs"][:1]
    (frozen / "qmk_settings.json").write_text(json.dumps(definitions), encoding="utf-8")
    monkeypatch.setattr(QmkSettingsCodec, "settings_defs", None)
    monkeypatch.setattr(QmkSettingsCodec, "qsid_fields", None)
    QmkSettingsCodec.load()
    assert QmkSettingsCodec.settings_defs == definitions


def test_web_ui_missing_says_how_to_build_it(from_source, source_root):
    problem = resources.web_ui_missing()
    assert problem is not None
    assert os.path.join(str(source_root), "web", "dist", "index.html") in problem
    assert "cd web && npm ci && npm run build" in problem
    build_web_ui(source_root)
    assert resources.web_ui_missing() is None


def test_web_ui_missing_when_frozen_looks_in_the_unpacked_folder(frozen):
    assert resources.web_ui_missing() is not None
    (frozen / "web").mkdir()
    (frozen / "web" / "index.html").write_text("<!doctype html>", encoding="utf-8")
    assert resources.web_ui_missing() is None


def test_pyinstaller_datas_put_each_resource_at_its_bundled_path(from_source, source_root):
    build_web_ui(source_root)
    assert resources.pyinstaller_datas() == [
        (os.path.join(str(source_root), "web", "dist"), "web"),
        (os.path.join(str(source_root), "src", "main", "resources", "base", "qmk_settings.json"), "."),
    ]


def test_pyinstaller_datas_refuse_a_build_without_the_web_ui(from_source, source_root):
    with pytest.raises(FileNotFoundError, match="npm run build"):
        resources.pyinstaller_datas()


def test_pyinstaller_datas_refuse_a_build_without_a_resource(from_source, source_root):
    build_web_ui(source_root)
    os.remove(os.path.join(str(source_root), "src", "main", "resources", "base", "qmk_settings.json"))
    with pytest.raises(FileNotFoundError, match="qmk_settings.json"):
        resources.pyinstaller_datas()
```

`test_vial_web.py`: the console says how to build a missing web UI, and the takeover test allows that line on stderr (tests from source may run without the UI built):

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -11,6 +11,7 @@ import threading
 import pytest
 import uvicorn
 
+import resources
 import vial_web
 from protocol.unlock_hook import set_unlock_handler
 from server import device as device_module
@@ -394,7 +395,8 @@ def test_launch_takes_over_when_the_starting_one_exits(home, fake_server, capsys
         other.wait()
     out, err = capsys.readouterr()
     assert fake_server.seen["session"]["url"] in out
-    assert err == ""
+    # nothing else is said, but that the web UI isn't built when it isn't (tests from source may run without it)
+    assert [line for line in err.splitlines() if "the web UI isn't built" not in line] == []
 
 
 def test_lock_file_that_cannot_be_opened_is_a_clear_error(home, no_keyboard, monkeypatch, capsys):
@@ -496,6 +498,14 @@ def test_serving_announces_the_bound_port_and_cleans_up(home, fake_server, capsy
     assert not os.path.exists(vial_web.session_file(True))
 
 
+def test_serving_without_the_web_ui_built_says_how_to_build_it(home, fake_server, monkeypatch, capsys):
+    monkeypatch.setattr(resources, "WEB_DIST", resources.Resource("web/not-built", "web"))
+    assert vial_web.main(["--fake", "--no-browser"]) == 0
+    out, err = capsys.readouterr()
+    assert "the web UI isn't built" in err and "cd web && npm ci && npm run build" in err
+    assert "Open it at" in out  # the API and the page that says so are served all the same
+
+
 def test_instance_is_claimed_before_connecting_and_released_at_exit(home, fake_server, monkeypatch):
     claimed_while_connecting = []
     connect = DeviceManager.connect
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_resources.py test/test_vial_web.py
```

Expected: `ModuleNotFoundError: No module named 'resources'` and `2 errors`.

- [ ] **Step 3: The resources module, used by the QMK settings, `vial_web.py` and the placeholder page**

Create `src/main/python/resources.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Where Vial's bundled files are: the built web UI and the QMK settings definitions.

From source they are read from the repository. In the one-file executable they are read from the folder PyInstaller
unpacks it to at start (sys._MEIPASS), where vial.spec puts each one at its `bundled` path. That folder is temporary:
user data never goes there, nor next to the executable (see vial_web.data_dir).
"""
import os
import sys
from typing import NamedTuple

SOURCE_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
""" the repository's root, when running from source """


class Resource(NamedTuple):
    source: str
    """ where it is in the repository, '/'-separated """
    bundled: str
    """ where it is in the one-file executable's unpacked folder, '/'-separated """


WEB_DIST = Resource("web/dist", "web")
""" the built web UI (cd web && npm ci && npm run build) """
QMK_SETTINGS = Resource("src/main/resources/base/qmk_settings.json", "qmk_settings.json")
""" the QMK settings Vial knows, grouped as the Settings page shows them """
BUNDLED = (WEB_DIST, QMK_SETTINGS)
""" every file or folder vial.spec bundles """


def is_frozen():
    """ Whether this is the one-file executable (PyInstaller sets sys.frozen and sys._MEIPASS) """
    return bool(getattr(sys, "frozen", False)) and getattr(sys, "_MEIPASS", None) is not None


def path(resource):
    """ The resource's path: in the unpacked executable when frozen, else in the repository """
    if is_frozen():
        return os.path.join(sys._MEIPASS, *resource.bundled.split("/"))
    return os.path.join(SOURCE_ROOT, *resource.source.split("/"))


WEB_BUILD_HINT = "build it first: cd web && npm ci && npm run build"


def web_ui_missing():
    """ Why the built web UI can't be served (a message saying how to build it), or None when it is there """
    index = os.path.join(path(WEB_DIST), "index.html")
    if os.path.isfile(index):
        return None
    return "the web UI isn't built ({} is missing): {}".format(os.path.normpath(index), WEB_BUILD_HINT)


def pyinstaller_datas():
    """ vial.spec's `datas`, from the repository: (path in the repository, folder in the bundle) for each resource. A
    folder is copied into the folder of its bundled path, a file into the folder its bundled path names ("." for the
    top). FileNotFoundError when one is missing, so that an executable is never built without it. """
    problem = web_ui_missing()
    if problem:
        raise FileNotFoundError(problem)
    datas = []
    for resource in BUNDLED:
        source = os.path.join(SOURCE_ROOT, *resource.source.split("/"))
        if not os.path.exists(source):
            raise FileNotFoundError("{} is missing".format(os.path.normpath(source)))
        if os.path.isdir(source):
            datas.append((source, resource.bundled))
        else:
            datas.append((source, os.path.dirname(resource.bundled) or "."))
    return datas
```

Apply to `src/main/python/protocol/qmk_settings_codec.py`:

```diff
diff --git a/src/main/python/protocol/qmk_settings_codec.py b/src/main/python/protocol/qmk_settings_codec.py
--- a/src/main/python/protocol/qmk_settings_codec.py
+++ b/src/main/python/protocol/qmk_settings_codec.py
@@ -1,11 +1,9 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
 """ Encodes and decodes QMK settings values, driven by qmk_settings.json. Must not import Qt. """
 import json
-import os
 from collections import defaultdict
 
-DEFAULT_DEFINITIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
-                                   "..", "..", "resources", "base", "qmk_settings.json")
+import resources
 
 
 class QmkSettingsCodec:
@@ -15,9 +13,9 @@ class QmkSettingsCodec:
 
     @classmethod
     def load(cls, path=None):
-        """ Load setting definitions; the default path works when running from source """
+        """ Load setting definitions: from path, by default the qmk_settings.json bundled with Vial """
         cls.qsid_fields = defaultdict(list)
-        with open(path or DEFAULT_DEFINITIONS, "r", encoding="utf-8") as inf:
+        with open(path or resources.path(resources.QMK_SETTINGS), "r", encoding="utf-8") as inf:
             cls.settings_defs = json.load(inf)
         for tab in cls.settings_defs["tabs"]:
             for field in tab["fields"]:
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -20,6 +20,8 @@ from logging.handlers import RotatingFileHandler
 
 import platformdirs
 
+import resources
+
 APP_NAME = "Vial"
 FAKE_SUBDIR = "fake"
 """ Fake mode keeps its own instance lock, server.json, vial.log and names.json in this subfolder of the data and
@@ -508,15 +510,19 @@ def serve(args, manager, sock):
     token = secrets.token_urlsafe(24)
     instance = secrets.token_hex(8)
     url = "http://127.0.0.1:{}/?token={}".format(port, token)
-    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "web", "dist")
+    missing_ui = resources.web_ui_missing()
+    if missing_ui:
+        # from source only: the executable always has it (vial.spec refuses to build without it)
+        print("Vial: {}, then start Vial again. Until then the page only says so.".format(missing_ui), file=sys.stderr,
+              flush=True)
     names = NamesStore(names_file(args.fake))
 
     def all_tabs_closed():
         print(REOPEN_MESSAGE.format(url=url), flush=True)
         logging.info("all browser tabs closed")
 
-    app = create_app(manager, names, token, port, static_dir=static_dir, on_all_clients_gone=all_tabs_closed,
-                     instance_id=instance)
+    app = create_app(manager, names, token, port, static_dir=resources.path(resources.WEB_DIST),
+                     on_all_clients_gone=all_tabs_closed, instance_id=instance)
 
     write_session({"port": port, "url": url, "instance": instance, "fake": bool(args.fake)})
     try:
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -49,7 +49,8 @@ PLACEHOLDER_PAGE = """<!doctype html>
 <html><head><meta charset="utf-8"><title>Vial</title></head>
 <body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
 <h1>Vial server is running</h1>
-<p>The web interface isn't built yet. The API is available under <code>/api</code>.</p>
+<p>The web interface isn't built yet. Build it with <code>cd web &amp;&amp; npm ci &amp;&amp; npm run build</code>, then start
+Vial again. The API is available under <code>/api</code>.</p>
 <script>
 // an open events connection is how Vial knows this tab is open, and tells in its terminal once all are closed
 (function connect() {
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_resources.py test/test_vial_web.py
```

Expected: `127 passed, 1 skipped`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1023 passed, 1 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/protocol/qmk_settings_codec.py \
  src/main/python/resources.py \
  src/main/python/server/app.py \
  src/main/python/test/test_resources.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py
git commit -m "feat: resources.py finds the bundled files from source and in the one-file executable"
```

### Task 2: Quit on the server: `POST /api/shutdown`, the `stopped` event, a stopped device manager, the shutdown grace

Quit Vial from the page needs a route that stops the server cleanly, closing the keyboard first.

`POST /api/shutdown` has the token and Host/Origin checks of every route. It answers 204 once the following is done:
- the unlock follower and the matrix watcher stop;
- the keyboard is closed (`manager.close`);
- every tab gets `{"type": "stopped"}`, the last event.

Then a background task calls `on_stop`, which `vial_web.serve()` makes set uvicorn's `should_exit` and print `QUIT_MESSAGE`. Calls made at the same time share one close (`asyncio.shield` of one task) and each answers 204. A server created without `on_stop` (the tests, `dump_openapi`) answers 501.

`DeviceManager.close()` now sets `stopped`. After it, `check()` looks for no keyboard, and `connect()` and `select()` open none: the hot-plug poll must not open the keyboard again while the server stops.

uvicorn waits at most `SHUTDOWN_GRACE` (2 s) for the tabs' connections once it stops (`timeout_graceful_shutdown`). The reason is in the Decisions: on Windows a connection the browser reset may never be let go of. Without the grace, some servers took Quit and never exited.

On the web side the generated types get the new event. `events.ts` passes a `stopped` event on and then closes the link for good: no "closed" state, and no reconnect.

**Files:**
- Modify: `src/main/python/server/device.py`
- Modify: `src/main/python/server/schemas.py`
- Modify: `src/main/python/server/app.py`
- Modify: `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_shutdown.py` (new)
- Test: `src/main/python/test/test_device_manager.py`
- Test: `src/main/python/test/test_dump_openapi.py`
- Test: `src/main/python/test/test_vial_web.py`
- Modify: `web/src/api/events.ts`
- Test: `web/src/api/events.test.ts`
- Regenerate: `web/src/api/schema.d.ts` (`npm run gen:api`)

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_shutdown.py`:

```python
""" Quit Vial: POST /api/shutdown lets go of the keyboard, tells every tab, and stops the server once it has answered """
import pytest
from fastapi.testclient import TestClient

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne
from test.test_api import BASE, EVENTS, ORIGIN, PORT, TOKEN


@pytest.fixture
def quitting(tmp_path, monkeypatch):
    """ (client with a session cookie, device manager, what on_stop saw each time it was called) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    stops = []

    def on_stop():
        # what the server stopping finds: the keyboard let go of already
        stops.append({"keyboard": manager.keyboard, "stopped": manager.stopped})

    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0, on_stop=on_stop)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/?token=" + TOKEN, follow_redirects=False).status_code == 303
        yield client, manager, stops
    set_unlock_handler(None)


def test_quit_lets_go_of_the_keyboard_then_stops_the_server(quitting):
    client, manager, stops = quitting
    device = manager.device
    response = client.post("/api/shutdown", headers=ORIGIN)
    assert response.status_code == 204
    assert response.content == b""
    assert device.closed
    assert stops == [{"keyboard": None, "stopped": True}]


def test_quit_tells_every_tab_that_vial_stopped(quitting):
    client, manager, stops = quitting
    with client.websocket_connect(EVENTS, headers=ORIGIN) as first, \
            client.websocket_connect(EVENTS, headers=ORIGIN) as second:
        assert first.receive_json() == {"type": "connected"}
        assert second.receive_json() == {"type": "connected"}
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
        assert first.receive_json() == {"type": "stopped"}
        assert second.receive_json() == {"type": "stopped"}


def test_after_quit_no_keyboard_is_opened_again(quitting):
    """ The server is stopping: the hot-plug poll doesn't find the keyboard still plugged in, and edits are refused """
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert manager.backend.virtual is not None  # still plugged in
    assert manager.check() == []
    assert manager.keyboard is None
    assert client.get("/api/session").json()["status"] == "disconnected"
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}, headers=ORIGIN).status_code == 503


def test_quit_asked_twice_answers_both_times(quitting):
    client, manager, stops = quitting
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 204
    assert [s["stopped"] for s in stops] == [True, True]  # uvicorn's should_exit, set twice


def test_quit_is_protected_like_every_route(quitting):
    client, manager, stops = quitting
    other_site = {"origin": "http://evil.example"}
    assert client.post("/api/shutdown", headers=other_site).status_code == 403
    assert client.post("/api/shutdown", headers={**ORIGIN, "host": "evil.example"}).status_code == 403
    client.cookies.clear()
    assert client.post("/api/shutdown", headers=ORIGIN).status_code == 401
    assert stops == []
    assert manager.keyboard is not None


def test_quit_is_refused_by_a_server_that_cannot_be_stopped_from_the_page(tmp_path, monkeypatch):
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as client:
        client.get("/?token=" + TOKEN, follow_redirects=False)
        assert client.post("/api/shutdown", headers=ORIGIN).status_code == 501
        assert manager.keyboard is not None


def test_quit_is_in_the_api_schema(quitting):
    client, manager, stops = quitting
    schema = client.get("/openapi.json").json()
    assert "204" in schema["paths"]["/api/shutdown"]["post"]["responses"]
    assert "stopped" in schema["components"]["schemas"]["Event"]["properties"]["type"]["enum"]
```

Apply to `src/main/python/test/test_device_manager.py`:

```diff
diff --git a/src/main/python/test/test_device_manager.py b/src/main/python/test/test_device_manager.py
--- a/src/main/python/test/test_device_manager.py
+++ b/src/main/python/test/test_device_manager.py
@@ -33,6 +33,20 @@ def test_run_without_keyboard_raises():
         m.run(lambda kb: None)
 
 
+def test_closed_the_manager_opens_no_keyboard_any_more(manager):
+    """ The server is stopping: the keyboard still plugged in is neither looked for nor opened again """
+    found = []
+    find = manager.backend.find
+    manager.backend.find = lambda: found.append(True) or find()
+    manager.close()
+    assert not manager.connected
+    assert manager.check() == []
+    assert found == []
+    assert not manager.connect()
+    assert manager.select(manager.listed[0].id) is False
+    assert manager.device is None
+
+
 def test_unplug_and_replug_are_reported(manager):
     manager.backend.virtual.connected = False
     assert manager.check() == ["disconnected"]
```

Apply to `src/main/python/test/test_dump_openapi.py`:

```diff
diff --git a/src/main/python/test/test_dump_openapi.py b/src/main/python/test/test_dump_openapi.py
--- a/src/main/python/test/test_dump_openapi.py
+++ b/src/main/python/test/test_dump_openapi.py
@@ -20,13 +20,13 @@ def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
     assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
     assert "/api/simulator/matrix" not in schema["paths"] and "/api/simulator/second-keyboard" not in schema["paths"]
     assert {"/api/keyboards", "/api/keyboards/select"} <= set(schema["paths"])
-    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/bootloader", "/api/lighting/save"} <= set(
-        schema["paths"])
+    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock", "/api/bootloader", "/api/lighting/save",
+            "/api/shutdown"} <= set(schema["paths"])
     assert "/" not in schema["paths"]  # the page, not the API
     # what /api/events sends (WebSockets have no place in OpenAPI's paths)
     event = schema["components"]["schemas"]["Event"]
     assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded", "unlock", "matrix",
-                                                        "keyboards"}
+                                                        "keyboards", "stopped"}
     assert "UnlockState" in schema["components"]["schemas"] and "MatrixState" in schema["components"]["schemas"]
     options = schema["paths"]["/api/layout-options"]["put"]["responses"]["200"]["content"]["application/json"]
     assert options["schema"] == {"$ref": "#/components/schemas/LayoutOptionsValue"}
```

`test_vial_web.py`: the page's Quit stops the server once the keyboard is closed, and uvicorn's grace is set:

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -464,6 +464,8 @@ class FakeServer:
 
     def __init__(self, config):
         FakeServer.seen["app"] = config.app
+        FakeServer.seen["config"] = config
+        FakeServer.seen["server"] = self
 
     def run(self, sockets):
         (sock,) = sockets
@@ -498,6 +500,33 @@ def test_serving_announces_the_bound_port_and_cleans_up(home, fake_server, capsy
     assert not os.path.exists(vial_web.session_file(True))
 
 
+def test_quit_on_the_page_stops_the_server_once_the_keyboard_is_let_go_of(home, fake_server, monkeypatch, capsys):
+    from fastapi.testclient import TestClient
+    opened = []
+
+    class Device(SimulatedHidDevice):
+        def __init__(self, keyboard):
+            super().__init__(keyboard)
+            opened.append(self)
+
+    def quit_on_the_page():
+        port = fake_server.seen["address"][1]
+        base = "http://127.0.0.1:{}".format(port)
+        with TestClient(fake_server.seen["app"], base_url=base) as page:
+            assert page.get(fake_server.seen["session"]["url"], follow_redirects=False).status_code == 303
+            assert not getattr(fake_server.seen["server"], "should_exit", False)
+            fake_server.seen["quit"] = page.post("/api/shutdown", headers={"origin": base}).status_code
+            fake_server.seen["closed"] = [d.closed for d in opened]
+    monkeypatch.setattr(device_module, "SimulatedHidDevice", Device)
+    fake_server.while_serving = quit_on_the_page
+    assert vial_web.main(["--fake", "--no-browser"]) == 0
+    assert fake_server.seen["quit"] == 204
+    assert fake_server.seen["closed"] == [True]  # by the time it answered
+    assert fake_server.seen["server"].should_exit is True  # uvicorn stops
+    assert vial_web.QUIT_MESSAGE in capsys.readouterr().out
+    assert not os.path.exists(vial_web.session_file(True))
+
+
 def test_serving_without_the_web_ui_built_says_how_to_build_it(home, fake_server, monkeypatch, capsys):
     monkeypatch.setattr(resources, "WEB_DIST", resources.Resource("web/not-built", "web"))
     assert vial_web.main(["--fake", "--no-browser"]) == 0
@@ -506,6 +535,12 @@ def test_serving_without_the_web_ui_built_says_how_to_build_it(home, fake_server
     assert "Open it at" in out  # the API and the page that says so are served all the same
 
 
+def test_stopping_waits_for_the_tabs_only_so_long(home, fake_server):
+    """ a tab's connection reset by the browser may never close (see SHUTDOWN_GRACE) """
+    assert vial_web.main(["--fake", "--no-browser"]) == 0
+    assert fake_server.seen["config"].timeout_graceful_shutdown == vial_web.SHUTDOWN_GRACE
+
+
 def test_instance_is_claimed_before_connecting_and_released_at_exit(home, fake_server, monkeypatch):
     claimed_while_connecting = []
     connect = DeviceManager.connect
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_shutdown.py test/test_device_manager.py test/test_dump_openapi.py test/test_vial_web.py
```

Expected: `TypeError: create_app() got an unexpected keyword argument 'on_stop'` and `5 failed, 146 passed, 1 skipped, 6 errors`.

- [ ] **Step 3: The stopped device manager, the event, the route and `on_stop`**

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -575,6 +575,8 @@ class DeviceManager:
         """ candidate key -> (failed attempts, clock time of the next attempt) """
         self.present_error_logged = None
         """ clock time a failing present() was last logged """
+        self.stopped = False
+        """ close() was called: the server is stopping, and no keyboard is looked for or opened any more """
 
     @property
     def connected(self):
@@ -671,6 +673,8 @@ class DeviceManager:
         """ found: what _find() gave, if it was called already """
         with self.lock:
             self._close()
+            if self.stopped:
+                return False
             candidates, failure = self._find() if found is None else found
             if failure is not None:
                 log.error("could not list keyboards", exc_info=failure)
@@ -989,7 +993,10 @@ class DeviceManager:
     # ---------- hot-plug ----------
 
     def check(self):
-        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
+        """ Hot-plug poll, called about once a second. Returns the events since the last call; once stopped, it looks
+        for no keyboard. """
+        if self.stopped:
+            return self.take_events()
         # outside the device lock: listing every HID device can take a while on some systems, and requests to the
         # open keyboard go on meanwhile (as Qt's autorefresh thread lists them)
         found = self._find()
@@ -1042,8 +1049,9 @@ class DeviceManager:
             return None
 
     def close(self):
-        """ Let go of the keyboard: the server is stopping """
+        """ Let go of the keyboard: the server is stopping. No keyboard is opened from now on. """
         with self.lock:
+            self.stopped = True
             self._close()
 
     @staticmethod
```

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -241,9 +241,9 @@ class MatrixState(BaseModel):
 class Event(BaseModel):
     """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed; the
     keyboards plugged in, the one chosen or open, or why none could be read (Session.error) changed ("keyboards":
-    GET /api/keyboards and /api/session tell how); and, to a tab that asked for it ({"type": "matrix", "watch": true}),
-    the keys held, at every change """
-    type: Literal["connected", "disconnected", "reloaded", "unlock", "matrix", "keyboards"]
+    GET /api/keyboards and /api/session tell how); to a tab that asked for it ({"type": "matrix", "watch": true}), the
+    keys held, at every change; and Vial is stopping, as Quit Vial was used in a tab ("stopped": the last event) """
+    type: Literal["connected", "disconnected", "reloaded", "unlock", "matrix", "keyboards", "stopped"]
     unlock: Optional[UnlockState] = None
     """ with "unlock": the new state; sent at every change, and with each reading of the countdown """
     matrix: Optional[MatrixState] = None
```

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -10,7 +10,7 @@ import sys
 import urllib.parse
 from typing import Annotated, Literal
 
-from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
+from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
 from fastapi.openapi.utils import get_openapi
 from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
 from fastapi.staticfiles import StaticFiles
@@ -327,11 +327,13 @@ class UnlockFollower:
 
 def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
                poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL,
-               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP):
+               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP, on_stop=None):
     """
     manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
     static_dir: built UI (web/dist) or None for a placeholder page
     on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
+    on_stop: stops the server (uvicorn's should_exit), called once POST /api/shutdown has answered; None: that route
+    refuses (501)
     poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
     matrix_interval, matrix_gap: the matrix tester's readings (MatrixWatcher)
     """
@@ -786,6 +788,30 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
             await broadcast_events(await asyncio.to_thread(manager.take_events))
         return await asyncio.to_thread(session)
 
+    stopping = []
+    """ the task letting go of the keyboard, once POST /api/shutdown was asked """
+
+    async def let_go():
+        await follower.shutdown()
+        await matrix.shutdown()
+        await asyncio.to_thread(manager.close)
+        log.info("the keyboard was let go of: stopping, as asked from the page")
+        await hub.broadcast({"type": "stopped"})
+
+    @app.post("/api/shutdown", status_code=204, response_class=Response)
+    async def shutdown(background: BackgroundTasks):
+        """ Quit Vial: the keyboard is let go of (an unlock followed and the matrix tester stop first, and no keyboard
+        is opened any more), every tab is told ("stopped" event: Vial is gone for good, there is nothing to reconnect
+        to), and the server stops once it has answered. Asked again meanwhile, it answers the same, once that is
+        done. """
+        if on_stop is None:
+            raise HTTPException(501, "this server can't be stopped from the page")
+        if not stopping:
+            stopping.append(asyncio.ensure_future(let_go()))
+        await asyncio.shield(stopping[0])
+        background.add_task(on_stop)
+        return Response(status_code=204)
+
     @app.websocket("/api/events")
     async def events(ws: WebSocket):
         if ws.headers.get("host") not in allowed_hosts or \
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -43,6 +43,10 @@ MAX_UNLOCK_COUNTER = 255
 LIGHTING_KINDS = ("none", "qmk_backlight", "qmk_rgblight", "qmk_backlight_rgblight", "vialrgb")
 """ --lighting: what vial.json's "lighting" can say (simulator.corne.LIGHTING; not imported, as a real launch never
 loads the simulator) """
+SHUTDOWN_GRACE = 2
+""" seconds the server waits, once stopping, for the tabs' connections to close. A connection the browser reset (a tab
+or a browser killed) may never be let go of on Windows: asyncio's proactor transport fails to shut such a socket down
+before it tells the server the connection is gone, and the server would wait for it forever. """
 UVICORN_LOGGING = {
     "version": 1,
     "disable_existing_loggers": False,
@@ -58,6 +62,8 @@ REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
   {url}
 Press Ctrl+C to stop."""
 
+QUIT_MESSAGE = "Quit Vial was used on the page: Vial is stopping."
+
 log = logging.getLogger(__name__)
 
 _data_root = None
@@ -501,7 +507,7 @@ def load_layout_file(manager, path):
 
 
 def serve(args, manager, sock):
-    """ Serve the UI on the bound socket until Ctrl+C """
+    """ Serve the UI on the bound socket until Quit Vial on the page (POST /api/shutdown) or Ctrl+C """
     import uvicorn
     from server.app import create_app
     from server.names import NamesStore
@@ -521,8 +527,23 @@ def serve(args, manager, sock):
         print(REOPEN_MESSAGE.format(url=url), flush=True)
         logging.info("all browser tabs closed")
 
+    server = None
+
+    def stop_server():
+        """ Ask the server to stop, as Ctrl+C does (from any thread) """
+        if server is not None:
+            server.should_exit = True
+
+    def quit_from_page():
+        # POST /api/shutdown has answered, and closed the keyboard
+        print(QUIT_MESSAGE, flush=True)
+        logging.info("Quit Vial was used on the page")
+        stop_server()
+
     app = create_app(manager, names, token, port, static_dir=resources.path(resources.WEB_DIST),
-                     on_all_clients_gone=all_tabs_closed, instance_id=instance)
+                     on_all_clients_gone=all_tabs_closed, instance_id=instance, on_stop=quit_from_page)
+    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", log_config=UVICORN_LOGGING,
+                                           timeout_graceful_shutdown=SHUTDOWN_GRACE))
 
     write_session({"port": port, "url": url, "instance": instance, "fake": bool(args.fake)})
     try:
@@ -531,7 +552,7 @@ def serve(args, manager, sock):
         logging.info("serving on port %d", port)
         if not args.no_browser:
             threading.Thread(target=webbrowser.open, args=[url], daemon=True).start()
-        uvicorn.Server(uvicorn.Config(app, log_level="warning", log_config=UVICORN_LOGGING)).run(sockets=[sock])
+        server.run(sockets=[sock])
     except KeyboardInterrupt:
         pass  # uvicorn shuts down cleanly on Ctrl+C, then raises it again
     finally:
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_shutdown.py test/test_device_manager.py test/test_dump_openapi.py test/test_vial_web.py
```

Expected: `157 passed, 1 skipped`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1033 passed, 1 skipped`.

- [ ] **Step 5: The events link ends on `stopped`: the failing test first**

Apply to `web/src/api/events.test.ts`:

```diff
diff --git a/web/src/api/events.test.ts b/web/src/api/events.test.ts
--- a/web/src/api/events.test.ts
+++ b/web/src/api/events.test.ts
@@ -240,3 +240,17 @@ describe("the matrix tester on the events link", () => {
     expect(FakeSocket.latest.sent).toEqual([]);
   });
 });
+
+describe("Vial stopping", () => {
+  it("passes on the stopped event, then closes the link for good: it isn't opened again", () => {
+    connect();
+    FakeSocket.latest.accept();
+    FakeSocket.latest.deliver(JSON.stringify({ type: "stopped" }));
+    expect(events).toEqual([{ type: "stopped" }]);
+    expect(FakeSocket.latest.closed).toBe(true);
+    vi.advanceTimersByTime(60_000);
+    expect(FakeSocket.all).toHaveLength(1);
+    // the link didn't drop: it ended
+    expect(links).toEqual(["connecting", "open"]);
+  });
+});
```

```bash
cd web && npx vitest run src/api/events.test.ts
```

Expected: `AssertionError: expected [] to deeply equal [ { type: 'stopped' } ]` and `Tests  1 failed | 13 passed (14)`.

- [ ] **Step 6: The link, then the API types regenerated and every web check**

Apply to `web/src/api/events.ts`:

```diff
diff --git a/web/src/api/events.ts b/web/src/api/events.ts
--- a/web/src/api/events.ts
+++ b/web/src/api/events.ts
@@ -1,5 +1,6 @@
-// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed; and,
-// while the page asks for them, the keys held (the matrix tester).
+// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed; while
+// the page asks for them, the keys held (the matrix tester); and Vial stopping (Quit Vial), after which the link isn't
+// opened again.
 import type { ServerEvent } from "./types";
 
 export type { ServerEvent };
@@ -19,7 +20,7 @@ const RETRY_FIRST_MS = 500;
 const RETRY_MAX_MS = 5000;
 
 const EVENTS: Record<ServerEvent["type"], true> = {
-  connected: true, disconnected: true, reloaded: true, unlock: true, matrix: true, keyboards: true,
+  connected: true, disconnected: true, reloaded: true, unlock: true, matrix: true, keyboards: true, stopped: true,
 };
 
 /** An event of a known type; an "unlock" one must carry the unlock state, a "matrix" one the keys held */
@@ -34,7 +35,8 @@ function isServerEvent(frame: unknown): frame is ServerEvent {
   return true;
 }
 
-/** Keeps a WebSocket to /api/events open, reconnecting when it drops */
+/** Keeps a WebSocket to /api/events open, reconnecting when it drops; after a "stopped" event it closes for good, as
+ * there is nothing to reconnect to */
 export function connectEvents(
   onEvent: (event: ServerEvent) => void,
   onLink: (state: LinkState) => void,
@@ -62,7 +64,14 @@ export function connectEvents(
       } catch {
         return; // not JSON: not an event
       }
-      if (isServerEvent(frame)) onEvent(frame);
+      if (!isServerEvent(frame)) return;
+      if (frame.type === "stopped") {
+        // Vial is stopping: the link ends, without the "closed" a drop would bring
+        stopped = true;
+        clearTimeout(timer);
+        current.close();
+      }
+      onEvent(frame);
     };
     current.onclose = () => {
       socket = null;
```

```bash
cd web && npm run gen:api && npm run check:api && npm run check && npm test
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date` and `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  811 passed (811)`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/device.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_device_manager.py \
  src/main/python/test/test_dump_openapi.py \
  src/main/python/test/test_shutdown.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py \
  web/src/api/events.test.ts \
  web/src/api/events.ts \
  web/src/api/schema.d.ts
git commit -m "feat(server): Quit Vial: POST /api/shutdown lets go of the keyboard, tells every tab and stops the server"
```

### Task 3: Closing the console window, Ctrl+Break or Ctrl+C stops Vial cleanly

The console window stays: it shows the link and the reopen message. Ctrl+C already reached Python as `KeyboardInterrupt`, which uvicorn stops on. Closing the window did not stop Vial cleanly: Windows ends the process as soon as its console handlers return, or 5 s after the event at the latest.

`console.py`:
- `ConsoleStop(stop, wait)` decides what each console event does:
  - Ctrl+C is left to Python (`False`);
  - Ctrl+Break calls `stop()` and lets the process run on, because uvicorn would otherwise end the process before the keyboard is closed;
  - a closed window, log-off and shutdown call `stop()`, then wait until `released()`, at most `CLOSE_WAIT` (4.5 s).
- `StopOnConsoleClose(stop)` is a `with` block. On Windows it installs `ConsoleStop` as a console control handler (`SetConsoleCtrlHandler`). It first turns Ctrl+C processing back on, because Windows passes "ignore Ctrl+C" on to child processes. Elsewhere it handles SIGHUP (a closed terminal) by calling `stop()`. Leaving the block releases a waiting close and removes the handler.

`serve()` runs uvicorn inside that block, and its `finally` closes the keyboard (`manager.close()`) inside the window a close leaves. The console messages say how to stop Vial: Ctrl+C or closing the window. `SHUTDOWN_GRACE` (2 s) is shorter than `CLOSE_WAIT`, which the test now checks.

**Files:**
- Create: `src/main/python/console.py`
- Test: `src/main/python/test/test_console.py` (new)
- Modify: `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_console.py`:

```python
import signal
import sys
import threading
import time

import pytest

import console


def test_ctrl_c_is_left_to_python():
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True))
    assert stop.handle(console.CTRL_C_EVENT) is False
    assert stops == []


def test_ctrl_break_stops_the_server_and_lets_the_process_run_on():
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True), wait=60)
    started = time.monotonic()
    assert stop.handle(console.CTRL_BREAK_EVENT) is True
    assert time.monotonic() - started < 5  # doesn't wait for anything: the process isn't ended
    assert stops == [True]


@pytest.mark.parametrize("event", console.ENDING_EVENTS)
def test_closing_the_console_waits_until_vial_has_let_go_of_the_keyboard(event):
    stops = []
    stop = console.ConsoleStop(lambda: stops.append(True), wait=60)
    handled = []
    handler = threading.Thread(target=lambda: handled.append(stop.handle(event)))
    handler.start()
    handler.join(0.2)
    assert handler.is_alive()  # Windows ends the process once it returns: not yet
    assert stops == [True]
    stop.released()
    handler.join(5)
    assert handled == [True]


def test_closing_the_console_waits_only_so_long():
    stop = console.ConsoleStop(lambda: None, wait=0.05)
    assert stop.handle(console.CTRL_CLOSE_EVENT) is True


def test_unknown_events_are_left_to_others():
    stop = console.ConsoleStop(lambda: pytest.fail("stopped"))
    assert stop.handle(3) is False


def test_leaving_the_block_releases_a_close_waiting_for_it():
    with console.StopOnConsoleClose(lambda: None, wait=60) as stop:
        assert not stop.done.is_set()
    assert stop.done.is_set()


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no SIGHUP")
def test_a_closed_terminal_stops_the_server_and_the_signal_is_handled_as_before_afterwards():
    before = signal.getsignal(signal.SIGHUP)
    stops = []
    with console.StopOnConsoleClose(lambda: stops.append(True)):
        signal.getsignal(signal.SIGHUP)(signal.SIGHUP, None)
        assert stops == [True]
    assert signal.getsignal(signal.SIGHUP) == before


@pytest.mark.skipif(sys.platform != "win32", reason="the console handler is Windows'")
def test_the_console_handler_is_installed_while_in_the_block_and_removed_after(monkeypatch):
    installed = []
    real = console._Installed

    class Recorded(real):
        def __init__(self, console_stop):
            super().__init__(console_stop)
            installed.append(self)
            self.removed = False

        def uninstall(self):
            super().uninstall()
            self.removed = True
    monkeypatch.setattr(console, "_Installed", Recorded)
    stops = []
    with console.StopOnConsoleClose(lambda: stops.append(True)):
        (handler,) = installed
        assert not handler.removed
        # the routine Windows calls answers what ConsoleStop decides
        assert handler.routine(console.CTRL_C_EVENT) == 0 and stops == []
        assert handler.routine(console.CTRL_BREAK_EVENT) == 1 and stops == [True]
    assert handler.removed
```

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -11,6 +11,7 @@ import threading
 import pytest
 import uvicorn
 
+import console
 import resources
 import vial_web
 from protocol.unlock_hook import set_unlock_handler
@@ -536,9 +537,10 @@ def test_serving_without_the_web_ui_built_says_how_to_build_it(home, fake_server
 
 
 def test_stopping_waits_for_the_tabs_only_so_long(home, fake_server):
-    """ a tab's connection reset by the browser may never close (see SHUTDOWN_GRACE) """
+    """ a tab's connection reset by the browser may never close (see SHUTDOWN_GRACE); a console window closed gives
+    Vial CLOSE_WAIT seconds in all """
     assert vial_web.main(["--fake", "--no-browser"]) == 0
-    assert fake_server.seen["config"].timeout_graceful_shutdown == vial_web.SHUTDOWN_GRACE
+    assert fake_server.seen["config"].timeout_graceful_shutdown == vial_web.SHUTDOWN_GRACE < console.CLOSE_WAIT
 
 
 def test_instance_is_claimed_before_connecting_and_released_at_exit(home, fake_server, monkeypatch):
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_console.py test/test_vial_web.py
```

Expected: `ModuleNotFoundError: No module named 'console'` and `2 errors`.

- [ ] **Step 3: The console handler, and `serve()` inside it**

Create `src/main/python/console.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Closing Vial's console window stops it cleanly, as Ctrl+C does: the server stops and the keyboard is let go of.

Ctrl+C reaches Python as KeyboardInterrupt, and uvicorn stops on it. On Windows a console window being closed (or
logging off, shutting down) doesn't: Windows ends the process as soon as its console handlers return, or at the latest
5 seconds after the event. The handler installed here asks the server to stop and waits, up to CLOSE_WAIT seconds,
until Vial has let go of the keyboard (released()). Ctrl+Break is taken here too: uvicorn would stop on it, then end the
process with it before the keyboard is closed. Elsewhere a terminal closed sends SIGHUP, which would end the process at
once: it asks the server to stop instead.
"""
import signal
import sys
import threading

CTRL_C_EVENT = 0
CTRL_BREAK_EVENT = 1
CTRL_CLOSE_EVENT = 2
CTRL_LOGOFF_EVENT = 5
CTRL_SHUTDOWN_EVENT = 6
ENDING_EVENTS = (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT)
""" the process is ended once the handlers return """
CLOSE_WAIT = 4.5
""" seconds a close waits for Vial to stop: Windows ends the process 5 seconds after the event anyway """


class ConsoleStop:
    """ What a console event does: stop() asks the server to stop (from any thread), and the event's handler waits for
    released() before it lets the process end """

    def __init__(self, stop, wait=CLOSE_WAIT):
        self.stop = stop
        self.wait = wait
        self.done = threading.Event()

    def handle(self, event):
        """ The console control handler: True when the event is taken here (no other handler sees it) """
        if event == CTRL_BREAK_EVENT:
            self.stop()
            return True
        if event in ENDING_EVENTS:
            self.stop()
            self.done.wait(self.wait)
            return True
        return False  # Ctrl+C: Python's KeyboardInterrupt, which uvicorn stops on

    def released(self):
        """ Vial has stopped and let go of the keyboard: a close waiting for it lets the process end """
        self.done.set()


class _Installed:
    """ A ConsoleStop installed as a console control handler, until uninstall() """

    def __init__(self, console_stop):
        import ctypes
        from ctypes import wintypes
        self.console_stop = console_stop
        routine = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel32.SetConsoleCtrlHandler.argtypes = (routine, wintypes.BOOL)
        self.kernel32.SetConsoleCtrlHandler.restype = wintypes.BOOL
        # Ctrl+C reaches Vial even if what started it ignored Ctrl+C, which a process inherits
        self.kernel32.SetConsoleCtrlHandler(routine(), False)  # routine(): no routine (NULL)
        # kept: Windows calls it for as long as it is installed
        self.routine = routine(lambda event: bool(console_stop.handle(event)))
        if not self.kernel32.SetConsoleCtrlHandler(self.routine, True):
            raise ctypes.WinError(ctypes.get_last_error())

    def uninstall(self):
        self.kernel32.SetConsoleCtrlHandler(self.routine, False)


class StopOnConsoleClose:
    """ with StopOnConsoleClose(stop): ... -- while inside, closing the console window calls stop(), and on Windows
    waits for the block to end (at most CLOSE_WAIT seconds) before the process is ended. Entered in the main thread
    (where Python handles signals). """

    def __init__(self, stop, wait=CLOSE_WAIT):
        self.console_stop = ConsoleStop(stop, wait)
        self.installed = None
        self.hangup = False
        self.previous_hangup = None

    def __enter__(self):
        if sys.platform == "win32":
            self.installed = _Installed(self.console_stop)
        elif hasattr(signal, "SIGHUP"):
            self.previous_hangup = signal.signal(signal.SIGHUP, lambda signum, frame: self.console_stop.stop())
            self.hangup = True
        return self.console_stop

    def __exit__(self, *exc):
        self.console_stop.released()
        if self.installed is not None:
            self.installed.uninstall()
        if self.hangup:
            signal.signal(signal.SIGHUP, self.previous_hangup or signal.SIG_DFL)
        return False
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -20,6 +20,7 @@ from logging.handlers import RotatingFileHandler
 
 import platformdirs
 
+import console
 import resources
 
 APP_NAME = "Vial"
@@ -46,7 +47,8 @@ loads the simulator) """
 SHUTDOWN_GRACE = 2
 """ seconds the server waits, once stopping, for the tabs' connections to close. A connection the browser reset (a tab
 or a browser killed) may never be let go of on Windows: asyncio's proactor transport fails to shut such a socket down
-before it tells the server the connection is gone, and the server would wait for it forever. """
+before it tells the server the connection is gone, and the server would wait for it forever. Less than
+console.CLOSE_WAIT, so that a console window closed still lets Vial close the keyboard. """
 UVICORN_LOGGING = {
     "version": 1,
     "disable_existing_loggers": False,
@@ -56,11 +58,11 @@ UVICORN_LOGGING = {
 
 STARTED_MESSAGE = """Vial is running{fake}. Open it at:
   {url}
-Press Ctrl+C to stop."""
+To stop it, press Ctrl+C or close this window."""
 
 REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
   {url}
-Press Ctrl+C to stop."""
+To stop it, press Ctrl+C or close this window."""
 
 QUIT_MESSAGE = "Quit Vial was used on the page: Vial is stopping."
 
@@ -507,7 +509,8 @@ def load_layout_file(manager, path):
 
 
 def serve(args, manager, sock):
-    """ Serve the UI on the bound socket until Quit Vial on the page (POST /api/shutdown) or Ctrl+C """
+    """ Serve the UI on the bound socket until Quit Vial on the page, Ctrl+C or the console window closed. The keyboard
+    is let go of before it returns. """
     import uvicorn
     from server.app import create_app
     from server.names import NamesStore
@@ -546,17 +549,21 @@ def serve(args, manager, sock):
                                            timeout_graceful_shutdown=SHUTDOWN_GRACE))
 
     write_session({"port": port, "url": url, "instance": instance, "fake": bool(args.fake)})
-    try:
-        # the socket is already listening: the URL works from now on
-        print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
-        logging.info("serving on port %d", port)
-        if not args.no_browser:
-            threading.Thread(target=webbrowser.open, args=[url], daemon=True).start()
-        server.run(sockets=[sock])
-    except KeyboardInterrupt:
-        pass  # uvicorn shuts down cleanly on Ctrl+C, then raises it again
-    finally:
-        remove_session(instance, bool(args.fake))
+    with console.StopOnConsoleClose(stop_server):
+        try:
+            # the socket is already listening: the URL works from now on
+            print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
+            logging.info("serving on port %d", port)
+            if not args.no_browser:
+                threading.Thread(target=webbrowser.open, args=[url], daemon=True).start()
+            server.run(sockets=[sock])
+        except KeyboardInterrupt:
+            pass  # uvicorn shuts down cleanly on Ctrl+C, then raises it again
+        finally:
+            remove_session(instance, bool(args.fake))
+            # here, not only when run() returns: a console window closed ends the process once this block is left
+            manager.close()
+            logging.info("stopped, the keyboard let go of")
     return 0
 
 
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_console.py test/test_vial_web.py
```

Expected: `128 passed, 2 skipped`. The SIGHUP test is skipped on Windows; it runs on Linux and macOS in CI.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1042 passed, 2 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/console.py \
  src/main/python/test/test_console.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py
git commit -m "feat: closing the console window, Ctrl+Break or Ctrl+C stops Vial cleanly, the keyboard let go of first"
```

### Task 4: Quit in the web UI: the top-bar button, the confirmation, the stopped page

- **The store** (`keyboard.svelte.ts`):
  - `quit()` sends `POST /api/shutdown` once (`quitting` while it is on its way). On success it sets `stopped` and closes the events link for good. On failure it shows a toast ("Quitting Vial failed: …") and goes on as before.
  - A `stopped` event from another tab sets `stopped` too.
  - `api.shutdown()` is the route. `client.ts` types a 204 reply as `null`.
- **`TopBar`:** a "Quit Vial" button with a power icon at the right end, after the language list, on every page with or without a keyboard. It is `aria-disabled` and reads "Quitting…" while `quitting`, so it keeps the focus.
- **`App.svelte`:** with no unsaved work (`unsavedWork`), the button quits at once. Otherwise a danger `ConfirmDialog` "Quit Vial?" says "Vial stops and lets go of the keyboard. Not saved yet, and lost if you quit: …". Once `stopped`, `StoppedPage` replaces the whole app, and the page title becomes "Vial has stopped".
- **`StoppedPage`:** "Vial has stopped", "You can close this tab.", "To use Vial again, start it again." It is a dashed card at most `--list-max` wide, and its heading takes the focus.
- **The console message** now names Quit Vial: "To stop it, use Quit Vial on the page, press Ctrl+C or close this window."
- **e2e:**
  - Each quit test has a server of its own (the `ownServer` fixture), because it ends it. `TestServer` gives the exit code (`exited`) and the output.
  - Every e2e server is now asked to quit at the end (`askToQuit`: the link for a session cookie, then `POST /api/shutdown`). Only one that can't be asked is ended.
  - A server that takes Quit and doesn't exit within 5 s fails the run: that is how the shutdown grace (Task 2) was found.

**Files:**
- Modify: `web/src/api/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/lib/keyboard.svelte.ts`
- Test: `web/src/lib/keyboard.test.ts`
- Create: `web/src/shell/StoppedPage.svelte`
- Modify: `web/src/shell/TopBar.svelte`
- Modify: `web/src/App.svelte`
- Modify: `src/main/python/vial_web.py`
- Modify: `web/e2e/servers.ts`
- Modify: `web/e2e/fixtures.ts`
- Test: `web/e2e/quit.spec.ts` (new)

- [ ] **Step 1: Write the failing store tests**

Apply to `web/src/lib/keyboard.test.ts`:

```diff
diff --git a/web/src/lib/keyboard.test.ts b/web/src/lib/keyboard.test.ts
--- a/web/src/lib/keyboard.test.ts
+++ b/web/src/lib/keyboard.test.ts
@@ -31,6 +31,7 @@ vi.mock("../api/api", () => ({
     setLighting: vi.fn(),
     saveLighting: vi.fn(),
     rebootToBootloader: vi.fn(),
+    shutdown: vi.fn(),
   },
 }));
 vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })) }));
@@ -1406,3 +1407,43 @@ describe("the keyboard selector", () => {
     expect(store.session?.error).toBe("unsupported");
   });
 });
+
+describe("quitting Vial", () => {
+  /** the events link the store opened */
+  const eventsLink = () => vi.mocked(connectEvents).mock.results.at(-1)!.value as { close: ReturnType<typeof vi.fn> };
+
+  it("quits: the server answered, so Vial has stopped and the events link is closed for good", async () => {
+    const { store } = await loaded();
+    const reply = deferred<null>();
+    mocked.shutdown.mockReturnValueOnce(reply.promise);
+    const quitting = store.quit();
+    expect(store.quitting).toBe(true);
+    expect(store.stopped).toBe(false);
+    // pressed again meanwhile: asked once
+    void store.quit();
+    expect(mocked.shutdown).toHaveBeenCalledTimes(1);
+    reply.resolve(null);
+    expect(await quitting).toBe(true);
+    expect(store.stopped).toBe(true);
+    expect(store.quitting).toBe(false);
+    expect(eventsLink().close).toHaveBeenCalled();
+  });
+
+  it("says why Vial couldn't be quit, and goes on as before", async () => {
+    const { store } = await loaded();
+    mocked.shutdown.mockRejectedValueOnce(new ApiError(0));
+    expect(await store.quit()).toBe(false);
+    expect(store.stopped).toBe(false);
+    expect(store.quitting).toBe(false);
+    expect(toasts.items.map((t) => t.message)).toEqual(["Quitting Vial failed: Can't reach Vial. Is it still running?"]);
+    expect(eventsLink().close).not.toHaveBeenCalled();
+  });
+
+  it("shows Vial stopped when another tab quit it (the stopped event)", async () => {
+    const { store, emit } = await loaded();
+    emit("stopped");
+    expect(store.stopped).toBe(true);
+    expect(eventsLink().close).toHaveBeenCalled();
+    expect(mocked.shutdown).not.toHaveBeenCalled();
+  });
+});
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `TypeError: store.quit is not a function` and `Tests  3 failed | 86 passed (89)`.

- [ ] **Step 2: The route call and the store**

Apply to `web/src/api/api.ts`:

```diff
diff --git a/web/src/api/api.ts b/web/src/api/api.ts
--- a/web/src/api/api.ts
+++ b/web/src/api/api.ts
@@ -52,4 +52,6 @@ export const api = {
   /** the keyboard reboots into its bootloader and leaves; answers the session without it. 504: it got the reboot and
    * didn't answer, so it most likely went (the server closed it) */
   rebootToBootloader: () => request("post", "/api/bootloader"),
+  /** quits Vial: the keyboard is let go of, every tab gets a "stopped" event, and the server stops once it answered */
+  shutdown: () => request("post", "/api/shutdown"),
 };
```

Apply to `web/src/api/client.ts`:

```diff
diff --git a/web/src/api/client.ts b/web/src/api/client.ts
--- a/web/src/api/client.ts
+++ b/web/src/api/client.ts
@@ -5,7 +5,9 @@ import type { paths } from "./schema";
 type Method = "get" | "put" | "post";
 type Operation<P extends keyof paths, M extends Method> = paths[P][M];
 type Json<T> = T extends { content: { "application/json": infer R } } ? R : never;
-type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R> : never;
+/** the reply's JSON; null for a route that answers nothing (204) */
+type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R>
+  : Op extends { responses: { 204: unknown } } ? null : never;
 type Body<Op> = Op extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;
 type PathParams<Op> = Op extends { parameters: { path: infer P } } ? P : undefined;
 
```

Apply to `web/src/lib/keyboard.svelte.ts`:

```diff
diff --git a/web/src/lib/keyboard.svelte.ts b/web/src/lib/keyboard.svelte.ts
--- a/web/src/lib/keyboard.svelte.ts
+++ b/web/src/lib/keyboard.svelte.ts
@@ -91,6 +91,10 @@ export class KeyboardStore {
   keyboards = $state.raw<KeyboardList | null>(null);
   /** the keyboard being opened (selectKeyboard), until the server has answered */
   switching = $state<string | null>(null);
+  /** Quit Vial is on its way to the server */
+  quitting = $state(false);
+  /** Vial has stopped (Quit Vial, in this tab or another): there is nothing more to show or to reconnect to */
+  stopped = $state(false);
 
   /** grows each time the keyboard shown is another one (or none): a keyboard of another uid, or another keyboard of
    * the same uid (one alike, KeyboardEntry.id), took its place. What was opened or offered for the one before (pages,
@@ -191,6 +195,10 @@ export class KeyboardStore {
   }
 
   #onEvent(event: ServerEvent): void {
+    if (event.type === "stopped") {
+      this.#stop();
+      return;
+    }
     if (event.type === "unlock") {
       if (event.unlock) this.unlock.update(event.unlock);
       return;
@@ -231,6 +239,31 @@ export class KeyboardStore {
     }
   }
 
+  /** Quit Vial: the server lets go of the keyboard, tells every tab, and stops. Resolves to whether it did; a toast
+   * says why not. */
+  async quit(): Promise<boolean> {
+    if (this.quitting || this.stopped) return this.stopped;
+    this.quitting = true;
+    try {
+      await api.shutdown();
+    } catch (error) {
+      this.quitting = false;
+      toasts.error(failureMessage("Quitting Vial", error));
+      return false;
+    }
+    this.#stop();
+    return true;
+  }
+
+  /** Vial has stopped: the events link closes for good (it may have closed itself already) */
+  #stop(): void {
+    this.stopped = true;
+    this.quitting = false;
+    this.matrix = null;
+    this.#link?.close();
+    this.#link = null;
+  }
+
   /** Read the keyboard (and its keycode catalogue) from the server; only the latest load is kept */
   async load(): Promise<void> {
     const load = ++this.#loads;
```

```bash
cd web && npx vitest run src/lib/keyboard.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  89 passed (89)`.

- [ ] **Step 3: The stopped page, the button and the confirmation**

Create `web/src/shell/StoppedPage.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";

  let heading = $state<HTMLElement>();

  // it replaces the whole page (Vial stopped, from this tab or another): the focus, which was in what went, would fall
  // to the page's body
  onMount(() => heading?.focus());
</script>

<main class="stopped-page">
  <div class="stopped">
    <h1 bind:this={heading} tabindex="-1">Vial has stopped</h1>
    <p>You can close this tab.</p>
    <p class="hint">To use Vial again, start it again.</p>
  </div>
</main>

<style>
  .stopped-page {
    display: grid;
    justify-items: center;
    padding: 96px var(--shell-gutter) 48px;
  }

  .stopped {
    width: 100%;
    max-width: var(--list-max);
    padding: 48px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    text-align: center;
    color: var(--text-2);
  }

  .stopped h1 {
    margin: 0 0 6px;
    color: var(--text);
    font-size: 20px;
  }

  .stopped p {
    margin: 0;
  }

  .stopped p + p {
    margin-top: 6px;
  }

  .stopped .hint {
    font-size: 13px;
  }
</style>
```

Apply to `web/src/shell/TopBar.svelte`:

```diff
diff --git a/web/src/shell/TopBar.svelte b/web/src/shell/TopBar.svelte
--- a/web/src/shell/TopBar.svelte
+++ b/web/src/shell/TopBar.svelte
@@ -29,11 +29,15 @@
     unlockOpen: boolean;
     onunlock: () => void;
     onlock: () => void;
+    /** Quit Vial is on its way to the server */
+    quitting: boolean;
+    /** Quit Vial was pressed */
+    onquit: () => void;
   }
 
   let {
     name, keyboards, keyboardId, switching, onkeyboard, status, fake, languages, language, onlanguage, lock, lockBusy,
-    unlockOpen, onunlock, onlock,
+    unlockOpen, onunlock, onlock, quitting, onquit,
   }: Props = $props();
 
   const shownKeyboard = $derived(keyboards.find((k) => k.id === keyboardId));
@@ -172,6 +176,23 @@
           {/each}
         </select>
       </label>
+      <!-- here on every page, with or without a keyboard: stopping Vial is about the app, not one keyboard -->
+      <button
+        id="quit-button"
+        type="button"
+        class="quit"
+        aria-disabled={quitting || undefined}
+        title="Stop Vial: it lets go of the keyboard and its console window closes"
+        onclick={() => {
+          if (!quitting) onquit();
+        }}
+      >
+        <svg viewBox="0 0 16 16" aria-hidden="true">
+          <path d="M8 2.5v5" />
+          <path d="M4.7 4.6a4.6 4.6 0 1 0 6.6 0" />
+        </svg>
+        {quitting ? "Quitting…" : "Quit Vial"}
+      </button>
     </div>
   </div>
 </header>
@@ -334,6 +355,40 @@
     font-size: 12px;
   }
 
+  .quit {
+    display: inline-flex;
+    align-items: center;
+    gap: 6px;
+    padding: 4px 10px;
+    border: 1px solid var(--border-strong);
+    border-radius: 7px;
+    background: var(--surface);
+    color: var(--text-2);
+    font-size: 12.5px;
+    font-weight: 600;
+    white-space: nowrap;
+    cursor: pointer;
+  }
+
+  .quit:hover {
+    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
+    color: var(--danger);
+  }
+
+  .quit[aria-disabled="true"] {
+    cursor: progress;
+    opacity: 0.6;
+  }
+
+  .quit svg {
+    width: 13px;
+    height: 13px;
+    fill: none;
+    stroke: currentColor;
+    stroke-width: 1.6;
+    stroke-linecap: round;
+  }
+
   .language select {
     max-width: 210px;
     padding: 4px 6px;
```

Apply to `web/src/App.svelte`:

```diff
diff --git a/web/src/App.svelte b/web/src/App.svelte
--- a/web/src/App.svelte
+++ b/web/src/App.svelte
@@ -24,6 +24,7 @@
   import { unsavedWork } from "./lib/unsaved";
   import Banner from "./shell/Banner.svelte";
   import Nav, { type Section } from "./shell/Nav.svelte";
+  import StoppedPage from "./shell/StoppedPage.svelte";
   import Toasts from "./shell/Toasts.svelte";
   import TopBar from "./shell/TopBar.svelte";
   import UnlockDialog from "./shell/UnlockDialog.svelte";
@@ -74,7 +75,9 @@
   });
 
   $effect(() => {
-    document.title = `${sections.find((s) => s.id === section)?.label ?? "Keymap"} · Vial`;
+    document.title = keyboard.stopped
+      ? "Vial has stopped"
+      : `${sections.find((s) => s.id === section)?.label ?? "Keymap"} · Vial`;
   });
 
   // another page shown from the address (the back or forward button), or the keymap shown as another keyboard has no
@@ -189,163 +192,194 @@
   function openKeyboard(id: string) {
     void keyboard.selectKeyboard(id);
   }
+
+  /** Quit Vial pressed while there is work not saved: what the confirmation says is lost */
+  let askingQuit = $state<string | null>(null);
+
+  function quit() {
+    const work = unsavedWork(keyboard.model);
+    if (work.length === 0) {
+      void keyboard.quit();
+      return;
+    }
+    askingQuit = `Vial stops and lets go of the keyboard. Not saved yet, and lost if you quit: ${listed(work)}.`;
+  }
 </script>
 
-<TopBar
-  name={keyboard.model?.name ?? null}
-  keyboards={keyboardChoices}
-  keyboardId={keyboardShown}
-  switching={keyboard.switching !== null}
-  onkeyboard={chooseKeyboard}
-  {status}
-  fake={keyboard.session?.fake ?? false}
-  languages={keyboard.languages}
-  language={keyboard.language}
-  onlanguage={(lang) => keyboard.setLanguage(lang)}
-  {lock}
-  lockBusy={keyboard.unlock.busy}
-  unlockOpen={keyboard.unlock.open}
-  onunlock={() => void keyboard.unlock.start()}
-  onlock={() => void keyboard.unlock.lock()}
-/>
-
-<div class="shell">
-  <Nav {sections} active={section} onselect={(id) => router.go(id)} />
-
-  <main class="content">
-    {#if opening !== null}
-      <!-- no aria-busy here (the selector has it): it would hold back what the live region says, and this goes once
-           the keyboard is open -->
-      <p class="opening" role="status">Opening {opening}…</p>
-    {/if}
-    {#if status === "offline"}
-      <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
-    {:else if blocked && inBootloader}
-      <Banner
-        id="bootloader-banner"
-        tone="warning"
-        title={keyboard.bootloaderUnanswered
-          ? "The keyboard has most likely rebooted into its bootloader"
-          : "The keyboard is in its bootloader"}
-        message="{keyboard.bootloaderUnanswered ? "It went without answering the reboot. " : ""}It usually doesn't work as a keyboard until it is flashed, or unplugged and plugged back in. It shows up here again then."
-      />
-    {:else if blocked && error && blockedBy !== "unplugged"}
-      <Banner tone="danger" title={READ_PROBLEMS[blockedBy].title} message="{error} {READ_PROBLEMS[blockedBy].retry}" />
-    {:else if blocked}
-      <Banner
-        tone="danger"
-        title="Keyboard unplugged"
-        message="Changes are blocked until it is plugged back in. It is then read again."
-      />
-    {/if}
-    {#if unlock.state === "cancelled"}
-      <Banner
-        tone="warning"
-        title="The keyboard still waits to be unlocked"
-        message="It takes no changes until its unlock keys are held, or it is unplugged and plugged back in."
-        actionLabel="Unlock"
-        onaction={() => void keyboard.unlock.start()}
-      />
-    {/if}
-    {#if keyboard.loadError}
-      <Banner
-        tone="danger"
-        title="Couldn't load the keyboard"
-        message={keyboard.loadError}
-        actionLabel="Try again"
-        onaction={() => void keyboard.load()}
-      />
-    {/if}
-
-    {#if keyboard.model && placement && analysis}
-      <!-- made anew for another keyboard, even one alike (the same uid): an editor open was for the one before -->
-      {#key keyboard.opened}
-        <div class="page" class:list={section !== "keymap"} class:blocked={greyed} inert={greyed}>
-          {#if section === "tap-dance"}
-            <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
-          {:else if section === "combos"}
-            <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
-          {:else if section === "macros"}
-            <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
-          {:else if section === "key-overrides"}
-            <KeyOverridesPage model={keyboard.model} item={router.route.item} />
-          {:else if section === "alt-repeat"}
-            <AltRepeatPage model={keyboard.model} item={router.route.item} />
-          {:else if section === "settings"}
-            <SettingsPage model={keyboard.model} />
-          {:else if section === "layout"}
-            <LayoutPage model={keyboard.model} {placement} />
-          {:else if section === "lighting"}
-            <LightingPage model={keyboard.model} />
-          {:else if section === "matrix"}
-            <MatrixPage model={keyboard.model} {placement} />
-          {:else if section === "keyboard"}
-            <KeyboardPage model={keyboard.model} {analysis} usb={shownUsb} />
-          {:else}
-            <KeymapPage model={keyboard.model} {placement} {analysis} />
-          {/if}
-        </div>
-      {/key}
-    {:else}
-      <!-- the empty page: what it says is read when it changes (a keyboard found and being read, an error that comes or
-           goes), as a screen reader would hear nothing else -->
-      <div class="empty-page" aria-live="polite">
-        {#if status === "disconnected" && isWaiting(unlock)}
-          <div class="empty">
-            <h1>The keyboard waits to be unlocked</h1>
-            <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
-          </div>
-        {:else if status === "disconnected" && away}
-          <div class="empty">
-            <h1>{awayName} is unplugged</h1>
-            <p>Vial opens it again as soon as it is plugged back in.</p>
-            {#if keyboardChoices.length > 1}
-              <p>To use another keyboard, choose it at the top of the page.</p>
-            {/if}
-          </div>
-        {:else if status === "disconnected" && error}
-          {@const problem = READ_PROBLEMS[keyboard.session?.errorKind === "list" ? "list" : "unread"]}
-          <div class="empty">
-            <h1>{problem.title}</h1>
-            <p>{error}</p>
-            <p>{problem.retry}</p>
-          </div>
-        {:else if status === "disconnected"}
-          <div class="empty">
-            <h1>No keyboard found</h1>
-            <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
-            {#if keyboard.session?.platform.startsWith("linux")}
-              <p class="hint">
-                Vial needs a udev rule to see keyboards:
-                <a href="https://get.vial.today/manual/linux-udev.html" target="_blank" rel="noreferrer">how to add it</a>.
-              </p>
+{#if keyboard.stopped}
+  <StoppedPage />
+{:else}
+  <TopBar
+    name={keyboard.model?.name ?? null}
+    keyboards={keyboardChoices}
+    keyboardId={keyboardShown}
+    switching={keyboard.switching !== null}
+    onkeyboard={chooseKeyboard}
+    {status}
+    fake={keyboard.session?.fake ?? false}
+    languages={keyboard.languages}
+    language={keyboard.language}
+    onlanguage={(lang) => keyboard.setLanguage(lang)}
+    {lock}
+    lockBusy={keyboard.unlock.busy}
+    unlockOpen={keyboard.unlock.open}
+    onunlock={() => void keyboard.unlock.start()}
+    onlock={() => void keyboard.unlock.lock()}
+    quitting={keyboard.quitting}
+    onquit={quit}
+  />
+
+  <div class="shell">
+    <Nav {sections} active={section} onselect={(id) => router.go(id)} />
+
+    <main class="content">
+      {#if opening !== null}
+        <!-- no aria-busy here (the selector has it): it would hold back what the live region says, and this goes once
+             the keyboard is open -->
+        <p class="opening" role="status">Opening {opening}…</p>
+      {/if}
+      {#if status === "offline"}
+        <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
+      {:else if blocked && inBootloader}
+        <Banner
+          id="bootloader-banner"
+          tone="warning"
+          title={keyboard.bootloaderUnanswered
+            ? "The keyboard has most likely rebooted into its bootloader"
+            : "The keyboard is in its bootloader"}
+          message="{keyboard.bootloaderUnanswered ? "It went without answering the reboot. " : ""}It usually doesn't work as a keyboard until it is flashed, or unplugged and plugged back in. It shows up here again then."
+        />
+      {:else if blocked && error && blockedBy !== "unplugged"}
+        <Banner tone="danger" title={READ_PROBLEMS[blockedBy].title} message="{error} {READ_PROBLEMS[blockedBy].retry}" />
+      {:else if blocked}
+        <Banner
+          tone="danger"
+          title="Keyboard unplugged"
+          message="Changes are blocked until it is plugged back in. It is then read again."
+        />
+      {/if}
+      {#if unlock.state === "cancelled"}
+        <Banner
+          tone="warning"
+          title="The keyboard still waits to be unlocked"
+          message="It takes no changes until its unlock keys are held, or it is unplugged and plugged back in."
+          actionLabel="Unlock"
+          onaction={() => void keyboard.unlock.start()}
+        />
+      {/if}
+      {#if keyboard.loadError}
+        <Banner
+          tone="danger"
+          title="Couldn't load the keyboard"
+          message={keyboard.loadError}
+          actionLabel="Try again"
+          onaction={() => void keyboard.load()}
+        />
+      {/if}
+
+      {#if keyboard.model && placement && analysis}
+        <!-- made anew for another keyboard, even one alike (the same uid): an editor open was for the one before -->
+        {#key keyboard.opened}
+          <div class="page" class:list={section !== "keymap"} class:blocked={greyed} inert={greyed}>
+            {#if section === "tap-dance"}
+              <TapDancePage model={keyboard.model} {analysis} item={router.route.item} />
+            {:else if section === "combos"}
+              <CombosPage model={keyboard.model} {placement} {analysis} item={router.route.item} />
+            {:else if section === "macros"}
+              <MacrosPage model={keyboard.model} {analysis} item={router.route.item} />
+            {:else if section === "key-overrides"}
+              <KeyOverridesPage model={keyboard.model} item={router.route.item} />
+            {:else if section === "alt-repeat"}
+              <AltRepeatPage model={keyboard.model} item={router.route.item} />
+            {:else if section === "settings"}
+              <SettingsPage model={keyboard.model} />
+            {:else if section === "layout"}
+              <LayoutPage model={keyboard.model} {placement} />
+            {:else if section === "lighting"}
+              <LightingPage model={keyboard.model} />
+            {:else if section === "matrix"}
+              <MatrixPage model={keyboard.model} {placement} />
+            {:else if section === "keyboard"}
+              <KeyboardPage model={keyboard.model} {analysis} usb={shownUsb} />
+            {:else}
+              <KeymapPage model={keyboard.model} {placement} {analysis} />
             {/if}
           </div>
-        {:else if !keyboard.loadError}
-          <div class="empty">
-            <h1>Reading the keyboard…</h1>
-          </div>
-        {/if}
-      </div>
-    {/if}
-  </main>
-</div>
-
-<UnlockDialog unlocker={keyboard.unlock} model={keyboard.model} {placement} {names} />
-<ConfirmDialog
-  open={asking !== null}
-  title={asking?.title ?? ""}
-  message={asking?.message ?? ""}
-  confirmLabel="Switch keyboard"
-  onconfirm={async () => {
-    if (asking) openKeyboard(asking.id);
-    return true;
-  }}
-  onclose={() => {
-    asking = null;
-    void tick().then(() => document.getElementById("keyboard-select")?.focus());
-  }}
-/>
+        {/key}
+      {:else}
+        <!-- the empty page: what it says is read when it changes (a keyboard found and being read, an error that comes or
+             goes), as a screen reader would hear nothing else -->
+        <div class="empty-page" aria-live="polite">
+          {#if status === "disconnected" && isWaiting(unlock)}
+            <div class="empty">
+              <h1>The keyboard waits to be unlocked</h1>
+              <p>An unlock started earlier wasn't finished. It is read once its unlock keys have been held.</p>
+            </div>
+          {:else if status === "disconnected" && away}
+            <div class="empty">
+              <h1>{awayName} is unplugged</h1>
+              <p>Vial opens it again as soon as it is plugged back in.</p>
+              {#if keyboardChoices.length > 1}
+                <p>To use another keyboard, choose it at the top of the page.</p>
+              {/if}
+            </div>
+          {:else if status === "disconnected" && error}
+            {@const problem = READ_PROBLEMS[keyboard.session?.errorKind === "list" ? "list" : "unread"]}
+            <div class="empty">
+              <h1>{problem.title}</h1>
+              <p>{error}</p>
+              <p>{problem.retry}</p>
+            </div>
+          {:else if status === "disconnected"}
+            <div class="empty">
+              <h1>No keyboard found</h1>
+              <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
+              {#if keyboard.session?.platform.startsWith("linux")}
+                <p class="hint">
+                  Vial needs a udev rule to see keyboards:
+                  <a href="https://get.vial.today/manual/linux-udev.html" target="_blank" rel="noreferrer">how to add it</a>.
+                </p>
+              {/if}
+            </div>
+          {:else if !keyboard.loadError}
+            <div class="empty">
+              <h1>Reading the keyboard…</h1>
+            </div>
+          {/if}
+        </div>
+      {/if}
+    </main>
+  </div>
+
+  <UnlockDialog unlocker={keyboard.unlock} model={keyboard.model} {placement} {names} />
+  <ConfirmDialog
+    open={asking !== null}
+    title={asking?.title ?? ""}
+    message={asking?.message ?? ""}
+    confirmLabel="Switch keyboard"
+    onconfirm={async () => {
+      if (asking) openKeyboard(asking.id);
+      return true;
+    }}
+    onclose={() => {
+      asking = null;
+      void tick().then(() => document.getElementById("keyboard-select")?.focus());
+    }}
+  />
+  <ConfirmDialog
+    open={askingQuit !== null}
+    title="Quit Vial?"
+    message={askingQuit ?? ""}
+    confirmLabel="Quit Vial"
+    danger
+    onconfirm={() => keyboard.quit()}
+    onclose={() => {
+      askingQuit = null;
+      // quit: the page that says so takes the focus
+      if (!keyboard.stopped) void tick().then(() => document.getElementById("quit-button")?.focus());
+    }}
+  />
+{/if}
 <Toasts />
 
 <style>
```

The console message names the button:

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -58,7 +58,7 @@ UVICORN_LOGGING = {
 
 STARTED_MESSAGE = """Vial is running{fake}. Open it at:
   {url}
-To stop it, press Ctrl+C or close this window."""
+To stop it, use Quit Vial on the page, press Ctrl+C or close this window."""
 
 REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
   {url}
```

- [ ] **Step 4: Type-check, unit tests, build, and the Python tests of the messages**

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  814 passed (814)` and `built in`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `119 passed, 1 skipped`.

- [ ] **Step 5: e2e: servers asked to quit, a server of the test's own, the quit tests**

Apply to `web/e2e/servers.ts`:

```diff
diff --git a/web/e2e/servers.ts b/web/e2e/servers.ts
--- a/web/e2e/servers.ts
+++ b/web/e2e/servers.ts
@@ -31,8 +31,8 @@ export const SERVERS = {
   twoKeyboards: ["--second-definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
 } satisfies Record<string, string[]>;
 
-/** Long enough to start a server, on a busy machine too */
-export const SERVER_FIXTURE_MS = STARTUP_MS + 2 * STOP_MS;
+/** Long enough to start a server and to stop it (asked to quit, then ended), on a busy machine too */
+export const SERVER_FIXTURE_MS = STARTUP_MS + 3 * STOP_MS;
 
 const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
 
@@ -52,7 +52,24 @@ function exitWithin(child: ChildProcess, ms: number): Promise<boolean> {
   });
 }
 
-/** Stops the server and waits for it, at most a few seconds per attempt. On Windows the venv's python.exe is a
+/** Asks the server to quit as Quit Vial does (POST /api/shutdown, with the session the link gives): it closes the
+ * keyboard and exits by itself. Resolves to whether it took the request. */
+async function askToQuit(url: string): Promise<boolean> {
+  try {
+    const login = await fetch(url, { redirect: "manual" });
+    const cookie = login.headers.get("set-cookie")?.split(";")[0];
+    if (!cookie) return false;
+    const reply = await fetch(new URL("/api/shutdown", url), {
+      method: "POST",
+      headers: { cookie, origin: new URL(url).origin },
+    });
+    return reply.status === 204;
+  } catch {
+    return false; // gone already, or not answering
+  }
+}
+
+/** Ends the server and waits for it, at most a few seconds per attempt. On Windows the venv's python.exe is a
  * launcher that runs the real Python as its child, and there is no gentler stop than terminating, so the whole tree
  * is ended at once. Elsewhere SIGTERM, then SIGKILL if it hasn't exited in time. */
 async function stopProcess(child: ChildProcess): Promise<void> {
@@ -106,7 +123,15 @@ function waitForUrl(server: ChildProcess, output: { text: string }): Promise<str
   });
 }
 
-export async function startServer(extraArgs: string[]): Promise<{ url: string; stop: () => Promise<void> }> {
+/** A test server: its link, what stops it, its exit code once it exits (by itself: Quit Vial), and what it printed */
+export interface TestServer {
+  url: string;
+  stop: () => Promise<void>;
+  exited: Promise<number | null>;
+  output: () => string;
+}
+
+export async function startServer(extraArgs: string[]): Promise<TestServer> {
   const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
   let server: ChildProcess | undefined;
   const output = { text: "" };
@@ -116,14 +141,25 @@ export async function startServer(extraArgs: string[]): Promise<{ url: string; s
       ["vial_web.py", "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
       { cwd: pythonRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
     );
+    const exited = new Promise<number | null>((resolve) => server!.once("exit", (code) => resolve(code)));
     const url = await waitForUrl(server, output);
     const running = server;
     return {
       url,
       stop: async () => {
-        await stopProcess(running);
+        // asked to quit first, as Quit Vial does; ended if it can't be asked
+        const asked = !hasExited(running) && (await askToQuit(url));
+        const quit = asked && (await exitWithin(running, STOP_MS));
+        if (!hasExited(running)) await stopProcess(running);
         removeDataDir(dataDir);
+        if (asked && !quit) {
+          const why = `vial_web.py took Quit (POST /api/shutdown) and didn't exit within ${STOP_MS / 1000} s`;
+          throw new Error(`${why}:\n${output.text}`);
+        }
       },
+      exited,
+      // waitForUrl keeps reading what it prints
+      output: () => output.text,
     };
   } catch (error) {
     // never leave a half-started server or its data dir behind
```

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -2,7 +2,7 @@ import { test as base, expect, type Page } from "@playwright/test";
 import { join } from "node:path";
 import { fileURLToPath } from "node:url";
 import type { Lighting } from "../src/api/types";
-import { SERVER_FIXTURE_MS, SERVERS, startServer } from "./servers";
+import { SERVER_FIXTURE_MS, SERVERS, startServer, type TestServer } from "./servers";
 
 /** e2e/screenshots/, wherever the tests are run from */
 const SCREENSHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));
@@ -36,9 +36,10 @@ function serverOf(
  * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty), `qmkLighting` the
  * simulated Corne with QMK's RGB light and backlight, `twoKeyboards` the simulated Corne of a server whose second
  * keyboard (the macropad) is plugged in by secondKeyboard(). `corneUrl` is the simulated Corne's link, for a test that
- * opens it itself. */
+ * opens it itself. `ownServer` is a simulated Corne's server of the test's own, started for it and stopped after it,
+ * for a test that ends it (Quit Vial). */
 export const test = base.extend<
-  { app: Page; macropad: Page; eightLayers: Page; qmkLighting: Page; twoKeyboards: Page },
+  { app: Page; macropad: Page; eightLayers: Page; qmkLighting: Page; twoKeyboards: Page; ownServer: TestServer },
   { corneUrl: string; macropadUrl: string; eightLayersUrl: string; qmkLightingUrl: string; twoKeyboardsUrl: string }
 >({
   corneUrl: serverOf(SERVERS.corne),
@@ -61,6 +62,17 @@ export const test = base.extend<
   twoKeyboards: async ({ page, twoKeyboardsUrl }, use) => {
     await use(await open(page, twoKeyboardsUrl));
   },
+  ownServer: [
+    async ({}, use) => {
+      const server = await startServer(SERVERS.corne);
+      try {
+        await use(server);
+      } finally {
+        await server.stop();
+      }
+    },
+    { timeout: SERVER_FIXTURE_MS },
+  ],
 });
 
 export { expect };
```

Create `web/e2e/quit.spec.ts`:

```ts
// Quit Vial: the top bar's button stops the server, closing the keyboard first; every tab shows that Vial has stopped.
// Each test ends its server, so each has one of its own (ownServer).
import { expect, open, screenshots, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** How far the page reaches past the window's right edge, in pixels */
const sideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const quitButton = (page: Page) => page.getByRole("button", { name: "Quit Vial" });
const stoppedHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Vial has stopped" });

test("Quit Vial stops the server; every tab says so and stops reconnecting", async ({ page, context, ownServer }) => {
  await open(page, ownServer.url);
  const other = await open(await context.newPage(), ownServer.url);

  await quitButton(page).click();
  await expect(stoppedHeading(page)).toBeFocused();
  await expect(page.getByText("You can close this tab.")).toBeVisible();
  await expect(page).toHaveTitle("Vial has stopped");
  // the other tab is told too
  await expect(stoppedHeading(other)).toBeVisible();
  await expect(page.getByRole("button", { name: "Quit Vial" })).toHaveCount(0);

  // the server process ends by itself
  expect(await ownServer.exited, ownServer.output()).toBe(0);
  // nothing tries to reach it any more: no "lost contact" banner comes, however long the tabs stay open
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  await page.waitForTimeout(6000);
  expect(sockets).toEqual([]);
  for (const tab of [page, other]) {
    await expect(stoppedHeading(tab)).toBeVisible();
    await expect(tab.getByText("Lost contact with Vial")).toHaveCount(0);
  }

  for (const [width, height] of [[375, 812], [800, 900], [1920, 950]] as const) {
    await page.setViewportSize({ width, height });
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    await screenshots(page, `quit-stopped-${width}`);
  }
});

test("Quit Vial asks first when there is work not saved; Cancel keeps Vial running", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("textbox", { name: "Tapping Term" }).fill("250");

  await quitButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Quit Vial?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Vial stops and lets go of the keyboard. Not saved yet, and lost if you quit: the changes on the Settings page.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await screenshots(page, "quit-confirm");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(quitButton(page)).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Tapping Term" })).toHaveValue("250");
  expect((await page.request.get(new URL("/api/session", page.url()).toString())).ok()).toBe(true);

  await quitButton(page).click();
  await dialog.getByRole("button", { name: "Quit Vial" }).click();
  await expect(stoppedHeading(page)).toBeFocused();
  expect(await ownServer.exited, ownServer.output()).toBe(0);
});

test("the Quit Vial button fits the top bar from 375 px to 1080p, in both themes", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  for (const [width, height] of [[375, 812], [800, 900], [1280, 800], [1920, 950]] as const) {
    await page.setViewportSize({ width, height });
    await expect(quitButton(page)).toBeVisible();
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    await screenshots(page, `quit-topbar-${width}`);
  }
  await quitButton(page).focus();
  await expect(quitButton(page)).toBeFocused();
  // the focus ring shows: an outline drawn around it
  expect(await quitButton(page).evaluate((b) => getComputedStyle(b).outlineStyle)).not.toBe("none");
});
```

```bash
cd web && npm run check && npx playwright test e2e/quit.spec.ts
```

Expected: `0 ERRORS 0 WARNINGS` and `3 passed`.

The whole suite, now that every server is asked to quit when its worker ends:

```bash
cd web && npx playwright test
```

Expected: `188 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/vial_web.py \
  web/e2e/fixtures.ts \
  web/e2e/quit.spec.ts \
  web/e2e/servers.ts \
  web/src/App.svelte \
  web/src/api/api.ts \
  web/src/api/client.ts \
  web/src/lib/keyboard.svelte.ts \
  web/src/lib/keyboard.test.ts \
  web/src/shell/StoppedPage.svelte \
  web/src/shell/TopBar.svelte
git commit -m "feat(web): a Quit Vial button in the top bar; every tab shows that Vial has stopped"
```

### Task 5: `protocol/flasher.py`: the firmware updater's logic without Qt, for phase 7

`editor/firmware_flasher.py` (Qt) goes in Task 6. Its logic moves here first, Qt-free and tested, so that phase 7 can build a web UI on it. Nothing here is wired into the server, and nothing runs it against a device.

- **Firmware files:**
  - `read_firmware(data)` checks the signature (`VIALFW00`/`VIALFW01`), the 64-byte header and the 10 MiB limit, and gives a `Firmware` with its UID, build time, payload and SHA-256. It raises `FirmwareError` with a sentence.
  - `check_firmware_for(firmware, uid)` says whether it is for the keyboard of that UID.
- **The bootloader:**
  - `is_bootloader(desc)` and `bootloader_title(desc)` recognise Vial's bootloader by its serial number (`vibl:d4f8159c`).
  - `bootloader_uid(dev)` reads its UID.
  - `find_bootloader(devices, open_device, uid)` picks the one bootloader of that UID. The caller lists and opens the devices, so the module never imports hidapi.
- **The protocol:**
  - `Bootloader(dev)` sends padded 64-byte messages with retries: `version()`, `uid()`, `CMD_FLASH`, `CMD_INSECURE` (restore the layout), `CMD_REBOOT`.
  - `flash(bootloader, firmware, restore_layout, log, progress)` checks everything before it writes: a supported version, a matching UID, at most 65535 chunks. Then it sends the payload in 64-byte chunks with progress, and reboots. A command the bootloader doesn't take raises `FlashError`, where Qt went on.

`test_core_isolation` checks that the flasher imports without hidapi.

**Files:**
- Create: `src/main/python/protocol/flasher.py`
- Test: `src/main/python/test/test_flasher.py` (new)
- Test: `src/main/python/test/test_core_isolation.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_flasher.py`:

```python
""" protocol/flasher.py against a stand-in bootloader: no HID device is listed or opened """
import contextlib
import datetime
import hashlib
import struct

import pytest

from protocol import flasher
from protocol.flasher import Bootloader, Firmware, FirmwareError, FlashError

UID = bytes.fromhex("0123456789abcdef")
BUILT = 1_700_000_000


def vfw(payload=b"\x11" * 100, uid=UID, signature=b"VIALFW01", built=BUILT, checksum=None):
    """ A .vfw file's bytes """
    digest = hashlib.sha256(payload).digest() if checksum is None else checksum
    return signature + uid + struct.pack("<Q", built) + b"\x00" * 8 + digest + payload


class FakeBootloader:
    """ Stands in for a Vial bootloader opened through hidapi: write() takes the report ID first and answers how many
    bytes it wrote, read() answers what the last command asks for """

    def __init__(self, uid=UID, version=1, busy_writes=0, refuse_after=None):
        self.uid = uid
        self.version = version
        self.busy_writes = busy_writes
        """ writes that fail (-1) before it is ready """
        self.refuse_after = refuse_after
        """ messages taken before it writes nothing (0) """
        self.messages = []
        self.answer = b""
        self.reads = []

    def write(self, data):
        assert data[0] == 0 and len(data) == 65  # report ID, then a whole message
        if self.busy_writes:
            self.busy_writes -= 1
            return -1
        if self.refuse_after is not None and len(self.messages) >= self.refuse_after:
            return 0
        message = data[1:]
        self.messages.append(message)
        if message[:3] == flasher.CMD_VERSION:
            self.answer = bytes([self.version]) + b"\x00" * 7
        elif message[:3] == flasher.CMD_UID:
            self.answer = self.uid
        return len(data)

    def read(self, length, timeout_ms=0):
        self.reads.append(timeout_ms)
        answer, self.answer = self.answer[:length], b""
        return list(answer)

    def commands(self):
        return [m[:3] for m in self.messages if m[:2] == b"VC"]


# ---------- the firmware file ----------

def test_a_firmware_file_is_read():
    firmware = flasher.read_firmware(vfw(b"\x22" * 10))
    assert firmware == Firmware(uid=UID, built=datetime.datetime(2023, 11, 14, 22, 13, 20, tzinfo=datetime.timezone.utc),
                                payload=b"\x22" * 10)


@pytest.mark.parametrize("signature", flasher.FIRMWARE_SIGNATURES)
def test_both_signatures_are_taken(signature):
    assert flasher.read_firmware(vfw(signature=signature)).uid == UID


@pytest.mark.parametrize("data", [b"", b"VIALFW01" + b"\x00" * 10, vfw(signature=b"VIALFW02"), b"\x00" * 200])
def test_what_isnt_a_firmware_file_is_refused(data):
    with pytest.raises(FirmwareError, match="isn't a Vial firmware file"):
        flasher.read_firmware(data)


def test_a_damaged_firmware_is_refused():
    with pytest.raises(FirmwareError, match="damaged"):
        flasher.read_firmware(vfw(checksum=b"\x00" * 32))
    data = bytearray(vfw())
    data[-1] ^= 0xFF
    with pytest.raises(FirmwareError, match="damaged"):
        flasher.read_firmware(bytes(data))


def test_a_file_too_large_is_refused_before_anything_else():
    with pytest.raises(FirmwareError, match="too large"):
        flasher.read_firmware(b"\x00" * (flasher.MAX_FIRMWARE_SIZE + 1))


def test_firmware_for_another_keyboard_is_refused():
    firmware = flasher.read_firmware(vfw())
    flasher.check_firmware_for(firmware, UID)
    with pytest.raises(FirmwareError, match="another keyboard"):
        flasher.check_firmware_for(firmware, b"\x00" * 8)


# ---------- finding the bootloader ----------

def test_bootloaders_are_told_by_their_serial_number():
    assert flasher.is_bootloader({"serial_number": "vibl:d4f8159c"})
    assert not flasher.is_bootloader({"serial_number": "vial:f64c2b3c"})
    assert not flasher.is_bootloader({"serial_number": None})
    assert flasher.bootloader_title({"vendor_id": 0x1234, "product_id": 0xAB}) == "Vial Bootloader [1234:00AB]"


def test_the_bootloader_of_the_keyboard_is_found_by_its_uid():
    devices = {
        "keyboard": FakeBootloader(),  # a keyboard: never opened
        "other": FakeBootloader(uid=b"\x01" * 8),
        "broken": None,
        "ours": FakeBootloader(),
    }
    listed = [{"path": "keyboard", "serial_number": "vial:f64c2b3c"},
              {"path": "other", "serial_number": "vibl:d4f8159c"},
              {"path": "broken", "serial_number": "vibl:d4f8159c"},
              {"path": "ours", "serial_number": "vibl:d4f8159c"}]
    opened = []

    @contextlib.contextmanager
    def open_device(desc):
        opened.append(desc["path"])
        if devices[desc["path"]] is None:
            raise OSError("can't open")
        yield devices[desc["path"]]
    assert flasher.find_bootloader(listed, open_device, UID) == listed[3]
    assert opened == ["other", "broken", "ours"]
    assert devices["ours"].reads == [flasher.UID_TIMEOUT_MS]  # asked, not waited for forever
    assert flasher.find_bootloader(listed[:3], open_device, UID) is None


def test_a_bootloader_that_doesnt_answer_has_no_uid():
    assert flasher.bootloader_uid(FakeBootloader(refuse_after=0)) == b""


# ---------- flashing ----------

def test_flashing_sends_the_payload_in_chunks_then_reboots():
    payload = bytes(range(256)) + b"\xAA" * 10  # not a whole number of chunks
    device = FakeBootloader()
    lines, done = [], []
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw(payload)), log=lines.append, progress=done.append)
    padded = payload + b"\x00" * 54
    assert device.commands() == [flasher.CMD_VERSION, flasher.CMD_UID, flasher.CMD_FLASH, flasher.CMD_REBOOT]
    flash_command = device.messages[2]
    assert flash_command == flasher.pad(flasher.CMD_FLASH + struct.pack("<H", 5))
    assert b"".join(device.messages[3:8]) == padded
    assert done == [1 / 5, 2 / 5, 3 / 5, 4 / 5, 1.0]
    assert lines == ["Firmware built on 2023-11-14 22:13:20 (UTC)", "Bootloader version: 1",
                     "Vial ID: 0123456789abcdef", "Flashing...", "Rebooting...", "Done!"]


def test_restoring_the_layout_starts_the_keyboard_unlocked_once():
    device = FakeBootloader()
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw()), restore_layout=True)
    assert device.commands()[-2:] == [flasher.CMD_INSECURE, flasher.CMD_REBOOT]


@pytest.mark.parametrize("version", [0, 1])
def test_both_bootloader_versions_are_flashed(version):
    device = FakeBootloader(version=version)
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert device.commands()[-1] == flasher.CMD_REBOOT


def test_an_unknown_bootloader_version_is_refused_before_anything_is_written():
    device = FakeBootloader(version=2)
    with pytest.raises(FlashError, match="version 2"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert device.commands() == [flasher.CMD_VERSION]


def test_firmware_for_another_keyboard_is_refused_before_anything_is_written():
    device = FakeBootloader(uid=b"\x00" * 8)
    with pytest.raises(FirmwareError, match="another keyboard"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert flasher.CMD_FLASH not in device.commands()


def test_a_bootloader_without_a_uid_is_warned_about():
    unset = flasher.UNSET_UID
    device = FakeBootloader(uid=unset)
    lines = []
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw(uid=unset)), log=lines.append)
    assert any(line.startswith("Warning: the bootloader's UID is not set") for line in lines)


def test_a_busy_bootloader_is_sent_the_message_again():
    pauses = []
    device = FakeBootloader(busy_writes=3)
    flasher.flash(Bootloader(device, sleep=pauses.append), flasher.read_firmware(vfw()))
    assert pauses == [flasher.RETRY_PAUSE] * 3
    assert device.commands()[-1] == flasher.CMD_REBOOT


def test_a_bootloader_never_ready_fails_the_command():
    device = FakeBootloader(busy_writes=flasher.SEND_RETRIES)
    with pytest.raises(FlashError, match="didn't take the command"):
        Bootloader(device, sleep=lambda s: None).version()


def test_a_chunk_not_taken_fails_the_flash_and_says_the_firmware_is_incomplete():
    device = FakeBootloader(refuse_after=4)  # version, UID, flash, one chunk
    progress = []
    with pytest.raises(FlashError, match="incomplete"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw(b"\x33" * 200)), progress=progress.append)
    assert progress == [1 / 4]
    assert flasher.CMD_REBOOT not in device.commands()


def test_messages_are_whole():
    with pytest.raises(ValueError):
        flasher.pad(b"\x00" * 65)
    with pytest.raises(ValueError):
        Bootloader(FakeBootloader()).send(b"VC")


def test_a_firmware_of_more_chunks_than_the_bootloader_counts_is_refused_before_anything_is_written():
    device = FakeBootloader()
    with pytest.raises(FirmwareError, match="too large for the bootloader"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw(b"\x00" * (0x10000 * flasher.MESSAGE_LEN))))
    assert flasher.CMD_FLASH not in device.commands()
```

Apply to `src/main/python/test/test_core_isolation.py`:

```diff
diff --git a/src/main/python/test/test_core_isolation.py b/src/main/python/test/test_core_isolation.py
--- a/src/main/python/test/test_core_isolation.py
+++ b/src/main/python/test/test_core_isolation.py
@@ -26,5 +26,5 @@ def run_isolated(code):
 
 
 def test_protocol_core_imports_without_qt_or_hid():
-    result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, transport")
+    result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, protocol.flasher, transport")
     assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_flasher.py test/test_core_isolation.py
```

Expected: `ImportError: cannot import name 'flasher' from 'protocol'` and `1 error`.

- [ ] **Step 3: The flasher**

Create `src/main/python/protocol/flasher.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Flashing Vial firmware (.vfw files) through the Vial bootloader ("vibl"): finding the bootloader, checking a firmware
file, and the bootloader's protocol. The logic of the Qt app's firmware updater, without its window, for the web UI of
phase 7; nothing calls it yet.

Must not import Qt or hidapi: the caller lists the HID devices and opens them (a raw HID device, as hidapi's
hid.device() opened on a path, or a stand-in in tests).

A firmware file: "VIALFW00" or "VIALFW01", the keyboard's UID (8 bytes), the build time (8 bytes, little-endian seconds
since 1970, UTC), 8 bytes unused, the SHA-256 of the payload (32 bytes), then the payload.

The bootloader takes 64-byte messages: "VC" and a command byte (CMD_*), padded with zeros; then, for CMD_FLASH, the
payload in 64-byte chunks.
"""
import datetime
import hashlib
import struct
import time
from dataclasses import dataclass

from transport import chunks

VIBL_SERIAL_NUMBER_MAGIC = "vibl:d4f8159c"
""" in the USB serial number of every Vial bootloader """
MESSAGE_LEN = 64
""" the bootloader's messages are this long, the firmware's chunks too """
FIRMWARE_SIGNATURES = (b"VIALFW00", b"VIALFW01")
HEADER_LEN = 64
MAX_FIRMWARE_SIZE = 10 * 1024 * 1024
""" larger than any keyboard's flash: most likely the wrong file """
UNSET_UID = b"\xFF" * 8
""" the UID of a bootloader that was never given one """
SUPPORTED_VERSIONS = (0, 1)
""" bootloader protocol versions this flasher speaks """
SEND_RETRIES = 200
RETRY_PAUSE = 0.01
""" seconds between two tries of a message the bootloader didn't take yet """
UID_TIMEOUT_MS = 500
""" how long a device found is given to say its UID """

CMD_VERSION = b"VC\x00"
CMD_UID = b"VC\x01"
CMD_FLASH = b"VC\x02"
""" followed by the number of chunks (2 bytes, little-endian) """
CMD_REBOOT = b"VC\x03"
CMD_INSECURE = b"VC\x04"
""" the keyboard starts unlocked once, so that the layout saved before flashing can be written back """


class FirmwareError(ValueError):
    """ The firmware file can't be flashed (on this keyboard) """


class FlashError(RuntimeError):
    """ The bootloader didn't take a message, or answered something this flasher can't work with """


@dataclass(frozen=True)
class Firmware:
    uid: bytes
    """ the UID of the keyboard it was built for """
    built: datetime.datetime
    """ when it was built, in UTC """
    payload: bytes


def read_firmware(data):
    """ The firmware in a .vfw file's bytes; FirmwareError when it isn't one, or is damaged """
    if len(data) > MAX_FIRMWARE_SIZE:
        raise FirmwareError("the firmware is too large ({} bytes, at most {}): check that it is the right file".format(
            len(data), MAX_FIRMWARE_SIZE))
    if len(data) < HEADER_LEN or data[0:8] not in FIRMWARE_SIGNATURES:
        raise FirmwareError("this isn't a Vial firmware file (.vfw)")
    expected, payload = data[32:64], data[HEADER_LEN:]
    actual = hashlib.sha256(payload).digest()
    if actual != expected:
        raise FirmwareError("the firmware is damaged: its checksum is {}, it should be {}".format(
            actual.hex(), expected.hex()))
    built = datetime.datetime.fromtimestamp(struct.unpack("<Q", data[16:24])[0], datetime.timezone.utc)
    return Firmware(uid=data[8:16], built=built, payload=payload)


def check_firmware_for(firmware, uid):
    """ FirmwareError unless the firmware was built for the keyboard (or bootloader) of this UID """
    if firmware.uid != uid:
        raise FirmwareError("the firmware was built for another keyboard: its UID is {}, the keyboard's is {}".format(
            firmware.uid.hex(), uid.hex()))


def pad(message):
    """ A message as the bootloader takes it: padded with zeros to MESSAGE_LEN bytes """
    if len(message) > MESSAGE_LEN:
        raise ValueError("a bootloader message is at most {} bytes".format(MESSAGE_LEN))
    return message + b"\x00" * (MESSAGE_LEN - len(message))


def is_bootloader(desc):
    """ Whether a HID device (as hidapi lists it) is a Vial bootloader """
    return VIBL_SERIAL_NUMBER_MAGIC in (desc.get("serial_number") or "")


def bootloader_title(desc):
    return "Vial Bootloader [{:04X}:{:04X}]".format(desc["vendor_id"], desc["product_id"])


class Bootloader:
    """ A Vial bootloader, open: dev is a raw HID device (write() takes a report ID first, read() answers bytes) """

    def __init__(self, dev, sleep=time.sleep):
        self.dev = dev
        self.sleep = sleep

    def send(self, message, retries=SEND_RETRIES):
        """ Send one 64-byte message, tried again while the bootloader isn't ready (a write fails); whether it was
        written whole """
        if len(message) != MESSAGE_LEN:
            raise ValueError("a bootloader message is {} bytes, not {}".format(MESSAGE_LEN, len(message)))
        for _ in range(retries):
            written = self.dev.write(b"\x00" + message)  # report ID 0 first
            if written == len(message) + 1:
                return True
            if written >= 0:
                return False
            self.sleep(RETRY_PAUSE)
        return False

    def command(self, command, argument=b""):
        """ Send a command; FlashError when the bootloader doesn't take it """
        if not self.send(pad(command + argument)):
            raise FlashError("the bootloader didn't take the command {}".format(command[2]))

    def recv(self, length, timeout_ms=0):
        """ The bootloader's answer (0: wait for it) """
        return bytes(self.dev.read(length, timeout_ms=timeout_ms))

    def version(self):
        self.command(CMD_VERSION)
        answer = self.recv(8)
        if not answer:
            raise FlashError("the bootloader didn't say its version")
        return answer[0]

    def uid(self, timeout_ms=0):
        self.command(CMD_UID)
        return self.recv(8, timeout_ms)


def bootloader_uid(dev):
    """ The UID of a bootloader just found and opened (b"" when it doesn't say in time), as the Qt app asked each one
    it found while it waited for the keyboard to come back as a bootloader """
    try:
        return Bootloader(dev).uid(UID_TIMEOUT_MS)
    except (OSError, FlashError):
        return b""


def find_bootloader(devices, open_device, uid):
    """ The first of the HID devices listed (hidapi's descriptors) that is a Vial bootloader of this UID, or None.
    open_device(desc) opens one (a context manager giving the raw device): each bootloader is asked for its UID. """
    for desc in devices:
        if not is_bootloader(desc):
            continue
        try:
            with open_device(desc) as dev:
                if bootloader_uid(dev) == uid:
                    return desc
        except OSError:
            continue
    return None


def flash(bootloader, firmware, restore_layout=False, log=lambda line: None, progress=lambda done: None):
    """ Flash the firmware (read_firmware()) through the bootloader (Bootloader), then reboot the keyboard into it.

    restore_layout: the keyboard starts unlocked once (CMD_INSECURE), so that a layout saved before flashing can be
    written back. log(line) tells what is done, progress(fraction) how much of the payload is sent. FirmwareError when
    the firmware is for another keyboard; FlashError when the bootloader can't flash it: nothing is written before
    every check has passed.
    """
    log("Firmware built on {} (UTC)".format(firmware.built.strftime("%Y-%m-%d %H:%M:%S")))
    version = bootloader.version()
    log("Bootloader version: {}".format(version))
    if version not in SUPPORTED_VERSIONS:
        raise FlashError("the bootloader's version {} isn't supported".format(version))
    uid = bootloader.uid()
    log("Vial ID: {}".format(uid.hex()))
    if uid == UNSET_UID:
        log("Warning: the bootloader's UID is not set: set it before releasing production firmware")
    check_firmware_for(firmware, uid)

    payload = firmware.payload + b"\x00" * (-len(firmware.payload) % MESSAGE_LEN)
    if len(payload) // MESSAGE_LEN > 0xFFFF:
        raise FirmwareError("the firmware is too large for the bootloader ({} bytes)".format(len(payload)))
    log("Flashing...")
    bootloader.command(CMD_FLASH, struct.pack("<H", len(payload) // MESSAGE_LEN))
    sent = 0
    for chunk in chunks(payload, MESSAGE_LEN):
        if not bootloader.send(chunk):
            raise FlashError("sending the firmware failed: the keyboard's firmware is now incomplete, flash it again")
        sent += len(chunk)
        progress(sent / len(payload))

    log("Rebooting...")
    if restore_layout:
        bootloader.command(CMD_INSECURE)
    bootloader.command(CMD_REBOOT)
    log("Done!")
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_flasher.py test/test_core_isolation.py
```

Expected: `26 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1067 passed, 2 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/protocol/flasher.py \
  src/main/python/test/test_core_isolation.py \
  src/main/python/test/test_flasher.py
git commit -m "feat: protocol/flasher.py, the firmware updater's logic without Qt, for phase 7"
```

### Task 6: Remove the Qt app, its tests and its dependencies

The web UI does everything the Qt app did (phase 5, signed off on 2026-10-20). This task removes the Qt app, the Qt-only tests and the dead code they leave behind, and drops PyQt5, keyboard, pywin32, certifi, pytest-qt and pytest-xvfb. Then it recreates the venv without them. Before each deletion the prototype checked with grep that no Qt-free module imports what goes. The new guard test proves the result: no source file imports Qt.

What else changes:
- `protocol/dummy_keyboard.py` moves to `test/`, since only the macro tests use it.
- `test_keyboard.py` takes `chunks` and `MSG_LEN` from `transport` (`util.py` goes).
- `protocol/unlock_hook.py` raises when no handler is installed, instead of opening Qt's unlock dialog. The server always installs one (`require_unlocked`).
- The dead code goes: the keycodes' 86 `recorder_alias=` arguments with `recorder_alias_to_keycode` and `find_by_recorder_alias`; the `emscripten` branches of `hidproxy.py` and `keycodes.py`; and `combo_get`, `tap_dance_get`, `key_override_get`, `alt_repeat_key_get`, `reload_macros`, `set_vialrgb_brightness` and `set_vialrgb_speed`.

**Files:**
- Test: `src/main/python/test/test_core_isolation.py`
- Move: `src/main/python/protocol/dummy_keyboard.py` → `src/main/python/test/dummy_keyboard.py`
- Test: `src/main/python/test/test_macro.py`
- Test: `src/main/python/test/test_keyboard.py`
- Modify: `src/main/python/protocol/unlock_hook.py`
- Modify: `src/main/python/hidproxy.py`
- Modify: `src/main/python/keycodes/keycodes.py`
- Modify: `src/main/python/protocol/alt_repeat_key.py`
- Modify: `src/main/python/protocol/combo.py`
- Modify: `src/main/python/protocol/key_override.py`
- Modify: `src/main/python/protocol/keyboard_comm.py`
- Modify: `src/main/python/protocol/macro.py`
- Modify: `src/main/python/protocol/tap_dance.py`
- Modify: `requirements.txt`
- Modify: `test-requirements.txt`
- Delete: 48 files, listed in the `git rm` step

- [ ] **Step 1: Write the failing guard test**

`test_core_isolation.py`: no source imports Qt (PyQt5, PyQt6, PySide2, PySide6, qtpy, `fbs_runtime`), and the isolated interpreter blocks all of them besides hidapi:

Apply to `src/main/python/test/test_core_isolation.py`:

```diff
diff --git a/src/main/python/test/test_core_isolation.py b/src/main/python/test/test_core_isolation.py
--- a/src/main/python/test/test_core_isolation.py
+++ b/src/main/python/test/test_core_isolation.py
@@ -1,15 +1,21 @@
+""" Vial has no Qt any more, and what runs without a real keyboard never loads hidapi: run_isolated() runs code in a
+fresh interpreter where importing either fails, for the tests that check that (fake mode, the API schema...) """
+import ast
 import os
+import pathlib
 import subprocess
 import sys
 
 PYTHON_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
+QT_PACKAGES = ("PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "fbs_runtime")
+""" Qt's Python bindings, and the runtime of fbs (the Qt app's packager) """
 
 # Runs in a fresh interpreter: any attempt to import Qt or hidapi raises ImportError.
 BLOCKER = """
 import sys
 
 class Blocker:
-    BLOCKED = ("PyQt5", "hid", "hidraw")
+    BLOCKED = {blocked!r}
 
     def find_spec(self, name, path=None, target=None):
         if name.split(".")[0] in self.BLOCKED:
@@ -17,7 +23,7 @@ class Blocker:
         return None
 
 sys.meta_path.insert(0, Blocker())
-"""
+""".format(blocked=QT_PACKAGES + ("hid", "hidraw"))
 
 
 def run_isolated(code):
@@ -25,6 +31,26 @@ def run_isolated(code):
                           capture_output=True, text=True, timeout=60)
 
 
+def imported_packages(path):
+    """ The top-level packages a source file imports, wherever in the file """
+    found = set()
+    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
+        if isinstance(node, ast.Import):
+            found.update(alias.name.split(".")[0] for alias in node.names)
+        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
+            found.add(node.module.split(".")[0])
+    return found
+
+
+def test_no_source_imports_qt():
+    users = {}
+    for path in sorted(pathlib.Path(PYTHON_ROOT).rglob("*.py")):
+        qt = imported_packages(path) & set(QT_PACKAGES)
+        if qt:
+            users[str(path.relative_to(PYTHON_ROOT))] = sorted(qt)
+    assert users == {}
+
+
 def test_protocol_core_imports_without_qt_or_hid():
     result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, protocol.flasher, transport")
     assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_core_isolation.py
```

Expected: `FAILED test/test_core_isolation.py::test_no_source_imports_qt` and `1 failed, 1 passed`: the 40 Qt modules still import PyQt5.

- [ ] **Step 3: Delete the Qt-only tests and the Qt app**

The Qt GUI tests and the Qt app's Windows hot-plug thread tests:

```bash
git rm -q \
  src/main/python/test/test_gui.py \
  src/main/python/test/test_autorefresh_win.py
```

The editors, the widgets, the Qt hot-plug thread and the Qt macro recorder (with its helpers `macro_key.py` and `macro_optimizer.py`):

```bash
git rm -q \
  src/main/python/autorefresh/autorefresh.py \
  src/main/python/autorefresh/autorefresh_thread.py \
  src/main/python/autorefresh/autorefresh_thread_web.py \
  src/main/python/autorefresh/autorefresh_thread_win.py \
  src/main/python/editor/alt_repeat_key.py \
  src/main/python/editor/basic_editor.py \
  src/main/python/editor/combos.py \
  src/main/python/editor/firmware_flasher.py \
  src/main/python/editor/key_override.py \
  src/main/python/editor/keymap_editor.py \
  src/main/python/editor/layout_editor.py \
  src/main/python/editor/macro_recorder.py \
  src/main/python/editor/matrix_test.py \
  src/main/python/editor/qmk_settings.py \
  src/main/python/editor/rgb_configurator.py \
  src/main/python/editor/tap_dance.py \
  src/main/python/macro/macro_action_ui.py \
  src/main/python/macro/macro_key.py \
  src/main/python/macro/macro_line.py \
  src/main/python/macro/macro_optimizer.py \
  src/main/python/macro/macro_recorder_linux.py \
  src/main/python/macro/macro_recorder_windows.py \
  src/main/python/macro/macro_tab.py \
  src/main/python/widgets/checkbox_no_padding.py \
  src/main/python/widgets/clickable_label.py \
  src/main/python/widgets/display_keyboard.py \
  src/main/python/widgets/display_keyboard_defs.py \
  src/main/python/widgets/editor_container.py \
  src/main/python/widgets/flowlayout.py \
  src/main/python/widgets/key_widget.py \
  src/main/python/widgets/keyboard_widget.py \
  src/main/python/widgets/square_button.py \
  src/main/python/widgets/tab_widget_keycodes.py
```

The app, its window, its web build, its dialogs and the Qt-only helpers:

```bash
git rm -q \
  src/main/python/main.py \
  src/main/python/main_window.py \
  src/main/python/webmain.py \
  src/main/python/about_keyboard.py \
  src/main/python/any_keycode_dialog.py \
  src/main/python/constants.py \
  src/main/python/linux_keystroke_recorder.py \
  src/main/python/tabbed_keycodes.py \
  src/main/python/textbox_window.py \
  src/main/python/themes.py \
  src/main/python/unlocker.py \
  src/main/python/util.py \
  src/main/python/vial_device.py
```

- [ ] **Step 4: The macro tests' `DummyKeyboard` moves to `test/`**

```bash
git mv src/main/python/protocol/dummy_keyboard.py src/main/python/test/dummy_keyboard.py
```

Apply to `src/main/python/test/dummy_keyboard.py`:

```diff
diff --git a/src/main/python/test/dummy_keyboard.py b/src/main/python/test/dummy_keyboard.py
--- a/src/main/python/test/dummy_keyboard.py
+++ b/src/main/python/test/dummy_keyboard.py
@@ -1,3 +1,4 @@
+""" A Keyboard that reads nothing from a device: 4 empty layers and 16 macros, for the macro tests """
 from protocol.keyboard_comm import Keyboard
 
 
```

Apply to `src/main/python/test/test_macro.py`:

```diff
diff --git a/src/main/python/test/test_macro.py b/src/main/python/test/test_macro.py
--- a/src/main/python/test/test_macro.py
+++ b/src/main/python/test/test_macro.py
@@ -1,37 +1,13 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
 import unittest
 
-from protocol.dummy_keyboard import DummyKeyboard
 from keycodes.keycodes import Keycode, recreate_keyboard_keycodes
 from macro.macro_action import ActionTap, ActionDown, ActionText, ActionDelay, ActionUp
-from macro.macro_key import KeyDown, KeyTap, KeyUp, KeyString
-from macro.macro_optimizer import remove_repeats, replace_with_tap, replace_with_string
-
-KC_A = Keycode.find_by_qmk_id("KC_A")
-KC_B = Keycode.find_by_qmk_id("KC_B")
-KC_C = Keycode.find_by_qmk_id("KC_C")
-
-CMB_TOG = Keycode.find_by_qmk_id("CMB_TOG")
+from test.dummy_keyboard import DummyKeyboard
 
 
 class TestMacro(unittest.TestCase):
 
-    def test_remove_repeats(self):
-        self.assertEqual(remove_repeats([KeyDown(KC_A), KeyDown(KC_A)]), [KeyDown(KC_A)])
-        self.assertEqual(remove_repeats([KeyDown(KC_A), KeyDown(KC_B), KeyDown(KC_B), KeyDown(KC_C), KeyDown(KC_C)]),
-                         [KeyDown(KC_A), KeyDown(KC_B), KeyDown(KC_C)])
-
-        # don't remove repeated taps
-        self.assertEqual(remove_repeats([KeyTap(KC_A), KeyTap(KC_A)]), [KeyTap(KC_A), KeyTap(KC_A)])
-
-    def test_replace_tap(self):
-        self.assertEqual(replace_with_tap([KeyDown(KC_A)]), [KeyDown(KC_A)])
-        self.assertEqual(replace_with_tap([KeyDown(KC_A), KeyUp(KC_A)]), [KeyTap(KC_A)])
-        self.assertEqual(replace_with_tap([KeyUp(KC_A), KeyDown(KC_A)]), [KeyUp(KC_A), KeyDown(KC_A)])
-
-    def test_replace_string(self):
-        self.assertEqual(replace_with_string([KeyTap(KC_A), KeyTap(KC_B)]), [KeyString("ab")])
-
     def test_serialize_v1(self):
         kb = DummyKeyboard(None)
         kb.vial_protocol = 1
```

Apply to `src/main/python/test/test_keyboard.py`:

```diff
diff --git a/src/main/python/test/test_keyboard.py b/src/main/python/test/test_keyboard.py
--- a/src/main/python/test/test_keyboard.py
+++ b/src/main/python/test/test_keyboard.py
@@ -4,7 +4,7 @@ import struct
 
 from keycodes.keycodes import Keycode
 from protocol.keyboard_comm import Keyboard
-from util import chunks, MSG_LEN
+from transport import chunks, MSG_LEN
 
 LAYOUT_2x2 = """
 {"name":"test","vendorId":"0x0000","productId":"0x1111","lighting":"none","matrix":{"rows":2,"cols":2},"layouts":{"keymap":[["0,0","0,1"],["1,0","1,1"]]}}
```

- [ ] **Step 5: The unlock hook without Qt's dialog**

Apply to `src/main/python/protocol/unlock_hook.py`:

```diff
diff --git a/src/main/python/protocol/unlock_hook.py b/src/main/python/protocol/unlock_hook.py
--- a/src/main/python/protocol/unlock_hook.py
+++ b/src/main/python/protocol/unlock_hook.py
@@ -1,14 +1,13 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
-""" How the protocol asks for the keyboard to be unlocked before a security-sensitive write.
-
-The Qt app shows its unlock dialog (the default). Other front ends install their own handler.
+""" How the protocol asks for the keyboard to be unlocked before a security-sensitive write: the server installs its
+handler (server.device.require_unlocked), which refuses the write while the keyboard is locked.
 """
 
 _handler = None
 
 
 def set_unlock_handler(handler):
-    """ Install handler(keyboard); pass None to restore the Qt unlock dialog.
+    """ Install handler(keyboard); None removes it.
 
     A handler must block until the keyboard is unlocked, or raise. If it returns without unlocking, the protocol
     goes on to send the write, which the firmware may silently reject. """
@@ -17,7 +16,6 @@ def set_unlock_handler(handler):
 
 
 def request_unlock(keyboard):
-    if _handler is not None:
-        return _handler(keyboard)
-    from unlocker import Unlocker
-    return Unlocker.unlock(keyboard)
+    if _handler is None:
+        raise RuntimeError("no unlock handler is installed (protocol.unlock_hook.set_unlock_handler)")
+    return _handler(keyboard)
```

- [ ] **Step 6: The dead code**

Apply to `src/main/python/hidproxy.py`:

```diff
diff --git a/src/main/python/hidproxy.py b/src/main/python/hidproxy.py
--- a/src/main/python/hidproxy.py
+++ b/src/main/python/hidproxy.py
@@ -1,51 +1,8 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
-import struct
+""" hidapi: its hidraw backend on Linux (the one Vial's udev rule gives access to), its default one elsewhere """
 import sys
 
-from protocol.constants import CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID
-
-if sys.platform == "emscripten":
-
-    import vialglue
-    import json
-
-    class hiddevice:
-
-        def open_path(self, path):
-            print("opening {}...".format(path))
-
-        def write(self, data):
-            return vialglue.write_device(data)
-
-        def read(self, length, timeout_ms=0):
-            data = vialglue.read_device()
-            return data
-
-
-    class hid:
-
-        @staticmethod
-        def enumerate():
-            from util import hid_send
-
-            desc = json.loads(vialglue.get_device_desc())
-            # hack: we don't know if it's vial or VIA device because webhid doesn't expose serial number
-            # so let's probe it with a vial command, and if the response looks good, inject fake vial serial number
-            # in the device descriptor
-            dev = hid.device()
-            data = hid_send(dev, struct.pack("BB", CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID), retries=20)
-            uid = data[4:12]
-            # here, a VIA keyboard will echo back all zeroes, while vial will return a valid UID
-            # so if this looks like vial, inject the serial numebr
-            if uid != b"\x00" * 8:
-                desc["serial_number"] = "vial:f64c2b3c"
-            return [desc]
-
-        @staticmethod
-        def device():
-            return hiddevice()
-
-elif sys.platform.startswith("linux"):
+if sys.platform.startswith("linux"):
     import hidraw as hid
 else:
     import hid
```

Apply to `src/main/python/keycodes/keycodes.py`:

```diff
diff --git a/src/main/python/keycodes/keycodes.py b/src/main/python/keycodes/keycodes.py
--- a/src/main/python/keycodes/keycodes.py
+++ b/src/main/python/keycodes/keycodes.py
@@ -2,8 +2,6 @@
 
 # SPDX-License-Identifier: GPL-2.0-or-later
 
-import sys
-
 from keycodes.keycodes_v5 import keycodes_v5
 from keycodes.keycodes_v6 import keycodes_v6
 
@@ -11,19 +9,15 @@ from keycodes.keycodes_v6 import keycodes_v6
 class Keycode:
 
     masked_keycodes = set()
-    recorder_alias_to_keycode = dict()
     qmk_id_to_keycode = dict()
     protocol = 0
     hidden = False
 
-    def __init__(self, qmk_id, label, tooltip=None, masked=False, printable=None, recorder_alias=None, alias=None, requires_feature=None):
+    def __init__(self, qmk_id, label, tooltip=None, masked=False, printable=None, alias=None, requires_feature=None):
         self.qmk_id = qmk_id
         self.qmk_id_to_keycode[qmk_id] = self
         self.requires_feature = requires_feature
         self.label = label
-        # we cannot embed full CJK fonts due to large size, workaround like this for now
-        if sys.platform == "emscripten" and not label.isascii() and qmk_id != "KC_TRNS":
-            self.label = qmk_id.replace("KC_", "")
 
         self.tooltip = tooltip
         # whether this keycode requires another sub-keycode
@@ -36,12 +30,6 @@ class Keycode:
         if alias:
             self.alias += alias
 
-        if recorder_alias:
-            for alias in recorder_alias:
-                if alias in self.recorder_alias_to_keycode:
-                    raise RuntimeError("Misconfigured: two keycodes claim the same alias {}".format(alias))
-                self.recorder_alias_to_keycode[alias] = self
-
         if masked:
             assert qmk_id.endswith("(kc)")
             self.masked_keycodes.add(qmk_id.replace("(kc)", ""))
@@ -71,10 +59,6 @@ class Keycode:
             qmk_id = qmk_id[qmk_id.find("(")+1:-1]
         return cls.find(qmk_id)
 
-    @classmethod
-    def find_by_recorder_alias(cls, alias):
-        return cls.recorder_alias_to_keycode.get(alias)
-
     @classmethod
     def find_by_qmk_id(cls, qmk_id):
         return cls.qmk_id_to_keycode.get(qmk_id)
@@ -174,7 +158,7 @@ KEYCODES_SPECIAL = [
 ]
 
 KEYCODES_BASIC_NUMPAD = [
-    K("KC_NUMLOCK", "Num\nLock", recorder_alias=["num lock"], alias=["KC_NLCK"]),
+    K("KC_NUMLOCK", "Num\nLock", alias=["KC_NLCK"]),
     K("KC_KP_SLASH", "/", alias=["KC_PSLS"]),
     K("KC_KP_ASTERISK", "*", alias=["KC_PAST"]),
     K("KC_KP_MINUS", "-", alias=["KC_PMNS"]),
@@ -197,96 +181,96 @@ KEYCODES_BASIC_NUMPAD = [
 
 KEYCODES_BASIC_NAV = [
     K("KC_PSCREEN", "Print\nScreen", alias=["KC_PSCR"]),
-    K("KC_SCROLLLOCK", "Scroll\nLock", recorder_alias=["scroll lock"], alias=["KC_SLCK", "KC_BRMD"]),
-    K("KC_PAUSE", "Pause", recorder_alias=["pause", "break"], alias=["KC_PAUS", "KC_BRK", "KC_BRMU"]),
-    K("KC_INSERT", "Insert", recorder_alias=["insert"], alias=["KC_INS"]),
-    K("KC_HOME", "Home", recorder_alias=["home"]),
-    K("KC_PGUP", "Page\nUp", recorder_alias=["page up"]),
-    K("KC_DELETE", "Del", recorder_alias=["delete"], alias=["KC_DEL"]),
-    K("KC_END", "End", recorder_alias=["end"]),
-    K("KC_PGDOWN", "Page\nDown", recorder_alias=["page down"], alias=["KC_PGDN"]),
-    K("KC_RIGHT", "Right", recorder_alias=["right"], alias=["KC_RGHT"]),
-    K("KC_LEFT", "Left", recorder_alias=["left"]),
-    K("KC_DOWN", "Down", recorder_alias=["down"]),
-    K("KC_UP", "Up", recorder_alias=["up"]),
+    K("KC_SCROLLLOCK", "Scroll\nLock", alias=["KC_SLCK", "KC_BRMD"]),
+    K("KC_PAUSE", "Pause", alias=["KC_PAUS", "KC_BRK", "KC_BRMU"]),
+    K("KC_INSERT", "Insert", alias=["KC_INS"]),
+    K("KC_HOME", "Home"),
+    K("KC_PGUP", "Page\nUp"),
+    K("KC_DELETE", "Del", alias=["KC_DEL"]),
+    K("KC_END", "End"),
+    K("KC_PGDOWN", "Page\nDown", alias=["KC_PGDN"]),
+    K("KC_RIGHT", "Right", alias=["KC_RGHT"]),
+    K("KC_LEFT", "Left"),
+    K("KC_DOWN", "Down"),
+    K("KC_UP", "Up"),
 ]
 
 KEYCODES_BASIC = [
-    K("KC_A", "A", printable="a", recorder_alias=["a"]),
-    K("KC_B", "B", printable="b", recorder_alias=["b"]),
-    K("KC_C", "C", printable="c", recorder_alias=["c"]),
-    K("KC_D", "D", printable="d", recorder_alias=["d"]),
-    K("KC_E", "E", printable="e", recorder_alias=["e"]),
-    K("KC_F", "F", printable="f", recorder_alias=["f"]),
-    K("KC_G", "G", printable="g", recorder_alias=["g"]),
-    K("KC_H", "H", printable="h", recorder_alias=["h"]),
-    K("KC_I", "I", printable="i", recorder_alias=["i"]),
-    K("KC_J", "J", printable="j", recorder_alias=["j"]),
-    K("KC_K", "K", printable="k", recorder_alias=["k"]),
-    K("KC_L", "L", printable="l", recorder_alias=["l"]),
-    K("KC_M", "M", printable="m", recorder_alias=["m"]),
-    K("KC_N", "N", printable="n", recorder_alias=["n"]),
-    K("KC_O", "O", printable="o", recorder_alias=["o"]),
-    K("KC_P", "P", printable="p", recorder_alias=["p"]),
-    K("KC_Q", "Q", printable="q", recorder_alias=["q"]),
-    K("KC_R", "R", printable="r", recorder_alias=["r"]),
-    K("KC_S", "S", printable="s", recorder_alias=["s"]),
-    K("KC_T", "T", printable="t", recorder_alias=["t"]),
-    K("KC_U", "U", printable="u", recorder_alias=["u"]),
-    K("KC_V", "V", printable="v", recorder_alias=["v"]),
-    K("KC_W", "W", printable="w", recorder_alias=["w"]),
-    K("KC_X", "X", printable="x", recorder_alias=["x"]),
-    K("KC_Y", "Y", printable="y", recorder_alias=["y"]),
-    K("KC_Z", "Z", printable="z", recorder_alias=["z"]),
-    K("KC_1", "!\n1", printable="1", recorder_alias=["1"]),
-    K("KC_2", "@\n2", printable="2", recorder_alias=["2"]),
-    K("KC_3", "#\n3", printable="3", recorder_alias=["3"]),
-    K("KC_4", "$\n4", printable="4", recorder_alias=["4"]),
-    K("KC_5", "%\n5", printable="5", recorder_alias=["5"]),
-    K("KC_6", "^\n6", printable="6", recorder_alias=["6"]),
-    K("KC_7", "&\n7", printable="7", recorder_alias=["7"]),
-    K("KC_8", "*\n8", printable="8", recorder_alias=["8"]),
-    K("KC_9", "(\n9", printable="9", recorder_alias=["9"]),
-    K("KC_0", ")\n0", printable="0", recorder_alias=["0"]),
-    K("KC_ENTER", "Enter", recorder_alias=["enter"], alias=["KC_ENT"]),
-    K("KC_ESCAPE", "Esc", recorder_alias=["esc"], alias=["KC_ESC"]),
-    K("KC_BSPACE", "Bksp", recorder_alias=["backspace"], alias=["KC_BSPC"]),
-    K("KC_TAB", "Tab", recorder_alias=["tab"]),
-    K("KC_SPACE", "Space", recorder_alias=["space"], alias=["KC_SPC"]),
-    K("KC_MINUS", "_\n-", printable="-", recorder_alias=["-"], alias=["KC_MINS"]),
-    K("KC_EQUAL", "+\n=", printable="=", recorder_alias=["="], alias=["KC_EQL"]),
-    K("KC_LBRACKET", "{\n[", printable="[", recorder_alias=["["], alias=["KC_LBRC"]),
-    K("KC_RBRACKET", "}\n]", printable="]", recorder_alias=["]"], alias=["KC_RBRC"]),
-    K("KC_BSLASH", "|\n\\", printable="\\", recorder_alias=["\\"], alias=["KC_BSLS"]),
-    K("KC_SCOLON", ":\n;", printable=";", recorder_alias=[";"], alias=["KC_SCLN"]),
-    K("KC_QUOTE", "\"\n'", printable="'", recorder_alias=["'"], alias=["KC_QUOT"]),
-    K("KC_GRAVE", "~\n`", printable="`", recorder_alias=["`"], alias=["KC_GRV", "KC_ZKHK"]),
-    K("KC_COMMA", "<\n,", printable=",", recorder_alias=[","], alias=["KC_COMM"]),
-    K("KC_DOT", ">\n.", printable=".", recorder_alias=["."]),
-    K("KC_SLASH", "?\n/", printable="/", recorder_alias=["/"], alias=["KC_SLSH"]),
-    K("KC_CAPSLOCK", "Caps\nLock", recorder_alias=["caps lock"], alias=["KC_CLCK", "KC_CAPS"]),
-    K("KC_F1", "F1", recorder_alias=["f1"]),
-    K("KC_F2", "F2", recorder_alias=["f2"]),
-    K("KC_F3", "F3", recorder_alias=["f3"]),
-    K("KC_F4", "F4", recorder_alias=["f4"]),
-    K("KC_F5", "F5", recorder_alias=["f5"]),
-    K("KC_F6", "F6", recorder_alias=["f6"]),
-    K("KC_F7", "F7", recorder_alias=["f7"]),
-    K("KC_F8", "F8", recorder_alias=["f8"]),
-    K("KC_F9", "F9", recorder_alias=["f9"]),
-    K("KC_F10", "F10", recorder_alias=["f10"]),
-    K("KC_F11", "F11", recorder_alias=["f11"]),
-    K("KC_F12", "F12", recorder_alias=["f12"]),
-
-    K("KC_APPLICATION", "Menu", recorder_alias=["menu", "left menu", "right menu"], alias=["KC_APP"]),
-    K("KC_LCTRL", "LCtrl", recorder_alias=["left ctrl", "ctrl"], alias=["KC_LCTL"]),
-    K("KC_LSHIFT", "LShift", recorder_alias=["left shift", "shift"], alias=["KC_LSFT"]),
-    K("KC_LALT", "LAlt", recorder_alias=["alt"], alias=["KC_LOPT"]),
-    K("KC_LGUI", "LGui", recorder_alias=["left windows", "windows"], alias=["KC_LCMD", "KC_LWIN"]),
-    K("KC_RCTRL", "RCtrl", recorder_alias=["right ctrl"], alias=["KC_RCTL"]),
-    K("KC_RSHIFT", "RShift", recorder_alias=["right shift"], alias=["KC_RSFT"]),
+    K("KC_A", "A", printable="a"),
+    K("KC_B", "B", printable="b"),
+    K("KC_C", "C", printable="c"),
+    K("KC_D", "D", printable="d"),
+    K("KC_E", "E", printable="e"),
+    K("KC_F", "F", printable="f"),
+    K("KC_G", "G", printable="g"),
+    K("KC_H", "H", printable="h"),
+    K("KC_I", "I", printable="i"),
+    K("KC_J", "J", printable="j"),
+    K("KC_K", "K", printable="k"),
+    K("KC_L", "L", printable="l"),
+    K("KC_M", "M", printable="m"),
+    K("KC_N", "N", printable="n"),
+    K("KC_O", "O", printable="o"),
+    K("KC_P", "P", printable="p"),
+    K("KC_Q", "Q", printable="q"),
+    K("KC_R", "R", printable="r"),
+    K("KC_S", "S", printable="s"),
+    K("KC_T", "T", printable="t"),
+    K("KC_U", "U", printable="u"),
+    K("KC_V", "V", printable="v"),
+    K("KC_W", "W", printable="w"),
+    K("KC_X", "X", printable="x"),
+    K("KC_Y", "Y", printable="y"),
+    K("KC_Z", "Z", printable="z"),
+    K("KC_1", "!\n1", printable="1"),
+    K("KC_2", "@\n2", printable="2"),
+    K("KC_3", "#\n3", printable="3"),
+    K("KC_4", "$\n4", printable="4"),
+    K("KC_5", "%\n5", printable="5"),
+    K("KC_6", "^\n6", printable="6"),
+    K("KC_7", "&\n7", printable="7"),
+    K("KC_8", "*\n8", printable="8"),
+    K("KC_9", "(\n9", printable="9"),
+    K("KC_0", ")\n0", printable="0"),
+    K("KC_ENTER", "Enter", alias=["KC_ENT"]),
+    K("KC_ESCAPE", "Esc", alias=["KC_ESC"]),
+    K("KC_BSPACE", "Bksp", alias=["KC_BSPC"]),
+    K("KC_TAB", "Tab"),
+    K("KC_SPACE", "Space", alias=["KC_SPC"]),
+    K("KC_MINUS", "_\n-", printable="-", alias=["KC_MINS"]),
+    K("KC_EQUAL", "+\n=", printable="=", alias=["KC_EQL"]),
+    K("KC_LBRACKET", "{\n[", printable="[", alias=["KC_LBRC"]),
+    K("KC_RBRACKET", "}\n]", printable="]", alias=["KC_RBRC"]),
+    K("KC_BSLASH", "|\n\\", printable="\\", alias=["KC_BSLS"]),
+    K("KC_SCOLON", ":\n;", printable=";", alias=["KC_SCLN"]),
+    K("KC_QUOTE", "\"\n'", printable="'", alias=["KC_QUOT"]),
+    K("KC_GRAVE", "~\n`", printable="`", alias=["KC_GRV", "KC_ZKHK"]),
+    K("KC_COMMA", "<\n,", printable=",", alias=["KC_COMM"]),
+    K("KC_DOT", ">\n.", printable="."),
+    K("KC_SLASH", "?\n/", printable="/", alias=["KC_SLSH"]),
+    K("KC_CAPSLOCK", "Caps\nLock", alias=["KC_CLCK", "KC_CAPS"]),
+    K("KC_F1", "F1"),
+    K("KC_F2", "F2"),
+    K("KC_F3", "F3"),
+    K("KC_F4", "F4"),
+    K("KC_F5", "F5"),
+    K("KC_F6", "F6"),
+    K("KC_F7", "F7"),
+    K("KC_F8", "F8"),
+    K("KC_F9", "F9"),
+    K("KC_F10", "F10"),
+    K("KC_F11", "F11"),
+    K("KC_F12", "F12"),
+
+    K("KC_APPLICATION", "Menu", alias=["KC_APP"]),
+    K("KC_LCTRL", "LCtrl", alias=["KC_LCTL"]),
+    K("KC_LSHIFT", "LShift", alias=["KC_LSFT"]),
+    K("KC_LALT", "LAlt", alias=["KC_LOPT"]),
+    K("KC_LGUI", "LGui", alias=["KC_LCMD", "KC_LWIN"]),
+    K("KC_RCTRL", "RCtrl", alias=["KC_RCTL"]),
+    K("KC_RSHIFT", "RShift", alias=["KC_RSFT"]),
     K("KC_RALT", "RAlt", alias=["KC_ALGR", "KC_ROPT"]),
-    K("KC_RGUI", "RGui", recorder_alias=["right windows"], alias=["KC_RCMD", "KC_RWIN"]),
+    K("KC_RGUI", "RGui", alias=["KC_RCMD", "KC_RWIN"]),
 ]
 
 KEYCODES_BASIC.extend(KEYCODES_BASIC_NUMPAD)
```

Apply to `src/main/python/protocol/alt_repeat_key.py`:

```diff
diff --git a/src/main/python/protocol/alt_repeat_key.py b/src/main/python/protocol/alt_repeat_key.py
--- a/src/main/python/protocol/alt_repeat_key.py
+++ b/src/main/python/protocol/alt_repeat_key.py
@@ -77,9 +77,6 @@ class ProtocolAltRepeatKey(BaseProtocol):
             e = (Keycode.serialize(e[0]), Keycode.serialize(e[1]), e[2], e[3])
             self.alt_repeat_key_entries.append(AltRepeatKeyEntry(e))
 
-    def alt_repeat_key_get(self, idx):
-        return self.alt_repeat_key_entries[idx]
-
     def alt_repeat_key_set(self, idx, entry):
         if entry != self.alt_repeat_key_entries[idx]:
             if entry.keycode == RESET_KEYCODE or entry.alt_keycode == RESET_KEYCODE:
```

Apply to `src/main/python/protocol/combo.py`:

```diff
diff --git a/src/main/python/protocol/combo.py b/src/main/python/protocol/combo.py
--- a/src/main/python/protocol/combo.py
+++ b/src/main/python/protocol/combo.py
@@ -18,9 +18,6 @@ class ProtocolCombo(BaseProtocol):
                                      Keycode.serialize(entry[2]), Keycode.serialize(entry[3]),
                                      Keycode.serialize(entry[4]))
 
-    def combo_get(self, idx):
-        return self.combo_entries[idx]
-
     def combo_set(self, idx, entry):
         if self.combo_entries[idx] == entry:
             return
```

Apply to `src/main/python/protocol/key_override.py`:

```diff
diff --git a/src/main/python/protocol/key_override.py b/src/main/python/protocol/key_override.py
--- a/src/main/python/protocol/key_override.py
+++ b/src/main/python/protocol/key_override.py
@@ -90,9 +90,6 @@ class ProtocolKeyOverride(BaseProtocol):
             e = (Keycode.serialize(e[0]), Keycode.serialize(e[1]), e[2], e[3], e[4], e[5], e[6])
             self.key_override_entries.append(KeyOverrideEntry(e))
 
-    def key_override_get(self, idx):
-        return self.key_override_entries[idx]
-
     def key_override_set(self, idx, entry):
         if entry != self.key_override_entries[idx]:
             if entry.replacement == RESET_KEYCODE:
```

Apply to `src/main/python/protocol/keyboard_comm.py`:

```diff
diff --git a/src/main/python/protocol/keyboard_comm.py b/src/main/python/protocol/keyboard_comm.py
--- a/src/main/python/protocol/keyboard_comm.py
+++ b/src/main/python/protocol/keyboard_comm.py
@@ -523,14 +523,6 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
                                             self.rgb_mode, self.rgb_speed,
                                             self.rgb_hsv[0], self.rgb_hsv[1], self.rgb_hsv[2]))
 
-    def set_vialrgb_brightness(self, value):
-        self.rgb_hsv = (self.rgb_hsv[0], self.rgb_hsv[1], value)
-        self._vialrgb_set_mode()
-
-    def set_vialrgb_speed(self, value):
-        self.rgb_speed = value
-        self._vialrgb_set_mode()
-
     def set_vialrgb_mode(self, value):
         self.rgb_mode = value
         self._vialrgb_set_mode()
```

Apply to `src/main/python/protocol/macro.py`:

```diff
diff --git a/src/main/python/protocol/macro.py b/src/main/python/protocol/macro.py
--- a/src/main/python/protocol/macro.py
+++ b/src/main/python/protocol/macro.py
@@ -159,11 +159,6 @@ class ProtocolMacro(BaseProtocol):
             macros = self.macro.split(b"\x00") + [b""] * self.macro_count
             self.macro = b"\x00".join(macros[:self.macro_count]) + b"\x00"
 
-    def reload_macros(self):
-        """ Loads macro information from the keyboard """
-        self.reload_macros_early()
-        self.reload_macros_late()
-
     def set_macro(self, data):
         if len(data) > self.macro_memory:
             raise RuntimeError("the macro is too big: got {} max {}".format(len(data), self.macro_memory))
```

Apply to `src/main/python/protocol/tap_dance.py`:

```diff
diff --git a/src/main/python/protocol/tap_dance.py b/src/main/python/protocol/tap_dance.py
--- a/src/main/python/protocol/tap_dance.py
+++ b/src/main/python/protocol/tap_dance.py
@@ -18,9 +18,6 @@ class ProtocolTapDance(BaseProtocol):
                                          Keycode.serialize(entry[2]), Keycode.serialize(entry[3]),
                                          entry[4])
 
-    def tap_dance_get(self, idx):
-        return self.tap_dance_entries[idx]
-
     def tap_dance_set(self, idx, entry):
         if self.tap_dance_entries[idx] == entry:
             return
```

- [ ] **Step 7: The dependencies, and the venv recreated from them**

Apply to `requirements.txt`:

```diff
diff --git a/requirements.txt b/requirements.txt
--- a/requirements.txt
+++ b/requirements.txt
@@ -1,13 +1,9 @@
-certifi
 fastapi==0.143.1
 hidapi==0.15.0
-keyboard==0.13.5
 platformdirs==4.13.0
 pydantic==2.14.1
 pydantic-core==2.50.1
 PyInstaller==6.22.3
-PyQt5==5.15.11
-pywin32==312; sys_platform == 'win32'
 simpleeval==1.0.8
 starlette==1.8.0
 uvicorn==0.54.0
```

Apply to `test-requirements.txt`:

```diff
diff --git a/test-requirements.txt b/test-requirements.txt
--- a/test-requirements.txt
+++ b/test-requirements.txt
@@ -3,5 +3,3 @@ httpx2==2.13.1
 pytest==9.1.1
 pytest-xdist==3.8.0
 execnet==2.1.2
-pytest-qt==4.5.0
-pytest-xvfb==3.1.1; sys_platform == 'linux'
```

The venv is created again with the same base Python, so that nothing removed stays installed. Close anything that runs from `.venv` first: an editor's Python console, or a running `vial_web.py`.

```bash
base="$(.venv/Scripts/python.exe -c 'import pathlib, sys; print(pathlib.Path(sys._base_executable).as_posix())')" && echo "base Python: $base" && rm -rf .venv && "$base" -m venv .venv && .venv/Scripts/python.exe -m pip install -q --disable-pip-version-check -r test-requirements.txt && echo "Qt and recorder packages left: $(.venv/Scripts/python.exe -m pip list --disable-pip-version-check 2>/dev/null | grep -i -c -E '^(pyqt5|pyqt5-qt5|pyqt5-sip|keyboard|pywin32|certifi|pytest-qt|pytest-xvfb) ')"
```

Expected: `Qt and recorder packages left: 0`.

- [ ] **Step 8: Run the guard test, the whole suite, the API types and the e2e suite on the new venv**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_core_isolation.py
```

Expected: `2 passed`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1053 passed, 2 skipped`. That is 15 tests fewer (the Qt GUI 7, the Windows hot-plug thread 5, the recorder helpers 3) and one more (the guard).

```bash
cd web && npm run check:api && npx playwright test
```

Expected: `src/api/schema.d.ts is up to date` and `188 passed`.

```bash
echo "PyQt5 is named in $(git grep -l PyQt5 -- src requirements.txt test-requirements.txt | wc -l) file(s): $(git grep -l PyQt5 -- src requirements.txt test-requirements.txt) (end)"
```

Expected: `PyQt5 is named in 1 file(s): src/main/python/test/test_core_isolation.py (end)`: the guard's list of Qt packages.

- [ ] **Step 9: Commit** (the deletions and the move are staged already)

```bash
git add requirements.txt \
  src/main/python/hidproxy.py \
  src/main/python/keycodes/keycodes.py \
  src/main/python/protocol/alt_repeat_key.py \
  src/main/python/protocol/combo.py \
  src/main/python/protocol/key_override.py \
  src/main/python/protocol/keyboard_comm.py \
  src/main/python/protocol/macro.py \
  src/main/python/protocol/tap_dance.py \
  src/main/python/protocol/unlock_hook.py \
  src/main/python/test/dummy_keyboard.py \
  src/main/python/test/test_core_isolation.py \
  src/main/python/test/test_keyboard.py \
  src/main/python/test/test_macro.py \
  test-requirements.txt
git commit -m "refactor: remove the Qt app, its tests and its dependencies"
```

### Task 7: Remove fbs, the NSIS installer, the docker builder, the AppImage recipe and the fbs icon sets

These built the Qt app with fbs. Task 8 replaces them with PyInstaller.

- `requirements-fbs.txt`, `util/fbs_build.py` and `util/setup_python36.sh` (the Python 3.6 fbs needed);
- `util/linux-builder/`: the docker builder;
- `util/prepare-release.sh`: it only renamed the AppImage, dmg and NSIS installer;
- fbs' `src/build/settings/*.json`, the NSIS script `src/installer/windows/Installer.nsi`, and the AppImage recipe `misc/Vial.yml`;
- the fbs icon sets `src/main/icons/{base,linux,mac}` and their README. `Icon.ico` stays: it is `Vial.exe`'s icon.

`use-python.*` keep creating, installing and activating the venv, but no longer install fbs or hash `requirements-fbs.txt`. `.python-version` says 3.13. `.github/workflows/main.yml` still names fbs until Task 10 rewrites it.

**Files:**
- Modify: `use-python.sh`
- Modify: `use-python.ps1`
- Modify: `use-python.cmd`
- Modify: `.python-version`
- Delete: 27 files, listed in the `git rm` step

- [ ] **Step 1: Delete the fbs build, the installer and the docker builder**

```bash
git rm -q \
  requirements-fbs.txt \
  util/fbs_build.py \
  util/setup_python36.sh \
  util/prepare-release.sh \
  util/linux-builder/.gitignore \
  util/linux-builder/Dockerfile \
  util/linux-builder/_builder.sh \
  util/linux-builder/build-in-docker.sh
```

```bash
git rm -q \
  src/build/settings/base.json \
  src/build/settings/linux.json \
  src/build/settings/mac.json \
  src/installer/windows/Installer.nsi \
  misc/Vial.yml
```

- [ ] **Step 2: Delete the fbs icon sets**

```bash
git rm -q \
  src/main/icons/README.md \
  src/main/icons/base/16.png \
  src/main/icons/base/24.png \
  src/main/icons/base/32.png \
  src/main/icons/base/48.png \
  src/main/icons/base/64.png \
  src/main/icons/linux/1024.png \
  src/main/icons/linux/128.png \
  src/main/icons/linux/256.png \
  src/main/icons/linux/512.png \
  src/main/icons/mac/1024.png \
  src/main/icons/mac/128.png \
  src/main/icons/mac/256.png \
  src/main/icons/mac/512.png
```

- [ ] **Step 3: `use-python.*` without fbs; Python 3.13**

Apply to `use-python.sh`:

```diff
diff --git a/use-python.sh b/use-python.sh
--- a/use-python.sh
+++ b/use-python.sh
@@ -28,7 +28,7 @@ fi
 # .venv/.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
 # The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
 _vial_hashcode='import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())'
-_vial_hash="$("$_vial_venvpy" -c "$_vial_hashcode" "$(cygpath -w "$_vial_repo")" requirements.txt test-requirements.txt requirements-fbs.txt | tr -d '\r')"
+_vial_hash="$("$_vial_venvpy" -c "$_vial_hashcode" "$(cygpath -w "$_vial_repo")" requirements.txt test-requirements.txt | tr -d '\r')"
 unset _vial_hashcode
 if [ -z "$_vial_hash" ]; then
     echo "could not read the requirement files" >&2
@@ -39,8 +39,7 @@ fi
 if [ "$(cat "$_vial_repo/.venv/.vial-installed" 2>/dev/null | tr -d '\r\n')" != "$_vial_hash" ]; then
     echo "Installing requirements ..."
     if ! { "$_vial_venvpy" -m pip install --quiet --upgrade pip &&
-           "$_vial_venvpy" -m pip install --quiet -r "$(cygpath -w "$_vial_repo/test-requirements.txt")" &&
-           "$_vial_venvpy" -m pip install --quiet --no-deps -r "$(cygpath -w "$_vial_repo/requirements-fbs.txt")"; }; then
+           "$_vial_venvpy" -m pip install --quiet -r "$(cygpath -w "$_vial_repo/test-requirements.txt")"; }; then
         echo "installing requirements failed; rerun to retry" >&2
         unset _vial_repo _vial_venvpy _vial_hash
         return 1 2>/dev/null || exit 1
```

Apply to `use-python.ps1`:

```diff
diff --git a/use-python.ps1 b/use-python.ps1
--- a/use-python.ps1
+++ b/use-python.ps1
@@ -23,7 +23,7 @@ if (-not (Test-Path $venvPy)) {
 # .venv\.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
 # The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
 $hashCode = 'import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())'
-$reqHash = "$(& $venvPy -c $hashCode $PSScriptRoot requirements.txt test-requirements.txt requirements-fbs.txt)".Trim()
+$reqHash = "$(& $venvPy -c $hashCode $PSScriptRoot requirements.txt test-requirements.txt)".Trim()
 if ($LASTEXITCODE -ne 0 -or -not $reqHash) { Write-Error "could not read the requirement files"; return }
 $installed = if (Test-Path $marker) { "$(Get-Content $marker -Raw)".Trim() } else { '' }
 
@@ -33,8 +33,6 @@ if ($installed -ne $reqHash) {
     if ($LASTEXITCODE -ne 0) { Write-Error "pip upgrade failed; rerun to retry"; return }
     & $venvPy -m pip install --quiet -r (Join-Path $PSScriptRoot 'test-requirements.txt')
     if ($LASTEXITCODE -ne 0) { Write-Error "installing test-requirements.txt failed; rerun to retry"; return }
-    & $venvPy -m pip install --quiet --no-deps -r (Join-Path $PSScriptRoot 'requirements-fbs.txt')
-    if ($LASTEXITCODE -ne 0) { Write-Error "installing requirements-fbs.txt failed; rerun to retry"; return }
     Set-Content -Path $marker -Value $reqHash
 }
 
```

Apply to `use-python.cmd`:

```diff
diff --git a/use-python.cmd b/use-python.cmd
--- a/use-python.cmd
+++ b/use-python.cmd
@@ -18,7 +18,7 @@ echo Creating .venv with %VIAL_PYTHON_HOME%\python.exe ...
 :install
 rem .venv\.vial-installed holds a hash of the requirement files as last installed: when they change, install again.
 rem The same Python one-liner computes it in use-python.sh, .ps1 and .cmd, so the three agree.
-"%~dp0.venv\Scripts\python.exe" -c "import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())" "%~dp0." requirements.txt test-requirements.txt requirements-fbs.txt > "%~dp0.venv\.vial-requirements" || (echo could not read the requirement files 1>&2 & exit /b 1)
+"%~dp0.venv\Scripts\python.exe" -c "import hashlib,pathlib,sys;d=pathlib.Path(sys.argv[1]);print(hashlib.sha256(bytes().join(hashlib.sha256((d/f).read_bytes()).digest() for f in sys.argv[2:])).hexdigest())" "%~dp0." requirements.txt test-requirements.txt > "%~dp0.venv\.vial-requirements" || (echo could not read the requirement files 1>&2 & exit /b 1)
 set "_vial_hash="
 set "_vial_installed="
 set /p _vial_hash=<"%~dp0.venv\.vial-requirements"
@@ -29,7 +29,6 @@ if "%_vial_hash%"=="%_vial_installed%" goto activate
 echo Installing requirements ...
 "%~dp0.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip || (echo pip upgrade failed; rerun to retry 1>&2 & exit /b 1)
 "%~dp0.venv\Scripts\python.exe" -m pip install --quiet -r "%~dp0test-requirements.txt" || (echo installing test-requirements.txt failed; rerun to retry 1>&2 & exit /b 1)
-"%~dp0.venv\Scripts\python.exe" -m pip install --quiet --no-deps -r "%~dp0requirements-fbs.txt" || (echo installing requirements-fbs.txt failed; rerun to retry 1>&2 & exit /b 1)
 >"%~dp0.venv\.vial-installed" echo %_vial_hash%
 
 :activate
```

Apply to `.python-version`:

```diff
diff --git a/.python-version b/.python-version
--- a/.python-version
+++ b/.python-version
@@ -1 +1 @@
-3.6.0
+3.13
```

- [ ] **Step 4: Check what is left**

```bash
echo "left: $(git ls-files src/build src/installer misc util src/main/icons requirements-fbs.txt | paste -sd' ' -) (end)" && echo "fbs in use-python: $(git grep -i -c fbs -- 'use-python.*' | wc -l)"
```

Expected: `left: src/main/icons/Icon.ico util/macro_fuzzer_v1.py util/macro_fuzzer_v2.py (end)` and `fbs in use-python: 0`.

- [ ] **Step 5: Commit** (the deletions are staged already)

```bash
git add .python-version \
  use-python.cmd \
  use-python.ps1 \
  use-python.sh
git commit -m "build: remove fbs, the NSIS installer, the docker builder, the AppImage recipe and the fbs icon sets"
```

### Task 8: `vial.spec` builds Vial as one executable; `vial --version`, `vial --self-check`; the smoke test

- **`version.py`** holds the version, once: `VERSION = "0.8.0"` and `PRODUCT = "Vial (web)"`. `vial --version` prints "Vial (web) 0.8.0".
- **`selfcheck.py`**, for `vial --self-check`. It loads hidapi without asking it for any device, imports the server and the uvicorn modules PyInstaller can miss, and reads the web UI and `qmk_settings.json`. It prints one line and exits 0, or lists what is missing and exits 1. `main()` handles the flag before the data dir, the instance lock or the log are touched.
- **`util/smoke_test.py`** (standard library only), for any command that runs Vial:
  - runs `--self-check`;
  - starts Vial with `--fake --no-browser --data-dir <temp>`;
  - waits for the link, opens it for the session cookie, and reads `GET /api/session` (a connected simulated keyboard);
  - quits with `POST /api/shutdown` and checks that Vial exits with 0 by itself;
  - prints how long the start took.
- **`vial.spec`** builds a one-file console executable with PyInstaller: `dist/Vial.exe` on Windows, `dist/vial` elsewhere.
  - Its datas come from `resources.pyinstaller_datas()`, so it refuses to build without the web UI.
  - It lists uvicorn's run-time imports and hidapi's extension as hidden imports, and excludes tkinter, PyQt5, pytest, setuptools, pkg_resources and PyInstaller.
  - No UPX, nothing stripped.
  - On Windows: `Icon.ico`, and version info built from `version.py`.
- **`.gitignore`** ignores PyInstaller's `/build/` and `/dist/` instead of fbs' `target`.

**Files:**
- Create: `src/main/python/version.py`
- Create: `src/main/python/selfcheck.py`
- Test: `src/main/python/test/test_selfcheck.py` (new)
- Test: `src/main/python/test/test_vial_web.py`
- Modify: `src/main/python/vial_web.py`
- Create: `util/smoke_test.py`
- Create: `vial.spec`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_selfcheck.py`:

```python
import pytest

import resources
import selfcheck
import vial_web


class Imports:
    """ Stands in for importlib.import_module: records what is imported (nothing is), and fails for some names """

    def __init__(self, failing=()):
        self.failing = failing
        self.imported = []

    def __call__(self, name):
        self.imported.append(name)
        if name in self.failing:
            raise ImportError("DLL load failed while importing hid")


@pytest.fixture
def web_ui_built(monkeypatch):
    monkeypatch.setattr(resources, "web_ui_missing", lambda: None)


def test_a_complete_build_has_no_problems(web_ui_built):
    imports = Imports()
    assert selfcheck.problems(imports) == []
    assert imports.imported == ["hidproxy", *selfcheck.SERVER_MODULES]


def test_hidapi_not_loading_is_a_problem(web_ui_built):
    assert selfcheck.problems(Imports(failing=("hidproxy",))) == [
        "hidapi can't be loaded: DLL load failed while importing hid"]


def test_a_server_module_missing_is_a_problem(web_ui_built):
    found = selfcheck.problems(Imports(failing=("uvicorn.lifespan.on",)))
    assert found == ["uvicorn.lifespan.on can't be imported: DLL load failed while importing hid"]


def test_the_web_ui_or_the_settings_missing_is_a_problem(monkeypatch, tmp_path):
    monkeypatch.setattr(resources, "SOURCE_ROOT", str(tmp_path))  # a checkout with nothing built or bundled
    found = selfcheck.problems(Imports())
    assert len(found) == 2
    assert "the web UI isn't built" in found[0]
    assert found[1].startswith("the QMK settings can't be read")


@pytest.mark.parametrize("found, code", [([], 0), (["hidapi can't be loaded: no"], 1)])
def test_vial_self_check_says_what_is_missing_and_never_looks_for_a_keyboard(monkeypatch, capsys, tmp_path, found,
                                                                           code):
    monkeypatch.setattr(selfcheck, "problems", lambda: found)

    def refuse(*args, **kwargs):
        raise AssertionError("looked for a keyboard, or used the data dir")
    monkeypatch.setattr(vial_web, "make_backend", refuse)
    monkeypatch.setattr(vial_web, "claim_instance", refuse)
    monkeypatch.setattr(vial_web, "setup_logging", refuse)
    assert vial_web.main(["--self-check"]) == code
    out = capsys.readouterr().out
    if found:
        assert "this build is incomplete" in out and "  - hidapi can't be loaded: no" in out
    else:
        assert "this build has everything it needs" in out and "No keyboard was looked for." in out
```

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -13,6 +13,7 @@ import uvicorn
 
 import console
 import resources
+import version
 import vial_web
 from protocol.unlock_hook import set_unlock_handler
 from server import device as device_module
@@ -113,6 +114,15 @@ def test_dry_run_says_a_keyboard_waits_for_its_unlock_and_leaves_it_waiting(monk
     assert vk.unlock_in_progress and vk.unlock_counter == counter
 
 
+def test_version_is_printed(capsys):
+    with pytest.raises(SystemExit) as stopped:
+        vial_web.parse_args(["--version"])
+    assert stopped.value.code == 0
+    assert capsys.readouterr().out.strip() == "Vial (web) " + version.VERSION
+    # vial.spec makes Windows' four-number version of it
+    assert all(part.isdigit() for part in version.VERSION.split(".")) and len(version.VERSION.split(".")) == 3
+
+
 def test_definition_requires_fake():
     with pytest.raises(SystemExit):
         vial_web.parse_args(["--definition", "x.json"])
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_selfcheck.py test/test_vial_web.py
```

Expected: `No module named 'selfcheck'` and `No module named 'version'` and `2 errors`.

- [ ] **Step 3: The version, the self-check and the two flags**

Create `src/main/python/version.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Vial's version, set here only: `vial --version` prints it, and vial.spec puts it in Vial.exe's version info """

VERSION = "0.8.0"
""" major.minor.patch, numbers only (Windows' version info takes four numbers: this one and 0) """
PRODUCT = "Vial (web)"
```

Create `src/main/python/selfcheck.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" `vial --self-check`: whether this build of Vial has everything it needs. hidapi is loaded, but never asked for any
device: no keyboard is looked for or opened. The CI's smoke test runs it on every built executable. """
import importlib
import json

import resources
import version

SERVER_MODULES = (
    "server.app",
    "simulator.corne",
    # what uvicorn picks by name when it runs (vial.spec's hidden imports)
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.lifespan.on",
)


def problems(import_module=importlib.import_module):
    """ What this build lacks, one sentence each; empty when it has everything """
    found = []
    try:
        import_module("hidproxy")  # hidapi's extension: its hidraw backend on Linux
    except Exception as e:  # ImportError, or its native library failing to load
        found.append("hidapi can't be loaded: {}".format(e))
    for name in SERVER_MODULES:
        try:
            import_module(name)
        except Exception as e:
            found.append("{} can't be imported: {}".format(name, e))
    missing = resources.web_ui_missing()
    if missing:
        found.append(missing)
    try:
        with open(resources.path(resources.QMK_SETTINGS), "r", encoding="utf-8") as inf:
            json.load(inf)
    except (OSError, ValueError) as e:
        found.append("the QMK settings can't be read: {}".format(e))
    return found


def main():
    """ Prints what this build lacks, if anything; returns the exit code """
    found = problems()
    name = "{} {}".format(version.PRODUCT, version.VERSION)
    if found:
        print("{}: this build is incomplete:".format(name))
        for problem in found:
            print("  - " + problem)
        return 1
    print("{}: this build has everything it needs (hidapi, the server, the web UI, the QMK settings). No keyboard was "
          "looked for.".format(name))
    return 0
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -22,6 +22,7 @@ import platformdirs
 
 import console
 import resources
+import version
 
 APP_NAME = "Vial"
 FAKE_SUBDIR = "fake"
@@ -364,6 +365,7 @@ def port_number(text):
 
 def parse_args(argv):
     parser = argparse.ArgumentParser(description="Vial keyboard configurator (web UI)")
+    parser.add_argument("--version", action="version", version="{} {}".format(version.PRODUCT, version.VERSION))
     parser.add_argument("--fake", action="store_true", help="use a simulated keyboard instead of real hardware")
     parser.add_argument("--definition", help="with --fake: vial.json of the keyboard to simulate")
     parser.add_argument("--layout", help="with --fake: .vil layout file to load into the simulated keyboard")
@@ -384,6 +386,9 @@ def parse_args(argv):
     parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
     parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
     parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
+    parser.add_argument("--self-check", action="store_true",
+                        help="check that this build has everything it needs (hidapi, the server, the web UI) and exit, "
+                             "without looking for any keyboard")
     parser.add_argument("--data-dir", type=os.path.abspath,
                         help="keep the instance lock, session file, log and names in this folder instead of the "
                              "user's data and config folders (for tests and development)")
@@ -397,6 +402,9 @@ def parse_args(argv):
 
 def main(argv=None):
     args = parse_args(sys.argv[1:] if argv is None else argv)
+    if args.self_check:
+        import selfcheck
+        return selfcheck.main()
     use_data_dir(args.data_dir)
 
     # Claim the instance before touching any keyboard: a second instance opening the keyboard and reading
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_selfcheck.py test/test_vial_web.py
```

Expected: `126 passed, 1 skipped`.

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1060 passed, 2 skipped`.

- [ ] **Step 5: The smoke test, first against the source**

Create `util/smoke_test.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Smoke test of a Vial build: it starts, serves its simulated keyboard, and quits through the page's API.

    python util/smoke_test.py dist/Vial.exe        (or dist/vial; any command that runs Vial)

Vial runs with --fake (the simulated keyboard: no keyboard is looked for or opened), --no-browser and a temporary
--data-dir. It checks `--self-check`, then waits for the link Vial prints, reads GET /api/session (a connected
simulated keyboard), quits with POST /api/shutdown, and checks that Vial exits with 0 by itself. Prints how long it
took to start. Python's standard library only. Exits 1 on any failure.
"""
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

START_TIMEOUT = 60
EXIT_TIMEOUT = 20
LINK = re.compile(r"Open it at:\r?\n\s*(http://127\.0\.0\.1:(\d+)/\?token=[\w-]+)\r?\n")


def fail(message, output=""):
    print("smoke test FAILED: " + message, file=sys.stderr)
    if output:
        print("--- Vial's output ---\n" + output, file=sys.stderr)
    sys.exit(1)


def self_check(command):
    result = subprocess.run(command + ["--self-check"], capture_output=True, text=True, timeout=START_TIMEOUT)
    if result.returncode != 0:
        fail("--self-check exited with {}".format(result.returncode), result.stdout + result.stderr)
    print(result.stdout.strip())


def main(command):
    self_check(command)
    data_dir = tempfile.mkdtemp(prefix="vial-smoke-")
    started = time.monotonic()
    vial = subprocess.Popen(command + ["--fake", "--no-browser", "--data-dir", data_dir],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    output = []

    def read():
        for line in vial.stdout:
            output.append(line)
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        while True:
            found = LINK.search("".join(output))
            if found:
                break
            if vial.poll() is not None:
                fail("Vial exited ({}) before serving".format(vial.returncode), "".join(output))
            if time.monotonic() - started > START_TIMEOUT:
                fail("Vial did not serve within {} s".format(START_TIMEOUT), "".join(output))
            time.sleep(0.02)
        startup = time.monotonic() - started
        link, port = found.group(1), found.group(2)
        base = "http://127.0.0.1:{}".format(port)
        # the link sets the session cookie; straight to this computer, never through a proxy
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                             urllib.request.ProxyHandler({}))
        opener.open(link, timeout=10).read()
        session = json.loads(opener.open(base + "/api/session", timeout=10).read())
        if session.get("fake") is not True or session.get("status") != "connected":
            fail("unexpected session: {}".format(session), "".join(output))
        quit_request = urllib.request.Request(base + "/api/shutdown", method="POST", headers={"Origin": base})
        status = opener.open(quit_request, timeout=10).status
        if status != 204:
            fail("POST /api/shutdown answered {}".format(status), "".join(output))
        try:
            code = vial.wait(EXIT_TIMEOUT)
        except subprocess.TimeoutExpired:
            fail("Vial did not exit within {} s of POST /api/shutdown".format(EXIT_TIMEOUT), "".join(output))
        reader.join(5)
        if code != 0:
            fail("Vial exited with {}".format(code), "".join(output))
        print("smoke test passed: started in {:.2f} s, served {} ({}), quit with POST /api/shutdown, exit code 0"
              .format(startup, session.get("device"), session.get("platform")))
    finally:
        if vial.poll() is None:
            vial.kill()
            vial.wait()
        shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    program = sys.argv[1]
    # a path to the executable, as Windows takes it too (it doesn't run "dist/Vial.exe" from the current folder)
    main([os.path.abspath(program) if os.path.isfile(program) else program] + sys.argv[2:])
```

It runs `--self-check` and then `--fake --no-browser --data-dir <temp>`; nothing else:

```bash
cd web && npm run build && cd .. && .venv/Scripts/python.exe util/smoke_test.py .venv/Scripts/python.exe src/main/python/vial_web.py
```

Expected: `built in` and `Vial (web) 0.8.0: this build has everything it needs` and `smoke test passed: started in` and `exit code 0`.

- [ ] **Step 6: The spec, and the build**

Create `vial.spec`:

```python
# -*- mode: python -*-
# PyInstaller spec: Vial as one executable file, which unpacks itself to a temporary folder at start (one-file mode).
# Windows: dist/Vial.exe, a console app with Vial's icon and version info. Linux and macOS: dist/vial.
#
# Build it from the repository root, once the web UI is built (see README.md):
#     cd web && npm ci && npm run build && cd ..
#     python -m PyInstaller vial.spec
#
# It refuses to build without the web UI (resources.pyinstaller_datas). Plain PyInstaller: no UPX, nothing stripped.
import os
import sys

ROOT = os.path.abspath(SPECPATH)  # noqa: F821 (PyInstaller defines SPECPATH)
PYTHON = os.path.join(ROOT, "src", "main", "python")
sys.path.insert(0, PYTHON)

import resources  # noqa: E402
import version  # noqa: E402

WINDOWS = sys.platform == "win32"

HIDDEN_IMPORTS = [
    # uvicorn picks its event loop, HTTP and WebSocket implementations and its logging by name at run time
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
    "uvicorn.lifespan.on",
    "websockets",
    # hidapi: hidproxy imports its hidraw backend on Linux, its default one elsewhere
    "hidraw" if sys.platform.startswith("linux") else "hid",
]

EXCLUDES = [
    # never imported by Vial; left out in case the build's Python has them
    "tkinter",
    "PyQt5",
    "pytest",
    # the build's own tools, which PyInstaller's analysis otherwise pulls in through optional imports
    "setuptools",
    "pkg_resources",
    "PyInstaller",
]


def windows_version_info():
    from PyInstaller.utils.win32.versioninfo import (FixedFileInfo, StringFileInfo, StringStruct, StringTable,
                                                     VarFileInfo, VarStruct, VSVersionInfo)
    numbers = tuple(int(n) for n in version.VERSION.split(".")) + (0,)
    strings = [
        StringStruct("CompanyName", "Vial (web) fork of vial-gui"),
        StringStruct("FileDescription", version.PRODUCT),
        StringStruct("FileVersion", version.VERSION),
        StringStruct("InternalName", "Vial"),
        StringStruct("LegalCopyright", "GPL-2.0-or-later"),
        StringStruct("OriginalFilename", "Vial.exe"),
        StringStruct("ProductName", version.PRODUCT),
        StringStruct("ProductVersion", version.VERSION),
    ]
    return VSVersionInfo(
        ffi=FixedFileInfo(filevers=numbers, prodvers=numbers),
        kids=[StringFileInfo([StringTable("040904B0", strings)]), VarFileInfo([VarStruct("Translation", [0x0409, 1200])])],
    )


a = Analysis(  # noqa: F821
    [os.path.join(PYTHON, "vial_web.py")],
    pathex=[PYTHON],
    datas=resources.pyinstaller_datas(),
    hiddenimports=HIDDEN_IMPORTS,
    excludes=EXCLUDES,
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Vial" if WINDOWS else "vial",
    console=True,  # the window shows the link and the reopen message; closing it stops Vial
    debug=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    icon=os.path.join(ROOT, "src", "main", "icons", "Icon.ico") if WINDOWS else None,
    version=windows_version_info() if WINDOWS else None,
)
```

Apply to `.gitignore`:

```diff
diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
@@ -1,5 +1,6 @@
 venv
-target
+/build/
+/dist/
 __pycache__
 *.pyc
 .idea
```

```bash
.venv/Scripts/python.exe -m PyInstaller --noconfirm vial.spec
```

Expected: `Building EXE from EXE-00.toc completed successfully.` and `Build complete!`. It takes about 15 to 25 s.

- [ ] **Step 7: The smoke test against the executable; its size; no unpack folder left**

```bash
before=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && .venv/Scripts/python.exe util/smoke_test.py dist/Vial.exe && after=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && echo "unpack folders left: $((after - before))" && .venv/Scripts/python.exe -c "import os; s = os.path.getsize('dist/Vial.exe') / 2**20; print('Vial.exe: {:.1f} MiB, {}'.format(s, 'within 12-25 MiB' if 12 <= s <= 25 else 'OUTSIDE 12-25 MiB'))"
```

Expected: `Vial (web) 0.8.0: this build has everything it needs` and `smoke test passed: started in` and `exit code 0` and `unpack folders left: 0` and `within 12-25 MiB`. The start takes about 0.5 to 1 s (0.63 s and 0.65 to 0.90 s measured), and the size is about 15 MiB (15.1 MiB measured).

- [ ] **Step 8: Commit** (`build/` and `dist/` are ignored now)

```bash
git add .gitignore \
  src/main/python/selfcheck.py \
  src/main/python/test/test_selfcheck.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/version.py \
  src/main/python/vial_web.py \
  util/smoke_test.py \
  vial.spec
git commit -m "feat: vial.spec builds Vial as one executable; vial --version and --self-check; a smoke test"
```

### Task 9: The e2e suite runs against the built executable (`E2E_VIAL_CMD`)

`E2E_VIAL_CMD=dist/Vial.exe npx playwright test` starts the built executable instead of `python vial_web.py`, with the same `--fake --no-browser --port 0 --data-dir` arguments. The path is relative to the repository, or absolute. Error messages name what was run. The quit-first stop (Task 4) matters most here: a one-file executable removes its unpack folder only when it exits by itself.

**Files:**
- Modify: `web/e2e/servers.ts`
- Modify: `web/playwright.config.ts`

- [ ] **Step 1: The command from the environment**

Apply to `web/e2e/servers.ts`:

```diff
diff --git a/web/e2e/servers.ts b/web/e2e/servers.ts
--- a/web/e2e/servers.ts
+++ b/web/e2e/servers.ts
@@ -1,12 +1,15 @@
 // Starts a `vial_web.py --fake --no-browser` server, on a free port with its own temporary data dir, and stops it:
 // the simulated keyboards the tests use (see SERVERS). Each test worker starts its own (fixtures.ts), so tests that run
 // at the same time never share a keyboard. The URLs carry the session token.
+//
+// $E2E_VIAL_CMD runs a built Vial executable instead (dist/Vial.exe, a path relative to the repository or absolute),
+// with the same arguments: the whole suite then tests what PyInstaller built.
 import { execFileSync, spawn, type ChildProcess } from "node:child_process";
 import { mkdtempSync, rmSync } from "node:fs";
 import { tmpdir } from "node:os";
-import { dirname, join } from "node:path";
+import { dirname, join, resolve } from "node:path";
 import { fileURLToPath } from "node:url";
-import { findPython, pythonRoot } from "../scripts/python.mjs";
+import { findPython, pythonRoot, repoRoot } from "../scripts/python.mjs";
 
 const STARTUP_MS = 30_000;
 const STOP_MS = 5_000;
@@ -34,6 +37,13 @@ export const SERVERS = {
 /** Long enough to start a server and to stop it (asked to quit, then ended), on a busy machine too */
 export const SERVER_FIXTURE_MS = STARTUP_MS + 3 * STOP_MS;
 
+/** What runs Vial: the executable $E2E_VIAL_CMD names, else vial_web.py with the repository's Python */
+function vialCommand(): { file: string; args: string[]; cwd: string; name: string } {
+  const executable = process.env.E2E_VIAL_CMD;
+  if (executable) return { file: resolve(repoRoot, executable), args: [], cwd: repoRoot, name: executable };
+  return { file: findPython(), args: ["vial_web.py"], cwd: pythonRoot, name: "vial_web.py" };
+}
+
 const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
 
 /** Resolves true once the process has exited, or false after `ms` */
@@ -53,7 +63,8 @@ function exitWithin(child: ChildProcess, ms: number): Promise<boolean> {
 }
 
 /** Asks the server to quit as Quit Vial does (POST /api/shutdown, with the session the link gives): it closes the
- * keyboard and exits by itself. Resolves to whether it took the request. */
+ * keyboard and exits by itself, and a one-file executable removes the folder it unpacked itself to, which ending it
+ * would leave behind. Resolves to whether it took the request. */
 async function askToQuit(url: string): Promise<boolean> {
   try {
     const login = await fetch(url, { redirect: "manual" });
@@ -70,8 +81,9 @@ async function askToQuit(url: string): Promise<boolean> {
 }
 
 /** Ends the server and waits for it, at most a few seconds per attempt. On Windows the venv's python.exe is a
- * launcher that runs the real Python as its child, and there is no gentler stop than terminating, so the whole tree
- * is ended at once. Elsewhere SIGTERM, then SIGKILL if it hasn't exited in time. */
+ * launcher that runs the real Python as its child (a one-file executable unpacks itself and runs as its own child
+ * too), and there is no gentler stop than terminating, so the whole tree is ended at once. Elsewhere SIGTERM, then
+ * SIGKILL if it hasn't exited in time. */
 async function stopProcess(child: ChildProcess): Promise<void> {
   if (child.pid === undefined || hasExited(child)) return; // never started, or already gone
   if (process.platform === "win32") {
@@ -96,10 +108,10 @@ function removeDataDir(dataDir: string): void {
 }
 
 /** Resolves with the server's link once it serves, or rejects when it exits, fails to start or takes too long */
-function waitForUrl(server: ChildProcess, output: { text: string }): Promise<string> {
+function waitForUrl(server: ChildProcess, name: string, output: { text: string }): Promise<string> {
   return new Promise<string>((resolve, reject) => {
     const timer = setTimeout(
-      () => reject(new Error(`vial_web.py did not start within ${STARTUP_MS / 1000} s:\n${output.text}`)),
+      () => reject(new Error(`${name} did not start within ${STARTUP_MS / 1000} s:\n${output.text}`)),
       STARTUP_MS,
     );
     const read = (chunk: Buffer) => {
@@ -114,11 +126,11 @@ function waitForUrl(server: ChildProcess, output: { text: string }): Promise<str
     server.stderr?.on("data", read);
     server.on("error", (error) => {
       clearTimeout(timer);
-      reject(new Error(`could not run vial_web.py with ${String(server.spawnfile)}: ${error.message}\n${output.text}`));
+      reject(new Error(`could not run ${name} with ${String(server.spawnfile)}: ${error.message}\n${output.text}`));
     });
     server.on("exit", (code, signal) => {
       clearTimeout(timer);
-      reject(new Error(`vial_web.py exited (${signal ?? code}) before serving:\n${output.text}`));
+      reject(new Error(`${name} exited (${signal ?? code}) before serving:\n${output.text}`));
     });
   });
 }
@@ -135,14 +147,15 @@ export async function startServer(extraArgs: string[]): Promise<TestServer> {
   const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
   let server: ChildProcess | undefined;
   const output = { text: "" };
+  const vial = vialCommand();
   try {
     server = spawn(
-      findPython(),
-      ["vial_web.py", "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
-      { cwd: pythonRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
+      vial.file,
+      [...vial.args, "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
+      { cwd: vial.cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
     );
     const exited = new Promise<number | null>((resolve) => server!.once("exit", (code) => resolve(code)));
-    const url = await waitForUrl(server, output);
+    const url = await waitForUrl(server, vial.name, output);
     const running = server;
     return {
       url,
@@ -153,7 +166,7 @@ export async function startServer(extraArgs: string[]): Promise<TestServer> {
         if (!hasExited(running)) await stopProcess(running);
         removeDataDir(dataDir);
         if (asked && !quit) {
-          const why = `vial_web.py took Quit (POST /api/shutdown) and didn't exit within ${STOP_MS / 1000} s`;
+          const why = `${vial.name} took Quit (POST /api/shutdown) and didn't exit within ${STOP_MS / 1000} s`;
           throw new Error(`${why}:\n${output.text}`);
         }
       },
@@ -166,7 +179,7 @@ export async function startServer(extraArgs: string[]): Promise<TestServer> {
     if (server) await stopProcess(server);
     removeDataDir(dataDir);
     const reason = error instanceof Error ? error.message : String(error);
-    const command = ["vial_web.py --fake", ...extraArgs].join(" ");
+    const command = [`${vial.name} --fake`, ...extraArgs].join(" ");
     throw new Error(`could not start the test server (${command}): ${reason}`, { cause: error });
   }
 }
```

Apply to `web/playwright.config.ts`:

```diff
diff --git a/web/playwright.config.ts b/web/playwright.config.ts
--- a/web/playwright.config.ts
+++ b/web/playwright.config.ts
@@ -1,6 +1,7 @@
 import { defineConfig, devices } from "@playwright/test";
 
-// Runs the built UI (npm run build) against `vial_web.py --fake`, started by the fixtures (e2e/fixtures.ts).
+// Runs the built UI (npm run build) against `vial_web.py --fake`, started by the fixtures (e2e/fixtures.ts); with
+// $E2E_VIAL_CMD set, against a built Vial executable instead (`E2E_VIAL_CMD=dist/Vial.exe npx playwright test`).
 // Never touches a real keyboard: the server only ever runs with --fake and a temporary data dir.
 // The tests run in parallel, each worker with its own servers, which keep every edit while the worker lasts. A worker
 // runs its tests one at a time, and each test that changes a key, an encoder or a name puts it back (in a `finally`,
```

- [ ] **Step 2: Type-check, then the suite from source**

```bash
cd web && npm run check && npx playwright test
```

Expected: `0 ERRORS 0 WARNINGS` and `188 passed`.

- [ ] **Step 3: The suite against the executable built in Task 8, leaving no unpack folder**

```bash
before=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && (cd web && E2E_VIAL_CMD=dist/Vial.exe npx playwright test) ; after=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && echo "unpack folders left: $((after - before))"
```

Expected: `188 passed` and `unpack folders left: 0`. It takes about as long as from source, 1.5 min with 8 workers here (81 to 96 s measured).

- [ ] **Step 4: Commit**

```bash
git add web/e2e/servers.ts \
  web/playwright.config.ts
git commit -m "test(web): the e2e suite runs against a built executable with E2E_VIAL_CMD"
```

### Task 10: CI builds and smoke-tests one executable on Windows, Linux and macOS; tests on all three

`.github/workflows/main.yml` is rewritten: the fbs, NSIS and docker builds go.

- **Job `build`, a matrix:**
  - Windows on `windows-2025` (`dist/Vial.exe`);
  - Linux on `ubuntu-22.04`, the oldest runner, so glibc 2.35+ (`dist/vial`);
  - macOS on `macos-15`, arm64 (`dist/vial`).
- **Each build:**
  - installs `requirements.txt` (on Linux, hidapi's `libusb-1.0-0-dev` and `libudev-dev` from apt);
  - runs `npm ci` and `npm run build`, then `python -m PyInstaller vial.spec`;
  - runs `python util/smoke_test.py <executable>`;
  - uploads the executable as `vial-windows`, `vial-linux` or `vial-macos`.
- **On Windows and Linux** it then runs the e2e suite against the executable (`E2E_VIAL_CMD`), after `npx playwright install --with-deps chromium` (CI only), and uploads `web/test-results/` if it fails.

`.github/workflows/test.yml`:
- `pytest` on `windows-2025`, `ubuntu-24.04` and `macos-15`;
- `web`: svelte-check, Vitest, build and check:api on Linux, and e2e against `vial_web.py --fake` on Linux and Windows. The screenshots and the test results are uploaded.

Only official `actions/*` at the majors the repository already used. GitHub Actions can't run from here: the YAML is parsed and checked locally, and the commands they run are the ones the earlier tasks ran. The parts only CI can prove are listed under "Out of scope / later".

**Files:**
- Modify: `.github/workflows/main.yml`
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: The build workflow**

Replace the whole of `.github/workflows/main.yml` with:

```yaml
name: Build

# Vial as one executable on each system: dist/Vial.exe (Windows), dist/vial (Linux, macOS). Each build is smoke-tested
# with the simulated keyboard (--fake: the runners have no keyboards, and --fake is the rule anyway), and uploaded. On
# Windows and Linux the end-to-end tests run against the built executable too.

on: [push, pull_request]

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - system: windows
            runner: windows-2025
            executable: dist/Vial.exe
            e2e: true
          # the oldest Ubuntu runner: the executable needs at least its glibc (2.35)
          - system: linux
            runner: ubuntu-22.04
            executable: dist/vial
            e2e: true
          # arm64, built as is: not tested beyond the smoke test
          - system: macos
            runner: macos-15
            executable: dist/vial
            e2e: false

    name: build-${{ matrix.system }}
    runs-on: ${{ matrix.runner }}
    defaults:
      run:
        shell: bash

    steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-python@v5
      with:
        python-version: '3.13'

    - uses: actions/setup-node@v4
      with:
        node-version: '24'
        cache: npm
        cache-dependency-path: web/package-lock.json

    # what hidapi's Linux backends link to, as the tests' runners install it
    - name: hidapi's libraries
      if: runner.os == 'Linux'
      run: |
        sudo apt-get update
        sudo apt-get install -y libusb-1.0-0-dev libudev-dev

    - name: Python packages
      run: python -m pip install -r requirements.txt

    - name: Build the web UI
      working-directory: web
      run: |
        npm ci
        npm run build

    - name: Build the executable
      run: python -m PyInstaller vial.spec

    - name: Smoke test (simulated keyboard)
      run: python util/smoke_test.py ${{ matrix.executable }}

    - uses: actions/upload-artifact@v4
      with:
        name: vial-${{ matrix.system }}
        path: ${{ matrix.executable }}
        if-no-files-found: error

    - name: End-to-end tests against the executable
      if: matrix.e2e
      working-directory: web
      env:
        E2E_VIAL_CMD: ${{ matrix.executable }}
      run: |
        npx playwright install --with-deps chromium
        npx playwright test

    - uses: actions/upload-artifact@v4
      if: failure() && matrix.e2e
      with:
        name: e2e-results-${{ matrix.system }}
        path: web/test-results/
        if-no-files-found: ignore
```

- [ ] **Step 2: The test workflow**

Apply to `.github/workflows/test.yml`:

```diff
diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -3,8 +3,17 @@ name: Test
 on: [push, pull_request]
 
 jobs:
-  test-linux:
-    runs-on: ubuntu-22.04
+  # the Python tests: the simulator and the server, never a real keyboard
+  pytest:
+    strategy:
+      fail-fast: false
+      matrix:
+        runner: [windows-2025, ubuntu-24.04, macos-15]
+
+    runs-on: ${{ matrix.runner }}
+    defaults:
+      run:
+        shell: bash
 
     steps:
     - uses: actions/checkout@v4
@@ -13,29 +22,34 @@ jobs:
       with:
         python-version: '3.13'
 
-    - name: Install dependencies
+    - name: hidapi's libraries
+      if: runner.os == 'Linux'
       run: |
         sudo apt-get update
-        sudo apt-get install -y libusb-1.0-0-dev libudev-dev xvfb libxkbcommon-x11-0 libxcb-icccm4 libxcb-image0 \
-          libxcb-keysyms1 libxcb-randr0 libxcb-render-util0 libxcb-xinerama0 libxcb-xfixes0 libxcb-shape0 libegl1
+        sudo apt-get install -y libusb-1.0-0-dev libudev-dev
 
-    - name: Setup venv
-      run: |
-        python -m venv venv
-        . venv/bin/activate
-        pip install -r test-requirements.txt
-        pip install --no-deps -r requirements-fbs.txt
+    - name: Python packages
+      run: python -m pip install -r test-requirements.txt
 
     - name: Run tests
-      run: |
-        source venv/bin/activate
-        pytest -v -n auto --dist worksteal src/main/python/test
+      run: python -m pytest -v -n auto --dist worksteal src/main/python/test
 
+  # the web UI: checks, unit tests, the build, the API types, and the end-to-end tests against vial_web.py --fake
   web:
-    runs-on: ubuntu-24.04
-
+    strategy:
+      fail-fast: false
+      matrix:
+        include:
+          - runner: ubuntu-24.04
+            checks: true
+          # end-to-end only: the rest doesn't depend on the system
+          - runner: windows-2025
+            checks: false
+
+    runs-on: ${{ matrix.runner }}
     defaults:
       run:
+        shell: bash
         working-directory: web
 
     steps:
@@ -51,28 +65,34 @@ jobs:
         cache: npm
         cache-dependency-path: web/package-lock.json
 
-    # the server code generates the API types and serves the UI in the end-to-end tests (simulated keyboard only)
-    - name: Python venv
+    # the server code generates the API types and serves the UI in the end-to-end tests (simulated keyboard only);
+    # VIAL_PYTHON tells web/scripts/python.mjs which Python runs it
+    - name: Python packages
       working-directory: .
       run: |
-        sudo apt-get update
-        sudo apt-get install -y libusb-1.0-0-dev libudev-dev
-        python -m venv .venv
-        .venv/bin/pip install -r requirements.txt
+        if [ "$RUNNER_OS" = Linux ]; then
+          sudo apt-get update
+          sudo apt-get install -y libusb-1.0-0-dev libudev-dev
+        fi
+        python -m pip install -r requirements.txt
+        echo "VIAL_PYTHON=$(python -c 'import sys; print(sys.executable)')" >> "$GITHUB_ENV"
 
     - name: Install
       run: npm ci
 
     - name: Check (svelte-check, tsc)
+      if: matrix.checks
       run: npm run check
 
     - name: Unit tests
+      if: matrix.checks
       run: npm test
 
     - name: Build
       run: npm run build
 
     - name: API types are up to date
+      if: matrix.checks
       run: npm run check:api
 
     - name: End-to-end tests
@@ -83,7 +103,7 @@ jobs:
     - uses: actions/upload-artifact@v4
       if: always()
       with:
-        name: e2e-screenshots
+        name: e2e-screenshots-${{ runner.os }}
         path: |
           web/e2e/screenshots/
           web/test-results/
```

- [ ] **Step 3: Parse both and check their actions and steps**

js-yaml is already in `web/node_modules` (a dependency of the web tools); nothing is installed:

```bash
cd web && node -e 'const yaml = require("js-yaml"); const fs = require("fs"); for (const name of ["main.yml", "test.yml"]) { const doc = yaml.load(fs.readFileSync("../.github/workflows/" + name, "utf8")); const steps = Object.values(doc.jobs).flatMap((job) => job.steps); const uses = [...new Set(steps.filter((s) => s.uses).map((s) => s.uses))].sort(); const unofficial = uses.filter((u) => !/^actions\/[a-z-]+@v\d+$/.test(u)); const banned = steps.filter((s) => /fbs|nsis|docker|curl|wget/i.test(s.run ?? "")); console.log(name + ": jobs " + Object.keys(doc.jobs).join(", ") + "; uses " + uses.join(" ") + "; unofficial " + unofficial.length + "; fbs/NSIS/docker/curl/wget steps " + banned.length); }'
```

Expected: `main.yml: jobs build; uses actions/checkout@v4 actions/setup-node@v4 actions/setup-python@v5 actions/upload-artifact@v4; unofficial 0; fbs/NSIS/docker/curl/wget steps 0` and `test.yml: jobs pytest, web; uses actions/checkout@v4 actions/setup-node@v4 actions/setup-python@v5 actions/upload-artifact@v4; unofficial 0; fbs/NSIS/docker/curl/wget steps 0`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/main.yml \
  .github/workflows/test.yml
git commit -m "ci: build and smoke-test one executable on Windows, Linux and macOS; tests on all three"
```

### Task 11: The README for the fork; `web/README.md` and `docs/parity.md` after phase 6; the final check

**`README.md`** is rewritten for the fork:
- what it is, and the status table (phases 5 and 6 done; Qt and fbs removed);
- download and run on Windows, Linux (`chmod +x`, the udev rule, linked to get.vial.today) and macOS (unsigned, `xattr`);
- Quit and the console, the command-line options (`--fake`, `--version`, `--self-check`, …), and where Vial keeps its files;
- the dev workflow (venv, `npm ci`, the dev server, the tests), and building the executable.

**`web/README.md`:** no Qt or fbs left; the e2e suite against the executable; the quit tests. **`docs/parity.md`:** the Qt app is removed (phase 6); About Vial is `vial --version` and Vial.exe's Properties; the flasher's logic is in `protocol/flasher.py`.

**Files:**
- Modify: `README.md`
- Modify: `web/README.md`
- Modify: `docs/parity.md`

- [ ] **Step 1: The README**

Replace the whole of `README.md` with:

````markdown
# vial-web

A personal fork of [vial-gui](https://github.com/vial-kb/vial-gui) that replaces the Qt interface with a local web
UI: a small Python server on `127.0.0.1` talks to the keyboard, and the browser shows a clearer, Oryx-style view of
layers, tap dances, combos and macros. It comes as one executable file per system.

This fork is not affiliated with Vial and is not meant for upstream. For Vial itself, its firmware and official
releases, see [get.vial.today](https://get.vial.today/).

## Status

| Phase | What | State |
|---|---|---|
| 0 | Python 3.13 | done |
| 1 | Keyboard simulator and local API server (`vial_web.py`) | done |
| 2 | Web UI: see and edit every key on every layer | done |
| 3 | Overview of all layers; how each layer is reached (including combos); find a character or key | done |
| 4 | Tap dance, combos, macros pages; unlock | done |
| 5 | Parity with the Qt app: key overrides, alt-repeat, QMK settings, lighting, layout options, matrix tester, `.vil` files, reboot to bootloader, keyboard selector ([`docs/parity.md`](docs/parity.md)) | done |
| 6 | One executable per system (PyInstaller); Qt and fbs removed; Quit Vial; CI on Windows, Linux and macOS | done |
| 7 | Firmware flasher (its logic is in `src/main/python/protocol/flasher.py`, without a UI yet) | optional |

Design: [`docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`](docs/superpowers/specs/2026-10-15-vial-web-ui-design.md).
Roadmap: [`docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`](docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md).

The Qt app was removed in phase 6; it is in the history before that, and in upstream vial-gui.

## Download and run

The CI's Build workflow builds one file per system and keeps it as an artifact of each run: open the latest
successful run of **Build** under Actions, download `vial-windows`, `vial-linux` or `vial-macos`, and unzip it.
Close Vial's Qt app or another configurator first: they would use the keyboard at the same time.

- **Windows:** `Vial.exe`. Put it in any folder and double-click it. A console window opens and shows the link, and
  the browser opens it. The file isn't signed: if SmartScreen stops it, choose *More info*, then *Run anyway*.
- **Linux:** `vial`, built on Ubuntu 22.04 (it needs glibc 2.35 or newer). Make it executable and run it from a
  terminal: `chmod +x vial && ./vial`. Vial needs a udev rule to see keyboards: add it as
  [get.vial.today's Linux instructions](https://get.vial.today/manual/linux-udev.html) say, then plug the keyboard in
  again.
- **macOS** (Apple silicon): `vial`, built as is and not tested beyond the CI's smoke test. It isn't signed: run
  `chmod +x vial && xattr -d com.apple.quarantine vial && ./vial` in Terminal.

To try it without a keyboard, start it with `--fake`: it serves a simulated Corne and never looks for real hardware.

```sh
Vial.exe --fake          # Windows (from a console in the folder of Vial.exe)
./vial --fake            # Linux, macOS
```

Starting Vial while it already runs opens the running one in the browser instead (a `--fake` Vial and a real one
are kept apart: each has its own).

### Quit

**Quit Vial** at the right of the top bar stops Vial: it lets go of the keyboard, every open tab says "Vial has
stopped. You can close this tab.", and Vial exits (a console window it opened closes). It asks first when there is work not saved (a
combo being edited, the Settings page's changes, lighting not saved). Pressing Ctrl+C in the console window, or
closing that window, stops Vial too, closing the keyboard first.

Closing the browser tab doesn't stop Vial: the console says it is still running and prints the link to reopen it.

### Command-line options

| Option | What it does |
|---|---|
| `--fake` | Use a simulated keyboard instead of real hardware |
| `--definition FILE` | With `--fake`: the `vial.json` of the keyboard to simulate |
| `--layout FILE` | With `--fake`: a `.vil` layout to load into the simulated keyboard |
| `--layers N` | With `--fake`: simulate a keyboard with N layers (1 to 32); layers past the sample keymap are empty |
| `--lighting KIND` | With `--fake`: the simulated keyboard's lighting (`none`, `qmk_backlight`, `qmk_rgblight`, `qmk_backlight_rgblight`, `vialrgb`) |
| `--unlock-counter N` | With `--fake`: how many polls the unlock keys must be held for (1 to 255; default 50, about 10 s) |
| `--second-definition FILE` | With `--fake`: the second simulated keyboard, plugged in by the tests' hook |
| `--port PORT` | Port to listen on (default: any free port) |
| `--no-browser` | Don't open the browser; the link with its session token is printed |
| `--dry-run` | Connect, print a summary of the keyboard and exit |
| `--data-dir DIR` | Keep the lock, session file, log and names in `DIR` instead of the user folders (below) |
| `--self-check` | Check that this build has everything it needs (hidapi, the server, the web UI) and exit, without looking for any keyboard |
| `--version` | Print Vial's version and exit |

The server listens on `127.0.0.1` only, and answers only pages opened through the printed link.

### Where Vial keeps its files

Never next to the executable, and never in the folder the executable unpacks itself to while it runs:

| System | Lock, session file, log (`vial.log`) | Layer, tap dance and macro names (`names.json`) |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Vial` | `%LOCALAPPDATA%\Vial` |
| Linux | `~/.local/share/Vial` | `~/.config/Vial` |
| macOS | `~/Library/Application Support/Vial` | `~/Library/Application Support/Vial` |

A `--fake` Vial keeps its own in a `fake` subfolder of each. `--data-dir DIR` puts everything in `DIR` instead.

The Overview shows how each layer is reached from what Vial can read: layer keys, tap dances and combos. Layer
switching done in the keyboard's firmware code (for example `update_tri_layer_state` or `layer_state_set_user`) isn't
visible over the Vial protocol, so it isn't shown.

## Development

Python 3.13, and Node 24 with npm 11. Every dependency is pinned (`requirements.txt`, `test-requirements.txt`,
`web/package-lock.json`).

Create the virtual environment `.venv` at the repository root and install the requirements:

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r test-requirements.txt        # Windows: .venv\Scripts\pip
```

On Windows the helper scripts do the same with scoop's Python 3.13 (or the one `VIAL_PYTHON_HOME` names), reinstall
when the requirement files change, and activate the venv:

```sh
source ./use-python.sh      # Git Bash
. .\use-python.ps1          # PowerShell
use-python.cmd              # cmd
```

Build the web UI (and again after changes to `web/`), then run Vial from source with the simulated keyboard:

```sh
cd web && npm ci && npm run build && cd ..
cd src/main/python
python vial_web.py --fake
```

Without the web UI built, Vial says how to build it and the page only says so. While working on the UI,
`npm run dev` in `web/` rebuilds it on every change (reload the page afterwards): see [`web/README.md`](web/README.md).

### Tests

```sh
# Python tests (repository root); -n auto runs them on every core (pytest-xdist)
python -m pytest -q -p no:cacheprovider -n auto --dist worksteal src/main/python/test
# web UI (in web/): type check, unit tests, build, API types up to date, end-to-end tests
npm run check && npm test && npm run build && npm run check:api && npx playwright test
```

The end-to-end tests run against `vial_web.py --fake` servers with temporary data dirs. Run against a built
executable instead with `E2E_VIAL_CMD=dist/Vial.exe npx playwright test` (in `web/`; the path is relative to the
repository). See [`web/README.md`](web/README.md).

### Building the executable

From the repository root, with the venv active and the web UI built:

```sh
cd web && npm ci && npm run build && cd ..
python -m PyInstaller vial.spec
python util/smoke_test.py dist/Vial.exe      # Linux, macOS: dist/vial
```

`vial.spec` builds one file, `dist/Vial.exe` on Windows (a console app with Vial's icon and version info) and
`dist/vial` on Linux and macOS, with the Python runtime, hidapi, the web UI and `qmk_settings.json` inside; it
refuses to build without the web UI. The version is set in `src/main/python/version.py`. The smoke test runs
`--self-check`, then the executable with `--fake --no-browser` and a temporary data dir, reads `/api/session` and
quits it through `/api/shutdown`. CI (`.github/workflows/main.yml`) does the same on Windows, Linux and macOS, and runs
the end-to-end tests against the executable on Windows and Linux.

## License

GPL-2.0, as upstream vial-gui; see [`COPYING`](COPYING).
````

- [ ] **Step 2: The web README and the parity document**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -1,9 +1,11 @@
 # Vial web UI
 
 Svelte 5 (runes only) + TypeScript, built with Vite. `npm run build` writes `web/dist`, which
-`vial_web.py` serves; without `dist` it shows a placeholder page.
+`vial_web.py` serves (and `vial.spec` bundles into the executable); without `dist`, `vial_web.py` says how to build
+it and shows a placeholder page.
 
-Where each tab, menu and dialog of the Qt app lives here, or why it is left out: `docs/parity.md`.
+Where each tab, menu and dialog of the Qt app (removed in phase 6) lives here, or why it is left out:
+`docs/parity.md`.
 
 ## Setup
 
@@ -74,7 +76,7 @@ starts the countdown at N instead, as firmware built with another `VIAL_UNLOCK_C
 | `npm run dev` | Build, then rebuild on every change |
 | `npm run check` | `svelte-check` (types, Svelte 5 runes-only syntax; fails on warnings), then `tsc` for the configs, e2e tests and scripts |
 | `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
-| `npm run e2e` | Build, then run the Playwright tests (`e2e/`) against `vial_web.py --fake` |
+| `npm run e2e` | Build, then run the Playwright tests (`e2e/`) against `vial_web.py --fake` (or the executable `$E2E_VIAL_CMD` names) |
 | `npm run gen:api` | Regenerate `src/api/schema.d.ts` from the server's OpenAPI schema |
 | `npm run check:api` | Fail if `src/api/schema.d.ts` is out of date |
 
@@ -91,8 +93,14 @@ CI runs `npm run check:api`.
 default Corne, with VialRGB; `e2e/fixtures/macropad.vial.json` with encoders, a layout option and no
 lighting; the Corne with `--layers 8`, as the owner's keyboard has; the Corne with
 `--lighting qmk_backlight_rgblight`; and the Corne with the macropad as its second keyboard,
-`--second-definition`), reads the links with the session token from their output and stops them. Each
-Playwright worker starts the ones its tests use (fixtures in `e2e/fixtures.ts`) and stops them when it ends. Screenshots, each in the
+`--second-definition`), reads the links with the session token from their output, and at the end asks each to quit
+(`POST /api/shutdown`, as Quit Vial does; one that takes it and doesn't exit within 5 s fails the run), ending it
+only if it can't be asked. Each Playwright worker starts the ones its tests use (fixtures in `e2e/fixtures.ts`) and
+stops them when it ends; a test that ends its server (Quit Vial) gets one of its own (`ownServer`).
+
+`E2E_VIAL_CMD=dist/Vial.exe npx playwright test` runs the same tests against a built executable (a path relative to
+the repository, or absolute) instead of `python vial_web.py`, with the same arguments; CI does so on Windows and
+Linux. Screenshots, each in the
 light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed); a
 full-page one is taken from the top, with the sticky top bar and macro editor footer drawn where they are in the
 page.
@@ -106,6 +114,7 @@ page.
 | `tapdance`, `combos`, `macros` | Editing on those pages: where the focus goes, saves that are slow or fail, recording keys (adding to the end, or replacing the steps: undone by Cancel); removing a macro: at once when nothing uses it, else asked first, Cancel keeping it |
 | `macro-text` | The macro text editor: Qt's JSON shown, Esc and Cancel changing nothing, what can't be read said and not applied, Apply then the page's Save, a `.vim` file saved and loaded; steps not finished going and coming as text; a text too long refused before it is sent; a text being applied dropped when the dialog closes; Ctrl+S on a layout whose letters aren't Latin; the dialog and the record buttons at 1920 and 375 px |
 | `unlock` | The unlock dialog |
+| `quit` | Quit Vial: every tab showing that Vial stopped (the heading taking the focus) and reconnecting no more, the server exiting by itself; asked first with work not saved (Cancel keeping Vial running); the button and the stopped page from 375 px to 1080p, in both themes |
 | `overrides` | The Key overrides and Alt-repeat pages: a new key override built and saved, switched off, removed; an alt-repeat key edited |
 | `settings` | The QMK settings form: a change undone, a number out of range, Save, Reset to defaults with its confirmation |
 | `layoutfile` | Saving the layout, loading it back with its preview; another keyboard's file and a broken one; a file with macros on a locked keyboard |
@@ -145,5 +154,5 @@ development machine, so no browser is downloaded there. CI installs that Chromiu
 | `src/settings/` | The QMK settings form (Settings): the groups `qmk_settings.json` defines, what changed, Save, Undo and Reset; what the page keeps while another one shows (`state.svelte.ts`) |
 | `src/about/` | The Keyboard page: what the keyboard is (Qt's About keyboard), saving and loading `.vil` layout files with a preview of what changes, and reboot to bootloader |
 | `src/picker/` | Keycode picker: search, categories (no Lighting category on a keyboard without lighting, `offered.ts`), any-keycode entry |
-| `src/shell/` | Top bar (with the keyboard selector, shown while there is more than one keyboard to choose from, and the Lock/Unlock control), navigation, banners, toasts, the unlock dialog |
+| `src/shell/` | Top bar (with the keyboard selector, shown while there is more than one keyboard to choose from, the Lock/Unlock control and Quit Vial), navigation, banners, toasts, the unlock dialog, the page shown once Vial has stopped |
 | `src/ui/` | Small shared controls (a switch, a list, a slider, the Save bar), the name dialog (layers, tap dances, macros) and a confirmation dialog |
```

Apply to `docs/parity.md`:

```diff
diff --git a/docs/parity.md b/docs/parity.md
--- a/docs/parity.md
+++ b/docs/parity.md
@@ -1,7 +1,8 @@
 # Parity with the Qt app
 
 Every tab, menu and dialog of the Qt app (`src/main/python/main_window.py`, `editor/`, `unlocker.py`,
-`about_keyboard.py`) and where it lives in the web UI (`web/src/`), or why it is left out. Phase 5's contract: once
+`about_keyboard.py`, removed from this fork in phase 6: see the history, or upstream vial-gui) and where it lives in
+the web UI (`web/src/`), or why it is left out. Phase 5's contract: once
 phase 5b is done, the web UI does all of this except what is marked **dropped** or **later**. Checked against the code
 on 2026-10-20.
 
@@ -25,7 +26,7 @@ navigation, as Qt hides the tabs whose `valid()` is false.
 | Alt Repeat Key (`alt_repeat_key.py`) | Alt-repeat, `#alt-repeat` | |
 | QMK Settings (`qmk_settings.py`) | Settings, `#settings` (`settings/SettingsPage.svelte`) | Grouped as Qt's tabs; Save/Undo; Reset to defaults with a confirmation. |
 | Matrix tester (`matrix_test.py`) | Matrix tester, `#matrix` (`matrix/MatrixPage.svelte`) | Shown when Qt's would be (Vial protocol 3+, a matrix that fits one reply: `server/device.py has_matrix_tester`). Qt tests whenever its tab shows (it reads the keys every 20 ms); here only after Start testing, which unlocks first (Qt shows an Unlock button). Keys pressed do nothing on the page meanwhile, as Qt grabs the keyboard. The test stops when the window loses the focus or the tab is hidden (Alt+Tab), when a dialog takes the focus (another keyboard picked asks first; the unlock dialog keeps the test going), when the keyboard is unplugged or reboots into its bootloader, and when the page is left; Start testing goes on with what was pressed so far. Reset is Qt's; the switch matrix grid (positions without a key) is new. |
-| Firmware updater (`firmware_flasher.py`) | **Later** (phase 7) | The roadmap's optional phase 7. Qt shows it only for keyboards with Vial's own bootloader (`vibl`). Reboot to bootloader (below) is there for flashing with another tool. |
+| Firmware updater (`firmware_flasher.py`) | **Later** (phase 7) | The roadmap's optional phase 7. Its logic, without Qt, is in `src/main/python/protocol/flasher.py` (phase 6): reading a `.vfw` file, finding the bootloader, the flashing protocol. Qt shows it only for keyboards with Vial's own bootloader (`vibl`). Reboot to bootloader (below) is there for flashing with another tool. |
 
 ## Above the tabs
 
@@ -43,14 +44,14 @@ navigation, as Qt hides the tabs whose `valid()` is false.
 | File > Sideload VIA JSON… | **Dropped** | Roadmap decision 5: VIA-only keyboards aren't supported (the server only finds Vial keyboards). |
 | File > Download VIA definitions | **Dropped** | Same decision. |
 | File > Load dummy JSON… | **Dropped** | A developer tool; `vial_web.py --fake --definition FILE` simulates a keyboard from its `vial.json` instead. |
-| File > Exit (Ctrl+Q) | Ctrl+C in Vial's terminal | Closing the tab leaves Vial running (it prints the link to reopen it). |
+| File > Exit (Ctrl+Q) | Top bar, Quit Vial (`shell/TopBar.svelte`; `POST /api/shutdown`) | Asks first when there is work not saved (`lib/unsaved.ts`); every tab then says Vial has stopped. Ctrl+C in Vial's console window, or closing it, stops Vial too. Closing the tab leaves Vial running (it prints the link to reopen it). |
 | Keyboard layout (QWERTY, AZERTY, …) | Top bar, Keyboard language (`shell/TopBar.svelte`) | Remembered in the browser. |
 | Security > Unlock (Ctrl+U) | Top bar, the Locked/Unlocked control; the unlock dialog (`shell/UnlockDialog.svelte`) | A change the firmware refuses while locked starts the unlock too, then is sent again. |
 | Security > Lock (Ctrl+L) | Top bar, the Locked/Unlocked control | |
 | Security > Reboot to bootloader (Ctrl+B) | Keyboard page, Reboot to bootloader… (`about/BootloaderCard.svelte`) | With a confirmation; unlocks first, as Qt does; then a banner, in the tab that rebooted it, says the keyboard is in its bootloader (other tabs say Keyboard unplugged); a reboot the keyboard got and didn't answer is shown as most likely done. A firmware built without the jump says so instead. |
 | Theme (System, Light, Dark, Arc, Nord, …) | Top bar, System / Light / Dark | **Dropped**: Qt's other colour themes. |
 | About > About *keyboard*… (`about_keyboard.py`) | Keyboard page, About this keyboard (`about/AboutCard.svelte`) | The name, Keyboard ID, protocols, matrix, keys, layers, macro memory, entries and features, with Copy. The USB device as Qt shows it: Manufacturer, Product, VID and PID (four hex digits) and Device (the HID path, cut short with its tooltip), from the keyboard list (`GET /api/keyboards`: what hidapi said when the keyboard was found). |
-| About > About Vial… | **Later** (phase 6) | Vial's version comes with the packaging. |
+| About > About Vial… | `vial --version`; Vial.exe's Properties > Details (phase 6) | The version is set in `src/main/python/version.py`. The page doesn't show it. |
 
 The menus' keyboard shortcuts aren't kept: in a browser, Ctrl+O, Ctrl+S and Ctrl+Q are the browser's.
 
```

- [ ] **Step 3: No Qt or fbs left outside the history and the docs that say they were removed**

```bash
echo "$(git grep -i -l -E 'pyqt|fbs' -- '*.py' '*.txt' '*.yml' '*.md' ':!docs/superpowers' | paste -sd' ' -) (end)"
```

Expected: `README.md src/main/python/test/test_core_isolation.py (end)`. The README says Qt and fbs were removed, the guard test names them to check that nothing imports them, and the plans and specs under docs/superpowers are the history.

- [ ] **Step 4: Run every check**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider -n auto --dist worksteal test
```

Expected: `1060 passed, 2 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  51 passed (51)` and `Tests  814 passed (814)` and `built in` and `src/api/schema.d.ts is up to date`.

- [ ] **Step 5: Commit**

```bash
git add README.md \
  docs/parity.md \
  web/README.md
git commit -m "docs: a README for the fork; web/README and parity.md after phase 6"
```

- [ ] **Step 6 (final): The whole e2e suite with the screenshots copied for review, then the e2e suite against a fresh build of the executable.** `screenshots/` is excluded from git through `.git/info/exclude` (pattern `/screenshots/`). Run this from the main working tree, or replace `/t/others/vial-gui` with its path.

```bash
cd web && npm run e2e && rm -rf /t/others/vial-gui/screenshots/phase6 && mkdir -p /t/others/vial-gui/screenshots/phase6 && cp e2e/screenshots/quit-* /t/others/vial-gui/screenshots/phase6/ && echo "$(ls /t/others/vial-gui/screenshots/phase6 | wc -l) screenshots copied" && git -C /t/others/vial-gui check-ignore screenshots/phase6/quit-stopped-375-light.png
```

Expected: `188 passed` and `16 screenshots copied` and `screenshots/phase6/quit-stopped-375-light.png`.

```bash
.venv/Scripts/python.exe -m PyInstaller --noconfirm vial.spec && .venv/Scripts/python.exe util/smoke_test.py dist/Vial.exe && before=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && (cd web && E2E_VIAL_CMD=dist/Vial.exe npx playwright test) ; after=$(ls -d "$TEMP"/_MEI* 2>/dev/null | wc -l) && echo "unpack folders left: $((after - before))"
```

Expected: `Build complete!` and `smoke test passed: started in` and `188 passed` and `unpack folders left: 0`.

Look at the screenshots, each in `-light` and `-dark`:
- `quit-topbar-375`, `-800`, `-1280`, `-1920`: the "Quit Vial" button at the top bar's right end, nothing scrolling sideways, the bar wrapped at 375 px;
- `quit-confirm`: the "Quit Vial?" confirmation naming the Settings page's unsaved changes, Cancel focused;
- `quit-stopped-375`, `-800`, `-1920`: "Vial has stopped" in its dashed card, centred, at most 860 px wide, its heading focused.

Then hand over to the owner checklist above.

## Roadmap coverage

| Roadmap phase 6 item, as the owner adjusted it, and the prototype brief's scope | Task |
|---|---|
| One-file PyInstaller spec, `vial_web.py` the entry point; the runtime, `web/dist`, `qmk_settings.json` and the keymaps bundled | 1 (`resources.py`), 8 (`vial.spec`) |
| certifi bundled: dropped instead, as nothing uses it after Qt | 6 |
| Bundled files read through `sys._MEIPASS`; user data in the data dir, never next to the exe or in the unpack folder | 1 |
| The web UI missing from source says how to build it; frozen, it is always bundled | 1, 8 |
| hidapi works in the frozen build, checked without opening a device | 8 (`--self-check`, the smoke test), 10 (CI on three systems) |
| Windows icon, version info, console app; the version in one place | 8 |
| The console window stays; closing it or Ctrl+C stops the server, closing the keyboard first | 3; checked on the frozen exe by the prototype, by the owner (checklist) |
| "Quit Vial" in the UI (`POST /api/shutdown`), protected, the keyboard closed first, an answer before it goes | 2, 4 |
| Unsaved work confirmed first; "Vial has stopped. You can close this tab."; no reconnect; other tabs stopped too | 2 (the event, the link), 4 |
| pytest for the route, Vitest and e2e for the UI; the e2e quit tests with servers of their own | 2, 4 |
| Remove Qt: the app, `editor/*`, `widgets/*`, `unlocker.py`, `util.py`, `autorefresh/`, `test_gui.py`, the Qt-only tests, PyQt5, keyboard, pywin32, pytest-qt, pytest-xvfb | 6 |
| Remove fbs, `requirements-fbs.txt`, the NSIS installer, the docker builder, `prepare-release.sh`, `setup_python36.sh`; `use-python.*` simplified | 7 |
| `test_core_isolation` kept meaningful | 5, 6 |
| The flasher's logic in a Qt-free `protocol/flasher.py` with tests, no UI | 5 |
| Linux: one binary on the oldest Ubuntu runner, the udev rule in the README | 8 (the spec), 10, 11 |
| macOS: one binary, arm64, as is, unsigned | 8 (the spec), 10, 11 |
| Build locally, size and start-up time; run only with `--fake --no-browser --data-dir` | 8 |
| The whole e2e suite against the built exe (`E2E_VIAL_CMD`) | 9, and the final step of 11 |
| CI `main.yml`: build, smoke test and artifact on three systems, e2e against the exe on Windows and Linux | 10 |
| CI `test.yml`: pytest on three systems, the web checks and e2e on Linux, e2e on Windows | 10 |
| Downloads: only pinned PyPI and npm packages, only official `actions/*`, no NSIS or docker | ground rules, 7, 10 |
| The fork's README; `web/README.md`; `docs/parity.md` | 11 |
| Owner's rules for the Quit button and the stopped page: 860 px, 1920 × 950, 800 and 375 px, Firefox-safe CSS, both themes, visible focus, focus never on `<body>` | 4 (e2e and screenshots), 11 (the final screenshots) |

## Self-review

- **Spec coverage:** every phase 6 item of the roadmap, as the owner adjusted it, and of the prototype brief maps to a task in the table above. The two Quit fixes found while prototyping are folded into the Quit tasks: the 2 s shutdown grace in Task 2 (with its e2e guard in Task 4), and Ctrl+C turned back on in Task 3. `--self-check` is in Task 8, with the build it checks. The prototype's read-only real-mode test is left to the owner (checklist), not to this plan.
- **Placeholder scan:** every code step gives the complete file, an exact diff, a whole replacement, or a `git rm` of named files. Every command has its expected output; the size and the start-up time of the executable, which vary, are given as ranges. Nothing is left to be filled in later. The deferred items are listed under "Out of scope / later" and are simply not built.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `resources.Resource`, `WEB_DIST`, `QMK_SETTINGS`, `BUNDLED`, `SOURCE_ROOT`, `is_frozen`, `path`, `web_ui_missing`, `WEB_BUILD_HINT` and `pyinstaller_datas` (Task 1), used by Tasks 1, 8 (`selfcheck.py`, `vial.spec`);
  - `create_app(…, on_stop=…)`, `POST /api/shutdown`, the `stopped` event, `DeviceManager.stopped`, `vial_web.QUIT_MESSAGE` and `SHUTDOWN_GRACE` (Task 2), used by Tasks 3 (`< console.CLOSE_WAIT`), 4 (`api.shutdown`, the store, the e2e `askToQuit`) and 8 (`util/smoke_test.py`);
  - `console.ConsoleStop`, `StopOnConsoleClose`, `CLOSE_WAIT`, `ENDING_EVENTS` and `CTRL_*_EVENT` (Task 3), used by `vial_web.serve()` (Task 3);
  - `api.shutdown`, `KeyboardStore.quit`, `quitting` and `stopped`, `StoppedPage`, and `TopBar`'s `quitting` and `onquit` (Task 4), used by `App.svelte` (Task 4); `TestServer`, `ownServer` and `askToQuit` (Task 4), used by Tasks 4 and 9;
  - `protocol.flasher` (Task 5), used by `test_core_isolation` (Tasks 5 and 6) and `docs/parity.md` (Task 11);
  - `test.dummy_keyboard.DummyKeyboard` (Task 6), used by `test_macro.py`; `QT_PACKAGES` and `imported_packages` (Task 6);
  - `version.VERSION` and `PRODUCT`, `selfcheck.problems`, `main` and `SERVER_MODULES`, `--version` and `--self-check` (Task 8), used by `vial.spec` and `util/smoke_test.py` (Task 8), CI (Task 10) and the README (Task 11);
  - `E2E_VIAL_CMD` (Task 9), used by `main.yml` (Task 10) and the READMEs (Task 11);
  - the artifact names `vial-windows`, `vial-linux` and `vial-macos` (Task 10), used by the README (Task 11) and the owner checklist.
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase6` at `22c45e5`). The plan was replayed mechanically from `main`, and the result was compared with the prototype.
