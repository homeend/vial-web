// The analysis in words, for the Overview and the Inspector: "hold Space", "one-shot (right outer thumb)",
// "switch from Layer 3 (right outer thumb)", "double-tap Tab to toggle", "combo: MO(5) + OSL(3)", "with Y → Esc".
import type { Described, KeyboardModel, LayerAction, TapDance } from "../api/types";
import { actionSummary, type Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import type { SlotLabel } from "../keymap/tapdance";
import { repeatedCodes, type ComboUse } from "./combos";
import type { Found, How } from "./find";
import type { LayerReach, ViaSlot, Way } from "./reach";

/** What a key does to the layer, as the verb of a label: "hold Space", "toggle (left outer thumb)" */
const VERBS: Record<LayerAction, string> = {
  "while held": "hold",
  toggle: "toggle",
  "switch to": "switch to it",
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

/** What a key types when tapped, when its label names it ("Space" for LT1(KC_SPC)), or null */
function typedName(d: Described): string | null {
  return LABELLED.has(d.kind) && d.tap ? d.tap : null;
}

/** What the key is called in a label: what it types when tapped ("Space" for LT1(KC_SPC), "Tab" for a tap dance that
 * taps Tab), or null when its label says nothing about it (MO 2, OSL 3, a tap dance tapping a layer key). A tap dance
 * that a tap dance taps isn't followed (as layerTargets doesn't): it may be the same one, or one that runs it back. */
export function tapName(d: Described, model: Pick<KeyboardModel, "tapDance">): string | null {
  if (d.kind === "tap-dance") {
    const tap = d.index != null ? model.tapDance[d.index]?.tap : undefined;
    return tap ? typedName(tap) : null;
  }
  return typedName(d);
}

/** A combo's keycode as a label: what it types, with a short note of what holding it does ("Space (hold: Layer 1)",
 * "T (hold: Shift)"); layer keys by their keycode ("MO(5)", or for one that has no name its label, with the modifiers
 * LM holds: "LM 1 (with Shift)"); tap dance and macro keys by their keycode ("TD(0)", "M1"); else what it types ("K",
 * "Esc") */
export function memberName(d: Described, names: Names): string {
  switch (d.kind) {
    case "layer":
      if (/^[A-Z]+\(\d+\)$/.test(d.code)) return d.code;
      return d.layerAction === "while held, with modifiers" && d.hold ? `${d.tap} (with ${d.hold})` : d.tap;
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
export function layerList(layers: number[], names: Names): string {
  return layers.map((l) => names.layer(l)).join(", ");
}

/** "Q", "Q and W", "Q, W and E" */
export function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Whether pressing a tap dance slot this way keeps the key held (so a layer held in it stays on) */
function isHeld(slot: SlotLabel): boolean {
  return slot === "Hold" || slot === "Tap, then hold";
}

/** The layer key a way runs: the key's own, or the one in the tap dance slot it goes through */
function layerKeyOf(way: Way, ctx: PhraseContext): Described | undefined {
  const via = way.via;
  if (via.type === "default" || via.type === "tri-layer") return undefined;
  const slot: ViaSlot | null = via.slot;
  if (slot) return ctx.model.tapDance[slot.tapDance]?.[SLOT_FIELDS[slot.slot]];
  return via.type === "key" ? via.action : via.combo.output;
}

/** What a way does with the layer, as pressed: a hold-or-toggle key (TT) in a held tap dance slot is held, so it just
 * holds the layer */
function actionOf(way: Way): LayerAction {
  const via = way.via;
  const held = (via.type === "key" || via.type === "combo") && via.slot !== null && isHeld(via.slot.slot);
  return held && way.action === "hold, or tap to toggle" ? "while held" : way.action;
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
    // "combo: J + K, held", "combo: J + K, tapped then held"; a layer held from another slot: "tapped and held"
    const purpose = PURPOSES[actionOf(way)] || (via.slot && !isHeld(via.slot.slot) ? " and held" : "");
    const slot = via.slot ? `, ${PARTICIPLES[via.slot.slot]}` : "";
    return `combo: ${comboName(via.combo.members, ctx.names)}${slot}${purpose}${mods}${from}`;
  }
  const name = via.slot?.slot === "Tap" ? null : tapName(via.action, ctx.model);
  const place = ctx.positions.get(refId(via.ref)) ?? "a key";
  if (via.slot) {
    // "hold Tab", "tap then hold Tab": holding the slot is holding the layer; other gestures say what they do
    const purpose = PURPOSES[actionOf(way)] || (isHeld(via.slot.slot) ? "" : " and hold");
    const gesture = GESTURES[via.slot.slot];
    return name ? `${gesture} ${name}${purpose}${mods}${from}` : `${gesture}${purpose}${mods}${from} (${place})`;
  }
  const verb = VERBS[way.action];
  return name ? `${verb} ${name}${mods}${from}` : `${verb}${mods}${from} (${place})`;
}

/** Where a way works, for the Inspector: "from any layer", "from Base, Nav", "the layer the keyboard starts on"; the
 * tap dance slot it goes through; for a combo that can't fire, why: its keycodes aren't all on one layer, or it has one
 * twice */
export function wayDetail(way: Way, ctx: PhraseContext): string {
  const via = way.via;
  if (via.type === "default") return "the layer the keyboard starts on";
  const parts: string[] = [];
  if (via.type !== "tri-layer" && via.slot) parts.push(`tap dance ${via.slot.tapDance}, ${via.slot.slot.toLowerCase()}`);
  const repeated = via.type === "combo" ? repeatedCodes(via.combo).map((d) => memberName(d, ctx.names)) : [];
  if (repeated.length > 0) {
    parts.push(`can't fire: it has ${andList(repeated)} twice`);
  } else if (way.from.length === 0) {
    parts.push("can't fire: its keys aren't all on one layer");
  } else {
    // a way never works on the layer it reaches: every other layer is all of them
    const anywhere = way.from.length === ctx.model.layers.length - 1;
    parts.push(anywhere ? "from any layer" : `from ${layerList(way.from, ctx.names)}`);
  }
  return parts.join(" · ");
}

/** Why a layer can't be reached, or null when it can. A way that works on no layer is a combo whose keycodes aren't on
 * the keymap, or that has one twice (combo outputs are the only ways layerReach keeps with no layers): it can't fire. */
export function unreachedReason(reach: LayerReach): string | null {
  if (reach.reachable) return null;
  if (reach.ways.some((w) => w.from.length > 0)) return "Only reached from layers that nothing reaches";
  // a combo with a tap dance output can reach the layer from several slots: count it once
  const dead = new Set(reach.ways.map((w) => (w.via.type === "combo" ? `combo:${w.via.combo.index}` : w.via.type)));
  if (dead.size === 0) return "Nothing reaches this layer";
  return dead.size === 1
    ? "Only a combo that can't fire reaches this layer"
    : "Only combos that can't fire reach this layer";
}

/** A combo a key is part of, from that key's side: "with OSL(3) → Layer 2, while held",
 * "with Space (hold: Layer 1) → Layer 2, while held", "with Y → Esc", "with B → Space (hold: Layer 1)" */
export function comboUseLabel(use: ComboUse, names: Names): string {
  const partners = use.partners.length > 0 ? `with ${comboName(use.partners, names)}` : "on its own";
  const output = use.combo.output;
  const does = output.kind === "layer-tap" || output.kind === "mod-tap"
    ? memberName(output, names)
    : actionSummary(output, names).tap;
  return `${partners} → ${does}`;
}

/** Why a combo a key is part of can't fire on the layer, or null: it lists a keycode twice ("It has A twice, so it
 * never fires"), or partners aren't on any key of the layer ("Y isn't on this layer") */
export function missingPartners(use: ComboUse, names: Names): string | null {
  const repeated = repeatedCodes(use.combo).map((d) => memberName(d, names));
  if (repeated.length > 0) return `It has ${andList(repeated)} twice, so it never fires`;
  const missing = use.partners.filter((p) => p.keys.length === 0).map((p) => memberName(p.action, names));
  if (missing.length === 0) return null;
  return `${andList(missing)} ${missing.length === 1 ? "isn't" : "aren't"} on this layer`;
}

/** What a keycode is pressed as to produce what was found: "2" (tapped, or by its name), "Shift + 2", "AltGr + A" */
export function howText(how: How, d: Described): string {
  const key = d.legend.main || d.tap || d.code;
  return how === "shift" ? `Shift + ${key}` : how === "altgr" ? `AltGr + ${key}` : key;
}

/** A place a character or key was found, in words: "Shift + 2 on Base (left top row, 2nd from the outside)",
 * "tap dance 0, double tap: Caps Lock", "combo M + C → Enter", "key override 0: Del instead of Bksp",
 * "macro 0 types "git status"" */
export function foundLabel(found: Found, ctx: PhraseContext): string {
  switch (found.type) {
    case "key": {
      const place = ctx.positions.get(refId(found.ref)) ?? "a key";
      return `${howText(found.how, found.action)} on ${ctx.names.layer(found.layer)} (${place})`;
    }
    case "tap-dance":
      return `tap dance ${found.tapDance}, ${found.slot.toLowerCase()}: ${howText(found.how, found.action)}`;
    case "combo":
      return `combo ${comboName(found.combo.members, ctx.names)} → ${howText(found.how, found.action)}`;
    case "key-override":
      return `key override ${found.keyOverride}: ${howText(found.how, found.action)} instead of ${
        found.trigger.tap || found.trigger.code}`;
    case "macro":
      if (found.how === "text" || !found.action) return `macro ${found.macro} types "${found.text ?? ""}"`;
      return `macro ${found.macro} presses ${howText(found.how, found.action)}`;
  }
}

/** What a key's combo marks say, after its name: " · in combo 0", " · in combos 0 and 2", or "" */
export function comboMarkLabel(combos: number[]): string {
  if (combos.length === 0) return "";
  return combos.length === 1 ? ` · in combo ${combos[0]}` : ` · in combos ${andList(combos.map(String))}`;
}
