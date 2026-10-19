// Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
// Combos page. A reload stays where it was, and the browser's back button goes back.

export type SectionId =
  | "keymap" | "tap-dance" | "combos" | "macros" | "key-overrides" | "alt-repeat" | "settings" | "keyboard";

export const SECTIONS: SectionId[] = [
  "keymap", "tap-dance", "combos", "macros", "key-overrides", "alt-repeat", "settings", "keyboard",
];

/** sections that show one page of their own, with no entries for the address to name */
const WHOLE: SectionId[] = ["keymap", "settings", "keyboard"];

export interface Route {
  section: SectionId;
  /** the entry to show (a tap dance, combo, macro, key override or alt-repeat key), or null */
  item: number | null;
}

export const HOME: Route = { section: "keymap", item: null };

/** "#combos/2" -> combo 2 on the Combos page; anything else is the keymap */
export function parseRoute(hash: string): Route {
  const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!m || !section) return HOME;
  if (m[2] !== undefined && WHOLE.includes(section)) return section === "keymap" ? HOME : { section, item: null };
  return { section, item: m[2] === undefined ? null : Number(m[2]) };
}

export function routeHash(route: Route): string {
  return route.item === null ? `#${route.section}` : `#${route.section}/${route.item}`;
}
