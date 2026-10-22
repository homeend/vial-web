import { describe, expect, it } from "vitest";
import { HOME, parseRoute, routeHash } from "./route";

describe("parseRoute", () => {
  it("reads the section and the entry", () => {
    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2, path: [] });
    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null, path: [] });
    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0, path: [] });
    expect(parseRoute("#key-overrides/2")).toEqual({ section: "key-overrides", item: 2, path: [] });
    expect(parseRoute("#alt-repeat/0")).toEqual({ section: "alt-repeat", item: 0, path: [] });
  });

  it("reads the sections that have no entries, an entry number left out", () => {
    expect(parseRoute("#settings")).toEqual({ section: "settings", item: null, path: [] });
    expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null, path: [] });
    expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null, path: [] });
    expect(parseRoute("#keyboard/3")).toEqual({ section: "keyboard", item: null, path: [] });
    for (const section of ["layout", "lighting", "matrix"] as const) {
      expect(parseRoute(`#${section}`)).toEqual({ section, item: null, path: [] });
      expect(parseRoute(`#${section}/1`)).toEqual({ section, item: null, path: [] });
    }
  });

  it("reads the Learning section's path: the list, Fingers, a lesson, an exercise", () => {
    expect(parseRoute("#learning")).toEqual({ section: "learning", item: null, path: [] });
    expect(parseRoute("#learning/fingers")).toEqual({ section: "learning", item: null, path: ["fingers"] });
    expect(parseRoute("#learning/corne-sim-en/01")).toEqual({ section: "learning", item: null, path: ["corne-sim-en", "01"] });
    expect(parseRoute("#learning/corne-sim-en/01/01-n1"))
      .toEqual({ section: "learning", item: null, path: ["corne-sim-en", "01", "01-n1"] });
    expect(parseRoute("#learning/Set_A/2/x")).toEqual({ section: "learning", item: null, path: ["Set_A", "2", "x"] });
  });

  it("is the Learning list for a path it can't read", () => {
    const list = { section: "learning", item: null, path: [] };
    for (const hash of ["#learning/", "#learning//01", "#learning/a/b/c/d", "#learning/a b", "#learning/a.json",
      "#learning/ą", `#learning/${"x".repeat(65)}`, "#learning/a/"]) {
      expect(parseRoute(hash)).toEqual(list);
    }
    expect(parseRoute(`#learning/${"x".repeat(64)}`)).toEqual({ ...list, path: ["x".repeat(64)] });
  });

  it("is the keymap for anything else", () => {
    for (const hash of ["", "#", "#rgb", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3", "#combos/a/b"]) {
      expect(parseRoute(hash)).toEqual(HOME);
    }
  });
});

describe("routeHash", () => {
  it("is what parseRoute reads back", () => {
    for (const route of [HOME, { section: "combos", item: 3, path: [] }, { section: "macros", item: null, path: [] },
      { section: "key-overrides", item: 1, path: [] }, { section: "keyboard", item: null, path: [] },
      { section: "alt-repeat", item: 2, path: [] }, { section: "settings", item: null, path: [] },
      { section: "lighting", item: null, path: [] }, { section: "matrix", item: null, path: [] },
      { section: "layout", item: null, path: [] }, { section: "learning", item: null, path: [] },
      { section: "learning", item: null, path: ["fingers"] },
      { section: "learning", item: null, path: ["corne-sim-en", "01", "01-n1"] }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });

  it("never names an entry of a section that has none", () => {
    expect(routeHash({ section: "settings", item: 2, path: [] })).toBe("#settings");
    expect(routeHash({ section: "matrix", item: 0, path: [] })).toBe("#matrix");
  });

  it("writes the Learning path, and no entry number", () => {
    expect(routeHash({ section: "learning", item: null, path: ["corne-sim-en", "01"] })).toBe("#learning/corne-sim-en/01");
    expect(routeHash({ section: "learning", item: 3, path: ["fingers"] })).toBe("#learning/fingers");
    // a path belongs to Learning only
    expect(routeHash({ section: "combos", item: 2, path: ["x"] })).toBe("#combos/2");
  });
});
