// Recording a macro from the keys typed into the browser window (never from the keyboard's own HID interface).
// Each key pressed becomes a step: characters as text, other keys and shortcuts as taps (Ctrl+L, Shift+Tab).
//
// The keyboard types text as the US layout places it, so a character becomes text only when the US layout types it
// with that key; otherwise (another keyboard layout, AltGr) the key itself is tapped, which the computer then reads as
// it read the recorded key. A modifier pressed on its own is not a step, and waits between keys aren't recorded.

/** The keys a recording knows, by KeyboardEvent.code: the keycode, and for those that type a character with the US
 * layout, that character and the shifted one */
const KEYS: Record<string, [code: string, plain?: string, shifted?: string]> = {
  Enter: ["KC_ENTER"], Escape: ["KC_ESCAPE"], Backspace: ["KC_BSPACE"], Tab: ["KC_TAB"], Space: ["KC_SPACE", " ", " "],
  Minus: ["KC_MINUS", "-", "_"], Equal: ["KC_EQUAL", "=", "+"], BracketLeft: ["KC_LBRACKET", "[", "{"],
  BracketRight: ["KC_RBRACKET", "]", "}"], Backslash: ["KC_BSLASH", "\\", "|"], Semicolon: ["KC_SCOLON", ";", ":"],
  Quote: ["KC_QUOTE", "'", "\""], Backquote: ["KC_GRAVE", "`", "~"], Comma: ["KC_COMMA", ",", "<"],
  Period: ["KC_DOT", ".", ">"], Slash: ["KC_SLASH", "/", "?"], CapsLock: ["KC_CAPSLOCK"], IntlBackslash: ["KC_NONUS_BSLASH"],
  PrintScreen: ["KC_PSCREEN"], ScrollLock: ["KC_SCROLLLOCK"], Pause: ["KC_PAUSE"], Insert: ["KC_INSERT"],
  Home: ["KC_HOME"], PageUp: ["KC_PGUP"], Delete: ["KC_DELETE"], End: ["KC_END"], PageDown: ["KC_PGDOWN"],
  ArrowRight: ["KC_RIGHT"], ArrowLeft: ["KC_LEFT"], ArrowDown: ["KC_DOWN"], ArrowUp: ["KC_UP"], NumLock: ["KC_NUMLOCK"],
  NumpadDivide: ["KC_KP_SLASH"], NumpadMultiply: ["KC_KP_ASTERISK"], NumpadSubtract: ["KC_KP_MINUS"],
  NumpadAdd: ["KC_KP_PLUS"], NumpadEnter: ["KC_KP_ENTER"], NumpadDecimal: ["KC_KP_DOT"], NumpadEqual: ["KC_KP_EQUAL"],
  ContextMenu: ["KC_APPLICATION"],
};
for (const letter of "abcdefghijklmnopqrstuvwxyz") KEYS[`Key${letter.toUpperCase()}`] = [`KC_${letter.toUpperCase()}`, letter, letter.toUpperCase()];
"1234567890".split("").forEach((digit, i) => (KEYS[`Digit${digit}`] = [`KC_${digit}`, digit, "!@#$%^&*()"[i]]));
for (let n = 0; n <= 9; n++) KEYS[`Numpad${n}`] = [`KC_KP_${n}`];
for (let n = 1; n <= 12; n++) KEYS[`F${n}`] = [`KC_F${n}`];

type Modifier = "LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI";

const MODIFIERS: Record<string, Modifier> = {
  ControlLeft: "LCTL", ShiftLeft: "LSFT", AltLeft: "LALT", MetaLeft: "LGUI",
  ControlRight: "RCTL", ShiftRight: "RSFT", AltRight: "RALT", MetaRight: "RGUI",
};
/** the order modifiers wrap a keycode in: LCTL(LSFT(KC_A)) */
const WRAP_ORDER: Modifier[] = ["LCTL", "RCTL", "LSFT", "RSFT", "LALT", "RALT", "LGUI", "RGUI"];

export type Recorded = { type: "text"; text: string } | { type: "tap"; code: string };

/** What a recording reads of a key event */
export type KeyPress = Pick<KeyboardEvent, "code" | "key" | "repeat"> & { altGraph: boolean };

export class Recording {
  readonly steps: Recorded[] = [];
  /** keys pressed that have no keycode here */
  skipped = 0;
  #held = new Set<Modifier>();

  keydown(press: KeyPress): void {
    const modifier = MODIFIERS[press.code];
    if (modifier) {
      this.#held.add(modifier);
      return;
    }
    if (press.repeat) return;
    const known = KEYS[press.code];
    if (!known) {
      this.skipped++;
      return;
    }
    const [code, plain, shifted] = known;
    // AltGr is reported as Ctrl and right Alt on Windows: it is right Alt to the keyboard
    const held = new Set(press.altGraph ? [...this.#held].filter((m) => m !== "LCTL" && m !== "RCTL").concat("RALT") : this.#held);
    const shift = held.has("LSFT") || held.has("RSFT");
    const others = [...held].filter((m) => m !== "LSFT" && m !== "RSFT");
    const us = shift ? shifted : plain;
    if (others.length === 0 && us !== undefined && press.key === us) {
      const last = this.steps.at(-1);
      if (last?.type === "text") last.text += us;
      else this.steps.push({ type: "text", text: us });
      return;
    }
    const wrapped = WRAP_ORDER.filter((m) => held.has(m)).reduceRight((inner, m) => `${m}(${inner})`, code);
    this.steps.push({ type: "tap", code: wrapped });
  }

  keyup(press: Pick<KeyboardEvent, "code">): void {
    const modifier = MODIFIERS[press.code];
    if (modifier) this.#held.delete(modifier);
  }
}
