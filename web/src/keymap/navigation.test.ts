import { describe, expect, it } from "vitest";
import { neighbour } from "./navigation";

// a 3x2 grid with a gap, and a thumb key below the middle
//  0 1   2
//  3 4   5
//      6
const grid = [
  { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 4, cy: 0 },
  { cx: 0, cy: 1 }, { cx: 1, cy: 1 }, { cx: 4, cy: 1 },
  { cx: 2.5, cy: 2.2 },
];

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
});
