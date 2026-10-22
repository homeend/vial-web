# Phase 11: a menu on the Linux tray icon

Design: [`2026-10-22-linux-tray-menu-design.md`](../specs/2026-10-22-linux-tray-menu-design.md). Branch
`phase11-linux-tray-menu`, in a worktree from `main`.

- [x] 1. **Groundwork.** dbus-fast 5.2.0 chosen (PyPI, MIT, no dependencies, Linux wheels); a WSL venv (Ubuntu
  24.04, Python 3.12) made from the pinned requirements with pip from its PyPI wheel, for the Linux tests.
- [x] 2. **`statusnotifier.py`.** `Item`, `pixmaps()`, `image_data()`; the `org.kde.StatusNotifierItem` and
  `com.canonical.dbusmenu` interfaces (dbus-fast `ServiceInterface`s, made only where dbus-fast imports);
  `Icon` mirroring pystray's (`run(setup)`, `stop()`, `visible`, `notify()`, the `HAS_*` flags), registration with
  the watcher and again when it comes back, notifications with the image; `make()` probing the session bus for a
  watcher with a host.
- [x] 3. **`tray.py`.** `image()` loads the logo on the square on its own; `make()` asks `statusnotifier` first on
  Linux, then pystray as before. `tray.run()` unchanged.
- [x] 4. **Build and check.** `requirements.txt` (`dbus-fast` on Linux), `vial.spec` (hidden imports `dbus_fast.aio`,
  `dbus_fast.service` on Linux), `selfcheck.LINUX_TRAY_MODULES` (`dbus_fast.service`), the CI's Linux runners
  install `dbus` for the bus tests.
- [x] 5. **Tests.** `test_statusnotifier.py`: the pure parts everywhere; on Linux, each bus test against its own
  `dbus-daemon --session` with a panel standing in (watcher with a host, notification service). `test_tray.py`:
  the StatusNotifier icon first on Linux, pystray when there is no host, never asked for elsewhere. Windows: 33
  passed, 9 skipped (the bus tests); WSL: 42 passed.
- [x] 6. **Live check (WSL).** `vial_web.py --fake` from source with the panel stand-in on the session bus:
  `statusnotifier.Icon` chosen, registered as `org.kde.StatusNotifierItem-<pid>-1`, the properties and the menu
  read by the panel, Quit Vial chosen on the menu: the tab told `stopped`, closed with 1001, exit 0, the name
  released.
- [x] 7. **Docs.** README: "What it does" (the tray bullet), Status row 11, Download and run (Linux), Quit (the
  notification), Building (dbus-fast). The design note.
- [x] 8. **Full suites and CI.** pytest Windows 1302 passed / 15 skipped, WSL 1313 / 4; `main` merged in
  (phase 9); pushed: Build (the Linux executable with dbus-fast, its smoke test's `--self-check`, e2e) and
  Test green on three systems (`35379b5`; Linux artifact: run 39765183494).
- [x] 9. **Owner check** on GNOME with the AppIndicator extension: the icon, its menu (Open Vial, Quit Vial), the
  notification when the last tab closes (2026-10-22: "it works"). Then the merge and a release.
