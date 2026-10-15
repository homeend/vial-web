import { describe, expect, it } from "vitest";
import { holdExpression, holdOf, tapCodeOf } from "./hold";

describe("tapCodeOf", () => {
  it("finds the tapped keycode of keys that can get a hold action", () => {
    expect(tapCodeOf("LT1(KC_SPACE)")).toBe("KC_SPACE");
    expect(tapCodeOf("LSFT_T(KC_T)")).toBe("KC_T");
    expect(tapCodeOf("C_S_T(KC_A)")).toBe("KC_A");
    expect(tapCodeOf("KC_A")).toBe("KC_A");
  });

  it("is null for keys that can't", () => {
    expect(tapCodeOf("TD(0)")).toBeNull();
    expect(tapCodeOf("LCTL(KC_C)")).toBeNull();
    expect(tapCodeOf("MO(1)")).toBeNull();
    expect(tapCodeOf("KC_TRNS")).toBeNull();
    expect(tapCodeOf("KC_NO")).toBeNull();
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
