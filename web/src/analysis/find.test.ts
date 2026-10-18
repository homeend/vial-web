import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, Described, KeyboardModel, KeycodeCategory } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { codesOn, combosOf } from "./combos";
import { findOnKeymap, foundKeys, matchOf, queryOf, type Found } from "./find";
import { foundLabel, howText } from "./phrases";
import { positionNames } from "./positions";
import { AT, corne, described, layer, type Setup } from "./testing";
import { usageOf } from "./usage";

/** A key whose legend shows a character with Shift and one with AltGr, as the server describes it in a language */
function withLegend(code: string, main: string, shifted: string | null, altGr: string | null = null): Described {
  return { ...described(code), tap: main, legend: { main, shifted, altGr } };
}

const catalogue: KeycodeCategory[] = [{
  name: "Basic", templates: [], keycodes: [
    { ...described("KC_ESCAPE"), tap: "Esc", legend: { main: "Esc" }, aliases: ["KC_ESC"] } as CatalogueKeycode,
    { ...described("KC_2"), tap: "2", legend: { main: "2", shifted: "@" }, aliases: [] } as CatalogueKeycode,
  ],
}];

function find(model: KeyboardModel, text: string) {
  const placement = placeKeyboard(model);
  const combos = combosOf(model, placement);
  const found = findOnKeymap(model, placement, queryOf(text, catalogue), combos, usageOf(model, placement),
    codesOn(model, placement, 0));
  const ctx = { model, names: namesOf(model), positions: positionNames(placement) };
  return { found, labels: found.map((f) => foundLabel(f, ctx)) };
}

/** A Corne whose base layer has 2 (Shift: @) in the top row, and the keys given */
function keyboard(setup: Partial<Setup> = {}, base: Record<number, Described> = {}): KeyboardModel {
  const model = corne({ layers: [layer({}, "KC_NO"), layer({}), layer({}, "KC_NO")], ...setup });
  model.layers[0].keys[AT.grid(0, 1)] = withLegend("KC_2", "2", "@");
  for (const [index, d] of Object.entries(base)) model.layers[0].keys[Number(index)] = d;
  return model;
}

