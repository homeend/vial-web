import { describe, expect, it } from "vitest";
import type { KeyboardModel } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { layerReach, layerTargets, type Way } from "./reach";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";

function reach(setup: Setup) {
  const model = corne(setup);
  return layerReach(model, placeKeyboard(model));
}

/** A way, briefly: "key 38 on 0: while held from 0,1" */
function brief(way: Way): string {
  const via = way.via;
  const from = way.from.join(",");
  if (via.type === "default") return "default";
  if (via.type === "tri-layer") {
    return `tri-layer ${via.keys.map((k) => `${k.ref.index} on ${k.layer}`).join(" + ")}: ${way.action} from ${from}`;
  }
  const slot = via.slot ? ` TD ${via.slot.tapDance} ${via.slot.slot}` : "";
  if (via.type === "combo") return `combo ${via.combo.index}${slot}: ${way.action} from ${from}`;
  return `${via.ref.kind} ${via.ref.index} on ${via.layer}${slot}: ${way.action} from ${from}`;
}

const blank = (n: number) => Array.from({ length: n }, () => layer({}));

describe("layerTargets", () => {
  const model = corne({
    layers: blank(4),
    tapDances: [["KC_A", "MO(1)", "TG(2)", "LT3(KC_B)"], ["MO(9)", "KC_NO", "KC_NO", "KC_NO"]],
  });

  it("is a layer key's or layer-tap's layer, with what it does", () => {
    expect(layerTargets(model, described("OSL(3)"))).toEqual([{ layer: 3, action: "one-shot", slot: null }]);
    expect(layerTargets(model, described("LT2(KC_SPC)"))).toEqual([{ layer: 2, action: "while held", slot: null }]);
    expect(layerTargets(model, described("KC_A"))).toEqual([]);
  });

  it("is each layer in a tap dance's slots", () => {
    expect(layerTargets(model, described("TD(0)"))).toEqual([
      { layer: 1, action: "while held", slot: { tapDance: 0, slot: "Hold" } },
      { layer: 2, action: "toggle", slot: { tapDance: 0, slot: "Double tap" } },
      { layer: 3, action: "while held", slot: { tapDance: 0, slot: "Tap, then hold" } },
    ]);
  });

  it("leaves out layers the keyboard doesn't have, and tap dances it doesn't have", () => {
    expect(layerTargets(model, described("MO(4)"))).toEqual([]);
    expect(layerTargets(model, described("TD(1)"))).toEqual([]);
    expect(layerTargets(model, described("TD(7)"))).toEqual([]);
  });
});

