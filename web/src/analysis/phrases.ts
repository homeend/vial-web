// The analysis in words, for the Overview and the Inspector: "hold Space", "one-shot (right outer thumb)",
// "switch from Layer 3 (right outer thumb)", "double-tap Tab to toggle", "combo: MO(5) + OSL(3)", "with Y → Esc".
import type { Described, KeyboardModel, TapDance } from "../api/types";
import { actionSummary, type Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import type { SlotLabel } from "../keymap/tapdance";
import type { ComboUse } from "./combos";
import type { LayerAction, LayerReach, ViaSlot, Way } from "./reach";

/** What a key does to the layer, as the verb of a label: "hold Space", "toggle (left outer thumb)" */
const VERBS: Record<LayerAction, string> = {
  "while held": "hold",
  toggle: "toggle",
  "switch to": "switch",
  "hold, or tap to toggle": "hold or toggle",
  "one-shot": "one-shot",
  default: "make default",
  "default (saved)": "make default for good",
  "while held, with modifiers": "hold",
};

/** The same, after a gesture: "double-tap Tab to toggle", "combo: J + K for a one-shot" */
const PURPOSES: Record<LayerAction, string> = {
  "while held": "",
  toggle: " to toggle",
  "switch to": " to switch",
  "hold, or tap to toggle": " to hold or toggle",
  "one-shot": " for a one-shot",
  default: " to make it default",
  "default (saved)": " to make it default for good",
  "while held, with modifiers": "",
};

/** How a tap dance slot is pressed: "double-tap Tab" */
const GESTURES: Record<SlotLabel, string> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "double-tap",
  "Tap, then hold": "tap then hold",
};

/** The same for a combo: "combo: J + K, double-tapped" */
const PARTICIPLES: Record<SlotLabel, string> = {
  Tap: "tapped",
  Hold: "held",
  "Double tap": "double-tapped",
  "Tap, then hold": "tapped then held",
};

const SLOT_FIELDS: Record<SlotLabel, keyof Pick<TapDance, "tap" | "hold" | "doubleTap" | "tapHold">> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "doubleTap",
  "Tap, then hold": "tapHold",
};

/** kinds whose tap label names the key: what it types, rather than what it does (MO 2, TD 0, M 1) */
const LABELLED = new Set<Described["kind"]>(["basic", "modifier", "mod-tap", "layer-tap", "mouse", "media", "lighting", "other"]);

export interface PhraseContext {
  model: Pick<KeyboardModel, "layers" | "tapDance">;
  names: Names;
  /** every placed key's position in words, by refId (positionNames) */
  positions: Map<string, string>;
}

/** What the key is called in a label: what it types when tapped ("Space" for LT1(KC_SPC), "Tab" for a tap dance that
 * taps Tab), or null when its label says nothing about it (MO 2, OSL 3, a tap dance tapping a layer key) */
export function tapName(d: Described, model: Pick<KeyboardModel, "tapDance">): string | null {
  if (d.kind === "tap-dance") {
    const tap = d.index != null ? model.tapDance[d.index]?.tap : undefined;
    return tap ? tapName(tap, model) : null;
  }
  return LABELLED.has(d.kind) && d.tap ? d.tap : null;
}

/** A combo's keycode as a label: what it types, with a short note of what holding it does ("Space (hold: Layer 1)",
 * "T (hold: Shift)"); layer keys by their keycode ("MO(5)", or "LM 1" for one that has no name); tap dance and macro
 * keys by their keycode ("TD(0)", "M1"); else what it types ("K", "Esc") */
export function memberName(d: Described, names: Names): string {
  switch (d.kind) {
    case "layer":
      return /^[A-Z]+\(\d+\)$/.test(d.code) ? d.code : d.tap;
    case "tap-dance":
    case "macro":
      return d.code;
    case "layer-tap":
      return `${d.tap || "nothing"} (hold: ${d.layer != null ? names.layer(d.layer) : d.hold ?? "a layer"})`;
    case "mod-tap":
      return `${d.tap || "nothing"} (hold: ${d.hold ?? "modifiers"})`;
    case "one-shot-mod":
      return `one-shot ${d.tap}`;
    default:
      return d.tap || d.code;
  }
}

/** "MO(5) + OSL(3)" */
export function comboName(members: { action: Described }[], names: Names): string {
  return members.map((m) => memberName(m.action, names)).join(" + ");
}

/** "Base", "Layer 1, Nav" */
function layerList(layers: number[], names: Names): string {
  return layers.map((l) => names.layer(l)).join(", ");
}

/** The layer key a way runs: the key's own, or the one in the tap dance slot it goes through */
function layerKeyOf(way: Way, ctx: PhraseContext): Described | undefined {
  const via = way.via;
  if (via.type === "default" || via.type === "tri-layer") return undefined;
  const slot: ViaSlot | null = via.slot;
  if (slot) return ctx.model.tapDance[slot.tapDance]?.[SLOT_FIELDS[slot.slot]];
  return via.type === "key" ? via.action : via.combo.output;
}

