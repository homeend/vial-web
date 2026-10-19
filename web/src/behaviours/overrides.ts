// Key overrides and alt-repeat keys: their modifier masks, layer masks and option bits, and what they do in words.
// The bits are the Vial protocol's (protocol/key_override.py, protocol/alt_repeat_key.py), as the Qt app sends them.
import type { AltRepeatKey, AltRepeatKeyIn, Described, KeyOverride, KeyOverrideIn } from "../api/types";
import { andList, memberName } from "../analysis/phrases";
import type { Names } from "../keyboard/labels";
import { membersOf } from "./members";

/** KC_NO, as the server describes it: an empty trigger, replacement or key */
export const NO_KEY: Described = {
  code: "KC_NO", value: 0, kind: "none", tap: "", legend: { main: "" }, hold: null, layer: null, layerAction: null,
  index: null, description: null, tapCode: null, triLayer: null,
};

// ---------- modifiers ----------

export type ModName = "Ctrl" | "Shift" | "Alt" | "Gui";
export const MOD_NAMES: ModName[] = ["Ctrl", "Shift", "Alt", "Gui"];
export type Side = "Left" | "Right";

/** The bit of a modifier in an 8-bit mask: LCtrl, LShift, LAlt, LGui, then the same on the right */
export function modBit(side: Side, mod: ModName): number {
  return 1 << (MOD_NAMES.indexOf(mod) + (side === "Right" ? 4 : 0));
}

/** The mask with a bit switched */
export function toggled(mask: number, bit: number): number {
  return mask & bit ? mask & ~bit : mask | bit;
}

/** A mask's modifiers in words: a modifier set on both sides is just its name ("Shift": either one), one set on one
 * side says which ("Left Shift"). ignoreSide: the side doesn't matter (an alt-repeat key that ignores it). */
export function modNames(mask: number, ignoreSide = false): string[] {
  return MOD_NAMES.flatMap((mod) => {
    const left = (mask & modBit("Left", mod)) !== 0;
    const right = (mask & modBit("Right", mod)) !== 0;
    if (ignoreSide || (left && right)) return left || right ? [mod] : [];
    return left ? [`Left ${mod}`] : right ? [`Right ${mod}`] : [];
  });
}

/** "Q", "Q or W", "Q, W or E" */
export function orList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// ---------- layers ----------

/** Layers a key override's mask can name: the firmware's mask has 16 bits */
export const MASK_LAYERS = 16;

/** The mask of every layer the keyboard has (up to 16) */
export function allLayers(count: number): number {
  return 2 ** Math.min(count, MASK_LAYERS) - 1;
}

/** The keyboard's layers (only those it has) a mask names */
export function layersIn(mask: number, count: number): number[] {
  return Array.from({ length: Math.min(count, MASK_LAYERS) }, (_, l) => l).filter((l) => (mask & (1 << l)) !== 0);
}

/** Where a layer mask applies, after the action: "on every layer", "on Base only", "on Base and Layer 2", "on no
 * layer". Bits of layers the keyboard doesn't have don't count; on a keyboard with more than 16 layers, all 16 bits
 * are "on layers 0 to 15" (the firmware never matches the layers above). */
export function layerPhrase(mask: number, count: number, names: Names): string {
  const layers = layersIn(mask, count);
  if (layers.length === 0) return "on no layer";
  if (layers.length === Math.min(count, MASK_LAYERS)) {
    if (count > MASK_LAYERS) return `on layers 0 to ${MASK_LAYERS - 1}`;
    return count > 1 ? "on every layer" : `on ${names.layer(0)}`;
  }
  if (layers.length === 1) return `on ${names.layer(layers[0])} only`;
  return `on ${andList(layers.map((l) => names.layer(l)))}`;
}

// ---------- options ----------

export interface OptionInfo {
  bit: number;
  label: string;
  /** what it does, in a sentence */
  explanation: string;
}

/** Vial's key override option bits (vial_ko_option_*), in Qt's order. Bits 4 and 5 are labelled by their names:
 * Qt's checkboxes give each the other one's text. */
