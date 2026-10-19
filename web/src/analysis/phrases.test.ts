import { describe, expect, it } from "vitest";
import type { KeyboardModel } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { codesOn, combosOf, combosUsing } from "./combos";
import {
  comboMarkLabel, comboName, comboUseLabel, memberName, missingPartners, tapName, unreachedReason, wayDetail, wayLabel,
  type PhraseContext,
} from "./phrases";
import { positionNames } from "./positions";
import { layerReach } from "./reach";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";

function setup(model: KeyboardModel) {
  const placement = placeKeyboard(model);
  const ctx: PhraseContext = { model, names: namesOf(model), positions: positionNames(placement) };
  const reach = layerReach(model, placement);
  return {
    ctx,
    reach,
    labels: reach.map((r) => r.ways.map((w) => wayLabel(w, ctx))),
    details: reach.map((r) => r.ways.map((w) => wayDetail(w, ctx))),
  };
}

const of = (s: Setup) => setup(corne(s));

describe("tapName", () => {
  const model = corne({ layers: [], tapDances: [["KC_TAB", "MO(1)", "KC_NO", "KC_NO"], ["OSL(2)", "KC_NO", "KC_NO", "KC_NO"]] });

  it("is what a key types when tapped", () => {
    expect(tapName(described("LT1(KC_SPC)"), model)).toBe("Space");
    expect(tapName(described("LSFT_T(KC_T)"), model)).toBe("T");
    expect(tapName(described("KC_K"), model)).toBe("K");
  });

  it("is what a tap dance taps, when that is a key", () => {
    expect(tapName(described("TD(0)"), model)).toBe("Tab");
    expect(tapName(described("TD(1)"), model)).toBeNull();
    expect(tapName(described("TD(9)"), model)).toBeNull();
  });

  it("is null for keys whose label says nothing about them", () => {
    for (const code of ["MO(1)", "OSL(3)", "M0", "KC_NO", "KC_TRNS", "LT1(KC_NO)"]) {
      expect(tapName(described(code), model)).toBeNull();
    }
  });

  it("doesn't follow a tap dance that a tap dance taps, so one running itself or another one running it is null", () => {
    const self = corne({ layers: [], tapDances: [["TD(0)", "MO(1)", "KC_NO", "KC_NO"]] });
    expect(tapName(described("TD(0)"), self)).toBeNull();
    const mutual = corne({
      layers: [], tapDances: [["TD(1)", "MO(1)", "KC_NO", "KC_NO"], ["TD(0)", "MO(2)", "KC_NO", "KC_NO"]],
    });
    expect(tapName(described("TD(0)"), mutual)).toBeNull();
    expect(tapName(described("TD(1)"), mutual)).toBeNull();
  });
});

describe("memberName and comboName", () => {
  const names = namesOf(corne({ layers: [layer({}), layer({})] }));

  it("names layer, tap dance and macro keys by their keycode, others by what they type and do on hold", () => {
    expect(["MO(5)", "OSL(3)", "TD(0)", "M1", "KC_K", "LT1(KC_SPC)", "LSFT_T(KC_T)"].map((c) => memberName(described(c), names)))
      .toEqual(["MO(5)", "OSL(3)", "TD(0)", "M1", "K", "Space (hold: Layer 1)", "T (hold: Shift)"]);
    expect(memberName({ ...described("KC_A"), kind: "one-shot-mod", tap: "Shift" }, names)).toBe("one-shot Shift");
    expect(memberName({ ...described("LT1(KC_NO)"), tap: "" }, names)).toBe("nothing (hold: Layer 1)");
  });

  it("names a layer key without a keycode name (LM, with its modifiers) and the tri-layer keys by their label", () => {
    expect(memberName({ ...described("LM(1, MOD_LSFT)"), code: "0x5022" }, names)).toBe("LM 1 (with Shift)");
    expect(memberName({ ...described("LM(1, 0)"), code: "0x5020" }, names)).toBe("LM 1");
    expect(memberName(described("FN_MO13"), names)).toBe("Fn1 (Fn3)");
  });

  it("joins a combo's keycodes with +", () => {
    expect(comboName([{ action: described("MO(5)") }, { action: described("OSL(3)") }], names)).toBe("MO(5) + OSL(3)");
  });
});

