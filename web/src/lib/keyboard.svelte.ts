// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
import { untrack } from "svelte";
import { api } from "../api/api";
import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
import { ApiError, causeMessage, failureMessage } from "../api/errors";
import { connectEvents, type LinkState, type ServerEvent } from "../api/events";
import type {
  KeyboardLanguage, KeyboardModel, KeycodeCategory, MacroActionIn, Named, Session, TapDanceIn,
} from "../api/types";
import { actionAt, type KeyRef } from "../keyboard/refs";
import { freeTapDance } from "../keymap/tapdance";
import { toasts } from "./toasts.svelte";
import { LOCKED, Unlocker, type UnlockOutcome } from "./unlock.svelte";

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
  /** whether the keyboard is unlocked, and the unlock dialog */
  readonly unlock = new Unlocker();

  canEdit = $derived(this.model !== null && !this.stale && this.connected && this.link === "open");

  #loads = 0;
  /** keyboards plugged in or unplugged so far ("connected" and "disconnected" events, and loads that found another
   * keyboard): once it changes, the keyboard may not be the one it was */
  #plugs = 0;
  /** the events link (re)opened, and its first event hasn't come yet */
  #opening = false;
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
      return connectEvents((event) => this.#onEvent(event), (state) => this.#onLink(state));
    });
  }

  #onLink(state: LinkState): void {
    this.link = state;
    if (state === "open") this.#opening = true;
  }

  #onEvent(event: ServerEvent): void {
    if (event.type === "unlock") {
      if (event.unlock) this.unlock.update(event.unlock);
      return;
    }
    // the server's first event on a link (re)opened says how the keyboard is: a "connected" there, when it was
    // connected already, is no plug, unless the load it brings finds another keyboard (see load)
    const opening = this.#opening;
    this.#opening = false;
    const unchanged = event.type === "reloaded" || (opening && event.type === "connected" && this.connected);
    if (!unchanged) this.#plugs++;
    this.connected = event.type !== "disconnected";
    this.stale = true;
    if (this.connected) {
      void this.load();
    } else {
      this.#loads++; // a load in flight is for the keyboard that went away
      this.loadError = null;
      // the server says "disconnected" only for a loaded keyboard, or for one it couldn't read once it was unlocked
      // (the session says why): an unlock it ran is over, even if the session can't be read
      this.unlock.update(LOCKED);
      api.session().then((s) => this.#useSession(s), () => undefined);
    }
  }

  /** Read the keyboard (and its keycode catalogue) from the server; only the latest load is kept */
  async load(): Promise<void> {
    const load = ++this.#loads;
    try {
      const [session, model, catalogue] = await Promise.all([api.session(), api.keyboard(), api.keycodes()]);
      if (load !== this.#loads) return;
      // another keyboard (plugged in while the events link was down, say): before the session is used, as an unlock
      // it ends tells those waiting for it
      if (this.model !== null && model.uid !== this.model.uid) this.#plugs++;
      this.#useSession(session);
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

  #useSession(session: Session): void {
    this.session = session;
    this.unlock.update(session.unlock);
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

  /** Put the key's current action into a free tap dance's tap slot, then put that tap dance on the key. Returns the
   * tap dance's index, or null when it didn't work. */
  async turnIntoTapDance(layer: number, ref: KeyRef): Promise<number | null> {
    const model = this.model;
    const current = model ? actionAt(model, layer, ref) : undefined;
    const index = model ? freeTapDance(model) : null;
    if (!model || !current || index === null || !this.canEdit) return null;
    const entry = model.tapDance[index];
    const created = await this.setTapDance(index, {
      tap: current.code, hold: "KC_NO", doubleTap: "KC_NO", tapHold: "KC_NO", tappingTerm: entry.tappingTerm,
    }, "Making a tap dance");
    if (!created) return null;
    if (!this.canEdit) {
      // setCode reports its own failures, but would refuse this one without a word
      toasts.error(`Tap dance ${index} was made, but the key couldn't be changed to TD(${index}).`);
      return null;
    }
    return (await this.setCode(layer, ref, `TD(${index})`, "Putting the tap dance on the key")) ? index : null;
  }

  /** Set a tap dance's four slots and its tapping term */
  setTapDance(index: number, body: TapDanceIn, action = "Changing the tap dance"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      model.tapDance[index] = await api.setTapDance(index, body);
    });
  }

  /** Set a combo: its keycodes (at most 4; the empty slots are filled in) and its output */
  setCombo(index: number, keys: string[], output: string, action = "Changing the combo"): Promise<boolean> {
    if (keys.length > 4) throw new RangeError(`a combo has at most 4 keys, not ${keys.length}`);
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    const slots = [...keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4);
    return this.#edit(action, model, async () => {
      model.combos[index] = await api.setCombo(index, { keys: slots, output });
    });
  }

  /** Set every macro: they share the macro memory (the keyboard keeps the bytes of those that didn't change) */
  setMacros(items: MacroActionIn[][], action = "Saving the macro"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      model.macros = await api.setMacros(items);
    });
  }

  /** Name a layer, tap dance or macro; an empty name gives it its default one back */
  rename(kind: Named["kind"], index: number, name: string): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    const what = { layers: "layer", tapDance: "tap dance", macros: "macro" }[kind];
    const items = () => (kind === "layers" ? model.layers : kind === "tapDance" ? model.tapDance : model.macros.items);
    if (!items()[index]) throw new RangeError(`there is no ${what} ${index}`);
    return this.#edit(`Renaming the ${what}`, model, async () => {
      // the reply is the name to show: the new one, or the default name when it was cleared
      const named = await api.setName(kind, index, name);
      // looked up again: the macros may have been replaced meanwhile
      const item = items()[index];
      if (item) Object.assign(item, { name: named.name, customName: named.customName });
    });
  }

  /** Runs write, which puts the keyboard's reply into model. A change refused because the keyboard is locked unlocks
   * it (the user holds its unlock keys) and is sent again, once, unless the keyboard was unplugged or another one
   * plugged in meanwhile: the change was for the one that went. */
  async #edit(action: string, model: KeyboardModel, write: () => Promise<void>): Promise<boolean> {
    this.pending++;
    const loads = this.#loads;
    const plugs = this.#plugs;
    try {
      try {
        await write();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 423)) throw error;
        const outcome = await this.unlock.unlockQuietly();
        if (!outcome.unlocked || this.#plugs !== plugs) {
          toasts.error(this.#notUnlocked(action, outcome));
          return false;
        }
        await write();
      }
      // a load started or landed meanwhile and may have read the keyboard before this edit (it can land after it,
      // too): read it again, unless the keyboard is gone
      if ((this.#loads !== loads || this.model !== model) && this.connected) void this.load();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      toasts.error(failureMessage(action, error));
      return false;
    } finally {
      this.pending--;
    }
  }

  /** Why a change refused as the keyboard is locked wasn't sent again: one message for the change and its unlock */
  #notUnlocked(action: string, outcome: UnlockOutcome): string {
    const why = !outcome.unlocked && outcome.failure !== undefined
      ? `unlocking it failed: ${causeMessage(outcome.failure)}` : "it wasn't unlocked.";
    return `${action} failed: The keyboard is locked, and ${why}`;
  }
}

export const keyboard = new KeyboardStore();
