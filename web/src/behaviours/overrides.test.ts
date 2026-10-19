import { describe, expect, it } from "vitest";
import { corne, described, layer } from "../analysis/testing";
import { namesOf } from "../keyboard/labels";
import {
  allLayers, altRepeatIsSet, altRepeatRequest, altRepeatSentence, AR_ENABLED, clearedKeyOverride,
  freeAltRepeat, freeKeyOverride, keyOverrideDetails, keyOverrideIsSet, keyOverrideProblems, keyOverrideRequest,
  keyOverrideSentence, KO_ACTIVATIONS, KO_ENABLED, layerPhrase, layersIn, modBit, modNames, newAltRepeat,
  newKeyOverride, orList, pressable, toggled, type AltRepeatDraft, type KeyOverrideDraft,
} from "./overrides";

const model = corne({
  layers: [layer({ 0: "QK_ALT_REPEAT_KEY" }, "KC_NO"), layer({}), layer({}), layer({})],
  tapDances: [["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"]],
  combos: [{ keys: ["KC_K", "KC_Y"], output: "KC_ESC" }, { keys: [], output: "KC_ENT" }],
  keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_DEL" }, { trigger: "KC_NO", replacement: "KC_NO" }],
  altRepeatKeys: [{ keycode: "KC_LEFT", altKeycode: "KC_RGHT" }, { keycode: "KC_NO", altKeycode: "KC_NO" }],
});
const names = namesOf(model);
const NONE = described("KC_NO");
const LSFT = 0x02;
const RSFT = 0x20;
const LCTL = 0x01;

function override(change: Partial<KeyOverrideDraft> = {}): KeyOverrideDraft {
  return {
    trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 0xffff, triggerMods: LSFT,
    negativeModMask: 0, suppressedMods: LSFT, options: KO_ENABLED | KO_ACTIVATIONS, enabled: true, ...change,
  };
}

function altRepeat(change: Partial<AltRepeatDraft> = {}): AltRepeatDraft {
  return { keycode: described("KC_LEFT"), altKeycode: described("KC_RIGHT"), allowedMods: 0, options: AR_ENABLED,
    enabled: true, ...change };
}

