import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";
import { LIGHTING_CATEGORY, offeredCategories } from "./offered";
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
