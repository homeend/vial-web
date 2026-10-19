// What the Lighting page compares the keyboard's lighting with: the lighting it showed when the page first showed it,
// or the lighting saved here since. Kept while another page shows (the page is made anew when it comes back), for one
// keyboard (its uid): another one starts over.
import type { Lighting } from "../api/types";

export class LightingBaseline {
  /** the lighting to compare with, or null before the page first showed this keyboard */
  lighting = $state.raw<Lighting | null>(null);
  /** it was saved here (rather than being what the keyboard showed at first, which may not be what it keeps) */
  saved = $state(false);
  #uid: string | null = null;

  /** The keyboard shown: one that isn't the one followed so far starts over from what it shows now */
  follow(uid: string, now: Lighting): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.lighting = now;
    this.saved = false;
  }

  /** The keyboard keeps `now` from here on */
  save(now: Lighting): void {
    this.lighting = now;
    this.saved = true;
  }
}

export const lightingBaseline = new LightingBaseline();