describe("wayLabel and wayDetail", () => {
  it("say how the simulated Corne's layers are reached", () => {
    const { labels, details } = setup(simulatedCorne());
    expect(labels).toEqual([
      ["default layer", "switch to it from Layer 3 (right outer thumb)"],
      ["hold Space"],
      ["hold B", "hold S"],
      ["one-shot (right outer thumb)"],
    ]);
    expect(details).toEqual([
      ["the layer the keyboard starts on", "from Layer 3"],
      ["from any layer"],
      ["from any layer", "from Base, Layer 1"],
      ["from any layer"],
    ]);
  });

  it("name a layer key without a tap label by where it is", () => {
    const { labels } = of({
      layers: [
        layer({
          [AT.leftInnerThumb]: "MO(1)", [AT.leftOuterThumb]: "TG(2)", [AT.grid(0, 0)]: "TT(3)", [AT.grid(0, 11)]: "DF(4)",
          [AT.rightInnerThumb]: "LM(5, MOD_LSFT)", [AT.rightMiddleThumb]: "OSL(6)", [AT.rightOuterThumb]: "PDF(7)",
        }, "KC_NO"),
        ...Array.from({ length: 7 }, () => layer({}, "KC_NO")),
      ],
    });
    expect(labels.slice(1)).toEqual([
      ["hold (left inner thumb)"],
      ["toggle (left outer thumb)"],
      ["hold or toggle (left top row, 1st from the outside)"],
      ["make default (right top row, 1st from the outside)"],
      ["hold with Shift (right inner thumb)"],
      ["one-shot (right middle thumb)"],
      ["make default for good (right outer thumb)"],
    ]);
  });

  it('say "switch to it" for a switch key, named by where it is', () => {
    const { labels } = of({ layers: [layer({ [AT.leftOuterThumb]: "TO(1)" }, "KC_NO"), layer({}, "KC_NO")] });
    expect(labels[1]).toEqual(["switch to it (left outer thumb)"]);
  });

  it("use the names the user gave the layers", () => {
    const model = corne({
      layers: [layer({ 0: "LT1(KC_SPC)", 1: "KC_J", 2: "KC_K" }, "KC_NO"), layer({ 3: "MO(2)" }), layer({ 3: "TG(3)" }),
        layer({ [AT.rightOuterThumb]: "TO(0)" }, "KC_NO")],
      combos: [{ keys: ["LT1(KC_SPC)", "KC_J"], output: "OSL(2)" }],
    });
    ["Base", "Nav", "Sym", "Num"].forEach((name, i) => (model.layers[i] = { ...model.layers[i], name, customName: i > 0 }));
    const { labels, details } = setup(model);
    expect(labels[0]).toEqual(["default layer", "switch to it from Num (right outer thumb)"]);
    expect(labels[2]).toEqual([
      "hold from Nav (left top row, 4th from the outside)", "combo: Space (hold: Nav) + J for a one-shot",
    ]);
    expect(details[2]).toEqual(["from Nav", "from Base, Nav"]);
    expect(labels[3]).toEqual(["toggle from Sym (left top row, 4th from the outside)"]);
  });

  it("name a layer-tap by what it types", () => {
    const { labels } = of({ layers: [layer({ 0: "LT1(KC_SPC)", 1: "LT1(KC_NO)" }, "KC_NO"), layer({}, "KC_NO")] });
    expect(labels[1]).toEqual(["hold Space", "hold (left top row, 2nd from the outside)"]);
  });

  it("say which tap dance slot reaches a layer, named by what the tap dance taps", () => {
    const { labels, details } = of({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)", [AT.rightInnerThumb]: "TD(1)" }, "KC_NO"),
        ...Array.from({ length: 6 }, () => layer({}, "KC_NO"))],
      tapDances: [["KC_TAB", "MO(1)", "TG(2)", "MO(3)"], ["OSL(4)", "KC_NO", "MO(6)", "TO(5)"]],
    });
    expect(labels.slice(1)).toEqual([
      ["hold Tab"],
      ["double-tap Tab to toggle"],
      ["tap then hold Tab"],
      ["tap for a one-shot (right inner thumb)"],
      ["tap then hold to switch (right inner thumb)"],
      ["double-tap and hold (right inner thumb)"],
    ]);
    expect(details[2]).toEqual(["tap dance 0, double tap · from Base"]);
  });

  it('say "hold" for a hold-or-toggle key in a held tap dance slot: holding it holds the layer', () => {
    const { labels } = of({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)", 0: "KC_J", 1: "KC_K" }, "KC_NO"),
        ...Array.from({ length: 4 }, () => layer({}, "KC_NO"))],
      tapDances: [["KC_TAB", "TT(1)", "TT(2)", "TT(3)"], ["KC_NO", "TT(4)", "KC_NO", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TD(1)" }],
    });
    expect(labels.slice(1)).toEqual([
      ["hold Tab"], ["double-tap Tab to hold or toggle"], ["tap then hold Tab"], ["combo: J + K, held"],
    ]);
  });

  it("name a tap dance that runs itself, or that another one runs, by where it is", () => {
    const self = of({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)" }, "KC_NO"), layer({}, "KC_NO")],
      tapDances: [["TD(0)", "MO(1)", "KC_NO", "KC_NO"]],
    });
    expect(self.labels[1]).toEqual(["hold (left outer thumb)"]);
    const mutual = of({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)", [AT.rightOuterThumb]: "TD(1)" }, "KC_NO"),
        layer({}, "KC_NO"), layer({}, "KC_NO")],
      tapDances: [["TD(1)", "MO(1)", "KC_NO", "KC_NO"], ["TD(0)", "MO(2)", "KC_NO", "KC_NO"]],
    });
    expect(mutual.labels.slice(1)).toEqual([["hold (left outer thumb)"], ["hold (right outer thumb)"]]);
  });

  it("name a combo by its keycodes, and the tap dance slot of a combo's tap dance", () => {
    const { labels, details } = of({
      layers: [layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", 0: "KC_J", 1: "KC_K", 2: "LT1(KC_SPC)" },
        "KC_NO"), ...Array.from({ length: 7 }, () => layer({}))],
      tapDances: [["KC_ESC", "MO(4)", "TG(6)", "KC_NO"]],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_J", "KC_K"], output: "TD(0)" },
        { keys: ["KC_Q", "KC_W"], output: "TG(7)" }, { keys: ["LT1(KC_SPC)", "OSL(3)"], output: "LM(1, MOD_LCTL)" }],
    });
    expect(labels[2]).toEqual(["combo: MO(5) + OSL(3)"]);
    expect(labels[4]).toEqual(["combo: J + K, held"]);
    expect(labels[6]).toEqual(["combo: J + K, double-tapped to toggle"]);
    expect(labels[7]).toEqual(["combo: Q + W to toggle"]);
    expect(details[7]).toEqual(["can't fire: its keys aren't all on one layer"]);
    const twice = of({
      layers: [layer({ 0: "KC_J", 1: "KC_J" }, "KC_NO"), layer({})],
      combos: [{ keys: ["KC_J", "KC_J"], output: "TG(1)" }],
    });
    expect(twice.details[1]).toEqual(["can't fire: it has J twice"]);
    expect(labels[1]).toEqual(["hold Space", "combo: Space (hold: Layer 1) + OSL(3) with Ctrl"]);
  });

  it("say that a combo's tap dance is tapped and held, or double-tapped and held, for a layer held in that slot", () => {
    const { labels } = of({
      layers: [layer({ 0: "KC_J", 1: "KC_K" }, "KC_NO"), layer({}), layer({}), layer({})],
      tapDances: [["MO(1)", "KC_NO", "MO(2)", "MO(3)"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TD(0)" }],
    });
    expect(labels.slice(1)).toEqual([
      ["combo: J + K, tapped and held"], ["combo: J + K, double-tapped and held"], ["combo: J + K, tapped then held"],
    ]);
  });

  it("say where a way works when it doesn't work on the base layer", () => {
    const { labels, details } = of({
      layers: [layer({ 0: "MO(1)" }, "KC_NO"), layer({ 2: "MO(3)", 3: "KC_J", 4: "KC_K" }),
        layer({ 3: "KC_J", 4: "KC_K" }), layer({})],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TG(3)" }],
    });
    expect(labels[3]).toEqual([
      "hold from Layer 1 (left top row, 3rd from the outside)", "combo: J + K to toggle from Layer 1, Layer 2",
    ]);
    expect(details[3]).toEqual(["from Layer 1", "from Layer 1, Layer 2"]);
  });

  it("say which keys to hold together for the tri-layer", () => {
    const { labels } = of({
      layers: [layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({}), layer({}), layer({}, "KC_NO")],
    });
    expect(labels[1]).toEqual(["hold (left inner thumb)"]);
    expect(labels[3]).toEqual(["hold both Fn keys (left inner thumb and right inner thumb)"]);
  });

  it("say that a hold-or-toggle key on an encoder toggles after a few quick turns, as the firmware's TT does", () => {
    const model = corne({ layers: [layer({}, "KC_NO"), layer({}, "KC_NO"), layer({}, "KC_NO")] });
    model.encoders = [0, 1].map((i) =>
      ({ ...model.keys[0], row: null, col: null, encoder: 0, direction: 1 - i, x: 20 + 2 * i }));
    model.layers.forEach((l, i) => (l.encoders = i === 0 ? [described("TT(1)"), described("TG(2)")] : [
      described("KC_TRNS"), described("KC_TRNS")]));
    const { labels, details } = setup(model);
    expect(labels[1]).toEqual(["turn it 5 times quickly to toggle (encoder 0, clockwise)"]);
    expect(details[1]).toEqual(["from any layer"]);
    expect(labels[2]).toEqual(["toggle (encoder 0, counter-clockwise)"]);
  });
});

