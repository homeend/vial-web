// The Settings page's changes not saved yet, kept while another page shows: the app draws one page at a time, so the
// page is made anew when it comes back, and the changes would be lost. They are for one keyboard (its uid), and start
// over for another, as the Keymap page's state does (keymap/state.svelte.ts).
//
// Each change is kept field by field (a switch: its bit wanted on or off; a number: the number wanted) and put over
// what the keyboard holds NOW, when the form is shown and when it is saved: a layout file loaded or the keyboard read
// again changes what is underneath, and a change made here never writes the other bits of its setting back as they
// were. A change that is what the keyboard holds is no change.
import type { SettingField } from "../api/types";
import { bitIsOn, bitOf, numberProblem, withBitAt, type Values } from "./qmkSettings";

/** A switch's key: its setting and bit, "21:0" */
function switchKey(field: SettingField): string {
  return `${field.qsid}:${bitOf(field)}`;
}

export class SettingsEdits {
  /** the switches changed in the form: whether each is wanted on, by setting and bit ("21:0") */
  switches = $state<Record<string, boolean>>({});
  /** the numbers changed in the form, which can be saved, by qsid */
  numbers = $state<Record<number, number>>({});
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

  /** The form: what the keyboard holds, with each change made here put over it */
  form(held: Values): Map<number, number> {
    const form = new Map(held);
    for (const [qsid, value] of Object.entries(this.numbers)) {
      if (form.has(Number(qsid))) form.set(Number(qsid), value);
    }
    for (const [key, on] of Object.entries(this.switches)) {
      const [qsid, bit] = key.split(":").map(Number);
      const value = form.get(qsid);
      if (value !== undefined) form.set(qsid, withBitAt(value, bit, on));
    }
    return form;
  }

  /** A switch switched: a change while it differs from what the keyboard holds (`held`, its setting's value) */
  toggle(field: SettingField, on: boolean, held: number | undefined): void {
    const key = switchKey(field);
    if (held !== undefined && bitIsOn(held, bitOf(field)) === on) delete this.switches[key];
    else this.switches[key] = on;
  }

  /** A number typed into an integer field: the change is made when the number can be saved, and dropped when it can't
   * (the box keeps the text and says why), so no count of changes shows what the form doesn't. Typed back to what the
   * keyboard holds, there is nothing left to keep. */
  type(field: SettingField, text: string, held: number | undefined): void {
    if (held !== undefined && text === String(held)) {
      delete this.numbers[field.qsid];
      delete this.texts[field.qsid];
      return;
    }
    this.texts[field.qsid] = text;
    if (numberProblem(field, text, held) === null) this.numbers[field.qsid] = Number(text);
    else delete this.numbers[field.qsid];
  }

  /** Drops the changes the keyboard holds already: saved, or loaded or read from elsewhere */
  settle(held: Values): void {
    for (const [key, on] of Object.entries(this.switches)) {
      const [qsid, bit] = key.split(":").map(Number);
      const value = held.get(qsid);
      if (value !== undefined && bitIsOn(value, bit) === on) delete this.switches[key];
    }
    for (const [qsid, value] of Object.entries(this.numbers)) {
      if (held.get(Number(qsid)) === value) {
        delete this.numbers[Number(qsid)];
        delete this.texts[Number(qsid)];
      }
    }
  }

  /** Whether there are changes not saved for this keyboard (its uid): a number that can't be saved counts, as the form
   * shows it */
  keptFor(uid: string): boolean {
    return this.#uid === uid && Object.keys(this.switches).length + Object.keys(this.numbers).length +
      Object.keys(this.texts).length > 0;
  }

  clear(): void {
    this.switches = {};
    this.numbers = {};
    this.texts = {};
  }
}

export const settingsEdits = new SettingsEdits();
