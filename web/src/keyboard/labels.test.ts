import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel } from "../api/types";
import {
  actionSummary, compactLegendSize, HOLD_MAX_LINES, holdLines, holdSize, keyFace, keyLabel, keyTitle, legendScale, legendSizes, legendWords, MAIN_LINE, mainLines,
  namesOf, toneOf, estimatedWidth, type Names, type TextWidth,
} from "./labels";

type Fields = Partial<Described> & Pick<Described, "code" | "kind" | "tap">;

function d(fields: Fields): Described {
  return {
    value: 0, hold: null, layer: null, layerAction: null, index: null, description: null,
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

describe("namesOf", () => {
  const model = {
    layers: [{ name: "Layer 0", customName: false }, { name: "Symbols", customName: true }],
    tapDance: [{ name: "Tab / Caps Lock", customName: false }, { name: "Esc dance", customName: true }],
    macros: { items: [{ name: "Text", customName: false }, { name: "git status", customName: true }] },
  } as unknown as KeyboardModel;
  const n = namesOf(model);

  it("names layers, and knows which ones the user named", () => {
    expect([n.layer(0), n.layer(1)]).toEqual(["Layer 0", "Symbols"]);
    expect([n.layerIsNamed(0), n.layerIsNamed(1)]).toEqual([false, true]);
  });

  it("uses the names of tap dances and macros, suggested or chosen", () => {
    expect([n.tapDance(0), n.tapDance(1)]).toEqual(["Tab / Caps Lock", "Esc dance"]);
    expect([n.macro(0), n.macro(1)]).toEqual(["Text", "git status"]);
  });

  it("has default names for what does not exist", () => {
    expect(n.layer(7)).toBe("Layer 7");
    expect(n.layerIsNamed(7)).toBe(false);
    expect(n.tapDance(9)).toBe("");
    expect(n.macro(9)).toBe("");
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

  it("describes LM, a layer held with modifiers", () => {
    const lm = d({ code: "0x5042", kind: "layer", tap: "LM 2", hold: "Shift", layer: 2, layerAction: "while held, with modifiers" });
    expect(actionSummary(lm, names)).toEqual({ tap: "Layer 2 with Shift, while held", hold: null });
    expect(actionSummary({ ...lm, hold: null }, names)).toEqual({ tap: "Layer 2, while held", hold: null });
  });

  it("falls back to the tap text for a layer action it does not know", () => {
    const key = d({ code: "X(2)", kind: "layer", tap: "X 2", layer: 2, layerAction: "sideways" as never });
    expect(actionSummary(key, names)).toEqual({ tap: "X 2", hold: null });
  });

  it("says Nothing for a hold key that types nothing on tap", () => {
    const shift = d({ code: "LSFT_T(KC_NO)", kind: "mod-tap", tap: "", hold: "Shift" });
    expect(actionSummary(shift, names)).toEqual({ tap: "Nothing", hold: "Shift" });
    const layer = d({ code: "LT1(KC_NO)", kind: "layer-tap", tap: "", hold: "layer 1", layer: 1 });
    expect(actionSummary(layer, names).tap).toBe("Nothing");
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

  it("says Nothing for a hold key that types nothing on tap", () => {
    expect(keyTitle(d({ code: "LSFT_T(KC_NO)", kind: "mod-tap", tap: "", hold: "Shift" }), names))
      .toBe("Nothing — hold for Shift");
    expect(keyTitle(d({ code: "LT2(KC_NO)", kind: "layer-tap", tap: "", hold: "layer 2", layer: 2 }), names))
      .toBe("Nothing — hold for Layer 2");
  });
});

describe("keyLabel", () => {
  const td = d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 });

  it("starts with the title, and ends with where the key is", () => {
    expect(keyLabel(layerTap, names, "key row 3, column 4")).toBe(
      "Space — hold for Layer 1 · Symbols (key row 3, column 4)");
    expect(keyLabel(undefined, names, "key row 0, column 0")).toBe("Empty (key row 0, column 0)");
  });

  it("has the text on the cap when the title doesn't (label in name)", () => {
    expect(keyLabel(td, names, "key row 1, column 0")).toBe(
      "Tap dance 0 · Tab / Caps Lock (TD 0, key row 1, column 0)");
    expect(keyLabel(d({ code: "M0", kind: "macro", tap: "M 0", index: 0 }), names, "key row 0, column 1")).toBe(
      "Macro 0 · git status (M 0, key row 0, column 1)");
    expect(keyLabel(d({ code: "OSL(3)", kind: "layer", tap: "OSL 3", layer: 3, layerAction: "one-shot" }), names,
      "key row 2, column 0")).toBe("One-shot Layer 3 (OSL 3, key row 2, column 0)");
  });

  it("doesn't repeat a cap text the title has, whatever its case", () => {
    expect(keyLabel(d({ code: "KC_TAB", kind: "basic", tap: "Tab" }), names, "key row 1, column 0")).toBe(
      "Tab (key row 1, column 0)");
    expect(keyLabel(d({ code: "KC_ESC", kind: "basic", tap: "Escape", legend: { main: "esc", shifted: null, altGr: null } }),
      names, "key row 0, column 0")).toBe("Escape (key row 0, column 0)");
  });

  it("leaves out a cap of symbols only, which isn't words to say", () => {
    expect(keyLabel(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names, "key row 0, column 0")).toBe(
      "Transparent (key row 0, column 0)");
  });
});

describe("legendWords", () => {
  it("splits at spaces, and after a + that joins two keys", () => {
    expect(legendWords("Vol +")).toEqual(["Vol", "+"]);
    expect(legendWords("+")).toEqual(["+"]);
    expect(legendWords("RCtrl++")).toEqual(["RCtrl+", "+"]);
    expect(legendWords("Ctrl+Shift+Esc")).toEqual(["Ctrl+", "Shift+", "Esc"]);
    expect(legendWords(" Caps  Lock ")).toEqual(["Caps", "Lock"]);
    expect(legendWords("")).toEqual([]);
  });
});

describe("mainLines", () => {
  it("counts the lines of a legend broken at spaces and after each +", () => {
    // 0.55 of the font size per character: 10 px a character at 18.18 px
    expect(mainLines("Esc", 18.18, 40)).toBe(1);
    expect(mainLines("Ctrl+Shift+Esc", 18.18, 40)).toBe(3);
    expect(mainLines("Ctrl+Shift+Esc", 18.18, 110)).toBe(2);
    expect(mainLines("Ctrl+Shift+Esc", 18.18, 140)).toBe(1);
    // the space counts between words, not between the parts of a combination
    expect(mainLines("Caps Lock", 18.18, 80)).toBe(2);
    expect(mainLines("Caps Lock", 18.18, 90)).toBe(1);
  });

  it("is one line for an empty legend", () => {
    expect(mainLines("", 10, 0)).toBe(1);
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

  it("sizes a combination by its longest part, as it breaks after each +", () => {
    expect(legendScale("Ctrl+Shift+Esc")).toBe(legendScale("Shift+"));
    expect(legendScale("Ctrl+Shift+Esc")).toBeGreaterThan(legendScale("CtrlShiftEsc"));
  });

  it("counts a wide character (CJK, full-width) as nearly two", () => {
    expect(legendScale("日本")).toBe(legendScale("Home"));
    expect(legendScale("ＡＢ")).toBe(legendScale("Home"));
    expect(legendScale("한")).toBe(legendScale("Up"));
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

  it("measures wide characters (CJK, kana, Hangul) at a full font size each", () => {
    // a word of n wide characters fits on one line when n * size <= 40
    expect(holdSize("ひらがな", 40, 48) * 4).toBeLessThanOrEqual(40);
    expect(holdSize("한국어자판", 40, 48) * 5).toBeLessThanOrEqual(40);
    // six wide characters and two spaces: smaller, to fit in two lines
    expect(holdSize("数字 記号 入力", 40, 48)).toBeLessThan(holdSize("Num Sym Fn", 40, 48));
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

  /** the width of the longest part of a legend that breaks at spaces and after each + (narrow characters only) */
  const longestPart = (main: string, px: number) => Math.max(...legendWords(main).map((w) => w.length)) * 0.55 * px;
  /** the height of the main legend on as many lines as it takes, at the line height the key draws it with */
  const mainHeight = (main: string, px: number, width: number) => mainLines(main, px, width) * MAIN_LINE * px;

  it("makes the main legend smaller when a long name needs two lines below it", () => {
    const sizes = legendSizes(face("M 0", "git status"), 40, 40, 48);
    expect(sizes.main).toBeLessThan(legendScale("M 0") * 48);
    const height = mainHeight("M 0", sizes.main, 40) + 2 * sizes.hold * 1.1 + 0.04 * 48;
    expect(height).toBeLessThanOrEqual(40 + 1e-9);
  });

  it("makes a long word small enough to fit across the key", () => {
    // a 1u key 48 px wide has about 40 px for its labels
    expect(legendSizes(face("Bootloader", null), 40, 40, 48).main * 0.55 * 10).toBeLessThanOrEqual(40);
  });

  it.each(["Ctrl+Alt+Del", "Ctrl+Shift+Esc", "RCtrl+RShift+AltGr+RGui+A"])(
    "breaks %s after each +: every part fits across the key, and the lines fit in its height",
    (main) => {
      for (const u of [48, 72]) {
        const room = 0.83 * u;
        const { main: px } = legendSizes(face(main, null), room, room, u);
        expect(longestPart(main, px)).toBeLessThanOrEqual(room + 1e-9);
        expect(mainHeight(main, px, room)).toBeLessThanOrEqual(room + 1e-9);
      }
    },
  );

  it("keeps a combination readable on a 1u key", () => {
    // on one line it would be about 5 px at 48 px a key, and 8 px at 72
    expect(legendSizes(face("Ctrl+Shift+Esc", null), 0.83 * 72, 0.83 * 72, 72).main).toBeGreaterThanOrEqual(12);
    expect(legendSizes(face("Ctrl+Shift+Esc", null), 0.83 * 48, 0.83 * 48, 48).main).toBeGreaterThanOrEqual(9);
  });

  it("never goes below 7 px, even for a combination too long for the key", () => {
    const extreme = "RCtrl+RShift+RAlt+RGui+LCtrl+LShift+LAlt+LGui+Esc";
    expect(legendSizes(face(extreme, null), 0.83 * 36, 0.83 * 36, 36).main).toBe(7);
    expect(legendSizes(face("Bootloader", "Tab / Caps Lock"), 10, 10, 12).main).toBe(7);
  });

  it("has a finite size for an empty legend, even with no room", () => {
    const sizes = legendSizes(face("", null), 0, 0, 48);
    expect(Number.isFinite(sizes.main)).toBe(true);
    expect(Number.isFinite(legendSizes(face("A", null), 0, 0, 48).main)).toBe(true);
  });

  it("fits the longest word of a legend that wraps, and leaves short legends alone", () => {
    expect(legendSizes(face("Print Screen", null), 40, 40, 48).main * 0.55 * 6).toBeLessThanOrEqual(40);
    expect(legendSizes(face("Esc", null), 40, 40, 48).main).toBeCloseTo(legendScale("Esc") * 48, 5);
    // a wider key has room for the usual size
    expect(legendSizes(face("Bootloader", null), 100, 40, 48).main).toBeCloseTo(legendScale("Bootloader") * 48, 5);
  });

  it("fits a long word even when a name below it needs two lines", () => {
    const sizes = legendSizes(face("Bootloader", "git status"), 40, 40, 48);
    expect(sizes.main * 0.55 * 10).toBeLessThanOrEqual(40);
  });

  it("measures wide characters at a full font size", () => {
    expect(legendSizes(face("日本語入力", null), 40, 40, 48).main * 5).toBeLessThanOrEqual(40);
    // two words of two wide characters: too wide for one line at this size, so two lines under the legend
    const sizes = legendSizes(face("A", "数字 記号"), 40, 40, 48);
    expect(mainHeight("A", sizes.main, 40) + 2 * sizes.hold * 1.1 + 0.04 * 48).toBeLessThanOrEqual(40 + 1e-9);
  });

  it("keeps room for the shifted character", () => {
    const sizes = legendSizes(face("1", "Layer 2", "!"), 40, 30, 36);
    expect(mainHeight("1", sizes.main, 40) + sizes.shifted + sizes.hold * 1.1 + 0.08 * 36).toBeLessThanOrEqual(30);
  });

  it("keeps room for a hold label under a combination on several lines", () => {
    const sizes = legendSizes(face("Ctrl+Shift+Esc", "Layer 2"), 0.83 * 48, 0.83 * 48, 48);
    const holdLines = sizes.hold * 0.55 * "Layer 2".length > 0.83 * 48 ? 2 : 1;
    expect(mainHeight("Ctrl+Shift+Esc", sizes.main, 0.83 * 48) + holdLines * sizes.hold * 1.1 + 0.04 * 48)
      .toBeLessThanOrEqual(0.83 * 48 + 1e-9);
  });
});

describe("a measured text width", () => {
  /** a font as wide as Verdana: 0.7 of the font size per character, wider than the 0.55 estimate */
  const wide = (text: string) => [...text].length * 0.7;
  const face = (main: string, hold: string | null) => ({ main, shifted: null, altGr: null, hold, tone: "macro" as const });

  it("is estimated from the characters by default", () => {
    expect(estimatedWidth("Caps", 10)).toBeCloseTo(4 * 0.55, 9);
    expect(estimatedWidth("Caps", 100)).toBe(estimatedWidth("Caps", 10));
    expect(estimatedWidth("日本", 10)).toBe(2);
    expect(holdSize("Tab / Caps Lock", 40, 48)).toBe(holdSize("Tab / Caps Lock", 40, 48, estimatedWidth));
  });

  it("decides where a main legend breaks, the space between words included", () => {
    // 14 px a character at 20 px: "Caps" is 56 px, and "Caps Lock" 126 px
    expect(mainLines("Caps Lock", 20, 125, wide)).toBe(2);
    expect(mainLines("Caps Lock", 20, 126, wide)).toBe(1);
    // a space measured narrower than the letters around it
    const narrowSpace = (text: string) => (text === " " ? 0.25 : text.length * 0.7);
    expect(mainLines("Caps Lock", 20, 117, narrowSpace)).toBe(1);
  });

  it("makes a long name small enough for two lines in a wide font", () => {
    // a 1.5u key 72 px wide has about 60 px for its labels
    const size = holdSize("Tab / Caps Lock", 60, 72, wide);
    expect(size).toBeLessThan(holdSize("Tab / Caps Lock", 60, 72));
    expect(size * wide("Caps Lock")).toBeLessThanOrEqual(60);
  });

  it("fits the longest word across the key in a wide font", () => {
    const sizes = legendSizes(face("Bootloader", "git status"), 60, 60, 72, wide);
    expect(sizes.main * wide("Bootloader")).toBeLessThanOrEqual(60 + 1e-9);
    expect(sizes.main).toBeLessThan(legendSizes(face("Bootloader", "git status"), 60, 60, 72).main);
    expect(sizes.hold * wide("status")).toBeLessThanOrEqual(60 + 1e-9);
  });

  it("keeps the main legend and a two-line name in the key's height in a wide font", () => {
    const sizes = legendSizes(face("TD 0", "Tab / Caps Lock"), 40, 40, 48, wide);
    const lines = mainLines("TD 0", sizes.main, 40, wide);
    expect(lines * MAIN_LINE * sizes.main + 2 * sizes.hold * 1.1 + 0.04 * 48).toBeLessThanOrEqual(40 + 1e-9);
  });
});

describe("holdLines", () => {
  const wide = (text: string) => [...text].length * 0.7;

  it("counts the lines of a name broken greedily at spaces", () => {
    // 7 px a character at 10 px: "Tab / Caps" is 70 px, the whole name 105 px
    expect(holdLines("Tab / Caps Lock", 10, 105, wide)).toBe(1);
    expect(holdLines("Tab / Caps Lock", 10, 70, wide)).toBe(2);
    // "Tab /" then "Caps Lock" (63 px), wider than 62
    expect(holdLines("Tab / Caps Lock", 10, 63, wide)).toBe(2);
    expect(holdLines("Tab / Caps Lock", 10, 62, wide)).toBe(3);
  });

  it("breaks a word wider than a line anywhere", () => {
    expect(holdLines("Bootloader", 10, 30, wide)).toBe(3);
    expect(holdLines("A Bootloader", 10, 30, wide)).toBe(4);
  });

  it("is one line for an empty name, or without room", () => {
    expect(holdLines("", 10, 40)).toBe(1);
    expect(holdLines("git status", 0, 40)).toBe(1);
  });
});

describe("a long name on a small key in a wide font", () => {
  const wide = (text: string) => [...text].length * 0.7;
  const face = { main: "TD 0", shifted: null, altGr: null, hold: "Tab / Caps Lock", tone: "tap-dance" as const };

  it("takes two lines while it can shrink", () => {
    const size = holdSize("Tab / Caps Lock", 60, 72, wide);
    expect(holdLines("Tab / Caps Lock", size, 60, wide)).toBeLessThanOrEqual(2);
    expect(legendSizes(face, 60, 60, 72, wide).holdLines).toBe(2);
  });

  it("gets a third line at the smallest size, and the main legend makes room for it", () => {
    // 37 px wide (a 1u key at 1280 px): "Tab / Caps" is 49 px at 7 px
    const sizes = legendSizes(face, 37, 37, 44, wide);
    expect(sizes.hold).toBe(7);
    expect(sizes.holdLines).toBe(HOLD_MAX_LINES);
    const lines = mainLines("TD 0", sizes.main, 37, wide);
    expect(lines * MAIN_LINE * sizes.main + 3 * sizes.hold * 1.1 + 0.04 * 44).toBeLessThanOrEqual(37 + 1e-9);
  });

  it("has no hold lines without a hold label", () => {
    expect(legendSizes({ ...face, hold: null }, 37, 37, 44, wide).holdLines).toBe(0);
  });
});

describe("a text width that depends on the size", () => {
  /** a hinted font: each character 0.55 of the font size, rounded up to whole pixels, so small text is wider than
   * scaled down (5 px a character at 8 px, 0.625 of the font size; 0.55 at 100 px) */
  const hinted: TextWidth = (text, px) => ([...text].length * Math.ceil(0.55 * px)) / px;
  const face = (main: string, hold: string | null) => ({ main, shifted: null, altGr: null, hold, tone: "macro" as const });

  it("is measured at the size the legend gets", () => {
    for (const room of [40, 47, 60]) {
      const sizes = legendSizes(face("Bootloader", "Tab / Caps Lock"), room, room, room * 1.2, hinted);
      expect(sizes.main * hinted("Bootloader", sizes.main)).toBeLessThanOrEqual(room + 1e-9);
      expect(holdLines("Tab / Caps Lock", sizes.hold, room, hinted)).toBeLessThanOrEqual(sizes.holdLines);
      expect(sizes.hold * hinted("Caps", sizes.hold)).toBeLessThanOrEqual(room + 1e-9);
    }
  });

  it("shrinks a long name until it takes two lines at its size", () => {
    const size = holdSize("git status", 40, 48, hinted);
    expect(holdLines("git status", size, 40, hinted)).toBeLessThanOrEqual(2);
  });
});

describe("compactLegendSize", () => {
  // a key of 31 px: about 25.7 px inside
  const inside = 25.7;
  /** a font as wide as Verdana: 0.7 of the font size per character */
  const wide = (text: string) => [...text].length * 0.7;

  it("fills a small key: longer words are only as small as the width needs", () => {
    expect(compactLegendSize("LCtrl", inside, inside, 31)).toBeCloseTo(inside / estimatedWidth("LCtrl", 10));
    const space = { main: "Space", shifted: null, altGr: null, hold: null, tone: "normal" as const };
    expect(compactLegendSize("Space", inside, inside, 31)).toBeGreaterThan(legendSizes(space, inside, inside, 31).main);
    // short ones stop at the largest size
    expect(compactLegendSize("Up", inside, inside, 31)).toBeCloseTo(0.42 * 31);
  });

  it("measures the text with the width it is given", () => {
    const px = compactLegendSize("Home", inside, inside, 31, wide);
    expect(px).toBeCloseTo(inside / wide("Home"));
    expect(px).toBeLessThan(compactLegendSize("Home", inside, inside, 31));
  });

  it("shrinks until its longest part fits at the size it gets, for a font measured per size", () => {
    /** each character 0.55 of the font size rounded up to whole pixels: small text is wider than scaled down */
    const hinted: TextWidth = (text, px) => ([...text].length * Math.ceil(0.55 * px)) / px;
    const px = compactLegendSize("LShift", inside, inside, 31, hinted);
    expect(px * hinted("LShift", px)).toBeLessThanOrEqual(inside + 1e-9);
  });

  it("is at most 0.42 of the key, for one character", () => {
    expect(compactLegendSize("A", inside, inside, 31)).toBeCloseTo(0.42 * 31);
    expect(compactLegendSize("", inside, inside, 31)).toBeCloseTo(0.42 * 31);
  });

  it("fits the lines of a legend that wraps into the height", () => {
    const px = compactLegendSize("Page Up", inside, inside, 31);
    expect(px * MAIN_LINE * mainLines("Page Up", px, inside)).toBeLessThanOrEqual(inside);
    expect(px).toBeGreaterThan(9);
  });

  it("keeps a legend on one line when that is nearly as large", () => {
    const px = compactLegendSize("MO 5", inside, inside, 31);
    expect(px).toBeCloseTo(inside / estimatedWidth("MO 5", px));
    expect(mainLines("MO 5", px, inside)).toBe(1);
  });

  it("never goes below 7 px", () => {
    expect(compactLegendSize("Bootloader", 12, 12, 14)).toBe(7);
  });
});
