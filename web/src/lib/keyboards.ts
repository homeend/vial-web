// The keyboard selector: the Vial keyboards plugged in (and the chosen one while it is unplugged), as the top bar
// offers them.
import type { KeyboardEntry, KeyboardList, Session } from "../api/types";

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

/** The number the server gives a keyboard among those alike (its id ends "#2"), or null */
function numberOf(entry: KeyboardEntry): number | null {
  const found = /#(\d+)$/.exec(entry.id);
  return found ? Number(found[1]) : null;
}

/** Each keyboard as the selector offers it. Keyboards of the same name are told apart by their serial numbers when
 * each has its own, else by the number the server gives each (which it keeps while it stays plugged in, whatever
 * comes and goes beside it): "Corne (1)", "Corne (2)"; by their order if those don't tell them apart either. */
export function keyboardOptions(list: KeyboardList | null): KeyboardOption[] {
  const entries = list?.keyboards ?? [];
  return entries.map((entry) => {
    const alike = entries.filter((e) => e.name === entry.name);
    let tell = "";
    if (alike.length > 1) {
      const serials = new Set(alike.map((e) => e.serial ?? null));
      const numbers = new Set(alike.map(numberOf));
      tell = entry.serial && !serials.has(null) && serials.size === alike.length
        ? ` (${entry.serial})`
        : !numbers.has(null) && numbers.size === alike.length
          ? ` (${numberOf(entry)})`
          : ` (${alike.indexOf(entry) + 1})`;
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

/** Why the keyboard shown (greyed out: it can't be changed) is blocked: "list", looking for keyboards failed; "unread",
 * it is plugged in, but couldn't be read (the error is about it); else "unplugged". An error about another keyboard
 * (one plugged in beside it, tried when none is chosen) doesn't make it unreadable. */
export function blockedWhy(
  session: Pick<Session, "error" | "errorKind"> | null, list: KeyboardList | null, shown: string | null,
): "list" | "unread" | "unplugged" {
  if (!session?.error) return "unplugged";
  if (session.errorKind === "list") return "list";
  const plugged = shown !== null && (list?.keyboards.some((k) => k.id === shown && k.plugged) ?? false);
  return session.errorKind === "read" && plugged ? "unread" : "unplugged";
}

/** What the page says when the keyboard can't be read, in the banner over a keyboard shown and on the empty page alike:
 * looking for keyboards failed ("list", the session's errorKind), or one found couldn't be read ("unread"). The
 * server's reason goes between the title and `retry`. */
export const READ_PROBLEMS = {
  list: { title: "Vial couldn't look for keyboards", retry: "Vial tries again by itself, about once a second." },
  unread: {
    title: "A keyboard was found, but couldn't be read",
    retry: "Vial tries again by itself, and when it is plugged in again.",
  },
} as const;
