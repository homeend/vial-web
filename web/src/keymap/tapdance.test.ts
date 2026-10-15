import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel, TapDance } from "../api/types";
import { freeTapDance, tapDanceSlots } from "./tapdance";

const none: Described = {
  code: "KC_NO", kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null, index: null,
  description: null,
};
const tab: Described = { ...none, code: "KC_TAB", kind: "basic", tap: "Tab", legend: { main: "Tab" } };

function td(index: number, tap: Described): TapDance {
  return { index, name: "", customName: false, tap, hold: none, doubleTap: none, tapHold: none, tappingTerm: 200 };
}

function key(code: string): Described {
  const td = /^TD\((\d+)\)$/.exec(code);
  return td ? { ...none, code, kind: "tap-dance", index: Number(td[1]) } : { ...none, code, kind: "basic" };
}

function model(tapDance: TapDance[], layerKeys: string[][], encoderKeys: string[][] = []) {
  return {
    tapDance,
    layers: layerKeys.map((keys, i) => ({ keys: keys.map(key), encoders: (encoderKeys[i] ?? []).map(key) })),
  } as unknown as KeyboardModel;
}

describe("freeTapDance", () => {
  it("is the first empty tap dance that no key uses", () => {
    expect(freeTapDance(model([td(0, tab), td(1, none), td(2, none)], [["TD(1)"], ["KC_A"]]))).toBe(2);
  });

  it("looks at encoders too", () => {
    expect(freeTapDance(model([td(0, none), td(1, none)], [["KC_A"]], [["TD(0)"]]))).toBe(1);
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
