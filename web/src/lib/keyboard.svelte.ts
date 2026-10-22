// The loaded keyboard and the connection to it. Edits go to the keyboard first; the UI then shows what the
// keyboard confirmed (the server's reply), never a guess.
import { untrack } from "svelte";
import { api } from "../api/api";
import { DEFAULT_LANGUAGE, setRequestKeyboard, setRequestLanguage } from "../api/client";
import { ApiError, causeMessage, failureMessage } from "../api/errors";
import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "../api/events";
import type {
  AltRepeatKeyIn, ArrangedModel, KeyboardLanguage, KeyboardList, KeyboardModel, KeycodeCategory, KeyOverrideIn,
  LightingIn, MacroActionIn, MatrixState, Named, QmkSetting, Session, TapDanceIn, UnfinishedArrange,
} from "../api/types";
import { keyTitle, namesOf } from "../keyboard/labels";
import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
import { unlockFirst, type Change } from "../keymap/move";
import { freeTapDance } from "../keymap/tapdance";
import { hasLighting } from "../lighting/lighting";
import { offeredCategories, setUpEntries } from "../picker/offered";
import { toasts } from "./toasts.svelte";
import { LOCKED, Unlocker, type UnlockOutcome } from "./unlock.svelte";
import { capitalised } from "./text";
import { dropUnsavedWork } from "./unsaved";

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

/** Whether a key or encoder direction has a matrix position (or encoder and direction) to write to */
function hasPosition(model: KeyboardModel, ref: KeyRef): boolean {
  if (ref.kind === "key") {
    const key = model.keys[ref.index];
    return key?.row != null && key.col != null;
  }
  const encoder = model.encoders[ref.index];
  return encoder?.encoder != null && encoder.direction != null;
}

/** Where a failure's message goes instead of a toast (a dialog that shows it); error: the failure itself, when there is
 * one (an ApiError says its status and code) */
export type Report = (message: string, error?: unknown) => void;

/** What writes an arrange: Apply, its Undo (an arrange with the reverse order), Finish, or Put back */
export type ArrangeKind = "arrange" | "undo" | "finish" | "put-back";

/** An arrange, Finish or Put back of this tab that stopped partway: the layout version it left, and why (a cause:
 * "The keyboard didn't respond.") */
export interface ArrangeStop {
  kind: ArrangeKind;
  version: number;
  cause: string;
}

/** Whether a request that failed so may have written to the keyboard: not one refused before it wrote (the keyboard
 * locked, another keyboard open, the layers changed, nothing unfinished, a bad order, the session ended) */
function mayHaveWritten(error: unknown): boolean {
  return error instanceof ApiError && ![401, 403, 404, 409, 422, 423].includes(error.status);
}

/** An edit of several writes stopped as another keyboard was plugged in meanwhile: the page's own failure, not the
 * server's refusal of a change meant for another keyboard (409), so nothing more is read for it */
