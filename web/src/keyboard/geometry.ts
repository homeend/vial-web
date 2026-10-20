// Where each key of a keyboard goes, in keyboard units (1 = one standard key), from the geometry the server sends.
import type { KeyGeometry, KeyboardModel, LayoutOptions } from "../api/types";

export interface PlacedKey {
  kind: "key" | "encoder";
  /** index into KeyboardModel.keys or .encoders (and so into each layer's keys or encoders) */
  index: number;
  geometry: KeyGeometry;
  /** primary rectangle, after layout options and moving the board to 0,0 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** second rectangle (ISO Enter, stepped keys), relative to x and y */
  x2: number;
  y2: number;
  w2: number;
  h2: number;
  hasSecond: boolean;
  /** rotation in degrees, clockwise, around (rx, ry) */
  r: number;
  rx: number;
  ry: number;
  /** centre of the primary rectangle as drawn (rotated) */
  cx: number;
  cy: number;
}

export interface Placement {
  items: PlacedKey[];
  width: number;
  height: number;
}

type Board = Pick<KeyboardModel, "keys" | "encoders" | "layoutOptions">;

/** How many choices a layout option has: an on/off option (a name) two, a list (its name, then its choices) as many as
 * it lists */
export function choiceCount(label: string | string[]): number {
  return typeof label === "string" ? 2 : label.length - 1;
}

/** The values each option's bits can hold: Vial pads to (count - 1).bit_length() bits but never below one, so a lone or
 * missing choice still takes one */
function optionSize(label: string | string[]): number {
  const count = choiceCount(label);
  return 2 ** (count <= 2 ? 1 : (count - 1).toString(2).length);
}

/** The chosen choice of each layout option. Vial packs them into one number, the first option in the highest bits:
 * an on/off option takes one bit, a list of choices as many bits as its highest choice needs, and at least one. */
export function layoutChoices(options: LayoutOptions | null | undefined): number[] {
  if (!options) return [];
  let value = options.value;
  const choices: number[] = [];
  for (const label of [...options.labels].reverse()) {
    const size = optionSize(label);
    choices.unshift(value % size);
    value = Math.floor(value / size);
  }
  return choices;
}

/** The layout options' value with one option's choice changed, packed as layoutChoices reads it. Bits above those of
 * the options (which nothing reads) are kept as the keyboard holds them. */
export function withLayoutChoice(options: LayoutOptions, index: number, choice: number): number {
  const choices = layoutChoices(options);
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new RangeError(`there is no layout option ${index}`);
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= choiceCount(options.labels[index])) {
    throw new RangeError(`layout option ${index} has no choice ${choice}`);
  }
  choices[index] = choice;
  let span = 1;
  let packed = 0;
  options.labels.forEach((label, i) => {
    const size = optionSize(label);
    packed = packed * size + choices[i];
    span *= size;
  });
  return Math.floor(options.value / span) * span + packed;
}

function rotate(x: number, y: number, r: number, rx: number, ry: number): [number, number] {
  if (!r) return [x, y];
  const a = (r * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = x - rx;
  const dy = y - ry;
  return [rx + dx * cos - dy * sin, ry + dx * sin + dy * cos];
}

function hasSecond(k: KeyGeometry): boolean {
  return k.w2 !== k.w || k.h2 !== k.h || k.x2 !== 0 || k.y2 !== 0;
}

/** Corners of both rectangles of a key, rotated, moved by (dx, dy) */
function corners(k: KeyGeometry, dx = 0, dy = 0): [number, number][] {
  const rects = [[k.x, k.y, k.w, k.h]];
  if (hasSecond(k)) rects.push([k.x + k.x2, k.y + k.y2, k.w2, k.h2]);
  return rects.flatMap(([x, y, w, h]) =>
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) =>
      rotate(px + dx, py + dy, k.r, k.rx + dx, k.ry + dy)));
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The smallest upright box around a placed key as drawn: both of its rectangles, rotated */
export function boundsOf(
  key: Pick<PlacedKey, "x" | "y" | "w" | "h" | "x2" | "y2" | "w2" | "h2" | "hasSecond" | "r" | "rx" | "ry">,
): Bounds {
  const rects = [[key.x, key.y, key.w, key.h]];
  if (key.hasSecond) rects.push([key.x + key.x2, key.y + key.y2, key.w2, key.h2]);
  const points = rects.flatMap(([x, y, w, h]) =>
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => rotate(px, py, key.r, key.rx, key.ry)));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function topLeft(points: [number, number][]): [number, number] {
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
}

