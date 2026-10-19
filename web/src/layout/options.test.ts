import { describe, expect, it } from "vitest";
import { canChoose, optionRows } from "./options";

describe("optionRows", () => {
  it("makes a switch of a name and a list of a name with choices, with what the keyboard holds", () => {
    const labels = ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL"]];
    expect(optionRows({ value: 0b1_10, labels })).toEqual([
      { index: 0, name: "Split Backspace", kind: "switch", choice: 1, choices: [] },
      { index: 1, name: "Bottom row", kind: "list", choice: 2, choices: ["ANSI", "Tsangan", "WKL"] },
    ]);
  });

  it("names a choice the keyboard holds beyond the list by its number", () => {
    const rows = optionRows({ value: 3, labels: [["Enter", "ANSI", "ISO", "Big"]] });
    expect(rows[0].choices).toEqual(["ANSI", "ISO", "Big", "Choice 3 (not one of the keyboard's)"]);
    expect(optionRows({ value: 1, labels: [["Lonely"]] })[0].choices).toEqual([
      "Choice 0 (not one of the keyboard's)", "Choice 1 (not one of the keyboard's)",
    ]);
  });
});

describe("canChoose", () => {
  const options = { value: 0b1_11, labels: ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL"], ["Lonely"]] };

  it("takes a switch's on and off, and the choices a list names", () => {
    expect([0, 1].map((c) => canChoose(options, 0, c))).toEqual([true, true]);
    expect([0, 1, 2].map((c) => canChoose(options, 1, c))).toEqual([true, true, true]);
  });

  it("refuses a choice the list doesn't name: the keyboard's placeholders, and anything else", () => {
    expect(canChoose(options, 0, 2)).toBe(false);
    expect(canChoose(options, 1, 3)).toBe(false);
    expect(canChoose(options, 1, -1)).toBe(false);
    expect(canChoose(options, 1, 0.5)).toBe(false);
    expect(canChoose(options, 2, 0)).toBe(false);
    expect(canChoose(options, 3, 0)).toBe(false);
  });
});
