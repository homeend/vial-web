import { describe, expect, it } from "vitest";
import { usageOf } from "../analysis/usage";
import { corne, layer, simulatedCorne } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { behaviourCounts, freeCombo, freeMacro, macroIsSet, shownEntries, tapDanceIsSet } from "./entries";

describe("shownEntries", () => {
  it("are those set up or used, and those opened, in order", () => {
    expect(shownEntries(6, (i) => i === 1 || i === 4, [5, 1])).toEqual([1, 4, 5]);
    expect(shownEntries(3, () => false, [])).toEqual([]);
  });

  it("drop opened numbers the keyboard doesn't have, and show one opened twice once", () => {
    expect(shownEntries(3, () => false, [3, -1, 7, 2, 2])).toEqual([2]);
  });
});

describe("free entries", () => {
  const model = simulatedCorne();

  it("are the first combo with nothing in it", () => {
    expect(freeCombo(model)).toBe(2);
    expect(freeCombo({ combos: model.combos.slice(0, 2) })).toBeNull();
  });

  it("are the first macro with no steps that nothing uses", () => {
    const usage = usageOf(model, placeKeyboard(model));
    expect(freeMacro(model, usage)).toBe(2);
    // M2 on a key: in use, though empty
    const used = corne({ layers: [layer({ 0: "M2" }, "KC_NO")], macros: [2, 6, 0, 0] });
    expect(freeMacro(used, usageOf(used, placeKeyboard(used)))).toBe(3);
    const full = corne({ layers: [layer({}, "KC_NO")], macros: [2, 6, 1] }); // every macro has steps
    expect(freeMacro(full, usageOf(full, placeKeyboard(full)))).toBeNull();
  });
});

describe("behaviourCounts", () => {
  it("count what is set up, and are null for what the firmware doesn't have", () => {
    const model = simulatedCorne();
    expect(model.tapDance.filter(tapDanceIsSet)).toHaveLength(2);
    expect(model.macros.items.filter(macroIsSet)).toHaveLength(2);
    expect(behaviourCounts(model)).toEqual({ tapDance: 2, combos: 2, macros: 2 });
    expect(behaviourCounts(corne({ layers: [] }))).toEqual({ tapDance: null, combos: null, macros: null });
  });

  it("go by the entries the keyboard lists, as tap dances and combos do", () => {
    const model = simulatedCorne();
    expect(behaviourCounts({ ...model, macros: { ...model.macros, items: [] } }).macros).toBeNull();
  });
});
