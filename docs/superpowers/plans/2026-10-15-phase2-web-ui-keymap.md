# Phase 2: Web UI with keymap editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vial_web.py` serves the first usable web UI: a Svelte 5 app that draws the keyboard from its geometry and edits every key on every layer. It has layer names, an Inspector, a keycode picker and keyboard-language labels, and it's tested end to end against the simulator.

**Architecture:**
- **Backend.** The phase 1 server gains:
  - a `--data-dir` option;
  - a fake-mode-only switch that unplugs the simulated keyboard;
  - keyboard languages (`?lang=`), and key descriptions with a structured legend;
  - typed responses, so `server/dump_openapi.py` can write a complete OpenAPI schema without starting a server.
- **Frontend.** `web/` is a plain Svelte 5 (runes only) + TypeScript + Vite app, built to `web/dist`, which `vial_web.py` already serves.
  - Its API types are generated from that schema.
  - Pure logic lives in `.ts` modules with Vitest tests. Components are `.svelte` files.
  - One store (`src/lib/keyboard.svelte.ts`) holds the loaded keyboard, the connection and the edits.
  - Playwright e2e tests run against two `vial_web.py --fake` servers.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2.
- Frontend: Node 24, Svelte 5.57.1, @sveltejs/vite-plugin-svelte 7.3.1, Vite 8.3.1, TypeScript 5.9.3, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0.
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).

**Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`. **Roadmap (phase 2 scope):** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard.** Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `vial_web.py --fake --no-browser --data-dir <temp dir>`. The e2e global setup (Task 15) starts it exactly like that.
   - Never start the Qt app (`src/main/python/main.py`).
   - Tests use simulated keyboards only.
2. **Shell:** Git Bash on Windows; commands are written for it.
   - Every command block starts in the repository root. A `cd` inside a block applies to that block only.
   - On Linux/macOS, replace `.venv/Scripts/python.exe` with `.venv/bin/python`.
3. **Python:** the repository's `.venv` (Python 3.13, with `test-requirements.txt` installed).
   - Tests run from `src/main/python`, because the code uses top-level imports:

   ```
   cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
   ```

   - `QT_QPA_PLATFORM=offscreen` keeps the Qt tests' windows off the screen.
   - The web scripts (`gen:api`, `check:api`, `e2e`) find this same `.venv` themselves, or the Python named by `VIAL_PYTHON`.
4. **Node:** Node 24 and npm 11, inside `web/` only. No global installs.
   - Task 5 runs `npm install` once to create `web/package-lock.json`. After that, a fresh checkout runs `cd web && npm ci`.
   - `web/.npmrc` sets `save-exact`: every version is exact.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` is pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. The file count grows from task to task; only the errors and warnings matter.
7. **Line endings:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
8. **Commits:** one commit per task, on branch `phase2-web-ui`.
   - Add the files the task names. Never `git add -A`, and leave the untracked `gh.txt` alone.
   - End every commit message with the trailer the session tells you to use.
9. **How code is given.**
   - "Create `X`:" or "Replace the whole of `X` with:" is followed by the file's complete content.
   - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
   - Two files are never written by hand: `web/package-lock.json` (from `npm install`) and `web/src/api/schema.d.ts` (from `npm run gen:api`).
   - Each "Expected:" lists text that the command's output contains.
10. **Standing rules (roadmap):**
   - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
   - Content width is capped at 1100 px for the keymap.
   - Every check stays green: pytest, svelte-check, Vitest, build, e2e, and the generated API types up to date.

## Prerequisite

