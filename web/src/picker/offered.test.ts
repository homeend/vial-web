import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, Described, KeyboardModel, KeycodeCategory, Macro, TapDance } from "../api/types";
import {
  categoryIndex, LIGHTING_CATEGORY, MACROS_CATEGORY, offeredCategories, setUpEntries, TAP_DANCE_CATEGORY,
} from "./offered";
import { codesNamed, searchKeycodes } from "./search";

function k(code: string, tap: string): CatalogueKeycode {
  return {
    code, value: 4, kind: "basic", tap, legend: { main: tap, shifted: null, altGr: null }, hold: null, layer: null,
    layerAction: null, index: null, description: null, aliases: [],
  };
}

const catalogue: KeycodeCategory[] = [
  { name: "Basic", templates: [], keycodes: [k("KC_A", "A")] },
  { name: LIGHTING_CATEGORY, templates: [], keycodes: [k("RGB_TOG", "RGB Toggle"), k("BL_TOGG", "BL Toggle")] },
  { name: "Media", templates: [], keycodes: [k("KC_VOLU", "Vol +")] },
];

describe("categoryIndex", () => {
  it("finds the category shown last by its name, wherever it is now (another keyboard offers other categories)", () => {
    expect(categoryIndex(catalogue, "Media")).toBe(2);
    expect(categoryIndex(offeredCategories(catalogue, false), "Media")).toBe(1);
  });

  it("is the first category when the one shown last isn't offered, or none was shown yet", () => {
    expect(categoryIndex(offeredCategories(catalogue, false), LIGHTING_CATEGORY)).toBe(0);
    expect(categoryIndex(catalogue, null)).toBe(0);
  });
});

describe("offeredCategories", () => {
  it("leaves out the Lighting category on a keyboard without lighting", () => {
    expect(offeredCategories(catalogue, false).map((c) => c.name)).toEqual(["Basic", "Media"]);
  });

  it("keeps every category on a keyboard with lighting (of any kind), as the catalogue is", () => {
    expect(offeredCategories(catalogue, true)).toBe(catalogue);
  });

  it("gives the same catalogue when there is nothing to leave out", () => {
    const plain = catalogue.filter((c) => c.name !== LIGHTING_CATEGORY);
    expect(offeredCategories(plain, false)).toBe(plain);
  });

  it("so searching doesn't find lighting keys either", () => {
    const offered = offeredCategories(catalogue, false);
    expect(searchKeycodes(offered, "rgb")).toEqual([]);
    expect(searchKeycodes(offered, "toggle")).toEqual([]);
    expect([...codesNamed(offered, "rgb_tog")]).toEqual([]);
    expect(searchKeycodes(catalogue, "rgb").map((r) => r.code)).toEqual(["RGB_TOG"]);
  });
});

