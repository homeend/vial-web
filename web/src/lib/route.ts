// Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
// Combos page. A reload stays where it was, and the browser's back button goes back.

export type SectionId =
  | "keymap" | "layout" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "lighting"
  | "matrix" | "keyboard";

export const SECTIONS: readonly SectionId[] = [
  "keymap", "layout", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "lighting", "matrix",
  "keyboard",
];

/** sections that show one page of their own, with no entries for the address to name */
const WHOLE: readonly SectionId[] = ["keymap", "layout", "settings", "lighting", "matrix", "keyboard"];

export interface Route {
  section: SectionId;
  /** the entry to show (a tap dance, combo, macro, key override or alt-repeat key), or null */
  item: number | null;
}

export const HOME: Route = { section: "keymap", item: null };

/** "#combos/2" -> combo 2 on the Combos page; a section with no entries leaves the number out; anything else is the
 * keymap */
export function parseRoute(hash: string): Route {
  const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!m || !section) return HOME;
  return { section, item: m[2] === undefined || WHOLE.includes(section) ? null : Number(m[2]) };
}

/** The address of a route; a section with no entries never names one */
export function routeHash(route: Route): string {
  return route.item === null || WHOLE.includes(route.section) ? `#${route.section}` : `#${route.section}/${route.item}`;
}
