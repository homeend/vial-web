// The keycode categories the picker offers for the keyboard shown. Qt offers every category whatever the keyboard;
// here a keyboard without lighting isn't offered the lighting keys (BL_*, RGB_*, RM_*), which would do nothing on it.
// A key that already has one still shows it, and "Any keycode" still takes one typed in.
import type { KeycodeCategory } from "../api/types";

/** The server's name of the category of lighting keys (server/model.py, KEYCODE_CATEGORIES) */
export const LIGHTING_CATEGORY = "Lighting";

/** The catalogue without the Lighting category when the keyboard has no lighting; otherwise (or when it has no such
 * category) the same array, so the search's index of it is kept */
export function offeredCategories(catalogue: KeycodeCategory[], hasLighting: boolean): KeycodeCategory[] {
  if (hasLighting || !catalogue.some((c) => c.name === LIGHTING_CATEGORY)) return catalogue;
  return catalogue.filter((c) => c.name !== LIGHTING_CATEGORY);
}

/** Where the category shown last (by its name) is among those offered now: the first one when it isn't offered (or
 * none was shown yet). A keyboard with other categories (without lighting) puts the others elsewhere. */
export function categoryIndex(categories: KeycodeCategory[], name: string | null): number {
  return Math.max(0, categories.findIndex((c) => c.name === name));
}
