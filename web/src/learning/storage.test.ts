import { describe, expect, it } from "vitest";
import { chosenSetKey, readChosenSet, saveChosenSet, type LearningStorage } from "./storage";

function storage(initial: Record<string, string> = {}): LearningStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: LearningStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("readChosenSet", () => {
  it("is the set remembered for the keyboard, or none", () => {
    expect(chosenSetKey("5EEDC0DE00420042")).toBe("vial.learningSet.5EEDC0DE00420042");
    const s = storage({ "vial.learningSet.5EEDC0DE00420042": "corne-sim-en" });
    expect(readChosenSet(s, "5EEDC0DE00420042")).toBe("corne-sim-en");
    expect(readChosenSet(s, "0")).toBeNull();
    expect(readChosenSet(storage({ "vial.learningSet.0": "" }), "0")).toBeNull();
  });

  it("is none when the storage can't be read, or isn't there", () => {
    expect(readChosenSet(broken, "0")).toBeNull();
    expect(readChosenSet(null, "0")).toBeNull();
  });
});

describe("saveChosenSet", () => {
  it("remembers the set per keyboard", () => {
    const s = storage();
    expect(saveChosenSet(s, "A", "corne-sim-en")).toBe(true);
    expect(saveChosenSet(s, "B", "other")).toBe(true);
    expect(s.data).toEqual({ "vial.learningSet.A": "corne-sim-en", "vial.learningSet.B": "other" });
    expect(readChosenSet(s, "A")).toBe("corne-sim-en");
  });

  it("says so when the storage refuses, or isn't there", () => {
    expect(saveChosenSet(broken, "A", "x")).toBe(false);
    expect(saveChosenSet(null, "A", "x")).toBe(false);
  });
});
