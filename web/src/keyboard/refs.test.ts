import { describe, expect, it } from "vitest";
import type { Described, KeyGeometry, KeyboardModel } from "../api/types";
import { actionAt, positionLine, refId, whereIs } from "./refs";

const d = (code: string): Described => ({
  code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
  description: null,
});
const g = (fields: Partial<KeyGeometry>) => ({ x: 0, y: 0, w: 1, h: 1, ...fields }) as KeyGeometry;

const model = {
  keys: [g({ row: 2, col: 3 })],
  encoders: [g({ encoder: 0, direction: 0 }), g({ encoder: 0, direction: 1 })],
  layers: [
    { keys: [d("KC_A")], encoders: [d("KC_VOLD"), d("KC_VOLU")] },
    { keys: [d("KC_B")], encoders: [d("KC_TRNS"), d("KC_MNXT")] },
  ],
} as unknown as KeyboardModel;

describe("actionAt", () => {
  it("is what a key or encoder direction does on a layer", () => {
    expect(actionAt(model, 1, { kind: "key", index: 0 })?.code).toBe("KC_B");
    expect(actionAt(model, 0, { kind: "encoder", index: 1 })?.code).toBe("KC_VOLU");
    expect(actionAt(model, 5, { kind: "key", index: 0 })).toBeUndefined();
  });
});

describe("refId", () => {
  it("is a key's or encoder direction's identity as one string", () => {
    expect(refId({ kind: "key", index: 3 })).toBe("key:3");
    expect(refId({ kind: "encoder", index: 0 })).toBe("encoder:0");
  });
});

describe("whereIs", () => {
  it("names a key by its matrix position and an encoder by its direction", () => {
    expect(whereIs(model, { kind: "key", index: 0 })).toEqual({ what: "Key", where: "row 2, column 3" });
    expect(whereIs(model, { kind: "encoder", index: 0 })).toEqual({ what: "Encoder 0", where: "counter-clockwise" });
    expect(whereIs(model, { kind: "encoder", index: 1 })).toEqual({ what: "Encoder 0", where: "clockwise" });
  });

  it("says so for a key or encoder that no longer exists", () => {
    expect(whereIs(model, { kind: "key", index: 9 })).toEqual({ what: "Key", where: "not found" });
    expect(whereIs(model, { kind: "encoder", index: 9 })).toEqual({ what: "Encoder", where: "not found" });
  });
});

describe("positionLine", () => {
  it("says where the key is and on which layer, in small words", () => {
    expect(positionLine(model, { kind: "key", index: 0 }, "Base")).toBe("row 2 · column 3 · Base layer");
    expect(positionLine(model, { kind: "key", index: 0 }, "Layer 3")).toBe("row 2 · column 3 · Layer 3");
    expect(positionLine(model, { kind: "encoder", index: 1 }, "Nav")).toBe("encoder 0 · clockwise · Nav layer");
  });

  it("doesn't say layer twice", () => {
    expect(positionLine(model, { kind: "key", index: 0 }, "Nav layer")).toBe("row 2 · column 3 · Nav layer");
    expect(positionLine(model, { kind: "key", index: 0 }, "Gaming LAYER")).toBe("row 2 · column 3 · Gaming LAYER");
    expect(positionLine(model, { kind: "key", index: 0 }, "Multilayer")).toBe("row 2 · column 3 · Multilayer layer");
  });

  it("is empty for a key or encoder that no longer exists", () => {
    expect(positionLine(model, { kind: "key", index: 9 }, "Base")).toBe("");
    expect(positionLine(model, { kind: "encoder", index: 9 }, "Base")).toBe("");
  });
});
