// What a key does on a layer, once transparent keys have fallen through.
import type { Described, KeyboardModel } from "../api/types";
import { actionAt, type KeyRef } from "../keyboard/refs";

interface Effective {
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
