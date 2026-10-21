# Arrange layers: design

_2026-10-21. Agreed with the owner in a brainstorming session. Built as phase 8, after phase 6 (phase 7, the
flasher, stays optional)._

## The problem

The owner wanted to change the order of some layers. Today that means editing each key of each layer by hand, and
then every key that reaches a layer by its number (`MO(2)`, `LT(3, Space)`, …). That is too slow to be worth doing.

## Decisions

| Question | Decision |
|---|---|
| The operation | **Move** a layer to another position; the layers in between shift by one. A swap is one or two moves, so there is no separate swap. Copying a layer is out of scope. |
| Keys that point at a layer | **They follow it.** Every layer reference is renumbered, so the keyboard behaves as before and only the order changes. The layer names move with their layers. |
| Where | An **Arrange layers** dialog: reorder freely, see what will change, then **Apply** once. One **Undo** reverses it. |
| Layer 0 | **Fixed.** It stays first; no layer can be moved into position 0. The keyboard starts on layer 0, and this keeps Base the base. |
| How | **The server** computes the new state and writes it (approach A). The web page only chooses the order and shows the server's preview. |

Rejected: writing each key from the page (over 100 requests, the page would have to roll back by itself, keycode bit
layouts duplicated in TypeScript); building a `.vil` in the page and loading it (names aren't in `.vil`, and its
preview is built around a file).

## 1. The dialog (web)

**Opening it:** an **Arrange layers…** button at the end of the layer tabs in the Edit view (`LayerTabs.svelte`, next
to the rename pencil), and the same button above the layer cards in the Overview. It is disabled when editing is
(`keyboard.canEdit` false: after Quit, while stopped, …), with a tooltip that says why. A keyboard with fewer than
three layers has nothing to arrange (layer 0 is fixed): the button is disabled with a tooltip that says so.

**Before it opens:** work not saved in this tab (`unsavedWork`: a combo being edited, the Settings page's changes,
lighting not saved) makes Arrange ask first, as Quit and the keyboard switch do.

**Inside:**

```
┌ Arrange layers ───────────────────────────────────────┐
│  0  Base      🔒 always first                         │
│  1  ⠿ Nav     ← was 3          [↑] [↓]                │
│  2  ⠿ Sym     ← was 1          [↑] [↓]                │
│  3  ⠿ Num     ← was 2          [↑] [↓]                │
│                                                       │
│  Will change: 3 layers move · 96 keys rewritten ·     │
│  12 layer keys renumbered (8 keymap, 2 combos,        │
│  2 tap dances) · 1 key override's layers              │
│  ⚠ FN_MO13 / FN_MO23 always use layers 1–3: after     │
│    this they reach Nav and Sym instead of Sym and Num │
│                                                       │
│        Nothing is written until you Apply.            │
│                        [Reset]  [Cancel]  [Apply]     │
└───────────────────────────────────────────────────────┘
```

- Each row: the position, the layer's name, "← was N" once it moved, and under the name one short line of how the
  layer is reached ("hold Space", "combo J+K"), from the Overview's analysis (`analysis/reach.ts`,
  `analysis/phrases.ts`), so layers can be told apart by more than their names.
- Reordering: drag a row by its ⠿ handle; ↑/↓ buttons move a row one step; with a row focused, Alt+↑ / Alt+↓ do
  the same. Layer 0 is shown first with a lock and takes no part.
