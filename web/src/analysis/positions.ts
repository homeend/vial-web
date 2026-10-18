// Where a key sits on the keyboard, in words ("left inner thumb", "right top row, 2nd from the outside"), worked out
// from the geometry alone: for keys whose label says nothing about them (MO 2, OSL 3).
import { boundsOf, type PlacedKey, type Placement } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";

/** a gap between the keys at least this wide (in key units) splits the keyboard into two halves: a Sofle's or a
 * Moonlander's halves are half a key apart, the gaps in a TKL or a Quefrency a quarter (between the two) */
const SPLIT_GAP = 0.45;
/** each half has at least this share of the keys */
const SPLIT_SHARE = 0.25;
/** a key whose centre is more than this far (in key units) below the first key of a row starts the next row; also
 * how much lower other low keys must be than a bottom finger row to be the thumbs (see thumbsOf) */
const ROW_SPAN = 0.8;
/** keys whose centres are at most this far apart across (in key units) stand in one column (rows staggered by a
 * quarter of a key don't) */
const COLUMN_SLACK = 0.1;
/** a half's keys stand in columns (column stagger) when at least this share of them is in columns of two or more */
const COLUMNS_SHARE = 0.6;
/** a thumb key's lower edge is more than this far (in key units) below that of the lowest key of its half's outermost
 * column: less than half a key, as a Kyria's outer thumbs are exactly half a key lower. Lower edges, not centres: a
 * Moonlander's tall thumb keys reach up beside the bottom row, so their centres are only 0.375 lower than its. */
const THUMB_DROP = 0.4;
/** and the thumbs stay at least this far (in key units) in from the outer edge of that column: a low row that comes
 * nearer (a row of modifiers on a row-staggered keyboard, or the bottom row of an Ergodox-like half without its
 * thumb cluster, half a key in under the wide outer keys) is no thumbs; real thumbs start a key or more in. A safety
 * net: no real board in the sample needs it, only made-up ones (a split 65%, an Ergodox without thumb keys). */
const THUMB_INSET = 0.75;
/** a key whose centre is less than this far across (in key units) from a column stands under it: a key under the
 * wide outer keys of an Ergodox is a quarter off, one between two columns (Kyria, Lily58) half (between the two) */
const UNDER_SLACK = 0.375;
/** a key at most this far (in key units) below the last key of a column is the next one down; the thumb cluster of
 * a Dactyl Manuform is two keys below */
const ROW_STEP = 1.25;
/** keys whose centres are less than this far apart up and down (in key units), as one of them is turned, are level */
const ROW_LEVEL = 0.25;
/** and less than this far apart across are next to each other in a row (the Iris's turned key is 1.5 from its row,
 * the next key but one is 2) */
const ROW_REACH = 1.8;
/** a key is right under another, as that one is turned, when its centre is less than this far across from the other's
 * (in key units) */
const UNDER_ACROSS = 0.5;
/** and more than this far down */
const UNDER_DOWN = 0.5;
/** keys less than this far apart (in key units) touch */
const TOUCH = 0.05;

export type Side = "left" | "right";

/** The vertical line between the halves of a split keyboard (in key units), or null for a keyboard in one piece: the
 * widest gap of at least SPLIT_GAP across which no key reaches, with at least a quarter of the keys on each side.
 * The gap is measured between upright keys only, since thumb keys turned towards the middle reach into it (Ferris
 * Sweep, Kyria), unless most keys are turned (an Alice, in one piece); every key counts, by its centre, for the side
 * it is on. */
