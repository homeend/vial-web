import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { codesOn, comboColours, comboLayers, comboMarksOn, combosOf, combosUsing } from "./combos";
import { effectiveAt } from "./effective";
import { AT, corne, layer, simulatedCorne } from "./testing";

const key = (index: number) => ({ kind: "key" as const, index });

describe("effectiveAt", () => {
  const model = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({ 1: "KC_B" }), layer({}, "KC_TRNS")] });

  it("is the key's own action, or the base layer's for a transparent key", () => {
    expect(effectiveAt(model, 1, key(1))).toMatchObject({ layer: 1, action: { code: "KC_B" } });
    expect(effectiveAt(model, 1, key(0))).toMatchObject({ layer: 0, action: { code: "KC_A" } });
    expect(effectiveAt(model, 2, key(0))).toMatchObject({ layer: 0, action: { code: "KC_A" } });
  });

  it("leaves a transparent key on the base layer transparent, and knows nothing of other layers or keys", () => {
    const transparent = corne({ layers: [layer({})] });
    expect(effectiveAt(transparent, 0, key(0))).toMatchObject({ layer: 0, action: { kind: "transparent" } });
    expect(effectiveAt(model, 5, key(0))).toBeUndefined();
    expect(effectiveAt(model, 0, key(99))).toBeUndefined();
  });
});

describe("combosOf", () => {
  it("finds each keycode of a combo on the base layer: one key, several keys, or none", () => {
    const model = corne({
      layers: [layer({ [AT.grid(2, 9)]: "KC_K", [AT.grid(2, 10)]: "KC_Y", [AT.grid(0, 10)]: "KC_Y" }, "KC_NO")],
      combos: [{ keys: ["KC_K", "KC_Y", "KC_Q"], output: "KC_ESC" }],
    });
    const [combo] = combosOf(model, placeKeyboard(model));
    expect(combo.members.map((m) => [m.action.code, m.keys.map((k) => k.index)])).toEqual([
      ["KC_K", [AT.grid(2, 9)]],
      ["KC_Y", [AT.grid(0, 10), AT.grid(2, 10)]],
      ["KC_Q", []],
    ]);
    expect(combo.output.code).toBe("KC_ESC");
  });

  it("leaves out empty combos and empty slots", () => {
    const model = corne({
      layers: [layer({}, "KC_NO")],
      combos: [{ keys: [], output: "KC_NO" }, { keys: ["KC_NO", "KC_A"], output: "KC_B" }],
    });
    const combos = combosOf(model, placeKeyboard(model));
    expect(combos.map((c) => c.index)).toEqual([1]);
    expect(combos[0].members.map((m) => m.action.code)).toEqual(["KC_A"]);
  });

  it("finds nothing on a keyboard without layers", () => {
    const model = corne({ layers: [], combos: [{ keys: ["KC_A"], output: "KC_B" }] });
    expect(combosOf(model, placeKeyboard(model))[0].members[0].keys).toEqual([]);
  });
});

describe("combo keys on a layer", () => {
  const model = simulatedCorne();
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const codes = model.layers.map((_, l) => codesOn(model, placement, l));

  it("are the keys with a combo's keycode, each with its combos", () => {
    const marks = comboMarksOn(combos, codes[0], model, 0);
    expect(marks).toEqual(new Map([
      [`key:${AT.grid(2, 9)}`, [0]], [`key:${AT.grid(2, 10)}`, [0]], [`key:${AT.grid(2, 2)}`, [1]],
      [`key:${AT.grid(2, 3)}`, [1]],
    ]));
  });

  it("list every combo a key is part of, in combo order", () => {
    const shared = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_B", 2: "KC_C" }, "KC_NO")],
      combos: [{ keys: ["KC_B", "KC_C"], output: "KC_X" }, { keys: ["KC_A", "KC_B"], output: "KC_Y" }],
    });
    const p = placeKeyboard(shared);
    const marks = comboMarksOn(combosOf(shared, p), codesOn(shared, p, 0), shared, 0);
    expect(marks.get("key:1")).toEqual([0, 1]);
    expect(marks.get("key:0")).toEqual([1]);
  });

  it("leave out the keys of a combo that never fires, as it lists a keycode twice", () => {
    const twice = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO")], combos: [{ keys: ["KC_A", "KC_A"], output: "KC_B" }] });
    const p = placeKeyboard(twice);
    expect(comboMarksOn(combosOf(twice, p), codesOn(twice, p, 0), twice, 0).size).toBe(0);
  });

  it("leave out transparent keys, though the combo goes through them", () => {
    // layer 1 is transparent there: the keycodes fall through, but the keys aren't marked
    expect(codes[1].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
    expect(comboMarksOn(combos, codes[1], model, 1).size).toBe(0);
    const own = corne({
      layers: [layer({ 0: "KC_A" }, "KC_NO"), layer({ 0: "KC_A" })],
      combos: [{ keys: ["KC_A", "KC_B"], output: "KC_X" }],
    });
    const p = placeKeyboard(own);
    expect([...comboMarksOn(combosOf(own, p), codesOn(own, p, 1), own, 1).keys()]).toEqual(["key:0"]);
  });

  it("can fire on the layers that have all its keycodes", () => {
    const model2 = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_B" }, "KC_NO"), layer({ 1: "KC_C" }), layer({}, "KC_TRNS")],
      combos: [{ keys: ["KC_A", "KC_B"], output: "KC_X" }],
    });
    const p = placeKeyboard(model2);
    const layerCodes = model2.layers.map((_, l) => codesOn(model2, p, l));
    expect(comboLayers(combosOf(model2, p)[0], layerCodes)).toEqual([0, 2]);
  });

  it("never fire when they list a keycode twice: QMK counts only one of the two as pressed", () => {
    const twice = corne({
      layers: [layer({ 0: "KC_A", 1: "KC_A", 2: "KC_B" }, "KC_NO")],
      combos: [{ keys: ["KC_A", "KC_A"], output: "KC_X" }, { keys: ["KC_A", "KC_B", "KC_A"], output: "KC_Y" }],
    });
    const p = placeKeyboard(twice);
    const layerCodes = [codesOn(twice, p, 0)];
    expect(combosOf(twice, p).map((c) => comboLayers(c, layerCodes))).toEqual([[], []]);
  });
});

