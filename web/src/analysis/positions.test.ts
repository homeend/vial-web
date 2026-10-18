import { describe, expect, it } from "vitest";
import type { KeyGeometry } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";
import { CRKBD, FERRIS_SWEEP, IRIS, KYRIA, boardKeys } from "./boards.test-data";
import { ordinal, positionNames, rowsOf, rowsOfHalf, splitLine } from "./positions";
import { AT, corneKeys } from "./testing";

const g = (fields: Partial<KeyGeometry>): KeyGeometry => ({
  x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0, layoutIndex: -1, layoutOption: -1, decal: false,
  ...fields,
});

function board(keys: KeyGeometry[], encoders: KeyGeometry[] = []) {
  return placeKeyboard({ keys, encoders, layoutOptions: null });
}

/** keys side by side from x0 at row y, of the widths given */
function row(y: number, x0: number, widths: number[]): KeyGeometry[] {
  let x = x0;
  return widths.map((w) => {
    const key = g({ x, y, w });
    x += w;
    return key;
  });
}

const ones = (n: number) => Array<number>(n).fill(1);

/** a 60% ANSI keyboard */
const sixty = [
  ...row(0, 0, [...ones(13), 2]), ...row(1, 0, [1.5, ...ones(12), 1.5]), ...row(2, 0, [1.75, ...ones(11), 2.25]),
  ...row(3, 0, [2.25, ...ones(10), 2.75]), ...row(4, 0, [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]),
];
/** a Planck: 4 rows of 12, a 2 unit space bar */
const planck = [...[0, 1, 2].flatMap((y) => row(y, 0, ones(12))), ...row(3, 0, [...ones(5), 2, ...ones(5)])];
/** a split row-staggered keyboard (like a Quefrency): halves 1 unit apart, the bottom rows reach the outer edges.
 * Left half keys 0-27 (bottom row 24-27), right half 28-62 (bottom row 57-62). */
const split65 = [
  ...row(0, 0, ones(7)), ...row(1, 0, [1.5, ...ones(5)]), ...row(2, 0, [1.75, ...ones(5)]),
  ...row(3, 0, [2.25, ...ones(4)]), ...row(4, 0, [1.75, 1.25, 1.5, 2.25]),
  ...row(0, 8, [...ones(6), 2]), ...row(1, 8, [...ones(7), 1.5]), ...row(2, 8, [...ones(6), 2.25]),
  ...row(3, 8, [...ones(5), 1.75, 1]), ...row(4, 8, [2.75, 1.25, 1.25, 1, 1, 1]),
];

const namesOf = (keys: KeyGeometry[]) => {
  const names = positionNames(board(keys));
  return (index: number) => names.get(refId({ kind: "key", index }));
};

describe("ordinal", () => {
  it("counts in English", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});

describe("splitLine", () => {
  const split = (keys: KeyGeometry[]) => splitLine(board(keys).items);

  it("is the middle of the gap between the halves of a split keyboard", () => {
    expect(split(corneKeys())).toBe(7.5);
  });

  it("is null for a keyboard in one piece, or a gap with only a few keys on one side", () => {
    const keys = Array.from({ length: 10 }, (_, x) => g({ x }));
    expect(split(keys)).toBeNull();
    expect(split([...keys, g({ x: 12 })])).toBeNull();
    for (const one of [sixty, planck, row(0, 0, ones(4))]) expect(split(one)).toBeNull();
  });

  it("measures the gap between upright keys: thumb keys turned towards the middle don't close it", () => {
    // upright, the gap is 0.9 units; the key turned 45 degrees reaches 0.2 units into it, which doesn't count
    const keys = [g({ x: 0 }), g({ x: 1, r: 45, rx: 1.5, ry: 0.5 }), g({ x: 2.9 }), g({ x: 3.9 })];
    expect(split(keys)).toBeCloseTo(1.95);
    expect(split(boardKeys(CRKBD))).toBeCloseTo(7.75);
    expect(split(boardKeys(FERRIS_SWEEP))).toBeCloseTo(5.875);
    expect(split(boardKeys(IRIS))).toBeCloseTo(8);
    expect(split(boardKeys(KYRIA))).toBeCloseTo(8.5);
  });

  it("is the widest gap with enough keys on each side: a lone key far out doesn't hide the split", () => {
    expect(split([...corneKeys(), g({ x: 20 })])).toBe(7.5);
  });
});

describe("rowsOf", () => {
  it("keeps staggered columns in one row", () => {
    const keys = [g({ x: 0, y: 0.5 }), g({ x: 1, y: 0 }), g({ x: 2, y: 0.25 }), g({ x: 0, y: 1.5 }), g({ x: 1, y: 1 })];
    const rows = rowsOf(board(keys).items);
    expect(rows.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2], [3, 4]]);
  });

});

