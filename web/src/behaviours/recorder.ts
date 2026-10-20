// Recording a macro from the keys typed into the browser window (never from the keyboard's own HID interface).
// Each key pressed becomes a step: characters as text, other keys and shortcuts as taps (Ctrl+L, Shift+Tab).
//
// The keyboard types text as the US layout places it, so a character becomes text only when the US layout types it
// with that key; otherwise (another keyboard layout, AltGr, dead keys, an input method) the key itself is tapped,
// which the computer then reads as it read the recorded key. A modifier pressed on its own is not a step, and waits
// between keys aren't recorded.
//
// Like a tapped key, text assumes the computer's Caps Lock and Num Lock are as they were while recording: with
// Caps Lock on, KeyH types "H", so it is recorded as the text "h", which the keyboard sends as H and Caps Lock turns
// into "H" again.

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
  NumpadComma: ["KC_KP_COMMA"], ContextMenu: ["KC_APPLICATION"],
  IntlRo: ["KC_RO"], IntlYen: ["KC_JYEN"], KanaMode: ["KC_KANA"], Convert: ["KC_HENK"], NonConvert: ["KC_MHEN"],
  Lang1: ["KC_LANG1"], Lang2: ["KC_LANG2"],
  MediaPlayPause: ["KC_MPLY"], MediaTrackNext: ["KC_MNXT"], MediaTrackPrevious: ["KC_MPRV"], MediaStop: ["KC_MSTP"],
  AudioVolumeUp: ["KC_VOLU"], AudioVolumeDown: ["KC_VOLD"], AudioVolumeMute: ["KC_MUTE"],
};
for (const letter of "abcdefghijklmnopqrstuvwxyz") KEYS[`Key${letter.toUpperCase()}`] = [`KC_${letter.toUpperCase()}`, letter, letter.toUpperCase()];
"1234567890".split("").forEach((digit, i) => (KEYS[`Digit${digit}`] = [`KC_${digit}`, digit, "!@#$%^&*()"[i]]));
for (let n = 0; n <= 9; n++) KEYS[`Numpad${n}`] = [`KC_KP_${n}`];
for (let n = 1; n <= 24; n++) KEYS[`F${n}`] = [`KC_F${n}`];

type Modifier = "LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI";

const MODIFIERS: Record<string, Modifier> = {
  ControlLeft: "LCTL", ShiftLeft: "LSFT", AltLeft: "LALT", MetaLeft: "LGUI", OSLeft: "LGUI",
  ControlRight: "RCTL", ShiftRight: "RSFT", AltRight: "RALT", MetaRight: "RGUI", OSRight: "RGUI",
};
/** the order modifiers wrap a keycode in: LCTL(LSFT(KC_A)) */
const WRAP_ORDER: Modifier[] = ["LCTL", "RCTL", "LSFT", "RSFT", "LALT", "RALT", "LGUI", "RGUI"];
const RIGHT: Record<Modifier, Modifier> = {
  LCTL: "RCTL", LSFT: "RSFT", LALT: "RALT", LGUI: "RGUI", RCTL: "RCTL", RSFT: "RSFT", RALT: "RALT", RGUI: "RGUI",
};
/** the KeyPress flag that says whether a modifier is down */
const FLAG: Record<Modifier, "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> = {
  LCTL: "ctrlKey", RCTL: "ctrlKey", LSFT: "shiftKey", RSFT: "shiftKey",
  LALT: "altKey", RALT: "altKey", LGUI: "metaKey", RGUI: "metaKey",
};

export type Recorded = { type: "text"; text: string } | { type: "tap"; code: string };

/** Where a recording's steps go once it stops: after the macro's steps ("append"), or in their place ("replace", as
 * Qt's "Replace everything") */
export type RecordMode = "append" | "replace";