interface Candidate {
  kind: PlacedKey["kind"];
  index: number;
  geometry: KeyGeometry;
}

/** The keys (and encoders) to draw: no decals; of keys that belong to a layout option, only the chosen choice's,
 * moved to where that option's first choice sits, as Vial does. The board starts at 0,0. */
export function placeKeyboard(board: Board): Placement {
  const all: Candidate[] = [
    ...board.keys.map((geometry, index) => ({ kind: "key" as const, index, geometry })),
    ...board.encoders.map((geometry, index) => ({ kind: "encoder" as const, index, geometry })),
  ];
  const choices = layoutChoices(board.layoutOptions);

  // top-left corner of every choice of every layout option
  const optionTopLeft = new Map<string, [number, number]>();
  for (const { geometry: g } of all) {
    if (g.layoutIndex === -1) continue;
    const id = `${g.layoutIndex},${g.layoutOption}`;
    const [x, y] = topLeft(corners(g));
    const seen = optionTopLeft.get(id);
    optionTopLeft.set(id, seen ? [Math.min(seen[0], x), Math.min(seen[1], y)] : [x, y]);
  }

  const visible = all
    .filter(({ geometry: g }) => !g.decal)
    .filter(({ geometry: g }) => g.layoutIndex === -1 || g.layoutOption === (choices[g.layoutIndex] ?? 0))
    .map((candidate) => {
      const g = candidate.geometry;
      let dx = 0;
      let dy = 0;
      if (g.layoutIndex !== -1) {
        const own = optionTopLeft.get(`${g.layoutIndex},${g.layoutOption}`);
        const first = optionTopLeft.get(`${g.layoutIndex},0`) ?? own;
        if (own && first) {
          dx = first[0] - own[0];
          dy = first[1] - own[1];
        }
      }
      return { ...candidate, dx, dy };
    });
  if (visible.length === 0) return { items: [], width: 0, height: 0 };

  const points = visible.flatMap(({ geometry, dx, dy }) => corners(geometry, dx, dy));
  const [minX, minY] = topLeft(points);
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));

  const items = visible.map(({ kind, index, geometry: g, dx, dy }) => {
    const x = g.x + dx - minX;
    const y = g.y + dy - minY;
    const rx = g.rx + dx - minX;
    const ry = g.ry + dy - minY;
    const [cx, cy] = rotate(x + g.w / 2, y + g.h / 2, g.r, rx, ry);
    return {
      kind, index, geometry: g, x, y, w: g.w, h: g.h,
      x2: g.x2, y2: g.y2, w2: g.w2, h2: g.h2, hasSecond: hasSecond(g),
      r: g.r, rx, ry, cx, cy,
    };
  });
  return { items, width: maxX - minX, height: maxY - minY };
}

export interface Knob {
  encoder: number;
  /** centre, in key units */
  cx: number;
  cy: number;
  /** a pill from one direction's key to the other's, turned by angle degrees */
  length: number;
  thickness: number;
  angle: number;
}

/** The knob behind each encoder: a pill joining its counter-clockwise and clockwise keys */
export function encoderKnobs(placement: Placement): Knob[] {
  const byEncoder = new Map<number, PlacedKey[]>();
  for (const item of placement.items) {
    if (item.kind !== "encoder") continue;
    const id = item.geometry.encoder ?? 0;
    byEncoder.set(id, [...(byEncoder.get(id) ?? []), item]);
  }
  return [...byEncoder.entries()].map(([encoder, items]) => {
    const [a, b] = [...items].sort((p, q) => (p.geometry.direction ?? 0) - (q.geometry.direction ?? 0));
    const thickness = Math.min(a.w, a.h);
    if (!b) return { encoder, cx: a.cx, cy: a.cy, length: thickness, thickness, angle: 0 };
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    return {
      encoder,
      cx: (a.cx + b.cx) / 2,
      cy: (a.cy + b.cy) / 2,
      length: Math.hypot(dx, dy) + thickness,
      thickness,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  });
}
