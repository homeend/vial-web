// What loading a .vil file changes, section by section, in words: from the server's preview (POST
// /api/layout-file/preview), with the page's own names for keys, layers and settings.
import type { Described, KeyboardModel, LayoutFilePreview, LayoutOptions, SettingsDefinitions } from "../api/types";
import { layoutChoices } from "../keyboard/geometry";
import { memberName } from "../analysis/phrases";
import type { Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import { tapDanceIsSet } from "../behaviours/entries";
import { isSet as comboIsSet } from "../behaviours/members";
import { altRepeatIsSet, altRepeatSentence, keyOverrideIsSet, keyOverrideSentence } from "../behaviours/overrides";
import { tapDanceSentence } from "../behaviours/sentences";
import { settingChanges } from "../settings/qmkSettings";

/** How many changes a section lists before "and N more" */
export const LISTED = 5;

export interface PreviewSection {
  id: "keys" | "encoders" | "layoutOptions" | "tapDance" | "combos" | "keyOverrides" | "altRepeatKeys" | "macros" |
    "settings";
  title: string;
  /** how many changes */
  count: number;
  /** for the keys: how many on each layer, "Base: 2, Layer 2: 1" */
  summary: string | null;
  /** the first few changes, in words */
  items: string[];
  /** how many more there are */
  more: number;
}

export interface PreviewContext {
  model: Pick<KeyboardModel, "keys" | "encoders" | "layers" | "layoutOptions" | "tapDance" | "combos" | "keyOverrides" |
    "altRepeatKeys" | "macros" | "settings">;
  names: Names;
  /** every placed key's position in words, by refId */
  positions: Map<string, string>;
  definitions: SettingsDefinitions | null;
}

/** A keycode in a few words, as combos name their keys: "Z", "B (hold: Layer 2)", "MO(3)", "nothing" */
export function shortAction(d: Described, names: Names): string {
  if (d.kind === "none") return "nothing";
  if (d.kind === "transparent") return "transparent";
  return memberName(d, names);
}

function change(before: Described, after: Described, names: Names): string {
  return `${shortAction(before, names)} → ${shortAction(after, names)}`;
}

/** Where a matrix position is, in words: the position of the key drawn there ("left, top row, outer"), else its row
 * and column */
function keyPlace(ctx: PreviewContext, row: number, col: number): string {
  const indexes = ctx.model.keys.flatMap((k, i) => (k.row === row && k.col === col ? [i] : []));
  const placed = indexes.map((i) => ctx.positions.get(refId({ kind: "key", index: i }))).find((p) => p !== undefined);
  return placed ?? `row ${row}, column ${col}`;
}

function encoderPlace(ctx: PreviewContext, encoder: number, direction: number): string {
  const index = ctx.model.encoders.findIndex((e) => e.encoder === encoder && e.direction === direction);
  const placed = index >= 0 ? ctx.positions.get(refId({ kind: "encoder", index })) : undefined;
  return placed ?? `encoder ${encoder}, ${direction === 1 ? "clockwise" : "counter-clockwise"}`;
}

/** Each layout option whose choice differs: "Split Backspace: off → on", "Bottom row: 6.25U → 7U" */
export function layoutOptionChanges(options: LayoutOptions | null | undefined, before: number, after: number): string[] {
  if (!options) return [`${before} → ${after}`];
  const was = layoutChoices({ ...options, value: before });
  const now = layoutChoices({ ...options, value: after });
  return options.labels.flatMap((label, i) => {
    if (was[i] === now[i]) return [];
    const name = typeof label === "string" ? label : label[0];
    const choice = (c: number) => (typeof label === "string" ? (c ? "on" : "off") : (label[c + 1] ?? `choice ${c}`));
    return [`${name}: ${choice(was[i])} → ${choice(now[i])}`];
  });
}

function section(id: PreviewSection["id"], title: string, items: string[], summary: string | null = null,
  count = items.length): PreviewSection {
  return { id, title, count, summary, items: items.slice(0, LISTED), more: Math.max(0, items.length - LISTED) };
}

function layerCounts(layers: number[], names: Names): string {
  const counts = new Map<number, number>();
  for (const l of layers) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([l, n]) => `${names.layer(l)}: ${n}`).join(", ");
}

