import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel, TapDance } from "../api/types";
import type { Names } from "./labels";
import { catalogueTip, entryTip, keyTip, slotTip, tapDanceWays } from "./tip";

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

const none = d({ code: "KC_NO", kind: "none", tap: "" });
const tab = d({ code: "KC_TAB", kind: "basic", tap: "Tab" });
const caps = d({ code: "KC_CAPS", kind: "basic", tap: "Caps Lock" });
const tapDance0: TapDance = {
  index: 0, name: "Tab / Caps Lock", customName: true, tappingTerm: 200, tap: tab, hold: none, doubleTap: caps, tapHold: none,
} as TapDance;
const tapDance1: TapDance = { ...tapDance0, index: 1, name: "", customName: false, tappingTerm: 150 } as TapDance;
const entries: Pick<KeyboardModel, "tapDance" | "macros"> = {
  tapDance: [tapDance0, tapDance1],
  macros: {
    items: [{ index: 0, name: "git status", customName: true, actions: [{ type: "text", text: "git status" }, { type: "tap", keys: [d({ code: "KC_ENTER", kind: "basic", tap: "Enter" })] }] }],
  } as unknown as KeyboardModel["macros"],
};

describe("keyTip", () => {
  it("a plain key: its title, where it is and its keycode; nothing else", () => {
    expect(keyTip(d({ code: "KC_C", kind: "basic", tap: "C" }), names, "row 2 · column 3 · Base layer", entries))
      .toEqual({ title: "C", tone: "normal", place: "row 2 · column 3 · Base layer", code: "KC_C" });
  });

  it("a key with Shift and AltGr characters says them in a note", () => {
    const key = d({ code: "KC_SLASH", kind: "basic", tap: "/", legend: { main: "/", shifted: "?", altGr: "ł" } });
    expect(keyTip(key, names, "", entries).notes).toEqual(["Shift: ? · AltGr: ł"]);
    expect(keyTip(key, names, "", entries).place).toBeUndefined();
  });

  it("a key's description and the notes given come after each other", () => {
    const key = d({ code: "KC_LSFT", kind: "modifier", tap: "LShift", description: "Left Shift" });
    expect(keyTip(key, names, "", entries, ["in combo 3", "matches the search"]).notes)
      .toEqual(["Left Shift", "in combo 3", "matches the search"]);
  });

  it("a layer-tap or mod-tap key: Tap and Hold in words", () => {
    const space = d({ code: "LT1(KC_SPACE)", kind: "layer-tap", tap: "Space", hold: "layer 1", layer: 1, layerAction: "while held" });
    expect(keyTip(space, names, "", entries)).toMatchObject({
      title: "Space — hold for Layer 1 · Symbols", tone: "layer",
      ways: [{ label: "Tap", text: "Space" }, { label: "Hold", text: "Layer 1 · Symbols, while held" }],
    });
    const t = d({ code: "LSFT_T(KC_T)", kind: "mod-tap", tap: "T", hold: "Shift" });
    expect(keyTip(t, names, "", entries).ways).toEqual([{ label: "Tap", text: "T" }, { label: "Hold", text: "Shift" }]);
  });

  it("a layer key: the sentence is the title, with no ways", () => {
    const mo = d({ code: "MO(2)", kind: "layer", tap: "MO 2", layer: 2, layerAction: "while held" });
    const tip = keyTip(mo, names, "", entries);
    expect(tip.title).toBe("Layer 2, while held");
    expect(tip.ways).toBeUndefined();
  });

  it("a tap dance key: its four ways as keycaps (null for nothing) and the tapping term, from the keyboard", () => {
    const td = d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0, description: "Tap dance 0" });
    const tip = keyTip(td, names, "row 0 · column 0 · Base layer", entries);
    expect(tip).toMatchObject({ title: "Tap dance 0 · Tab / Caps Lock", tone: "tap-dance", code: "TD(0)", tappingTerm: 200 });
    expect(tip.ways).toEqual([
      { label: "Tap", action: tab }, { label: "Hold", action: null }, { label: "Double tap", action: caps },
      { label: "Tap, then hold", action: null },
    ]);
    // the description only says "Tap dance 0" again
    expect(tip.notes).toBeUndefined();
  });

  it("a macro key: its steps, from the keyboard", () => {
    const m = d({ code: "M0", kind: "macro", tap: "M0", index: 0 });
    const tip = keyTip(m, names, "", entries);
    expect(tip.title).toBe("Macro 0 · git status");
    expect(tip.steps).toHaveLength(2);
    expect(tip.ways).toBeUndefined();
  });

  it("without the keyboard's entries, a tap dance key says its title only", () => {
    const td = d({ code: "TD(1)", kind: "tap-dance", tap: "TD 1", index: 1 });
    expect(keyTip(td, names, "", null)).toEqual({ title: "Tap dance 1", tone: "tap-dance", place: undefined, code: "TD(1)" });
  });

  it("an empty or transparent key", () => {
    expect(keyTip(undefined, names, "row 1 · column 1 · Base layer")).toEqual({ title: "Empty", tone: "none", place: "row 1 · column 1 · Base layer", notes: undefined });
    expect(keyTip(none, names, "", entries)).toMatchObject({ title: "Empty", tone: "none", code: "KC_NO" });
    expect(keyTip(d({ code: "KC_TRNS", kind: "transparent", tap: "▽" }), names, "", entries)).toMatchObject({ title: "Transparent", tone: "transparent" });
  });
});

describe("tapDanceWays", () => {
  it("names the four ways, with null where nothing is set", () => {
    expect(tapDanceWays(tapDance0).map((w) => [w.label, w.action?.code ?? null])).toEqual([
      ["Tap", "KC_TAB"], ["Hold", null], ["Double tap", "KC_CAPS"], ["Tap, then hold", null],
    ]);
  });
});

describe("slotTip", () => {
  it("says what the slot is for as the place, and that a click changes it", () => {
    expect(slotTip("Trigger", tab, names)).toEqual({ title: "Tab", tone: "normal", place: "Trigger", code: "KC_TAB", notes: ["click to change"] });
  });

  it("an empty slot", () => {
    expect(slotTip("Hold", none, names)).toEqual({ title: "Nothing", tone: "none", place: "Hold", notes: ["click to change"] });
  });
});

describe("catalogueTip and entryTip", () => {
  it("a keycode offered by the picker: what it is and its description (the key shows the code itself)", () => {
    const k = d({ code: "DYN_REC_START1", kind: "other", tap: "DM1 Rec", description: "Start recording dynamic macro 1" });
    expect(catalogueTip(k, names)).toEqual({ title: "DM1 Rec", tone: "normal", notes: ["Start recording dynamic macro 1"] });
  });

  it("a tap dance the picker offers: its ways and tapping term from the detail given", () => {
    const k = d({ code: "TD(0)", kind: "tap-dance", tap: "TD 0", index: 0 });
    const tip = entryTip(k, names, { kind: "tap-dance", slots: tapDanceWays(tapDance0), tappingTerm: 200 });
    expect(tip).toEqual({ title: "Tap dance 0 · Tab / Caps Lock", tone: "tap-dance", ways: tapDanceWays(tapDance0), tappingTerm: 200 });
  });

  it("a macro the picker offers: its steps", () => {
    const k = d({ code: "M0", kind: "macro", tap: "M0", index: 0 });
    const steps = entries.macros.items[0].actions;
    expect(entryTip(k, names, { kind: "macro", steps })).toEqual({ title: "Macro 0 · git status", tone: "macro", steps });
  });
});
