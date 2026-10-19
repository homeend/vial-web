import { describe, expect, it } from "vitest";
import type { SettingField, SettingsDefinitions } from "../api/types";
import {
  changeCount, changed, fieldChanged, fieldText, groupChanges, isOn, numberProblem, settingChanges, settingGroups,
  valuesOf, withBit,
} from "./qmkSettings";

const bool = (title: string, qsid: number, bit?: number): SettingField =>
  ({ type: "boolean", title, qsid, bit: bit ?? null, width: bit === undefined ? null : 4, min: null, max: null });
const int = (title: string, qsid: number, min: number, max: number): SettingField =>
  ({ type: "integer", title, qsid, bit: null, width: 2, min, max });

/** a part of qmk_settings.json */
const DEFINITIONS: SettingsDefinitions = {
  tabs: [
    { name: "Magic", fields: [bool("Swap Caps Lock and Left Control", 21, 0), bool("Treat Caps Lock as Control", 21, 1),
      bool("Enable N-key rollover", 21, 7)] },
    { name: "Grave Escape", fields: [bool("Always send Escape if Alt is pressed", 1, 0)] },
    { name: "Tap-Hold", fields: [int("Tapping Term", 7, 0, 10000), bool("Permissive Hold", 8, 0),
      bool("Permissive Hold", 22), int("Quick Tap Term", 25, 0, 10000)] },
  ],
};
const MAGIC = DEFINITIONS.tabs[0].fields;
const TERM = DEFINITIONS.tabs[2].fields[0];

describe("settingGroups", () => {
  it("keeps the groups and settings the keyboard has, in the definitions' order", () => {
    const groups = settingGroups(DEFINITIONS, [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }, { qsid: 21, value: 0 }]);
    expect(groups.map((g) => [g.name, g.fields.map((f) => f.qsid)])).toEqual([
      ["Magic", [21, 21, 21]], ["Tap-Hold", [7, 22]],
    ]);
  });
});

describe("boolean fields", () => {
  it("are one bit of their setting", () => {
    expect(isOn(MAGIC[1], 0b10)).toBe(true);
    expect(isOn(MAGIC[0], 0b10)).toBe(false);
    expect(isOn(MAGIC[2], 0x80)).toBe(true);
  });

  it("switch their bit and keep the others, those no field covers too", () => {
    expect(withBit(MAGIC[0], 0b10, true)).toBe(0b11);
    expect(withBit(MAGIC[1], 0b11, false)).toBe(0b01);
    expect(withBit(MAGIC[1], 0b10, true)).toBe(0b10);
    expect(withBit(MAGIC[0], 0x400, true)).toBe(0x401); // bit 10: Qt's form would clear it
  });

  it("read in words", () => {
    expect(fieldText(MAGIC[2], 0x80)).toBe("on");
    expect(fieldText(MAGIC[0], 0x80)).toBe("off");
    expect(fieldText(TERM, 180)).toBe("180");
  });
});

describe("numberProblem", () => {
  it("takes a whole number in the field's range", () => {
    expect(numberProblem(TERM, "250", 200)).toBeNull();
    expect(numberProblem(TERM, " 0 ", 200)).toBeNull();
    expect(numberProblem(TERM, "10000", 200)).toBeNull();
  });

  it("refuses anything else", () => {
    for (const text of ["", "abc", "1.5", "-1", "10001", "1e3"]) {
      expect(numberProblem(TERM, text, 200), text).toBe("Not a whole number from 0 to 10000.");
    }
  });

  it("takes what the keyboard holds, even beyond the range", () => {
    expect(numberProblem(TERM, "20000", 20000)).toBeNull();
  });
});

describe("changes", () => {
  const held = valuesOf([{ qsid: 7, value: 200 }, { qsid: 21, value: 0 }, { qsid: 22, value: 0 }]);

  it("are the settings whose value differs, in qsid order", () => {
    const form = new Map(held).set(21, 0b10).set(7, 250).set(22, 0);
    expect(changed(held, form)).toEqual([{ qsid: 7, value: 250 }, { qsid: 21, value: 2 }]);
    expect(changed(held, held)).toEqual([]);
  });

  it("are counted by field, a boolean only when its own bit changed", () => {
    const form = new Map(held).set(21, 0b10).set(7, 250);
    expect(fieldChanged(MAGIC[0], held, form)).toBe(false);
    expect(fieldChanged(MAGIC[1], held, form)).toBe(true);
    expect(fieldChanged(TERM, held, form)).toBe(true);
    expect(groupChanges({ name: "Magic", fields: MAGIC }, held, form)).toBe(1);
    expect(changeCount(1)).toBe("1 change");
    expect(changeCount(3)).toBe("3 changes");
  });

  it("are told field by field, for a layout file's preview", () => {
    expect(settingChanges(DEFINITIONS, 7, 200, 250)).toEqual(["Tapping Term: 200 → 250"]);
    expect(settingChanges(DEFINITIONS, 21, 0b10, 0b1)).toEqual([
      "Swap Caps Lock and Left Control: off → on", "Treat Caps Lock as Control: on → off",
    ]);
    expect(settingChanges(DEFINITIONS, 30, 1, 2)).toEqual(["Setting 30: 1 → 2"]);
    expect(settingChanges(null, 7, 1, 2)).toEqual(["Setting 7: 1 → 2"]);
  });
});
