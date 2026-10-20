import { describe, expect, it } from "vitest";
import type { KeyboardEntry, KeyboardList } from "../api/types";
import { asSentence, blockedWhy, chosenAway, keyboardOptions, shownKeyboard } from "./keyboards";

function entry(id: string, name: string, more: Partial<KeyboardEntry> = {}): KeyboardEntry {
  return {
    id, name, product: name, manufacturer: "", vendorId: 1, productId: 2, serial: null, path: `usb-${id}`, open: false,
    plugged: true, ...more,
  };
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

  it("numbers keyboards alike as the server does, which keeps each one's number while it stays plugged in", () => {
    const both = list([entry("k#2", "Corne", { open: true }), entry("k#1", "Corne")]);
    expect(keyboardOptions(both).map((o) => o.label)).toEqual(["Corne (2)", "Corne (1)"]);
    // the first unplugged and chosen: each keeps its label
    const away = list([entry("k#1", "Corne", { plugged: false }), entry("k#2", "Corne")], "k#1");
    expect(keyboardOptions(away).map((o) => o.label)).toEqual(["Corne (1) (unplugged)", "Corne (2)"]);
    // the same name, but not alike for the server (other IDs): both are its 1st, so their order tells
    const kinds = list([entry("a#1", "Corne"), entry("b#1", "Corne")]);
    expect(keyboardOptions(kinds).map((o) => o.label)).toEqual(["Corne (1)", "Corne (2)"]);
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

describe("blockedWhy", () => {
  const plugged = list([entry("a", "A"), entry("b", "B")]);
  const away = list([entry("a", "A", { plugged: false }), entry("b", "B")], "a");

  it("is unplugged when there is no error", () => {
    expect(blockedWhy({ error: null, errorKind: null }, plugged, "a")).toBe("unplugged");
    expect(blockedWhy(null, plugged, "a")).toBe("unplugged");
  });

  it("is the listing when looking for keyboards failed", () => {
    expect(blockedWhy({ error: "could not list keyboards: boom", errorKind: "list" }, plugged, "a")).toBe("list");
    expect(blockedWhy({ error: "could not list keyboards: boom", errorKind: "list" }, away, "a")).toBe("list");
  });

  it("is unreadable only when the keyboard shown is plugged in", () => {
    const error = { error: "unsupported", errorKind: "read" as const };
    expect(blockedWhy(error, plugged, "a")).toBe("unread");
    // unplugged, with another keyboard beside it that couldn't be read: it is unplugged
    expect(blockedWhy(error, list([entry("b", "B")]), "a")).toBe("unplugged");
    expect(blockedWhy(error, away, "a")).toBe("unplugged");
    expect(blockedWhy(error, plugged, null)).toBe("unplugged");
    expect(blockedWhy(error, null, "a")).toBe("unplugged");
  });
});

describe("asSentence", () => {
  it("capitalises a reason and ends it with a full stop", () => {
    expect(asSentence("unsupported keyboard")).toBe("Unsupported keyboard.");
    expect(asSentence("a newer Vial may read it.")).toBe("A newer Vial may read it.");
    expect(asSentence("")).toBe("");
  });
});