class PluggedMeanwhile extends Error {}

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
  /** this page rebooted the keyboard into its bootloader, and it hasn't come back since */
  inBootloader = $state(false);
  /** ... but the keyboard didn't answer the reboot: it most likely went into its bootloader (the server closed it) */
  bootloaderUnanswered = $state(false);
  /** a reboot into the bootloader is on its way to the keyboard: a "disconnected" meanwhile is most likely the reboot
   * (the server says so before it answers), not an unplug */
  rebooting = $state(false);
  /** the Vial keyboards plugged in, and the chosen one while it is unplugged, as the server last said; null before */
  keyboards = $state.raw<KeyboardList | null>(null);
  /** the keyboard being opened (selectKeyboard), until the server has answered */
  switching = $state<string | null>(null);
  /** Quit Vial is on its way to the server */
  quitting = $state(false);
  /** Vial has stopped (Quit Vial, in this tab or another): there is nothing more to show or to reconnect to */
  stopped = $state(false);

  /** grows each time the keyboard shown is another one (or none): a keyboard of another uid, or another keyboard of
   * the same uid (one alike, KeyboardEntry.id), took its place. What was opened or offered for the one before (pages,
   * an Undo) must not be used for it. */
  opened = $state(0);

  /** whether the keyboard has lighting of any kind (true before one is read): a value, so the catalogue offered is
   * worked out again only when it changes, not on every lighting change */
  #lit = $derived(this.model === null || hasLighting(this.model.lighting));
  /** the keycode categories the picker offers: the catalogue, without the Lighting category on a keyboard without
   * lighting, and with only the tap dances and macros set up (each described by what it does). Finding keys and
   * describing keycodes still use the whole catalogue. */
  pickerCatalogue = $derived(setUpEntries(offeredCategories(this.catalogue, this.#lit), this.model));

  /** whether the keyboard shown can be changed: not while Quit Vial is on its way, nor once Vial has stopped */
  canEdit = $derived(
    this.model !== null && !this.stale && this.connected && this.link === "open" && this.switching === null &&
      !this.stopped && !this.quitting,
  );

  #loads = 0;
  /** keyboards plugged in or unplugged so far ("connected" and "disconnected" events, and loads that found another
   * keyboard): once it changes, the keyboard may not be the one it was */
  #plugs = 0;
  /** "connected" events so far: a reply that comes after one is older than what it says */
  #connects = 0;
  /** the events link (re)opened, and its first event hasn't come yet */
  #opening = false;
  /** the language list, or null when it couldn't be read */
  #languageList: Promise<KeyboardLanguage[] | null> = Promise.resolve(null);
  #link: EventsLink | null = null;
  /** pages watching the keys held */
  #matrixWatchers = 0;
  /** the keyboard (KeyboardEntry.id) the model was read from, as the session said */
  #modelKeyboard = $state<string | null>(null);
  /** readings of the keyboard list so far: only the latest is kept */
  #listReads = 0;
  /** readings of the session asked for so far, and the one (by that count) the session shown came from: one answered
   * after a reading asked later was kept is older, and isn't */
  #sessionReads = 0;
  #sessionKept = 0;
  /** told once no edit is on its way */
  #editsDone: (() => void)[] = [];
  /** the last arrange, Finish or Put back of this tab that may have stopped partway (unfinishedStop), on the
   * keyboard shown: it goes once another one is */
  #stopped = $state.raw<ArrangeStop | null>(null);
  /** told when the layout version changes (onLayoutVersion) */
  #layoutListeners = new Set<(version: number | null) => void>();

  /** the keyboard (KeyboardEntry.id) the model shown was read from; null while none is */
  get modelKeyboard(): string | null {
    return this.#modelKeyboard;
  }

  /** arranging the layers of the keyboard loaded stopped partway, as the session last said; null for none */
  get unfinishedArrange(): UnfinishedArrange | null {
    return this.session?.arrange ?? null;
  }

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

  /** Get the keys held (in `matrix`) while the keyboard is unlocked, until the function it returns is called. The
   * server reads them about 20 times a second while any page of any tab watches, and sends a reading only when it
   * differs from the one before. */
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
    // the keys held are no longer followed: the reading shown would stay as it was
    if (state !== "open") this.matrix = null;
    if (state === "open") {
      this.#opening = true;
      // a link opened again starts with nothing asked for
      if (this.#matrixWatchers > 0) this.#link?.send({ type: "matrix", watch: true });
      // the keyboards may have changed while it was down
      void this.#readKeyboards();
    }
  }

  #onEvent(event: ServerEvent): void {
    if (event.type === "stopped") {
      this.#stop();
      return;
    }
    if (event.type === "unlock") {
      if (event.unlock) this.unlock.update(event.unlock);
      return;
    }
    if (event.type === "matrix") {
      if (event.matrix && this.#matrixWatchers > 0) this.matrix = event.matrix;
      return;
    }
    // the list of keyboards, the one chosen or open, or why none could be read changed: no plug of the keyboard loaded
    if (event.type === "keyboards") {
      void this.#readKeyboards();
      return;
    }
    // the server's first event on a link (re)opened says how the keyboard is: a "connected" there, when it was
    // connected already, is no plug, unless the load it brings finds another keyboard (see load)
    const opening = this.#opening;
    this.#opening = false;
    const unchanged = event.type === "reloaded" || (opening && event.type === "connected" && this.connected);
    if (!unchanged) this.#plugs++;
    this.connected = event.type !== "disconnected";
    // the keys held were another keyboard's, or of none: the next reading says what is held now
    if (event.type !== "reloaded") this.matrix = null;
    if (event.type === "connected") {
      this.#connects++;
      this.#leftBootloader();
    }
    this.stale = true;
    if (this.connected) {
      void this.load();
    } else {
      this.#loads++; // a load in flight is for the keyboard that went away
      this.loadError = null;
      // the server says "disconnected" only for a loaded keyboard, or for one it couldn't read once it was unlocked
      // (the session says why): an unlock it ran is over, even if the session can't be read
      this.unlock.update(LOCKED);
      const at = ++this.#sessionReads;
      api.session().then((s) => this.#useSession(s, at), () => undefined);
    }
  }

  /** Quit Vial: the server lets go of the keyboard, tells every tab, and stops. Resolves to whether it did; a toast
   * says why not. */
  async quit(): Promise<boolean> {
    if (this.quitting || this.stopped) return this.stopped;
    this.quitting = true;
    try {
      await api.shutdown();
    } catch (error) {
      // the stopped event came, though the answer was lost: Vial has stopped, which is what was asked
      if (this.stopped) return true;
      this.quitting = false;
      toasts.error(failureMessage("Quitting Vial", error));
      return false;
    }
    this.#stop();
    return true;
  }

  /** Vial has stopped: the events link closes for good (it may have closed itself already) */
  #stop(): void {
    this.stopped = true;
    this.quitting = false;
    // what they offer (Undo) or report no longer matters: the page says that Vial has stopped
    for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
    this.matrix = null;
    this.#link?.close();
    this.#link = null;
  }

  /** Read the keyboard (and its keycode catalogue) from the server; only the latest load is kept */
  async load(): Promise<void> {
    const load = ++this.#loads;
    const at = ++this.#sessionReads;
    try {
      const [session, model, catalogue] = await Promise.all([api.session(), api.keyboard(), api.keycodes()]);
      if (load !== this.#loads) return;
      // another keyboard (plugged in while the events link was down, or opened from another tab: maybe one alike,
      // with the same uid): before the session is used, as an unlock it ends tells those waiting for it
      const opened = session.keyboard ?? null;
      if (this.model !== null && (model.uid !== this.model.uid || opened !== this.#modelKeyboard)) {
        this.#plugs++;
        this.#anotherKeyboard();
      }
      this.#useSession(session, at);
      this.model = model;
      this.#showKeyboard(opened);
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

  /** Show the session read (`at`: which reading it is, #sessionReads), unless a reading asked for later was shown
   * already; and the unlock state of the one shown */
  #useSession(session: Session, at: number): void {
    this.#keepSession(session, at);
    this.unlock.update((this.session ?? session).unlock);
  }

  /** Show the session read, unless a reading asked for later was shown already */
  #keepSession(session: Session, at: number): void {
    if (at < this.#sessionKept) return;
    this.#sessionKept = at;
    const version = this.layoutVersion;
    this.session = session;
    if (this.layoutVersion !== version) for (const listener of [...this.#layoutListeners]) listener(this.layoutVersion);
  }

  /** Read the list of keyboards, and the session (why none could be read): only the latest reading is kept. A model
   * of a keyboard no longer chosen, with none open, goes: that keyboard isn't coming back (another one was chosen, in
   * another tab maybe, and couldn't be opened: the page says why). */
  async #readKeyboards(): Promise<void> {
    const read = ++this.#listReads;
    const at = ++this.#sessionReads;
    try {
      const [list, session] = await Promise.all([api.keyboards(), api.session()]);
      if (read !== this.#listReads) return;
      this.keyboards = list;
      // the unlock state comes with its own events
      this.#keepSession(session, at);
      const chosen = list.chosen ?? null;
      if (this.model !== null && !this.connected && chosen !== null && chosen !== this.#modelKeyboard) {
        this.#forgetKeyboard();
      }
    } catch {
      // read again on the next change, or once the events link is open again
    }
  }

  /** The keyboard loaded is gone for good (another one is opened): its model and what waited on it go, and a load on
   * its way is dropped */
  #forgetKeyboard(): void {
    this.#plugs++;
    this.#loads++;
    this.#anotherKeyboard();
    this.model = null;
    this.#showKeyboard(null);
    this.matrix = null;
    this.loadError = null;
    this.#leftBootloader();
    this.stale = true;
  }

  #leftBootloader(): void {
    this.inBootloader = false;
    this.bootloaderUnanswered = false;
  }

  /** The model shown is of this keyboard (KeyboardEntry.id), or of none: the changes sent are meant for it, so that
   * the server refuses them (409) if another tab opened another keyboard meanwhile */
  #showKeyboard(id: string | null): void {
    this.#modelKeyboard = id;
    setRequestKeyboard(id);
  }

  /** The keyboard shown is another one now (or none): what was kept for the one before goes, the work not saved on it
   * included (the caller asked about it, if it was this tab's choice), and the toasts offering to act on it (Undo) */
  #anotherKeyboard(): void {
    this.opened++;
    // its layout versions count from 0 too: a stop of the one before would pass for its own
    this.#stopped = null;
    dropUnsavedWork();
    toasts.dropKeyboardActions();
  }

  /** Use another keyboard: the one open is closed and the chosen one opened, as if it had just been plugged in. The
   * edits on their way are waited for first, and no other is taken meanwhile; whatever waited on the keyboard closed
   * (an unlock) ends. The keyboard shown stays (it can't be changed meanwhile), with the work not saved on it, until the
   * server has switched: if it doesn't, nothing is lost. The caller asks about work not saved (lib/unsaved) first.
   * Returns whether it was done. */
  async selectKeyboard(id: string): Promise<boolean> {
    if (this.switching !== null) return false;
    const list = this.keyboards;
    if (list?.keyboards.some((k) => k.id === id && k.open)) return true;
    const name = list?.keyboards.find((k) => k.id === id)?.name ?? "the keyboard";
    this.switching = id;
    this.stale = true;
    try {
      if (this.pending > 0) await new Promise<void>((done) => this.#editsDone.push(done));
      // a load on its way read the keyboard before the switch: it isn't kept (one the switch brings is newer)
      this.#loads++;
      try {
        const reply = await api.selectKeyboard(id);
        this.#listReads++; // a reading on its way is older
        this.keyboards = reply;
        // the keyboard shown was closed: it goes, with the work not saved on it. (The "connected" event the switch
        // brings may have loaded the chosen one already: that one stays.)
        const open = reply.keyboards.find((k) => k.open)?.id ?? null;
        if (this.model !== null && open !== this.#modelKeyboard) this.#forgetKeyboard();
      } catch (error) {
        toasts.error(failureMessage(`Opening ${name}`, error));
        // the keyboard open is still the one it was, or none: read again what there is
        void this.#readKeyboards();
        if (this.connected) void this.load();
        return false;
      }
      const at = ++this.#sessionReads;
      const session = await api.session().catch(() => null);
      if (session) {
        this.#useSession(session, at);
        this.connected = session.status === "connected";
      }
      // the "connected" event loads it too: the latest load is kept
      if (this.connected) void this.load();
      return true;
    } finally {
      this.switching = null;
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

  /** Reboot the keyboard into its bootloader, to flash it: it leaves Vial. A locked keyboard is unlocked first (the
   * firmware takes it only then). A reboot the keyboard got and didn't answer (504) most likely went through: it is
   * shown so (bootloaderUnanswered), not as a failure. A reply that comes after the keyboard was plugged in again is
   * older than that, and changes nothing. */
  rebootToBootloader(): Promise<boolean> {
    const model = this.model;
    if (!model) return Promise.resolve(false);
    if (!this.canEdit) {
      toasts.error("Rebooting the keyboard into its bootloader failed: the keyboard can't be changed just now.");
      return Promise.resolve(false);
    }
    return this.#edit("Rebooting the keyboard into its bootloader", model, async () => {
      const connects = this.#connects;
      this.rebooting = true;
      try {
        let session: Session | null = null;
        const at = ++this.#sessionReads;
        try {
          session = await api.rebootToBootloader();
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 504)) throw error;
        }
        if (this.#connects !== connects) return;
        this.inBootloader = true;
        this.bootloaderUnanswered = session === null;
        // it is gone: the "disconnected" event says so too, maybe after this reply. Not answered, the server closed it.
        this.connected = session !== null && session.status === "connected";
        if (session) this.#useSession(session, at);
      } finally {
        this.rebooting = false;
      }
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
          throw new PluggedMeanwhile(
            "another keyboard was plugged in; the settings not yet saved were left as they were",
          );
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

  /** Move the layers to `order` (order[position] = layer now): the server renumbers every layer reference and moves
   * the names, writing only what differs. expect: the layout version the order was chosen for (a preview's): the
   * server refuses it (409, code "layoutChanged", nothing written) when the layers changed since; null: whatever they
   * are. A keyboard that must be unlocked for it (QK_BOOT moves, or the macros change) is unlocked first, as nothing
   * was written. A write that fails leaves the arrange unfinished (unfinishedArrange). report: says why it wasn't
   * done, instead of a toast. kind: "undo" for an Undo, said so. Resolves to the model the server answered (its new
   * layoutVersion), or null when it wasn't done. */
  arrangeLayers(order: number[], expect: number | null, report?: Report, kind: "arrange" | "undo" = "arrange"):
    Promise<ArrangedModel | null> {
    return this.#arrange(kind, kind === "undo" ? "Undoing the arrange" : "Arranging the layers",
      () => api.arrangeLayers(order, expect), report);
  }

  /** Write the rest of an arrange that stopped partway, then move the names (or only the names, when that is all it
   * has left: UnfinishedArrange.namesOnly) */
  finishArrange(report?: Report): Promise<ArrangedModel | null> {
    return this.#arrange("finish", "Finishing the arrange", () => api.finishArrange(), report);
  }

  /** Write back what an arrange that stopped partway changed */
  putBackArrange(report?: Report): Promise<ArrangedModel | null> {
    return this.#arrange("put-back", "Putting the layers back", () => api.putBackArrange(), report);
  }

  /** An arrange's request; the session (which says whether one is unfinished) is read again afterwards, done or not.
   * Nothing is sent while the keyboard can't be changed, or while another change is being saved (it could be one the
   * arrange would renumber). */
  async #arrange(kind: ArrangeKind, action: string, send: () => Promise<ArrangedModel>, report?: Report):
    Promise<ArrangedModel | null> {
    const model = this.model;
    if (!model) return null;
    const refuse = (why: string) => {
      const message = `${action} failed: ${why}`;
      if (report) report(message);
      else toasts.error(message);
      return null;
    };
    if (!this.canEdit) return refuse("the keyboard can't be changed just now.");
    if (this.pending > 0) return refuse("another change was still being saved. Try again.");
    const before = this.layoutVersion;
    const opened = this.opened;
    let arranged: ArrangedModel | null = null;
    let failure: unknown = undefined;
    await this.#edit(action, model, async () => {
      arranged = await send();
      if (this.model === model) this.model = arranged;
    }, undefined, (message, error) => {
      failure = error;
      if (report) report(message, error);
      else toasts.error(message);
    });
    // it may have written, and stopped partway: the server counted the layout version up once for it. The stop is
    // this one's while the session says that version, with an arrange unfinished: the keyboard may only say so once
    // it is open again (the server resets it after a write that failed).
    if (!arranged && before !== null && mayHaveWritten(failure) && this.opened === opened) {
      this.#stopped = { kind, version: before + 1, cause: causeMessage(failure) };
    }
    await this.refreshSession();
    return arranged;
  }

  /** The keyboard's layout version, as the session last said: it goes up each time its layers are arranged (finished,
   * put back, or stopped partway) or a layout file is loaded, from any tab; null while no keyboard is open */
  get layoutVersion(): number | null {
    return this.session?.layoutVersion ?? null;
  }

  /** The arrange, Finish or Put back of this tab that left the arrange unfinished, and why it stopped; null when it
   * isn't known (another tab's, or the page was opened since), or when nothing is unfinished */
  get unfinishedStop(): ArrangeStop | null {
    const stopped = this.#stopped;
    return this.unfinishedArrange && stopped && stopped.version === this.layoutVersion ? stopped : null;
  }

  /** The last arrange, Finish or Put back of this tab that may have stopped partway, whatever the session says now */
  get arrangeStop(): ArrangeStop | null {
    return this.#stopped;
  }

  /** What of this tab's left the arrange unfinished (unfinishedStop), or null */
  get unfinishedBy(): ArrangeKind | null {
    return this.unfinishedStop?.kind ?? null;
  }

  /** Call `listener` each time the session says another layout version (see layoutVersion). Returns what stops it. */
  onLayoutVersion(listener: (version: number | null) => void): () => void {
    this.#layoutListeners.add(listener);
    return () => this.#layoutListeners.delete(listener);
  }

  /** Read the session again (whether an arrange is unfinished, the unlock state) */
  async refreshSession(): Promise<void> {
    const at = ++this.#sessionReads;
    try {
      this.#useSession(await api.session(), at);
    } catch {
      // read again with the next load
    }
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
   * didn't: that follows the failure's message. report: where the failure's message goes, instead of a toast (a dialog
   * that shows it). */
  async #edit(
    action: string, model: KeyboardModel, write: () => Promise<void>,
    putBack?: (sameKeyboard: boolean) => Promise<string>, report?: Report,
  ): Promise<boolean> {
    this.pending++;
    const loads = this.#loads;
    const plugs = this.#plugs;
    /** the server said another keyboard is open than the one the change was for */
    let changed = false;
    const fail = async (message: string, error?: unknown) => {
      const note = putBack ? await putBack(this.#plugs === plugs && !changed) : "";
      const text = note ? `${message} ${note}` : message;
      if (report) report(text, error);
      else toasts.error(text);
      return false;
    };
    try {
      try {
        await write();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 423)) throw error;
        const outcome = await this.unlock.unlockQuietly();
        // nothing was written: the message says why (the unlock's failure in it)
        if (!outcome.unlocked || this.#plugs !== plugs) return await fail(this.#notUnlocked(action, outcome));
        await write();
      }
      // a load started or landed meanwhile and may have read the keyboard before this edit (it can land after it,
      // too): read it again, unless the keyboard is gone
      if ((this.#loads !== loads || this.model !== model) && this.connected) void this.load();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) this.connected = false;
      if (error instanceof ApiError && error.status === 409) {
        // refused, nothing written: another keyboard is open now (another tab opened it), or (an arrange) the layers
        // changed since the order was shown, one is unfinished, or the order has problems. Nothing more is sent (no
        // putting back either), and what there is now is read.
        changed = true;
        void this.#readKeyboards();
        if (this.connected) void this.load();
      }
      return await fail(
        error instanceof PluggedMeanwhile ? `${action} failed: ${error.message}` : failureMessage(action, error), error,
      );
    } finally {
      this.pending--;
      if (this.pending === 0) for (const done of this.#editsDone.splice(0)) done();
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
