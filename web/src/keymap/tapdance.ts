// Tap dances as the keymap shows them: what a tap dance key does, and finding a free one.
import type { Described, KeyboardModel, TapDance } from "../api/types";

type Model = Pick<KeyboardModel, "tapDance" | "layers" | "combos" | "keyOverrides" | "altRepeatKeys" | "macros">;

/** Every keycode of the keyboard that can run a tap dance: keys and encoders on every layer, combos (keys and
 * output), key overrides (trigger and replacement), alt repeat keys (both keycodes), tap dances (every slot) and
 * macros (every step that taps, presses or releases keycodes) */
function everyAction(model: Model): Described[] {
  return [
    ...model.layers.flatMap((layer) => [...layer.keys, ...layer.encoders]),
    ...model.combos.flatMap((combo) => [...combo.keys, combo.output]),
    ...model.keyOverrides.flatMap((o) => [o.trigger, o.replacement]),
    ...model.altRepeatKeys.flatMap((a) => [a.keycode, a.altKeycode]),
    ...model.tapDance.flatMap((td) => tapDanceSlots(td).map((slot) => slot.action)),
    ...model.macros.items.flatMap((m) => m.actions.flatMap((a) => a.keys)),
  ];
}

/** The first tap dance with nothing in it that nothing uses (no key, encoder, combo, key override, alt repeat key,
 * tap dance or macro), or null */
export function freeTapDance(model: Model): number | null {
  const used = new Set<number>();
  for (const d of everyAction(model)) {
    if (d.kind === "tap-dance" && d.index != null) used.add(d.index);
  }
  const free = model.tapDance.find((td) =>
    !used.has(td.index) && tapDanceSlots(td).every((slot) => slot.action.kind === "none"));
  return free ? free.index : null;
}

/** The four ways of pressing a tap dance key */
export type SlotLabel = "Tap" | "Hold" | "Double tap" | "Tap, then hold";

/** Whether a slot's own way of pressing ends with the key held: Hold, and Tap, then hold */
export function isHeldSlot(slot: SlotLabel): boolean {
  return slot === "Hold" || slot === "Tap, then hold";
}

/** Whether some way of pressing a tap dance keeps a slot's keycode down while the key stays held, so that a layer it
 * holds while held (MO, LM, a layer-tap with nothing to tap) is on. As vial-qmk's on_dance_finished (vial.c) runs
 * them:
 * - Hold, and Tap, then hold: by their own way of pressing.
 * - Tap: by tapping and holding the key (one press, held), but only while Hold is empty: holding runs Hold when it is
 *   set (any keycode, transparent too). A plain tap presses Tap and lets it go at once. A double tap and hold with
 *   Tap, then hold empty taps Tap, then holds Hold, or Tap when Hold is empty: no other way.
 * - Double tap: never. It runs once the key is let go after the second tap, and is let go at once; a double tap and
 *   hold runs Tap, then hold (or the above), never Double tap.
 * Another key pressed while the tap dance key is still down, before its tapping term ends, holds Tap too (after one
 * press, or tapped then held after two), whatever Hold is: that isn't counted, as it isn't a way of pressing it one
 * chooses. */
export function slotCanBeHeld(td: TapDance, slot: SlotLabel): boolean {
  if (isHeldSlot(slot)) return true;
  return slot === "Tap" && td.hold.kind === "none";
}

/** The four ways of pressing a tap dance key, and what each does */
export function tapDanceSlots(td: TapDance): { label: SlotLabel; action: Described }[] {
  return [
    { label: "Tap", action: td.tap },
    { label: "Hold", action: td.hold },
    { label: "Double tap", action: td.doubleTap },
    { label: "Tap, then hold", action: td.tapHold },
  ];
}
