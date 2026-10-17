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