describe("unreachedReason", () => {
  it("is null for a reachable layer, and says why another can't be reached", () => {
    const { reach } = of({ layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({}), layer({ 1: "MO(3)" }, "KC_NO"), layer({})] });
    expect(reach.map(unreachedReason)).toEqual([
      null, "Nothing reaches this layer", "Nothing reaches this layer", "Only reached from layers that nothing reaches",
    ]);
  });

  it("says when only combos that can't fire reach a layer", () => {
    const { reach } = of({
      layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({}), layer({}), layer({ 1: "MO(4)" }, "KC_NO"), layer({})],
      tapDances: [["KC_NO", "MO(2)", "TG(2)", "KC_NO"]],
      combos: [{ keys: ["KC_Q", "KC_W"], output: "MO(1)" }, { keys: ["KC_Q", "KC_E"], output: "TD(0)" },
        { keys: ["KC_Q", "KC_R"], output: "TG(2)" }, { keys: ["KC_Q", "KC_W"], output: "MO(4)" }],
    });
    expect(reach.map(unreachedReason)).toEqual([
      null, "Only a combo that can't fire reaches this layer", "Only combos that can't fire reach this layer",
      "Nothing reaches this layer", "Only reached from layers that nothing reaches",
    ]);
  });
});

describe("comboUseLabel and missingPartners", () => {
  const model = corne({
    layers: [layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", 0: "KC_K", 1: "KC_A" }, "KC_NO"),
      ...Array.from({ length: 7 }, () => layer({}))],
    combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_K", "KC_Y"], output: "KC_ESC" },
      { keys: ["KC_A"], output: "KC_B" }, { keys: ["KC_A", "KC_Q", "KC_W"], output: "KC_C" }],
  });
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const names = namesOf(model);
  const uses = (index: number) => combosUsing(combos, model, codesOn(model, placement, 0), 0, { kind: "key", index });

  it("say what the other keys are and what the combo does", () => {
    expect(uses(AT.leftInnerThumb).map((u) => comboUseLabel(u, names))).toEqual(["with OSL(3) → Layer 2, while held"]);
    expect(uses(AT.rightOuterThumb).map((u) => comboUseLabel(u, names))).toEqual(["with MO(5) → Layer 2, while held"]);
    expect(uses(0).map((u) => comboUseLabel(u, names))).toEqual(["with Y → Esc"]);
    expect(uses(1).map((u) => comboUseLabel(u, names))).toEqual(["on its own → B", "with Q + W → C"]);
  });

  it("name a layer-tap partner by what it types and what holding it does", () => {
    const lt = corne({
      layers: [layer({ 0: "LT1(KC_SPC)", 1: "OSL(3)" }, "KC_NO"), layer({}), layer({}), layer({})],
      combos: [{ keys: ["LT1(KC_SPC)", "OSL(3)"], output: "MO(2)" }],
    });
    const p = placeKeyboard(lt);
    const [use] = combosUsing(combosOf(lt, p), lt, codesOn(lt, p, 0), 0, { kind: "key", index: 1 });
    expect(comboUseLabel(use, namesOf(lt))).toBe("with Space (hold: Layer 1) → Layer 2, while held");
  });

  it("say what holding a combo's layer-tap or mod-tap output does", () => {
    const outputs = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_B" }, "KC_NO"), layer({})],
      combos: [{ keys: ["KC_A", "KC_B"], output: "LT1(KC_SPC)" }, { keys: ["KC_A"], output: "LSFT_T(KC_T)" }],
    });
    outputs.layers[1] = { ...outputs.layers[1], name: "Nav", customName: true };
    const p = placeKeyboard(outputs);
    const used = combosUsing(combosOf(outputs, p), outputs, codesOn(outputs, p, 0), 0, { kind: "key", index: 0 });
    expect(used.map((u) => comboUseLabel(u, namesOf(outputs)))).toEqual([
      "with B → Space (hold: Nav)", "on its own → T (hold: Shift)",
    ]);
  });

  it("say which other keys aren't on the layer", () => {
    expect(uses(AT.leftInnerThumb).map((u) => missingPartners(u, names))).toEqual([null]);
    expect(uses(0).map((u) => missingPartners(u, names))).toEqual(["Y isn't on this layer"]);
    expect(uses(1).map((u) => missingPartners(u, names))).toEqual([null, "Q and W aren't on this layer"]);
  });

  it("list three or more missing keys with commas", () => {
    const many = corne({
      layers: [layer({ 0: "KC_A" }, "KC_NO")],
      combos: [{ keys: ["KC_A", "KC_Q", "KC_W", "KC_E"], output: "KC_B" }],
    });
    const p = placeKeyboard(many);
    const [use] = combosUsing(combosOf(many, p), many, codesOn(many, p, 0), 0, { kind: "key", index: 0 });
    expect(missingPartners(use, namesOf(many))).toBe("Q, W and E aren't on this layer");
  });

  it("say that a combo listing a keycode twice never fires", () => {
    const twice = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_A" }, "KC_NO")],
      combos: [{ keys: ["KC_A", "KC_A"], output: "KC_B" }, { keys: ["KC_A", "KC_Q", "KC_A", "KC_Q"], output: "KC_C" }],
    });
    const p = placeKeyboard(twice);
    const used = combosUsing(combosOf(twice, p), twice, codesOn(twice, p, 0), 0, { kind: "key", index: 0 });
    expect(used.map((u) => missingPartners(u, namesOf(twice)))).toEqual([
      "It has A twice, so it never fires", "It has A and Q twice, so it never fires",
    ]);
  });
});

describe("comboMarkLabel", () => {
  it("names the combos a key is part of", () => {
    expect(comboMarkLabel([])).toBe("");
    expect(comboMarkLabel([2])).toBe(" · in combo 2");
    expect(comboMarkLabel([0, 1, 3])).toBe(" · in combos 0, 1 and 3");
  });
});
