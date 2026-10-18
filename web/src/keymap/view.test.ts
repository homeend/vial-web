import { describe, expect, it } from "vitest";
import {
  readReachOpen, readView, REACH_OPEN_KEY, saveReachOpen, saveView, VIEW_KEY, type ViewStorage,
} from "./view";

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

describe("readReachOpen", () => {
  it("is open only when remembered open", () => {
    expect(readReachOpen(storage({ [REACH_OPEN_KEY]: "open" }))).toBe(true);
    expect(readReachOpen(storage({ [REACH_OPEN_KEY]: "closed" }))).toBe(false);
    expect(readReachOpen(storage())).toBe(false);
  });

  it("is folded away when the storage can't be read, or isn't there", () => {
    expect(readReachOpen(broken)).toBe(false);
    expect(readReachOpen(null)).toBe(false);
  });
});

describe("saveReachOpen", () => {
  it("remembers it open or folded", () => {
    const s = storage();
    expect(saveReachOpen(s, true)).toBe(true);
    expect(readReachOpen(s)).toBe(true);
    expect(saveReachOpen(s, false)).toBe(true);
    expect(readReachOpen(s)).toBe(false);
  });

  it("says so when the storage refuses, or isn't there", () => {
    expect(saveReachOpen(broken, true)).toBe(false);
    expect(saveReachOpen(null, true)).toBe(false);
  });
});
