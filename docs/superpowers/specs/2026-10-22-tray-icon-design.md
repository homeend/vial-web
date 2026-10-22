# Tray icon instead of the console window: design

_2026-10-22. The owner asked for an icon in the taskbar's notification area instead of the console window Vial opens
on Windows, and how feasible that is on Windows, Linux and macOS. Built as phase 10, after phase 8; phase 9
(Learning) continues on its own branch._

## The problem

Double-clicking `Vial.exe` opened a console window showing the link, next to the browser. The console was Vial's
only presence: closing it stopped Vial, and it said when Vial was still running after the last tab closed. The owner
wants that presence to be an icon in the notification area instead, as other background programs have.

## Decisions

| Question | Decision |
|---|---|
| The library | **pystray** (LGPL, fine next to GPL-2) with **Pillow** for the icon image. Pure ctypes on Windows; PyObjC on macOS; python-xlib, or the system's PyGObject when it is there, on Linux. |
| Windows build | **Windowed** (`console=False`): no console window at all. The icon stands in for it. |
| Linux and macOS builds | **Terminal programs still**: they are started from a terminal, which keeps showing the link. The icon comes on top, where the desktop has a tray. |
| The icon's menu | **Open Vial** (the default action, so a click opens Vial where the system allows a click action: Windows and Linux) and **Quit Vial** (stops Vial as Quit on the page does, without asking about unsaved work). No "copy link": it would need a clipboard library, and Open Vial covers the need. |
| When the last tab closes | A **notification** from the icon says Vial is still running, where the backend can show one (not pystray's plain X11 backend). The console message stays. |
| Threads | **The icon's loop owns the main thread; the server runs in a thread.** pystray must run on the main thread on macOS (AppKit) and GTK, so one shape on every system. |
| Stopping | **Quit on the icon does what Quit on the page does**: the keyboard is let go of and every tab is told that Vial stopped (`app.state.quit`, run on the server's loop from the icon's thread; otherwise the tabs would keep trying to reconnect, which the owner saw on the first build), then the server stops. Ctrl+C, SIGTERM and SIGHUP ask the server to stop outright, as before; the icon goes when the server's thread ends. On Linux and macOS the stop signals are taken by a thread (`sigwait`) while the native loop holds the main thread, where Python's own handlers can't run. |
| No tray | **Vial runs as before**, and `vial.log` says why: pystray missing or without a backend, no display (Wayland, headless), the icon failing. `--no-tray` asks for that outright: the tests, the e2e fixtures and the smoke test use it. |
| macOS and the Dock | The app sets the **accessory** activation policy before the icon is made: a menu bar item only, nothing in the Dock. To be confirmed on a Mac (the CI's macOS job runs the smoke test only, with `--no-tray`). |
| Windows 11's hidden icons | New icons land behind the `^` until the user drags them out; an app can't change that. The README says so. |

Rejected: hiding the console window at start (it flashes, and started from a terminal it would hide the user's
terminal); attaching a windowed `Vial.exe` to the terminal it was started from to keep printing the link (the
one-file build's Python runs as a child of PyInstaller's bootloader, which has no console to attach to; the link is
in the browser, in `vial.log` and in redirected output); shipping pystray's GTK or AppIndicator backend on Linux (they
need the system's PyGObject, which the one-file executable can't carry reliably).

## What was checked

- **pystray's backends** (0.19.5): Windows `_win32` is ctypes only and can run in any thread; macOS `_darwin` needs
  the main thread, has no click action and installs its own SIGINT handler that would end the process at once (the
  `sigwait` thread takes SIGINT first); Linux `_xorg` has **no menu** and no notifications, and **opens the display
  as it is imported**, so a failed import is not always an `ImportError` (the tray code catches any exception, and
  the self-check on Linux imports the libraries module by module instead of pystray itself).
- **A windowed PyInstaller executable still writes to a redirected stdout**: the smoke test and the e2e tests read
  the link from the pipe as before (checked on the built `Vial.exe`: PE subsystem 2, no console window, pystray's
  windows present, smoke test passed).
- **Python's `print` with no console** (`sys.stdout` is `None`) does nothing, and argparse's messages are swallowed:
  nothing in the launcher fails for want of a console.

## What is left to the owner

- Try the icon on Windows: the hidden-icons area, Open Vial, Quit Vial, the notification after the last tab closes.
- Linux: whether the icon shows on the owner's desktop (an X11 panel with XEmbed), and that nothing changes without
  one. macOS: no Mac to test on.
- The executable grew by about 7 MB (Pillow's image libraries); trimming Pillow's plugins is possible later.