export const KEY_OVERRIDE_OPTIONS: OptionInfo[] = [
  { bit: 1 << 0, label: "Start when the trigger key goes down",
    explanation: "Pressing the trigger key while the modifiers are held starts it." },
  { bit: 1 << 1, label: "Start when a trigger modifier goes down",
    explanation: "Pressing a trigger modifier while the trigger key is held starts it too." },
  { bit: 1 << 2, label: "Start when a blocking modifier is let go",
    explanation: "Letting go of a modifier that blocks it, while the rest is held, starts it too." },
  { bit: 1 << 3, label: "Any one trigger modifier is enough",
    explanation: "One of the trigger modifiers starts it, instead of all of them together." },
  { bit: 1 << 4, label: "Don't press the trigger key again afterwards",
    explanation: "When it ends while the trigger key is still held, the trigger key isn't sent again." },
  { bit: 1 << 5, label: "Don't end when another key is pressed",
    explanation: "Pressing another key while it is on doesn't end it." },
];

export const KO_ENABLED = 1 << 7;
/** the three ways to start it: QMK's default (ko_options_default) */
export const KO_ACTIVATIONS = 0b111;
/** the option bits the protocol keeps, enabled left out */
const KO_OPTION_BITS = KEY_OVERRIDE_OPTIONS.reduce((all, o) => all | o.bit, 0);

/** Vial's alt-repeat key option bits (vial_arep_option_*), in Qt's order */
export const ALT_REPEAT_OPTIONS: OptionInfo[] = [
  { bit: 1 << 0, label: "Default to this alt key",
    explanation: "After any other key that no alt-repeat key covers (with only allowed modifiers held), Alt Repeat sends this alt key, instead of the firmware's own pairs." },
  { bit: 1 << 1, label: "Both ways",
    explanation: "Also the other way round: after the alt key, Alt Repeat sends the key." },
  { bit: 1 << 2, label: "Either side's modifiers",
    explanation: "Left and right modifiers count as the same: Right Shift matches an allowed Left Shift." },
];

export const AR_ENABLED = 1 << 3;
const AR_OPTION_BITS = ALT_REPEAT_OPTIONS.reduce((all, o) => all | o.bit, 0);

// ---------- key overrides ----------

/** A key override as it is edited: the model's, enabled kept apart from the other options */
export type KeyOverrideDraft = Omit<KeyOverride, "index">;

export function keyOverrideIsSet(o: KeyOverride): boolean {
  return o.trigger.value !== 0 || o.replacement.value !== 0 || o.layers !== 0 || o.triggerMods !== 0 ||
    o.negativeModMask !== 0 || o.suppressedMods !== 0 || o.options !== 0;
}

/** The first key override that isn't set up, or null */
export function freeKeyOverride(overrides: KeyOverride[]): number | null {
  return overrides.find((o) => !keyOverrideIsSet(o))?.index ?? null;
}

/** What a new key override starts as: on every layer, on, started all three ways (QMK's defaults) */
export function newKeyOverride(none: Described, layerCount: number): KeyOverrideDraft {
  return {
    trigger: none, replacement: none, layers: allLayers(layerCount), triggerMods: 0, negativeModMask: 0,
    suppressedMods: 0, options: KO_ENABLED | KO_ACTIVATIONS, enabled: true,
  };
}

export function keyOverrideRequest(o: KeyOverrideDraft): KeyOverrideIn {
  return {
    trigger: o.trigger.code, replacement: o.replacement.code, layers: o.layers & 0xffff, triggerMods: o.triggerMods,
    negativeModMask: o.negativeModMask, suppressedMods: o.suppressedMods,
    options: (o.options & KO_OPTION_BITS) | (o.enabled ? KO_ENABLED : 0),
  };
}

/** What every field of an empty key override holds: saving it removes the key override */
export function clearedKeyOverride(none: Described): KeyOverrideDraft {
  return {
    trigger: none, replacement: none, layers: 0, triggerMods: 0, negativeModMask: 0, suppressedMods: 0, options: 0,
    enabled: false,
  };
}

function keyName(d: Described, names: Names): string {
  return memberName(d, names);
}

/** "Left Shift + Bksp sends Del, on every layer.", "Ctrl or Alt + Q sends Esc, on Base only.", "Holding Left Shift
 * sends Caps Lock, on every layer." (no trigger key: the modifiers alone), "Bksp sends nothing, on Base only." */
