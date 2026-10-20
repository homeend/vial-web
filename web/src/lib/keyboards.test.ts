import { describe, expect, it } from "vitest";
import type { KeyboardEntry, KeyboardList } from "../api/types";
import { asSentence, chosenAway, keyboardOptions, shownKeyboard } from "./keyboards";

function entry(id: string, name: string, more: Partial<KeyboardEntry> = {}): KeyboardEntry {
  return { id, name, vendorId: 1, productId: 2, serial: null, open: false, plugged: true, ...more };
}

function list(keyboards: KeyboardEntry[], chosen: string | null = null): KeyboardList {
  return { keyboards, chosen };
}

describe("keyboardOptions", () => {
  it("names each keyboard", () => {
    expect(keyboardOptions(list([entry("a", "Corne"), entry("b", "Lily58")])).map((o) => o.label))
      .toEqual(["Corne", "Lily58"]);
    expect(keyboardOptions(null)).toEqual([]);
  });

  it("tells keyboards of the same name apart by their serial numbers, else by their order", () => {
    const serials = list([entry("a", "Corne", { serial: "A1" }), entry("b", "Corne", { serial: "B2" }),
      entry("c", "Lily58")]);
    expect(keyboardOptions(serials).map((o) => o.label)).toEqual(["Corne (A1)", "Corne (B2)", "Lily58"]);
    const none = list([entry("a", "Corne"), entry("b", "Corne", { serial: "B2" })]);
    expect(keyboardOptions(none).map((o) => o.label)).toEqual(["Corne (1)", "Corne (2)"]);
    const same = list([entry("a", "Corne", { serial: "X" }), entry("b", "Corne", { serial: "X" })]);
    expect(keyboardOptions(same).map((o) => o.label)).toEqual(["Corne (1)", "Corne (2)"]);
  });

  it("says which one is unplugged", () => {
    const options = keyboardOptions(list([entry("a", "Corne"), entry("b", "Pad", { plugged: false })], "b"));
    expect(options.map((o) => o.label)).toEqual(["Corne", "Pad (unplugged)"]);
    expect(options.map((o) => o.name)).toEqual(["Corne", "Pad"]);
  });

  it("cuts a long name short, and keeps it whole for the tooltip", () => {
    const name = "A keyboard with a very long product name indeed, too long";
    const [option] = keyboardOptions(list([entry("a", name, { plugged: false })], "a"));
    expect(option.label).toBe("A keyboard with a very long product nam… (unplugged)");
    expect(option.full).toBe(`${name} (unplugged)`);
  });
});

describe("shownKeyboard", () => {
  it("is the keyboard open, else the one chosen, else none", () => {
    expect(shownKeyboard(list([entry("a", "A"), entry("b", "B", { open: true })], "a"))).toBe("b");
    expect(shownKeyboard(list([entry("a", "A"), entry("b", "B", { plugged: false })], "b"))).toBe("b");
    expect(shownKeyboard(list([entry("a", "A"), entry("b", "B")]))).toBe("");
    expect(shownKeyboard(null)).toBe("");
  });
});

describe("chosenAway", () => {
  it("is the chosen keyboard while it is unplugged", () => {
    const away = entry("b", "B", { plugged: false });
    expect(chosenAway(list([entry("a", "A"), away], "b"))).toBe(away);
    expect(chosenAway(list([entry("a", "A"), entry("b", "B")], "b"))).toBeNull();
    expect(chosenAway(list([entry("a", "A")]))).toBeNull();
    expect(chosenAway(null)).toBeNull();
  });
});

describe("asSentence", () => {
  it("capitalises a reason and ends it with a full stop", () => {
    expect(asSentence("unsupported keyboard")).toBe("Unsupported keyboard.");
    expect(asSentence("a newer Vial may read it.")).toBe("A newer Vial may read it.");
    expect(asSentence("")).toBe("");
  });
});
