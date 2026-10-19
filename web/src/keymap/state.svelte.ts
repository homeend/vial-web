// What the Keymap page shows, kept while another page shows: the app draws one page at a time, so the Keymap page is
// made anew when it comes back (a combo opened from the Inspector, then Back). The layer, the selected key and the
// find box's text start over for another keyboard; the view (Edit or Overview) is this browser's, as view.ts keeps it.
import type { KeyRef } from "../keyboard/refs";
import { browserStorage } from "../lib/theme";
import { readView, type KeymapView } from "./view";

export class KeymapState {
  layer = $state(0);
  selection = $state<KeyRef | null>(null);
  findText = $state("");
  view = $state<KeymapView>("edit");
  /** the keyboard (its uid) the layer, selection and find text are for */
  #uid: string | null = null;

  constructor(view: KeymapView = "edit") {
    this.view = view;
  }

  /** Start over when the keyboard isn't the one shown before */
  follow(uid: string): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.layer = 0;
    this.selection = null;
    this.findText = "";
  }
}

export const keymapState = new KeymapState(readView(browserStorage()));
