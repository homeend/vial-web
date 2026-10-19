import { describe, expect, it } from "vitest";
import { Recording, type KeyPress } from "./recorder";

const press = (code: string, key: string, more: Partial<KeyPress> = {}): KeyPress =>
  ({ code, key, repeat: false, altGraph: false, ...more });

/** The KeyboardEvent.code of the key a US keyboard types `char` with, unshifted */
function codeOf(char: string): string {
  if (char === " ") return "Space";
  if (/^[a-z]$/.test(char)) return `Key${char.toUpperCase()}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  throw new Error(`type() can't type ${JSON.stringify(char)}`);
}

/** Types `text` as a US keyboard would: each character pressed and released */
function type(recording: Recording, text: string) {
  for (const char of text) {
    const code = codeOf(char);
    recording.keydown(press(code, char));
    recording.keyup({ code });
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

  it("the test's type() refuses characters it can't type", () => {
    expect(() => type(new Recording(), "é")).toThrow(/can't type "é"/);
  });

  it("adds to text with new steps, leaving the ones it handed out unchanged", () => {
    const r = new Recording();
    type(r, "a");
    const first = r.steps[0];
    type(r, "b");
    expect(first).toEqual({ type: "text", text: "a" });
    expect(r.steps).toEqual([{ type: "text", text: "ab" }]);
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

  it("taps Shift with a digit another layout shifts to another character", () => {
    // German: Shift+2 types " where the US layout types @
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift", { shiftKey: true }));
    r.keydown(press("Digit2", "\"", { shiftKey: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "LSFT(KC_2)" }]);
  });

  it("taps the ISO key next to left Shift as itself", () => {
    // German: < on the key the US ANSI layout doesn't have
    const r = new Recording();
    r.keydown(press("IntlBackslash", "<"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_NONUS_BSLASH" }]);
  });

  it("taps a dead key and the letter after it, which the computer combines again", () => {
    // US International: ' then a types á
    const r = new Recording();
    r.keydown(press("Quote", "Dead"));
    r.keyup({ code: "Quote" });
    r.keydown(press("KeyA", "á"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_QUOTE" }, { type: "tap", code: "KC_A" }]);
  });

  it("taps the keys an input method is composing from", () => {
    const r = new Recording();
    r.keydown(press("KeyK", "Process"));
    r.keydown(press("KeyA", "Process"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_K" }, { type: "tap", code: "KC_A" }]);
  });

  it("taps numpad keys as numpad keys, whatever Num Lock makes them type", () => {
    const r = new Recording();
    r.keydown(press("Numpad7", "Home"));
    r.keydown(press("Numpad7", "7"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_KP_7" }, { type: "tap", code: "KC_KP_7" }]);
  });

  it("taps AltGr characters as right Alt with the key, without the Ctrl Windows adds", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("AltRight", "AltGraph"));
    r.keydown(press("KeyA", "ą", { altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RALT(KC_A)" }]);
  });

  it("taps AltGr characters on Linux, where AltGr is right Alt alone and Alt isn't reported", () => {
    const r = new Recording();
    r.keydown(press("AltRight", "AltGraph", { altGraph: true, altKey: false, ctrlKey: false }));
    r.keydown(press("KeyE", "€", { altGraph: true, altKey: false, ctrlKey: false }));
    expect(r.steps).toEqual([{ type: "tap", code: "RALT(KC_E)" }]);
  });

  it("keeps AltGr when Firefox on Windows reports neither Ctrl nor Alt with its character", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control", { ctrlKey: true }));
    r.keydown(press("AltRight", "AltGraph", { ctrlKey: true, altKey: true, altGraph: true }));
    r.keydown(press("KeyQ", "@", { ctrlKey: false, altKey: false, altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RALT(KC_Q)" }]);
  });

  it("taps AltGr with Shift as right-hand Shift and right Alt, as the keyboard stores them", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift", { shiftKey: true }));
    r.keydown(press("ControlLeft", "Control", { shiftKey: true, ctrlKey: true }));
    r.keydown(press("AltRight", "AltGraph", { shiftKey: true, ctrlKey: true, altKey: true, altGraph: true }));
    r.keydown(press("KeyA", "Ą", { shiftKey: true, ctrlKey: true, altKey: true, altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RSFT(RALT(KC_A))" }]);
  });

  it("keeps a real right Ctrl held with AltGr", () => {
    const r = new Recording();
    r.keydown(press("ControlRight", "Control"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("AltRight", "AltGraph"));
    r.keydown(press("KeyA", "ą", { altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "RCTL(RALT(KC_A))" }]);
  });

  it("keeps left Ctrl when AltGraph is reported without right Alt held (Ctrl+Alt)", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("AltLeft", "Alt"));
    r.keydown(press("KeyA", "ą", { altGraph: true }));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(LALT(KC_A))" }]);
  });

  it("names left-hand modifiers by their right-hand forms when a right-hand one is held", () => {
    // the keyboard stores modifiers as four bits and one 'right-hand' bit for them all
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("ShiftRight", "Shift"));
    r.keydown(press("KeyT", "T"));
    expect(r.steps).toEqual([{ type: "tap", code: "RCTL(RSFT(KC_T))" }]);
  });

  it("wraps several modifiers in a fixed order", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyT", "T"));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(LSFT(KC_T))" }]);
  });

  it("forgets a modifier whose release it never saw when the next key says it is up", () => {
    // Alt+Tab away: the window never sees Alt released
    const r = new Recording();
    r.keydown(press("AltLeft", "Alt", { altKey: true }));
    r.keydown(press("Tab", "Tab", { altKey: true }));
    r.keydown(press("KeyL", "l", { altKey: false }));
    r.keydown(press("MetaLeft", "Meta", { metaKey: true }));
    r.keydown(press("KeyS", "s", { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }));
    expect(r.steps).toEqual([{ type: "tap", code: "LALT(KC_TAB)" }, { type: "text", text: "ls" }]);
  });

  it("keeps modifiers held when the key event doesn't say", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("KeyL", "l"));
    r.keydown(press("KeyK", "k", { shiftKey: false }));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(KC_L)" }, { type: "tap", code: "LCTL(KC_K)" }]);
  });

  it("forgets every held modifier on releaseAll", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keydown(press("ShiftRight", "Shift"));
    r.releaseAll();
    type(r, "a");
    expect(r.steps).toEqual([{ type: "text", text: "a" }]);
  });

  it("ignores the release of an ordinary key", () => {
    const r = new Recording();
    r.keydown(press("ControlLeft", "Control"));
    r.keyup({ code: "KeyX" });
    r.keydown(press("KeyX", "x"));
    expect(r.steps).toEqual([{ type: "tap", code: "LCTL(KC_X)" }]);
  });

  it("with Caps Lock on, records letters as the keys type them without it", () => {
    // the computer's Caps Lock is still on when the macro plays: text "h" sends H, which it types as "H" again
    const r = new Recording();
    r.keydown(press("KeyH", "H", { capsLock: true }));
    r.keydown(press("KeyI", "I", { capsLock: true }));
    r.keydown(press("ShiftLeft", "Shift", { capsLock: true, shiftKey: true }));
    r.keydown(press("KeyA", "a", { capsLock: true, shiftKey: true }));
    r.keydown(press("Digit1", "!", { capsLock: true, shiftKey: true }));
    expect(r.steps).toEqual([{ type: "text", text: "hiA!" }]);
  });

  it("without Caps Lock reported, taps a letter typed in the other case", () => {
    const r = new Recording();
    r.keydown(press("KeyH", "H"));
    expect(r.steps).toEqual([{ type: "tap", code: "KC_H" }]);
  });

  it("knows international, F13-F24, media and volume keys, and the old names of the GUI keys", () => {
    const r = new Recording();
    const keys = ["IntlRo", "IntlYen", "NumpadComma", "Lang1", "Lang2", "Convert", "NonConvert", "KanaMode", "F13",
      "F24", "MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious", "MediaStop", "AudioVolumeUp",
      "AudioVolumeDown", "AudioVolumeMute"];
    for (const code of keys) r.keydown(press(code, "Unidentified"));
    r.keydown(press("OSLeft", "OS"));
    r.keydown(press("KeyL", "l"));
    r.keyup({ code: "OSLeft" });
    r.keydown(press("OSRight", "OS"));
    r.keydown(press("KeyD", "d"));
    expect(r.steps.map((s) => (s.type === "tap" ? s.code : s.text))).toEqual([
      "KC_RO", "KC_JYEN", "KC_KP_COMMA", "KC_LANG1", "KC_LANG2", "KC_HENK", "KC_MHEN", "KC_KANA", "KC_F13", "KC_F24",
      "KC_MPLY", "KC_MNXT", "KC_MPRV", "KC_MSTP", "KC_VOLU", "KC_VOLD", "KC_MUTE", "LGUI(KC_L)", "RGUI(KC_D)",
    ]);
    expect(r.skipped).toBe(0);
  });

  it("leaves out modifiers pressed on their own, held keys repeating, and keys it doesn't know", () => {
    const r = new Recording();
    r.keydown(press("ShiftLeft", "Shift"));
    r.keyup(press("ShiftLeft", "Shift"));
    r.keydown(press("KeyA", "a"));
    r.keydown(press("KeyA", "a", { repeat: true }));
    r.keydown(press("BrowserBack", "BrowserBack"));
    r.keydown(press("", "Unidentified"));
    expect(r.steps).toEqual([{ type: "text", text: "a" }]);
    expect(r.skipped).toBe(2);
  });
});
