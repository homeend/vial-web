// Everything the keymap views show about a keyboard beyond its keys, worked out in the browser from the loaded model,
// so it follows every edit at once.
import type { KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { refId, type KeyRef } from "../keyboard/refs";
import { codesOn, comboColours, comboMarksOn, combosOf, type ComboInfo } from "./combos";
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
  /** by layer: the keys (refIds) that are part of a combo there, each with the combos (indexes) it is part of */
  comboMarks: Map<string, number[]>[];
  /** each set combo's colour (a palette index), by combo index */
  comboColours: Map<number, number>;
  usage: Usage;
  unused: Unused;
}

export function analyse(model: KeyboardModel, placement: Placement): Analysis {
  const combos = combosOf(model, placement);
  const codes = model.layers.map((_, layer) => codesOn(model, placement, layer));
  const usage = usageOf(model, placement);
  const comboMarks = codes.map((c, layer) => comboMarksOn(combos, c, model, layer));
  return {
    positions: positionNames(placement),
    reach: layerReach(model, placement),
    combos,
    codes,
    comboMarks,
    comboColours: comboColours(combos, comboMarks),
    usage,
    unused: unusedOf(model, usage),
  };
}

/** For each placed key, the combos it is part of on a layer (their indexes) and their colours */
export function comboMarksOf(analysis: Pick<Analysis, "comboMarks" | "comboColours">, placement: Placement, layer: number):
  { combos: number[][]; colours: number[][] } {
  const combos = placement.items.map((item) => analysis.comboMarks[layer]?.get(refId(item)) ?? []);
  return { combos, colours: combos.map((list) => list.map((i) => analysis.comboColours.get(i) ?? 0)) };
}
