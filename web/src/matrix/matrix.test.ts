import { describe, expect, it } from "vitest";
import { layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed } from "./matrix";

const keys = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: null, col: null }];

describe("the matrix tester", () => {
  it("knows where the layout has keys", () => {
    expect(layoutPositions({ keys } as never)).toEqual(new Set(["0,0", "0,1", "1,0"]));
    expect(positionId({ row: 3, col: 12 })).toBe("3,12");
  });

  it("adds what is held to what was pressed, the same set when nothing is new", () => {
    const none = new Set<string>();
    const one = withPressed(none, [{ row: 0, col: 1 }]);
    expect([...one]).toEqual(["0,1"]);
    expect(withPressed(one, [{ row: 0, col: 1 }])).toBe(one);
    expect([...withPressed(one, [{ row: 1, col: 1 }])]).toEqual(["0,1", "1,1"]);
  });

  it("lays out every position, held, pressed before or not yet, with or without a key", () => {
    const layout = layoutPositions({ keys } as never);
    const cells = matrixCells(2, 2, layout, new Set(["0,0"]), new Set(["0,0", "1,1"]));
    expect(cells.map((r) => r.map((c) => `${c.state}${c.inLayout ? "" : " (no key)"}`))).toEqual([
      ["held", "untested"],
      ["untested", "tested (no key)"],
    ]);
  });

  it("counts the keys pressed, and the positions without a key that were", () => {
    const layout = layoutPositions({ keys } as never);
    const summary = testSummary(layout, new Set(["1,1", "0,0", "0,5"]));
    expect(summary).toEqual({ keysTested: 1, keys: 3, strays: [{ row: 0, col: 5 }, { row: 1, col: 1 }] });
    expect(summaryText(summary)).toBe("1 of 3 keys pressed so far.");
    expect(summaryText(testSummary(layout, new Set(["0,0", "0,1", "1,0"])))).toBe("Every key has been pressed (3).");
    expect(summaryText({ keysTested: 0, keys: 1, strays: [] })).toBe("0 of 1 key pressed so far.");
  });
});
