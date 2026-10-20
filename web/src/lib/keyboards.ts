// The keyboard selector: the Vial keyboards plugged in (and the chosen one while it is unplugged), as the top bar
// offers them.
import type { KeyboardEntry, KeyboardList } from "../api/types";

/** names longer than this are cut short in the selector (the tooltip has them whole) */
const NAME_MAX = 40;

export interface KeyboardOption {
  id: string;
  /** what the selector shows: the name, cut short when it is long, and what tells it apart */
  label: string;
  /** the same, whole: the tooltip */
  full: string;
  /** its name and what tells it apart, whole, without "(unplugged)": "Corne (2)" */
  name: string;
}

function shortened(text: string): string {
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1).trimEnd()}…` : text;
}

/** Each keyboard as the selector offers it. Keyboards of the same name are told apart by their serial numbers when
 * each has its own, else by their order: "Corne (1)", "Corne (2)". */
export function keyboardOptions(list: KeyboardList | null): KeyboardOption[] {
  const entries = list?.keyboards ?? [];
  return entries.map((entry) => {
    const alike = entries.filter((e) => e.name === entry.name);
    let tell = "";
    if (alike.length > 1) {
      const serials = new Set(alike.map((e) => e.serial ?? null));
      tell = entry.serial && !serials.has(null) && serials.size === alike.length
        ? ` (${entry.serial})` : ` (${alike.indexOf(entry) + 1})`;
    }
    const away = entry.plugged ? "" : " (unplugged)";
    return { id: entry.id, label: shortened(entry.name) + tell + away, full: entry.name + tell + away,
      name: entry.name + tell };
  });
}

/** The keyboard the selector shows: the one open, else the one chosen; "" when there is neither */
export function shownKeyboard(list: KeyboardList | null): string {
  return list?.keyboards.find((k) => k.open)?.id ?? list?.chosen ?? "";
}

/** The chosen keyboard while it is unplugged (it is opened again once it is plugged back in), or null */
export function chosenAway(list: KeyboardList | null): KeyboardEntry | null {
  if (!list?.chosen) return null;
  return list.keyboards.find((k) => k.id === list.chosen && !k.plugged) ?? null;
}

/** A reason from the server ("could not list keyboards: ...") as a sentence: capitalised, with a full stop */
export function asSentence(reason: string): string {
  const text = reason.trim();
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?…]$/.test(text) ? "" : ".");
}
