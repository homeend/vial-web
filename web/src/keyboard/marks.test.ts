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
    // 36 px hold four dots of 6 px with 4 px between them, exactly
    expect(comboMarks([0, 1, 2, 3], 36, sizes)).toEqual({ type: "dots", colours: [0, 1, 2, 3], more: 0 });
  });

  it("shows as many dots as fit next to \"+n\" for the others", () => {
    // 36 px: four dots fit, but not five; with "+n" (14 px) two dots fit
    expect(comboMarks([0, 1, 2, 3, 4], 36, sizes)).toEqual({ type: "dots", colours: [0, 1], more: 3 });
    expect(comboMarks([0, 1, 2], 12, sizes)).toEqual({ type: "dots", colours: [], more: 3 });
    // 35 px: a pixel short of four dots; 30 px: exactly two dots and "+n"; 24 px: one dot and "+n"
    expect(comboMarks([0, 1, 2, 3], 35, sizes)).toEqual({ type: "dots", colours: [0, 1], more: 2 });
    expect(comboMarks([0, 1, 2, 3], 30, sizes)).toEqual({ type: "dots", colours: [0, 1], more: 2 });
    expect(comboMarks([0, 1, 2, 3], 24, sizes)).toEqual({ type: "dots", colours: [0], more: 3 });
    expect(comboMarks([0, 1, 2], -5, sizes)).toEqual({ type: "dots", colours: [], more: 3 });
  });

  it("fits dots that fill the width exactly, whatever the rounding", () => {
    const small = dotSizes(20); // 4 px dots, 2.4 px apart
    expect(comboMarks([0, 1, 2, 3], 4 * 4 + 3 * 2.4, small)).toEqual({ type: "dots", colours: [0, 1, 2, 3], more: 0 });
    const large = dotSizes(72);
    expect(comboMarks([0, 1], 2 * large.dot + large.gap, large)).toEqual({ type: "dots", colours: [0, 1], more: 0 });
  });

  it("leaves more room for a two-digit \"+n\"", () => {
    const many = Array.from({ length: 12 }, (_, i) => i);
    // one digit would leave room for two dots (36 - 14 = 22); two digits take 21 px, leaving one
    expect(comboMarks(many, 36, sizes)).toEqual({ type: "dots", colours: [0], more: 11 });
  });
});

describe("dotSizes", () => {
  it("grows with the key, never below 4 px a dot", () => {
    expect(dotSizes(20).dot).toBe(4);
    expect(dotSizes(72).dot).toBeCloseTo(7.92);
    expect(dotSizes(72).gap).toBeCloseTo(4.752);
    expect(dotSizes(20).more).toBe(12);
    expect(dotSizes(72).more).toBeCloseTo(23.04);
  });
});
