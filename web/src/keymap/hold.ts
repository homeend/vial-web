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

/** The layers a layer-tap (LT) can hold: the firmware keeps the layer in 4 bits */
export const HOLD_LAYERS = 16;

/** How many of a keyboard's layers a hold action can switch to (layers 0 to the count - 1) */
export function holdLayerCount(layers: number): number {
  return Math.min(layers, HOLD_LAYERS);
}

/** The keycode a key types when tapped, if it can have a hold action added or changed; else null. The server works
 * it out (Described.tapCode): the tapped key of a layer-tap or mod-tap, KC_NO included so a hold-only key's hold can
 * change, or a basic keycode itself; never for KC_NO or KC_TRNS keys, nor keys such as KC_GESC that can't take a
 * hold. */
export function tapCodeOf(d: Pick<Described, "tapCode">): string | null {
  return d.tapCode ?? null;
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

/** The keycode expression for a tapped keycode with a hold action, for the server to parse. Throws a RangeError for
 * a layer a layer-tap can't hold (offer layers below holdLayerCount). */
export function holdExpression(tap: string, hold: Hold): string {
  if (hold?.type === "layer") {
    if (!Number.isInteger(hold.layer) || hold.layer < 0 || hold.layer >= HOLD_LAYERS) {
      throw new RangeError(`a layer-tap can only hold layers 0 to ${HOLD_LAYERS - 1}, not ${hold.layer}`);
    }
    return `LT(${hold.layer}, ${tap})`;
  }
  if (hold?.type === "mods" && hold.mods.length > 0) {
    const side = hold.right ? "R" : "L";
    return `MT(${hold.mods.map((m) => `MOD_${side}${m}`).join(" | ")}, ${tap})`;
  }
  return tap;
}
