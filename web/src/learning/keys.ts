// What a key pressed in the typing area means. Pure: the view hands the event in, and takes the key to type (or what
// to do instead) out.
//
// A key is typed by its `key`: one printable code point (a letter, a digit, Space, "😀"), or Backspace and Enter, which
// the engine knows. Escape quits. A shortcut of the browser's (Ctrl+R, Meta+K) stays one: the view lets it through.
// AltGr on Windows comes as Ctrl+Alt, and its characters (Ctrl+Alt+ą) are typed. Everything else is ignored: the
// modifiers themselves (Shift, AltGraph), Tab, the F-keys, "Dead" (a dead key, whose composed character comes on the
// next keydown in current Chromium and Firefox on Windows) and "Process" (an IME composing; not supported).
// Auto-repeat is ignored too: a drill never needs it, and a key held down is one press, one error at most.

/** the key to type, or "quit" (Escape), "shortcut" (the browser's) or "ignore" (a name, a modifier, a repeat) */
export type KeyMeaning = "quit" | "ignore" | "shortcut" | (string & {});

/** Whether a `key` is one the engine takes: one printable code point, Backspace or Enter */
export function typesKey(key: string): boolean {
  return key === "Backspace" || key === "Enter" || Array.from(key).length === 1;
}

/** What a keydown means to the typing area */
export function keyOf(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat">): KeyMeaning {
  if (event.key === "Escape") return "quit";
  if (event.repeat) return "ignore";
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return "shortcut";
  return typesKey(event.key) ? event.key : "ignore";
}
