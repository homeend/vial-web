import { describe, expect, it } from "vitest";
import { safeFileName } from "./fileName";

describe("safeFileName", () => {
  it("keeps a plain name", () => {
    expect(safeFileName("Simulated Corne")).toBe("Simulated Corne");
  });

  it("replaces each run of characters file systems refuse with one underscore", () => {
    expect(safeFileName('Knob/Pad: "mini"')).toBe("Knob_Pad_ _mini");
    expect(safeFileName("a\\b|c?d*e<f>g")).toBe("a_b_c_d_e_f_g");
    expect(safeFileName("tab\there\u0001x")).toBe("tab_here_x");
    expect(safeFileName("a//b")).toBe("a_b");
  });

  it("drops dots, spaces and underscores at the ends", () => {
    expect(safeFileName("  ..name._ ")).toBe("name");
  });

  it("cuts at 100 characters", () => {
    expect(safeFileName("x".repeat(150))).toBe("x".repeat(100));
    expect(safeFileName("y".repeat(100))).toBe("y".repeat(100));
  });

  it("falls back to keyboard when nothing is left", () => {
    expect(safeFileName("")).toBe("keyboard");
    expect(safeFileName("...")).toBe("keyboard");
    expect(safeFileName("???")).toBe("keyboard");
  });
});