Phase 1 is merged into `main`. `.venv` exists, the full suite passes, and Node 24 and the Playwright Chromium are installed:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `421 passed, 1 skipped`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/vial_web.py` | `--data-dir DIR`: the lock, `server.json`, `vial.log` and `names.json` all go in one folder (fake mode in its `fake/` subfolder) |
| `src/main/python/server/device.py` | `FakeBackend.set_connected()`: unplug or replug the simulated keyboard |
| `src/main/python/server/languages.py` | **new.** Keyboard languages from Vial's `keymaps.py` with slug ids (`polish-qwerty`), and their label overrides |
| `src/main/python/server/describe.py` | Keycode → legend `{main, shifted, altGr}`, one-line tap, hold, kind, layer + `layerAction`, index, description. All modifier combinations are decoded from the mod bits. Labels follow the keyboard language of the context |
| `src/main/python/server/schemas.py` | `KeyKind`, `LayerAction`, `Legend`, the new `Described`, `KeyboardLanguage`, `CatalogueKeycode`, `KeycodeCategory`, `Named`, `LayoutOptionsValue`, `Event`, typed `LayoutOptions.labels`, `SimulatorConnection` |
| `src/main/python/server/model.py` | `display_name()` (the reply of `PUT /api/names`), keycode catalogue with aliases |
| `src/main/python/server/app.py` | `?lang=` on every route that describes keys, `GET /api/keyboard-languages`, keycodes and parse work without a keyboard, typed replies, `Event` in the schema, the fake-only `PUT /api/simulator/connection` (left out of the schema), placeholder page left out of the schema |
| `src/main/python/server/dump_openapi.py` | **new.** `python -m server.dump_openapi OUT.json` writes the OpenAPI schema without a server or device |
| `src/main/python/test/test_vial_web.py`, `test_api.py`, `test_describe.py` | tests for the above |
| `src/main/python/test/test_languages.py`, `test_dump_openapi.py` | **new.** tests |
| `web/package.json`, `web/package-lock.json`, `web/.npmrc`, `web/.gitignore` | **new.** Exact dependency versions and scripts (`dev`, `build`, `check`, `test`, `e2e`, `gen:api`, `check:api`) |
| `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`, `web/svelte.config.js` | **new.** TypeScript for the app and for the tooling; Vite + Vitest; runes-only Svelte |
| `web/index.html`, `web/src/main.ts`, `web/src/app.css` | **new.** Page, entry point, colour tokens (light and dark) and base styles |
| `web/scripts/python.mjs`, `web/scripts/gen-api.mjs` | **new.** Find the repository's Python; generate or check `src/api/schema.d.ts` |
| `web/src/api/schema.d.ts` | **new, generated** by `npm run gen:api`; never edited by hand |
| `web/src/api/types.ts`, `client.ts`, `errors.ts`, `events.ts`, `api.ts` | **new.** Named API types, typed `request()`, user-facing error messages, the `/api/events` WebSocket with reconnect, the routes the UI uses |
| `web/src/keyboard/geometry.ts` | **new.** Places keys and encoders (rotation, secondary rectangles, layout options, decals) in key units |
| `web/src/keyboard/labels.ts` | **new.** What a key cap shows (`keyFace`), its colour family, legend sizes, and the Inspector's words (`keyTitle`, `actionSummary`) |
| `web/src/keyboard/refs.ts` | **new.** A key or encoder direction (`KeyRef`), what it does on a layer, where it is |
| `web/src/keymap/hold.ts`, `navigation.ts`, `tapdance.ts` | **new.** Change-hold expressions (LT/MT), arrow-key navigation, free tap dance and tap dance slots |
| `web/src/picker/search.ts`, `web/src/lib/theme.ts` | **new.** Keycode search (label, name, alias, description); System/Light/Dark theme |
| `web/src/lib/toasts.svelte.ts`, `web/src/lib/keyboard.svelte.ts` | **new.** Toast messages; the keyboard store (model, session, catalogue, language, connection, edits) |
| `web/src/ui/Button.svelte`, `web/src/shell/*.svelte` | **new.** Button; top bar (name, status, simulated badge, language, theme), navigation, banners, toasts |
| `web/src/keyboard/Key.svelte`, `KeyCap.svelte`, `Encoder.svelte`, `Keyboard.svelte` | **new.** Drawing keys (SVG shapes), knobs for encoders, the whole board scaled to its card |
| `web/src/picker/AnyKeycode.svelte`, `Picker.svelte` | **new.** The keycode picker dialog and its live-checked "any keycode" entry |
| `web/src/keymap/*.svelte`, `web/src/App.svelte` | **new.** Keymap Edit view (layer tabs with rename, Inspector, hold editor, colour legend) and the app shell |
| `web/playwright.config.ts`, `web/e2e/**` | **new.** e2e tests against `vial_web.py --fake`: the Corne, and a macropad fixture with encoders |
| `web/README.md` | **new.** Setup, dev workflow, scripts, API types, e2e |
| `.github/workflows/test.yml` | a `web` job: check, unit tests, build, API types up to date, e2e |

## Out of scope for this plan (later phases)

- **Phase 3:**
  - In the Inspector: "combos using this key" and "how this layer is reached".
  - The Overview view.
  - The red underline on combo member keys.
- **Phase 4:**
  - The tap dance, combos and macros pages. "Turn into tap dance" (Task 14) puts the key's action into a free tap dance and that tap dance on the key; editing its slots comes with the tap dance page.
  - The unlock flow. Until then, a 423 shows "This change needs the keyboard unlocked; unlocking isn't supported yet."
- **Phase 5:**
  - Editing layout options. The drawing uses the keyboard's current option values.
  - The matrix tester and the other parity pages.
- **Phase 6:** packaging, removing Qt, CI on three systems.

---

### Task 1: `--data-dir` keeps every file in one folder

Tests and e2e runs need a server whose lock, session file (`server.json`), log and names file live in a temporary folder, never in the user's data and config folders. `--data-dir DIR` puts all four in `DIR`. Fake mode still uses its own `fake/` subfolder, so a fake run and a real run never share a lock. `use_data_dir(None)` restores the user's folders. The tests reset it after each test, because it is process-wide.

**Files:**
- Modify: `src/main/python/test/test_vial_web.py`, `src/main/python/vial_web.py`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -31,6 +31,13 @@ def reset_unlock_handler():
     set_unlock_handler(None)
 
 
+@pytest.fixture(autouse=True)
+def reset_data_dir():
+    """ main(["--data-dir", ...]) and use_data_dir() choose the data dir for the whole process """
+    yield
+    vial_web.use_data_dir(None)
+
+
 @pytest.fixture
 def home(tmp_path, monkeypatch):
     """ Keeps the data dirs (log, server.json) and the config dirs of both modes in tmp_path, and the browser closed.
@@ -736,3 +743,62 @@ def test_connection_reset_is_ignored(home):
     finally:
         thread.join(2)
         listener.close()
+
+
+# ---------- --data-dir ----------
+
+@pytest.fixture
+def no_platform_dirs(monkeypatch):
+    """ Fails the test if anything asks for the user's real data or config dir """
+    def refuse(*args, **kwargs):
+        raise AssertionError("used the user's own data or config dir")
+    monkeypatch.setattr(vial_web.platformdirs, "user_data_dir", refuse)
+    monkeypatch.setattr(vial_web.platformdirs, "user_config_dir", refuse)
+    monkeypatch.setattr(vial_web.webbrowser, "open", refuse)
+
+
+@pytest.fixture
+def root_log_handlers():
+    """ Removes (and closes) the log handlers main() adds to the root logger """
+    root = logging.getLogger()
+    level, before = root.level, list(root.handlers)
+    yield
+    root.setLevel(level)
+    for handler in [h for h in root.handlers if h not in before]:
+        root.removeHandler(handler)
+        handler.close()
+
+
+def test_data_dir_option_is_made_absolute(tmp_path, monkeypatch):
+    monkeypatch.chdir(tmp_path)
+    assert vial_web.parse_args(["--fake", "--data-dir", "here"]).data_dir == str(tmp_path / "here")
+    assert vial_web.parse_args(["--fake"]).data_dir is None
+
+
+@pytest.mark.parametrize("fake", [True, False])
+def test_data_dir_holds_every_file_of_its_mode(tmp_path, no_platform_dirs, fake):
+    vial_web.use_data_dir(str(tmp_path))
+    where = str(tmp_path / "fake") if fake else str(tmp_path)
+    for path in (vial_web.lock_file, vial_web.session_file, vial_web.log_file, vial_web.names_file):
+        assert os.path.dirname(path(fake)) == where
+
+
+def test_fake_launch_with_data_dir_keeps_everything_in_it(tmp_path, no_platform_dirs, fake_server, monkeypatch,
+                                                          root_log_handlers):
+    from server import names
+    paths = []
+    store = names.NamesStore
+    monkeypatch.setattr(names, "NamesStore", lambda path: paths.append(path) or store(path))
+    assert vial_web.main(["--fake", "--no-browser", "--data-dir", str(tmp_path)]) == 0
+    fake_dir = tmp_path / "fake"
+    assert paths == [str(fake_dir / "names.json")]
+    assert fake_server.seen["session"]["fake"] is True  # server.json was found in the fake subfolder while serving
+    assert sorted(os.listdir(tmp_path)) == ["fake"]
+    assert "vial.lock" in os.listdir(fake_dir) and "vial.log" in os.listdir(fake_dir)
+
+
+def test_launch_without_data_dir_uses_the_user_dirs_again(tmp_path, home, fake_server):
+    vial_web.use_data_dir(str(tmp_path / "elsewhere"))
+    assert vial_web.main(["--fake", "--no-browser"]) == 0
+    assert vial_web.data_dir(True) != str(tmp_path / "elsewhere" / "fake")
+    assert not os.path.exists(tmp_path / "elsewhere")
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `5 failed, 83 passed, 1 skipped, 88 errors`.

The 5 new tests fail. Every test also errors at teardown, because the autouse fixture `reset_data_dir` calls `vial_web.use_data_dir`, which doesn't exist yet.

- [ ] **Step 3: Implement `--data-dir`**

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -50,6 +50,16 @@ Press Ctrl+C to stop."""
 
 log = logging.getLogger(__name__)
 
+_data_root = None
+""" --data-dir: one folder holding the lock, server.json, vial.log and names.json instead of the user's data and
+config dirs (fake mode still uses its own subfolder of it). None: the user's dirs. """
+
+
+def use_data_dir(path):
+    """ Keep every file in path (None: the user's data and config dirs) """
+    global _data_root
+    _data_root = path
+
 
 def _mode_dir(path, fake):
     return os.path.join(path, FAKE_SUBDIR) if fake else path
@@ -57,12 +67,12 @@ def _mode_dir(path, fake):
 
 def data_dir(fake):
     """ Holds the instance lock, server.json and vial.log of real mode, or (fake=True) of fake mode """
-    return _mode_dir(platformdirs.user_data_dir(APP_NAME, appauthor=False), fake)
+    return _mode_dir(_data_root or platformdirs.user_data_dir(APP_NAME, appauthor=False), fake)
 
 
 def config_dir(fake):
     """ Holds names.json of real mode, or (fake=True) of fake mode """
-    return _mode_dir(platformdirs.user_config_dir(APP_NAME, appauthor=False), fake)
+    return _mode_dir(_data_root or platformdirs.user_config_dir(APP_NAME, appauthor=False), fake)
 
 
 def lock_file(fake):
@@ -291,6 +301,9 @@ def parse_args(argv):
     parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
     parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
     parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
+    parser.add_argument("--data-dir", type=os.path.abspath,
+                        help="keep the instance lock, session file, log and names in this folder instead of the "
+                             "user's data and config folders (for tests and development)")
     args = parser.parse_args(argv)
     if (args.definition or args.layout) and not args.fake:
         parser.error("--definition and --layout only work with --fake")
@@ -299,6 +312,7 @@ def parse_args(argv):
 
 def main(argv=None):
     args = parse_args(sys.argv[1:] if argv is None else argv)
+    use_data_dir(args.data_dir)
 
     # Claim the instance before touching any keyboard: a second instance opening the keyboard and reading
     # everything from it would mix up the replies the first one is waiting for. The claim is held from before
```

- [ ] **Step 4: Run the tests again**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `88 passed, 1 skipped`.

- [ ] **Step 5: Run the full suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `426 passed, 1 skipped`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py
git commit -m "feat(vial_web): --data-dir keeps the lock, session, log and names in one folder"
```

### Task 2: Fake mode can unplug and replug the simulated keyboard

The e2e test for the "keyboard unplugged" banner needs a way to unplug the simulated keyboard.
- `FakeBackend.set_connected(False)` marks the simulator as unplugged. The device manager's hot-plug poll then reports `disconnected`, exactly as it would for a real keyboard.
- `PUT /api/simulator/connection` exposes this, but only when the server runs with `--fake`. For real keyboards the route doesn't exist.
- The route needs the session cookie like every other route, and it is left out of the OpenAPI schema: it is a test aid, not part of the API.
- `app.state.manager` lets tests reach the device manager.

**Files:**
- Modify: `src/main/python/server/app.py`, `src/main/python/server/device.py`, `src/main/python/server/schemas.py`, `src/main/python/test/test_api.py`

- [ ] **Step 1: Write the failing tests** (appended at the end of `test_api.py`)

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -271,3 +271,44 @@ def test_last_tab_closing_is_reported(setup):
     while not app.state.gone and time.time() < deadline:
         time.sleep(0.02)
     assert app.state.gone == [True]
+
+
+# ---------- simulator controls (fake mode only) ----------
+
+def test_simulated_keyboard_can_be_unplugged_and_plugged_back(setup):
+    client, virtual, app = setup
+    response = client.put("/api/simulator/connection", json={"connected": False})
+    assert response.status_code == 200 and response.json() == {"connected": False}
+    assert not virtual.connected
+    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}).status_code == 503
+    assert client.put("/api/simulator/connection", json={"connected": True}).json() == {"connected": True}
+    assert virtual.connected
+
+
+def test_unplugging_the_simulator_is_reported_by_the_hot_plug_poll(tmp_path):
+    manager = DeviceManager(FakeBackend(make_corne))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
+    with TestClient(app, base_url=BASE) as c:
+        c.get("/?token=" + TOKEN, follow_redirects=False)
+        c.put("/api/simulator/connection", json={"connected": False})
+        assert manager.check() == ["disconnected"]
+        c.put("/api/simulator/connection", json={"connected": True})
+        assert manager.check() == ["connected"]
+        assert c.get("/api/keyboard").status_code == 200
+
+
+def test_simulator_controls_need_the_session(tmp_path):
+    app = create_app(DeviceManager(FakeBackend(make_corne)), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
+                     poll_interval=0)
+    with TestClient(app, base_url=BASE) as c:
+        assert c.put("/api/simulator/connection", json={"connected": False}).status_code == 401
+
+
+def test_simulator_controls_do_not_exist_for_real_keyboards(tmp_path):
+    app = create_app(DeviceManager(NoRealKeyboard()), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
+                     poll_interval=0)
+    with TestClient(app, base_url=BASE) as c:
+        c.get("/?token=" + TOKEN, follow_redirects=False)
+        assert c.put("/api/simulator/connection", json={"connected": False}).status_code in (404, 405)
+        assert "/api/simulator/connection" not in c.get("/openapi.json").text
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api.py
```

Expected: `2 failed, 27 passed`. The route doesn't exist yet, so the session test and the real-keyboard test already pass.

- [ ] **Step 3: Add `set_connected` to the fake backend**

Apply to `src/main/python/server/device.py`:

```diff
diff --git a/src/main/python/server/device.py b/src/main/python/server/device.py
--- a/src/main/python/server/device.py
+++ b/src/main/python/server/device.py
@@ -113,6 +113,12 @@ class FakeBackend:
     def present(self, candidate):
         return self.virtual is not None and self.virtual.connected
 
+    def set_connected(self, connected):
+        """ Simulate unplugging the keyboard (False) or plugging it back in (True); the hot-plug poll notices """
+        if self.virtual is None:
+            self.virtual = self.keyboard_factory()
+        self.virtual.connected = connected
+
 
 class HidBackend:
     """ Real keyboards through hidapi; imported lazily so fake mode never loads hidapi """
```

- [ ] **Step 4: Add the request shape**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -289,5 +289,10 @@ class LightingIn(Request):
     save: bool = True
 
 
+class SimulatorConnection(Request):
+    """ Fake mode only: whether the simulated keyboard is plugged in """
+    connected: bool
+
+
 class NameIn(Request):
     name: Optional[str] = Field(default=None, max_length=40)
```

- [ ] **Step 5: Add the route** (fake mode only, outside the schema)

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -157,6 +157,7 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
 
     app = FastAPI(title="Vial", lifespan=lifespan)
     app.state.hub = hub
+    app.state.manager = manager
 
     def token_ok(value):
         # as bytes: compare_digest refuses str with non-ASCII characters
@@ -387,6 +388,14 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         finally:
             await hub.remove(ws)
 
+    if manager.backend.fake:
+        # for UI tests: unplug and replug the simulated keyboard. Never exists for real keyboards.
+        @app.put("/api/simulator/connection", include_in_schema=False)
+        def set_simulator_connection(body: schemas.SimulatorConnection):
+            with manager.lock:
+                manager.backend.set_connected(body.connected)
+            return {"connected": body.connected}
+
     if static_dir and os.path.isdir(static_dir):
         app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
     else:
```

- [ ] **Step 6: Run the tests again, then the full suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api.py
```

Expected: `29 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `430 passed, 1 skipped`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/device.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py
git commit -m "feat(server): fake mode can unplug and replug the simulated keyboard"
```

### Task 3: Keyboard languages and clean key descriptions

Two changes to what the API says about a key. They are made together because both rewrite `describe()`.

**Keyboard languages.** The computer's keyboard layout changes what a key's label should say. With Polish, `KC_A` also types `ą` with AltGr. With German, `KC_Y` types `Z`.
- `server/languages.py` lists Vial's own layouts from `keymaps.py`. Each gets a slug id: `polish-qwerty`, `german-qwertz`.
- `en-us` ("English (US)") is the default, and relabels nothing.
- Every route that describes keys takes `?lang=<id>`. An unknown id is refused with 422 before anything is read or written.
- `describe()` reads the language from a context variable that `keyboard_language()` sets. The language is stateless per request.

**Clean key descriptions.** `Described` changes as follows:
- `legend {main, shifted, altGr}`: what the key cap shows, each part on one line. Vial's Qt labels break lines (`"!\n1"`, `"Caps\nLock"`) and have an AltGr column; `legend_of()` turns them into this.
- `tap` is one line: `"Caps Lock"`, `"Ctrl+C"`.
- `hold` only describes holding: `"Shift"`, `"layer 2"`. A layer key's action now goes in `layerAction`: `"while held"`, `"toggle"`, `"switch to"`, …
- `description` is the keycode's explanation. It replaces `tooltip`, which mixed the name with the explanation.
- `kind` is a fixed set (`KeyKind`), so the UI's types can switch on it.
- Modifiers are decoded from QMK's 5 mod bits, for both protocol 5 and protocol 6. So every combination reads well, including right-hand ones (`MT(MOD_RCTL|MOD_RSFT, KC_A)` holds "RCtrl+RShift"; before, it came back as kind "other").

The keycode catalogue and `parse` also stop needing a connected keyboard. The picker must keep working while the keyboard is unplugged, and the keycode tables are those of the last keyboard read, or the defaults before the first. They run under the device lock, because reading a keyboard rebuilds those tables.

**Files:**
- Create: `src/main/python/server/languages.py`, `src/main/python/test/test_languages.py`
- Modify: `src/main/python/server/app.py`, `src/main/python/server/describe.py`, `src/main/python/server/schemas.py`, `src/main/python/test/test_api.py`, `src/main/python/test/test_describe.py`

- [ ] **Step 1: Write the language tests**

Create `src/main/python/test/test_languages.py`:

```python
import pytest

from server import languages
from server.describe import describe, keyboard_language, legend_of

POLISH = "polish-qwerty"
GERMAN = "german-qwertz"


@pytest.fixture(autouse=True)
def loaded_keyboard(corne_keyboard):
    """ The keycode tables are those of a loaded (protocol 6) keyboard """
    return corne_keyboard


def described(code, lang):
    with keyboard_language(languages.overrides(lang)):
        return describe(code)


def legend(main, shifted=None, alt_gr=None):
    return {"main": main, "shifted": shifted, "altGr": alt_gr}


# ---------- the list of languages ----------

def test_default_language_is_english_us_without_overrides():
    first = languages.catalogue()[0]
    assert first == {"id": languages.DEFAULT, "name": "English (US)"}
    assert languages.DEFAULT == "en-us"
    assert languages.overrides(languages.DEFAULT) == {}


def test_every_vial_keyboard_layout_is_offered_once():
    from keymaps import KEYMAPS
    ids = [entry["id"] for entry in languages.catalogue()]
    assert len(ids) == len(set(ids)) == len(KEYMAPS)
    assert {"id": POLISH, "name": "Polish (QWERTY)"} in languages.catalogue()
    assert all(i.isascii() and i == i.lower() and " " not in i for i in ids)


def test_unknown_language_is_an_error():
    with pytest.raises(ValueError, match="unknown keyboard language"):
        languages.overrides("klingon")


# ---------- reading Vial's labels ----------

@pytest.mark.parametrize("label, expected", [
    ("A", legend("A")),
    ("!\n1", legend("1", "!")),  # shifted over unshifted
    ("Caps\nLock", legend("Caps Lock")),  # one label, broken in two lines
    ("Boot-\nloader", legend("Bootloader")),
    ("Mouse\nWheel\nUp", legend("Mouse Wheel Up")),
    ("~ \n` ", legend("`", "~")),  # Polish: trailing spaces only
    ("A\n   ą", legend("A", None, "ą")),  # Polish: AltGr character in the lower right
    ("!  ¹\n1  ¡", legend("1", "!", "¡")),  # Canadian CSA: shifted and unshifted, with and without AltGr
    ("@   \n2  ²", legend("2", "@", "²")),
    ("1\n&", legend("&", "1")),  # French: the shifted character is the digit
    ("AltGr", legend("AltGr")),
    ("", legend("")),
])
def test_legend_of(label, expected):
    assert legend_of(label) == expected


def test_every_language_label_reads_as_a_legend():
    """ Except the few keys a layout leaves blank on purpose (Colemak DH ISO: KC_B) """
    for entry in languages.catalogue():
        for qmk_id, label in languages.overrides(entry["id"]).items():
            result = legend_of(label)
            assert result["main"] or not label.strip(), (entry["id"], qmk_id, label)
            assert all("\n" not in (part or "") for part in result.values()), (entry["id"], qmk_id, label)


# ---------- describing keys in a language ----------

def test_polish_letter_shows_its_alt_gr_character():
    result = described("KC_A", POLISH)
    assert (result["tap"], result["legend"]) == ("A", legend("A", None, "ą"))


def test_polish_alt_gr_with_a_letter_is_the_polish_letter():
    result = described("RALT(KC_A)", POLISH)
    assert (result["kind"], result["tap"], result["legend"]) == ("basic", "ą", legend("ą"))


def test_alt_gr_with_a_key_that_has_no_alt_gr_character_stays_generic():
    assert described("RALT(KC_B)", POLISH)["tap"] == "AltGr+B"


def test_polish_mod_tap_and_layer_tap_keep_the_alt_gr_character():
    assert described("RALT_T(KC_E)", POLISH)["legend"] == legend("E", None, "ę")
    assert described("LT1(KC_L)", POLISH)["legend"]["altGr"] == "ł"


def test_polish_right_alt_is_alt_gr():
    assert described("KC_RALT", POLISH)["tap"] == "AltGr"


def test_german_keys_are_relabelled():
    assert described("KC_Y", GERMAN)["tap"] == "Z"
    assert described("KC_7", GERMAN)["legend"] == legend("7", "/")


def test_german_shifted_key_is_the_german_shifted_character():
    assert described("LSFT(KC_7)", GERMAN)["tap"] == "/"


def test_english_has_no_alt_gr_characters():
    assert describe("KC_A")["legend"] == legend("A")
    assert describe("RALT(KC_A)")["tap"] == "AltGr+A"


def test_language_applies_only_inside_the_block():
    with keyboard_language(languages.overrides(POLISH)):
        assert describe("KC_A")["legend"]["altGr"] == "ą"
    assert describe("KC_A")["legend"]["altGr"] is None
```

- [ ] **Step 2: Update the description tests**

Apply to `src/main/python/test/test_describe.py`:

```diff
diff --git a/src/main/python/test/test_describe.py b/src/main/python/test/test_describe.py
--- a/src/main/python/test/test_describe.py
+++ b/src/main/python/test/test_describe.py
@@ -14,7 +14,8 @@ def loaded_keyboard(corne_keyboard):
     ("KC_NO", "none", "", None, None, None),
     ("KC_TRNS", "transparent", "▽", None, None, None),
     ("KC_A", "basic", "A", None, None, None),
-    ("KC_1", "basic", "!\n1", None, None, None),
+    ("KC_1", "basic", "1", None, None, None),
+    ("KC_CAPSLOCK", "basic", "Caps Lock", None, None, None),
     ("LSFT(KC_1)", "basic", "!", None, None, None),
     ("LCTL(KC_C)", "basic", "Ctrl+C", None, None, None),
     ("LCTL(KC_NO)", "modifier", "Ctrl", None, None, None),
@@ -23,16 +24,17 @@ def loaded_keyboard(corne_keyboard):
     ("LT2(KC_S)", "layer-tap", "S", "layer 2", 2, None),
     ("LSFT_T(KC_T)", "mod-tap", "T", "Shift", None, None),
     ("ALL_T(KC_B)", "mod-tap", "B", "Hyper", None, None),
-    ("MO(1)", "layer", "MO 1", "while held", 1, None),
-    ("OSL(3)", "layer", "OSL 3", "one-shot", 3, None),
+    ("MO(1)", "layer", "MO 1", None, 1, None),
+    ("OSL(3)", "layer", "OSL 3", None, 3, None),
     ("TD(0)", "tap-dance", "TD 0", None, None, 0),
     ("M0", "macro", "M 0", None, None, 0),
-    ("OSM(MOD_LSFT)", "one-shot-mod", "OSM", "LSft", None, None),
+    ("OSM(MOD_LSFT)", "one-shot-mod", "Shift", None, None, None),
+    ("OSM(MOD_RCTL|MOD_RALT)", "one-shot-mod", "RCtrl+AltGr", None, None, None),
     ("KC_LCTRL", "modifier", "LCtrl", None, None, None),
-    ("KC_MS_U", "mouse", "Mouse\nUp", None, None, None),
+    ("KC_MS_U", "mouse", "Mouse Up", None, None, None),
     ("KC_VOLU", "media", "Vol +", None, None, None),
-    ("RGB_TOG", "lighting", "RGB\nToggle", None, None, None),
-    ("QK_BOOT", "other", "Boot-\nloader", None, None, None),
+    ("RGB_TOG", "lighting", "RGB Toggle", None, None, None),
+    ("QK_BOOT", "other", "Bootloader", None, None, None),
 ])
 def test_describe(code, kind, tap, hold, layer, index):
     result = describe(code)
@@ -44,8 +46,107 @@ def test_describe_normalizes_aliases():
     assert describe("KC_ENT")["code"] == "KC_ENTER"
 
 
-def test_describe_includes_tooltip():
-    assert describe("LT2(KC_S)")["tooltip"] == "LT2(kc): kc on tap, switch to layer 2 while held"
+# ---------- legends: what the key cap shows ----------
+
+@pytest.mark.parametrize("code, legend", [
+    ("KC_A", {"main": "A", "shifted": None, "altGr": None}),
+    ("KC_1", {"main": "1", "shifted": "!", "altGr": None}),
+    ("KC_LBRACKET", {"main": "[", "shifted": "{", "altGr": None}),
+    ("KC_CAPSLOCK", {"main": "Caps Lock", "shifted": None, "altGr": None}),
+    ("LT1(KC_SLASH)", {"main": "/", "shifted": "?", "altGr": None}),
+    ("LSFT_T(KC_1)", {"main": "1", "shifted": "!", "altGr": None}),
+    ("LCTL(KC_C)", {"main": "Ctrl+C", "shifted": None, "altGr": None}),
+    ("MO(1)", {"main": "MO 1", "shifted": None, "altGr": None}),
+    ("KC_NO", {"main": "", "shifted": None, "altGr": None}),
+])
+def test_legend(code, legend):
+    assert describe(code)["legend"] == legend
+
+
+def test_labels_have_no_line_breaks():
+    """ Qt's labels break lines for its key widgets ("Caps", "Lock"); the API sends words and lets the UI wrap """
+    from server.model import KEYCODE_CATEGORIES
+    for _, keycodes in KEYCODE_CATEGORIES:
+        for keycode in keycodes:
+            if "(kc)" in keycode.qmk_id:
+                continue
+            result = describe(keycode.qmk_id)
+            assert "\n" not in result["tap"], keycode.qmk_id
+            assert all("\n" not in (part or "") for part in result["legend"].values()), keycode.qmk_id
+
+
+# ---------- descriptions ----------
+
+def test_description_is_the_explanation_only():
+    assert describe("LT2(KC_S)")["description"] == "kc on tap, switch to layer 2 while held"
+    assert describe("KC_GESC")["description"].startswith("Esc normally")
+    assert describe("KC_A")["description"] is None
+
+
+# ---------- layer actions ----------
+
+@pytest.mark.parametrize("code, action", [
+    ("MO(1)", "while held"), ("TG(1)", "toggle"), ("TO(1)", "switch to"), ("TT(1)", "hold, or tap to toggle"),
+    ("OSL(1)", "one-shot"), ("DF(1)", "default"), ("LT1(KC_A)", "while held"), ("KC_A", None), ("TD(0)", None),
+])
+def test_layer_action(code, action):
+    assert describe(code)["layerAction"] == action
+
+
+# ---------- modifiers: every combination the firmware can store ----------
+
+MOD_BITS = [(0x01, "Ctrl"), (0x02, "Shift"), (0x04, "Alt"), (0x08, "Gui")]
+
+
+def expected_mods(bits):
+    """ What the hold label of a mod-tap with these 5 modifier bits should read """
+    if bits == 0x0F:
+        return "Hyper"
+    if bits == 0x07:
+        return "Meh"
+    right = bits & 0x10
+    return "+".join(("AltGr" if name == "Alt" else "R" + name) if right else name
+                    for bit, name in MOD_BITS if bits & bit)
+
+
+ALL_MODS = [bits for bits in range(1, 0x20) if bits & 0x0F]
+
+
+@pytest.mark.parametrize("bits", ALL_MODS)
+def test_every_mod_tap_combination_is_a_mod_tap_with_a_readable_hold(bits):
+    result = describe(Keycode.serialize(0x2000 | (bits << 8) | 0x04))  # protocol 6 QK_MOD_TAP, KC_A
+    assert (result["kind"], result["tap"], result["hold"]) == ("mod-tap", "A", expected_mods(bits))
+
+
+@pytest.mark.parametrize("bits", ALL_MODS)
+def test_every_modifier_combination_with_a_key_is_readable(bits):
+    result = describe(Keycode.serialize((bits << 8) | 0x06))  # protocol 6 QK_MODS, KC_C
+    assert (result["kind"], result["tap"]) == ("basic", "{}+C".format(expected_mods(bits)))
+
+
+def test_right_hand_mod_tap_from_an_expression():
+    result = parse("MT(MOD_RCTL | MOD_RSFT, KC_A)")
+    assert (result["kind"], result["tap"], result["hold"]) == ("mod-tap", "A", "RCtrl+RShift")
+
+
+def test_every_mod_tap_in_the_keycode_tables_reads_well():
+    from keycodes.keycodes import KEYCODES_MODIFIERS
+    mod_taps = [k.qmk_id for k in KEYCODES_MODIFIERS if k.qmk_id.endswith("_T(kc)")]
+    assert len(mod_taps) >= 19
+    for qmk_id in mod_taps:
+        result = describe(qmk_id.replace("(kc)", "(KC_A)"))
+        assert result["kind"] == "mod-tap" and result["tap"] == "A", qmk_id
+        assert "_" not in result["hold"] and result["hold"], qmk_id
+
+
+@pytest.mark.parametrize("protocol, value, kind, hold", [
+    (5, 0x7304, "mod-tap", "RCtrl+RShift"),  # protocol 5 QK_MOD_TAP is 0x6000
+    (5, 0x5512, "one-shot-mod", None),
+])
+def test_mods_in_protocol_5(monkeypatch, protocol, value, kind, hold):
+    monkeypatch.setattr(Keycode, "protocol", protocol)
+    result = describe(Keycode.serialize(value))
+    assert (result["kind"], result["hold"]) == (kind, hold)
 
 
 def test_parse_accepts_expressions_and_numbers():
```

- [ ] **Step 3: Add the API tests**

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -128,6 +128,33 @@ def test_keycodes_and_parse(client):
     assert client.post("/api/keycodes/parse", json={"expression": "NOPE"}).status_code == 422
 
 
+def test_keycode_catalogue_works_without_a_keyboard(setup):
+    client, virtual, app = setup
+    client.put("/api/simulator/connection", json={"connected": False})
+    app.state.manager.check()  # the hot-plug poll notices
+    assert client.get("/api/session").json()["status"] == "disconnected"
+    response = client.get("/api/keycodes")
+    assert response.status_code == 200 and response.json()[0]["name"] == "Basic"
+    assert client.post("/api/keycodes/parse", json={"expression": "LT(1, KC_A)"}).json()["code"] == "LT1(KC_A)"
+
+
+def test_keycode_catalogue_before_any_keyboard_was_connected(tmp_path):
+    app = create_app(DeviceManager(NoRealKeyboard()), NamesStore(str(tmp_path / "n.json")), TOKEN, PORT,
+                     poll_interval=0)
+    with TestClient(app, base_url=BASE) as c:
+        c.get("/?token=" + TOKEN, follow_redirects=False)
+        response = c.get("/api/keycodes")
+        assert response.status_code == 200
+        assert any(k["code"] == "KC_A" for k in response.json()[0]["keycodes"])
+
+
+def test_keycode_catalogue_has_descriptions(client):
+    modifiers = next(c for c in client.get("/api/keycodes").json() if c["name"] == "Modifiers")["keycodes"]
+    gesc = next(k for k in modifiers if k["code"] == "KC_GESC")
+    assert gesc["legend"] == {"main": "Esc", "shifted": "~", "altGr": None}
+    assert gesc["description"].startswith("Esc normally") and "tooltip" not in gesc
+
+
 def test_placeholder_page_when_ui_not_built(client):
     response = client.get("/")
     assert response.status_code == 200 and "Vial server is running" in response.text
@@ -312,3 +339,46 @@ def test_simulator_controls_do_not_exist_for_real_keyboards(tmp_path):
         c.get("/?token=" + TOKEN, follow_redirects=False)
         assert c.put("/api/simulator/connection", json={"connected": False}).status_code in (404, 405)
         assert "/api/simulator/connection" not in c.get("/openapi.json").text
+
+
+# ---------- keyboard languages ----------
+
+POLISH = "polish-qwerty"
+
+
+def key_at(model, layer, row, col):
+    index = next(i for i, k in enumerate(model["keys"]) if (k["row"], k["col"]) == (row, col))
+    return model["layers"][layer]["keys"][index]
+
+
+def test_keyboard_languages_are_listed(client):
+    listed = client.get("/api/keyboard-languages").json()
+    assert listed[0] == {"id": "en-us", "name": "English (US)"}
+    assert {"id": POLISH, "name": "Polish (QWERTY)"} in listed
+
+
+def test_keyboard_is_described_in_the_chosen_language(client):
+    # base layer, right home row: RALT_T(KC_E)
+    english = key_at(client.get("/api/keyboard").json(), 0, 5, 3)
+    polish = key_at(client.get("/api/keyboard", params={"lang": POLISH}).json(), 0, 5, 3)
+    assert (english["tap"], english["legend"]["altGr"]) == ("E", None)
+    assert (polish["code"], polish["tap"], polish["legend"]["altGr"]) == ("RALT_T(KC_E)", "E", "ę")
+
+
+def test_keycode_catalogue_in_the_chosen_language(client):
+    basic = client.get("/api/keycodes", params={"lang": POLISH}).json()[0]["keycodes"]
+    assert next(k for k in basic if k["code"] == "KC_A")["legend"]["altGr"] == "ą"
+
+
+def test_edits_and_parsing_answer_in_the_chosen_language(client):
+    set_key = client.put("/api/keymap/0/0/0", params={"lang": POLISH}, json={"code": "RALT(KC_A)"})
+    assert set_key.json()["tap"] == "ą"
+    parsed = client.post("/api/keycodes/parse", params={"lang": POLISH}, json={"expression": "KC_L"})
+    assert parsed.json()["legend"]["altGr"] == "ł"
+    assert client.post("/api/keycodes/parse", json={"expression": "KC_L"}).json()["legend"]["altGr"] is None
+
+
+def test_unknown_language_is_refused(client, virtual):
+    response = client.put("/api/keymap/0/0/0", params={"lang": "klingon"}, json={"code": "KC_A"})
+    assert response.status_code == 422 and "unknown keyboard language" in response.json()["detail"]
+    assert virtual.keymap[0][0][0] == encode("KC_TAB")
```

- [ ] **Step 4: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_languages.py test/test_describe.py test/test_api.py
```

Expected: `1 error` and `ImportError: cannot import name 'languages' from 'server'`. Collection stops at `test_languages.py`.

- [ ] **Step 5: Create the language list**

Create `src/main/python/server/languages.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Keyboard languages: the layout the computer types with (Polish, German, ...), which changes what a key's label
should say. The labels come from Vial's own keyboard layouts (keymaps.py, keymap/); describe() applies them. """
import re
import unicodedata

from keymaps import KEYMAPS

DEFAULT = "en-us"
DEFAULT_NAME = "English (US)"
""" Vial's first layout ("QWERTY") relabels nothing: keycodes are named after the US layout """


def _slug(name):
    """ "French (BÉPO)" -> "french-bepo" """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


_LANGUAGES = {DEFAULT: (DEFAULT_NAME, KEYMAPS[0][1])}
for _name, _keymap in KEYMAPS[1:]:
    _LANGUAGES[_slug(_name)] = (_name, _keymap)


def catalogue():
    """ [{"id": "polish-qwerty", "name": "Polish (QWERTY)"}, ...], English (US) first """
    return [{"id": lang, "name": name} for lang, (name, _) in _LANGUAGES.items()]


def overrides(lang):
    """ {qmk_id: Vial label} of a keyboard language; raises ValueError for an unknown one """
    if lang not in _LANGUAGES:
        raise ValueError("unknown keyboard language: {}".format(lang))
    return _LANGUAGES[lang][1]
```

- [ ] **Step 6: Rewrite `describe.py`.** The legend, the mod-bit decoding and the language context touch almost every function, so here is the whole file.

Replace the whole of `src/main/python/server/describe.py` with:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Turns a keycode into what the UI shows: its legend (what the key cap says), tap and hold labels, a kind, the
layer, tap dance or macro it refers to, and a description.

All keycode knowledge comes from keycodes/ (and the keyboard languages of keymap/); this module only interprets it.
"""
import contextlib
import contextvars
import re

from keycodes.keycodes import Keycode, RAWCODES_MAP, KEYCODES_MEDIA, KEYCODES_BACKLIGHT

LAYER_ACTIONS = {
    "MO": "while held", "TG": "toggle", "TO": "switch to", "TT": "hold, or tap to toggle",
    "OSL": "one-shot", "DF": "default", "PDF": "default (saved)",
}
MODIFIER_KEYS = {"KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"}
MOUSE_PREFIXES = ("KC_MS_", "KC_BTN", "KC_WH_", "KC_ACL")

RE_TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
RE_MACRO = re.compile(r"^M(\d+)$")
RE_LAYER = re.compile(r"^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$")
RE_LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")
RE_NUMBERED = re.compile(r"^(M\d+|(TD|MO|TG|TO|TT|OSL|DF|PDF)\(\d+\))$")
RE_LEGEND_GAP = re.compile(r"\s{2,}")
MEDIA_CODES = frozenset(k.qmk_id for k in KEYCODES_MEDIA)
LIGHTING_CODES = frozenset(k.qmk_id for k in KEYCODES_BACKLIGHT)

# QMK's 5-bit modifier sets: Ctrl, Shift, Alt, Gui, and a bit saying they are the right-hand ones
MOD_CTRL, MOD_SHIFT, MOD_ALT, MOD_GUI, MOD_RIGHT = 0x01, 0x02, 0x04, 0x08, 0x10
MOD_BITS = [(MOD_CTRL, "Ctrl"), (MOD_SHIFT, "Shift"), (MOD_ALT, "Alt"), (MOD_GUI, "Gui")]
QK_MODS = (0x0100, 0x1FFF)
""" a key with modifiers held, e.g. LCTL(KC_C): modifiers in bits 8-12, the key in bits 0-7 (both protocols) """
QK_MOD_TAP = {6: (0x2000, 0x3FFF), 5: (0x6000, 0x7FFF)}
""" mod-tap: modifiers on hold in bits 8-12, the tapped key in bits 0-7 """
QK_ONE_SHOT_MOD = {6: (0x52A0, 0x52BF), 5: (0x5500, 0x55FF)}
""" one-shot modifiers: modifiers in bits 0-4 """

_overrides = contextvars.ContextVar("keyboard_language_overrides", default={})
""" The keyboard language's labels, {qmk_id: Vial label}, for describe() calls in this context """


@contextlib.contextmanager
def keyboard_language(overrides):
    """ Within the block, describe() labels keys as the computer's keyboard language types them, e.g. with Polish,
    KC_A has the AltGr character "ą". overrides: {qmk_id: Vial label}, from server.languages.overrides(). """
    token = _overrides.set(overrides)
    try:
        yield
    finally:
        _overrides.reset(token)


def _legend(main, shifted=None, alt_gr=None):
    return {"main": main, "shifted": shifted, "altGr": alt_gr}


def _join_words(lines):
    """ ["Caps", "Lock"] -> "Caps Lock"; ["Boot-", "loader"] -> "Bootloader" """
    text = ""
    for line in lines:
        if text.endswith("-") and len(text) > 1:
            text = text[:-1] + line
        else:
            text = "{} {}".format(text, line) if text else line
    return text


def legend_of(label):
    """ A Vial label -> legend {main, shifted, altGr}, all on one line.

    Vial's labels are laid out for its Qt key widgets, in two columns. The left column holds the key's characters:
    a single character over another line is shifted over unshifted ("!" over "1", "~" over "Esc"); anything else is
    one label broken into lines ("Caps" over "Lock"). A keyboard language's label may have a right column, after two or more spaces (or alone on
    an indented line): the AltGr characters, the lower one typed with AltGr alone. """
    left, right = [], []
    for line in label.split("\n"):
        if line.startswith("  "):
            first, second = "", line.strip()
        else:
            parts = RE_LEGEND_GAP.split(line.strip(), maxsplit=1)
            first, second = parts[0], parts[1] if len(parts) > 1 else ""
        left.append(first)
        right.append(second)
    alt_gr = right[-1] or None
    chars = [c for c in left if c]
    if len(left) == 2 and len(chars) == 2 and len(chars[0]) == 1:
        return _legend(chars[1], chars[0], alt_gr)
    return _legend(_join_words(chars), None, alt_gr)


def _keycode_legend(code):
    """ Legend of a keycode (of its outer keycode, if it wraps another one) in the keyboard language """
    keycode = Keycode.find_outer_keycode(code)
    overrides = _overrides.get()
    if keycode is not None and keycode.qmk_id in overrides:
        return legend_of(overrides[keycode.qmk_id])
    return legend_of(Keycode.label(code))


def mods_name(bits):
    """ QMK's 5 modifier bits -> "Ctrl+Shift", "RCtrl+AltGr", "Meh", "Hyper" """
    if bits == MOD_CTRL | MOD_SHIFT | MOD_ALT | MOD_GUI:
        return "Hyper"
    if bits == MOD_CTRL | MOD_SHIFT | MOD_ALT:
        return "Meh"
    right = bits & MOD_RIGHT
    names = [(("AltGr" if name == "Alt" else "R" + name) if right else name)
             for bit, name in MOD_BITS if bits & bit]
    return "+".join(names)


def _in(value, ranges):
    first, last = ranges[Keycode.protocol] if isinstance(ranges, dict) else ranges
    return first <= value <= last


def _description(code):
    keycode = Keycode.find_outer_keycode(code)
    return keycode.tooltip if keycode is not None and keycode.tooltip else None


def _result(code, kind, legend, tap=None, hold=None, layer=None, layer_action=None, index=None):
    return {"code": code, "kind": kind, "tap": legend["main"] if tap is None else tap, "legend": legend,
            "hold": hold, "layer": layer, "layerAction": layer_action, "index": index,
            "description": _description(code)}


def one_line(label):
    """ "!\\n1" (shifted over unshifted) -> "1"; "Caps\\nLock" -> "Caps Lock" """
    lines = [line.strip() for line in label.split("\n") if line.strip()]
    if len(lines) == 2 and all(len(line) == 1 for line in lines):
        return lines[-1]
    return " ".join(lines)


def _with_mods(code, bits, inner_code):
    """ A key with modifiers held, e.g. LCTL(KC_C) """
    inner = _keycode_legend(inner_code)
    if Keycode.find_outer_keycode(inner_code) is not None and Keycode.find_outer_keycode(inner_code).qmk_id \
            in _overrides.get():
        # what the keyboard language types: Shift+7 is "/" in German, AltGr+A is "ą" in Polish
        if bits & ~MOD_RIGHT == MOD_SHIFT and inner["shifted"]:
            return _result(code, "basic", _legend(inner["shifted"]))
        if bits == MOD_RIGHT | MOD_ALT and inner["altGr"]:
            return _result(code, "basic", _legend(inner["altGr"]))
    else:
        # shifted symbols have keycodes of their own, e.g. LSFT(KC_1) is KC_EXLM, "!"
        direct = RAWCODES_MAP.get(Keycode.deserialize(code))
        if direct is not None and not direct.masked:
            return _result(code, "basic", legend_of(direct.label))
    if not inner["main"]:  # e.g. LCTL(KC_NO): just the modifiers
        return _result(code, "modifier", _legend(mods_name(bits)))
    return _result(code, "basic", _legend("{}+{}".format(mods_name(bits), inner["main"])))


def describe(code):
    """ Keycode string (as the protocol layer stores it) -> description dict for the UI """
    code = Keycode.normalize(code)
    value = Keycode.deserialize(code)

    if code == "KC_NO":
        return _result(code, "none", _legend(""))
    if code == "KC_TRNS":
        return _result(code, "transparent", _legend("▽"))

    m = RE_TAP_DANCE.match(code)
    if m:
        return _result(code, "tap-dance", _legend("TD {}".format(m.group(1))), index=int(m.group(1)))
    m = RE_MACRO.match(code)
    if m:
        return _result(code, "macro", _legend("M {}".format(m.group(1))), index=int(m.group(1)))
    m = RE_LAYER.match(code)
    if m:
        layer = int(m.group(2))
        return _result(code, "layer", _legend("{} {}".format(m.group(1), layer)), layer=layer,
                       layer_action=LAYER_ACTIONS[m.group(1)])
    m = RE_LAYER_TAP.match(code)
    if m:
        layer = int(m.group(1))
        return _result(code, "layer-tap", _keycode_legend(m.group(2)), hold="layer {}".format(layer), layer=layer,
                       layer_action=LAYER_ACTIONS["MO"])

    if _in(value, QK_MOD_TAP):
        return _result(code, "mod-tap", _keycode_legend(Keycode.serialize(value & 0xFF)),
                       hold=mods_name((value >> 8) & 0x1F))
    if _in(value, QK_ONE_SHOT_MOD):
        return _result(code, "one-shot-mod", _legend(mods_name(value & 0x1F)))
    if _in(value, QK_MODS):
        return _with_mods(code, (value >> 8) & 0x1F, Keycode.serialize(value & 0xFF))

    if code in MODIFIER_KEYS:
        return _result(code, "modifier", _keycode_legend(code))
    if code.startswith(MOUSE_PREFIXES):
        return _result(code, "mouse", _keycode_legend(code))
    if code in MEDIA_CODES:
        return _result(code, "media", _keycode_legend(code))
    if code in LIGHTING_CODES:
        return _result(code, "lighting", _keycode_legend(code))
    if Keycode.find(code) is not None and Keycode.is_basic(code):
        return _result(code, "basic", _keycode_legend(code))
    return _result(code, "other", _keycode_legend(code))


def parse_value(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> firmware integer; raises ValueError """
    expression = expression.strip()
    if RE_NUMBERED.match(expression):
        # numbered keycodes the keyboard doesn't have aren't in the keycode tables; the firmware's own tables give
        # their real value (the generic parser gets some wrong, e.g. TO(n), or doesn't know them, e.g. M20, PDF(n))
        try:
            value = Keycode.resolve(expression)
        except RuntimeError as e:
            raise ValueError("not a valid keycode: {}".format(expression)) from e
    else:
        try:
            value = Keycode.deserialize(expression, reraise=True)
        except Exception as e:
            raise ValueError("not a valid keycode: {}".format(e)) from e
    if isinstance(value, bool):  # an int to Python, but "True" isn't a keycode
        raise ValueError("not a valid keycode: {}".format(expression))
    if not isinstance(value, int) or not 0 <= value <= 0xFFFF:
        raise ValueError("keycode must be a number between 0 and 0xFFFF")
    return value


def parse(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> description; raises ValueError """
    return describe(Keycode.serialize(parse_value(expression)))


# (first, last, what, number) for keycodes that point at a layer, tap dance or macro; number(value) -> its number
_REFERENCES_V6 = [
    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
    (0x5000, 0x51FF, "layer", lambda v: (v >> 5) & 0xF),  # LM
    (0x5200, 0x529F, "layer", lambda v: v & 0x1F),  # TO, MO, DF, TG, OSL
    (0x52C0, 0x52FF, "layer", lambda v: v & 0x1F),  # TT, PDF
    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
    (0x7700, 0x77FF, "macro", lambda v: v & 0xFF),
    (0x7C77, 0x7C78, "layer", lambda v: 3),  # FN_MO13, FN_MO23
]
_REFERENCES_V5 = [
    (0x4000, 0x4FFF, "layer", lambda v: (v >> 8) & 0xF),  # LT
    (0x5000, 0x50FF, "layer", lambda v: v & 0xF),  # TO
    (0x5100, 0x54FF, "layer", lambda v: v & 0xFF),  # MO, DF, TG, OSL
    (0x5700, 0x57FF, "tap dance", lambda v: v & 0xFF),
    (0x5800, 0x58FF, "layer", lambda v: v & 0xFF),  # TT
    (0x5900, 0x59FF, "layer", lambda v: (v >> 4) & 0xF),  # LM
    (0x5F10, 0x5F11, "layer", lambda v: 3),  # FN_MO13, FN_MO23
    (0x5F12, 0x5F7F, "macro", lambda v: v - 0x5F12),
]


def reference(value):
    """ Firmware keycode -> ("layer" | "tap dance" | "macro", number) it points at, or None """
    for first, last, what, number in (_REFERENCES_V6 if Keycode.protocol == 6 else _REFERENCES_V5):
        if first <= value <= last:
            return what, number(value)
    return None
```

- [ ] **Step 7: The new shapes**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -7,14 +7,39 @@ from pydantic import BaseModel, ConfigDict, Field
 # ---------- responses ----------
 
 
+KeyKind = Literal["basic", "modifier", "mod-tap", "layer-tap", "layer", "one-shot-mod", "tap-dance", "macro",
+                  "transparent", "none", "mouse", "media", "lighting", "other"]
+
+
+LayerAction = Literal["while held", "toggle", "switch to", "hold, or tap to toggle", "one-shot", "default",
+                      "default (saved)"]
+
+
+class Legend(BaseModel):
+    """ What a key cap shows, each on one line """
+    main: str
+    shifted: Optional[str] = None
+    """ the character typed with Shift, when the key cap shows it (e.g. "!" on the 1 key) """
+    altGr: Optional[str] = None
+    """ the character typed with AltGr in the chosen keyboard language, e.g. "ą" on Polish A """
+
+
 class Described(BaseModel):
+    """ A keycode as the UI shows it """
     code: str
-    kind: str
+    kind: KeyKind
     tap: str
+    """ what a tap does, in a few words, e.g. "1", "Caps Lock", "Ctrl+C", "TD 0" """
+    legend: Legend
     hold: Optional[str] = None
+    """ what holding does, when it differs from a tap: "Shift" (mod-tap), "layer 2" (layer-tap) """
     layer: Optional[int] = None
+    layerAction: Optional[LayerAction] = None
+    """ for keys that use a layer: what they do with it """
     index: Optional[int] = None
-    tooltip: Optional[str] = None
+    """ the tap dance or macro a key runs """
+    description: Optional[str] = None
+    """ what the keycode does, when its name doesn't say it all """
 
 
 class KeyGeometry(BaseModel):
@@ -174,6 +199,11 @@ class Session(BaseModel):
     error: Optional[str] = None
 
 
+class KeyboardLanguage(BaseModel):
+    id: str
+    name: str
+
+
 class Names(BaseModel):
     layers: dict[str, str]
     tapDance: dict[str, str]
```

- [ ] **Step 8: `?lang=` on the routes, the language list, and keycodes without a keyboard**

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -5,14 +5,15 @@ import contextlib
 import logging
 import os
 import secrets
+from typing import Annotated
 
-from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
+from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
 from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
 from fastapi.staticfiles import StaticFiles
 
 from protocol.qmk_settings_codec import QmkSettingsCodec
-from server import edits, model, schemas
-from server.describe import parse
+from server import edits, languages, model, schemas
+from server.describe import keyboard_language, parse
 from server.device import NotConnected, KeyboardLocked
 
 log = logging.getLogger(__name__)
@@ -47,6 +48,9 @@ NEED_TOKEN_PAGE = """<!doctype html>
 </body></html>"""
 
 
+Lang = Annotated[str, Query(description="keyboard language the keys are labelled in, from /api/keyboard-languages")]
+
+
 def cookie_name(port):
     """ The session cookie's name. Cookies don't keep ports apart, so two servers on 127.0.0.1 would overwrite each
     other's cookie under one name. """
@@ -216,8 +220,16 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         log.error("unexpected error in %s %s", request.method, request.url.path, exc_info=exc)
         return JSONResponse({"detail": "unexpected error, see vial.log"}, status_code=500, headers=SECURITY_HEADERS)
 
-    def run(fn):
-        return manager.run(fn)
+    def run(fn, lang=languages.DEFAULT):
+        """ fn(keyboard) under the device lock; keycodes it describes are labelled in the keyboard language lang """
+        with keyboard_language(languages.overrides(lang)):
+            return manager.run(fn)
+
+    def offline(fn, lang=languages.DEFAULT):
+        """ fn() for what needs no keyboard (the keycode tables are those of the last keyboard read, or the
+        defaults before the first): under the device lock, as a keyboard being read rebuilds those tables """
+        with manager.lock, keyboard_language(languages.overrides(lang)):
+            return fn()
 
     async def resync():
         """ After a write failed halfway: read the keyboard again and tell the UI to do the same """
@@ -245,60 +257,67 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         return schemas.Session(status="connected" if status.connected else "disconnected",
                                fake=manager.backend.fake, device=status.title, error=status.error)
 
+    @app.get("/api/keyboard-languages", response_model=list[schemas.KeyboardLanguage])
+    def keyboard_languages():
+        return languages.catalogue()
+
     @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
-    def keyboard():
-        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))
+    def keyboard(lang: Lang = languages.DEFAULT):
+        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)
 
     @app.post("/api/reload", response_model=schemas.KeyboardModel)
-    async def reload():
+    async def reload(lang: Lang = languages.DEFAULT):
+        languages.overrides(lang)  # an unknown language is refused before reading the keyboard
+
         def reload_and_build():
             with manager.lock:  # one hold of the lock: the reply shows exactly what was read
                 manager.reload()
-                return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))
+                return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)
         # device access waits for the device lock: keep it off the event loop
         result = await asyncio.to_thread(reload_and_build)
         await hub.broadcast({"type": "reloaded"})
         return result
 
     @app.put("/api/keymap/{layer}/{row}/{col}", response_model=schemas.Described)
-    def set_key(layer: int, row: int, col: int, body: schemas.SetKeycode):
-        return run(lambda kb: edits.set_key(kb, layer, row, col, body.code))
+    def set_key(layer: int, row: int, col: int, body: schemas.SetKeycode, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_key(kb, layer, row, col, body.code), lang)
 
     @app.put("/api/encoders/{layer}/{index}/{direction}", response_model=schemas.Described)
-    def set_encoder(layer: int, index: int, direction: int, body: schemas.SetKeycode):
-        return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code))
+    def set_encoder(layer: int, index: int, direction: int, body: schemas.SetKeycode,
+                    lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code), lang)
 
     @app.put("/api/layout-options")
     def set_layout_options(body: schemas.SetLayoutOptions):
         return {"value": run(lambda kb: edits.set_layout_options(kb, body.value))}
 
     @app.get("/api/keycodes")
-    def keycodes():
-        return run(lambda kb: model.keycode_catalogue())
+    def keycodes(lang: Lang = languages.DEFAULT):
+        return offline(model.keycode_catalogue, lang)
 
     @app.post("/api/keycodes/parse", response_model=schemas.Described)
-    def parse_keycode(body: schemas.ParseRequest):
-        return run(lambda kb: schemas.Described(**parse(body.expression)))
+    def parse_keycode(body: schemas.ParseRequest, lang: Lang = languages.DEFAULT):
+        return offline(lambda: schemas.Described(**parse(body.expression)), lang)
 
     @app.put("/api/tap-dance/{index}", response_model=schemas.TapDance)
-    def set_tap_dance(index: int, body: schemas.TapDanceIn):
-        return run(lambda kb: edits.set_tap_dance(kb, index, body, names_for(kb)))
+    def set_tap_dance(index: int, body: schemas.TapDanceIn, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_tap_dance(kb, index, body, names_for(kb)), lang)
 
     @app.put("/api/combos/{index}", response_model=schemas.Combo)
-    def set_combo(index: int, body: schemas.ComboIn):
-        return run(lambda kb: edits.set_combo(kb, index, body))
+    def set_combo(index: int, body: schemas.ComboIn, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_combo(kb, index, body), lang)
 
     @app.put("/api/key-overrides/{index}", response_model=schemas.KeyOverride)
-    def set_key_override(index: int, body: schemas.KeyOverrideIn):
-        return run(lambda kb: edits.set_key_override(kb, index, body))
+    def set_key_override(index: int, body: schemas.KeyOverrideIn, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_key_override(kb, index, body), lang)
 
     @app.put("/api/alt-repeat/{index}", response_model=schemas.AltRepeatKey)
-    def set_alt_repeat_key(index: int, body: schemas.AltRepeatKeyIn):
-        return run(lambda kb: edits.set_alt_repeat_key(kb, index, body))
+    def set_alt_repeat_key(index: int, body: schemas.AltRepeatKeyIn, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_alt_repeat_key(kb, index, body), lang)
 
     @app.put("/api/macros", response_model=schemas.Macros)
-    def set_macros(body: schemas.MacrosIn):
-        return run(lambda kb: edits.set_macros(kb, body, names_for(kb)))
+    def set_macros(body: schemas.MacrosIn, lang: Lang = languages.DEFAULT):
+        return run(lambda kb: edits.set_macros(kb, body, names_for(kb)), lang)
 
     @app.get("/api/qmk-settings/definitions")
     def setting_definitions():
@@ -351,7 +370,8 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
         return bytes(data)
 
     @app.post("/api/layout-file", response_model=schemas.KeyboardModel)
-    async def upload_layout(request: Request):
+    async def upload_layout(request: Request, lang: Lang = languages.DEFAULT):
+        languages.overrides(lang)  # an unknown language is refused before anything is written
         data = await read_limited(request, MAX_LAYOUT_FILE)
         writing = []
 
@@ -362,7 +382,7 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
             return model.build(kb, names_for(kb), manager.unlocked)
 
         try:
-            result = await asyncio.to_thread(run, restore)
+            result = await asyncio.to_thread(run, restore, lang)
         except Exception:
             if writing:
                 # part of the file may have been written: re-read the keyboard and make the UI do the same
```

- [ ] **Step 9: Run the tests again, then the full suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_languages.py test/test_describe.py test/test_api.py
```

Expected: `208 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `548 passed, 1 skipped`.

- [ ] **Step 10: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/describe.py \
  src/main/python/server/languages.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_describe.py \
  src/main/python/test/test_languages.py
git commit -m "feat(server): keyboard languages (?lang=) and clean key descriptions with a structured legend"
```

### Task 4: A complete, typed OpenAPI schema and `dump_openapi`

The web UI's TypeScript types are generated from the server's OpenAPI schema, so every reply the UI reads needs a declared shape.
- **Keycode catalogue:** `GET /api/keycodes` answers `KeycodeCategory[]`. Each keycode is a `CatalogueKeycode`: a `Described` plus its `aliases` (`KC_ESC` for `KC_ESCAPE`), which the picker's search uses.
- **Names:** `PUT /api/names/{kind}/{index}` answers `Named`: the name to show, which is the default name when the user's name was cleared. Before, it answered the raw names store. `kind` is a `Literal`, so an unknown kind is a 422 from validation.
- **Layout options:** `PUT /api/layout-options` answers `LayoutOptionsValue`, and `LayoutOptions.labels` is typed (`str | list[str]`).
- **Events:** WebSocket messages have no place in OpenAPI's paths, so the `/api/events` message shape (`Event`) is added to the schema's components.
- **Placeholder page:** `/` (shown when `web/dist` is missing) is left out of the schema.

`python -m server.dump_openapi OUT.json` builds the app around a simulated keyboard that is never connected, and writes the schema. It needs no server, device, Qt or hidapi. Its output is byte-for-byte stable, with LF line endings.

**Files:**
- Create: `src/main/python/server/dump_openapi.py`, `src/main/python/test/test_dump_openapi.py`
- Modify: `src/main/python/server/app.py`, `src/main/python/server/model.py`, `src/main/python/server/schemas.py`, `src/main/python/test/test_api.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_dump_openapi.py`:

```python
import json

from test.test_core_isolation import run_isolated


def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
    out = tmp_path / "openapi.json"
    result = run_isolated("import sys, server.dump_openapi\n"
                          "sys.exit(server.dump_openapi.main([{!r}]))".format(str(out)))
    assert result.returncode == 0, result.stderr
    schema = json.loads(out.read_text(encoding="utf-8"))
    assert schema["info"]["title"] == "Vial"
    assert "/api/keyboard" in schema["paths"] and "/api/keyboard-languages" in schema["paths"]
    assert "KeyboardModel" in schema["components"]["schemas"]
    keycodes = schema["paths"]["/api/keycodes"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert keycodes == {"type": "array", "items": {"$ref": "#/components/schemas/KeycodeCategory"},
                        "title": "Response Keycodes Api Keycodes Get"}
    assert "/api/simulator/connection" not in schema["paths"]  # a test aid of fake mode, not part of the API
    assert "/" not in schema["paths"]  # the page, not the API
    # what /api/events sends (WebSockets have no place in OpenAPI's paths)
    event = schema["components"]["schemas"]["Event"]
    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded"}
    options = schema["paths"]["/api/layout-options"]["put"]["responses"]["200"]["content"]["application/json"]
    assert options["schema"] == {"$ref": "#/components/schemas/LayoutOptionsValue"}
    named = schema["paths"]["/api/names/{kind}/{index}"]["put"]["responses"]["200"]["content"]["application/json"]
    assert named["schema"] == {"$ref": "#/components/schemas/Named"}
    described = schema["components"]["schemas"]["Described"]["properties"]
    assert "legend" in described and "description" in described and "layerAction" in described
    assert "tooltip" not in described and "altGr" not in described
    described = schema["components"]["schemas"]["Described"]["properties"]
    assert set(described["kind"]["enum"]) == {
        "basic", "modifier", "mod-tap", "layer-tap", "layer", "one-shot-mod", "tap-dance", "macro", "transparent",
        "none", "mouse", "media", "lighting", "other"}
    labels = schema["components"]["schemas"]["LayoutOptions"]["properties"]["labels"]
    assert labels["items"] == {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]}


def test_dump_openapi_is_stable(tmp_path):
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    for out in (first, second):
        result = run_isolated("import sys, server.dump_openapi\n"
                              "sys.exit(server.dump_openapi.main([{!r}]))".format(str(out)))
        assert result.returncode == 0, result.stderr
    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes().endswith(b"}\n") and b"\r\n" not in first.read_bytes()
```

Apply to `src/main/python/test/test_api.py`:

```diff
diff --git a/src/main/python/test/test_api.py b/src/main/python/test/test_api.py
--- a/src/main/python/test/test_api.py
+++ b/src/main/python/test/test_api.py
@@ -155,6 +155,13 @@ def test_keycode_catalogue_has_descriptions(client):
     assert gesc["description"].startswith("Esc normally") and "tooltip" not in gesc
 
 
+def test_keycode_catalogue_lists_aliases_for_search(client):
+    basic = client.get("/api/keycodes").json()[0]["keycodes"]
+    esc = next(k for k in basic if k["code"] == "KC_ESCAPE")
+    assert (esc["tap"], esc["aliases"]) == ("Esc", ["KC_ESC"])
+    assert next(k for k in basic if k["code"] == "KC_A")["aliases"] == []
+
+
 def test_placeholder_page_when_ui_not_built(client):
     response = client.get("/")
     assert response.status_code == 200 and "Vial server is running" in response.text
@@ -170,6 +177,18 @@ def test_placeholder_page_keeps_an_events_connection_open(client):
 
 # ---------- writing ----------
 
+def test_layout_options_answer_with_the_value_set(tmp_path):
+    definition = {"name": "Options", "matrix": {"rows": 1, "cols": 2},
+                  "layouts": {"labels": ["Split"], "keymap": [["0,0", "0,1\n\n\n0,0"]]}}
+    from simulator.virtual_keyboard import VirtualKeyboard
+    manager = DeviceManager(FakeBackend(lambda: VirtualKeyboard(definition)))
+    manager.connect()
+    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
+    with TestClient(app, base_url=BASE) as c:
+        c.get("/?token=" + TOKEN, follow_redirects=False)
+        assert c.put("/api/layout-options", json={"value": 1}).json() == {"value": 1}
+
+
 def test_set_key_writes_to_keyboard(client, virtual):
     response = client.put("/api/keymap/0/0/0", json={"code": "LCTL(KC_A)"})
     assert response.status_code == 200
@@ -243,11 +262,28 @@ def test_settings_and_lighting(client, virtual):
 
 
 def test_names(client):
-    assert client.put("/api/names/layers/1", json={"name": "symbols"}).json()["layers"] == {"1": "symbols"}
+    named = client.put("/api/names/layers/1", json={"name": "symbols"}).json()
+    assert named == {"kind": "layers", "index": 1, "name": "symbols", "customName": True}
+    assert client.get("/api/names").json()["layers"] == {"1": "symbols"}
     assert client.get("/api/keyboard").json()["layers"][1]["name"] == "symbols"
     assert client.put("/api/names/combos/1", json={"name": "x"}).status_code == 422
 
 
+def test_cleared_name_answers_with_the_name_shown_instead(client):
+    client.put("/api/names/layers/0", json={"name": "letters"})
+    cleared = client.put("/api/names/layers/0", json={"name": ""}).json()
+    assert cleared == {"kind": "layers", "index": 0, "name": "Base", "customName": False}
+    assert client.put("/api/names/layers/3", json={"name": None}).json()["name"] == "Layer 3"
+
+
+def test_tap_dance_and_macro_names_answer_with_the_suggested_name(client):
+    suggested = client.put("/api/names/tapDance/0", json={"name": ""}).json()
+    assert suggested == {"kind": "tapDance", "index": 0, "name": "Tab / Caps Lock", "customName": False}
+    custom = client.put("/api/names/macros/0", json={"name": "status"}).json()
+    assert custom == {"kind": "macros", "index": 0, "name": "status", "customName": True}
+    assert client.put("/api/names/macros/0", json={"name": ""}).json()["name"] == "git status"
+
+
 def test_layout_file_round_trip(client, virtual):
     original = client.get("/api/layout-file").content
     assert client.post("/api/layout-file", content=original).status_code == 200
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api.py test/test_dump_openapi.py
```

Expected: `6 failed, 37 passed`.

- [ ] **Step 3: The shapes**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -1,6 +1,6 @@
 # SPDX-License-Identifier: GPL-2.0-or-later
 """ Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
-from typing import Annotated, Literal, Optional
+from typing import Annotated, Literal, Optional, Union
 
 from pydantic import BaseModel, ConfigDict, Field
 
@@ -165,9 +165,27 @@ class Lighting(BaseModel):
     backlight: Optional[Backlight] = None
 
 
+class LayoutOptionsValue(BaseModel):
+    value: int
+
+
+class Named(BaseModel):
+    """ The name a layer, tap dance or macro is shown with: the user's, or the one given when it has none """
+    kind: Literal["layers", "tapDance", "macros"]
+    index: int
+    name: str
+    customName: bool
+
+
+class Event(BaseModel):
+    """ What /api/events sends: the keyboard was plugged in, unplugged, or read again """
+    type: Literal["connected", "disconnected", "reloaded"]
+
+
 class LayoutOptions(BaseModel):
     value: int
-    labels: list
+    labels: list[Union[str, list[str]]]
+    """ one entry per option, as in vial.json: a name (an on/off option), or [name, choice 0, choice 1, ...] """
 
 
 class KeyboardModel(BaseModel):
@@ -199,6 +217,19 @@ class Session(BaseModel):
     error: Optional[str] = None
 
 
+class CatalogueKeycode(Described):
+    aliases: list[str] = []
+    """ other names of the keycode, e.g. KC_ESC for KC_ESCAPE """
+
+
+class KeycodeCategory(BaseModel):
+    """ A group of the keycode picker """
+    name: str
+    keycodes: list[CatalogueKeycode]
+    templates: list[str]
+    """ keycodes that wrap another one, e.g. "LT1(kc)" or "LSFT(kc)" """
+
+
 class KeyboardLanguage(BaseModel):
     id: str
     name: str
```

- [ ] **Step 4: Display names and the catalogue with aliases**

Apply to `src/main/python/server/model.py`:

```diff
diff --git a/src/main/python/server/model.py b/src/main/python/server/model.py
--- a/src/main/python/server/model.py
+++ b/src/main/python/server/model.py
@@ -43,6 +43,19 @@ def layer_name(names, index):
     return (custom, True) if custom else (("Base" if index == 0 else "Layer {}".format(index)), False)
 
 
+def display_name(kb, names, kind, index):
+    """ The name a layer, tap dance or macro is shown with -> schemas.Named """
+    if kind == "layers":
+        name, custom = layer_name(names, index)
+    elif kind == "tapDance":
+        entry = tap_dance(index, kb.tap_dance_entries[index], names)
+        name, custom = entry.name, entry.customName
+    else:
+        entry = macros(kb, names).items[index]
+        name, custom = entry.name, entry.customName
+    return schemas.Named(kind=kind, index=index, name=name, customName=custom)
+
+
 def tap_dance(index, entry, names):
     tap, hold, double_tap, tap_hold, term = entry
     slots = [d(tap), d(hold), d(double_tap), d(tap_hold)]
@@ -148,11 +161,16 @@ def uid_of(kb):
     return "{:016X}".format(kb.keyboard_id & 0xFFFFFFFFFFFFFFFF)
 
 
+def catalogue_keycode(keycode):
+    described = describe(keycode.qmk_id)
+    return schemas.CatalogueKeycode(**described, aliases=[a for a in keycode.alias if a != described["code"]])
+
+
 def keycode_catalogue():
     """ Keycodes the picker offers, grouped; hidden (unsupported) keycodes are left out """
     out = []
     for name, keycodes in KEYCODE_CATEGORIES:
-        items = [d(kc.qmk_id) for kc in keycodes if not kc.hidden and "(kc)" not in kc.qmk_id]
+        items = [catalogue_keycode(kc) for kc in keycodes if not kc.hidden and "(kc)" not in kc.qmk_id]
         masks = [kc.qmk_id for kc in keycodes if not kc.hidden and "(kc)" in kc.qmk_id]
         if items or masks:
             out.append({"name": name, "keycodes": items, "templates": masks})
```

- [ ] **Step 5: Typed routes and the `Event` component**

Apply to `src/main/python/server/app.py`:

```diff
diff --git a/src/main/python/server/app.py b/src/main/python/server/app.py
--- a/src/main/python/server/app.py
+++ b/src/main/python/server/app.py
@@ -5,9 +5,10 @@ import contextlib
 import logging
 import os
 import secrets
-from typing import Annotated
+from typing import Annotated, Literal
 
 from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
+from fastapi.openapi.utils import get_openapi
 from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
 from fastapi.staticfiles import StaticFiles
 
@@ -163,6 +164,17 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     app.state.hub = hub
     app.state.manager = manager
 
+    def openapi():
+        # WebSocket messages have no place in OpenAPI's paths: the event shape is added as a component, so the UI's
+        # types are generated for it too
+        if app.openapi_schema is None:
+            schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
+            components = schema.setdefault("components", {}).setdefault("schemas", {})
+            components["Event"] = schemas.Event.model_json_schema(ref_template="#/components/schemas/{model}")
+            app.openapi_schema = schema
+        return app.openapi_schema
+    app.openapi = openapi
+
     def token_ok(value):
         # as bytes: compare_digest refuses str with non-ASCII characters
         return value is not None and secrets.compare_digest(value.encode("utf-8", "replace"), token.encode("utf-8"))
@@ -287,11 +299,11 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
                     lang: Lang = languages.DEFAULT):
         return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code), lang)
 
-    @app.put("/api/layout-options")
+    @app.put("/api/layout-options", response_model=schemas.LayoutOptionsValue)
     def set_layout_options(body: schemas.SetLayoutOptions):
-        return {"value": run(lambda kb: edits.set_layout_options(kb, body.value))}
+        return schemas.LayoutOptionsValue(value=run(lambda kb: edits.set_layout_options(kb, body.value)))
 
-    @app.get("/api/keycodes")
+    @app.get("/api/keycodes", response_model=list[schemas.KeycodeCategory])
     def keycodes(lang: Lang = languages.DEFAULT):
         return offline(model.keycode_catalogue, lang)
 
@@ -343,12 +355,14 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     def get_names():
         return run(lambda kb: names_for(kb))
 
-    @app.put("/api/names/{kind}/{index}", response_model=schemas.Names)
-    def set_name(kind: str, index: int, body: schemas.NameIn):
+    @app.put("/api/names/{kind}/{index}", response_model=schemas.Named)
+    def set_name(kind: Literal["layers", "tapDance", "macros"], index: int, body: schemas.NameIn,
+                 lang: Lang = languages.DEFAULT):
         def do(kb):
             edits.check_name(kb, kind, index)
-            return names.set(model.uid_of(kb), kind, index, body.name)
-        return run(do)
+            stored = names.set(model.uid_of(kb), kind, index, body.name)
+            return model.display_name(kb, stored, kind, index)
+        return run(do, lang)
 
     @app.get("/api/layout-file")
     def download_layout():
@@ -419,7 +433,7 @@ def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone
     if static_dir and os.path.isdir(static_dir):
         app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
     else:
-        @app.get("/", response_class=HTMLResponse)
+        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
         def placeholder():
             return PLACEHOLDER_PAGE
 
```

- [ ] **Step 6: The schema dumper**

Create `src/main/python/server/dump_openapi.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Writes the API's OpenAPI schema, which the web UI's TypeScript types are generated from.

    python -m server.dump_openapi OUT.json     (from src/main/python)

Builds the app around a simulated keyboard that is never connected: no server, no device, no files but OUT.json.
"""
import json
import os
import sys

from server.app import create_app
from server.device import DeviceManager, FakeBackend
from server.names import NamesStore
from simulator.corne import make_corne


def schema():
    app = create_app(DeviceManager(FakeBackend(make_corne)), NamesStore(os.devnull), token="unused", port=0,
                     poll_interval=0)
    return app.openapi()


def main(argv):
    if len(argv) != 1:
        print("usage: python -m server.dump_openapi OUT.json", file=sys.stderr)
        return 2
    with open(argv[0], "w", encoding="utf-8", newline="\n") as outf:
        json.dump(schema(), outf, indent=2, ensure_ascii=False)
        outf.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 7: Run the tests again, then the full suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_api.py test/test_dump_openapi.py
```

Expected: `43 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `554 passed, 1 skipped`. This is the backend's final count for the phase.

- [ ] **Step 8: Commit**

```bash
git add src/main/python/server/app.py \
  src/main/python/server/dump_openapi.py \
  src/main/python/server/model.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_api.py \
  src/main/python/test/test_dump_openapi.py
git commit -m "feat(server): typed replies for the UI and a schema dump without a server"
```

### Task 5: Web project scaffold and generated API types

A plain Svelte 5 + TypeScript + Vite project, without SvelteKit: the server serves a single page from `web/dist`.
- `svelte.config.js` turns on runes mode for every component, so Svelte 4 syntax is a compile error.
- `npm run dev` is `vite build --watch`, and Vial serves the result. Vite's dev server can't be used: the server only answers its own origin and wants its session cookie.
- `scripts/gen-api.mjs` runs `python -m server.dump_openapi` with the repository's Python, then `openapi-typescript`, and writes `src/api/schema.d.ts`. With `--check`, it fails when the committed file differs.
- `index.html` applies a saved theme choice before the first paint. Task 10 adds the theme code that saves it.
- `src/app.css` holds the colour tokens for the light and the dark palette.
- `App.svelte` is a placeholder for now. Task 14 replaces it.

`package.json` lists every package that phase 2 needs, at exact versions, so the lock file is created once, here.

**Files:**
- Create: `web/.gitignore`, `web/.npmrc`, `web/index.html`, `web/package-lock.json` (generated), `web/package.json`, `web/scripts/gen-api.mjs`, `web/scripts/python.mjs`, `web/src/App.svelte`, `web/src/api/schema.d.ts` (generated), `web/src/app.css`, `web/src/main.ts`, `web/svelte.config.js`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`

- [ ] **Step 1: Package files**

Create `web/.npmrc`:

```ini
save-exact=true
engine-strict=true
```

Create `web/.gitignore`:

```gitignore
node_modules/
dist/
test-results/
playwright-report/
e2e/screenshots/
```

Create `web/package.json`:

```json
{
  "name": "vial-web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "check": "svelte-check --tsconfig ./tsconfig.json --fail-on-warnings && tsc -p tsconfig.node.json",
    "test": "vitest run",
    "e2e": "vite build && playwright test",
    "gen:api": "node scripts/gen-api.mjs",
    "check:api": "node scripts/gen-api.mjs --check"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0-alpha-2026-08-05",
    "@sveltejs/vite-plugin-svelte": "7.3.1",
    "@tsconfig/svelte": "5.0.8",
    "@types/node": "24.19.0",
    "openapi-typescript": "7.13.0",
    "svelte": "5.57.1",
    "svelte-check": "4.7.6",
    "typescript": "5.9.3",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

- [ ] **Step 2: Install.** This creates `web/package-lock.json`.

```bash
cd web && npm install
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 3: TypeScript, Vite and Svelte configuration**

Create `web/tsconfig.json`:

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"],
    "types": ["svelte", "vite/client"],
    "noEmit": true,
    "allowJs": true,
    "checkJs": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "src/**/*.js"]
}
```

Create `web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2023", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "allowJs": true,
    "checkJs": true
  },
  "include": ["vite.config.ts", "svelte.config.js", "playwright.config.ts", "e2e/**/*.ts", "scripts/**/*.mjs"]
}
```

Create `web/vite.config.ts`:

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

Create `web/svelte.config.js`:

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  // runes only: Svelte 4 syntax (export let, $:, on:click, slots) is a compile error
  compilerOptions: { runes: true },
};
```

