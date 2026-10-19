// Choosing a combo's keys. A combo is a list of keycodes (Vial has room for 4), so choosing a key means choosing the
// keycode it has on the base layer; choosing it again takes it out.
import type { Combo, Described } from "../api/types";

export const MAX_COMBO_KEYS = 4;

/** Why a keycode can't be one of a combo's, or null: an empty or transparent key does nothing to press */
export function memberProblem(d: Described | undefined): string | null {
  if (!d || d.kind === "none") return "An empty key can't be part of a combo.";
  if (d.kind === "transparent") return "A transparent key can't be part of a combo.";
  return null;
}

/** The members with the keycode added, or taken out if it is one already; refused past MAX_COMBO_KEYS */
export function toggleMember(members: Described[], d: Described): { members: Described[]; problem: string | null } {
  if (members.some((m) => m.code === d.code)) return { members: members.filter((m) => m.code !== d.code), problem: null };
  const problem = memberProblem(d) ?? (members.length >= MAX_COMBO_KEYS
    ? `A combo has at most ${MAX_COMBO_KEYS} keys: take one out first.` : null);
  return problem ? { members, problem } : { members: [...members, d], problem: null };
}

/** A combo's keycodes: the firmware reads them up to the first empty slot (KC_NO ends the list), so keycodes after a
 * gap (a combo saved that way elsewhere) never count */
export function membersOf(combo: Combo): Described[] {
  const end = combo.keys.findIndex((k) => k.kind === "none");
  return end === -1 ? combo.keys : combo.keys.slice(0, end);
}

/** Whether a combo is set up: it has a keycode or an output */
export function isSet(combo: Combo): boolean {
  return combo.output.kind !== "none" || combo.keys.some((k) => k.kind !== "none");
}
