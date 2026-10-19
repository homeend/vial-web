import { describe, expect, it } from "vitest";
import { positionNames } from "../analysis/positions";
import { described, simulatedCorne } from "../analysis/testing";
import type { KeyboardModel, LayoutFilePreview, SettingsDefinitions } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import {
  changeTotal, layoutFileName, layoutOptionChanges, LISTED, previewSections, shortAction, unchangedSections,
  type PreviewContext,
} from "./layoutFile";

const model: KeyboardModel = {
  ...simulatedCorne(),
  keyOverrides: [{ index: 0, trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 0xffff,
    triggerMods: 2, negativeModMask: 0, suppressedMods: 2, options: 0x87, enabled: true }],
  altRepeatKeys: [{ index: 0, keycode: described("KC_LEFT"), altKeycode: described("KC_RGHT"), allowedMods: 0,
    options: 8, enabled: true }],
  settings: [{ qsid: 7, value: 200 }, { qsid: 21, value: 0 }],
};
const names = namesOf(model);
const definitions: SettingsDefinitions = {
  tabs: [{ name: "Magic", fields: [
    { type: "boolean", title: "Swap Caps Lock and Left Control", qsid: 21, bit: 0, width: 4, min: null, max: null },
    { type: "integer", title: "Tapping Term", qsid: 7, bit: null, width: 2, min: 0, max: 10000 },
  ] }],
};
const ctx: PreviewContext = { model, names, positions: positionNames(placeKeyboard(model)), definitions };

function preview(change: Partial<LayoutFilePreview> = {}): LayoutFilePreview {
  return {
    uid: "5EEDC0DE00420042", keys: [], encoders: [], layoutOptions: null, tapDance: [], combos: [], keyOverrides: [],
    altRepeatKeys: [], macros: [], settings: [], ignored: [], needsUnlock: false, ...change,
  };
}

const key = (layer: number, row: number, col: number, before: string, after: string) =>
  ({ layer, row, col, before: described(before), after: described(after) });

