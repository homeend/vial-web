import { describe, expect, it } from "vitest";
import type { KeyGeometry } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";
import { ordinal, positionNames, rowsOf, splitLine } from "./positions";
import { AT, corneKeys } from "./testing";

const g = (fields: Partial<KeyGeometry>): KeyGeometry => ({
  x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0, layoutIndex: -1, layoutOption: -1, decal: false,
  ...fields,
});

function board(keys: KeyGeometry[], encoders: KeyGeometry[] = []) {
  return placeKeyboard({ keys, encoders, layoutOptions: null });
}

describe("ordinal", () => {
  it("counts in English", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});

describe("splitLine", () => {
  it("is the middle of the gap between the halves of a split keyboard", () => {
    expect(splitLine(board(corneKeys()).items)).toBe(7.5);
  });

  it("is null for a keyboard in one piece, or a gap with only a few keys on one side", () => {
    const row = Array.from({ length: 10 }, (_, x) => g({ x }));
    expect(splitLine(board(row).items)).toBeNull();
    expect(splitLine(board([...row, g({ x: 12 })]).items)).toBeNull();
  });

  it("measures rotated keys as drawn", () => {
    // upright, the gap would be 0.9 units; a key turned 45 degrees reaches 0.2 units further, leaving 0.69
    const keys = [g({ x: 0 }), g({ x: 1, r: 45, rx: 1.5, ry: 0.5 }), g({ x: 2.9 }), g({ x: 3.9 })];
    expect(splitLine(board(keys).items)).toBeNull();
    expect(splitLine(board(keys.map((k) => ({ ...k, r: 0 }))).items)).not.toBeNull();
  });
});

describe("rowsOf", () => {
  it("keeps staggered columns in one row", () => {
    const keys = [g({ x: 0, y: 0.5 }), g({ x: 1, y: 0 }), g({ x: 2, y: 0.25 }), g({ x: 0, y: 1.5 }), g({ x: 1, y: 1 })];
    const rows = rowsOf(board(keys).items);
    expect(rows.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2], [3, 4]]);
  });
});

describe("positionNames", () => {
  const names = positionNames(board(corneKeys()));
  const at = (index: number) => names.get(refId({ kind: "key", index }));

  it("names the thumb keys of a split keyboard from the inside out", () => {
    expect([AT.leftInnerThumb, AT.leftMiddleThumb, AT.leftOuterThumb].map(at)).toEqual(
      ["left inner thumb", "left middle thumb", "left outer thumb"]);
    expect([AT.rightInnerThumb, AT.rightMiddleThumb, AT.rightOuterThumb].map(at)).toEqual(
      ["right inner thumb", "right middle thumb", "right outer thumb"]);
  });

  it("names the other keys by half, row and place from the outside", () => {
    expect(at(AT.grid(0, 0))).toBe("left top row, 1st from the outside");
    expect(at(AT.grid(1, 4))).toBe("left home row, 5th from the outside");
    expect(at(AT.grid(2, 11))).toBe("right bottom row, 1st from the outside");
    expect(at(AT.grid(0, 6))).toBe("right top row, 6th from the outside");
  });

  it("calls a single thumb key, or two, by what they are", () => {
    const keys = [...corneKeys().slice(0, 36), g({ x: 5, y: 3 }), g({ x: 9, y: 3 }), g({ x: 10, y: 3 })];
    const two = positionNames(board(keys));
    expect(two.get("key:36")).toBe("left thumb");
    expect(two.get("key:37")).toBe("right inner thumb");
    expect(two.get("key:38")).toBe("right outer thumb");
  });

  it("numbers the rows of a split half with more than three, and thumb clusters of more than three keys", () => {
    const keys: KeyGeometry[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) keys.push(g({ x, y }), g({ x: x + 8, y }));
    for (let x = 1; x < 5; x++) keys.push(g({ x, y: 4 }), g({ x: x + 7, y: 4 }));
    const many = positionNames(board(keys));
    expect(many.get("key:0")).toBe("left half, row 1, 1st from the outside");
    expect(many.get("key:31")).toBe("right half, row 4, 5th from the outside");
    // left thumbs 1-4 at x 1-4: the one at x 4 is nearest the middle
    expect(many.get("key:46")).toBe("left thumb 1");
    expect(many.get("key:40")).toBe("left thumb 4");
  });

  it("names the keys of a keyboard in one piece by row, from the left", () => {
    const keys = [g({ x: 0, y: 0 }), g({ x: 1, y: 0 }), g({ x: 0, y: 1 }), g({ x: 1, y: 1 }), g({ x: 0, y: 2, w: 2 })];
    const plain = positionNames(board(keys));
    expect(plain.get("key:1")).toBe("top row, 2nd from the left");
    expect(plain.get("key:2")).toBe("middle row, 1st from the left");
    expect(plain.get("key:4")).toBe("bottom row, 1st from the left");
    const four = positionNames(board([...keys, g({ x: 0, y: 3 })]));
    expect(four.get("key:5")).toBe("row 4, 1st from the left");
  });

  it("names encoders by number and direction", () => {
    const encoders = [g({ x: 3, encoder: 0, direction: 0 }), g({ x: 4, encoder: 0, direction: 1 })];
    const named = positionNames(board([g({ x: 0 })], encoders));
    expect(named.get("encoder:0")).toBe("encoder 0, counter-clockwise");
    expect(named.get("encoder:1")).toBe("encoder 0, clockwise");
  });

  it("is empty for a keyboard without keys", () => {
    expect(positionNames(board([])).size).toBe(0);
  });
});