describe("matchOf", () => {
  const q = (text: string) => queryOf(text, catalogue);

  it("matches what a key types, with Shift, and with AltGr", () => {
    const two = withLegend("KC_2", "2", "@");
    expect(matchOf(two, q("2"))).toBe("tap");
    expect(matchOf(two, q("@"))).toBe("shift");
    // Polish: A types ą with AltGr
    const a = withLegend("KC_A", "A", null, "ą");
    expect(matchOf(a, q("ą"))).toBe("altgr");
    expect(matchOf(a, q("a"))).toBe("tap");
    expect(matchOf(a, q("@"))).toBeNull();
  });

  it("matches a key by its name or alias, and a layer key by its keycode", () => {
    const esc = { ...described("KC_ESCAPE"), tap: "Esc", legend: { main: "Esc" } };
    expect(matchOf(esc, q("esc"))).toBe("tap");
    expect(matchOf(esc, q("KC_ESC"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("MO(2)"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("mo(2)"))).toBe("name");
    expect(matchOf(described("MO(2)"), q("MO(3)"))).toBeNull();
  });

  it("never matches empty or transparent keys, or an empty query", () => {
    expect(matchOf(described("KC_NO"), q(""))).toBeNull();
    expect(matchOf(described("KC_TRNS"), q("▽"))).toBeNull();
    expect(matchOf(withLegend("KC_2", "2", "@"), q("   "))).toBeNull();
  });
});

describe("findOnKeymap", () => {
  it("finds @ as Shift + 2 and as its own key on every layer", () => {
    const model = keyboard({}, { [AT.grid(1, 5)]: withLegend("KC_AT", "@", null) });
    model.layers[2].keys[AT.rightInnerThumb] = withLegend("LSFT(KC_2)", "@", null);
    const { found, labels } = find(model, "@");
    expect(labels).toEqual([
      "Shift + 2 on Base (left top row, 2nd from the outside)",
      "@ on Base (left home row, 6th from the outside)",
      "@ on Layer 2 (right inner thumb)",
    ]);
    expect(found.map((f) => f.type)).toEqual(["key", "key", "key"]);
  });

  it("finds ą as AltGr + A with the Polish keyboard language", () => {
    const model = keyboard({}, { [AT.grid(1, 1)]: withLegend("KC_A", "A", null, "ą") });
    expect(find(model, "ą").labels).toEqual(["AltGr + A on Base (left home row, 2nd from the outside)"]);
  });

  it("finds it in tap dance slots, combo outputs, key overrides and macros", () => {
    const model = keyboard({
      tapDances: [["KC_A", "KC_NO", "KC_ESC", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "KC_ESC" }],
      keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_ESC" }],
      macros: [0, 1],
    }, {
      [AT.leftOuterThumb]: described("TD(0)"), 0: described("KC_J"), 1: described("KC_K"),
      [AT.grid(0, 11)]: described("KC_BSPC"), [AT.rightOuterThumb]: described("M1"),
    });
    model.macros.items[0].actions = [{ type: "text", text: "Hello, Esc", keys: [] }];
    model.macros.items[1].actions = [{ type: "tap", keys: [described("KC_ESC")] }];
    const { found, labels } = find(model, "Esc");
    expect(labels).toEqual([
      "tap dance 0, double tap: Esc",
      "combo J + K → Esc",
      "key override 0: Esc instead of BSPC",
      "macro 0 types \"Hello, Esc\"",
      "macro 1 presses Esc",
    ]);
    // each says which key runs it, when one does
    const keys = found.map((f) => (f.type === "key" ? null : f.key && `${f.key.layer}:${f.key.ref.index}`));
    expect(keys).toEqual([`0:${AT.leftOuterThumb}`, "0:0", `0:${AT.grid(0, 11)}`, null, `0:${AT.rightOuterThumb}`]);
  });

  it("matches macro text as typed, with case", () => {
    const model = keyboard({ macros: [1] });
    model.macros.items[0].actions = [{ type: "text", text: "git status", keys: [] }];
    expect(find(model, "g").labels).toEqual(["macro 0 types \"git status\""]);
    expect(find(model, "G").labels).toEqual([]);
  });

  it("leaves out disabled key overrides", () => {
    const model = keyboard({ keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_ESC" }] });
    model.keyOverrides[0].enabled = false;
    expect(find(model, "esc").found).toEqual([]);
  });

  it("finds a layer key by its keycode", () => {
    const model = keyboard({}, { [AT.leftInnerThumb]: described("MO(2)") });
    expect(find(model, "MO(2)").labels).toEqual(["MO 2 on Base (left inner thumb)"]);
  });

  it("finds nothing for a character that is nowhere, or no text", () => {
    expect(find(keyboard(), "ż").found).toEqual([]);
    expect(find(keyboard(), "").found).toEqual([]);
  });
});

describe("foundKeys", () => {
  it("are the keys found, and those that run what was found, by layer", () => {
    const found: Found[] = [
      { type: "key", layer: 1, ref: { kind: "key", index: 3 }, how: "tap", action: described("KC_A") },
      { type: "tap-dance", tapDance: 0, slot: "Tap", how: "tap", action: described("KC_A"), key: { layer: 0, ref: { kind: "key", index: 7 } } },
      { type: "macro", macro: 0, how: "text", text: "a", action: null, key: null },
    ];
    expect(foundKeys(found, 2).map((keys) => [...keys])).toEqual([["key:7"], ["key:3"]]);
  });
});

describe("howText", () => {
  it("says which key to press, and with which modifier", () => {
    const two = withLegend("KC_2", "2", "@");
    expect([howText("tap", two), howText("shift", two), howText("altgr", two), howText("name", described("MO(2)"))])
      .toEqual(["2", "Shift + 2", "AltGr + 2", "MO 2"]);
  });
});
