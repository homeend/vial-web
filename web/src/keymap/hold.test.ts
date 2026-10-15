import { describe, expect, it } from "vitest";
import { HOLD_LAYERS, holdExpression, holdLayerCount, holdOf, tapCodeOf } from "./hold";

describe("tapCodeOf", () => {
  it("is the keycode the server says the key types when tapped", () => {
    expect(tapCodeOf({ tapCode: "KC_SPACE" })).toBe("KC_SPACE");
    expect(tapCodeOf({ tapCode: "KC_NO" })).toBe("KC_NO"); // a hold-only key, e.g. LT1(KC_NO)
  });

  it("is null for keys that can't have a hold action", () => {
    expect(tapCodeOf({ tapCode: null })).toBeNull();
    expect(tapCodeOf({})).toBeNull();
  });
});

describe("holdOf", () => {
  it("reads the layer of a layer-tap key", () => {
    expect(holdOf({ kind: "layer-tap", layer: 2, hold: "layer 2" })).toEqual({ type: "layer", layer: 2 });
  });

  it("reads the modifiers of a mod-tap key from its hold label", () => {
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Ctrl+Shift" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT"], right: false });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "AltGr" })).toEqual({ type: "mods", mods: ["ALT"], right: true });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "RCtrl+RGui" }))
      .toEqual({ type: "mods", mods: ["CTL", "GUI"], right: true });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Hyper" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT", "ALT", "GUI"], right: false });
    expect(holdOf({ kind: "mod-tap", layer: null, hold: "Meh" }))
      .toEqual({ type: "mods", mods: ["CTL", "SFT", "ALT"], right: false });
  });

  it("is null for keys without a hold action", () => {
    expect(holdOf({ kind: "basic", layer: null, hold: null })).toBeNull();
  });
});

describe("holdExpression", () => {
  it("writes a layer-tap", () => {
    expect(holdExpression("KC_SPACE", { type: "layer", layer: 1 })).toBe("LT(1, KC_SPACE)");
    expect(holdExpression("KC_NO", { type: "layer", layer: 15 })).toBe("LT(15, KC_NO)");
  });

  it("refuses a layer a layer-tap can't hold", () => {
    expect(() => holdExpression("KC_A", { type: "layer", layer: 16 })).toThrow(RangeError);
    expect(() => holdExpression("KC_A", { type: "layer", layer: -1 })).toThrow(RangeError);
    expect(() => holdExpression("KC_A", { type: "layer", layer: 1.5 })).toThrow(RangeError);
  });

  it("writes a mod-tap with left or right modifiers", () => {
    expect(holdExpression("KC_A", { type: "mods", mods: ["CTL", "SFT"], right: false }))
      .toBe("MT(MOD_LCTL | MOD_LSFT, KC_A)");
    expect(holdExpression("KC_E", { type: "mods", mods: ["ALT"], right: true })).toBe("MT(MOD_RALT, KC_E)");
  });

  it("is just the tapped keycode without a hold action", () => {
    expect(holdExpression("KC_A", null)).toBe("KC_A");
    expect(holdExpression("KC_A", { type: "mods", mods: [], right: false })).toBe("KC_A");
  });
});

describe("holdLayerCount", () => {
  it("is the keyboard's layers, up to the 16 a layer-tap can hold", () => {
    expect(HOLD_LAYERS).toBe(16);
    expect(holdLayerCount(4)).toBe(4);
    expect(holdLayerCount(16)).toBe(16);
    expect(holdLayerCount(32)).toBe(16);
  });
});
