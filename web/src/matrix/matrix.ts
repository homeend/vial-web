// The matrix tester's picture of the keyboard: which matrix positions are held now, which were held since the test
// started (or was reset), and which have no key in the keyboard's layout.
import type { KeyboardModel, MatrixPosition } from "../api/types";
import type { Placement } from "../keyboard/geometry";

/** "2,3": a matrix position as one string */
export function positionId(p: MatrixPosition): string {
  return `${p.row},${p.col}`;
}

/** The positions the keyboard's layout has keys at, every layout option's included: a position pressed that isn't one
 * of them has no key in the layout */
export function layoutPositions(model: Pick<KeyboardModel, "keys">): Set<string> {
  return new Set(model.keys.filter((k) => k.row != null && k.col != null)
    .map((k) => positionId({ row: k.row as number, col: k.col as number })));
}

/** The positions of the keys drawn, with the layout options chosen: the keys the test counts */
export function drawnPositions(placement: Pick<Placement, "items">): Set<string> {
  return new Set(placement.items.filter((item) => item.kind === "key" && item.geometry.row != null
    && item.geometry.col != null)
    .map((item) => positionId({ row: item.geometry.row as number, col: item.geometry.col as number })));
}

/** The positions pressed so far, with those held now added; the same set when nothing is new */
export function withPressed(tested: ReadonlySet<string>, pressed: MatrixPosition[]): ReadonlySet<string> {
  const ids = pressed.map(positionId);
  if (ids.every((id) => tested.has(id))) return tested;
  return new Set([...tested, ...ids]);
}

export type CellState = "held" | "tested" | "untested";

export interface MatrixCell {
  row: number;
  col: number;
  /** a key of the layout is at this position */
  inLayout: boolean;
  state: CellState;
}

/** Every position of the matrix, row by row */
export function matrixCells(rows: number, cols: number, layout: ReadonlySet<string>, held: ReadonlySet<string>,
  tested: ReadonlySet<string>): MatrixCell[][] {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
    const id = positionId({ row, col });
    const state: CellState = held.has(id) ? "held" : tested.has(id) ? "tested" : "untested";
    return { row, col, inLayout: layout.has(id), state };
  }));
}

export interface TestSummary {
  /** keys drawn (the layout options chosen) pressed so far, and how many are drawn */
  keysTested: number;
  keys: number;
  /** positions with no key in the layout, whatever the options, that were pressed: a key there isn't in the layout, or
   * the matrix has a fault */
  strays: MatrixPosition[];
}

/** drawn: the positions of the keys drawn (drawnPositions); layout: those of every layout option (layoutPositions) */
export function testSummary(drawn: ReadonlySet<string>, layout: ReadonlySet<string>,
  tested: ReadonlySet<string>): TestSummary {
  const strays = [...tested].filter((id) => !layout.has(id)).map((id) => {
    const [row, col] = id.split(",").map(Number);
    return { row, col };
  }).sort((a, b) => a.row - b.row || a.col - b.col);
  return { keysTested: [...tested].filter((id) => drawn.has(id)).length, keys: drawn.size, strays };
}

/** "12 of 42 keys pressed so far", "Every key has been pressed (42)." */
export function summaryText(summary: TestSummary): string {
  const { keysTested, keys } = summary;
  if (keys > 0 && keysTested === keys) return `Every key has been pressed (${keys}).`;
  return `${keysTested} of ${keys} ${keys === 1 ? "key" : "keys"} pressed so far.`;
}
