// Which section of the app shows, and which of its entries, in the page's address: "#combos/2" is combo 2 on the
// Combos page. A reload stays where it was, and the browser's back button goes back. The Learning section names its
// views by a path instead: "#learning" (the lesson list), "#learning/fingers", "#learning/<set>/<lesson>" (a lesson),
// "#learning/<set>/<lesson>/<exercise>" (typing).

export type SectionId =
  | "keymap" | "layout" | "tap-dance" | "combos" | "macros" | "learning" | "key-overrides" | "alt-repeat" | "settings"
  | "lighting" | "matrix" | "keyboard" | "version";

export const SECTIONS: readonly SectionId[] = [
  "keymap", "layout", "tap-dance", "combos", "macros", "learning", "key-overrides", "alt-repeat", "settings", "lighting",
  "matrix", "keyboard", "version",
];

/** sections that show one page of their own, with no entries for the address to name */
const WHOLE: readonly SectionId[] = ["keymap", "layout", "settings", "lighting", "matrix", "keyboard", "version"];

/** the section whose address holds a path of names, not an entry number */
const PATHED: SectionId = "learning";

/** Whether a section shows one page of its own, with no entries */
export function isWhole(section: SectionId): boolean {
  return WHOLE.includes(section);
}

/** Whether a section's address holds a path of names (the Learning section) rather than an entry number */
export function isPathed(section: SectionId): boolean {
  return section === PATHED;
}

export interface Route {
  section: SectionId;
  /** the entry to show (a tap dance, combo, macro, key override or alt-repeat key), or null */
  item: number | null;
  /** the Learning view's path, up to three names ("corne-sim-en", "01", "01-n1"); [] for every other section */
  path: readonly string[];
}

export const HOME: Route = { section: "keymap", item: null, path: [] };

/** one name of a Learning path: a set id, a lesson id, an exercise id or "fingers"; the lesson set schema's id pattern
 * (docs/learning/lesson-set.schema.json), which learning/types.ts checks a set's id against too */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PATH_MAX = 3;

/** "#combos/2" -> combo 2 on the Combos page; a section with no entries leaves the number out; "#learning/<set>/<lesson>"
 * -> the Learning section with that path (a path it can't read is the lesson list); anything else is the keymap */
export function parseRoute(hash: string): Route {
  const m = /^#([a-z-]+)(?:\/(.*))?$/.exec(hash);
  const section = SECTIONS.find((s) => s === m?.[1]);
  if (!m || !section) return HOME;
  if (section === PATHED) {
    const path = m[2] === undefined ? [] : m[2].split("/");
    const readable = path.length <= PATH_MAX && path.every((name) => NAME.test(name));
    return { section, item: null, path: readable ? path : [] };
  }
  if (m[2] !== undefined && !/^\d{1,4}$/.test(m[2])) return HOME;
  return { section, item: m[2] === undefined || WHOLE.includes(section) ? null : Number(m[2]), path: [] };
}

/** The address of a route; a section with no entries never names one, and only the Learning section writes a path */
export function routeHash(route: Route): string {
  if (route.section === PATHED) return [`#${PATHED}`, ...route.path].join("/");
  return route.item === null || WHOLE.includes(route.section) ? `#${route.section}` : `#${route.section}/${route.item}`;
}

/** Whether two routes show the same thing */
export function sameRoute(a: Route, b: Route): boolean {
  return a.section === b.section && a.item === b.item && a.path.length === b.path.length
    && a.path.every((name, i) => name === b.path[i]);
}
