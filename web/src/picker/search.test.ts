import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
import { searchKeycodes } from "./search";

function k(code: string, tap: string, aliases: string[] = [], description: string | null = null,
  shifted: string | null = null): CatalogueKeycode {
  return {
    code, kind: "basic", tap, legend: { main: tap, shifted, altGr: null }, hold: null, layer: null, layerAction: null,
    index: null, description, aliases,
  };
}

const categories: KeycodeCategory[] = [
  {
    name: "Basic", templates: [], keycodes: [
      k("KC_ESCAPE", "Esc", ["KC_ESC"]), k("KC_A", "A"), k("KC_CAPSLOCK", "Caps Lock", ["KC_CAPS"]),
      k("KC_GRAVE", "`", ["KC_GRV"], null, "~"), k("KC_ENTER", "Enter", ["KC_ENT"]),
    ],
  },
  {
    name: "Modifiers", templates: [], keycodes: [
      k("KC_GESC", "Esc", [], "Esc normally, but ~ when Shift or GUI is pressed", "~"),
      k("KC_ESCAPE", "Esc", ["KC_ESC"]),
    ],
  },
];

const codes = (query: string) => searchKeycodes(categories, query).map((r) => r.code);

describe("searchKeycodes", () => {
  it("puts exact label matches first and lists each keycode once", () => {
    expect(codes("esc")).toEqual(["KC_ESCAPE", "KC_GESC"]);
  });

  it("finds keycodes by name and alias", () => {
    expect(codes("kc_caps")).toEqual(["KC_CAPSLOCK"]);
    expect(codes("GRV")).toEqual(["KC_GRAVE"]);
  });

  it("finds labels of several words, and shifted characters", () => {
    expect(codes("caps lock")).toEqual(["KC_CAPSLOCK"]);
    expect(codes("~")).toEqual(["KC_GRAVE", "KC_GESC"]);
  });

  it("searches descriptions too, after better matches", () => {
    expect(codes("shift")).toEqual(["KC_GESC"]);
  });

  it("is empty for an empty query", () => {
    expect(codes("  ")).toEqual([]);
  });
});
