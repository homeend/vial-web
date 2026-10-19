import { describe, expect, it } from "vitest";
import type { SettingField } from "../api/types";
import { changed } from "./qmkSettings";
import { SettingsEdits } from "./state.svelte";

const term: SettingField = { type: "integer", title: "Tapping Term", qsid: 7, bit: null, width: 2, min: 0, max: 10000 };
const swap: SettingField = { type: "boolean", title: "Swap Caps Lock and Left Control", qsid: 21, bit: 0, width: 4,
  min: null, max: null };
const treat: SettingField = { ...swap, title: "Treat Caps Lock as Control", bit: 1 };
const permissive: SettingField = { type: "boolean", title: "Permissive Hold", qsid: 22, bit: null, width: null,
  min: null, max: null };

/** What the keyboard holds, by qsid */
const held = (values: Record<number, number>) => new Map(Object.entries(values).map(([q, v]) => [Number(q), v]));

describe("SettingsEdits", () => {
  it("keeps the changes for the same keyboard, and starts over for another", () => {
    const edits = new SettingsEdits();
    edits.follow("A");
    edits.type(term, "250", 200);
    edits.toggle(swap, true, 0);
    edits.follow("A");
    expect(edits.form(held({ 7: 200, 21: 0 }))).toEqual(held({ 7: 250, 21: 1 }));
    expect(edits.texts).toEqual({ 7: "250" });
    edits.follow("B");
    expect(edits.form(held({ 7: 200, 21: 0 }))).toEqual(held({ 7: 200, 21: 0 }));
    expect(edits.texts).toEqual({});
  });

  it("takes a number that can be saved; one that can't drops the change, so no count shows it", () => {
    const edits = new SettingsEdits();
    const now = held({ 7: 200 });
    edits.type(term, "250", 200);
    expect(edits.form(now)).toEqual(held({ 7: 250 }));
    edits.type(term, "25x", 200);
    expect([edits.form(now), edits.texts]).toEqual([now, { 7: "25x" }]);
    edits.type(term, "20000", 200);
    expect(edits.form(now)).toEqual(now);
  });

  it("puts each change over what the keyboard holds now: a switch over the setting's other bits", () => {
    const edits = new SettingsEdits();
    edits.toggle(swap, true, 0);
    edits.type(term, "250", 200);
    expect(edits.form(held({ 7: 200, 21: 0 }))).toEqual(held({ 7: 250, 21: 0b01 }));
    // another bit of the setting changed on the keyboard (a layout file, a re-read): it is kept, and only the bit
    // switched here is saved
    const now = held({ 7: 300, 21: 0b10 });
    expect(edits.form(now)).toEqual(held({ 7: 250, 21: 0b11 }));
    expect(changed(now, edits.form(now))).toEqual([{ qsid: 7, value: 250 }, { qsid: 21, value: 0b11 }]);
    // a switch with no bit of its own is bit 0
    edits.toggle(permissive, true, 0);
    expect(edits.form(held({ 22: 0b100 })).get(22)).toBe(0b101);
  });

  it("drops a change that is what the keyboard holds: switched back, typed back, or held now", () => {
    const edits = new SettingsEdits();
    edits.toggle(swap, true, 0);
    edits.toggle(swap, false, 0);
    edits.type(term, "250", 200);
    edits.type(term, "200", 200);
    expect([edits.form(held({ 7: 200, 21: 0 })), edits.texts]).toEqual([held({ 7: 200, 21: 0 }), {}]);

    edits.toggle(swap, true, 0);
    edits.toggle(treat, true, 0);
    edits.type(term, "250", 200);
    // the keyboard took some of them (saved, or loaded from elsewhere)
    const now = held({ 7: 250, 21: 0b01 });
    expect(changed(now, edits.form(now))).toEqual([{ qsid: 21, value: 0b11 }]);
    edits.settle(now);
    expect(edits.texts).toEqual({});
    // what is left still goes over what the keyboard holds later
    expect(edits.form(held({ 7: 100, 21: 0 }))).toEqual(held({ 7: 100, 21: 0b10 }));
  });

  it("forgets every change", () => {
    const edits = new SettingsEdits();
    edits.type(term, "250", 200);
    edits.type(term, "25x", 200);
    edits.toggle(swap, true, 0);
    edits.clear();
    expect([edits.form(held({ 7: 200, 21: 0 })), edits.texts]).toEqual([held({ 7: 200, 21: 0 }), {}]);
  });
});
