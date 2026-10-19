// Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
// Combos page. A reload stays where it was, and the browser's back button goes back.

export type SectionId = "keymap" | "tap-dance" | "combos" | "macros";

export const SECTIONS: SectionId[] = ["keymap", "tap-dance", "combos", "macros"];

export interface Route {
  section: SectionId;
  /** the entry to show (a tap dance, combo or macro), or null */
  item: number | null;
}

export const HOME: Route = { section: "keymap", item: null };

/** "#combos/2" -> combo 2 on the Combos page; anything else is the keymap */
export function parseRoute(hash: string): Route {
  const m = /^#([a-z-]+)(?:\/(\d{1,4}))?$/.exec(hash);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!m || !section) return HOME;
  return { section, item: m[2] === undefined || section === "keymap" ? null : Number(m[2]) };
}

export function routeHash(route: Route): string {
  return route.item === null ? `#${route.section}` : `#${route.section}/${route.item}`;
}
