import { describe, expect, it } from "vitest";
import { readView, saveView, VIEW_KEY, type ViewStorage } from "./view";

function storage(initial: Record<string, string> = {}): ViewStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: ViewStorage = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("readView", () => {
  it("is the remembered view, or Edit", () => {
    expect(readView(storage({ [VIEW_KEY]: "overview" }))).toBe("overview");
    expect(readView(storage({ [VIEW_KEY]: "edit" }))).toBe("edit");
    expect(readView(storage({ [VIEW_KEY]: "something else" }))).toBe("edit");
    expect(readView(storage())).toBe("edit");
  });

  it("is Edit when the storage can't be read, or isn't there", () => {
    expect(readView(broken)).toBe("edit");
    expect(readView(null)).toBe("edit");
  });
});

describe("saveView", () => {
  it("remembers the view", () => {
    const s = storage();
    expect(saveView(s, "overview")).toBe(true);
    expect(s.data[VIEW_KEY]).toBe("overview");
  });

  it("says so when the storage refuses, or isn't there", () => {
    expect(saveView(broken, "overview")).toBe(false);
    expect(saveView(null, "edit")).toBe(false);
  });
});
