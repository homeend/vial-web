// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
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

class KeyboardStore {
  model = $state<KeyboardModel | null>(null);
  session = $state<Session | null>(null);
  catalogue = $state<KeycodeCategory[]>([]);
  languages = $state<KeyboardLanguage[]>([]);
  language = $state(DEFAULT_LANGUAGE);
  /** the events connection to the server */
  link = $state<LinkState>("connecting");
  /** whether the keyboard is plugged in, as the server last said */
  connected = $state(false);
  loadError = $state<string | null>(null);
  /** edits waiting for the keyboard */
  pending = $state(0);

  canEdit = $derived(this.model !== null && this.connected && this.link === "open");

  #loads = 0;

  /** Load the language list, then follow the server's events (which start with the keyboard's state) */
  start(): () => void {
    // reads no state: called from an effect, it must not run again when the language changes
    const language = savedLanguage();
    this.language = language;
    setRequestLanguage(language);
    api.languages().then((list) => (this.languages = list), () => undefined);
    return connectEvents((event) => this.#onEvent(event), (state) => (this.link = state));
  }

  #onEvent(event: ServerEvent): void {
    this.connected = event !== "disconnected";
    if (this.connected) void this.load();
    else api.session().then((s) => (this.session = s), () => undefined);
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
    } catch (error) {
      if (load !== this.#loads) return;
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      else this.loadError = failureMessage("Loading the keyboard", error);
    }
  }

  async setLanguage(lang: string): Promise<void> {
    this.language = lang;
    setRequestLanguage(lang);
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      // not remembered (private window): still used until the page is closed
    }
    await this.load();
  }

  /** Set a keycode on the keyboard and show what it confirmed. Returns whether it worked. */
  async setCode(layer: number, ref: KeyRef, code: string, action = "Changing the key"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    return this.#edit(action, async () => {
      if (ref.kind === "key") {
        const { row, col } = model.keys[ref.index];
        const result = await api.setKey(layer, row ?? 0, col ?? 0, code);
        // keys of different layout options can share a matrix position
        model.keys.forEach((k, i) => {
          if (k.row === row && k.col === col) model.layers[layer].keys[i] = result;
        });
      } else {
        const { encoder, direction } = model.encoders[ref.index];
        const result = await api.setEncoder(layer, encoder ?? 0, direction ?? 0, code);
        model.encoders.forEach((e, i) => {
          if (e.encoder === encoder && e.direction === direction) model.layers[layer].encoders[i] = result;
        });
      }
    });
  }

  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key */
  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<boolean> {
    const model = this.model;
    const current = model ? actionAt(model, layer, ref) : undefined;
    const index = model ? freeTapDance(model) : null;
    if (!model || !current || index === null || !this.canEdit) return false;
    const entry = model.tapDance[index];
    const created = await this.#edit("Making a tap dance", async () => {
      model.tapDance[index] = await api.setTapDance(index, {
        tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
      });
    });
    return created && this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key");
  }

  async renameLayer(index: number, name: string): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    return this.#edit("Renaming the layer", async () => {
      // the reply is the name to show: the new one, or the default name when it was cleared
      const named = await api.setLayerName(index, name);
      model.layers[index].name = named.name;
      model.layers[index].customName = named.customName;
    });
  }

  async #edit(action: string, write: () => Promise<void>): Promise<boolean> {
    this.pending++;
    try {
      await write();
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
