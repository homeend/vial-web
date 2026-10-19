// Keycodes as the server describes them, for steps and members made in the browser (a recorded key).
import type { Described, KeycodeCategory } from "../api/types";

/** The catalogue's description of a keycode, by its name or one of its aliases, or undefined */
export function catalogued(catalogue: KeycodeCategory[], code: string): Described | undefined {
  for (const category of catalogue) {
    const found = category.keycodes.find((k) => k.code === code || k.aliases.includes(code));
    if (found) return found;
  }
  return undefined;
}

/** A keycode described: from the catalogue, or else by the server (`parse`, e.g. for "LCTL(KC_L)") */
export async function describeCode(
  catalogue: KeycodeCategory[],
  code: string,
  parse: (expression: string) => Promise<Described>,
): Promise<Described> {
  return catalogued(catalogue, code) ?? parse(code);
}
