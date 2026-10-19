// What the Lighting page compares the keyboard's lighting with: the lighting it showed when the page first showed it,
// or the lighting saved here since. Kept while another page shows (the page is made anew when it comes back), for one
// keyboard (its uid): another one starts over.
import type { Backlight, Lighting } from "../api/types";
import { sameLighting } from "./lighting";

export class LightingBaseline {
  /** the lighting to compare with, or null before the page first showed this keyboard */
  lighting = $state.raw<Lighting | null>(null);
  /** it was saved here (rather than being what the keyboard showed at first, which may not be what it keeps) */
  saved = $state(false);
  /** the backlight the keyboard has kept since `lighting`, without a save: the firmware writes the backlight (its
   * breathing and the level it runs at) when its breathing changes. Null when it hasn't. */
  keptBacklight = $state.raw<Backlight | null>(null);
  #uid: string | null = null;

  /** The keyboard shown: one that isn't the one followed so far starts over from what it shows now */
  follow(uid: string, now: Lighting): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.lighting = now;
    this.saved = false;
    this.keptBacklight = null;
  }

  /** The keyboard keeps `now` from here on */
  save(now: Lighting): void {
    this.lighting = now;
    this.saved = true;
    this.keptBacklight = null;
  }

  /** The keyboard showed `after` once a change sent while it showed `before` was done: a change of its backlight's
   * breathing kept the backlight as it shows it now */
  confirmed(before: Lighting, after: Lighting): void {
    if (before.backlight && after.backlight && before.backlight.effect !== after.backlight.effect) {
      this.keptBacklight = after.backlight;
    }
  }

  /** The keyboard shows something else than the baseline: Undo has something to put back */
  changed(now: Lighting): boolean {
    return this.lighting !== null && !sameLighting(now, this.lighting);
  }

  /** The keyboard shows something else than the baseline, besides the backlight it has kept since: Save has
   * something to keep, and unplugged, the keyboard would lose it */
  unsaved(now: Lighting): boolean {
    if (this.lighting === null) return false;
    const kept = this.keptBacklight ? { ...this.lighting, backlight: this.keptBacklight } : this.lighting;
    return !sameLighting(now, kept);
  }
}

export const lightingBaseline = new LightingBaseline();