describe("previewSections", () => {
  it("is nothing for a file that changes nothing; every section the keyboard has is unchanged", () => {
    expect(previewSections(preview(), ctx)).toEqual([]);
    expect(unchangedSections(preview(), ctx)).toEqual([
      "keys", "tap dances", "combos", "key overrides", "alt-repeat keys", "macros", "QMK settings",
    ]);
  });

  it("lists the keys changed, where they are, and how many on each layer", () => {
    const sections = previewSections(preview({
      keys: [key(0, 0, 0, "KC_TAB", "KC_Z"), key(0, 4, 0, "KC_BSPC", "KC_NO"), key(2, 1, 1, "KC_TRNS", "LT2(KC_B)")],
    }), ctx);
    expect(sections).toEqual([{
      id: "keys", title: "Keys", count: 3, summary: "Base: 2, Layer 2: 1", more: 0,
      items: [
        "Base, left top row, 1st from the outside: Tab → Z",
        "Base, right top row, 1st from the outside: BSPC → nothing",
        "Layer 2, left home row, 2nd from the outside: transparent → B (hold: Layer 2)",
      ],
    }]);
  });

  it("lists the first few changes of a long section, and how many more there are", () => {
    const keys = Array.from({ length: LISTED + 3 }, (_, c) => key(0, c % 3, c % 6, "KC_A", "KC_B"));
    const [section] = previewSections(preview({ keys }), ctx);
    expect(section.items).toHaveLength(LISTED);
    expect([section.count, section.more]).toEqual([LISTED + 3, 3]);
    expect(changeTotal([section, section])).toBe(2 * (LISTED + 3));
  });

  it("says what each changed entry does after loading", () => {
    const td = model.tapDance[2];
    const combo = model.combos[2];
    const ko = model.keyOverrides[0];
    const ark = model.altRepeatKeys[0];
    const macro = { index: 2, name: "hello", customName: false,
      actions: [{ type: "text" as const, text: "hello", keys: [], delay: null }] };
    const sections = previewSections(preview({
      tapDance: [{ before: td, after: { ...td, tap: described("KC_A"), doubleTap: described("KC_B") } }],
      combos: [{ before: combo, after: { ...combo, keys: [described("KC_J"), described("KC_K"), described("KC_NO"),
        described("KC_NO")], output: described("KC_ESC") } }],
      keyOverrides: [{ before: ko, after: { ...ko, enabled: false } }],
      altRepeatKeys: [{ before: ark, after: { ...ark, keycode: described("KC_NO"), altKeycode: described("KC_NO"),
        options: 0, enabled: false } }],
      macros: [{ before: { ...macro, actions: [] }, after: macro }],
      settings: [{ qsid: 7, before: 200, after: 250 }, { qsid: 21, before: 0, after: 1 }],
    }), ctx);
    expect(sections.map((s) => [s.title, s.items])).toEqual([
      ["Tap dances", ["Tap dance 2: Tap for A, double-tap for B."]],
      ["Combos", ["Combo 2: J + K → Esc"]],
      ["Key overrides", ["Key override 0: Left Shift + BSPC sends DEL, on every layer. Left Shift is hidden from the " +
        "computer while it works. Switched off."]],
      ["Alt-repeat keys", ["Alt-repeat key 0: cleared"]],
      ["Macros", ["Macro 2: hello (1 step)"]],
      ["QMK settings", ["Tapping Term: 200 → 250", "Swap Caps Lock and Left Control: off → on"]],
    ]);
    expect(unchangedSections(preview({ macros: [{ before: { ...macro, actions: [] }, after: macro }] }), ctx))
      .not.toContain("macros");
  });

  it("says what else a changed entry changes, and never asks for what an editor would", () => {
    const td = { ...model.tapDance[2], tap: described("KC_NO"), hold: described("KC_NO"), doubleTap: described("KC_NO"),
      tapHold: described("KC_NO") };
    const ko = model.keyOverrides[0];
    const ark = model.altRepeatKeys[0];
    const sections = previewSections(preview({
      tapDance: [
        // the tapping term too
        { before: td, after: { ...td, tap: described("KC_A"), tappingTerm: 250 } },
        // only the term of a tap dance that does nothing: not "cleared"
        { before: { ...td, index: 1 }, after: { ...td, index: 1, tappingTerm: 300 } },
        { before: { ...td, index: 0, tap: described("KC_B") }, after: { ...td, index: 0 } },
      ],
      keyOverrides: [
        { before: ko, after: { ...ko, negativeModMask: 1, options: 0x81 } },
        { before: ko, after: { ...ko, index: 1, trigger: described("KC_NO"), triggerMods: 0 } },
        { before: ko, after: { ...ko, index: 2, trigger: described("KC_NO"), triggerMods: 0, enabled: false } },
      ],
      altRepeatKeys: [
        { before: ark, after: { ...ark, keycode: described("KC_NO") } },
        { before: ark, after: { ...ark, index: 1, keycode: described("KC_NO"), options: 0x0a } },
      ],
    }), ctx);
    expect(sections.map((s) => [s.title, s.items])).toEqual([
      ["Tap dances", [
        "Tap dance 2: Tap for A. Tapping term: 200 → 250 ms.",
        "Tap dance 1: does nothing. Tapping term: 200 → 300 ms.",
        "Tap dance 0: cleared",
      ]],
      ["Key overrides", [
        "Key override 0: Left Shift + BSPC sends DEL, on every layer. Not while Left Ctrl is held. Left Shift is " +
          "hidden from the computer while it works. Starts only: when the trigger key goes down.",
        "Key override 1: With no trigger key and no trigger modifiers, it starts on every key press on its layers. " +
          "Left Shift is hidden from the computer while it works.",
        "Key override 2: No trigger key or modifiers. Left Shift is hidden from the computer while it works. " +
          "Switched off.",
      ]],
      ["Alt-repeat keys", [
        "Alt-repeat key 0: No last key, so it does nothing.",
        "Alt-repeat key 1: No last key: after RGHT, Alt Repeat sends nothing.",
      ]],
    ]);
  });

  it("says where a key or encoder is by its matrix position or number when nothing is drawn there", () => {
    const sections = previewSections(preview({
      keys: [key(0, 3, 0, "KC_A", "KC_B")],
      encoders: [{ layer: 1, encoder: 0, direction: 1, before: described("KC_VOLU"), after: described("KC_PGDN") }],
    }), ctx);
    expect(sections.map((s) => [s.title, s.items])).toEqual([
      ["Keys", ["Base, row 3, column 0: A → B"]],
      ["Encoders", ["Layer 1, encoder 0, clockwise: VOLU → PGDN"]],
    ]);
  });

  it("names a setting by its number without the definitions, or when only bits no field covers change", () => {
    const settings = [{ qsid: 7, before: 200, after: 250 }];
    expect(previewSections(preview({ settings }), { ...ctx, definitions: null })[0].items)
      .toEqual(["Setting 7: 200 → 250"]);
    expect(previewSections(preview({ settings: [{ qsid: 21, before: 0, after: 2 }] }), ctx)[0].items)
      .toEqual(["Setting 21: 0 → 2"]);
  });

  it("names the layout options that change", () => {
    const options = { value: 0, labels: ["Split Backspace", ["Bottom row", "6.25U", "7U", "Split"]] as (string | string[])[] };
    // the first option is in the highest bits: Split Backspace is bit 2, Bottom row bits 0-1
    expect(layoutOptionChanges(options, 0b000, 0b101)).toEqual(["Split Backspace: off → on", "Bottom row: 6.25U → 7U"]);
    expect(layoutOptionChanges(null, 0, 1)).toEqual(["0 → 1"]);
    const sections = previewSections(preview({ layoutOptions: { before: 0, after: 4 } }), { ...ctx,
      model: { ...model, layoutOptions: options } });
    expect(sections[0].items).toEqual(["Split Backspace: off → on"]);
  });

  it("names a change in bits no layout option covers, so the section stays", () => {
    const options = { value: 0, labels: ["Split Backspace", ["Bottom row", "6.25U", "7U", "Split"]] as (string | string[])[] };
    // the options take bits 0-2: bit 3 and up belong to none (the server writes them all the same)
    expect(layoutOptionChanges(options, 0b0001, 0b1001)).toEqual(["other bits: 0 → 8"]);
    expect(layoutOptionChanges(options, 0b0000, 0b1100)).toEqual(["Split Backspace: off → on", "other bits: 0 → 8"]);
    const sections = previewSections(preview({ layoutOptions: { before: 1, after: 9 } }), { ...ctx,
      model: { ...model, layoutOptions: options } });
    expect(sections.map((s) => [s.title, s.count, s.items])).toEqual([["Layout options", 1, ["other bits: 0 → 8"]]]);
  });
});

describe("shortAction", () => {
  it("is a keycode in a few words", () => {
    expect(shortAction(described("KC_NO"), names)).toBe("nothing");
    expect(shortAction(described("KC_ESC"), names)).toBe("Esc");
    expect(shortAction(described("LT1(KC_SPC)"), names)).toBe("Space (hold: Layer 1)");
  });
});

describe("layoutFileName", () => {
  it("is the keyboard's name, without what file systems refuse", () => {
    expect(layoutFileName("Simulated Corne")).toBe("Simulated Corne.vil");
    expect(layoutFileName('Knob/Pad: "mini"')).toBe("Knob_Pad_ _mini.vil");
    expect(layoutFileName("...")).toBe("keyboard.vil");
  });
});
