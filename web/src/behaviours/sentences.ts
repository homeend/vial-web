// Tap dances and combos in plain words, for their cards: "Tap for Tab, double-tap for Caps Lock.", "Press K + Y
// together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held."
import { comboLayers, repeatedCodes, type ComboInfo } from "../analysis/combos";
import { andList, comboName, layerList, memberName } from "../analysis/phrases";
import { layerTargets } from "../analysis/reach";
import type { Use } from "../analysis/usage";
import type { Described, KeyboardModel, LayerAction, TapDance } from "../api/types";
import { actionSummary, layerLabel, type Names } from "../keyboard/labels";
import { refId, type KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

/** How a tap dance slot is pressed, at the start of a sentence's part: "double-tap for Caps Lock" */
const GESTURES: Record<SlotLabel, string> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "double-tap",
  "Tap, then hold": "tap then hold",
};

/** The same, for a combo running the tap dance: "reaches Layer 2 when held", "is double-tapped to toggle Layer 2" */
const PARTICIPLES: Record<SlotLabel, string> = {
  Tap: "tapped",
  Hold: "held",
  "Double tap": "double-tapped",
  "Tap, then hold": "tapped then held",
};

/** What a layer key does with its layer, after "reaches Layer 2" */
const LAYER_WAYS: Record<LayerAction, string> = {
  "while held": ", while held",
  toggle: ", toggled on or off",
  "switch to": ", switched to",
  "one-shot": ", for the next key",
  "hold, or tap to toggle": ", held or toggled",
  default: ", as the default layer",
  "default (saved)": ", as the default layer for good",
  "while held, with modifiers": ", while held",
};

/** Whether pressing a tap dance slot this way keeps the key held, so a layer held in it stays on (as in phrases.ts) */
function isHeld(slot: SlotLabel): boolean {
  return slot === "Hold" || slot === "Tap, then hold";
}

/** Whether a keycode does nothing in a tap dance slot or as a combo's output: empty, or transparent (QMK has no layer
 * below a tap dance or a combo for it to fall through to) */
function doesNothing(d: Described): boolean {
  return d.kind === "none" || d.kind === "transparent";
}

/** Whether a keycode turns its layer on only while it is held, and does nothing when tapped: MO, LM, a layer-tap with
 * nothing to tap */
function holdsLayer(d: Described): boolean {
  if (d.kind === "layer") return d.layerAction === "while held" || d.layerAction === "while held, with modifiers";
  return d.kind === "layer-tap" && d.layer != null && !d.tap;
}

/** What a layer key in a tap dance slot does, as that slot presses it: a hold-or-toggle key (TT) in a held slot is
 * held, so it just holds the layer (as actionOf in phrases.ts) */
function asPressed(d: Described, slot: SlotLabel): Described {
  return isHeld(slot) && d.kind === "layer" && d.layerAction === "hold, or tap to toggle"
    ? { ...d, layerAction: "while held" }
    : d;
}

/** Whether a layer number is one of the keyboard's layers (a keycode can name one the keyboard doesn't have) */
function hasLayer(model: Pick<KeyboardModel, "layers">, layer: number): boolean {
  return Number.isInteger(layer) && layer >= 0 && layer < model.layers.length;
}

/** What a keycode does, after the gesture that runs it: "for Tab", "to toggle Layer 2", "for Space (hold: Shift)",
 * "for tap dance 0", "for one-shot Shift". A layer-tap with nothing to tap is its layer: "for Layer 1". */
