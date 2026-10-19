// The names people call keys by, which the keycode catalogue doesn't give: its labels are short ("Bksp", "Up") and
// basic keys have no description. Search finds a key by these as by its label, and the find box by them as by its
// name. Lowercase; a label the key already has ("caps lock") isn't repeated here.

const ARROW = (direction: string) => [`${direction} arrow`, `arrow ${direction}`, `${direction}arrow`];

export const EVERYDAY_NAMES: Record<string, string[]> = {
  KC_ENTER: ["return"],
  KC_ESCAPE: ["escape"],
  KC_BSPACE: ["backspace", "back space"],
  KC_SPACE: ["spacebar", "space bar"],
  KC_MINUS: ["minus", "hyphen", "dash"],
  KC_EQUAL: ["equals", "equal"],
  KC_LBRACKET: ["left bracket", "open bracket", "square bracket"],
  KC_RBRACKET: ["right bracket", "close bracket", "square bracket"],
  KC_BSLASH: ["backslash", "back slash"],
  KC_SCOLON: ["semicolon"],
  KC_QUOTE: ["quote", "apostrophe", "single quote"],
  KC_GRAVE: ["grave", "backtick", "back tick", "tilde"],
  KC_COMMA: ["comma"],
  KC_DOT: ["period", "dot", "full stop"],
  KC_SLASH: ["slash", "forward slash"],
  KC_CAPSLOCK: ["capslock"],
  KC_APPLICATION: ["application", "context menu"],
  KC_NUMLOCK: ["numlock"],
  KC_PSCREEN: ["printscreen", "prtsc", "prt sc", "screenshot"],
  KC_SCROLLLOCK: ["scrolllock"],
  KC_PAUSE: ["break", "pause break"],
  KC_DELETE: ["delete"],
  KC_INSERT: ["ins"],
  KC_PGUP: ["pageup", "pgup"],
  KC_PGDOWN: ["pagedown", "pgdn", "pgdown"],
  KC_UP: ARROW("up"),
  KC_DOWN: ARROW("down"),
  KC_LEFT: ARROW("left"),
  KC_RIGHT: ARROW("right"),
  "LSFT(KC_GRAVE)": ["tilde"],
  "LSFT(KC_1)": ["exclamation mark", "bang"],
  "LSFT(KC_2)": ["at sign"],
  "LSFT(KC_3)": ["hash", "pound", "number sign"],
  "LSFT(KC_4)": ["dollar"],
  "LSFT(KC_5)": ["percent"],
  "LSFT(KC_6)": ["caret"],
  "LSFT(KC_7)": ["ampersand"],
  "LSFT(KC_8)": ["asterisk", "star"],
  "LSFT(KC_9)": ["left parenthesis", "open parenthesis", "left paren"],
  "LSFT(KC_0)": ["right parenthesis", "close parenthesis", "right paren"],
  "LSFT(KC_MINUS)": ["underscore"],
  "LSFT(KC_EQUAL)": ["plus"],
  "LSFT(KC_LBRACKET)": ["left brace", "open brace", "curly brace"],
  "LSFT(KC_RBRACKET)": ["right brace", "close brace", "curly brace"],
  "LSFT(KC_COMMA)": ["less than"],
  "LSFT(KC_DOT)": ["greater than"],
  "LSFT(KC_SCOLON)": ["colon"],
  "LSFT(KC_BSLASH)": ["pipe", "vertical bar"],
  "LSFT(KC_SLASH)": ["question mark"],
  "LSFT(KC_QUOTE)": ["double quote", "quotation mark"],
};

const KEYPAD = /^KC_KP_/;

/** The everyday names of a keycode: from the table, and "numpad 1" / "keypad 1" for the keypad's keys */
export function everydayNames(code: string, tap: string | null): string[] {
  const names = [...(EVERYDAY_NAMES[code] ?? [])];
  if (KEYPAD.test(code) && tap) names.push(`numpad ${tap.toLowerCase()}`, `keypad ${tap.toLowerCase()}`);
  return names;
}
