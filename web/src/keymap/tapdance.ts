// Tap dances as the keymap shows them: what a tap dance key does, and finding a free one.
import type { Described, KeyboardModel, TapDance } from "../api/types";

type Model = Pick<KeyboardModel, "tapDance" | "layers" | "combos" | "keyOverrides" | "altRepeatKeys">;

/** Every keycode of the keyboard that can run a tap dance: keys and encoders on every layer, combos (keys and
 * output), key overrides (trigger and replacement), alt repeat keys (both keycodes) and tap dances (every slot) */
function everyAction(model: Model): Described[] {
  return [
    ...model.layers.flatMap((layer) => [...layer.keys, ...layer.encoders]),
    ...model.combos.flatMap((combo) => [...combo.keys, combo.output]),
    ...model.keyOverrides.flatMap((o) => [o.trigger, o.replacement]),
    ...model.altRepeatKeys.flatMap((a) => [a.keycode, a.altKeycode]),
    ...model.tapDance.flatMap((td) => tapDanceSlots(td).map((slot) => slot.action)),
  ];
}

/** The first tap dance with nothing in it that nothing uses (no key, encoder, combo, key override, alt repeat key
 * or tap dance), or null */
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

/** The four ways of pressing a tap dance key, and what each does */
export function tapDanceSlots(td: TapDance): { label: SlotLabel; action: Described }[] {
  return [
    { label: "Tap", action: td.tap },
    { label: "Hold", action: td.hold },
    { label: "Double tap", action: td.doubleTap },
    { label: "Tap, then hold", action: td.tapHold },
  ];
}
