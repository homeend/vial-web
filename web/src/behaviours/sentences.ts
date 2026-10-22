// Tap dances and combos in plain words, for their cards: "Tap for Tab, double-tap for Caps Lock.", "Press K + Y
// together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held."
import { comboLayers, repeatedCodes, type ComboInfo } from "../analysis/combos";
import { andList, comboName, layerList, memberName } from "../analysis/phrases";
import { layerTargets } from "../analysis/reach";
import { capitalised } from "../lib/text";
import type { Use } from "../analysis/usage";
import type { Described, KeyboardModel, LayerAction, TapDance } from "../api/types";
import { actionSummary, layerLabel, type Names } from "../keyboard/labels";
import { refId, type KeyRef } from "../keyboard/refs";
import { isHeldSlot, slotCanBeHeld, tapDanceSlots, type SlotLabel } from "../keymap/tapdance";

/** How a tap dance slot is pressed, at the start of a sentence's part: "double-tap for Caps Lock" */
const GESTURES: Record<SlotLabel, string> = {
  Tap: "tap",
  Hold: "hold",
  "Double tap": "double-tap",
  "Tap, then hold": "tap then hold",
};

/** The same, for a combo running the tap dance: "reaches Layer 2 when held", "toggles Layer 2 when double-tapped" */
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
 * held, so it just holds the layer (as actionOf in phrases.ts); in a slot that is never held (slotCanBeHeld) it is
 * only tapped, so it just toggles it (as layerTargets in reach.ts) */
