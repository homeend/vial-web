// "Change hold": the hold action of a key, as a layer-tap (LT) or mod-tap (MT).
import type { Described } from "../api/types";

export type Mod = "CTL" | "SFT" | "ALT" | "GUI";
export const MODS: { mod: Mod; label: string }[] = [
  { mod: "CTL", label: "Ctrl" },
  { mod: "SFT", label: "Shift" },
  { mod: "ALT", label: "Alt" },
  { mod: "GUI", label: "Gui" },
];

export type Hold = { type: "layer"; layer: number } | { type: "mods"; mods: Mod[]; right: boolean } | null;

const LAYER_TAP = /^LT\d+\((KC_\w+)\)$/;
const MOD_TAP = /^\w+_T\((KC_\w+)\)$/;
const BASIC = /^KC_\w+$/;
const NO_TAP = new Set(["KC_NO", "KC_TRNS"]);

/** The keycode a key types when tapped, if it can have a hold action added or changed; else null */
export function tapCodeOf(code: string): string | null {
  const inner = LAYER_TAP.exec(code)?.[1] ?? MOD_TAP.exec(code)?.[1] ?? (BASIC.test(code) ? code : null);
  return inner && !NO_TAP.has(inner) ? inner : null;
}

const MOD_WORDS: Record<string, Mod[]> = {
  ctrl: ["CTL"], shift: ["SFT"], alt: ["ALT"], gui: ["GUI"], altgr: ["ALT"],
  meh: ["CTL", "SFT", "ALT"], hyper: ["CTL", "SFT", "ALT", "GUI"],
};

/** The current hold action of a key, read from its description (mod-tap modifiers from the hold label the server
 * gives, e.g. "Ctrl+Shift" or "AltGr") */
export function holdOf(d: Pick<Described, "kind" | "layer" | "hold">): Hold {
  if (d.kind === "layer-tap" && d.layer != null) return { type: "layer", layer: d.layer };
  if (d.kind !== "mod-tap" || !d.hold) return null;
  const words = d.hold.split("+");
  const right = words.some((w) => w === "AltGr" || /^R[A-Z]/.test(w));
  const mods = new Set<Mod>();
  for (const word of words) {
    const key = word.toLowerCase().replace(/^r(?=ctrl|shift|alt$|gui)/, "");
    for (const mod of MOD_WORDS[key] ?? []) mods.add(mod);
  }
  return { type: "mods", mods: MODS.map((m) => m.mod).filter((m) => mods.has(m)), right };
}

/** The keycode expression for a tapped keycode with a hold action, for the server to parse */
export function holdExpression(tap: string, hold: Hold): string {
  if (hold?.type === "layer") return `LT(${hold.layer}, ${tap})`;
  if (hold?.type === "mods" && hold.mods.length > 0) {
    const side = hold.right ? "R" : "L";
    return `MT(${hold.mods.map((m) => `MOD_${side}${m}`).join(" | ")}, ${tap})`;
  }
  return tap;
}
