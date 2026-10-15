import { describe, expect, it } from "vitest";
import type { KeyGeometry, KeyboardModel } from "../api/types";
import { encoderKnobs, layoutChoices, placeKeyboard } from "./geometry";

function key(fields: Partial<KeyGeometry>): KeyGeometry {
  return {
    row: 0, col: 0, encoder: null, direction: null,
    x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0,
    layoutIndex: -1, layoutOption: -1, decal: false,
    ...fields,
  };
}

function board(keys: KeyGeometry[], encoders: KeyGeometry[] = [],
  layoutOptions: KeyboardModel["layoutOptions"] = null) {
  return { keys, encoders, layoutOptions };
}

const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6);

describe("layoutChoices", () => {
  it("is empty without layout options", () => {
    expect(layoutChoices(null)).toEqual([]);
  });

  it("reads on/off options as one bit and lists as enough bits for their choices, first option highest", () => {
    // "Split Backspace" (1 bit) then "Bottom row" with 4 choices (2 bits)
    const labels = ["Split Backspace", ["Bottom row", "ANSI", "Tsangan", "WKL", "HHKB"]];
    expect(layoutChoices({ value: (1 << 2) | 2, labels })).toEqual([1, 2]);
    expect(layoutChoices({ value: 3, labels })).toEqual([0, 3]);
  });

  it("gives a list with one choice no bits", () => {
    expect(layoutChoices({ value: 1, labels: [["Only", "one"], "Flag"] })).toEqual([0, 1]);
  });

  it("handles 32-bit values", () => {
    const labels = Array.from({ length: 32 }, (_, i) => `option ${i}`);
    expect(layoutChoices({ value: 0xffffffff, labels })).toEqual(Array(32).fill(1));
  });
});

describe("placeKeyboard", () => {
  it("places keys in keyboard units, starting at 0,0", () => {
    const placed = placeKeyboard(board([key({ x: 1, y: 2 }), key({ x: 2, y: 2, col: 1, w: 2 })]));
    expect(placed.items.map((k) => [k.x, k.y, k.w, k.h])).toEqual([[0, 0, 1, 1], [1, 0, 2, 1]]);
    expect([placed.width, placed.height]).toEqual([3, 1]);
    expect(placed.items.map((k) => [k.kind, k.index])).toEqual([["key", 0], ["key", 1]]);
  });

  it("leaves out decal keys but keeps the index of the others", () => {
    const placed = placeKeyboard(board([key({ decal: true, x: 5 }), key({ x: 1, row: 1 })]));
    expect(placed.items.map((k) => k.index)).toEqual([1]);
    expect(placed.width).toBe(1);
  });

  it("rotates keys around their rotation origin, clockwise like KLE", () => {
    const placed = placeKeyboard(board([key({ r: 90, rx: 0, ry: 0 })]));
    const [item] = placed.items;
    // the key swings to the left of the origin: everything moves right by one unit
    expect([item.x, item.y, item.rx, item.ry, item.r]).toEqual([1, 0, 1, 0, 90]);
    close(placed.width, 1);
    close(placed.height, 1);
    close(item.cx, 0.5);
    close(item.cy, 0.5);
  });

  it("includes the second rectangle of an ISO Enter in the size", () => {
    const iso = key({ x: 0.25, y: 0, w: 1.25, h: 2, x2: -0.25, y2: 0, w2: 1.5, h2: 1 });
    const placed = placeKeyboard(board([iso]));
    const [item] = placed.items;
    expect([item.x, item.x2, item.w2, item.hasSecond]).toEqual([0.25, -0.25, 1.5, true]);
    expect([placed.width, placed.height]).toEqual([1.5, 2]);
  });

  it("shows only the chosen layout option, moved to where the first choice sits", () => {
    const keys = [
      key({ x: 0, y: 0 }),
      key({ x: 1, y: 0, col: 1, layoutIndex: 0, layoutOption: 0, w: 2 }),
      key({ x: 1, y: 2, col: 2, layoutIndex: 0, layoutOption: 1 }),
      key({ x: 2, y: 2, col: 3, layoutIndex: 0, layoutOption: 1 }),
    ];
    const first = placeKeyboard(board(keys, [], { value: 0, labels: ["Split"] }));
    expect(first.items.map((k) => k.index)).toEqual([0, 1]);
    const second = placeKeyboard(board(keys, [], { value: 1, labels: ["Split"] }));
    expect(second.items.map((k) => [k.index, k.x, k.y])).toEqual([[0, 0, 0], [2, 1, 0], [3, 2, 0]]);
    expect([second.width, second.height]).toEqual([3, 1]);
  });

  it("shows every option's first choice when the keyboard reports no layout options", () => {
    const keys = [key({ layoutIndex: 0, layoutOption: 0 }), key({ col: 1, layoutIndex: 0, layoutOption: 1 })];
    expect(placeKeyboard(board(keys)).items.map((k) => k.index)).toEqual([0]);
  });

  it("places encoders after the keys, as encoders", () => {
    const encoders = [
      key({ row: null, col: null, encoder: 0, direction: 0, x: 3 }),
      key({ row: null, col: null, encoder: 0, direction: 1, x: 4 }),
    ];
    const placed = placeKeyboard(board([key({})], encoders));
    expect(placed.items.map((k) => [k.kind, k.index, k.x])).toEqual([["key", 0, 0], ["encoder", 0, 3], ["encoder", 1, 4]]);
    expect(placed.width).toBe(5);
  });

  it("has no size without keys", () => {
    expect(placeKeyboard(board([]))).toEqual({ items: [], width: 0, height: 0 });
  });
});

describe("encoderKnobs", () => {
  const enc = (encoder: number, direction: number, fields: Partial<KeyGeometry>) =>
    key({ row: null, col: null, encoder, direction, ...fields });

  it("joins the two directions of an encoder into one knob", () => {
    const placed = placeKeyboard(board([], [enc(0, 0, { x: 0 }), enc(0, 1, { x: 1 })]));
    expect(encoderKnobs(placed)).toEqual([{ encoder: 0, cx: 1, cy: 0.5, length: 2, thickness: 1, angle: 0 }]);
  });

  it("follows the rotation of the encoder", () => {
    const placed = placeKeyboard(board([], [enc(0, 0, { x: 0, r: 90 }), enc(0, 1, { x: 1, r: 90 })]));
    const [knob] = encoderKnobs(placed);
    expect(knob.angle).toBeCloseTo(90, 6);
    expect(knob.length).toBeCloseTo(2, 6);
  });

  it("gives an encoder with one direction a round knob", () => {
    const placed = placeKeyboard(board([], [enc(3, 1, { x: 0 })]));
    expect(encoderKnobs(placed)).toEqual([{ encoder: 3, cx: 0.5, cy: 0.5, length: 1, thickness: 1, angle: 0 }]);
  });
});
