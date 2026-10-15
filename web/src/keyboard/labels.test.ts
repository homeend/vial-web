import { describe, expect, it } from "vitest";
import type { Described } from "../api/types";
import { actionSummary, holdSize, keyFace, keyTitle, legendScale, legendSizes, toneOf, type Names } from "./labels";

type Fields = Partial<Described> & Pick<Described, "code" | "kind" | "tap">;

function d(fields: Fields): Described {
  return {
    hold: null, layer: null, layerAction: null, index: null, description: null,
    legend: { main: fields.tap, shifted: null, altGr: null },
    ...fields,
  };
}

const names: Names = {
  layer: (i) => ["Base", "Symbols", "Layer 2"][i] ?? `Layer ${i}`,
  layerIsNamed: (i) => i === 1,
  tapDance: (i) => (i === 0 ? "Tab / Caps Lock" : ""),
  macro: (i) => (i === 0 ? "git status" : ""),
};

const layerTap = d({ code: "LT1(KC_SPACE)", kind: "layer-tap", tap: "Space", hold: "layer 1", layer: 1, layerAction: "while held" });
const modTap = d({ code: "LSFT_T(KC_T)", kind: "mod-tap", tap: "T", hold: "Shift" });

describe("toneOf", () => {
  it.each([
    ["basic", "normal"], ["mod-tap", "mod"], ["modifier", "mod"], ["one-shot-mod", "mod"],
    ["layer", "layer"], ["layer-tap", "layer"], ["tap-dance", "tap-dance"], ["macro", "macro"],
    ["transparent", "transparent"], ["none", "none"], ["media", "normal"], ["other", "normal"],
  ] as const)("%s keys are %s", (kind, tone) => {
    expect(toneOf(kind)).toBe(tone);
  });
});

describe("keyFace", () => {
  it("shows the legend big and nothing small for a plain key", () => {
    const one = d({ code: "KC_1", kind: "basic", tap: "1", legend: { main: "1", shifted: "!", altGr: null } });
    expect(keyFace(one, names)).toEqual({ main: "1", shifted: "!", altGr: null, hold: null, tone: "normal" });
  });

  it("names the layer a layer-tap key holds", () => {
    const face = keyFace(layerTap, names);
    expect([face.main, face.hold, face.tone]).toEqual(["Space", "Symbols", "layer"]);
  });

  it("names the layer of a layer key", () => {
    const face = keyFace(d({ code: "OSL(2)", kind: "layer", tap: "OSL 2", layer: 2, layerAction: "one-shot" }), names);
    expect([face.main, face.hold]).toEqual(["OSL 2", "Layer 2"]);
  });

  it("shows the modifiers of a mod-tap key, and marks one-shot modifiers", () => {
    expect(keyFace(modTap, names).hold).toBe("Shift");
    expect(keyFace(d({ code: "OSM(MOD_LSFT)", kind: "one-shot-mod", tap: "Shift" }), names).hold).toBe("one-shot");
  });

  it("names tap dances and macros, when they have a name", () => {
    expect(keyFace(d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 }), names).hold).toBe("Tab / Caps Lock");
    expect(keyFace(d({ code: "TD(1)", kind: "tap-dance", tap: "TD 1", index: 1 }), names).hold).toBeNull();
    expect(keyFace(d({ code: "M0", kind: "macro", tap: "M 0", index: 0 }), names).hold).toBe("git status");
  });

  it("keeps the AltGr character of the keyboard language", () => {
    const a = d({ code: "KC_A", kind: "basic", tap: "A", legend: { main: "A", shifted: null, altGr: "ą" } });
    expect(keyFace(a, names).altGr).toBe("ą");
  });
});