describe("setUpEntries", () => {
  const none: Described = {
    code: "KC_NO", value: 0, kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null,
    index: null, description: null,
  };
  const esc: Described = { ...none, code: "KC_ESC", kind: "basic", tap: "Esc", legend: { main: "Esc" } };
  const ctrl: Described = { ...none, code: "KC_LCTRL", kind: "modifier", tap: "LCtrl", legend: { main: "LCtrl" } };
  const enter: Described = { ...none, code: "KC_ENTER", kind: "basic", tap: "Enter", legend: { main: "Enter" } };

  function td(index: number, slots: Partial<TapDance> = {}): TapDance {
    return { index, name: "", customName: false, tap: none, hold: none, doubleTap: none, tapHold: none, tappingTerm: 200,
      ...slots };
  }

  function macro(index: number, actions: Macro["actions"], name = ""): Macro {
    return { index, name, customName: name !== "", actions };
  }

  function entry(code: string, kind: "tap-dance" | "macro", index: number): CatalogueKeycode {
    return { ...k(code, code), kind, index };
  }

  const withEntries: KeycodeCategory[] = [
    { name: "Basic", templates: [], keycodes: [k("KC_A", "A")] },
    { name: TAP_DANCE_CATEGORY, templates: [],
      keycodes: [entry("TD(0)", "tap-dance", 0), entry("TD(1)", "tap-dance", 1), entry("TD(2)", "tap-dance", 2)] },
    { name: MACROS_CATEGORY, templates: [],
      keycodes: [entry("M0", "macro", 0), entry("M1", "macro", 1), { ...k("DYN_REC_START1", "DM1 Rec"), kind: "other" }] },
  ];

  function model(tapDance: TapDance[], macros: Macro[]): KeyboardModel {
    return { layers: [], tapDance, macros: { items: macros } } as unknown as KeyboardModel;
  }

  const both = model(
    [td(0), td(1, { name: "Nav", customName: true, tap: esc, hold: ctrl }), td(2)],
    [macro(0, []), macro(1, [{ type: "text", text: "git status", keys: [] }, { type: "tap", keys: [enter] }])],
  );

  it("offers only the tap dances and macros that are set up: an empty one does nothing", () => {
    const offered = setUpEntries(withEntries, both);
    expect(offered.map((c) => [c.name, c.keycodes.map((x) => x.code)])).toEqual([
      ["Basic", ["KC_A"]], [TAP_DANCE_CATEGORY, ["TD(1)"]], [MACROS_CATEGORY, ["M1", "DYN_REC_START1"]],
    ]);
    expect(offered[0]).toBe(withEntries[0]);
  });

  it("keeps the dynamic macro keys, which aren't Vial's macros", () => {
    const offered = setUpEntries(withEntries, model([td(0)], [macro(0, [])]));
    expect(offered[2].keycodes.map((x) => x.code)).toEqual(["DYN_REC_START1"]);
    expect(offered[2].keycodes[0]).toBe(withEntries[2].keycodes[2]);
  });

  it("describes each by its name and what it does, which the picker shows as its tooltip", () => {
    const offered = setUpEntries(withEntries, both);
    expect(offered[1].keycodes[0].description).toBe("Nav — tap: Esc · hold: LCtrl · tapping term 200 ms");
    expect(offered[2].keycodes[0].description).toBe("type “git status”, tap Enter");
  });

  it("gives each one's card: a name given, the four slots (empty ones as null) or the steps", () => {
    const offered = setUpEntries(withEntries, both);
    expect(offered[1].details?.get("TD(1)")).toEqual({
      kind: "tap-dance", name: "Nav", tappingTerm: 200,
      slots: [{ label: "Tap", action: esc }, { label: "Hold", action: ctrl }, { label: "Double tap", action: null },
        { label: "Tap, then hold", action: null }],
    });
    expect(offered[2].details?.get("M1")).toEqual({ kind: "macro", name: "", steps: both.macros.items[1].actions });
    expect([...(offered[2].details?.keys() ?? [])]).toEqual(["M1"]);
    expect(offered[0].details).toBeUndefined();
  });

  it("leaves out a name made from the slots, which would only say them again", () => {
    const made = model([td(0, { name: "Esc / LCtrl", customName: false, tap: esc, hold: ctrl })], []);
    expect(setUpEntries(withEntries, made)[1].keycodes[0].description).toBe("tap: Esc · hold: LCtrl · tapping term 200 ms");
  });

  it("cuts a long macro's description short", () => {
    const long = model([td(0)], [macro(0, [{ type: "text", text: "x".repeat(400), keys: [] }])]);
    const description = setUpEntries(withEntries, long)[2].keycodes[0].description ?? "";
    expect(description.length).toBeLessThanOrEqual(200);
    expect(description.endsWith("…")).toBe(true);
  });

  it("keeps the tab when none is set up, and says how to set one up", () => {
    const none = model([td(0)], [macro(0, [])]);
    const empty = setUpEntries(withEntries, none);
    expect(empty.map((c) => [c.name, c.keycodes.length])).toEqual([["Basic", 1], [TAP_DANCE_CATEGORY, 0],
      [MACROS_CATEGORY, 1]]);
    expect(empty[1].note).toMatch(/^No tap dance is set up yet/);
    expect(empty[2].note).toMatch(/^No macro is set up yet/);
  });

  it("says what is left out on the tabs that leave some out, and nothing on the others", () => {
    const offered = setUpEntries(withEntries, both);
    expect(offered[1].note).toMatch(/^Only the tap dances set up are shown/);
    expect(offered[2].note).toMatch(/^Only the macros set up are shown/);
    expect(offered[0].note).toBeUndefined();
  });

  it("leaves out the Tap dance tab when the firmware has none, and keeps the dynamic macro keys without a note", () => {
    const offered = setUpEntries(withEntries, model([], []));
    expect(offered.map((c) => c.name)).toEqual(["Basic", MACROS_CATEGORY]);
    expect(offered[1].note).toBeUndefined();
  });

  it("gives the catalogue as it is with no keyboard shown", () => {
    expect(setUpEntries(withEntries, null)).toBe(withEntries);
  });
});
