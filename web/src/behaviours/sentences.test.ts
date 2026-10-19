import { describe, expect, it } from "vitest";
import { codesOn, combosOf } from "../analysis/combos";
import { AT, corne, described, layer } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import type { Use } from "../analysis/usage";
import { namesOf } from "../keyboard/labels";
import { comboNotes, comboSentence, outcome, tapDanceSentence, useLabel } from "./sentences";

const model = corne({
  layers: [layer({}, "KC_NO"), layer({}), layer({}), layer({})],
  tapDances: [
    ["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"],
    ["KC_ESC", "KC_LCTL", "MO(2)", "TG(3)"],
    ["KC_NO", "KC_NO", "KC_NO", "KC_NO"],
    ["KC_TRNS", "KC_TRNS", "KC_TAB", "KC_NO"],
    ["KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS"],
    ["KC_NO", "MO(1)", "KC_NO", "KC_NO"],
    ["MO(1)", "KC_NO", "LM(2, MOD_LSFT)", "TT(3)"],
    ["TT(1)", "TT(2)", "LT3(KC_NO)", "LT1(KC_SPC)"],
  ],
});
const names = namesOf(model);

describe("tapDanceSentence", () => {
  it("says what each way of pressing does, leaving out the empty ones", () => {
    expect(tapDanceSentence(model.tapDance[0], names)).toBe("Tap for Tab, double-tap for Caps Lock.");
    expect(tapDanceSentence(model.tapDance[1], names)).toBe(
      "Tap for Esc, hold for LCTL, double-tap and hold for Layer 2, tap then hold to toggle Layer 3.");
  });

  it("leaves out transparent slots: there is no layer below a tap dance to fall through to", () => {
    expect(tapDanceSentence(model.tapDance[3], names)).toBe("Double-tap for Tab.");
  });

  it("says when it does nothing yet: every slot empty or transparent", () => {
    expect(tapDanceSentence(model.tapDance[2], names)).toBe("Does nothing yet: choose what each way of pressing it does.");
    expect(tapDanceSentence(model.tapDance[4], names)).toBe("Does nothing yet: choose what each way of pressing it does.");
  });

  it("says what a tap dance with only a hold does", () => {
    expect(tapDanceSentence(model.tapDance[5], names)).toBe("Hold for Layer 1.");
  });

  it("says a layer held from a tapped slot needs the key held after the last tap", () => {
    expect(tapDanceSentence(model.tapDance[6], names)).toBe(
      "Tap and hold for Layer 1, double-tap and hold for Layer 2 with Shift, tap then hold for Layer 3.");
  });

  it("says a hold-or-toggle key in a held slot is held, and a layer-tap with nothing to tap holds its layer", () => {
    expect(tapDanceSentence(model.tapDance[7], names)).toBe(
      "Tap to hold or toggle Layer 1, hold for Layer 2, double-tap and hold for Layer 3, " +
      "tap then hold for Space (hold: Layer 1).");
  });
});

describe("outcome", () => {
  it("names what a layer key does with its layer", () => {
    expect(["MO(1)", "TG(1)", "TO(1)", "OSL(1)", "TT(1)", "DF(1)", "PDF(1)", "LM(1, MOD_LSFT)"]
      .map((c) => outcome(described(c), names))).toEqual([
      "for Layer 1", "to toggle Layer 1", "to switch to Layer 1", "for Layer 1 on the next key",
      "to hold or toggle Layer 1", "to make Layer 1 the default layer", "to make Layer 1 the default layer for good",
      "for Layer 1 with Shift",
    ]);
  });

  it("names a key with a hold action with both", () => {
    expect(outcome(described("LT1(KC_SPC)"), names)).toBe("for Space (hold: Layer 1)");
    expect(outcome(described("LSFT_T(KC_T)"), names)).toBe("for T (hold: Shift)");
    expect(outcome(described("LT1(KC_NO)"), names)).toBe("for Layer 1");
  });

  it("names tap dances, macros and one-shot modifiers in lower case, as they fall mid-sentence", () => {
    expect(outcome(described("TD(0)"), names)).toBe("for tap dance 0");
    expect(outcome(described("TD(0)"), { ...names, tapDance: () => "Esc-Ctl" })).toBe("for tap dance 0 · Esc-Ctl");
    expect(outcome(described("M0"), names)).toBe("for macro 0");
    expect(outcome({ ...described("KC_A"), kind: "one-shot-mod", tap: "Shift" }, names)).toBe("for one-shot Shift");
    expect(outcome(described("KC_NO"), names)).toBe("for nothing");
    expect(outcome(described("KC_TRNS"), names)).toBe("for nothing");
  });
});

