# vial-web

A personal fork of [vial-gui](https://github.com/vial-kb/vial-gui) that replaces the Qt interface with a local web
UI: a small Python server on `127.0.0.1` talks to the keyboard, and the browser shows a clearer, Oryx-style view of
layers, tap dances, combos and macros. It comes as one executable file per system.

Website: **[vial-web.code-drill.eu](https://vial-web.code-drill.eu/)**

The Overview shows how each layer is reached from what Vial can read: layer keys, tap dances and combos. Layer
switching done in the keyboard's firmware code (for example `update_tri_layer_state` or `layer_state_set_user`) isn't
visible over the Vial protocol, so it isn't shown.

This fork is not affiliated with Vial and is not meant for upstream. For Vial itself, its firmware and official
releases, see [get.vial.today](https://get.vial.today/).

## What it does

- **Keymap:** every key on every layer. Click a key to see what it does on tap and on hold, and change it from a
  picker. Pointing at a key (or moving to it with Tab or the arrow keys) shows a tip at once (new in 1.1.0), in place of the
  browser's tooltip: what the key does, where it is, its keycode; a mod-tap's or layer-tap's tap and hold; a tap
  dance's four ways of pressing or a macro's steps, as coloured keycaps; the combos it is in. The same tip shows on
  the picker's keys and on the slot buttons of the Tap dance, Combos, Key overrides and Alt-repeat pages. The
  picker's Tap dance and Macros tabs list only the tap dances and macros that are set up. Find which keys type a
  character or send a key (`ą`, `@`, `Esc`, `MO(2)`). Drag a key onto another to swap or copy it. Name your layers.
- **Overview:** all layers at once, how each one is reached (layer keys, tap dances, combos), and what is set up but
  never used.
- **Arrange layers** (new in 0.9.0): move layers to other positions by dragging them or with ↑ and ↓. Every key that
  reaches a moved layer follows it: in the keymap, encoders, tap dances, combos, key overrides (and their layer
  masks), alt-repeat keys and macros. Layer names move too, and layer 0 stays first. A preview shows what will change
  before Apply; only what changes is written, and Undo puts the old order back. If writing stops partway (the keyboard
  unplugged, say), Vial offers to finish the arrange or put the layers back as they were.
- **Tap dance, combos, macros, key overrides, alt-repeat:** a page each. Macros can be edited as text or recorded.
  A tap dance's Clear empties its four slots at once (it asks first when keys use it); a combo, macro, key
  override or alt-repeat key has Remove in its editor.
- **QMK settings, lighting, layout options, matrix tester, reboot to bootloader.**
- **Layout files:** save the whole layout to a `.vil` file and load one back, with a preview of what it changes.
- **Learning** (first in the list of sections, above the editing pages): a typing course for your own layout. The
  Fingers view proposes which finger rests on and
  reaches each key (correct it where it is wrong) and exports the layout for the `generate-lessons` skill in Claude
  Code, which writes a lesson set; import it, and type the lessons with the next key lit on the keyboard picture.
  Accuracy and speed are recorded per keyboard; a lesson passes at the pass accuracy, a star at the target speed;
  a set's progress can be reset (every attempt and best forgotten, the lessons kept). A set built for an earlier
  layout (a character moved since) can be re-fitted to the layout as it is now, its lessons and progress kept.
  A ready course for a plain US QWERTY board, with a simulated board to type it on without hardware, is in
  [`docs/learning/examples/`](docs/learning/examples/ansi-60/README.md)
  ([design](docs/superpowers/specs/2026-10-21-learning-design.md), [file formats](docs/learning/lesson-format.md)).
  Nothing is written to the keyboard.
- Several keyboards plugged in: choose which one to edit. Unlocking, when the keyboard asks for it.
- Light and dark themes; key legends in your keyboard language.
- **Tray icon** (new in 1.0.0): while Vial runs it shows an icon (Vial's logo on a light square) in the notification
  area (on Windows no console window opens any more). Its menu has **Open Vial**, which opens the page in the
  browser, and **Quit Vial**, which stops Vial. When the last tab closes, the icon says that Vial is still running.
  On Linux the icon, with its menu, is in the panel's status area on every current desktop (KDE Plasma, GNOME with
  its AppIndicator extension, XFCE, Cinnamon, MATE and others, on X11 and Wayland); on macOS it is in the menu bar.
  Without a panel for it, Vial runs as before, from the terminal (see "Download and run").

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
| 8 | Arrange layers: move layers, every layer reference and name follows ([design](docs/superpowers/specs/2026-10-21-arrange-layers-design.md)) | done (0.9.0) |
| 9 | Learning: a typing course generated from the layout ([design](docs/superpowers/specs/2026-10-21-learning-design.md), [file formats](docs/learning/lesson-format.md)) | done |
| 10 | Tray icon instead of the console window: Open Vial and Quit Vial on its menu; Windows build without a console ([design](docs/superpowers/specs/2026-10-22-tray-icon-design.md)) | done |
| 11 | A menu on the Linux tray icon: Vial's own StatusNotifierItem over D-Bus, with notifications, on X11 and Wayland ([design](docs/superpowers/specs/2026-10-22-linux-tray-menu-design.md)) | done |

Design: [`docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`](docs/superpowers/specs/2026-10-15-vial-web-ui-design.md).
Roadmap: [`docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`](docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md).

The Qt app was removed in phase 6; it is in the history before that, and in upstream vial-gui.

## Download and run

Download the file for your system from [**Releases**](https://github.com/homeend/vial-web/releases):
`Vial-<version>-windows-x64.exe`, `vial-<version>-linux-x64.tar.gz` or `vial-<version>-macos-arm64.tar.gz`
(`SHA256SUMS.txt` has each file's SHA-256). The CI's Build workflow makes a release when a version tag is pushed.

Each push's build is also an artifact of its run for 30 days: open a successful run of
[**Build**](https://github.com/homeend/vial-web/actions/workflows/main.yml) under Actions (signed in to GitHub),
download `vial-windows`, `vial-linux` or `vial-macos`, and unzip it. An artifact doesn't keep the Linux and macOS
file's executable bit: `chmod +x vial` gives it back.

Close Vial's Qt app or another configurator first: they would use the keyboard at the same time.

- **Windows:** `Vial.exe` (in a release, `Vial-<version>-windows-x64.exe`). Put it in any folder and double-click it.
  The browser opens Vial, and Vial's icon appears in the notification area (no console window). Windows 11 puts a
  new icon in the hidden part of the notification area, behind the `^` at the right of the taskbar, until you drag it
  onto the taskbar. The icon's menu has **Open Vial** and **Quit Vial**. The file isn't signed: if SmartScreen stops
  it, choose *More info*, then *Run anyway*. Started from a terminal (`Vial.exe --fake`), it prints nothing there
  and the prompt comes back at once, as with any windowed program: the link is in the browser, in `vial.log`, and
  in the terminal only when the output is redirected (`Vial.exe --no-tray > out.txt`).
- **Linux:** `vial`, built on Ubuntu 22.04 (it needs glibc 2.35 or newer). Unpack it and run it from a terminal:
  `tar -xzf vial-<version>-linux-x64.tar.gz && ./vial`. Vial needs a udev rule to see keyboards: add it as
  [get.vial.today's Linux instructions](https://get.vial.today/manual/linux-udev.html) say, then plug the keyboard in
  again. The terminal shows the link as before, and Vial's icon appears in the panel's status area, with **Open
  Vial** and **Quit Vial** on its menu (the right button; a click opens Vial), on every desktop that takes
  StatusNotifier icons: KDE Plasma, GNOME with its AppIndicator extension (without it, GNOME shows no status
  icons at all), XFCE, Cinnamon, MATE, Budgie, LXQt, Waybar and others, on X11 and Wayland alike. On an older
  panel that takes only XEmbed tray icons (X11), the icon shows without a menu: a click opens Vial, Quit is on the
  page or Ctrl+C. Without any panel for it, there is no icon and Vial runs as before.
- **macOS** (Apple silicon): `vial`, built as is and not tested beyond the CI's smoke test. It isn't signed with a
  developer certificate or notarized. Run `tar -xzf vial-<version>-macos-arm64.tar.gz && ./vial` in Terminal (for an
  artifact: `chmod +x vial && ./vial`); if macOS refuses to open it, run
  `xattr -d com.apple.quarantine vial`, then `./vial` again. Vial's icon appears in the menu bar, with Open Vial and
  Quit Vial on its menu, and Vial stays out of the Dock.

To try it without a keyboard, start it with `--fake`: it serves a simulated Corne and never looks for real hardware.

```sh
.\Vial.exe --fake        # Windows (cmd or PowerShell, in the folder of Vial.exe)
./vial --fake            # Linux, macOS
```

Starting Vial while it already runs opens the running one in the browser instead (a `--fake` Vial and a real one
are kept apart: each has its own lock and session file).

### Quit

**Quit Vial** at the right of the top bar stops Vial: it lets go of the keyboard, every open tab says that Vial has
stopped and that you can close the tab, and Vial exits (its tray icon goes).
It asks first when there is work not saved (a combo being edited, the Settings page's changes, lighting not saved).
It asks only about the tab Quit is used in: work not saved in other open tabs is lost too. **Quit Vial** on the tray
icon's menu stops Vial the same way, without asking about unsaved work. Pressing Ctrl+C in the terminal Vial was
started from, or closing that window on Windows, stops Vial too, closing the keyboard first. On Linux and
macOS, `kill` (SIGTERM) and closing the terminal (SIGHUP) stop it cleanly as well, unless it was started with
`nohup`, which keeps it running when the terminal closes. At Windows log-off or shutdown, Windows ends Vial without
its cleanup, and the system releases the keyboard.

Closing the browser tabs doesn't stop Vial: once the last one has closed, the tray icon shows a notification that
Vial is still running (except from an XEmbed-only icon on Linux), and a console or terminal says so and prints the
link to reopen it. **Open Vial** on the icon's menu opens the page again (on Windows and Linux, a click on the icon
does the same).

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
| `--no-tray` | Don't show the tray icon; the link is printed and in `vial.log`. The tests and the smoke test use it |
| `--dry-run` | Connect, print a summary of the keyboard and exit |
| `--data-dir DIR` | Keep the lock, session file, log, names and Learning files in `DIR` instead of the user folders (below); a `--fake` Vial keeps them in `DIR/fake` |
| `--self-check` | Check that this build has everything it needs (hidapi, the server, the web UI, the tray icon's libraries) and exit, without looking for any keyboard |
| `--version` | Print Vial's version and exit |

The server listens on `127.0.0.1` only, and answers (apart from a health check) only pages opened through the
printed link.

### Where Vial keeps its files

Never next to the executable, and never in the folder the executable unpacks itself to while it runs:

| System | Lock, session file, log (`vial.log`) | Layer, tap dance and macro names (`names.json`); Learning's lesson sets, progress and fingers (`learning/<keyboard uid>/`) |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Vial` | `%LOCALAPPDATA%\Vial` |
| Linux | `~/.local/share/Vial` | `~/.config/Vial` |
| macOS | `~/Library/Application Support/Vial` | `~/Library/Application Support/Vial` |

A `--fake` Vial keeps its own in a `fake` subfolder of each. `--data-dir DIR` puts everything in `DIR` instead (a
`--fake` Vial in `DIR/fake`).

## Development

Python 3.13, and Node 24 with npm 11. The Python packages Vial uses directly are pinned (`requirements.txt`,
`test-requirements.txt`; the packages they pull in are not), and every npm package is pinned (`web/package-lock.json`).

Create the virtual environment `.venv` at the repository root and install the requirements:

```sh
python3.13 -m venv .venv                              # Windows: py -3.13 -m venv .venv
.venv/bin/pip install -r test-requirements.txt        # Windows: .venv\Scripts\pip
```

On Windows the helper scripts do the same with scoop's Python 3.13 (or the one `VIAL_PYTHON_HOME` names), reinstall
when the requirement files change, and activate the venv:

```sh
source ./use-python.sh      # Git Bash
. .\use-python.ps1          # PowerShell
use-python.cmd              # cmd
```

Build the web UI (and again after changes to `web/`), then run Vial from source with the simulated keyboard, with the
venv active:

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

The end-to-end tests need Playwright's Chromium: run `npx playwright install chromium` in `web/` once before the first
`npx playwright test`.

The end-to-end tests run against `vial_web.py --fake` servers with temporary data dirs. Run against a built
executable instead with `E2E_VIAL_CMD=dist/Vial.exe npx playwright test` (in `web/`; the path is relative to the
repository). The executable serves the web UI it was built with: rebuild it (`python -m PyInstaller vial.spec`) after
changes to `web/`. See [`web/README.md`](web/README.md).

### Building the executable

In one go, with Python 3.13 and Node 24 installed:

```sh
build-local.cmd       # Windows (cmd or PowerShell): dist\Vial.exe
./build-local.sh      # Linux, macOS: dist/vial
```

Each script activates the venv `.venv`, creating it when there is none, and installs the Python requirements when
they changed since they were last installed. On Windows `build-local.cmd` does this with `use-python.cmd` (scoop's
Python 3.13, or the one `VIAL_PYTHON_HOME` names); `build-local.sh` uses `python3.13`, or the Python that `PYTHON`
names (`PYTHON=/path/to/python3.13 ./build-local.sh`). It then runs `npm ci` in `web/` when `web/package-lock.json`
changed since it last ran, and does steps 1–3 below. It stops at the first step that fails and says which one; on
success it prints where the executable is. On Debian and Ubuntu, creating the venv needs the `python3.13-venv`
package.

The same steps by hand, from the repository root, with the venv active (see above: its Python has PyInstaller and the other
packages of `requirements.txt`). Each system builds only its own executable: build the Linux one on Linux.

1. Build the web UI. The executable carries it inside, so build it again after changes to `web/`:

   ```sh
   cd web && npm ci && npm run build && cd ..
   ```

2. Build the executable. **When this step ends, the executable is ready:** `dist/Vial.exe` on Windows, `dist/vial`
   on Linux and macOS.

   ```sh
   python -m PyInstaller vial.spec
   ```

   It is one file that you can copy anywhere and run: the Python runtime, hidapi, the web UI, `qmk_settings.json`
   and the tray icon's libraries (pystray, Pillow; dbus-fast on Linux) are inside it. On Windows it is a windowed
   app, without a console, with Vial's icon and version info; on Linux and macOS a terminal program.
   `vial.spec` refuses to build without the web UI of step 1. PyInstaller also leaves its working files in `build/`;
   you can delete that folder. The version is set in `src/main/python/version.py`.

3. Optional: check that the new file runs.

   ```sh
   python util/smoke_test.py dist/Vial.exe      # Linux, macOS: dist/vial
   ```

   The smoke test changes nothing in the executable and never uses a real keyboard. It runs `--self-check` (the
   executable checks that it has everything it needs), then starts it with `--fake --no-browser --no-tray` and a temporary
   data dir, reads `/api/session`, quits it through `/api/shutdown` as **Quit Vial** does, and checks that it exits
   with 0. It prints `smoke test passed: …`, or `smoke test FAILED: …` with the executable's output.

CI (`.github/workflows/main.yml`) does steps 1–3 on Windows, Linux and macOS, and runs the end-to-end tests against
the executable on Windows and Linux.

## License

GPL-2.0-or-later, as upstream vial-gui; see [`COPYING`](COPYING).
