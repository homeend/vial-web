import { describe, expect, it } from "vitest";
import type { SettingField } from "../api/types";
import { SettingsEdits } from "./state.svelte";

const term: SettingField = { type: "integer", title: "Tapping Term", qsid: 7, bit: null, width: 2, min: 0, max: 10000 };

describe("SettingsEdits", () => {
  it("keeps the changes for the same keyboard, and starts over for another", () => {
    const edits = new SettingsEdits();
    edits.follow("A");
    edits.type(term, "250", 200);
    edits.edits[21] = 1;
    edits.follow("A");
    expect([edits.edits, edits.texts]).toEqual([{ 7: 250, 21: 1 }, { 7: "250" }]);
    edits.follow("B");
    expect([edits.edits, edits.texts]).toEqual([{}, {}]);
  });

  it("takes a number that can be saved; one that can't drops the change, so no count shows it", () => {
    const edits = new SettingsEdits();
    edits.type(term, "250", 200);
    expect(edits.edits).toEqual({ 7: 250 });
    edits.type(term, "25x", 200);
    expect([edits.edits, edits.texts]).toEqual([{}, { 7: "25x" }]);
    edits.type(term, "20000", 200);
    expect(edits.edits).toEqual({});
  });

  it("forgets every change, or one saved", () => {
    const edits = new SettingsEdits();
    edits.type(term, "250", 200);
    edits.edits[21] = 1;
    edits.forget(7);
    expect([edits.edits, edits.texts]).toEqual([{ 21: 1 }, {}]);
    edits.clear();
    expect([edits.edits, edits.texts]).toEqual([{}, {}]);
  });
});
