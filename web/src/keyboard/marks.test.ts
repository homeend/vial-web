import { describe, expect, it } from "vitest";
import { comboMarks, dotSizes } from "./marks";

const sizes = { dot: 6, gap: 4, more: 14 };

describe("comboMarks", () => {
  it("is nothing for a key in no combo, and an underline in the combo's colour for a key in one", () => {
    expect(comboMarks([], 40, sizes)).toEqual({ type: "none" });
    expect(comboMarks([3], 40, sizes)).toEqual({ type: "line", colour: 3 });
  });

  it("is a dot per combo for a key in several", () => {
    expect(comboMarks([0, 2], 40, sizes)).toEqual({ type: "dots", colours: [0, 2], more: 0 });
    // 40 px hold four dots of 6 px with 4 px between them, exactly
    expect(comboMarks([0, 1, 2, 3], 36, sizes)).toEqual({ type: "dots", colours: [0, 1, 2, 3], more: 0 });
  });

  it("shows as many dots as fit next to \"+n\" for the others", () => {
    // 36 px: four dots fit, but not five; with "+n" (14 px) two dots fit
    expect(comboMarks([0, 1, 2, 3, 4], 36, sizes)).toEqual({ type: "dots", colours: [0, 1], more: 3 });
    expect(comboMarks([0, 1, 2], 12, sizes)).toEqual({ type: "dots", colours: [], more: 3 });
  });
});

describe("dotSizes", () => {
  it("grows with the key, never below 4 px a dot", () => {
    expect(dotSizes(20).dot).toBe(4);
    expect(dotSizes(72).dot).toBeCloseTo(7.92);
    expect(dotSizes(72).gap).toBeCloseTo(4.752);
  });
});
