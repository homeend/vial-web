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

/** What a key is called, for screen readers and its tooltip: its title first, then where it is. When the title
 * doesn't contain the text on the key cap ("TD 0", "OSL 3"), that comes before where it is, so the cap's text works
 * as a name for speech control (WCAG 2.5.3); a cap of symbols only ("▽") isn't words to say, and is left out.
 * "Tap dance 0 · Tab / Caps Lock (TD 0, key row 1, column 0)". An undefined action is an empty key. */
export function keyLabel(d: Described | undefined, names: Names, place: string): string {
  if (!d) return `Empty (${place})`;
  const title = keyTitle(d, names);
  const cap = keyFace(d, names).main.trim();
  const said = /[\p{L}\p{N}]/u.test(cap) && !title.toLowerCase().includes(cap.toLowerCase());
  return `${title} (${said ? `${cap}, ` : ""}${place})`;
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

/** Where a main legend may break besides spaces: after a "+" that joins two keys ("Ctrl+|Shift+|Esc"), not inside
 * "Vol +" or after the first "+" of "RCtrl++" */
export const PLUS_BREAK = /(?<=[^\s+]\+)(?=\S)/;

/** The parts of a main legend that never break: its words, and the keys of a combination ("Ctrl+", "Shift+", "Esc") */
export function legendWords(t: string): string[] {
  return t.split(/\s+/).flatMap((w) => w.split(PLUS_BREAK)).filter(Boolean);
}

/** How many lines a main legend takes at px pixels in widthPx, breaking greedily at spaces and after each "+" as the
 * browser does; a part wider than the line still takes one line (it is the width check's job to prevent that). */
export function mainLines(text: string, px: number, widthPx: number): number {
  const max = px > 0 ? widthPx / px : Infinity;
  let lines = 1;
  let line = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    word.split(PLUS_BREAK).forEach((part, i) => {
      const width = textWidth(part);
      // a space before a word, nothing between the keys of a combination
      const gap = i === 0 && line > 0 ? CHAR_WIDTH : 0;
      if (line > 0 && line + gap + width > max + 1e-9) {
        lines += 1;
        line = width;
      } else {
        line += gap + width;
      }
    });
  }
  return lines;
}

/** Font sizes of a tap label, in key units, from one character down to long words */
const LEGEND_SCALES = [0.4, 0.32, 0.27, 0.22, 0.18];
const LEGEND_LENGTHS = [1, 2, 4, 6];
/** the smallest main legend, in pixels */
const MAIN_MIN_PX = 7;
/** line height of the main legend, as a share of its font size: room for descenders, as the legend clips */
export const MAIN_LINE = 1.15;

/** Font size of a key's main legend, in key units. Labels wrap at spaces and after the "+" of a combination, so the
 * longest part counts; a wide character counts as almost two. */
export function legendScale(main: string): number {
  const longest = Math.max(
    0,
    ...legendWords(main).map((w) => {
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
 * (0 if none), so that all of them fit in widthPx by heightPx on a key of u pixels. The main legend breaks at spaces
 * and after each "+", and its longest part always fits across the key. When it takes several lines, or a long name
 * needs two lines, the main legend gets smaller first, then the name, down to its smallest size; then the main legend
 * again, down to 7 px. */
export function legendSizes(face: KeyFace, widthPx: number, heightPx: number, u: number): {
  main: number;
  shifted: number;
  hold: number;
} {
  const width = Math.max(0, widthPx);
  // its longest part on one line: a key cap doesn't break inside a word or a key name
  const longest = Math.max(0, ...legendWords(face.main).map(textWidth));
  const scale = legendScale(face.main);
  let main = longest > 0 ? Math.min(scale * u, width / longest) : scale * u;
  const shifted = face.shifted ? 0.2 * u : 0;
  let hold = face.hold ? holdSize(face.hold, widthPx, u) : 0;
  const holdLines = !face.hold ? 0 : textWidth(face.hold) * hold > widthPx ? 2 : 1;
  const gaps = (face.shifted ? 0.04 * u : 0) + (face.hold ? 0.04 * u : 0);
  const free = () => heightPx - gaps - shifted - holdLines * hold * 1.1;
  const height = (px: number) => px * MAIN_LINE * mainLines(face.main, px, width);
  /** the largest size, at most main, at which the main legend fits in the free height; fewer lines first */
  const fitting = () => {
    const most = mainLines(face.main, main, width);
    for (let lines = 1; lines <= most; lines++) {
      const px = Math.min(main, free() / (MAIN_LINE * lines));
      if (mainLines(face.main, px, width) <= lines) return px;
    }
    return Math.min(main, free() / (MAIN_LINE * most));
  };
  // smaller to make room for the labels around it, down to the smallest usual size (or less, if the width asks)
  if (height(main) > free()) main = Math.min(main, Math.max(0.18 * u, fitting()));
  if (height(main) > free() && holdLines) {
    hold = Math.max(HOLD_MIN_PX, (heightPx - gaps - shifted - height(main)) / (holdLines * 1.1));
  }
  // still too tall (a long combination): smaller still
  if (height(main) > free()) main = fitting();
  return { main: Math.max(MAIN_MIN_PX, main), shifted, hold };
}
