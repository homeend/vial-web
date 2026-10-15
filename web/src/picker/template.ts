// Templates such as "LSFT(kc)" wrap another keycode; the any-keycode box fills one in.

/** "LSFT(kc)" -> "LSFT(KC_)", for the user to finish */
export function fillTemplate(template: string): string {
  return template.replace("(kc)", "(KC_)");
}

/** An expression that is obviously still being filled in: not worth asking the server about yet */
export function isUnfinished(expression: string): boolean {
  const text = expression.trim();
  return /\bKC_\s*\)/i.test(text) || /\(\s*kc\s*\)/i.test(text) || /\(\s*\)/.test(text) || /[(,]$/.test(text);
}
