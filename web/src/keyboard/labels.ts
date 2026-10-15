// What a key shows: on the key itself (keyFace) and in words in the Inspector (actionSummary, keyTitle).
import type { Described, KeyKind, KeyboardModel } from "../api/types";

/** The colour family of a key */
export type Tone = "normal" | "mod" | "layer" | "tap-dance" | "macro" | "transparent" | "none";

export interface KeyFace {
  /** big label: the tap action */
  main: string;
  /** small, above it: the character typed with Shift */
  shifted: string | null;
  /** small, top right: the character typed with AltGr in the chosen keyboard language */
  altGr: string | null;
  /** small, below: the hold action, or what a layer, tap dance or macro key refers to */
  hold: string | null;
  tone: Tone;
}

/** Names of the layers, tap dances and macros keys refer to */
export interface Names {
  layer(index: number): string;
  /** whether the user named the layer (unnamed layers are called "Layer N" anyway) */
  layerIsNamed(index: number): boolean;
  /** "" when it has no name */
  tapDance(index: number): string;
  macro(index: number): string;
}

const TONES: Partial<Record<KeyKind, Tone>> = {
  "mod-tap": "mod",
  modifier: "mod",
  "one-shot-mod": "mod",
  layer: "layer",
  "layer-tap": "layer",
  "tap-dance": "tap-dance",
  macro: "macro",
  transparent: "transparent",
  none: "none",
};

export function toneOf(kind: KeyKind): Tone {
  return TONES[kind] ?? "normal";
}

export function namesOf(model: KeyboardModel): Names {
  return {
    layer: (i) => model.layers[i]?.name ?? `Layer ${i}`,
    layerIsNamed: (i) => model.layers[i]?.customName ?? false,
    tapDance: (i) => model.tapDance[i]?.name ?? "",
    macro: (i) => model.macros.items[i]?.name ?? "",
  };
}

function referenced(d: Described, names: Names): string | null {
  if (d.index == null) return null;
  const name = d.kind === "tap-dance" ? names.tapDance(d.index) : names.macro(d.index);
  return name || null;
}

export function keyFace(d: Described, names: Names): KeyFace {
  let hold: string | null = null;
  if ((d.kind === "layer-tap" || d.kind === "layer") && d.layer != null) hold = names.layer(d.layer);
  else if (d.kind === "tap-dance" || d.kind === "macro") hold = referenced(d, names);
  else if (d.kind === "mod-tap") hold = d.hold ?? null;
  else if (d.kind === "one-shot-mod") hold = "one-shot";
  return { main: d.legend.main, shifted: d.legend.shifted ?? null, altGr: d.legend.altGr ?? null, hold, tone: toneOf(d.kind) };
}

/** "Layer 1 · Symbols" for a named layer, "Layer 2" for an unnamed one */
export function layerLabel(index: number, names: Names): string {
  return names.layerIsNamed(index) ? `Layer ${index} · ${names.layer(index)}` : names.layer(index);
}

function layerSentence(d: Described, names: Names): string {
  const layer = d.layer != null ? layerLabel(d.layer, names) : d.tap;
  switch (d.layerAction) {
    case "while held":
      return `${layer}, while held`;
    case "toggle":
      return `Toggle ${layer}`;
    case "switch to":
      return `Switch to ${layer}`;
    case "one-shot":
      return `One-shot ${layer}`;
    case "hold, or tap to toggle":
      return `Hold for ${layer}, or tap to toggle it`;
    case "default":
      return `Make ${layer} the default layer`;
    case "default (saved)":
      return `Make ${layer} the default layer, and remember it`;
    default:
      return d.tap;
  }
}

