import { describe, expect, it } from "vitest";
import { HOME, parseRoute, routeHash } from "./route";

describe("parseRoute", () => {
  it("reads the section and the entry", () => {
    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2 });
    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null });
    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0 });
    expect(parseRoute("#key-overrides/2")).toEqual({ section: "key-overrides", item: 2 });
    expect(parseRoute("#alt-repeat/0")).toEqual({ section: "alt-repeat", item: 0 });
  });

  it("reads the sections that have no entries, an entry number left out", () => {
    expect(parseRoute("#settings")).toEqual({ section: "settings", item: null });
    expect(parseRoute("#keyboard")).toEqual({ section: "keyboard", item: null });
    expect(parseRoute("#settings/3")).toEqual({ section: "settings", item: null });
    expect(parseRoute("#keyboard/3")).toEqual({ section: "keyboard", item: null });
    for (const section of ["layout", "lighting", "matrix"] as const) {
      expect(parseRoute(`#${section}`)).toEqual({ section, item: null });
      expect(parseRoute(`#${section}/1`)).toEqual({ section, item: null });
    }
  });

  it("is the keymap for anything else", () => {
    for (const hash of ["", "#", "#rgb", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
      expect(parseRoute(hash)).toEqual(HOME);
    }
  });
});

describe("routeHash", () => {
  it("is what parseRoute reads back", () => {
    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null },
      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }, { section: "alt-repeat", item: 2 },
      { section: "settings", item: null }, { section: "lighting", item: null }, { section: "matrix", item: null },
      { section: "layout", item: null }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });

  it("never names an entry of a section that has none", () => {
    expect(routeHash({ section: "settings", item: 2 })).toBe("#settings");
    expect(routeHash({ section: "matrix", item: 0 })).toBe("#matrix");
  });
});