export function outcome(d: Described, names: Names): string {
  switch (d.kind) {
    case "none":
    case "transparent":
      return "for nothing";
    case "layer":
      return d.layer != null ? layerOutcome(d, d.layer, names) : `for ${d.tap || d.code}`;
    case "layer-tap":
      return !d.tap && d.layer != null ? `for ${layerLabel(d.layer, names)}` : `for ${memberName(d, names)}`;
    case "mod-tap":
    case "one-shot-mod":
      return `for ${memberName(d, names)}`;
    case "tap-dance":
    case "macro": {
      if (d.index == null) return `for ${d.code}`;
      const what = d.kind === "tap-dance" ? "tap dance" : "macro";
      const name = d.kind === "tap-dance" ? names.tapDance(d.index) : names.macro(d.index);
      return `for ${what} ${d.index}${name ? ` · ${name}` : ""}`;
    }
    default:
      return `for ${actionSummary(d, names).tap}`;
  }
}

/** What a layer key does with its layer: "for Layer 1", "to toggle Layer 2" */
function layerOutcome(d: Described, index: number, names: Names): string {
  const layer = layerLabel(index, names);
  switch (d.layerAction) {
    case "toggle":
      return `to toggle ${layer}`;
    case "switch to":
      return `to switch to ${layer}`;
    case "one-shot":
      return `for ${layer} on the next key`;
    case "hold, or tap to toggle":
      return `to hold or toggle ${layer}`;
    case "default":
      return `to make ${layer} the default layer`;
    case "default (saved)":
      return `to make ${layer} the default layer for good`;
    case "while held, with modifiers":
      return d.hold ? `for ${layer} with ${d.hold}` : `for ${layer}`;
    default:
      return `for ${layer}`;
  }
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A way of pressing a tap dance, and what it does: "double-tap for Caps Lock". A layer held from a tapped slot is on
 * only while the key stays down after the last tap: "tap and hold for Layer 1" (as wayLabel in phrases.ts). */
function slotPhrase(slot: SlotLabel, d: Described, names: Names): string {
  const pressed = asPressed(d, slot);
  const hold = holdsLayer(pressed) && !isHeld(slot) ? " and hold" : "";
  return `${GESTURES[slot]}${hold} ${outcome(pressed, names)}`;
}

/** "Tap for Tab, double-tap for Caps Lock." Empty and transparent slots are left out. */
export function tapDanceSentence(td: TapDance, names: Names): string {
  const parts = tapDanceSlots(td)
    .filter((slot) => !doesNothing(slot.action))
    .map((slot) => slotPhrase(slot.label, slot.action, names));
  return parts.length === 0 ? "Does nothing yet: choose what each way of pressing it does." : `${capitalised(parts.join(", "))}.`;
}

/** What a tap dance a combo runs does to each layer it reaches, after "which": "reaches Layer 1 when held", "reaches
 * Layer 1 when tapped and held" (a layer held from a tapped slot), "is double-tapped to toggle Layer 2" */
function tapDanceReach(model: Pick<KeyboardModel, "layers" | "tapDance">, output: Described, names: Names): string[] {
  return layerTargets(model, output).flatMap((t) => {
    const slot = t.slot?.slot;
    const td = t.slot ? model.tapDance[t.slot.tapDance] : undefined;
    const d = td && slot ? tapDanceSlots(td).find((s) => s.label === slot)?.action : undefined;
    if (!slot || !d) return [];
    const action = isHeld(slot) && t.action === "hold, or tap to toggle" ? "while held" : t.action;
    if (action === "while held" || action === "while held, with modifiers") {
      const mods = action === "while held, with modifiers" && d.hold ? ` with ${d.hold}` : "";
      return [`reaches ${layerLabel(t.layer, names)}${mods} when ${PARTICIPLES[slot]}${isHeld(slot) ? "" : " and held"}`];
    }
    return [`is ${PARTICIPLES[slot]} ${outcome(d, names)}`];
  });
}

/** "Press K + Y together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held.", "Press K for
 * Esc." (a combo of one key), "Hold K + Y together → reaches Layer 1." (a layer-tap with nothing to tap) */
export function comboSentence(combo: Pick<ComboInfo, "members" | "output">, model: Pick<KeyboardModel, "layers" | "tapDance">,
  names: Names): string {
  if (combo.members.length === 0) return "No keys chosen yet.";
  const several = combo.members.length > 1;
  const keys = `${comboName(combo.members, names)}${several ? " together" : ""}`;
  const output = combo.output;
  if (doesNothing(output)) return `Press ${keys}: it does nothing yet.`;
  if ((output.kind === "layer" || output.kind === "layer-tap") && output.layer != null && output.layerAction) {
    const layer = layerLabel(output.layer, names);
    const missing = !hasLayer(model, output.layer);
    const where = missing ? ` for ${layer}, which this keyboard doesn't have` : ` → reaches ${layer}`;
    if (output.kind === "layer-tap") {
      return output.tap
        ? `Press ${keys} for ${output.tap}, or hold ${several ? "them" : "it"}${where}.`
        : `Hold ${keys}${where}.`;
    }
    if (missing) return `Press ${keys} ${outcome(output, names)}, which this keyboard doesn't have.`;
    const mods = output.layerAction === "while held, with modifiers" && output.hold ? `, with ${output.hold}` : "";
    return `Press ${keys}${where}${LAYER_WAYS[output.layerAction]}${mods}.`;
  }
  const reached = output.kind === "tap-dance" ? tapDanceReach(model, output, names) : [];
  return `Press ${keys} ${outcome(output, names)}${reached.length > 0 ? `, which ${andList(reached)}` : ""}.`;
}

/** Why a combo can't fire, or how its keys are found: "It has A twice, so it never fires.", "Y isn't on any key, so
 * it can't fire.", "K is on 2 keys of the base layer: either one works." (only said of a combo that fires).
 * layerCodes: by layer, codesOn's maps. */
export function comboNotes(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[], names: Names): string[] {
  const repeated = repeatedCodes(combo).map((d) => memberName(d, names));
  if (repeated.length > 0) return [`It has ${andList(repeated)} twice, so it never fires.`];
  const fires = comboLayers(combo, layerCodes);
  const be = (items: string[]) => (items.length === 1 ? "isn't" : "aren't");
  if (fires.length === 0) {
    const nowhere = combo.members
      .filter((m) => !layerCodes.some((codes) => codes.has(m.action.code)))
      .map((m) => memberName(m.action, names));
    return [nowhere.length > 0
      ? `${andList(nowhere)} ${be(nowhere)} on any key, so it can't fire.`
      : "Its keys aren't all on one layer, so it can't fire."];
  }
  const notes: string[] = [];
  const offBase = combo.members.filter((m) => m.keys.length === 0).map((m) => memberName(m.action, names));
  if (offBase.length > 0) {
    notes.push(`${andList(offBase)} ${be(offBase)} on the base layer: it fires on ${layerList(fires, names)}.`);
  }
  for (const m of combo.members) {
    if (m.keys.length > 1) notes.push(`${memberName(m.action, names)} is on ${m.keys.length} keys of the base layer: either one works.`);
  }
  return notes;
}

/** Something that uses a tap dance or macro, in words: "Base, left inner thumb", "combo 1's output", "tap dance 0,
 * double tap", "macro 2, step 3", "key override 0's replacement" */
export function useLabel(use: Use, names: Names, positions: Map<string, string>): string {
  switch (use.type) {
    case "key":
      return `${names.layer(use.layer)}, ${positions.get(refId(use.ref)) ?? "a key"}`;
    case "combo":
      return use.part === "output" ? `combo ${use.combo}'s output` : `combo ${use.combo}'s keys`;
    case "tap-dance":
      return `tap dance ${use.tapDance}, ${use.slot.toLowerCase()}`;
    case "macro":
      return `macro ${use.macro}, step ${use.step + 1}`;
    case "key-override":
      return `key override ${use.keyOverride}'s ${use.part}`;
    case "alt-repeat":
      return `alt-repeat key ${use.altRepeat}'s ${use.part}`;
  }
}
