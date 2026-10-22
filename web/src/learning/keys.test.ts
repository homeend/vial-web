import { describe, expect, it } from "vitest";
import { keyOf, typesKey } from "./keys";

type Keydown = Parameters<typeof keyOf>[0];

function keydown(key: string, rest: Partial<Omit<Keydown, "key">> = {}): Keydown {
  return { key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...rest };
}

describe("keyOf", () => {
  it("quits on Escape", () => {
    expect(keyOf(keydown("Escape"))).toBe("quit");
  });

  it("leaves the browser its shortcuts: Ctrl without Alt, and Meta", () => {
    expect(keyOf(keydown("r", { ctrlKey: true }))).toBe("shortcut");
    expect(keyOf(keydown("k", { metaKey: true }))).toBe("shortcut");
  });

  it("types an AltGr character, which Windows sends as Ctrl+Alt", () => {
    expect(keyOf(keydown("ą", { ctrlKey: true, altKey: true }))).toBe("ą");
  });

  it("ignores the modifiers themselves, a dead key and an IME composing", () => {
    expect(keyOf(keydown("AltGraph"))).toBe("ignore");
    expect(keyOf(keydown("Shift"))).toBe("ignore");
    expect(keyOf(keydown("Dead"))).toBe("ignore");
    expect(keyOf(keydown("Process"))).toBe("ignore");
  });

  it("ignores auto-repeat", () => {
    expect(keyOf(keydown("a", { repeat: true }))).toBe("ignore");
    expect(keyOf(keydown("Backspace", { repeat: true }))).toBe("ignore");
  });

  it("ignores Tab and the F-keys, which keep their work", () => {
    expect(keyOf(keydown("Tab"))).toBe("ignore");
    expect(keyOf(keydown("F5"))).toBe("ignore");
  });

  it("types Space, with Shift held too", () => {
    expect(keyOf(keydown(" "))).toBe(" ");
  });

  it("types Enter and Backspace, which the engine knows", () => {
    expect(keyOf(keydown("Enter"))).toBe("Enter");
    expect(keyOf(keydown("Backspace"))).toBe("Backspace");
  });

  it("types one code point beyond the BMP", () => {
    expect(keyOf(keydown("😀"))).toBe("😀");
  });
});

describe("typesKey", () => {
  it("takes one printable code point, Backspace and Enter", () => {
    expect(typesKey("a")).toBe(true);
    expect(typesKey("😀")).toBe(true);
    expect(typesKey("Backspace")).toBe(true);
    expect(typesKey("Enter")).toBe(true);
  });

  it("takes no name", () => {
    expect(typesKey("Tab")).toBe(false);
    expect(typesKey("Dead")).toBe(false);
    expect(typesKey("")).toBe(false);
  });
});
