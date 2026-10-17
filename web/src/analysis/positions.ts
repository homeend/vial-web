// Where a key sits on the keyboard, in words ("left inner thumb", "right top row, 2nd from the outside"), worked out
// from the geometry alone: for keys whose label says nothing about them (MO 2, OSL 3).
import { boundsOf, type PlacedKey, type Placement } from "../keyboard/geometry";
import { refId } from "../keyboard/refs";

/** a gap between the keys at least this wide (in key units) splits the keyboard into two halves */
const SPLIT_GAP = 0.75;
/** each half has at least this share of the keys */
const SPLIT_SHARE = 0.25;
/** a key whose centre is this far (in key units) below the first key of a row starts the next row */
const ROW_SPAN = 0.8;

export type Side = "left" | "right";

/** The vertical line between the halves of a split keyboard (in key units), or null for a keyboard in one piece: the
 * widest gap of at least SPLIT_GAP across which no key reaches, with at least a quarter of the keys on each side */
export function splitLine(keys: PlacedKey[]): number | null {
  const spans = keys.map((k) => boundsOf(k)).map((b) => [b.left, b.right]).sort((a, b) => a[0] - b[0]);
  let best: { width: number; at: number } | null = null;
  let reach = -Infinity;
  for (const [left, right] of spans) {
    if (reach > -Infinity && left - reach >= SPLIT_GAP && (!best || left - reach > best.width)) {
      best = { width: left - reach, at: (left + reach) / 2 };
    }
    reach = Math.max(reach, right);
  }
  if (!best) return null;
  const at = best.at;
  const leftCount = keys.filter((k) => k.cx < at).length;
  const share = Math.min(leftCount, keys.length - leftCount) / keys.length;
  return share >= SPLIT_SHARE ? at : null;
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

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const THUMB_WORDS: Record<number, string[]> = { 2: ["inner", "outer"], 3: ["inner", "middle", "outer"] };

/** "left inner thumb" for a cluster of 2 or 3 thumb keys, "left thumb" for one, "left thumb 4" (from the inside) for
 * more */
function thumbName(side: Side, position: number, count: number): string {
  if (count === 1) return `${side} thumb`;
  const words = THUMB_WORDS[count];
  return words ? `${side} ${words[position]} thumb` : `${side} thumb ${position + 1}`;
}

/** "top", "home", "bottom" for three rows of a split keyboard ("middle" on one in a piece), "top"/"bottom" for two,
 * else null (the rows are numbered) */
function rowWord(row: number, count: number, split: boolean): string | null {
  if (count === 2) return ["top", "bottom"][row];
  if (count === 3) return ["top", split ? "home" : "middle", "bottom"][row];
  return null;
}

function encoderName(item: PlacedKey): string {
  const direction = item.geometry.direction === 1 ? "clockwise" : "counter-clockwise";
  return `encoder ${item.geometry.encoder ?? 0}, ${direction}`;
}

/** Every placed key's position in words, by refId. On a split keyboard: "left inner thumb" (the bottom row of a half,
 * when it has fewer keys than its other rows), "right top row, 2nd from the outside", "left half, row 4, 1st from the
 * outside" (more than three rows). In one piece: "bottom row, 3rd from the left", "row 4, 1st from the left".
 * Encoders: "encoder 0, clockwise". */
export function positionNames(placement: Placement): Map<string, string> {
  const names = new Map<string, string>();
  const keys = placement.items.filter((i) => i.kind === "key");
  for (const item of placement.items) if (item.kind === "encoder") names.set(refId(item), encoderName(item));
  if (keys.length === 0) return names;

  const split = splitLine(keys);
  const halves: { side: Side | null; keys: PlacedKey[] }[] = split === null
    ? [{ side: null, keys }]
    : [
        { side: "left", keys: keys.filter((k) => k.cx < split) },
        { side: "right", keys: keys.filter((k) => k.cx >= split) },
      ];

  for (const { side, keys: half } of halves) {
    const rows = rowsOf(half);
    const widest = Math.max(...rows.map((r) => r.length));
    const last = rows.at(-1)!;
    const hasThumbs = side !== null && rows.length >= 2 && last.length < widest;
    const plain = hasThumbs ? rows.slice(0, -1) : rows;
    plain.forEach((row, r) => {
      // from the outside on a split keyboard: the left half from the left, the right half from the right
      const ordered = side === "right" ? [...row].reverse() : row;
      const word = rowWord(r, plain.length, side !== null);
      const along = side ? "from the outside" : "from the left";
      const where = side
        ? word ? `${side} ${word} row` : `${side} half, row ${r + 1}`
        : word ? `${word} row` : `row ${r + 1}`;
      ordered.forEach((key, i) => names.set(refId(key), `${where}, ${ordinal(i + 1)} ${along}`));
    });
    if (hasThumbs && side !== null && split !== null) {
      // from the inside (nearest the middle of the keyboard) out
      const thumbs = [...last].sort((a, b) => Math.abs(a.cx - split) - Math.abs(b.cx - split));
      thumbs.forEach((key, i) => names.set(refId(key), thumbName(side, i, thumbs.length)));
    }
  }
  return names;
}