/** " with Shift" for LM, a layer held with modifiers */
function modifiers(way: Way, ctx: PhraseContext): string {
  const hold = way.action === "while held, with modifiers" ? layerKeyOf(way, ctx)?.hold : null;
  return hold ? ` with ${hold}` : "";
}

/** A way to reach a layer, as a short label that reads as an instruction:
 * - "default layer";
 * - keys: "hold Space", "one-shot (right outer thumb)", "toggle (left top row, 3rd from the outside)",
 *   "hold with Shift (left inner thumb)";
 * - tap dance slots: "hold Tab", "double-tap Tab to toggle", "tap for a one-shot (right inner thumb)";
 * - combos: "combo: MO(5) + OSL(3)", "combo: J + K, double-tapped to toggle";
 * - the tri-layer keys: "hold both Fn keys (left inner thumb and right inner thumb)".
 * A way that doesn't work on the base layer says where it starts: "switch from Layer 3 (right outer thumb)". */
export function wayLabel(way: Way, ctx: PhraseContext): string {
  const via = way.via;
  if (via.type === "default") return "default layer";
  const from = way.from.length > 0 && !way.from.includes(0) ? ` from ${layerList(way.from, ctx.names)}` : "";
  const mods = modifiers(way, ctx);
  if (via.type === "tri-layer") {
    const places = via.keys.map((k) => ctx.positions.get(refId(k.ref)) ?? "a key");
    return `hold both Fn keys${from} (${places.join(" and ")})`;
  }
  if (via.type === "combo") {
    const slot = via.slot ? `, ${PARTICIPLES[via.slot.slot]}` : "";
    return `combo: ${comboName(via.combo.members, ctx.names)}${slot}${PURPOSES[way.action]}${mods}${from}`;
  }
  const name = via.slot?.slot === "Tap" ? null : tapName(via.action, ctx.model);
  const place = ctx.positions.get(refId(via.ref)) ?? "a key";
  if (via.slot) {
    // "hold Tab", "tap then hold Tab": holding the slot is holding the layer; other gestures say what they do
    const held = via.slot.slot === "Hold" || via.slot.slot === "Tap, then hold";
    const purpose = PURPOSES[way.action] || (held ? "" : " and hold");
    const gesture = GESTURES[via.slot.slot];
    return name ? `${gesture} ${name}${purpose}${mods}${from}` : `${gesture}${purpose}${mods}${from} (${place})`;
  }
  const verb = VERBS[way.action];
  return name ? `${verb} ${name}${mods}${from}` : `${verb}${mods}${from} (${place})`;
}

/** Where a way works, for the Inspector: "from any layer", "from Base, Nav", "the layer the keyboard starts on"; the
 * tap dance slot it goes through; for a combo whose keycodes aren't on any key, that it can't fire */
export function wayDetail(way: Way, ctx: PhraseContext): string {
  const via = way.via;
  if (via.type === "default") return "the layer the keyboard starts on";
  const parts: string[] = [];
  if (via.type !== "tri-layer" && via.slot) parts.push(`tap dance ${via.slot.tapDance}, ${via.slot.slot.toLowerCase()}`);
  if (way.from.length === 0) {
    parts.push("can't fire: its keys aren't all on one layer");
  } else {
    // a way never works on the layer it reaches: every other layer is all of them
    const anywhere = way.from.length === ctx.model.layers.length - 1;
    parts.push(anywhere ? "from any layer" : `from ${layerList(way.from, ctx.names)}`);
  }
  return parts.join(" · ");
}

/** Why a layer can't be reached, or null when it can */
export function unreachedReason(reach: LayerReach): string | null {
  if (reach.reachable) return null;
  return reach.ways.length === 0 ? "Nothing reaches this layer" : "Only reached from layers that nothing reaches";
}

/** A combo a key is part of, from that key's side: "with OSL(3) → Layer 2, while held",
 * "with Space (hold: Layer 1) → Layer 2, while held", "with Y → Esc" */
export function comboUseLabel(use: ComboUse, names: Names): string {
  const partners = use.partners.length > 0 ? `with ${comboName(use.partners, names)}` : "on its own";
  return `${partners} → ${actionSummary(use.combo.output, names).tap}`;
}

/** The partners of a combo that aren't on any key of the layer, or null: "Y isn't on this layer" */
export function missingPartners(use: ComboUse, names: Names): string | null {
  const missing = use.partners.filter((p) => p.keys.length === 0).map((p) => memberName(p.action, names));
  if (missing.length === 0) return null;
  return `${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} on this layer`;
}
