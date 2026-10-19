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
  });

  it("is the keymap for anything else", () => {
    for (const hash of ["", "#", "#lighting", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
      expect(parseRoute(hash)).toEqual(HOME);
    }
  });
});

describe("routeHash", () => {
  it("is what parseRoute reads back", () => {
    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null },
      { section: "key-overrides", item: 1 }, { section: "keyboard", item: null }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });
});
