// The QMK settings form: the groups qmk_settings.json defines, with only the settings the keyboard has; each field's
// value (a boolean is one bit of its setting), what changed, and why a number can't be saved. As the Qt app does it,
// but a setting's bits no field covers are kept as they are (Qt's form clears them).
import type { QmkSetting, SettingField, SettingsDefinitions } from "../api/types";

export interface SettingGroup {
  name: string;
  fields: SettingField[];
}

/** The groups that have a setting the keyboard has, with only those settings, in the definitions' order */
export function settingGroups(definitions: SettingsDefinitions, settings: QmkSetting[]): SettingGroup[] {
  const have = new Set(settings.map((s) => s.qsid));
  return definitions.tabs
    .map((tab) => ({ name: tab.name, fields: tab.fields.filter((f) => have.has(f.qsid)) }))
    .filter((group) => group.fields.length > 0);
}

/** Settings by qsid */
export type Values = ReadonlyMap<number, number>;

export function valuesOf(settings: QmkSetting[]): Map<number, number> {
  return new Map(settings.map((s) => [s.qsid, s.value]));
}

function bitOf(field: SettingField): number {
  return 2 ** (field.bit ?? 0);
}

/** Whether a boolean field is on in its setting's value */
export function isOn(field: SettingField, value: number): boolean {
  return Math.floor(value / bitOf(field)) % 2 === 1;
}

/** The setting's value with a boolean field switched on or off; its other bits stay */
export function withBit(field: SettingField, value: number, on: boolean): number {
  return isOn(field, value) === on ? value : on ? value + bitOf(field) : value - bitOf(field);
}

/** Why a number typed into an integer field can't be saved, or null. What the keyboard holds is always fine (firmware
 * defaults can lie outside the range), as the server sees it. */
export function numberProblem(field: SettingField, text: string, held: number | undefined): string | null {
  const range = `a whole number from ${field.min ?? 0} to ${field.max ?? 0}`;
  if (!/^\s*\d+\s*$/.test(text)) return `Not ${range}.`;
  const value = Number(text);
  if (value === held) return null;
  return value < (field.min ?? 0) || value > (field.max ?? 0) ? `Not ${range}.` : null;
}

/** The settings whose value in the form differs from the keyboard's, in qsid order */
export function changed(held: Values, form: Values): QmkSetting[] {
  return [...form]
    .filter(([qsid, value]) => held.has(qsid) && held.get(qsid) !== value)
    .sort(([a], [b]) => a - b)
    .map(([qsid, value]) => ({ qsid, value }));
}

/** Whether a field shows another value in the form than the keyboard holds */
export function fieldChanged(field: SettingField, held: Values, form: Values): boolean {
  const before = held.get(field.qsid);
  const now = form.get(field.qsid);
  if (before === undefined || now === undefined || before === now) return false;
  return field.type === "boolean" ? isOn(field, before) !== isOn(field, now) : true;
}

/** How many fields of a group were changed */
export function groupChanges(group: SettingGroup, held: Values, form: Values): number {
  return group.fields.filter((f) => fieldChanged(f, held, form)).length;
}

/** "1 change", "3 changes" */
export function changeCount(n: number): string {
  return `${n} ${n === 1 ? "change" : "changes"}`;
}

/** A field's value in words, for lists of changes: "on", "off", "200" */
export function fieldText(field: SettingField, value: number): string {
  return field.type === "boolean" ? (isOn(field, value) ? "on" : "off") : String(value);
}

/** The changes from one value of a setting to another, field by field: "Tapping Term: 200 → 250", "Swap Caps Lock and
 * Left Control: off → on"; "Setting 30: 1 → 2" for one the definitions don't have, or when only bits no field covers
 * change */
export function settingChanges(definitions: SettingsDefinitions | null, qsid: number, before: number,
  after: number): string[] {
  const whole = before === after ? [] : [`Setting ${qsid}: ${before} → ${after}`];
  const fields = definitions?.tabs.flatMap((t) => t.fields).filter((f) => f.qsid === qsid) ?? [];
  const changes = fields
    .filter((f) => fieldText(f, before) !== fieldText(f, after))
    .map((f) => `${f.title}: ${fieldText(f, before)} → ${fieldText(f, after)}`);
  return changes.length > 0 ? changes : whole;
}
