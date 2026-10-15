# Phase 1: Simulator and local API server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `python vial_web.py --fake` serves the whole keyboard (keymap, tap dance, combos, key overrides, alt-repeat, macros, QMK settings, lighting, names, .vil files) as a secure local JSON API with live events, backed by a byte-level simulated keyboard.

**Architecture:** First cut the protocol core loose from Qt and hidapi, so the server can import it alone. Then promote the GUI tests' fake keyboard into a full `simulator` package that answers real HID packets. On top: `server/` (FastAPI) with one module per job and `vial_web.py` as the entry point.

**Tech Stack:** Python 3.13, FastAPI 0.143.1, uvicorn 0.54.0 + websockets 17.2, pydantic 2, platformdirs 4.13.0, httpx2 2.13.1 (test client), pytest 9.

**Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard.** Nothing you run may enumerate or open real HID devices.
   - Never run `vial_web.py` without `--fake`.
   - Never start the Qt app (`src/main/python/main.py`) unless `hid` is replaced by the no-devices stub from the last task of the phase 0 plan.
   - Tests use simulated devices only.
2. **Shell:** Git Bash on Windows; commands are written for it. On Linux/macOS replace `.venv/Scripts/python.exe` with `.venv/bin/python`.
3. **Python:** the repo venv `.venv` (Python 3.13). Tests always run from `src/main/python`, because the code uses top-level imports (`from protocol.keyboard_comm import ...`):

   ```bash
   cd src/main/python
   QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
   ```

   `QT_QPA_PLATFORM=offscreen` keeps Qt windows from appearing on screen.
4. **Line endings:** the repo uses CRLF on Windows checkouts. Edit with tools that keep existing line endings.
5. **Commits:** one commit per task, on branch `web-ui`. End every commit message with the trailer the session tells you to use.

## Prerequisite

The phase 0 plan is done: `.venv` exists and the full suite passes (28 tests).

## File map

| File | Responsibility |
|---|---|
| `src/main/python/transport.py` | **new.** `MSG_LEN`, `hid_send`, `chunks`, moved from `util.py` (which imports Qt and hidapi) |
| `src/main/python/protocol/unlock_hook.py` | **new.** How the protocol asks for an unlock; Qt dialog by default, the server installs its own |
| `src/main/python/protocol/qmk_settings_codec.py` | **new.** QMK settings encode/decode without Qt |
| `src/main/python/macro/macro_action.py` | gains `tag_to_action` (moved from the Qt `macro_action_ui.py`) |
| `src/main/python/simulator/virtual_keyboard.py` | **new.** Vial keyboard simulated at the packet level |
| `src/main/python/simulator/device.py` | **new.** hidapi-device stand-in answered by the simulator |
| `src/main/python/simulator/corne.py` | **new.** Default fake keyboard: 42-key Corne with sample content |
| `src/main/python/server/describe.py` | **new.** Keycode → tap/hold/kind/layer for the UI |
| `src/main/python/server/names.py` | **new.** User names for layers, tap dances and macros (JSON file) |
| `src/main/python/server/schemas.py` | **new.** Pydantic request/response shapes |
| `src/main/python/server/model.py` | **new.** Loaded `Keyboard` → `KeyboardModel` (no device I/O) |
| `src/main/python/server/edits.py` | **new.** Validated requests → protocol calls |
| `src/main/python/server/device.py` | **new.** `DeviceManager` (one lock around all device I/O, hot-plug), fake and hidapi backends |
| `src/main/python/server/hid_discovery.py` | **new.** Finds Vial raw-HID interfaces (real mode only) |
| `src/main/python/server/app.py` | **new.** FastAPI app: security, routes, WebSocket events, tab-closed detection |
| `src/main/python/vial_web.py` | **new.** Entry point |
| `src/main/python/test/...` | new tests per module; `test_gui.py` switches to the simulator |

## Out of scope for this plan (planned later)

- **Matrix-tester state over the WebSocket:** phase 5. The simulator already answers matrix queries (`VirtualKeyboard.press`).
- **VIA-stack and sideloaded keyboards** in real mode: `hid_discovery` finds Vial keyboards only. The spec's read-only VIA view comes later.
- **Country keymap labels** (e.g. Polish `ą` on `KC_A`, from `keymaps.py`): phase 2, where the UI chooses the layout.

### Task 1: Isolation test and the Qt-free transport

**Files:**
- Create: `src/main/python/test/test_core_isolation.py`, `src/main/python/transport.py`
- Modify: `src/main/python/util.py`, `src/main/python/protocol/keyboard_comm.py:25`, `src/main/python/protocol/macro.py:11`

- [ ] **Step 1: Write the failing test.** It imports the protocol core in a fresh interpreter where any import of PyQt5, `hid` or `hidraw` raises:

Create `src/main/python/test/test_core_isolation.py`:

```python
import os
import subprocess
import sys

PYTHON_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Runs in a fresh interpreter: any attempt to import Qt or hidapi raises ImportError.
BLOCKER = """
import sys

class Blocker:
    BLOCKED = ("PyQt5", "hid", "hidraw")

    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in self.BLOCKED:
            raise ImportError("blocked import: " + name)
        return None

sys.meta_path.insert(0, Blocker())
"""


def run_isolated(code):
    return subprocess.run([sys.executable, "-c", BLOCKER + code], cwd=PYTHON_ROOT,
                          capture_output=True, text=True, timeout=60)


def test_protocol_core_imports_without_qt_or_hid():
    result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, transport")
    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_core_isolation.py
```

Expected: FAIL with `ImportError: blocked import: PyQt5` (from `util.py`, imported by `protocol/keyboard_comm.py`).

- [ ] **Step 3: Create the transport module** (the code is moved unchanged from `util.py`)

Create `src/main/python/transport.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Raw packet exchange with a Vial keyboard. Must not import Qt or hidapi. """
import time

MSG_LEN = 32


def hid_send(dev, msg, retries=1):
    if len(msg) > MSG_LEN:
        raise RuntimeError("message must be less than 32 bytes")
    msg += b"\x00" * (MSG_LEN - len(msg))

    data = b""
    first = True

    while retries > 0:
        retries -= 1
        if not first:
            time.sleep(0.5)
        first = False
        try:
            # add 00 at start for hidapi report id
            if dev.write(b"\x00" + msg) != MSG_LEN + 1:
                continue

            data = bytes(dev.read(MSG_LEN, timeout_ms=500))
            if not data:
                continue
        except OSError:
            continue
        break

    if not data:
        raise RuntimeError("failed to communicate with the device")
    return data


def chunks(data, sz):
    for i in range(0, len(data), sz):
        yield data[i:i+sz]
```

- [ ] **Step 4: Remove the moved code from `util.py` and re-export it for existing callers**

```diff
diff --git a/src/main/python/util.py b/src/main/python/util.py
index 20128ea..cccc796 100644
--- a/src/main/python/util.py
+++ b/src/main/python/util.py
@@ -13,6 +13,7 @@ from PyQt5.QtWidgets import QApplication, QWidget, QScrollArea, QFrame
 from hidproxy import hid
 from keycodes.keycodes import Keycode
 from keymaps import KEYMAPS
+from transport import MSG_LEN, hid_send, chunks  # noqa: F401 (re-exported for existing callers)
 
 tr = QCoreApplication.translate
 
@@ -22,7 +23,6 @@ VIAL_SERIAL_NUMBER_MAGIC = "vial:f64c2b3c"
 # For bootloader
 VIBL_SERIAL_NUMBER_MAGIC = "vibl:d4f8159c"
 
-MSG_LEN = 32
 
 # these should match what we have in vial-qmk/keyboards/vial_example
 # so that people don't accidentally reuse a sample keyboard UID
@@ -37,36 +37,6 @@ EXAMPLE_KEYBOARDS = [
 EXAMPLE_KEYBOARD_PREFIX = 0xA6867BDFD3B00F
 
 
-def hid_send(dev, msg, retries=1):
-    if len(msg) > MSG_LEN:
-        raise RuntimeError("message must be less than 32 bytes")
-    msg += b"\x00" * (MSG_LEN - len(msg))
-
-    data = b""
-    first = True
-
-    while retries > 0:
-        retries -= 1
-        if not first:
-            time.sleep(0.5)
-        first = False
-        try:
-            # add 00 at start for hidapi report id
-            if dev.write(b"\x00" + msg) != MSG_LEN + 1:
-                continue
-
-            data = bytes(dev.read(MSG_LEN, timeout_ms=500))
-            if not data:
-                continue
-        except OSError:
-            continue
-        break
-
-    if not data:
-        raise RuntimeError("failed to communicate with the device")
-    return data
-
-
 def is_rawhid(desc, quiet):
     if desc["usage_page"] != 0xFF60 or desc["usage"] != 0x61:
         if not quiet:
@@ -132,11 +102,6 @@ def find_vial_devices(via_stack_json, sideload_vid=None, sideload_pid=None, quie
     return filtered
 
 
-def chunks(data, sz):
-    for i in range(0, len(data), sz):
-        yield data[i:i+sz]
-
-
 def pad_for_vibl(msg):
     """ Pads message to vibl fixed 64-byte length """
     if len(msg) > 64:
```

- [ ] **Step 5: Point the protocol at `transport`.** In `protocol/keyboard_comm.py`, replace `from util import MSG_LEN, hid_send` with `from transport import MSG_LEN, hid_send`. In `protocol/macro.py`, replace `from util import chunks` with `from transport import chunks`.

- [ ] **Step 6: Run the isolation test**

Expected: still FAIL, now on `blocked import: PyQt5` from `unlocker.py` (Task 2), or `protocol.qmk_settings_codec` not found (Task 3). The test passes at the end of Task 4.

- [ ] **Step 7: Run the full suite** (it must stay green)

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test --ignore=test/test_core_isolation.py
```

Expected: `28 passed`.

- [ ] **Step 8: Commit**

```bash
git add src/main/python/transport.py src/main/python/util.py src/main/python/protocol/keyboard_comm.py src/main/python/protocol/macro.py src/main/python/test/test_core_isolation.py
git commit -m "refactor: move HID packet exchange into a Qt-free transport module"
```

### Task 2: Unlock hook

Six protocol modules call `Unlocker.unlock(self)` (a Qt dialog) before security-sensitive writes, such as writing `QK_BOOT` or writing macros. They should ask through a hook instead. The Qt app keeps its dialog as the default.

**Files:**
- Create: `src/main/python/protocol/unlock_hook.py`
- Modify: `protocol/keyboard_comm.py`, `protocol/tap_dance.py`, `protocol/combo.py`, `protocol/key_override.py`, `protocol/alt_repeat_key.py`, `protocol/macro.py`

- [ ] **Step 1: Create the hook**

Create `src/main/python/protocol/unlock_hook.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" How the protocol asks for the keyboard to be unlocked before a security-sensitive write.

The Qt app shows its unlock dialog (the default). Other front ends install their own handler.
"""

_handler = None


def set_unlock_handler(handler):
    """ Install handler(keyboard); pass None to restore the Qt unlock dialog """
    global _handler
    _handler = handler


def request_unlock(keyboard):
    if _handler is not None:
        return _handler(keyboard)
    from unlocker import Unlocker
    return Unlocker.unlock(keyboard)
```

- [ ] **Step 2: In each of the six modules,** replace the import line `from unlocker import Unlocker` with `from protocol.unlock_hook import request_unlock`, and every call `Unlocker.unlock(self)` with `request_unlock(self)`. For example, `protocol/tap_dance.py`:

```diff
diff --git a/src/main/python/protocol/tap_dance.py b/src/main/python/protocol/tap_dance.py
index dcc8e73..ec9b460 100644
--- a/src/main/python/protocol/tap_dance.py
+++ b/src/main/python/protocol/tap_dance.py
@@ -5,7 +5,7 @@ from keycodes.keycodes import Keycode, RESET_KEYCODE
 from protocol.base_protocol import BaseProtocol
 from protocol.constants import DYNAMIC_VIAL_TAP_DANCE_GET, CMD_VIA_VIAL_PREFIX, DYNAMIC_VIAL_TAP_DANCE_SET, \
     CMD_VIAL_DYNAMIC_ENTRY_OP
-from unlocker import Unlocker
+from protocol.unlock_hook import request_unlock
 
 
 class ProtocolTapDance(BaseProtocol):
@@ -26,7 +26,7 @@ class ProtocolTapDance(BaseProtocol):
             return
         for x in range(4):
             if entry[x] == RESET_KEYCODE:
-                Unlocker.unlock(self)
+                request_unlock(self)
         self.tap_dance_entries[idx] = entry
         entry = [Keycode.deserialize(entry[0]), Keycode.deserialize(entry[1]), Keycode.deserialize(entry[2]),
                  Keycode.deserialize(entry[3]), entry[4]]
```

Check that nothing is left:

```bash
grep -rn "Unlocker" src/main/python/protocol
```

Expected: no output.

- [ ] **Step 3: Run the full suite** (same command as Task 1 step 7). Expected: `28 passed`.

- [ ] **Step 4: Commit**

```bash
git add src/main/python/protocol
git commit -m "refactor: protocol requests unlocks through a replaceable hook"
```

### Task 3: Qt-free QMK settings codec

`protocol/keyboard_comm.py` imports `editor.qmk_settings` (a Qt widget module) just to encode and decode setting values.

**Files:**
- Create: `src/main/python/protocol/qmk_settings_codec.py`
- Modify: `src/main/python/protocol/keyboard_comm.py`, `src/main/python/editor/qmk_settings.py`

- [ ] **Step 1: Create the codec.** The logic is moved from `QmkSettings`, plus lazy loading from the source tree's `qmk_settings.json`:

Create `src/main/python/protocol/qmk_settings_codec.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Encodes and decodes QMK settings values, driven by qmk_settings.json. Must not import Qt. """
import json
import os
from collections import defaultdict

DEFAULT_DEFINITIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "..", "..", "resources", "base", "qmk_settings.json")


class QmkSettingsCodec:

    settings_defs = None
    qsid_fields = None

    @classmethod
    def load(cls, path=None):
        """ Load setting definitions; the default path works when running from source """
        cls.qsid_fields = defaultdict(list)
        with open(path or DEFAULT_DEFINITIONS, "r") as inf:
            cls.settings_defs = json.load(inf)
        for tab in cls.settings_defs["tabs"]:
            for field in tab["fields"]:
                cls.qsid_fields[field["qsid"]].append(field)

    @classmethod
    def fields(cls):
        if cls.qsid_fields is None:
            cls.load()
        return cls.qsid_fields

    @classmethod
    def is_qsid_supported(cls, qsid):
        """ Return whether this qsid is known to the settings definitions """
        return qsid in cls.fields()

    @classmethod
    def qsid_serialize(cls, qsid, data):
        """ Serialize from internal representation into binary that can be sent to the firmware """
        fields = cls.fields()[qsid]
        if fields[0]["type"] == "boolean":
            assert isinstance(data, int)
            return data.to_bytes(fields[0].get("width", 1), byteorder="little")
        elif fields[0]["type"] == "integer":
            assert isinstance(data, int)
            assert len(fields) == 1
            return data.to_bytes(fields[0]["width"], byteorder="little")

    @classmethod
    def qsid_deserialize(cls, qsid, data):
        """ Deserialize from binary received from firmware into internal representation """
        fields = cls.fields()[qsid]
        if fields[0]["type"] == "boolean":
            return int.from_bytes(data[0:fields[0].get("width", 1)], byteorder="little")
        elif fields[0]["type"] == "integer":
            assert len(fields) == 1
            return int.from_bytes(data[0:fields[0]["width"]], byteorder="little")
        else:
            raise RuntimeError("unsupported field")
```

- [ ] **Step 2: Use it in `keyboard_comm.py`** (removes all three local `from editor.qmk_settings import QmkSettings` imports)

```diff
diff --git a/src/main/python/protocol/keyboard_comm.py b/src/main/python/protocol/keyboard_comm.py
index 12b785f..f63d95d 100644
--- a/src/main/python/protocol/keyboard_comm.py
+++ b/src/main/python/protocol/keyboard_comm.py
@@ -20,9 +20,10 @@ from protocol.constants import CMD_VIA_GET_PROTOCOL_VERSION, CMD_VIA_GET_KEYBOAR
 from protocol.dynamic import ProtocolDynamic
 from protocol.key_override import ProtocolKeyOverride
 from protocol.macro import ProtocolMacro
+from protocol.qmk_settings_codec import QmkSettingsCodec
 from protocol.tap_dance import ProtocolTapDance
-from unlocker import Unlocker
-from util import MSG_LEN, hid_send
+from protocol.unlock_hook import request_unlock
+from transport import MSG_LEN, hid_send
 
 SUPPORTED_VIA_PROTOCOL = [-1, 9]
 SUPPORTED_VIAL_PROTOCOL = [-1, 0, 1, 2, 3, 4, 5, 6]
@@ -300,21 +301,19 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
                     self.supported_settings.add(qsid)
 
         for qsid in self.supported_settings:
