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
