// Where a key sits on the keyboard, in words ("left inner thumb", "right top row, 2nd from the outside"), worked out
// from the geometry alone: for keys whose label says nothing about them (MO 2, OSL 3).
import { boundsOf, type PlacedKey, type Placement } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";

/** a gap between the keys at least this wide (in key units) splits the keyboard into two halves */
const SPLIT_GAP = 0.75;
/** each half has at least this share of the keys */
const SPLIT_SHARE = 0.25;
/** a key whose centre is more than this far (in key units) below the first key of a row starts the next row */
const ROW_SPAN = 0.8;
/** keys whose centres are at most this far apart across (in key units) stand in one column (rows staggered by a
 * quarter of a key don't) */
const COLUMN_SLACK = 0.1;
/** keys stand in columns (a column-staggered keyboard) when at least this share of them is in the longest columns */
const COLUMNS_SHARE = 0.6;
/** a thumb key's centre is more than this far (in key units) below the lowest key of its half's outermost column */
const THUMB_DROP = 0.4;
/** and none of the thumbs comes nearer than this (in key units) to the outer edge of that column: a bottom row that
 * does is a row of modifiers on a row-staggered keyboard */
const THUMB_INSET = 0.5;

export type Side = "left" | "right";

/** The vertical line between the halves of a split keyboard (in key units), or null for a keyboard in one piece: the
 * widest gap of at least SPLIT_GAP across which no key reaches, with at least a quarter of the keys on each side.
 * The gap is measured between upright keys only, since thumb keys turned towards the middle reach into it (Ferris
 * Sweep, Kyria); every key counts, by its centre, for the side it is on. A Sofle stays in one piece: the push keys of
 * its encoders sit in the middle. */
export function splitLine(keys: PlacedKey[]): number | null {
  const upright = keys.filter((k) => !k.r);
  const spans = (upright.length > 0 ? upright : keys)
    .map((k) => boundsOf(k))
    .map((b) => [b.left, b.right])
    .sort((a, b) => a[0] - b[0]);
  let best: { width: number; at: number } | null = null;
  let reach = -Infinity;
  for (const [left, right] of spans) {
    const width = left - reach;
    if (reach > -Infinity && width >= SPLIT_GAP && (!best || width > best.width)) {
      const at = (left + reach) / 2;
      const leftCount = keys.filter((k) => k.cx < at).length;
      if (Math.min(leftCount, keys.length - leftCount) / keys.length >= SPLIT_SHARE) best = { width, at };
    }
    reach = Math.max(reach, right);
  }
  return best ? best.at : null;
}

/** Columns of keys from the left, each from the top: a key more than COLUMN_SLACK right of the first key of a column
 * starts the next one */
function columnsOf(keys: PlacedKey[]): PlacedKey[][] {
  const columns: PlacedKey[][] = [];
  for (const key of [...keys].sort((a, b) => a.cx - b.cx || a.cy - b.cy)) {
    const column = columns.at(-1);
    if (column && key.cx - column[0].cx <= COLUMN_SLACK) column.push(key);
    else columns.push([key]);
  }
  return columns.map((column) => column.sort((a, b) => a.cy - b.cy));
}

/** Index of the smallest of the values (the last of equal ones) */
function smallest(values: number[]): number {
  return values.reduce((best, value, i) => (value <= values[best] ? i : best), 0);
}

/** Rows of keys from the top, each from left to right: a key more than ROW_SPAN below the first key of a row starts
 * the next one (so columns staggered by up to that much stay in one row) */
export function rowsOf(keys: PlacedKey[]): PlacedKey[][] {
  const rows: PlacedKey[][] = [];
  for (const key of [...keys].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const row = rows.at(-1);
    if (row && key.cy - row[0].cy <= ROW_SPAN) row.push(key);
    else rows.push([key]);
  }
  return rows.map((row) => row.sort((a, b) => a.cx - b.cx));
}

/** Rows of the keys of one half of a split keyboard, its thumbs left out, from the top, each from left to right. When
 * most keys stand in columns of the same length (column stagger), the rows are counted down those columns, however
 * far a column is staggered (a Ferris Sweep's pinky column), and any other key joins the row it is nearest in the
 * nearest of those columns: with the thumbs gone, such keys end a row (Iris, Kyria). Otherwise as rowsOf. */
export function rowsOfHalf(keys: PlacedKey[]): PlacedKey[][] {
  const columns = columnsOf(keys);
  const height = Math.max(0, ...columns.map((c) => c.length));
  const full = columns.filter((c) => c.length === height);
  if (height < 2 || full.length * height < COLUMNS_SHARE * keys.length) return rowsOf(keys);
  const rows: PlacedKey[][] = Array.from({ length: height }, () => []);
  for (const key of keys) {
    const column = full[smallest(full.map((c) => Math.abs(c[0].cx - key.cx)))];
    rows[smallest(column.map((k) => Math.abs(k.cy - key.cy)))].push(key);
  }
  return rows.map((row) => row.sort((a, b) => a.cx - b.cx));
}

