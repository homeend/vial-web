// The Keymap section's view, Edit or Overview, remembered by this browser.
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
