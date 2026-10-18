import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { AT, corne, described, layer, simulatedCorne, type Setup } from "./testing";
import { unusedOf, usageOf } from "./usage";

function usage(setup: Setup) {
  const model = corne(setup);
  return usageOf(model, placeKeyboard(model));
}

describe("usageOf", () => {
  it("lists the keys that use each tap dance and macro, by layer and key", () => {
    const used = usage({
      layers: [layer({ 0: "TD(0)", 1: "M1" }, "KC_NO"), layer({ 0: "TD(0)", 5: "TD(1)" })],
      tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"], ["KC_B", "KC_NO", "KC_NO", "KC_NO"]],
      macros: [1, 1],
    });
    expect(used.tapDances).toEqual([
      [{ type: "key", layer: 0, ref: { kind: "key", index: 0 } }, { type: "key", layer: 1, ref: { kind: "key", index: 0 } }],
      [{ type: "key", layer: 1, ref: { kind: "key", index: 5 } }],
    ]);
    expect(used.macros).toEqual([[], [{ type: "key", layer: 0, ref: { kind: "key", index: 1 } }]]);
  });

  it("counts combos, other tap dances, key overrides and alt repeat keys", () => {
    const used = usage({
      layers: [layer({}, "KC_NO")],
      tapDances: [["M0", "KC_NO", "TD(1)", "TD(0)"], ["KC_A", "KC_NO", "KC_NO", "KC_NO"]],
      combos: [{ keys: ["TD(1)", "KC_A"], output: "M0" }],
      macros: [1],
      keyOverrides: [{ trigger: "KC_A", replacement: "M0" }],
      altRepeatKeys: [{ keycode: "TD(1)", altKeycode: "M0" }],
    });
    expect(used.tapDances[0]).toEqual([]); // its own slot doesn't count
    expect(used.tapDances[1]).toEqual([
      { type: "combo", combo: 0, part: "key" },
      { type: "tap-dance", tapDance: 0, slot: "Double tap" },
      { type: "alt-repeat", altRepeat: 0, part: "keycode" },
    ]);
    expect(used.macros[0]).toEqual([
      { type: "combo", combo: 0, part: "output" },
      { type: "tap-dance", tapDance: 0, slot: "Tap" },
      { type: "key-override", keyOverride: 0, part: "replacement" },
      { type: "alt-repeat", altRepeat: 0, part: "alt keycode" },
    ]);
  });

  it("counts a macro's steps: a macro can tap, press or release a tap dance or another macro, but not itself", () => {
    const model = corne({
      layers: [layer({}, "KC_NO")], tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"]], macros: [1, 1],
    });
    model.macros.items[0].actions = [
      { type: "text", text: "hi", keys: [] },
      { type: "tap", keys: [described("KC_B"), described("M1")] },
      { type: "down", keys: [described("TD(0)")] },
      { type: "up", keys: [described("TD(0)")] },
      { type: "tap", keys: [described("M0")] },
    ];
    model.macros.items[1].actions = [{ type: "tap", keys: [described("M1")] }];
    const used = usageOf(model, placeKeyboard(model));
    expect(used.macros).toEqual([[], [{ type: "macro", macro: 0, step: 1 }]]);
    expect(used.tapDances).toEqual([[{ type: "macro", macro: 0, step: 2 }, { type: "macro", macro: 0, step: 3 }]]);
  });

  it("ignores a combo with no keys: it never fires", () => {
    const used = usage({ layers: [layer({}, "KC_NO")], combos: [{ keys: [], output: "M0" }], macros: [1] });
    expect(used.macros).toEqual([[]]);
  });

  it("only counts the keys that are drawn, encoders included, and ignores numbers the keyboard doesn't have", () => {
    const model = corne({ layers: [layer({ 0: "TD(5)", 1: "M7" }, "KC_NO")], tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"]] });
    model.encoders = [{ ...model.keys[0], row: null, col: null, encoder: 0, direction: 0, x: 20 }];
    model.layers[0].encoders = [described("TD(0)")];
    model.keys.push({ ...model.keys[0], layoutIndex: 0, layoutOption: 1 });
    model.layoutOptions = { value: 0, labels: ["Option"] };
    model.layers[0].keys.push(described("TD(0)"));
    const used = usageOf(model, placeKeyboard(model));
    expect(used.tapDances).toEqual([[{ type: "key", layer: 0, ref: { kind: "encoder", index: 0 } }]]);
    expect(used.macros).toEqual([]);
  });
});

describe("unusedOf", () => {
  it("lists the tap dances and macros that are set up but that nothing uses", () => {
    const model = simulatedCorne();
    expect(unusedOf(model, usageOf(model, placeKeyboard(model)))).toEqual({ tapDances: [1], macros: [1] });
  });

  it("leaves out empty ones, and counts any use", () => {
    const model = corne({
      layers: [layer({ [AT.leftOuterThumb]: "TD(0)" }, "KC_NO")],
      tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"], ["KC_NO", "KC_NO", "KC_NO", "KC_NO"], ["KC_NO", "KC_NO", "M0", "KC_NO"]],
      combos: [{ keys: ["KC_A", "KC_B"], output: "TD(2)" }],
      macros: [3, 0],
    });
    expect(unusedOf(model, usageOf(model, placeKeyboard(model)))).toEqual({ tapDances: [], macros: [] });
  });

  it("counts a tap dance or macro that only a macro uses, but not a macro that only uses itself", () => {
    const model = corne({ layers: [layer({ 0: "M0" }, "KC_NO")], tapDances: [["KC_A", "KC_NO", "KC_NO", "KC_NO"]],
      macros: [1, 1, 1] });
    model.macros.items[0].actions = [{ type: "tap", keys: [described("M1"), described("TD(0)")] }];
    model.macros.items[2].actions = [{ type: "tap", keys: [described("M2")] }];
    expect(unusedOf(model, usageOf(model, placeKeyboard(model)))).toEqual({ tapDances: [], macros: [2] });
  });
});
