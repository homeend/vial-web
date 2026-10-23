// The keycode categories the picker offers for the keyboard shown. Qt offers every category whatever the keyboard;
// here a keyboard without lighting isn't offered the lighting keys (BL_*, RGB_*, RM_*), and only the tap dances and
// macros set up are offered: the others would do nothing on it. A key that already has one still shows it, and
// "Any keycode" still takes one typed in.
import { stepVerb, stepWhat, type Step } from "../behaviours/macro";
import { macroIsSet, tapDanceIsSet } from "../behaviours/entries";
import { memberName } from "../analysis/phrases";
import type { Described, KeyboardModel, KeycodeCategory } from "../api/types";
import { namesOf, type Names } from "../keyboard/labels";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

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

/** The longest description in words (detailText), in characters */
const LONGEST_MACRO = 200;

/** What a tap dance or macro does, for the picker's tip on it (keyboard/tip.ts entryTip): its name when one was given (not
 * one made from what it does, which would only say it again), and its slots or steps */
export type EntryDetail =
  | { kind: "tap-dance"; name: string; slots: { label: SlotLabel; action: Described | null }[]; tappingTerm: number }
  | { kind: "macro"; name: string; steps: Step[] };

function tapDanceDetail(index: number, model: KeyboardModel, names: Names): EntryDetail {
  const td = model.tapDance[index];
  return {
    kind: "tap-dance",
    name: td.customName ? names.tapDance(index) : "",
    slots: tapDanceSlots(td).map((slot) => ({ label: slot.label, action: slot.action.kind === "none" ? null : slot.action })),
    tappingTerm: td.tappingTerm,
  };
}

function macroDetail(index: number, model: KeyboardModel, names: Names): EntryDetail {
  const macro = model.macros.items[index];
  return { kind: "macro", name: macro.customName ? names.macro(index) : "", steps: macro.actions };
}

/** The same as words, for a screen reader: "Nav — tap: Esc · hold: LCtrl · tapping term 200 ms", "type “git status”,
 * tap Enter" (a long macro cut short with "…") */
export function detailText(detail: EntryDetail, names: Names): string {
  const parts = detail.kind === "tap-dance"
    ? [detail.slots.flatMap((s) => s.action ? [`${s.label.toLowerCase()}: ${memberName(s.action, names)}`] : [])
      .concat(`tapping term ${detail.tappingTerm} ms`).join(" · ")]
    : [detail.steps.map((step) => `${stepVerb(step)} ${stepWhat(step)}`).join(", ")];
  const text = (detail.name ? `${detail.name} — ` : "") + parts[0];
  return text.length > LONGEST_MACRO ? `${text.slice(0, LONGEST_MACRO - 1)}…` : text;
}

/** A category as the picker offers it: with a note under its keys when some are left out, and each tap dance's or
 * macro's card, by keycode */
export type OfferedCategory = KeycodeCategory & { note?: string; details?: ReadonlyMap<string, EntryDetail> };

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

/** The categories with only the tap dances (TD(n)) and macros (Mn) set up, each with its card and described in words
 * (for a screen reader), with a note saying so. The Macros category's other keys (the dynamic macro keys, DM_*) stay.
 * On a keyboard whose firmware has none of a kind, its keys are left out with no note (and the Tap dance category
 * with them). Without a keyboard, or for the other categories, as they are. */
export function setUpEntries(categories: KeycodeCategory[], model: KeyboardModel | null): OfferedCategory[] {
  if (!model) return categories;
  const names = namesOf(model);
  const entries = (c: KeycodeCategory, kind: "tap-dance" | "macro", count: number, isSet: (i: number) => boolean,
    detailOf: (i: number) => EntryDetail): OfferedCategory[] => {
    const details = new Map<string, EntryDetail>();
    const keycodes = c.keycodes.flatMap((k) => {
      if (k.kind !== kind || k.index == null) return [k];
      if (k.index >= count || !isSet(k.index)) return [];
      const detail = detailOf(k.index);
      details.set(k.code, detail);
      return [{ ...k, description: detailText(detail, names) }];
    });
    if (count === 0) return keycodes.length === 0 ? [] : [{ ...c, keycodes }];
    const note = details.size > 0 ? NOTES[kind].some : NOTES[kind].none;
    return [{ ...c, keycodes, note, details }];
  };
  return categories.flatMap((c) => {
    if (c.name === TAP_DANCE_CATEGORY) {
      return entries(c, "tap-dance", model.tapDance.length, (i) => tapDanceIsSet(model.tapDance[i]),
        (i) => tapDanceDetail(i, model, names));
    }
    if (c.name === MACROS_CATEGORY) {
      return entries(c, "macro", model.macros.items.length, (i) => macroIsSet(model.macros.items[i]),
        (i) => macroDetail(i, model, names));
    }
    return [c];
  });
}
