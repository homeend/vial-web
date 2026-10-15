import { describe, expect, it } from "vitest";
import { neighbour, type NavigableKey } from "./navigation";

/** A key of w x h units centred on (cx, cy), turned r degrees around its centre */
function at(cx: number, cy: number, w = 1, h = 1, r = 0): NavigableKey {
  return { x: cx - w / 2, y: cy - h / 2, w, h, x2: 0, y2: 0, w2: w, h2: h, hasSecond: false, r, rx: cx, ry: cy, cx, cy };
}

/** A key from its top-left corner, as keyboard layouts give them */
function from(x: number, y: number, w = 1, h = 1): NavigableKey {
  return at(x + w / 2, y + h / 2, w, h);
}

// a 3x2 grid with a gap, and a thumb key below the middle
//  0 1   2
//  3 4   5
//      6
const grid = [at(0, 0), at(1, 0), at(4, 0), at(0, 1), at(1, 1), at(4, 1), at(2.5, 2.2)];

describe("neighbour", () => {
  it("moves along a row, across gaps", () => {
    expect(neighbour(grid, 0, "right")).toBe(1);
    expect(neighbour(grid, 1, "right")).toBe(2);
    expect(neighbour(grid, 2, "left")).toBe(1);
  });

  it("moves along a column", () => {
    expect(neighbour(grid, 0, "down")).toBe(3);
    expect(neighbour(grid, 4, "up")).toBe(1);
  });

  it("goes to the nearest key in that direction, even if a little off to the side", () => {
    expect(neighbour(grid, 4, "down")).toBe(6);
    expect(neighbour(grid, 6, "up")).toBe(4);
  });

  it("stays put at the edge", () => {
    expect(neighbour(grid, 0, "left")).toBe(0);
    expect(neighbour(grid, 2, "up")).toBe(2);
  });

  it("stays put without keys", () => {
    expect(neighbour([], 0, "left")).toBe(0);
  });

  it("measures how far off to the side a wide key is to its edge, not its centre", () => {
    // the bottom of an ANSI board: Shift Z X C V B N above Ctrl Gui Alt Space Alt
    const ansi = [
      from(0, 0, 2.25), from(2.25, 0), from(3.25, 0), from(4.25, 0), from(5.25, 0), from(6.25, 0), from(7.25, 0),
      from(0, 1, 1.25), from(1.25, 1, 1.25), from(2.5, 1, 1.25), from(3.75, 1, 6.25), from(10, 1, 1.25),
    ];
    const [c, v, b, alt, space] = [3, 4, 5, 9, 10];
    expect(neighbour(ansi, c, "down")).toBe(space);
    expect(neighbour(ansi, v, "down")).toBe(space);
    expect(neighbour(ansi, space, "up")).toBe(b);
    expect(neighbour(ansi, 1, "down")).toBe(alt); // Z
  });

  it("uses the extent of a rotated key as drawn", () => {
    // a 1x2 thumb key turned 45 degrees reaches under the start key, though its centre is further off than the
    // other key's; unturned, it would not
    const keys = [at(0.5, 0.5), at(-0.7, 1.7), at(1.8, 2.2, 1, 2, 45)];
    expect(neighbour(keys, 0, "down")).toBe(2);
    expect(neighbour([keys[0], keys[1], at(1.8, 2.2, 1, 2)], 0, "down")).toBe(1);
  });

  it("breaks a tie on a staggered board by key order", () => {
    // the next row is staggered by half a key: the key above sits exactly between two
    const staggered = [at(0.5, 0), at(1.5, 0), at(1, 1), at(2, 1)];
    expect(neighbour(staggered, 1, "down")).toBe(2);
    expect(neighbour([at(0.5, 0), at(1.5, 0), at(2, 1), at(1, 1)], 1, "down")).toBe(2);
  });

  it("breaks a tie by the smaller distance in that direction first", () => {
    // straight below but two rows down, or one row down and a little off to the side: as good as each other
    const keys = [at(0.5, 0), at(0.5, 2), from(1, 0.5)];
    expect(neighbour(keys, 0, "down")).toBe(2);
  });

  it("treats keys with nearly the same centre as level, and takes the first", () => {
    const keys = [at(0, 0), at(5, 0), at(5 - 1e-12, 1e-12)];
    expect(neighbour(keys, 0, "right")).toBe(1);
    expect(neighbour([at(0, 0), at(5 - 1e-12, 0), at(5, 0)], 0, "right")).toBe(1);
  });
});