describe("rowsOfHalf", () => {
  it("counts the rows of keys in columns down each column, however far a column is staggered", () => {
    // the 1st column is 1.25 units below the 3rd, as a Ferris Sweep's pinky column
    const keys = [0, 1, 2].flatMap((y) => [g({ x: 0, y: y + 1.25 }), g({ x: 1, y: y + 0.5 }), g({ x: 2, y })]);
    const rows = rowsOfHalf(board(keys).items);
    expect(rows.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8]]);
    // a key beside the columns joins the row it is nearest in the nearest column
    const more = rowsOfHalf(board([...keys, g({ x: 3.2, y: 2.6, r: 30, rx: 3.7, ry: 3.1 })]).items);
    expect(more.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8, 9]]);
  });

  it("is as rowsOf for keys not in columns", () => {
    const keys = [...row(0, 0, ones(4)), ...row(1, 0, [1.5, 1, 1]), ...row(2, 0, [1.75, 1, 1])];
    const rows = rowsOfHalf(board(keys).items);
    expect(rows.map((r) => r.map((k) => k.index))).toEqual([[0, 1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });
});

describe("positionNames", () => {
  const at = namesOf(corneKeys());

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
    const two = namesOf([...corneKeys().slice(0, 36), g({ x: 5, y: 3 }), g({ x: 9, y: 3 }), g({ x: 10, y: 3 })]);
    expect(two(36)).toBe("left thumb");
    expect(two(37)).toBe("right inner thumb");
    expect(two(38)).toBe("right outer thumb");
  });

  it("numbers the rows of a split half with more than three, and the thumbs of a cluster of more than three", () => {
    const keys: KeyGeometry[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) keys.push(g({ x, y }), g({ x: x + 8, y }));
    for (let x = 1; x < 5; x++) keys.push(g({ x, y: 4 }), g({ x: x + 7, y: 4 }));
    const many = namesOf(keys);
    expect(many(0)).toBe("left half, row 1, 1st from the outside");
    expect(many(31)).toBe("right half, row 4, 5th from the outside");
    // left thumbs at x 1-4: the one at x 4 is nearest the middle
    expect(many(46)).toBe("left thumb, 1st from the inside");
    expect(many(40)).toBe("left thumb, 4th from the inside");
  });

  it("names the keys of a keyboard in one piece by row, from the left", () => {
    const keys = [g({ x: 0, y: 0 }), g({ x: 1, y: 0 }), g({ x: 0, y: 1 }), g({ x: 1, y: 1 }), g({ x: 0, y: 2, w: 2 })];
    const plain = namesOf(keys);
    expect(plain(1)).toBe("top row, 2nd from the left");
    expect(plain(2)).toBe("middle row, 1st from the left");
    expect(plain(4)).toBe("bottom row, 1st from the left");
    expect(namesOf([...keys, g({ x: 0, y: 3 })])(5)).toBe("row 4, 1st from the left");
  });

  it("leaves out the row of a keyboard with only one", () => {
    expect(namesOf(row(0, 0, ones(4)))(1)).toBe("2nd from the left");
    const split = namesOf([...row(0, 0, ones(3)), ...row(0, 5, ones(3))]);
    expect(split(1)).toBe("left half, 2nd from the outside");
    expect(split(3)).toBe("right half, 3rd from the outside");
  });

  it("keeps the keys of keyboards in one piece in rows, from the left", () => {
    const sixtyAt = namesOf(sixty);
    expect(sixtyAt(0)).toBe("row 1, 1st from the left");
    expect(sixtyAt(sixty.length - 5)).toBe("row 5, 4th from the left");
    const planckAt = namesOf(planck);
    expect(planckAt(41)).toBe("row 4, 6th from the left");
    expect(planckAt(46)).toBe("row 4, 11th from the left");
  });

  it("finds no thumbs on a split keyboard whose bottom rows reach the outer edges", () => {
    const at65 = namesOf(split65);
    expect(at65(24)).toBe("left half, row 5, 1st from the outside");
    expect(at65(27)).toBe("left half, row 5, 4th from the outside");
    expect(at65(57)).toBe("right half, row 5, 6th from the outside");
    expect(at65(62)).toBe("right half, row 5, 1st from the outside");
    expect([...positionNames(board(split65)).values()].filter((n) => n.includes("thumb"))).toEqual([]);
    // the same with the top two rows of the left half in line, so its outermost column ends at the 2nd row: the rows
    // below still reach the outer edge
    const inLine = [...split65.slice(0, 7), ...row(1, 0, ones(6)), ...split65.slice(13)];
    expect(namesOf(inLine)(24)).toBe("left half, row 5, 1st from the outside");
    expect([...positionNames(board(inLine)).values()].filter((n) => n.includes("thumb"))).toEqual([]);
  });

  it("names a split keyboard alike with a lone key far out, which ends a row", () => {
    const outlier = namesOf([...corneKeys(), g({ x: 20, y: 0 })]);
    const rightTop = [6, 7, 8, 9, 10, 11].map((col) => AT.grid(0, col));
    for (let index = 0; index < 42; index++) if (!rightTop.includes(index)) expect(outlier(index)).toBe(at(index));
    expect(outlier(42)).toBe("right top row, 1st from the outside");
    expect(outlier(AT.grid(0, 11))).toBe("right top row, 2nd from the outside");
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

describe("positionNames on real split keyboards", () => {
  it("crkbd: thumbs turned towards the middle", () => {
    const at = namesOf(boardKeys(CRKBD));
    expect([39, 38, 36].map(at)).toEqual(["left inner thumb", "left middle thumb", "left outer thumb"]);
    expect([40, 41, 37].map(at)).toEqual(["right inner thumb", "right middle thumb", "right outer thumb"]);
    expect(at(8)).toBe("left top row, 1st from the outside");
    expect(at(30)).toBe("left bottom row, 6th from the outside");
    expect(at(35)).toBe("right bottom row, 1st from the outside");
  });

  it("Ferris Sweep: two turned thumbs, and the pinky column well below the others", () => {
    const at = namesOf(boardKeys(FERRIS_SWEEP));
    expect([31, 30, 32, 33].map(at)).toEqual(
      ["left inner thumb", "left outer thumb", "right inner thumb", "right outer thumb"]);
    expect(at(10)).toBe("left top row, 1st from the outside");
    expect(at(28)).toBe("left bottom row, 1st from the outside");
    expect(at(7)).toBe("right top row, 5th from the outside");
    expect(at(29)).toBe("right bottom row, 1st from the outside");
  });

  it("Iris: three thumbs along an arc, the turned key above them ends the bottom row", () => {
    const at = namesOf(boardKeys(IRIS));
    expect([52, 49, 48].map(at)).toEqual(["left inner thumb", "left middle thumb", "left outer thumb"]);
    expect([55, 50, 51].map(at)).toEqual(["right inner thumb", "right middle thumb", "right outer thumb"]);
    expect(at(53)).toBe("left half, row 4, 7th from the outside");
    expect(at(54)).toBe("right half, row 4, 7th from the outside");
    expect(at(0)).toBe("left half, row 1, 1st from the outside");
    expect(at(47)).toBe("right half, row 4, 1st from the outside");
  });

  it("Kyria: five thumbs along a fan, the two keys above them end the bottom row", () => {
    const at = namesOf(boardKeys(KYRIA));
    expect([44, 42, 40, 38, 36].map(at)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `left thumb, ${ordinal(n)} from the inside`));
    expect([46, 48, 49, 39, 37].map(at)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `right thumb, ${ordinal(n)} from the inside`));
    expect([30, 41, 43].map(at)).toEqual(
      ["left bottom row, 6th from the outside", "left bottom row, 7th from the outside",
        "left bottom row, 8th from the outside"]);
    expect([47, 45].map(at)).toEqual(
      ["right bottom row, 7th from the outside", "right bottom row, 8th from the outside"]);
    expect(at(8)).toBe("left top row, 1st from the outside");
  });
});
