# A menu on the Linux tray icon: design

Phase 11. Owner request 2026-10-22, after trying 1.0.0 on Linux (a GNOME top bar): the icon showed, but "there is no
context menu on linux".

## The problem

The Linux executable carries pystray's plain X11 backend only (`_xorg`): an XEmbed icon, which has no menu at all,
shows only on an X11 session whose panel still takes XEmbed icons, and can't show a notification. pystray's backends
with a menu (`_gtk`, `_appindicator`) need the system's PyGObject, which a one-file executable can't carry (it is
built against the system's Python and GTK). So on Linux, Quit was on the page or Ctrl+C, and a click was all the
icon did.

Every current Linux panel takes **StatusNotifierItem** icons instead: the D-Bus protocol from KDE (the
"AppIndicator" protocol is the same one): KDE Plasma, GNOME with its AppIndicator extension (the owner's case),
XFCE, Cinnamon, MATE, Budgie, LXQt, Waybar and others, on X11 and Wayland alike. The item is a D-Bus object the
panel reads (the icon as pixmaps, a title, a status) and calls (Activate on a click); its menu is a second object
(`com.canonical.dbusmenu`) whose layout the panel reads and draws itself, sending back which entry was chosen.
Notifications are a third, standard service (`org.freedesktop.Notifications`).

## Decisions

| Question | Decision |
|---|---|
| How | **Vial's own StatusNotifierItem** (`statusnotifier.py`) over the session bus, in pure Python: no GTK, no PyGObject, nothing from the system but the bus. Inside the one-file executable, on X11 and Wayland. |
| The D-Bus library | **dbus-fast 5.2.0** (MIT; the maintained fork of dbus-next; wheels for Linux, pure-Python fallback; no dependencies). Linux only in `requirements.txt`; it doesn't import on Windows (`socket.CMSG_LEN`), so `statusnotifier` guards its import and `tray.py` asks for it on Linux only. |
| Its place in `tray.py` | **On Linux the StatusNotifierItem comes first**, when the session bus has a `org.kde.StatusNotifierWatcher` with a host (a panel taking the icons; checked by `statusnotifier.make`, 5 s at most); **otherwise pystray as before** (its X11 icon without a menu, or, from source with PyGObject, its GTK/AppIndicator one); otherwise no icon, with why in `vial.log`. |
| The icon's contract | `statusnotifier.Icon` **mirrors the part of pystray's Icon that `tray.run()` uses**: `run(setup)` owns the thread it is called in and runs `setup(icon)` in a thread once the icon is on the bus; `stop()`; `visible`; `notify()`; the `HAS_*` flags. `tray.run()` is unchanged: the server runs in the setup thread, the stop signals are taken by `sigwait` as before. The menu is a plain list of `statusnotifier.Item(label, action, default)`, so pystray needn't be importable for the item to work (its X11 backend fails to import without a DISPLAY, which a Wayland session may lack). |
| The item | Bus name `org.kde.StatusNotifierItem-<pid>-1` (libappindicator's pattern; the unique name if that is taken), object `/StatusNotifierItem`: `Category` ApplicationStatus, `Id` vial, `Title` (the tooltip too), `Status` Active while visible and Passive otherwise (`NewStatus` + `PropertiesChanged` on a change), `IconPixmap` at 16, 22, 24, 32, 48 and 64 px (ARGB32 in network order, from the square image of 1.0.2, so no icon theme file is needed), `ItemIsMenu` false (a click = `Activate` = Open Vial; the menu is on the right button), `Menu` `/MenuBar`. `SecondaryActivate` (middle click) opens Vial too. |
| The menu | `/MenuBar`, `com.canonical.dbusmenu` version 3: the root (id 0, `children-display` submenu) with **Open Vial** (id 1) and **Quit Vial** (id 2), labels, enabled, visible. `GetLayout`, `GetGroupProperties`, `GetProperty`, `Event` / `EventGroup` ("clicked" runs the entry's action; other events are taken and ignored), `AboutToShow` false (the layout never changes). Unknown ids are D-Bus errors. |
| Registration | `RegisterStatusNotifierItem(<bus name>)` on the watcher once on the bus; **a watcher that comes back** (the panel restarted) is watched for through `NameOwnerChanged` and gets the item registered again. Leaving: the bus connection is closed, the name goes, the panel takes the icon down. |
| Notifications | `org.freedesktop.Notifications.Notify` with the icon's image as the `image-data` hint, replacing Vial's previous notification; failures logged, never raised (a courtesy). |
| Actions and threads | The panel's calls arrive on the icon's asyncio loop (the main thread); an entry's action runs there and must not block: Open Vial opens the browser in a thread already, Quit Vial hands over to the server's loop. An action that raises is logged. |
| Tests | The pure parts (pixmaps, layout, events, status) run everywhere dbus-fast imports. **The bus tests run on Linux**, each against a `dbus-daemon --session` of its own, with a panel standing in (the watcher with a host, and the notification service, faked with dbus-fast): registration, every property the panel reads, the menu's layout and a chosen entry, a click, Passive/Active, a notification with the image, a watcher restarting, and no icon without a watcher, a host or a bus. The CI installs `dbus` on its Linux runners for them; without `dbus-daemon` they skip. |
| Build | The executable carries `dbus_fast` (hidden imports `dbus_fast.aio` and `dbus_fast.service` on Linux); `--self-check` imports `dbus_fast.service` module by module with the other tray libraries. |
| Not done | Dynamic menus, an attention state, icon theme names, `Scroll`: nothing in Vial needs them. KDE's `org.kde.StatusNotifierItem` is served under that name only (the `org.freedesktop.StatusNotifierItem` name is taken by no panel in practice). |

## Rejected

- **PyGObject in the executable**: it binds to the system's GTK and Python; a one-file executable can't carry it.
- **A GTK or Qt tray through another toolkit**: hundreds of megabytes and the same binding problem.
- **Keeping the XEmbed icon only**: no menu, X11 only, and GNOME needs the extension's legacy mode for it.
- **dbus-next**: the same API, unmaintained since 2021; dbus-fast is its maintained fork.
- **jeepney**: pure Python too, but low-level: introspection, properties and signals would have to be written by hand.

## What was checked

- Under WSL (Ubuntu 24.04, Python 3.12, a session bus of the test's own): all bus tests pass; a live run of
  `vial_web.py --fake` from source with the panel stand-in registers the icon, serves its properties and menu, and
  Quit Vial chosen on the menu stops Vial as Quit on the page does (the tabs told, exit 0).
- On Windows the pure tests pass and the bus tests skip; `statusnotifier` imports (dbus-fast's core does; its aio
  part doesn't, and is imported only where used).

## Left to the owner

- The real panels: GNOME with the AppIndicator extension (the owner's), and any other the owner uses. The menu's
  look is the panel's.
- macOS stays as it was (pystray's menu bar item).
