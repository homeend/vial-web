import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
import { searchKeycodes } from "./search";

function k(code: string, tap: string, aliases: string[] = [], description: string | null = null,
  shifted: string | null = null, kind: CatalogueKeycode["kind"] = "basic"): CatalogueKeycode {
  return {
    code, kind, tap, legend: { main: tap, shifted, altGr: null }, hold: null, layer: null, layerAction: null,
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

const codes = (query: string, cats: KeycodeCategory[] = categories) => searchKeycodes(cats, query).map((r) => r.code);

/** one category, in this order: a better match coming later in the catalogue must still win */
const catalogue = (...keycodes: CatalogueKeycode[]): KeycodeCategory[] => [{ name: "Test", templates: [], keycodes }];

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

  it("ranks an exact label above an earlier description match", () => {
    const cats = catalogue(k("KC_X", "X", [], "Sends a for a"), k("KC_A", "A"));
    expect(codes("a", cats)).toEqual(["KC_A", "KC_X"]);
  });

  it("ranks a name match above an earlier label prefix", () => {
    const cats = catalogue(k("KC_LONG", "Capsule"), k("KC_CAPS", "Lock"));
    expect(codes("caps", cats)).toEqual(["KC_CAPS", "KC_LONG"]);
  });

  it("ranks a label prefix above an earlier name prefix", () => {
    const cats = catalogue(k("KC_VOLUME", "Loud"), k("KC_Q", "Volume Up"));
    expect(codes("vol", cats)).toEqual(["KC_Q", "KC_VOLUME"]);
  });

  it("ranks a label word start below a label prefix and above a substring", () => {
    const cats = catalogue(k("KC_1", "Subplay"), k("KC_2", "Media Player"), k("KC_3", "Play Pause"));
    expect(codes("play", cats)).toEqual(["KC_3", "KC_2", "KC_1"]);
  });

  it("ranks a whole label word above a longer word", () => {
    const cats = catalogue(k("KC_MSEL", "Media Player"), k("KC_MPLY", "Media Play"));
    expect(codes("play", cats)).toEqual(["KC_MPLY", "KC_MSEL"]);
  });

  it("ranks a description word above a label substring", () => {
    const cats = catalogue(k("KC_MSEL", "Media Player"), k("MO(1)", "MO", [], "Momentary layer 1", null, "layer"));
    expect(codes("layer", cats)).toEqual(["MO(1)", "KC_MSEL"]);
  });

  it("puts real keys before one-shot modifiers of the same rank", () => {
    const cats = catalogue(
      k("OSM(MOD_LCTL)", "Ctrl", [], "Enable Left Control for one keypress", null, "one-shot-mod"),
      k("KC_LCTRL", "LCtrl", ["KC_LCTL"], null, null, "modifier"),
      k("KC_RCTRL", "RCtrl", ["KC_RCTL"], null, null, "modifier"),
    );
    expect(codes("ctrl", cats)).toEqual(["KC_LCTRL", "KC_RCTRL", "OSM(MOD_LCTL)"]);
  });

  it("finds plain modifiers by side and name", () => {
    const cats = catalogue(
      k("KC_RSHIFT", "RShift", [], null, null, "modifier"), k("KC_LSHIFT", "LShift", [], null, null, "modifier"),
    );
    expect(codes("left shift", cats)).toEqual(["KC_LSHIFT"]);
    expect(codes("right", cats)).toEqual(["KC_RSHIFT"]);
  });

  it("matches words anywhere when the whole phrase isn't found", () => {
    const cats = catalogue(k("KC_X", "Swap Ctrl Caps", [], "Swap Caps Lock and Left Control"));
    expect(codes("caps swap", cats)).toEqual(["KC_X"]);
    expect(codes("caps nothing", cats)).toEqual([]);
  });

  it("ignores extra whitespace and accent composition", () => {
    expect(codes("  caps \t  lock ")).toEqual(["KC_CAPSLOCK"]);
    const cats = catalogue(k("KC_E", "é"));
    expect(codes("é", cats)).toEqual(["KC_E"]);
  });
});
