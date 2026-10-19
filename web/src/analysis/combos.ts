// Combos: which keys they are made of. A combo is a list of keycodes, not of keys: QMK fires it when keys with those
// keycodes (on the active layers) are pressed together. So its keys are found by looking its keycodes up.
import type { Described, KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { actionAt, refId, type KeyRef } from "../keyboard/refs";
import { membersOf } from "../behaviours/members";
import { effectiveAt } from "./effective";

type Model = Pick<KeyboardModel, "layers" | "combos">;

interface ComboMember {
  action: Described;
  /** the keys with this keycode on the base layer: none, one, or several */
  keys: KeyRef[];
}

export interface ComboInfo {
  index: number;
  /** its keycodes, up to its first empty slot (KC_NO), as the firmware reads them (see membersOf) */
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
    const keys = codes.get(code);
    if (keys) keys.push(ref);
    else codes.set(code, [ref]);
  }
  return codes;
}

/** The combos that have at least one keycode (up to the first empty slot, see membersOf), each keycode with the keys
 * that have it on the base layer. Not quite the combos that are set up (members.isSet), which also counts a combo
 * with an output and no keycode: that one gets a card and counts in the navigation, as there is something in it to
 * see and change; but with no keycode it has no keys to mark, no layer it fires on, and nothing to analyse. */
export function combosOf(model: Model, placement: Placement): ComboInfo[] {
  const base = model.layers.length > 0 ? codesOn(model, placement, 0) : new Map<string, KeyRef[]>();
  return model.combos
    .map((combo) => ({
      index: combo.index,
      members: membersOf(combo).map((action) => ({ action, keys: base.get(action.code) ?? [] })),
      output: combo.output,
    }))
    .filter((combo) => combo.members.length > 0);
}

/** The keycodes a combo lists more than once, each once. Such a combo never fires: QMK matches a pressed keycode to
 * one of the combo's slots only, so the other slot it is in never counts as pressed. */
export function repeatedCodes(combo: ComboInfo): Described[] {
  const seen = new Set<string>();
  const repeated = new Map<string, Described>();
  for (const { action } of combo.members) {
    if (seen.has(action.code)) repeated.set(action.code, action);
    seen.add(action.code);
  }
  return [...repeated.values()];
}

/** The layers on which a combo can fire: those where every one of its keycodes is on some key (none for a combo
 * that lists a keycode twice, see repeatedCodes) */
export function comboLayers(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[]): number[] {
  if (repeatedCodes(combo).length > 0) return [];
  return layerCodes.flatMap((codes, layer) => (combo.members.every((m) => codes.has(m.action.code)) ? [layer] : []));
}

/** The keys that are part of a combo on a layer, by refId, each with the combos (their indexes, in order) it is part
 * of: the keys whose keycode there is one of a combo's. A transparent key isn't marked (it would mark every empty
 * layer); the combo goes through it all the same. Nor are the keys of a combo that lists a keycode twice: it never
 * fires (see repeatedCodes). codes must be the same layer's: codesOn(model, placement, layer). */
export function comboMarksOn(
  combos: ComboInfo[],
  codes: Map<string, KeyRef[]>,
  model: Pick<KeyboardModel, "layers">,
  layer: number,
): Map<string, number[]> {
  const marks = new Map<string, number[]>();
  for (const combo of combos) {
    if (repeatedCodes(combo).length > 0) continue;
    for (const member of combo.members) {
      for (const ref of codes.get(member.action.code) ?? []) {
        if (actionAt(model, layer, ref)?.kind === "transparent") continue;
        const id = refId(ref);
        const on = marks.get(id) ?? [];
        if (!on.includes(combo.index)) on.push(combo.index);
        marks.set(id, on);
      }
    }
  }
  return marks;
}

/** How many colours combos are marked in (app.css: --combo-0 to --combo-5) */
export const COMBO_COLOURS = 6;

/** The colour of each combo (an index into the palette), by combo index: the same everywhere it is shown. A combo
 * has its own colour, its number round the palette (combo 7 of 6 colours: colour 1), so that setting or clearing
 * another combo doesn't recolour it. Different combos with keys on the same layer get different colours though: in
 * combo order, a combo whose own colour a combo before it with keys on one of its layers has takes the palette's
 * first colour none of those have. (Only then can another combo change its colour.) With more such combos than
 * colours, it keeps its own colour. marks: by layer, as comboMarksOn gives them. */
export function comboColours(combos: ComboInfo[], marks: Map<string, number[]>[], size = COMBO_COLOURS): Map<number, number> {
  const layersOf = new Map<number, Set<number>>(combos.map((c) => [c.index, new Set<number>()]));
  marks.forEach((onLayer, layer) => {
    for (const indexes of onLayer.values()) for (const index of indexes) layersOf.get(index)?.add(layer);
  });
  const colours = new Map<number, number>();
  for (const combo of [...combos].sort((a, b) => a.index - b.index)) {
    const layers = layersOf.get(combo.index) ?? new Set<number>();
    const taken = new Set<number>();
    for (const [other, colour] of colours) {
      if ([...(layersOf.get(other) ?? [])].some((l) => layers.has(l))) taken.add(colour);
    }
    const own = combo.index % size;
    const free = taken.has(own) ? Array.from({ length: size }, (_, c) => c).find((c) => !taken.has(c)) : own;
    colours.set(combo.index, free ?? own);
  }
  return colours;
}

export interface ComboUse {
  combo: ComboInfo;
  /** the combo's other keycodes, each with its keys on the layer (none when the layer lacks it) */
  partners: { action: Described; keys: KeyRef[] }[];
}

/** The combos a key is part of on a layer, through the keycode it has there. codes must be the same layer's:
 * codesOn(model, placement, layer). */
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
