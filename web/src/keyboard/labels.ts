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

/** The tap action of a key that also has a hold action: "Nothing" when a tap does nothing (LSFT_T(KC_NO)) */
function tapOf(d: Described): string {
  return d.tap || "Nothing";
}

function plainSummary(d: Described): { tap: string; hold: string | null } {
  const tap = d.tap || d.code;
  return { tap: d.legend.altGr ? `${tap} (AltGr: ${d.legend.altGr})` : tap, hold: null };
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
      return { tap: tapOf(d), hold: d.layer != null ? `${layerLabel(d.layer, names)}, while held` : d.hold ?? null };
    case "mod-tap":
      return { tap: tapOf(d), hold: d.hold ?? null };
    case "one-shot-mod":
      return { tap: `One-shot ${d.tap}`, hold: null };
    case "tap-dance":
    case "macro": {
      const what = d.kind === "tap-dance" ? "Tap dance" : "Macro";
      const name = referenced(d, names);
      return { tap: `${what} ${d.index ?? ""}${name ? ` · ${name}` : ""}`, hold: null };
    }
    case "basic":
    case "modifier":
    case "mouse":
    case "media":
    case "lighting":
    case "other":
      return plainSummary(d);
    default:
      // every kind is handled above; a kind the server adds later reads as a plain key
      void (d.kind satisfies never);
      return plainSummary(d);
  }
}

/** What the key is, as a title: "Tab", "S — hold for Layer 2", "Transparent" */
export function keyTitle(d: Described, names: Names): string {
  if (d.kind === "none") return "Empty";
  if (d.kind === "transparent") return "Transparent";
  if (d.kind === "layer-tap" && d.layer != null) return `${tapOf(d)} — hold for ${layerLabel(d.layer, names)}`;
  if (d.kind === "mod-tap" && d.hold) return `${tapOf(d)} — hold for ${d.hold}`;
  return actionSummary(d, names).tap;
}

/** average width of a character, as a share of the font size */
const CHAR_WIDTH = 0.55;
/** width of a wide character (CJK, kana, Hangul, full-width forms, emoji): a full font size */
const WIDE_WIDTH = 1;
const HOLD_MIN_PX = 7;

/** East Asian wide and full-width characters, and emoji */
const WIDE = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compatibility Jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs, extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff60], // full-width forms
  [0xffe0, 0xffe6], // full-width signs
  [0x1f300, 0x1faff], // emoji
  [0x20000, 0x3fffd], // CJK unified ideographs, extensions B and later
];

function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return WIDE.some(([from, to]) => code >= from && code <= to);
}

/** How many narrow and wide characters a text has */
function countChars(text: string): { narrow: number; wide: number } {
  const chars = [...text];
  const wide = chars.filter(isWide).length;
  return { narrow: chars.length - wide, wide };
}

/** Width of a text on one line, as a share of the font size */
function textWidth(text: string): number {
  const { narrow, wide } = countChars(text);
  return narrow * CHAR_WIDTH + wide * WIDE_WIDTH;
}

/** Width of the longest word of a text, as a share of the font size. Labels wrap at spaces, so it counts most. */
function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map(textWidth));
}

/** Font sizes of a tap label, in key units, from one character down to long words */
const LEGEND_SCALES = [0.4, 0.32, 0.27, 0.22, 0.18];
const LEGEND_LENGTHS = [1, 2, 4, 6];

/** Font size of a key's main legend, in key units. Labels wrap at spaces, so the longest word counts; a wide
 * character counts as almost two. */
export function legendScale(main: string): number {
  const longest = Math.max(
    0,
    ...main.split(/\s+/).map((w) => {
      const { narrow, wide } = countChars(w);
      return narrow + (wide * WIDE_WIDTH) / CHAR_WIDTH;
    }),
  );
  const level = LEGEND_LENGTHS.findIndex((n) => longest <= n);
  return LEGEND_SCALES[level === -1 ? LEGEND_LENGTHS.length : level];
}

/** Font size, in pixels, of a key's small hold label in widthPx pixels on a key of u pixels: a fifth of the key, but
 * small enough for a long name (a tap dance's, a macro's) to fit in two lines, and its longest word in one */
export function holdSize(hold: string, widthPx: number, u: number): number {
  // two lines, less what is lost where a line breaks between words
  const lines = (2 * widthPx * 0.8) / textWidth(hold);
  const word = widthPx / Math.max(CHAR_WIDTH, longestWord(hold));
  return Math.max(HOLD_MIN_PX, Math.min(0.2 * u, lines, word));
}

/** Font sizes, in pixels, of a key's legends: the main one, the shifted character (0 if none) and the hold label
 * (0 if none), so that all of them fit in widthPx by heightPx on a key of u pixels. The main legend's longest word
 * always fits across the key. When a long name needs two lines, the main legend gets smaller first, then the name,
 * down to its smallest size. */
export function legendSizes(face: KeyFace, widthPx: number, heightPx: number, u: number): {
  main: number;
  shifted: number;
  hold: number;
} {
  // its longest word on one line: a key cap doesn't break words
  let main = Math.min(legendScale(face.main) * u, Math.max(0, widthPx) / longestWord(face.main));
  const shifted = face.shifted ? 0.2 * u : 0;
  let hold = face.hold ? holdSize(face.hold, widthPx, u) : 0;
  const holdLines = !face.hold ? 0 : textWidth(face.hold) * hold > widthPx ? 2 : 1;
  const gaps = (face.shifted ? 0.04 * u : 0) + (face.hold ? 0.04 * u : 0);
  const free = () => heightPx - gaps - shifted - holdLines * hold * 1.1;
  // smaller to make room for the labels around it, down to the smallest usual size (or less, if the width asks)
  if (main * 1.05 > free()) main = Math.min(main, Math.max(0.18 * u, free() / 1.05));
  if (main * 1.05 > free() && holdLines) {
    hold = Math.max(HOLD_MIN_PX, (heightPx - gaps - shifted - main * 1.05) / (holdLines * 1.1));
  }
  return { main, shifted, hold };
}
