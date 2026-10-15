// Light or dark: the system's (the default), or chosen in the top bar and remembered by this browser.
// index.html applies a saved choice before the first paint, with the same key and values.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "vial.theme";
export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export type ThemeRoot = Pick<HTMLElement, "setAttribute" | "removeAttribute">;

/** The remembered choice; the system's theme if there is none, or the storage can't be read (private window) */
export function readTheme(storage: ThemeStorage | null): ThemeChoice {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/** Remember the choice; false if the storage refuses (it then lasts until the page is closed) */
export function saveTheme(storage: ThemeStorage | null, choice: ThemeChoice): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** data-theme="light" or "dark" on the root element picks the palette; without it, prefers-color-scheme does */
export function applyTheme(root: ThemeRoot, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** The browser's storage, or null where it can't even be reached */
export function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
