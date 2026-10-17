# Phase 3: Overview view and analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Keymap section shows every layer at once and why each one is reachable: an Overview of small keyboards labelled with how each layer is reached (keys, tap dances, combos, tri-layer), combos and layer reach in the Inspector, a red underline on combo keys, and a find box that shows everywhere a character or key is produced.

**Architecture:**
- **Backend.** Two small changes:
  - `server/describe.py` describes LM (a layer with modifiers) and Vial's tri-layer keys FN_MO13/FN_MO23 as layer keys, so the browser never parses keycode strings. This adds a layer action and a `triLayer` field to the schema.
  - `vial_web.py --fake --layers N` simulates a keyboard with N layers, so the e2e tests can use a real 8-layer simulator, like the owner's W-CORNE.
- **Analysis.** `web/src/analysis/` holds pure functions over the loaded `KeyboardModel` and the keyboard's placement, each with Vitest tests:
  - layer reach (keys, layer-taps, tap dance slots, combos, tri-layer, and from which layers);
  - combo keys;
  - tap dance and macro usage;
  - key positions in words;
  - finding a character or key;
  - the phrases the UI shows.

  `KeymapPage` holds `analyse(model, placement)` as a `$derived`, so it follows every edit at once.
- **UI.**
  - An Edit/Overview switch in the Keymap header, remembered by the browser.
  - The Overview: one card per layer, each a non-interactive drawing of the keyboard.
  - Two new Inspector sections: "Combos with this key" and "How Layer N is reached".
  - A find box with highlighted keys.
  - The keyboard drawing gains a combo underline, a find highlight, a compact label mode and a non-interactive mode. Nothing is duplicated.

**Tech Stack:**
- Backend: Python 3.13, FastAPI 0.143.1, pydantic 2.
- Frontend: Node 24, Svelte 5.57.1 (runes only), TypeScript 5.9.3, Vite 8.3.1, svelte-check 4.7.6, Vitest 5.0.2.
- API types: openapi-typescript 7.13.0.
- e2e: @playwright/test 1.63.0-alpha-2026-08-05 (Chromium build 1237).
- No new dependencies: `web/package.json` and `web/package-lock.json` don't change.

**Roadmap (phase 3 scope):** `docs/superpowers/plans/2026-10-15-roadmap-phases-2-7.md`. **Spec:** `docs/superpowers/specs/2026-10-15-vial-web-ui-design.md`.

---

## Ground rules (read before every task)

1. **Never touch the owner's keyboard.** Nothing you run may enumerate or open real HID devices.
   - Run `vial_web.py` only as `vial_web.py --fake --no-browser --data-dir <temp dir>`, plus the options a step names. The e2e global setup starts it exactly like that.
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
   - A fresh checkout runs `cd web && npm ci` once.
   - This phase adds no dependency. If a step seems to need one, stop and ask.
5. **Playwright browsers: reuse, never download.**
   - `@playwright/test` stays pinned to `1.63.0-alpha-2026-08-05`, because that version's Chromium (build 1237) is already installed in `%LOCALAPPDATA%\ms-playwright`.
   - Never run `npx playwright install` locally; only CI does.
   - If `chromium-1237` or `chromium_headless_shell-1237` is missing there, stop and ask. Don't change the pinned version.
6. **svelte-check output.** Under Claude Code (`CLAUDECODE=1`), svelte-check prints its machine format, `... COMPLETED <n> FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`. In a plain terminal it prints "svelte-check found 0 errors and 0 warnings" instead. Only the errors and warnings matter.
7. **Line endings:** Windows checkouts use CRLF (`core.autocrlf=true`).
   - Edit with tools that keep the existing line endings. `git apply` keeps them too.
   - The generated `web/src/api/schema.d.ts` is written with LF. Git normalises it, and `check:api` ignores CR.
8. **Commits:** one commit per task, on branch `phase3-overview`.
   - Add the files the task names. Never `git add -A`, and leave the untracked `gh.txt` alone.
   - End every commit message with the trailer the session tells you to use.
9. **How code is given.**
   - "Create `X`:" is followed by the file's complete content.
   - "Apply to `X`:" is followed by a unified diff against the file as the earlier tasks (or `main`) left it. Apply it by hand, or save it to a file and run `git apply <file>` from the repository root.
   - `web/src/api/schema.d.ts` is never written by hand: `npm run gen:api` writes it (Task 1).
   - Each "Expected:" lists text that the command's output contains.
10. **Standing rules (roadmap):**
    - Svelte 5 runes only. `svelte.config.js` makes Svelte 4 syntax a compile error.
    - Content width is capped at 1100 px for the keymap.
    - Every check stays green at the end of every task: pytest, svelte-check, Vitest, build, the generated API types up to date, and e2e (run from Task 14 on, once the page changes).

## Prerequisite

Phase 2 is merged into `main` (at `4e54fbe` or later), and `phase3-overview` is branched from it. `.venv` exists and `web/node_modules` comes from `npm ci`. The suites pass:

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `719 passed, 1 skipped`.

```bash
cd web && npm run check && npm test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  15 passed (15)` and `Tests  226 passed (226)`.

```bash
node --version && ls "$LOCALAPPDATA/ms-playwright"
```

Expected: `v24.` and `chromium-1237` and `chromium_headless_shell-1237`.

## File map

| File | Responsibility |
|---|---|
| `src/main/python/server/describe.py` | LM(layer, mods) → kind `layer`, its layer, the modifiers as `hold`, layer action "while held, with modifiers" (or "while held" with no modifiers). FN_MO13/FN_MO23 → layer 1 or 2 "while held", with `triLayer: 3`. Both protocols |
| `src/main/python/server/schemas.py` | `LayerAction` gains "while held, with modifiers"; `Described.triLayer` |
| `src/main/python/simulator/corne.py` | `make_corne(layers=…)`: the sample keymap on the first layers, the others empty |
| `src/main/python/vial_web.py` | `--layers N` (1–32, only with `--fake`) for the simulated Corne or a `--definition` keyboard |
| `src/main/python/test/test_describe.py`, `test_vial_web.py` | tests for the above |
| `web/src/api/schema.d.ts` | regenerated by `npm run gen:api` |
| `web/src/keyboard/labels.ts` | LM's sentence for the Inspector; `compactLegendSize`, the font size of a small key's only legend |
| `web/src/keyboard/refs.ts` | `refId`: "key:3" / "encoder:0", a key's identity as one string, used everywhere |
| `web/src/keymap/tapdance.ts` | typed `SlotLabel` for the four tap dance slots |
| `web/src/picker/search.ts` | `codesNamed` (keycodes a name or alias names exactly) and `searchText` |
| `web/src/analysis/effective.ts` | **new.** What a key does on a layer once transparent keys fall through (to the base layer); `isLayer` |
| `web/src/analysis/combos.ts` | **new.** Combos' keycodes and their base-layer keys; the layers a combo can fire on; combo keys per layer; combos using a key |
| `web/src/analysis/reach.ts` | **new.** `layerTargets`, `layerReach`: every way to each layer (key, layer-tap, tap dance slot, combo, tri-layer), from which layers, and whether it is reachable |
| `web/src/analysis/positions.ts` | **new.** Key positions in words from the geometry: split detection, rows, thumb clusters, encoders |
| `web/src/analysis/usage.ts` | **new.** What uses each tap dance and macro; the unused ones |
| `web/src/analysis/analysis.ts` | **new.** `analyse(model, placement)`: all of the above in one object |
| `web/src/analysis/phrases.ts` | **new.** The analysis in words: way labels and details, unreached reasons, combo and partner names, find results |
| `web/src/analysis/find.ts` | **new.** Finding a character or key on keys, tap dance slots, combo outputs, key overrides and macros; keys to highlight |
| `web/src/analysis/testing.ts` | **new, tests only.** Corne-shaped keyboard models built from keycode names |
| `web/src/analysis/*.test.ts`, `web/src/keymap/view.test.ts` | **new.** Vitest for the above |
| `web/src/app.css` | `--combo` and `--find` colours, light and dark |
| `web/src/keyboard/Key.svelte`, `Encoder.svelte`, `Keyboard.svelte` | combo underline, find highlight, compact labels, and a non-interactive drawing (plain divs, hidden from screen readers) |
| `web/src/keymap/KindLegend.svelte` | "part of a combo" entry |
| `web/src/keymap/view.ts`, `ViewSwitch.svelte` | **new.** The Edit/Overview choice, kept in `localStorage` (`vial.keymapView`) |
| `web/src/ui/SectionTitle.svelte` | **new.** The Inspector's small upper-case section title, shared |
| `web/src/keymap/ComboList.svelte`, `ReachList.svelte` | **new.** Inspector sections "Combos with this key" and "How Layer N is reached" |
| `web/src/keymap/LayerCard.svelte`, `Overview.svelte` | **new.** One card per layer (title, "reached by" chips, small keyboard, one button over the card); the Overview with help text, legend and the "Not used" box |
| `web/src/keymap/FindBox.svelte` | **new.** The find box, its results as chips, "not on your keymap" |
| `web/src/keymap/Inspector.svelte`, `KeymapPage.svelte` | the new Inspector sections; the view switch, find box, Overview and analysis wired in |
| `web/e2e/global-setup.ts`, `fixtures.ts` | a third server with `--layers 8` (`eightLayers` fixture); `comboAt`, `setCombo`; `labelsCutOff` checks drawn keys too |
| `web/e2e/overview.spec.ts`, `find.spec.ts` | **new.** e2e for the Overview, combos reaching layers, the underline, 8 layers, the find box |
| `web/e2e/display.spec.ts` | the wide-font test also covers the Overview and the find views |
| `web/README.md` | `--layers`, the three e2e servers, `src/analysis/` |

## Out of scope for this plan (later phases)

- **A `changed` WebSocket event.** An edit made outside the UI (a `PUT` from another tab, or from a test) sends no event, so the page keeps the old model until a reload. The e2e tests reload after a `PUT`. A `changed` event, or `reloaded` after writes, would keep several tabs in step.
- **`setCombo` in the store** (`lib/keyboard.svelte.ts`): phase 4's combos page needs it. The analysis follows the model automatically once it exists.
- **"Used on" lists in the UI:** phase 4's tap dance, combo and macro pages. `usageOf` and `combosOf` are ready for them.
- **Clicking a way in the Inspector** to jump to its key.
- **Prefix matching in find.** Find matches whole legends and names, so "Es" finds nothing until "Esc". A prefix mode could reuse the picker's ranking if the owner wants it.
- **Tri-layer inside tap dances and combos.** The tri-layer way only uses FN_MO13 and FN_MO23 on keys. In tap dance slots or as combo outputs they count only as their own layer (1 or 2).
- **Overview with wide fonts.** In a wide font such as Verdana at 1280 px, long small-key labels ("LCtrl", "LShift", "Ctrl+Z") come out near the 7 px minimum. The wide-font e2e test only checks that nothing is cut. If the owner's Linux setup reads poorly, the Overview could switch to one column at a wider threshold than 760 px.
- **Transparent keys fall through to the base layer only.** QMK falls through to the next active layer, which depends on how the layer was reached. `effective.ts` documents the assumption.

---

### Task 1: LM and the tri-layer keys are layer keys

`describe.py` gives LM(layer, mods) and FN_MO13/FN_MO23 no `layer` or `layerAction`, so they come out as kind "other" and the browser can't count them as ways to a layer. This task describes them as layer keys:
- **LM(layer, mods):** kind `layer`, legend "LM n", the modifiers as `hold`, and the new layer action "while held, with modifiers". Without modifiers it reads as MO ("while held"). Protocol 6 keeps the layer in bits 5–8 and the modifiers in bits 0–4; protocol 5 keeps the layer in bits 4–7 and the left-hand modifiers in bits 0–3.
- **FN_MO13 / FN_MO23:** layer 1 or 2 "while held", legend "Fn1 (Fn3)", and the new field `triLayer: 3`, the layer both turn on together.
- Both get a description.

The schema change and the regenerated `schema.d.ts` go in this task. So does LM's sentence in the Inspector ("Layer 2 with Shift, while held").

**Files:**
- Modify: `src/main/python/server/describe.py`, `src/main/python/server/schemas.py`, `web/src/keyboard/labels.ts`
- Test: `src/main/python/test/test_describe.py`, `web/src/keyboard/labels.test.ts`
- Generated: `web/src/api/schema.d.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `src/main/python/test/test_describe.py`:

```diff
diff --git a/src/main/python/test/test_describe.py b/src/main/python/test/test_describe.py
--- a/src/main/python/test/test_describe.py
+++ b/src/main/python/test/test_describe.py
@@ -96,6 +96,43 @@ def test_layer_action(code, action):
     assert describe(code)["layerAction"] == action
 
 
+@pytest.mark.parametrize("protocol, value, layer, action, hold", [
+    (6, 0x5022, 1, "while held, with modifiers", "Shift"),
+    (6, 0x5045, 2, "while held, with modifiers", "Ctrl+Alt"),
+    (6, 0x51F2, 15, "while held, with modifiers", "RShift"),
+    (6, 0x5180, 12, "while held", None),  # no modifiers: as MO
+    (5, 0x5912, 1, "while held, with modifiers", "Shift"),
+    (5, 0x5925, 2, "while held, with modifiers", "Ctrl+Alt"),
+])
+def test_layer_mod_is_a_layer_key(monkeypatch, protocol, value, layer, action, hold):
+    monkeypatch.setattr(Keycode, "protocol", protocol)
+    result = describe(Keycode.serialize(value))
+    assert (result["kind"], result["layer"], result["layerAction"], result["hold"], result["triLayer"]) ==         ("layer", layer, action, hold, None)
+    assert result["legend"]["main"] == "LM {}".format(layer)
+    assert result["description"].startswith("Turns on layer {} while held".format(layer))
+    assert result["tapCode"] is None
+
+
+@pytest.mark.parametrize("protocol, value, layer", [(6, 0x7C77, 1), (6, 0x7C78, 2), (5, 0x5F10, 1), (5, 0x5F11, 2)])
+def test_tri_layer_keys_are_layer_keys(monkeypatch, protocol, value, layer):
+    monkeypatch.setattr(Keycode, "protocol", protocol)
+    result = describe(Keycode.serialize(value))
+    assert (result["kind"], result["layer"], result["layerAction"], result["triLayer"]) ==         ("layer", layer, "while held", 3)
+    assert result["legend"]["main"] == "Fn{} (Fn3)".format(layer)
+    assert result["description"] == "Turns on layer {} while held, and layer 3 while Fn{} is held too".format(
+        layer, 3 - layer)
+
+
+def test_tri_layer_keys_by_name():
+    # the loaded Corne has 4 layers, so FN_MO13 and FN_MO23 have names
+    assert (describe("FN_MO13")["layer"], describe("FN_MO23")["layer"]) == (1, 2)
+    assert parse("FN_MO23")["triLayer"] == 3
+
+
+def test_other_keys_have_no_tri_layer():
+    assert describe("MO(3)")["triLayer"] is None
+
+
 # ---------- modifiers: every combination the firmware can store ----------
 
 MOD_BITS = [(0x01, "Ctrl"), (0x02, "Shift"), (0x04, "Alt"), (0x08, "Gui")]
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_describe.py
```

Expected: `12 failed, 292 passed`.

The 12 new tests fail: LM and the Fn keys still come out as kind "other", and there is no `triLayer` field yet.

- [ ] **Step 3: Describe LM and the tri-layer keys**

Apply to `src/main/python/server/schemas.py`:

```diff
diff --git a/src/main/python/server/schemas.py b/src/main/python/server/schemas.py
--- a/src/main/python/server/schemas.py
+++ b/src/main/python/server/schemas.py
@@ -12,7 +12,7 @@ KeyKind = Literal["basic", "modifier", "mod-tap", "layer-tap", "layer", "one-sho
 
 
 LayerAction = Literal["while held", "toggle", "switch to", "hold, or tap to toggle", "one-shot", "default",
-                      "default (saved)"]
+                      "default (saved)", "while held, with modifiers"]
 
 
 class Legend(BaseModel):
@@ -36,6 +36,9 @@ class Described(BaseModel):
     layer: Optional[int] = None
     layerAction: Optional[LayerAction] = None
     """ for keys that use a layer: what they do with it """
+    triLayer: Optional[int] = None
+    """ for FN_MO13 and FN_MO23 (Vial's tri-layer keys): the layer that is on while both are held, as well as their
+    own layer (1 or 2) """
     index: Optional[int] = None
     """ the tap dance or macro a key runs """
     description: Optional[str] = None
```

Apply to `src/main/python/server/describe.py`:

```diff
diff --git a/src/main/python/server/describe.py b/src/main/python/server/describe.py
--- a/src/main/python/server/describe.py
+++ b/src/main/python/server/describe.py
@@ -14,6 +14,8 @@ LAYER_ACTIONS = {
     "MO": "while held", "TG": "toggle", "TO": "switch to", "TT": "hold, or tap to toggle",
     "OSL": "one-shot", "DF": "default", "PDF": "default (saved)",
 }
+LAYER_WITH_MODS = "while held, with modifiers"
+""" LM(layer, mods): the layer and the modifiers, while held """
 MODIFIER_KEYS = {"KC_LCTRL", "KC_LSHIFT", "KC_LALT", "KC_LGUI", "KC_RCTRL", "KC_RSHIFT", "KC_RALT", "KC_RGUI"}
 MOUSE_PREFIXES = ("KC_MS_", "KC_BTN", "KC_WH_", "KC_ACL")
 
@@ -36,6 +38,12 @@ QK_MOD_TAP = {6: (0x2000, 0x3FFF), 5: (0x6000, 0x7FFF)}
 """ mod-tap: modifiers on hold in bits 8-12, the tapped key in bits 0-7 """
 QK_ONE_SHOT_MOD = {6: (0x52A0, 0x52BF), 5: (0x5500, 0x55FF)}
 """ one-shot modifiers: modifiers in bits 0-4 """
+QK_LAYER_MOD = {6: (0x5000, 0x51FF), 5: (0x5900, 0x59FF)}
+""" LM(layer, mods): protocol 6 has the layer in bits 5-8 and the modifiers in bits 0-4; protocol 5 the layer in bits
+4-7 and the left-hand modifiers in bits 0-3 """
+TRI_LAYER_KEYS = {6: {0x7C77: 1, 0x7C78: 2}, 5: {0x5F10: 1, 0x5F11: 2}}
+""" FN_MO13 and FN_MO23: layer 1 or 2 while held, and layer 3 while both are held (Vial's tri-layer keys) """
+TRI_LAYER = 3
 BASIC = (0x00, 0xFF)
 """ basic keycodes, the ones a layer-tap or mod-tap can tap (both protocols) """
 TAPPABLE_KINDS = {"basic", "modifier", "media", "mouse"}
@@ -144,10 +152,23 @@ def _description(code):
     return keycode.tooltip if keycode is not None and keycode.tooltip else None
 
 
-def _result(code, kind, legend, tap=None, hold=None, layer=None, layer_action=None, index=None):
+def _result(code, kind, legend, tap=None, hold=None, layer=None, layer_action=None, index=None, tri_layer=None,
+            description=None):
     return {"code": code, "kind": kind, "tap": legend["main"] if tap is None else tap, "legend": legend,
             "hold": hold, "layer": layer, "layerAction": layer_action, "index": index,
-            "description": _description(code)}
+            "description": description or _description(code), "triLayer": tri_layer}
+
+
+def _layer_mod(code, value):
+    """ LM(layer, mods), e.g. 0x5022 (protocol 6): layer 1 with Shift, while held """
+    if _protocol() == 6:
+        layer, bits = (value >> 5) & 0xF, value & 0x1F
+    else:
+        layer, bits = (value >> 4) & 0xF, value & 0xF
+    mods = mods_name(bits) or None
+    description = "Turns on layer {} while held{}".format(layer, ", with {} held too".format(mods) if mods else "")
+    return _result(code, "layer", _legend("LM {}".format(layer)), hold=mods, layer=layer,
+                   layer_action=LAYER_WITH_MODS if mods else LAYER_ACTIONS["MO"], description=description)
 
 
 def _tap_code(result, value):
@@ -222,6 +243,14 @@ def _describe(code, value):
         layer = int(m.group(1))
         return _result(code, "layer-tap", _keycode_legend(m.group(2)), hold="layer {}".format(layer), layer=layer,
                        layer_action=LAYER_ACTIONS["MO"])
+    tri = TRI_LAYER_KEYS[_protocol()].get(value)
+    if tri is not None:
+        description = "Turns on layer {} while held, and layer {} while Fn{} is held too".format(
+            tri, TRI_LAYER, 3 - tri)
+        return _result(code, "layer", _legend("Fn{} (Fn{})".format(tri, TRI_LAYER)), layer=tri,
+                       layer_action=LAYER_ACTIONS["MO"], tri_layer=TRI_LAYER, description=description)
+    if _in(value, QK_LAYER_MOD):
+        return _layer_mod(code, value)
 
     # modifier bits naming no modifier (none, or only the right-hand bit) fall through and read as a raw code
     if _in(value, QK_MOD_TAP) and mods_name((value >> 8) & 0x1F):
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_describe.py
```

Expected: `304 passed`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `731 passed, 1 skipped`.

- [ ] **Step 5: Regenerate the API types**

The schema changed, so the check fails first:

```bash
cd web && npm run check:api
```

Expected: `src/api/schema.d.ts is out of date: run`.

```bash
cd web && npm run gen:api && npm run check:api
```

Expected: `wrote src/api/schema.d.ts` and `src/api/schema.d.ts is up to date`.

`schema.d.ts` now has `"while held, with modifiers"` in both `layerAction` unions and `triLayer?: number | null` in both described-key types.

- [ ] **Step 6: Write the failing test for LM's sentence**

Apply to `web/src/keyboard/labels.test.ts`:

```diff
diff --git a/web/src/keyboard/labels.test.ts b/web/src/keyboard/labels.test.ts
--- a/web/src/keyboard/labels.test.ts
+++ b/web/src/keyboard/labels.test.ts
@@ -116,6 +116,12 @@ describe("actionSummary", () => {
     expect(actionSummary(key, names)).toEqual({ tap: sentence, hold: null });
   });
 
