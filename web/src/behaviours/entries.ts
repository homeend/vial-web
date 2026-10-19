// Which tap dances, combos and macros their pages show, and which are free for a new one. The keyboard has a fixed
// number of each (often many more than are used): a page shows those set up or used, and those opened.
import type { Usage } from "../analysis/usage";
import type { KeyboardModel, Macro, TapDance } from "../api/types";
import { tapDanceSlots } from "../keymap/tapdance";
import { isSet as comboIsSet } from "./members";

export function tapDanceIsSet(td: TapDance): boolean {
  return tapDanceSlots(td).some((slot) => slot.action.kind !== "none");
}

export function macroIsSet(macro: Macro): boolean {
  return macro.actions.length > 0;
}

/** The indexes of the entries to show as cards, in order: those `shown` says, and those opened */
export function shownEntries(count: number, shown: (index: number) => boolean, opened: Iterable<number>): number[] {
  const open = new Set(opened);
  return Array.from({ length: count }, (_, i) => i).filter((i) => shown(i) || open.has(i));
}

/** The first combo with no keycode and no output, or null */
export function freeCombo(model: Pick<KeyboardModel, "combos">): number | null {
  return model.combos.find((c) => !comboIsSet(c))?.index ?? null;
}

/** The first macro with no steps that nothing uses, or null */
export function freeMacro(model: Pick<KeyboardModel, "macros">, usage: Usage): number | null {
  return model.macros.items.find((m) => !macroIsSet(m) && (usage.macros[m.index]?.length ?? 0) === 0)?.index ?? null;
}

/** How many of each are set up, for the navigation; null where the firmware has none (the section is hidden). Only
 * those set up count, though a page also shows those used but empty (a macro on a key with no steps): the count says
 * how many there are, the page where they are used. */
export function behaviourCounts(model: Pick<KeyboardModel, "tapDance" | "combos" | "macros">):
  { tapDance: number | null; combos: number | null; macros: number | null } {
  return {
    tapDance: model.tapDance.length > 0 ? model.tapDance.filter(tapDanceIsSet).length : null,
    combos: model.combos.length > 0 ? model.combos.filter(comboIsSet).length : null,
    macros: model.macros.items.length > 0 ? model.macros.items.filter(macroIsSet).length : null,
  };
}
