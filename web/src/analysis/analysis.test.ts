import { describe, expect, it } from "vitest";
import { placeKeyboard } from "../keyboard/geometry";
import { analyse } from "./analysis";
import { AT, corne, layer, simulatedCorne } from "./testing";

describe("analyse", () => {
  it("puts the analysis of the simulated Corne together", () => {
    const model = simulatedCorne();
    const analysis = analyse(model, placeKeyboard(model));
    expect(analysis.reach.map((r) => r.reachable)).toEqual([true, true, true, true]);
    expect(analysis.combos.map((c) => c.index)).toEqual([0, 1]);
    expect(analysis.codes).toHaveLength(4);
    expect(analysis.codes[0].get("KC_K")).toEqual([{ kind: "key", index: AT.grid(2, 9) }]);
    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([4, 0, 0, 0]);
    expect(analysis.positions.get(`key:${AT.rightOuterThumb}`)).toBe("right outer thumb");
    expect(analysis.usage.tapDances[0]).toEqual([{ type: "key", layer: 0, ref: { kind: "key", index: AT.leftInnerThumb } }]);
    expect(analysis.unused).toEqual({ tapDances: [1], macros: [1] });
  });

  it("covers 8 layers, as the owner's W-CORNE has, with layers that nothing reaches", () => {
    // like the W-CORNE: layer 2 is reached by the MO(5) + OSL(3) combo; 4, 6 and 7 by nothing
    const model = corne({
      layers: [
        layer({ [AT.leftInnerThumb]: "MO(5)", [AT.rightOuterThumb]: "OSL(3)", [AT.leftMiddleThumb]: "LT1(KC_SPC)" }, "KC_A"),
        ...Array.from({ length: 7 }, () => layer({})),
      ],
      combos: [{ keys: ["MO(5)", "OSL(3)"], output: "MO(2)" }],
    });
    const analysis = analyse(model, placeKeyboard(model));
    expect(analysis.reach).toHaveLength(8);
    expect(analysis.reach.map((r) => r.reachable)).toEqual([true, true, true, true, false, true, false, false]);
    expect(analysis.reach[2].ways.map((w) => w.via.type)).toEqual(["combo"]);
    expect(analysis.comboKeys.map((keys) => keys.size)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
  });
});
