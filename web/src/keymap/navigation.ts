// Moving the key selection with the arrow keys.

export type Direction = "left" | "right" | "up" | "down";

interface Centre {
  cx: number;
  cy: number;
}

/** How much being off to the side counts against a key, compared with being further away in the direction */
const OFF_AXIS_WEIGHT = 2;

/** The index of the nearest key from keys[from] in a direction (by key centres), or from if there is none */
export function neighbour(keys: Centre[], from: number, direction: Direction): number {
  const start = keys[from];
  if (!start) return from;
  let best = from;
  let bestScore = Infinity;
  keys.forEach((key, index) => {
    if (index === from) return;
    const dx = key.cx - start.cx;
    const dy = key.cy - start.cy;
    const along = { right: dx, left: -dx, down: dy, up: -dy }[direction];
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along < 0.25) return; // not in that direction
    const score = along + OFF_AXIS_WEIGHT * across;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