-            from editor.qmk_settings import QmkSettings
-
-            if not QmkSettings.is_qsid_supported(qsid):
+            if not QmkSettingsCodec.is_qsid_supported(qsid):
                 continue
 
             data = self.usb_send(self.dev, struct.pack("<BBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_GET, qsid),
                                  retries=20)
             if data[0] == 0:
-                self.settings[qsid] = QmkSettings.qsid_deserialize(qsid, data[1:])
+                self.settings[qsid] = QmkSettingsCodec.qsid_deserialize(qsid, data[1:])
 
     def set_key(self, layer, row, col, code):
         key = (layer, row, col)
         if self.layout[key] != code:
             if code == RESET_KEYCODE:
-                Unlocker.unlock(self)
+                request_unlock(self)
 
             self.usb_send(self.dev, struct.pack(">BBBBH", CMD_VIA_SET_KEYCODE, layer, row, col,
                                                 Keycode.deserialize(code)), retries=20)
@@ -324,7 +323,7 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
         key = (layer, index, direction)
         if self.encoder_layout[key] != code:
             if code == RESET_KEYCODE:
-                Unlocker.unlock(self)
+                request_unlock(self)
 
             self.usb_send(self.dev, struct.pack(">BBBBBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_SET_ENCODER,
                                                 layer, index, direction, Keycode.deserialize(code)), retries=20)
@@ -433,10 +432,8 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
         self.restore_alt_repeat_key(data.get("alt_repeat_key", []))
 
         for qsid, value in data.get("settings", dict()).items():
-            from editor.qmk_settings import QmkSettings
-
             qsid = int(qsid)
-            if QmkSettings.is_qsid_supported(qsid):
+            if QmkSettingsCodec.is_qsid_supported(qsid):
                 self.qmk_settings_set(qsid, value)
 
     def reset(self):
@@ -510,10 +507,9 @@ class Keyboard(ProtocolMacro, ProtocolDynamic, ProtocolTapDance, ProtocolCombo,
         return data
 
     def qmk_settings_set(self, qsid, value):
-        from editor.qmk_settings import QmkSettings
         self.settings[qsid] = value
         data = self.usb_send(self.dev, struct.pack("<BBH", CMD_VIA_VIAL_PREFIX, CMD_VIAL_QMK_SETTINGS_SET, qsid)
-                             + QmkSettings.qsid_serialize(qsid, value),
+                             + QmkSettingsCodec.qsid_serialize(qsid, value),
                              retries=20)
         return data[0]
 
```

- [ ] **Step 3: Make the Qt editor delegate to the codec**

```diff
diff --git a/src/main/python/editor/qmk_settings.py b/src/main/python/editor/qmk_settings.py
index 2597bdd..3cb1cc2 100644
--- a/src/main/python/editor/qmk_settings.py
+++ b/src/main/python/editor/qmk_settings.py
@@ -9,6 +9,7 @@ from PyQt5.QtWidgets import QVBoxLayout, QCheckBox, QGridLayout, QLabel, QWidget
 
 from editor.basic_editor import BasicEditor
 from protocol.constants import VIAL_PROTOCOL_QMK_SETTINGS
+from protocol.qmk_settings_codec import QmkSettingsCodec
 from util import tr
 from vial_device import VialKeyboard
 
@@ -234,38 +235,21 @@ class QmkSettings(BasicEditor):
 
     @classmethod
     def initialize(cls, appctx):
-        cls.qsid_fields = defaultdict(list)
-        with open(appctx.get_resource("qmk_settings.json"), "r") as inf:
-            cls.settings_defs = json.load(inf)
-        for tab in cls.settings_defs["tabs"]:
-            for field in tab["fields"]:
-                cls.qsid_fields[field["qsid"]].append(field)
+        QmkSettingsCodec.load(appctx.get_resource("qmk_settings.json"))
+        cls.settings_defs = QmkSettingsCodec.settings_defs
+        cls.qsid_fields = QmkSettingsCodec.qsid_fields
 
     @classmethod
     def is_qsid_supported(cls, qsid):
         """ Return whether this qsid is supported by the settings editor """
-        return qsid in cls.qsid_fields
+        return QmkSettingsCodec.is_qsid_supported(qsid)
 
     @classmethod
     def qsid_serialize(cls, qsid, data):
         """ Serialize from internal representation into binary that can be sent to the firmware """
-        fields = cls.qsid_fields[qsid]
-        if fields[0]["type"] == "boolean":
-            assert isinstance(data, int)
-            return data.to_bytes(fields[0].get("width", 1), byteorder="little")
-        elif fields[0]["type"] == "integer":
-            assert isinstance(data, int)
-            assert len(fields) == 1
-            return data.to_bytes(fields[0]["width"], byteorder="little")
+        return QmkSettingsCodec.qsid_serialize(qsid, data)
 
     @classmethod
     def qsid_deserialize(cls, qsid, data):
         """ Deserialize from binary received from firmware into internal representation """
-        fields = cls.qsid_fields[qsid]
-        if fields[0]["type"] == "boolean":
-            return int.from_bytes(data[0:fields[0].get("width", 1)], byteorder="little")
-        elif fields[0]["type"] == "integer":
-            assert len(fields) == 1
-            return int.from_bytes(data[0:fields[0]["width"]], byteorder="little")
-        else:
-            raise RuntimeError("unsupported field")
+        return QmkSettingsCodec.qsid_deserialize(qsid, data)
```

- [ ] **Step 4: Run the full suite.** Expected: `28 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/protocol/qmk_settings_codec.py src/main/python/protocol/keyboard_comm.py src/main/python/editor/qmk_settings.py
git commit -m "refactor: QMK settings codec without Qt"
```

### Task 4: `tag_to_action` next to the macro actions

`protocol/macro.py` imports `tag_to_action` from the Qt module `macro/macro_action_ui.py`.

**Files:**
- Modify: `src/main/python/macro/macro_action.py`, `src/main/python/macro/macro_action_ui.py`, `src/main/python/protocol/macro.py`

- [ ] **Step 1: Move the dictionary and re-export it** (`macro_tab.py` still imports it from `macro_action_ui`)

```diff
diff --git a/src/main/python/macro/macro_action.py b/src/main/python/macro/macro_action.py
index c57ad49..938b5ff 100644
--- a/src/main/python/macro/macro_action.py
+++ b/src/main/python/macro/macro_action.py
@@ -157,3 +157,12 @@ class ActionDelay(BasicAction):
 
     def __eq__(self, other):
         return super().__eq__(other) and self.delay == other.delay
+
+
+tag_to_action = {
+    "down": ActionDown,
+    "up": ActionUp,
+    "tap": ActionTap,
+    "text": ActionText,
+    "delay": ActionDelay,
+}
diff --git a/src/main/python/macro/macro_action_ui.py b/src/main/python/macro/macro_action_ui.py
index 0b0c298..3918fea 100644
--- a/src/main/python/macro/macro_action_ui.py
+++ b/src/main/python/macro/macro_action_ui.py
@@ -4,7 +4,8 @@ from PyQt5.QtWidgets import QLineEdit, QToolButton, QWidget, QSizePolicy, QSpinB
 from constants import KEY_SIZE_RATIO
 from tabbed_keycodes import TabbedKeycodes
 from widgets.flowlayout import FlowLayout
-from macro.macro_action import ActionText, ActionSequence, ActionDown, ActionUp, ActionTap, ActionDelay
+from macro.macro_action import ActionText, ActionSequence, ActionDown, ActionUp, ActionTap, ActionDelay, \
+    tag_to_action  # noqa: F401 (re-exported for macro_tab)
 from widgets.key_widget import KeyWidget
 
 
@@ -183,14 +184,6 @@ class ActionDelayUI(BasicActionUI):
         self.changed.emit()
 
 
-tag_to_action = {
-    "down": ActionDown,
-    "up": ActionUp,
-    "tap": ActionTap,
-    "text": ActionText,
-    "delay": ActionDelay,
-}
-
 ui_action = {
     ActionText: ActionTextUI,
     ActionUp: ActionUpUI,
diff --git a/src/main/python/protocol/macro.py b/src/main/python/protocol/macro.py
index d11e742..5b90b16 100644
--- a/src/main/python/protocol/macro.py
+++ b/src/main/python/protocol/macro.py
@@ -2,13 +2,12 @@ import struct
 
 from keycodes.keycodes import Keycode
 from macro.macro_action import SS_TAP_CODE, SS_DOWN_CODE, SS_UP_CODE, ActionText, ActionTap, ActionDown, ActionUp, \
-    SS_QMK_PREFIX, SS_DELAY_CODE, ActionDelay, VIAL_MACRO_EXT_TAP, VIAL_MACRO_EXT_DOWN, VIAL_MACRO_EXT_UP
-from macro.macro_action_ui import tag_to_action
+    SS_QMK_PREFIX, SS_DELAY_CODE, ActionDelay, VIAL_MACRO_EXT_TAP, VIAL_MACRO_EXT_DOWN, VIAL_MACRO_EXT_UP, tag_to_action
 from protocol.base_protocol import BaseProtocol
 from protocol.constants import CMD_VIA_MACRO_GET_COUNT, CMD_VIA_MACRO_GET_BUFFER_SIZE, CMD_VIA_MACRO_GET_BUFFER, \
     CMD_VIA_MACRO_SET_BUFFER, BUFFER_FETCH_CHUNK, VIAL_PROTOCOL_ADVANCED_MACROS
-from unlocker import Unlocker
-from util import chunks
+from protocol.unlock_hook import request_unlock
+from transport import chunks
 
 
 def macro_deserialize_v1(data):
@@ -201,7 +200,7 @@ class ProtocolMacro(BaseProtocol):
         # TODO: log a warning if macro is cutoff
         data = self.macros_serialize(full_macro)[0:self.macro_memory]
         if data != self.macro:
-            Unlocker.unlock(self)
+            request_unlock(self)
             self.set_macro(data)
 
     def macro_serialize(self, macro):
```

- [ ] **Step 2: Run the isolation test**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_core_isolation.py
```

Expected: `1 passed`.

- [ ] **Step 3: Run the full suite.** Expected: `29 passed`.

- [ ] **Step 4: Commit**

```bash
git add src/main/python/macro src/main/python/protocol/macro.py
git commit -m "refactor: macro action registry lives with the Qt-free actions"
```

### Task 5: Simulator core; GUI tests switch to it

The GUI tests contain a `VirtualKeyboard` that answers a subset of the protocol. It becomes a complete simulator in its own package. Its defaults keep that class's behaviour: 8 macros, 512 bytes of macro memory, UID `F00DFACEDEADBEEF`, protocol 6, no QMK settings. The GUI tests pass `unlocked=False` to keep its locked state.

Two fixes compared with the old class:
- **Buffer replies.** Replies to keymap and macro buffer reads now echo the 4-byte request header, as the firmware does; `keyboard_comm` reads `data[4:]`. The old class echoed only 1 byte, which never showed because its buffers were all zeros.
- **Unplugging.** `process()` raises `OSError` when `connected` is False, which simulates a pulled cable.

**Files:**
- Create: `src/main/python/simulator/__init__.py` (empty), `src/main/python/simulator/virtual_keyboard.py`, `src/main/python/simulator/device.py`
- Modify: `src/main/python/test/test_gui.py`

- [ ] **Step 1: Create the simulator**

Create `src/main/python/simulator/virtual_keyboard.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" A Vial keyboard simulated at the HID packet level.

It answers the same 32-byte requests real firmware does, so the real protocol code runs against it unchanged.
All state is kept in memory as raw integers (keycodes as the firmware stores them).
"""
import json
import lzma
import math
import struct

from protocol.constants import CMD_VIA_GET_PROTOCOL_VERSION, CMD_VIA_GET_KEYBOARD_VALUE, CMD_VIA_SET_KEYBOARD_VALUE, \
    CMD_VIA_SET_KEYCODE, CMD_VIA_LIGHTING_SET_VALUE, CMD_VIA_LIGHTING_GET_VALUE, CMD_VIA_LIGHTING_SAVE, \
    CMD_VIA_MACRO_GET_COUNT, CMD_VIA_MACRO_GET_BUFFER_SIZE, CMD_VIA_MACRO_GET_BUFFER, CMD_VIA_MACRO_SET_BUFFER, \
    CMD_VIA_GET_LAYER_COUNT, CMD_VIA_KEYMAP_GET_BUFFER, CMD_VIA_VIAL_PREFIX, VIA_LAYOUT_OPTIONS, \
    VIA_SWITCH_MATRIX_STATE, QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT, QMK_RGBLIGHT_BRIGHTNESS, \
    QMK_RGBLIGHT_EFFECT, QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR, VIALRGB_GET_INFO, VIALRGB_GET_MODE, \
    VIALRGB_GET_SUPPORTED, VIALRGB_SET_MODE, CMD_VIAL_GET_KEYBOARD_ID, CMD_VIAL_GET_SIZE, CMD_VIAL_GET_DEFINITION, \
    CMD_VIAL_GET_ENCODER, CMD_VIAL_SET_ENCODER, CMD_VIAL_GET_UNLOCK_STATUS, CMD_VIAL_UNLOCK_START, \
    CMD_VIAL_UNLOCK_POLL, CMD_VIAL_LOCK, CMD_VIAL_QMK_SETTINGS_QUERY, CMD_VIAL_QMK_SETTINGS_GET, \
    CMD_VIAL_QMK_SETTINGS_SET, CMD_VIAL_QMK_SETTINGS_RESET, CMD_VIAL_DYNAMIC_ENTRY_OP, \
    DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES, DYNAMIC_VIAL_TAP_DANCE_GET, DYNAMIC_VIAL_TAP_DANCE_SET, \
    DYNAMIC_VIAL_COMBO_GET, DYNAMIC_VIAL_COMBO_SET, DYNAMIC_VIAL_KEY_OVERRIDE_GET, DYNAMIC_VIAL_KEY_OVERRIDE_SET, \
    DYNAMIC_VIAL_ALT_REPEAT_KEY_GET, DYNAMIC_VIAL_ALT_REPEAT_KEY_SET
from protocol.qmk_settings_codec import QmkSettingsCodec

CMD_VIA_BOOTLOADER_JUMP = 0x0B
# bits of the last byte of the dynamic entry count reply
FEATURE_CAPS_WORD = 1 << 0
FEATURE_LAYER_LOCK = 1 << 1
NO_MORE = 0xFFFF


class SimulatorError(RuntimeError):
    pass


class VirtualKeyboard:

    def __init__(self, definition, layers=4, keymap=None, uid=0xF00DFACEDEADBEEF, vial_protocol=6,
                 via_protocol=9, macro_count=8, macro_memory=512, macros=b"", tap_dance=None, combos=None,
                 key_overrides=None, alt_repeat_keys=None, settings=None, unlocked=True,
                 features=FEATURE_CAPS_WORD | FEATURE_LAYER_LOCK):
        """
        definition: vial.json as a dict or JSON string
        keymap: optional {(layer, row, col): keycode}; unset keys are KC_NO
        macros: initial macro buffer bytes (NUL-separated); padded with zeros to macro_memory
        tap_dance / combos: lists of 5-int tuples, as the firmware stores them
        key_overrides: list of 7-int tuples (trigger, replacement, layers, trigger_mods, negative_mod_mask,
                       suppressed_mods, options)
        alt_repeat_keys: list of 4-int tuples (keycode, alt_keycode, allowed_mods, options)
        settings: {qsid: int} of supported QMK settings; None means the firmware has no QMK settings
        """
        if isinstance(definition, str):
            definition = json.loads(definition)
        self.definition = definition
        self.compressed_definition = lzma.compress(json.dumps(definition).encode("utf-8"))

        self.rows = definition["matrix"]["rows"]
        self.cols = definition["matrix"]["cols"]
        self.layers = layers
        self.keymap = [[[0] * self.cols for _ in range(self.rows)] for _ in range(layers)]
        for (layer, row, col), code in (keymap or {}).items():
            self.keymap[layer][row][col] = code

        self.encoders = {}
        self.layout_options = 0

        self.uid = uid
        self.vial_protocol = vial_protocol
        self.via_protocol = via_protocol
        self.features = features

        self.macro_count = macro_count
        if len(macros) > macro_memory:
            raise SimulatorError("initial macros do not fit into macro memory")
        self.macro_buffer = bytearray(macros + b"\x00" * (macro_memory - len(macros)))

        self.tap_dance = list(tap_dance or [])
        self.combos = list(combos or [])
        self.key_overrides = list(key_overrides or [])
        self.alt_repeat_keys = list(alt_repeat_keys or [])

        self.settings = None if settings is None else dict(settings)
        self.default_settings = None if settings is None else dict(settings)

        self.unlocked = unlocked
        self.unlock_in_progress = False

        lighting = definition.get("lighting", "none")
        self.rgblight = {"brightness": 128, "effect": 1, "speed": 2, "color": (0, 255)} \
            if lighting in ["qmk_rgblight", "qmk_backlight_rgblight"] else None
        self.backlight = {"brightness": 128, "effect": 0} \
            if lighting in ["qmk_backlight", "qmk_backlight_rgblight"] else None
        self.vialrgb = {"mode": 2, "speed": 128, "hsv": (0, 255, 128), "max_brightness": 200,
                        "supported": [1, 2, 3, 4, 5, 6, 7, 8]} if lighting == "vialrgb" else None
        self.lighting_saved = False

        self.pressed = set()
        self.connected = True
        self.bootloader_requested = False
        self.writes = []

    # --- helpers for tests and the fake server ---

    def press(self, row, col):
        self.pressed.add((row, col))

    def release(self, row, col):
        self.pressed.discard((row, col))

    def macros(self):
        """ Macro buffer split into macro_count byte strings """
        return bytes(self.macro_buffer).split(b"\x00")[:self.macro_count]

    # --- packet handling ---

    def process(self, msg):
        """ Handle one 32-byte request and return the reply (padded to 32 bytes by the device) """
        if not self.connected:
            raise OSError("simulated keyboard is unplugged")
        msg = bytes(msg)
        cmd = msg[0]
        if cmd == CMD_VIA_VIAL_PREFIX:
            return self._vial(msg)
        handler = {
            CMD_VIA_GET_PROTOCOL_VERSION: lambda: struct.pack(">BH", cmd, self.via_protocol),
            CMD_VIA_GET_KEYBOARD_VALUE: lambda: self._get_keyboard_value(msg),
            CMD_VIA_SET_KEYBOARD_VALUE: lambda: self._set_keyboard_value(msg),
            CMD_VIA_SET_KEYCODE: lambda: self._set_keycode(msg),
            CMD_VIA_LIGHTING_GET_VALUE: lambda: self._lighting_get(msg),
            CMD_VIA_LIGHTING_SET_VALUE: lambda: self._lighting_set(msg),
            CMD_VIA_LIGHTING_SAVE: lambda: self._lighting_save(msg),
            CMD_VIA_MACRO_GET_COUNT: lambda: struct.pack(">BB", cmd, self.macro_count),
            CMD_VIA_MACRO_GET_BUFFER_SIZE: lambda: struct.pack(">BH", cmd, len(self.macro_buffer)),
            CMD_VIA_MACRO_GET_BUFFER: lambda: self._read_buffer(msg, bytes(self.macro_buffer)),
            CMD_VIA_MACRO_SET_BUFFER: lambda: self._write_macro_buffer(msg),
            CMD_VIA_GET_LAYER_COUNT: lambda: struct.pack(">BB", cmd, self.layers),
            CMD_VIA_KEYMAP_GET_BUFFER: lambda: self._read_buffer(msg, self._keymap_buffer()),
            CMD_VIA_BOOTLOADER_JUMP: self._bootloader,
        }.get(cmd)
        if handler is None:
            raise SimulatorError("unknown VIA command 0x{:02X}".format(cmd))
        return handler()

    def _keymap_buffer(self):
        out = b""
        for layer in self.keymap:
            for row in layer:
                for code in row:
                    out += struct.pack(">H", code)
        return out

    @staticmethod
    def _read_buffer(msg, buffer):
        offset, size = struct.unpack_from(">HB", msg, 1)
        # the reply echoes the 4-byte request header, then the data
        return msg[0:4] + buffer[offset:offset + size]

    def _write_macro_buffer(self, msg):
        offset, size = struct.unpack_from(">HB", msg, 1)
        if offset + size > len(self.macro_buffer):
            raise SimulatorError("macro write past the end of macro memory")
        self.macro_buffer[offset:offset + size] = msg[4:4 + size]
        self.writes.append(("macro", offset, size))
        return msg[0:4]

    def _set_keycode(self, msg):
        layer, row, col, code = struct.unpack_from(">BBBH", msg, 1)
        self.keymap[layer][row][col] = code
        self.writes.append(("keycode", layer, row, col, code))
        return msg[0:6]

    def _get_keyboard_value(self, msg):
        sub = msg[1]
        if sub == VIA_LAYOUT_OPTIONS:
            return struct.pack(">BBI", msg[0], sub, self.layout_options)
        if sub == VIA_SWITCH_MATRIX_STATE:
            row_size = math.ceil(self.cols / 8)
            out = msg[0:2]
            for row in range(self.rows):
                bits = 0
                for col in range(self.cols):
                    if (row, col) in self.pressed:
                        bits |= 1 << col
                out += bits.to_bytes(row_size, byteorder="big")
            return out
        raise SimulatorError("unknown keyboard value 0x{:02X}".format(sub))

    def _set_keyboard_value(self, msg):
        sub = msg[1]
        if sub == VIA_LAYOUT_OPTIONS:
            self.layout_options = struct.unpack_from(">I", msg, 2)[0]
            self.writes.append(("layout_options", self.layout_options))
            return msg[0:6]
        raise SimulatorError("unknown keyboard value 0x{:02X}".format(sub))

    def _lighting_get(self, msg):
        sub = msg[1]
        head = msg[0:2]
        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
            if sub == QMK_RGBLIGHT_COLOR:
                return head + bytes(self.rgblight["color"])
            key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
                   QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
            return head + bytes([self.rgblight[key]])
        if self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
            key = "brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"
            return head + bytes([self.backlight[key]])
        if self.vialrgb is not None:
            if sub == VIALRGB_GET_INFO:
                return head + struct.pack("<HB", 1, self.vialrgb["max_brightness"])
            if sub == VIALRGB_GET_MODE:
                return head + struct.pack("<HBBBB", self.vialrgb["mode"], self.vialrgb["speed"],
                                          *self.vialrgb["hsv"])
            if sub == VIALRGB_GET_SUPPORTED:
                after = struct.unpack_from("<H", msg, 2)[0]
                effects = [e for e in sorted(self.vialrgb["supported"]) if e > after][:15]
                effects += [NO_MORE] * (15 - len(effects))
                return head + struct.pack("<15H", *effects)
        raise SimulatorError("unsupported lighting query 0x{:02X}".format(sub))

    def _lighting_set(self, msg):
        sub = msg[1]
        if self.rgblight is not None and sub in [QMK_RGBLIGHT_BRIGHTNESS, QMK_RGBLIGHT_EFFECT,
                                                 QMK_RGBLIGHT_EFFECT_SPEED, QMK_RGBLIGHT_COLOR]:
            if sub == QMK_RGBLIGHT_COLOR:
                self.rgblight["color"] = (msg[2], msg[3])
            else:
                key = {QMK_RGBLIGHT_BRIGHTNESS: "brightness", QMK_RGBLIGHT_EFFECT: "effect",
                       QMK_RGBLIGHT_EFFECT_SPEED: "speed"}[sub]
                self.rgblight[key] = msg[2]
        elif self.backlight is not None and sub in [QMK_BACKLIGHT_BRIGHTNESS, QMK_BACKLIGHT_EFFECT]:
            self.backlight["brightness" if sub == QMK_BACKLIGHT_BRIGHTNESS else "effect"] = msg[2]
        elif self.vialrgb is not None and sub == VIALRGB_SET_MODE:
            mode, speed, h, s, v = struct.unpack_from("<HBBBB", msg, 2)
            self.vialrgb["mode"], self.vialrgb["speed"], self.vialrgb["hsv"] = mode, speed, (h, s, v)
        else:
            raise SimulatorError("unsupported lighting change 0x{:02X}".format(sub))
        self.writes.append(("lighting", sub))
        return msg[0:2]

    def _lighting_save(self, msg):
        self.lighting_saved = True
        return msg[0:1]

    def _bootloader(self):
        self.bootloader_requested = True
        return b""

    # --- Vial commands ---

    def _vial(self, msg):
        sub = msg[1]
        if sub == CMD_VIAL_GET_KEYBOARD_ID:
            return struct.pack("<IQ", self.vial_protocol, self.uid)
        if sub == CMD_VIAL_GET_SIZE:
            return struct.pack("<I", len(self.compressed_definition))
        if sub == CMD_VIAL_GET_DEFINITION:
            page = struct.unpack_from("<I", msg, 2)[0]
            return self.compressed_definition[page * 32:(page + 1) * 32]
        if sub == CMD_VIAL_GET_ENCODER:
            layer, idx = msg[2], msg[3]
            return struct.pack(">HH", self.encoders.get((layer, idx, 0), 0), self.encoders.get((layer, idx, 1), 0))
        if sub == CMD_VIAL_SET_ENCODER:
            layer, idx, direction, code = struct.unpack_from(">BBBH", msg, 2)
            self.encoders[(layer, idx, direction)] = code
            self.writes.append(("encoder", layer, idx, direction, code))
            return b""
        if sub == CMD_VIAL_GET_UNLOCK_STATUS:
            # unlock keys: none (255, 255) in all 15 slots
            return bytes([int(self.unlocked), int(self.unlock_in_progress)]) + b"\xFF" * 30
        if sub == CMD_VIAL_UNLOCK_START:
            self.unlock_in_progress = True
            return b""
        if sub == CMD_VIAL_UNLOCK_POLL:
            # the simulated user holds the unlock keys instantly
            self.unlocked, self.unlock_in_progress = True, False
            return bytes([1, 0, 0])
        if sub == CMD_VIAL_LOCK:
            self.unlocked = False
            return b""
        if sub == CMD_VIAL_QMK_SETTINGS_QUERY:
            after = struct.unpack_from("<H", msg, 2)[0]
            qsids = [q for q in sorted(self.settings or {}) if q > after][:16]
            qsids += [NO_MORE] * (16 - len(qsids))
            return struct.pack("<16H", *qsids)
        if sub == CMD_VIAL_QMK_SETTINGS_GET:
            qsid = struct.unpack_from("<H", msg, 2)[0]
            if not self.settings or qsid not in self.settings:
                return b"\x01"
            return b"\x00" + self.settings[qsid].to_bytes(self._setting_width(qsid), byteorder="little")
        if sub == CMD_VIAL_QMK_SETTINGS_SET:
            qsid = struct.unpack_from("<H", msg, 2)[0]
            if not self.settings or qsid not in self.settings:
                return b"\x01"
            width = self._setting_width(qsid)
            self.settings[qsid] = int.from_bytes(msg[4:4 + width], byteorder="little")
            self.writes.append(("setting", qsid, self.settings[qsid]))
            return b"\x00"
        if sub == CMD_VIAL_QMK_SETTINGS_RESET:
            if self.settings is not None:
                self.settings = dict(self.default_settings)
            return b""
        if sub == CMD_VIAL_DYNAMIC_ENTRY_OP:
            return self._dynamic(msg)
        raise SimulatorError("unknown Vial command 0x{:02X}".format(sub))

    @staticmethod
    def _setting_width(qsid):
        return QmkSettingsCodec.fields()[qsid][0].get("width", 1)

    DYNAMIC = {
        # get command: (attribute, struct format, set command)
        DYNAMIC_VIAL_TAP_DANCE_GET: ("tap_dance", "<HHHHH", DYNAMIC_VIAL_TAP_DANCE_SET),
        DYNAMIC_VIAL_COMBO_GET: ("combos", "<HHHHH", DYNAMIC_VIAL_COMBO_SET),
        DYNAMIC_VIAL_KEY_OVERRIDE_GET: ("key_overrides", "<HHHBBBB", DYNAMIC_VIAL_KEY_OVERRIDE_SET),
        DYNAMIC_VIAL_ALT_REPEAT_KEY_GET: ("alt_repeat_keys", "<HHBB", DYNAMIC_VIAL_ALT_REPEAT_KEY_SET),
    }

    def _dynamic(self, msg):
        op = msg[2]
        if op == DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES:
            counts = struct.pack("BBBB", len(self.tap_dance), len(self.combos), len(self.key_overrides),
                                 len(self.alt_repeat_keys))
            return counts + b"\x00" * (31 - len(counts)) + bytes([self.features])
        for get_op, (attr, fmt, set_op) in self.DYNAMIC.items():
            entries = getattr(self, attr)
            if op == get_op:
                idx = msg[3]
                if idx >= len(entries):
                    return b"\x01"
                return b"\x00" + struct.pack(fmt, *entries[idx])
            if op == set_op:
                idx = msg[3]
                if idx >= len(entries):
                    return b"\x01"
                entries[idx] = struct.unpack_from(fmt, msg, 4)
                self.writes.append((attr, idx, entries[idx]))
                return b"\x00"
        raise SimulatorError("unknown dynamic entry op 0x{:02X}".format(op))
```

Create `src/main/python/simulator/device.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" A stand-in for a hidapi device object, answered by a VirtualKeyboard instead of USB. """
from transport import MSG_LEN


class SimulatedHidDevice:

    def __init__(self, keyboard):
        self.keyboard = keyboard
        self.reply = None
        self.closed = False

    def open_path(self, path):
        self.closed = False

    def write(self, data):
        data = bytes(data)
        # hidapi writes are prefixed with a 0 report id
        if len(data) != MSG_LEN + 1 or data[0] != 0:
            raise ValueError("expected a {}-byte report starting with 0, got {}".format(MSG_LEN + 1, data.hex()))
        reply = self.keyboard.process(data[1:])
        if len(reply) > MSG_LEN:
            raise ValueError("simulator reply longer than {} bytes".format(MSG_LEN))
        self.reply = reply + b"\x00" * (MSG_LEN - len(reply))
        return len(data)

    def read(self, length, timeout_ms=0):
        reply, self.reply = self.reply, None
        if reply is None:
            return []
        return list(reply[:length])

    def close(self):
        self.closed = True
```

- [ ] **Step 2: Switch `test_gui.py` to the simulator**

  1. Delete the whole `class VirtualKeyboard:` and `class MockDevice:` definitions.
  2. Delete the `from protocol.constants import CMD_VIA_GET_PROTOCOL_VERSION, ...` import block (six lines), plus `import lzma` and `import struct`.
  3. Add these imports after `from main_window import MainWindow`:

```python
from simulator.device import SimulatedHidDevice
from simulator.virtual_keyboard import VirtualKeyboard
```

  4. Where the old classes were, add:

```python
class MockDevice(SimulatedHidDevice):
    """ hid.device() replacement for the Qt app, answered by the simulated keyboard in MockDevice.vk """

    vk = None

    def __init__(self):
        super().__init__(MockDevice.vk)

    def open_path(self, path):
        assert path == "/magic/path/for/tests"
        super().open_path(path)
```

  5. In `prepare()`, change the `VirtualKeyboard(...)` line to:

```python
    vk = VirtualKeyboard(keyboard_json, combos=combos, tap_dance=tap_dance, unlocked=False)
```

- [ ] **Step 3: Run the GUI tests**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_gui.py
```

Expected: `7 passed`. The GUI tests now run against the new simulator, which proves it is protocol-compatible.

- [ ] **Step 4: Commit**

```bash
git add src/main/python/simulator src/main/python/test/test_gui.py
git commit -m "feat: packet-level keyboard simulator; GUI tests use it"
```

### Task 6: Default fake keyboard (Corne) and simulator tests

**Files:**
- Create: `src/main/python/simulator/corne.py`, `src/main/python/test/conftest.py`, `src/main/python/test/test_simulator.py`

- [ ] **Step 1: Write the tests first**

Create `src/main/python/test/test_simulator.py`:

```python
import pytest

import transport
from protocol.key_override import KeyOverrideEntry
from protocol.keyboard_comm import Keyboard
from simulator.corne import make_corne, encode
from simulator.device import SimulatedHidDevice


@pytest.fixture
def corne():
    """ (simulated keyboard, Keyboard object loaded from it through the real protocol code) """
    vk = make_corne()
    kb = Keyboard(SimulatedHidDevice(vk))
    kb.reload()
    return vk, kb


def test_reload_reads_geometry_and_identity(corne):
    vk, kb = corne
    assert (kb.layers, kb.rows, kb.cols) == (4, 8, 6)
    assert len(kb.keys) == 42
    assert kb.vial_protocol == 6
    assert kb.keyboard_id == 0x5EEDC0DE00420042


def test_reload_reads_keymap(corne):
    vk, kb = corne
    assert kb.layout[(0, 1, 1)] == "LT2(KC_S)"
    assert kb.layout[(0, 1, 4)] == "LSFT_T(KC_T)"
    assert kb.layout[(0, 3, 5)] == "TD(0)"
    assert kb.layout[(0, 7, 5)] == "M0"
    assert kb.layout[(0, 7, 3)] == "OSL(3)"
    assert kb.layout[(1, 0, 0)] == "KC_TRNS"


def test_reload_reads_dynamic_entries(corne):
    vk, kb = corne
    assert kb.tap_dance_entries[0] == ("KC_TAB", "KC_NO", "KC_CAPSLOCK", "KC_NO", 200)
    assert kb.combo_entries[0] == ("KC_K", "KC_Y", "KC_NO", "KC_NO", "KC_ESCAPE")
    assert kb.key_override_entries[0].save()["replacement"] == "KC_DELETE"
    assert kb.alt_repeat_key_count == 4
    assert {"caps_word", "layer_lock"} <= kb.supported_features


def test_reload_reads_macros_settings_and_lighting(corne):
    vk, kb = corne
    assert kb.save_macro()[0] == [["text", "git status"], ["tap", "KC_ENTER"]]
    assert kb.save_macro()[1][4] == ["delay", 50]
    assert (kb.macro_count, kb.macro_memory) == (16, 900)
    assert kb.settings[7] == 200
    assert kb.lighting_vialrgb and kb.rgb_mode == 2
    assert kb.rgb_supported_effects == set(range(9))


def test_writes_reach_the_simulator(corne):
    vk, kb = corne
    kb.set_key(0, 0, 0, "KC_A")
    assert vk.keymap[0][0][0] == encode("KC_A")

    kb.tap_dance_set(1, ("KC_A", "KC_B", "KC_C", "KC_D", 250))
    assert vk.tap_dance[1] == (encode("KC_A"), encode("KC_B"), encode("KC_C"), encode("KC_D"), 250)

    kb.combo_set(1, ("KC_Q", "KC_W", "KC_NO", "KC_NO", "KC_TAB"))
    assert vk.combos[1] == (encode("KC_Q"), encode("KC_W"), 0, 0, encode("KC_TAB"))

    kb.key_override_set(1, KeyOverrideEntry(("KC_A", "KC_B", 1, 0, 0, 0, 0x80)))
    assert vk.key_overrides[1] == (encode("KC_A"), encode("KC_B"), 1, 0, 0, 0, 0x80)

    kb.qmk_settings_set(7, 175)
    assert vk.settings[7] == 175

    kb.set_vialrgb_mode(5)
    assert vk.vialrgb["mode"] == 5


def test_macro_write_round_trips(corne):
    vk, kb = corne
    macros = kb.macros_deserialize(kb.macro)
    macros[2] = kb.macros_deserialize(kb.macro)[0]
    kb.set_macro(kb.macros_serialize(macros))
    assert vk.macros()[2] == vk.macros()[0] == b"git status\x01\x01\x28"


def test_matrix_state_reports_pressed_keys(corne):
    vk, kb = corne
    vk.press(1, 2)
    data = kb.matrix_poll()
    # one byte per row after the 2-byte header; bit = column
    assert data[2 + 1] == 1 << 2


def test_unplugged_keyboard_fails_cleanly(corne, monkeypatch):
    vk, kb = corne
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    vk.connected = False
    with pytest.raises(RuntimeError, match="failed to communicate"):
        kb.set_key(0, 0, 0, "KC_B")


def test_device_rejects_reports_without_report_id():
    dev = SimulatedHidDevice(make_corne())
    with pytest.raises(ValueError):
        dev.write(b"\x01" * 33)


def test_encode_matches_protocol_6_values():
    assert encode("KC_A") == 0x04
    assert encode("LT2(KC_S)") == 0x4216
    assert encode("TD(0)") == 0x5700
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_simulator.py
```

Expected: ERROR, `ModuleNotFoundError: No module named 'simulator.corne'`.

- [ ] **Step 3: Create the Corne.** `encode()` turns keycode names into protocol-6 integers. The sample content matches the approved mockups: home-row mods, `LT2(KC_S)`, `TD(0)` on a thumb, an `M0` macro, combos K+Y→Esc and M+C→Enter, and a Backspace→Delete key override.

Create `src/main/python/simulator/corne.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" A realistic default keyboard for fake mode: a 42-key split (Corne layout) with sample content. """
from keycodes.keycodes import Keycode
from keycodes.keycodes_v6 import keycodes_v6
from macro.macro_action import ActionText, ActionTap, ActionDelay, ActionDown, ActionUp
from simulator.virtual_keyboard import VirtualKeyboard

VIAL_PROTOCOL = 6
CORNE_UID = 0x5EED_C0DE_0042_0042

# Left half: matrix rows 0-3, columns 0-5 from the outside in.
# Right half: matrix rows 4-7, mirrored so column 0 is the outermost key.
LEFT = [[(r, c) for c in range(6)] for r in range(3)]
RIGHT = [[(r + 4, 5 - c) for c in range(6)] for r in range(3)]
LEFT_THUMBS = [(3, 3), (3, 4), (3, 5)]
RIGHT_THUMBS = [(7, 5), (7, 4), (7, 3)]


def definition():
    """ vial.json for the simulated keyboard (KLE layout, matrix 8x6, VialRGB lighting) """
    rows = []
    for r in range(3):
        rows.append(["{},{}".format(*rc) for rc in LEFT[r]] + [{"x": 3}] + ["{},{}".format(*rc) for rc in RIGHT[r]])
    rows.append([{"x": 3}] + ["{},{}".format(*rc) for rc in LEFT_THUMBS] + [{"x": 3}] +
                ["{},{}".format(*rc) for rc in RIGHT_THUMBS])
    return {
        "name": "Simulated Corne",
        "vendorId": "0xFEED",
        "productId": "0x0042",
        "lighting": "vialrgb",
        "matrix": {"rows": 8, "cols": 6},
        "layouts": {"keymap": rows},
    }


def encode(qmk_id):
    """ Keycode name or expression (e.g. "LT1(KC_SPC)", "LCTL(KC_C)") -> firmware integer, protocol 6 """
    if qmk_id in keycodes_v6.kc:
        return keycodes_v6.kc[qmk_id]
    saved = Keycode.protocol
    Keycode.protocol = VIAL_PROTOCOL
    try:
        return Keycode.deserialize(qmk_id, reraise=True)
    finally:
        Keycode.protocol = saved


# Each layer: 3 rows of 6 keys per half (outside to inside on the left, inside to outside on the right),
# then 3 thumb keys per half (inside to outside on the left... as listed in LEFT_THUMBS / RIGHT_THUMBS).
LAYERS = [
    {   # 0: base, with home-row mods
        "left": [["KC_TAB", "LGUI_T(KC_W)", "KC_L", "KC_R", "LT2(KC_B)", "KC_Z"],
                 ["KC_LCTL", "LT2(KC_S)", "LALT_T(KC_H)", "LCTL_T(KC_N)", "LSFT_T(KC_T)", "KC_COMM"],
                 ["KC_LSFT", "KC_F", "KC_M", "KC_C", "KC_V", "KC_SLSH"]],
        "right": [["KC_Q", "KC_U", "KC_D", "KC_J", "KC_BSLS", "KC_BSPC"],
                  ["KC_DOT", "RGUI_T(KC_A)", "RALT_T(KC_E)", "RCTL_T(KC_O)", "RSFT_T(KC_I)", "KC_QUOT"],
                  ["KC_G", "KC_P", "KC_X", "KC_K", "KC_Y", "KC_RSFT"]],
        "left_thumbs": ["KC_ESC", "LT1(KC_SPC)", "TD(0)"],
        "right_thumbs": ["M0", "KC_ENT", "OSL(3)"],
    },
    {   # 1: symbols (hold Space)
        "left": [["KC_TRNS", "LSFT(KC_1)", "LSFT(KC_2)", "LSFT(KC_3)", "LSFT(KC_4)", "LSFT(KC_5)"],
                 ["KC_TRNS", "KC_GRV", "LSFT(KC_EQL)", "LSFT(KC_9)", "LSFT(KC_0)", "KC_EQL"],
                 ["KC_TRNS", "LSFT(KC_GRV)", "LSFT(KC_LBRC)", "LSFT(KC_RBRC)", "KC_LBRC", "KC_RBRC"]],
        "right": [["LSFT(KC_6)", "LSFT(KC_7)", "LSFT(KC_8)", "KC_MINS", "LSFT(KC_MINS)", "KC_TRNS"],
                  ["KC_SCLN", "LSFT(KC_SCLN)", "LSFT(KC_QUOT)", "LSFT(KC_BSLS)", "KC_BSLS", "KC_TRNS"],
                  ["KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
    },
    {   # 2: navigation (hold S or B)
        "left": [["KC_TRNS", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS", "KC_NO"],
                 ["KC_TRNS", "KC_TRNS", "KC_LALT", "KC_LCTL", "KC_LSFT", "KC_NO"],
                 ["KC_TRNS", "LCTL(KC_Z)", "LCTL(KC_X)", "LCTL(KC_C)", "LCTL(KC_V)", "KC_NO"]],
        "right": [["KC_PGUP", "KC_HOME", "KC_UP", "KC_END", "KC_NO", "KC_DEL"],
                  ["KC_PGDN", "KC_LEFT", "KC_DOWN", "KC_RGHT", "KC_NO", "KC_NO"],
                  ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
    },
    {   # 3: numbers and function keys (one-shot from the right thumb)
        "left": [["KC_TRNS", "KC_F1", "KC_F2", "KC_F3", "KC_F4", "KC_F5"],
                 ["KC_TRNS", "KC_1", "KC_2", "KC_3", "KC_4", "KC_5"],
                 ["KC_TRNS", "KC_F11", "KC_F12", "KC_NO", "KC_NO", "KC_NO"]],
        "right": [["KC_F6", "KC_F7", "KC_F8", "KC_F9", "KC_F10", "KC_TRNS"],
                  ["KC_6", "KC_7", "KC_8", "KC_9", "KC_0", "KC_TRNS"],
                  ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_TRNS"]],
        "left_thumbs": ["KC_TRNS", "KC_TRNS", "KC_TRNS"],
        "right_thumbs": ["KC_TRNS", "KC_TRNS", "TO(0)"],
    },
]


def keymap():
    """ {(layer, row, col): keycode} for all layers """
    out = {}
    for layer, keys in enumerate(LAYERS):
        for side, positions in (("left", LEFT), ("right", RIGHT)):
            for r in range(3):
                for c in range(6):
                    out[(layer, *positions[r][c])] = encode(keys[side][r][c])
        for side, positions in (("left_thumbs", LEFT_THUMBS), ("right_thumbs", RIGHT_THUMBS)):
            for i in range(3):
                out[(layer, *positions[i])] = encode(keys[side][i])
    return out


def macros():
    """ Macro buffer: M0 types "git status" and Enter; M1 copies a line; the rest are empty """
    m0 = [ActionText("git status"), ActionTap(["KC_ENT"])]
    m1 = [ActionTap(["KC_HOME"]), ActionDown(["KC_LSFT"]), ActionTap(["KC_END"]), ActionUp(["KC_LSFT"]),
          ActionDelay(50), ActionTap(["LCTL(KC_C)"])]
    saved = Keycode.protocol
    Keycode.protocol = VIAL_PROTOCOL
    try:
        data = [b"".join(a.serialize(VIAL_PROTOCOL) for a in m) for m in (m0, m1)]
    finally:
        Keycode.protocol = saved
    return b"\x00".join(data) + b"\x00"


def make_corne():
    """ A fresh simulated Corne; nothing is shared between calls """
    ko_options_enabled = 0b1000_0111  # enabled, activates on trigger down / required mod down / negative mod up
    return VirtualKeyboard(
        definition(),
        layers=len(LAYERS),
        keymap=keymap(),
        uid=CORNE_UID,
        vial_protocol=VIAL_PROTOCOL,
        macro_count=16,
        macro_memory=900,
        macros=macros(),
        tap_dance=[(encode("KC_TAB"), encode("KC_NO"), encode("KC_CAPS"), encode("KC_NO"), 200),
                   (encode("KC_ESC"), encode("KC_LCTL"), encode("LCTL(KC_S)"), encode("KC_NO"), 200)] +
                  [(0, 0, 0, 0, 200)] * 6,
        combos=[(encode("KC_K"), encode("KC_Y"), 0, 0, encode("KC_ESC")),
                (encode("KC_M"), encode("KC_C"), 0, 0, encode("KC_ENT"))] +
               [(0, 0, 0, 0, 0)] * 6,
        key_overrides=[(encode("KC_BSPC"), encode("KC_DEL"), 0xFFFF, 0x02, 0, 0x02, ko_options_enabled)] +
                      [(0, 0, 0, 0, 0, 0, 0)] * 3,
        alt_repeat_keys=[(0, 0, 0, 0)] * 4,
        settings={2: 50, 7: 200, 8: 0, 22: 0, 23: 0, 24: 0, 25: 100},
        unlocked=True,
    )
```

- [ ] **Step 4: Add the shared fixture used by later tests**

Create `src/main/python/test/conftest.py`:

```python
import pytest

from protocol.keyboard_comm import Keyboard
from simulator.corne import make_corne
from simulator.device import SimulatedHidDevice


@pytest.fixture
def corne_keyboard():
    """ (simulated Corne, Keyboard loaded from it). Loading also resets the global keycode tables. """
    virtual = make_corne()
    keyboard = Keyboard(SimulatedHidDevice(virtual))
    keyboard.reload()
    return virtual, keyboard
```

- [ ] **Step 5: Run the simulator tests.** Expected: `10 passed`.

- [ ] **Step 6: Run the full suite.** Expected: `39 passed`.

- [ ] **Step 7: Commit**

```bash
git add src/main/python/simulator/corne.py src/main/python/test/conftest.py src/main/python/test/test_simulator.py
git commit -m "feat: simulated Corne as the default fake keyboard"
```

### Task 7: Server dependencies and keycode descriptions

**Files:**
- Modify: `requirements.txt`, `test-requirements.txt`
- Create: `src/main/python/server/__init__.py` (empty), `src/main/python/server/describe.py`, `src/main/python/test/test_describe.py`

- [ ] **Step 1: Add the server dependencies.** Add to `requirements.txt` (keep alphabetical order). `websockets` is required: plain uvicorn refuses WebSocket upgrades without it, which the end-to-end check in Task 13 catches.

```
fastapi==0.143.1
platformdirs==4.13.0
uvicorn==0.54.0
websockets==17.2
```

Add to `test-requirements.txt` (Starlette's test client prefers `httpx2`):

```
httpx2==2.13.1
```

Install: `.venv/Scripts/python.exe -m pip install -r test-requirements.txt`.

- [ ] **Step 2: Write the failing tests**

Create `src/main/python/test/test_describe.py`:

```python
import pytest

from server.describe import describe, parse, one_line


@pytest.fixture(autouse=True)
def loaded_keyboard(corne_keyboard):
    """ Layer, tap dance and macro keycodes only exist once a keyboard is loaded """
    return corne_keyboard


@pytest.mark.parametrize("code, kind, tap, hold, layer, index", [
    ("KC_NO", "none", "", None, None, None),
    ("KC_TRNS", "transparent", "▽", None, None, None),
    ("KC_A", "basic", "A", None, None, None),
    ("KC_1", "basic", "!\n1", None, None, None),
    ("LSFT(KC_1)", "basic", "!", None, None, None),
    ("LCTL(KC_C)", "basic", "Ctrl+C", None, None, None),
    ("LT2(KC_S)", "layer-tap", "S", "layer 2", 2, None),
    ("LSFT_T(KC_T)", "mod-tap", "T", "Shift", None, None),
    ("ALL_T(KC_B)", "mod-tap", "B", "Hyper", None, None),
    ("MO(1)", "layer", "MO 1", "while held", 1, None),
    ("OSL(3)", "layer", "OSL 3", "one-shot", 3, None),
    ("TD(0)", "tap-dance", "TD 0", None, None, 0),
    ("M0", "macro", "M 0", None, None, 0),
    ("OSM(MOD_LSFT)", "one-shot-mod", "OSM", "LSft", None, None),
    ("KC_LCTRL", "modifier", "LCtrl", None, None, None),
    ("KC_MS_U", "mouse", "Mouse\nUp", None, None, None),
    ("KC_VOLU", "media", "Vol +", None, None, None),
    ("RGB_TOG", "lighting", "RGB\nToggle", None, None, None),
    ("QK_BOOT", "other", "Boot-\nloader", None, None, None),
])
def test_describe(code, kind, tap, hold, layer, index):
    result = describe(code)
    assert (result["kind"], result["tap"], result["hold"], result["layer"], result["index"]) == \
        (kind, tap, hold, layer, index)


def test_describe_normalizes_aliases():
    assert describe("KC_ENT")["code"] == "KC_ENTER"


def test_describe_includes_tooltip():
    assert describe("LT2(KC_S)")["tooltip"] == "LT2(kc): kc on tap, switch to layer 2 while held"


def test_parse_accepts_expressions_and_numbers():
    assert parse("LCTL(KC_A)")["code"] == "LCTL(KC_A)"
    assert parse(" 0x7E05 ")["code"] == "USER05"


@pytest.mark.parametrize("expression", ["NOT_A_KEY", "0x10000", "-1", "KC_A +"])
def test_parse_rejects_invalid(expression):
    with pytest.raises(ValueError):
        parse(expression)


@pytest.mark.parametrize("label, expected", [
    ("!\n1", "1"), ("Caps\nLock", "Caps Lock"), ("{ \n[ ", "["), ("Mouse\nWheel\nUp", "Mouse Wheel Up"), ("A", "A"),
])
def test_one_line(label, expected):
    assert one_line(label) == expected
```

- [ ] **Step 3: Run them to see them fail.** Expected: `ModuleNotFoundError: No module named 'server.describe'`.

- [ ] **Step 4: Implement**

Create `src/main/python/server/describe.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Turns a keycode into what the UI shows: tap and hold labels, a kind, and the layer or entry it refers to.

All keycode knowledge comes from keycodes/; this module only interprets it.
"""
import re

from keycodes.keycodes import Keycode, RAWCODES_MAP, KEYCODES_MEDIA, KEYCODES_BACKLIGHT

MOD_NAMES = {
    "LCTL": "Ctrl", "LSFT": "Shift", "LALT": "Alt", "LGUI": "Gui",
    "RCTL": "RCtrl", "RSFT": "RShift", "RALT": "AltGr", "RGUI": "RGui",
    "C_S": "Ctrl+Shift", "LCA": "Ctrl+Alt", "LCG": "Ctrl+Gui", "LSA": "Shift+Alt", "LAG": "Alt+Gui",
    "SGUI": "Gui+Shift", "LCAG": "Ctrl+Alt+Gui", "RCG": "RCtrl+RGui", "RCAG": "RCtrl+RAlt+RGui",
    "MEH": "Meh", "HYPR": "Hyper", "ALL": "Hyper",
}
LAYER_ACTIONS = {
    "MO": "while held", "TG": "toggle", "TO": "switch to", "TT": "hold, or tap to toggle",
    "OSL": "one-shot", "DF": "set default", "PDF": "set default (saved)",
}
MODIFIER_KEYS = {"KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"}
MOUSE_PREFIXES = ("KC_MS_", "KC_BTN", "KC_WH_", "KC_ACL")

RE_TAP_DANCE = re.compile(r"^TD\((\d+)\)$")
RE_MACRO = re.compile(r"^M(\d+)$")
RE_LAYER = re.compile(r"^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$")
RE_LAYER_TAP = re.compile(r"^LT(\d+)\((.+)\)$")


def _result(code, kind, tap, hold=None, layer=None, index=None):
    return {"code": code, "kind": kind, "tap": tap, "hold": hold, "layer": layer, "index": index,
            "tooltip": Keycode.tooltip(code)}


def one_line(label):
    """ "!\\n1" (shifted over unshifted) -> "1"; "Caps\\nLock" -> "Caps Lock" """
    lines = [line.strip() for line in label.split("\n") if line.strip()]
    if len(lines) == 2 and all(len(line) == 1 for line in lines):
        return lines[-1]
    return " ".join(lines)


def _short_label(code):
    return one_line(Keycode.label(code))


def _mods(outer_qmk_id):
    """ "LSFT_T(kc)" or "LSFT(kc)" -> "Shift" """
    prefix = outer_qmk_id[:outer_qmk_id.find("(")]
    if prefix.endswith("_T"):
        prefix = prefix[:-2]
    return MOD_NAMES.get(prefix, prefix)


def describe(code):
    """ Keycode string (as the protocol layer stores it) -> description dict for the UI """
    code = Keycode.normalize(code)

    if code == "KC_NO":
        return _result(code, "none", "")
    if code == "KC_TRNS":
        return _result(code, "transparent", "▽")

    m = RE_TAP_DANCE.match(code)
    if m:
        return _result(code, "tap-dance", "TD {}".format(m.group(1)), index=int(m.group(1)))
    m = RE_MACRO.match(code)
    if m:
        return _result(code, "macro", "M {}".format(m.group(1)), index=int(m.group(1)))
    m = RE_LAYER.match(code)
    if m:
        layer = int(m.group(2))
        return _result(code, "layer", "{} {}".format(m.group(1), layer), LAYER_ACTIONS[m.group(1)], layer=layer)
    m = RE_LAYER_TAP.match(code)
    if m:
        layer = int(m.group(1))
        return _result(code, "layer-tap", Keycode.label(m.group(2)), "layer {}".format(layer), layer=layer)

    if Keycode.is_mask(code):
        outer = Keycode.find_outer_keycode(code).qmk_id
        inner = Keycode.find_inner_keycode(code).qmk_id
        if outer.endswith("_T(kc)"):
            return _result(code, "mod-tap", Keycode.label(inner), _mods(outer))
        # a modifier held with a key: shifted symbols have their own label, e.g. LSFT(KC_1) is "!"
        direct = RAWCODES_MAP.get(Keycode.deserialize(code))
        if direct is not None and not direct.masked:
            return _result(code, "basic", direct.label)
        return _result(code, "basic", "{}+{}".format(_mods(outer), _short_label(inner)))

    if code.startswith("OSM("):
        return _result(code, "one-shot-mod", "OSM", Keycode.label(code).split("\n", 1)[-1].replace("\n", " "))
    if code in MODIFIER_KEYS:
        return _result(code, "modifier", Keycode.label(code))
    if code.startswith(MOUSE_PREFIXES):
        return _result(code, "mouse", Keycode.label(code))
    if code in {k.qmk_id for k in KEYCODES_MEDIA}:
        return _result(code, "media", Keycode.label(code))
    if code in {k.qmk_id for k in KEYCODES_BACKLIGHT}:
        return _result(code, "lighting", Keycode.label(code))
    if Keycode.find(code) is not None and Keycode.is_basic(code):
        return _result(code, "basic", Keycode.label(code))
    return _result(code, "other", Keycode.label(code))


def parse(expression):
    """ Free-form keycode expression, e.g. "LCTL(KC_A)" or "0x7E05" -> description; raises ValueError """
    try:
        value = Keycode.deserialize(expression.strip(), reraise=True)
    except Exception as e:
        raise ValueError("not a valid keycode: {}".format(e))
    if not isinstance(value, int) or not 0 <= value <= 0xFFFF:
        raise ValueError("keycode must be a number between 0 and 0xFFFF")
    return describe(Keycode.serialize(value))
```

- [ ] **Step 5: Run the tests.** Expected: `31 passed`.

- [ ] **Step 6: Commit**

```bash
git add requirements.txt test-requirements.txt src/main/python/server src/main/python/test/test_describe.py
git commit -m "feat(server): describe keycodes for the UI"
```

### Task 8: Names store

**Files:**
- Create: `src/main/python/server/names.py`, `src/main/python/test/test_names.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_names.py`:

```python
import json

import pytest

from server.names import NamesStore, suggest_tap_dance_name, suggest_macro_name


def slot(kind, tap, code="X"):
    return {"kind": kind, "tap": tap, "code": code}


def test_missing_file_means_no_names(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    assert store.get("ABC") == {"layers": {}, "tapDance": {}, "macros": {}}


def test_set_get_and_clear(tmp_path):
    path = tmp_path / "sub" / "names.json"
    store = NamesStore(str(path))
    store.set("ABC", "layers", 1, "  symbols  ")
    store.set("ABC", "macros", 0, "git")
    assert store.get("ABC")["layers"] == {"1": "symbols"}
    assert json.loads(path.read_text(encoding="utf-8"))["ABC"]["macros"] == {"0": "git"}
    store.set("ABC", "layers", 1, "")
    assert store.get("ABC")["layers"] == {}
    assert store.get("OTHER")["macros"] == {}


def test_names_are_truncated(tmp_path):
    store = NamesStore(str(tmp_path / "names.json"))
    assert store.set("ABC", "tapDance", 0, "x" * 100)["tapDance"]["0"] == "x" * 40


def test_unknown_kind_rejected(tmp_path):
    with pytest.raises(ValueError):
        NamesStore(str(tmp_path / "names.json")).set("ABC", "combos", 0, "x")


def test_corrupt_file_is_ignored(tmp_path):
    path = tmp_path / "names.json"
    path.write_text("not json", encoding="utf-8")
    assert NamesStore(str(path)).get("ABC")["layers"] == {}


def test_suggest_tap_dance_name():
    slots = [slot("basic", "Tab"), slot("none", ""), slot("basic", "Caps\nLock"), slot("none", "")]
    assert suggest_tap_dance_name(slots) == "Tab / Caps Lock"
    assert suggest_tap_dance_name([slot("none", "")] * 4) == ""


def test_suggest_macro_name():
    assert suggest_macro_name([{"type": "text", "text": "git status", "keys": []}]) == "git status"
    assert suggest_macro_name([{"type": "tap", "text": None, "keys": [slot("basic", "Home")]}]) == "Home"
    assert suggest_macro_name([]) == ""
```

- [ ] **Step 2: Run them to see them fail.** Expected: `ModuleNotFoundError: No module named 'server.names'`.

- [ ] **Step 3: Implement**

Create `src/main/python/server/names.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" User names for layers, tap dances and macros. The firmware can't store names, so they live in a JSON file,
keyed by the keyboard's UID. """
import json
import os
import threading

from server.describe import one_line

KINDS = ("layers", "tapDance", "macros")


class NamesStore:

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as inf:
                data = json.load(inf)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, uid):
        """ {"layers": {"0": "base"}, "tapDance": {...}, "macros": {...}} for this keyboard """
        with self.lock:
            stored = self._load().get(uid, {})
        return {kind: dict(stored.get(kind, {})) for kind in KINDS}

    def set(self, uid, kind, index, name):
        """ Set a name; an empty or None name removes it """
        if kind not in KINDS:
            raise ValueError("unknown name kind: {}".format(kind))
        with self.lock:
            data = self._load()
            entry = data.setdefault(uid, {}).setdefault(kind, {})
            name = (name or "").strip()
            if name:
                entry[str(index)] = name[:40]
            else:
                entry.pop(str(index), None)
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as outf:
                json.dump(data, outf, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
        return self.get(uid)


def suggest_tap_dance_name(described_slots):
    """ "Tab / Caps" from the described (tap, hold, double tap, tap-hold) slots; "" when all are empty """
    labels = []
    for slot in described_slots:
        if slot["kind"] != "none":
            label = one_line(slot["tap"]) or slot["code"]
            if label not in labels:
                labels.append(label)
    return " / ".join(labels)


def suggest_macro_name(actions):
    """ A macro's first typed text, or its first key, e.g. "git status"; "" for an empty macro """
    for action in actions:
        if action["type"] == "text" and action["text"].strip():
            return action["text"].strip()[:24]
    for action in actions:
        if action["type"] in ("tap", "down") and action["keys"]:
            return one_line(action["keys"][0]["tap"])
    return ""
```

- [ ] **Step 4: Run the tests.** Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/names.py src/main/python/test/test_names.py
git commit -m "feat(server): store user names for layers, tap dances and macros"
```

### Task 9: API shapes and the keyboard model

**Files:**
- Create: `src/main/python/server/schemas.py`, `src/main/python/server/model.py`, `src/main/python/test/test_model.py`

- [ ] **Step 1: Write the failing tests**

Create `src/main/python/test/test_model.py`:

```python
from server import model

NO_NAMES = {"layers": {}, "tapDance": {}, "macros": {}}


def key_index(result, row, col):
    return next(i for i, k in enumerate(result.keys) if (k.row, k.col) == (row, col))


def test_build_geometry_and_layers(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=True)
    assert result.name == "Simulated Corne"
    assert result.uid == "5EEDC0DE00420042"
    assert (result.rows, result.cols, len(result.keys), len(result.encoders)) == (8, 6, 42, 0)
    assert [layer.name for layer in result.layers] == ["Base", "Layer 1", "Layer 2", "Layer 3"]
    s_key = result.layers[0].keys[key_index(result, 1, 1)]
    assert (s_key.kind, s_key.tap, s_key.hold, s_key.layer) == ("layer-tap", "S", "layer 2", 2)
    thumb = result.keys[key_index(result, 7, 5)]
    assert (thumb.x, thumb.y) == (9, 3)


def test_build_uses_custom_names(corne_keyboard):
    virtual, kb = corne_keyboard
    names = {"layers": {"1": "symbols"}, "tapDance": {"0": "Caps"}, "macros": {}}
    result = model.build(kb, names, unlocked=True)
    assert (result.layers[1].name, result.layers[1].customName) == ("symbols", True)
    assert (result.tapDance[0].name, result.tapDance[0].customName) == ("Caps", True)


def test_build_behaviours(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=True)
    td = result.tapDance[0]
    assert (td.name, td.tap.tap, td.doubleTap.code, td.hold.kind, td.tappingTerm) == \
        ("Tab / Caps Lock", "Tab", "KC_CAPSLOCK", "none", 200)
    assert [k.code for k in result.combos[0].keys] == ["KC_K", "KC_Y", "KC_NO", "KC_NO"]
    assert result.combos[0].output.code == "KC_ESCAPE"
    assert (result.keyOverrides[0].trigger.code, result.keyOverrides[0].enabled) == ("KC_BSPACE", True)
    assert len(result.altRepeatKeys) == 4


def test_build_macros_settings_lighting(corne_keyboard):
    virtual, kb = corne_keyboard
    result = model.build(kb, NO_NAMES, unlocked=False)
    assert (result.macros.count, result.macros.memory, result.macros.used) == (16, 900, len(kb.macro))
    first = result.macros.items[0]
    assert first.name == "git status"
    assert [a.type for a in first.actions] == ["text", "tap"]
    assert result.macros.items[1].actions[4].delay == 50
    assert {s.qsid: s.value for s in result.settings}[7] == 200
    assert result.lighting.vialrgb.mode == 2 and result.lighting.rgblight is None
    assert "caps_word" in result.features
    assert result.unlocked is False


def test_keycode_catalogue(corne_keyboard):
    catalogue = {c["name"]: c for c in model.keycode_catalogue()}
    assert "KC_A" in [k.code for k in catalogue["Basic"]["keycodes"]]
    assert "TD(7)" in [k.code for k in catalogue["Tap dance"]["keycodes"]]
    assert "LT0(kc)" in catalogue["Layers"]["templates"]
```

- [ ] **Step 2: Run them to see them fail.** Expected: `ImportError: cannot import name 'model' from 'server'`.

- [ ] **Step 3: Create the schemas**

Create `src/main/python/server/schemas.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------- responses ----------


class Described(BaseModel):
    code: str
    kind: str
    tap: str
    hold: Optional[str] = None
    layer: Optional[int] = None
    index: Optional[int] = None
    tooltip: Optional[str] = None


class KeyGeometry(BaseModel):
    """ One physical key (or encoder direction) in keyboard units; rotation in degrees around (rx, ry) """
    row: Optional[int] = None
    col: Optional[int] = None
    encoder: Optional[int] = None
    direction: Optional[int] = None
    x: float
    y: float
    w: float
    h: float
    x2: float = 0
    y2: float = 0
    w2: float = 1
    h2: float = 1
    r: float = 0
    rx: float = 0
    ry: float = 0
    layoutIndex: int = -1
    layoutOption: int = -1
    decal: bool = False


class Layer(BaseModel):
    index: int
    name: str
    customName: bool
    keys: list[Described]
    """ aligned with KeyboardModel.keys """
    encoders: list[Described]
    """ aligned with KeyboardModel.encoders """


class TapDance(BaseModel):
    index: int
    name: str
    customName: bool
    tap: Described
    hold: Described
    doubleTap: Described
    tapHold: Described
    tappingTerm: int


class Combo(BaseModel):
    index: int
    keys: list[Described]
    output: Described


class KeyOverride(BaseModel):
    index: int
    trigger: Described
    replacement: Described
    layers: int
    triggerMods: int
    negativeModMask: int
    suppressedMods: int
    options: int
    enabled: bool


class AltRepeatKey(BaseModel):
    index: int
    keycode: Described
    altKeycode: Described
    allowedMods: int
    options: int
    enabled: bool


class MacroAction(BaseModel):
    type: Literal["text", "tap", "down", "up", "delay"]
    text: Optional[str] = None
    keys: list[Described] = []
    delay: Optional[int] = None


class Macro(BaseModel):
    index: int
    name: str
    customName: bool
    actions: list[MacroAction]


class Macros(BaseModel):
    count: int
    memory: int
    used: int
    items: list[Macro]


class QmkSetting(BaseModel):
    qsid: int
    value: int


class VialRgb(BaseModel):
    mode: int
    speed: int
    hsv: list[int]
    maxBrightness: int
    supportedEffects: list[int]


class RgbLight(BaseModel):
    brightness: int
    effect: int
    speed: int
    hue: int
    saturation: int


class Backlight(BaseModel):
    brightness: int
    effect: int


class Lighting(BaseModel):
    vialrgb: Optional[VialRgb] = None
    rgblight: Optional[RgbLight] = None
    backlight: Optional[Backlight] = None


class LayoutOptions(BaseModel):
    value: int
    labels: list


class KeyboardModel(BaseModel):
    name: str
    uid: str
    viaProtocol: int
    vialProtocol: int
    rows: int
    cols: int
    keys: list[KeyGeometry]
    encoders: list[KeyGeometry]
    layoutOptions: Optional[LayoutOptions] = None
    layers: list[Layer]
    tapDance: list[TapDance]
    combos: list[Combo]
    keyOverrides: list[KeyOverride]
    altRepeatKeys: list[AltRepeatKey]
    macros: Macros
    settings: list[QmkSetting]
    lighting: Lighting
    features: list[str]
    unlocked: bool


class Session(BaseModel):
    status: Literal["connected", "disconnected"]
    fake: bool
    device: Optional[str] = None
    error: Optional[str] = None


class Names(BaseModel):
    layers: dict[str, str]
    tapDance: dict[str, str]
    macros: dict[str, str]


# ---------- requests ----------


class SetKeycode(BaseModel):
    code: str


class SetLayoutOptions(BaseModel):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class ParseRequest(BaseModel):
    expression: str = Field(max_length=200)


class TapDanceIn(BaseModel):
    tap: str
    hold: str
    doubleTap: str
    tapHold: str
    tappingTerm: int = Field(ge=0, le=10000)


class ComboIn(BaseModel):
    keys: list[str] = Field(min_length=4, max_length=4)
    output: str


class KeyOverrideIn(BaseModel):
    trigger: str
    replacement: str
    layers: int = Field(ge=0, le=0xFFFF)
    triggerMods: int = Field(ge=0, le=0xFF)
    negativeModMask: int = Field(ge=0, le=0xFF)
    suppressedMods: int = Field(ge=0, le=0xFF)
    options: int = Field(ge=0, le=0xFF)


class AltRepeatKeyIn(BaseModel):
    keycode: str
    altKeycode: str
    allowedMods: int = Field(ge=0, le=0xFF)
    options: int = Field(ge=0, le=0xFF)


class MacroActionIn(BaseModel):
    type: Literal["text", "tap", "down", "up", "delay"]
    text: Optional[str] = None
    keys: list[str] = []
    delay: Optional[int] = Field(default=None, ge=0, le=64000)


class MacrosIn(BaseModel):
    items: list[list[MacroActionIn]]


class SettingIn(BaseModel):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class VialRgbIn(BaseModel):
    mode: Optional[int] = Field(default=None, ge=0, le=0xFFFF)
    speed: Optional[int] = Field(default=None, ge=0, le=255)
    hsv: Optional[list[int]] = Field(default=None, min_length=3, max_length=3)


class RgbLightIn(BaseModel):
    brightness: Optional[int] = Field(default=None, ge=0, le=255)
    effect: Optional[int] = Field(default=None, ge=0, le=255)
    speed: Optional[int] = Field(default=None, ge=0, le=255)
    hue: Optional[int] = Field(default=None, ge=0, le=255)
    saturation: Optional[int] = Field(default=None, ge=0, le=255)


class BacklightIn(BaseModel):
    brightness: Optional[int] = Field(default=None, ge=0, le=255)
    effect: Optional[int] = Field(default=None, ge=0, le=255)


class LightingIn(BaseModel):
    vialrgb: Optional[VialRgbIn] = None
    rgblight: Optional[RgbLightIn] = None
    backlight: Optional[BacklightIn] = None
    save: bool = True


class NameIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
```

- [ ] **Step 4: Create the model builder**

Create `src/main/python/server/model.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Builds the API's view of a loaded keyboard. Reads only what the protocol layer already holds: no device I/O. """
from keycodes.keycodes import KEYCODES_SPECIAL, KEYCODES_BASIC, KEYCODES_SHIFTED, KEYCODES_ISO, KEYCODES_LAYERS, \
    KEYCODES_BOOT, KEYCODES_MODIFIERS, KEYCODES_QUANTUM, KEYCODES_BACKLIGHT, KEYCODES_MEDIA, KEYCODES_TAP_DANCE, \
    KEYCODES_MACRO, KEYCODES_USER, KEYCODES_MIDI
from macro.macro_action import ActionText, ActionDelay, ActionSequence
from server import schemas
from server.describe import describe
from server.names import suggest_tap_dance_name, suggest_macro_name

KEYCODE_CATEGORIES = [
    ("Basic", KEYCODES_SPECIAL + KEYCODES_BASIC),
    ("Shifted", KEYCODES_SHIFTED),
    ("ISO / JIS", KEYCODES_ISO),
    ("Layers", KEYCODES_LAYERS),
    ("Modifiers", KEYCODES_MODIFIERS),
    ("Quantum", KEYCODES_QUANTUM),
    ("Lighting", KEYCODES_BACKLIGHT),
    ("Media", KEYCODES_MEDIA),
    ("Tap dance", KEYCODES_TAP_DANCE),
    ("Macros", KEYCODES_MACRO),
    ("User", KEYCODES_USER),
    ("MIDI", KEYCODES_MIDI),
    ("Boot", KEYCODES_BOOT),
]


def d(code):
    return schemas.Described(**describe(code))


def geometry(key):
    return schemas.KeyGeometry(
        row=key.row, col=key.col, encoder=key.encoder_idx, direction=key.encoder_dir,
        x=key.x, y=key.y, w=key.width, h=key.height, x2=key.x2, y2=key.y2, w2=key.width2, h2=key.height2,
        r=key.rotation_angle, rx=key.rotation_x, ry=key.rotation_y,
        layoutIndex=key.layout_index, layoutOption=key.layout_option, decal=key.decal,
    )


def layer_name(names, index):
    custom = names["layers"].get(str(index))
    return (custom, True) if custom else (("Base" if index == 0 else "Layer {}".format(index)), False)


def tap_dance(index, entry, names):
    tap, hold, double_tap, tap_hold, term = entry
    slots = [d(tap), d(hold), d(double_tap), d(tap_hold)]
    custom = names["tapDance"].get(str(index))
    return schemas.TapDance(
        index=index, name=custom or suggest_tap_dance_name([s.model_dump() for s in slots]),
        customName=bool(custom), tap=slots[0], hold=slots[1], doubleTap=slots[2], tapHold=slots[3],
        tappingTerm=term,
    )


def combo(index, entry):
    return schemas.Combo(index=index, keys=[d(code) for code in entry[:4]], output=d(entry[4]))


def key_override(index, entry):
    return schemas.KeyOverride(
        index=index, trigger=d(entry.trigger), replacement=d(entry.replacement), layers=entry.layers,
        triggerMods=entry.trigger_mods, negativeModMask=entry.negative_mod_mask,
        suppressedMods=entry.suppressed_mods, options=entry.options.serialize(), enabled=entry.options.enabled,
    )


def alt_repeat_key(index, entry):
    return schemas.AltRepeatKey(
        index=index, keycode=d(entry.keycode), altKeycode=d(entry.alt_keycode), allowedMods=entry.allowed_mods,
        options=entry.options.serialize(), enabled=entry.options.enabled,
    )


def macro_action(action):
    if isinstance(action, ActionText):
        return schemas.MacroAction(type="text", text=action.text)
    if isinstance(action, ActionDelay):
        return schemas.MacroAction(type="delay", delay=action.delay)
    if isinstance(action, ActionSequence):
        return schemas.MacroAction(type=action.tag, keys=[d(code) for code in action.sequence])
    raise ValueError("unknown macro action {!r}".format(action))


def macros(kb, names):
    items = []
    for index, actions in enumerate(kb.macros_deserialize(kb.macro)):
        converted = [macro_action(a) for a in actions]
        custom = names["macros"].get(str(index))
        items.append(schemas.Macro(index=index, name=custom or suggest_macro_name([a.model_dump() for a in converted]),
                                   customName=bool(custom), actions=converted))
    return schemas.Macros(count=kb.macro_count, memory=kb.macro_memory, used=len(kb.macro), items=items)


def lighting(kb):
    out = schemas.Lighting()
    if kb.lighting_vialrgb:
        out.vialrgb = schemas.VialRgb(mode=kb.rgb_mode, speed=kb.rgb_speed, hsv=list(kb.rgb_hsv),
                                      maxBrightness=kb.rgb_maximum_brightness,
                                      supportedEffects=sorted(kb.rgb_supported_effects))
    if kb.lighting_qmk_rgblight:
        out.rgblight = schemas.RgbLight(brightness=kb.underglow_brightness, effect=kb.underglow_effect,
                                        speed=kb.underglow_effect_speed, hue=kb.underglow_color[0],
                                        saturation=kb.underglow_color[1])
    if kb.lighting_qmk_backlight:
        out.backlight = schemas.Backlight(brightness=kb.backlight_brightness, effect=kb.backlight_effect)
    return out


def build(kb, names, unlocked):
    """ Keyboard (already reloaded) + names for its UID -> KeyboardModel """
    layers = []
    for index in range(kb.layers):
        name, custom = layer_name(names, index)
        layers.append(schemas.Layer(
            index=index, name=name, customName=custom,
            keys=[d(kb.layout[(index, key.row, key.col)]) for key in kb.keys],
            encoders=[d(kb.encoder_layout[(index, key.encoder_idx, key.encoder_dir)]) for key in kb.encoders],
        ))
    layout_options = None
    if kb.layout_labels:
        layout_options = schemas.LayoutOptions(value=kb.layout_options, labels=kb.layout_labels)
    return schemas.KeyboardModel(
        name=kb.definition.get("name", "Keyboard"),
        uid=uid_of(kb),
        viaProtocol=kb.via_protocol,
        vialProtocol=kb.vial_protocol,
        rows=kb.rows,
        cols=kb.cols,
        keys=[geometry(key) for key in kb.keys],
        encoders=[geometry(key) for key in kb.encoders],
        layoutOptions=layout_options,
        layers=layers,
        tapDance=[tap_dance(i, e, names) for i, e in enumerate(kb.tap_dance_entries)],
        combos=[combo(i, e) for i, e in enumerate(kb.combo_entries)],
        keyOverrides=[key_override(i, e) for i, e in enumerate(kb.key_override_entries)],
        altRepeatKeys=[alt_repeat_key(i, e) for i, e in enumerate(kb.alt_repeat_key_entries)],
        macros=macros(kb, names),
        settings=[schemas.QmkSetting(qsid=q, value=v) for q, v in sorted(kb.settings.items())],
        lighting=lighting(kb),
        features=sorted(kb.supported_features),
        unlocked=unlocked,
    )


def uid_of(kb):
    return "{:016X}".format(kb.keyboard_id & 0xFFFFFFFFFFFFFFFF)


def keycode_catalogue():
    """ Keycodes the picker offers, grouped; hidden (unsupported) keycodes are left out """
    out = []
    for name, keycodes in KEYCODE_CATEGORIES:
        items = [d(kc.qmk_id) for kc in keycodes if not kc.hidden and "(kc)" not in kc.qmk_id]
        masks = [kc.qmk_id for kc in keycodes if not kc.hidden and "(kc)" in kc.qmk_id]
        if items or masks:
            out.append({"name": name, "keycodes": items, "templates": masks})
    return out
```

- [ ] **Step 5: Run the tests.** Expected: `5 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/schemas.py src/main/python/server/model.py src/main/python/test/test_model.py
git commit -m "feat(server): keyboard model and API schemas"
```

### Task 10: Device manager and HID discovery

**Files:**
- Create: `src/main/python/server/device.py`, `src/main/python/server/hid_discovery.py`, `src/main/python/test/test_device_manager.py`, `src/main/python/test/test_hid_discovery.py`

- [ ] **Step 1: Write the failing tests.** Discovery is tested against a fake `hid` module, so no real device is ever enumerated:

Create `src/main/python/test/test_device_manager.py`:

```python
import pytest

import transport
from server.device import DeviceManager, FakeBackend, NotConnected, KeyboardLocked, require_unlocked
from simulator.corne import make_corne


@pytest.fixture
def manager(monkeypatch):
    # failed sends retry with 0.5 s pauses; skip the waiting
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    m = DeviceManager(FakeBackend(make_corne))
    assert m.connect()
    return m


def test_connect_loads_keyboard(manager):
    assert manager.connected
    assert manager.title == "Simulated: Simulated Corne"
    assert manager.unlocked
    assert manager.run(lambda kb: kb.layers) == 4


def test_run_without_keyboard_raises():
    m = DeviceManager(FakeBackend(make_corne))
    with pytest.raises(NotConnected):
        m.run(lambda kb: None)


def test_unplug_and_replug_are_reported(manager):
    manager.backend.virtual.connected = False
    assert manager.check() == ["disconnected"]
    assert not manager.connected
    assert manager.check() == []
    manager.backend.virtual.connected = True
    assert manager.check() == ["connected"]
    assert manager.connected


def test_unplug_during_write_raises_not_connected(manager):
    manager.backend.virtual.connected = False
    with pytest.raises(NotConnected):
        manager.run(lambda kb: kb.set_key(0, 0, 0, "KC_B"))
    assert manager.check() == ["disconnected"]


def test_write_error_while_present_is_reraised(manager):
    def fail(kb):
        raise RuntimeError("bad reply")
    with pytest.raises(RuntimeError, match="bad reply"):
        manager.run(fail)
    assert manager.connected


def test_reload_rereads_device(manager):
    manager.backend.virtual.keymap[0][0][0] = 0x04
    manager.reload()
    assert manager.run(lambda kb: kb.layout[(0, 0, 0)]) == "KC_A"


def test_require_unlocked(manager):
    require_unlocked(manager.keyboard)
    manager.backend.virtual.unlocked = False
    with pytest.raises(KeyboardLocked):
        require_unlocked(manager.keyboard)
```

Create `src/main/python/test/test_hid_discovery.py`:

```python
import sys

import server.hid_discovery as discovery


class FakeHidDevice:
    opened = []

    def open_path(self, path):
        FakeHidDevice.opened.append(path)

    def close(self):
        pass


class FakeHid:
    """ Stands in for hidapi so no real device is ever enumerated """

    def __init__(self, devices):
        self.devices = devices

    def enumerate(self):
        return self.devices

    @staticmethod
    def device():
        return FakeHidDevice()


def desc(path, serial, usage_page=0xFF60, usage=0x61):
    return {"path": path, "serial_number": serial, "usage_page": usage_page, "usage": usage,
            "manufacturer_string": "Test", "product_string": "Board", "vendor_id": 1, "product_id": 2}


def test_finds_only_vial_raw_hid_interfaces(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(discovery, "hid", FakeHid([
        desc(b"vial-raw", "vial:f64c2b3c"),
        desc(b"vial-keyboard-interface", "vial:f64c2b3c", usage_page=0x0001, usage=0x06),
        desc(b"other", "ABC123"),
        desc(b"no-serial", None),
    ]))
    assert [d["path"] for d in discovery.find_vial_keyboards()] == [b"vial-raw"]


def test_linux_checks_the_device_can_be_opened(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    FakeHidDevice.opened = []
    monkeypatch.setattr(discovery, "hid", FakeHid([desc(b"/dev/hidraw3", "vial:f64c2b3c")]))
    assert len(discovery.find_vial_keyboards()) == 1
    assert FakeHidDevice.opened == [b"/dev/hidraw3"]
```

- [ ] **Step 2: Run them to see them fail.** Expected: `ModuleNotFoundError: No module named 'server.device'`.

- [ ] **Step 3: Implement**

Create `src/main/python/server/device.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds and opens the keyboard, keeps it loaded, and serializes all access to it. """
import logging
import threading

from protocol.keyboard_comm import Keyboard
from simulator.device import SimulatedHidDevice

log = logging.getLogger(__name__)


class NotConnected(RuntimeError):
    pass


class KeyboardLocked(RuntimeError):
    pass


def require_unlocked(keyboard):
    """ Unlock handler for the server: the web UI can't run the unlock flow yet, so refuse instead """
    if keyboard.get_unlock_status() != 1:
        raise KeyboardLocked("the keyboard is locked; unlock it in the Qt app to change security-sensitive keys")
    return True


class FakeBackend:
    """ Serves one simulated keyboard. Never touches hidapi. """

    fake = True

    def __init__(self, keyboard_factory):
        self.keyboard_factory = keyboard_factory
        self.virtual = None

    def find(self):
        if self.virtual is None:
            self.virtual = self.keyboard_factory()
        return ["simulated"] if self.virtual.connected else []

    def open(self, candidate):
        return SimulatedHidDevice(self.virtual), "Simulated: " + self.virtual.definition.get("name", "keyboard")

    def present(self, candidate):
        return self.virtual is not None and self.virtual.connected


class HidBackend:
    """ Real keyboards through hidapi; imported lazily so fake mode never loads hidapi """

    fake = False

    def find(self):
        from server.hid_discovery import find_vial_keyboards
        return find_vial_keyboards()

    def open(self, desc):
        from hidproxy import hid
        dev = hid.device()
        dev.open_path(desc["path"])
        title = "{} {}".format(desc.get("manufacturer_string", ""), desc.get("product_string", "")).strip()
        return dev, title or "Vial keyboard"

    def present(self, desc):
        from hidproxy import hid
        return any(d["path"] == desc["path"] for d in hid.enumerate())


class DeviceManager:

    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.RLock()
        self.keyboard = None
        self.device = None
        self.candidate = None
        self.title = None
        self.error = None
        self.unlocked = False
        self.pending_events = []

    @property
    def connected(self):
        return self.keyboard is not None

    def connect(self):
        """ Open the first keyboard found and load everything from it. Returns True when connected. """
        with self.lock:
            self._close()
            for candidate in self.backend.find():
                dev = None
                try:
                    dev, title = self.backend.open(candidate)
                    keyboard = Keyboard(dev)
                    keyboard.reload()
                    unlocked = keyboard.get_unlock_status() == 1
                except Exception as e:
                    log.warning("could not load keyboard %s: %s", candidate, e)
                    self.error = str(e) or e.__class__.__name__
                    if dev is not None:
                        dev.close()
                    continue
                self.keyboard, self.device, self.candidate, self.title = keyboard, dev, candidate, title
                self.unlocked, self.error = unlocked, None
                log.info("connected to %s", title)
                return True
            return False

    def reload(self):
        """ Read everything from the keyboard again """
        def do_reload(keyboard):
            keyboard.reload()
            self.unlocked = keyboard.get_unlock_status() == 1
        self.run(do_reload)

    def run(self, fn):
        """ Call fn(keyboard) while holding the device lock """
        with self.lock:
            if self.keyboard is None:
                raise NotConnected("no keyboard connected")
            try:
                return fn(self.keyboard)
            except (OSError, RuntimeError) as e:
                if isinstance(e, (NotConnected, KeyboardLocked)) or self.backend.present(self.candidate):
                    raise
                self._close()
                self.pending_events.append("disconnected")
                raise NotConnected("keyboard disconnected") from e

    def check(self):
        """ Hot-plug poll, called about once a second. Returns the events since the last call. """
        with self.lock:
            if self.keyboard is not None and not self.backend.present(self.candidate):
                self._close()
                self.pending_events.append("disconnected")
            elif self.keyboard is None and self.connect():
                self.pending_events.append("connected")
            events, self.pending_events = self.pending_events, []
            return events

    def _close(self):
        if self.device is not None:
            try:
                self.device.close()
            except Exception:
                pass
        self.keyboard = self.device = self.candidate = self.title = None
        self.unlocked = False
```

Create `src/main/python/server/hid_discovery.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds Vial keyboards among HID devices. Imports hidapi, so only the real (non-fake) backend uses it. """
import logging
import sys

from hidproxy import hid

log = logging.getLogger(__name__)

VIAL_SERIAL_NUMBER_MAGIC = "vial:f64c2b3c"
RAW_HID_USAGE_PAGE = 0xFF60
RAW_HID_USAGE = 0x61


def is_raw_hid(desc):
    if desc["usage_page"] != RAW_HID_USAGE_PAGE or desc["usage"] != RAW_HID_USAGE:
        return False
    # only Linux needs a permission check; macOS won't let us reopen an open device
    if not sys.platform.startswith("linux"):
        return True
    dev = hid.device()
    try:
        dev.open_path(desc["path"])
    except OSError as e:
        log.warning("cannot open %s: %s (check udev rules)", desc["path"], e)
        return False
    dev.close()
    return True


def find_vial_keyboards():
    """ Device descriptors of connected Vial keyboards' raw HID interfaces """
    return [desc for desc in hid.enumerate()
            if VIAL_SERIAL_NUMBER_MAGIC in (desc.get("serial_number") or "") and is_raw_hid(desc)]
```

- [ ] **Step 4: Run the tests.** Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/python/server/device.py src/main/python/server/hid_discovery.py src/main/python/test/test_device_manager.py src/main/python/test/test_hid_discovery.py
git commit -m "feat(server): device manager with hot-plug detection, fake and hidapi backends"
```

### Task 11: Edits and the FastAPI app

**Files:**
- Create: `src/main/python/server/edits.py`, `src/main/python/server/app.py`, `src/main/python/test/test_api.py`

- [ ] **Step 1: Write the failing tests.** They cover:
  - **Security:** Host, Origin, and the token-to-cookie handshake.
  - **Every route** against the simulator.
  - **Error codes:** 422 invalid, 423 locked, 503 unplugged.
  - **The WebSocket,** and detection of the last tab closing.

Create `src/main/python/test/test_api.py`:

```python
import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import transport
from protocol.unlock_hook import set_unlock_handler
from server.app import create_app
from server.device import DeviceManager, FakeBackend, require_unlocked
from server.names import NamesStore
from simulator.corne import make_corne, encode

TOKEN = "test-token"
PORT = 8765
BASE = "http://127.0.0.1:{}".format(PORT)
ORIGIN = {"origin": BASE}
# the test client sends "Host: testserver" on WebSockets unless the URL names the host
EVENTS = "ws://127.0.0.1:{}/api/events".format(PORT)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """ (client with a session cookie, simulated keyboard, app) """
    monkeypatch.setattr(transport.time, "sleep", lambda s: None)
    set_unlock_handler(require_unlocked)
    manager = DeviceManager(FakeBackend(make_corne))
    manager.connect()
    gone = []
    app = create_app(manager, NamesStore(str(tmp_path / "names.json")), TOKEN, PORT, poll_interval=0,
                     close_grace=0.05, on_all_clients_gone=lambda: gone.append(True))
    app.state.gone = gone
    with TestClient(app, base_url=BASE) as client:
        response = client.get("/?token=" + TOKEN, follow_redirects=False)
        assert response.status_code == 303
        yield client, manager.backend.virtual, app
    set_unlock_handler(None)


@pytest.fixture
def client(setup):
    return setup[0]


@pytest.fixture
def virtual(setup):
    return setup[1]


# ---------- security ----------

def test_token_handshake_sets_http_only_cookie(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        response = c.get("/?token=" + TOKEN, follow_redirects=False)
        assert response.headers["location"] == "/"
        cookie = response.headers["set-cookie"]
        assert "vial_session=" + TOKEN in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie


def test_requests_without_session_are_refused(tmp_path):
    manager = DeviceManager(FakeBackend(make_corne))
    app = create_app(manager, NamesStore(str(tmp_path / "n.json")), TOKEN, PORT, poll_interval=0)
    with TestClient(app, base_url=BASE) as c:
        assert c.get("/api/session").status_code == 401
        assert c.get("/?token=wrong").status_code == 401
        assert c.get("/").status_code == 401
        assert c.get("/api/health").status_code == 200


def test_foreign_host_and_origin_are_refused(client):
    assert client.get("/api/session", headers={"host": "evil.example"}).status_code == 403
    assert client.get("/api/session", headers={"host": "127.0.0.1:9999"}).status_code == 403
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"},
                      headers={"origin": "http://evil.example"}).status_code == 403
    assert client.get("/api/session", headers=ORIGIN).status_code == 200


# ---------- reading ----------

def test_session_and_keyboard(client):
    assert client.get("/api/session").json() == \
        {"status": "connected", "fake": True, "device": "Simulated: Simulated Corne", "error": None}
    kb = client.get("/api/keyboard").json()
    assert (kb["name"], len(kb["layers"]), len(kb["keys"])) == ("Simulated Corne", 4, 42)


def test_keycodes_and_parse(client):
    names = [c["name"] for c in client.get("/api/keycodes").json()]
    assert names[:2] == ["Basic", "Shifted"]
    assert client.post("/api/keycodes/parse", json={"expression": "LCTL(KC_A)"}).json()["tap"] == "Ctrl+A"
    assert client.post("/api/keycodes/parse", json={"expression": "NOPE"}).status_code == 422


def test_placeholder_page_when_ui_not_built(client):
    response = client.get("/")
    assert response.status_code == 200 and "Vial server is running" in response.text


# ---------- writing ----------

def test_set_key_writes_to_keyboard(client, virtual):
    response = client.put("/api/keymap/0/0/0", json={"code": "LCTL(KC_A)"})
    assert response.status_code == 200
    assert response.json()["tap"] == "Ctrl+A"
    assert virtual.keymap[0][0][0] == encode("LCTL(KC_A)")


@pytest.mark.parametrize("path, body", [
    ("/api/keymap/9/0/0", {"code": "KC_A"}),
    ("/api/keymap/0/3/0", {"code": "KC_A"}),
    ("/api/keymap/0/0/0", {"code": "NOT_A_KEY"}),
    ("/api/tap-dance/99", {"tap": "KC_A", "hold": "KC_NO", "doubleTap": "KC_NO", "tapHold": "KC_NO",
                           "tappingTerm": 200}),
    ("/api/qmk-settings/1", {"value": 1}),
])
def test_invalid_writes_are_rejected(client, virtual, path, body):
    before = [row[:] for row in virtual.keymap[0]]
    assert client.put(path, json=body).status_code == 422
    assert virtual.keymap[0] == before


def test_tap_dance_combo_override_alt_repeat(client, virtual):
    td = client.put("/api/tap-dance/2", json={"tap": "KC_A", "hold": "KC_LCTL", "doubleTap": "KC_B",
                                              "tapHold": "KC_NO", "tappingTerm": 180}).json()
    assert (td["name"], td["tappingTerm"]) == ("A / LCtrl / B", 180)
    assert virtual.tap_dance[2] == (encode("KC_A"), encode("KC_LCTL"), encode("KC_B"), 0, 180)

    combo = client.put("/api/combos/2", json={"keys": ["KC_J", "KC_K", "KC_NO", "KC_NO"], "output": "KC_ESC"})
    assert combo.json()["output"]["code"] == "KC_ESCAPE"
    assert virtual.combos[2] == (encode("KC_J"), encode("KC_K"), 0, 0, encode("KC_ESC"))

    ko = client.put("/api/key-overrides/1", json={"trigger": "KC_A", "replacement": "KC_B", "layers": 1,
                                                  "triggerMods": 2, "negativeModMask": 0, "suppressedMods": 2,
                                                  "options": 0x80})
    assert ko.json()["enabled"] is True
    assert virtual.key_overrides[1] == (encode("KC_A"), encode("KC_B"), 1, 2, 0, 2, 0x80)

    ark = client.put("/api/alt-repeat/0", json={"keycode": "KC_A", "altKeycode": "KC_B", "allowedMods": 0,
                                                "options": 8})
    assert ark.json()["enabled"] is True
    assert virtual.alt_repeat_keys[0] == (encode("KC_A"), encode("KC_B"), 0, 8)


def test_macros(client, virtual):
    items = [[] for _ in range(16)]
    items[3] = [{"type": "text", "text": "hi"}, {"type": "tap", "keys": ["KC_ENT"]}, {"type": "delay", "delay": 20}]
    result = client.put("/api/macros", json={"items": items})
    assert result.status_code == 200
    assert result.json()["items"][3]["name"] == "hi"
    assert virtual.macros()[3] == b"hi\x01\x01\x28\x01\x04\x15\x01"

    items[0] = [{"type": "text", "text": "x" * 1000}]
    response = client.put("/api/macros", json={"items": items})
    assert response.status_code == 422 and "bytes" in response.json()["detail"]
    assert client.put("/api/macros", json={"items": items[:3]}).status_code == 422


def test_settings_and_lighting(client, virtual):
    assert client.put("/api/qmk-settings/7", json={"value": 180}).json() == {"qsid": 7, "value": 180}
    assert virtual.settings[7] == 180
    reset = {s["qsid"]: s["value"] for s in client.post("/api/qmk-settings/reset").json()}
    assert reset[7] == 200
    assert "tabs" in client.get("/api/qmk-settings/definitions").json()

    lighting = client.put("/api/lighting", json={"vialrgb": {"mode": 3, "hsv": [10, 20, 255]}}).json()
    assert lighting["vialrgb"]["mode"] == 3
    assert virtual.vialrgb["hsv"] == (10, 20, 200)  # clamped to the keyboard's maximum brightness
    assert virtual.lighting_saved
    assert client.put("/api/lighting", json={"vialrgb": {"mode": 99}}).status_code == 422
    assert client.put("/api/lighting", json={"backlight": {"brightness": 1}}).status_code == 422


def test_names(client):
    assert client.put("/api/names/layers/1", json={"name": "symbols"}).json()["layers"] == {"1": "symbols"}
    assert client.get("/api/keyboard").json()["layers"][1]["name"] == "symbols"
    assert client.put("/api/names/combos/1", json={"name": "x"}).status_code == 422


def test_layout_file_round_trip(client, virtual):
    data = json.loads(client.get("/api/layout-file").content)
    assert data["layout"][0][0][0] == "KC_TAB"
    data["layout"][0][0][0] = "KC_Q"
    response = client.post("/api/layout-file", content=json.dumps(data))
    assert response.status_code == 200
    assert virtual.keymap[0][0][0] == encode("KC_Q")
    assert client.post("/api/layout-file", content=b"not json").status_code == 422


# ---------- failures ----------

def test_locked_keyboard_refuses_bootloader_key(client, virtual):
    virtual.unlocked = False
    response = client.put("/api/keymap/0/0/0", json={"code": "QK_BOOT"})
    assert response.status_code == 423
    assert virtual.keymap[0][0][0] == encode("KC_TAB")


def test_unplugged_keyboard_gives_503(client, virtual):
    virtual.connected = False
    assert client.put("/api/keymap/0/0/0", json={"code": "KC_A"}).status_code == 503
    assert client.get("/api/keyboard").status_code == 503
    assert client.get("/api/session").json()["status"] == "disconnected"


# ---------- live events ----------

def test_websocket_requires_origin_and_session(client):
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "connected"}
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(EVENTS) as ws:
            ws.receive_json()


def test_last_tab_closing_is_reported(setup):
    client, virtual, app = setup
    with client.websocket_connect(EVENTS, headers=ORIGIN) as ws:
        ws.receive_json()
        assert app.state.gone == []
    deadline = time.time() + 2
    while not app.state.gone and time.time() < deadline:
        time.sleep(0.02)
    assert app.state.gone == [True]
```

- [ ] **Step 2: Run them to see them fail.** Expected: `ModuleNotFoundError: No module named 'server.app'`.

- [ ] **Step 3: Implement the edits**

Create `src/main/python/server/edits.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Applies validated API requests to the keyboard through the protocol layer.

Every function takes the loaded Keyboard first and raises ValueError for requests that don't fit this keyboard.
They are called by DeviceManager.run, which holds the device lock.
"""
from macro.macro_action import ActionText, ActionDelay, tag_to_action
from protocol.alt_repeat_key import AltRepeatKeyEntry
from protocol.key_override import KeyOverrideEntry
from protocol.qmk_settings_codec import QmkSettingsCodec
from protocol.unlock_hook import request_unlock
from server import model
from server.describe import parse


def code(expression):
    """ Validate and normalize a keycode expression """
    return parse(expression)["code"]


def _check_index(index, count, what):
    if not 0 <= index < count:
        raise ValueError("{} {} does not exist (this keyboard has {})".format(what, index, count))


def set_key(kb, layer, row, col, keycode):
    _check_index(layer, kb.layers, "layer")
    if (row, col) not in kb.rowcol:
        raise ValueError("no key at row {} column {}".format(row, col))
    kb.set_key(layer, row, col, code(keycode))
    return model.d(kb.layout[(layer, row, col)])


def set_encoder(kb, layer, index, direction, keycode):
    _check_index(layer, kb.layers, "layer")
    if (layer, index, direction) not in kb.encoder_layout:
        raise ValueError("no encoder {} direction {}".format(index, direction))
    kb.set_encoder(layer, index, direction, code(keycode))
    return model.d(kb.encoder_layout[(layer, index, direction)])


def set_layout_options(kb, value):
    if not kb.layout_labels:
        raise ValueError("this keyboard has no layout options")
    kb.set_layout_options(value)
    return kb.layout_options


def set_tap_dance(kb, index, body, names):
    _check_index(index, kb.tap_dance_count, "tap dance")
    entry = (code(body.tap), code(body.hold), code(body.doubleTap), code(body.tapHold), body.tappingTerm)
    kb.tap_dance_set(index, entry)
    return model.tap_dance(index, kb.tap_dance_entries[index], names)


def set_combo(kb, index, body):
    _check_index(index, kb.combo_count, "combo")
    entry = tuple(code(k) for k in body.keys) + (code(body.output),)
    kb.combo_set(index, entry)
    return model.combo(index, kb.combo_entries[index])


def set_key_override(kb, index, body):
    _check_index(index, kb.key_override_count, "key override")
    entry = KeyOverrideEntry((code(body.trigger), code(body.replacement), body.layers, body.triggerMods,
                              body.negativeModMask, body.suppressedMods, body.options))
    kb.key_override_set(index, entry)
    return model.key_override(index, kb.key_override_entries[index])


def set_alt_repeat_key(kb, index, body):
    _check_index(index, kb.alt_repeat_key_count, "alt-repeat key")
    entry = AltRepeatKeyEntry((code(body.keycode), code(body.altKeycode), body.allowedMods, body.options))
    kb.alt_repeat_key_set(index, entry)
    return model.alt_repeat_key(index, kb.alt_repeat_key_entries[index])


def _macro_action(action):
    if action.type == "text":
        if not action.text:
            raise ValueError("a text step needs text")
        return ActionText(action.text)
    if action.type == "delay":
        if action.delay is None:
            raise ValueError("a delay step needs a delay")
        return ActionDelay(action.delay)
    if not action.keys:
        raise ValueError("a {} step needs at least one key".format(action.type))
    return tag_to_action[action.type]([code(k) for k in action.keys])


def set_macros(kb, body, names):
    if len(body.items) != kb.macro_count:
        raise ValueError("expected {} macros, got {}".format(kb.macro_count, len(body.items)))
    data = kb.macros_serialize([[_macro_action(a) for a in actions] for actions in body.items])
    if len(data) > kb.macro_memory:
        raise ValueError("macros need {} bytes but the keyboard has {}".format(len(data), kb.macro_memory))
    if data != kb.macro:
        request_unlock(kb)
        kb.set_macro(data)
    return model.macros(kb, names)


def set_setting(kb, qsid, value):
    if qsid not in kb.supported_settings or not QmkSettingsCodec.is_qsid_supported(qsid):
        raise ValueError("setting {} is not supported by this keyboard".format(qsid))
    if kb.qmk_settings_set(qsid, value) != 0:
        raise RuntimeError("the keyboard rejected setting {}".format(qsid))
    return value


def reset_settings(kb):
    kb.qmk_settings_reset()
    kb.reload_settings()


def set_lighting(kb, body):
    if body.vialrgb is not None:
        if not kb.lighting_vialrgb:
            raise ValueError("this keyboard has no VialRGB lighting")
        if body.vialrgb.mode is not None:
            if body.vialrgb.mode not in kb.rgb_supported_effects:
                raise ValueError("effect {} is not supported".format(body.vialrgb.mode))
            kb.set_vialrgb_mode(body.vialrgb.mode)
        if body.vialrgb.speed is not None:
            kb.set_vialrgb_speed(body.vialrgb.speed)
        if body.vialrgb.hsv is not None:
            h, s, v = body.vialrgb.hsv
            kb.set_vialrgb_color(h, s, min(v, kb.rgb_maximum_brightness))
    if body.rgblight is not None:
        if not kb.lighting_qmk_rgblight:
            raise ValueError("this keyboard has no RGB light")
        r = body.rgblight
        if r.effect is not None:
            kb.set_qmk_rgblight_effect(r.effect)
        if r.speed is not None:
            kb.set_qmk_rgblight_effect_speed(r.speed)
        if r.hue is not None or r.saturation is not None:
            hue = kb.underglow_color[0] if r.hue is None else r.hue
            sat = kb.underglow_color[1] if r.saturation is None else r.saturation
            kb.set_qmk_rgblight_color(hue, sat, kb.underglow_brightness if r.brightness is None else r.brightness)
            kb.underglow_color = (hue, sat)
        elif r.brightness is not None:
            kb.set_qmk_rgblight_brightness(r.brightness)
    if body.backlight is not None:
        if not kb.lighting_qmk_backlight:
            raise ValueError("this keyboard has no backlight")
        if body.backlight.brightness is not None:
            kb.set_qmk_backlight_brightness(body.backlight.brightness)
        if body.backlight.effect is not None:
            kb.set_qmk_backlight_effect(body.backlight.effect)
    if body.save:
        kb.save_rgb()
    return model.lighting(kb)


def restore_layout_file(kb, data):
    """ Apply a .vil file (bytes) to the keyboard """
    try:
        kb.restore_layout(data)
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError("not a valid Vial layout file: {}".format(e))
```

- [ ] **Step 4: Implement the app.** Starlette picks the most specific exception handler, so `NotConnected` and `KeyboardLocked` aren't caught by the generic `RuntimeError` (502) handler.

Create `src/main/python/server/app.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" The local web server: security checks, API routes, live events and the built UI. """
import asyncio
import contextlib
import logging
import os
import secrets

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from protocol.qmk_settings_codec import QmkSettingsCodec
from server import edits, model, schemas
from server.describe import parse
from server.device import NotConnected, KeyboardLocked

log = logging.getLogger(__name__)

COOKIE = "vial_session"

PLACEHOLDER_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Vial</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>Vial server is running</h1>
<p>The web interface isn't built yet. The API is available under <code>/api</code>.</p>
</body></html>"""

NEED_TOKEN_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Vial</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>Open Vial from its link</h1>
<p>For security, open the link Vial printed in its terminal window (it ends with <code>?token=...</code>).</p>
</body></html>"""


class EventHub:
    """ Tracks open UI tabs (WebSocket connections) and broadcasts events to them """

    def __init__(self, on_all_clients_gone=None, grace_seconds=3.0):
        self.clients = set()
        self.on_all_clients_gone = on_all_clients_gone
        self.grace_seconds = grace_seconds
        self.ever_connected = False

    async def add(self, ws):
        self.clients.add(ws)
        self.ever_connected = True

    async def remove(self, ws):
        self.clients.discard(ws)
        if not self.clients and self.on_all_clients_gone is not None:
            asyncio.get_running_loop().create_task(self._notify_if_still_empty())

    async def _notify_if_still_empty(self):
        await asyncio.sleep(self.grace_seconds)
        if not self.clients:
            self.on_all_clients_gone()

    async def broadcast(self, event):
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.clients.discard(ws)


def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
               poll_interval=1.0, close_grace=3.0, instance_id=None):
    """
    manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
    static_dir: built UI (web/dist) or None for a placeholder page
    on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
    """
    allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
    allowed_origins = {"http://" + h for h in allowed_hosts}
    hub = EventHub(on_all_clients_gone, close_grace)
    instance_id = instance_id or secrets.token_hex(8)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async def poll():
            while True:
                await asyncio.sleep(poll_interval)
                for event in await asyncio.to_thread(manager.check):
                    await hub.broadcast({"type": event})
        task = asyncio.create_task(poll()) if poll_interval else None
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Vial", lifespan=lifespan)
    app.state.hub = hub

    def token_ok(value):
        return value is not None and secrets.compare_digest(value, token)

    @app.middleware("http")
    async def security(request: Request, call_next):
        if request.headers.get("host") not in allowed_hosts:
            return JSONResponse({"detail": "forbidden host"}, status_code=403)
        origin = request.headers.get("origin")
        if origin is not None and origin not in allowed_origins:
            return JSONResponse({"detail": "forbidden origin"}, status_code=403)
        path = request.url.path
        if path == "/api/health":
            return await call_next(request)
        if path == "/" and token_ok(request.query_params.get("token")):
            response = RedirectResponse("/", status_code=303)
            response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/")
            return response
        if not token_ok(request.cookies.get(COOKIE)):
            if path.startswith("/api/"):
                return JSONResponse({"detail": "missing or wrong session token"}, status_code=401)
            return HTMLResponse(NEED_TOKEN_PAGE, status_code=401)
        return await call_next(request)

    @app.exception_handler(NotConnected)
    async def not_connected(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(KeyboardLocked)
    async def locked(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=423)

    @app.exception_handler(ValueError)
    async def bad_value(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(RuntimeError)
    async def device_error(request, exc):
        log.exception("keyboard error")
        return JSONResponse({"detail": "the keyboard didn't respond: {}".format(exc)}, status_code=502)

    def run(fn):
        return manager.run(fn)

    def names_for(kb):
        return names.get(model.uid_of(kb))

    @app.get("/api/health")
    def health():
        return {"app": "vial", "instance": instance_id}

    @app.get("/api/session", response_model=schemas.Session)
    def session():
        return schemas.Session(status="connected" if manager.connected else "disconnected",
                               fake=manager.backend.fake, device=manager.title, error=manager.error)

    @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
    def keyboard():
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.post("/api/reload", response_model=schemas.KeyboardModel)
    async def reload():
        await asyncio.to_thread(manager.reload)
        await hub.broadcast({"type": "reloaded"})
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.put("/api/keymap/{layer}/{row}/{col}", response_model=schemas.Described)
    def set_key(layer: int, row: int, col: int, body: schemas.SetKeycode):
        return run(lambda kb: edits.set_key(kb, layer, row, col, body.code))

    @app.put("/api/encoders/{layer}/{index}/{direction}", response_model=schemas.Described)
    def set_encoder(layer: int, index: int, direction: int, body: schemas.SetKeycode):
        return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code))

    @app.put("/api/layout-options")
    def set_layout_options(body: schemas.SetLayoutOptions):
        return {"value": run(lambda kb: edits.set_layout_options(kb, body.value))}

    @app.get("/api/keycodes")
    def keycodes():
        return run(lambda kb: model.keycode_catalogue())

    @app.post("/api/keycodes/parse", response_model=schemas.Described)
    def parse_keycode(body: schemas.ParseRequest):
        return run(lambda kb: schemas.Described(**parse(body.expression)))

    @app.put("/api/tap-dance/{index}", response_model=schemas.TapDance)
    def set_tap_dance(index: int, body: schemas.TapDanceIn):
        return run(lambda kb: edits.set_tap_dance(kb, index, body, names_for(kb)))

    @app.put("/api/combos/{index}", response_model=schemas.Combo)
    def set_combo(index: int, body: schemas.ComboIn):
        return run(lambda kb: edits.set_combo(kb, index, body))

    @app.put("/api/key-overrides/{index}", response_model=schemas.KeyOverride)
    def set_key_override(index: int, body: schemas.KeyOverrideIn):
        return run(lambda kb: edits.set_key_override(kb, index, body))

    @app.put("/api/alt-repeat/{index}", response_model=schemas.AltRepeatKey)
    def set_alt_repeat_key(index: int, body: schemas.AltRepeatKeyIn):
        return run(lambda kb: edits.set_alt_repeat_key(kb, index, body))

    @app.put("/api/macros", response_model=schemas.Macros)
    def set_macros(body: schemas.MacrosIn):
        return run(lambda kb: edits.set_macros(kb, body, names_for(kb)))

    @app.get("/api/qmk-settings/definitions")
    def setting_definitions():
        QmkSettingsCodec.fields()
        return QmkSettingsCodec.settings_defs

    @app.put("/api/qmk-settings/{qsid}", response_model=schemas.QmkSetting)
    def set_setting(qsid: int, body: schemas.SettingIn):
        return schemas.QmkSetting(qsid=qsid, value=run(lambda kb: edits.set_setting(kb, qsid, body.value)))

    @app.post("/api/qmk-settings/reset", response_model=list[schemas.QmkSetting])
    def reset_settings():
        def do(kb):
            edits.reset_settings(kb)
            return [schemas.QmkSetting(qsid=q, value=v) for q, v in sorted(kb.settings.items())]
        return run(do)

    @app.put("/api/lighting", response_model=schemas.Lighting)
    def set_lighting(body: schemas.LightingIn):
        return run(lambda kb: edits.set_lighting(kb, body))

    @app.get("/api/names", response_model=schemas.Names)
    def get_names():
        return run(lambda kb: names_for(kb))

    @app.put("/api/names/{kind}/{index}", response_model=schemas.Names)
    def set_name(kind: str, index: int, body: schemas.NameIn):
        return run(lambda kb: names.set(model.uid_of(kb), kind, index, body.name))

    @app.get("/api/layout-file")
    def download_layout():
        data = run(lambda kb: kb.save_layout())
        return Response(data, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="keyboard.vil"'})

    @app.post("/api/layout-file", response_model=schemas.KeyboardModel)
    async def upload_layout(request: Request):
        data = await request.body()
        if len(data) > 1024 * 1024:
            raise ValueError("layout file is too large")
        await asyncio.to_thread(run, lambda kb: edits.restore_layout_file(kb, data))
        await hub.broadcast({"type": "reloaded"})
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.websocket("/api/events")
    async def events(ws: WebSocket):
        if ws.headers.get("host") not in allowed_hosts or \
                ws.headers.get("origin") not in allowed_origins or not token_ok(ws.cookies.get(COOKIE)):
            await ws.close(code=1008)
            return
        await ws.accept()
        await hub.add(ws)
        try:
            await ws.send_json({"type": "connected" if manager.connected else "disconnected"})
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(ws)

    if static_dir and os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse)
        def placeholder():
            return PLACEHOLDER_PAGE

    return app
```

- [ ] **Step 5: Run the tests.** Expected: `21 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/server/edits.py src/main/python/server/app.py src/main/python/test/test_api.py
git commit -m "feat(server): local API with security checks, live events and tab-closed detection"
```

### Task 12: Entry point

**Files:**
- Create: `src/main/python/vial_web.py`, `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests.** The first test is the hardware guard: fake mode runs with PyQt5, `hid` and `hidraw` blocked.

Create `src/main/python/test/test_vial_web.py`:

```python
import json

import pytest

import vial_web
from test.test_core_isolation import run_isolated

LAYOUT_2x2 = {"name": "Tiny", "matrix": {"rows": 2, "cols": 2},
              "layouts": {"keymap": [["0,0", "0,1"], ["1,0", "1,1"]]}}


def test_fake_mode_never_loads_qt_or_hidapi():
    """ The guarantee behind 'development never touches real hardware' """
    result = run_isolated("import sys, vial_web\nsys.exit(vial_web.main(['--fake', '--dry-run']))")
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    assert summary == {"device": "Simulated: Simulated Corne", "name": "Simulated Corne", "layers": 4,
                       "keys": 42, "fake": True}


def test_fake_mode_with_custom_definition(tmp_path, capsys):
    path = tmp_path / "vial.json"
    path.write_text(json.dumps(LAYOUT_2x2), encoding="utf-8")
    assert vial_web.main(["--fake", "--definition", str(path), "--dry-run"]) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (summary["name"], summary["keys"]) == ("Tiny", 4)


def test_definition_requires_fake():
    with pytest.raises(SystemExit):
        vial_web.parse_args(["--definition", "x.json"])


def test_messages_include_the_url():
    url = "http://127.0.0.1:1234/?token=abc"
    assert url in vial_web.REOPEN_MESSAGE.format(url=url)
    assert "simulated" in vial_web.STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard")


def test_no_running_session(tmp_path, monkeypatch):
    monkeypatch.setattr(vial_web, "data_dir", lambda: str(tmp_path))
    assert vial_web.running_session() is None
    (tmp_path / "server.json").write_text(json.dumps({"port": vial_web.free_port(), "url": "x", "instance": "y"}))
    assert vial_web.running_session() is None


def test_free_port_is_usable():
    assert 1024 <= vial_web.free_port() <= 65535
```

- [ ] **Step 2: Run them to see them fail.** Expected: `ModuleNotFoundError: No module named 'vial_web'`.

- [ ] **Step 3: Implement**

Create `src/main/python/vial_web.py`:

```python
# SPDX-License-Identifier: GPL-2.0-or-later
""" Starts Vial's local web server and opens the browser.

    python vial_web.py            # real keyboards (hidapi)
    python vial_web.py --fake     # simulated keyboard, never touches hardware
"""
import argparse
import json
import logging
import os
import secrets
import socket
import sys
import threading
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler

import platformdirs

APP_NAME = "Vial"

STARTED_MESSAGE = """Vial is running{fake}. Open it at:
  {url}
Press Ctrl+C to stop."""

REOPEN_MESSAGE = """Browser window closed. Vial is still running. Reopen it at:
  {url}
Press Ctrl+C to stop."""


def data_dir():
    return platformdirs.user_data_dir(APP_NAME, appauthor=False)


def setup_logging():
    os.makedirs(data_dir(), exist_ok=True)
    handler = RotatingFileHandler(os.path.join(data_dir(), "vial.log"), maxBytes=5 * 1024 * 1024, backupCount=5)
    handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def session_file():
    return os.path.join(data_dir(), "server.json")


def running_session():
    """ The URL of an already running Vial server, or None """
    try:
        with open(session_file(), "r") as inf:
            info = json.load(inf)
        with urllib.request.urlopen("http://127.0.0.1:{}/api/health".format(info["port"]), timeout=1) as resp:
            health = json.load(resp)
        if health.get("app") == "vial" and health.get("instance") == info["instance"]:
            return info["url"]
    except (OSError, ValueError, KeyError):
        pass
    return None


def make_backend(args):
    if args.fake:
        from server.device import FakeBackend
        if args.definition:
            from simulator.virtual_keyboard import VirtualKeyboard
            with open(args.definition, "r", encoding="utf-8") as inf:
                definition = json.load(inf)
            return FakeBackend(lambda: VirtualKeyboard(definition))
        from simulator.corne import make_corne
        return FakeBackend(make_corne)
    from server.device import HidBackend
    return HidBackend()


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Vial keyboard configurator (web UI)")
    parser.add_argument("--fake", action="store_true", help="use a simulated keyboard instead of real hardware")
    parser.add_argument("--definition", help="with --fake: vial.json of the keyboard to simulate")
    parser.add_argument("--layout", help="with --fake: .vil layout file to load into the simulated keyboard")
    parser.add_argument("--port", type=int, default=0, help="port to listen on (default: any free port)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
    args = parser.parse_args(argv)
    if (args.definition or args.layout) and not args.fake:
        parser.error("--definition and --layout only work with --fake")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    from protocol.unlock_hook import set_unlock_handler
    from server import model
    from server.app import create_app
    from server.device import DeviceManager, require_unlocked
    from server.names import NamesStore

    set_unlock_handler(require_unlocked)
    manager = DeviceManager(make_backend(args))
    manager.connect()
    if args.layout:
        with open(args.layout, "rb") as inf:
            data = inf.read()
        manager.run(lambda kb: kb.restore_layout(data))

    if args.dry_run:
        if not manager.connected:
            print("no keyboard found" + (": " + manager.error if manager.error else ""))
            return 1
        summary = manager.run(lambda kb: model.build(kb, {"layers": {}, "tapDance": {}, "macros": {}}, manager.unlocked))
        print(json.dumps({"device": manager.title, "name": summary.name, "layers": len(summary.layers),
                          "keys": len(summary.keys), "fake": manager.backend.fake}))
        return 0

    setup_logging()
    existing = running_session()
    if existing:
        print("Vial is already running. Opening it at:\n  " + existing)
        webbrowser.open(existing)
        return 0

    import uvicorn

    port = args.port or free_port()
    token = secrets.token_urlsafe(24)
    instance = secrets.token_hex(8)
    url = "http://127.0.0.1:{}/?token={}".format(port, token)
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "web", "dist")
    names = NamesStore(os.path.join(platformdirs.user_config_dir(APP_NAME, appauthor=False), "names.json"))

    def all_tabs_closed():
        print(REOPEN_MESSAGE.format(url=url), flush=True)
        logging.info("all browser tabs closed")

    app = create_app(manager, names, token, port, static_dir=static_dir, on_all_clients_gone=all_tabs_closed,
                     instance_id=instance)

    with open(session_file(), "w") as outf:
        json.dump({"port": port, "url": url, "instance": instance}, outf)
    print(STARTED_MESSAGE.format(url=url, fake=" with a simulated keyboard" if args.fake else ""), flush=True)
    logging.info("serving on port %d", port)
    if not args.no_browser:
        threading.Timer(0.7, webbrowser.open, [url]).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    finally:
        try:
            os.remove(session_file())
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests.** Expected: `6 passed`.

- [ ] **Step 5: Run the full suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `118 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/vial_web.py src/main/python/test/test_vial_web.py
git commit -m "feat: vial_web entry point (local server, --fake simulator mode)"
```

### Task 13: End-to-end check against the live fake server

Unit tests use Starlette's test client, which doesn't exercise uvicorn's WebSocket support. This check runs the real server and a real (headless) browser.

- [ ] **Step 1: Start the server** (always with `--fake`):

```bash
cd src/main/python && PYTHONUNBUFFERED=1 ../../../.venv/Scripts/python.exe vial_web.py --fake --no-browser --port 51999
```

Expected output:

```
Vial is running with a simulated keyboard. Open it at:
  http://127.0.0.1:51999/?token=<token>
Press Ctrl+C to stop.
```

- [ ] **Step 2: Drive it from a headless browser.** From a second shell, with Playwright for Node (`npm i playwright-core` in a scratch folder; it reuses the browsers in `%LOCALAPPDATA%\ms-playwright`). Save this as `e2e.js` and run `node e2e.js "<URL from step 1>"`:

```javascript
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(process.argv[2]);
  console.log('landed on:', p.url());
  const r = await p.evaluate(async () => {
    const kb = await (await fetch('/api/keyboard')).json();
    const put = await fetch('/api/keymap/0/0/0', { method: 'PUT', headers: { 'content-type': 'application/json' },
                                                    body: JSON.stringify({ code: 'KC_ESC' }) });
    const ws = await new Promise((resolve) => {
      const w = new WebSocket(`ws://${location.host}/api/events`);
      w.onmessage = (e) => resolve(e.data); w.onclose = (e) => resolve('closed ' + e.code);
      setTimeout(() => resolve('timeout'), 5000);
    });
    return { name: kb.name, firstKey: kb.layers[0].keys[0].tap, put: put.status, newKey: (await put.json()).tap, ws };
  });
  console.log(JSON.stringify(r));
  console.log('cookies:', (await ctx.cookies()).map(c => `${c.name} httpOnly=${c.httpOnly} sameSite=${c.sameSite}`));
  const fresh = await (await b.newContext()).newPage();
  console.log('without token:', (await fresh.goto('http://127.0.0.1:51999/')).status());
  await b.close();
})();
```

Expected:

```
landed on: http://127.0.0.1:51999/
{"name":"Simulated Corne","firstKey":"Tab","put":200,"newKey":"Esc","ws":"{\"type\":\"connected\"}"}
cookies: [ 'vial_session httpOnly=true sameSite=Strict' ]
without token: 401
```

About 3 seconds after the script ends, the server prints:

```
Browser window closed. Vial is still running. Reopen it at:
  http://127.0.0.1:51999/?token=<token>
Press Ctrl+C to stop.
```

- [ ] **Step 3: Stop the server** with Ctrl+C. Check that nothing is still listening on the port: `netstat -ano | grep 51999` should print nothing.

- [ ] **Step 4: Owner checklist (the owner runs this, not you).** With the owner's keyboard plugged in: `python src/main/python/vial_web.py`.
  - The browser opens on the placeholder page.
  - `http://127.0.0.1:<port>/api/keyboard` shows the keyboard's real name and layers.
  - Unplug the keyboard: `/api/session` reports `disconnected`. Plug it back in: `connected` within about a second.
  - Close the tab: the reopen message appears in the terminal.