- The summary is the server's preview (section 2) of the order shown. It is asked for after each change, after a
  short pause (about 300 ms) so that quick moves make one request; a newer answer replaces an older one, and an
  answer for an order no longer shown is dropped.
  - **Warnings** show and don't block Apply (the tri-layer case).
  - **Problems** disable Apply and say why (a layer number that doesn't fit; see section 2).
  - When the order is the current one, the summary says "Nothing to change" and Apply is disabled.
- **Reset** returns to the current order. **Cancel** or Esc closes the dialog and writes nothing.
- **Apply:** the buttons turn into "Writing 96 keys…" (the preview's count; no live counter). When it ends, the
  dialog closes and a toast says "Layers arranged" with **Undo**. The Edit view stays on the same layer, not the same
  number: whoever looked at Nav still sees Nav, at its new position.
- **Unlock:** when the preview says `needsUnlock` (a key that needs the keyboard unlocked, such as `QK_BOOT`, must be
  rewritten), Apply runs the existing unlock flow first, as `.vil` load does.
- Layout rules as everywhere: fits a 1080p window, no sideways scroll at 375 px, both themes, a visible focus that is
  never left on `<body>`, long names cut with "…" and shown whole in a tooltip, Firefox-safe CSS.

## 2. The server

### `server/layers.py` (new; pure functions, no I/O)

- **`renumber(code, mapping, protocol)`**: the keycode with its layer number changed through `mapping` (old layer →
  new layer), or the same keycode when it holds no layer number.
  - "Holds a layer number" is defined once, with `describe.py`'s ranges (`_REFERENCES_V6` / `_REFERENCES_V5`): MO,
    TG, TO, TT, OSL, DF, PDF, `LT`, and LM with its own bit layout on each protocol (layer in bits 5–8 on protocol 6,
    bits 4–7 on protocol 5). `describe.py` and `layers.py` share these definitions; none is copied.
  - A new number that doesn't fit the keycode's field (LT and LM: layers 0–15 on protocol 6) is a **problem**, never
    a guess.
  - `FN_MO13` / `FN_MO23` are not renumbered: the firmware fixes them to layers 1, 2 and 3.
- **`arrange(state, order)`** → the target state, a summary, warnings and problems.
  - `order[new position] = old layer`: `[0, 3, 1, 2]` puts the old layer 3 at position 1. Refused unless it holds
    every layer exactly once and `order[0] == 0`.
  - The target:
    - **keymap and encoders:** each layer's contents at its new position, every keycode renumbered;
    - **tap dance:** its four keycodes (tap, hold, double tap, tap-hold), renumbered;
    - **combos:** the trigger keys and the output, renumbered;
    - **key overrides:** the trigger and the replacement renumbered, and the *active on layers* mask's bits moved to
      the new positions. A layer that is in a mask and would move past bit 15 is a problem;
    - **alt-repeat:** the keycode and the alt keycode, renumbered;
    - **macros:** every keycode of every step (tap, down, up), renumbered.
  - The summary: which layers move (old → new), how many keys are rewritten (keymap + encoders), how many layer
    references are renumbered in each place, and how many key overrides' layers change.
  - Warning: a tri-layer key (`FN_MO13` / `FN_MO23`) is anywhere in the keymap, encoders, tap dance, combos, key
    overrides, alt-repeat or macros while any of layers 1–3 moves. The warning says what they reach before and after.
  - Warning: a PDF key (anywhere a keycode can be) points at a layer that moves (`savedDefault`: the layers, old →
    new). PDF(n) saves layer n in the keyboard's EEPROM as the layer it starts on (vial-qmk `process_default_layer.c`
    → `set_single_persistent_default_layer`), which Vial can't read or write: if one was pressed, press it again after
    Apply. Protocol 6 only: protocol 5 firmware has no PDF.
- Nothing else that Vial reads or writes has layer numbers: QMK settings, lighting and layout options are left alone.
  The keyboard itself holds a few Vial can't reach: the start-up default layer a PDF key saved (the warning above),
  and, until it restarts, the layers switched on at Apply (TG) and the default set by DF, which keep their old numbers.

### Routes (`server/app.py`)

- **`POST /api/layers/arrange/preview`** `{order}` → `{moves, keys, references, keyOverrides, warnings, problems,
  needsUnlock}`. Writes nothing.
- **`POST /api/layers/arrange`** `{order}` → the new full state, as `POST /api/layout-file` returns it. Computes the
  target again from the keyboard's current state (never from the preview), refuses (409) when it has problems, then
  writes it (section 3).
- Added in the end batch: each keyboard's `layoutVersion` (in memory, counted up by every arrange, Finish, Put back
  and `.vil` load, also one stopped partway) is in the session, the preview and the responses of Apply, Finish and Put
  back (which also say how many changes made since a stop they `kept`). Apply with `expect` set to another version is
  refused (409, code `layoutChanged`), so an Undo or a dialog shown before another tab's arrange can't apply twice.
