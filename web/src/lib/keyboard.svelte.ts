// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
import { untrack } from "svelte";
import { api } from "../api/api";
import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
import { ApiError, failureMessage } from "../api/errors";
import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
import type { KeyboardLanguage, KeyboardModel, KeycodeCategory, Session } from "../api/types";
import { actionAt, type KeyRef } from "../keyboard/refs";
import { freeTapDance } from "../keymap/tapdance";
import { toasts } from "./toasts.svelte";

const LANGUAGE_KEY = "vial.keyboardLanguage";

function savedLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_KEY) ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // not remembered (private window): still used until the page is closed
  }
}

export class KeyboardStore {
  model = $state<KeyboardModel | null>(null);
  // only ever replaced, never changed in place (the picker's search caches by the catalogue array)
  session = $state.raw<Session | null>(null);
  catalogue = $state.raw<KeycodeCategory[]>([]);
  languages = $state.raw<KeyboardLanguage[]>([]);
  language = $state(DEFAULT_LANGUAGE);
  /** the events connection to the server */
  link = $state<LinkState>("connecting");
  /** whether the keyboard is plugged in, as the server last said */
  connected = $state(false);
  /** the model may no longer be the keyboard's (plugged in again, read again, another language) until the latest
   * load succeeds: its layers and matrix positions mustn't be used for edits */
  stale = $state(true);
  loadError = $state<string | null>(null);
  /** edits waiting for the keyboard */
  pending = $state(0);

  canEdit = $derived(this.model !== null && !this.stale && this.connected && this.link === "open");

  #loads = 0;
  /** the language list, or null when it couldn't be read */
  #languageList: Promise<KeyboardLanguage[] | null> = Promise.resolve(null);

  /** Load the language list, then follow the server's events (which start with the keyboard's state) */
  start(): () => void {
    // called from an effect, it must not run again when the state it reads or writes changes
    return untrack(() => {
      this.#useLanguage(savedLanguage());
      this.#languageList = api.languages().then(
        (list) => {
          this.languages = list;
          this.#checkLanguage();
          return list;
        },
        () => null,
      );
      return connectEvents((event) => this.#onEvent(event), (state) => (this.link = state));
    });
  }

  #onEvent(event: ServerEvent): void {
    this.connected = event !== "disconnected";
    this.stale = true;
    if (this.connected) {
      void this.load();
    } else {
      this.#loads++; // a load in flight is for the keyboard that went away
      this.loadError = null;
      api.session().then((s) => (this.session = s), () => undefined);
    }
  }

  /** Read the keyboard (and its keycode catalogue) from the server; only the latest load is kept */
  async load(): Promise<void> {
    const load = ++this.#loads;
    try {
      const [session, model, catalogue] = await Promise.all([api.session(), api.keyboard(), api.keycodes()]);
      if (load !== this.#loads) return;
      this.session = session;
      this.model = model;
      this.catalogue = catalogue;
      this.loadError = null;
      this.stale = false;
    } catch (error) {
      if (load !== this.#loads) return;
      if (error instanceof ApiError && error.status === 503) {
        this.connected = false;
        this.loadError = null;
        return;
      }
      if (error instanceof ApiError && error.status === 422 && this.language !== DEFAULT_LANGUAGE) {
        // maybe the remembered language is gone: the list (once it is here) says, and the default is used instead
        await this.#languageList;
        if (load !== this.#loads || this.#checkLanguage()) return;
      }
      this.loadError = failureMessage("Loading the keyboard", error);
    }
  }

  async setLanguage(lang: string): Promise<void> {
    this.#useLanguage(lang);
    saveLanguage(lang);
    this.stale = true;
    await this.load();
  }

  #useLanguage(lang: string): void {
    this.language = lang;
    setRequestLanguage(lang);
  }

  /** A language the server doesn't have (remembered from an older version) makes it refuse every load: the default
   * is used instead. Returns whether it was. */
  #checkLanguage(): boolean {
    const known = this.languages;
    if (this.language === DEFAULT_LANGUAGE || known.length === 0 || known.some((l) => l.id === this.language)) {
      return false;
    }
    void this.setLanguage(DEFAULT_LANGUAGE);
    return true;
  }

  /** Set a keycode on the keyboard and show what it confirmed. Returns whether it worked. */
  async setCode(layer: number, ref: KeyRef, code: string, action = "Changing the key"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    if (ref.kind === "key") {
      const { row, col } = model.keys[ref.index];
      if (row == null || col == null) return this.#noPosition(action);
      return this.#edit(action, model, async () => {
        const result = await api.setKey(layer, row, col, code);
        // keys of different layout options can share a matrix position
        model.keys.forEach((k, i) => {
          if (k.row === row && k.col === col) model.layers[layer].keys[i] = result;
        });
      });
    }
    const { encoder, direction } = model.encoders[ref.index];
    if (encoder == null || direction == null) return this.#noPosition(action);
    return this.#edit(action, model, async () => {
      const result = await api.setEncoder(layer, encoder, direction, code);
      model.encoders.forEach((e, i) => {
        if (e.encoder === encoder && e.direction === direction) model.layers[layer].encoders[i] = result;
      });
    });
  }

  #noPosition(action: string): false {
    toasts.error(`${action} failed: that key has no matrix position.`);
    return false;
  }

  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key */
  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<boolean> {
    const model = this.model;
    const current = model ? actionAt(model, layer, ref) : undefined;
    const index = model ? freeTapDance(model) : null;
    if (!model || !current || index === null || !this.canEdit) return false;
    const entry = model.tapDance[index];
    const created = await this.#edit("Making a tap dance", model, async () => {
      model.tapDance[index] = await api.setTapDance(index, {
        tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
      });
    });
    if (!created) return false;
    if (!this.canEdit) {
      // setCode reports its own failures, but would refuse this one without a word
      toasts.error(`Tap dance ${index} was made, but the key couldn't be changed to TD(${index}).`);
      return false;
    }
    return this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key");
  }

  async renameLayer(index: number, name: string): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    return this.#edit("Renaming the layer", model, async () => {
      // the reply is the name to show: the new one, or the default name when it was cleared
      const named = await api.setLayerName(index, name);
      model.layers[index].name = named.name;
      model.layers[index].customName = named.customName;
    });
  }

  /** Runs write, which puts the keyboard's reply into model */
  async #edit(action: string, model: KeyboardModel, write: () => Promise<void>): Promise<boolean> {
    this.pending++;
    try {
      await write();
      // a load replaced the model meanwhile and may have read the keyboard before this edit: read it again
      if (this.model !== model) void this.load();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      toasts.error(failureMessage(action, error));
      return false;
    } finally {
      this.pending--;
    }
  }
}

export const keyboard = new KeyboardStore();