/** Whether `below` sits right under `key` as `key` is turned */
function isUnder(key: PlacedKey, below: PlacedKey): boolean {
  const a = (-key.r * Math.PI) / 180;
  const dx = below.cx - key.cx;
  const dy = below.cy - key.cy;
  return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) < 0.5 && dx * Math.sin(a) + dy * Math.cos(a) > 0.5;
}

/** The thumb keys of one half of a split keyboard: those well below its outermost column (of at least two keys, so a
 * lone key out there doesn't count), but not a key with another one of them right under it as it is turned (that
 * ends a row above the thumbs: Iris, Kyria). None if one of them reaches the outer edge of that column. */
function thumbsOf(half: PlacedKey[], side: Side): PlacedKey[] {
  const columns = columnsOf(half).filter((c) => c.length >= 2);
  const outer = side === "left" ? columns[0] : columns.at(-1);
  if (!outer) return [];
  const bottom = Math.max(...outer.map((k) => k.cy));
  // where a key's outer side is, counted inwards (rightwards on the left half, leftwards on the right)
  const inward = (k: PlacedKey) => (side === "left" ? boundsOf(k).left : -boundsOf(k).right);
  const edge = Math.min(...outer.map(inward));
  const low = half.filter((k) => k.cy - bottom > THUMB_DROP);
  const thumbs = low.filter((k) => !low.some((other) => other !== k && other.r === k.r && isUnder(k, other)));
  return thumbs.some((k) => inward(k) - edge < THUMB_INSET) ? [] : thumbs;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const THUMB_WORDS: Record<number, string[]> = { 2: ["inner", "outer"], 3: ["inner", "middle", "outer"] };

/** "left inner thumb" for a cluster of 2 or 3 thumb keys, "left thumb" for one, "left thumb, 4th from the inside"
 * for more */
function thumbName(side: Side, position: number, count: number): string {
  if (count === 1) return `${side} thumb`;
  const words = THUMB_WORDS[count];
  return words ? `${side} ${words[position]} thumb` : `${side} thumb, ${ordinal(position + 1)} from the inside`;
}

/** "top", "home", "bottom" for three rows of a split keyboard ("middle" on one in a piece), "top"/"bottom" for two,
 * else null (the rows are numbered) */
function rowWord(row: number, count: number, split: boolean): string | null {
  if (count === 2) return ["top", "bottom"][row];
  if (count === 3) return ["top", split ? "home" : "middle", "bottom"][row];
  return null;
}

/** Where a row is: "left top row", "left half, row 4", "left half" (the only row); "top row", "row 4", null */
function rowPlace(side: Side | null, row: number, count: number): string | null {
  const word = rowWord(row, count, side !== null);
  if (side) return count === 1 ? `${side} half` : word ? `${side} ${word} row` : `${side} half, row ${row + 1}`;
  return count === 1 ? null : word ? `${word} row` : `row ${row + 1}`;
}

function encoderName(item: PlacedKey): string {
  const direction = item.geometry.direction === 1 ? "clockwise" : "counter-clockwise";
  return `encoder ${item.geometry.encoder ?? 0}, ${direction}`;
}

/** Every placed key's position in words, by refId. On a split keyboard: "left inner thumb" (keys well below the
 * outermost column of a half, see thumbsOf), "right top row, 2nd from the outside", "left half, row 4, 1st from the
 * outside" (more than three rows), "left half, 2nd from the outside" (one row). In one piece: "bottom row, 3rd from
 * the left", "row 4, 1st from the left", "2nd from the left" (one row). Encoders: "encoder 0, clockwise". */
export function positionNames(placement: Placement): Map<string, string> {
  const names = new Map<string, string>();
  const keys = placement.items.filter((i) => i.kind === "key");
  for (const item of placement.items) if (item.kind === "encoder") names.set(refId(item), encoderName(item));
  if (keys.length === 0) return names;

  const split = splitLine(keys);
  const halves: [Side | null, PlacedKey[]][] = split === null
    ? [[null, keys]]
    : [["left", keys.filter((k) => k.cx < split)], ["right", keys.filter((k) => k.cx >= split)]];

  for (const [side, half] of halves) {
    const thumbs = side ? thumbsOf(half, side) : [];
    const rest = half.filter((k) => !thumbs.includes(k));
    const rows = side ? rowsOfHalf(rest) : rowsOf(rest);
    rows.forEach((row, r) => {
      // from the outside on a split keyboard: the left half from the left, the right half from the right
      const ordered = side === "right" ? [...row].reverse() : row;
      const place = rowPlace(side, r, rows.length);
      const along = side ? "from the outside" : "from the left";
      ordered.forEach((key, i) => names.set(refId(key), `${place ? `${place}, ` : ""}${ordinal(i + 1)} ${along}`));
    });
    if (side) {
      // from the inside (nearest the middle of the keyboard) out
      const inside = [...thumbs].sort((a, b) => (side === "left" ? b.cx - a.cx : a.cx - b.cx));
      inside.forEach((key, i) => names.set(refId(key), thumbName(side, i, inside.length)));
    }
  }
  return names;
}