/** The sections the file changes, each with its changes in words; a section the file leaves as it is isn't one */
export function previewSections(preview: LayoutFilePreview, ctx: PreviewContext): PreviewSection[] {
  const { names, model } = ctx;
  const layerCount = model.layers.length;
  const sections: PreviewSection[] = [
    section("keys", "Keys",
      preview.keys.map((k) => `${names.layer(k.layer)}, ${keyPlace(ctx, k.row, k.col)}: ${change(k.before, k.after, names)}`),
      preview.keys.length > 0 ? layerCounts(preview.keys.map((k) => k.layer), names) : null),
    section("encoders", "Encoders",
      preview.encoders.map((e) => `${names.layer(e.layer)}, ${encoderPlace(ctx, e.encoder, e.direction)}: ${change(e.before, e.after, names)}`)),
  ];
  if (preview.layoutOptions) {
    const items = layoutOptionChanges(model.layoutOptions, preview.layoutOptions.before, preview.layoutOptions.after);
    sections.push(section("layoutOptions", "Layout options", items));
  }
  sections.push(
    section("tapDance", "Tap dances", preview.tapDance.map(({ after }) =>
      `Tap dance ${after.index}: ${tapDanceIsSet(after) ? tapDanceSentence(after, names, model) : "cleared"}`)),
    section("combos", "Combos", preview.combos.map(({ after }) => {
      if (!comboIsSet(after)) return `Combo ${after.index}: cleared`;
      const keys = after.keys.filter((k) => k.kind !== "none").map((k) => shortAction(k, names)).join(" + ");
      return `Combo ${after.index}: ${keys || "no keys"} → ${shortAction(after.output, names)}`;
    })),
    section("keyOverrides", "Key overrides", preview.keyOverrides.map(({ after }) =>
      `Key override ${after.index}: ${keyOverrideIsSet(after)
        ? `${keyOverrideSentence(after, layerCount, names)}${after.enabled ? "" : " Switched off."}` : "cleared"}`)),
    section("altRepeatKeys", "Alt-repeat keys", preview.altRepeatKeys.map(({ after }) =>
      `Alt-repeat key ${after.index}: ${altRepeatIsSet(after)
        ? `${altRepeatSentence(after, names)}${after.enabled ? "" : " Switched off."}` : "cleared"}`)),
    section("macros", "Macros", preview.macros.map(({ after }) => {
      const steps = after.actions.length;
      return `Macro ${after.index}: ${steps === 0 ? "cleared" : `${after.name} (${steps} ${steps === 1 ? "step" : "steps"})`}`;
    })),
  );
  const settings = preview.settings.flatMap((s) => settingChanges(ctx.definitions, s.qsid, s.before, s.after));
  sections.push(section("settings", "QMK settings", settings));
  return sections.filter((s) => s.count > 0);
}

/** The sections the keyboard has that the file leaves as they are: "encoders", "combos" */
export function unchangedSections(preview: LayoutFilePreview, ctx: PreviewContext): string[] {
  const changed = new Set(previewSections(preview, ctx).map((s) => s.id));
  const { model } = ctx;
  const has: [PreviewSection["id"], string, boolean][] = [
    ["keys", "keys", true],
    ["encoders", "encoders", model.encoders.length > 0],
    ["layoutOptions", "layout options", (model.layoutOptions?.labels.length ?? 0) > 0],
    ["tapDance", "tap dances", model.tapDance.length > 0],
    ["combos", "combos", model.combos.length > 0],
    ["keyOverrides", "key overrides", model.keyOverrides.length > 0],
    ["altRepeatKeys", "alt-repeat keys", model.altRepeatKeys.length > 0],
    ["macros", "macros", model.macros.items.length > 0],
    ["settings", "QMK settings", model.settings.length > 0],
  ];
  return has.filter(([id, , present]) => present && !changed.has(id)).map(([, label]) => label);
}

/** How many changes in all */
export function changeTotal(sections: PreviewSection[]): number {
  return sections.reduce((n, s) => n + s.count, 0);
}

/** The name to save a layout under when the server gives none: the keyboard's, without characters file systems
 * refuse */
export function layoutFileName(keyboardName: string): string {
  const name = keyboardName.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[\s._]+|[\s._]+$/g, "");
  return `${name.slice(0, 100) || "keyboard"}.vil`;
}
