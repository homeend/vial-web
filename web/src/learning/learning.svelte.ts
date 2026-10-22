// What the Learning page shows, kept while another page shows: the lesson sets of the keyboard, the set chosen (open,
// with its progress), the settings, the layout export (for where each character is, and whether a set is out of
// date), and the fingers while the Fingers view is open. All of it is the server's files for this keyboard
// (docs/learning/lesson-format.md); nothing is read from or written to the keyboard. Loaded when the page first
// shows, and again for another keyboard or another keyboard language (the export's characters are the language's).
import { api } from "../api/api";
import { ApiError, causeMessage, failureMessage } from "../api/errors";
import type { AttemptIn, FingersIn, LearningSettingsIn, LessonSetSummary } from "../api/types";
import { browserStorage } from "../lib/theme";
import { toasts } from "../lib/toasts.svelte";
import { placeOfChars, type PlaceOf } from "./picture";
import { DEFAULT_SETTINGS, setToOpen } from "./state";
import { readChosenSet, saveChosenSet } from "./storage";
import {
  readLayoutExport, readLessonSet, type Fingers, type LayoutExport, type LearningSettings, type LessonSet, type Progress,
} from "./types";

/** what an import came to: the set's listing entry, or the checker's findings */
export type ImportOutcome = { ok: true; entry: LessonSetSummary; warnings: string[] } | { ok: false; errors: string[] };

/** Why a read failed: the server's answer, or what is wrong with the shape of a file it passed through (a plain Error
 * from readLessonSet or readLayoutExport: the failure of the request itself is always an ApiError) */
function readFailure(action: string, error: unknown): string {
  const cause = error instanceof Error && !(error instanceof ApiError) ? error.message : causeMessage(error);
  return `${action} failed: ${cause}`;
}

export class LearningState {
  /** the sets the keyboard has, as the server lists them (a file that isn't a lesson set with its error) */
  sets = $state.raw<LessonSetSummary[]>([]);
  /** the set chosen in the selector: open below once read */
  chosen = $state<string | null>(null);
  /** the set open, whole; null while none is chosen, or the chosen one can't be read (its listing entry says why) */
  set = $state.raw<LessonSet | null>(null);
  progress = $state.raw<Progress | null>(null);
  settings = $state.raw<LearningSettings>(DEFAULT_SETTINGS);
  export = $state.raw<LayoutExport | null>(null);
  /** the fingers, read when the Fingers view opens */
  fingers = $state.raw<Fingers | null>(null);
  /** the sets, settings and export are being read */
  loading = $state(false);
  /** they were read for this keyboard (or the read failed: `error` says why) */
  loaded = $state(false);
  /** the set chosen is being read */
  opening = $state(false);
  /** why the last read failed, for the page's banner */
  error = $state<string | null>(null);
  /** where every character the set teaches is, from the set's `new` entries and the export's space */
  places = $derived<Map<string, PlaceOf>>(this.set && this.export ? placeOfChars(this.set, this.export) : new Map());
  /** the keyboard (uid) and language this is for */
  #key: string | null = null;
  #uid: string | null = null;
  /** reads under way, so a stale one's answer is dropped */
  #reads = 0;
  /** opens under way: only the latest one's answer counts, and only it ends `opening` */
  #opens = 0;