- [ ] **Step 4: The page, the entry point, the styles and a placeholder app**

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Vial</title>
    <script>
      // the theme chosen in the top bar (src/lib/theme.ts), applied before the first paint: no flash of the other one
      try {
        var theme = localStorage.getItem("vial.theme");
        if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `web/src/main.ts`:

```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("index.html has no #app element");

export default mount(App, { target });
```

Create `web/src/app.css`:

```css
/* Colour tokens and base styles. Components keep their own styles; they only use these tokens.
   Two palettes: light (here) and dark. The dark one applies with data-theme="dark" on <html> (chosen in the top bar),
   or when the system prefers dark and the user hasn't chosen light. CSS can't share one block between a selector and
   a media query, so the dark palette is written twice, identically. */
:root {
  color-scheme: light;
  --bg: #f3f4f7;
  --surface: #ffffff;
  --surface-2: #eef0f4;
  --board-bg: #f8f9fb;
  --border: #dfe2e9;
  --border-strong: #c3c9d4;
  --text: #191f2d;
  --text-2: #535c6e;
  --text-3: #858d9d;
  --accent: #2b63f0;
  --accent-weak: #e5edff;
  --accent-text: #ffffff;
  --danger: #c92a2a;
  --danger-weak: #fdecec;
  --danger-line: #f1b5b5;
  --ok: #1a8f4c;
  --warning-weak: #fff4dc;
  --warning-text: #6d4300;
  --badge: #8a3cc2;

  --key-bg: #ffffff;
  --key-border: #cfd5df;
  --key-shadow: #bfc6d2;
  --key-text: #191f2d;
  --key-dashed: #aab2bf;
  --tone-mod: #23a049;
  --tone-layer: #1872e8;
  --tone-tap-dance: #9a43cf;
  --tone-macro: #e07f00;
  /* how much of a kind's colour goes into a key's face and outline */
  --tone-fill: 15%;
  --tone-line: 62%;
  --tone-text: 60%;

  /* layout: the navigation plus a content column of at most 1100 px, centred on wide screens */
  --nav-width: 190px;
  --content-max: 1100px;
  --shell-gap: 28px;
  --shell-gutter: 24px;
  --shell-width: calc(var(--nav-width) + var(--shell-gap) + var(--content-max) + 2 * var(--shell-gutter));

  --shadow: 0 1px 2px rgb(16 24 40 / 6%), 0 1px 3px rgb(16 24 40 / 8%);
  --shadow-lg: 0 12px 32px rgb(16 24 40 / 18%);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101217;
  --surface: #191c23;
  --surface-2: #222630;
  --board-bg: #15181e;
  --border: #2b303b;
  --border-strong: #3e4553;
  --text: #e8ebf1;
  --text-2: #a6aebd;
  --text-3: #7a8292;
  --accent: #6a96ff;
  --accent-weak: #1f2d4d;
  --accent-text: #0b1020;
  --danger: #ff7a7a;
  --danger-weak: #341c20;
  --danger-line: #6e2f35;
  --ok: #45d483;
  --warning-weak: #362b14;
  --warning-text: #ffd47e;
  --badge: #d29bf5;

  --key-bg: #272b35;
  --key-border: #3c4250;
  --key-shadow: #08090c;
  --key-text: #f0f2f6;
  --key-dashed: #5d6575;
  --tone-mod: #44d070;
  --tone-layer: #5ba2ff;
  --tone-tap-dance: #c98af2;
  --tone-macro: #ffaa3d;
  --tone-fill: 22%;
  --tone-line: 70%;
  --tone-text: 80%;

  --shadow: 0 1px 2px rgb(0 0 0 / 45%);
  --shadow-lg: 0 16px 40px rgb(0 0 0 / 55%);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #101217;
    --surface: #191c23;
    --surface-2: #222630;
    --board-bg: #15181e;
    --border: #2b303b;
    --border-strong: #3e4553;
    --text: #e8ebf1;
    --text-2: #a6aebd;
    --text-3: #7a8292;
    --accent: #6a96ff;
    --accent-weak: #1f2d4d;
    --accent-text: #0b1020;
    --danger: #ff7a7a;
    --danger-weak: #341c20;
    --danger-line: #6e2f35;
    --ok: #45d483;
    --warning-weak: #362b14;
    --warning-text: #ffd47e;
    --badge: #d29bf5;

    --key-bg: #272b35;
    --key-border: #3c4250;
    --key-shadow: #08090c;
    --key-text: #f0f2f6;
    --key-dashed: #5d6575;
    --tone-mod: #44d070;
    --tone-layer: #5ba2ff;
    --tone-tap-dance: #c98af2;
    --tone-macro: #ffaa3d;
    --tone-fill: 22%;
    --tone-line: 70%;
    --tone-text: 80%;

    --shadow: 0 1px 2px rgb(0 0 0 / 45%);
    --shadow-lg: 0 16px 40px rgb(0 0 0 / 55%);
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 var(--font);
  -webkit-font-smoothing: antialiased;
}

button,
input,
select {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

code {
  font-family: var(--mono);
  font-size: 0.92em;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Key colours by kind (see keyboard/labels.ts toneOf): any element with data-tone gets --tone (the kind's colour),
   --fill and --line (its key face and outline) */
[data-tone] {
  --tone: var(--key-border);
  --fill: var(--key-bg);
  --line: var(--key-border);
}

[data-tone="mod"] {
  --tone: var(--tone-mod);
}

[data-tone="layer"] {
  --tone: var(--tone-layer);
}

[data-tone="tap-dance"] {
  --tone: var(--tone-tap-dance);
}

[data-tone="macro"] {
  --tone: var(--tone-macro);
}

[data-tone="transparent"] {
  --line: var(--key-dashed);
}

[data-tone="mod"],
[data-tone="layer"],
[data-tone="tap-dance"],
[data-tone="macro"] {
  --fill: color-mix(in srgb, var(--tone) var(--tone-fill), var(--key-bg));
  --line: color-mix(in srgb, var(--tone) var(--tone-line), var(--key-bg));
}
```

Create `web/src/App.svelte`:

```svelte
<main>
  <h1>Vial</h1>
  <p>The keymap editor is on its way.</p>
</main>
```

- [ ] **Step 5: The API type generator**

Create `web/scripts/python.mjs`:

```js
// The Python that runs Vial's server code: $VIAL_PYTHON, else the repository's virtual environment.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const pythonRoot = join(repoRoot, "src", "main", "python");

export function findPython() {
  if (process.env.VIAL_PYTHON) return process.env.VIAL_PYTHON;
  const candidates = [".venv", "venv"].flatMap((dir) => [
    join(repoRoot, dir, "Scripts", "python.exe"),
    join(repoRoot, dir, "bin", "python"),
  ]);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      "no Python found: create the repository's .venv (see README) or set VIAL_PYTHON",
    );
  }
  return found;
}
```

Create `web/scripts/gen-api.mjs`:

```js
// Generates src/api/schema.d.ts from the server's OpenAPI schema.
//   node scripts/gen-api.mjs           write it
//   node scripts/gen-api.mjs --check   fail if the committed file is out of date
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { findPython, pythonRoot } from "./python.mjs";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "api", "schema.d.ts");
const banner =
  "// Generated by `npm run gen:api` from the server's OpenAPI schema. Do not edit.\n\n";

async function generate() {
  const dir = mkdtempSync(join(tmpdir(), "vial-openapi-"));
  try {
    const file = join(dir, "openapi.json");
    execFileSync(findPython(), ["-m", "server.dump_openapi", file], {
      cwd: pythonRoot,
      stdio: "inherit",
    });
    const schema = JSON.parse(readFileSync(file, "utf8"));
    return banner + astToString(await openapiTS(schema));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const generated = await generate();
if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // missing: out of date
  }
  if (committed !== generated) {
    console.error("src/api/schema.d.ts is out of date: run `npm run gen:api` and commit it");
    process.exit(1);
  }
  console.log("src/api/schema.d.ts is up to date");
} else {
  writeFileSync(target, generated);
  console.log("wrote src/api/schema.d.ts");
}
```

- [ ] **Step 6: See the check fail** (there are no generated types yet)

```bash
cd web && npm run check:api
```

Expected: `src/api/schema.d.ts is out of date: run`.

- [ ] **Step 7: Generate the types, and check them.** The generator writes into `web/src/api/`, which doesn't exist yet.

```bash
mkdir -p web/src/api && cd web && npm run gen:api && npm run check:api
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date`.

- [ ] **Step 8: Type-check and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run build
```

Expected: `built in`.

This writes `web/dist`, which is ignored by git.

- [ ] **Step 9: Commit**

```bash
git add web/.gitignore \
  web/.npmrc \
  web/index.html \
  web/package-lock.json \
  web/package.json \
  web/scripts/gen-api.mjs \
  web/scripts/python.mjs \
  web/src/App.svelte \
  web/src/api/schema.d.ts \
  web/src/app.css \
  web/src/main.ts \
  web/svelte.config.js \
  web/tsconfig.json \
  web/tsconfig.node.json \
  web/vite.config.ts
git commit -m "feat(web): Svelte 5 + TypeScript + Vite project with generated API types"
```

### Task 6: API client, error messages and events

- `types.ts` gives the generated schema's shapes short names. `ServerEvent` is the `Event` component's `type`.
- `client.ts` has one `request()`. Its path, path parameters, body and reply are all checked against the generated `paths`. It adds `?lang=` when a keyboard language other than `en-us` is chosen.
- `errors.ts` turns an HTTP status into a message for the user: 401, 422, 423, 500, 502, 503, and 0 for "can't reach Vial". `failureMessage()` names the action and the cause: "Changing the key failed: The keyboard didn't respond."
- `events.ts` keeps the `/api/events` WebSocket open. It reconnects with a backoff from 0.5 s to 5 s.
- `api.ts` lists the routes the UI uses.

**Files:**
- Create: `web/src/api/api.ts`, `web/src/api/client.ts`, `web/src/api/errors.test.ts`, `web/src/api/errors.ts`, `web/src/api/events.ts`, `web/src/api/types.ts`

- [ ] **Step 1: The type names**

Create `web/src/api/types.ts`:

```ts
// Names for the API's shapes, generated from the server's OpenAPI schema (schema.d.ts)
import type { components } from "./schema";

type Schemas = components["schemas"];

export type KeyboardModel = Schemas["KeyboardModel"];
export type KeyGeometry = Schemas["KeyGeometry"];
export type Layer = Schemas["Layer"];
export type Described = Schemas["Described"];
export type KeyKind = Described["kind"];
export type LayoutOptions = Schemas["LayoutOptions"];
export type KeycodeCategory = Schemas["KeycodeCategory"];
export type CatalogueKeycode = Schemas["CatalogueKeycode"];
export type KeyboardLanguage = Schemas["KeyboardLanguage"];
export type Session = Schemas["Session"];
export type Names = Schemas["Names"];
export type TapDance = Schemas["TapDance"];
export type TapDanceIn = Schemas["TapDanceIn"];
export type Legend = Schemas["Legend"];
export type Named = Schemas["Named"];
/** what /api/events sends */
export type ServerEvent = Schemas["Event"]["type"];
```

- [ ] **Step 2: Write the failing test**

Create `web/src/api/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, failureMessage } from "./errors";