export function keyOverrideSentence(o: KeyOverrideDraft, layerCount: number, names: Names): string {
  const mods = modNames(o.triggerMods);
  const join = o.options & KEY_OVERRIDE_OPTIONS[3].bit ? orList : (m: string[]) => m.join(" + ");
  const hasKey = o.trigger.kind !== "none";
  if (!hasKey && mods.length === 0) return "No trigger yet: choose a trigger key, or modifiers.";
  const trigger = hasKey
    ? (mods.length > 0 ? `${join(mods)} + ${keyName(o.trigger, names)}` : keyName(o.trigger, names))
    : `Holding ${join(mods)}`;
  const sends = o.replacement.kind === "none" ? "sends nothing" : `sends ${keyName(o.replacement, names)}`;
  return `${trigger} ${sends}, ${layerPhrase(o.layers, layerCount, names)}.`;
}

/** The parts that aren't QMK's usual, in short: "Not while Ctrl is held", "Left Shift is hidden from the computer" */
export function keyOverrideDetails(o: KeyOverrideDraft): string[] {
  const details: string[] = [];
  const negative = modNames(o.negativeModMask);
  if (negative.length > 0) details.push(`Not while ${orList(negative)} is held`);
  const hidden = modNames(o.suppressedMods);
  if (hidden.length > 0) details.push(`${andList(hidden)} ${hidden.length === 1 ? "is" : "are"} hidden from the computer while it works`);
  for (const option of KEY_OVERRIDE_OPTIONS.slice(3)) {
    if (o.options & option.bit) details.push(option.label);
  }
  const starts = KEY_OVERRIDE_OPTIONS.slice(0, 3).filter((option) => o.options & option.bit);
  if (starts.length > 0 && starts.length < 3) details.push(`Starts only: ${starts.map((s) => s.label.replace(/^Start /, "")).join("; ")}`);
  return details;
}

/** The highest keycode the firmware can send as a replacement: QK_MODS_MAX, a key of the basic range with modifiers.
 * It sends the replacement with register_code(uint8_t), so anything above loses its high byte or sends nothing. */
const KO_REPLACEMENT_MAX = 0x1fff;

/** Why it can never work or does what the owner wouldn't want, or nothing. With no way to start it chosen, the
 * firmware uses all three (process_key_override.c check_activation_event): that is no problem. */
export function keyOverrideProblems(o: KeyOverrideDraft, layerCount: number): string[] {
  const problems: string[] = [];
  const onLayers = layersIn(o.layers, layerCount).length > 0;
  // a KC_NO trigger needs no key down, and no trigger modifiers match any: every key press starts it
  if (o.trigger.kind === "none" && o.triggerMods === 0 && o.enabled && onLayers) {
    problems.push("With no trigger key and no trigger modifiers, it starts on every key press on its layers.");
  }
  if (!onLayers) problems.push("It is on no layer of this keyboard, so it never works.");
  if (o.replacement.value > KO_REPLACEMENT_MAX) {
    problems.push("The keyboard can only send a plain key (with modifiers) as the replacement.");
  }
  return problems;
}

// ---------- alt-repeat keys ----------

export type AltRepeatDraft = Omit<AltRepeatKey, "index">;

export function altRepeatIsSet(a: AltRepeatKey): boolean {
  return a.keycode.value !== 0 || a.altKeycode.value !== 0 || a.allowedMods !== 0 || a.options !== 0;
}

export function freeAltRepeat(keys: AltRepeatKey[]): number | null {
  return keys.find((a) => !altRepeatIsSet(a))?.index ?? null;
}

export function newAltRepeat(none: Described): AltRepeatDraft {
  return { keycode: none, altKeycode: none, allowedMods: 0, options: AR_ENABLED, enabled: true };
}

export function clearedAltRepeat(none: Described): AltRepeatDraft {
  return { keycode: none, altKeycode: none, allowedMods: 0, options: 0, enabled: false };
}

export function altRepeatRequest(a: AltRepeatDraft): AltRepeatKeyIn {
  return {
    keycode: a.keycode.code, altKeycode: a.altKeycode.code, allowedMods: a.allowedMods,
    options: (a.options & AR_OPTION_BITS) | (a.enabled ? AR_ENABLED : 0),
  };
}