describe("layerReach", () => {
  it("reaches the simulated Corne's layers by hold, one-shot and switch keys", () => {
    const model = simulatedCorne();
    const layers = layerReach(model, placeKeyboard(model));
    expect(layers.map((l) => l.reachable)).toEqual([true, true, true, true]);
    expect(layers.map((l) => l.ways.map(brief))).toEqual([
      ["default", `key ${AT.rightOuterThumb} on 3: switch to from 3`],
      [`key ${AT.leftMiddleThumb} on 0: while held from 0,2,3`],
      [`key ${AT.grid(0, 4)} on 0: while held from 0,1,3`, `key ${AT.grid(1, 1)} on 0: while held from 0,1`],
      [`key ${AT.rightOuterThumb} on 0: one-shot from 0,1,2`],
    ]);
  });

  it("knows every kind of layer key: MO, TG, TO, TT, OSL, DF and LT", () => {
    const layers = reach({
      layers: [
        layer({ 0: "MO(1)", 1: "TG(2)", 2: "TO(3)", 3: "TT(4)", 4: "OSL(5)", 5: "DF(6)", 6: "LT7(KC_A)" }, "KC_NO"),
        ...blank(7),
      ],
    });
    expect(layers.slice(1).map((l) => l.ways.map((w) => w.action))).toEqual([
      ["while held"], ["toggle"], ["switch to"], ["hold, or tap to toggle"], ["one-shot"], ["default"], ["while held"],
    ]);
    expect(layers.every((l) => l.reachable)).toBe(true);
  });

  it("knows LM, a layer held with modifiers", () => {
    const layers = reach({ layers: [layer({ 0: "LM(1, MOD_LSFT)" }, "KC_NO"), layer({ 0: "KC_A" })] });
    expect(layers[1].ways.map(brief)).toEqual(["key 0 on 0: while held, with modifiers from 0"]);
    expect(layers[1].reachable).toBe(true);
  });

  it("reaches layer 3 by holding both tri-layer keys, FN_MO13 and FN_MO23", () => {
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({}), layer({}), layer({ [AT.leftInnerThumb]: "KC_A", [AT.rightInnerThumb]: "KC_B" }, "KC_NO"),
      ],
    });
    expect(layers[1].ways.map(brief)).toEqual([`key ${AT.leftInnerThumb} on 0: while held from 0,2`]);
    expect(layers[2].ways.map(brief)).toEqual([`key ${AT.rightInnerThumb} on 0: while held from 0,1`]);
    expect(layers[3].ways.map(brief)).toEqual(
      [`tri-layer ${AT.leftInnerThumb} on 0 + ${AT.rightInnerThumb} on 0: while held from 0,1,2`]);
    expect(layers[3].reachable).toBe(true);
  });

  it("needs the second tri-layer key on the layer the first one turns on", () => {
    // layer 1 and 2 cover the other Fn key: neither order works
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "FN_MO13", [AT.rightInnerThumb]: "FN_MO23" }, "KC_NO"),
        layer({ [AT.rightInnerThumb]: "KC_X" }), layer({ [AT.leftInnerThumb]: "KC_Y" }), layer({}),
      ],
    });
    expect(layers[3].ways).toEqual([]);
    expect(layers[3].reachable).toBe(false);
  });

  it("finds no tri-layer way with only one of the two keys", () => {
    const layers = reach({ layers: [layer({ 0: "FN_MO13" }, "KC_NO"), layer({}), layer({}), layer({})] });
    expect(layers[3].ways).toEqual([]);
  });

  it("reaches layers through a tap dance's slots: tap, hold, double tap and tap then hold", () => {
    const layers = reach({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)" }, "KC_NO"), ...Array.from({ length: 4 }, () => layer({}, "KC_NO"))],
      tapDances: [["TG(1)", "MO(2)", "TO(3)", "LT4(KC_A)"]],
    });
    expect(layers.slice(1).map((l) => l.ways.map(brief))).toEqual([
      [`key ${AT.leftOuterThumb} on 0 TD 0 Tap: toggle from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Hold: while held from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Double tap: switch to from 0`],
      [`key ${AT.leftOuterThumb} on 0 TD 0 Tap, then hold: while held from 0`],
    ]);
  });

  it("reaches a layer through a combo of two layer keys whose output is a layer key", () => {
    // the owner's W-CORNE: MO(5) + OSL(3) pressed together give layer 2
    const layers = reach({
      layers: [
        layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)" }, "KC_NO"),
        ...blank(7),
      ],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }],
    });
    // the other layers are transparent, so the combo's keycodes are on every layer: it works everywhere but on layer 2
    expect(layers[2].ways.map(brief)).toEqual(["combo 0: while held from 0,1,3,4,5,6,7"]);
    expect(layers[2].reachable).toBe(true);
    expect(layers.map((l) => l.reachable)).toEqual([true, false, true, true, false, true, false, false]);
  });

  it("reaches layers through a combo whose output is a tap dance", () => {
    const layers = reach({
      layers: [layer({ 0: "KC_J", 1: "KC_K" }, "KC_NO"), ...blank(2)],
      tapDances: [["KC_ESC", "MO(1)", "TG(2)", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TD(0)" }],
    });
    expect(layers[1].ways.map(brief)).toEqual(["combo 0 TD 0 Hold: while held from 0,2"]);
    expect(layers[2].ways.map(brief)).toEqual(["combo 0 TD 0 Double tap: toggle from 0,1"]);
  });

  it("only counts a combo on the layers that have its keycodes, and still lists one that can never fire", () => {
    const layers = reach({
      layers: [layer({ 0: "KC_J" }, "KC_NO"), layer({ 1: "KC_K" }), layer({}), layer({ 0: "KC_NO" })],
      combos: [{ keys: ["KC_J", "KC_K"], output: "TG(2)" }, { keys: ["KC_Q", "KC_W"], output: "TG(3)" }],
    });
    expect(layers[2].ways.map(brief)).toEqual(["combo 0: toggle from 1"]);
    expect(layers[3].ways.map(brief)).toEqual(["combo 1: toggle from "]);
    expect(layers[3].reachable).toBe(false);
  });

  it("leaves out keys and combos that only work on the layer they reach", () => {
    const layers = reach({
      layers: [layer({}, "KC_NO"), layer({ 0: "TG(1)", 1: "KC_A", 2: "KC_B" }, "KC_NO")],
      combos: [{ keys: ["KC_A", "KC_B"], output: "TG(1)" }],
    });
    expect(layers[1].ways).toEqual([]);
    expect(layers[1].reachable).toBe(false);
  });

  it("finds layers that nothing reaches, and those reached only from them", () => {
    const layers = reach({
      layers: [layer({ 0: "MO(1)" }, "KC_NO"), layer({}), layer({ 1: "MO(3)" }, "KC_NO"), layer({}), layer({})],
    });
    expect(layers.map((l) => l.reachable)).toEqual([true, true, false, false, false]);
    expect(layers[3].ways.map(brief)).toEqual(["key 1 on 2: while held from 2"]);
    expect(layers[4].ways).toEqual([]);
  });

  it("reaches a layer from a layer reached by DF (a new default layer)", () => {
    const layers = reach({ layers: [layer({ 0: "DF(1)" }, "KC_NO"), layer({ 1: "MO(2)" }, "KC_NO"), layer({})] });
    expect(layers.map((l) => l.reachable)).toEqual([true, true, true]);
  });

  it("ignores layers the keyboard doesn't have", () => {
    const layers = reach({ layers: [layer({ 0: "MO(9)", 1: "OSL(4)" }, "KC_NO"), layer({})] });
    expect(layers.map((l) => l.ways.length)).toEqual([1, 0]);
  });

  it("only uses the keys that are drawn, and encoders too", () => {
    const model: KeyboardModel = corne({ layers: [layer({}, "KC_NO"), layer({}), layer({})] });
    model.encoders = [{ ...model.keys[0], row: null, col: null, encoder: 0, direction: 1, x: 20 }];
    model.layers[0].encoders = [described("TG(1)")];
    model.layers[1].encoders = [described("KC_TRNS")];
    model.layers[2].encoders = [described("KC_TRNS")];
    // a key of a layout option that isn't chosen
    model.keys.push({ ...model.keys[0], layoutIndex: 0, layoutOption: 1 });
    model.layoutOptions = { value: 0, labels: ["Option"] };
    for (const l of model.layers) l.keys.push(described(l.index === 0 ? "MO(2)" : "KC_TRNS"));
    const layers = layerReach(model, placeKeyboard(model));
    expect(layers[1].ways.map(brief)).toEqual(["encoder 0 on 0: toggle from 0,2"]);
    expect(layers[2].ways).toEqual([]);
  });

  it("works for 8 layers, each reached from the one before", () => {
    const layers = reach({
      layers: Array.from({ length: 8 }, (_, i) => layer(i < 7 ? { [AT.leftInnerThumb]: `TO(${i + 1})` } : {}, "KC_NO")),
    });
    expect(layers.map((l) => l.reachable)).toEqual(Array(8).fill(true));
    expect(layers[7].ways.map(brief)).toEqual([`key ${AT.leftInnerThumb} on 6: switch to from 6`]);
  });

  it("has nothing for a keyboard without layers", () => {
    const model = corne({ layers: [] });
    expect(layerReach(model, placeKeyboard(model))).toEqual([]);
  });
});
