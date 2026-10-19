// The section shown, kept in the page's address (see route.ts), and a key the keymap is to show when it opens.
import { untrack } from "svelte";
import type { Place } from "../analysis/find";
import { HOME, parseRoute, routeHash, type Route, type SectionId } from "./route";

export class Router {
  // what the address says from the start, so a reload doesn't show the keymap first
  route = $state<Route>(typeof location === "undefined" ? HOME : parseRoute(location.hash));
  /** a key to select in the keymap's Edit view: the keymap takes it when it shows */
  keyTarget = $state<Place | null>(null);

  /** Follow the address (the back button too); returns a function that stops */
  start(): () => void {
    return untrack(() => {
      const read = () => (this.route = parseRoute(location.hash));
      read();
      window.addEventListener("hashchange", read);
      return () => window.removeEventListener("hashchange", read);
    });
  }

  go(section: SectionId, item: number | null = null): void {
    const route = { section, item };
    this.route = route;
    const hash = routeHash(route);
    if (location.hash !== hash) location.hash = hash;
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

export const router = new Router();
