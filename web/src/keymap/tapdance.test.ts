import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel, TapDance } from "../api/types";
import { freeTapDance, tapDanceSlots } from "./tapdance";

const none: Described = {
  code: "KC_NO", value: 0, kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null, index: null,
  description: null,
};
const tab: Described = { ...none, code: "KC_TAB", value: 0x2b, kind: "basic", tap: "Tab", legend: { main: "Tab" } };

function td(index: number, tap: Described): TapDance {
  return { index, name: "", customName: false, tap, hold: none, doubleTap: none, tapHold: none, tappingTerm: 200 };
}

function key(code: string): Described {
  const td = /^TD\((\d+)\)$/.exec(code);
  return td ? { ...none, code, kind: "tap-dance", index: Number(td[1]) } : { ...none, code, kind: "basic" };
}

interface Elsewhere {
  combos?: { keys: string[]; output: string }[];
  keyOverrides?: { trigger: string; replacement: string }[];
  altRepeatKeys?: { keycode: string; altKeycode: string }[];
  /** each macro's steps, one keycode tapped in each */
  macros?: string[][];
}

function model(tapDance: TapDance[], layerKeys: string[][], encoderKeys: string[][] = [], elsewhere: Elsewhere = {}) {
  return {
    tapDance,
    layers: layerKeys.map((keys, i) => ({ keys: keys.map(key), encoders: (encoderKeys[i] ?? []).map(key) })),
    combos: (elsewhere.combos ?? []).map((c, index) => ({ index, keys: c.keys.map(key), output: key(c.output) })),
    keyOverrides: (elsewhere.keyOverrides ?? []).map((o, index) => (
      { index, trigger: key(o.trigger), replacement: key(o.replacement) })),
    altRepeatKeys: (elsewhere.altRepeatKeys ?? []).map((a, index) => (
      { index, keycode: key(a.keycode), altKeycode: key(a.altKeycode) })),
    macros: { items: (elsewhere.macros ?? []).map((steps, index) => (
      { index, actions: steps.map((code) => ({ type: "tap", keys: [key(code)] })) })) },
  } as unknown as KeyboardModel;
}

describe("freeTapDance", () => {
  it("is the first empty tap dance that no key uses", () => {
    expect(freeTapDance(model([td(0, tab), td(1, none), td(2, none)], [["TD(1)"], ["KC_A"]]))).toBe(2);
  });

  it("looks at encoders too", () => {
    expect(freeTapDance(model([td(0, none), td(1, none)], [["KC_A"]], [["TD(0)"]]))).toBe(1);
  });

  it("counts a tap dance a combo uses, as its output or one of its keys", () => {
    const empty = [td(0, none), td(1, none), td(2, none)];
    expect(freeTapDance(model(empty, [["KC_A"]], [], { combos: [{ keys: ["KC_A", "KC_B"], output: "TD(0)" }] })))
      .toBe(1);
    expect(freeTapDance(model(empty, [["KC_A"]], [], { combos: [{ keys: ["TD(0)", "TD(1)"], output: "KC_C" }] })))
      .toBe(2);
  });

  it("counts a tap dance a key override uses, as its trigger or its replacement", () => {
    const empty = [td(0, none), td(1, none), td(2, none)];
    expect(freeTapDance(model(empty, [["KC_A"]], [], { keyOverrides: [{ trigger: "TD(0)", replacement: "TD(1)" }] })))
      .toBe(2);
  });

  it("counts a tap dance an alt repeat key uses", () => {
    const empty = [td(0, none), td(1, none), td(2, none)];
    expect(freeTapDance(model(empty, [["KC_A"]], [], { altRepeatKeys: [{ keycode: "TD(0)", altKeycode: "TD(1)" }] })))
      .toBe(2);
  });

  it("counts a tap dance a macro taps, presses or releases", () => {
    const empty = [td(0, none), td(1, none), td(2, none)];
    expect(freeTapDance(model(empty, [["KC_A"]], [], { macros: [["KC_B"], ["KC_C", "TD(0)"]] }))).toBe(1);
  });

  it("counts a tap dance another tap dance uses", () => {
    const usesTd1 = { ...td(0, tab), doubleTap: key("TD(1)") };
    expect(freeTapDance(model([usesTd1, td(1, none), td(2, none)], [["KC_A"]]))).toBe(2);
    expect(freeTapDance(model([td(0, none), td(1, none), { ...td(2, tab), tapHold: key("TD(0)") }], [["KC_A"]])))
      .toBe(1);
  });

  it("is null when every tap dance is set or used", () => {
    expect(freeTapDance(model([td(0, tab), td(1, none)], [["KC_A", "TD(1)"]]))).toBeNull();
    expect(freeTapDance(model([], [["KC_A"]]))).toBeNull();
  });
});

describe("tapDanceSlots", () => {
  it("lists what each way of pressing does, in order", () => {
    const caps: Described = { ...none, code: "KC_CAPSLOCK", kind: "basic", tap: "Caps Lock" };
    const entry = { ...td(0, tab), doubleTap: caps };
    expect(tapDanceSlots(entry).map((s) => [s.label, s.action.code])).toEqual([
      ["Tap", "KC_TAB"], ["Hold", "KC_NO"], ["Double tap", "KC_CAPSLOCK"], ["Tap, then hold", "KC_NO"],
    ]);
  });
});