describe("comboSentence", () => {
  const combos = corne({
    layers: [layer({ [AT.grid(2, 9)]: "KC_K", [AT.grid(2, 10)]: "KC_Y", [AT.leftInnerThumb]: "MO(5)",
      [AT.rightOuterThumb]: "OSL(3)" }, "KC_NO"), ...Array.from({ length: 5 }, () => layer({}))],
    tapDances: [["KC_A", "MO(1)", "KC_NO", "KC_NO"], ["MO(1)", "MO(2)", "TG(3)", "TT(4)"],
      ["MO(1)", "KC_NO", "KC_NO", "KC_NO"]],
    combos: [
      { keys: ["KC_K", "KC_Y"], output: "KC_ESC" },
      { keys: ["MO(5)", "OSL(3)"], output: "MO(2)" },
      { keys: ["KC_K", "KC_Y"], output: "LT1(KC_SPC)" },
      { keys: ["KC_K"], output: "TD(0)" },
      { keys: ["KC_K"], output: "KC_NO" },
      { keys: [], output: "KC_ESC" },
      { keys: ["KC_K", "KC_Y"], output: "TG(4)" },
      { keys: ["KC_K", "KC_Y"], output: "KC_TRNS" },
      { keys: ["KC_K"], output: "KC_ESC" },
      { keys: ["KC_K", "KC_Y"], output: "LM(1, MOD_LSFT)" },
      { keys: ["KC_K", "KC_Y"], output: "LT1(KC_NO)" },
      { keys: ["KC_K", "KC_Y"], output: "TD(1)" },
      { keys: ["KC_K", "KC_Y"], output: "TD(2)" },
      { keys: ["KC_K", "KC_Y"], output: "MO(9)" },
      { keys: ["KC_K", "KC_Y"], output: "TG(9)" },
      { keys: ["KC_K", "KC_Y"], output: "LT9(KC_SPC)" },
      { keys: ["KC_K", "KC_Y"], output: "LT9(KC_NO)" },
      { keys: ["KC_K"], output: "LT1(KC_SPC)" },
      { keys: ["KC_K"], output: "LT1(KC_NO)" },
      { keys: ["KC_K", "KC_Y"], output: "M0" },
    ],
  });
  const placement = placeKeyboard(combos);
  const info = combosOf(combos, placement);
  const sentence = (index: number) => {
    const combo = info.find((c) => c.index === index) ?? { members: [], output: combos.combos[index].output };
    return comboSentence(combo, combos, namesOf(combos));
  };

  it("says which keys to press together, and what for", () => {
    expect(sentence(0)).toBe("Press K + Y together for Esc.");
    expect(sentence(19)).toBe("Press K + Y together for macro 0.");
  });

  it("says which key to press for a combo of one key, without \"together\"", () => {
    expect(sentence(8)).toBe("Press K for Esc.");
    expect(sentence(17)).toBe("Press K for Space, or hold it → reaches Layer 1.");
    expect(sentence(18)).toBe("Hold K → reaches Layer 1.");
  });

  it("says which layer a combo of layer keys reaches, as the Overview does", () => {
    expect(sentence(1)).toBe("Press MO(5) + OSL(3) together → reaches Layer 2, while held.");
    expect(sentence(6)).toBe("Press K + Y together → reaches Layer 4, toggled on or off.");
    expect(sentence(9)).toBe("Press K + Y together → reaches Layer 1, while held, with Shift.");
  });

  it("says when the output reaches a layer when held, or from a tap dance slot", () => {
    expect(sentence(2)).toBe("Press K + Y together for Space, or hold them → reaches Layer 1.");
    expect(sentence(10)).toBe("Hold K + Y together → reaches Layer 1.");
    expect(sentence(3)).toBe("Press K for tap dance 0, which reaches Layer 1 when held.");
  });

  it("says a layer held from a tapped slot of a tap dance output needs a hold, and what each slot does", () => {
    expect(sentence(12)).toBe("Press K + Y together for tap dance 2, which reaches Layer 1 when tapped and held.");
    expect(sentence(11)).toBe("Press K + Y together for tap dance 1, which reaches Layer 1 when tapped and held, " +
      "reaches Layer 2 when held, toggles Layer 3 when double-tapped and reaches Layer 4 when tapped then held.");
  });

  it("says when the output's layer is one the keyboard doesn't have", () => {
    expect(sentence(13)).toBe("Press K + Y together for Layer 9, which this keyboard doesn't have.");
    expect(sentence(14)).toBe("Press K + Y together to toggle Layer 9, which this keyboard doesn't have.");
    expect(sentence(15)).toBe(
      "Press K + Y together for Space, or hold them for Layer 9, which this keyboard doesn't have.");
    expect(sentence(16)).toBe("Hold K + Y together for Layer 9, which this keyboard doesn't have.");
  });

  it("says when there is nothing to press or nothing it does, a transparent output too", () => {
    expect(sentence(4)).toBe("Press K: it does nothing yet.");
    expect(sentence(7)).toBe("Press K + Y together: it does nothing yet.");
    expect(sentence(5)).toBe("No keys chosen yet.");
  });
});

