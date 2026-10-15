// Searching the keycode catalogue by label, name, alias and description.
import type { CatalogueKeycode, KeycodeCategory } from "../api/types";

function labels(k: CatalogueKeycode): string[] {
  return [k.tap, k.legend.shifted, k.legend.altGr].filter((l): l is string => !!l).map((l) => l.toLowerCase());
}

function names(k: CatalogueKeycode): string[] {
  return [k.code, ...k.aliases].map((n) => n.toLowerCase());
}

/** How well a keycode matches (lower is better), or null if it doesn't */
function rank(k: CatalogueKeycode, query: string): number | null {
  const shown = labels(k);
  const bare = names(k).map((n) => n.replace(/^kc_/, ""));
  if (shown.includes(query)) return 0;
  if (bare.includes(query) || names(k).includes(query)) return 1;
  if (shown.some((l) => l.startsWith(query))) return 2;
  if (names(k).some((n) => n.startsWith(query)) || bare.some((n) => n.startsWith(query))) return 3;
  if (shown.some((l) => l.includes(query)) || names(k).some((n) => n.includes(query))) return 4;
  if (k.description?.toLowerCase().includes(query)) return 5;
  return null;
}

/** Keycodes of all categories matching the query, best first, each once */
export function searchKeycodes(categories: KeycodeCategory[], query: string): CatalogueKeycode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const found: { k: CatalogueKeycode; rank: number; order: number }[] = [];
  for (const category of categories) {
    for (const k of category.keycodes) {
      if (seen.has(k.code)) continue;
      seen.add(k.code);
      const r = rank(k, q);
      if (r != null) found.push({ k, rank: r, order: found.length });
    }
  }
  return found.sort((a, b) => a.rank - b.rank || a.order - b.order).map((f) => f.k);
}
