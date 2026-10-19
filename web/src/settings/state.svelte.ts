// The Settings page's changes not saved yet, kept while another page shows: the app draws one page at a time, so the
// page is made anew when it comes back, and the changes would be lost. They are for one keyboard (its uid), and start
// over for another, as the Keymap page's state does (keymap/state.svelte.ts).
import type { SettingField } from "../api/types";
import { numberProblem } from "./qmkSettings";

export class SettingsEdits {
  /** the values changed in the form, by qsid (a boolean changes a bit of its setting's value) */
  edits = $state<Record<number, number>>({});
  /** what the number boxes hold while it isn't the value: being typed, or not a number they take */
  texts = $state<Record<number, string>>({});
  /** the keyboard (its uid) the changes are for */
  #uid: string | null = null;

  /** Start over when the keyboard isn't the one the changes were made for */
  follow(uid: string): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.clear();
  }

  /** A number typed into an integer field: the change is made when the number can be saved, and dropped when it can't
   * (the box keeps the text and says why), so no count of changes shows what the form doesn't */
  type(field: SettingField, text: string, held: number | undefined): void {
    this.texts[field.qsid] = text;
    if (numberProblem(field, text, held) === null) this.edits[field.qsid] = Number(text);
    else delete this.edits[field.qsid];
  }

  /** A setting is done with: saved, say */
  forget(qsid: number): void {
    delete this.edits[qsid];
    delete this.texts[qsid];
  }

  clear(): void {
    this.edits = {};
    this.texts = {};
  }
}

export const settingsEdits = new SettingsEdits();
