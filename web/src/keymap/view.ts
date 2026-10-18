// The Keymap section's view, Edit or Overview, and whether "How … is reached" is open, remembered by this browser.
export type KeymapView = "edit" | "overview";

export const VIEW_KEY = "vial.keymapView";
export const VIEWS: { value: KeymapView; label: string }[] = [
  { value: "edit", label: "Edit" },
  { value: "overview", label: "Overview" },
];

export type ViewStorage = Pick<Storage, "getItem" | "setItem">;

/** The remembered view; Edit if there is none, or the storage can't be read (private window) */
export function readView(storage: ViewStorage | null): KeymapView {
  try {
    return storage?.getItem(VIEW_KEY) === "overview" ? "overview" : "edit";
  } catch {
    return "edit";
  }
}

/** Remember the view; false if the storage refuses (it then lasts until the page is closed) */
export function saveView(storage: ViewStorage | null, view: KeymapView): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VIEW_KEY, view);
    return true;
  } catch {
    return false;
  }
}

export const REACH_OPEN_KEY = "vial.reachOpen";

/** Whether "How … is reached" above the keyboard is open; folded away if not remembered, or unreadable */
export function readReachOpen(storage: ViewStorage | null): boolean {
  try {
    return storage?.getItem(REACH_OPEN_KEY) === "open";
  } catch {
    return false;
  }
}

/** Remember whether it is open; false if the storage refuses */
export function saveReachOpen(storage: ViewStorage | null, open: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(REACH_OPEN_KEY, open ? "open" : "closed");
    return true;
  } catch {
    return false;
  }
}
