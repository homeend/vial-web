import { describe, expect, it } from "vitest";
import type { CatalogueKeycode, Described, KeyboardModel, KeycodeCategory } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { namesOf } from "../keyboard/labels";
import { codesOn, combosOf } from "./combos";
import { findOnKeymap, foundKeys, matchOf, queryOf, type Found, type Place } from "./find";
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
    { ...described("KC_Y"), aliases: [] } as CatalogueKeycode,
    { ...described("KC_Z"), aliases: [] } as CatalogueKeycode,
  ],
}];

/** A layer-tap or mod-tap key, with the keycode it taps as the server gives it */
function tapping(code: string, tapCode: string): Described {
  return { ...described(code), tapCode };
}

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

  it("never matches empty or transparent keys", () => {
    expect(matchOf(described("KC_NO"), q("KC_NO"))).toBeNull();
    expect(matchOf(described("KC_TRNS"), q("▽"))).toBeNull();
    expect(matchOf(described("KC_TRNS"), q("KC_TRNS"))).toBeNull();
  });

  it("never matches an empty query", () => {
    expect(matchOf(withLegend("KC_2", "2", "@"), q(""))).toBeNull();
    expect(matchOf(withLegend("KC_2", "2", "@"), q("   "))).toBeNull();
  });

  it("matches a single character by legend only, never by a keycode's name", () => {
    // German (QWERTZ): KC_Y types Z, and KC_Z types Y
    const y = withLegend("KC_Y", "Z", null);
    const z = withLegend("KC_Z", "Y", null);
    expect(matchOf(y, q("y"))).toBeNull();
    expect(matchOf(z, q("y"))).toBe("tap");
    expect(matchOf(y, q("z"))).toBe("tap");
    // a keycode's full name still names it
    expect(matchOf(y, q("KC_Y"))).toBe("name");
    expect(matchOf(z, q("KC_Y"))).toBeNull();
  });

  it("matches a layer-tap or mod-tap key by the name of the keycode it taps", () => {
    const lt = tapping("LT1(KC_ESC)", "KC_ESCAPE");
    const mt = tapping("LCTL_T(KC_ESC)", "KC_ESCAPE");
    expect([matchOf(lt, q("esc")), matchOf(mt, q("esc"))]).toEqual(["tap", "tap"]);
    for (const text of ["KC_ESC", "escape", "KC_ESCAPE"]) {
      expect([matchOf(lt, q(text)), matchOf(mt, q(text))]).toEqual(["name", "name"]);
    }
    expect(matchOf(lt, q("LT1(KC_ESC)"))).toBe("name");
    // a hold-only key taps nothing
    expect(matchOf(tapping("LT1(KC_NO)", "KC_NO"), q("KC_NO"))).toBeNull();
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

  it("finds @ as Shift + 2 on a layer-tap key", () => {
    const model = keyboard();
    model.layers[0].keys[AT.leftInnerThumb] = { ...withLegend("LT1(KC_2)", "2", "@"), kind: "layer-tap",
      hold: "layer 1", layer: 1, layerAction: "while held", tapCode: "KC_2" };
    expect(find(model, "@").labels).toEqual([
      "Shift + 2 on Base (left top row, 2nd from the outside)",
      "Shift + 2 on Base (left inner thumb)",
    ]);
  });

  it("lists keys by layer, and on each layer as the keyboard is drawn", () => {
    const model = keyboard();
    model.layers[2].keys[AT.grid(0, 3)] = withLegend("KC_2", "2", "@");
    model.layers[1].keys[AT.rightOuterThumb] = withLegend("KC_AT", "@", null);
    model.layers[1].keys[AT.grid(2, 0)] = withLegend("KC_AT", "@", null);
    expect(find(model, "@").labels).toEqual([
      "Shift + 2 on Base (left top row, 2nd from the outside)",
      "@ on Layer 1 (left bottom row, 1st from the outside)",
      "@ on Layer 1 (right outer thumb)",
      "Shift + 2 on Layer 2 (left top row, 4th from the outside)",
    ]);
  });

  it("finds a letter by what it types in the keyboard language, not by its keycode's name", () => {
    // German (QWERTZ): KC_Y types Z, and KC_Z types Y
    const model = keyboard({}, {
      [AT.grid(0, 6)]: withLegend("KC_Y", "Z", null), [AT.grid(2, 1)]: withLegend("KC_Z", "Y", null),
    });
    expect(find(model, "y").labels).toEqual(["Y on Base (left bottom row, 2nd from the outside)"]);
    expect(find(model, "z").labels).toEqual(["Z on Base (right top row, 6th from the outside)"]);
    // its keycode's name finds the key, showing what it types
    expect(find(model, "KC_Y").labels).toEqual(["Z on Base (right top row, 6th from the outside)"]);
  });

  it("finds layer-tap and mod-tap keys by the name of the keycode they tap", () => {
    const model = keyboard({}, {
      [AT.leftInnerThumb]: tapping("LT1(KC_ESC)", "KC_ESCAPE"),
      [AT.rightInnerThumb]: tapping("LCTL_T(KC_ESC)", "KC_ESCAPE"),
    });
    const labels = ["Esc on Base (left inner thumb)", "Esc on Base (right inner thumb)"];
    expect(find(model, "KC_ESC").labels).toEqual(labels);
    expect(find(model, "escape").labels).toEqual(labels);
    expect(find(model, "KC_ESC").found.map((f) => f.how)).toEqual(["name", "name"]);
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

  it("finds nothing for a character that is nowhere", () => {
    expect(find(keyboard(), "ż").found).toEqual([]);
  });

  it("finds nothing for no text", () => {
    expect(find(keyboard(), "").found).toEqual([]);
    expect(find(keyboard(), "  ").found).toEqual([]);
  });
});

describe("foundKeys", () => {
  const seven = { layer: 0, ref: { kind: "key" as const, index: 7 } };
  const runBy = (keys: Place[]) => ({ key: keys[0] ?? null, keys });

  it("are the keys found, and those that run what was found, by layer", () => {
    const found: Found[] = [
      { type: "key", layer: 1, ref: { kind: "key", index: 3 }, how: "tap", action: described("KC_A") },
      { type: "tap-dance", tapDance: 0, slot: "Tap", how: "tap", action: described("KC_A"), ...runBy([seven]) },
      { type: "macro", macro: 0, how: "text", text: "a", action: null, key: null, keys: [] },
    ];
    expect(foundKeys(found, 2).map((keys) => [...keys])).toEqual([["key:7"], ["key:3"]]);
  });

  it("leave out a place on a layer beyond those given", () => {
    const found: Found[] = [
      { type: "key", layer: 0, ref: { kind: "key", index: 3 }, how: "tap", action: described("KC_A") },
      { type: "key", layer: 2, ref: { kind: "key", index: 4 }, how: "tap", action: described("KC_A") },
    ];
    expect(foundKeys(found, 2).map((keys) => [...keys])).toEqual([["key:3"], []]);
  });

  it("are every key that runs a tap dance, combo, key override or macro, not only the first", () => {
    const model = keyboard({
      tapDances: [["KC_ESC", "KC_NO", "KC_NO", "KC_NO"]],
      combos: [{ keys: ["KC_J", "KC_K"], output: "KC_ESC" }],
      keyOverrides: [{ trigger: "KC_BSPC", replacement: "KC_ESC" }],
      macros: [1],
    }, {
      [AT.leftOuterThumb]: described("TD(0)"), [AT.grid(0, 0)]: described("KC_J"), [AT.grid(0, 2)]: described("KC_K"),
      [AT.grid(0, 11)]: described("KC_BSPC"), [AT.grid(1, 11)]: described("KC_BSPC"),
      [AT.rightOuterThumb]: described("M0"), [AT.rightMiddleThumb]: described("M0"),
    });
    model.layers[1].keys[AT.leftInnerThumb] = described("TD(0)");
    model.macros.items[0].actions = [{ type: "tap", keys: [described("KC_ESC")] }];
    const { found } = find(model, "Esc");
    expect(found.map((f) => f.type)).toEqual(["tap-dance", "combo", "key-override", "macro"]);
    const ids = (keys: Set<string>) => [...keys].map((id) => Number(id.slice("key:".length))).sort((a, b) => a - b);
    expect(foundKeys(found, 3).map(ids)).toEqual([
      [0, 2, AT.grid(0, 11), AT.grid(1, 11), AT.leftOuterThumb, AT.rightMiddleThumb, AT.rightOuterThumb]
        .sort((a, b) => a - b),
      [AT.leftInnerThumb],
      [],
    ]);
    // a result still opens the first of its keys
    const first = found.map((f) => (f.type === "key" ? null : f.key && `${f.key.layer}:${f.key.ref.index}`));
    expect(first).toEqual([`0:${AT.leftOuterThumb}`, "0:0", `0:${AT.grid(0, 11)}`, `0:${AT.rightMiddleThumb}`]);
  });
});

describe("howText", () => {
  it("says which key to press, and with which modifier", () => {
    const two = withLegend("KC_2", "2", "@");
    expect([howText("tap", two), howText("shift", two), howText("altgr", two), howText("name", described("MO(2)"))])
      .toEqual(["2", "Shift + 2", "AltGr + 2", "MO 2"]);
  });
});
