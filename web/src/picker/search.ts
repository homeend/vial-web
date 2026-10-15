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

const SIDES: Record<string, string> = { l: "left", r: "right" };

function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** "Left Shift" for LShift: plain modifiers have no description, so give them the words people search for */
function derivedLabels(k: CatalogueKeycode, label: string): string[] {
  const m = k.kind === "modifier" ? /^([lr])(ctrl|shift|alt|gui)$/.exec(label) : null;
  return m ? [m[2], `${SIDES[m[1]]} ${m[2]}`] : [];
}

function entry(k: CatalogueKeycode): Entry {
  const labels = [k.tap, k.legend.shifted, k.legend.altGr].filter((l): l is string => !!l).map(fold);
  for (const label of [...labels]) labels.push(...derivedLabels(k, label));
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

/** Keycodes of all categories matching the query, best first, each once */
export function searchKeycodes(categories: KeycodeCategory[], query: string): CatalogueKeycode[] {
  const q = fold(query).trim().replace(/\s+/g, " ");
  if (!q) return [];
  const found: { k: CatalogueKeycode; rank: number; kind: number; order: number }[] = [];
  for (const e of indexOf(categories)) {
    const r = rank(e, q);
    if (r != null) found.push({ k: e.k, rank: r, kind: e.kind, order: found.length });
  }
  return found.sort((a, b) => a.rank - b.rank || a.kind - b.kind || a.order - b.order).map((f) => f.k);
}