- Both check `X-Vial-Keyboard` like every keyboard route, so a keyboard switch in between is refused.
- Request and response models go in `server/schemas.py`; the OpenAPI schema and `web/src/api/schema.d.ts` are
  regenerated with them.

### Layer names (`server/names.py`)

- **`NamesStore.move_layers(uid, order)`** moves the layer names in one atomic write of `names.json`.
- A layer never named keeps no name, so it shows its new position's default name ("Layer 3" moved to position 1
  shows "Layer 1"); the dialog's "← was 3" makes that clear.

## 3. Writing, failures and Undo

**Writing.** Apply reads the current state S, computes the target T, and writes only what differs, under one device
lock (as `.vil` load does): keymap and encoders first; then tap dance, combos, key overrides, alt-repeat; then macros
(one buffer write); last, the layer names. Names are saved only once every write has succeeded, so a failure never
leaves names on the wrong contents. Other tabs' edits wait for the lock; when it ends, every tab gets the new state
through the existing broadcast (`{"type": "reloaded"}`).

**A write fails partway** (unplugged, no answer):

- The server re-reads the keyboard (as `.vil` load does) and keeps S and T in memory for that keyboard's UID while
  Vial runs.
- The dialog stays open: "Arranging stopped after 40 of 96 writes. The keyboard has part of the new order." Two
  buttons:
  - **Finish**: write what still differs from T, then the names;
  - **Put back**: write what differs from S (names were never changed).
- Both make the keyboard match a fixed state, so either can be retried as often as needed and nothing is
  renumbered twice.
- Closing the dialog leaves a bar in the Edit view with the same two buttons until one of them succeeds. After a
  replug, the buttons work as long as Vial still runs.
- Routes: **`POST /api/layers/arrange/finish`** and **`POST /api/layers/arrange/put-back`**, each 404 when no
  arrange of this keyboard is left unfinished. `GET /api/session` (or the state it returns) says whether one is, so
  that a reloaded tab shows the bar too.

**Undo.** The toast's Undo runs Arrange with the reverse order. Because it renumbers rather than restores a copy, it
stays right even after keys were changed in between: an edited key goes back with its layer. Undo is offered until the
toast closes or the next arrange; after that, the dialog puts layers back by hand.

**Not included:** a live write counter, a general undo history, copying layers.

## 4. Tests

**pytest (against the simulator):**

- `renumber`: each family on protocols 5 and 6, at the edges (layer 15 for LT/LM, 31 for the others); keycodes next
  to those ranges unchanged; a number that doesn't fit is a problem; `FN_MO13` / `FN_MO23` unchanged.
- `arrange`: refused orders (repeated layer, missing layer, layer 0 not first); every place with layer numbers
  (keymap, encoders, tap dance, combos, key overrides and their masks, alt-repeat, macros); the tri-layer warning;
  a mask bit past 15.
- Round trip, over many random orders and random states: arranging and then applying the reverse order gives back
  exactly the start, names included.
- Routes: the preview writes nothing (the simulator's write log stays empty); Apply writes only the differences; a
  keyboard switch in between is refused; unlock comes first when `QK_BOOT` must be rewritten.
- Failure: a write fails partway; Finish reaches T, Put back reaches S, each can be retried, and the names follow
  only on Finish.
- Encoders with a definition that has encoders (the simulated Corne has none).

**Vitest:** the dialog's order logic (↑/↓, Alt+↑/↓, Reset, the reverse order for Undo, the preview's stale-answer
rule) and the summary's wording.

**Playwright (against `--fake` servers):** open the dialog, reorder by drag and by keyboard, Apply, then check tabs,
names and keys; Undo; Esc writes nothing; the failure bar's Finish and Put back. If the simulator has no way to make a
write fail, a switch that only `--fake` has is added for it.

**Screenshots** in both themes, 375 → 2560 px, in `screenshots/phase8/`.

## How it is built

As every phase: prototype → plan → one implementer per task with a spec review and a quality review → fix batches →
final review → merge to `main` and push to `origin` → the owner's checklist on the W-CORNE.

Agents never use the owner's keyboard: everything runs against `--fake`. This feature writes to the keyboard, so the
owner is the first to use it on real hardware. The checklist starts with a harmless case: move one layer, check it,
then Undo.
