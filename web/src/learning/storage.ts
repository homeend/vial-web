// The lesson set last chosen on the Learning page, remembered by this browser per keyboard (like keymap/view.ts).
export type LearningStorage = Pick<Storage, "getItem" | "setItem">;

/** the storage key of a keyboard's chosen set */
export function chosenSetKey(uid: string): string {
  return `vial.learningSet.${uid}`;
}

/** The set id remembered for the keyboard; null if there is none, or the storage can't be read (private window) */
export function readChosenSet(storage: LearningStorage | null, uid: string): string | null {
  try {
    return storage?.getItem(chosenSetKey(uid)) || null;
  } catch {
    return null;
  }
}

/** Remember the set chosen for the keyboard; false if the storage refuses (it then lasts until the page is closed) */
export function saveChosenSet(storage: LearningStorage | null, uid: string, id: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(chosenSetKey(uid), id);
    return true;
  } catch {
    return false;
  }
}
