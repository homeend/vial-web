// Searching the keycode catalogue by label, name, alias and description.
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";

/** A keycode with its search fields lowercased once, not on every keystroke */
interface Entry {
  k: CatalogueKeycode;
  labels: string[];
  names: string[];
  bare: string[];
  description: string;
  /** one-shot modifiers come after the real keys of the same rank */
  kind: number;
}

const SIDES: Record<string, string> = { L: "left", R: "right" };

/** the other names people search the GUI key by */
const GUI_WORDS = ["gui", "win", "windows", "cmd", "command", "super", "meta"];

function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/**
 * "Left Shift" for KC_LSHIFT: plain modifiers have no description, so give them the words people search for.
 * Taken from the code, not the legend: a localized legend (Polish "AltGr") is still the right Alt.
 */
function derivedLabels(k: CatalogueKeycode): string[] {
  const m = /^KC_([LR])(CTRL|SHIFT|ALT|GUI)$/.exec(k.code);
  if (!m) return [];
  const words = m[2] === "GUI" ? GUI_WORDS : [m[2].toLowerCase()];
  return words.flatMap((word) => [word, `${SIDES[m[1]]} ${word}`]);
}

function entry(k: CatalogueKeycode): Entry {
  const labels = [k.tap, k.legend.shifted, k.legend.altGr].filter((l): l is string => !!l).map(fold);
  labels.push(...derivedLabels(k));
  const names = [k.code, ...k.aliases].map(fold);
  return {
    k,
    labels,
    names,
    bare: names.map((n) => n.replace(/^kc_/, "")),
    description: fold(k.description ?? ""),
    kind: k.kind === "one-shot-mod" ? 1 : 0,
  };
}

const wordsOf = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** How well a keycode matches (lower is better), or null if it doesn't */
function rank(e: Entry, query: string): number | null {
  if (e.labels.includes(query)) return 0;
  if (e.bare.includes(query) || e.names.includes(query)) return 1;
  if (e.labels.some((l) => l.startsWith(query))) return 2;
  if (e.names.some((n) => n.startsWith(query)) || e.bare.some((n) => n.startsWith(query))) return 3;
  const labelWords = e.labels.flatMap(wordsOf);
  if (labelWords.includes(query)) return 4;
  if (labelWords.some((w) => w.startsWith(query))) return 5;
  if (wordsOf(e.description).some((w) => w.startsWith(query))) return 6;
  if (e.labels.some((l) => l.includes(query)) || e.names.some((n) => n.includes(query))) return 7;
  if (e.description.includes(query)) return 8;
  const parts = query.split(" ");
  if (parts.length > 1) {
    const all = [...e.labels, ...e.names, e.description].join(" ");
    if (parts.every((p) => all.includes(p))) return 9;
  }
  return null;
}

const indexes = new WeakMap<KeycodeCategory[], Entry[]>();

/** Each keycode once, in catalogue order, prepared for searching */
function indexOf(categories: KeycodeCategory[]): Entry[] {
  let index = indexes.get(categories);
  if (!index) {
    const seen = new Set<string>();
    index = [];
    for (const category of categories) {
      for (const k of category.keycodes) {
        if (seen.has(k.code)) continue;
        seen.add(k.code);
        index.push(entry(k));
      }
    }
    indexes.set(categories, index);
  }
  return index;
}

const normalize = (query: string) => fold(query).trim().replace(/\s+/g, " ");

/** Keycodes of all categories matching the query, best first, each once */
export function searchKeycodes(categories: KeycodeCategory[], query: string): CatalogueKeycode[] {
  const q = normalize(query);
  if (!q) return [];
  const found: { k: CatalogueKeycode; rank: number; kind: number; order: number }[] = [];
  for (const e of indexOf(categories)) {
    const r = rank(e, q);
    if (r != null) found.push({ k: e.k, rank: r, kind: e.kind, order: found.length });
  }
  return found.sort((a, b) => a.rank - b.rank || a.kind - b.kind || a.order - b.order).map((f) => f.k);
}

/** The keycodes the query names exactly: by their name, an alias, or either without KC_ ("esc", "KC_ESC", "caps") */
export function codesNamed(categories: KeycodeCategory[], query: string): Set<string> {
  const q = normalize(query);
  const found = new Set<string>();
  if (!q) return found;
  for (const e of indexOf(categories)) {
    if (e.names.includes(q) || e.bare.includes(q)) found.add(e.k.code);
  }
  return found;
}

/** A search text as searches compare it: case folded, spaces trimmed and collapsed */
export function searchText(query: string): string {
  return normalize(query);
}

/** Kinds of template, by the words that name them (without spaces or dashes) */
const TEMPLATE_KINDS: { words: string[]; matches: (template: string) => boolean }[] = [
  { words: ["mt", "modtap"], matches: (t) => /_T\(kc\)$/.test(t) },
  { words: ["lt", "layertap"], matches: (t) => /^LT\d+\(kc\)$/.test(t) },
];

/**
 * Templates ("LSFT(kc)") of all categories whose name starts with the query, or of the kind it names
 * ("mod tap", "mt", "layer tap", "lt"), in catalogue order, each once. A single character finds none.
 */
export function searchTemplates(categories: KeycodeCategory[], query: string): string[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const word = q.replace(/[\s-]+/g, "");
  const kinds = TEMPLATE_KINDS.filter((kind) => kind.words.includes(word));
  const found = new Set<string>();
  for (const category of categories) {
    for (const t of category.templates) {
      if (fold(t).startsWith(q) || kinds.some((kind) => kind.matches(t))) found.add(t);
    }
  }
  return [...found];
}