describe("errorMessage", () => {
  it.each([
    [503, "no keyboard connected", "The keyboard isn't connected."],
    [423, "locked", "This change needs the keyboard unlocked; unlocking isn't supported yet."],
    [422, "not a valid keycode: FOO", "not a valid keycode: FOO"],
    [502, "the keyboard didn't respond: timeout", "The keyboard didn't respond."],
    [500, "unexpected error, see vial.log", "Unexpected error, see vial.log."],
    [401, "missing or wrong session token",
      "This page's session has ended. Open Vial again from the link in its terminal."],
    [0, undefined, "Can't reach Vial. Is it still running?"],
  ])("%i: %s", (status, detail, message) => {
    expect(errorMessage(status, detail)).toBe(message);
  });

  it("shows the server's detail for other refusals", () => {
    expect(errorMessage(413, "the file is too large (at most 1024 KiB)"))
      .toBe("the file is too large (at most 1024 KiB)");
    expect(errorMessage(404)).toBe("The request failed (HTTP 404).");
  });

  it("does not show an empty 422 detail", () => {
    expect(errorMessage(422, "")).toBe("The keyboard can't take this change.");
  });
});

describe("failureMessage", () => {
  it("names the action and the cause", () => {
    expect(failureMessage("Changing the key", new ApiError(502, "x")))
      .toBe("Changing the key failed: The keyboard didn't respond.");
  });

  it("handles errors that aren't from the API", () => {
    expect(failureMessage("Loading", new TypeError("Failed to fetch")))
      .toBe("Loading failed: Can't reach Vial. Is it still running?");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```bash
cd web && npx vitest run src/api/errors.test.ts
```

Expected: `Cannot find module './errors'` and `Test Files  1 failed (1)`.

- [ ] **Step 4: Implement the messages**

Create `web/src/api/errors.ts`:

```ts
// What a failed request means for the user.

/** A request the server answered with an error, or (status 0) that didn't reach it */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, detail?: string) {
    super(errorMessage(status, detail));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function errorMessage(status: number, detail?: string): string {
  switch (status) {
    case 0:
      return "Can't reach Vial. Is it still running?";
    case 401:
      return "This page's session has ended. Open Vial again from the link in its terminal.";
    case 423:
      return "This change needs the keyboard unlocked; unlocking isn't supported yet.";
    case 422:
      return detail || "The keyboard can't take this change.";
    case 500:
      return "Unexpected error, see vial.log.";
    case 502:
      return "The keyboard didn't respond.";
    case 503:
      return "The keyboard isn't connected.";
    default:
      return detail || `The request failed (HTTP ${status}).`;
  }
}

/** "Changing the key failed: The keyboard didn't respond." */
export function failureMessage(action: string, error: unknown): string {
  const cause = error instanceof ApiError ? error.message : errorMessage(0);
  return `${action} failed: ${cause}`;
}
```

- [ ] **Step 5: Run the test again**

```bash
cd web && npx vitest run src/api/errors.test.ts
```

Expected: `Tests  11 passed (11)`.

- [ ] **Step 6: The client, the events and the routes**

Create `web/src/api/client.ts`:

```ts
// Typed requests to the Vial server. Paths, bodies and replies are checked against the generated schema.
import { ApiError } from "./errors";
import type { paths } from "./schema";

type Method = "get" | "put" | "post";
type Operation<P extends keyof paths, M extends Method> = paths[P][M];
type Json<T> = T extends { content: { "application/json": infer R } } ? R : never;
type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R> : never;
type Body<Op> = Op extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;
type PathParams<Op> = Op extends { parameters: { path: infer P } } ? P : undefined;

export const DEFAULT_LANGUAGE = "en-us";
let language = DEFAULT_LANGUAGE;

/** Keyboard language that every request asks the server to label keys in (routes that don't label keys ignore it) */
export function setRequestLanguage(lang: string): void {
  language = lang;
}

function url(path: string, params: Record<string, string | number> | undefined): string {
  const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(String(params?.[name])));
  return language === DEFAULT_LANGUAGE ? filled : `${filled}?lang=${encodeURIComponent(language)}`;
}

/** The server's reason: a string, or FastAPI's list of validation errors */
function detailOf(body: unknown): string | undefined {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e as { msg?: string }).msg).filter(Boolean).join("; ") || undefined;
  }
  return undefined;
}

export async function request<P extends keyof paths, M extends Method>(
  method: M,
  path: P,
  options: { params?: PathParams<Operation<P, M>>; body?: Body<Operation<P, M>> } = {},
): Promise<Reply<Operation<P, M>>> {
  let response: Response;
  try {
    response = await fetch(url(path, options.params as Record<string, string | number> | undefined), {
      method: method.toUpperCase(),
      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(body));
  return body as Reply<Operation<P, M>>;
}
```

Create `web/src/api/events.ts`:

```ts
// Live events from the server: the keyboard was plugged in, unplugged, or read again.
import type { ServerEvent } from "./types";

export type { ServerEvent };
export type LinkState = "connecting" | "open" | "closed";

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;

const EVENTS: Record<ServerEvent, true> = { connected: true, disconnected: true, reloaded: true };

function isServerEvent(type: unknown): type is ServerEvent {
  return typeof type === "string" && type in EVENTS;
}

/** Keeps a WebSocket to /api/events open, reconnecting when it drops. Returns a function that closes it for good. */
export function connectEvents(
  onEvent: (event: ServerEvent) => void,
  onLink: (state: LinkState) => void,
): () => void {
  let socket: WebSocket | null = null;
  let retry = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function open() {
    onLink("connecting");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${scheme}//${location.host}/api/events`);
    socket.onopen = () => {
      retry = RETRY_FIRST_MS;
      onLink("open");
    };
    socket.onmessage = (message) => {
      const type = (JSON.parse(String(message.data)) as { type?: string }).type;
      if (isServerEvent(type)) onEvent(type);
    };
    socket.onclose = () => {
      socket = null;
      if (stopped) return;
      onLink("closed");
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    };
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
```

Create `web/src/api/api.ts`:

```ts
// The server's routes the UI uses.
import { request } from "./client";
import type { TapDanceIn } from "./types";

export const api = {
  session: () => request("get", "/api/session"),
  keyboard: () => request("get", "/api/keyboard"),
  keycodes: () => request("get", "/api/keycodes"),
  languages: () => request("get", "/api/keyboard-languages"),
  parse: (expression: string) => request("post", "/api/keycodes/parse", { body: { expression } }),
  setKey: (layer: number, row: number, col: number, code: string) =>
    request("put", "/api/keymap/{layer}/{row}/{col}", { params: { layer, row, col }, body: { code } }),
  setEncoder: (layer: number, index: number, direction: number, code: string) =>
    request("put", "/api/encoders/{layer}/{index}/{direction}", { params: { layer, index, direction }, body: { code } }),
  setTapDance: (index: number, body: TapDanceIn) =>
    request("put", "/api/tap-dance/{index}", { params: { index }, body }),
  setLayerName: (index: number, name: string) =>
    request("put", "/api/names/{kind}/{index}", { params: { kind: "layers", index }, body: { name } }),
};
```

- [ ] **Step 7: Type-check**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 8: Commit**

```bash
git add web/src/api/api.ts \
  web/src/api/client.ts \
  web/src/api/errors.test.ts \
  web/src/api/errors.ts \
  web/src/api/events.ts \
  web/src/api/types.ts
git commit -m "feat(web): typed API client, error messages and live events"
```

### Task 7: Keyboard geometry

`placeKeyboard()` turns the server's `KeyGeometry` list into placed keys, in key units (1 = one standard key). It handles:
- rotation around `rx`/`ry`;
- secondary rectangles (ISO Enter);
- decals, which are skipped;
- layout options: of the keys that belong to a layout option, only the chosen choice's are drawn, moved to where that option's first choice sits, as Vial does.

It also moves the board to 0,0 and computes its bounding box with rotation included.
- `layoutChoices()` unpacks the chosen choice of each option from Vial's packed value.
- `encoderKnobs()` joins an encoder's counter-clockwise and clockwise keys into one knob.

**Files:**
- Create: `web/src/keyboard/geometry.test.ts`, `web/src/keyboard/geometry.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/keyboard/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KeyGeometry, KeyboardModel } from "../api/types";
import { encoderKnobs, layoutChoices, placeKeyboard } from "./geometry";

function key(fields: Partial<KeyGeometry>): KeyGeometry {
  return {
    row: 0, col: 0, encoder: null, direction: null,
    x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0,
    layoutIndex: -1, layoutOption: -1, decal: false,
    ...fields,
  };
}

function board(keys: KeyGeometry[], encoders: KeyGeometry[] = [],
  layoutOptions: KeyboardModel["layoutOptions"] = null) {
  return { keys, encoders, layoutOptions };
}

const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6);

describe("layoutChoices", () => {
  it("is empty without layout options", () => {
    expect(layoutChoices(null)).toEqual([]);
  });

  it("reads on/off options as one bit and lists as enough bits for their choices, first option highest", () => {
    // "Split Backspace" (1 bit) then "Bottom row" with 4 choices (2 bits)
    const labels = ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL", "HHKB"]];
    expect(layoutChoices({ value: (1 << 2) | 2, labels })).toEqual([1, 2]);
    expect(layoutChoices({ value: 3, labels })).toEqual([0, 3]);
  });

  it("gives a list with one choice no bits", () => {
    expect(layoutChoices({ value: 1, labels: [["Only", "one"], "Flag"] })).toEqual([0, 1]);
  });

  it("handles 32-bit values", () => {
    const labels = Array.from({ length: 32 }, (_, i) => `option ${i}`);
    expect(layoutChoices({ value: 0xffffffff, labels })).toEqual(Array(32).fill(1));
  });
});

describe("placeKeyboard", () => {
  it("places keys in keyboard units, starting at 0,0", () => {
    const placed = placeKeyboard(board([key({ x: 1, y: 2 }), key({ x: 2, y: 2, col: 1, w: 2 })]));
    expect(placed.items.map((k) => [k.x, k.y, k.w, k.h])).toEqual([[0, 0, 1, 1], [1, 0, 2, 1]]);
    expect([placed.width, placed.height]).toEqual([3, 1]);
    expect(placed.items.map((k) => [k.kind, k.index])).toEqual([["key", 0], ["key", 1]]);
  });

  it("leaves out decal keys but keeps the index of the others", () => {
    const placed = placeKeyboard(board([key({ decal: true, x: 5 }), key({ x: 1, row: 1 })]));
    expect(placed.items.map((k) => k.index)).toEqual([1]);
    expect(placed.width).toBe(1);
  });

  it("rotates keys around their rotation origin, clockwise like KLE", () => {
    const placed = placeKeyboard(board([key({ r: 90, rx: 0, ry: 0 })]));
    const [item] = placed.items;
    // the key swings to the left of the origin: everything moves right by one unit
    expect([item.x, item.y, item.rx, item.ry, item.r]).toEqual([1, 0, 1, 0, 90]);
    close(placed.width, 1);
    close(placed.height, 1);
    close(item.cx, 0.5);
    close(item.cy, 0.5);
  });

  it("includes the second rectangle of an ISO Enter in the size", () => {
    const iso = key({ x: 0.25, y: 0, w: 1.25, h: 2, x2: -0.25, y2: 0, w2: 1.5, h2: 1 });
    const placed = placeKeyboard(board([iso]));
    const [item] = placed.items;
    expect([item.x, item.x2, item.w2, item.hasSecond]).toEqual([0.25, -0.25, 1.5, true]);
    expect([placed.width, placed.height]).toEqual([1.5, 2]);
  });

  it("shows only the chosen layout option, moved to where the first choice sits", () => {
    const keys = [
      key({ x: 0, y: 0 }),
      key({ x: 1, y: 0, col: 1, layoutIndex: 0, layoutOption: 0, w: 2 }),
      key({ x: 1, y: 2, col: 2, layoutIndex: 0, layoutOption: 1 }),
      key({ x: 2, y: 2, col: 3, layoutIndex: 0, layoutOption: 1 }),
    ];
    const first = placeKeyboard(board(keys, [], { value: 0, labels: ["Split"] }));
    expect(first.items.map((k) => k.index)).toEqual([0, 1]);
    const second = placeKeyboard(board(keys, [], { value: 1, labels: ["Split"] }));
    expect(second.items.map((k) => [k.index, k.x, k.y])).toEqual([[0, 0, 0], [2, 1, 0], [3, 2, 0]]);
    expect([second.width, second.height]).toEqual([3, 1]);
  });

  it("shows every option's first choice when the keyboard reports no layout options", () => {
    const keys = [key({ layoutIndex: 0, layoutOption: 0 }), key({ col: 1, layoutIndex: 0, layoutOption: 1 })];
    expect(placeKeyboard(board(keys)).items.map((k) => k.index)).toEqual([0]);
  });

  it("places encoders after the keys, as encoders", () => {
    const encoders = [
      key({ row: null, col: null, encoder: 0, direction: 0, x: 3 }),
      key({ row: null, col: null, encoder: 0, direction: 1, x: 4 }),
    ];
    const placed = placeKeyboard(board([key({})], encoders));
    expect(placed.items.map((k) => [k.kind, k.index, k.x])).toEqual([["key", 0, 0], ["encoder", 0, 3], ["encoder", 1, 4]]);
    expect(placed.width).toBe(5);
  });

  it("has no size without keys", () => {
    expect(placeKeyboard(board([]))).toEqual({ items: [], width: 0, height: 0 });
  });
});

describe("encoderKnobs", () => {
  const enc = (encoder: number, direction: number, fields: Partial<KeyGeometry>) =>
    key({ row: null, col: null, encoder, direction, ...fields });

  it("joins the two directions of an encoder into one knob", () => {
    const placed = placeKeyboard(board([], [enc(0, 0, { x: 0 }), enc(0, 1, { x: 1 })]));
    expect(encoderKnobs(placed)).toEqual([{ encoder: 0, cx: 1, cy: 0.5, length: 2, thickness: 1, angle: 0 }]);
  });

  it("follows the rotation of the encoder", () => {
    const placed = placeKeyboard(board([], [enc(0, 0, { x: 0, r: 90 }), enc(0, 1, { x: 1, r: 90 })]));
    const [knob] = encoderKnobs(placed);
    expect(knob.angle).toBeCloseTo(90, 6);
    expect(knob.length).toBeCloseTo(2, 6);
  });

  it("gives an encoder with one direction a round knob", () => {
    const placed = placeKeyboard(board([], [enc(3, 1, { x: 0 })]));
    expect(encoderKnobs(placed)).toEqual([{ encoder: 3, cx: 0.5, cy: 0.5, length: 1, thickness: 1, angle: 0 }]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/keyboard/geometry.test.ts
```

Expected: `Cannot find module './geometry'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Create `web/src/keyboard/geometry.ts`:

```ts
// Where each key of a keyboard goes, in keyboard units (1 = one standard key), from the geometry the server sends.
import type { KeyGeometry, KeyboardModel, LayoutOptions } from "../api/types";

export interface PlacedKey {
  kind: "key" | "encoder";
  /** index into KeyboardModel.keys or .encoders (and so into each layer's keys or encoders) */
  index: number;
  geometry: KeyGeometry;
  /** primary rectangle, after layout options and moving the board to 0,0 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** second rectangle (ISO Enter, stepped keys), relative to x and y */
  x2: number;
  y2: number;
  w2: number;
  h2: number;
  hasSecond: boolean;
  /** rotation in degrees, clockwise, around (rx, ry) */
  r: number;
  rx: number;
  ry: number;
  /** centre of the primary rectangle as drawn (rotated) */
  cx: number;
  cy: number;
}

export interface Placement {
  items: PlacedKey[];
  width: number;
  height: number;
}

type Board = Pick<KeyboardModel, "keys" | "encoders" | "layoutOptions">;

/** The chosen choice of each layout option. Vial packs them into one number, the first option in the highest bits:
 * an on/off option takes one bit, a list of choices as many bits as its highest choice needs. */
export function layoutChoices(options: LayoutOptions | null | undefined): number[] {
  if (!options) return [];
  let value = options.value;
  const choices: number[] = [];
  for (const label of [...options.labels].reverse()) {
    const count = typeof label === "string" ? 2 : label.length - 1;
    const bits = count > 1 ? (count - 1).toString(2).length : 0; // Python: (count - 1).bit_length()
    const size = 2 ** bits;
    choices.unshift(value % size);
    value = Math.floor(value / size);
  }
  return choices;
}

function rotate(x: number, y: number, r: number, rx: number, ry: number): [number, number] {
  if (!r) return [x, y];
  const a = (r * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = x - rx;
  const dy = y - ry;
  return [rx + dx * cos - dy * sin, ry + dx * sin + dy * cos];
}

function hasSecond(k: KeyGeometry): boolean {
  return k.w2 !== k.w || k.h2 !== k.h || k.x2 !== 0 || k.y2 !== 0;
}

/** Corners of both rectangles of a key, rotated, moved by (dx, dy) */
function corners(k: KeyGeometry, dx = 0, dy = 0): [number, number][] {
  const rects = [[k.x, k.y, k.w, k.h]];
  if (hasSecond(k)) rects.push([k.x + k.x2, k.y + k.y2, k.w2, k.h2]);
  return rects.flatMap(([x, y, w, h]) =>
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) =>
      rotate(px + dx, py + dy, k.r, k.rx + dx, k.ry + dy)));
}

function topLeft(points: [number, number][]): [number, number] {
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
}

interface Candidate {
  kind: PlacedKey["kind"];
  index: number;
  geometry: KeyGeometry;
}

/** The keys (and encoders) to draw: no decals; of keys that belong to a layout option, only the chosen choice's,
 * moved to where that option's first choice sits, as Vial does. The board starts at 0,0. */
export function placeKeyboard(board: Board): Placement {
  const all: Candidate[] = [
    ...board.keys.map((geometry, index) => ({ kind: "key" as const, index, geometry })),
    ...board.encoders.map((geometry, index) => ({ kind: "encoder" as const, index, geometry })),
  ];
  const choices = layoutChoices(board.layoutOptions);

  // top-left corner of every choice of every layout option
  const optionTopLeft = new Map<string, [number, number]>();
  for (const { geometry: g } of all) {
    if (g.layoutIndex === -1) continue;
    const id = `${g.layoutIndex},${g.layoutOption}`;
    const [x, y] = topLeft(corners(g));
    const seen = optionTopLeft.get(id);
    optionTopLeft.set(id, seen ? [Math.min(seen[0], x), Math.min(seen[1], y)] : [x, y]);
  }

  const visible = all
    .filter(({ geometry: g }) => !g.decal)
    .filter(({ geometry: g }) => g.layoutIndex === -1 || g.layoutOption === (choices[g.layoutIndex] ?? 0))
    .map((candidate) => {
      const g = candidate.geometry;
      let dx = 0;
      let dy = 0;
      if (g.layoutIndex !== -1) {
        const own = optionTopLeft.get(`${g.layoutIndex},${g.layoutOption}`);
        const first = optionTopLeft.get(`${g.layoutIndex},0`) ?? own;
        if (own && first) {
          dx = first[0] - own[0];
          dy = first[1] - own[1];
        }
      }
      return { ...candidate, dx, dy };
    });
  if (visible.length === 0) return { items: [], width: 0, height: 0 };

  const points = visible.flatMap(({ geometry, dx, dy }) => corners(geometry, dx, dy));
  const [minX, minY] = topLeft(points);
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));

  const items = visible.map(({ kind, index, geometry: g, dx, dy }) => {
    const x = g.x + dx - minX;
    const y = g.y + dy - minY;
    const rx = g.rx + dx - minX;
    const ry = g.ry + dy - minY;
    const [cx, cy] = rotate(x + g.w / 2, y + g.h / 2, g.r, rx, ry);
    return {
      kind, index, geometry: g, x, y, w: g.w, h: g.h,
      x2: g.x2, y2: g.y2, w2: g.w2, h2: g.h2, hasSecond: hasSecond(g),
      r: g.r, rx, ry, cx, cy,
    };
  });
  return { items, width: maxX - minX, height: maxY - minY };
}

export interface Knob {
  encoder: number;
  /** centre, in key units */
  cx: number;
  cy: number;
  /** a pill from one direction's key to the other's, turned by angle degrees */
  length: number;
  thickness: number;
  angle: number;
}

/** The knob behind each encoder: a pill joining its counter-clockwise and clockwise keys */
export function encoderKnobs(placement: Placement): Knob[] {
  const byEncoder = new Map<number, PlacedKey[]>();
  for (const item of placement.items) {
    if (item.kind !== "encoder") continue;
    const id = item.geometry.encoder ?? 0;
    byEncoder.set(id, [...(byEncoder.get(id) ?? []), item]);
  }
  return [...byEncoder.entries()].map(([encoder, items]) => {
    const [a, b] = [...items].sort((p, q) => (p.geometry.direction ?? 0) - (q.geometry.direction ?? 0));
    const thickness = Math.min(a.w, a.h);
    if (!b) return { encoder, cx: a.cx, cy: a.cy, length: thickness, thickness, angle: 0 };
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    return {
      encoder,
      cx: (a.cx + b.cx) / 2,
      cy: (a.cy + b.cy) / 2,
      length: Math.hypot(dx, dy) + thickness,
      thickness,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  });
}
```

- [ ] **Step 4: Run the test again, then type-check**

```bash
cd web && npx vitest run src/keyboard/geometry.test.ts
```

Expected: `Tests  15 passed (15)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keyboard/geometry.test.ts \
  web/src/keyboard/geometry.ts
git commit -m "feat(web): place keys and encoders from the keyboard geometry"
```

### Task 8: Key labels and key references

`labels.ts` decides what a key shows:
- `keyFace()`: the big main legend (the tap action), the small shifted and AltGr characters, a small label at the bottom, and a colour family (`toneOf`). The bottom label is a mod-tap's modifiers, the layer's name for layer keys, the tap dance's or macro's name, or "one-shot".
- `legendSizes()` and `legendScale()` shrink long legends so they always fit on the key. A two-line name makes the main legend smaller to leave room.
- `keyTitle()` and `actionSummary()` put the key into words for the Inspector and screen readers: "S — hold for Layer 2", "Toggle Layer 1 · Symbols".

`refs.ts` points at a key or encoder direction (`KeyRef`):
- `actionAt()`: what it does on a layer;
- `whereIs()` and `positionLine()`: where it is, in words.

**Files:**
- Create: `web/src/keyboard/labels.test.ts`, `web/src/keyboard/labels.ts`, `web/src/keyboard/refs.test.ts`, `web/src/keyboard/refs.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/keyboard/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Described } from "../api/types";
import { actionSummary, holdSize, keyFace, keyTitle, legendScale, legendSizes, toneOf, type Names } from "./labels";

type Fields = Partial<Described> & Pick<Described, "code" | "kind" | "tap">;

function d(fields: Fields): Described {
  return {
    hold: null, layer: null, layerAction: null, index: null, description: null,
    legend: { main: fields.tap, shifted: null, altGr: null },
    ...fields,
  };
}

const names: Names = {
  layer: (i) => ["Base", "Symbols", "Layer 2"][i] ?? `Layer ${i}`,
  layerIsNamed: (i) => i === 1,
  tapDance: (i) => (i === 0 ? "Tab / Caps Lock" : ""),
  macro: (i) => (i === 0 ? "git status" : ""),
};

const layerTap = d({ code: "LT1(KC_SPACE)", kind: "layer-tap", tap: "Space", hold: "layer 1", layer: 1, layerAction: "while held" });
const modTap = d({ code: "LSFT_T(KC_T)", kind: "mod-tap", tap: "T", hold: "Shift" });

describe("toneOf", () => {
  it.each([
    ["basic", "normal"], ["mod-tap", "mod"], ["modifier", "mod"], ["one-shot-mod", "mod"],
    ["layer", "layer"], ["layer-tap", "layer"], ["tap-dance", "tap-dance"], ["macro", "macro"],
    ["transparent", "transparent"], ["none", "none"], ["media", "normal"], ["other", "normal"],
  ] as const)("%s keys are %s", (kind, tone) => {
    expect(toneOf(kind)).toBe(tone);
  });
});

describe("keyFace", () => {
  it("shows the legend big and nothing small for a plain key", () => {
    const one = d({ code: "KC_1", kind: "basic", tap: "1", legend: { main: "1", shifted: "!", altGr: null } });
    expect(keyFace(one, names)).toEqual({ main: "1", shifted: "!", altGr: null, hold: null, tone: "normal" });
  });

  it("names the layer a layer-tap key holds", () => {
    const face = keyFace(layerTap, names);
    expect([face.main, face.hold, face.tone]).toEqual(["Space", "Symbols", "layer"]);
  });

  it("names the layer of a layer key", () => {
    const face = keyFace(d({ code: "OSL(2)", kind: "layer", tap: "OSL 2", layer: 2, layerAction: "one-shot" }), names);
    expect([face.main, face.hold]).toEqual(["OSL 2", "Layer 2"]);
  });

  it("shows the modifiers of a mod-tap key, and marks one-shot modifiers", () => {
    expect(keyFace(modTap, names).hold).toBe("Shift");
    expect(keyFace(d({ code: "OSM(MOD_LSFT)", kind: "one-shot-mod", tap: "Shift" }), names).hold).toBe("one-shot");
  });

  it("names tap dances and macros, when they have a name", () => {
    expect(keyFace(d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 }), names).hold).toBe("Tab / Caps Lock");
    expect(keyFace(d({ code: "TD(1)", kind: "tap-dance", tap: "TD 1", index: 1 }), names).hold).toBeNull();
    expect(keyFace(d({ code: "M0", kind: "macro", tap: "M 0", index: 0 }), names).hold).toBe("git status");
  });

  it("keeps the AltGr character of the keyboard language", () => {
    const a = d({ code: "KC_A", kind: "basic", tap: "A", legend: { main: "A", shifted: null, altGr: "ą" } });
    expect(keyFace(a, names).altGr).toBe("ą");
  });
});

describe("actionSummary", () => {
  it("describes a layer-tap key", () => {
    expect(actionSummary(layerTap, names)).toEqual({ tap: "Space", hold: "Layer 1 · Symbols, while held" });
  });

  it("describes a mod-tap key", () => {
    expect(actionSummary(modTap, names)).toEqual({ tap: "T", hold: "Shift" });
  });

  it.each([
    ["while held", "Layer 2, while held"],
    ["toggle", "Toggle Layer 2"],
    ["switch to", "Switch to Layer 2"],
    ["one-shot", "One-shot Layer 2"],
    ["hold, or tap to toggle", "Hold for Layer 2, or tap to toggle it"],
    ["default", "Make Layer 2 the default layer"],
    ["default (saved)", "Make Layer 2 the default layer, and remember it"],
  ] as const)("describes a layer key that does %s", (layerAction, sentence) => {
    const key = d({ code: "X(2)", kind: "layer", tap: "X 2", layer: 2, layerAction });
    expect(actionSummary(key, names)).toEqual({ tap: sentence, hold: null });
  });

  it("describes transparent and empty keys in words", () => {
    expect(actionSummary(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names).tap)
      .toBe("Falls through to the layer below");
    expect(actionSummary(d({ code: "KC_NO", kind: "none", tap: "" }), names).tap).toBe("Nothing");
  });

  it("describes tap dances and macros with their names", () => {
    expect(actionSummary(d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 }), names).tap)
      .toBe("Tap dance 0 · Tab / Caps Lock");
    expect(actionSummary(d({ code: "M1", kind: "macro", tap: "M 1", index: 1 }), names).tap).toBe("Macro 1");
  });

  it("describes one-shot modifiers and AltGr characters", () => {
    expect(actionSummary(d({ code: "OSM(MOD_LSFT)", kind: "one-shot-mod", tap: "Shift" }), names).tap)
      .toBe("One-shot Shift");
    const a = d({ code: "KC_A", kind: "basic", tap: "A", legend: { main: "A", shifted: null, altGr: "ą" } });
    expect(actionSummary(a, names).tap).toBe("A (AltGr: ą)");
  });
});

describe("keyTitle", () => {
  it("says what the key is, in words", () => {
    expect(keyTitle(d({ code: "KC_TAB", kind: "basic", tap: "Tab" }), names)).toBe("Tab");
    expect(keyTitle(d({ code: "LT2(KC_S)", kind: "layer-tap", tap: "S", hold: "layer 2", layer: 2 }), names))
      .toBe("S — hold for Layer 2");
    expect(keyTitle(layerTap, names)).toBe("Space — hold for Layer 1 · Symbols");
    expect(keyTitle(modTap, names)).toBe("T — hold for Shift");
    expect(keyTitle(d({ code: "MO(1)", kind: "layer", tap: "MO 1", layer: 1, layerAction: "while held" }), names))
      .toBe("Layer 1 · Symbols, while held");
    expect(keyTitle(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names)).toBe("Transparent");
    expect(keyTitle(d({ code: "KC_NO", kind: "none", tap: "" }), names)).toBe("Empty");
  });
});

describe("legendScale", () => {
  it("shrinks longer labels", () => {
    expect(legendScale("A")).toBeGreaterThan(legendScale("Esc"));
    expect(legendScale("Esc")).toBeGreaterThan(legendScale("Space"));
    expect(legendScale("Space")).toBeGreaterThan(legendScale("PrintScr"));
  });

  it("sizes multi-word labels by their longest word, as they wrap", () => {
    expect(legendScale("Caps Lock")).toBe(legendScale("Caps"));
  });
});

describe("holdSize", () => {
  // a 1u key 48 px wide has about 40 px for its labels
  it("is a fifth of the key size for short labels", () => {
    expect(holdSize("Shift", 40, 48)).toBeCloseTo(9.6, 5);
  });

  it("shrinks long names so they fit in two lines", () => {
    const size = holdSize("Tab / Caps Lock", 40, 48);
    expect(size).toBeLessThan(9.6);
    expect(size * 0.55 * "Caps Lock".length).toBeLessThanOrEqual(40);
  });

  it("shrinks a long word so it fits on one line", () => {
    expect(holdSize("Ctrl+Shift", 40, 48) * 0.55 * 10).toBeLessThanOrEqual(40);
  });

  it("never goes below 7 px", () => {
    expect(holdSize("Esc / LCtrl / Ctrl+S / Alt+Tab", 20, 24)).toBe(7);
  });
});

describe("legendSizes", () => {
  const face = (main: string, hold: string | null, shifted: string | null = null) =>
    ({ main, shifted, altGr: null, hold, tone: "macro" as const });

  it("uses the usual sizes when everything fits", () => {
    const sizes = legendSizes(face("A", null), 40, 40, 48);
    expect(sizes.main).toBeCloseTo(legendScale("A") * 48, 5);
    expect(sizes.hold).toBe(0);
  });

  it("makes the main legend smaller when a long name needs two lines below it", () => {
    const sizes = legendSizes(face("M 0", "git status"), 40, 40, 48);
    expect(sizes.main).toBeLessThan(legendScale("M 0") * 48);
    const height = sizes.main * 1.05 + 2 * sizes.hold * 1.1 + 0.04 * 48;
    expect(height).toBeLessThanOrEqual(40);
  });

  it("keeps room for the shifted character", () => {
    const sizes = legendSizes(face("1", "Layer 2", "!"), 40, 30, 36);
    expect(sizes.main * 1.05 + sizes.shifted + sizes.hold * 1.1 + 0.08 * 36).toBeLessThanOrEqual(30);
  });
});
```

Create `web/src/keyboard/refs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Described, KeyGeometry, KeyboardModel } from "../api/types";
import { actionAt, positionLine, whereIs } from "./refs";

const d = (code: string): Described => ({
  code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
  description: null,
});
const g = (fields: Partial<KeyGeometry>) => ({ x: 0, y: 0, w: 1, h: 1, ...fields }) as KeyGeometry;

const model = {
  keys: [g({ row: 2, col: 3 })],
  encoders: [g({ encoder: 0, direction: 0 }), g({ encoder: 0, direction: 1 })],
  layers: [
    { keys: [d("KC_A")], encoders: [d("KC_VOLD"), d("KC_VOLU")] },
    { keys: [d("KC_B")], encoders: [d("KC_TRNS"), d("KC_MNXT")] },
  ],
} as unknown as KeyboardModel;

describe("actionAt", () => {
  it("is what a key or encoder direction does on a layer", () => {
    expect(actionAt(model, 1, { kind: "key", index: 0 })?.code).toBe("KC_B");
    expect(actionAt(model, 0, { kind: "encoder", index: 1 })?.code).toBe("KC_VOLU");
    expect(actionAt(model, 5, { kind: "key", index: 0 })).toBeUndefined();
  });
});

describe("whereIs", () => {
  it("names a key by its matrix position and an encoder by its direction", () => {
    expect(whereIs(model, { kind: "key", index: 0 })).toEqual({ what: "Key", where: "row 2, column 3" });
    expect(whereIs(model, { kind: "encoder", index: 0 })).toEqual({ what: "Encoder 0", where: "counter-clockwise" });
    expect(whereIs(model, { kind: "encoder", index: 1 })).toEqual({ what: "Encoder 0", where: "clockwise" });
  });
});

describe("positionLine", () => {
  it("says where the key is and on which layer, in small words", () => {
    expect(positionLine(model, { kind: "key", index: 0 }, "Base")).toBe("row 2 · column 3 · Base layer");
    expect(positionLine(model, { kind: "key", index: 0 }, "Layer 3")).toBe("row 2 · column 3 · Layer 3");
    expect(positionLine(model, { kind: "encoder", index: 1 }, "Nav")).toBe("encoder 0 · clockwise · Nav layer");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/keyboard/labels.test.ts src/keyboard/refs.test.ts
```

Expected: `Test Files  2 failed (2)`.

- [ ] **Step 3: Implement them**

Create `web/src/keyboard/labels.ts`:

```ts
// What a key shows: on the key itself (keyFace) and in words in the Inspector (actionSummary, keyTitle).
import type { Described, KeyKind, KeyboardModel } from "../api/types";

/** The colour family of a key */
export type Tone = "normal" | "mod" | "layer" | "tap-dance" | "macro" | "transparent" | "none";

export interface KeyFace {
  /** big label: the tap action */
  main: string;
  /** small, above it: the character typed with Shift */
  shifted: string | null;
  /** small, top right: the character typed with AltGr in the chosen keyboard language */
  altGr: string | null;
  /** small, below: the hold action, or what a layer, tap dance or macro key refers to */
  hold: string | null;
  tone: Tone;
}

/** Names of the layers, tap dances and macros keys refer to */
export interface Names {
  layer(index: number): string;
  /** whether the user named the layer (unnamed layers are called "Layer N" anyway) */
  layerIsNamed(index: number): boolean;
  /** "" when it has no name */
  tapDance(index: number): string;
  macro(index: number): string;
}

const TONES: Partial<Record<KeyKind, Tone>> = {
  "mod-tap": "mod",
  modifier: "mod",
  "one-shot-mod": "mod",
  layer: "layer",
  "layer-tap": "layer",
  "tap-dance": "tap-dance",
  macro: "macro",
  transparent: "transparent",
  none: "none",
};

export function toneOf(kind: KeyKind): Tone {
  return TONES[kind] ?? "normal";
}

export function namesOf(model: KeyboardModel): Names {
  return {
    layer: (i) => model.layers[i]?.name ?? `Layer ${i}`,
    layerIsNamed: (i) => model.layers[i]?.customName ?? false,
    tapDance: (i) => model.tapDance[i]?.name ?? "",
    macro: (i) => model.macros.items[i]?.name ?? "",
  };
}

function referenced(d: Described, names: Names): string | null {
  if (d.index == null) return null;
  const name = d.kind === "tap-dance" ? names.tapDance(d.index) : names.macro(d.index);
  return name || null;
}

export function keyFace(d: Described, names: Names): KeyFace {
  let hold: string | null = null;
  if ((d.kind === "layer-tap" || d.kind === "layer") && d.layer != null) hold = names.layer(d.layer);
  else if (d.kind === "tap-dance" || d.kind === "macro") hold = referenced(d, names);
  else if (d.kind === "mod-tap") hold = d.hold ?? null;
  else if (d.kind === "one-shot-mod") hold = "one-shot";
  return { main: d.legend.main, shifted: d.legend.shifted ?? null, altGr: d.legend.altGr ?? null, hold, tone: toneOf(d.kind) };
}

/** "Layer 1 · Symbols" for a named layer, "Layer 2" for an unnamed one */
export function layerLabel(index: number, names: Names): string {
  return names.layerIsNamed(index) ? `Layer ${index} · ${names.layer(index)}` : names.layer(index);
}

function layerSentence(d: Described, names: Names): string {
  const layer = d.layer != null ? layerLabel(d.layer, names) : d.tap;
  switch (d.layerAction) {
    case "while held":
      return `${layer}, while held`;
    case "toggle":
      return `Toggle ${layer}`;
    case "switch to":
      return `Switch to ${layer}`;
    case "one-shot":
      return `One-shot ${layer}`;
    case "hold, or tap to toggle":
      return `Hold for ${layer}, or tap to toggle it`;
    case "default":
      return `Make ${layer} the default layer`;
    case "default (saved)":
      return `Make ${layer} the default layer, and remember it`;
    default:
      return d.tap;
  }
}

/** The tap and hold actions in words, for the Inspector */
export function actionSummary(d: Described, names: Names): { tap: string; hold: string | null } {
  switch (d.kind) {
    case "none":
      return { tap: "Nothing", hold: null };
    case "transparent":
      return { tap: "Falls through to the layer below", hold: null };
    case "layer":
      return { tap: layerSentence(d, names), hold: null };
    case "layer-tap":
      return { tap: d.tap, hold: d.layer != null ? `${layerLabel(d.layer, names)}, while held` : d.hold ?? null };
    case "mod-tap":
      return { tap: d.tap, hold: d.hold ?? null };
    case "one-shot-mod":
      return { tap: `One-shot ${d.tap}`, hold: null };
    case "tap-dance":
    case "macro": {
      const what = d.kind === "tap-dance" ? "Tap dance" : "Macro";
      const name = referenced(d, names);
      return { tap: `${what} ${d.index ?? ""}${name ? ` · ${name}` : ""}`, hold: null };
    }
    default: {
      const tap = d.tap || d.code;
      return { tap: d.legend.altGr ? `${tap} (AltGr: ${d.legend.altGr})` : tap, hold: null };
    }
  }
}

/** What the key is, as a title: "Tab", "S — hold for Layer 2", "Transparent" */
export function keyTitle(d: Described, names: Names): string {
  if (d.kind === "none") return "Empty";
  if (d.kind === "transparent") return "Transparent";
  if (d.kind === "layer-tap" && d.layer != null) return `${d.tap} — hold for ${layerLabel(d.layer, names)}`;
  if (d.kind === "mod-tap" && d.hold) return `${d.tap} — hold for ${d.hold}`;
  return actionSummary(d, names).tap;
}

function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((w) => [...w].length));
}

/** Font sizes of a tap label, in key units, from one character down to long words */
const LEGEND_SCALES = [0.4, 0.32, 0.27, 0.22, 0.18];
const LEGEND_LENGTHS = [1, 2, 4, 6];

/** Font size of a key's main legend, in key units. Labels wrap at spaces, so the longest word counts. */
export function legendScale(main: string): number {
  const longest = longestWord(main);
  const level = LEGEND_LENGTHS.findIndex((n) => longest <= n);
  return LEGEND_SCALES[level === -1 ? LEGEND_LENGTHS.length : level];
}

/** average width of a character, as a share of the font size */
const CHAR_WIDTH = 0.55;
const HOLD_MIN_PX = 7;

/** Font size, in pixels, of a key's small hold label in widthPx pixels on a key of u pixels: a fifth of the key, but
 * small enough for a long name (a tap dance's, a macro's) to fit in two lines, and its longest word in one */
export function holdSize(hold: string, widthPx: number, u: number): number {
  // two lines, less what is lost where a line breaks between words
  const lines = (2 * widthPx * 0.8) / ([...hold].length * CHAR_WIDTH);
  const word = widthPx / (Math.max(1, longestWord(hold)) * CHAR_WIDTH);
  return Math.max(HOLD_MIN_PX, Math.min(0.2 * u, lines, word));
}

/** Font sizes, in pixels, of a key's legends: the main one, the shifted character (0 if none) and the hold label
 * (0 if none), so that all of them fit in widthPx by heightPx on a key of u pixels. When a long name needs two lines,
 * the main legend gets smaller first, then the name, down to its smallest size. */
export function legendSizes(face: KeyFace, widthPx: number, heightPx: number, u: number): {
  main: number;
  shifted: number;
  hold: number;
} {
  let main = legendScale(face.main) * u;
  const shifted = face.shifted ? 0.2 * u : 0;
  let hold = face.hold ? holdSize(face.hold, widthPx, u) : 0;
  const holdLines = !face.hold ? 0 : [...face.hold].length * CHAR_WIDTH * hold > widthPx ? 2 : 1;
  const gaps = (face.shifted ? 0.04 * u : 0) + (face.hold ? 0.04 * u : 0);
  const free = () => heightPx - gaps - shifted - holdLines * hold * 1.1;
  if (main * 1.05 > free()) main = Math.max(0.18 * u, free() / 1.05);
  if (main * 1.05 > free() && holdLines) {
    hold = Math.max(HOLD_MIN_PX, (heightPx - gaps - shifted - main * 1.05) / (holdLines * 1.1));
  }
  return { main, shifted, hold };
}
```

Create `web/src/keyboard/refs.ts`:

```ts
// Pointing at one key or encoder direction of a keyboard.
import type { Described, KeyboardModel } from "../api/types";

/** A key or an encoder direction: an index into KeyboardModel.keys or .encoders */
export interface KeyRef {
  kind: "key" | "encoder";
  index: number;
}

/** What a key or encoder direction does on a layer */
export function actionAt(model: Pick<KeyboardModel, "layers">, layer: number, ref: KeyRef): Described | undefined {
  const l = model.layers[layer];
  return ref.kind === "key" ? l?.keys[ref.index] : l?.encoders[ref.index];
}

/** { what: "Key", where: "row 1, column 2" } or { what: "Encoder 0", where: "clockwise" } */
export function whereIs(model: Pick<KeyboardModel, "keys" | "encoders">, ref: KeyRef): { what: string; where: string } {
  if (ref.kind === "key") {
    const g = model.keys[ref.index];
    return { what: "Key", where: `row ${g.row}, column ${g.col}` };
  }
  const g = model.encoders[ref.index];
  return { what: `Encoder ${g.encoder}`, where: g.direction === 1 ? "clockwise" : "counter-clockwise" };
}

/** "row 0 · column 0 · Base layer", "encoder 0 · clockwise · Layer 2" */
export function positionLine(model: Pick<KeyboardModel, "keys" | "encoders">, ref: KeyRef, layerName: string): string {
  const layer = /^layer\b/i.test(layerName) ? layerName : `${layerName} layer`;
  if (ref.kind === "key") {
    const g = model.keys[ref.index];
    return `row ${g.row} · column ${g.col} · ${layer}`;
  }
  const { what, where } = whereIs(model, ref);
  return `${what.toLowerCase()} · ${where} · ${layer}`;
}
```

- [ ] **Step 4: Run the tests again, then type-check**

```bash
cd web && npx vitest run src/keyboard/labels.test.ts src/keyboard/refs.test.ts
```

Expected: `Tests  43 passed (43)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keyboard/labels.test.ts \
  web/src/keyboard/labels.ts \
  web/src/keyboard/refs.test.ts \
  web/src/keyboard/refs.ts
git commit -m "feat(web): what each key shows, in legends and in words"
```

### Task 9: Keymap logic: hold actions, arrow-key navigation, tap dances

- **`hold.ts`** (the Inspector's "Change hold"):
  - `tapCodeOf()` finds the keycode a key types when tapped. Only keys that can get a hold action have one.
  - `holdOf()` reads the current hold: a layer, or modifiers with left or right hand.
  - `holdExpression()` writes the new keycode: `LT(n, kc)`, `MT(MOD_LCTL | MOD_LSFT, kc)`, or the plain tap keycode for no hold.
- **`navigation.ts`:** `neighbour()` finds the key the arrow keys move to. It prefers keys in the pressed direction, and being off to the side counts double.
- **`tapdance.ts`:**
  - `freeTapDance()` finds an empty tap dance that no key or encoder uses;
  - `tapDanceSlots()` lists the four ways of pressing a tap dance key.

**Files:**
- Create: `web/src/keymap/hold.test.ts`, `web/src/keymap/hold.ts`, `web/src/keymap/navigation.test.ts`, `web/src/keymap/navigation.ts`, `web/src/keymap/tapdance.test.ts`, `web/src/keymap/tapdance.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/keymap/hold.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { holdExpression, holdOf, tapCodeOf } from "./hold";

describe("tapCodeOf", () => {
  it("finds the tapped keycode of keys that can get a hold action", () => {
    expect(tapCodeOf("LT1(KC_SPACE)")).toBe("KC_SPACE");
    expect(tapCodeOf("LSFT_T(KC_T)")).toBe("KC_T");
    expect(tapCodeOf("C_S_T(KC_A)")).toBe("KC_A");
    expect(tapCodeOf("KC_A")).toBe("KC_A");
  });

  it("is null for keys that can't", () => {
    expect(tapCodeOf("TD(0)")).toBeNull();
    expect(tapCodeOf("LCTL(KC_C)")).toBeNull();
    expect(tapCodeOf("MO(1)")).toBeNull();
    expect(tapCodeOf("KC_TRNS")).toBeNull();
    expect(tapCodeOf("KC_NO")).toBeNull();
  });
});

describe("holdOf", () => {
  it("reads the layer of a layer-tap key", () => {
    expect(holdOf({ kind: "layer-tap", layer: 2, hold: "layer 2" })).toEqual({ type: "layer", layer: 2 });
  });

  it("reads the modifiers of a mod-tap key from its hold label", () => {
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Ctrl+Shift" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT"], right: false });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "AltGr" })).toEqual({ type: "mods", mods: ["ALT"], right: true });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "RCtrl+RGui" }))
      .toEqual({ type: "mods", mods: ["CTL", "GUI"], right: true });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Hyper" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT", "ALT", "GUI"], right: false });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Meh" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT", "ALT"], right: false });
  });

  it("is null for keys without a hold action", () => {
    expect(holdOf({ kind: "basic", layer: null, hold: null })).toBeNull();
  });
});

describe("holdExpression", () => {
  it("writes a layer-tap", () => {
    expect(holdExpression("KC_SPACE", { type: "layer", layer: 1 })).toBe("LT(1, KC_SPACE)");
  });

  it("writes a mod-tap with left or right modifiers", () => {
    expect(holdExpression("KC_A", { type: "mods", mods: ["CTL", "SFT"], right: false }))
      .toBe("MT(MOD_LCTL | MOD_LSFT, KC_A)");
    expect(holdExpression("KC_E", { type: "mods", mods: ["ALT"], right: true })).toBe("MT(MOD_RALT, KC_E)");
  });

  it("is just the tapped keycode without a hold action", () => {
    expect(holdExpression("KC_A", null)).toBe("KC_A");
    expect(holdExpression("KC_A", { type: "mods", mods: [], right: false })).toBe("KC_A");
  });
});
```

Create `web/src/keymap/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { neighbour } from "./navigation";

// a 3x2 grid with a gap, and a thumb key below the middle
//  0 1   2
//  3 4   5
//      6
const grid = [
  { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 4, cy: 0 },
  { cx: 0, cy: 1 }, { cx: 1, cy: 1 }, { cx: 4, cy: 1 },
  { cx: 2.5, cy: 2.2 },
];

describe("neighbour", () => {
  it("moves along a row, across gaps", () => {
    expect(neighbour(grid, 0, "right")).toBe(1);
    expect(neighbour(grid, 1, "right")).toBe(2);
    expect(neighbour(grid, 2, "left")).toBe(1);
  });

  it("moves along a column", () => {
    expect(neighbour(grid, 0, "down")).toBe(3);
    expect(neighbour(grid, 4, "up")).toBe(1);
  });

  it("goes to the nearest key in that direction, even if a little off to the side", () => {
    expect(neighbour(grid, 4, "down")).toBe(6);
    expect(neighbour(grid, 6, "up")).toBe(4);
  });

  it("stays put at the edge", () => {
    expect(neighbour(grid, 0, "left")).toBe(0);
    expect(neighbour(grid, 2, "up")).toBe(2);
  });

  it("stays put without keys", () => {
    expect(neighbour([], 0, "left")).toBe(0);
  });
});
```

Create `web/src/keymap/tapdance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel, TapDance } from "../api/types";
import { freeTapDance, tapDanceSlots } from "./tapdance";

const none: Described = {
  code: "KC_NO", kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null, index: null,
  description: null,
};
const tab: Described = { ...none, code: "KC_TAB", kind: "basic", tap: "Tab", legend: { main: "Tab" } };

function td(index: number, tap: Described): TapDance {
  return { index, name: "", customName: false, tap, hold: none, doubleTap: none, tapHold: none, tappingTerm: 200 };
}

function key(code: string): Described {
  const td = /^TD\((\d+)\)$/.exec(code);
  return td ? { ...none, code, kind: "tap-dance", index: Number(td[1]) } : { ...none, code, kind: "basic" };
}

function model(tapDance: TapDance[], layerKeys: string[][], encoderKeys: string[][] = []) {
  return {
    tapDance,
    layers: layerKeys.map((keys, i) => ({ keys: keys.map(key), encoders: (encoderKeys[i] ?? []).map(key) })),
  } as unknown as KeyboardModel;
}

describe("freeTapDance", () => {
  it("is the first empty tap dance that no key uses", () => {
    expect(freeTapDance(model([td(0, tab), td(1, none), td(2, none)], [["TD(1)"], ["KC_A"]]))).toBe(2);
  });

  it("looks at encoders too", () => {
    expect(freeTapDance(model([td(0, none), td(1, none)], [["KC_A"]], [["TD(0)"]]))).toBe(1);
  });

  it("is null when every tap dance is set or used", () => {
    expect(freeTapDance(model([td(0, tab), td(1, none)], [["KC_A", "TD(1)"]]))).toBeNull();
    expect(freeTapDance(model([], [["KC_A"]]))).toBeNull();
  });
});

describe("tapDanceSlots", () => {
  it("lists what each way of pressing does, in order", () => {
    const caps: Described = { ...none, code: "KC_CAPSLOCK", kind: "basic", tap: "Caps Lock" };
    const entry = { ...td(0, tab), doubleTap: caps };
    expect(tapDanceSlots(entry).map((s) => [s.label, s.action.code])).toEqual([
      ["Tap", "KC_TAB"], ["Hold", "KC_NO"], ["Double tap", "KC_CAPSLOCK"], ["Tap, then hold", "KC_NO"],
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/keymap
```

Expected: `Test Files  3 failed (3)`.

- [ ] **Step 3: Implement them**

Create `web/src/keymap/hold.ts`:

```ts
// "Change hold": the hold action of a key, as a layer-tap (LT) or mod-tap (MT).
import type { Described } from "../api/types";

export type Mod = "CTL" | "SFT" | "ALT" | "GUI";
export const MODS: { mod: Mod; label: string }[] = [
  { mod: "CTL", label: "Ctrl" },
  { mod: "SFT", label: "Shift" },
  { mod: "ALT", label: "Alt" },
  { mod: "GUI", label: "Gui" },
];

export type Hold = { type: "layer"; layer: number } | { type: "mods"; mods: Mod[]; right: boolean } | null;

const LAYER_TAP = /^LT\d+\((KC_\w+)\)$/;
const MOD_TAP = /^\w+_T\((KC_\w+)\)$/;
const BASIC = /^KC_\w+$/;
const NO_TAP = new Set(["KC_NO", "KC_TRNS"]);

/** The keycode a key types when tapped, if it can have a hold action added or changed; else null */
export function tapCodeOf(code: string): string | null {
  const inner = LAYER_TAP.exec(code)?.[1] ?? MOD_TAP.exec(code)?.[1] ?? (BASIC.test(code) ? code : null);
  return inner && !NO_TAP.has(inner) ? inner : null;
}

const MOD_WORDS: Record<string, Mod[]> = {
  ctrl: ["CTL"], shift: ["SFT"], alt: ["ALT"], gui: ["GUI"], altgr: ["ALT"],
  meh: ["CTL", "SFT", "ALT"], hyper: ["CTL", "SFT", "ALT", "GUI"],
};

/** The current hold action of a key, read from its description (mod-tap modifiers from the hold label the server
 * gives, e.g. "Ctrl+Shift" or "AltGr") */
export function holdOf(d: Pick<Described, "kind" | "layer" | "hold">): Hold {
  if (d.kind === "layer-tap" && d.layer != null) return { type: "layer", layer: d.layer };
  if (d.kind !== "mod-tap" || !d.hold) return null;
  const words = d.hold.split("+");
  const right = words.some((w) => w === "AltGr" || /^R[A-Z]/.test(w));
  const mods = new Set<Mod>();
  for (const word of words) {
    const key = word.toLowerCase().replace(/^r(?=ctrl|shift|alt$|gui)/, "");
    for (const mod of MOD_WORDS[key] ?? []) mods.add(mod);
  }
  return { type: "mods", mods: MODS.map((m) => m.mod).filter((m) => mods.has(m)), right };
}

/** The keycode expression for a tapped keycode with a hold action, for the server to parse */
export function holdExpression(tap: string, hold: Hold): string {
  if (hold?.type === "layer") return `LT(${hold.layer}, ${tap})`;
  if (hold?.type === "mods" && hold.mods.length > 0) {
    const side = hold.right ? "R" : "L";
    return `MT(${hold.mods.map((m) => `MOD_${side}${m}`).join(" | ")}, ${tap})`;
  }
  return tap;
}
```

Create `web/src/keymap/navigation.ts`:

```ts
// Moving the key selection with the arrow keys.

export type Direction = "left" | "right" | "up" | "down";

interface Centre {
  cx: number;
  cy: number;
}

/** How much being off to the side counts against a key, compared with being further away in the direction */
const OFF_AXIS_WEIGHT = 2;

/** The index of the nearest key from keys[from] in a direction (by key centres), or from if there is none */
export function neighbour(keys: Centre[], from: number, direction: Direction): number {
  const start = keys[from];
  if (!start) return from;
  let best = from;
  let bestScore = Infinity;
  keys.forEach((key, index) => {
    if (index === from) return;
    const dx = key.cx - start.cx;
    const dy = key.cy - start.cy;
    const along = { right: dx, left: -dx, down: dy, up: -dy }[direction];
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along < 0.25) return; // not in that direction
    const score = along + OFF_AXIS_WEIGHT * across;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
```

Create `web/src/keymap/tapdance.ts`:

```ts
// Tap dances as the keymap shows them: what a tap dance key does, and finding a free one.
import type { Described, KeyboardModel, TapDance } from "../api/types";

/** The first tap dance with nothing in it that no key or encoder uses, or null */
export function freeTapDance(model: Pick<KeyboardModel, "tapDance" | "layers">): number | null {
  const used = new Set<number>();
  for (const layer of model.layers) {
    for (const d of [...layer.keys, ...layer.encoders]) {
      if (d.kind === "tap-dance" && d.index != null) used.add(d.index);
    }
  }
  const free = model.tapDance.find((td) =>
    !used.has(td.index) && [td.tap, td.hold, td.doubleTap, td.tapHold].every((slot) => slot.kind === "none"));
  return free ? free.index : null;
}

/** The four ways of pressing a tap dance key, and what each does */
export function tapDanceSlots(td: TapDance): { label: string; action: Described }[] {
  return [
    { label: "Tap", action: td.tap },
    { label: "Hold", action: td.hold },
    { label: "Double tap", action: td.doubleTap },
    { label: "Tap, then hold", action: td.tapHold },
  ];
}
```

- [ ] **Step 4: Run the tests again, then type-check**

```bash
cd web && npx vitest run src/keymap
```

Expected: `Tests  17 passed (17)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keymap/hold.test.ts \
  web/src/keymap/hold.ts \
  web/src/keymap/navigation.test.ts \
  web/src/keymap/navigation.ts \
  web/src/keymap/tapdance.test.ts \
  web/src/keymap/tapdance.ts
git commit -m "feat(web): hold actions, arrow-key navigation and tap dance helpers"
```

### Task 10: Keycode search and the theme choice

- **`search.ts`:** `searchKeycodes()` searches every category and lists each keycode once, best match first. From best to worst:
  - an exact label (the tap, shifted or AltGr character);
  - an exact name or alias, with or without `KC_`;
  - a label that starts with the query, then a name that does;
  - a label or name that contains it;
  - a description that contains it.

  Ties keep the catalogue's order.
- **`theme.ts`:** the System/Light/Dark choice.
  - It is stored in `localStorage` under `vial.theme`, the same key and values that `index.html` reads before the first paint.
  - It is applied as `data-theme` on `<html>`. With "System" the attribute is removed, and the CSS follows `prefers-color-scheme`.
  - Storage that throws (private windows) is handled.

**Files:**
- Create: `web/src/lib/theme.test.ts`, `web/src/lib/theme.ts`, `web/src/picker/search.test.ts`, `web/src/picker/search.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/picker/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
import { searchKeycodes } from "./search";

function k(code: string, tap: string, aliases: string[] = [], description: string | null = null,
  shifted: string | null = null): CatalogueKeycode {
  return {
    code, kind: "basic", tap, legend: { main: tap, shifted, altGr: null }, hold: null, layer: null, layerAction: null,
    index: null, description, aliases,
  };
}

const categories: KeycodeCategory[] = [
  {
    name: "Basic", templates: [], keycodes: [
      k("KC_ESCAPE", "Esc", ["KC_ESC"]), k("KC_A", "A"), k("KC_CAPSLOCK", "Caps Lock", ["KC_CAPS"]),
      k("KC_GRAVE", "`", ["KC_GRV"], null, "~"), k("KC_ENTER", "Enter", ["KC_ENT"]),
    ],
  },
  {
    name: "Modifiers", templates: [], keycodes: [
      k("KC_GESC", "Esc", [], "Esc normally, but ~ when Shift or GUI is pressed", "~"),
      k("KC_ESCAPE", "Esc", ["KC_ESC"]),
    ],
  },
];

const codes = (query: string) => searchKeycodes(categories, query).map((r) => r.code);

describe("searchKeycodes", () => {
  it("puts exact label matches first and lists each keycode once", () => {
    expect(codes("esc")).toEqual(["KC_ESCAPE", "KC_GESC"]);
  });

  it("finds keycodes by name and alias", () => {
    expect(codes("kc_caps")).toEqual(["KC_CAPSLOCK"]);
    expect(codes("GRV")).toEqual(["KC_GRAVE"]);
  });

  it("finds labels of several words, and shifted characters", () => {
    expect(codes("caps lock")).toEqual(["KC_CAPSLOCK"]);
    expect(codes("~")).toEqual(["KC_GRAVE", "KC_GESC"]);
  });

  it("searches descriptions too, after better matches", () => {
    expect(codes("shift")).toEqual(["KC_GESC"]);
  });

  it("is empty for an empty query", () => {
    expect(codes("  ")).toEqual([]);
  });
});
```

Create `web/src/lib/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, saveTheme, THEME_KEY, type ThemeRoot, type ThemeStorage } from "./theme";

function storage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

function root(): ThemeRoot & { attributes: Record<string, string> } {
  const attributes: Record<string, string> = {};
  return {
    attributes,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
  };
}

describe("readTheme", () => {
  it("is the saved choice", () => {
    expect(readTheme(storage({ [THEME_KEY]: "dark" }))).toBe("dark");
    expect(readTheme(storage({ [THEME_KEY]: "light" }))).toBe("light");
  });

  it("follows the system when nothing, or something unknown, is saved", () => {
    expect(readTheme(storage())).toBe("system");
    expect(readTheme(storage({ [THEME_KEY]: "purple" }))).toBe("system");
  });

  it("follows the system when the storage can't be read", () => {
    expect(readTheme(broken)).toBe("system");
    expect(readTheme(null)).toBe("system");
  });
});

describe("saveTheme", () => {
  it("remembers the choice", () => {
    const s = storage();
    expect(saveTheme(s, "dark")).toBe(true);
    expect(s.data[THEME_KEY]).toBe("dark");
  });

  it("says when it can't remember it", () => {
    expect(saveTheme(broken, "dark")).toBe(false);
    expect(saveTheme(null, "dark")).toBe(false);
  });
});

describe("applyTheme", () => {
  it("sets data-theme for light and dark", () => {
    const r = root();
    applyTheme(r, "dark");
    expect(r.attributes["data-theme"]).toBe("dark");
    applyTheme(r, "light");
    expect(r.attributes["data-theme"]).toBe("light");
  });

  it("removes it for the system's theme, so the colour-scheme media query decides", () => {
    const r = root();
    applyTheme(r, "dark");
    applyTheme(r, "system");
    expect(r.attributes).toEqual({});
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/picker src/lib
```

Expected: `Test Files  2 failed (2)`.

- [ ] **Step 3: Implement them**

Create `web/src/picker/search.ts`:

```ts
// Searching the keycode catalogue by label, name, alias and description.
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";

function labels(k: CatalogueKeycode): string[] {
  return [k.tap, k.legend.shifted, k.legend.altGr].filter((l): l is string => !!l).map((l) => l.toLowerCase());
}

function names(k: CatalogueKeycode): string[] {
  return [k.code, ...k.aliases].map((n) => n.toLowerCase());
}

/** How well a keycode matches (lower is better), or null if it doesn't */
function rank(k: CatalogueKeycode, query: string): number | null {
  const shown = labels(k);
  const bare = names(k).map((n) => n.replace(/^kc_/, ""));
  if (shown.includes(query)) return 0;
  if (bare.includes(query) || names(k).includes(query)) return 1;
  if (shown.some((l) => l.startsWith(query))) return 2;
  if (names(k).some((n) => n.startsWith(query)) || bare.some((n) => n.startsWith(query))) return 3;
  if (shown.some((l) => l.includes(query)) || names(k).some((n) => n.includes(query))) return 4;
  if (k.description?.toLowerCase().includes(query)) return 5;
  return null;
}

/** Keycodes of all categories matching the query, best first, each once */
export function searchKeycodes(categories: KeycodeCategory[], query: string): CatalogueKeycode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const found: { k: CatalogueKeycode; rank: number; order: number }[] = [];
  for (const category of categories) {
    for (const k of category.keycodes) {
      if (seen.has(k.code)) continue;
      seen.add(k.code);
      const r = rank(k, q);
      if (r != null) found.push({ k, rank: r, order: found.length });
    }
  }
  return found.sort((a, b) => a.rank - b.rank || a.order - b.order).map((f) => f.k);
}
```

Create `web/src/lib/theme.ts`:

```ts
// Light or dark: the system's (the default), or chosen in the top bar and remembered by this browser.
// index.html applies a saved choice before the first paint, with the same key and values.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "vial.theme";
export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export type ThemeRoot = Pick<HTMLElement, "setAttribute" | "removeAttribute">;

/** The remembered choice; the system's theme if there is none, or the storage can't be read (private window) */
export function readTheme(storage: ThemeStorage | null): ThemeChoice {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/** Remember the choice; false if the storage refuses (it then lasts until the page is closed) */
export function saveTheme(storage: ThemeStorage | null, choice: ThemeChoice): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** data-theme="light" or "dark" on the root element picks the palette; without it, prefers-color-scheme does */
export function applyTheme(root: ThemeRoot, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** The browser's storage, or null where it can't even be reached */
export function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run every unit test, then type-check**

```bash
cd web && npm test
```

Expected: `Test Files  9 passed (9)` and `Tests  98 passed (98)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/theme.test.ts \
  web/src/lib/theme.ts \
  web/src/picker/search.test.ts \
  web/src/picker/search.ts
git commit -m "feat(web): keycode search and the light/dark theme choice"
```

### Task 11: The keyboard store and the app shell components

**`lib/keyboard.svelte.ts`** is the only shared state.
- `start()` loads the language list and opens the events connection. The server's first event says whether a keyboard is connected. `connected` and `reloaded` load the keyboard, its session and the keycode catalogue; only the latest load is kept.
- `canEdit` is false while the keyboard is unplugged or the events connection is down.
- Edits (`setCode`, `turnIntoTapDance`, `renameLayer`) go to the keyboard first. The UI then shows the server's reply, never a guess.
- A failed edit shows a toast that names the action and the cause. A 503 marks the keyboard as unplugged.
- The chosen keyboard language is remembered in `localStorage` (`vial.keyboardLanguage`).

**Shell components:**
- `TopBar`: the keyboard name, the connection status, a "simulated keyboard" badge in fake mode, the keyboard-language select, and the theme switch.
- `Nav`: only the sections that are built, with counts.
- `Banner` and `Toasts`.
- `ui/Button`: the shared button, with variants and sizes.

These components have no unit tests. svelte-check verifies them here, and the e2e tests in Task 15 exercise them.

**Files:**
- Create: `web/src/lib/keyboard.svelte.ts`, `web/src/lib/toasts.svelte.ts`, `web/src/shell/Banner.svelte`, `web/src/shell/Nav.svelte`, `web/src/shell/ThemeSwitch.svelte`, `web/src/shell/Toasts.svelte`, `web/src/shell/TopBar.svelte`, `web/src/ui/Button.svelte`

- [ ] **Step 1: Toasts and the keyboard store**

Create `web/src/lib/toasts.svelte.ts`:

```ts
// Short messages in the corner: mostly why an edit failed.

export interface Toast {
  id: number;
  message: string;
}

const SHOW_MS = 7000;

class Toasts {
  items = $state<Toast[]>([]);
  #next = 1;

  error(message: string): void {
    const id = this.#next++;
    this.items.push({ id, message });
    setTimeout(() => this.dismiss(id), SHOW_MS);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
```

Create `web/src/lib/keyboard.svelte.ts`:

```ts
// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
import { api } from "../api/api";
import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
import { ApiError, failureMessage } from "../api/errors";
import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
import type { KeyboardLanguage, KeyboardModel, KeycodeCategory, Session } from "../api/types";
import { actionAt, type KeyRef } from "../keyboard/refs";
import { freeTapDance } from "../keymap/tapdance";
import { toasts } from "./toasts.svelte";

const LANGUAGE_KEY = "vial.keyboardLanguage";

function savedLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_KEY) ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

class KeyboardStore {
  model = $state<KeyboardModel | null>(null);
  session = $state<Session | null>(null);
  catalogue = $state<KeycodeCategory[]>([]);
  languages = $state<KeyboardLanguage[]>([]);
  language = $state(DEFAULT_LANGUAGE);
  /** the events connection to the server */
  link = $state<LinkState>("connecting");
  /** whether the keyboard is plugged in, as the server last said */
  connected = $state(false);
  loadError = $state<string | null>(null);
  /** edits waiting for the keyboard */
  pending = $state(0);

  canEdit = $derived(this.model !== null && this.connected && this.link === "open");

  #loads = 0;

  /** Load the language list, then follow the server's events (which start with the keyboard's state) */
  start(): () => void {
    // reads no state: called from an effect, it must not run again when the language changes
    const language = savedLanguage();
    this.language = language;
    setRequestLanguage(language);
    api.languages().then((list) => (this.languages = list), () => undefined);
    return connectEvents((event) => this.#onEvent(event), (state) => (this.link = state));
  }

  #onEvent(event: ServerEvent): void {
    this.connected = event !== "disconnected";
    if (this.connected) void this.load();
    else api.session().then((s) => (this.session = s), () => undefined);
  }

  /** Read the keyboard (and its keycode catalogue) from the server; only the latest load is kept */
  async load(): Promise<void> {
    const load = ++this.#loads;
    try {
      const [session, model, catalogue] = await Promise.all([api.session(), api.keyboard(), api.keycodes()]);
      if (load !== this.#loads) return;
      this.session = session;
      this.model = model;
      this.catalogue = catalogue;
      this.loadError = null;
    } catch (error) {
      if (load !== this.#loads) return;
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      else this.loadError = failureMessage("Loading the keyboard", error);
    }
  }

  async setLanguage(lang: string): Promise<void> {
    this.language = lang;
    setRequestLanguage(lang);
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      // not remembered (private window): still used until the page is closed
    }
    await this.load();
  }

  /** Set a keycode on the keyboard and show what it confirmed. Returns whether it worked. */
  async setCode(layer: number, ref: KeyRef, code: string, action = "Changing the key"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    return this.#edit(action, async () => {
      if (ref.kind === "key") {
        const { row, col } = model.keys[ref.index];
        const result = await api.setKey(layer, row ?? 0, col ?? 0, code);
        // keys of different layout options can share a matrix position
        model.keys.forEach((k, i) => {
          if (k.row === row && k.col === col) model.layers[layer].keys[i] = result;
        });
      } else {
        const { encoder, direction } = model.encoders[ref.index];
        const result = await api.setEncoder(layer, encoder ?? 0, direction ?? 0, code);
        model.encoders.forEach((e, i) => {
          if (e.encoder === encoder && e.direction === direction) model.layers[layer].encoders[i] = result;
        });
      }
    });
  }

  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key */
  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<boolean> {
    const model = this.model;
    const current = model ? actionAt(model, layer, ref) : undefined;
    const index = model ? freeTapDance(model) : null;
    if (!model || !current || index === null || !this.canEdit) return false;
    const entry = model.tapDance[index];
    const created = await this.#edit("Making a tap dance", async () => {
      model.tapDance[index] = await api.setTapDance(index, {
        tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
      });
    });
    return created && this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key");
  }

  async renameLayer(index: number, name: string): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    return this.#edit("Renaming the layer", async () => {
      // the reply is the name to show: the new one, or the default name when it was cleared
      const named = await api.setLayerName(index, name);
      model.layers[index].name = named.name;
      model.layers[index].customName = named.customName;
    });
  }

  async #edit(action: string, write: () => Promise<void>): Promise<boolean> {
    this.pending++;
    try {
      await write();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      toasts.error(failureMessage(action, error));
      return false;
    } finally {
      this.pending--;
    }
  }
}

export const keyboard = new KeyboardStore();
```

- [ ] **Step 2: The shared button**

Create `web/src/ui/Button.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    children: Snippet;
  }

  let { variant = "secondary", size = "md", type = "button", children, ...rest }: Props = $props();
</script>

<button class="btn {variant} {size}" {type} {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.12s, border-color 0.12s;
  }

  .md {
    padding: 7px 12px;
    font-size: 13px;
  }

  .sm {
    padding: 4px 9px;
    font-size: 12px;
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--text-2);
  }

  .danger {
    color: var(--danger);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
```

- [ ] **Step 3: The shell components**

Create `web/src/shell/Banner.svelte`:

```svelte
<script lang="ts">
  interface Props {
    tone: "danger" | "warning";
    title: string;
    message: string;
  }

  let { tone, title, message }: Props = $props();
</script>

<div class="banner {tone}" role="alert">
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3l8 14H2z" />
    <path d="M10 8.5v3.5M10 14.5v.01" />
  </svg>
  <div>
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid;
    border-radius: 12px;
    font-size: 13.5px;
  }

  .danger {
    border-color: var(--danger-line);
    background: var(--danger-weak);
  }

  .warning {
    border-color: color-mix(in srgb, var(--warning-text) 30%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  svg {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .danger svg {
    color: var(--danger);
  }

  strong {
    display: block;
  }

  span {
    color: var(--text-2);
  }

  .warning span {
    color: inherit;
  }
</style>
```

Create `web/src/shell/Toasts.svelte`:

```svelte
<script lang="ts">
  import { toasts } from "../lib/toasts.svelte";
</script>

<div class="toasts" role="status" aria-live="assertive">
  {#each toasts.items as toast (toast.id)}
    <div class="toast">
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 50;
    display: grid;
    gap: 8px;
    width: min(380px, calc(100vw - 40px));
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--danger-line);
    border-left: 4px solid var(--danger);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: 13.5px;
  }

  span {
    flex: 1;
  }

  button {
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
</style>
```

Create `web/src/shell/Nav.svelte`:

```svelte
<script lang="ts" module>
  export interface Section {
    id: string;
    label: string;
    /** shown next to the label, e.g. how many layers */
    count?: number;
  }
</script>

<script lang="ts">
  interface Props {
    sections: Section[];
    active: string;
    onselect: (id: string) => void;
  }

  let { sections, active, onselect }: Props = $props();
</script>

<nav class="nav" aria-label="Sections">
  <ul>
    {#each sections as s (s.id)}
      <li>
        <button
          type="button"
          class:active={s.id === active}
          aria-current={s.id === active ? "page" : undefined}
          onclick={() => onselect(s.id)}
        >
          <span>{s.label}</span>
          {#if s.count !== undefined}<em>{s.count}</em>{/if}
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    font-weight: 550;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  button.active {
    background: var(--accent-weak);
    color: var(--accent);
    font-weight: 650;
  }

  em {
    color: inherit;
    font-size: 12px;
    font-style: normal;
    opacity: 0.7;
  }

  @media (min-width: 1000px) {
    .nav {
      position: sticky;
      top: 76px;
    }

    ul {
      flex-direction: column;
    }
  }
</style>
```

Create `web/src/shell/ThemeSwitch.svelte`:

```svelte
<script lang="ts">
  import { applyTheme, browserStorage, readTheme, saveTheme, THEME_CHOICES, type ThemeChoice } from "../lib/theme";

  // index.html has already applied the saved choice before the first paint
  let choice = $state<ThemeChoice>(readTheme(browserStorage()));

  function choose(next: ThemeChoice) {
    choice = next;
    applyTheme(document.documentElement, next);
    saveTheme(browserStorage(), next);
  }
</script>

<fieldset class="theme">
  <legend class="visually-hidden">Theme</legend>
  {#each THEME_CHOICES as c (c.value)}
    <label class:on={choice === c.value}>
      <input
        type="radio"
        name="theme"
        value={c.value}
        checked={choice === c.value}
        onchange={() => choose(c.value)}
      />
      {c.label}
    </label>
  {/each}
</fieldset>

<style>
  .theme {
    display: inline-flex;
    gap: 2px;
    margin: 0;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
  }

  label {
    position: relative;
    padding: 3px 9px;
    border-radius: 7px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
  }

  label:hover {
    color: var(--text);
  }

  label.on {
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* the radio button covers its label, invisibly */
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
```

Create `web/src/shell/TopBar.svelte`:

```svelte
<script lang="ts">
  import type { KeyboardLanguage } from "../api/types";
  import ThemeSwitch from "./ThemeSwitch.svelte";

  interface Props {
    /** the keyboard's name, once loaded */
    name: string | null;
    status: "connected" | "disconnected" | "connecting" | "offline";
    fake: boolean;
    languages: KeyboardLanguage[];
    language: string;
    onlanguage: (lang: string) => void;
  }

  let { name, status, fake, languages, language, onlanguage }: Props = $props();

  const STATUS_TEXT = {
    connected: "Connected",
    disconnected: "Keyboard unplugged",
    connecting: "Connecting…",
    offline: "Vial not running",
  };
</script>

<header class="topbar">
  <div class="inner">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
        <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0.01M7 14h10" />
      </svg>
      <span class="app">Vial</span>
      {#if name}
        <span class="sep" aria-hidden="true">/</span>
        <span class="name">{name}</span>
      {/if}
    </div>

    <div class="right">
      {#if fake}
        <span class="badge fake" title="Started with --fake: nothing here touches a real keyboard">simulated keyboard</span>
      {/if}
      <span class="badge status {status}" role="status">
        <i aria-hidden="true"></i>{STATUS_TEXT[status]}
      </span>
      <ThemeSwitch />
      <label class="language">
        <span>Keyboard language</span>
        <select value={language} onchange={(e) => onlanguage(e.currentTarget.value)} disabled={languages.length === 0}>
          {#each languages as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </label>
    </div>
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(8px);
  }

  .inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    max-width: var(--shell-width);
    margin: 0 auto;
    padding: 10px var(--shell-gutter);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .logo {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.7;
    stroke-linecap: round;
  }

  .app {
    font-size: 16px;
    font-weight: 750;
    letter-spacing: -0.01em;
  }

  .sep {
    color: var(--text-3);
  }

  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .fake {
    border-color: color-mix(in srgb, var(--badge) 45%, transparent);
    background: color-mix(in srgb, var(--badge) 12%, transparent);
    color: var(--badge);
  }

  .status i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .status.connected i {
    background: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);
  }

  .status.disconnected i,
  .status.offline i {
    background: var(--danger);
  }

  .language {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 12px;
  }

  .language select {
    max-width: 210px;
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 13px;
  }
</style>
```

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run build
```

Expected: `built in`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/keyboard.svelte.ts \
  web/src/lib/toasts.svelte.ts \
  web/src/shell/Banner.svelte \
  web/src/shell/Nav.svelte \
  web/src/shell/ThemeSwitch.svelte \
  web/src/shell/Toasts.svelte \
  web/src/shell/TopBar.svelte \
  web/src/ui/Button.svelte
git commit -m "feat(web): keyboard store, toasts, top bar, navigation and banners"
```

### Task 12: Drawing the keyboard

- **`Key.svelte`:** one absolutely positioned `<button class="key">` per key, with an inline SVG shape. The shape can be a plain rectangle or a two-rectangle outline (ISO Enter).
  - The main legend is big, with the shifted and AltGr characters small; the hold label is small at the bottom.
  - It is coloured by kind. A transparent key is dashed. Rotation comes from the geometry.
- **`Encoder.svelte`:** an encoder drawn as a knob, with one button per direction.
- **`KeyCap.svelte`:** a single key drawn on its own, for the Inspector's header.
- **`Keyboard.svelte`:** scales the placed board to the width of its card (`u` pixels per key unit, at most 72 px), so it fits narrow windows. It draws a knob behind each encoder.
- The key with the selection is the one Tab reaches.

**Files:**
- Create: `web/src/keyboard/Encoder.svelte`, `web/src/keyboard/Key.svelte`, `web/src/keyboard/KeyCap.svelte`, `web/src/keyboard/Keyboard.svelte`

- [ ] **Step 1: The components**

Create `web/src/keyboard/Key.svelte`:

```svelte
<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { legendSizes, type KeyFace } from "./labels";

  interface Props {
    item: PlacedKey;
    face: KeyFace;
    /** pixels per key unit */
    u: number;
    selected: boolean;
    /** everything the key says, in words: for screen readers, and the tooltip */
    label: string;
    /** reaches the key with Tab (the selected one, or the first) */
    focusable: boolean;
    onselect: () => void;
  }

  let { item, face, u, selected, label, focusable, onselect }: Props = $props();

  const GAP = 0.09;
  /** space around the labels, in key units */
  const PAD = 0.04;
  const ROUND = 0.12;

  // the button covers both rectangles; everything inside is relative to its top-left corner
  const box = $derived.by(() => {
    const left = Math.min(0, item.hasSecond ? item.x2 : 0);
    const top = Math.min(0, item.hasSecond ? item.y2 : 0);
    const right = Math.max(item.w, item.hasSecond ? item.x2 + item.w2 : 0);
    const bottom = Math.max(item.h, item.hasSecond ? item.y2 + item.h2 : 0);
    return { left, top, width: right - left, height: bottom - top };
  });

  const rects = $derived.by(() => {
    const g = GAP * u;
    const shapes = [{ x: -box.left, y: -box.top, w: item.w, h: item.h }];
    if (item.hasSecond) shapes.push({ x: item.x2 - box.left, y: item.y2 - box.top, w: item.w2, h: item.h2 });
    return shapes.map((s) => ({ x: s.x * u + g / 2, y: s.y * u + g / 2, w: s.w * u - g, h: s.h * u - g }));
  });

  // the legends fit inside the primary rectangle, less the gap between keys and the padding
  const sizes = $derived(
    legendSizes(face, (item.w - GAP - 2 * PAD) * u, (item.h - GAP - 2 * PAD) * u, u),
  );

  const style = $derived(
    [
      `left: ${(item.x + box.left) * u}px`,
      `top: ${(item.y + box.top) * u}px`,
      `width: ${box.width * u}px`,
      `height: ${box.height * u}px`,
      `--u: ${u}px`,
      `--tap-size: ${sizes.main}px`,
      `--shifted-size: ${sizes.shifted}px`,
      `--hold-size: ${sizes.hold}px`,
      item.r ? `transform: rotate(${item.r}deg)` : "",
      item.r ? `transform-origin: ${(item.rx - item.x - box.left) * u}px ${(item.ry - item.y - box.top) * u}px` : "",
    ].filter(Boolean).join("; "),
  );

  const legendStyle = $derived(
    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h}px`,
  );
</script>

<button
  type="button"
  class="key tone-{face.tone}" data-tone={face.tone}
  class:selected
  {style}
  aria-label={label}
  title={label}
  aria-pressed={selected}
  tabindex={focusable ? 0 : -1}
  data-ref="{item.kind}:{item.index}"
  onclick={onselect}
>
  <svg class="cap" width={box.width * u} height={box.height * u} aria-hidden="true">
    <!-- outlines first, then the fills over them: two rectangles read as one key (ISO Enter) -->
    {#each rects as r, i (i)}
      <rect class="edge" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
    {#each rects as r, i (i)}
      <rect class="face" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
  </svg>
  <span class="legend" style={legendStyle}>
    {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
    {#if face.shifted}<span class="shifted">{face.shifted}</span>{/if}
    <span class="tap">{face.main}</span>
    {#if face.hold}<span class="hold">{face.hold}</span>{/if}
  </span>
</button>

<style>
  .key {
    position: absolute;
    padding: 0;
    border: 0;
    background: none;
    color: var(--key-text);
    cursor: pointer;
    border-radius: calc(var(--u) * 0.14);
  }

  .cap {
    position: absolute;
    inset: 0;
    overflow: visible;
    filter: drop-shadow(0 calc(var(--u) * 0.035) 0 var(--key-shadow));
  }

  .edge {
    fill: none;
    stroke: var(--line);
    stroke-width: 2;
  }

  .face {
    fill: var(--fill);
  }

  .tone-transparent .cap {
    filter: none;
  }

  .tone-transparent .face {
    fill: var(--board-bg);
  }

  .tone-transparent .edge {
    stroke-dasharray: 4 3;
    stroke-width: 1.5;
  }

  .tone-transparent,
  .tone-none {
    color: var(--text-3);
  }

  /* fills stay opaque: the two rectangles of an ISO Enter must hide each other's outline */
  .tone-none .face {
    fill: color-mix(in srgb, var(--key-bg) 55%, var(--board-bg));
  }

  .key:hover .face {
    fill: color-mix(in srgb, var(--fill) 88%, var(--accent));
  }

  .selected .edge {
    stroke: var(--accent);
    stroke-width: 5;
    stroke-dasharray: none;
  }

  .key:focus-visible {
    outline: none;
  }

  .key:focus-visible .edge {
    stroke: var(--accent);
    stroke-width: 5;
  }

  .legend {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: calc(var(--u) * 0.04);
    pointer-events: none;
    overflow: hidden;
  }

  .tap {
    max-width: 100%;
    font-size: var(--tap-size);
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-align: center;
    overflow-wrap: normal;
  }

  .shifted {
    margin-bottom: calc(var(--u) * 0.02);
    color: var(--text-2);
    font-size: var(--shifted-size);
    font-weight: 550;
    line-height: 1;
  }

  /* names of tap dances and macros can be long: two lines at most, smaller for longer names */
  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--u) * 0.04);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: var(--hold-size);
    font-weight: 550;
    line-height: 1.1;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .alt-gr {
    position: absolute;
    top: calc(var(--u) * 0.05);
    right: calc(var(--u) * 0.1);
    color: var(--tone-layer);
    font-size: max(10px, calc(var(--u) * 0.23));
    font-weight: 600;
  }
</style>
```

Create `web/src/keyboard/KeyCap.svelte`:

```svelte
<script lang="ts">
  import { holdSize, legendScale, type KeyFace } from "./labels";

  interface Props {
    face: KeyFace;
    /** width and height, in pixels */
    size: number;
    round?: boolean;
  }

  // a key drawn on its own, not part of a keyboard: the selected key in the Inspector
  let { face, size, round = false }: Props = $props();
</script>

<div
  class="cap tone-{face.tone}" data-tone={face.tone}
  class:round
  style="--size: {size}px; --tap-size: {legendScale(face.main) * size}px;
    --hold-size: {face.hold ? holdSize(face.hold, size * 0.82, size) : 0}px"
  aria-hidden="true"
>
  {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
  {#if face.shifted}<span class="shifted">{face.shifted}</span>{/if}
  <span class="main">{face.main || "—"}</span>
  {#if face.hold}<span class="hold">{face.hold}</span>{/if}
</div>

<style>
  .cap {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    padding: calc(var(--size) * 0.07);
    border: 2px solid var(--line);
    border-radius: calc(var(--size) * 0.16);
    background: var(--fill);
    box-shadow: 0 calc(var(--size) * 0.045) 0 var(--key-shadow);
    color: var(--key-text);
    overflow: hidden;
  }

  .round {
    border-radius: 50%;
  }

  .tone-transparent {
    --fill: transparent;
    border-style: dashed;
    box-shadow: none;
    color: var(--text-3);
  }

  .tone-none {
    color: var(--text-3);
  }

  .main {
    max-width: 100%;
    font-size: var(--tap-size);
    font-weight: 650;
    line-height: 1.05;
    text-align: center;
  }

  .shifted {
    color: var(--text-2);
    font-size: calc(var(--size) * 0.2);
    font-weight: 550;
    line-height: 1;
  }

  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--size) * 0.04);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: var(--hold-size);
    font-weight: 550;
    line-height: 1.1;
    text-align: center;
  }

  .alt-gr {
    position: absolute;
    top: calc(var(--size) * 0.05);
    right: calc(var(--size) * 0.1);
    color: var(--tone-layer);
    font-size: calc(var(--size) * 0.22);
    font-weight: 600;
  }
</style>
```

Create `web/src/keyboard/Encoder.svelte`:

```svelte
<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { legendScale, type KeyFace } from "./labels";

  interface Props {
    /** one direction of an encoder: 0 counter-clockwise, 1 clockwise */
    item: PlacedKey;
    face: KeyFace;
    u: number;
    selected: boolean;
    label: string;
    focusable: boolean;
    onselect: () => void;
  }

  let { item, face, u, selected, label, focusable, onselect }: Props = $props();

  const clockwise = $derived(item.geometry.direction === 1);
  const size = $derived(Math.min(item.w, item.h) * u * 0.91);

  // a round knob needs no rotation: it sits on the (rotated) centre of its key
  const style = $derived(
    [
      `left: ${item.cx * u - size / 2}px`,
      `top: ${item.cy * u - size / 2}px`,
      `width: ${size}px`,
      `height: ${size}px`,
      `--u: ${u}px`,
      `--tap-size: ${legendScale(face.main) * u * 0.9}px`,
    ].join("; "),
  );
</script>

<button
  type="button"
  class="encoder tone-{face.tone}" data-tone={face.tone}
  class:selected
  {style}
  aria-label={label}
  title={label}
  aria-pressed={selected}
  tabindex={focusable ? 0 : -1}
  data-ref="{item.kind}:{item.index}"
  onclick={onselect}
>
  <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true" class:mirrored={!clockwise}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M17.5 3.5v4h-4" />
  </svg>
  <span class="tap">{face.main}</span>
  {#if face.hold}<span class="hold">{face.hold}</span>{/if}
</button>

<style>
  .encoder {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 2px solid var(--line);
    border-radius: 50%;
    background: var(--fill);
    box-shadow: 0 calc(var(--u) * 0.035) 0 var(--key-shadow);
    color: var(--key-text);
    cursor: pointer;
  }

  .tone-transparent {
    --fill: transparent;
    border-style: dashed;
    box-shadow: none;
    color: var(--text-3);
  }

  .tone-none {
    color: var(--text-3);
  }

  .selected,
  .encoder:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
    outline: none;
  }

  .arrow {
    position: absolute;
    top: 6%;
    left: 6%;
    width: 30%;
    height: 30%;
    fill: none;
    stroke: var(--text-3);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .arrow.mirrored {
    transform: scaleX(-1);
  }

  .tap {
    max-width: 84%;
    font-size: max(9px, var(--tap-size));
    font-weight: 600;
    line-height: 1.05;
    text-align: center;
  }

  .hold {
    max-width: 80%;
    overflow: hidden;
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: max(8px, calc(var(--u) * 0.16));
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

Create `web/src/keyboard/Keyboard.svelte`:

```svelte
<script lang="ts">
  import Encoder from "./Encoder.svelte";
  import { encoderKnobs, type Placement } from "./geometry";
  import Key from "./Key.svelte";
  import type { KeyFace } from "./labels";

  interface Props {
    placement: Placement;
    /** what each placed key shows, aligned with placement.items */
    faces: KeyFace[];
    /** what a screen reader says for each placed key */
    labels: string[];
    /** index into placement.items, or -1 */
    selected: number;
    onselect: (index: number) => void;
    /** largest key size, in pixels */
    maxUnit?: number;
  }

  let { placement, faces, labels, selected, onselect, maxUnit = 72 }: Props = $props();

  let width = $state(0);
  // as big as fits the width, never bigger than maxUnit
  const u = $derived(placement.width > 0 ? Math.min(maxUnit, width / placement.width) : 0);

  const knobs = $derived(encoderKnobs(placement));

  const focusIndex = $derived(selected >= 0 ? selected : 0);
</script>

<div class="keyboard" bind:clientWidth={width}>
  <div class="plate" style="width: {placement.width * u}px; height: {placement.height * u}px">
    {#each knobs as knob (knob.encoder)}
      <div
        class="knob"
        style="left: {(knob.cx - knob.length / 2) * u}px; top: {(knob.cy - knob.thickness / 2) * u}px;
          width: {knob.length * u}px; height: {knob.thickness * u}px; transform: rotate({knob.angle}deg)"
      ></div>
    {/each}
    {#if u > 0}
      {#each placement.items as item, i (`${item.kind}:${item.index}`)}
        {#if item.kind === "key"}
          <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            onselect={() => onselect(i)} />
        {:else}
          <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            onselect={() => onselect(i)} />
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .keyboard {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .plate {
    position: relative;
    flex: none;
  }

  .knob {
    position: absolute;
    border: 1px dashed var(--border-strong);
    border-radius: 999px;
    background: var(--surface-2);
  }
</style>
```

- [ ] **Step 2: Type-check and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run build
```

Expected: `built in`.

- [ ] **Step 3: Commit**

```bash
git add web/src/keyboard/Encoder.svelte \
  web/src/keyboard/Key.svelte \
  web/src/keyboard/KeyCap.svelte \
  web/src/keyboard/Keyboard.svelte
git commit -m "feat(web): draw any keyboard from its geometry, with knobs for encoders"
```

### Task 13: The keycode picker

**`Picker.svelte`** is a native `<dialog>` that lists the catalogue's categories as tabs.
- The search box ranks matches across every category with `searchKeycodes()`.
- Each keycode shows its key face, so the language labels match the keyboard. The key's current keycode is marked.
- A category's templates (`LSFT(kc)`) fill the any-keycode box with `LSFT(KC_)`, with the cursor inside the brackets.
- Escape, the close button or a click outside closes it.

**`AnyKeycode.svelte`** takes any keycode expression, such as `LT(1, KC_SPC)` or `LCTL(KC_C)`.
- It checks the expression through `POST /api/keycodes/parse` once typing pauses for 250 ms, and shows what it would do.
- The server's reason is shown when the expression is refused.
- "Use" is enabled only for an expression the server understood.

**Files:**
- Create: `web/src/picker/AnyKeycode.svelte`, `web/src/picker/Picker.svelte`

- [ ] **Step 1: The components**

Create `web/src/picker/AnyKeycode.svelte`:

```svelte
<script lang="ts">
  import { api } from "../api/api";
  import { ApiError } from "../api/errors";
  import type { Described } from "../api/types";
  import Button from "../ui/Button.svelte";

  interface Props {
    /** the expression typed so far; a template click fills it in */
    value: string;
    onpick: (code: string) => void;
  }

  let { value = $bindable(), onpick }: Props = $props();

  const DEBOUNCE_MS = 250;

  let result = $state<Described | null>(null);
  let problem = $state<string | null>(null);
  let checking = $state(false);

  // ask the server what the expression means, once typing pauses
  $effect(() => {
    const expression = value.trim();
    result = null;
    problem = null;
    if (!expression) {
      checking = false;
      return;
    }
    checking = true;
    let stale = false;
    const timer = setTimeout(() => {
      api.parse(expression).then(
        (parsed) => {
          if (stale) return;
          result = parsed;
          checking = false;
        },
        (error: unknown) => {
          if (stale) return;
          problem = error instanceof ApiError ? error.message : "Can't check this keycode.";
          checking = false;
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (result) onpick(result.code);
  }
</script>

<form class="any" onsubmit={submit}>
  <label for="any-keycode">Any keycode</label>
  <div class="row">
    <input
      id="any-keycode"
      bind:value
      autocomplete="off"
      spellcheck="false"
      placeholder="e.g. LT(1, KC_SPC) or LCTL(KC_C)"
      aria-describedby="any-keycode-result"
    />
    <Button variant="primary" type="submit" disabled={!result}>Use</Button>
  </div>
  <p id="any-keycode-result" class="result" aria-live="polite">
    {#if problem}
      <span class="problem">{problem}</span>
    {:else if result}
      <code>{result.code}</code>
      <span>tap {result.tap || "nothing"}{result.hold ? `, hold ${result.hold}` : ""}</span>
    {:else if checking}
      <span class="muted">Checking…</span>
    {:else}
      <span class="muted">Type a QMK keycode expression; it is checked as you type.</span>
    {/if}
  </p>
</form>

<style>
  .any {
    display: grid;
    gap: 6px;
  }

  label {
    font-size: 12px;
    font-weight: 650;
    color: var(--text-2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-family: var(--mono);
    font-size: 13px;
  }

  .result {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 20px;
    margin: 0;
    font-size: 13px;
  }

  .problem {
    color: var(--danger);
  }

  .muted {
    color: var(--text-3);
  }
</style>
```

Create `web/src/picker/Picker.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import AnyKeycode from "./AnyKeycode.svelte";
  import { searchKeycodes } from "./search";

  interface Props {
    open: boolean;
    /** what the picker is for, e.g. "Key row 1, column 2 on Base" */
    subject: string;
    categories: KeycodeCategory[];
    /** the keycode the key has now */
    current: string;
    names: Names;
    onpick: (code: string) => void;
  }

  let { open = $bindable(), subject, categories, current, names, onpick }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let searchInput = $state<HTMLInputElement>();
  let query = $state("");
  let category = $state(0);
  let anyKeycode = $state("");

  const results = $derived(query.trim() ? searchKeycodes(categories, query) : null);
  const shown = $derived<CatalogueKeycode[]>(results ?? categories[category]?.keycodes ?? []);
  const templates = $derived(results ? [] : (categories[category]?.templates ?? []));

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      query = "";
      anyKeycode = "";
      dialog.showModal();
      void tick().then(() => searchInput?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function pick(code: string) {
    open = false;
    onpick(code);
  }

  function useTemplate(template: string) {
    // e.g. "LSFT(kc)": fill in the any-keycode box and let the user type the inner keycode
    anyKeycode = template.replace("(kc)", "(KC_)");
    void tick().then(() => {
      const input = document.getElementById("any-keycode") as HTMLInputElement | null;
      input?.focus();
      input?.setSelectionRange(anyKeycode.length - 1, anyKeycode.length - 1);
    });
  }
</script>

<dialog
  bind:this={dialog}
  class="picker"
  aria-labelledby="picker-title"
  onclose={() => (open = false)}
  onclick={(e) => {
    if (e.target === dialog) open = false;
  }}
>
  <div class="panel">
    <header>
      <div>
        <h2 id="picker-title">Choose a keycode</h2>
        <p>{subject} · now <code>{current}</code></p>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </header>

    <div class="search">
      <input
        bind:this={searchInput}
        bind:value={query}
        type="search"
        placeholder="Search keycodes: name, label or alias"
        aria-label="Search keycodes"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    {#if !results}
      <div class="categories" role="tablist" aria-label="Keycode categories">
        {#each categories as c, i (c.name)}
          <button type="button" role="tab" aria-selected={i === category} class:active={i === category}
            onclick={() => (category = i)}>{c.name}</button>
        {/each}
      </div>
    {/if}

    <div class="grid-area" role={results ? "region" : "tabpanel"} aria-label={results ? "Search results" : categories[category]?.name}>
      {#if results && results.length === 0}
        <p class="empty">No keycode matches “{query}”. Try the Any keycode box below.</p>
      {/if}
      <div class="grid">
        {#each shown as k (k.code)}
          {@const face = keyFace(k, names)}
          <button
            type="button"
            class="kc tone-{face.tone}"
            data-tone={face.tone}
            class:current={k.code === current}
            title={k.description ? `${k.code}: ${k.description}` : k.code}
            aria-label="{k.tap || k.code} ({k.code})"
            onclick={() => pick(k.code)}
          >
            {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
            {#if face.shifted}<span class="kc-shifted">{face.shifted}</span>{/if}
            <span class="kc-tap">{face.main || "∅"}</span>
            <span class="kc-code">{k.code.replace(/^KC_/, "")}</span>
          </button>
        {/each}
      </div>
      {#if templates.length > 0}
        <div class="templates">
          <span>Wrap another key:</span>
          {#each templates as t (t)}
            <button type="button" onclick={() => useTemplate(t)}>{t}</button>
          {/each}
        </div>
      {/if}
    </div>

    <footer>
      <AnyKeycode bind:value={anyKeycode} onpick={pick} />
    </footer>
  </div>
</dialog>

<style>
  .picker {
    width: min(920px, calc(100vw - 32px));
    max-width: none;
    height: min(680px, calc(100vh - 48px));
    max-height: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .picker::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .panel {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    height: 100%;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px 10px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  header p {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-2);
  }

  .close svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .search {
    padding: 0 20px 10px;
  }

  .search input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 14px;
  }

  .categories {
    display: flex;
    gap: 4px;
    padding: 0 20px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
  }

  .categories button {
    flex: none;
    padding: 5px 11px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .categories button:hover {
    color: var(--text);
  }

  .categories button.active {
    border-color: var(--accent);
    background: var(--accent-weak);
    color: var(--accent);
  }

  .grid-area {
    overflow-y: auto;
    padding: 14px 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 6px;
  }

  .kc {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 58px;
    padding: 6px 4px 5px;
    border: 1.5px solid var(--line);
    border-radius: 8px;
    background: var(--fill);
    box-shadow: 0 2px 0 var(--key-shadow);
    color: var(--key-text);
    cursor: pointer;
  }

  .kc:hover {
    border-color: var(--accent);
  }

  .kc.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .tone-transparent {
    border-style: dashed;
    background: transparent;
    box-shadow: none;
  }

  .kc-tap {
    max-width: 100%;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.1;
    text-align: center;
  }

  .kc-shifted {
    color: var(--text-2);
    font-size: 11px;
    line-height: 1;
  }

  .kc-code {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 9.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alt-gr {
    position: absolute;
    top: 3px;
    right: 6px;
    color: var(--tone-layer);
    font-size: 11px;
    font-weight: 650;
  }

  .templates {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    color: var(--text-2);
    font-size: 12px;
  }

  .templates button {
    padding: 3px 8px;
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    background: transparent;
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
  }

  .templates button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty {
    margin: 0 0 12px;
    color: var(--text-2);
  }

  footer {
    padding: 14px 20px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: 0 0 16px 16px;
  }
</style>
```

- [ ] **Step 2: Type-check and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run build
```

Expected: `built in`.

- [ ] **Step 3: Commit**

```bash
git add web/src/picker/AnyKeycode.svelte \
  web/src/picker/Picker.svelte
git commit -m "feat(web): keycode picker with search, categories and any-keycode entry"
```

### Task 14: The Keymap Edit view and the app

**`KeymapPage.svelte`** puts the keymap together:
- the layer tabs;
- the keyboard drawing for the active layer;
- the colour legend;
- the Inspector, as a sidebar on wide windows and below the keyboard on narrow ones;
- the picker.

**Keyboard shortcuts:** the arrow keys move the selection, Enter opens the picker, and Delete clears the key.

**`LayerTabs.svelte`:** the layers as tabs with their names.
- The arrow keys move between the tabs.
- Double-click, F2 or the rename button next to the active tab renames the layer in place. Enter saves and Escape cancels.
- Clearing the name gives the layer its default name back.

**`Inspector.svelte`:**
- The selected key drawn large, with a plain-language title, its position and layer, its keycode and its description.
- What a tap and a hold do. For a tap dance key, what each of its four presses does.
- The actions: Change key, Change hold (`HoldEditor.svelte`: layer or modifiers, left or right hand), Make transparent, Clear, and Turn into tap dance.
- What the same position does on every other layer, with a click to jump there.

**`App.svelte`** replaces the placeholder:
- It starts the store, and draws the top bar, the navigation and the content area, capped at 1100 px.
- "Lost contact with Vial" shows while the events connection is down.
- "Keyboard unplugged" shows when the keyboard is unplugged. The keymap then stays on screen, greyed out and inert, until the keyboard is back.

**Files:**
- Create: `web/src/keymap/HoldEditor.svelte`, `web/src/keymap/Inspector.svelte`, `web/src/keymap/KeymapPage.svelte`, `web/src/keymap/KindLegend.svelte`, `web/src/keymap/LayerTabs.svelte`
- Modify: `web/src/App.svelte`

- [ ] **Step 1: The small keymap components**

Create `web/src/keymap/KindLegend.svelte`:

```svelte
<ul class="legend" aria-label="Key colours">
  <li><i class="normal"></i>normal key</li>
  <li><i class="mod"></i>modifier on hold</li>
  <li><i class="layer"></i>layer key</li>
  <li><i class="tap-dance"></i>tap dance</li>
  <li><i class="macro"></i>macro</li>
  <li><i class="transparent"></i>transparent (falls through)</li>
</ul>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    color: var(--text-2);
    font-size: 12px;
    list-style: none;
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  i {
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--key-border);
    border-radius: 3px;
    background: var(--key-bg);
  }

  .mod {
    border-color: var(--tone-mod);
    background: color-mix(in srgb, var(--tone-mod) 25%, var(--key-bg));
  }

  .layer {
    border-color: var(--tone-layer);
    background: color-mix(in srgb, var(--tone-layer) 25%, var(--key-bg));
  }

  .tap-dance {
    border-color: var(--tone-tap-dance);
    background: color-mix(in srgb, var(--tone-tap-dance) 25%, var(--key-bg));
  }

  .macro {
    border-color: var(--tone-macro);
    background: color-mix(in srgb, var(--tone-macro) 25%, var(--key-bg));
  }

  .transparent {
    border-style: dashed;
    background: transparent;
  }
</style>
```

Create `web/src/keymap/LayerTabs.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import type { Layer } from "../api/types";

  interface Props {
    layers: Layer[];
    active: number;
    canRename: boolean;
    onselect: (index: number) => void;
    /** an empty name gives the layer its default name back */
    onrename: (index: number, name: string) => void;
  }

  let { layers, active, canRename, onselect, onrename }: Props = $props();

  let editing = $state<number | null>(null);
  let draft = $state("");
  let input = $state<HTMLInputElement>();

  async function startRename(index: number) {
    if (!canRename) return;
    onselect(index);
    editing = index;
    draft = layers[index].customName ? layers[index].name : "";
    await tick();
    input?.select();
  }

  function finish(save: boolean) {
    if (editing === null) return;
    const index = editing;
    editing = null;
    const layer = layers[index];
    const name = draft.trim();
    if (save && name !== (layer.customName ? layer.name : "")) onrename(index, name);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter") finish(true);
    else if (event.key === "Escape") {
      event.stopPropagation();
      finish(false);
    }
  }

  function tabKeys(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      const next = (index + step + layers.length) % layers.length;
      onselect(next);
      document.getElementById(`layer-tab-${next}`)?.focus();
    } else if (event.key === "F2") {
      void startRename(index);
    }
  }
</script>

<div class="tabs" role="tablist" aria-label="Layers">
  {#each layers as layer (layer.index)}
    {#if editing === layer.index}
      <div class="tab active editing">
        <span class="number">{layer.index}</span>
        <input
          bind:this={input}
          bind:value={draft}
          maxlength="40"
          placeholder={layer.index === 0 ? "Base" : `Layer ${layer.index}`}
          aria-label="Name of layer {layer.index}"
          onblur={() => finish(true)}
          {onkeydown}
        />
      </div>
    {:else}
      <button
        id="layer-tab-{layer.index}"
        type="button"
        role="tab"
        class="tab"
        class:active={layer.index === active}
        aria-selected={layer.index === active}
        tabindex={layer.index === active ? 0 : -1}
        title={canRename ? "Double-click to rename" : undefined}
        onclick={() => onselect(layer.index)}
        ondblclick={() => startRename(layer.index)}
        onkeydown={(e) => tabKeys(e, layer.index)}
      >
        <span class="number">{layer.index}</span>
        <span class="name">{layer.name}</span>
      </button>
      {#if layer.index === active && canRename}
        <button
          type="button"
          class="rename"
          aria-label="Rename layer {layer.index}"
          title="Rename"
          onclick={() => startRename(layer.index)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" />
          </svg>
        </button>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-2);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 5px 14px 5px 6px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    font-weight: 550;
    cursor: pointer;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    border-color: var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  .number {
    display: inline-grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tone-layer) 14%, transparent);
    color: var(--tone-layer);
    font-size: 12px;
    font-weight: 700;
  }

  .editing input {
    width: 150px;
    padding: 3px 6px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
    outline: none;
  }

  .rename {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: -4px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .rename:hover {
    background: var(--surface);
    color: var(--text);
  }

  .rename svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
```

Create `web/src/keymap/HoldEditor.svelte`:

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "../api/api";
  import { ApiError } from "../api/errors";
  import type { Described, Layer } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { holdExpression, holdOf, MODS, type Hold, type Mod } from "./hold";

  interface Props {
    /** the key's current action */
    current: Described;
    /** the keycode it types when tapped */
    tap: string;
    layers: Layer[];
    disabled: boolean;
    onapply: (code: string) => void;
    oncancel: () => void;
  }

  let { current, tap, layers, disabled, onapply, oncancel }: Props = $props();

  // the form starts from the key's hold action; it is remade for another key
  const initial = untrack(() => holdOf(current));
  const firstOtherLayer = untrack(() => Math.min(1, layers.length - 1));
  let type = $state<"layer" | "mods" | "none">(initial?.type ?? "layer");
  let layer = $state(initial?.type === "layer" ? initial.layer : firstOtherLayer);
  let mods = $state<Mod[]>(initial?.type === "mods" ? initial.mods : ["SFT"]);
  let right = $state(initial?.type === "mods" ? initial.right : false);

  const hold = $derived<Hold>(
    type === "layer" ? { type, layer } : type === "mods" ? { type, mods, right } : null,
  );
  const expression = $derived(holdExpression(tap, hold));

  let preview = $state<Described | null>(null);
  let problem = $state<string | null>(null);

  // the server parses the expression: it shows what the key will do, or why it can't
  $effect(() => {
    const asked = expression;
    let stale = false;
    api.parse(asked).then(
      (result) => {
        if (stale) return;
        preview = result;
        problem = null;
      },
      (error: unknown) => {
        if (stale) return;
        preview = null;
        problem = error instanceof ApiError ? error.message : "Can't check this keycode.";
      },
    );
    return () => (stale = true);
  });

  function toggle(mod: Mod) {
    mods = mods.includes(mod) ? mods.filter((m) => m !== mod) : MODS.map((m) => m.mod).filter((m) => m === mod || mods.includes(m));
  }
</script>

<form
  class="hold-editor"
  aria-label="Change hold action"
  onsubmit={(e) => {
    e.preventDefault();
    if (preview) onapply(preview.code);
  }}
>
  <fieldset class="choice">
    <legend>When held</legend>
    <label><input type="radio" bind:group={type} value="layer" /> Switch to a layer</label>
    <label><input type="radio" bind:group={type} value="mods" /> Hold modifiers</label>
    <label><input type="radio" bind:group={type} value="none" /> Nothing (tap only)</label>
  </fieldset>

  {#if type === "layer"}
    <label class="field">
      <span>Layer</span>
      <select bind:value={layer}>
        {#each layers as l (l.index)}
          <option value={l.index}>{l.index} · {l.name}</option>
        {/each}
      </select>
    </label>
  {:else if type === "mods"}
    <div class="mods" role="group" aria-label="Modifiers">
      {#each MODS as m (m.mod)}
        <label class="mod" class:on={mods.includes(m.mod)}>
          <input type="checkbox" checked={mods.includes(m.mod)} onchange={() => toggle(m.mod)} />
          {m.label}
        </label>
      {/each}
      <label class="side"><input type="checkbox" bind:checked={right} /> right-hand</label>
    </div>
  {/if}

  <p class="result" aria-live="polite">
    <code>{expression}</code>
    {#if problem}
      <span class="problem">{problem}</span>
    {:else if preview}
      <span>→ tap {preview.tap}{preview.hold ? `, hold ${preview.hold}` : ""}</span>
    {/if}
  </p>

  <div class="buttons">
    <Button variant="primary" size="sm" type="submit" disabled={disabled || !preview}>Apply</Button>
    <Button variant="ghost" size="sm" onclick={oncancel}>Cancel</Button>
  </div>
</form>

<style>
  .hold-editor {
    display: grid;
    gap: 10px;
    margin-top: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }

  .choice {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 4px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }

  .field {
    display: grid;
    gap: 4px;
    color: var(--text-2);
    font-size: 12px;
  }

  select {
    padding: 5px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
  }

  .mods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mod {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12px;
    cursor: pointer;
  }

  .mod.on {
    border-color: var(--tone-mod);
    background: color-mix(in srgb, var(--tone-mod) 15%, var(--surface));
  }

  .mod input {
    margin: 0;
  }

  .side {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-2);
    font-size: 12px;
  }

  .result {
    display: grid;
    gap: 2px;
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }

  .problem {
    color: var(--danger);
  }

  .buttons {
    display: flex;
    gap: 6px;
  }
</style>
```

- [ ] **Step 2: The Inspector**

Create `web/src/keymap/Inspector.svelte`:

```svelte
<script lang="ts">
  import type { Described, KeyboardModel } from "../api/types";
  import KeyCap from "../keyboard/KeyCap.svelte";
  import { actionSummary, keyFace, keyTitle, layerLabel, type Names } from "../keyboard/labels";
  import { actionAt, positionLine, type KeyRef } from "../keyboard/refs";
  import Button from "../ui/Button.svelte";
  import { tapCodeOf } from "./hold";
  import HoldEditor from "./HoldEditor.svelte";
  import { freeTapDance, tapDanceSlots } from "./tapdance";

  interface Props {
    model: KeyboardModel;
    names: Names;
    layer: number;
    selection: KeyRef;
    canEdit: boolean;
    onchangekey: () => void;
    onsetcode: (code: string, action: string) => Promise<boolean>;
    ontapdance: () => void;
    onjump: (layer: number) => void;
  }

  let { model, names, layer, selection, canEdit, onchangekey, onsetcode, ontapdance, onjump }: Props = $props();

  let editingHold = $state(false);

  function actionOn(index: number): Described {
    return actionAt(model, index, selection) as Described;
  }

  const current = $derived(actionOn(layer));
  const face = $derived(keyFace(current, names));
  const summary = $derived(actionSummary(current, names));
  const tapCode = $derived(selection.kind === "key" ? tapCodeOf(current.code) : null);
  const freeSlot = $derived(freeTapDance(model));
  const tapDance = $derived(
    current.kind === "tap-dance" && current.index != null ? model.tapDance[current.index] : undefined,
  );

  const others = $derived(
    model.layers
      .filter((l) => l.index !== layer)
      .map((l) => {
        const d = actionOn(l.index);
        const otherFace = keyFace(d, names);
        const otherSummary = actionSummary(d, names);
        // in words, unless the key label says it all
        const detail = otherSummary.hold
          ? `hold: ${otherSummary.hold}`
          : otherSummary.tap !== otherFace.main ? otherSummary.tap : "";
        return { index: l.index, label: layerLabel(l.index, names), face: otherFace, detail };
      }),
  );

  async function applyHold(code: string) {
    if (await onsetcode(code, "Changing the hold action")) editingHold = false;
  }
</script>

<aside class="inspector" aria-label="Selected key">
  <header>
    <KeyCap {face} size={68} round={selection.kind === "encoder"} />
    <div class="heading">
      <h2>{keyTitle(current, names)}</h2>
      <p class="position">{positionLine(model, selection, names.layer(layer))}</p>
    </div>
  </header>

  <section class="code">
    <code>{current.code}</code>
    {#if current.description}<p>{current.description}</p>{/if}
  </section>

  {#if tapDance}
    <section class="tap-dance" aria-label="Tap dance {tapDance.index}">
      <h3>What each press does</h3>
      <dl class="rows">
        {#each tapDanceSlots(tapDance) as slot (slot.label)}
          <dt>{slot.label}</dt>
          <dd class:none={slot.action.kind === "none"}>
            {slot.action.kind === "none" ? "nothing" : actionSummary(slot.action, names).tap}
          </dd>
        {/each}
      </dl>
      <p class="term">Decides after {tapDance.tappingTerm} ms</p>
    </section>
  {:else}
    <dl class="rows">
      <dt>{selection.kind === "encoder" ? "Does" : "Tap"}</dt>
      <dd>{summary.tap}</dd>
      {#if summary.hold || tapCode}
        <dt>Hold</dt>
        <dd class:none={!summary.hold}>{summary.hold ?? "Same as tap"}</dd>
      {/if}
    </dl>
  {/if}

  <div class="buttons">
    <Button variant="primary" disabled={!canEdit} onclick={onchangekey}>Change key</Button>
    {#if tapCode}
      <Button disabled={!canEdit} aria-expanded={editingHold} onclick={() => (editingHold = !editingHold)}>
        Change hold
      </Button>
    {/if}
    <Button disabled={!canEdit || current.kind === "transparent"} onclick={() => onsetcode("KC_TRNS", "Making the key transparent")}>
      Make transparent
    </Button>
    <Button disabled={!canEdit || current.kind === "none"} onclick={() => onsetcode("KC_NO", "Clearing the key")}>
      Clear
    </Button>
    {#if selection.kind === "key" && current.kind !== "tap-dance"}
      <Button
        disabled={!canEdit || freeSlot === null}
        title={freeSlot === null ? "Every tap dance is already in use" : `Uses tap dance ${freeSlot}`}
        onclick={ontapdance}
      >
        Turn into tap dance
      </Button>
    {/if}
  </div>

  {#if editingHold && tapCode}
    {#key `${layer}:${selection.kind}:${selection.index}`}
      <HoldEditor
        {current}
        tap={tapCode}
        layers={model.layers}
        disabled={!canEdit}
        onapply={applyHold}
        oncancel={() => (editingHold = false)}
      />
    {/key}
  {/if}

  {#if others.length > 0}
    <section class="others">
      <h3>On the other layers</h3>
      <ul>
        {#each others as other (other.index)}
          <li>
            <button type="button" onclick={() => onjump(other.index)}>
              <span class="other-layer">{other.label}</span>
              <span class="chip tone-{other.face.tone}" data-tone={other.face.tone}>{other.face.main || "—"}</span>
              <span class="other-summary">{other.detail}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .inspector {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .heading {
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 17px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  .position {
    margin: 4px 0 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .code code {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    font-weight: 600;
    word-break: break-all;
  }

  .code p {
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .rows {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13.5px;
  }

  dt {
    color: var(--text-2);
    font-weight: 550;
  }

  dd {
    margin: 0;
    font-weight: 600;
  }

  dd.none {
    color: var(--text-3);
    font-weight: 450;
  }

  .tap-dance {
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--tone-tap-dance) 35%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--tone-tap-dance) 6%, var(--surface));
  }

  .term {
    margin: 8px 0 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  h3 {
    margin: 0 0 8px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .others ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .others button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .others button:hover {
    background: var(--surface-2);
  }

  .other-layer {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .other-summary {
    grid-column: 1 / -1;
    color: var(--text-3);
    font-size: 12px;
  }

  .other-summary:empty {
    display: none;
  }

  .chip {
    min-width: 30px;
    max-width: 120px;
    overflow: hidden;
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--fill);
    font-size: 12.5px;
    font-weight: 650;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.tone-transparent {
    border-style: dashed;
    background: transparent;
    color: var(--text-3);
  }

  .chip.tone-none {
    color: var(--text-3);
  }
</style>
```

- [ ] **Step 3: The page**

Create `web/src/keymap/KeymapPage.svelte`:

```svelte
<script lang="ts">
  import { tick } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { placeKeyboard } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { keyFace, keyTitle, layerLabel, namesOf, type KeyFace } from "../keyboard/labels";
  import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
  import Picker from "../picker/Picker.svelte";
  import Inspector from "./Inspector.svelte";
  import KindLegend from "./KindLegend.svelte";
  import LayerTabs from "./LayerTabs.svelte";
  import { neighbour, type Direction } from "./navigation";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  let layer = $state(0);
  let selection = $state<KeyRef | null>(null);
  let pickerOpen = $state(false);

  const names = $derived(namesOf(model));
  const placement = $derived(placeKeyboard(model));
  const actions = $derived(placement.items.map((item) => actionAt(model, layer, item)));
  const EMPTY: KeyFace = { main: "", shifted: null, altGr: null, hold: null, tone: "none" };
  const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY)));
  // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
  const labels = $derived(
    placement.items.map((item, i) => {
      const action = actions[i];
      const { what, where } = whereIs(model, item);
      return `${action ? keyTitle(action, names) : "Empty"} (${what.toLowerCase()} ${where})`;
    }),
  );
  const selectedIndex = $derived(
    selection ? placement.items.findIndex((i) => i.kind === selection?.kind && i.index === selection.index) : -1,
  );

  // a layer or key that no longer exists (another keyboard, other layout options) falls back to the first one
  $effect(() => {
    if (layer >= model.layers.length) layer = 0;
    if (selectedIndex === -1 && placement.items.length > 0) {
      const first = placement.items[0];
      selection = { kind: first.kind, index: first.index };
    }
  });

  function select(index: number) {
    const item = placement.items[index];
    if (item) selection = { kind: item.kind, index: item.index };
  }

  async function focusSelected() {
    await tick();
    if (selection) document.querySelector<HTMLElement>(`[data-ref="${selection.kind}:${selection.index}"]`)?.focus();
  }

  function setCode(code: string, action = "Changing the key") {
    return selection ? keyboard.setCode(layer, selection, code, action) : Promise.resolve(false);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function onkeydown(event: KeyboardEvent) {
    // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
    if (document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, dialog, [role=tab]")) return;
    const onKey = target === document.body || target.hasAttribute("data-ref");
    const direction = ARROWS[event.key];
    if (direction && selectedIndex >= 0) {
      event.preventDefault();
      select(neighbour(placement.items, selectedIndex, direction));
      void focusSelected();
    } else if (event.key === "Enter" && onKey && selection && keyboard.canEdit) {
      event.preventDefault();
      pickerOpen = true;
    } else if (event.key === "Delete" && onKey && selection) {
      event.preventDefault();
      void setCode("KC_NO", "Clearing the key");
    }
  }

  const current = $derived(selection ? actionAt(model, layer, selection) : undefined);
  const subject = $derived.by(() => {
    if (!selection) return "";
    const { what, where } = whereIs(model, selection);
    return `${what} ${where} on ${layerLabel(layer, names)}`;
  });
</script>

<svelte:window {onkeydown} />

<section class="keymap" aria-labelledby="keymap-title">
  <header class="head">
    <h1 id="keymap-title">Keymap</h1>
    <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete clears it.</p>
  </header>

  <LayerTabs
    layers={model.layers}
    active={layer}
    canRename={keyboard.canEdit}
    onselect={(i) => (layer = i)}
    onrename={(i, name) => keyboard.renameLayer(i, name)}
  />

  <div class="workspace">
    <div class="board">
      <Keyboard {placement} {faces} {labels} selected={selectedIndex} onselect={select} />
      <KindLegend />
    </div>

    {#if selection && current}
      {#key `${selection.kind}:${selection.index}`}
        <Inspector
          {model}
          {names}
          {layer}
          {selection}
          canEdit={keyboard.canEdit && keyboard.pending === 0}
          onchangekey={() => (pickerOpen = true)}
          onsetcode={setCode}
          ontapdance={() => selection && keyboard.turnIntoTapDance(layer, selection)}
          onjump={(i) => (layer = i)}
        />
      {/key}
    {/if}
  </div>
</section>

{#if selection && current}
  <Picker
    bind:open={pickerOpen}
    {subject}
    categories={keyboard.catalogue}
    current={current.code}
    {names}
    onpick={(code) => {
      void setCode(code).then(() => focusSelected());
    }}
  />
{/if}

<style>
  .keymap {
    display: grid;
    gap: 16px;
  }

  .head h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  .head p {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .board {
    display: grid;
    gap: 14px;
    min-width: 0;
    padding: 16px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  @media (min-width: 1000px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 290px;
    }
  }
</style>
```

- [ ] **Step 4: The app**

Replace the whole of `web/src/App.svelte` with:

```svelte
<script lang="ts">
  import KeymapPage from "./keymap/KeymapPage.svelte";
  import { keyboard } from "./lib/keyboard.svelte";
  import Banner from "./shell/Banner.svelte";
  import Nav, { type Section } from "./shell/Nav.svelte";
  import Toasts from "./shell/Toasts.svelte";
  import TopBar from "./shell/TopBar.svelte";

  $effect(() => keyboard.start());

  // only the sections that are built; later phases add theirs
  const sections = $derived<Section[]>([{ id: "keymap", label: "Keymap", count: keyboard.model?.layers.length }]);
  let section = $state("keymap");

  const status = $derived(
    keyboard.link === "closed"
      ? "offline"
      : keyboard.link === "connecting" && !keyboard.model
        ? "connecting"
        : keyboard.connected
          ? "connected"
          : "disconnected",
  );
  // the loaded keyboard stays on screen, greyed out, while it can't be edited
  const blocked = $derived(keyboard.model !== null && status !== "connected");
</script>

<TopBar
  name={keyboard.model?.name ?? null}
  {status}
  fake={keyboard.session?.fake ?? false}
  languages={keyboard.languages}
  language={keyboard.language}
  onlanguage={(lang) => keyboard.setLanguage(lang)}
/>

<div class="shell">
  <Nav {sections} active={section} onselect={(id) => (section = id)} />

  <main class="content">
    {#if status === "offline"}
      <Banner tone="warning" title="Lost contact with Vial" message="Reconnecting… If this lasts, check that Vial is still running." />
    {:else if blocked}
      <Banner
        tone="danger"
        title="Keyboard unplugged"
        message="Changes are blocked until it is plugged back in. It is then read again."
      />
    {/if}
    {#if keyboard.loadError}
      <Banner tone="danger" title="Couldn't load the keyboard" message={keyboard.loadError} />
    {/if}

    {#if keyboard.model}
      <div class="page" class:blocked inert={blocked}>
        <KeymapPage model={keyboard.model} />
      </div>
    {:else if status === "disconnected"}
      <div class="empty">
        <h1>No keyboard found</h1>
        <p>Plug in a Vial keyboard. It shows up here as soon as it is found.</p>
      </div>
    {:else if !keyboard.loadError}
      <div class="empty" aria-busy="true">
        <h1>Reading the keyboard…</h1>
      </div>
    {/if}
  </main>
</div>

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    max-width: var(--shell-width);
    margin: 0 auto;
    padding: 16px var(--shell-gutter) 48px;
  }

  .content {
    display: grid;
    gap: 14px;
    min-width: 0;
    width: 100%;
    max-width: var(--content-max);
  }

  .page.blocked {
    filter: grayscale(1);
    opacity: 0.55;
  }

  .empty {
    padding: 64px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    text-align: center;
    color: var(--text-2);
  }

  .empty h1 {
    margin: 0 0 6px;
    color: var(--text);
    font-size: 18px;
  }

  .empty p {
    margin: 0;
  }

  @media (min-width: 1000px) {
    .shell {
      grid-template-columns: var(--nav-width) minmax(0, var(--content-max));
      gap: var(--shell-gap);
      padding-top: 24px;
    }
  }

  @media (max-width: 600px) {
    .shell {
      --shell-gutter: 12px;
    }
  }
</style>
```

- [ ] **Step 5: Type-check, test and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm test
```

Expected: `Tests  98 passed (98)`.

```bash
cd web && npm run build
```

Expected: `built in`.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.svelte \
  web/src/keymap/HoldEditor.svelte \
  web/src/keymap/Inspector.svelte \
  web/src/keymap/KeymapPage.svelte \
  web/src/keymap/KindLegend.svelte \
  web/src/keymap/LayerTabs.svelte
git commit -m "feat(web): app shell, Keymap Edit view, Inspector and layer names"
```

### Task 15: End-to-end tests against `vial_web.py --fake`

`e2e/global-setup.ts` starts two servers, each as `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>`:
- the default simulated Corne (`VIAL_URL`);
- `e2e/fixtures/macropad.vial.json` (`VIAL_MACROPAD_URL`): a macropad with encoders, rotated keys, an ISO Enter, a decal and a layout option.

The global setup reads each server's link (with its session token) from the output, and stops both servers and removes their folders afterwards. The fixtures `app` and `macropad` open a page from that link.

The tests cover the roadmap's e2e list:
- load, and edit a key through the picker;
- any keycode, and change hold;
- layers and renaming;
- the unplugged banner (through `PUT /api/simulator/connection`);
- the Polish language;
- encoders;
- the theme switch.

Width and fit tests run at 800, 1280 and 2560 px:
- every label fits on its key;
- the content is at most 1100 px wide;
- on a narrow window, the Inspector moves below the keyboard and the page has no horizontal scroll.

Screenshots go to `web/e2e/screenshots/`, in the light and the dark theme, and are not committed.

**Files:**
- Create: `web/e2e/display.spec.ts`, `web/e2e/fixtures.ts`, `web/e2e/fixtures/macropad.vial.json`, `web/e2e/global-setup.ts`, `web/e2e/keymap.spec.ts`, `web/e2e/macropad.spec.ts`, `web/e2e/theme.spec.ts`, `web/playwright.config.ts`

- [ ] **Step 1: Playwright configuration and the global setup**

Create `web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// Runs the built UI (npm run build) against `vial_web.py --fake`, started by e2e/global-setup.ts.
// Never touches a real keyboard: the server only ever runs with --fake and a temporary data dir.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
});
```

Create `web/e2e/global-setup.ts`:

```ts
// Starts two `vial_web.py --fake --no-browser` servers, each on a free port with its own temporary data dir, and
// stops them afterwards: the default simulated Corne (VIAL_URL) and a macropad with encoders, rotated keys, an ISO
// Enter, a decal and a layout option (VIAL_MACROPAD_URL). The URLs carry the session token.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPython, pythonRoot } from "../scripts/python.mjs";

const STARTUP_MS = 30_000;
const URL_LINE = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/;
export const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "macropad.vial.json");

async function startServer(extraArgs: string[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
  const server = spawn(
    findPython(),
    ["vial_web.py", "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
    { cwd: pythonRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
  );

  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vial_web.py did not start in time:\n${output}`)), STARTUP_MS);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const found = URL_LINE.exec(output);
      if (found) {
        clearTimeout(timer);
        resolve(found[0]);
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vial_web.py exited (${code}) before serving:\n${output}`));
    });
  });

  return {
    url,
    stop: async () => {
      server.kill();
      await new Promise((resolve) => (server.exitCode === null ? server.once("exit", resolve) : resolve(null)));
      // Windows may hold the files of the stopped server for a moment
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const corne = await startServer([]);
  const macropad = await startServer(["--definition", MACROPAD_DEFINITION]).catch(async (error: unknown) => {
    await corne.stop();
    throw error;
  });
  process.env.VIAL_URL = corne.url;
  process.env.VIAL_MACROPAD_URL = macropad.url;
  return async () => {
    await Promise.all([corne.stop(), macropad.stop()]);
  };
}
```

Create `web/e2e/fixtures/macropad.vial.json`:

```json
{
  "name": "Simulated Macropad",
  "matrix": {"rows": 4, "cols": 6},
  "layouts": {
    "labels": ["Split Backspace"],
    "keymap": [
      ["0,0", "0,1", "0,2", {"w": 2}, "0,3\n\n\n0,0", {"x": 0.5}, "0,3\n\n\n0,1", "0,4\n\n\n0,1", {"x": 0.5}, "0,0\n\n\n\n\n\n\n\n\ne", "0,1\n\n\n\n\n\n\n\n\ne"],
      ["1,0", "1,1", "1,2", {"x": 0.25, "w": 1.25, "h": 2, "w2": 1.5, "h2": 1, "x2": -0.25}, "1,3", {"x": 1.75, "d": true}, "decal"],
      ["2,0", "2,1", "2,2"],
      [{"r": 20, "rx": 3, "ry": 3.2}, "3,0", "3,1", {"x": 2}, "1,0\n\n\n\n\n\n\n\n\ne", "1,1\n\n\n\n\n\n\n\n\ne"]
    ]
  }
}
```

Create `web/e2e/fixtures.ts`:

```ts
import { test as base, expect, type Page } from "@playwright/test";

async function open(page: Page, url: string | undefined): Promise<Page> {
  if (!url) throw new Error("the global setup did not start the server");
  await page.goto(url); // the link with the token sets the session cookie
  await expect(page.locator("button.key").first()).toBeVisible();
  return page;
}

/** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
 * simulated macropad with encoders */
export const test = base.extend<{ app: Page; macropad: Page }>({
  app: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_URL));
  },
  macropad: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_MACROPAD_URL));
  },
});

export { expect };

/** A URL of the server the page shows: the requests of page.request carry the page's session cookie */
export function serverUrl(page: Page, path: string): string {
  return new URL(path, page.url()).toString();
}

async function keyboardModel(page: Page) {
  return (await page.request.get(serverUrl(page, "/api/keyboard"))).json();
}

/** Index of the key at a matrix position in the keyboard model */
export async function keyIndex(page: Page, row: number, col: number): Promise<number> {
  const model = await keyboardModel(page);
  const index = model.keys.findIndex((k: { row: number; col: number }) => k.row === row && k.col === col);
  if (index < 0) throw new Error(`no key at row ${row}, column ${col}`);
  return index;
}

/** The keycode the server reports for a key on a layer */
export async function codeAt(page: Page, layer: number, index: number): Promise<string> {
  return (await keyboardModel(page)).layers[layer].keys[index].code;
}

/** The keycode the server reports for an encoder direction on a layer */
export async function encoderCodeAt(page: Page, layer: number, index: number): Promise<string> {
  return (await keyboardModel(page)).layers[layer].encoders[index].code;
}

/** Screenshots of the page in the light and the dark theme (the app follows the system's): <name>-light.png and
 * <name>-dark.png in e2e/screenshots/ */
export async function screenshots(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // animations "disabled" finishes colour transitions, which the switch of theme just started
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, animations: "disabled", ...options });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** The key labels that don't fit on their key. Tap dance and macro names wrap to two lines and shrink, and the main
 * legend makes room for them, rather than anything being cut off. (A line that is cut off shows as a whole line of
 * overflow; letters reaching a little past their line box, a few pixels, don't count.) */
export async function labelsCutOff(page: Page): Promise<string[]> {
  const labels = page.locator("button.key .hold, button.key .tap, button.key .shifted");
  const cut = await labels.evaluateAll((elements) => elements.filter((l) => {
    const key = l.closest("button")!.querySelector(".legend")!.getBoundingClientRect();
    const box = l.getBoundingClientRect();
    const font = parseFloat(getComputedStyle(l).fontSize);
    return l.scrollHeight - l.clientHeight > font * 0.3 || l.scrollWidth > l.clientWidth + 1 ||
      box.bottom > key.bottom + 1 || box.top < key.top - 1;
  }).map((l) => l.textContent ?? ""));
  return cut;
}
```

- [ ] **Step 2: The tests**

Create `web/e2e/keymap.spec.ts`:

```ts
import { codeAt, expect, keyIndex, screenshots, serverUrl, test } from "./fixtures";

test("loads the simulated Corne and draws its 42 keys", async ({ app }) => {
  await expect(app.locator(".topbar")).toContainText("Simulated Corne");
  await expect(app.locator(".topbar")).toContainText("simulated keyboard");
  await expect(app.locator("button.key")).toHaveCount(42);
});

test("picking a keycode from the search changes the key on the keyboard", async ({ app }) => {
  const index = await keyIndex(app, 0, 1); // base layer: W with Gui on hold
  const key = app.locator(`[data-ref="key:${index}"]`);
  await key.click();
  await app.getByRole("button", { name: "Change key" }).click();
  const picker = app.getByRole("dialog");
  await expect(picker).toBeVisible();
  await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("esc");
  await picker.getByRole("button", { name: "Esc (KC_ESCAPE)" }).click();
  await expect(picker).toBeHidden();
  await expect(key).toContainText("Esc");
  expect(await codeAt(app, 0, index)).toBe("KC_ESCAPE");
});

test("the keyboard shortcuts select, change and clear keys", async ({ app }) => {
  const first = await keyIndex(app, 1, 1);
  const next = await keyIndex(app, 1, 2);
  await app.locator(`[data-ref="key:${first}"]`).click();
  await app.keyboard.press("ArrowRight");
  await expect(app.locator(`[data-ref="key:${next}"]`)).toBeFocused();
  await expect(app.locator(`[data-ref="key:${next}"]`)).toHaveAttribute("aria-pressed", "true");
  await app.keyboard.press("Enter");
  await expect(app.getByRole("dialog")).toBeVisible();
  await app.keyboard.press("Escape");
  await app.keyboard.press("Delete"); // straight after closing the picker: the key has the keyboard again
  await expect(app.getByRole("dialog")).toBeHidden();
  await expect.poll(() => codeAt(app, 0, next)).toBe("KC_NO");
});

test("any keycode: LT(1,KC_SPC) makes a layer-tap with a hold label", async ({ app }) => {
  const index = await keyIndex(app, 0, 2); // base layer: L
  const key = app.locator(`[data-ref="key:${index}"]`);
  await key.click();
  await app.getByRole("button", { name: "Change key" }).click();
  const picker = app.getByRole("dialog");
  await picker.getByLabel("Any keycode").fill("LT(1,KC_SPC)");
  await expect(picker.locator("#any-keycode-result")).toContainText("LT1(KC_SPACE)");
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(key.locator(".tap")).toHaveText("Space");
  await expect(key.locator(".hold")).toHaveText("Layer 1");
  expect(await codeAt(app, 0, index)).toBe("LT1(KC_SPACE)");
});

test("change hold turns a key into a mod-tap", async ({ app }) => {
  const index = await keyIndex(app, 2, 1); // base layer: F
  const key = app.locator(`[data-ref="key:${index}"]`);
  await key.click();
  await app.getByRole("button", { name: "Change hold" }).click();
  const form = app.getByRole("form", { name: "Change hold action" });
  await form.getByLabel("Hold modifiers").check();
  await form.getByLabel("Ctrl").check();
  await expect(form).toContainText("MT(MOD_LCTL | MOD_LSFT, KC_F)");
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(key.locator(".hold")).toHaveText("Ctrl+Shift");
  expect(await codeAt(app, 0, index)).toBe("C_S_T(KC_F)");
});

test("layer tabs switch layers, and a renamed layer keeps its name", async ({ app }) => {
  const index = await keyIndex(app, 4, 4); // layer 2 (navigation): Home
  await app.getByRole("tab", { name: "2 Layer 2" }).click();
  await expect(app.getByRole("tab", { name: "2 Layer 2" })).toHaveAttribute("aria-selected", "true");
  await expect(app.locator(`[data-ref="key:${index}"]`)).toContainText("Home");

  await app.getByRole("tab", { name: "2 Layer 2" }).dblclick();
  const keyboardReads: string[] = [];
  app.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/keyboard") keyboardReads.push(request.url());
  });
  const name = app.getByLabel("Name of layer 2");
  await name.fill("Nav");
  await name.press("Enter");
  await expect(app.getByRole("tab", { name: "2 Nav" })).toBeVisible();
  expect(keyboardReads).toEqual([]); // the rename's reply has the name to show: the keyboard isn't read again
  const names = await (await app.request.get(serverUrl(app, "/api/names"))).json();
  expect(names.layers["2"]).toBe("Nav");

  await app.reload();
  await expect(app.getByRole("tab", { name: "2 Nav" })).toBeVisible();
});

test("an unplugged keyboard greys out the keymap and blocks edits until it is back", async ({ app }) => {
  const plug = (connected: boolean) => app.request.put(serverUrl(app, "/api/simulator/connection"), { data: { connected } });
  try {
    expect((await plug(false)).ok()).toBe(true);
    await expect(app.getByRole("alert")).toContainText("Keyboard unplugged");
    await expect(app.locator(".page")).toHaveAttribute("inert", "");
    await expect(app.getByRole("button", { name: "Change key" })).toBeDisabled();
    await screenshots(app, "unplugged");
  } finally {
    await plug(true);
  }
  await expect(app.getByRole("alert")).toBeHidden();
  await expect(app.getByRole("button", { name: "Change key" })).toBeEnabled();
});

test("a keyboard language relabels the keys", async ({ app }) => {
  const index = await keyIndex(app, 5, 3); // base layer: E with AltGr on hold
  const key = app.locator(`[data-ref="key:${index}"]`);
  await expect(key.locator(".alt-gr")).toHaveCount(0);
  await app.getByLabel("Keyboard language").selectOption({ label: "Polish (QWERTY)" });
  await expect(key.locator(".alt-gr")).toHaveText("ę");
  await screenshots(app, "polish");
  // remembered by this browser
  await app.reload();
  await expect(app.getByLabel("Keyboard language")).toHaveValue("polish-qwerty");
  await expect(key.locator(".alt-gr")).toHaveText("ę");
});

test("clearing a layer's name gives it its default name back", async ({ app }) => {
  await app.getByRole("tab", { name: /^3 / }).dblclick();
  const name = app.getByLabel("Name of layer 3");
  await name.fill("Numbers");
  await name.press("Enter");
  await expect(app.getByRole("tab", { name: "3 Numbers" })).toBeVisible();
  await app.getByRole("tab", { name: "3 Numbers" }).dblclick();
  await app.getByLabel("Name of layer 3").fill("");
  await app.getByLabel("Name of layer 3").press("Enter");
  await expect(app.getByRole("tab", { name: "3 Layer 3" })).toBeVisible();
});
```

Create `web/e2e/display.spec.ts`:

```ts
import { expect, labelsCutOff, screenshots, test } from "./fixtures";

test.describe("width and fit", () => {
  test("1280 x 800: every label fits on its key", async ({ app }) => {
    await screenshots(app, "keymap-1280", { fullPage: true });
    expect(await labelsCutOff(app)).toEqual([]);
    // the whole name is in the tooltip
    await expect(app.getByRole("button", { name: /^Tap dance 0 · Tab \/ Caps Lock/ })).toHaveAttribute(
      "title", /Tab \/ Caps Lock/);
  });

  test("2560 x 1440: content stays at most 1100 px wide, and the keyboard fills its card", async ({ app }) => {
    await app.setViewportSize({ width: 2560, height: 1440 });
    await screenshots(app, "keymap-2560", { fullPage: true });
    const content = await app.locator("main.content").boundingBox();
    expect(content?.width).toBeLessThanOrEqual(1100);
    const card = await app.locator(".board").first().boundingBox();
    const keyboard = await app.locator(".plate").boundingBox();
    expect(keyboard!.width).toBeGreaterThanOrEqual(card!.width * 0.9);
    expect(keyboard!.width).toBeGreaterThanOrEqual(620);
    expect(await labelsCutOff(app)).toEqual([]);
  });

  test("800 wide: Inspector below the keyboard, no horizontal scroll", async ({ app }) => {
    await app.setViewportSize({ width: 800, height: 900 });
    const board = await app.locator(".board").first().boundingBox();
    const inspector = await app.getByRole("complementary", { name: "Selected key" }).boundingBox();
    expect(board && inspector).toBeTruthy();
    expect(inspector!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
    const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const keys = app.locator("button.key");
    for (const box of await Promise.all((await keys.all()).map((k) => k.boundingBox()))) {
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(800);
    }
    expect(await labelsCutOff(app)).toEqual([]);
    await screenshots(app, "keymap-800", { fullPage: true });
  });
});

test.describe("Inspector and picker", () => {
  test("a layer-tap key is titled in words; the picker", async ({ app }) => {
    await app.getByRole("button", { name: /^Space — hold for Layer 1/ }).click();
    await expect(app.getByRole("heading", { name: "Space — hold for Layer 1" })).toBeVisible();
    await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("row 3 · column 4 · Base layer");
    await screenshots(app, "inspector-layer-tap");
    await app.getByRole("button", { name: "Change key" }).click();
    await expect(app.getByRole("dialog")).toBeVisible();
    await screenshots(app, "picker");
  });

  test("a tap dance key is explained in place", async ({ app }) => {
    await app.getByRole("button", { name: /^Tap dance 0/ }).click();
    const tapDance = app.getByRole("region", { name: "Tap dance 0" });
    await expect(app.getByRole("heading", { name: "Tap dance 0 · Tab / Caps Lock" })).toBeVisible();
    const rows = await tapDance.locator("dt, dd").allTextContents();
    expect(rows.map((t) => t.trim())).toEqual([
      "Tap", "Tab", "Hold", "nothing", "Double tap", "Caps Lock", "Tap, then hold", "nothing",
    ]);
    await expect(tapDance).toContainText("Decides after 200 ms");
    await screenshots(app, "inspector-tap-dance");
  });
});
```

Create `web/e2e/macropad.spec.ts`:

```ts
import { encoderCodeAt, expect, screenshots, test } from "./fixtures";

// web/e2e/fixtures/macropad.vial.json: 3x3 keys, a 2u key that splits in two (a layout option), an ISO Enter, two
// rotated keys, a decal and two encoders
test("draws a keyboard with encoders, rotated keys and an ISO Enter", async ({ macropad }) => {
  await expect(macropad.locator(".topbar")).toContainText("Simulated Macropad");
  // 16 keys in the layout: no decal, and of the layout option only its first choice (one 2u key, not two 1u keys)
  await expect(macropad.locator("button.key")).toHaveCount(13);
  await expect(macropad.locator("button.encoder")).toHaveCount(4);
  await expect(macropad.locator(".knob")).toHaveCount(2);
  await screenshots(macropad, "macropad");
});

test("an encoder direction is selected and changed through the picker", async ({ macropad }) => {
  // encoders are listed in the layout's order: encoder 0 counter-clockwise, encoder 0 clockwise, ...
  const clockwise = macropad.locator('[data-ref="encoder:1"]');
  await clockwise.click();
  await expect(clockwise).toHaveAttribute("aria-pressed", "true");
  const inspector = macropad.getByRole("complementary", { name: "Selected key" });
  await expect(inspector).toContainText("encoder 0 · clockwise · Base layer");
  await inspector.getByRole("button", { name: "Change key" }).click();
  const picker = macropad.getByRole("dialog");
  await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("volu");
  await picker.getByRole("button", { name: /^Vol \+ \(/ }).click();
  await expect(picker).toBeHidden();
  await expect(clockwise).toContainText("Vol +");
  expect(await encoderCodeAt(macropad, 0, 1)).toBe("KC_VOLU");
  expect(await encoderCodeAt(macropad, 0, 0)).toBe("KC_NO");
});
```

Create `web/e2e/theme.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LIGHT_BG = "rgb(243, 244, 247)"; // --bg of the light palette
const DARK_BG = "rgb(16, 18, 23)"; // --bg of the dark palette

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeAttribute = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test("the theme can be chosen, and the choice is kept", async ({ app }) => {
  const problems: string[] = [];
  app.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await app.emulateMedia({ colorScheme: "light" });
  const theme = app.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
  expect(await background(app)).toBe(LIGHT_BG);

  await theme.getByRole("radio", { name: "Dark" }).check();
  expect(await themeAttribute(app)).toBe("dark");
  expect(await background(app)).toBe(DARK_BG);

  // applied by index.html before the first paint (the Content-Security-Policy lets that inline script run)
  await app.reload();
  expect(await themeAttribute(app)).toBe("dark");
  expect(await background(app)).toBe(DARK_BG);
  await expect(app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Light" }).check();
  await app.emulateMedia({ colorScheme: "dark" });
  expect(await background(app)).toBe(LIGHT_BG); // a chosen theme wins over the system's

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "System" }).check();
  expect(await themeAttribute(app)).toBeNull();
  expect(await background(app)).toBe(DARK_BG); // the system's again
  expect(problems.filter((p) => /Content Security Policy/i.test(p))).toEqual([]);
});
```

- [ ] **Step 3: Type-check** (`tsc -p tsconfig.node.json` covers `e2e/`)

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 4: Build and run the e2e tests**

```bash
cd web && npm run e2e
```

Expected: `17 passed`.

- [ ] **Step 5: Copy the screenshots for review.** The folder is excluded from git through `.git/info/exclude`.

```bash
mkdir -p /t/others/vial-gui/screenshots/phase2 && cp web/e2e/screenshots/*.png /t/others/vial-gui/screenshots/phase2/ && ls /t/others/vial-gui/screenshots/phase2 | wc -l
```

Expected: `18`.

Look at `keymap-800`, `keymap-1280` and `keymap-2560`, in both themes. Check that:
- the content is centred and capped;
- the labels fit;
- the Inspector sits beside the keyboard at 1280 and 2560, and below it at 800.

- [ ] **Step 6: Commit**

```bash
git add web/e2e/display.spec.ts \
  web/e2e/fixtures.ts \
  web/e2e/fixtures/macropad.vial.json \
  web/e2e/global-setup.ts \
  web/e2e/keymap.spec.ts \
  web/e2e/macropad.spec.ts \
  web/e2e/theme.spec.ts \
  web/playwright.config.ts
git commit -m "test(web): Playwright end-to-end tests against vial_web.py --fake"
```

### Task 16: CI job and the web README

The new `web` job runs on ubuntu-24.04 with Python 3.13 and Node 24. In order, it runs:
- `npm ci`;
- `npm run check`, `npm test` and `npm run build`;
- `npm run check:api`;
- the e2e tests. CI is the one place that runs `npx playwright install --with-deps chromium`.

It uploads the screenshots and the failure traces as an artifact. The Python venv only needs `requirements.txt`: the web job runs the server, not the Python tests.

**Files:**
- Create: `web/README.md`
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: The CI job**

Apply to `.github/workflows/test.yml`:

```diff
diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -30,3 +30,61 @@ jobs:
       run: |
         source venv/bin/activate
         pytest -v src/main/python/test
+
+  web:
+    runs-on: ubuntu-24.04
+
+    defaults:
+      run:
+        working-directory: web
+
+    steps:
+    - uses: actions/checkout@v4
+
+    - uses: actions/setup-python@v5
+      with:
+        python-version: '3.13'
+
+    - uses: actions/setup-node@v4
+      with:
+        node-version: '24'
+        cache: npm
+        cache-dependency-path: web/package-lock.json
+
+    # the server code generates the API types and serves the UI in the end-to-end tests (simulated keyboard only)
+    - name: Python venv
+      working-directory: .
+      run: |
+        sudo apt-get update
+        sudo apt-get install -y libusb-1.0-0-dev libudev-dev
+        python -m venv .venv
+        .venv/bin/pip install -r requirements.txt
+
+    - name: Install
+      run: npm ci
+
+    - name: Check (svelte-check, tsc)
+      run: npm run check
+
+    - name: Unit tests
+      run: npm test
+
+    - name: Build
+      run: npm run build
+
+    - name: API types are up to date
+      run: npm run check:api
+
+    - name: End-to-end tests
+      run: |
+        npx playwright install --with-deps chromium
+        npx playwright test
+
+    - uses: actions/upload-artifact@v4
+      if: always()
+      with:
+        name: e2e-screenshots
+        path: |
+          web/e2e/screenshots/
+          web/test-results/
+        if-no-files-found: ignore
```

- [ ] **Step 2: The README**

Create `web/README.md`:

````markdown
# Vial web UI

Svelte 5 (runes only) + TypeScript, built with Vite. `npm run build` writes `web/dist`, which
`vial_web.py` serves; without `dist` it shows a placeholder page.

## Setup

Node 24 and npm 11. Every dependency is pinned to an exact version (`.npmrc` has `save-exact`).

```sh
cd web
npm ci
```

The scripts that run server code (`gen:api`, `check:api`, `e2e`) need the repository's Python
virtual environment (`.venv` or `venv` at the repository root, with `test-requirements.txt`
installed), or a Python named by `VIAL_PYTHON`.

## Developing

The server only answers its own origin (it checks `Host` and `Origin` and wants its session
cookie), so the UI is not served by Vite's dev server. Instead, rebuild on every change and let
Vial serve the result:

```sh
npm run dev                      # vite build --watch: rewrites web/dist on every change
# in another terminal, from src/main/python:
python vial_web.py --fake        # open the printed link; reload the page after a rebuild
```

`--fake` runs a simulated keyboard and never touches real hardware. Add `--data-dir DIR` to keep
its lock, log and names out of your user folders.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Build into `dist/` |
| `npm run dev` | Build, then rebuild on every change |
| `npm run check` | `svelte-check`: types, and Svelte 5 runes-only syntax; fails on warnings |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run e2e` | Build, then run the Playwright tests (`e2e/`) against `vial_web.py --fake` |
| `npm run gen:api` | Regenerate `src/api/schema.d.ts` from the server's OpenAPI schema |
| `npm run check:api` | Fail if `src/api/schema.d.ts` is out of date |

## API types

`src/api/schema.d.ts` is generated: `npm run gen:api` runs `python -m server.dump_openapi`
(which builds the app around a never-connected simulator and writes its OpenAPI schema) and
`openapi-typescript` on the result. Regenerate and commit it whenever the server's schemas change;
CI runs `npm run check:api`.

## End-to-end tests

`e2e/global-setup.ts` starts two `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
default Corne, and `e2e/fixtures/macropad.vial.json` with encoders),
reads the links with the session token from their output and stops them afterwards. Screenshots, each in the
light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed).

`@playwright/test` is pinned to the version whose Chromium is already installed on the
development machine, so no browser is downloaded there. CI installs that Chromium with
`npx playwright install --with-deps chromium`.

## Layout

| Folder | What |
|---|---|
| `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
| `src/lib/` | The keyboard store (loaded model, connection, edits), toasts, and the theme (System, Light, Dark) |
| `src/keyboard/` | Drawing any keyboard from its geometry; key labels |
| `src/keymap/` | Keymap Edit view: layer tabs, Inspector, hold editor, keyboard navigation |
| `src/picker/` | Keycode picker: search, categories, any-keycode entry |
| `src/shell/` | Top bar, navigation, banners, toasts |
| `src/ui/` | Small shared controls |
````

- [ ] **Step 3: Run every check once more**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `554 passed, 1 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api && npx playwright test
```

Expected: `0 ERRORS 0 WARNINGS` and `Tests  98 passed (98)` and `built in` and `src/api/schema.d.ts is up to date` and `17 passed`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml \
  web/README.md
git commit -m "ci: web job: check, unit tests, build, API types up to date, end-to-end tests"
```

- [ ] **Step 5: Owner checklist (the owner runs this, not you).** This is the roadmap's phase 2 checklist. Anything it finds becomes the first task of phase 3.
  1. Close the Qt Vial app. Build the UI (`cd web && npm ci && npm run build`), then run `python src/main/python/vial_web.py`.
  2. The browser shows your W-CORNE with your real keymap.
  3. Change one key and change it back.
  4. Switch the language to Polish and check the labels.
  5. Unplug the keyboard and see the banner. Plug it back in and see the keymap return.

## Roadmap coverage

| Roadmap phase 2 item | Task |
|---|---|
| `web/` Svelte 5 + TypeScript + Vite, built to `web/dist` | 5 |
| API types generated with openapi-typescript, check that they're up to date | 4 (schema), 5 (`gen:api`, `check:api`), 16 (CI) |
| App shell: left navigation (built sections only), top bar with name, status and "simulated keyboard" badge, content capped at 1100 px | 11, 14; width checked in 15 |
| WebSocket `/api/events` with reconnect; reload on `connected` / `reloaded`; banner and blocked edits on `disconnected` | 6, 11, 14; e2e in 15 |
| Error toasts naming the action and the cause (422, 423, 502, 503, 500) | 6, 11 |
| Keyboard drawing: rotation, ISO Enter / secondary rectangles, decals, current layout options, encoders; big tap / small hold labels; colour by kind; transparent dashed; scales to fit | 7, 8, 12; e2e (macropad, widths) in 15 |
| Edit view: layer tabs with user names (rename in place), click to select, keyboard navigation | 9, 14; e2e in 15 |
| Inspector: keycode, tap, hold; change key, change hold (LT/MT), transparent, clear; the same position on the other layers | 9, 14; e2e in 15 |
| Keycode picker: search, categories from `/api/keycodes`, "any keycode" checked live through `/api/keycodes/parse` | 4, 10, 13; e2e in 15 |
| Keyboard language labels (Qt's `keymaps.py` languages), chosen per browser | 3, 11; e2e in 15 |
| Backend `vial_web.py --data-dir DIR` | 1 |
| Vitest for pure logic; svelte-check 0 errors and 0 warnings; Playwright e2e (load, picker edit, any keycode, layers, rename, disconnect banner, screenshots, width cap, narrow layout); CI job with Node 24 | 6–10, every task, 15, 16 |
