import { describe, expect, it } from "vitest";
import { Recording, type KeyPress } from "./recorder";

const press = (code: string, key: string, more: Partial<KeyPress> = {}): KeyPress =>
  ({ code, key, repeat: false, altGraph: false, ...more });

/** Types `text` as a US keyboard would: each character pressed and released */
function type(recording: Recording, text: string) {
  for (const char of text) {
    const code = char === " " ? "Space" : /[a-z]/.test(char) ? `Key${char.toUpperCase()}` : "";
    recording.keydown(press(code, char));
    recording.keyup(press(code, char));
  }
}

describe("Recording", () => {
  it("turns characters into text, other keys and shortcuts into taps", () => {
    const r = new Recording();
    type(r, "git status");
    r.keydown(press("Enter", "Enter"));
    r.keyup(press("Enter", "Enter"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyL", "l"));
    r.keyup(press("KeyL", "l"));
    r.keyup(press("ControlLeft", "Control"));
    type(r, "ls");
    expect(r.steps).toEqual([
      { type: "text", text: "git status" }, { type: "tap", code: "KC_ENTER" }, { type: "tap", code: "LCTL(KC_L)" },
      { type: "text", text: "ls" },
    ]);
  });

  it("types shifted characters as text, and taps Shift with other keys", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keydown(press("Digit1", "!"));
    r.keydown(press("KeyA", "A"));
    r.keydown(press("Tab", "Tab"));
    r.keyup(press("ShiftLeft", "Shift"));
    expect(r.steps).toEqual([{ type: "text", text: "!A" }, { type: "tap", code: "LSFT(KC_TAB)" }]);
  });

  it("taps the key itself when another layout puts another character there", () => {
    // German: the key the US layout has Y on types z
    const r = new Recording();
    r.keydown(press("KeyY", "z"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_Y" }]);
  });

  it("taps AltGr characters as right Alt with the key, without the Ctrl Windows adds", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("AltRight", "AltGraph"));
    r.keydown(press("KeyA", "ą", { altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RALT(KC_A)" }]);
  });

  it("wraps several modifiers in a fixed order", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyT", "T"));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(LSFT(KC_T))" }]);
  });

  it("leaves out modifiers pressed on their own, held keys repeating, and keys it doesn't know", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keyup(press("ShiftLeft", "Shift"));
    r.keydown(press("KeyA", "a"));
    r.keydown(press("KeyA", "a", { repeat: true }));
    r.keydown(press("F20", "F20"));
    r.keydown(press("MediaPlayPause", "MediaPlayPause"));
    expect(r.steps).toEqual([{ type: "text", text: "a" }]);
    expect(r.skipped).toBe(2);
  });
});
