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
