# vial-web

A personal fork of [vial-gui](https://github.com/vial-kb/vial-gui) that replaces the Qt interface with a local web
UI: a small Python server on `127.0.0.1` talks to the keyboard, and the browser shows a clearer, Oryx-style view of
layers, tap dances, combos and macros. It comes as one executable file per system.

The Overview shows how each layer is reached from what Vial can read: layer keys, tap dances and combos. Layer
switching done in the keyboard's firmware code (for example `update_tri_layer_state` or `layer_state_set_user`) isn't
visible over the Vial protocol, so it isn't shown.

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

Download the file for your system from [**Releases**](https://github.com/homeend/vial-web/releases):
`Vial-<version>-windows-x64.exe`, `vial-<version>-linux-x64.tar.gz` or `vial-<version>-macos-arm64.tar.gz`
(`SHA256SUMS.txt` has each file's SHA-256). The CI's Build workflow makes a release when a version tag is pushed.

Each push's build is also an artifact of its run for 30 days: open a successful run of
[**Build**](https://github.com/homeend/vial-web/actions/workflows/main.yml) under Actions (signed in to GitHub),
download `vial-windows`, `vial-linux` or `vial-macos`, and unzip it. An artifact doesn't keep the Linux and macOS
file's executable bit: `chmod +x vial` gives it back.

Close Vial's Qt app or another configurator first: they would use the keyboard at the same time.

- **Windows:** `Vial.exe` (in a release, `Vial-<version>-windows-x64.exe`). Put it in any folder and double-click it.
  A console window opens and shows the link, and the browser opens it. The file isn't signed: if SmartScreen stops
  it, choose *More info*, then *Run anyway*.
- **Linux:** `vial`, built on Ubuntu 22.04 (it needs glibc 2.35 or newer). Unpack it and run it from a terminal:
  `tar -xzf vial-<version>-linux-x64.tar.gz && ./vial`. Vial needs a udev rule to see keyboards: add it as
  [get.vial.today's Linux instructions](https://get.vial.today/manual/linux-udev.html) say, then plug the keyboard in
  again.
- **macOS** (Apple silicon): `vial`, built as is and not tested beyond the CI's smoke test. It isn't signed with a
  developer certificate or notarized. Run `tar -xzf vial-<version>-macos-arm64.tar.gz && ./vial` in Terminal (for an
  artifact: `chmod +x vial && ./vial`); if macOS refuses to open it, run
  `xattr -d com.apple.quarantine vial`, then `./vial` again.

To try it without a keyboard, start it with `--fake`: it serves a simulated Corne and never looks for real hardware.

```sh
.\Vial.exe --fake        # Windows (cmd or PowerShell, in the folder of Vial.exe)
./vial --fake            # Linux, macOS
```

Starting Vial while it already runs opens the running one in the browser instead (a `--fake` Vial and a real one
are kept apart: each has its own lock and session file).

### Quit

**Quit Vial** at the right of the top bar stops Vial: it lets go of the keyboard, every open tab says that Vial has
stopped and that you can close the tab, and Vial exits (a console window it opened closes). It asks first when there
is work not saved (a combo being edited, the Settings page's changes, lighting not saved). It asks only about the tab
Quit is used in: work not saved in other open tabs is lost too. Pressing Ctrl+C in the console window, or closing that
window, stops Vial too, closing the keyboard first. On Linux and macOS, `kill` (SIGTERM) and closing the terminal
(SIGHUP) stop it cleanly as well, unless it was started with `nohup`, which keeps it running when the terminal closes.
At Windows log-off or shutdown, Windows ends Vial without its cleanup, and the system releases the keyboard.

Closing the browser tabs doesn't stop Vial: once the last one has closed, the console says that Vial is still running
and prints the link to reopen it.

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
| `--data-dir DIR` | Keep the lock, session file, log and names in `DIR` instead of the user folders (below); a `--fake` Vial keeps them in `DIR/fake` |
| `--self-check` | Check that this build has everything it needs (hidapi, the server, the web UI) and exit, without looking for any keyboard |
| `--version` | Print Vial's version and exit |

The server listens on `127.0.0.1` only, and answers (apart from a health check) only pages opened through the
printed link.

### Where Vial keeps its files

Never next to the executable, and never in the folder the executable unpacks itself to while it runs:

| System | Lock, session file, log (`vial.log`) | Layer, tap dance and macro names (`names.json`) |
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

From the repository root, with the venv active:

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

GPL-2.0-or-later, as upstream vial-gui; see [`COPYING`](COPYING).