describe("comboColours", () => {
  /** combos of two keycodes each, KC_A + KC_B and so on, all on the base layer; `on` gives a combo's keys layer 1 */
  function colours(count: number, size: number, on: number[] = []) {
    const letters = "ABCDEFGHIJKLMNOPQRST";
    const codes = (i: number) => [`KC_${letters[2 * i]}`, `KC_${letters[2 * i + 1]}`];
    const base: Record<number, string> = {};
    const upper: Record<number, string> = {};
    for (let i = 0; i < count; i++) {
      codes(i).forEach((code, k) => {
        base[2 * i + k] = on.includes(i) ? "KC_NO" : code;
        upper[2 * i + k] = on.includes(i) ? code : "KC_NO";
      });
    }
    const model = corne({
      layers: [layer(base, "KC_NO"), layer(upper, "KC_NO")],
      combos: Array.from({ length: count }, (_, i) => ({ keys: codes(i), output: "KC_X" })),
    });
    const p = placeKeyboard(model);
    const combos = combosOf(model, p);
    const marks = model.layers.map((_, l) => comboMarksOn(combos, codesOn(model, p, l), model, l));
    return [...comboColours(combos, marks, size).values()];
  }

  it("gives combos on the same layer different colours, in palette order", () => {
    expect(colours(3, 6)).toEqual([0, 1, 2]);
  });

  it("lets combos on different layers share a colour", () => {
    // combos 1 and 2 have their keys on layer 1 only: they start the palette again
    expect(colours(4, 6, [1, 2])).toEqual([0, 0, 1, 1]);
  });

  it("repeats colours in palette order once they are all taken", () => {
    expect(colours(5, 3)).toEqual([0, 1, 2, 0, 1]);
  });

  it("gives a combo with no keys anywhere the first colour", () => {
    const model = corne({ layers: [layer({}, "KC_NO")], combos: [{ keys: ["KC_Q"], output: "KC_X" }] });
    const p = placeKeyboard(model);
    const combos = combosOf(model, p);
    expect([...comboColours(combos, [comboMarksOn(combos, codesOn(model, p, 0), model, 0)])]).toEqual([[0, 0]]);
  });
});

describe("combosUsing", () => {
  const model = corne({
    layers: [
      layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", [AT.grid(2, 9)]: "KC_K" }, "KC_NO"),
      layer({ [AT.grid(2, 9)]: "KC_NO" }),
      ...Array.from({ length: 6 }, () => layer({})),
    ],
    combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }, { keys: ["KC_K", "KC_Y"], output: "KC_ESC" }],
  });
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const using = (l: number, index: number) =>
    combosUsing(combos, model, codesOn(model, placement, l), l, key(index));

  it("lists the combos a key is part of, with the other keycodes and their keys", () => {
    const [use] = using(0, AT.leftInnerThumb);
    expect(use.combo.index).toBe(0);
    expect(use.partners.map((p) => [p.action.code, p.keys])).toEqual([["OSL(3)", [key(AT.rightOuterThumb)]]]);
    expect(using(0, AT.rightOuterThumb)[0].partners.map((p) => p.action.code)).toEqual(["MO(5)"]);
  });

  it("says when a partner isn't on any key of the layer", () => {
    const [use] = using(0, AT.grid(2, 9));
    expect(use.partners).toEqual([{ action: expect.objectContaining({ code: "KC_Y" }), keys: [] }]);
  });

  it("goes by the keycode the key has on the layer", () => {
    expect(using(1, AT.grid(2, 9))).toEqual([]);
    expect(using(1, AT.leftInnerThumb).map((u) => u.combo.index)).toEqual([0]);
    expect(using(0, AT.grid(0, 0))).toEqual([]);
  });

  it("lists a keycode that is in a combo twice once as the key and once as a partner (the combo never fires)", () => {
    const twice = corne({ layers: [layer({ 0: "KC_A" }, "KC_NO")], combos: [{ keys: ["KC_A", "KC_A"], output: "KC_B" }] });
    const p = placeKeyboard(twice);
    const [use] = combosUsing(combosOf(twice, p), twice, codesOn(twice, p, 0), 0, key(0));
    expect(use.partners.map((m) => m.action.code)).toEqual(["KC_A"]);
  });

  it("is empty for an encoder", () => {
    expect(combosUsing(combos, model, codesOn(model, placement, 0), 0, { kind: "encoder", index: 0 })).toEqual([]);
  });
});
