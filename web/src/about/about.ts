// What the Keyboard page says about the keyboard: what Qt's "About keyboard" dialog says, from the loaded model.
import type { KeyboardEntry, KeyboardModel, KeyGeometry } from "../api/types";
import { layoutChoices } from "../keyboard/geometry";

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
  /** may be very long (a device path): cut short on a wide screen, over a few lines on a phone */
  long?: boolean;
}

export interface FactGroup {
  title: string;
  facts: Fact[];
}

/** Features the firmware reports (KeyboardModel.features), by name, with the Vial protocol that can report them
 * (protocol/dynamic.py: the feature bits come with the dynamic entries; Repeat Key with the alt-repeat keys, and the
 * persistent default layer with protocol 5) */
const FEATURES: [string, string, number][] = [
  ["caps_word", "Caps Word", DYNAMIC],
  ["layer_lock", "Layer Lock", DYNAMIC],
  ["repeat_key", "Repeat Key", KEY_OVERRIDE],
  ["persistent_default_layer", "Persistent default layer", KEY_OVERRIDE],
];

type Model = Pick<KeyboardModel, "name" | "uid" | "viaProtocol" | "vialProtocol" | "rows" | "cols" | "keys" |
  "encoders" | "layoutOptions" | "layers" | "macros" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" |
  "settings" | "features">;

/** The USB device's facts the card shows: those of the keyboard list (KeyboardEntry), as hidapi gave them */
export type UsbDevice = Pick<KeyboardEntry, "manufacturer" | "product" | "vendorId" | "productId" | "path">;

/** A USB vendor or product ID as Qt writes it: four hex digits, upper case ("55D4") */
export function usbId(id: number): string {
  return id.toString(16).toUpperCase().padStart(4, "0");
}

/** What Qt's About keyboard says of the USB device first: Manufacturer, Product, VID, PID and Device (its path) */
function usbFacts(usb: UsbDevice): FactGroup {
  return {
    title: "USB device",
    facts: [
      { label: "Manufacturer", value: usb.manufacturer || "none given" },
      // the product name it gives, as Qt shows it: not the name it is shown by, made up when it gives none
      { label: "Product", value: usb.product || "none given" },
      { label: "VID", value: usbId(usb.vendorId), code: true },
      { label: "PID", value: usbId(usb.productId), code: true },
      { label: "Device", value: usb.path, copy: true, code: true, long: true },
    ],
  };
}

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

/** The facts the card shows; `usb`: the keyboard's USB device, when the keyboard list has it (not when the keyboard
 * is unplugged and isn't the one chosen) */
export function aboutFacts(model: Model, usb: UsbDevice | null = null): FactGroup[] {
  // the keys drawn: no decals, and of a layout option only the choice made (keyboard/geometry.ts placeKeyboard)
  const choices = layoutChoices(model.layoutOptions);
  const drawn = (g: KeyGeometry) => !g.decal && (g.layoutIndex === -1 || g.layoutOption === (choices[g.layoutIndex] ?? 0));
  const keys = model.keys.filter(drawn).length;
  const encoders = new Set(model.encoders.filter(drawn).map((e) => e.encoder)).size;
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
        { label: "Keys", value: `${keys}${encoders > 0 ? `, and ${plural(encoders, "encoder", "encoders")}` : ""}` },
        { label: "Layers", value: String(model.layers.length) },
      ],
    },
    ...(usb ? [usbFacts(usb)] : []),
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
        ...FEATURES.map(([id, label, since]) => ({ label, value: features.has(id) ? "yes" : missing(model, since) })),
        ...[...features].filter((id) => !known.has(id)).sort().map((id) => ({ label: id, value: "yes" })),
      ],
    },
  ];
}

/** All of it as text, one fact a line, to paste into a bug report */
export function aboutText(groups: FactGroup[]): string {
  return groups.map((g) => [g.title, ...g.facts.map((f) => `  ${f.label}: ${f.value}`)].join("\n")).join("\n");
}
