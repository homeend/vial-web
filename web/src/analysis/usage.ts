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
  /** a step of another macro (by index in its actions), which taps, presses or releases it */
  | { type: "macro"; macro: number; step: number }
  | { type: "key-override"; keyOverride: number; part: "trigger" | "replacement" }
  | { type: "alt-repeat"; altRepeat: number; part: "keycode" | "alt keycode" };

export interface Usage {
  /** by tap dance index; every tap dance has an entry */
  tapDances: Use[][];
  /** by macro index; every macro has an entry */
  macros: Use[][];
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "macros">;

/** Which keys (on the keyboard as drawn: the chosen layout options), combos, tap dances, macros, key overrides and
 * alt repeat keys use each tap dance and macro.
 * - A combo with no keycodes is an unused entry, not a combo: its output isn't a use (combosOf leaves it out too).
 * - A tap dance running itself from one of its slots doesn't count, nor does a macro running itself from a step.
 * - A disabled key override or alt repeat key still counts: it is set up, only switched off. */
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
    if (combo.keys.every((k) => k.kind === "none")) continue;
    for (const key of combo.keys) note(key, { type: "combo", combo: combo.index, part: "key" });
    note(combo.output, { type: "combo", combo: combo.index, part: "output" });
  }
  for (const td of model.tapDance) {
    for (const { label, action } of tapDanceSlots(td)) {
      if (action.kind === "tap-dance" && action.index === td.index) continue;
      note(action, { type: "tap-dance", tapDance: td.index, slot: label });
    }
  }
  for (const macro of model.macros.items) {
    macro.actions.forEach((action, step) => {
      for (const key of action.keys) {
        if (key.kind === "macro" && key.index === macro.index) continue;
        note(key, { type: "macro", macro: macro.index, step });
      }
    });
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