/** Whether it is worth saving: it has a last key, or it is a default alt key with an alt key (a default entry never
 * looks at its own key: vial.c get_alt_repeat_key_keycode_user) */
export function altRepeatReady(a: AltRepeatDraft): boolean {
  return a.keycode.kind !== "none" || ((a.options & ALT_REPEAT_OPTIONS[0].bit) !== 0 && a.altKeycode.kind !== "none");
}

/** "(alone, or with Left Shift)", "(alone, or with Ctrl, Shift or both)": the firmware takes any mix of the allowed
 * modifiers (vial.c alt_repeat_key_mods_match) */
function heldPhrase(mods: string[]): string {
  if (mods.length === 0) return " without modifiers";
  if (mods.length === 1) return ` (alone, or with ${mods[0]})`;
  if (mods.length === 2) return ` (alone, or with ${mods[0]}, ${mods[1]} or both)`;
  return ` (alone, or with any mix of ${andList(mods)})`;
}

/** "After Left, Alt Repeat sends Right.", "After Left (alone, or with Left Shift), Alt Repeat sends Right, and the
 * other way round." The default alt key (vial.c get_alt_repeat_key_keycode_user) is also sent after any last key
 * that no entry matches, held with only the allowed modifiers; that doesn't look at the entry's own key. QMK asks
 * Vial's entries first and uses its own pairs only when none answers (repeat_key.c get_alt_repeat_key_keycode), so
 * an enabled default entry replaces those pairs for the keys no entry covers. A default entry with no last key that
 * goes both ways answers its alt key with its own empty key: Alt Repeat then sends nothing after the alt key. */
export function altRepeatSentence(a: AltRepeatDraft, names: Names): string {
  const isDefault = (a.options & ALT_REPEAT_OPTIONS[0].bit) !== 0;
  if (!altRepeatReady(a)) {
    return "No key chosen yet: choose the last key and what Alt Repeat sends after it, or turn on Default to this alt " +
      "key and choose the alt key.";
  }
  const mods = modNames(a.allowedMods, (a.options & ALT_REPEAT_OPTIONS[2].bit) !== 0);
  const held = heldPhrase(mods);
  const instead = ", instead of the firmware's own pairs";
  const sends = a.altKeycode.kind === "none" ? "sends nothing" : `sends ${keyName(a.altKeycode, names)}`;
  if (a.keycode.kind === "none") {
    // both ways: the alt key matches, and the answer is the entry's own key, KC_NO: nothing is sent after it (and the
    // firmware's own pair for it isn't used either)
    const back = a.options & ALT_REPEAT_OPTIONS[1].bit && a.altKeycode.kind !== "none"
      ? ` After ${keyName(a.altKeycode, names)}${mods.length > 0 ? held : ""}, it sends nothing.`
      : "";
    return `After any key${held} that no alt-repeat key covers, Alt Repeat ${sends}${instead}.${back}`;
  }
  const after = mods.length > 0 ? `${keyName(a.keycode, names)}${held}` : keyName(a.keycode, names);
  const back = a.options & ALT_REPEAT_OPTIONS[1].bit && a.altKeycode.kind !== "none" ? ", and the other way round" : "";
  const fallback = isDefault
    ? ` After any other key${held} that no alt-repeat key covers, it ${sends} too${instead}.`
    : "";
  return `After ${after}, Alt Repeat ${sends}${back}.${fallback}`;
}

/** Whether a keycode is on a key, in a tap dance or as a combo's output: somewhere it can be pressed */
export function pressable(code: string, model: {
  layers: { keys: Described[]; encoders: Described[] }[];
  tapDance: { tap: Described; hold: Described; doubleTap: Described; tapHold: Described }[];
  combos: { keys: Described[]; output: Described }[];
}): boolean {
  return model.layers.some((l) => l.keys.some((k) => k.code === code) || l.encoders.some((k) => k.code === code)) ||
    model.tapDance.some((td) => [td.tap, td.hold, td.doubleTap, td.tapHold].some((d) => d.code === code)) ||
    model.combos.some((c) => membersOf(c).length > 0 && c.output.code === code);
}
