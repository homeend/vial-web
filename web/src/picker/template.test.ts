import { describe, expect, it } from "vitest";
import { fillTemplate, isUnfinished } from "./template";

describe("fillTemplate", () => {
  it("leaves KC_ for the user to finish", () => {
    expect(fillTemplate("LSFT(kc)")).toBe("LSFT(KC_)");
    expect(fillTemplate("LT1(kc)")).toBe("LT1(KC_)");
  });
});

describe("isUnfinished", () => {
  it("is true for a template not filled in yet", () => {
    for (const text of ["LSFT(KC_)", "LT1(KC_ )", "LT(1, KC_)", "lsft(kc_)", "LSFT(kc)", "LSFT()", "LT(", "LT(1,"]) {
      expect(isUnfinished(text), text).toBe(true);
    }
  });

  it("is false for anything else, even if wrong", () => {
    for (const text of ["LSFT(KC_A)", "KC_", "LT(1, KC_SPC)", "LT(1,KC_SPC", "KC_ESC", "nonsense"]) {
      expect(isUnfinished(text), text).toBe(false);
    }
  });
});
