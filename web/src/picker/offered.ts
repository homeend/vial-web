// The keycode categories the picker offers for the keyboard shown. Qt offers every category whatever the keyboard;
// here a keyboard without lighting isn't offered the lighting keys (BL_*, RGB_*, RM_*), and only the tap dances and
// macros set up are offered: the others would do nothing on it. A key that already has one still shows it, and
// "Any keycode" still takes one typed in.
import { stepVerb, stepWhat } from "../behaviours/macro";
import { macroIsSet, tapDanceIsSet } from "../behaviours/entries";
import { memberName } from "../analysis/phrases";
import type { KeyboardModel, KeycodeCategory } from "../api/types";
import { namesOf, type Names } from "../keyboard/labels";
import { tapDanceSlots } from "../keymap/tapdance";

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

/** The server's names of the categories of tap dance keys (TD(n)) and macro keys (Mn) */
export const TAP_DANCE_CATEGORY = "Tap dance";
export const MACROS_CATEGORY = "Macros";

/** A tooltip's longest description of a macro, in characters */
const LONGEST_MACRO = 200;

/** What a tap dance does, for its tooltip: "Nav — tap: Esc · hold: LCtrl · tapping term 200 ms" (its slots set up) */
function tapDanceText(index: number, model: KeyboardModel, names: Names): string {
  const td = model.tapDance[index];
  const slots = tapDanceSlots(td).filter((slot) => slot.action.kind !== "none")
    .map((slot) => `${slot.label.toLowerCase()}: ${memberName(slot.action, names)}`);
  // a name given (not the one made from its slots, which would only say them again)
  const name = td.customName ? names.tapDance(index) : "";
  return `${name ? `${name} — ` : ""}${[...slots, `tapping term ${td.tappingTerm} ms`].join(" · ")}`;
}

/** What a macro does, for its tooltip: "type “git status”, tap Enter", cut short with "…" */
function macroText(index: number, model: KeyboardModel, names: Names): string {
  const name = model.macros.items[index].customName ? names.macro(index) : "";
  const text = (name ? `${name} — ` : "") +
    model.macros.items[index].actions.map((step) => `${stepVerb(step)} ${stepWhat(step)}`).join(", ");
  return text.length > LONGEST_MACRO ? `${text.slice(0, LONGEST_MACRO - 1)}…` : text;
}

/** A category as the picker offers it: with a note under its keys when some are left out */
export type OfferedCategory = KeycodeCategory & { note?: string };

/** What the picker says under the Tap dance and Macros tabs' keys: which are left out, or how to set up a first one */
const NOTES = {
  "tap-dance": {
    some: "Only the tap dances set up are shown. Set up another on the Tap dance page.",
    none: "No tap dance is set up yet. Set one up on the Tap dance page, or with “Turn into tap dance” on a key.",
  },
  macro: {
    some: "Only the macros set up are shown. Set up another on the Macros page.",
    none: "No macro is set up yet. Set one up on the Macros page.",
  },
};

/** The categories with only the tap dances (TD(n)) and macros (Mn) set up, each described by what it does (the
 * picker's tooltip), with a note saying so. The Macros category's other keys (the dynamic macro keys, DM_*) stay. On
 * a keyboard whose firmware has none of a kind, its keys are left out with no note (and the Tap dance category with
 * them). Without a keyboard, or for the other categories, as they are. */
export function setUpEntries(categories: KeycodeCategory[], model: KeyboardModel | null): OfferedCategory[] {
  if (!model) return categories;
  const names = namesOf(model);
  const entries = (c: KeycodeCategory, kind: "tap-dance" | "macro", count: number, isSet: (i: number) => boolean,
    describe: (i: number) => string): OfferedCategory[] => {
    const keycodes = c.keycodes.flatMap((k) => {
      if (k.kind !== kind || k.index == null) return [k];
      return k.index < count && isSet(k.index) ? [{ ...k, description: describe(k.index) }] : [];
    });
    if (count === 0) return keycodes.length === 0 ? [] : [{ ...c, keycodes }];
    return [{ ...c, keycodes, note: keycodes.some((k) => k.kind === kind) ? NOTES[kind].some : NOTES[kind].none }];
  };
  return categories.flatMap((c) => {
    if (c.name === TAP_DANCE_CATEGORY) {
      return entries(c, "tap-dance", model.tapDance.length, (i) => tapDanceIsSet(model.tapDance[i]),
        (i) => tapDanceText(i, model, names));
    }
    if (c.name === MACROS_CATEGORY) {
      return entries(c, "macro", model.macros.items.length, (i) => macroIsSet(model.macros.items[i]),
        (i) => macroText(i, model, names));
    }
    return [c];
  });
}