export function splitLine(keys: PlacedKey[]): number | null {
  const upright = keys.filter((k) => !k.r);
  const spans = (upright.length * 2 >= keys.length ? upright : keys)
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
 * most keys stand in columns (column stagger), the rows are counted down the longest columns, however far a column
 * is staggered (a Ferris Sweep's pinky column), and every other key joins the row it is nearest in the nearest of
 * those: shorter columns (an Ergodox's outer one), keys at the end of a row (Iris, Kyria). Otherwise as rowsOf. */
export function rowsOfHalf(keys: PlacedKey[]): PlacedKey[][] {
  const columns = columnsOf(keys).filter((c) => c.length >= 2);
  const height = Math.max(0, ...columns.map((c) => c.length));
  const full = columns.filter((c) => c.length === height);
  if (height < 2 || columns.flat().length < COLUMNS_SHARE * keys.length) return rowsOf(keys);
  const rows: PlacedKey[][] = Array.from({ length: height }, () => []);
  for (const key of keys) {
    const column = full[smallest(full.map((c) => Math.abs(c[0].cx - key.cx)))];
    rows[smallest(column.map((k) => Math.abs(k.cy - key.cy)))].push(key);
  }
  return rows.map((row) => row.sort((a, b) => a.cx - b.cx));
}

/** Where `other` is as seen from `key`, turned with it: [across, down] */
function seenFrom(key: PlacedKey, other: PlacedKey): [number, number] {
  const a = (-key.r * Math.PI) / 180;
  const dx = other.cx - key.cx;
  const dy = other.cy - key.cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Whether `below` sits right under `key` as `key` is turned */
function isUnder(key: PlacedKey, below: PlacedKey): boolean {
  const [across, down] = seenFrom(key, below);
  return Math.abs(across) < UNDER_ACROSS && down > UNDER_DOWN;
}

/** Whether `other` sits next to `key` in a row, as `key` is turned */
function isBeside(key: PlacedKey, other: PlacedKey): boolean {
  const [across, down] = seenFrom(key, other);
  return Math.abs(down) < ROW_LEVEL && Math.abs(across) < ROW_REACH;
}

/** Whether two upright keys touch, at a side or a corner */
function isAgainst(key: PlacedKey, other: PlacedKey): boolean {
  if (key.r || other.r) return false;
  const a = boundsOf(key);
  const b = boundsOf(other);
  return Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom) < TOUCH;
}

/** The thumb keys of one half of a split keyboard: those well below its outermost column (of at least two keys, so a
 * lone key out there doesn't count), but
 * - not a bottom finger row: keys right under the finger columns, the next one down, when other low keys are a row
 *   lower still (Ergodox, Redox, Dactyl Manuform). On a Corne or a Sofle nothing is that much lower: those keys are
 *   the thumbs;
 * - not a key with another low key right under it that lines up with a finger key, as it is turned (Iris, Kyria), or
 *   rests against one, upright (Elora), or does either with another such key: it ends a row above the thumbs. The
 *   upper keys of a thumb cluster do neither (Ergodox, Redox, Dactyl Manuform).
 * None if one of them comes within THUMB_INSET of the outer edge of that column. */
function thumbsOf(half: PlacedKey[], side: Side): PlacedKey[] {
  const columns = columnsOf(half).filter((c) => c.length >= 2);
  const outer = side === "left" ? columns[0] : columns.at(-1);
  if (!outer) return [];
  const bottom = Math.max(...outer.map((k) => boundsOf(k).bottom));
  // where a key's outer side is, counted inwards (rightwards on the left half, leftwards on the right)
  const inward = (k: PlacedKey) => (side === "left" ? boundsOf(k).left : -boundsOf(k).right);
  const edge = Math.min(...outer.map(inward));
  const low = half.filter((k) => boundsOf(k).bottom - bottom > THUMB_DROP);

  const fingerColumns = columnsOf(half.filter((k) => !low.includes(k))).filter((c) => c.length >= 2);
  const nextDown = (k: PlacedKey) => fingerColumns.some((c) => {
    const step = k.cy - c[c.length - 1].cy;
    return Math.abs(c[0].cx - k.cx) < UNDER_SLACK && step > 0 && step <= ROW_STEP;
  });
  const fingerRow = low.filter(nextDown);
  const others = low.filter((k) => !fingerRow.includes(k));
  const lowest = (keys: PlacedKey[]) => Math.max(...keys.map((k) => k.cy));
  // the others are a row lower still: further below the finger row than one row spans (ROW_SPAN, as in rowsOf)
  const lowerStill = fingerRow.length > 0 && others.length > 0 && lowest(others) - lowest(fingerRow) > ROW_SPAN;
  const thumbs = [...(lowerStill ? others : low)]; // a copy: the loop below takes keys out of it

  const fingers = half.filter((k) => !thumbs.includes(k));
  const endsRow = (k: PlacedKey) => thumbs.some((other) => other !== k && isUnder(k, other)) &&
    fingers.some((f) => isBeside(k, f) || isAgainst(k, f));
  for (let rowEnd = thumbs.find(endsRow); rowEnd; rowEnd = thumbs.find(endsRow)) {
    thumbs.splice(thumbs.indexOf(rowEnd), 1);
    fingers.push(rowEnd);
  }
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
