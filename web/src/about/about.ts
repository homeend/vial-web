// What the Keyboard page says about the keyboard: what Qt's "About keyboard" dialog says, from the loaded model.
import type { KeyboardModel } from "../api/types";

/** Vial protocol versions that brought each feature (protocol/constants.py), for why a keyboard lacks one */
const ADVANCED_MACROS = 2;
const DYNAMIC = 4;
const QMK_SETTINGS = 4;
const EXT_MACROS = 5;
const KEY_OVERRIDE = 5;

export interface Fact {
  label: string;
  value: string;
  /** worth copying on its own: the name, the ID */
  copy?: boolean;
  /** monospaced: an ID */
  code?: boolean;
}

export interface FactGroup {
  title: string;
  facts: Fact[];
}

/** Features the firmware reports (KeyboardModel.features), by name */
const FEATURES: [string, string][] = [
  ["caps_word", "Caps Word"],
  ["layer_lock", "Layer Lock"],
  ["repeat_key", "Repeat Key"],
  ["persistent_default_layer", "Persistent default layer"],
];

type Model = Pick<KeyboardModel, "name" | "uid" | "viaProtocol" | "vialProtocol" | "rows" | "cols" | "keys" |
  "encoders" | "layers" | "macros" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "settings" | "features">;

/** Why a keyboard has none of something, as Qt says it: its firmware is too old, or it was left out of it */
function missing(model: Model, since: number): string {
  return model.vialProtocol < since ? "no (the Vial firmware is too old)" : "no (turned off in the firmware)";
}

function count(model: Model, n: number, since: number): string {
  return n > 0 ? String(n) : missing(model, since);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function aboutFacts(model: Model): FactGroup[] {
  const encoders = new Set(model.encoders.map((e) => e.encoder)).size;
  const features = new Set(model.features);
  const known = new Set(FEATURES.map(([id]) => id));
  return [
    {
      title: "Keyboard",
      facts: [
        { label: "Name", value: model.name, copy: true },
        { label: "Keyboard ID", value: model.uid, copy: true, code: true },
        { label: "Protocols", value: `VIA ${model.viaProtocol}, Vial ${model.vialProtocol}`, copy: true },
        { label: "Matrix", value: `${plural(model.rows, "row", "rows")} × ${plural(model.cols, "column", "columns")}` },
        { label: "Keys", value: `${model.keys.length}${encoders > 0 ? `, and ${plural(encoders, "encoder", "encoders")}` : ""}` },
        { label: "Layers", value: String(model.layers.length) },
      ],
    },
    {
      title: "Memory and entries",
      facts: [
        { label: "Macros", value: model.macros.count > 0
          ? `${model.macros.count}, sharing ${model.macros.memory} bytes (${model.macros.used} used)` : "none" },
        { label: "Delays in macros", value: model.vialProtocol >= ADVANCED_MACROS ? "yes" : missing(model, ADVANCED_MACROS) },
        { label: "Two-byte keycodes in macros", value: model.vialProtocol >= EXT_MACROS ? "yes" : missing(model, EXT_MACROS) },
        { label: "Tap dances", value: count(model, model.tapDance.length, DYNAMIC) },
        { label: "Combos", value: count(model, model.combos.length, DYNAMIC) },
        { label: "Key overrides", value: count(model, model.keyOverrides.length, KEY_OVERRIDE) },
        { label: "Alt-repeat keys", value: count(model, model.altRepeatKeys.length, KEY_OVERRIDE) },
        { label: "QMK settings", value: model.settings.length > 0 ? String(model.settings.length) : missing(model, QMK_SETTINGS) },
      ],
    },
    {
      title: "Features",
      facts: [
        ...FEATURES.map(([id, label]) => ({ label, value: features.has(id) ? "yes" : missing(model, DYNAMIC) })),
        ...[...features].filter((id) => !known.has(id)).sort().map((id) => ({ label: id, value: "yes" })),
      ],
    },
  ];
}

/** All of it as text, one fact a line, to paste into a bug report */
export function aboutText(groups: FactGroup[]): string {
  return groups.map((g) => [g.title, ...g.facts.map((f) => `  ${f.label}: ${f.value}`)].join("\n")).join("\n");
}
