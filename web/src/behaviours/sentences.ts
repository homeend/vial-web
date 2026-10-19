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

/** The same, after a combo's layer: "reaches Layer 2 when double-tapped" */
const PARTICIPLES: Record<SlotLabel, string> = {
  Tap: "when tapped",
  Hold: "when held",
  "Double tap": "when double-tapped",
  "Tap, then hold": "when tapped then held",
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

/** What a keycode does, after the gesture that runs it: "for Tab", "to toggle Layer 2", "for Space (hold: Shift)" */
export function outcome(d: Described, names: Names): string {
  if (d.kind === "layer" && d.layer != null) {
    const layer = layerLabel(d.layer, names);
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
  if (d.kind === "layer-tap" || d.kind === "mod-tap") return `for ${memberName(d, names)}`;
  return `for ${actionSummary(d, names).tap}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Tap for Tab, double-tap for Caps Lock." */
export function tapDanceSentence(td: TapDance, names: Names): string {
  const parts = tapDanceSlots(td)
    .filter((slot) => slot.action.kind !== "none")
    .map((slot) => `${GESTURES[slot.label]} ${outcome(slot.action, names)}`);
  return parts.length === 0 ? "Does nothing yet: choose what each way of pressing it does." : `${capitalised(parts.join(", "))}.`;
}

/** The layers a combo's output reaches, in words: "reaches Layer 2, while held", "reaches Layer 1 when held" */
function reaches(model: Pick<KeyboardModel, "layers" | "tapDance">, output: Described, names: Names): string | null {
  const targets = layerTargets(model, output);
  if (targets.length === 0) return null;
  return targets
    .map((t) => {
      const layer = layerLabel(t.layer, names);
      if (t.slot) return `reaches ${layer} ${PARTICIPLES[t.slot.slot]}`;
      if (output.kind === "layer-tap") return `reaches ${layer} when held`;
      const mods = t.action === "while held, with modifiers" && output.hold ? `, with ${output.hold}` : "";
      return `reaches ${layer}${LAYER_WAYS[t.action]}${mods}`;
    })
    .join("; ");
}

/** "Press K + Y together for Esc.", "Press MO(5) + OSL(3) together → reaches Layer 2, while held." */
export function comboSentence(combo: Pick<ComboInfo, "members" | "output">, model: Pick<KeyboardModel, "layers" | "tapDance">,
  names: Names): string {
  if (combo.members.length === 0) return "No keys chosen yet.";
  const keys = comboName(combo.members, names);
  const output = combo.output;
  if (output.kind === "none") return `Press ${keys} together: it does nothing yet.`;
  const reached = reaches(model, output, names);
  if (output.kind === "layer" && reached) return `Press ${keys} together → ${reached}.`;
  if (output.kind === "layer-tap" && output.layer != null && reached) {
    return `Press ${keys} together for ${output.tap || "nothing"}, or hold them → reaches ${layerLabel(output.layer, names)}.`;
  }
  return `Press ${keys} together ${outcome(output, names)}${reached ? `, which ${reached}` : ""}.`;
}

/** Why a combo can't fire, or how its keys are found: "It has A twice, so it never fires.", "Y isn't on any key, so
 * it can't fire.", "K is on 2 keys of the base layer: either one works." layerCodes: by layer, codesOn's maps. */
export function comboNotes(combo: ComboInfo, layerCodes: Map<string, KeyRef[]>[], names: Names): string[] {
  const repeated = repeatedCodes(combo).map((d) => memberName(d, names));
  if (repeated.length > 0) return [`It has ${andList(repeated)} twice, so it never fires.`];
  const notes: string[] = [];
  const fires = comboLayers(combo, layerCodes);
  const offBase = combo.members.filter((m) => m.keys.length === 0).map((m) => memberName(m.action, names));
  const be = (items: string[]) => (items.length === 1 ? "isn't" : "aren't");
  if (fires.length === 0) {
    const nowhere = combo.members
      .filter((m) => !layerCodes.some((codes) => codes.has(m.action.code)))
      .map((m) => memberName(m.action, names));
    notes.push(nowhere.length > 0
      ? `${andList(nowhere)} ${be(nowhere)} on any key, so it can't fire.`
      : "Its keys aren't all on one layer, so it can't fire.");
  } else if (offBase.length > 0) {
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
