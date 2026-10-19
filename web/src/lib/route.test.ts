import { describe, expect, it } from "vitest";
import { HOME, parseRoute, routeHash } from "./route";

describe("parseRoute", () => {
  it("reads the section and the entry", () => {
    expect(parseRoute("#combos/2")).toEqual({ section: "combos", item: 2 });
    expect(parseRoute("#tap-dance")).toEqual({ section: "tap-dance", item: null });
    expect(parseRoute("#macros/0")).toEqual({ section: "macros", item: 0 });
  });

  it("is the keymap for anything else", () => {
    for (const hash of ["", "#", "#settings", "#combos/", "#combos/x", "#combos/12345", "combos/2", "#keymap/3"]) {
      expect(parseRoute(hash)).toEqual(HOME);
    }
  });
});

describe("routeHash", () => {
  it("is what parseRoute reads back", () => {
    for (const route of [HOME, { section: "combos", item: 3 }, { section: "macros", item: null }] as const) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });
});