describe("comboNotes", () => {
  const notesOf = (keys: string[], layers: string[][]) => {
    const m = corne({ layers, combos: [{ keys, output: "KC_ESC" }] });
    const p = placeKeyboard(m);
    const codes = m.layers.map((_, l) => codesOn(m, p, l));
    return comboNotes(combosOf(m, p)[0], codes, namesOf(m));
  };

  it("has nothing to say about a combo whose keys are each on one key of the base layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A", 1: "KC_B" }, "KC_NO")])).toEqual([]);
  });

  it("says when a keycode is on several keys: either one works", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A", 1: "KC_B", 2: "KC_B" }, "KC_NO")]))
      .toEqual(["B is on 2 keys of the base layer: either one works."]);
  });

  it("says nothing about a keycode on several keys of a combo that can't fire", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A", 1: "KC_A" }, "KC_NO")]))
      .toEqual(["B isn't on any key, so it can't fire."]);
    expect(notesOf(["KC_A", "KC_B"],
      [layer({ 0: "KC_A", 1: "KC_A" }, "KC_NO"), layer({ 0: "KC_NO", 1: "KC_NO", 2: "KC_B" }, "KC_NO")]))
      .toEqual(["Its keys aren't all on one layer, so it can't fire."]);
  });

  it("says when it can't fire: a keycode on no key, or not all on one layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO")])).toEqual(["B isn't on any key, so it can't fire."]);
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO"), layer({ 0: "KC_NO", 1: "KC_B" }, "KC_NO")]))
      .toEqual(["Its keys aren't all on one layer, so it can't fire."]);
  });

  it("says where it fires when its keys aren't on the base layer", () => {
    expect(notesOf(["KC_A", "KC_B"], [layer({ 0: "KC_A" }, "KC_NO"), layer({ 1: "KC_B" })]))
      .toEqual(["B isn't on the base layer: it fires on Layer 1."]);
  });

  it("says a combo that has a keycode twice never fires", () => {
    expect(notesOf(["KC_A", "KC_A"], [layer({ 0: "KC_A", 1: "KC_A" }, "KC_NO")]))
      .toEqual(["It has A twice, so it never fires."]);
  });
});

describe("useLabel", () => {
  const positions = new Map([["key:38", "left inner thumb"]]);
  it("names each kind of use", () => {
    expect(([
      { type: "key", layer: 0, ref: { kind: "key", index: 38 } },
      { type: "combo", combo: 1, part: "output" },
      { type: "combo", combo: 1, part: "key" },
      { type: "tap-dance", tapDance: 0, slot: "Double tap" },
      { type: "macro", macro: 2, step: 0 },
      { type: "key-override", keyOverride: 0, part: "replacement" },
      { type: "alt-repeat", altRepeat: 1, part: "alt keycode" },
    ] satisfies Use[]).map((use) => useLabel(use, names, positions))).toEqual([
      "Base, left inner thumb", "combo 1's output", "combo 1's keys", "tap dance 0, double tap", "macro 2, step 1",
      "key override 0's replacement", "alt-repeat key 1's alt keycode",
    ]);
  });
});
