// Moving the key selection with the arrow keys.
import { boundsOf, type PlacedKey } from "../keyboard/geometry";

export type Direction = "left" | "right" | "up" | "down";

/** What moving needs of a placed key: its centre and its rectangles as drawn */
export type NavigableKey = Pick<
  PlacedKey,
  "x" | "y" | "w" | "h" | "x2" | "y2" | "w2" | "h2" | "hasSecond" | "r" | "rx" | "ry" | "cx" | "cy"
>;

/** How much being off to the side counts against a key, compared with being further away in the direction */
const OFF_AXIS_WEIGHT = 2;
/** Differences smaller than this are rounding (rotated keys), not a reason to prefer one key over another */
const EPSILON = 1e-6;

/** The index of the nearest key from keys[from] in a direction, or from if there is none. How far ahead a key is
 * goes from centre to centre; how far off to the side, from the start key's centre to the key's nearest edge (of its
 * box as drawn, rotated), so a wide key straight ahead is straight ahead. Ties go to the key less far ahead, then
 * to the first one. */
export function neighbour(keys: NavigableKey[], from: number, direction: Direction): number {
  const start = keys[from];
  if (!start) return from;
  const sideways = direction === "left" || direction === "right";
  let best = from;
  let bestScore = Infinity;
  let bestAlong = Infinity;
  keys.forEach((key, index) => {
    if (index === from) return;
    const dx = key.cx - start.cx;
    const dy = key.cy - start.cy;
    const along = { right: dx, left: -dx, down: dy, up: -dy }[direction];
    if (along < 0.25) return; // not in that direction
    const box = boundsOf(key);
    const [low, high, at] = sideways ? [box.top, box.bottom, start.cy] : [box.left, box.right, start.cx];
    const across = Math.max(low - at, at - high, 0);
    const score = along + OFF_AXIS_WEIGHT * across;
    const better = score < bestScore - EPSILON || (score < bestScore + EPSILON && along < bestAlong - EPSILON);
    if (better) {
      bestScore = score;
      bestAlong = along;
      best = index;
    }
  });
  return best;
}
