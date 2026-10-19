// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
import { untrack } from "svelte";
import { api } from "../api/api";
import { DEFAULT_LANGUAGE, setRequestLanguage } from "../api/client";
import { ApiError, causeMessage, failureMessage } from "../api/errors";
import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "../api/events";
import type {
  AltRepeatKeyIn, KeyboardLanguage, KeyboardModel, KeycodeCategory, KeyOverrideIn, LightingIn, MacroActionIn,
  MatrixState, Named, QmkSetting, Session, TapDanceIn,
} from "../api/types";
import { keyTitle, namesOf } from "../keyboard/labels";
import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
import { unlockFirst, type Change } from "../keymap/move";
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

/** "the key at row 1, column 2", "encoder 0, clockwise": a key named by where it is in the matrix */
function defaultPlace(model: KeyboardModel, ref: KeyRef): string {
  const { what, where } = whereIs(model, ref);
  return ref.kind === "key" ? `the key at ${where}` : `${what.toLowerCase()}, ${where}`;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether a key or encoder direction has a matrix position (or encoder and direction) to write to */
function hasPosition(model: KeyboardModel, ref: KeyRef): boolean {
  if (ref.kind === "key") {
    const key = model.keys[ref.index];
    return key?.row != null && key.col != null;
  }
  const encoder = model.encoders[ref.index];
  return encoder?.encoder != null && encoder.direction != null;
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
  /** the keys held, as the server last read them, while the matrix tester watches (watchMatrix); null before the
   * first reading */
  matrix = $state.raw<MatrixState | null>(null);
  /** this page restarted the keyboard into its bootloader, and it hasn't come back since */
  inBootloader = $state(false);

  canEdit = $derived(this.model !== null && !this.stale && this.connected && this.link === "open");

  #loads = 0;
  /** keyboards plugged in or unplugged so far ("connected" and "disconnected" events, and loads that found another
   * keyboard): once it changes, the keyboard may not be the one it was */
  #plugs = 0;
  /** the events link (re)opened, and its first event hasn't come yet */
  #opening = false;
  /** the language list, or null when it couldn't be read */
  #languageList: Promise<KeyboardLanguage[] | null> = Promise.resolve(null);
  #link: EventsLink | null = null;
  /** pages watching the keys held */
  #matrixWatchers = 0;

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
      const link = connectEvents((event) => this.#onEvent(event), (state) => this.#onLink(state));
      this.#link = link;
      return () => {
        link.close();
        if (this.#link === link) this.#link = null;
      };
    });
  }

  /** Get the keys held, about 20 times a second while the keyboard is unlocked (in `matrix`), until the function it
   * returns is called. The server reads them while any page of any tab watches. */
  watchMatrix(): () => void {
    this.#matrixWatchers++;
    if (this.#matrixWatchers === 1) this.#link?.send({ type: "matrix", watch: true });
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      this.#matrixWatchers--;
      if (this.#matrixWatchers === 0) {
        this.#link?.send({ type: "matrix", watch: false });
        this.matrix = null;
      }
    };
  }

  #onLink(state: LinkState): void {
    this.link = state;
    if (state === "open") {
      this.#opening = true;
      // a link opened again starts with nothing asked for
      if (this.#matrixWatchers > 0) this.#link?.send({ type: "matrix", watch: true });
    }
  }

  #onEvent(event: ServerEvent): void {
    if (event.type === "unlock") {
      if (event.unlock) this.unlock.update(event.unlock);
      return;
    }
    if (event.type === "matrix") {
      if (event.matrix && this.#matrixWatchers > 0) this.matrix = event.matrix;
      return;
    }
    // the list of keyboards changed: no plug of the keyboard loaded
    if (event.type === "keyboards") return;
    // the server's first event on a link (re)opened says how the keyboard is: a "connected" there, when it was
    // connected already, is no plug, unless the load it brings finds another keyboard (see load)
    const opening = this.#opening;
    this.#opening = false;
    const unchanged = event.type === "reloaded" || (opening && event.type === "connected" && this.connected);
    if (!unchanged) this.#plugs++;
    this.connected = event.type !== "disconnected";
    if (event.type === "connected") this.inBootloader = false;
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
    if (!hasPosition(model, ref)) return this.#noPosition(action);
    return this.#edit(action, model, async () => {
      await this.#writeCode(model, layer, ref, code);
    });
  }

  /** Set several keycodes on a layer, one after another (a swap: both keys), as one change: busy until all are
   * written. Those a locked keyboard refuses (the bootloader key) go first, so that nothing is written when it isn't
   * unlocked for them; a locked keyboard is unlocked for the one it refused, and the rest are written. When one can't
   * be written, those written before it are put back, last first (not on a keyboard unplugged or replaced meanwhile);
   * the failure's message says so, or names each key that kept its change, by placeOf (where the key is, "row 1,
   * column 2" by default) and what it does now. Returns whether all were written. */
  async setCodes(
    layer: number, changes: Change[], action: string, placeOf?: (ref: KeyRef) => string,
  ): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return false;
    if (!changes.every((c) => hasPosition(model, c.ref))) return this.#noPosition(action);
    const ordered = unlockFirst(changes);
    const written: Change[] = [];
    const write = async () => {
      for (const change of ordered.slice(written.length)) {
        await this.#writeCode(model, layer, change.ref, change.code);
        written.push(change);
      }
    };
    const place = (ref: KeyRef) => capitalised(placeOf ? placeOf(ref) : defaultPlace(model, ref));
    const now = (ref: KeyRef) => {
      const action = actionAt(model, layer, ref);
      return action ? keyTitle(action, namesOf(model)) : "nothing";
    };
    const putBack = async (sameKeyboard: boolean) => {
      if (!sameKeyboard) {
        return written.map((c) =>
          `${place(c.ref)} was already changed to ${now(c.ref)}: it wasn't put back, as the keyboard was unplugged ` +
            "or replaced.").join(" ");
      }
      const notes: string[] = [];
      for (const change of [...written].reverse()) {
        try {
          await this.#writeCode(model, layer, change.ref, change.was);
          notes.push(`${place(change.ref)} was put back as it was.`);
        } catch {
          notes.push(`${place(change.ref)} is now ${now(change.ref)}: putting it back failed too.`);
        }
      }
      return notes.join(" ");
    };
    return this.#edit(action, model, write, putBack);
  }

  /** Write a keycode to a key or encoder direction and put the keyboard's reply into the model */
  async #writeCode(model: KeyboardModel, layer: number, ref: KeyRef, code: string): Promise<void> {
    if (ref.kind === "key") {
      const { row, col } = model.keys[ref.index];
      const result = await api.setKey(layer, row!, col!, code);
      // keys of different layout options can share a matrix position
      model.keys.forEach((k, i) => {
        if (k.row === row && k.col === col) model.layers[layer].keys[i] = result;
      });
      return;
    }
    const { encoder, direction } = model.encoders[ref.index];
    const result = await api.setEncoder(layer, encoder!, direction!, code);
    model.encoders.forEach((e, i) => {
      if (e.encoder === encoder && e.direction === direction) model.layers[layer].encoders[i] = result;
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

  /** Choose the keyboard's layout options (all of them, as one number): the keyboard keeps them at once */
  setLayoutOptions(value: number, action = "Changing the layout"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      const set = await api.setLayoutOptions(value);
      if (model.layoutOptions) model.layoutOptions.value = set.value;
    });
  }

  /** Change the lighting: the keyboard shows it at once, and keeps it only once saved (saveLighting), but for backlight
   * breathing, which the firmware keeps at once with the backlight level it runs at. The model gets what the keyboard
   * shows afterwards, which can differ (its brightness steps, a change it ignores). */
  setLighting(body: LightingIn, action = "Changing the lighting"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      model.lighting = await api.setLighting(body);
    });
  }

  /** Keep the lighting the keyboard shows when it is unplugged */
  saveLighting(): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit("Saving the lighting", model, async () => {
      model.lighting = await api.saveLighting();
    });
  }

  /** Restart the keyboard into its bootloader, to flash it: it leaves Vial. A locked keyboard is unlocked first (the
   * firmware takes it only then). */
  rebootToBootloader(): Promise<boolean> {
    const model = this.model;
    if (!model) return Promise.resolve(false);
    if (!this.canEdit) {
      toasts.error("Restarting the keyboard into its bootloader failed: the keyboard can't be changed just now.");
      return Promise.resolve(false);
    }
    return this.#edit("Restarting the keyboard into its bootloader", model, async () => {
      const session = await api.rebootToBootloader();
      this.inBootloader = true;
      // it is gone: the "disconnected" event says so too, maybe after this reply
      this.connected = session.status === "connected";
      this.#useSession(session);
    });
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

  /** Set a key override: its trigger and replacement, layers, modifiers and options */
  setKeyOverride(index: number, body: KeyOverrideIn, action = "Saving the key override"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      model.keyOverrides[index] = await api.setKeyOverride(index, body);
    });
  }

  /** Set an alt-repeat key: its keycode and alt keycode, allowed modifiers and options */
  setAltRepeatKey(index: number, body: AltRepeatKeyIn, action = "Saving the alt-repeat key"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      model.altRepeatKeys[index] = await api.setAltRepeatKey(index, body);
    });
  }

  /** Set QMK settings, one after another. Those the keyboard took before one failed stay set, and show so. */
  setSettings(values: QmkSetting[], action = "Saving the settings"): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit(action, model, async () => {
      const plugs = this.#plugs;
      for (const { qsid, value } of values) {
        // the rest were chosen for the keyboard that went: not for another one
        if (this.#plugs !== plugs) {
          throw new ApiError(409, "another keyboard was plugged in; the settings not yet saved were left as they were");
        }
        const set = await api.setSetting(qsid, value);
        const at = model.settings.findIndex((s) => s.qsid === set.qsid);
        if (at >= 0) model.settings[at] = set;
        else model.settings.push(set);
      }
    });
  }

  /** Put every QMK setting back to the firmware's default. Its confirmation stays open while the keyboard is read
   * again, and its button with it: a refusal then says why, as nothing else would. */
  resetSettings(): Promise<boolean> {
    const model = this.model;
    if (!model) return Promise.resolve(false);
    if (!this.canEdit) {
      toasts.error("Resetting the settings failed: the keyboard can't be changed just now.");
      return Promise.resolve(false);
    }
    return this.#edit("Resetting the settings", model, async () => {
      model.settings = await api.resetSettings();
    });
  }

  /** Write a .vil file to the keyboard: all of it, or nothing when it doesn't fit. A file that needs the keyboard
   * unlocked (it changes the macros) is refused as a whole on a locked one, unlocked for and sent again. */
  loadLayoutFile(text: string): Promise<boolean> {
    const model = this.model;
    if (!model || !this.canEdit) return Promise.resolve(false);
    return this.#edit("Loading the layout file", model, async () => {
      const loaded = await api.loadLayoutFile(text);
      if (this.model === model) this.model = loaded;
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
   * plugged in meanwhile: the change was for the one that went. When it fails, putBack (if given) undoes what write
   * got done, unless the keyboard was unplugged or replaced meanwhile (sameKeyboard), and says what it did or why it
   * didn't: that follows the failure's message. */
  async #edit(
    action: string, model: KeyboardModel, write: () => Promise<void>,
    putBack?: (sameKeyboard: boolean) => Promise<string>,
  ): Promise<boolean> {
    this.pending++;
    const loads = this.#loads;
    const plugs = this.#plugs;
    const fail = async (message: string) => {
      const note = putBack ? await putBack(this.#plugs === plugs) : "";
      toasts.error(note ? `${message} ${note}` : message);
      return false;
    };
    try {
      try {
        await write();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 423)) throw error;
        const outcome = await this.unlock.unlockQuietly();
        if (!outcome.unlocked || this.#plugs !== plugs) return await fail(this.#notUnlocked(action, outcome));
        await write();
      }
      // a load started or landed meanwhile and may have read the keyboard before this edit (it can land after it,
      // too): read it again, unless the keyboard is gone
      if ((this.#loads !== loads || this.model !== model) && this.connected) void this.load();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      return await fail(failureMessage(action, error));
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
