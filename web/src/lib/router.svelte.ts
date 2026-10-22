// The section shown, kept in the page's address (see route.ts), and a key the keymap is to show when it opens.
// Outside a browser (unit tests without a DOM) there is no address: the route is only kept here.
import { untrack } from "svelte";
import type { Place } from "../analysis/find";
import { HOME, isPathed, isWhole, parseRoute, routeHash, sameRoute, type Route, type SectionId } from "./route";

export class Router {
  // what the address says from the start, so a reload doesn't show the keymap first
  route = $state<Route>(hasAddress() ? parseRoute(location.hash) : HOME);
  /** a key to select in the keymap's Edit view: the keymap takes it when it shows */
  keyTarget = $state<Place | null>(null);
  /** the route shown last came from the address (the back or forward button, a link, an address typed), rather than
   * from go() */
  fromAddress = false;
  /** routes shown so far, the same one shown again included: a card opened again while it already is the one shown is
   * shown again (useTarget scrolls to it, and its highlight starts over) */
  visits = $state(0);

  /** Follow the address (the back button too); returns a function that stops */
  start(): () => void {
    return untrack(() => {
      // the address changing to what go() already shows (its own hashchange) changes nothing, so effects that follow
      // the route (scrolling to a card) run once
      const read = () => {
        const route = parseRoute(location.hash);
        // an entry named for a section that shows one page ("#lighting/3"), or a Learning path that can't be read, goes
        // from the address too, as it does from the route: no step back
        const hash = routeHash(route);
        if (location.hash !== hash && location.hash.startsWith(`#${route.section}/`)) location.replace(hash);
        if (!sameRoute(route, this.route)) {
          this.fromAddress = true;
          this.route = route;
          this.visits++;
        }
      };
      read();
      window.addEventListener("hashchange", read);
      return () => window.removeEventListener("hashchange", read);
    });
  }

  /** Show a section (and a card in it, or a Learning view by its `path`; the path's names must match the address
   * pattern (route.ts's NAME), or the address is read back as the list). `replace` changes the address without a new
   * step back, for opening something on the page shown */
  go(
    section: SectionId, item: number | null = null,
    { replace = false, path = [] }: { replace?: boolean; path?: readonly string[] } = {},
  ): void {
    const route: Route = isPathed(section)
      ? { section, item: null, path }
      : { section, item: isWhole(section) ? null : item, path: [] };
    this.fromAddress = false;
    this.route = route;
    this.visits++;
    if (!hasAddress()) return;
    const hash = routeHash(route);
    if (location.hash === hash) return;
    if (replace) location.replace(hash);
    else location.hash = hash;
  }

  /** The key, selected in the keymap's Edit view */
  openKey(place: Place): void {
    this.keyTarget = place;
    this.go("keymap");
  }

  /** The key to show, once: null when there is none */
  takeKeyTarget(): Place | null {
    const target = this.keyTarget;
    this.keyTarget = null;
    return target;
  }
}

function hasAddress(): boolean {
  return typeof location !== "undefined" && typeof window !== "undefined";
}

export const router = new Router();
