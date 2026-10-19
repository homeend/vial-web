import { describe, expect, it } from "vitest";
import type { KeyGeometry } from "../api/types";
import { placeKeyboard } from "../keyboard/geometry";
import {
  drawnPositions, layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed,
} from "./matrix";

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
    const summary = testSummary(layout, layout, new Set(["1,1", "0,0", "0,5"]));
    expect(summary).toEqual({ keysTested: 1, keys: 3, strays: [{ row: 0, col: 5 }, { row: 1, col: 1 }] });
    expect(summaryText(summary)).toBe("1 of 3 keys pressed so far.");
    expect(summaryText(testSummary(layout, layout, new Set(["0,0", "0,1", "1,0"]))))
      .toBe("Every key has been pressed (3).");
    expect(summaryText({ keysTested: 0, keys: 1, strays: [] })).toBe("0 of 1 key pressed so far.");
  });

  it("counts the keys drawn, with the layout options chosen; a key of another choice is no stray", () => {
    const key = (fields: Partial<KeyGeometry>): KeyGeometry => ({
      row: 0, col: 0, encoder: null, direction: null, x: 0, y: 0, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0,
      ry: 0, layoutIndex: -1, layoutOption: -1, decal: false, ...fields,
    });
    // "Split Backspace": one 2u key at 0,1, or two 1u keys at 0,1 and 0,2; "Bottom row": a 7u space at 1,1, or a 6u
    // one at 1,2 with a key at 1,3
    const board = {
      keys: [
        key({ row: 0, col: 0 }),
        key({ x: 1, col: 1, w: 2, layoutIndex: 0, layoutOption: 0 }),
        key({ x: 1, col: 1, layoutIndex: 0, layoutOption: 1 }),
        key({ x: 2, col: 2, layoutIndex: 0, layoutOption: 1 }),
        key({ y: 1, row: 1, col: 0 }),
        key({ x: 1, y: 1, row: 1, col: 1, w: 7, layoutIndex: 1, layoutOption: 0 }),
        key({ x: 1, y: 1, row: 1, col: 2, w: 6, layoutIndex: 1, layoutOption: 1 }),
        key({ x: 7, y: 1, row: 1, col: 3, layoutIndex: 1, layoutOption: 1 }),
      ],
      encoders: [],
      layoutOptions: { value: 0, labels: ["Split Backspace", ["Bottom row", "7u", "6u"]] },
    };
    const layout = layoutPositions(board);
    expect(layout).toEqual(new Set(["0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "1,3"]));

    const unsplit = drawnPositions(placeKeyboard(board));
    expect(unsplit).toEqual(new Set(["0,0", "0,1", "1,0", "1,1"]));
    // keys of the choices not drawn count for nothing, and are no strays either
    const tested = new Set(["0,0", "0,1", "0,2", "1,3", "1,0", "1,1"]);
    expect(testSummary(unsplit, layout, tested)).toEqual({ keysTested: 4, keys: 4, strays: [] });
    expect(summaryText(testSummary(unsplit, layout, tested))).toBe("Every key has been pressed (4).");

    // split, the other bottom row: 5 keys drawn
    const split = drawnPositions(placeKeyboard({ ...board, layoutOptions: { ...board.layoutOptions, value: 0b11 } }));
    expect(split).toEqual(new Set(["0,0", "0,1", "0,2", "1,0", "1,2", "1,3"]));
    expect(testSummary(split, layout, tested)).toEqual({ keysTested: 5, keys: 6, strays: [] });
    expect(testSummary(split, layout, new Set(["0,2", "2,0"]))).toEqual({
      keysTested: 1, keys: 6, strays: [{ row: 2, col: 0 }],
    });
  });
});
