// What loading a .vil file changes, section by section, in words: from the server's preview (POST
// /api/layout-file/preview), with the page's own names for keys, layers and settings.
import type {
  AltRepeatKey, Described, KeyboardModel, KeyOverride, LayoutFilePreview, LayoutOptions, SettingsDefinitions, TapDance,
} from "../api/types";
import { layoutChoices } from "../keyboard/geometry";
import { memberName } from "../analysis/phrases";
import type { Names } from "../keyboard/labels";
import { refId } from "../keyboard/refs";
import { tapDanceIsSet } from "../behaviours/entries";
import { isSet as comboIsSet } from "../behaviours/members";
import {
  ALT_REPEAT_OPTIONS, altRepeatIsSet, altRepeatReady, altRepeatSentence, keyOverrideDetails, keyOverrideIsSet,
  keyOverrideProblems, keyOverrideSentence,
} from "../behaviours/overrides";
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

/** How many values the layout options' bits hold together: the bits above belong to no option (the bit widths of
 * layoutChoices) */
function coveredValues(options: LayoutOptions): number {
  return options.labels.reduce<number>((n, label) => {
    const count = typeof label === "string" ? 2 : label.length - 1;
    return n * 2 ** (count <= 2 ? 1 : (count - 1).toString(2).length);
  }, 1);
}

/** Each layout option whose choice differs: "Split Backspace: off → on", "Bottom row: 6.25U → 7U"; and "other bits:
 * 0 → 8" when bits no option covers differ (the server writes them too) */
export function layoutOptionChanges(options: LayoutOptions | null | undefined, before: number, after: number): string[] {
  if (!options) return [`${before} → ${after}`];
  const was = layoutChoices({ ...options, value: before });
  const now = layoutChoices({ ...options, value: after });
  const changes = options.labels.flatMap((label, i) => {
    if (was[i] === now[i]) return [];
    const name = typeof label === "string" ? label : label[0];
    const choice = (c: number) => (typeof label === "string" ? (c ? "on" : "off") : (label[c + 1] ?? `choice ${c}`));
    return [`${name}: ${choice(was[i])} → ${choice(now[i])}`];
  });
  const covered = coveredValues(options);
  const other = (value: number) => value - (value % covered);
  if (other(before) !== other(after)) changes.push(`other bits: ${other(before)} → ${other(after)}`);
  return changes;
}

function section(id: PreviewSection["id"], title: string, items: string[], summary: string | null = null): PreviewSection {
  return { id, title, count: items.length, summary, items: items.slice(0, LISTED), more: Math.max(0, items.length - LISTED) };
}

/** A tap dance after loading: what it does, and its tapping term when that changes too; "cleared" only for one that
 * did something */
function tapDanceText(before: TapDance, after: TapDance, ctx: PreviewContext): string {
  const term = before.tappingTerm !== after.tappingTerm
    ? ` Tapping term: ${before.tappingTerm} → ${after.tappingTerm} ms.` : "";
  if (tapDanceIsSet(after)) return `${tapDanceSentence(after, ctx.names, ctx.model)}${term}`;
  return tapDanceIsSet(before) ? `cleared${term}` : `does nothing.${term}`;
}

/** A key override after loading: what it does, what isn't QMK's usual about it and why it may not work, said of it
 * (not the editor's prompt for a trigger) */
function keyOverrideText(o: KeyOverride, layerCount: number, names: Names): string {
  const problems = keyOverrideProblems(o, layerCount);
  const ready = o.trigger.kind !== "none" || o.triggerMods !== 0;
  // with no trigger, the problem that it starts on every key press (when it is on) says what it does
  const everyPress = ready ? -1 : problems.findIndex((p) => p.startsWith("With no trigger"));
  const opener = ready ? keyOverrideSentence(o, layerCount, names)
    : everyPress >= 0 ? problems.splice(everyPress, 1)[0] : "No trigger key or modifiers.";
  const parts = [opener, ...keyOverrideDetails(o).map((d) => `${d}.`), ...problems];
  if (!o.enabled) parts.push("Switched off.");
  return parts.join(" ");
}

/** An alt-repeat key after loading: what it does, said of it (not the editor's prompt for a last key). One with no
 * last key that isn't a default alt key only answers its alt key, with nothing, when it goes both ways. */
function altRepeatText(a: AltRepeatKey, names: Names): string {
  const off = a.enabled ? "" : " Switched off.";
  if (altRepeatReady(a)) return `${altRepeatSentence(a, names)}${off}`;
  const back = (a.options & ALT_REPEAT_OPTIONS[1].bit) !== 0 && a.altKeycode.kind !== "none";
  return back
    ? `No last key: after ${memberName(a.altKeycode, names)}, Alt Repeat sends nothing.${off}`
    : `No last key, so it does nothing.${off}`;
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
    section("tapDance", "Tap dances", preview.tapDance.map(({ before, after }) =>
      `Tap dance ${after.index}: ${tapDanceText(before, after, ctx)}`)),
    section("combos", "Combos", preview.combos.map(({ after }) => {
      if (!comboIsSet(after)) return `Combo ${after.index}: cleared`;
      const keys = after.keys.filter((k) => k.kind !== "none").map((k) => shortAction(k, names)).join(" + ");
      return `Combo ${after.index}: ${keys || "no keys"} → ${shortAction(after.output, names)}`;
    })),
    section("keyOverrides", "Key overrides", preview.keyOverrides.map(({ after }) =>
      `Key override ${after.index}: ${keyOverrideIsSet(after) ? keyOverrideText(after, layerCount, names) : "cleared"}`)),
    section("altRepeatKeys", "Alt-repeat keys", preview.altRepeatKeys.map(({ after }) =>
      `Alt-repeat key ${after.index}: ${altRepeatIsSet(after) ? altRepeatText(after, names) : "cleared"}`)),
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
