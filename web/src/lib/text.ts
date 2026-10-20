// Small helpers for the sentences the page shows.

/** The text with its first letter in upper case: "the key at row 1" -> "The key at row 1" */
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A reason from the server ("could not list keyboards: ...") as a sentence: capitalised, with a full stop */
export function asSentence(reason: string): string {
  const text = reason.trim();
  if (!text) return text;
  return capitalised(text) + (/[.!?…]$/.test(text) ? "" : ".");
}
