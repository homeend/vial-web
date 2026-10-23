// What the tip on a key says (KeyTipCard.svelte): the card shown at once while a key is pointed at or has the focus,
// in place of the browser's tooltip, which comes late and says it in one line. A keymap key's tip has what the key
// does in words and, drawn as keycaps, a tap dance's four ways of pressing or a macro's steps; the picker's keys and
// the slot buttons of the behaviour pages use the same card.
import type { Described, KeyboardModel, TapDance } from "../api/types";
import type { Step } from "../behaviours/macro";
import { actionSummary, keyTitle, toneOf, type Names, type Tone } from "./labels";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

/** One way of pressing: a tap dance's slot drawn as a keycap, or a tap or hold said in words */
export type TipWay =
  | { label: string; action: Described | null }
  | { label: string; text: string };

export interface KeyTip {
  /** what the key is: "Space — hold for Layer 1", "Tap dance 0 · Tab / Caps Lock", "Empty" */
  title: string;
  /** the colour family of the card's border: the key's */
  tone?: Tone;
  /** small, under the title: where the key is, "row 2 · column 3 · Base layer"; or what the button is for */
  place?: string;
  /** the keycode, in a code font */
  code?: string;
  /** the ways of pressing: a tap dance's four (keycaps), or Tap and Hold in words */
  ways?: TipWay[];
  /** a tap dance's tapping term, in ms */
  tappingTerm?: number;
  /** a macro's steps */
  steps?: Step[];
  /** lines under the rest: "in combo 3", "matches the search", "click to change" */
  notes?: string[];
}

type Entries = Pick<KeyboardModel, "tapDance" | "macros">;

/** Chars the keycap shows with Shift and AltGr, in words: "Shift: ? · AltGr: ł" */
function legendNote(d: Described): string | null {
  const parts: string[] = [];
  if (d.legend.shifted) parts.push(`Shift: ${d.legend.shifted}`);
  if (d.legend.altGr) parts.push(`AltGr: ${d.legend.altGr}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The ways of pressing a tap dance, each with what it does (null for nothing) */
export function tapDanceWays(td: TapDance): { label: SlotLabel; action: Described | null }[] {
  return tapDanceSlots(td).map((slot) => ({ label: slot.label, action: slot.action.kind === "none" ? null : slot.action }));
}

/** The tip on a key that does `d`: its title, where it is (`place`, "" for none), the keycode, and what it does:
 * a tap dance's four ways and tapping term, a macro's steps (both from `entries`, the keyboard's tap dances and
 * macros; without them, a tap dance or macro key says only its title), a mod-tap's or layer-tap's Tap and Hold in
 * words, a plain key's Shift and AltGr characters. `notes` go last. An undefined action is an empty key. */
export function keyTip(
  d: Described | undefined, names: Names, place: string, entries: Entries | null = null, notes: string[] = [],
): KeyTip {
  if (!d) return { title: "Empty", tone: "none", place: place || undefined, notes: notes.length ? notes : undefined };
  const tip: KeyTip = { title: keyTitle(d, names), tone: toneOf(d.kind), place: place || undefined, code: d.code };
  const td = d.kind === "tap-dance" && d.index != null ? entries?.tapDance[d.index] : undefined;
  const macro = d.kind === "macro" && d.index != null ? entries?.macros.items[d.index] : undefined;
  const summary = actionSummary(d, names);
  const extra = [...notes];
  if (td) {
    tip.ways = tapDanceWays(td);
    tip.tappingTerm = td.tappingTerm;
  } else if (macro) {
    tip.steps = macro.actions;
  } else if (d.kind === "mod-tap" || d.kind === "layer-tap") {
    tip.ways = [{ label: "Tap", text: summary.tap }, { label: "Hold", text: summary.hold ?? "nothing" }];
  } else if (d.kind === "layer" || d.kind === "one-shot-mod") {
    // the title is the sentence already ("Layer 2, while held"); a layer key with modifiers says them there too
  } else if (d.kind !== "none" && d.kind !== "transparent" && d.kind !== "tap-dance" && d.kind !== "macro") {
    const legend = legendNote(d);
    if (legend) extra.unshift(legend);
  }
  // the server's description of a key, unless the card says it already (a tap dance's ways, a macro's steps, a
  // mod-tap's or layer-tap's Tap and Hold)
  if (d.description && !tip.ways && !tip.steps && d.kind !== "tap-dance" && d.kind !== "macro") extra.unshift(d.description);
  if (extra.length > 0) tip.notes = extra;
  return tip;
}

/** The tip on a slot button (a tap dance's slot, a combo's output, a key override's trigger): what the slot is for
 * as the place line ("Trigger"), then the key as keyTip says it, and that a click changes it */
export function slotTip(label: string, d: Described, names: Names, entries: Entries | null = null): KeyTip {
  if (d.kind === "none") return { title: "Nothing", tone: "none", place: label, notes: ["click to change"] };
  return keyTip(d, names, label, entries, ["click to change"]);
}

/** The tip on a keycode offered by the picker: what it is and its description (the key shows its keycode itself) */
export function catalogueTip(k: Described, names: Names): KeyTip {
  const tip: KeyTip = { title: keyTitle(k, names), tone: toneOf(k.kind) };
  if (k.description) tip.notes = [k.description];
  return tip;
}

/** The tip on a tap dance or macro the picker offers: as keyTip says it, with the ways or steps the picker was given
 * (it has no keyboard model, only each entry's detail) */
export function entryTip(
  k: Described, names: Names,
  detail: { kind: "tap-dance"; slots: { label: SlotLabel; action: Described | null }[]; tappingTerm: number }
    | { kind: "macro"; steps: Step[] },
): KeyTip {
  const tip: KeyTip = { title: keyTitle(k, names), tone: toneOf(k.kind) };
  if (detail.kind === "tap-dance") {
    tip.ways = detail.slots;
    tip.tappingTerm = detail.tappingTerm;
  } else {
    tip.steps = detail.steps;
  }
  return tip;
}
