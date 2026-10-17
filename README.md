# vial-web

A personal fork of [vial-gui](https://github.com/vial-kb/vial-gui) that replaces the Qt interface with a local web
UI: a small Python server on `127.0.0.1` talks to the keyboard, and the browser shows a clearer, Oryx-style view of
layers, tap dances, combos and macros.

This fork is not affiliated with Vial and is not meant for upstream. For Vial itself, its firmware and official
releases, see [get.vial.today](https://get.vial.today/).

## Status

| Phase | What | State |
|---|---|---|
| 0 | Python 3.13 | done |
| 1 | Keyboard simulator and local API server (`vial_web.py`) | done |
| 2 | Web UI: see and edit every key on every layer | done |
| 3 | Overview of all layers; how each layer is reached (including combos) | in progress |
| 4 | Tap dance, combos, macros pages; unlock | planned |
| 5 | Parity with the Qt app | planned |
| 6 | Packaging; Qt removed | planned |
| 7 | Firmware flasher | optional |

Design: [`docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`](docs/superpowers/specs/2026-10-15-vial-web-ui-design.md).
Roadmap: [`docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`](docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md).

Until phase 6, the Qt app is still here and still works. Use one or the other: close the Qt app before starting the
web UI, because both want the keyboard.

## Setup

Python 3.13 and, for the web UI, Node 24 with npm 11.

Create the virtual environment `.venv` at the repository root and install the requirements. On Windows the helper
scripts do this (they use scoop's Python 3.13 unless `VIAL_PYTHON_HOME` says otherwise) and reinstall when the
requirement files change:

```sh
source ./use-python.sh      # Git Bash
. .\use-python.ps1          # PowerShell
use-python.cmd              # cmd
```

Or by hand:

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r test-requirements.txt                 # Windows: .venv\Scripts\pip
.venv/bin/pip install --no-deps -r requirements-fbs.txt        # only for the Qt app
```

Build the web UI once (and again after pulling changes to `web/`):

```sh
cd web
npm ci
npm run build
```

## Running

Web UI with your keyboard (opens the browser):

```sh
cd src/main/python
python vial_web.py
```

Web UI with a simulated Corne, no hardware touched:

```sh
python vial_web.py --fake
```

| Option | What it does |
|---|---|
| `--fake` | Use a simulated keyboard instead of real hardware |
| `--definition FILE` | With `--fake`: the `vial.json` of the keyboard to simulate |
| `--layout FILE` | With `--fake`: a `.vil` layout to load into the simulated keyboard |
| `--port PORT` | Port to listen on (default: any free port) |
| `--no-browser` | Don't open the browser; the link with its session token is printed |
| `--dry-run` | Connect, print a summary and exit |
| `--data-dir DIR` | Keep the lock, session file, log and layer names in `DIR` instead of the user folders |

The server listens on `127.0.0.1` only, and answers only pages opened through the printed link.

Qt app (until phase 6):

```sh
cd src/main/python
python main.py
```

## Development

Python tests, from `src/main/python`:

```sh
QT_QPA_PLATFORM=offscreen python -m pytest -q -p no:cacheprovider test
```

Web UI: see [`web/README.md`](web/README.md) for the dev workflow, the type check, unit tests, end-to-end tests and the
generated API types.

## License

GPL-2.0, as upstream vial-gui; see [`COPYING`](COPYING).