  /** Start over when the keyboard, or the keyboard language, isn't the one shown before */
  follow(uid: string, language: string): void {
    const key = `${uid}\n${language}`;
    if (this.#key === key) return;
    this.#key = key;
    this.#uid = uid;
    this.#reads++;
    this.#opens++;
    this.sets = [];
    this.chosen = readChosenSet(browserStorage(), uid);
    this.set = null;
    this.progress = null;
    this.settings = DEFAULT_SETTINGS;
    this.export = null;
    this.fingers = null;
    this.loading = false;
    this.loaded = false;
    this.opening = false;
    this.error = null;
  }

  /** the listing read under way (load or refresh), for a change made meanwhile: its answer lists the sets as they
   * were when it was asked, so an import or a removal waits for it before changing the list, or the answer would
   * put the list back as it was (an import during the page's first read: the set saved but not listed) */
  #reading: Promise<void> | null = null;

  async #listing(work: Promise<void>): Promise<void> {
    this.#reading = work;
    try {
      await work;
    } finally {
      if (this.#reading === work) this.#reading = null;
    }
  }

  /** Reads the sets, the settings and the export, then opens the set chosen (or the first that can be read, or the
   * first listed when none can be: its error shows) */
  async load(): Promise<void> {
    if (this.loading) return;
    await this.#listing(this.#load());
  }

  async #load(): Promise<void> {
    const read = ++this.#reads;
    this.loading = true;
    this.error = null;
    try {
      const [sets, settings, layout] = await Promise.all([api.learningSets(), api.learningSettings(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.export = readLayoutExport(layout);
      this.sets = sets;
      this.settings = settings;
      this.loaded = true;
      await this.open(setToOpen(sets, this.chosen));
    } catch (error) {
      if (read !== this.#reads) return;
      this.error = readFailure("Reading the lessons", error);
      this.loaded = true;
    } finally {
      if (read === this.#reads) this.loading = false;
    }
  }

  /** Reads the sets and the export again (after Fingers changes, or the keymap: the export, and so what is out of date
   * and where the characters are). The set open and its progress stay as they are. */
  async refresh(): Promise<void> {
    await this.#listing(this.#refresh());
  }

  async #refresh(): Promise<void> {
    const read = this.#reads;
    try {
      const [sets, layout] = await Promise.all([api.learningSets(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.export = readLayoutExport(layout);
      this.sets = sets;
    } catch (error) {
      if (read === this.#reads) toasts.error(readFailure("Reading the lessons", error));
    }
  }

  /** Opens a set: reads it whole with its progress; null closes the one open; a set listed with an error is chosen
   * but not read (nothing is open: its entry says why). Remembered for the keyboard. */
  async open(id: string | null): Promise<void> {
    const read = this.#reads;
    const opened = ++this.#opens;
    this.chosen = id;
    if (id !== null && this.#uid !== null) saveChosenSet(browserStorage(), this.#uid, id);
    if (id === null || this.sets.find((s) => s.id === id)?.error) {
      this.set = null;
      this.progress = null;
      this.opening = false;
      return;
    }
    this.opening = true;
    try {
      const [set, progress] = await Promise.all([api.learningSet(id), api.learningProgress(id)]);
      if (read !== this.#reads || opened !== this.#opens) return;
      this.set = readLessonSet(set);
      this.progress = progress;
    } catch (error) {
      if (read !== this.#reads || opened !== this.#opens) return;
      this.set = null;
      this.progress = null;
      toasts.error(readFailure(`Opening the lesson set ${id}`, error));
    } finally {
      // a later open (or follow) ends it itself: this one's answer was dropped
      if (opened === this.#opens) this.opening = false;
    }
  }

  /** Imports a lesson set file (its text): checked and saved by the server, listed, and opened. The checker's
   * findings come back instead when it refuses the file; any other failure is a toast. */
  async importSet(text: string): Promise<ImportOutcome | null> {
    const read = this.#reads;
    try {
      const entry = await api.importLearningSet(text);
      if (this.#reading) await this.#reading; // a listing asked before the import doesn't know the set
      if (read !== this.#reads) return null;
      this.sets = [...this.sets.filter((s) => s.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
      await this.open(entry.id);
      return { ok: true, entry, warnings: entry.warnings };
    } catch (error) {
      if (read !== this.#reads) return null;
      if (error instanceof ApiError && error.status === 422) {
        return { ok: false, errors: error.errors?.length ? error.errors : [error.detail ?? "the file isn't a lesson set"] };
      }
      toasts.error(failureMessage("Importing the lesson set", error));
      return null;
    }
  }

  /** Removes a set (its progress stays); the next readable set is opened */
  async deleteSet(id: string): Promise<boolean> {
    const read = this.#reads;
    try {
      await api.deleteLearningSet(id);
      if (this.#reading) await this.#reading; // a listing asked before the removal still has the set
      if (read !== this.#reads) return true;
      this.sets = this.sets.filter((s) => s.id !== id);
      if (this.chosen === id) await this.open(setToOpen(this.sets, null));
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Removing the lesson set", error));
      return false;
    }
  }

  /** Records an exercise typed to the end; the server's best and attempts take the exercise's place in the progress */
  async recordAttempt(exercise: string, body: AttemptIn): Promise<boolean> {
    const read = this.#reads;
    const set = this.chosen;
    if (set === null) return false;
    try {
      const record = await api.recordAttempt(set, exercise, body);
      if (read !== this.#reads || this.chosen !== set) return true;
      const progress: Progress = this.progress ?? { format: "vial-web-progress/1", lessonSet: set, exercises: {} };
      this.progress = { ...progress, exercises: { ...progress.exercises, [exercise]: record } };
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Saving the result", error));
      return false;
    }
  }

  /** Forgets the progress of the set open, every attempt and best: the empty progress takes its place, so every row
   * shows its empty state at once; false (with a toast) when that fails */
  async resetProgress(): Promise<boolean> {
    const read = this.#reads;
    const set = this.chosen;
    if (set === null) return false;
    try {
      await api.resetLearningProgress(set);
      if (read !== this.#reads || this.chosen !== set) return true;
      this.progress = { format: "vial-web-progress/1", lessonSet: set, exercises: {} };
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Resetting the progress", error));
      return false;
    }
  }

  async saveSettings(body: LearningSettingsIn): Promise<boolean> {
    const read = this.#reads;
    try {
      const settings = await api.setLearningSettings(body);
      if (read === this.#reads) this.settings = settings;
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Saving the settings", error));
      return false;
    }
  }

  /** Reads the fingers for the Fingers view; false (with a toast) when that fails */
  async loadFingers(): Promise<boolean> {
    const read = this.#reads;
    try {
      const fingers = await api.learningFingers();
      if (read === this.#reads) this.fingers = fingers;
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Reading the fingers", error));
      return false;
    }
  }

  /** Saves the fingers as they are now (every key, and the resting keys), or puts the proposal back (null); the
   * export follows, and so which sets are out of date */
  async saveFingers(body: FingersIn | null): Promise<boolean> {
    const read = this.#reads;
    try {
      const fingers = body === null ? await api.resetLearningFingers() : await api.setLearningFingers(body);
      if (read !== this.#reads) return true;
      this.fingers = fingers;
      void this.refresh();
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage(body === null ? "Resetting the fingers" : "Saving the fingers", error));
      return false;
    }
  }
}

export const learning = new LearningState();