/** The macro's steps once a recording stopped. Nothing recorded replaces nothing: the steps there are kept. */
export function stepsRecorded<T>(steps: T[], made: T[], mode: RecordMode): T[] {
  return mode === "replace" && made.length > 0 ? [...made] : [...steps, ...made];
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the macro editor says once a recording stopped: `made` steps recorded, `skipped` keys with no keycode, and
 * `before` steps there when it started */
export function recordedNote(made: number, skipped: number, mode: RecordMode, before: number): string {
  const unread = skipped > 0 ? `; ${counted(skipped, "key has", "keys have")} no keycode here` : "";
  if (mode === "replace" && made === 0) {
    return `Nothing was recorded, so ${before === 1 ? "the step there is" : `the ${before} steps there are`} kept${unread}.`;
  }
  const recorded = `${counted(made, "step", "steps")} recorded`;
  if (mode === "append") return `${recorded}${unread}.`;
  return `${recorded}, in place of ${before === 1 ? "the step" : `the ${before} steps`} there before${unread}. ` +
    "Cancel puts back the macro as the keyboard has it.";
}

/** What a recording reads of a key event. The optional flags are the event's ctrlKey, shiftKey, altKey, metaKey and
 * getModifierState("CapsLock"): given, they let the recording forget modifiers released while the window couldn't see
 * it (Alt+Tab away), and read letters typed with Caps Lock on. */
export type KeyPress = Pick<KeyboardEvent, "code" | "key" | "repeat"> & {
  altGraph: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  capsLock?: boolean;
};

export class Recording {
  readonly steps: Recorded[] = [];
  /** keys pressed that have no keycode here */
  skipped = 0;
  #held = new Set<Modifier>();

  keydown(press: KeyPress): void {
    this.#forgetReleased(press);
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
    const held = this.#modifiers(press.altGraph);
    const shift = held.has("LSFT") || held.has("RSFT");
    const others = [...held].filter((m) => m !== "LSFT" && m !== "RSFT");
    const us = shift ? shifted : plain;
    // Caps Lock flips the case of letters (only theirs, on the US layout)
    const typed = us !== undefined && press.capsLock && press.code.startsWith("Key") ? flipCase(us) : us;
    if (others.length === 0 && us !== undefined && press.key === typed) {
      const last = this.steps.at(-1);
      if (last?.type === "text") this.steps[this.steps.length - 1] = { type: "text", text: last.text + us };
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

  /** Forgets every modifier held, e.g. when the window loses focus and won't see them released */
  releaseAll(): void {
    this.#held.clear();
  }

  /** Drops the modifiers the event says are up. AltGr keeps its Ctrl and Alt: Firefox on Windows may report neither
   * with an AltGr character. */
  #forgetReleased(press: KeyPress): void {
    for (const m of [...this.#held]) {
      if (press.altGraph && (FLAG[m] === "ctrlKey" || FLAG[m] === "altKey")) continue;
      if (press[FLAG[m]] === false) this.#held.delete(m);
    }
  }

  /** The modifiers to wrap a key in */
  #modifiers(altGraph: boolean): Set<Modifier> {
    const held = new Set(this.#held);
    if (altGraph) {
      // AltGr is right Alt to the keyboard. Windows reports it as left Ctrl and right Alt: drop that left Ctrl (a
      // real one held with AltGr can't be told apart), but not a right Ctrl, nor the Ctrl of Ctrl+Alt
      if (held.has("RALT")) held.delete("LCTL");
      // AltGr pressed before the recording could see it
      else if (!held.has("LALT")) held.add("RALT");
    }
    // the keyboard stores modifiers as four bits and one "right-hand" bit for them all: LSFT(RALT(KC_A)) is
    // RSFT(RALT(KC_A)), so name them as it stores them
    if ([...held].some((m) => RIGHT[m] === m)) return new Set([...held].map((m) => RIGHT[m]));
    return held;
  }
}

function flipCase(char: string): string {
  const upper = char.toUpperCase();
  return char === upper ? char.toLowerCase() : upper;
}