function asPressed(d: Described, td: TapDance, slot: SlotLabel): Described {
  if (d.kind !== "layer" || d.layerAction !== "hold, or tap to toggle") return d;
  if (isHeldSlot(slot)) return { ...d, layerAction: "while held" };
  return slotCanBeHeld(td, slot) ? d : { ...d, layerAction: "toggle" };
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

/** Why a layer held while its key is down is never on from a tap dance slot the firmware never keeps held */
const NEVER_HELD: Partial<Record<SlotLabel, string>> = {
  Tap: "which does nothing: holding the key runs Hold instead",
  "Double tap": "which does nothing: a double tap isn't held",
};

/** A way of pressing a tap dance, and what it does: "double-tap for Caps Lock". A layer held from a tapped slot is on
 * only while the key stays down after the last tap: "tap and hold for Layer 1" (as wayLabel in phrases.ts); from a
 * slot the firmware never keeps held (slotCanBeHeld), never: "double-tap for Layer 1, which does nothing: …". */
function slotPhrase(td: TapDance, slot: SlotLabel, d: Described, names: Names,
  model?: Pick<KeyboardModel, "layers">): string {
  const pressed = asPressed(d, td, slot);
  const holds = holdsLayer(pressed);
  const held = slotCanBeHeld(td, slot);
  const hold = holds && held && !isHeldSlot(slot) ? " and hold" : "";
  const missing = model && (d.kind === "layer" || d.kind === "layer-tap") && d.layer != null && !hasLayer(model, d.layer);
  const note = missing ? ", which this keyboard doesn't have" : holds && !held ? `, ${NEVER_HELD[slot]}` : "";
  return `${GESTURES[slot]}${hold} ${outcome(pressed, names)}${note}`;
}

/** "Tap for Tab, double-tap for Caps Lock." Empty and transparent slots are left out. Given the keyboard, a slot's
 * layer the keyboard doesn't have says so: "Hold for Layer 9, which this keyboard doesn't have." */
export function tapDanceSentence(td: TapDance, names: Names, model?: Pick<KeyboardModel, "layers">): string {
  const parts = tapDanceSlots(td)
    .filter((slot) => !doesNothing(slot.action))
    .map((slot) => slotPhrase(td, slot.label, slot.action, names, model));
  return parts.length === 0 ? "Does nothing yet: choose what each way of pressing it does." : `${capitalised(parts.join(", "))}.`;
}

/** An outcome said of the tap dance itself: "to toggle Layer 2" → "toggles Layer 2", "for Layer 2 on the next key" →
 * "reaches Layer 2 for the next key" */
function thirdPerson(outcome: string): string {
  const verb = /^to (\w+)(.*)$/.exec(outcome);
  if (verb) return `${verb[1].endsWith("ch") || verb[1].endsWith("sh") ? `${verb[1]}es` : `${verb[1]}s`}${verb[2]}`;
  const next = /^for (.*) on the next key$/.exec(outcome);
  return next ? `reaches ${next[1]} for the next key` : outcome;
}

/** What a tap dance a combo runs does to each layer it reaches, after "which": "reaches Layer 1 when held", "reaches
 * Layer 1 when tapped and held" (a layer held from a tapped slot), "toggles Layer 2 when double-tapped" */
function tapDanceReach(model: Pick<KeyboardModel, "layers" | "tapDance">, output: Described, names: Names): string[] {
  return layerTargets(model, output).flatMap((t) => {
    const slot = t.slot?.slot;
    const td = t.slot ? model.tapDance[t.slot.tapDance] : undefined;
    const d = td && slot ? tapDanceSlots(td).find((s) => s.label === slot)?.action : undefined;
    if (!slot || !td || !d) return [];
    const action = isHeldSlot(slot) && t.action === "hold, or tap to toggle" ? "while held" : t.action;
    if (action === "while held" || action === "while held, with modifiers") {
      const mods = action === "while held, with modifiers" && d.hold ? ` with ${d.hold}` : "";
      return [`reaches ${layerLabel(t.layer, names)}${mods} when ${PARTICIPLES[slot]}${isHeldSlot(slot) ? "" : " and held"}`];
    }
    return [`${thirdPerson(outcome(asPressed(d, td, slot), names))} when ${PARTICIPLES[slot]}`];
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

/** Each kind of use, as counted: its singular and plural */
const USE_KINDS: [Use["type"], string, string][] = [
  ["key", "key", "keys"],
  ["combo", "combo", "combos"],
  ["tap-dance", "tap dance", "tap dances"],
  ["macro", "macro", "macros"],
  ["key-override", "key override", "key overrides"],
  ["alt-repeat", "alt-repeat key", "alt-repeat keys"],
];

/** What a use belongs to: a key on a layer, or the combo, tap dance, macro, key override or alt-repeat key */
function useOwner(use: Use): string {
  switch (use.type) {
    case "key":
      return `${use.layer}:${refId(use.ref)}`;
    case "combo":
      return String(use.combo);
    case "tap-dance":
      return String(use.tapDance);
    case "macro":
      return String(use.macro);
    case "key-override":
      return String(use.keyOverride);
    case "alt-repeat":
      return String(use.altRepeat);
  }
}

/** What uses a tap dance or macro, counted: "3 keys", "1 key, 2 combos and 1 tap dance". A key counts once on each
 * layer it is on; a combo (or tap dance, …) once, however many of its parts use it. `total`: how many there are. */
export function usesCounted(uses: Use[]): { text: string; total: number } {
  const parts: string[] = [];
  let total = 0;
  for (const [type, one, many] of USE_KINDS) {
    const count = new Set(uses.filter((u) => u.type === type).map(useOwner)).size;
    if (count === 0) continue;
    total += count;
    parts.push(`${count} ${count === 1 ? one : many}`);
  }
  return { text: andList(parts), total };
}

/** Why removing macro `index` asks first: what uses it, which runs nothing once the macro is empty (vial-qmk sends
 * nothing for an empty macro); null when nothing uses it */
export function macroRemoveNote(index: number, uses: Use[]): string | null {
  const { text, total } = usesCounted(uses);
  if (total === 0) return null;
  return `${text} ${total === 1 ? "uses" : "use"} M${index}. Once the macro is removed, M${index} sends ` +
    "nothing there until the macro has steps again.";
}

/** Why clearing tap dance `index` asks first: what uses it, which does nothing once its four slots are empty (vial-qmk
 * presses KC_NO for each, which sends nothing); null when nothing uses it */
export function tapDanceClearNote(index: number, uses: Use[]): string | null {
  const { text, total } = usesCounted(uses);
  if (total === 0) return null;
  return `${text} ${total === 1 ? "uses" : "use"} TD(${index}). Once the tap dance is cleared, TD(${index}) does ` +
    "nothing there until one of its slots is set again.";
}
