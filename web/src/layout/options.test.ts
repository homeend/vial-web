import { describe, expect, it } from "vitest";
import { optionRows } from "./options";

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
