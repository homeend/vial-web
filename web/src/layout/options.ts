// The layout options form: one row per option of the keyboard's vial.json, as Qt's Layout tab shows them.
import type { LayoutOptions } from "../api/types";
import { layoutChoices } from "../keyboard/geometry";

export interface OptionRow {
  index: number;
  /** the option's name, as vial.json gives it */
  name: string;
  /** "switch": on or off (a name alone); "list": one of its choices */
  kind: "switch" | "list";
  /** what the keyboard holds: 0 or 1 for a switch, the choice's number for a list */
  choice: number;
  /** a list's choices; one the keyboard holds beyond them is added, named by its number */
  choices: string[];
}

export function optionRows(options: LayoutOptions): OptionRow[] {
  const held = layoutChoices(options);
  return options.labels.map((label, index) => {
    const choice = held[index] ?? 0;
    if (typeof label === "string") return { index, name: label, kind: "switch", choice, choices: [] };
    const [name = `Option ${index + 1}`, ...listed] = label;
    const choices = choice < listed.length ? listed : [...listed, ...Array.from(
      { length: choice - listed.length + 1 }, (_, i) => `Choice ${listed.length + i} (not one of the keyboard's)`,
    )];
    return { index, name, kind: "list", choice, choices };
  });
}
