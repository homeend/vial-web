// Pointing at one key or encoder direction of a keyboard.
import type { Described, KeyboardModel } from "../api/types";

/** A key or an encoder direction: an index into KeyboardModel.keys or .encoders */
export interface KeyRef {
  kind: "key" | "encoder";
  index: number;
}

/** What a key or encoder direction does on a layer */
export function actionAt(model: Pick<KeyboardModel, "layers">, layer: number, ref: KeyRef): Described | undefined {
  const l = model.layers[layer];
  return ref.kind === "key" ? l?.keys[ref.index] : l?.encoders[ref.index];
}

/** { what: "Key", where: "row 1, column 2" } or { what: "Encoder 0", where: "clockwise" };
 * { what: "Key", where: "not found" } for one that no longer exists (another keyboard, other layout options) */
export function whereIs(model: Pick<KeyboardModel, "keys" | "encoders">, ref: KeyRef): { what: string; where: string } {
  if (ref.kind === "key") {
    const g = model.keys[ref.index];
    return { what: "Key", where: g ? `row ${g.row}, column ${g.col}` : "not found" };
  }
  const g = model.encoders[ref.index];
  if (!g) return { what: "Encoder", where: "not found" };
  return { what: `Encoder ${g.encoder}`, where: g.direction === 1 ? "clockwise" : "counter-clockwise" };
}

/** "row 0 · column 0 · Base layer", "encoder 0 · clockwise · Layer 2"; "" for one that no longer exists */
export function positionLine(model: Pick<KeyboardModel, "keys" | "encoders">, ref: KeyRef, layerName: string): string {
  if (!(ref.kind === "key" ? model.keys : model.encoders)[ref.index]) return "";
  // "Base layer", but "Layer 2" and "Nav layer" as they are
  const layer = /^layer\b|\blayer\s*$/i.test(layerName) ? layerName : `${layerName} layer`;
  if (ref.kind === "key") {
    const g = model.keys[ref.index];
    return `row ${g.row} · column ${g.col} · ${layer}`;
  }
  const { what, where } = whereIs(model, ref);
  return `${what.toLowerCase()} · ${where} · ${layer}`;
}
