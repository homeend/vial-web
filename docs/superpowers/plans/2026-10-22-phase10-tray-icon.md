# Phase 10: Tray icon instead of the console window — Implementation Plan

**Goal:** while Vial runs it shows an icon in the notification area (Windows, Linux with a tray, macOS's menu bar)
with **Open Vial** and **Quit Vial** on its menu; the Windows executable opens no console window any more. Where
there can be no icon, Vial runs exactly as before. `--no-tray` turns the icon off.

**Design (scope contract):** `docs/superpowers/specs/2026-10-22-tray-icon-design.md`.

**Architecture:**
- **`tray.py`** (new): `load()` loads pystray and Pillow, or says why not (any exception: pystray's X11 backend
  opens the display as it is imported); `make(title, open_vial, quit_vial)` builds the icon with its menu, keeps Vial
  out of the macOS Dock, and returns `None` (logged) when there can be no icon; `run(icon, serve, stop)` runs
  `serve()` in pystray's setup thread while the icon's loop holds the main thread, stops on Quit, Ctrl+C or the stop
  signals (`_StopSignals`: SIGINT, SIGTERM, SIGHUP taken with `sigwait` on Linux and macOS), falls back to serving
  in the main thread when the icon can't be shown, and raises again what `serve()` raised; `notify(icon, message)`
  shows a notification where the backend can.
- **`vial_web.py`:** `--no-tray`; `serve()` makes the icon (title `Vial` or `Vial (simulated keyboard)`), prints
  `TRAY_MESSAGE` when there is one, runs the server through `tray.run` or directly, notifies from the icon when the
  last tab closes, and treats Quit on the icon like Ctrl+C (`TRAY_QUIT_MESSAGE`).
- **`resources.py`:** `ICON` (`src/main/icons/Icon.ico`) is bundled. **`selfcheck.py`:** the tray's libraries are
  checked (on Linux module by module, without importing pystray).
- **`vial.spec`:** `console=not WINDOWS`; hidden imports for the system's pystray backend and Pillow's ICO plugin;
  `gi` and pystray's GTK backends excluded. **`requirements.txt`:** pystray, Pillow, six; python-xlib on Linux;
  pyobjc-core, -Cocoa and -Quartz on macOS.
- **Tests and tooling:** `test/test_tray.py` (a `FakeIcon` standing in for pystray's); `test_vial_web.py` never
  makes a real icon (autouse fixture) and tests the tray path with the `FakeIcon`; `util/smoke_test.py` and
  `web/e2e/servers.ts` start Vial with `--no-tray`.

**Tech stack:** as phase 8, plus pystray 0.19.5, Pillow 13.0.0, six 1.17.0, python-xlib 0.33 (Linux), pyobjc 12.2.2
(macOS). No npm package changes.

---

## Tasks

- [x] **1. `tray.py`** with `load`, `keep_out_of_the_dock`, `make`, `notify`, `_StopSignals`, `run`; tests in
  `test/test_tray.py` for every path of `run` (serve in a thread, what it raised, Ctrl+C before and after the icon is
  ready, the icon failing before and after, a loop returning at once), the stop signals (POSIX), `make` with a fake
  pystray (menu, image, Dock policy, every way of failing) and `notify`.
- [x] **2. `vial_web.py`**: `--no-tray`, the icon in `serve()`, Quit from the icon, the notification; tests: the icon is
  asked for by default and not with `--no-tray`, the server runs in a thread and Quit on the icon stops it, Open
  Vial opens the browser, the last tab closing notifies, Ctrl+C with an icon stops cleanly.
- [x] **3. `resources.ICON`**, bundled; `selfcheck` checks the tray's libraries (platform-aware); tests.
- [x] **4. `vial.spec`** windowed on Windows, hidden imports and excludes; `requirements.txt`; `smoke_test.py` and
  `e2e/servers.ts` with `--no-tray`.
- [x] **5. Verify on Windows:** pytest (whole suite), build `dist/Vial.exe`, smoke test, and a live check of the built
  exe with `--fake`: PE subsystem 2 (GUI), no console window, pystray's windows present, Quit through the API, exit 0.
- [x] **6. README** ("What it does", Status, Download and run, Quit, options, Building) and this plan; STATUS.md.
- [x] **7. CI green** on the three systems (`f4f0302`, 2026-10-22: Build with the smoke test and the e2e tests against
  the executable, Test with pytest on Windows, Linux and macOS). The first push failed pytest on Linux and macOS:
  the stop-signal test sent SIGTERM to the whole process, which pytest-xdist's own threads don't block; it now sends
  it to the waiting thread.
- [ ] **8. Owner:** try the icon on Windows (hidden-icons area, Open Vial, Quit Vial, the notification after the last
  tab closes) and on Linux; then merge to `main`.