describe("actionSummary", () => {
  it("describes a layer-tap key", () => {
    expect(actionSummary(layerTap, names)).toEqual({ tap: "Space", hold: "Layer 1 · Symbols, while held" });
  });

  it("describes a mod-tap key", () => {
    expect(actionSummary(modTap, names)).toEqual({ tap: "T", hold: "Shift" });
  });

  it.each([
    ["while held", "Layer 2, while held"],
    ["toggle", "Toggle Layer 2"],
    ["switch to", "Switch to Layer 2"],
    ["one-shot", "One-shot Layer 2"],
    ["hold, or tap to toggle", "Hold for Layer 2, or tap to toggle it"],
    ["default", "Make Layer 2 the default layer"],
    ["default (saved)", "Make Layer 2 the default layer, and remember it"],
  ] as const)("describes a layer key that does %s", (layerAction, sentence) => {
    const key = d({ code: "X(2)", kind: "layer", tap: "X 2", layer: 2, layerAction });
    expect(actionSummary(key, names)).toEqual({ tap: sentence, hold: null });
  });

  it("describes transparent and empty keys in words", () => {
    expect(actionSummary(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names).tap)
      .toBe("Falls through to the layer below");
    expect(actionSummary(d({ code: "KC_NO", kind: "none", tap: "" }), names).tap).toBe("Nothing");
  });

  it("describes tap dances and macros with their names", () => {
    expect(actionSummary(d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 }), names).tap)
      .toBe("Tap dance 0 · Tab / Caps Lock");
    expect(actionSummary(d({ code: "M1", kind: "macro", tap: "M 1", index: 1 }), names).tap).toBe("Macro 1");
  });

  it("describes one-shot modifiers and AltGr characters", () => {
    expect(actionSummary(d({ code: "OSM(MOD_LSFT)", kind: "one-shot-mod", tap: "Shift" }), names).tap)
      .toBe("One-shot Shift");
    const a = d({ code: "KC_A", kind: "basic", tap: "A", legend: { main: "A", shifted: null, altGr: "ą" } });
    expect(actionSummary(a, names).tap).toBe("A (AltGr: ą)");
  });
});

describe("keyTitle", () => {
  it("says what the key is, in words", () => {
    expect(keyTitle(d({ code: "KC_TAB", kind: "basic", tap: "Tab" }), names)).toBe("Tab");
    expect(keyTitle(d({ code: "LT2(KC_S)", kind: "layer-tap", tap: "S", hold: "layer 2", layer: 2 }), names))
      .toBe("S — hold for Layer 2");
    expect(keyTitle(layerTap, names)).toBe("Space — hold for Layer 1 · Symbols");
    expect(keyTitle(modTap, names)).toBe("T — hold for Shift");
    expect(keyTitle(d({ code: "MO(1)", kind: "layer", tap: "MO 1", layer: 1, layerAction: "while held" }), names))
      .toBe("Layer 1 · Symbols, while held");
    expect(keyTitle(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names)).toBe("Transparent");
    expect(keyTitle(d({ code: "KC_NO", kind: "none", tap: "" }), names)).toBe("Empty");
  });
});

describe("legendScale", () => {
  it("shrinks longer labels", () => {
    expect(legendScale("A")).toBeGreaterThan(legendScale("Esc"));
    expect(legendScale("Esc")).toBeGreaterThan(legendScale("Space"));
    expect(legendScale("Space")).toBeGreaterThan(legendScale("PrintScr"));
  });

  it("sizes multi-word labels by their longest word, as they wrap", () => {
    expect(legendScale("Caps Lock")).toBe(legendScale("Caps"));
  });
});

describe("holdSize", () => {
  // a 1u key 48 px wide has about 40 px for its labels
  it("is a fifth of the key size for short labels", () => {
    expect(holdSize("Shift", 40, 48)).toBeCloseTo(9.6, 5);
  });

  it("shrinks long names so they fit in two lines", () => {
    const size = holdSize("Tab / Caps Lock", 40, 48);
    expect(size).toBeLessThan(9.6);
    expect(size * 0.55 * "Caps Lock".length).toBeLessThanOrEqual(40);
  });

  it("shrinks a long word so it fits on one line", () => {
    expect(holdSize("Ctrl+Shift", 40, 48) * 0.55 * 10).toBeLessThanOrEqual(40);
  });

  it("never goes below 7 px", () => {
    expect(holdSize("Esc / LCtrl / Ctrl+S / Alt+Tab", 20, 24)).toBe(7);
  });
});

describe("legendSizes", () => {
  const face = (main: string, hold: string | null, shifted: string | null = null) =>
    ({ main, shifted, altGr: null, hold, tone: "macro" as const });

  it("uses the usual sizes when everything fits", () => {
    const sizes = legendSizes(face("A", null), 40, 40, 48);
    expect(sizes.main).toBeCloseTo(legendScale("A") * 48, 5);
    expect(sizes.hold).toBe(0);
  });

  it("makes the main legend smaller when a long name needs two lines below it", () => {
    const sizes = legendSizes(face("M 0", "git status"), 40, 40, 48);
    expect(sizes.main).toBeLessThan(legendScale("M 0") * 48);
    const height = sizes.main * 1.05 + 2 * sizes.hold * 1.1 + 0.04 * 48;
    expect(height).toBeLessThanOrEqual(40);
  });

  it("keeps room for the shifted character", () => {
    const sizes = legendSizes(face("1", "Layer 2", "!"), 40, 30, 36);
    expect(sizes.main * 1.05 + sizes.shifted + sizes.hold * 1.1 + 0.08 * 36).toBeLessThanOrEqual(30);
  });
});