describe("modifier masks", () => {
  it("has Qt's bit order: the left Ctrl, Shift, Alt, Gui, then the right ones", () => {
    expect(modBit("Left", "Ctrl")).toBe(0x01);
    expect(modBit("Left", "Gui")).toBe(0x08);
    expect(modBit("Right", "Shift")).toBe(0x20);
    expect(modBit("Right", "Gui")).toBe(0x80);
  });

  it("names a modifier set on both sides by its name, one set on one side with its side", () => {
    expect(modNames(LSFT)).toEqual(["Left Shift"]);
    expect(modNames(LSFT | RSFT)).toEqual(["Shift"]);
    expect(modNames(LCTL | RSFT | 0x80)).toEqual(["Left Ctrl", "Right Shift", "Right Gui"]);
    expect(modNames(0)).toEqual([]);
  });

  it("leaves the side out when it doesn't matter", () => {
    expect(modNames(RSFT | LCTL, true)).toEqual(["Ctrl", "Shift"]);
  });

  it("switches one bit", () => {
    expect(toggled(0b101, 0b100)).toBe(0b001);
    expect(toggled(0b001, 0b100)).toBe(0b101);
  });

  it("lists with or", () => {
    expect(orList(["A"])).toBe("A");
    expect(orList(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("layer masks", () => {
  it("names only the layers the keyboard has, at most 16", () => {
    expect(layersIn(0xffff, 4)).toEqual([0, 1, 2, 3]);
    expect(layersIn(0b10010, 4)).toEqual([1]);
    expect(layersIn(0xffff, 20)).toHaveLength(16);
    expect(allLayers(4)).toBe(0b1111);
    expect(allLayers(20)).toBe(0xffff);
  });

  it("says where in words", () => {
    expect(layerPhrase(0xffff, 4, names)).toBe("on every layer");
    expect(layerPhrase(0b1111, 4, names)).toBe("on every layer");
    expect(layerPhrase(0b0001, 4, names)).toBe("on Base only");
    expect(layerPhrase(0b0101, 4, names)).toBe("on Base and Layer 2");
    expect(layerPhrase(0b1110000, 4, names)).toBe("on no layer");
  });
});

describe("key overrides", () => {
  it("is set up when anything in it isn't empty; the first one that isn't is free", () => {
    const empty = { ...clearedKeyOverride(NONE), index: 1 };
    const set = { ...override(), index: 0 };
    expect([set, empty].map(keyOverrideIsSet)).toEqual([true, false]);
    expect(keyOverrideIsSet({ ...empty, layers: 1 })).toBe(true);
    expect(freeKeyOverride([set, empty])).toBe(1);
    expect(freeKeyOverride([set])).toBeNull();
  });

  it("starts a new one on every layer, switched on, started all three ways", () => {
    const draft = newKeyOverride(NONE, 4);
    expect(draft.layers).toBe(0b1111);
    expect(draft.enabled).toBe(true);
    expect(keyOverrideRequest(draft).options).toBe(0x87);
  });

  it("sends the options with the enabled bit as the switch says, and only the bits the protocol has", () => {
    expect(keyOverrideRequest(override({ options: 0xff, enabled: false })).options).toBe(0x3f);
    expect(keyOverrideRequest(override({ options: 0x01, enabled: true })).options).toBe(0x81);
    expect(keyOverrideRequest(override())).toEqual({
      trigger: "KC_BSPC", replacement: "KC_DEL", layers: 0xffff, triggerMods: LSFT, negativeModMask: 0,
      suppressedMods: LSFT, options: 0x87,
    });
  });

  it("clears every field to remove it", () => {
    expect(keyOverrideRequest(clearedKeyOverride(NONE))).toEqual({
      trigger: "KC_NO", replacement: "KC_NO", layers: 0, triggerMods: 0, negativeModMask: 0, suppressedMods: 0,
      options: 0,
    });
  });

  it("says what it does", () => {
    expect(keyOverrideSentence(override(), 4, names)).toBe("Left Shift + BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ triggerMods: LCTL | 0x04, layers: 1 }), 4, names))
      .toBe("Left Ctrl + Left Alt + BSPC sends DEL, on Base only.");
    expect(keyOverrideSentence(override({ triggerMods: LCTL | 0x04, options: 0x88 }), 4, names))
      .toBe("Left Ctrl or Left Alt + BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ triggerMods: 0 }), 4, names)).toBe("BSPC sends DEL, on every layer.");
    expect(keyOverrideSentence(override({ replacement: NONE }), 4, names)).toBe("Left Shift + BSPC sends nothing, on every layer.");
  });

  it("with no trigger key, the modifiers alone trigger it; with neither, it says so", () => {
    expect(keyOverrideSentence(override({ trigger: NONE, replacement: described("KC_CAPS") }), 4, names))
      .toBe("Holding Left Shift sends Caps Lock, on every layer.");
    expect(keyOverrideSentence(override({ trigger: NONE, triggerMods: 0 }), 4, names))
      .toBe("No trigger yet: choose a trigger key, or modifiers.");
  });

  it("lists what isn't QMK's usual", () => {
    expect(keyOverrideDetails(override())).toEqual(["Left Shift is hidden from the computer while it works"]);
    expect(keyOverrideDetails(override({ negativeModMask: LCTL | 0x10, suppressedMods: 0, options: 0x81 | 0x30 }))).toEqual([
      "Not while Ctrl is held", "Don't press the trigger key again afterwards", "Don't end when another key is pressed",
      "Starts only: when the trigger key goes down",
    ]);
    expect(keyOverrideDetails(override({ suppressedMods: LSFT | RSFT | LCTL, options: 0x8f }))).toEqual([
      "Left Ctrl and Shift are hidden from the computer while it works", "Any one trigger modifier is enough",
    ]);
  });

  it("says why it can never work", () => {
    expect(keyOverrideProblems(override(), 4)).toEqual([]);
    expect(keyOverrideProblems(override({ trigger: NONE, triggerMods: 0 }), 4)).toEqual([
      "It has no trigger key and no trigger modifiers, so it never works."]);
    expect(keyOverrideProblems(override({ trigger: NONE }), 4)).toEqual([]);
    // layers 4 and up: this keyboard has only 4
    expect(keyOverrideProblems(override({ layers: 0xfff0 }), 4)).toEqual([
      "It is on no layer of this keyboard, so it never works."]);
    expect(keyOverrideProblems(override({ options: 0x88 }), 4)).toEqual([
      "None of the three ways to start it is on, so it never starts."]);
  });
});

describe("alt-repeat keys", () => {
  it("is set up when anything in it isn't empty", () => {
    expect(model.altRepeatKeys.map(altRepeatIsSet)).toEqual([true, false]);
    expect(freeAltRepeat(model.altRepeatKeys)).toBe(1);
  });

  it("starts a new one switched on, and sends the enabled bit as the switch says", () => {
    expect(altRepeatRequest(newAltRepeat(NONE))).toEqual({ keycode: "KC_NO", altKeycode: "KC_NO", allowedMods: 0, options: 8 });
    expect(altRepeatRequest(altRepeat({ options: 0xff, enabled: false })).options).toBe(0x07);
  });

  it("says what it does", () => {
    expect(altRepeatSentence(altRepeat(), names)).toBe("After LEFT, Alt Repeat sends RIGHT.");
    expect(altRepeatSentence(altRepeat({ allowedMods: LSFT, options: AR_ENABLED | 0x02 }), names))
      .toBe("After LEFT (alone, or with Left Shift), Alt Repeat sends RIGHT, and the other way round.");
    expect(altRepeatSentence(altRepeat({ allowedMods: RSFT | LCTL, options: AR_ENABLED | 0x04 }), names))
      .toBe("After LEFT (alone, or with Ctrl or Shift), Alt Repeat sends RIGHT.");
    expect(altRepeatSentence(altRepeat({ altKeycode: NONE, options: 0x0a }), names)).toBe("After LEFT, Alt Repeat sends nothing.");
    // the default alt key: also after any key no other entry covers (vial.c get_alt_repeat_key_keycode_user)
    expect(altRepeatSentence(altRepeat({ options: AR_ENABLED | 0x01 }), names))
      .toBe("After LEFT, Alt Repeat sends RIGHT. After any other key that no alt-repeat key covers, it sends RIGHT too.");
    expect(altRepeatSentence(altRepeat({ keycode: NONE }), names))
      .toBe("No key chosen yet: choose the last key, and what Alt Repeat sends after it.");
  });
});

describe("pressable", () => {
  it("finds a keycode on a key, in a tap dance slot, or as the output of a combo that has keys", () => {
    expect(pressable("QK_ALT_REPEAT_KEY", model)).toBe(true);
    expect(pressable("KC_CAPS", model)).toBe(true);
    expect(pressable("KC_ESC", model)).toBe(true);
    expect(pressable("KC_ENT", model)).toBe(false); // combo 1 has no keys
    expect(pressable("QK_REPEAT_KEY", model)).toBe(false);
  });
});