+  it("describes LM, a layer held with modifiers", () => {
+    const lm = d({ code: "0x5022", kind: "layer", tap: "LM 1", hold: "Shift", layer: 2, layerAction: "while held, with modifiers" });
+    expect(actionSummary(lm, names)).toEqual({ tap: "Layer 2 with Shift, while held", hold: null });
+    expect(actionSummary({ ...lm, hold: null }, names)).toEqual({ tap: "Layer 2, while held", hold: null });
+  });
+
   it("falls back to the tap text for a layer action it does not know", () => {
     const key = d({ code: "X(2)", kind: "layer", tap: "X 2", layer: 2, layerAction: "sideways" as never });
     expect(actionSummary(key, names)).toEqual({ tap: "X 2", hold: null });
```

```bash
cd web && npx vitest run src/keyboard/labels.test.ts
```

Expected: `Tests  1 failed | 80 passed (81)`. The new LM test fails: the sentence falls back to the tap text.

- [ ] **Step 7: LM's sentence**

Apply to `web/src/keyboard/labels.ts`:

```diff
diff --git a/web/src/keyboard/labels.ts b/web/src/keyboard/labels.ts
--- a/web/src/keyboard/labels.ts
+++ b/web/src/keyboard/labels.ts
@@ -88,6 +88,8 @@ function layerSentence(d: Described, names: Names): string {
       return `Make ${layer} the default layer`;
     case "default (saved)":
       return `Make ${layer} the default layer, and remember it`;
+    case "while held, with modifiers":
+      return d.hold ? `${layer} with ${d.hold}, while held` : `${layer}, while held`;
     default:
       return d.tap;
   }
```

```bash
cd web && npm test && npm run check
```

Expected: `Test Files  15 passed (15)` and `Tests  227 passed (227)` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 8: Commit**

```bash
git add src/main/python/server/describe.py \
  src/main/python/server/schemas.py \
  src/main/python/test/test_describe.py \
  web/src/api/schema.d.ts \
  web/src/keyboard/labels.test.ts \
  web/src/keyboard/labels.ts
git commit -m "feat: LM and the tri-layer keys FN_MO13/FN_MO23 are layer keys"
```

### Task 2: `vial_web.py --fake --layers N`

`--definition` always builds a 4-layer keyboard, and a `.vil` can't change the layer count. The 8-layer e2e tests (Task 15) need a real 8-layer simulator, as the owner's W-CORNE has 8 layers.
- `--layers N` accepts 1 to 32 and refuses anything else (0, 33, -1, "eight", 2.5).
- Like `--definition` and `--layout`, it only works with `--fake`.
- `make_corne(layers=…)` keeps the sample keymap on the first layers and leaves the others empty (KC_NO). With `--definition`, the simulated keyboard gets N layers.

**Files:**
- Modify: `src/main/python/simulator/corne.py`, `src/main/python/vial_web.py`
- Test: `src/main/python/test/test_vial_web.py`

- [ ] **Step 1: Write the failing tests**

The `simulated` fixture's stand-in for `make_corne` now passes keyword arguments on.

Apply to `src/main/python/test/test_vial_web.py`:

```diff
diff --git a/src/main/python/test/test_vial_web.py b/src/main/python/test/test_vial_web.py
--- a/src/main/python/test/test_vial_web.py
+++ b/src/main/python/test/test_vial_web.py
@@ -92,6 +92,34 @@ def test_definition_requires_fake():
         vial_web.parse_args(["--definition", "x.json"])
 
 
+@pytest.mark.parametrize("layers", [1, 8, 32])
+def test_fake_mode_with_more_or_fewer_layers(capsys, layers):
+    assert vial_web.main(["--fake", "--layers", str(layers), "--dry-run"]) == 0
+    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
+    assert (summary["name"], summary["layers"]) == ("Simulated Corne", layers)
+
+
+def test_layers_with_a_custom_definition(tmp_path, capsys):
+    path = tmp_path / "vial.json"
+    path.write_text(json.dumps(LAYOUT_2x2), encoding="utf-8")
+    assert vial_web.main(["--fake", "--definition", str(path), "--layers", "6", "--dry-run"]) == 0
+    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
+    assert (summary["name"], summary["layers"]) == ("Tiny", 6)
+
+
+@pytest.mark.parametrize("layers", ["0", "33", "-1", "eight", "2.5"])
+def test_layers_must_be_a_layer_count(layers, capsys):
+    with pytest.raises(SystemExit):
+        vial_web.parse_args(["--fake", "--layers", layers])
+    assert "layer count (1 to 32)" in capsys.readouterr().err
+
+
+def test_layers_requires_fake(capsys):
+    with pytest.raises(SystemExit):
+        vial_web.parse_args(["--layers", "8"])
+    assert "only work with --fake" in capsys.readouterr().err
+
+
 @pytest.mark.parametrize("port", ["-1", "65536", "http", "1.5"])
 def test_port_must_be_a_port_number(port):
     with pytest.raises(SystemExit):
@@ -485,7 +513,7 @@ def simulated(monkeypatch):
     from simulator import corne
     made = []
     make = corne.make_corne
-    monkeypatch.setattr(corne, "make_corne", lambda: made.append(make()) or made[-1])
+    monkeypatch.setattr(corne, "make_corne", lambda **kwargs: made.append(make(**kwargs)) or made[-1])
     return made
 
 
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `10 failed, 88 passed, 1 skipped`.

The 10 new tests fail, because `--layers` isn't an option yet.

- [ ] **Step 3: Implement `--layers`**

Apply to `src/main/python/simulator/corne.py`:

```diff
diff --git a/src/main/python/simulator/corne.py b/src/main/python/simulator/corne.py
--- a/src/main/python/simulator/corne.py
+++ b/src/main/python/simulator/corne.py
@@ -92,10 +92,10 @@ LAYERS = [
 ]
 
 
-def keymap():
-    """ {(layer, row, col): keycode} for all layers """
+def keymap(layers=None):
+    """ {(layer, row, col): keycode} for the first `layers` layers (all of them by default) """
     out = {}
-    for layer, keys in enumerate(LAYERS):
+    for layer, keys in enumerate(LAYERS[:layers]):
         for side, positions in (("left", LEFT), ("right", RIGHT)):
             for r in range(3):
                 for c in range(6):
@@ -120,14 +120,15 @@ def macros():
     return b"\x00".join(data) + b"\x00"
 
 
-def make_corne():
-    """ A fresh simulated Corne; nothing is shared between calls """
+def make_corne(layers=len(LAYERS)):
+    """ A fresh simulated Corne; nothing is shared between calls. With more layers than the sample keymap has, the
+    others are empty (KC_NO); with fewer, the sample's last layers are left out. """
     ko_options_enabled = 0b1000_0111  # enabled, activates on trigger down / required mod down / negative mod up
     ark_options = 0b1110  # enabled, ignore mod handedness, bidirectional
     return VirtualKeyboard(
         definition(),
-        layers=len(LAYERS),
-        keymap=keymap(),
+        layers=layers,
+        keymap=keymap(layers),
         uid=CORNE_UID,
         vial_protocol=VIAL_PROTOCOL,
         macro_count=16,
```

Apply to `src/main/python/vial_web.py`:

```diff
diff --git a/src/main/python/vial_web.py b/src/main/python/vial_web.py
--- a/src/main/python/vial_web.py
+++ b/src/main/python/vial_web.py
@@ -272,17 +272,33 @@ def open_running(url, args):
 def make_backend(args):
     if args.fake:
         from server.device import FakeBackend
+        layers = args.layers or DEFAULT_FAKE_LAYERS
         if args.definition:
             from simulator.virtual_keyboard import VirtualKeyboard
             with open(args.definition, "r", encoding="utf-8") as inf:
                 definition = json.load(inf)
-            return FakeBackend(lambda: VirtualKeyboard(definition))
+            return FakeBackend(lambda: VirtualKeyboard(definition, layers=layers))
         from simulator.corne import make_corne
-        return FakeBackend(make_corne)
+        return FakeBackend(lambda: make_corne(layers=layers))
     from server.device import HidBackend
     return HidBackend()
 
 
+DEFAULT_FAKE_LAYERS = 4
+MAX_FAKE_LAYERS = 32
+""" Vial keyboards have at most 32 layers (the layer keycodes MO, TG, ... hold 5 bits) """
+
+
+def layer_count(text):
+    try:
+        count = int(text)
+    except ValueError:
+        count = 0
+    if not 1 <= count <= MAX_FAKE_LAYERS:
+        raise argparse.ArgumentTypeError("{!r} is not a layer count (1 to {})".format(text, MAX_FAKE_LAYERS))
+    return count
+
+
 def port_number(text):
     try:
         port = int(text)
@@ -298,6 +314,9 @@ def parse_args(argv):
     parser.add_argument("--fake", action="store_true", help="use a simulated keyboard instead of real hardware")
     parser.add_argument("--definition", help="with --fake: vial.json of the keyboard to simulate")
     parser.add_argument("--layout", help="with --fake: .vil layout file to load into the simulated keyboard")
+    parser.add_argument("--layers", type=layer_count,
+                        help="with --fake: how many layers the simulated keyboard has (1 to {}, default {})".format(
+                            MAX_FAKE_LAYERS, DEFAULT_FAKE_LAYERS))
     parser.add_argument("--port", type=port_number, default=0, help="port to listen on (default: any free port)")
     parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
     parser.add_argument("--dry-run", action="store_true", help="connect, print a summary and exit without serving")
@@ -305,8 +324,8 @@ def parse_args(argv):
                         help="keep the instance lock, session file, log and names in this folder instead of the "
                              "user's data and config folders (for tests and development)")
     args = parser.parse_args(argv)
-    if (args.definition or args.layout) and not args.fake:
-        parser.error("--definition and --layout only work with --fake")
+    if (args.definition or args.layout or args.layers) and not args.fake:
+        parser.error("--definition, --layout and --layers only work with --fake")
     return args
 
 
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test/test_vial_web.py
```

Expected: `98 passed, 1 skipped`.

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `741 passed, 1 skipped`. This is the backend's final count for the phase.

- [ ] **Step 5: Try it once** (fake mode, temp data dir, no browser, and `--dry-run` exits without serving)

```bash
DATA=$(mktemp -d) && cd src/main/python && ../../../.venv/Scripts/python.exe vial_web.py --fake --no-browser --data-dir "$DATA" --layers 8 --dry-run; rm -rf "$DATA"
```

Expected: `"name": "Simulated Corne"` and `"layers": 8`.

- [ ] **Step 6: Commit**

```bash
git add src/main/python/simulator/corne.py \
  src/main/python/test/test_vial_web.py \
  src/main/python/vial_web.py
git commit -m "feat(server): vial_web.py --fake --layers N simulates a keyboard with N layers (1-32)"
```

### Task 3: Combos and how each layer is reached

The core of the analysis. Everything works from the model's described keycodes (`kind`, `layer`, `layerAction`, `triLayer`) and the tap dances' slots. Nothing parses keycode strings.

**Where a key or combo works:**
- `effectiveAt`: a key works on the layer it is set on. A key on the base layer also works on every layer where that position is transparent. The analysis assumes transparent keys fall through to layer 0; QMK falls through to the next active layer.
- A combo is a list of keycodes, not of keys: QMK fires it when keys with those keycodes are pressed together on the active layers. So:
  - `combosOf` looks each keycode up on the base layer (one key, several, or none), for phase 4's combo cards;
  - `comboLayers` gives the layers where every keycode of a combo is on some key, after fall-through;
  - `comboKeysOn` gives the keys to underline on a layer, never transparent ones;
  - `combosUsing` gives the combos a key is part of on a layer, with the partner keycodes and their keys.

**How each layer is reached** (`layerReach`), from every:
- layer key and layer-tap;
- tap dance slot holding one (on a key, or as a combo's output);
- combo whose output is one;
- pair of tri-layer keys: FN_MO13 and FN_MO23, one pressed first from a layer it works on, which turns its own layer on, where the other must work. Together they turn on layer 3.

LM counts as a key held for its layer. A way that only works on the layer it reaches (TG(1) on layer 1) can only leave it, so it isn't listed. A combo whose keycodes aren't all on any one layer is still listed, with no layers it works from. Layer 0 is where the keyboard starts. A layer is reachable when a way to it works on a reachable layer; DF counts like any other way.

Two small changes to phase 2 code come first: `refId` (a key's identity as one string, "key:3") in `keyboard/refs.ts`, and a typed `SlotLabel` for tap dance slots. `analysis/testing.ts` builds Corne-shaped models from keycode names for every analysis test, including the simulator's Corne (`simulatedCorne`).

**Files:**
- Create: `web/src/analysis/effective.ts`, `web/src/analysis/combos.ts`, `web/src/analysis/reach.ts`, `web/src/analysis/testing.ts`
- Modify: `web/src/keyboard/refs.ts`, `web/src/keymap/tapdance.ts`
- Test: `web/src/keyboard/refs.test.ts`, `web/src/analysis/combos.test.ts`, `web/src/analysis/reach.test.ts`

- [ ] **Step 1: The test models**

Create `web/src/analysis/testing.ts`:

```ts
// For the analysis tests only: keyboard models built from keycode names, described roughly as the server does.
import type { Described, KeyGeometry, KeyboardModel, TapDance } from "../api/types";
import type { LayerAction } from "./reach";

const LAYER_ACTIONS: Record<string, LayerAction> = {
  MO: "while held", TG: "toggle", TO: "switch to", TT: "hold, or tap to toggle", OSL: "one-shot", DF: "default",
  PDF: "default (saved)",
};
const LABELS: Record<string, string> = { SPC: "Space", ESC: "Esc", ENT: "Enter", TAB: "Tab", CAPS: "Caps Lock" };
const MODS: Record<string, string> = { LSFT: "Shift", LCTL: "Ctrl", LALT: "Alt", LGUI: "Gui" };

function label(code: string): string {
  const name = code.replace(/^KC_/, "");
  return LABELS[name] ?? name;
}

/** A keycode described as the server would, for the kinds the analysis looks at */
export function described(code: string): Described {
  const base = {
    code, hold: null, layer: null, layerAction: null, index: null, description: null, tapCode: null, triLayer: null,
  };
  const plain = (kind: Described["kind"], tap: string, extra: Partial<Described> = {}): Described =>
    ({ ...base, kind, tap, legend: { main: tap }, ...extra });
  if (code === "KC_NO") return plain("none", "");
  if (code === "KC_TRNS") return { ...plain("transparent", ""), legend: { main: "▽" } };
  let m = /^TD\((\d+)\)$/.exec(code);
  if (m) return plain("tap-dance", `TD ${m[1]}`, { index: Number(m[1]) });
  m = /^M(\d+)$/.exec(code);
  if (m) return plain("macro", `M ${m[1]}`, { index: Number(m[1]) });
  m = /^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$/.exec(code);
  if (m) return plain("layer", `${m[1]} ${m[2]}`, { layer: Number(m[2]), layerAction: LAYER_ACTIONS[m[1]] });
  m = /^LM\((\d+), ?(\w+)\)$/.exec(code);
  if (m) {
    return plain("layer", `LM ${m[1]}`, { layer: Number(m[1]), layerAction: "while held, with modifiers",
      hold: MODS[m[2].replace("MOD_", "")] ?? m[2] });
  }
  m = /^FN_MO([12])3$/.exec(code);
  if (m) return plain("layer", `Fn${m[1]} (Fn3)`, { layer: Number(m[1]), layerAction: "while held", triLayer: 3 });
  m = /^LT(\d+)\((.+)\)$/.exec(code);
  if (m) {
    return plain("layer-tap", m[2] === "KC_NO" ? "" : label(m[2]),
      { layer: Number(m[1]), layerAction: "while held", hold: `layer ${m[1]}` });
  }
  m = /^(\w+)_T\((.+)\)$/.exec(code);
  if (m) return plain("mod-tap", label(m[2]), { hold: MODS[m[1]] ?? m[1] });
  return plain("basic", label(code));
}

/** Keys of a Corne as the simulator draws it: three rows of 6 + 6 keys (index = row * 12 + column, columns 0-5 the
 * left half, 6-11 the right), then the thumbs, left 36-38 and right 39-41, each from left to right */
export function corneKeys(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  const key = (row: number, col: number, x: number, y: number): KeyGeometry =>
    ({ row, col, x, y, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0, layoutIndex: -1, layoutOption: -1,
      decal: false });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) keys.push(key(r, c, c, r));
    for (let c = 0; c < 6; c++) keys.push(key(r + 4, 5 - c, 9 + c, r));
  }
  [3, 4, 5].forEach((x, i) => keys.push(key(3, 3 + i, x, 3)));
  [9, 10, 11].forEach((x, i) => keys.push(key(7, 5 - i, x, 3)));
  return keys;
}

export const KEY_COUNT = 42;
/** where the Corne's keys are, by index */
export const AT = {
  grid: (row: number, col: number) => row * 12 + col,
  leftOuterThumb: 36,
  leftMiddleThumb: 37,
  leftInnerThumb: 38,
  rightInnerThumb: 39,
  rightMiddleThumb: 40,
  rightOuterThumb: 41,
};

/** A layer of 42 keycodes: `fill` everywhere but the keys given */
export function layer(keys: Record<number, string>, fill = "KC_TRNS"): string[] {
  return Array.from({ length: KEY_COUNT }, (_, i) => keys[i] ?? fill);
}

export interface Setup {
  /** each layer's 42 keycodes */
  layers: string[][];
  /** tap, hold, double tap, tap then hold */
  tapDances?: [string, string, string, string][];
  combos?: { keys: string[]; output: string }[];
  /** steps of each macro (only their number matters) */
  macros?: number[];
  keyOverrides?: { trigger: string; replacement: string }[];
  altRepeatKeys?: { keycode: string; altKeycode: string }[];
}

/** A Corne keyboard model; layer 0 is called Base, the others "Layer N" */
export function corne(setup: Setup): KeyboardModel {
  const tapDance: TapDance[] = (setup.tapDances ?? []).map(([tap, hold, doubleTap, tapHold], index) => ({
    index, name: "", customName: false, tappingTerm: 200,
    tap: described(tap), hold: described(hold), doubleTap: described(doubleTap), tapHold: described(tapHold),
  }));
  return {
    name: "Test Corne", uid: "0", viaProtocol: 9, vialProtocol: 6, rows: 8, cols: 6,
    keys: corneKeys(), encoders: [], layoutOptions: null,
    layers: setup.layers.map((codes, index) => ({
      index, name: index === 0 ? "Base" : `Layer ${index}`, customName: false, keys: codes.map(described),
      encoders: [],
    })),
    tapDance,
    combos: (setup.combos ?? []).map((c, index) => ({
      index,
      keys: [...c.keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4).map(described),
      output: described(c.output),
    })),
    keyOverrides: (setup.keyOverrides ?? []).map((o, index) => ({
      index, trigger: described(o.trigger), replacement: described(o.replacement), layers: 0xffff, triggerMods: 0,
      negativeModMask: 0, suppressedMods: 0, options: 0, enabled: true,
    })),
    altRepeatKeys: (setup.altRepeatKeys ?? []).map((a, index) => ({
      index, keycode: described(a.keycode), altKeycode: described(a.altKeycode), allowedMods: 0, options: 0,
      enabled: true,
    })),
    macros: {
      count: (setup.macros ?? []).length, memory: 900, used: 0,
      items: (setup.macros ?? []).map((steps, index) => ({
        index, name: "", customName: false,
        actions: Array.from({ length: steps }, () => ({ type: "tap" as const, keys: [described("KC_A")] })),
      })),
    },
    settings: [], lighting: {}, features: [], unlocked: true,
  };
}

/** The simulator's Corne (simulator/corne.py), as the analysis sees it */
export function simulatedCorne(): KeyboardModel {
  const grid = (rows: string[][]) => rows.flatMap((r) => r);
  const base = [
    ...grid([
      ["KC_TAB", "LGUI_T(KC_W)", "KC_L", "KC_R", "LT2(KC_B)", "KC_Z", "KC_Q", "KC_U", "KC_D", "KC_J", "KC_BSLS", "KC_BSPC"],
      ["KC_LCTL", "LT2(KC_S)", "LALT_T(KC_H)", "LCTL_T(KC_N)", "LSFT_T(KC_T)", "KC_COMM", "KC_DOT", "LGUI_T(KC_A)",
        "LALT_T(KC_E)", "LCTL_T(KC_O)", "LSFT_T(KC_I)", "KC_QUOT"],
      ["KC_LSFT", "KC_F", "KC_M", "KC_C", "KC_V", "KC_SLSH", "KC_G", "KC_P", "KC_X", "KC_K", "KC_Y", "KC_RSFT"],
    ]),
    "KC_ESC", "LT1(KC_SPC)", "TD(0)", "M0", "KC_ENT", "OSL(3)",
  ];
  return corne({
    layers: [
      base,
      layer({ [AT.grid(0, 1)]: "KC_1" }),
      layer({ [AT.grid(1, 7)]: "KC_LEFT" }),
      layer({ [AT.grid(1, 1)]: "KC_1", [AT.rightOuterThumb]: "TO(0)" }),
    ],
    tapDances: [["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"], ["KC_ESC", "KC_LCTL", "LCTL(KC_S)", "KC_NO"],
      ["KC_NO", "KC_NO", "KC_NO", "KC_NO"]],
    combos: [{ keys: ["KC_K", "KC_Y"], output: "KC_ESC" }, { keys: ["KC_M", "KC_C"], output: "KC_ENT" },
      { keys: [], output: "KC_NO" }],
    macros: [2, 6, 0],
  });
}
```

- [ ] **Step 2: Write the failing tests**

Apply to `web/src/keyboard/refs.test.ts`:

```diff
diff --git a/web/src/keyboard/refs.test.ts b/web/src/keyboard/refs.test.ts
--- a/web/src/keyboard/refs.test.ts
+++ b/web/src/keyboard/refs.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import type { Described, KeyGeometry, KeyboardModel } from "../api/types";
-import { actionAt, positionLine, whereIs } from "./refs";
+import { actionAt, positionLine, refId, whereIs } from "./refs";
 
 const d = (code: string): Described => ({
   code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
@@ -25,6 +25,13 @@ describe("actionAt", () => {
   });
 });
 
+describe("refId", () => {
+  it("is a key's or encoder direction's identity as one string", () => {
+    expect(refId({ kind: "key", index: 3 })).toBe("key:3");
+    expect(refId({ kind: "encoder", index: 0 })).toBe("encoder:0");
+  });
+});
+
 describe("whereIs", () => {
   it("names a key by its matrix position and an encoder by its direction", () => {
     expect(whereIs(model, { kind: "key", index: 0 })).toEqual({ what: "Key", where: "row 2, column 3" });
```

Create `web/src/analysis/combos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { codesOn, comboKeysOn, comboLayers, combosOf, combosUsing } from "./combos";
import { effectiveAt } from "./effective";
import { AT, corne, layer, simulatedCorne } from "./testing";

const key = (index: number) => ({ kind: "key" as const, index });

describe("effectiveAt", () => {
  const model = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({ 1: "KC_B" }), layer({}, "KC_TRNS")] });

  it("is the key's own action, or the base layer's for a transparent key", () => {
    expect(effectiveAt(model, 1, key(1))).toMatchObject({ layer: 1, action: { code: "KC_B" } });
    expect(effectiveAt(model, 1, key(0))).toMatchObject({ layer: 0, action: { code: "KC_A" } });
    expect(effectiveAt(model, 2, key(0))).toMatchObject({ layer: 0, action: { code: "KC_A" } });
  });

  it("leaves a transparent key on the base layer transparent, and knows nothing of other layers or keys", () => {
    const transparent = corne({ layers: [layer({})] });
    expect(effectiveAt(transparent, 0, key(0))).toMatchObject({ layer: 0, action: { kind: "transparent" } });
    expect(effectiveAt(model, 5, key(0))).toBeUndefined();
    expect(effectiveAt(model, 0, key(99))).toBeUndefined();
  });
});

describe("combosOf", () => {
  it("finds each keycode of a combo on the base layer: one key, several keys, or none", () => {
    const model = corne({
      layers: [layer({ [AT.grid(2, 9)]: "KC_K", [AT.grid(2, 10)]: "KC_Y", [AT.grid(0, 10)]: "KC_Y" }, "KC_NO")],
      combos: [{ keys: ["KC_K", "KC_Y", "KC_Q"], output: "KC_ESC" }],
    });
    const [combo] = combosOf(model, placeKeyboard(model));
    expect(combo.members.map((m) => [m.action.code, m.keys.map((k) => k.index)])).toEqual([
      ["KC_K", [AT.grid(2, 9)]],
      ["KC_Y", [AT.grid(0, 10), AT.grid(2, 10)]],
      ["KC_Q", []],
    ]);
    expect(combo.output.code).toBe("KC_ESC");
  });

  it("leaves out empty combos and empty slots", () => {
    const model = corne({
      layers: [layer({}, "KC_NO")],
      combos: [{ keys: [], output: "KC_NO" }, { keys: ["KC_NO", "KC_A"], output: "KC_B" }],
    });
    const combos = combosOf(model, placeKeyboard(model));
    expect(combos.map((c) => c.index)).toEqual([1]);
    expect(combos[0].members.map((m) => m.action.code)).toEqual(["KC_A"]);
  });

  it("finds nothing on a keyboard without layers", () => {
    const model = { ...corne({ layers: [], combos: [{ keys: ["KC_A"], output: "KC_B" }] }) };
    expect(combosOf(model, placeKeyboard(model))[0].members[0].keys).toEqual([]);
  });
});

describe("combo keys on a layer", () => {
  const model = simulatedCorne();
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const codes = model.layers.map((_, l) => codesOn(model, placement, l));

  it("are the keys with a combo's keycode", () => {
    const members = [AT.grid(2, 9), AT.grid(2, 10), AT.grid(2, 2), AT.grid(2, 3)].map((i) => `key:${i}`).sort();
    expect([...comboKeysOn(combos, codes[0], model, 0)].sort()).toEqual(members);
  });

  it("leave out transparent keys, though the combo goes through them", () => {
    // layer 1 is transparent there: the keycodes fall through, but the keys aren't marked
    expect(codes[1].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
    expect(comboKeysOn(combos, codes[1], model, 1).size).toBe(0);
    const own = corne({
      layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({ 0: "KC_A" })],
      combos: [{ keys: ["KC_A", "KC_B"], output: "KC_X" }],
    });
    const p = placeKeyboard(own);
    expect([...comboKeysOn(combosOf(own, p), codesOn(own, p, 1), own, 1)]).toEqual(["key:0"]);
  });

  it("can fire on the layers that have all its keycodes", () => {
    const model2 = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_B" }, "KC_NO"), layer({ 1: "KC_C" }), layer({}, "KC_TRNS")],
      combos: [{ keys: ["KC_A", "KC_B"], output: "KC_X" }],
    });
    const p = placeKeyboard(model2);
    const layerCodes = model2.layers.map((_, l) => codesOn(model2, p, l));
    expect(comboLayers(combosOf(model2, p)[0], layerCodes)).toEqual([0, 2]);
  });
});

describe("combosUsing", () => {
  const model = corne({
    layers: [
      layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", [AT.grid(2, 9)]: "KC_K" }, "KC_NO"),
      layer({ [AT.grid(2, 9)]: "KC_NO" }),
      ...Array.from({ length: 6 }, () => layer({})),
    ],
    combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_K", "KC_Y"], output: "KC_ESC" }],
  });
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const using = (l: number, index: number) =>
    combosUsing(combos, model, codesOn(model, placement, l), l, key(index));

  it("lists the combos a key is part of, with the other keycodes and their keys", () => {
    const [use] = using(0, AT.leftInnerThumb);
    expect(use.combo.index).toBe(0);
    expect(use.partners.map((p) => [p.action.code, p.keys])).toEqual([["OSL(3)", [key(AT.rightOuterThumb)]]]);
    expect(using(0, AT.rightOuterThumb)[0].partners.map((p) => p.action.code)).toEqual(["MO(5)"]);
  });

  it("says when a partner isn't on any key of the layer", () => {
    const [use] = using(0, AT.grid(2, 9));
    expect(use.partners).toEqual([{ action: expect.objectContaining({ code: "KC_Y" }), keys: [] }]);
  });

  it("goes by the keycode the key has on the layer", () => {
    expect(using(1, AT.grid(2, 9))).toEqual([]);
    expect(using(1, AT.leftInnerThumb).map((u) => u.combo.index)).toEqual([0]);
    expect(using(0, AT.grid(0, 0))).toEqual([]);
  });

  it("lists a keycode that is in a combo twice once as the key and once as a partner", () => {
    const twice = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO")], combos: [{ keys: ["KC_A", "KC_A"], output: "KC_B" }] });
    const p = placeKeyboard(twice);
    const [use] = combosUsing(combosOf(twice, p), twice, codesOn(twice, p, 0), 0, key(0));
    expect(use.partners.map((m) => m.action.code)).toEqual(["KC_A"]);
  });

  it("is empty for an encoder", () => {
    expect(combosUsing(combos, model, codesOn(model, placement, 0), 0, { kind: "encoder", index: 0 })).toEqual([]);
  });
});
```

Create `web/src/analysis/reach.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KeyboardModel } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { layerReach, layerTargets, type Way } from "./reach";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";

function reach(setup: Setup) {
  const model = corne(setup);
  return layerReach(model, placeKeyboard(model));
}

/** A way, briefly: "key 38 on 0: while held from 0,1" */
function brief(way: Way): string {
  const via = way.via;
  const from = way.from.join(",");
  if (via.type === "default") return "default";
  if (via.type === "tri-layer") {
    return `tri-layer ${via.keys.map((k) => `${k.ref.index} on ${k.layer}`).join(" + ")}: ${way.action} from ${from}`;
  }
  const slot = via.slot ? ` TD ${via.slot.tapDance} ${via.slot.slot}` : "";
  if (via.type === "combo") return `combo ${via.combo.index}${slot}: ${way.action} from ${from}`;
  return `${via.ref.kind} ${via.ref.index} on ${via.layer}${slot}: ${way.action} from ${from}`;
}

const blank = (n: number) => Array.from({ length: n }, () => layer({}));

describe("layerTargets", () => {
  const model = corne({
    layers: blank(4),
    tapDances: [["KC_A", "MO(1)", "TG(2)", "LT3(KC_B)"], ["MO(9)", "KC_NO", "KC_NO", "KC_NO"]],
  });

  it("is a layer key's or layer-tap's layer, with what it does", () => {
    expect(layerTargets(model, described("OSL(3)"))).toEqual([{ layer: 3, action: "one-shot", slot: null }]);
    expect(layerTargets(model, described("LT2(KC_SPC)"))).toEqual([{ layer: 2, action: "while held", slot: null }]);
    expect(layerTargets(model, described("KC_A"))).toEqual([]);
  });

  it("is each layer in a tap dance's slots", () => {
    expect(layerTargets(model, described("TD(0)"))).toEqual([
      { layer: 1, action: "while held", slot: { tapDance: 0, slot: "Hold" } },
      { layer: 2, action: "toggle", slot: { tapDance: 0, slot: "Double tap" } },
      { layer: 3, action: "while held", slot: { tapDance: 0, slot: "Tap, then hold" } },
    ]);
  });

  it("leaves out layers the keyboard doesn't have, and tap dances it doesn't have", () => {
    expect(layerTargets(model, described("MO(4)"))).toEqual([]);
    expect(layerTargets(model, described("TD(1)"))).toEqual([]);
    expect(layerTargets(model, described("TD(7)"))).toEqual([]);
  });
});

describe("layerReach", () => {
  it("reaches the simulated Corne's layers by hold, one-shot and switch keys", () => {
    const model = simulatedCorne();
    const layers = layerReach(model, placeKeyboard(model));
    expect(layers.map((l) => l.reachable)).toEqual([true, true, true, true]);
    expect(layers.map((l) => l.ways.map(brief))).toEqual([
      ["default", `key ${AT.rightOuterThumb} on 3: switch to from 3`],
      [`key ${AT.leftMiddleThumb} on 0: while held from 0,2,3`],
      [`key ${AT.grid(0, 4)} on 0: while held from 0,1,3`, `key ${AT.grid(1, 1)} on 0: while held from 0,1`],
      [`key ${AT.rightOuterThumb} on 0: one-shot from 0,1,2`],
    ]);
  });

  it("knows every kind of layer key: MO, TG, TO, TT, OSL, DF and LT", () => {
    const layers = reach({
      layers: [
        layer({ 0: "MO(1)", 1: "TG(2)", 2: "TO(3)", 3: "TT(4)", 4: "OSL(5)", 5: "DF(6)", 6: "LT7(KC_A)" }, "KC_NO"),
        ...blank(7),
      ],
    });
    expect(layers.slice(1).map((l) => l.ways.map((w) => w.action))).toEqual([
      ["while held"], ["toggle"], ["switch to"], ["hold, or tap to toggle"], ["one-shot"], ["default"], ["while held"],
    ]);
    expect(layers.every((l) => l.reachable)).toBe(true);
  });

  it("knows LM, a layer held with modifiers", () => {
    const layers = reach({ layers: [layer({ 0: "LM(1, MOD_LSFT)" }, "KC_NO"), layer({ 0: "KC_A" })] });
    expect(layers[1].ways.map(brief)).toEqual(["key 0 on 0: while held, with modifiers from 0"]);
    expect(layers[1].reachable).toBe(true);
  });

  it("reaches layer 3 by holding both tri-layer keys, FN_MO13 and FN_MO23", () => {
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({}), layer({}), layer({ [AT.leftInnerThumb]: "KC_A", [AT.rightInnerThumb]: "KC_B" }, "KC_NO"),
      ],
    });
    expect(layers[1].ways.map(brief)).toEqual([`key ${AT.leftInnerThumb} on 0: while held from 0,2`]);
    expect(layers[2].ways.map(brief)).toEqual([`key ${AT.rightInnerThumb} on 0: while held from 0,1`]);
    expect(layers[3].ways.map(brief)).toEqual(
      [`tri-layer ${AT.leftInnerThumb} on 0 + ${AT.rightInnerThumb} on 0: while held from 0,1,2`]);
    expect(layers[3].reachable).toBe(true);
  });

  it("needs the second tri-layer key on the layer the first one turns on", () => {
    // layer 1 and 2 cover the other Fn key: neither order works
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({ [AT.rightInnerThumb]: "KC_X" }), layer({ [AT.leftInnerThumb]: "KC_Y" }), layer({}),
      ],
    });
    expect(layers[3].ways).toEqual([]);
    expect(layers[3].reachable).toBe(false);
  });

  it("finds no tri-layer way with only one of the two keys", () => {
    const layers = reach({ layers: [layer({ 0: "FN_MO13" }, "KC_NO"), layer({}), layer({}), layer({})] });
    expect(layers[3].ways).toEqual([]);
  });

  it("reaches layers through a tap dance's slots: tap, hold, double tap and tap then hold", () => {
    const layers = reach({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)" }, "KC_NO"), ...Array.from({ length: 4 }, () => layer({}, "KC_NO"))],
      tapDances: [["TG(1)", "MO(2)", "TO(3)", "LT4(KC_A)"]],
    });
    expect(layers.slice(1).map((l) => l.ways.map(brief))).toEqual([
      [`key ${AT.leftOuterThumb} on 0 TD 0 Tap: toggle from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Hold: while held from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Double tap: switch to from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Tap, then hold: while held from 0`],
    ]);
  });

  it("reaches a layer through a combo of two layer keys whose output is a layer key", () => {
    // the owner's W-CORNE: MO(5) + OSL(3) pressed together give layer 2
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)" }, "KC_NO"),
        ...blank(7),
      ],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }],
    });
    // the other layers are transparent, so the combo's keycodes are on every layer: it works everywhere but on layer 2
    expect(layers[2].ways.map(brief)).toEqual(["combo 0: while held from 0,1,3,4,5,6,7"]);
    expect(layers[2].reachable).toBe(true);
    expect(layers.map((l) => l.reachable)).toEqual([true, false, true, true, false, true, false, false]);
  });

  it("reaches layers through a combo whose output is a tap dance", () => {
    const layers = reach({
      layers: [layer({ 0: "KC_J", 1: "KC_K" }, "KC_NO"), ...blank(2)],
      tapDances: [["KC_ESC", "MO(1)", "TG(2)", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TD(0)" }],
    });
    expect(layers[1].ways.map(brief)).toEqual(["combo 0 TD 0 Hold: while held from 0,2"]);
    expect(layers[2].ways.map(brief)).toEqual(["combo 0 TD 0 Double tap: toggle from 0,1"]);
  });

  it("only counts a combo on the layers that have its keycodes, and still lists one that can never fire", () => {
    const layers = reach({
      layers: [layer({ 0: "KC_J" }, "KC_NO"), layer({ 1: "KC_K" }), layer({}), layer({ 0: "KC_NO" })],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TG(2)" }, { keys: ["KC_Q", "KC_W"], output: "TG(3)" }],
    });
    expect(layers[2].ways.map(brief)).toEqual(["combo 0: toggle from 1"]);
    expect(layers[3].ways.map(brief)).toEqual(["combo 1: toggle from "]);
    expect(layers[3].reachable).toBe(false);
  });

  it("leaves out keys and combos that only work on the layer they reach", () => {
    const layers = reach({
      layers: [layer({}, "KC_NO"), layer({ 0: "TG(1)", 1: "KC_A", 2: "KC_B" }, "KC_NO")],
      combos: [{ keys: ["KC_A", "KC_B"], output: "TG(1)" }],
    });
    expect(layers[1].ways).toEqual([]);
    expect(layers[1].reachable).toBe(false);
  });

  it("finds layers that nothing reaches, and those reached only from them", () => {
    const layers = reach({
      layers: [layer({ 0: "MO(1)" }, "KC_NO"), layer({}), layer({ 1: "MO(3)" }, "KC_NO"), layer({}), layer({})],
    });
    expect(layers.map((l) => l.reachable)).toEqual([true, true, false, false, false]);
    expect(layers[3].ways.map(brief)).toEqual(["key 1 on 2: while held from 2"]);
    expect(layers[4].ways).toEqual([]);
  });

  it("reaches a layer from a layer reached by DF (a new default layer)", () => {
    const layers = reach({ layers: [layer({ 0: "DF(1)" }, "KC_NO"), layer({ 1: "MO(2)" }, "KC_NO"), layer({})] });
    expect(layers.map((l) => l.reachable)).toEqual([true, true, true]);
  });

  it("ignores layers the keyboard doesn't have", () => {
    const layers = reach({ layers: [layer({ 0: "MO(9)", 1: "OSL(4)" }, "KC_NO"), layer({})] });
    expect(layers.map((l) => l.ways.length)).toEqual([1, 0]);
  });

  it("only uses the keys that are drawn, and encoders too", () => {
    const model: KeyboardModel = corne({ layers: [layer({}, "KC_NO"), layer({}), layer({})] });
    model.encoders = [{ ...model.keys[0], row: null, col: null, encoder: 0, direction: 1, x: 20 }];
    model.layers[0].encoders = [described("TG(1)")];
    model.layers[1].encoders = [described("KC_TRNS")];
    model.layers[2].encoders = [described("KC_TRNS")];
    // a key of a layout option that isn't chosen
    model.keys.push({ ...model.keys[0], layoutIndex: 0, layoutOption: 1 });
    model.layoutOptions = { value: 0, labels: ["Option"] };
    for (const l of model.layers) l.keys.push(described(l.index === 0 ? "MO(2)" : "KC_TRNS"));
    const layers = layerReach(model, placeKeyboard(model));
    expect(layers[1].ways.map(brief)).toEqual(["encoder 0 on 0: toggle from 0,2"]);
    expect(layers[2].ways).toEqual([]);
  });

  it("works for 8 layers, each reached from the one before", () => {
    const layers = reach({
      layers: Array.from({ length: 8 }, (_, i) => layer(i < 7 ? { [AT.leftInnerThumb]: `TO(${i + 1})` } : {}, "KC_NO")),
    });
    expect(layers.map((l) => l.reachable)).toEqual(Array(8).fill(true));
    expect(layers[7].ways.map(brief)).toEqual([`key ${AT.leftInnerThumb} on 6: switch to from 6`]);
  });

  it("has nothing for a keyboard without layers", () => {
    const model = corne({ layers: [] });
    expect(layerReach(model, placeKeyboard(model))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
cd web && npx vitest run src/keyboard/refs.test.ts src/analysis/combos.test.ts src/analysis/reach.test.ts
```

Expected: `Test Files  3 failed (3)` and `Tests  1 failed | 6 passed (7)`.

`refId` is not a function yet, and `combos.test.ts` and `reach.test.ts` can't import modules that don't exist yet.

- [ ] **Step 4: `refId` and `SlotLabel`**

Apply to `web/src/keyboard/refs.ts`:

```diff
diff --git a/web/src/keyboard/refs.ts b/web/src/keyboard/refs.ts
--- a/web/src/keyboard/refs.ts
+++ b/web/src/keyboard/refs.ts
@@ -7,6 +7,11 @@ export interface KeyRef {
   index: number;
 }
 
+/** "key:3" or "encoder:1": a key's identity as one string (the keyboard drawing's data-ref, keys of sets and maps) */
+export function refId(ref: KeyRef): string {
+  return `${ref.kind}:${ref.index}`;
+}
+
 /** What a key or encoder direction does on a layer */
 export function actionAt(model: Pick<KeyboardModel, "layers">, layer: number, ref: KeyRef): Described | undefined {
   const l = model.layers[layer];
```

Apply to `web/src/keymap/tapdance.ts`:

```diff
diff --git a/web/src/keymap/tapdance.ts b/web/src/keymap/tapdance.ts
--- a/web/src/keymap/tapdance.ts
+++ b/web/src/keymap/tapdance.ts
@@ -27,8 +27,11 @@ export function freeTapDance(model: Model): number | null {
   return free ? free.index : null;
 }
 
+/** The four ways of pressing a tap dance key */
+export type SlotLabel = "Tap" | "Hold" | "Double tap" | "Tap, then hold";
+
 /** The four ways of pressing a tap dance key, and what each does */
-export function tapDanceSlots(td: TapDance): { label: string; action: Described }[] {
+export function tapDanceSlots(td: TapDance): { label: SlotLabel; action: Described }[] {
   return [
     { label: "Tap", action: td.tap },
     { label: "Hold", action: td.hold },
```

- [ ] **Step 5: What a key does on a layer**

Create `web/src/analysis/effective.ts`:

```ts
// What a key does on a layer, once transparent keys have fallen through.
import type { Described, KeyboardModel } from "../api/types";
import { actionAt, type KeyRef } from "../keyboard/refs";

export interface Effective {
  /** the layer the action is set on: the layer itself, or the base layer for a transparent key */
  layer: number;
  action: Described;
}

/** What a key or encoder direction does on a layer: its own action, or for a transparent key the base layer's. QMK
 * falls through to the next active layer below, which depends on how the layer was reached; the analysis assumes the
 * base layer (layer 0) is the one under every layer, as it is for a layer held from the base layer. */
export function effectiveAt(model: Pick<KeyboardModel, "layers">, layer: number, ref: KeyRef): Effective | undefined {
  const own = actionAt(model, layer, ref);
  if (!own) return undefined;
  if (own.kind !== "transparent" || layer === 0) return { layer, action: own };
  const base = actionAt(model, 0, ref);
  return base ? { layer: 0, action: base } : undefined;
}

/** Whether a layer number is one of the keyboard's layers (a keycode can name a layer the keyboard doesn't have) */
export function isLayer(model: Pick<KeyboardModel, "layers">, layer: number | null | undefined): layer is number {
  return layer != null && Number.isInteger(layer) && layer >= 0 && layer < model.layers.length;
}
```

- [ ] **Step 6: Combos**

Create `web/src/analysis/combos.ts`:

```ts
// Combos: which keys they are made of. A combo is a list of keycodes, not of keys: QMK fires it when keys with those
// keycodes (on the active layers) are pressed together. So its keys are found by looking its keycodes up.
import type { Described, KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { actionAt, refId, type KeyRef } from "../keyboard/refs";
import { effectiveAt } from "./effective";

type Model = Pick<KeyboardModel, "layers" | "combos">;

export interface ComboMember {
  action: Described;
  /** the keys with this keycode on the base layer: none, one, or several */
  keys: KeyRef[];
}

export interface ComboInfo {
  index: number;
  /** its keycodes, empty slots (KC_NO) left out */
  members: ComboMember[];
  output: Described;
}

/** The keys of a placement (encoders are never part of a combo) */
function keyRefs(placement: Placement): KeyRef[] {
  return placement.items.filter((i) => i.kind === "key").map((i) => ({ kind: i.kind, index: i.index }));
}

/** The keycodes keys have on a layer, transparent keys fallen through (see effectiveAt): keycode -> keys */
export function codesOn(model: Pick<KeyboardModel, "layers">, placement: Placement, layer: number): Map<string, KeyRef[]> {
  const codes = new Map<string, KeyRef[]>();
  for (const ref of keyRefs(placement)) {
    const code = effectiveAt(model, layer, ref)?.action.code;
    if (code === undefined) continue;
    codes.set(code, [...(codes.get(code) ?? []), ref]);
  }
  return codes;
}

/** The combos that are set (at least one keycode), each keycode with the keys that have it on the base layer */
export function combosOf(model: Model, placement: Placement): ComboInfo[] {
  const base = model.layers.length > 0 ? codesOn(model, placement, 0) : new Map<string, KeyRef[]>();
  return model.combos
    .map((combo) => ({
      index: combo.index,
      members: combo.keys
        .filter((k) => k.kind !== "none")
        .map((action) => ({ action, keys: base.get(action.code) ?? [] })),
      output: combo.output,
    }))
    .filter((combo) => combo.members.length > 0);
}

/** The layers on which a combo can fire: those where every one of its keycodes is on some key */
export function comboLayers(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[]): number[] {
  return layerCodes.flatMap((codes, layer) => (combo.members.every((m) => codes.has(m.action.code)) ? [layer] : []));
}

/** The keys (by refId) that are part of a combo on a layer: those whose keycode there is one of a combo's. A
 * transparent key isn't marked (it would mark every empty layer); the combo goes through it all the same. */
export function comboKeysOn(
  combos: ComboInfo[],
  codes: Map<string, KeyRef[]>,
  model: Pick<KeyboardModel, "layers">,
  layer: number,
): Set<string> {
  const keys = new Set<string>();
  for (const combo of combos) {
    for (const member of combo.members) {
      for (const ref of codes.get(member.action.code) ?? []) {
        if (actionAt(model, layer, ref)?.kind !== "transparent") keys.add(refId(ref));
      }
    }
  }
  return keys;
}

export interface ComboUse {
  combo: ComboInfo;
  /** the combo's other keycodes, each with its keys on the layer (none when the layer lacks it) */
  partners: { action: Described; keys: KeyRef[] }[];
}

/** The combos a key is part of on a layer, through the keycode it has there */
export function combosUsing(
  combos: ComboInfo[],
  model: Pick<KeyboardModel, "layers">,
  codes: Map<string, KeyRef[]>,
  layer: number,
  ref: KeyRef,
): ComboUse[] {
  if (ref.kind !== "key") return [];
  const code = effectiveAt(model, layer, ref)?.action.code;
  if (code === undefined) return [];
  return combos
    .filter((combo) => combo.members.some((m) => m.action.code === code))
    .map((combo) => {
      // the key's own keycode once; a keycode listed twice is still a partner the second time
      const own = combo.members.findIndex((m) => m.action.code === code);
      const partners = combo.members
        .filter((_, i) => i !== own)
        .map((m) => ({ action: m.action, keys: codes.get(m.action.code) ?? [] }));
      return { combo, partners };
    });
}
```

- [ ] **Step 7: Layer reach**

Create `web/src/analysis/reach.ts`:

```ts
// How each layer is reached: by which keys, tap dances and combos, from which layers, and whether the keyboard can get
// there at all from the base layer.
//
// Only what the keymap says is known: layer switching done in the firmware's own C code (tri-layer,
// layer_state_set_user) isn't visible over the Vial protocol.
import type { Described, KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import type { KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
import { codesOn, comboLayers, combosOf, type ComboInfo } from "./combos";
import { effectiveAt, isLayer } from "./effective";

export type LayerAction = NonNullable<Described["layerAction"]>;
/** A tap dance slot that a way goes through */
export interface ViaSlot {
  tapDance: number;
  slot: SlotLabel;
}

export type Via =
  /** layer 0: where the keyboard starts */
  | { type: "default" }
  /** a key (or encoder direction) set on a layer: a layer key, a layer-tap, or a tap dance with a layer in a slot */
  | { type: "key"; ref: KeyRef; layer: number; action: Described; slot: ViaSlot | null }
  /** a combo whose output is a layer key, or a tap dance with a layer in a slot */
  | { type: "combo"; combo: ComboInfo; slot: ViaSlot | null }
  /** Vial's tri-layer keys FN_MO13 and FN_MO23 held together: each key, and the layer it is set on */
  | { type: "tri-layer"; keys: { ref: KeyRef; layer: number }[] };

export interface Way {
  via: Via;
  /** what it does with the layer */
  action: LayerAction;
  /** the layers it works on (never the layer it reaches); empty for a combo whose keycodes aren't on any key */
  from: number[];
}

export interface LayerReach {
  layer: number;
  ways: Way[];
  /** whether the keyboard can get to it from the base layer, through the ways */
  reachable: boolean;
}

interface Target {
  layer: number;
  action: LayerAction;
  slot: ViaSlot | null;
}

/** The layers a keycode reaches: a layer key or layer-tap's own layer, or each layer in a tap dance's slots. Layers the
 * keyboard doesn't have are left out. */
export function layerTargets(model: Pick<KeyboardModel, "layers" | "tapDance">, d: Described): Target[] {
  if ((d.kind === "layer" || d.kind === "layer-tap") && isLayer(model, d.layer) && d.layerAction) {
    return [{ layer: d.layer, action: d.layerAction, slot: null }];
  }
  if (d.kind !== "tap-dance" || d.index == null) return [];
  const td = model.tapDance[d.index];
  if (!td) return [];
  return tapDanceSlots(td).flatMap(({ label, action }) =>
    (action.kind === "layer" || action.kind === "layer-tap") && isLayer(model, action.layer) && action.layerAction
      ? [{ layer: action.layer, action: action.layerAction, slot: { tapDance: td.index, slot: label } }]
      : []);
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos">;

/** A tri-layer key (FN_MO13, FN_MO23) on the keymap */
interface FnKey {
  ref: KeyRef;
  layer: number;
  /** its own layer (1 or 2) and the one both together turn on (3) */
  own: number;
  tri: number;
  worksOn: number[];
}

/** Holding two tri-layer keys of different layers: one pressed first from a layer it works on, which turns its own
 * layer on, where the other one must work (set there, or fallen through to) */
function triLayerWays(keys: FnKey[]): { target: number; way: Way }[] {
  const ways: { target: number; way: Way }[] = [];
  for (const a of keys) {
    for (const b of keys) {
      if (a.own >= b.own || a.tri !== b.tri) continue;
      const from = new Set([
        ...(b.worksOn.includes(a.own) ? a.worksOn : []),
        ...(a.worksOn.includes(b.own) ? b.worksOn : []),
      ]);
      from.delete(a.tri);
      if (from.size === 0) continue;
      ways.push({
        target: a.tri,
        way: {
          via: { type: "tri-layer", keys: [{ ref: a.ref, layer: a.layer }, { ref: b.ref, layer: b.layer }] },
          action: "while held",
          from: [...from].sort((x, y) => x - y),
        },
      });
    }
  }
  return ways;
}

/** For every layer, every way it is reached and from which layers, and whether it can be reached at all.
 *
 * - Keys: a key set on layer S works on S, and on the layers where that key is transparent when S is the base layer
 *   (see effectiveAt). A key on the layer it reaches doesn't reach it (it can only leave it), so isn't listed.
 * - Combos: a combo works on the layers where each of its keycodes is on some key (QMK matches combos by keycode on
 *   the active layers), transparent keys falling through to the base layer.
 * - Tri-layer keys: FN_MO13 and FN_MO23 held together turn on layer 3 (see triLayerWays).
 * - LM (a layer with modifiers) counts as a key held for its layer.
 * - Layer 0 is where the keyboard starts. A layer is reachable when a way to it works on a reachable layer; DF (a new
 *   default layer) counts like any other way.
 */
export function layerReach(model: Model, placement: Placement): LayerReach[] {
  const count = model.layers.length;
  const ways: Way[][] = Array.from({ length: count }, (_, layer) => (layer === 0
    ? [{ via: { type: "default" }, action: "default", from: [] }]
    : []));

  const refs = placement.items.map((i) => ({ kind: i.kind, index: i.index }));
  const fnKeys: FnKey[] = [];
  for (let layer = 0; layer < count; layer++) {
    for (const ref of refs) {
      const action = effectiveAt(model, layer, ref);
      // each key once, from the layer it is set on
      if (!action || action.layer !== layer) continue;
      const worksOn = Array.from({ length: count }, (_, l) => l).filter((l) => effectiveAt(model, l, ref)?.layer === layer);
      const d = action.action;
      if (d.kind === "layer" && isLayer(model, d.layer) && isLayer(model, d.triLayer)) {
        fnKeys.push({ ref, layer, own: d.layer, tri: d.triLayer, worksOn });
      }
      for (const target of layerTargets(model, action.action)) {
        const from = worksOn.filter((l) => l !== target.layer);
        if (from.length === 0) continue;
        ways[target.layer].push({
          via: { type: "key", ref, layer, action: action.action, slot: target.slot },
          action: target.action,
          from,
        });
      }
    }
  }

  for (const { target, way } of triLayerWays(fnKeys)) ways[target].push(way);

  const layerCodes = Array.from({ length: count }, (_, layer) => codesOn(model, placement, layer));
  for (const combo of combosOf(model, placement)) {
    const usable = comboLayers(combo, layerCodes);
    for (const target of layerTargets(model, combo.output)) {
      const from = usable.filter((l) => l !== target.layer);
      // one that only works on the layer it reaches only leaves it; one that works nowhere is still shown
      if (usable.length > 0 && from.length === 0) continue;
      ways[target.layer].push({ via: { type: "combo", combo, slot: target.slot }, action: target.action, from });
    }
  }

  const reachable = new Set(count > 0 ? [0] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (let layer = 0; layer < count; layer++) {
      if (!reachable.has(layer) && ways[layer].some((w) => w.from.some((l) => reachable.has(l)))) {
        reachable.add(layer);
        grew = true;
      }
    }
  }
  return ways.map((w, layer) => ({ layer, ways: w, reachable: reachable.has(layer) }));
}
```

- [ ] **Step 8: Run the tests to see them pass, then every unit test, then type-check**

```bash
cd web && npx vitest run src/keyboard/refs.test.ts src/analysis/combos.test.ts src/analysis/reach.test.ts
```

Expected: `Test Files  3 passed (3)` and `Tests  40 passed (40)`.

```bash
cd web && npm test && npm run check
```

Expected: `Test Files  17 passed (17)` and `Tests  261 passed (261)` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 9: Commit**

```bash
git add web/src/analysis/combos.test.ts \
  web/src/analysis/combos.ts \
  web/src/analysis/effective.ts \
  web/src/analysis/reach.test.ts \
  web/src/analysis/reach.ts \
  web/src/analysis/testing.ts \
  web/src/keyboard/refs.test.ts \
  web/src/keyboard/refs.ts \
  web/src/keymap/tapdance.ts
git commit -m "feat(web): analysis of combos and of how each layer is reached"
```

### Task 4: Key positions in words

A layer key's tap label often says nothing ("MO 2", "OSL 3"), so the Overview names where the key is. `positionNames` works it out from the geometry alone.
- **Split keyboards:** a keyboard is split when there's a gap of at least 0.75 key units that no key reaches across (rotated keys measured as drawn), with at least a quarter of the keys on each side.
- **Rows:** key centres are grouped into rows, allowing up to 0.8 units of stagger within a row. The bottom row of a split half is its thumb row when it has fewer keys than the half's widest row.
- **Thumbs** are counted from the inside: "left inner/middle/outer thumb", "left thumb" for a single key, "left thumb N" for more than three.
- **Other keys:**
  - "left top row, 3rd from the outside", with "home" for the middle of three rows;
  - "left half, row 4, …" for more than three rows;
  - on a one-piece keyboard, "bottom row, 2nd from the left";
  - encoders: "encoder 0, clockwise".

**Files:**
- Create: `web/src/analysis/positions.ts`
- Test: `web/src/analysis/positions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/analysis/positions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KeyGeometry } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";
import { ordinal, positionNames, rowsOf, splitLine } from "./positions";
import { AT, corneKeys } from "./testing";

const g = (fields: Partial<KeyGeometry>): KeyGeometry => ({
  x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0, layoutIndex: -1, layoutOption: -1, decal: false,
  ...fields,
});

function board(keys: KeyGeometry[], encoders: KeyGeometry[] = []) {
  return placeKeyboard({ keys, encoders, layoutOptions: null });
}

describe("ordinal", () => {
  it("counts in English", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});

describe("splitLine", () => {
  it("is the middle of the gap between the halves of a split keyboard", () => {
    expect(splitLine(board(corneKeys()).items)).toBe(7.5);
  });

  it("is null for a keyboard in one piece, or a gap with only a few keys on one side", () => {
    const row = Array.from({ length: 10 }, (_, x) => g({ x }));
    expect(splitLine(board(row).items)).toBeNull();
    expect(splitLine(board([...row, g({ x: 12 })]).items)).toBeNull();
  });

  it("measures rotated keys as drawn", () => {
    // upright, the gap would be 0.9 units; a key turned 45 degrees reaches 0.2 units further, leaving 0.69
    const keys = [g({ x: 0 }), g({ x: 1, r: 45, rx: 1.5, ry: 0.5 }), g({ x: 2.9 }), g({ x: 3.9 })];
    expect(splitLine(board(keys).items)).toBeNull();
    expect(splitLine(board(keys.map((k) => ({ ...k, r: 0 }))).items)).not.toBeNull();
  });
});

describe("rowsOf", () => {
  it("keeps staggered columns in one row", () => {
    const keys = [g({ x: 0, y: 0.5 }), g({ x: 1, y: 0 }), g({ x: 2, y: 0.25 }), g({ x: 0, y: 1.5 }), g({ x: 1, y: 1 })];
    const rows = rowsOf(board(keys).items);
    expect(rows.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2], [3, 4]]);
  });
});

describe("positionNames", () => {
  const names = positionNames(board(corneKeys()));
  const at = (index: number) => names.get(refId({ kind: "key", index }));

  it("names the thumb keys of a split keyboard from the inside out", () => {
    expect([AT.leftInnerThumb, AT.leftMiddleThumb, AT.leftOuterThumb].map(at)).toEqual(
      ["left inner thumb", "left middle thumb", "left outer thumb"]);
    expect([AT.rightInnerThumb, AT.rightMiddleThumb, AT.rightOuterThumb].map(at)).toEqual(
      ["right inner thumb", "right middle thumb", "right outer thumb"]);
  });

  it("names the other keys by half, row and place from the outside", () => {
    expect(at(AT.grid(0, 0))).toBe("left top row, 1st from the outside");
    expect(at(AT.grid(1, 4))).toBe("left home row, 5th from the outside");
    expect(at(AT.grid(2, 11))).toBe("right bottom row, 1st from the outside");
    expect(at(AT.grid(0, 6))).toBe("right top row, 6th from the outside");
  });

  it("calls a single thumb key, or two, by what they are", () => {
    const keys = [...corneKeys().slice(0, 36), g({ x: 5, y: 3 }), g({ x: 9, y: 3 }), g({ x: 10, y: 3 })];
    const two = positionNames(board(keys));
    expect(two.get("key:36")).toBe("left thumb");
    expect(two.get("key:37")).toBe("right inner thumb");
    expect(two.get("key:38")).toBe("right outer thumb");
  });

  it("numbers the rows of a split half with more than three, and thumb clusters of more than three keys", () => {
    const keys: KeyGeometry[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) keys.push(g({ x, y }), g({ x: x + 8, y }));
    for (let x = 1; x < 5; x++) keys.push(g({ x, y: 4 }), g({ x: x + 7, y: 4 }));
    const many = positionNames(board(keys));
    expect(many.get("key:0")).toBe("left half, row 1, 1st from the outside");
    expect(many.get("key:31")).toBe("right half, row 4, 5th from the outside");
    // left thumbs 1-4 at x 1-4: the one at x 4 is nearest the middle
    expect(many.get("key:46")).toBe("left thumb 1");
    expect(many.get("key:40")).toBe("left thumb 4");
  });

  it("names the keys of a keyboard in one piece by row, from the left", () => {
    const keys = [g({ x: 0, y: 0 }), g({ x: 1, y: 0 }), g({ x: 0, y: 1 }), g({ x: 1, y: 1 }), g({ x: 0, y: 2, w: 2 })];
    const plain = positionNames(board(keys));
    expect(plain.get("key:1")).toBe("top row, 2nd from the left");
    expect(plain.get("key:2")).toBe("middle row, 1st from the left");
    expect(plain.get("key:4")).toBe("bottom row, 1st from the left");
    const four = positionNames(board([...keys, g({ x: 0, y: 3 })]));
    expect(four.get("key:5")).toBe("row 4, 1st from the left");
  });

  it("names encoders by number and direction", () => {
    const encoders = [g({ x: 3, encoder: 0, direction: 0 }), g({ x: 4, encoder: 0, direction: 1 })];
    const named = positionNames(board([g({ x: 0 })], encoders));
    expect(named.get("encoder:0")).toBe("encoder 0, counter-clockwise");
    expect(named.get("encoder:1")).toBe("encoder 0, clockwise");
  });

  it("is empty for a keyboard without keys", () => {
    expect(positionNames(board([])).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/analysis/positions.test.ts
```

Expected: `Cannot find module './positions'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Create `web/src/analysis/positions.ts`:

```ts
// Where a key sits on the keyboard, in words ("left inner thumb", "right top row, 2nd from the outside"), worked out
// from the geometry alone: for keys whose label says nothing about them (MO 2, OSL 3).
import { boundsOf, type PlacedKey, type Placement } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";

/** a gap between the keys at least this wide (in key units) splits the keyboard into two halves */
const SPLIT_GAP = 0.75;
/** each half has at least this share of the keys */
const SPLIT_SHARE = 0.25;
/** a key whose centre is this far (in key units) below the first key of a row starts the next row */
const ROW_SPAN = 0.8;

export type Side = "left" | "right";

/** The vertical line between the halves of a split keyboard (in key units), or null for a keyboard in one piece: the
 * widest gap of at least SPLIT_GAP across which no key reaches, with at least a quarter of the keys on each side */
export function splitLine(keys: PlacedKey[]): number | null {
  const spans = keys.map((k) => boundsOf(k)).map((b) => [b.left, b.right]).sort((a, b) => a[0] - b[0]);
  let best: { width: number; at: number } | null = null;
  let reach = -Infinity;
  for (const [left, right] of spans) {
    if (reach > -Infinity && left - reach >= SPLIT_GAP && (!best || left - reach > best.width)) {
      best = { width: left - reach, at: (left + reach) / 2 };
    }
    reach = Math.max(reach, right);
  }
  if (!best) return null;
  const at = best.at;
  const leftCount = keys.filter((k) => k.cx < at).length;
  const share = Math.min(leftCount, keys.length - leftCount) / keys.length;
  return share >= SPLIT_SHARE ? at : null;
}

/** Rows of keys from the top, each from left to right: a key more than ROW_SPAN below the first key of a row starts
 * the next one (so columns staggered by up to that much stay in one row) */
export function rowsOf(keys: PlacedKey[]): PlacedKey[][] {
  const rows: PlacedKey[][] = [];
  for (const key of [...keys].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const row = rows.at(-1);
    if (row && key.cy - row[0].cy <= ROW_SPAN) row.push(key);
    else rows.push([key]);
  }
  return rows.map((row) => row.sort((a, b) => a.cx - b.cx));
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const THUMB_WORDS: Record<number, string[]> = { 2: ["inner", "outer"], 3: ["inner", "middle", "outer"] };

/** "left inner thumb" for a cluster of 2 or 3 thumb keys, "left thumb" for one, "left thumb 4" (from the inside) for
 * more */
function thumbName(side: Side, position: number, count: number): string {
  if (count === 1) return `${side} thumb`;
  const words = THUMB_WORDS[count];
  return words ? `${side} ${words[position]} thumb` : `${side} thumb ${position + 1}`;
}

/** "top", "home", "bottom" for three rows of a split keyboard ("middle" on one in a piece), "top"/"bottom" for two,
 * else null (the rows are numbered) */
function rowWord(row: number, count: number, split: boolean): string | null {
  if (count === 2) return ["top", "bottom"][row];
  if (count === 3) return ["top", split ? "home" : "middle", "bottom"][row];
  return null;
}

function encoderName(item: PlacedKey): string {
  const direction = item.geometry.direction === 1 ? "clockwise" : "counter-clockwise";
  return `encoder ${item.geometry.encoder ?? 0}, ${direction}`;
}

/** Every placed key's position in words, by refId. On a split keyboard: "left inner thumb" (the bottom row of a half,
 * when it has fewer keys than its other rows), "right top row, 2nd from the outside", "left half, row 4, 1st from the
 * outside" (more than three rows). In one piece: "bottom row, 3rd from the left", "row 4, 1st from the left".
 * Encoders: "encoder 0, clockwise". */
export function positionNames(placement: Placement): Map<string, string> {
  const names = new Map<string, string>();
  const keys = placement.items.filter((i) => i.kind === "key");
  for (const item of placement.items) if (item.kind === "encoder") names.set(refId(item), encoderName(item));
  if (keys.length === 0) return names;

  const split = splitLine(keys);
  const halves: { side: Side | null; keys: PlacedKey[] }[] = split === null
    ? [{ side: null, keys }]
    : [
        { side: "left", keys: keys.filter((k) => k.cx < split) },
        { side: "right", keys: keys.filter((k) => k.cx >= split) },
      ];

  for (const { side, keys: half } of halves) {
    const rows = rowsOf(half);
    const widest = Math.max(...rows.map((r) => r.length));
    const last = rows.at(-1)!;
    const hasThumbs = side !== null && rows.length >= 2 && last.length < widest;
    const plain = hasThumbs ? rows.slice(0, -1) : rows;
    plain.forEach((row, r) => {
      // from the outside on a split keyboard: the left half from the left, the right half from the right
      const ordered = side === "right" ? [...row].reverse() : row;
      const word = rowWord(r, plain.length, side !== null);
      const along = side ? "from the outside" : "from the left";
      const where = side
        ? word ? `${side} ${word} row` : `${side} half, row ${r + 1}`
        : word ? `${word} row` : `row ${r + 1}`;
      ordered.forEach((key, i) => names.set(refId(key), `${where}, ${ordinal(i + 1)} ${along}`));
    });
    if (hasThumbs && side !== null && split !== null) {
      // from the inside (nearest the middle of the keyboard) out
      const thumbs = [...last].sort((a, b) => Math.abs(a.cx - split) - Math.abs(b.cx - split));
      thumbs.forEach((key, i) => names.set(refId(key), thumbName(side, i, thumbs.length)));
    }
  }
  return names;
}
```

- [ ] **Step 4: Run it to see it pass, then type-check**

```bash
cd web && npx vitest run src/analysis/positions.test.ts
```

Expected: `Tests  12 passed (12)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/analysis/positions.test.ts \
  web/src/analysis/positions.ts
git commit -m "feat(web): key positions in words, from the keyboard's geometry"
```

### Task 5: What uses each tap dance and macro

`usageOf` lists, for every tap dance and macro, what runs it:
- keys on every layer, on the keyboard as drawn (the chosen layout options);
- combos (a keycode or the output);
- other tap dances' slots (a tap dance running itself doesn't count);
- key overrides (trigger or replacement);
- alt-repeat keys.

`unusedOf` gives the tap dances with something in a slot, and the macros with steps, that nothing uses. The Overview's "Not used" box shows them; phase 4's pages will show the full "used on" lists.

**Files:**
- Create: `web/src/analysis/usage.ts`
- Test: `web/src/analysis/usage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/analysis/usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";
import { unusedOf, usageOf } from "./usage";

function usage(setup: Setup) {
  const model = corne(setup);
  return usageOf(model, placeKeyboard(model));
}

describe("usageOf", () => {
  it("lists the keys that use each tap dance and macro, by layer and key", () => {
    const used = usage({
      layers: [layer({ 0: "TD(0)", 1: "M1" }, "KC_NO"), layer({ 0: "TD(0)", 5: "TD(1)" })],
      tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"], ["KC_B", "KC_NO", "KC_NO", "KC_NO"]],
      macros: [1, 1],
    });
    expect(used.tapDances).toEqual([
      [{ type: "key", layer: 0, ref: { kind: "key", index: 0 } }, { type: "key", layer: 1, ref: { kind: "key", index: 0 } }],
      [{ type: "key", layer: 1, ref: { kind: "key", index: 5 } }],
    ]);
    expect(used.macros).toEqual([[], [{ type: "key", layer: 0, ref: { kind: "key", index: 1 } }]]);
  });

  it("counts combos, other tap dances, key overrides and alt repeat keys", () => {
    const used = usage({
      layers: [layer({}, "KC_NO")],
      tapDances: [["M0", "KC_NO", "TD(1)", "TD(0)"], ["KC_A", "KC_NO", "KC_NO", "KC_NO"]],
      combos: [{ keys: ["TD(1)", "KC_A"], output: "M0" }],
      macros: [1],
      keyOverrides: [{ trigger: "KC_A", replacement: "M0" }],
      altRepeatKeys: [{ keycode: "TD(1)", altKeycode: "M0" }],
    });
    expect(used.tapDances[0]).toEqual([]); // its own slot doesn't count
    expect(used.tapDances[1]).toEqual([
      { type: "combo", combo: 0, part: "key" },
      { type: "tap-dance", tapDance: 0, slot: "Double tap" },
      { type: "alt-repeat", altRepeat: 0, part: "keycode" },
    ]);
    expect(used.macros[0]).toEqual([
      { type: "combo", combo: 0, part: "output" },
      { type: "tap-dance", tapDance: 0, slot: "Tap" },
      { type: "key-override", keyOverride: 0, part: "replacement" },
      { type: "alt-repeat", altRepeat: 0, part: "alt keycode" },
    ]);
  });

  it("only counts the keys that are drawn, encoders included, and ignores numbers the keyboard doesn't have", () => {
    const model = corne({ layers: [layer({ 0: "TD(5)", 1: "M7" }, "KC_NO")], tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"]] });
    model.encoders = [{ ...model.keys[0], row: null, col: null, encoder: 0, direction: 0, x: 20 }];
    model.layers[0].encoders = [described("TD(0)")];
    model.keys.push({ ...model.keys[0], layoutIndex: 0, layoutOption: 1 });
    model.layoutOptions = { value: 0, labels: ["Option"] };
    model.layers[0].keys.push(described("TD(0)"));
    const used = usageOf(model, placeKeyboard(model));
    expect(used.tapDances).toEqual([[{ type: "key", layer: 0, ref: { kind: "encoder", index: 0 } }]]);
    expect(used.macros).toEqual([]);
  });
});

describe("unusedOf", () => {
  it("lists the tap dances and macros that are set up but that nothing uses", () => {
    const model = simulatedCorne();
    expect(unusedOf(model, usageOf(model, placeKeyboard(model)))).toEqual({ tapDances: [1], macros: [1] });
  });

  it("leaves out empty ones, and counts any use", () => {
    const model = corne({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)" }, "KC_NO")],
      tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"], ["KC_NO", "KC_NO", "KC_NO", "KC_NO"], ["KC_NO", "KC_NO", "M0", "KC_NO"]],
      combos: [{ keys: ["KC_A", "KC_B"], output: "TD(2)" }],
      macros: [3, 0],
    });
    expect(unusedOf(model, usageOf(model, placeKeyboard(model)))).toEqual({ tapDances: [], macros: [] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/analysis/usage.test.ts
```

Expected: `Cannot find module './usage'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Create `web/src/analysis/usage.ts`:

```ts
// What uses each tap dance and macro, and the ones that are set but that nothing uses.
import type { Described, KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import type { KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

export type Use =
  /** a key or encoder direction on a layer */
  | { type: "key"; layer: number; ref: KeyRef }
  /** one of a combo's keycodes, or its output */
  | { type: "combo"; combo: number; part: "key" | "output" }
  /** a slot of another tap dance */
  | { type: "tap-dance"; tapDance: number; slot: SlotLabel }
  | { type: "key-override"; keyOverride: number; part: "trigger" | "replacement" }
  | { type: "alt-repeat"; altRepeat: number; part: "keycode" | "alt keycode" };

export interface Usage {
  /** by tap dance index; every tap dance has an entry */
  tapDances: Use[][];
  /** by macro index; every macro has an entry */
  macros: Use[][];
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "macros">;

/** Which keys (on the keyboard as drawn: the chosen layout options), combos, tap dances, key overrides and alt repeat
 * keys use each tap dance and macro. A tap dance running itself from one of its slots doesn't count. */
export function usageOf(model: Model, placement: Placement): Usage {
  const usage: Usage = {
    tapDances: model.tapDance.map(() => []),
    macros: model.macros.items.map(() => []),
  };
  const note = (d: Described, use: Use) => {
    if (d.index == null) return;
    const list = d.kind === "tap-dance" ? usage.tapDances[d.index] : d.kind === "macro" ? usage.macros[d.index] : null;
    list?.push(use);
  };

  model.layers.forEach((layer, l) => {
    for (const item of placement.items) {
      const d = item.kind === "key" ? layer.keys[item.index] : layer.encoders[item.index];
      if (d) note(d, { type: "key", layer: l, ref: { kind: item.kind, index: item.index } });
    }
  });
  for (const combo of model.combos) {
    for (const key of combo.keys) note(key, { type: "combo", combo: combo.index, part: "key" });
    note(combo.output, { type: "combo", combo: combo.index, part: "output" });
  }
  for (const td of model.tapDance) {
    for (const { label, action } of tapDanceSlots(td)) {
      if (action.kind === "tap-dance" && action.index === td.index) continue;
      note(action, { type: "tap-dance", tapDance: td.index, slot: label });
    }
  }
  for (const o of model.keyOverrides) {
    note(o.trigger, { type: "key-override", keyOverride: o.index, part: "trigger" });
    note(o.replacement, { type: "key-override", keyOverride: o.index, part: "replacement" });
  }
  for (const a of model.altRepeatKeys) {
    note(a.keycode, { type: "alt-repeat", altRepeat: a.index, part: "keycode" });
    note(a.altKeycode, { type: "alt-repeat", altRepeat: a.index, part: "alt keycode" });
  }
  return usage;
}

export interface Unused {
  /** tap dances with something in a slot that nothing uses */
  tapDances: number[];
  /** macros with steps that nothing uses */
  macros: number[];
}

/** The tap dances and macros that are set up but that nothing uses */
export function unusedOf(model: Pick<KeyboardModel, "tapDance" | "macros">, usage: Usage): Unused {
  return {
    tapDances: model.tapDance
      .filter((td) => tapDanceSlots(td).some((s) => s.action.kind !== "none") && usage.tapDances[td.index]?.length === 0)
      .map((td) => td.index),
    macros: model.macros.items
      .filter((m) => m.actions.length > 0 && usage.macros[m.index]?.length === 0)
      .map((m) => m.index),
  };
}
```

- [ ] **Step 4: Run it to see it pass, then type-check**

```bash
cd web && npx vitest run src/analysis/usage.test.ts
```

Expected: `Tests  5 passed (5)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/analysis/usage.test.ts \
  web/src/analysis/usage.ts
git commit -m "feat(web): what uses each tap dance and macro, and the unused ones"
```

### Task 6: `analyse()` bundles the analysis

`analyse(model, placement)` returns everything the keymap views show beyond the keys:
- positions;
- reach per layer;
- the combos that are set;
- each layer's keycodes and their keys;
- the combo keys per layer;
- tap dance and macro usage, and the unused ones.

`KeymapPage` will hold it as a `$derived` (Task 14). The test builds a keyboard like the owner's W-CORNE: 8 layers, the combo MO(5) + OSL(3) → MO(2), and layers 4, 6 and 7 reached by nothing.

**Files:**
- Create: `web/src/analysis/analysis.ts`
- Test: `web/src/analysis/analysis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/analysis/analysis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { analyse } from "./analysis";
import { AT, corne, layer, simulatedCorne } from "./testing";

describe("analyse", () => {
  it("puts the analysis of the simulated Corne together", () => {
    const model = simulatedCorne();
    const analysis = analyse(model, placeKeyboard(model));
    expect(analysis.reach.map((r) => r.reachable)).toEqual([true, true, true, true]);
    expect(analysis.combos.map((c) => c.index)).toEqual([0, 1]);
    expect(analysis.codes).toHaveLength(4);
    expect(analysis.codes[0].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([4, 0, 0, 0]);
    expect(analysis.positions.get(`key:${AT.rightOuterThumb}`)).toBe("right outer thumb");
    expect(analysis.usage.tapDances[0]).toEqual([{ type: "key", layer: 0, ref: { kind: "key", index: AT.leftInnerThumb } }]);
    expect(analysis.unused).toEqual({ tapDances: [1], macros: [1] });
  });

  it("covers 8 layers, as the owner's W-CORNE has, with layers that nothing reaches", () => {
    // like the W-CORNE: layer 2 is reached by the MO(5) + OSL(3) combo; 4, 6 and 7 by nothing
    const model = corne({
      layers: [
        layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", [AT.leftMiddleThumb]: "LT1(KC_SPC)" }, "KC_A"),
        ...Array.from({ length: 7 }, () => layer({})),
      ],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }],
    });
    const analysis = analyse(model, placeKeyboard(model));
    expect(analysis.reach).toHaveLength(8);
    expect(analysis.reach.map((r) => r.reachable)).toEqual([true, true, true, true, false, true, false, false]);
    expect(analysis.reach[2].ways.map((w) => w.via.type)).toEqual(["combo"]);
    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/analysis/analysis.test.ts
```

Expected: `Cannot find module './analysis'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Create `web/src/analysis/analysis.ts`:

```ts
// Everything the keymap views show about a keyboard beyond its keys, worked out in the browser from the loaded model,
// so it follows every edit at once.
import type { KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import type { KeyRef } from "../keyboard/refs";
import { codesOn, comboKeysOn, combosOf, type ComboInfo } from "./combos";
import { positionNames } from "./positions";
import { layerReach, type LayerReach } from "./reach";
import { unusedOf, usageOf, type Unused, type Usage } from "./usage";

export interface Analysis {
  /** every placed key's position in words, by refId */
  positions: Map<string, string>;
  /** by layer */
  reach: LayerReach[];
  /** the combos that are set */
  combos: ComboInfo[];
  /** by layer: each keycode and the keys that have it there */
  codes: Map<string, KeyRef[]>[];
  /** by layer: the keys (refIds) that are part of a combo there */
  comboKeys: Set<string>[];
  usage: Usage;
  unused: Unused;
}

export function analyse(model: KeyboardModel, placement: Placement): Analysis {
  const combos = combosOf(model, placement);
  const codes = model.layers.map((_, layer) => codesOn(model, placement, layer));
  const usage = usageOf(model, placement);
  return {
    positions: positionNames(placement),
    reach: layerReach(model, placement),
    combos,
    codes,
    comboKeys: codes.map((c, layer) => comboKeysOn(combos, c, model, layer)),
    usage,
    unused: unusedOf(model, usage),
  };
}
```

- [ ] **Step 4: Run it to see it pass, then every unit test, then type-check**

```bash
cd web && npx vitest run src/analysis/analysis.test.ts
```

Expected: `Tests  2 passed (2)`.

```bash
cd web && npm test && npm run check
```

Expected: `Test Files  20 passed (20)` and `Tests  280 passed (280)` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/analysis/analysis.test.ts \
  web/src/analysis/analysis.ts
git commit -m "feat(web): analyse() bundles layer reach, combos, positions and usage"
```

### Task 7: The analysis in words

`phrases.ts` holds every phrase the Overview and the Inspector show. They read as instructions:

| Way | Example |
|---|---|
| Layer-tap, or a layer key with a meaningful tap label | "hold Space" |
| Layer key with no tap label: verb + position | "one-shot (right outer thumb)", "toggle (left top row, 3rd from the outside)", "hold or toggle (…)", "make default (…)", "make default for good (…)" |
| A way that doesn't start on the base layer | "switch from Layer 3 (right outer thumb)" |
| Tap dance slot: gesture + the tap dance's tap label, else its position | "hold Tab", "double-tap Tab to toggle", "tap then hold Tab", "tap for a one-shot (right inner thumb)" |
| Combo | "combo: MO(5) + OSL(3)", "combo: J + K, double-tapped to toggle", "combo: Q + W to toggle" |
| LM | "hold with Shift (right inner thumb)" |
| Tri-layer | "hold both Fn keys (left inner thumb and right inner thumb)" |

- **Combo keycodes:**
  - layer, tap dance and macro keys are named by their keycode ("MO(5)", "TD(0)");
  - LM and the Fn keys by their label;
  - a layer-tap or mod-tap by what it types plus a hold note ("Space (hold: Layer 1)", "T (hold: Shift)");
  - anything else by what it types ("K").
- **`wayDetail`** says which layers a way works from ("from any layer", "from Base, Layer 1").
- **`unreachedReason`** explains a layer nothing reaches.
- **`comboUseLabel` and `missingPartners`** are for the Inspector's combo list: "with OSL(3) → Layer 2, while held", "Y isn't on this layer".

**Files:**
- Create: `web/src/analysis/phrases.ts`
- Test: `web/src/analysis/phrases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/analysis/phrases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KeyboardModel } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { codesOn, combosOf, combosUsing } from "./combos";
import {
  comboName, comboUseLabel, memberName, missingPartners, tapName, unreachedReason, wayDetail, wayLabel,
  type PhraseContext,
} from "./phrases";
import { positionNames } from "./positions";
import { layerReach } from "./reach";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";

function setup(model: KeyboardModel) {
  const placement = placeKeyboard(model);
  const ctx: PhraseContext = { model, names: namesOf(model), positions: positionNames(placement) };
  const reach = layerReach(model, placement);
  return {
    ctx,
    reach,
    labels: reach.map((r) => r.ways.map((w) => wayLabel(w, ctx))),
    details: reach.map((r) => r.ways.map((w) => wayDetail(w, ctx))),
  };
}

const of = (s: Setup) => setup(corne(s));

describe("tapName", () => {
  const model = corne({ layers: [], tapDances: [["KC_TAB", "MO(1)", "KC_NO", "KC_NO"], ["OSL(2)", "KC_NO", "KC_NO", "KC_NO"]] });

  it("is what a key types when tapped", () => {
    expect(tapName(described("LT1(KC_SPC)"), model)).toBe("Space");
    expect(tapName(described("LSFT_T(KC_T)"), model)).toBe("T");
    expect(tapName(described("KC_K"), model)).toBe("K");
  });

  it("is what a tap dance taps, when that is a key", () => {
    expect(tapName(described("TD(0)"), model)).toBe("Tab");
    expect(tapName(described("TD(1)"), model)).toBeNull();
    expect(tapName(described("TD(9)"), model)).toBeNull();
  });

  it("is null for keys whose label says nothing about them", () => {
    for (const code of ["MO(1)", "OSL(3)", "M0", "KC_NO", "KC_TRNS", "LT1(KC_NO)"]) {
      expect(tapName(described(code), model)).toBeNull();
    }
  });
});

describe("memberName and comboName", () => {
  const names = namesOf(corne({ layers: [layer({}), layer({})] }));

  it("names layer, tap dance and macro keys by their keycode, others by what they type and do on hold", () => {
    expect(["MO(5)", "OSL(3)", "TD(0)", "M1", "KC_K", "LT1(KC_SPC)", "LSFT_T(KC_T)"].map((c) => memberName(described(c), names)))
      .toEqual(["MO(5)", "OSL(3)", "TD(0)", "M1", "K", "Space (hold: Layer 1)", "T (hold: Shift)"]);
    expect(memberName({ ...described("KC_A"), kind: "one-shot-mod", tap: "Shift" }, names)).toBe("one-shot Shift");
    expect(memberName({ ...described("LT1(KC_NO)"), tap: "" }, names)).toBe("nothing (hold: Layer 1)");
  });

  it("names a layer key without a keycode name (LM) and the tri-layer keys by their label", () => {
    expect(memberName({ ...described("LM(1, MOD_LSFT)"), code: "0x5022" }, names)).toBe("LM 1");
    expect(memberName(described("FN_MO13"), names)).toBe("Fn1 (Fn3)");
  });

  it("joins a combo's keycodes with +", () => {
    expect(comboName([{ action: described("MO(5)") }, { action: described("OSL(3)") }], names)).toBe("MO(5) + OSL(3)");
  });
});

describe("wayLabel and wayDetail", () => {
  it("say how the simulated Corne's layers are reached", () => {
    const { labels, details } = setup(simulatedCorne());
    expect(labels).toEqual([
      ["default layer", "switch from Layer 3 (right outer thumb)"],
      ["hold Space"],
      ["hold B", "hold S"],
      ["one-shot (right outer thumb)"],
    ]);
    expect(details).toEqual([
      ["the layer the keyboard starts on", "from Layer 3"],
      ["from any layer"],
      ["from any layer", "from Base, Layer 1"],
      ["from any layer"],
    ]);
  });

  it("name a layer key without a tap label by where it is", () => {
    const { labels } = of({
      layers: [
        layer({
          [AT.leftInnerThumb]: "MO(1)", [AT.leftOuterThumb]: "TG(2)", [AT.grid(0, 0)]: "TT(3)", [AT.grid(0, 11)]: "DF(4)",
          [AT.rightInnerThumb]: "LM(5, MOD_LSFT)", [AT.rightMiddleThumb]: "OSL(6)", [AT.rightOuterThumb]: "PDF(7)",
        }, "KC_NO"),
        ...Array.from({ length: 7 }, () => layer({}, "KC_NO")),
      ],
    });
    expect(labels.slice(1)).toEqual([
      ["hold (left inner thumb)"],
      ["toggle (left outer thumb)"],
      ["hold or toggle (left top row, 1st from the outside)"],
      ["make default (right top row, 1st from the outside)"],
      ["hold with Shift (right inner thumb)"],
      ["one-shot (right middle thumb)"],
      ["make default for good (right outer thumb)"],
    ]);
  });

  it("name a layer-tap by what it types", () => {
    const { labels } = of({ layers: [layer({ 0: "LT1(KC_SPC)", 1: "LT1(KC_NO)" }, "KC_NO"), layer({}, "KC_NO")] });
    expect(labels[1]).toEqual(["hold Space", "hold (left top row, 2nd from the outside)"]);
  });

  it("say which tap dance slot reaches a layer, named by what the tap dance taps", () => {
    const { labels, details } = of({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)", [AT.rightInnerThumb]: "TD(1)" }, "KC_NO"),
        ...Array.from({ length: 6 }, () => layer({}, "KC_NO"))],
      tapDances: [["KC_TAB", "MO(1)", "TG(2)", "MO(3)"], ["OSL(4)", "KC_NO", "MO(6)", "TO(5)"]],
    });
    expect(labels.slice(1)).toEqual([
      ["hold Tab"],
      ["double-tap Tab to toggle"],
      ["tap then hold Tab"],
      ["tap for a one-shot (right inner thumb)"],
      ["tap then hold to switch (right inner thumb)"],
      ["double-tap and hold (right inner thumb)"],
    ]);
    expect(details[2]).toEqual(["tap dance 0, double tap · from Base"]);
  });

  it("name a combo by its keycodes, and the tap dance slot of a combo's tap dance", () => {
    const { labels, details } = of({
      layers: [layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", 0: "KC_J", 1: "KC_K", 2: "LT1(KC_SPC)" },
        "KC_NO"), ...Array.from({ length: 7 }, () => layer({}))],
      tapDances: [["KC_ESC", "MO(4)", "TG(6)", "KC_NO"]],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_J", "KC_K"], output: "TD(0)" },
        { keys: ["KC_Q", "KC_W"], output: "TG(7)" }, { keys: ["LT1(KC_SPC)", "OSL(3)"], output: "LM(1, MOD_LCTL)" }],
    });
    expect(labels[2]).toEqual(["combo: MO(5) + OSL(3)"]);
    expect(labels[4]).toEqual(["combo: J + K, held"]);
    expect(labels[6]).toEqual(["combo: J + K, double-tapped to toggle"]);
    expect(labels[7]).toEqual(["combo: Q + W to toggle"]);
    expect(details[7]).toEqual(["can't fire: its keys aren't all on one layer"]);
    expect(labels[1]).toEqual(["hold Space", "combo: Space (hold: Layer 1) + OSL(3) with Ctrl"]);
  });

  it("say where a way works when it doesn't work on the base layer", () => {
    const { labels, details } = of({
      layers: [layer({ 0: "MO(1)" }, "KC_NO"), layer({ 2: "MO(3)", 3: "KC_J", 4: "KC_K" }),
        layer({ 3: "KC_J", 4: "KC_K" }), layer({})],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TG(3)" }],
    });
    expect(labels[3]).toEqual([
      "hold from Layer 1 (left top row, 3rd from the outside)", "combo: J + K to toggle from Layer 1, Layer 2",
    ]);
    expect(details[3]).toEqual(["from Layer 1", "from Layer 1, Layer 2"]);
  });

  it("say which keys to hold together for the tri-layer", () => {
    const { labels } = of({
      layers: [layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({}), layer({}), layer({}, "KC_NO")],
    });
    expect(labels[1]).toEqual(["hold (left inner thumb)"]);
    expect(labels[3]).toEqual(["hold both Fn keys (left inner thumb and right inner thumb)"]);
  });
});

describe("unreachedReason", () => {
  it("is null for a reachable layer, and says why another can't be reached", () => {
    const { reach } = of({ layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({}), layer({ 1: "MO(3)" }, "KC_NO"), layer({})] });
    expect(reach.map(unreachedReason)).toEqual([
      null, "Nothing reaches this layer", "Nothing reaches this layer", "Only reached from layers that nothing reaches",
    ]);
  });
});

describe("comboUseLabel and missingPartners", () => {
  const model = corne({
    layers: [layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", 0: "KC_K", 1: "KC_A" }, "KC_NO"),
      ...Array.from({ length: 7 }, () => layer({}))],
    combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_K", "KC_Y"], output: "KC_ESC" },
      { keys: ["KC_A"], output: "KC_B" }, { keys: ["KC_A", "KC_Q", "KC_W"], output: "KC_C" }],
  });
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const names = namesOf(model);
  const uses = (index: number) => combosUsing(combos, model, codesOn(model, placement, 0), 0, { kind: "key", index });

  it("say what the other keys are and what the combo does", () => {
    expect(uses(AT.leftInnerThumb).map((u) => comboUseLabel(u, names))).toEqual(["with OSL(3) → Layer 2, while held"]);
    expect(uses(AT.rightOuterThumb).map((u) => comboUseLabel(u, names))).toEqual(["with MO(5) → Layer 2, while held"]);
    expect(uses(0).map((u) => comboUseLabel(u, names))).toEqual(["with Y → Esc"]);
    expect(uses(1).map((u) => comboUseLabel(u, names))).toEqual(["on its own → B", "with Q + W → C"]);
  });

  it("name a layer-tap partner by what it types and what holding it does", () => {
    const lt = corne({
      layers: [layer({ 0: "LT1(KC_SPC)", 1: "OSL(3)" }, "KC_NO"), layer({}), layer({}), layer({})],
      combos: [{ keys: ["LT1(KC_SPC)", "OSL(3)"], output: "MO(2)" }],
    });
    const p = placeKeyboard(lt);
    const [use] = combosUsing(combosOf(lt, p), lt, codesOn(lt, p, 0), 0, { kind: "key", index: 1 });
    expect(comboUseLabel(use, namesOf(lt))).toBe("with Space (hold: Layer 1) → Layer 2, while held");
  });

  it("say which other keys aren't on the layer", () => {
    expect(uses(AT.leftInnerThumb).map((u) => missingPartners(u, names))).toEqual([null]);
    expect(uses(0).map((u) => missingPartners(u, names))).toEqual(["Y isn't on this layer"]);
    expect(uses(1).map((u) => missingPartners(u, names))).toEqual([null, "Q and W aren't on this layer"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/analysis/phrases.test.ts
```

Expected: `Cannot find module './phrases'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Task 8 adds the find phrases (`howText`, `foundLabel`) to this file.

Create `web/src/analysis/phrases.ts`:

```ts
// The analysis in words, for the Overview and the Inspector: "hold Space", "one-shot (right outer thumb)",
// "switch from Layer 3 (right outer thumb)", "double-tap Tab to toggle", "combo: MO(5) + OSL(3)", "with Y → Esc".
import type { Described, KeyboardModel, TapDance } from "../api/types";
import { actionSummary, type Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import type { SlotLabel } from "../keymap/tapdance";
import type { ComboUse } from "./combos";
import type { LayerAction, LayerReach, ViaSlot, Way } from "./reach";

/** What a key does to the layer, as the verb of a label: "hold Space", "toggle (left outer thumb)" */
const VERBS: Record<LayerAction, string> = {
  "while held": "hold",
  toggle: "toggle",
  "switch to": "switch",
  "hold, or tap to toggle": "hold or toggle",
  "one-shot": "one-shot",
  default: "make default",
  "default (saved)": "make default for good",
  "while held, with modifiers": "hold",
};

/** The same, after a gesture: "double-tap Tab to toggle", "combo: J + K for a one-shot" */
const PURPOSES: Record<LayerAction, string> = {
  "while held": "",
  toggle: " to toggle",
  "switch to": " to switch",
  "hold, or tap to toggle": " to hold or toggle",
  "one-shot": " for a one-shot",
  default: " to make it default",
  "default (saved)": " to make it default for good",
  "while held, with modifiers": "",
};

/** How a tap dance slot is pressed: "double-tap Tab" */
const GESTURES: Record<SlotLabel, string> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "double-tap",
  "Tap, then hold": "tap then hold",
};

/** The same for a combo: "combo: J + K, double-tapped" */
const PARTICIPLES: Record<SlotLabel, string> = {
  Tap: "tapped",
  Hold: "held",
  "Double tap": "double-tapped",
  "Tap, then hold": "tapped then held",
};

const SLOT_FIELDS: Record<SlotLabel, keyof Pick<TapDance, "tap" | "hold" | "doubleTap" | "tapHold">> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "doubleTap",
  "Tap, then hold": "tapHold",
};

/** kinds whose tap label names the key: what it types, rather than what it does (MO 2, TD 0, M 1) */
const LABELLED = new Set<Described["kind"]>(["basic", "modifier", "mod-tap", "layer-tap", "mouse", "media", "lighting", "other"]);

export interface PhraseContext {
  model: Pick<KeyboardModel, "layers" | "tapDance">;
  names: Names;
  /** every placed key's position in words, by refId (positionNames) */
  positions: Map<string, string>;
}

/** What the key is called in a label: what it types when tapped ("Space" for LT1(KC_SPC), "Tab" for a tap dance that
 * taps Tab), or null when its label says nothing about it (MO 2, OSL 3, a tap dance tapping a layer key) */
export function tapName(d: Described, model: Pick<KeyboardModel, "tapDance">): string | null {
  if (d.kind === "tap-dance") {
    const tap = d.index != null ? model.tapDance[d.index]?.tap : undefined;
    return tap ? tapName(tap, model) : null;
  }
  return LABELLED.has(d.kind) && d.tap ? d.tap : null;
}

/** A combo's keycode as a label: what it types, with a short note of what holding it does ("Space (hold: Layer 1)",
 * "T (hold: Shift)"); layer keys by their keycode ("MO(5)", or "LM 1" for one that has no name); tap dance and macro
 * keys by their keycode ("TD(0)", "M1"); else what it types ("K", "Esc") */
export function memberName(d: Described, names: Names): string {
  switch (d.kind) {
    case "layer":
      return /^[A-Z]+\(\d+\)$/.test(d.code) ? d.code : d.tap;
    case "tap-dance":
    case "macro":
      return d.code;
    case "layer-tap":
      return `${d.tap || "nothing"} (hold: ${d.layer != null ? names.layer(d.layer) : d.hold ?? "a layer"})`;
    case "mod-tap":
      return `${d.tap || "nothing"} (hold: ${d.hold ?? "modifiers"})`;
    case "one-shot-mod":
      return `one-shot ${d.tap}`;
    default:
      return d.tap || d.code;
  }
}

/** "MO(5) + OSL(3)" */
export function comboName(members: { action: Described }[], names: Names): string {
  return members.map((m) => memberName(m.action, names)).join(" + ");
}

/** "Base", "Layer 1, Nav" */
function layerList(layers: number[], names: Names): string {
  return layers.map((l) => names.layer(l)).join(", ");
}

/** The layer key a way runs: the key's own, or the one in the tap dance slot it goes through */
function layerKeyOf(way: Way, ctx: PhraseContext): Described | undefined {
  const via = way.via;
  if (via.type === "default" || via.type === "tri-layer") return undefined;
  const slot: ViaSlot | null = via.slot;
  if (slot) return ctx.model.tapDance[slot.tapDance]?.[SLOT_FIELDS[slot.slot]];
  return via.type === "key" ? via.action : via.combo.output;
}

/** " with Shift" for LM, a layer held with modifiers */
function modifiers(way: Way, ctx: PhraseContext): string {
  const hold = way.action === "while held, with modifiers" ? layerKeyOf(way, ctx)?.hold : null;
  return hold ? ` with ${hold}` : "";
}

/** A way to reach a layer, as a short label that reads as an instruction:
 * - "default layer";
 * - keys: "hold Space", "one-shot (right outer thumb)", "toggle (left top row, 3rd from the outside)",
 *   "hold with Shift (left inner thumb)";
 * - tap dance slots: "hold Tab", "double-tap Tab to toggle", "tap for a one-shot (right inner thumb)";
 * - combos: "combo: MO(5) + OSL(3)", "combo: J + K, double-tapped to toggle";
 * - the tri-layer keys: "hold both Fn keys (left inner thumb and right inner thumb)".
 * A way that doesn't work on the base layer says where it starts: "switch from Layer 3 (right outer thumb)". */
export function wayLabel(way: Way, ctx: PhraseContext): string {
  const via = way.via;
  if (via.type === "default") return "default layer";
  const from = way.from.length > 0 && !way.from.includes(0) ? ` from ${layerList(way.from, ctx.names)}` : "";
  const mods = modifiers(way, ctx);
  if (via.type === "tri-layer") {
    const places = via.keys.map((k) => ctx.positions.get(refId(k.ref)) ?? "a key");
    return `hold both Fn keys${from} (${places.join(" and ")})`;
  }
  if (via.type === "combo") {
    const slot = via.slot ? `, ${PARTICIPLES[via.slot.slot]}` : "";
    return `combo: ${comboName(via.combo.members, ctx.names)}${slot}${PURPOSES[way.action]}${mods}${from}`;
  }
  const name = via.slot?.slot === "Tap" ? null : tapName(via.action, ctx.model);
  const place = ctx.positions.get(refId(via.ref)) ?? "a key";
  if (via.slot) {
    // "hold Tab", "tap then hold Tab": holding the slot is holding the layer; other gestures say what they do
    const held = via.slot.slot === "Hold" || via.slot.slot === "Tap, then hold";
    const purpose = PURPOSES[way.action] || (held ? "" : " and hold");
    const gesture = GESTURES[via.slot.slot];
    return name ? `${gesture} ${name}${purpose}${mods}${from}` : `${gesture}${purpose}${mods}${from} (${place})`;
  }
  const verb = VERBS[way.action];
  return name ? `${verb} ${name}${mods}${from}` : `${verb}${mods}${from} (${place})`;
}

/** Where a way works, for the Inspector: "from any layer", "from Base, Nav", "the layer the keyboard starts on"; the
 * tap dance slot it goes through; for a combo whose keycodes aren't on any key, that it can't fire */
export function wayDetail(way: Way, ctx: PhraseContext): string {
  const via = way.via;
  if (via.type === "default") return "the layer the keyboard starts on";
  const parts: string[] = [];
  if (via.type !== "tri-layer" && via.slot) parts.push(`tap dance ${via.slot.tapDance}, ${via.slot.slot.toLowerCase()}`);
  if (way.from.length === 0) {
    parts.push("can't fire: its keys aren't all on one layer");
  } else {
    // a way never works on the layer it reaches: every other layer is all of them
    const anywhere = way.from.length === ctx.model.layers.length - 1;
    parts.push(anywhere ? "from any layer" : `from ${layerList(way.from, ctx.names)}`);
  }
  return parts.join(" · ");
}

/** Why a layer can't be reached, or null when it can */
export function unreachedReason(reach: LayerReach): string | null {
  if (reach.reachable) return null;
  return reach.ways.length === 0 ? "Nothing reaches this layer" : "Only reached from layers that nothing reaches";
}

/** A combo a key is part of, from that key's side: "with OSL(3) → Layer 2, while held",
 * "with Space (hold: Layer 1) → Layer 2, while held", "with Y → Esc" */
export function comboUseLabel(use: ComboUse, names: Names): string {
  const partners = use.partners.length > 0 ? `with ${comboName(use.partners, names)}` : "on its own";
  return `${partners} → ${actionSummary(use.combo.output, names).tap}`;
}

/** The partners of a combo that aren't on any key of the layer, or null: "Y isn't on this layer" */
export function missingPartners(use: ComboUse, names: Names): string | null {
  const missing = use.partners.filter((p) => p.keys.length === 0).map((p) => memberName(p.action, names));
  if (missing.length === 0) return null;
  return `${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} on this layer`;
}
```

- [ ] **Step 4: Run it to see it pass, then type-check**

```bash
cd web && npx vitest run src/analysis/phrases.test.ts
```

Expected: `Tests  17 passed (17)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/analysis/phrases.test.ts \
  web/src/analysis/phrases.ts
git commit -m "feat(web): the analysis in words: how layers are reached, combo partners"
```

### Task 8: Find a character or key

The owner's request: type "ą", "@", "Esc" or "MO(2)" and see everywhere the keymap produces it.

**Matching** (`matchOf`): a keycode matches by:
- its main legend or tap label ("tap");
- its Shift legend ("shift");
- its AltGr legend ("altgr");
- its name ("name"): the picker's search index through the new `codesNamed` in `picker/search.ts` (the name, an alias, or the name without `KC_`), plus the keycode itself ("MO(2)").

Legends come from the server in the chosen keyboard language, so with the Polish language "ą" is found as AltGr + A. Empty and transparent keys never match.

**Where it looks** (`findOnKeymap`):
- keys on every layer, as drawn;
- tap dance slots;
- combo outputs;
- enabled key overrides' replacements;
- macros: their text, matched as typed with case, and the keys they press.

Each result that isn't a key names the key that runs it, if any. `foundKeys` gives the keys to highlight on each layer. `foundLabel` (added to `phrases.ts`) puts each result in words:
- "Shift + 2 on Layer 3 (left home row, 3rd from the outside)"
- "tap dance 1, tap: Esc"
- "combo K + Y → Esc"
- "key override 0: Del instead of Bksp"
- "macro 0 types "git status""

**Files:**
- Create: `web/src/analysis/find.ts`
- Modify: `web/src/picker/search.ts`, `web/src/analysis/phrases.ts`
- Test: `web/src/picker/search.test.ts`, `web/src/analysis/find.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/picker/search.test.ts`:

```diff
diff --git a/web/src/picker/search.test.ts b/web/src/picker/search.test.ts
--- a/web/src/picker/search.test.ts
+++ b/web/src/picker/search.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
-import { searchKeycodes, searchTemplates } from "./search";
+import { codesNamed, searchKeycodes, searchTemplates, searchText } from "./search";
 
 function k(code: string, tap: string, aliases: string[] = [], description: string | null = null,
   shifted: string | null = null, kind: CatalogueKeycode["kind"] = "basic"): CatalogueKeycode {
@@ -168,3 +168,23 @@ describe("searchTemplates", () => {
     expect(found("alt")).toEqual([]);
   });
 });
+
+describe("codesNamed", () => {
+  it("finds the keycodes a name or alias names exactly, with or without KC_", () => {
+    expect([...codesNamed(categories, "esc")]).toEqual(["KC_ESCAPE"]);
+    expect([...codesNamed(categories, " KC_Caps ")]).toEqual(["KC_CAPSLOCK"]);
+    expect([...codesNamed(categories, "kc_gesc")]).toEqual(["KC_GESC"]);
+  });
+
+  it("doesn't match labels or parts of names", () => {
+    expect([...codesNamed(categories, "Caps Lock")]).toEqual([]);
+    expect([...codesNamed(categories, "es")]).toEqual([]);
+    expect([...codesNamed(categories, "")]).toEqual([]);
+  });
+});
+
+describe("searchText", () => {
+  it("folds case and spaces", () => {
+    expect(searchText("  Caps   LOCK ")).toBe("caps lock");
+  });
+});
```

Create `web/src/analysis/find.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, Described, KeyboardModel, KeycodeCategory } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { codesOn, combosOf } from "./combos";
import { findOnKeymap, foundKeys, matchOf, queryOf, type Found } from "./find";
import { foundLabel, howText } from "./phrases";
import { positionNames } from "./positions";
import { AT, corne, described, layer, type Setup } from "./testing";
import { usageOf } from "./usage";

/** A key whose legend shows a character with Shift and one with AltGr, as the server describes it in a language */
function withLegend(code: string, main: string, shifted: string | null, altGr: string | null = null): Described {
  return { ...described(code), tap: main, legend: { main, shifted, altGr } };
}

const catalogue: KeycodeCategory[] = [{
  name: "Basic", templates: [], keycodes: [
    { ...described("KC_ESCAPE"), tap: "Esc", legend: { main: "Esc" }, aliases: ["KC_ESC"] } as CatalogueKeycode,
    { ...described("KC_2"), tap: "2", legend: { main: "2", shifted: "@" }, aliases: [] } as CatalogueKeycode,
  ],
}];

function find(model: KeyboardModel, text: string) {
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const found = findOnKeymap(model, placement, queryOf(text, catalogue), combos, usageOf(model, placement),
    codesOn(model, placement, 0));
  const ctx = { model, names: namesOf(model), positions: positionNames(placement) };
  return { found, labels: found.map((f) => foundLabel(f, ctx)) };
}

/** A Corne whose base layer has 2 (Shift: @) in the top row, and the keys given */
function keyboard(setup: Partial<Setup> = {}, base: Record<number, Described> = {}): KeyboardModel {
  const model = corne({ layers: [layer({}, "KC_NO"), layer({}), layer({}, "KC_NO")], ...setup });
  model.layers[0].keys[AT.grid(0, 1)] = withLegend("KC_2", "2", "@");
  for (const [index, d] of Object.entries(base)) model.layers[0].keys[Number(index)] = d;
  return model;
}

describe("matchOf", () => {
  const q = (text: string) => queryOf(text, catalogue);

  it("matches what a key types, with Shift, and with AltGr", () => {
    const two = withLegend("KC_2", "2", "@");
    expect(matchOf(two, q("2"))).toBe("tap");
    expect(matchOf(two, q("@"))).toBe("shift");
    // Polish: A types ą with AltGr
    const a = withLegend("KC_A", "A", null, "ą");
    expect(matchOf(a, q("ą"))).toBe("altgr");
    expect(matchOf(a, q("a"))).toBe("tap");
    expect(matchOf(a, q("@"))).toBeNull();
  });

  it("matches a key by its name or alias, and a layer key by its keycode", () => {
    const esc = { ...described("KC_ESCAPE"), tap: "Esc", legend: { main: "Esc" } };
    expect(matchOf(esc, q("esc"))).toBe("tap");
    expect(matchOf(esc, q("KC_ESC"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("MO(2)"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("mo(2)"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("MO(3)"))).toBeNull();
  });

  it("never matches empty or transparent keys, or an empty query", () => {
    expect(matchOf(described("KC_NO"), q(""))).toBeNull();
    expect(matchOf(described("KC_TRNS"), q("▽"))).toBeNull();
    expect(matchOf(withLegend("KC_2", "2", "@"), q("   "))).toBeNull();
  });
});

describe("findOnKeymap", () => {
  it("finds @ as Shift + 2 and as its own key on every layer", () => {
    const model = keyboard({}, { [AT.grid(1, 5)]: withLegend("KC_AT", "@", null) });
    model.layers[2].keys[AT.rightInnerThumb] = withLegend("LSFT(KC_2)", "@", null);
    const { found, labels } = find(model, "@");
    expect(labels).toEqual([
      "Shift + 2 on Base (left top row, 2nd from the outside)",
      "@ on Base (left home row, 6th from the outside)",
      "@ on Layer 2 (right inner thumb)",
    ]);
    expect(found.map((f) => f.type)).toEqual(["key", "key", "key"]);
  });

  it("finds ą as AltGr + A with the Polish keyboard language", () => {
    const model = keyboard({}, { [AT.grid(1, 1)]: withLegend("KC_A", "A", null, "ą") });
    expect(find(model, "ą").labels).toEqual(["AltGr + A on Base (left home row, 2nd from the outside)"]);
  });

  it("finds it in tap dance slots, combo outputs, key overrides and macros", () => {
    const model = keyboard({
      tapDances: [["KC_A", "KC_NO", "KC_ESC", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "KC_ESC" }],
      keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_ESC" }],
      macros: [0, 1],
    }, {
      [AT.leftOuterThumb]: described("TD(0)"), 0: described("KC_J"), 1: described("KC_K"),
      [AT.grid(0, 11)]: described("KC_BSPC"), [AT.rightOuterThumb]: described("M1"),
    });
    model.macros.items[0].actions = [{ type: "text", text: "Hello, Esc", keys: [] }];
    model.macros.items[1].actions = [{ type: "tap", keys: [described("KC_ESC")] }];
    const { found, labels } = find(model, "Esc");
    expect(labels).toEqual([
      "tap dance 0, double tap: Esc",
      "combo J + K → Esc",
      "key override 0: Esc instead of BSPC",
      "macro 0 types \"Hello, Esc\"",
      "macro 1 presses Esc",
    ]);
    // each says which key runs it, when one does
    const keys = found.map((f) => (f.type === "key" ? null : f.key && `${f.key.layer}:${f.key.ref.index}`));
    expect(keys).toEqual([`0:${AT.leftOuterThumb}`, "0:0", `0:${AT.grid(0, 11)}`, null, `0:${AT.rightOuterThumb}`]);
  });

  it("matches macro text as typed, with case", () => {
    const model = keyboard({ macros: [1] });
    model.macros.items[0].actions = [{ type: "text", text: "git status", keys: [] }];
    expect(find(model, "g").labels).toEqual(["macro 0 types \"git status\""]);
    expect(find(model, "G").labels).toEqual([]);
  });

  it("leaves out disabled key overrides", () => {
    const model = keyboard({ keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_ESC" }] });
    model.keyOverrides[0].enabled = false;
    expect(find(model, "esc").found).toEqual([]);
  });

  it("finds a layer key by its keycode", () => {
    const model = keyboard({}, { [AT.leftInnerThumb]: described("MO(2)") });
    expect(find(model, "MO(2)").labels).toEqual(["MO 2 on Base (left inner thumb)"]);
  });

  it("finds nothing for a character that is nowhere, or no text", () => {
    expect(find(keyboard(), "ż").found).toEqual([]);
    expect(find(keyboard(), "").found).toEqual([]);
  });
});

describe("foundKeys", () => {
  it("are the keys found, and those that run what was found, by layer", () => {
    const found: Found[] = [
      { type: "key", layer: 1, ref: { kind: "key", index: 3 }, how: "tap", action: described("KC_A") },
      { type: "tap-dance", tapDance: 0, slot: "Tap", how: "tap", action: described("KC_A"), key: { layer: 0, ref: { kind: "key", index: 7 } } },
      { type: "macro", macro: 0, how: "text", text: "a", action: null, key: null },
    ];
    expect(foundKeys(found, 2).map((keys) => [...keys])).toEqual([["key:7"], ["key:3"]]);
  });
});

describe("howText", () => {
  it("says which key to press, and with which modifier", () => {
    const two = withLegend("KC_2", "2", "@");
    expect([howText("tap", two), howText("shift", two), howText("altgr", two), howText("name", described("MO(2)"))])
      .toEqual(["2", "Shift + 2", "AltGr + 2", "MO 2"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/picker/search.test.ts src/analysis/find.test.ts
```

Expected: `Test Files  2 failed (2)` and `Tests  3 failed | 20 passed (23)`.

The 3 new search tests fail (`codesNamed` and `searchText` aren't functions yet), and `find.test.ts` can't import `./find`.

- [ ] **Step 3: Names in the picker's search index**

Apply to `web/src/picker/search.ts`:

```diff
diff --git a/web/src/picker/search.ts b/web/src/picker/search.ts
--- a/web/src/picker/search.ts
+++ b/web/src/picker/search.ts
@@ -102,6 +102,22 @@ export function searchKeycodes(categories: KeycodeCategory[], query: string): Ca
   return found.sort((a, b) => a.rank - b.rank || a.kind - b.kind || a.order - b.order).map((f) => f.k);
 }
 
+/** The keycodes the query names exactly: by their name, an alias, or either without KC_ ("esc", "KC_ESC", "caps") */
+export function codesNamed(categories: KeycodeCategory[], query: string): Set<string> {
+  const q = normalize(query);
+  const found = new Set<string>();
+  if (!q) return found;
+  for (const e of indexOf(categories)) {
+    if (e.names.includes(q) || e.bare.includes(q)) found.add(e.k.code);
+  }
+  return found;
+}
+
+/** A search text as searches compare it: case folded, spaces trimmed and collapsed */
+export function searchText(query: string): string {
+  return normalize(query);
+}
+
 /** Kinds of template, by the words that name them (without spaces or dashes) */
 const TEMPLATE_KINDS: { words: string[]; matches: (template: string) => boolean }[] = [
   { words: ["mt", "modtap"], matches: (t) => /_T\(kc\)$/.test(t) },
```

- [ ] **Step 4: Finding**

Create `web/src/analysis/find.ts`:

```ts
// Finding a character or key: everywhere the keymap produces it. "@" is Shift + 2 on a US keyboard, its own key
// (KC_AT), or a combo's output; "ą" is AltGr + A with the Polish keyboard language. The legends come from the server
// in the chosen keyboard language, so what a key types follows it.
import type { Described, KeyboardModel, KeycodeCategory } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { actionAt, refId, type KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
import { codesNamed, searchText } from "../picker/search";
import type { ComboInfo } from "./combos";
import type { Usage } from "./usage";

/** How a keycode produces what was searched for: tapped, with Shift, with AltGr, or by its name ("Esc", "MO(2)") */
export type How = "tap" | "shift" | "altgr" | "name";

export interface Match {
  how: How;
  action: Described;
}

/** A key on a layer */
export interface Place {
  layer: number;
  ref: KeyRef;
}

export type Found =
  | ({ type: "key" } & Place & Match)
  | ({ type: "tap-dance"; tapDance: number; slot: SlotLabel; key: Place | null } & Match)
  | ({ type: "combo"; combo: ComboInfo; key: Place | null } & Match)
  | ({ type: "key-override"; keyOverride: number; trigger: Described; key: Place | null } & Match)
  | { type: "macro"; macro: number; how: How | "text"; text: string | null; action: Described | null; key: Place | null };

/** What the search compares a keycode with, folded once per search */
export interface Query {
  /** folded: case and spaces don't count */
  text: string;
  /** as typed, less the spaces around it: macro text is matched with case */
  raw: string;
  /** keycodes the text names (by name or alias, from the keycode catalogue) */
  named: Set<string>;
}

export function queryOf(text: string, catalogue: KeycodeCategory[]): Query {
  return { text: searchText(text), raw: text.normalize("NFC").trim(), named: codesNamed(catalogue, text) };
}

/** How a keycode produces the query, or null: its legend (what it types, with Shift, with AltGr in the chosen
 * keyboard language), or its name. Empty and transparent keys produce nothing. */
export function matchOf(d: Described, query: Query): How | null {
  if (!query.text || d.kind === "none" || d.kind === "transparent") return null;
  const same = (text: string | null | undefined) => !!text && searchText(text) === query.text;
  if (same(d.legend.main) || same(d.tap)) return "tap";
  if (same(d.legend.shifted)) return "shift";
  if (same(d.legend.altGr)) return "altgr";
  if (query.named.has(d.code) || searchText(d.code) === query.text) return "name";
  return null;
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverrides" | "macros">;

/** The first key (on the keyboard as drawn) that runs a tap dance or macro, from its usage */
function firstKey(uses: Usage["tapDances"][number] | undefined): Place | null {
  const use = uses?.find((u) => u.type === "key");
  return use?.type === "key" ? { layer: use.layer, ref: use.ref } : null;
}

/** The first base-layer key with a keycode */
function baseKey(codes: Map<string, KeyRef[]> | undefined, code: string): Place | null {
  const ref = codes?.get(code)?.[0];
  return ref ? { layer: 0, ref } : null;
}

/** Everywhere the keymap produces what the query is: keys on every layer (the keyboard as drawn), tap dance slots,
 * combo outputs, key override replacements, and macros (their text, and the keys they tap). Results that aren't on a
 * key say which key runs them, when one does (`key`), so they can be shown. */
export function findOnKeymap(
  model: Model,
  placement: Placement,
  query: Query,
  combos: ComboInfo[],
  usage: Usage,
  baseCodes: Map<string, KeyRef[]> | undefined,
): Found[] {
  if (!query.text) return [];
  const found: Found[] = [];
  model.layers.forEach((_, layer) => {
    for (const item of placement.items) {
      const ref = { kind: item.kind, index: item.index };
      const action = actionAt(model, layer, ref);
      const how = action ? matchOf(action, query) : null;
      if (action && how) found.push({ type: "key", layer, ref, how, action });
    }
  });
  for (const td of model.tapDance) {
    for (const { label, action } of tapDanceSlots(td)) {
      const how = matchOf(action, query);
      if (how) {
        found.push({ type: "tap-dance", tapDance: td.index, slot: label, how, action, key: firstKey(usage.tapDances[td.index]) });
      }
    }
  }
  for (const combo of combos) {
    const how = matchOf(combo.output, query);
    const member = combo.members.find((m) => m.keys.length > 0);
    const key = member ? { layer: 0, ref: member.keys[0] } : null;
    if (how) found.push({ type: "combo", combo, how, action: combo.output, key });
  }
  for (const o of model.keyOverrides) {
    const how = o.enabled ? matchOf(o.replacement, query) : null;
    if (how) {
      found.push({
        type: "key-override", keyOverride: o.index, trigger: o.trigger, how, action: o.replacement,
        key: baseKey(baseCodes, o.trigger.code),
      });
    }
  }
  for (const macro of model.macros.items) {
    const key = firstKey(usage.macros[macro.index]);
    const text = macro.actions.find((a) => a.type === "text" && a.text?.normalize("NFC").includes(query.raw));
    if (text) {
      found.push({ type: "macro", macro: macro.index, how: "text", text: text.text ?? null, action: null, key });
      continue;
    }
    for (const step of macro.actions) {
      const hit = step.type === "tap" || step.type === "down" ? step.keys.find((k) => matchOf(k, query)) : undefined;
      if (hit) {
        found.push({ type: "macro", macro: macro.index, how: matchOf(hit, query) ?? "tap", text: null, action: hit, key });
        break;
      }
    }
  }
  return found;
}

/** The keys to highlight on each layer: those that produce it, and those that run a tap dance, combo, key override
 * or macro that does */
export function foundKeys(found: Found[], layers: number): Set<string>[] {
  const keys = Array.from({ length: layers }, () => new Set<string>());
  for (const f of found) {
    const place = f.type === "key" ? f : f.key;
    if (place) keys[place.layer]?.add(refId(place.ref));
  }
  return keys;
}
```

- [ ] **Step 5: The find results in words**

Apply to `web/src/analysis/phrases.ts`:

```diff
diff --git a/web/src/analysis/phrases.ts b/web/src/analysis/phrases.ts
--- a/web/src/analysis/phrases.ts
+++ b/web/src/analysis/phrases.ts
@@ -5,6 +5,7 @@ import { actionSummary, type Names } from "../keyboard/labels";
 import { refId } from "../keyboard/refs";
 import type { SlotLabel } from "../keymap/tapdance";
 import type { ComboUse } from "./combos";
+import type { Found, How } from "./find";
 import type { LayerAction, LayerReach, ViaSlot, Way } from "./reach";
 
 /** What a key does to the layer, as the verb of a label: "hold Space", "toggle (left outer thumb)" */
@@ -190,3 +191,31 @@ export function missingPartners(use: ComboUse, names: Names): string | null {
   if (missing.length === 0) return null;
   return `${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} on this layer`;
 }
+
+/** What a keycode is pressed as to produce what was found: "2" (tapped, or by its name), "Shift + 2", "AltGr + A" */
+export function howText(how: How, d: Described): string {
+  const key = d.legend.main || d.tap || d.code;
+  return how === "shift" ? `Shift + ${key}` : how === "altgr" ? `AltGr + ${key}` : key;
+}
+
+/** A place a character or key was found, in words: "Shift + 2 on Base (left top row, 2nd from the outside)",
+ * "tap dance 0, double tap: Caps Lock", "combo M + C → Enter", "key override 0: Del instead of Bksp",
+ * "macro 0 types "git status"" */
+export function foundLabel(found: Found, ctx: PhraseContext): string {
+  switch (found.type) {
+    case "key": {
+      const place = ctx.positions.get(refId(found.ref)) ?? "a key";
+      return `${howText(found.how, found.action)} on ${ctx.names.layer(found.layer)} (${place})`;
+    }
+    case "tap-dance":
+      return `tap dance ${found.tapDance}, ${found.slot.toLowerCase()}: ${howText(found.how, found.action)}`;
+    case "combo":
+      return `combo ${comboName(found.combo.members, ctx.names)} → ${howText(found.how, found.action)}`;
+    case "key-override":
+      return `key override ${found.keyOverride}: ${howText(found.how, found.action)} instead of ${
+        found.trigger.tap || found.trigger.code}`;
+    case "macro":
+      if (found.how === "text" || !found.action) return `macro ${found.macro} types "${found.text ?? ""}"`;
+      return `macro ${found.macro} presses ${howText(found.how, found.action)}`;
+  }
+}
```

- [ ] **Step 6: Run the tests to see them pass, then every unit test, then type-check**

```bash
cd web && npx vitest run src/picker/search.test.ts src/analysis/find.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  35 passed (35)`.

```bash
cd web && npm test && npm run check
```

Expected: `Test Files  22 passed (22)` and `Tests  312 passed (312)` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add web/src/analysis/find.test.ts \
  web/src/analysis/find.ts \
  web/src/analysis/phrases.ts \
  web/src/picker/search.test.ts \
  web/src/picker/search.ts
git commit -m "feat(web): find a character or key on the keymap (analysis)"
```

### Task 9: Readable labels on small keys

The Overview draws every layer at about 31 px per key, showing only each key's main legend. `legendSizes` keeps longer words smaller so a full-size keyboard reads evenly. On a small key that wastes space, so `compactLegendSize` fills the key instead:
- **Size:** as large as fits, at most 0.42 of the key and at least 7 px.
- **Fit:** the longest word fits across the key, and the lines fit its height.
- **Line breaks:** it stays on one line when that is nearly as large ("MO 5", "Ctrl+Z").

Text is measured with the injected `TextWidth`, as for `legendSizes`. `Key.svelte` passes the browser measurement (`legendFont.width`); Vitest falls back to `estimatedWidth`. The function shrinks the size until the longest part fits at the size it is drawn at, using the same `shrinking` helper as `legendSizes`.

**Files:**
- Modify: `web/src/keyboard/labels.ts`
- Test: `web/src/keyboard/labels.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply to `web/src/keyboard/labels.test.ts`:

```diff
diff --git a/web/src/keyboard/labels.test.ts b/web/src/keyboard/labels.test.ts
--- a/web/src/keyboard/labels.test.ts
+++ b/web/src/keyboard/labels.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, it } from "vitest";
 import type { Described, KeyboardModel } from "../api/types";
 import {
-  actionSummary, HOLD_MAX_LINES, holdLines, holdSize, keyFace, keyLabel, keyTitle, legendScale, legendSizes, legendWords, MAIN_LINE, mainLines,
+  actionSummary, compactLegendSize, HOLD_MAX_LINES, holdLines, holdSize, keyFace, keyLabel, keyTitle, legendScale, legendSizes, legendWords, MAIN_LINE, mainLines,
   namesOf, toneOf, estimatedWidth, type Names, type TextWidth,
 } from "./labels";
 
@@ -484,3 +484,52 @@ describe("a text width that depends on the size", () => {
     expect(holdLines("git status", size, 40, hinted)).toBeLessThanOrEqual(2);
   });
 });
+
+describe("compactLegendSize", () => {
+  // a key of 31 px: about 25.7 px inside
+  const inside = 25.7;
+  /** a font as wide as Verdana: 0.7 of the font size per character */
+  const wide = (text: string) => [...text].length * 0.7;
+
+  it("fills a small key: longer words are only as small as the width needs", () => {
+    expect(compactLegendSize("LCtrl", inside, inside, 31)).toBeCloseTo(inside / estimatedWidth("LCtrl", 10));
+    const space = { main: "Space", shifted: null, altGr: null, hold: null, tone: "normal" as const };
+    expect(compactLegendSize("Space", inside, inside, 31)).toBeGreaterThan(legendSizes(space, inside, inside, 31).main);
+    // short ones stop at the largest size
+    expect(compactLegendSize("Up", inside, inside, 31)).toBeCloseTo(0.42 * 31);
+  });
+
+  it("measures the text with the width it is given", () => {
+    const px = compactLegendSize("Home", inside, inside, 31, wide);
+    expect(px).toBeCloseTo(inside / wide("Home"));
+    expect(px).toBeLessThan(compactLegendSize("Home", inside, inside, 31));
+  });
+
+  it("shrinks until its longest part fits at the size it gets, for a font measured per size", () => {
+    /** each character 0.55 of the font size rounded up to whole pixels: small text is wider than scaled down */
+    const hinted: TextWidth = (text, px) => ([...text].length * Math.ceil(0.55 * px)) / px;
+    const px = compactLegendSize("LShift", inside, inside, 31, hinted);
+    expect(px * hinted("LShift", px)).toBeLessThanOrEqual(inside + 1e-9);
+  });
+
+  it("is at most 0.42 of the key, for one character", () => {
+    expect(compactLegendSize("A", inside, inside, 31)).toBeCloseTo(0.42 * 31);
+    expect(compactLegendSize("", inside, inside, 31)).toBeCloseTo(0.42 * 31);
+  });
+
+  it("fits the lines of a legend that wraps into the height", () => {
+    const px = compactLegendSize("Page Up", inside, inside, 31);
+    expect(px * MAIN_LINE * mainLines("Page Up", px, inside)).toBeLessThanOrEqual(inside);
+    expect(px).toBeGreaterThan(9);
+  });
+
+  it("keeps a legend on one line when that is nearly as large", () => {
+    const px = compactLegendSize("MO 5", inside, inside, 31);
+    expect(px).toBeCloseTo(inside / estimatedWidth("MO 5", px));
+    expect(mainLines("MO 5", px, inside)).toBe(1);
+  });
+
+  it("never goes below 7 px", () => {
+    expect(compactLegendSize("Bootloader", 12, 12, 14)).toBe(7);
+  });
+});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd web && npx vitest run src/keyboard/labels.test.ts
```

Expected: `compactLegendSize is not a function` and `Tests  7 failed | 81 passed (88)`. The 7 new tests fail.

- [ ] **Step 3: Implement it**

Apply to `web/src/keyboard/labels.ts`:

```diff
diff --git a/web/src/keyboard/labels.ts b/web/src/keyboard/labels.ts
--- a/web/src/keyboard/labels.ts
+++ b/web/src/keyboard/labels.ts
@@ -355,3 +355,37 @@ export function legendSizes(
   if (height(main) > free()) main = fitting();
   return { main: Math.max(MAIN_MIN_PX, main), shifted, hold, holdLines: nameLines };
 }
+
+/** the largest compact legend, in key units */
+const COMPACT_MAX = 0.42;
+/** a compact legend stays on one line if that keeps at least this share of the size it would have on several */
+const COMPACT_ONE_LINE = 0.75;
+
+/** Font size, in pixels, of the only legend of a key on a small keyboard (the Overview's): as large as fits widthPx
+ * by heightPx, its longest part across the key and its lines in the height, at most COMPACT_MAX of the key, at least
+ * 7 px, and on one line when that is nearly as large. Unlike legendSizes, which keeps longer words smaller so a
+ * full-size keyboard reads evenly, it fills the key: small keys need every pixel ("LCtrl", "Space", "Enter"). Text is
+ * measured as for legendSizes (textWidth), and estimated where nothing can be measured. */
+export function compactLegendSize(
+  main: string, widthPx: number, heightPx: number, u: number, textWidth = estimatedWidth,
+): number {
+  const width = Math.max(0, widthPx);
+  const most = COMPACT_MAX * u;
+  const words = legendWords(main);
+  if (words.length === 0) return Math.max(MAIN_MIN_PX, most);
+  const longest = (px: number) => Math.max(0, ...words.map((w) => textWidth(w, px)));
+  // its longest part across the key
+  let px = shrinking(Math.min(most, width / Math.max(longest(most), 1e-9)), MAIN_MIN_PX,
+    (size) => longest(size) * size <= width + 1e-9);
+  // wrapped onto more lines than fit: smaller, until it fits or can't wrap any less
+  for (let lines = mainLines(main, px, width, textWidth); px * MAIN_LINE * lines > heightPx && px > MAIN_MIN_PX;) {
+    px = Math.max(MAIN_MIN_PX, Math.min(px - 0.5, heightPx / (MAIN_LINE * lines)));
+    lines = mainLines(main, px, width, textWidth);
+  }
+  // on one line when that is nearly as large: "MO 5" and "Ctrl+Z" read better unbroken
+  const whole = (size: number) => textWidth(main, size) * size;
+  const oneLine = shrinking(Math.min(most, width / Math.max(textWidth(main, most), 1e-9), heightPx / MAIN_LINE),
+    MAIN_MIN_PX, (size) => whole(size) <= width + 1e-9);
+  const single = oneLine >= COMPACT_ONE_LINE * px && whole(oneLine) <= width + 1e-9;
+  return Math.max(MAIN_MIN_PX, single ? oneLine : px);
+}
```

- [ ] **Step 4: Run them to see them pass, then type-check**

```bash
cd web && npx vitest run src/keyboard/labels.test.ts
```

Expected: `Tests  88 passed (88)`.

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add web/src/keyboard/labels.test.ts \
  web/src/keyboard/labels.ts
git commit -m "feat(web): compactLegendSize, readable labels for small keys"
```

### Task 10: The keyboard drawing: combo underline, find highlight, small keys, pictures

`Keyboard`, `Key` and `Encoder` gain optional props, so the phase 2 Edit view keeps working unchanged until Task 14 passes them:
- `combos` (aligned with `placement.items`): a red underline (`--combo`) inside the bottom of the key.
- `highlights`: keys that produce what the find box looks for get a `--find` outline and glow. Encoders too.
- `compact`: each key shows only its main legend, sized by `compactLegendSize`, with less padding.
- `interactive={false}`: plain divs instead of buttons, and the whole drawing hidden from screen readers. An Overview card is one button, and a button can't contain other buttons.

Every `data-ref` and `{#each}` key uses `refId`. `app.css` gets the two colours, light and dark. The colour legend gets a "part of a combo" entry.

There are no unit tests for components. svelte-check and the build verify this task; the e2e tests in Tasks 14–16 cover the drawing.

**Files:**
- Modify: `web/src/app.css`, `web/src/keyboard/Key.svelte`, `web/src/keyboard/Encoder.svelte`, `web/src/keyboard/Keyboard.svelte`, `web/src/keymap/KindLegend.svelte`

- [ ] **Step 1: The colours**

Apply to `web/src/app.css`:

```diff
diff --git a/web/src/app.css b/web/src/app.css
--- a/web/src/app.css
+++ b/web/src/app.css
@@ -33,6 +33,10 @@
   --tone-layer: #1872e8;
   --tone-tap-dance: #9a43cf;
   --tone-macro: #e07f00;
+  /* the underline of a key that is part of a combo */
+  --combo: #e8264a;
+  /* keys that produce what the find box looks for */
+  --find: #e0a100;
   /* how much of a kind's colour goes into a key's face and outline */
   --tone-fill: 15%;
   --tone-line: 62%;
@@ -82,6 +86,8 @@
   --tone-layer: #5ba2ff;
   --tone-tap-dance: #c98af2;
   --tone-macro: #ffaa3d;
+  --combo: #ff5577;
+  --find: #ffcc33;
   --tone-fill: 22%;
   --tone-line: 70%;
   --tone-text: 80%;
@@ -122,6 +128,8 @@
     --tone-layer: #5ba2ff;
     --tone-tap-dance: #c98af2;
     --tone-macro: #ffaa3d;
+    --combo: #ff5577;
+    --find: #ffcc33;
     --tone-fill: 22%;
     --tone-line: 70%;
     --tone-text: 80%;
```

- [ ] **Step 2: Keys**

Apply to `web/src/keyboard/Key.svelte`:

```diff
diff --git a/web/src/keyboard/Key.svelte b/web/src/keyboard/Key.svelte
--- a/web/src/keyboard/Key.svelte
+++ b/web/src/keyboard/Key.svelte
@@ -1,6 +1,7 @@
 <script lang="ts">
   import type { PlacedKey } from "./geometry";
-  import { legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
+  import { compactLegendSize, legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
+  import { refId } from "./refs";
   import { legendFont } from "./textWidth.svelte";
 
   interface Props {
@@ -13,14 +14,25 @@
     label: string;
     /** reaches the key with Tab (the selected one, or the first) */
     focusable: boolean;
+    /** part of a combo: underlined */
+    combo?: boolean;
+    /** produces what the find box looks for: highlighted */
+    found?: boolean;
+    /** a key to click; otherwise only a picture (the keyboard as a whole is labelled) */
+    interactive?: boolean;
+    /** a small key showing its main legend only, as large as it fits */
+    compact?: boolean;
     onselect: () => void;
   }
 
-  let { item, face, u, selected, label, focusable, onselect }: Props = $props();
+  let {
+    item, face, u, selected, label, focusable, combo = false, found = false, interactive = true, compact = false, onselect,
+  }: Props = $props();
 
   const GAP = 0.09;
   /** space around the labels, in key units */
   const PAD = 0.04;
+  const COMPACT_PAD = 0.015;
   const ROUND = 0.12;
 
   // the button covers both rectangles; everything inside is relative to its top-left corner
@@ -40,9 +52,15 @@
   });
 
   // the legends fit inside the primary rectangle, less the gap between keys and the padding
-  const sizes = $derived(
-    legendSizes(face, (item.w - GAP - 2 * PAD) * u, (item.h - GAP - 2 * PAD) * u, u, legendFont.width),
-  );
+  // a small key keeps less space around its only legend
+  const pad = $derived(compact ? COMPACT_PAD : PAD);
+  const sizes = $derived.by(() => {
+    const width = (item.w - GAP - 2 * pad) * u;
+    const height = (item.h - GAP - 2 * pad) * u;
+    return compact
+      ? { main: compactLegendSize(face.main, width, height, u, legendFont.width), shifted: 0, hold: 0, holdLines: 0 }
+      : legendSizes(face, width, height, u, legendFont.width);
+  });
 
   const style = $derived(
     [
@@ -60,24 +78,22 @@
     ].filter(Boolean).join("; "),
   );
 
+  // a line along the bottom of the primary rectangle, inside its outline
+  const underline = $derived.by(() => {
+    const r = rects[0];
+    const thickness = Math.max(2, u * 0.07);
+    const inset = Math.max(2, u * 0.12);
+    const bottom = r.y + r.h - Math.max(1.5, u * 0.05);
+    return { x: r.x + inset, y: bottom - thickness, w: Math.max(0, r.w - 2 * inset), h: thickness };
+  });
+
   const legendStyle = $derived(
-    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h}px`,
+    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h}px; ` +
+      `padding: ${pad * u}px`,
   );
 </script>
 
-<button
-  type="button"
-  class="key tone-{face.tone}" data-tone={face.tone}
-  class:selected
-  class:notched={item.hasSecond}
-  {style}
-  aria-label={label}
-  title={label}
-  aria-pressed={selected}
-  tabindex={focusable ? 0 : -1}
-  data-ref="{item.kind}:{item.index}"
-  onclick={onselect}
->
+{#snippet cap()}
   <svg class="cap" width={box.width * u} height={box.height * u} aria-hidden="true">
     <!-- outlines first, then the fills over them: two rectangles read as one key (ISO Enter) -->
     {#each rects as r, i (i)}
@@ -86,6 +102,10 @@
     {#each rects as r, i (i)}
       <rect class="face" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
     {/each}
+    {#if combo}
+      <rect class="combo-mark" x={underline.x} y={underline.y} width={underline.w} height={underline.h}
+        rx={underline.h / 2} />
+    {/if}
   </svg>
   <span class="legend" style={legendStyle}>
     {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
@@ -94,7 +114,31 @@
     <span class="tap">{#each face.main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
     {#if face.hold}<span class="hold">{face.hold}</span>{/if}
   </span>
-</button>
+{/snippet}
+
+{#if interactive}
+  <button
+    type="button"
+    class="key tone-{face.tone}" data-tone={face.tone}
+    class:selected
+    class:notched={item.hasSecond}
+    class:combo
+    class:found
+    {style}
+    aria-label={label}
+    title={label}
+    aria-pressed={selected}
+    tabindex={focusable ? 0 : -1}
+    data-ref={refId(item)}
+    onclick={onselect}
+  >
+    {@render cap()}
+  </button>
+{:else}
+  <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found {style}>
+    {@render cap()}
+  </div>
+{/if}
 
 <style>
   .key {
@@ -147,10 +191,28 @@
     fill: color-mix(in srgb, var(--key-bg) 55%, var(--board-bg));
   }
 
-  .key:hover .face {
+  .combo-mark {
+    fill: var(--combo);
+  }
+
+  .static {
+    cursor: inherit;
+  }
+
+  .key:not(.static):hover .face {
     fill: color-mix(in srgb, var(--fill) 88%, var(--accent));
   }
 
+  .found .edge {
+    stroke: var(--find);
+    stroke-width: 4;
+    stroke-dasharray: none;
+  }
+
+  .found .cap {
+    filter: drop-shadow(0 0 calc(var(--u) * 0.12) color-mix(in srgb, var(--find) 70%, transparent));
+  }
+
   .selected .edge {
     stroke: var(--accent);
     stroke-width: 5;
@@ -181,7 +243,6 @@
     flex-direction: column;
     align-items: center;
     justify-content: center;
-    padding: calc(var(--u) * 0.04);
     pointer-events: none;
     overflow: hidden;
   }
```

- [ ] **Step 3: Encoders**

Apply to `web/src/keyboard/Encoder.svelte`:

```diff
diff --git a/web/src/keyboard/Encoder.svelte b/web/src/keyboard/Encoder.svelte
--- a/web/src/keyboard/Encoder.svelte
+++ b/web/src/keyboard/Encoder.svelte
@@ -1,6 +1,7 @@
 <script lang="ts">
   import type { PlacedKey } from "./geometry";
   import { legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
+  import { refId } from "./refs";
   import { legendFont } from "./textWidth.svelte";
 
   interface Props {
@@ -11,10 +12,14 @@
     selected: boolean;
     label: string;
     focusable: boolean;
+    /** produces what the find box looks for: highlighted */
+    found?: boolean;
+    /** a knob to click; otherwise only a picture (the keyboard as a whole is labelled) */
+    interactive?: boolean;
     onselect: () => void;
   }
 
-  let { item, face, u, selected, label, focusable, onselect }: Props = $props();
+  let { item, face, u, selected, label, focusable, found = false, interactive = true, onselect }: Props = $props();
 
   const clockwise = $derived(item.geometry.direction === 1);
   const size = $derived(Math.min(item.w, item.h) * u * 0.91);
@@ -37,18 +42,7 @@
   );
 </script>
 
-<button
-  type="button"
-  class="encoder tone-{face.tone}" data-tone={face.tone}
-  class:selected
-  {style}
-  aria-label={label}
-  title={label}
-  aria-pressed={selected}
-  tabindex={focusable ? 0 : -1}
-  data-ref="{item.kind}:{item.index}"
-  onclick={onselect}
->
+{#snippet knob()}
   <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true" class:mirrored={!clockwise}>
     <path d="M19 12a7 7 0 1 1-2.05-4.95" />
     <path d="M17.5 3.5v4h-4" />
@@ -58,7 +52,29 @@
     <span class="tap">{#each face.main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
     {#if face.hold}<span class="hold">{face.hold}</span>{/if}
   </span>
-</button>
+{/snippet}
+
+{#if interactive}
+  <button
+    type="button"
+    class="encoder tone-{face.tone}" data-tone={face.tone}
+    class:selected
+    class:found
+    {style}
+    aria-label={label}
+    title={label}
+    aria-pressed={selected}
+    tabindex={focusable ? 0 : -1}
+    data-ref={refId(item)}
+    onclick={onselect}
+  >
+    {@render knob()}
+  </button>
+{:else}
+  <div class="encoder static tone-{face.tone}" data-tone={face.tone} class:found {style}>
+    {@render knob()}
+  </div>
+{/if}
 
 <style>
   .encoder {
@@ -76,6 +92,10 @@
     cursor: pointer;
   }
 
+  .static {
+    cursor: inherit;
+  }
+
   .tone-transparent {
     --fill: transparent;
     border-style: dashed;
@@ -87,6 +107,11 @@
     color: var(--text-3);
   }
 
+  .found {
+    border-color: var(--find);
+    box-shadow: 0 0 0 2px var(--find);
+  }
+
   .selected {
     border-color: var(--accent);
     box-shadow: 0 0 0 2px var(--accent);
```

- [ ] **Step 4: The keyboard**

Apply to `web/src/keyboard/Keyboard.svelte`:

```diff
diff --git a/web/src/keyboard/Keyboard.svelte b/web/src/keyboard/Keyboard.svelte
--- a/web/src/keyboard/Keyboard.svelte
+++ b/web/src/keyboard/Keyboard.svelte
@@ -3,6 +3,7 @@
   import { encoderKnobs, type Placement } from "./geometry";
   import Key from "./Key.svelte";
   import type { KeyFace } from "./labels";
+  import { refId } from "./refs";
 
   interface Props {
     placement: Placement;
@@ -15,9 +16,21 @@
     onselect: (index: number) => void;
     /** largest key size, in pixels */
     maxUnit?: number;
+    /** which placed keys are part of a combo (underlined), aligned with placement.items */
+    combos?: boolean[];
+    /** keys to click and move between; otherwise a picture, hidden from screen readers (what shows it says what it
+     * is) */
+    interactive?: boolean;
+    /** small keys, main legends only, as large as they fit (the Overview's) */
+    compact?: boolean;
+    /** which placed keys produce what the find box looks for (highlighted), aligned with placement.items */
+    highlights?: boolean[];
   }
 
-  let { placement, faces, labels, selected, onselect, maxUnit = 72 }: Props = $props();
+  let {
+    placement, faces, labels, selected, onselect, maxUnit = 72, combos = [], interactive = true, compact = false,
+    highlights = [],
+  }: Props = $props();
 
   let width = $state(0);
   // as big as fits the width, never bigger than maxUnit
@@ -29,11 +42,11 @@
   const focusIndex = $derived(selected >= 0 && selected < placement.items.length ? selected : 0);
 </script>
 
-<div class="keyboard" bind:clientWidth={width}>
+<div class="keyboard" bind:clientWidth={width} aria-hidden={interactive ? undefined : "true"}>
   <div
     class="plate"
-    role="group"
-    aria-label="Keyboard"
+    role={interactive ? "group" : undefined}
+    aria-label={interactive ? "Keyboard" : undefined}
     style="width: {placement.width * u}px; height: {placement.height * u}px"
   >
     {#if u > 0}
@@ -44,13 +57,13 @@
             width: {knob.length * u}px; height: {knob.thickness * u}px; transform: rotate({knob.angle}deg)"
         ></div>
       {/each}
-      {#each placement.items as item, i (`${item.kind}:${item.index}`)}
+      {#each placement.items as item, i (refId(item))}
         {#if item.kind === "key"}
           <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
-            onselect={() => onselect(i)} />
+            combo={combos[i] ?? false} found={highlights[i] ?? false} {interactive} {compact} onselect={() => onselect(i)} />
         {:else}
           <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
-            onselect={() => onselect(i)} />
+            found={highlights[i] ?? false} {interactive} onselect={() => onselect(i)} />
         {/if}
       {/each}
     {/if}
```

- [ ] **Step 5: The legend entry**

Apply to `web/src/keymap/KindLegend.svelte`:

```diff
diff --git a/web/src/keymap/KindLegend.svelte b/web/src/keymap/KindLegend.svelte
--- a/web/src/keymap/KindLegend.svelte
+++ b/web/src/keymap/KindLegend.svelte
@@ -5,6 +5,7 @@
   <li><i class="tap-dance"></i>tap dance</li>
   <li><i class="macro"></i>macro</li>
   <li><i class="transparent"></i>transparent (falls through)</li>
+  <li><i class="combo"></i>part of a combo</li>
 </ul>
 
 <style>
@@ -58,4 +59,8 @@
     border-style: dashed;
     background: transparent;
   }
+
+  .combo {
+    box-shadow: inset 0 -3px 0 var(--combo);
+  }
 </style>
```

- [ ] **Step 6: Type-check and build**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run build
```

Expected: `built in`.

- [ ] **Step 7: Commit**

```bash
git add web/src/app.css \
  web/src/keyboard/Encoder.svelte \
  web/src/keyboard/Key.svelte \
  web/src/keyboard/Keyboard.svelte \
  web/src/keymap/KindLegend.svelte
git commit -m "feat(web): combo underline, find highlight, compact keys and a non-interactive keyboard drawing"
```

### Task 11: The Edit/Overview switch

The Keymap header gets two radio buttons, Edit and Overview. The choice is kept in `localStorage` under `vial.keymapView`. Reading and writing go through try/catch, because storage can refuse in a private window, and it falls back to Edit. `KeymapPage` passes the theme's `browserStorage()` (Task 14).

**Files:**
- Create: `web/src/keymap/view.ts`, `web/src/keymap/ViewSwitch.svelte`
- Test: `web/src/keymap/view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/keymap/view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readView, saveView, VIEW_KEY, type ViewStorage } from "./view";

function storage(initial: Record<string, string> = {}): ViewStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: ViewStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("readView", () => {
  it("is the remembered view, or Edit", () => {
    expect(readView(storage({ [VIEW_KEY]: "overview" }))).toBe("overview");
    expect(readView(storage({ [VIEW_KEY]: "edit" }))).toBe("edit");
    expect(readView(storage({ [VIEW_KEY]: "something else" }))).toBe("edit");
    expect(readView(storage())).toBe("edit");
  });

  it("is Edit when the storage can't be read, or isn't there", () => {
    expect(readView(broken)).toBe("edit");
    expect(readView(null)).toBe("edit");
  });
});

describe("saveView", () => {
  it("remembers the view", () => {
    const s = storage();
    expect(saveView(s, "overview")).toBe(true);
    expect(s.data[VIEW_KEY]).toBe("overview");
  });

  it("says so when the storage refuses, or isn't there", () => {
    expect(saveView(broken, "overview")).toBe(false);
    expect(saveView(null, "edit")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd web && npx vitest run src/keymap/view.test.ts
```

Expected: `Cannot find module './view'` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Implement it**

Create `web/src/keymap/view.ts`:

```ts
// The Keymap section's view, Edit or Overview, remembered by this browser.
export type KeymapView = "edit" | "overview";

export const VIEW_KEY = "vial.keymapView";
export const VIEWS: { value: KeymapView; label: string }[] = [
  { value: "edit", label: "Edit" },
  { value: "overview", label: "Overview" },
];

export type ViewStorage = Pick<Storage, "getItem" | "setItem">;

/** The remembered view; Edit if there is none, or the storage can't be read (private window) */
export function readView(storage: ViewStorage | null): KeymapView {
  try {
    return storage?.getItem(VIEW_KEY) === "overview" ? "overview" : "edit";
  } catch {
    return "edit";
  }
}

/** Remember the view; false if the storage refuses (it then lasts until the page is closed) */
export function saveView(storage: ViewStorage | null, view: KeymapView): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VIEW_KEY, view);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd web && npx vitest run src/keymap/view.test.ts
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: The switch**

Create `web/src/keymap/ViewSwitch.svelte`:

```svelte
<script lang="ts">
  import { VIEWS, type KeymapView } from "./view";

  interface Props {
    view: KeymapView;
    onchange: (view: KeymapView) => void;
  }

  let { view, onchange }: Props = $props();
</script>

<fieldset class="switch">
  <legend class="visually-hidden">View</legend>
  {#each VIEWS as v (v.value)}
    <label class:on={view === v.value}>
      <input type="radio" name="keymap-view" value={v.value} checked={view === v.value} onchange={() => onchange(v.value)} />
      {v.label}
    </label>
  {/each}
</fieldset>

<style>
  .switch {
    display: inline-flex;
    gap: 2px;
    margin: 0;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }

  label {
    position: relative;
    padding: 5px 14px;
    border-radius: 8px;
    color: var(--text-2);
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

- [ ] **Step 6: Every unit test, then type-check**

```bash
cd web && npm test && npm run check
```

Expected: `Test Files  23 passed (23)` and `Tests  323 passed (323)` and `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add web/src/keymap/ViewSwitch.svelte \
  web/src/keymap/view.test.ts \
  web/src/keymap/view.ts
git commit -m "feat(web): the Edit/Overview switch, remembered by the browser"
```

### Task 12: Inspector sections: combos with this key, how the layer is reached

Three components for the Inspector:
- **`SectionTitle`:** the small upper-case title the Inspector's sections share. It replaces the `h3` style that `Inspector.svelte` defines today (Task 14 switches it over).
- **`ComboList`, "Combos with this key":**
  - each combo the key is part of, with its partners and output: "with OSL(3) → Layer 2, while held", "with Y → Esc";
  - the combo's number;
  - "Y isn't on this layer" when a partner key isn't on the layer;
  - on a transparent key, one line saying it falls through to the base layer's key, so these combos still fire.
- **`ReachList`, "How Layer N is reached":** each way and the layers it works from, or the warning when nothing reaches the layer.

They aren't used until Task 14, so svelte-check and the build verify them here.

**Files:**
- Create: `web/src/ui/SectionTitle.svelte`, `web/src/keymap/ComboList.svelte`, `web/src/keymap/ReachList.svelte`

- [ ] **Step 1: The section title**

Create `web/src/ui/SectionTitle.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** for aria-labelledby */
    id?: string;
    children: Snippet;
  }

  // the small upper-case title of a section of a panel (the Inspector's)
  let { id, children }: Props = $props();
</script>

<h3 {id}>{@render children()}</h3>

<style>
  h3 {
    margin: 0 0 8px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
```

- [ ] **Step 2: Combos with this key**

Create `web/src/keymap/ComboList.svelte`:

```svelte
<script lang="ts">
  import type { ComboUse } from "../analysis/combos";
  import { comboUseLabel, missingPartners } from "../analysis/phrases";
  import type { Names } from "../keyboard/labels";
  import SectionTitle from "../ui/SectionTitle.svelte";

  interface Props {
    /** the combos the selected key is part of, on the layer shown */
    uses: ComboUse[];
    names: Names;
    /** the key is transparent: the combos are those of the key below, which it falls through to */
    through?: boolean;
  }

  let { uses, names, through = false }: Props = $props();
</script>

<section class="combos" aria-labelledby="combos-title">
  <SectionTitle id="combos-title">Combos with this key</SectionTitle>
  {#if through}<p class="through">It falls through to the base layer's key, so these combos still fire.</p>{/if}
  <ul>
    {#each uses as use (use.combo.index)}
      {@const missing = missingPartners(use, names)}
      <li>
        <span class="what">{comboUseLabel(use, names)}</span>
        <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .through {
    margin: 0 0 8px;
    color: var(--text-3);
    font-size: 12px;
  }

  ul {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    gap: 1px;
    padding-left: 10px;
    border-left: 3px solid var(--combo);
  }

  .what {
    font-size: 13px;
    font-weight: 600;
  }

  .detail {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 3: How the layer is reached**

Create `web/src/keymap/ReachList.svelte`:

```svelte
<script lang="ts">
  import { unreachedReason, wayDetail, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { LayerReach } from "../analysis/reach";
  import { layerLabel } from "../keyboard/labels";
  import SectionTitle from "../ui/SectionTitle.svelte";

  interface Props {
    /** the layer shown */
    reach: LayerReach;
    ctx: PhraseContext;
  }

  let { reach, ctx }: Props = $props();

  const warning = $derived(unreachedReason(reach));
  const ways = $derived(reach.ways.map((w) => ({ label: wayLabel(w, ctx), detail: wayDetail(w, ctx) })));
</script>

<section class="reach" aria-labelledby="reach-title">
  <SectionTitle id="reach-title">How {layerLabel(reach.layer, ctx.names)} is reached</SectionTitle>
  {#if warning}
    <p class="warning" role="note">{warning}</p>
  {/if}
  {#if ways.length > 0}
    <ul>
      {#each ways as way, i (i)}
        <li>
          <span class="what">{way.label}</span>
          <span class="detail">{way.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .warning {
    margin: 0 0 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
    font-weight: 600;
  }

  ul {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    gap: 1px;
    padding-left: 10px;
    border-left: 3px solid color-mix(in srgb, var(--tone-layer) 55%, transparent);
  }

  .what {
    font-size: 13px;
    font-weight: 600;
  }

  .detail {
    color: var(--text-3);
    font-size: 12px;
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
git add web/src/keymap/ComboList.svelte \
  web/src/keymap/ReachList.svelte \
  web/src/ui/SectionTitle.svelte
git commit -m "feat(web): Inspector sections for combos with a key and how a layer is reached"
```

### Task 13: The Overview and the find box

**`LayerCard`**, one card per layer:
- its number and name, and "reached by" chips;
- its keyboard drawn small: tap labels only, colour by kind, combo underline, find highlight;
- unreached layers get a dashed border and a "Nothing reaches this layer" chip;
- the layer shown in the Edit view gets an accent outline;
- the whole card is one button, stretched over the card. Its accessible name includes the reached-by text: "Layer 2 — reached by hold B; hold S; combo: MO(5) + OSL(3)".

**`Overview`:**
- the help text about layer switching done in firmware code (tri-layer, `layer_state_set_user`), which the Vial protocol can't show;
- the cards: two to a row once the overview is at least 760 px wide, one below that;
- the colour legend;
- a "Not used" box for unused tap dances and macros.

**`FindBox`**, a search box under the Keymap header, in both views:
- results as chips: a chip with a key opens it; the others are plain text;
- "“ż” is not on your keymap." when nothing matches;
- a hidden status line tells screen readers how many places were found.

They are wired in by Task 14, so svelte-check and the build verify them here.

**Files:**
- Create: `web/src/keymap/LayerCard.svelte`, `web/src/keymap/Overview.svelte`, `web/src/keymap/FindBox.svelte`

- [ ] **Step 1: A layer's card**

Create `web/src/keymap/LayerCard.svelte`:

```svelte
<script lang="ts">
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import type { KeyFace } from "../keyboard/labels";

  interface Props {
    index: number;
    /** "Layer 1 · Symbols", "Base" */
    title: string;
    /** how it is reached, in short labels */
    reachedBy: string[];
    /** why nothing gets to it, or null when something does */
    warning: string | null;
    placement: Placement;
    faces: KeyFace[];
    combos: boolean[];
    /** keys the find box highlights */
    highlights: boolean[];
    /** the layer the Edit view shows */
    current: boolean;
    onopen: () => void;
  }

  let { index, title, reachedBy, warning, placement, faces, combos, highlights, current, onopen }: Props = $props();

  const name = $derived(
    `${title}${warning ? ` — ${warning}` : ""}${reachedBy.length > 0 ? ` — reached by ${reachedBy.join("; ")}` : ""}`,
  );
  const labels = $derived(faces.map(() => ""));
</script>

<article class="card" class:current class:unreached={warning !== null} data-layer={index}>
  <button type="button" class="open" aria-label={name} title="Open in the Edit view" onclick={onopen}>
    <span class="number">{index}</span>
    <span class="title">{title}</span>
  </button>
  <ul class="reach" aria-hidden="true">
    {#if warning}<li class="warning">{warning}</li>{/if}
    {#each reachedBy as label, i (i)}
      <li>{label}</li>
    {/each}
  </ul>
  <div class="drawing">
    <Keyboard {placement} {faces} {labels} {combos} {highlights} selected={-1} onselect={() => undefined} interactive={false}
      compact maxUnit={44} />
  </div>
</article>

<style>
  .card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
    padding: 10px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
    transition: border-color 0.12s;
  }

  .card:hover {
    border-color: var(--border-strong);
  }

  .card.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow);
  }

  .card:has(.open:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .card.unreached {
    border-style: dashed;
  }

  /* the whole card opens the layer */
  .open {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .open::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  .open:focus-visible {
    outline: none;
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

  .title {
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reach {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .reach li {
    padding: 1px 8px;
    border: 1px solid color-mix(in srgb, var(--tone-layer) 30%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--tone-layer) 8%, var(--surface));
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.5;
  }

  .reach li.warning {
    border-color: color-mix(in srgb, var(--warning-text) 35%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
    font-weight: 600;
  }

  .drawing {
    padding-top: 4px;
  }
</style>
```

- [ ] **Step 2: The Overview**

Create `web/src/keymap/Overview.svelte`:

```svelte
<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyFace, layerLabel, type KeyFace, type Names } from "../keyboard/labels";
  import { actionAt, refId } from "../keyboard/refs";
  import KindLegend from "./KindLegend.svelte";
  import LayerCard from "./LayerCard.svelte";

  interface Props {
    model: KeyboardModel;
    names: Names;
    placement: Placement;
    analysis: Analysis;
    /** by layer: the keys (refIds) the find box highlights */
    highlighted: Set<string>[];
    /** the layer the Edit view shows */
    current: number;
    onopen: (layer: number) => void;
  }

  let { model, names, placement, analysis, highlighted, current, onopen }: Props = $props();

  const EMPTY: KeyFace = { main: "", shifted: null, altGr: null, hold: null, tone: "none" };
  const ctx = $derived<PhraseContext>({ model, names, positions: analysis.positions });

  // small keyboards show the tap action only: the colour says what kind of key it is
  const cards = $derived(
    model.layers.map((layer) => {
      const reach = analysis.reach[layer.index];
      return {
        index: layer.index,
        title: layerLabel(layer.index, names),
        reachedBy: reach ? reach.ways.map((w) => wayLabel(w, ctx)) : [],
        warning: reach ? unreachedReason(reach) : null,
        faces: placement.items.map((item) => {
          const d = actionAt(model, layer.index, item);
          return d ? { ...keyFace(d, names), shifted: null, altGr: null, hold: null } : EMPTY;
        }),
        combos: placement.items.map((item) => analysis.comboKeys[layer.index]?.has(refId(item)) ?? false),
        highlights: placement.items.map((item) => highlighted[layer.index]?.has(refId(item)) ?? false),
      };
    }),
  );

  const unused = $derived([
    ...analysis.unused.tapDances.map((i) => {
      const name = names.tapDance(i);
      return `Tap dance ${i}${name ? ` · ${name}` : ""} is set up, but no key or combo uses it.`;
    }),
    ...analysis.unused.macros.map((i) => {
      const name = names.macro(i);
      return `Macro ${i}${name ? ` · ${name}` : ""} is set up, but no key or combo uses it.`;
    }),
  ]);
</script>

<div class="overview" role="region" aria-label="Overview of the layers">
  <p class="limit">
    Layer switching done in the keyboard's firmware code (for example tri-layer or <code>layer_state_set_user</code>)
    can't be seen over the Vial protocol, so it isn't shown here.
  </p>
  <div class="layers">
    {#each cards as card (card.index)}
      <LayerCard
        index={card.index}
        title={card.title}
        reachedBy={card.reachedBy}
        warning={card.warning}
        {placement}
        faces={card.faces}
        combos={card.combos}
        highlights={card.highlights}
        current={card.index === current}
        onopen={() => onopen(card.index)}
      />
    {/each}
  </div>

  <KindLegend />

  {#if unused.length > 0}
    <section class="notes" aria-labelledby="unused-title">
      <h2 id="unused-title">Not used</h2>
      <ul>
        {#each unused as note (note)}
          <li>{note}</li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .overview {
    display: grid;
    gap: 14px;
    container: overview / inline-size;
  }

  .layers {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  /* two to a row once the small keyboards stay big enough to read (about 30 px a key for a Corne) */
  @container overview (min-width: 760px) {
    .layers {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .notes {
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .notes h2 {
    margin: 0 0 4px;
    font-size: 13px;
  }

  .notes ul {
    margin: 0;
    padding-left: 18px;
  }

  .limit {
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
```

- [ ] **Step 3: The find box**

Create `web/src/keymap/FindBox.svelte`:

```svelte
<script lang="ts">
  import type { Place } from "../analysis/find";

  interface Result {
    label: string;
    /** the key to open in the Edit view, if it is on one */
    place: Place | null;
  }

  interface Props {
    text: string;
    results: Result[];
    onopen: (place: Place) => void;
  }

  let { text = $bindable(), results, onopen }: Props = $props();

  /** more than this many places would only scroll: the highlighted keys show the rest */
  const SHOWN = 40;
  const searched = $derived(text.trim());
  const summary = $derived(
    !searched ? "" : results.length === 0 ? `“${searched}” is not on your keymap.`
      : `“${searched}”: ${results.length === 1 ? "1 place" : `${results.length} places`}`,
  );
</script>

<section class="find" aria-label="Find a character or key">
  <input
    type="search"
    bind:value={text}
    placeholder="Find a character or key: ą, @, Esc, MO(2)"
    aria-label="Find a character or key"
    aria-describedby={searched ? "find-results" : undefined}
    spellcheck="false"
    autocomplete="off"
  />
  <!-- said by screen readers as it changes; the same text is shown in the results -->
  <p class="visually-hidden" role="status">{summary}</p>
  {#if searched}
    <div id="find-results" class="results">
      {#if results.length === 0}
        <p class="none">{summary}</p>
      {:else}
        <p class="count">{summary}</p>
        <ul>
          {#each results.slice(0, SHOWN) as result, i (i)}
            <li>
              {#if result.place}
                {@const place = result.place}
                <button type="button" onclick={() => onopen(place)}>{result.label}</button>
              {:else}
                <span>{result.label}</span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if results.length > SHOWN}<p class="more">and {results.length - SHOWN} more, highlighted on the keys</p>{/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .find {
    display: grid;
    gap: 8px;
  }

  input {
    width: min(100%, 420px);
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface);
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .results {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--find) 45%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--find) 7%, var(--surface));
    font-size: 13px;
  }

  p {
    margin: 0;
  }

  .count {
    margin-bottom: 6px;
    color: var(--text-2);
    font-weight: 600;
  }

  .none {
    color: var(--text-2);
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li > * {
    display: inline-block;
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
  }

  button {
    cursor: pointer;
  }

  button:hover {
    border-color: var(--find);
  }

  .more {
    margin-top: 6px;
    color: var(--text-3);
    font-size: 12px;
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
git add web/src/keymap/FindBox.svelte \
  web/src/keymap/LayerCard.svelte \
  web/src/keymap/Overview.svelte
git commit -m "feat(web): the Overview's layer cards and the find box"
```

### Task 14: Wire the Overview, the find box and the Inspector sections into the Keymap page

`KeymapPage`:
- holds `analyse(model, placement)` as a `$derived`, so the Overview, the underline and the Inspector follow every edit at once;
- shows the view switch in the header, with a description for each view;
- shows the find box in both views;
- shows either the Overview or the Edit view.

**Opening things:**
- Clicking an Overview card opens that layer in the Edit view and moves the focus to its tab.
- Clicking a find result opens its key, selected and focused, in the Edit view.

**In the Edit view:**
- Combo keys are underlined, and their screen-reader labels end with "· part of a combo".
- Keys found by the find box are highlighted.
- Arrow keys only act in the Edit view.

**Inspector:** it gets the key's combo uses (`combosUsing` on the layer's own keycodes after fall-through), the layer's reach and the phrase context. It shows the two new sections when there's something to show, and uses `SectionTitle` for every section title.

**Files:**
- Modify: `web/src/keymap/Inspector.svelte`, `web/src/keymap/KeymapPage.svelte`

- [ ] **Step 1: The Inspector**

Apply to `web/src/keymap/Inspector.svelte`:

```diff
diff --git a/web/src/keymap/Inspector.svelte b/web/src/keymap/Inspector.svelte
--- a/web/src/keymap/Inspector.svelte
+++ b/web/src/keymap/Inspector.svelte
@@ -1,11 +1,17 @@
 <script lang="ts">
+  import type { ComboUse } from "../analysis/combos";
+  import type { PhraseContext } from "../analysis/phrases";
+  import type { LayerReach } from "../analysis/reach";
   import type { Described, KeyboardModel } from "../api/types";
   import KeyCap from "../keyboard/KeyCap.svelte";
   import { actionSummary, keyFace, keyTitle, layerLabel, type Names } from "../keyboard/labels";
-  import { actionAt, positionLine, type KeyRef } from "../keyboard/refs";
+  import { actionAt, positionLine, refId, type KeyRef } from "../keyboard/refs";
   import Button from "../ui/Button.svelte";
+  import SectionTitle from "../ui/SectionTitle.svelte";
+  import ComboList from "./ComboList.svelte";
   import { tapCodeOf } from "./hold";
   import HoldEditor from "./HoldEditor.svelte";
+  import ReachList from "./ReachList.svelte";
   import { freeTapDance, tapDanceSlots } from "./tapdance";
 
   interface Props {
@@ -14,19 +20,26 @@
     layer: number;
     selection: KeyRef;
     canEdit: boolean;
+    /** the combos the key is part of on the layer */
+    comboUses: ComboUse[];
+    /** how the layer is reached */
+    reach: LayerReach | undefined;
+    phrases: PhraseContext;
     onchangekey: () => void;
     onsetcode: (code: string, action: string) => Promise<boolean>;
     ontapdance: () => void;
     onjump: (layer: number) => void;
   }
 
-  let { model, names, layer, selection, canEdit, onchangekey, onsetcode, ontapdance, onjump }: Props = $props();
+  let {
+    model, names, layer, selection, canEdit, comboUses, reach, phrases, onchangekey, onsetcode, ontapdance, onjump,
+  }: Props = $props();
 
   let editingHold = $state(false);
   // the hold editor is for one key on one layer: another one closes it
   let editedKey = "";
   $effect.pre(() => {
-    const key = `${layer}:${selection.kind}:${selection.index}`;
+    const key = `${layer}:${refId(selection)}`;
     if (key !== editedKey) {
       editedKey = key;
       editingHold = false;
@@ -84,7 +97,7 @@
 
   {#if tapDance}
     <section class="tap-dance" aria-label="Tap dance {tapDance.index}">
-      <h3>What each press does</h3>
+      <SectionTitle>What each press does</SectionTitle>
       <dl class="rows">
         {#each tapDanceSlots(tapDance) as slot (slot.label)}
           <dt>{slot.label}</dt>
@@ -138,7 +151,7 @@
   </div>
 
   {#if editingHold && tapCode}
-    {#key `${layer}:${selection.kind}:${selection.index}`}
+    {#key `${layer}:${refId(selection)}`}
       <HoldEditor
         {current}
         tap={tapCode}
@@ -152,7 +165,7 @@
 
   {#if others.length > 0}
     <section class="others">
-      <h3>On the other layers</h3>
+      <SectionTitle>On the other layers</SectionTitle>
       <ul>
         {#each others as other (other.index)}
           <li>
@@ -166,6 +179,14 @@
       </ul>
     </section>
   {/if}
+
+  {#if comboUses.length > 0}
+    <ComboList uses={comboUses} {names} through={current.kind === "transparent"} />
+  {/if}
+
+  {#if reach}
+    <ReachList {reach} ctx={phrases} />
+  {/if}
 </aside>
 
 <style>
@@ -261,15 +282,6 @@
     gap: 6px;
   }
 
-  h3 {
-    margin: 0 0 8px;
-    color: var(--text-2);
-    font-size: 12px;
-    font-weight: 650;
-    letter-spacing: 0.04em;
-    text-transform: uppercase;
-  }
-
   .others ul {
     display: grid;
     gap: 2px;
```

- [ ] **Step 2: The Keymap page**

Apply to `web/src/keymap/KeymapPage.svelte`:

```diff
diff --git a/web/src/keymap/KeymapPage.svelte b/web/src/keymap/KeymapPage.svelte
--- a/web/src/keymap/KeymapPage.svelte
+++ b/web/src/keymap/KeymapPage.svelte
@@ -1,16 +1,25 @@
 <script lang="ts">
   import { tick } from "svelte";
+  import { analyse } from "../analysis/analysis";
+  import { combosUsing } from "../analysis/combos";
+  import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
+  import { foundLabel, type PhraseContext } from "../analysis/phrases";
   import type { KeyboardModel } from "../api/types";
   import { placeKeyboard } from "../keyboard/geometry";
   import Keyboard from "../keyboard/Keyboard.svelte";
   import { keyFace, keyLabel, layerLabel, namesOf, type KeyFace } from "../keyboard/labels";
-  import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
+  import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
   import { keyboard } from "../lib/keyboard.svelte";
+  import { browserStorage } from "../lib/theme";
   import Picker from "../picker/Picker.svelte";
   import Inspector from "./Inspector.svelte";
+  import FindBox from "./FindBox.svelte";
   import KindLegend from "./KindLegend.svelte";
   import LayerTabs from "./LayerTabs.svelte";
   import { neighbour, type Direction } from "./navigation";
+  import Overview from "./Overview.svelte";
+  import { readView, saveView, type KeymapView } from "./view";
+  import ViewSwitch from "./ViewSwitch.svelte";
 
   interface Props {
     model: KeyboardModel;
@@ -18,6 +27,8 @@
 
   let { model }: Props = $props();
 
+  let view = $state<KeymapView>(readView(browserStorage()));
+  let findText = $state("");
   let layer = $state(0);
   let selection = $state<KeyRef | null>(null);
   let pickerOpen = $state(false);
@@ -28,14 +39,32 @@
 
   const names = $derived(namesOf(model));
   const placement = $derived(placeKeyboard(model));
+  // layers reached, combo keys, usage: worked out again from the model after every edit
+  const analysis = $derived(analyse(model, placement));
+  const phrases = $derived<PhraseContext>({ model, names, positions: analysis.positions });
+  // what the find box looks for, everywhere the keymap produces it (in the keyboard language's legends)
+  const found = $derived(
+    findOnKeymap(model, placement, queryOf(findText, keyboard.catalogue), analysis.combos, analysis.usage,
+      analysis.codes[0]),
+  );
+  const foundResults = $derived(
+    found.map((f) => ({
+      label: foundLabel(f, phrases),
+      place: f.type === "key" ? { layer: f.layer, ref: f.ref } : f.key,
+    })),
+  );
+  const highlighted = $derived(foundKeys(found, model.layers.length));
   const actions = $derived(placement.items.map((item) => actionAt(model, layer, item)));
   const EMPTY: KeyFace = { main: "", shifted: null, altGr: null, hold: null, tone: "none" };
   const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY)));
+  const combos = $derived(placement.items.map((item) => analysis.comboKeys[layer]?.has(refId(item)) ?? false));
+  const highlights = $derived(placement.items.map((item) => highlighted[layer]?.has(refId(item)) ?? false));
   // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
   const labels = $derived(
     placement.items.map((item, i) => {
       const { what, where } = whereIs(model, item);
-      return keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
+      const label = keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
+      return combos[i] ? `${label} · part of a combo` : label;
     }),
   );
   const selectedIndex = $derived(
@@ -51,6 +80,27 @@
     }
   });
 
+  function changeView(next: KeymapView) {
+    view = next;
+    saveView(browserStorage(), next);
+  }
+
+  /** From the Overview: the layer, in the Edit view, with the focus on its tab */
+  async function openLayer(index: number) {
+    layer = index;
+    changeView("edit");
+    await tick();
+    document.getElementById(`layer-tab-${index}`)?.focus();
+  }
+
+  /** From a find result: the key, selected in the Edit view on its layer */
+  async function openKey(place: Place) {
+    layer = place.layer;
+    selection = place.ref;
+    changeView("edit");
+    await focusSelected();
+  }
+
   function select(index: number) {
     const item = placement.items[index];
     if (item) selection = { kind: item.kind, index: item.index };
@@ -58,7 +108,7 @@
 
   async function focusSelected() {
     await tick();
-    if (selection) document.querySelector<HTMLElement>(`[data-ref="${selection.kind}:${selection.index}"]`)?.focus();
+    if (selection) document.querySelector<HTMLElement>(`[data-ref="${refId(selection)}"]`)?.focus();
   }
 
   function setCode(code: string, action = "Changing the key") {
@@ -85,14 +135,15 @@
 
   function onkeydown(event: KeyboardEvent) {
     // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
-    if (document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
+    if (view !== "edit" || document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey ||
+      event.ctrlKey || event.metaKey) {
       return;
     }
     const target = event.target as HTMLElement;
     // Enter and Delete act on the key that has the focus, never on one the focus merely fell from (to <body>);
     // the arrows also start from <body>, and leave every other control (buttons, tabs, fields) alone
     const ref = target instanceof HTMLElement ? target.getAttribute("data-ref") : null;
-    const focused = ref === null ? -1 : placement.items.findIndex((i) => `${i.kind}:${i.index}` === ref);
+    const focused = ref === null ? -1 : placement.items.findIndex((i) => refId(i) === ref);
     const onKey = focused >= 0;
     const direction = ARROWS[event.key];
     const handled = direction || event.key === "Enter" || event.key === "Delete" || event.key === "Backspace";
@@ -114,6 +165,9 @@
   }
 
   const current = $derived(selection ? actionAt(model, layer, selection) : undefined);
+  const comboUses = $derived(
+    selection ? combosUsing(analysis.combos, model, analysis.codes[layer] ?? new Map(), layer, selection) : [],
+  );
   const subject = $derived.by(() => {
     if (!selection) return "";
     const { what, where } = whereIs(model, selection);
@@ -125,46 +179,64 @@
 
 <section class="keymap" aria-labelledby="keymap-title">
   <header class="head">
-    <h1 id="keymap-title">Keymap</h1>
-    <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete or Backspace clears it.</p>
+    <div class="title">
+      <h1 id="keymap-title">Keymap</h1>
+      {#if view === "edit"}
+        <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete or Backspace clears it.</p>
+      {:else}
+        <p>Every layer at once, and how each one is reached. Click a layer to edit it.</p>
+      {/if}
+    </div>
+    <ViewSwitch {view} onchange={changeView} />
   </header>
 
-  <LayerTabs
-    layers={model.layers}
-    active={layer}
-    canRename={keyboard.canEdit}
-    onselect={(i) => (layer = i)}
-    onrename={(i, name) => keyboard.renameLayer(i, name)}
-  />
+  <FindBox bind:text={findText} results={foundResults} onopen={(place) => void openKey(place)} />
 
-  <div class="workspace">
-    <div class="board" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{layer}">
-      <Keyboard {placement} {faces} {labels} selected={selectedIndex} onselect={select} />
-      <KindLegend />
-    </div>
+  {#if view === "overview"}
+    <Overview
+      {model} {names} {placement} {analysis} {highlighted} current={layer} onopen={(i) => void openLayer(i)}
+    />
+  {:else}
+    <LayerTabs
+      layers={model.layers}
+      active={layer}
+      canRename={keyboard.canEdit}
+      onselect={(i) => (layer = i)}
+      onrename={(i, name) => keyboard.renameLayer(i, name)}
+    />
 
-    {#if selection && current}
-      {#key `${selection.kind}:${selection.index}`}
-        <Inspector
-          {model}
-          {names}
-          {layer}
-          {selection}
-          canEdit={keyboard.canEdit && keyboard.pending === 0}
-          onchangekey={() => (pickerOpen = true)}
-          onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
-          ontapdance={() => fromInspector(turnIntoTapDance)}
-          onjump={(i) => {
-            layer = i;
-            void focusSelected();
-          }}
-        />
-      {/key}
-    {/if}
-  </div>
+    <div class="workspace">
+      <div class="board" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{layer}">
+        <Keyboard {placement} {faces} {labels} {combos} {highlights} selected={selectedIndex} onselect={select} />
+        <KindLegend />
+      </div>
+
+      {#if selection && current}
+        {#key refId(selection)}
+          <Inspector
+            {model}
+            {names}
+            {layer}
+            {selection}
+            canEdit={keyboard.canEdit && keyboard.pending === 0}
+            {comboUses}
+            reach={analysis.reach[layer]}
+            {phrases}
+            onchangekey={() => (pickerOpen = true)}
+            onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
+            ontapdance={() => fromInspector(turnIntoTapDance)}
+            onjump={(i) => {
+              layer = i;
+              void focusSelected();
+            }}
+          />
+        {/key}
+      {/if}
+    </div>
+  {/if}
 </section>
 
-{#if selection && current}
+{#if view === "edit" && selection && current}
   <Picker
     bind:open={pickerOpen}
     {subject}
@@ -185,6 +257,14 @@
     container: keymap / inline-size;
   }
 
+  .head {
+    display: flex;
+    flex-wrap: wrap;
+    align-items: flex-start;
+    justify-content: space-between;
+    gap: 10px 16px;
+  }
+
   .head h1 {
     margin: 0;
     font-size: 22px;
```

- [ ] **Step 3: Type-check, unit tests and build**

```bash
cd web && npm run check && npm test && npm run build
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  323 passed (323)` and `built in`.

- [ ] **Step 4: The existing e2e tests still pass** (the Edit view now shows the underline on the Corne's combo keys)

```bash
cd web && npm run e2e
```

Expected: `18 passed`: the e2e tests already on main.

- [ ] **Step 5: Commit**

```bash
git add web/src/keymap/Inspector.svelte \
  web/src/keymap/KeymapPage.svelte
git commit -m "feat(web): Overview view, Edit/Overview switch, find box, Inspector combos and layer reach"
```

### Task 15: e2e: the Overview, combos reaching layers, the underline and 8 layers

**Global setup** starts a third server, `--layers 8` (the `eightLayers` fixture). The three servers start in parallel; if one fails, the others are stopped. `fixtures.ts` gains:
- `comboAt` and `setCombo`, to read and set a combo through the API;
- `labelsCutOff`, which now checks every `.key`, whether a button or a drawn div.

**`e2e/overview.spec.ts`** puts back everything it changes in `finally`, through the API. It checks:
- **Labels:** the Overview's labels for the 4 Corne layers, and that clicking a layer opens it.
- **Memory:** the view choice is remembered.
- **A combo of two layer keys:** `LT1(KC_SPC)` + `OSL(3)` → `MO(2)`, set through `PUT /api/combos/2`. It shows:
  - on both keys in the Inspector;
  - in "How Layer 2 is reached";
  - on the Overview card.
- **The underline** in both views, in the combo colour, and never on transparent keys.
- **Edits:** an edit shows in the Overview at once.
- **8 layers:** MO(5) on the base layer's left outer thumb and combo 2 = MO(5) + OSL(3) → MO(2), set through the API. It checks:
  - the fit at 2560, 1280 and 800 px, with no sideways scroll;
  - the warnings on unreached layers;
  - the Inspector on both combo keys.
- **Small labels:** at least 8 px and nothing cut, at 800, 1280 and 2560.
- **Encoders and rotated keys:** the macropad's are drawn as pictures.
- **Screenshots** at 800, 1280 and 2560, light and dark.

The README documents `--layers`, the three e2e servers and `src/analysis/`.

**Files:**
- Create: `web/e2e/overview.spec.ts`
- Modify: `web/e2e/global-setup.ts`, `web/e2e/fixtures.ts`, `web/README.md`

- [ ] **Step 1: A third server, with 8 layers**

Apply to `web/e2e/global-setup.ts`:

```diff
diff --git a/web/e2e/global-setup.ts b/web/e2e/global-setup.ts
--- a/web/e2e/global-setup.ts
+++ b/web/e2e/global-setup.ts
@@ -1,6 +1,7 @@
-// Starts two `vial_web.py --fake --no-browser` servers, each on a free port with its own temporary data dir, and
-// stops them afterwards: the default simulated Corne (VIAL_URL) and a macropad with encoders, rotated keys, an ISO
-// Enter, a decal and a layout option (VIAL_MACROPAD_URL). The URLs carry the session token.
+// Starts three `vial_web.py --fake --no-browser` servers, each on a free port with its own temporary data dir, and
+// stops them afterwards: the default simulated Corne (VIAL_URL), a macropad with encoders, rotated keys, an ISO
+// Enter, a decal and a layout option (VIAL_MACROPAD_URL), and the Corne with 8 layers, as the owner's W-CORNE has
+// (VIAL_EIGHT_LAYERS_URL). The URLs carry the session token.
 import { execFileSync, spawn, type ChildProcess } from "node:child_process";
 import { mkdtempSync, rmSync } from "node:fs";
 import { tmpdir } from "node:os";
@@ -117,14 +118,23 @@ async function startServer(extraArgs: string[]): Promise<{ url: string; stop: ()
 }
 
 export default async function globalSetup(): Promise<() => Promise<void>> {
-  const corne = await startServer([]);
-  const macropad = await startServer(["--definition", MACROPAD_DEFINITION]).catch(async (error: unknown) => {
-    await corne.stop();
-    throw error;
-  });
+  const started = await Promise.allSettled([
+    startServer([]),
+    startServer(["--definition", MACROPAD_DEFINITION]),
+    startServer(["--layers", "8"]),
+  ]);
+  const servers = started.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
+  const failed = started.find((s) => s.status === "rejected");
+  if (failed) {
+    // never leave the others running
+    await Promise.all(servers.map((s) => s.stop()));
+    throw failed.reason;
+  }
+  const [corne, macropad, eight] = servers;
   process.env.VIAL_URL = corne.url;
   process.env.VIAL_MACROPAD_URL = macropad.url;
+  process.env.VIAL_EIGHT_LAYERS_URL = eight.url;
   return async () => {
-    await Promise.all([corne.stop(), macropad.stop()]);
+    await Promise.all(servers.map((s) => s.stop()));
   };
 }
```

- [ ] **Step 2: Fixtures**

Apply to `web/e2e/fixtures.ts`:

```diff
diff --git a/web/e2e/fixtures.ts b/web/e2e/fixtures.ts
--- a/web/e2e/fixtures.ts
+++ b/web/e2e/fixtures.ts
@@ -14,14 +14,17 @@ export async function open(page: Page, url: string | undefined): Promise<Page> {
 }
 
 /** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
- * simulated macropad with encoders */
-export const test = base.extend<{ app: Page; macropad: Page }>({
+ * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty) */
+export const test = base.extend<{ app: Page; macropad: Page; eightLayers: Page }>({
   app: async ({ page }, use) => {
     await use(await open(page, process.env.VIAL_URL));
   },
   macropad: async ({ page }, use) => {
     await use(await open(page, process.env.VIAL_MACROPAD_URL));
   },
+  eightLayers: async ({ page }, use) => {
+    await use(await open(page, process.env.VIAL_EIGHT_LAYERS_URL));
+  },
 });
 
 export { expect };
@@ -70,6 +73,17 @@ export async function setEncoderCodeAt(page: Page, layer: number, index: number,
   await put(page, `/api/encoders/${layer}/${encoder}/${direction}`, { code });
 }
 
+/** A combo's keycodes (all four slots) and output, as the server reports them */
+export async function comboAt(page: Page, index: number): Promise<{ keys: string[]; output: string }> {
+  const combo = (await keyboardModel(page)).combos[index];
+  return { keys: combo.keys.map((k: { code: string }) => k.code), output: combo.output.code };
+}
+
+/** Sets a combo through the API: four keycodes (KC_NO for an empty slot) and the output */
+export async function setCombo(page: Page, index: number, combo: { keys: string[]; output: string }): Promise<void> {
+  await put(page, `/api/combos/${index}`, combo);
+}
+
 /** The custom name of a layer, or null when it has its default name */
 export async function layerNameOf(page: Page, layer: number): Promise<string | null> {
   const names = await (await page.request.get(serverUrl(page, "/api/names"))).json();
@@ -115,9 +129,10 @@ export async function useFont(page: Page, family: string): Promise<void> {
  * legend makes room for them, rather than anything being cut off. (A line that is cut off shows as a whole line of
  * overflow; letters reaching a little past their line box, a few pixels, don't count.) */
 export async function labelsCutOff(page: Page): Promise<string[]> {
-  const labels = page.locator("button.key .hold, button.key .tap, button.key .shifted");
+  // the keys of the Edit view (buttons) and of the Overview's small keyboards (pictures)
+  const labels = page.locator(".key .hold, .key .tap, .key .shifted");
   const cut = await labels.evaluateAll((elements) => elements.filter((l) => {
-    const key = l.closest("button")!.querySelector(".legend")!.getBoundingClientRect();
+    const key = l.closest(".key")!.querySelector(".legend")!.getBoundingClientRect();
     const box = l.getBoundingClientRect();
     const font = parseFloat(getComputedStyle(l).fontSize);
     return l.scrollHeight - l.clientHeight > font * 0.3 || l.scrollWidth > l.clientWidth + 1 ||
```

- [ ] **Step 3: The Overview tests**

Create `web/e2e/overview.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import {
  codeAt, comboAt, expect, keyIndex, screenshots, setCodeAt, setCombo, test,
} from "./fixtures";

// The server is shared by every test: a test that changes a key or a combo puts it back in its `finally`

async function showOverview(page: Page) {
  await page.getByRole("radio", { name: "Overview" }).check();
  await expect(page.getByRole("region", { name: "Overview of the layers" })).toBeVisible();
}

const card = (page: Page, layer: number) => page.locator(`.card[data-layer="${layer}"]`);

test("the Overview shows every layer and how it is reached; clicking one opens it", async ({ app }) => {
  await showOverview(app);
  const overview = app.getByRole("region", { name: "Overview of the layers" });
  await expect(overview.locator(".card")).toHaveCount(4);
  await expect(overview.getByRole("button")).toHaveText([/^0\s*Base$/, /^1\s*Layer 1$/, /^2\s*Layer 2$/, /^3\s*Layer 3$/]);
  await expect(overview.getByRole("button", { name: "Base — reached by default layer; switch from Layer 3 (right outer thumb)" }))
    .toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 1 — reached by hold Space" })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 2 — reached by hold B; hold S" })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 3 — reached by one-shot (right outer thumb)" })).toBeVisible();
  await expect(overview).toContainText("layer_state_set_user");
  // the simulated Corne's second tap dance and second macro are on no key
  await expect(overview.getByRole("region", { name: "Not used" })).toContainText(
    "Tap dance 1 · Esc / LCtrl / Ctrl+S is set up, but no key or combo uses it.");
  await expect(overview.getByRole("region", { name: "Not used" })).toContainText(
    "Macro 1 · Home is set up, but no key or combo uses it.");

  await overview.getByRole("button", { name: /^Layer 2 —/ }).click();
  await expect(app.getByRole("tab", { name: "2 Layer 2" })).toHaveAttribute("aria-selected", "true");
  await expect(app.getByRole("tab", { name: "2 Layer 2" })).toBeFocused();
  await expect(app.getByRole("radio", { name: "Edit" })).toBeChecked();
  await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("How Layer 2 is reached");
  await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("hold B");
});

test("the chosen view is remembered", async ({ app }) => {
  await showOverview(app);
  await app.reload();
  await expect(app.getByRole("region", { name: "Overview of the layers" })).toBeVisible();
  await expect(app.getByRole("radio", { name: "Overview" })).toBeChecked();
  await app.getByRole("radio", { name: "Edit" }).check();
  await app.reload();
  await expect(app.getByRole("tablist", { name: "Layers" })).toBeVisible();
});

test("a combo of two layer keys whose output is a layer key reaches that layer", async ({ app }) => {
  const space = await keyIndex(app, 3, 4); // base layer: Space, Layer 1 on hold
  const oneShot = await keyIndex(app, 7, 3); // base layer: OSL(3)
  const before = await comboAt(app, 2);
  try {
    await setCombo(app, 2, { keys: ["LT1(KC_SPC)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
    await app.reload(); // the UI only knows of its own edits

    for (const [index, partner] of [[space, "OSL(3)"], [oneShot, "Space (hold: Layer 1)"]] as const) {
      const key = app.locator(`[data-ref="key:${index}"]`);
      await expect(key).toHaveClass(/\bcombo\b/);
      await key.click();
      const combos = app.getByRole("region", { name: "Combos with this key" });
      await expect(combos).toContainText(`with ${partner} → Layer 2, while held`);
      await expect(combos).toContainText("Combo 2");
    }
    await screenshots(app, "inspector-combo", { fullPage: true });

    await app.getByRole("tab", { name: "2 Layer 2" }).click();
    await expect(app.getByRole("region", { name: "How Layer 2 is reached" })).toContainText("combo: Space (hold: Layer 1) + OSL(3)");

    await showOverview(app);
    await expect(card(app, 2).getByRole("button")).toHaveAccessibleName(
      "Layer 2 — reached by hold B; hold S; combo: Space (hold: Layer 1) + OSL(3)");
    await expect(card(app, 2).locator(".reach")).toContainText("combo: Space (hold: Layer 1) + OSL(3)");
  } finally {
    await setCombo(app, 2, before);
  }
});

test("combo keys are underlined, in the Edit view and the Overview", async ({ app }) => {
  // K + Y and M + C on the base layer
  const members = await Promise.all([[6, 2], [6, 1], [2, 2], [2, 3]].map(([r, c]) => keyIndex(app, r, c)));
  for (const index of members) {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await expect(key).toHaveClass(/\bcombo\b/);
    await expect(key).toHaveAccessibleName(/· part of a combo$/);
    await expect(key.locator(".combo-mark")).toHaveCount(1);
  }
  await expect(app.locator("button.key.combo")).toHaveCount(4);
  const fill = await app.locator("button.key.combo .combo-mark").first().evaluate((r) => getComputedStyle(r).fill);
  expect(fill).toMatch(/^rgb\((2[0-5]\d), \d{1,2}, \d{2,3}\)$/); // red
  await app.locator(`[data-ref="key:${members[0]}"]`).click();
  await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText("with Y → Esc");

  // layer 1 is transparent on K: not underlined, but the Inspector says the combo still fires through it
  await app.getByRole("tab", { name: "1 Layer 1" }).click();
  const k = app.locator(`[data-ref="key:${members[0]}"]`);
  await expect(k).not.toHaveClass(/\bcombo\b/);
  await k.click();
  const combos = app.getByRole("region", { name: "Combos with this key" });
  await expect(combos).toContainText("with Y → Esc");
  await expect(combos).toContainText("falls through to the base layer's key");

  await showOverview(app);
  // the other layers have other keys there, or transparent ones, which aren't marked
  for (const [layer, count] of [[0, 4], [1, 0], [2, 0], [3, 0]]) {
    await expect(card(app, layer).locator(".key.combo")).toHaveCount(count);
  }
});

test("an edit shows in the Overview at once", async ({ app }) => {
  const index = await keyIndex(app, 0, 2); // base layer: L
  const before = await codeAt(app, 0, index);
  try {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await key.click();
    await app.getByRole("button", { name: "Change key" }).click();
    const picker = app.getByRole("dialog");
    await picker.getByLabel("Any keycode").fill("TG(3)");
    await expect(picker.locator("#any-keycode-result")).toContainText("TG(3)");
    await picker.getByRole("button", { name: "Use", exact: true }).click();
    await expect(picker).toBeHidden();
    await showOverview(app);
    await expect(card(app, 3).getByRole("button")).toHaveAccessibleName(
      "Layer 3 — reached by toggle (left top row, 3rd from the outside); one-shot (right outer thumb)");
  } finally {
    await setCodeAt(app, 0, index, before);
  }
});

/** On the 8-layer server, as on the owner's W-CORNE: the base layer's left outer thumb (Esc) becomes MO(5), and combo
 * 2 is MO(5) + OSL(3) → MO(2). Returns what puts them back. */
async function likeTheWCorne(page: Page): Promise<() => Promise<void>> {
  const escape = await keyIndex(page, 3, 3);
  const key = await codeAt(page, 0, escape);
  const combo = await comboAt(page, 2);
  const restore = async () => {
    await setCodeAt(page, 0, escape, key);
    await setCombo(page, 2, combo);
  };
  try {
    await setCodeAt(page, 0, escape, "MO(5)");
    await setCombo(page, 2, { keys: ["MO(5)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
  } catch (error) {
    await restore();
    throw error;
  }
  await page.reload(); // the UI only knows of its own edits
  await expect(page.locator("button.key").first()).toBeVisible();
  return restore;
}

async function expectFits(page: Page, width: number) {
  await expect(async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const content = (await page.locator("main.content").boundingBox())!;
    expect(content.width).toBeLessThanOrEqual(1100);
    for (const box of await Promise.all((await page.locator(".card").all()).map((c) => c.boundingBox()))) {
      expect(box!.x).toBeGreaterThanOrEqual(content.x - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(width, content.x + content.width) + 0.5);
    }
    for (const box of await Promise.all((await page.locator(".card .plate").all()).map((c) => c.boundingBox()))) {
      expect(box!.width).toBeGreaterThan(0);
    }
  }).toPass();
}

/** Waits for the keyboards to be drawn again at the window's size: they measure their width a frame after it changes */
async function settled(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Every label of the small keyboards is at least 8 px and fits on its key, once they are drawn at this width */
async function expectReadable(page: Page) {
  await settled(page);
  await expect(async () => {
    const labels = await page.locator(".card .key .tap").evaluateAll((elements) => elements
      .filter((l) => (l.textContent ?? "").trim() !== "")
      .map((l) => ({
        text: l.textContent ?? "",
        size: parseFloat(getComputedStyle(l).fontSize),
        cut: l.scrollWidth > l.clientWidth || l.scrollHeight - l.clientHeight > parseFloat(getComputedStyle(l).fontSize) * 0.3,
      })));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((l) => l.size < 8)).toEqual([]);
    expect(labels.filter((l) => l.cut)).toEqual([]);
  }).toPass();
}

test.describe("8 layers", () => {
  test("fit the Overview without scrolling sideways", async ({ eightLayers: app }) => {
    const restore = await likeTheWCorne(app);
    try {
      await showOverview(app);
      await expect(app.locator(".card")).toHaveCount(8);
      await expect(card(app, 2).getByRole("button")).toHaveAccessibleName(
        "Layer 2 — reached by hold B; hold S; combo: MO(5) + OSL(3)");
      await expect(card(app, 5).getByRole("button")).toHaveAccessibleName(
        "Layer 5 — reached by hold (left outer thumb)");
      for (const layer of [4, 6, 7]) {
        await expect(card(app, layer).getByRole("button")).toHaveAccessibleName(
          `Layer ${layer} — Nothing reaches this layer`);
        await expect(card(app, layer)).toHaveClass(/\bunreached\b/);
      }

      for (const [width, height] of [[2560, 1440], [1280, 800], [800, 900]]) {
        await app.setViewportSize({ width, height });
        await expectFits(app, width);
        const [first, second] = await Promise.all([card(app, 0).boundingBox(), card(app, 1).boundingBox()]);
        // two to a row, or one below the other where two would make the keys too small to read
        if (width >= 1280) expect(second!.y).toBe(first!.y);
        else expect(second!.y).toBeGreaterThan(first!.y + first!.height);
        await expectReadable(app);
        await screenshots(app, `overview-8-layers-${width}`, { fullPage: true });
      }
    } finally {
      await restore();
    }
  });

  test("the Inspector shows the combo on both of its keys", async ({ eightLayers: app }) => {
    const restore = await likeTheWCorne(app);
    try {
      await app.locator(`[data-ref="key:${await keyIndex(app, 3, 3)}"]`).click();
      await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText(
        "with OSL(3) → Layer 2, while held");
      await app.locator(`[data-ref="key:${await keyIndex(app, 7, 3)}"]`).click();
      await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText(
        "with MO(5) → Layer 2, while held");
      await app.getByRole("tab", { name: "4 Layer 4" }).click();
      await expect(app.getByRole("region", { name: "How Layer 4 is reached" })).toContainText(
        "Nothing reaches this layer");
      await screenshots(app, "inspector-unreached", { fullPage: true });
    } finally {
      await restore();
    }
  });
});

test.describe("screenshots", () => {
  for (const [width, height] of [[800, 900], [1280, 800], [2560, 1440]]) {
    test(`the Overview at ${width} wide`, async ({ app }) => {
      await app.setViewportSize({ width, height });
      await showOverview(app);
      await expectFits(app, width);
      await expectReadable(app);
      await screenshots(app, `overview-${width}`, { fullPage: true });
    });
  }
});

test("a keyboard with encoders and rotated keys is drawn in the Overview as pictures", async ({ macropad }) => {
  await showOverview(macropad);
  const overview = macropad.getByRole("region", { name: "Overview of the layers" });
  await expect(overview.locator(".card")).toHaveCount(4);
  await expect(overview.locator(".card .encoder")).toHaveCount(16);
  // only the cards are buttons: their keys and encoders are part of the picture
  await expect(overview.getByRole("button")).toHaveCount(4);
  await screenshots(macropad, "overview-macropad", { fullPage: true });
});
```

- [ ] **Step 4: The README**

Apply to `web/README.md`:

```diff
diff --git a/web/README.md b/web/README.md
--- a/web/README.md
+++ b/web/README.md
@@ -29,7 +29,9 @@ python vial_web.py --fake        # open the printed link; reload the page after
 ```
 
 `--fake` runs a simulated keyboard and never touches real hardware. Add `--data-dir DIR` to keep
-its lock, log and names out of your user folders.
+its lock, log and names out of your user folders. With `--fake`, `--layers N` (1 to 32) gives the
+simulated keyboard N layers (the sample keymap fills the first four, the others are empty), and
+`--definition FILE` simulates another keyboard.
 
 ## Scripts
 
@@ -52,8 +54,9 @@ CI runs `npm run check:api`.
 
 ## End-to-end tests
 
-`e2e/global-setup.ts` starts two `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
-default Corne, and `e2e/fixtures/macropad.vial.json` with encoders),
+`e2e/global-setup.ts` starts three `vial_web.py --fake --no-browser --port 0 --data-dir <temp dir>` servers (the
+default Corne; `e2e/fixtures/macropad.vial.json` with encoders; and the Corne with `--layers 8`, as the
+owner's keyboard has),
 reads the links with the session token from their output and stops them afterwards. Screenshots, each in the
 light and the dark theme (`*-light.png`, `*-dark.png`), go to `e2e/screenshots/` (not committed).
 
@@ -68,7 +71,8 @@ development machine, so no browser is downloaded there. CI installs that Chromiu
 | `src/api/` | Typed HTTP client, error messages, WebSocket events, generated schema types |
 | `src/lib/` | The keyboard store (loaded model, connection, edits), toasts, and the theme (System, Light, Dark) |
 | `src/keyboard/` | Drawing any keyboard from its geometry; key labels |
-| `src/keymap/` | Keymap Edit view: layer tabs, Inspector, hold editor, keyboard navigation |
+| `src/analysis/` | Pure functions over the loaded model: how each layer is reached, combo keys, tap dance and macro usage, finding a character or key, and the phrases for them |
+| `src/keymap/` | Keymap Edit and Overview views: layer tabs, Inspector, hold editor, keyboard navigation, layer cards, find box |
 | `src/picker/` | Keycode picker: search, categories, any-keycode entry |
 | `src/shell/` | Top bar, navigation, banners, toasts |
 | `src/ui/` | Small shared controls |
```

- [ ] **Step 5: Type-check** (`tsc -p tsconfig.node.json` covers `e2e/`)

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Build and run the e2e tests**

```bash
cd web && npm run e2e
```

Expected: `29 passed`: the 18 from main and 11 in overview.spec.ts.

- [ ] **Step 7: Commit**

```bash
git add web/README.md \
  web/e2e/fixtures.ts \
  web/e2e/global-setup.ts \
  web/e2e/overview.spec.ts
git commit -m "test(web): e2e for the Overview, combos reaching layers, the underline and 8 layers"
```

### Task 16: e2e: finding a character or key, wide fonts, and the final check

**`e2e/find.spec.ts`** runs on the simulated Corne:
- **"@"** is listed as "@ on Layer 1 …" (LSFT(KC_2)) and as "Shift + 2 on Layer 3 …". It is highlighted on cards 1 and 3, and clicking a result opens and focuses the key.
- **"ż"** says it is not on your keymap.
- **"Esc", "OSL(3)", "git" and "Del"** find a key, a tap dance, a combo, a key override and a macro.
- **"ą"**, with the Polish keyboard language, is "AltGr + A on Base (right home row, 5th from the outside)".

**The wide-font test** in `display.spec.ts` now also checks the Overview's small keys at 1280, 2560 and 800. It then finds "@", with 2 highlighted keys in the Overview, opens a result in the Edit view, and checks that no label is cut. Labels are measured in the browser's font, and Linux often uses the much wider DejaVu Sans.

**Files:**
- Create: `web/e2e/find.spec.ts`
- Modify: `web/e2e/display.spec.ts`

- [ ] **Step 1: The find tests**

Create `web/e2e/find.spec.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect, keyIndex, screenshots, test } from "./fixtures";

// Read-only: these tests change no key, so there is nothing to put back

const findBox = (page: Page) => page.getByRole("searchbox", { name: "Find a character or key" });
const results = (page: Page) => page.locator("#find-results");

test("finding @ lists Shift + 2 and the @ key, highlights them, and opens one", async ({ app }) => {
  await findBox(app).fill("@");
  await expect(results(app)).toContainText("“@”: 2 places");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "@ on Layer 1 (left top row, 3rd from the outside)",
    "Shift + 2 on Layer 3 (left home row, 3rd from the outside)",
  ]);
  // and said to screen readers
  await expect(app.getByRole("region", { name: "Find a character or key" }).getByRole("status")).toHaveText(
    "“@”: 2 places");

  // highlighted in the Overview, on the layers they are on
  await app.getByRole("radio", { name: "Overview" }).check();
  for (const [layer, count] of [[0, 0], [1, 1], [2, 0], [3, 1]]) {
    await expect(app.locator(`.card[data-layer="${layer}"] .key.found`)).toHaveCount(count);
  }
  await screenshots(app, "find-overview", { fullPage: true });

  // a result opens its key in the Edit view
  await results(app).getByRole("button", { name: /^Shift \+ 2 on Layer 3/ }).click();
  const two = app.locator(`[data-ref="key:${await keyIndex(app, 1, 2)}"]`);
  await expect(app.getByRole("tab", { name: "3 Layer 3" })).toHaveAttribute("aria-selected", "true");
  await expect(two).toHaveAttribute("aria-pressed", "true");
  await expect(two).toBeFocused();
  await expect(two).toHaveClass(/\bfound\b/);
  await screenshots(app, "find-edit");
});

test("a character that is nowhere on the keymap says so", async ({ app }) => {
  await findBox(app).fill("ż");
  await expect(results(app)).toHaveText("“ż” is not on your keymap.");
  await expect(app.locator(".key.found")).toHaveCount(0);
  await findBox(app).fill("");
  await expect(results(app)).toHaveCount(0);
});

test("keys, tap dances, combos, key overrides and macros are found by name", async ({ app }) => {
  await findBox(app).fill("Esc");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "Esc on Base (left outer thumb)",
    "tap dance 1, tap: Esc",
    "combo K + Y → Esc",
  ]);
  await findBox(app).fill("OSL(3)");
  await expect(results(app).getByRole("listitem")).toHaveText(["OSL 3 on Base (right outer thumb)"]);
  await findBox(app).fill("git");
  await expect(results(app).getByRole("listitem")).toHaveText(["macro 0 types \"git status\""]);
  await findBox(app).fill("Del");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "Del on Layer 2 (right top row, 1st from the outside)",
    "key override 0: Del instead of Bksp",
  ]);
});

test("with the Polish keyboard language, ą is AltGr + A", async ({ app }) => {
  await app.getByLabel("Keyboard language").selectOption({ label: "Polish (QWERTY)" });
  await findBox(app).fill("ą");
  await expect(results(app).getByRole("listitem")).toHaveText(["AltGr + A on Base (right home row, 5th from the outside)"]);
});
```

- [ ] **Step 2: Wide fonts in the Overview and the find views**

Apply to `web/e2e/display.spec.ts`:

```diff
diff --git a/web/e2e/display.spec.ts b/web/e2e/display.spec.ts
--- a/web/e2e/display.spec.ts
+++ b/web/e2e/display.spec.ts
@@ -43,7 +43,7 @@ test.describe("width and fit", () => {
 
   // labels are sized by measuring them in the font the browser uses, which differs between systems (Segoe UI on
   // Windows, often the much wider DejaVu Sans on Linux): a wide font must fit too
-  test("labels fit with a wide font, 800, 1280 and 2560 wide", async ({ page }) => {
+  test("labels fit with a wide font, 800, 1280 and 2560 wide, in the Edit view, the Overview and the find views", async ({ page }) => {
     const font = `Verdana, "DejaVu Sans", sans-serif`;
     await useFont(page, font);
     const app = await open(page, process.env.VIAL_URL);
@@ -54,6 +54,24 @@ test.describe("width and fit", () => {
       await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
       await screenshots(app, `keymap-wide-font-${width}`, { fullPage: true });
     }
+    // the Overview's small keys too
+    await app.getByRole("radio", { name: "Overview" }).check();
+    for (const [width, height] of [[1280, 800], [2560, 1440], [800, 900]]) {
+      await app.setViewportSize({ width, height });
+      await expect(async () => {
+        expect(await app.locator(".card .key .tap").count()).toBeGreaterThan(0);
+        expect(await labelsCutOff(app)).toEqual([]);
+      }).toPass({ timeout: 5_000 });
+      await screenshots(app, `overview-wide-font-${width}`, { fullPage: true });
+    }
+    // and with keys highlighted by the find box, in the Overview and in the Edit view it opens
+    await app.getByRole("searchbox", { name: "Find a character or key" }).fill("@");
+    await expect(app.locator(".card .key.found")).toHaveCount(2);
+    await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
+    await screenshots(app, "find-wide-font", { fullPage: true });
+    await app.locator("#find-results").getByRole("button", { name: /^Shift \+ 2/ }).click();
+    await expect(app.locator("button.key.found")).toHaveCount(1);
+    await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
   });
 });
 
```

- [ ] **Step 3: Type-check, then build and run the e2e tests**

```bash
cd web && npm run check
```

Expected: `0 ERRORS 0 WARNINGS`.

```bash
cd web && npm run e2e
```

Expected: `33 passed`: 18 from main (the wide-font test now extended), 11 Overview and 4 find.

- [ ] **Step 4: Copy the screenshots for review.** The folder is excluded from git through `.git/info/exclude`.

```bash
rm -rf /t/others/vial-gui/screenshots/phase3 && mkdir -p /t/others/vial-gui/screenshots/phase3 && cp web/e2e/screenshots/*.png /t/others/vial-gui/screenshots/phase3/ && ls /t/others/vial-gui/screenshots/phase3 | wc -l
```

Expected: `54` (light and dark).

Look at the screenshots in both themes:
- **The Overview, `overview-800`, `overview-1280`, `overview-2560`:**
  - one column at 800, two at 1280 and 2560;
  - the labels are readable;
  - "reached by" reads as instructions.
- **8 layers, `overview-8-layers-*`:** four rows of two at 1280 and 2560, no sideways scroll, and the unreached layers dashed with a warning.
- **The Inspector:**
  - `inspector-combo-*`: the combo on Space + OSL(3);
  - `inspector-unreached-*`: layer 4 unreached.
- **Encoders and rotated keys:** `overview-macropad-*`.
- **Find:** `find-overview-*`, `find-edit-*`, `find-wide-font-*`, with the highlighted keys.
- **Wide fonts:** `overview-wide-font-*` and `keymap-wide-font-*`, with nothing cut.
- **The Edit view, `keymap-800`, `keymap-1280`, `keymap-2560`:** the red underline on K, Y, M and C.

- [ ] **Step 5: Run every check once more**

```bash
cd src/main/python && QT_QPA_PLATFORM=offscreen ../../../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider test
```

Expected: `741 passed, 1 skipped`.

```bash
cd web && npm ci && npm run check && npm test && npm run build && npm run check:api && npx playwright test
```

Expected: `0 ERRORS 0 WARNINGS` and `Test Files  23 passed (23)` and `Tests  323 passed (323)` and `built in` and `src/api/schema.d.ts is up to date` and `33 passed`.

- [ ] **Step 6: Commit**

```bash
git add web/e2e/display.spec.ts \
  web/e2e/find.spec.ts
git commit -m "test(web): e2e for the find box, and wide fonts in the Overview and the find views"
```

- [ ] **Step 7: Owner checklist (the owner runs this, not you).** This is the roadmap's phase 3 checklist. Anything it finds becomes the first task of phase 4.
  1. Close the Qt Vial app. Build the UI (`cd web && npm ci && npm run build`), then run `python src/main/python/vial_web.py`.
  2. Switch the Keymap section to Overview. All 8 layers of your W-CORNE show, and the "reached by" labels match what you know about your layers.
  3. Layer 2 shows that it's reached by the MO(5) + OSL(3) combo, and the Inspector shows that combo on both keys.
  4. Find "@" and a Polish letter (with the Polish keyboard language), and check the places listed.
  5. Click a layer card and a find result: each opens the right layer and key in the Edit view.

## Roadmap coverage

| Roadmap phase 3 item | Task |
|---|---|
| `web/src/analysis/`: for each layer, which keys reach it and how (MO, TG, TO, TT, OSL, DF, LT, tap dance slots), and from which layers | 3 (`reach.ts`), 7 (phrases) |
| Combos whose output reaches a layer count as a way to it ("MO(5) + OSL(3) → layer 2"); a tap dance slot as a combo output counts too | 3; the W-CORNE case in 6; e2e in 15 |
| For each tap dance and macro, which keys use it | 5 (`usageOf`) |
| Combo member positions from the base layer, including "several keys" and "no key" | 3 (`combosOf`) |
| Warnings for unused tap dances and macros, and for layers that nothing reaches | 5 (`unusedOf`), 3 (`reachable`), 7 (`unreachedReason`), 13 (Overview) |
| Overview: every layer as a small keyboard, labelled with how it's reached ("hold Space", "one-shot (right outer thumb)", "combo: MO(5) + OSL(3)") | 4 (positions), 7, 9, 10, 13; e2e in 15 |
| Click a layer to open it in the Edit view; Edit/Overview switch at the top of the Keymap section | 11, 14; e2e in 15 |
| Find a character or key: legends of the chosen keyboard language (Shift, AltGr); tap dance slots, combo outputs, key overrides, macros; results jump to the key; highlighted in the Overview; "not on your keymap" | 8, 10, 13, 14; e2e in 16 |
| Inspector: combos using this key, with partners and output; how this layer is reached, including by combos | 12, 14; e2e in 15 |
| Red underline on combo member keys | 10, 14; e2e in 15 |
| e2e: 4 Corne layers with correct labels; a combo of two layer keys reaching a layer, on both keys in the Inspector; clicking a layer opens it; "@" lists Shift + 2 and highlights it; a character that's nowhere says so; 8 layers fit without horizontal scroll; screenshots at three widths | 15, 16 |
| Limit shown in the UI's help text: firmware-code layer switching (tri-layer, `layer_state_set_user`) isn't visible | 13 (Overview help text), `reach.ts` comment |
| Open decision: show unreached layers (default: yes, with a warning) | 13: shown, dashed, with "Nothing reaches this layer" |
| Owner's additions: 8 layers (W-CORNE uses 0–7); combos reaching layers; find a character or key | 2 (`--layers`), 6, 15; 3, 15; 8, 16 |
| Beyond the roadmap: LM and the tri-layer keys FN_MO13/FN_MO23 count as ways to a layer | 1, 3 |

## Self-review

- **Spec coverage:** every item of the roadmap's phase 3 scope maps to a task in the table above. None is left without one.
- **Placeholder scan:** every code step gives the complete file or an exact diff. Every command has its expected output. Nothing is left to be filled in later.
- **Names across tasks:** each name is defined once and used with the same signature everywhere:
  - `refId` (Task 3) is used by Tasks 4, 8, 10, 13 and 14.
  - `SlotLabel` (Task 3) is used by Tasks 5, 7 and 8.
  - `effectiveAt`, `codesOn`, `combosOf`, `comboKeysOn`, `combosUsing`, `layerReach` (Task 3), `positionNames` (Task 4) and `usageOf`/`unusedOf` (Task 5) are bundled by `analyse` (Task 6).
  - `PhraseContext`, `wayLabel`, `wayDetail`, `unreachedReason`, `comboUseLabel` and `missingPartners` (Task 7) are used by Tasks 12 and 13.
  - `foundLabel` (Task 8) is used by Task 14.
  - `Place` (Task 8) is used by Tasks 13 (`FindBox`) and 14. `findOnKeymap`, `foundKeys` and `queryOf` (Task 8) are used by Task 14.
  - `compactLegendSize` (Task 9) is used by Task 10.
  - The `Keyboard` props `combos`, `highlights`, `interactive` and `compact` (Task 10) are used by Tasks 13 and 14.
  - `readView`, `saveView` and `KeymapView` (Task 11) are used by Task 14.
- **End state:** applied in order, the tasks give exactly the verified prototype (`proto-phase3` at `d3b5347`). The plan was replayed mechanically from `main` and the result compared with it.
