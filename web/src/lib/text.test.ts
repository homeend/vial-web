import { describe, expect, it } from "vitest";
import { asSentence, capitalised } from "./text";

describe("capitalised", () => {
  it("puts the first letter in upper case and leaves the rest", () => {
    expect(capitalised("the key at row 1, column 2")).toBe("The key at row 1, column 2");
    expect(capitalised("Tab")).toBe("Tab");
    expect(capitalised("")).toBe("");
  });
});

describe("asSentence", () => {
  it("capitalises a reason and ends it with a full stop", () => {
    expect(asSentence("unsupported keyboard")).toBe("Unsupported keyboard.");
    expect(asSentence("a newer Vial may read it.")).toBe("A newer Vial may read it.");
    expect(asSentence("  ")).toBe("");
  });
});