/** The tap and hold actions in words, for the Inspector */
export function actionSummary(d: Described, names: Names): { tap: string; hold: string | null } {
  switch (d.kind) {
    case "none":
      return { tap: "Nothing", hold: null };
    case "transparent":
      return { tap: "Falls through to the layer below", hold: null };
    case "layer":
      return { tap: layerSentence(d, names), hold: null };
    case "layer-tap":
      return { tap: d.tap, hold: d.layer != null ? `${layerLabel(d.layer, names)}, while held` : d.hold ?? null };
    case "mod-tap":
      return { tap: d.tap, hold: d.hold ?? null };
    case "one-shot-mod":
      return { tap: `One-shot ${d.tap}`, hold: null };
    case "tap-dance":
    case "macro": {
      const what = d.kind === "tap-dance" ? "Tap dance" : "Macro";
      const name = referenced(d, names);
      return { tap: `${what} ${d.index ?? ""}${name ? ` · ${name}` : ""}`, hold: null };
    }
    default: {
      const tap = d.tap || d.code;
      return { tap: d.legend.altGr ? `${tap} (AltGr: ${d.legend.altGr})` : tap, hold: null };
    }
  }
}

/** What the key is, as a title: "Tab", "S — hold for Layer 2", "Transparent" */
export function keyTitle(d: Described, names: Names): string {
  if (d.kind === "none") return "Empty";
  if (d.kind === "transparent") return "Transparent";
  if (d.kind === "layer-tap" && d.layer != null) return `${d.tap} — hold for ${layerLabel(d.layer, names)}`;
  if (d.kind === "mod-tap" && d.hold) return `${d.tap} — hold for ${d.hold}`;
  return actionSummary(d, names).tap;
}

function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((w) => [...w].length));
}

/** Font sizes of a tap label, in key units, from one character down to long words */
const LEGEND_SCALES = [0.4, 0.32, 0.27, 0.22, 0.18];
const LEGEND_LENGTHS = [1, 2, 4, 6];

/** Font size of a key's main legend, in key units. Labels wrap at spaces, so the longest word counts. */
export function legendScale(main: string): number {
  const longest = longestWord(main);
  const level = LEGEND_LENGTHS.findIndex((n) => longest <= n);
  return LEGEND_SCALES[level === -1 ? LEGEND_LENGTHS.length : level];
}

/** average width of a character, as a share of the font size */
const CHAR_WIDTH = 0.55;
const HOLD_MIN_PX = 7;

/** Font size, in pixels, of a key's small hold label in widthPx pixels on a key of u pixels: a fifth of the key, but
 * small enough for a long name (a tap dance's, a macro's) to fit in two lines, and its longest word in one */
export function holdSize(hold: string, widthPx: number, u: number): number {
  // two lines, less what is lost where a line breaks between words
  const lines = (2 * widthPx * 0.8) / ([...hold].length * CHAR_WIDTH);
  const word = widthPx / (Math.max(1, longestWord(hold)) * CHAR_WIDTH);
  return Math.max(HOLD_MIN_PX, Math.min(0.2 * u, lines, word));
}

/** Font sizes, in pixels, of a key's legends: the main one, the shifted character (0 if none) and the hold label
 * (0 if none), so that all of them fit in widthPx by heightPx on a key of u pixels. When a long name needs two lines,
 * the main legend gets smaller first, then the name, down to its smallest size. */
export function legendSizes(face: KeyFace, widthPx: number, heightPx: number, u: number): {
  main: number;
  shifted: number;
  hold: number;
} {
  let main = legendScale(face.main) * u;
  const shifted = face.shifted ? 0.2 * u : 0;
  let hold = face.hold ? holdSize(face.hold, widthPx, u) : 0;
  const holdLines = !face.hold ? 0 : [...face.hold].length * CHAR_WIDTH * hold > widthPx ? 2 : 1;
  const gaps = (face.shifted ? 0.04 * u : 0) + (face.hold ? 0.04 * u : 0);
  const free = () => heightPx - gaps - shifted - holdLines * hold * 1.1;
  if (main * 1.05 > free()) main = Math.max(0.18 * u, free() / 1.05);
  if (main * 1.05 > free() && holdLines) {
    hold = Math.max(HOLD_MIN_PX, (heightPx - gaps - shifted - main * 1.05) / (holdLines * 1.1));
  }
  return { main, shifted, hold };
}
