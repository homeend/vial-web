// What the Learning page shows, kept while another page shows: the lesson sets of the keyboard, the set chosen (open,
// with its progress), the settings, the layout export (for where each character is, and whether a set is out of
// date), and the fingers while the Fingers view is open. All of it is the server's files for this keyboard
// (docs/learning/lesson-format.md); nothing is read from or written to the keyboard. Loaded when the page first
// shows, and again for another keyboard or another keyboard language (the export's characters are the language's).
import { api } from "../api/api";
import { ApiError, failureMessage } from "../api/errors";
import type { FingersIn, LearningSettingsIn, LessonSetSummary } from "../api/types";
import { browserStorage } from "../lib/theme";
import { toasts } from "../lib/toasts.svelte";
import { placeOfChars, type PlaceOf } from "./picture";
import { DEFAULT_SETTINGS } from "./state";
import { readChosenSet, saveChosenSet } from "./storage";
import { readLessonSet, type Fingers, type LayoutExport, type LearningSettings, type LessonSet, type Progress } from "./types";

/** what an import came to: the set's listing entry, or the checker's findings */
export type ImportOutcome = { ok: true; entry: LessonSetSummary; warnings: string[] } | { ok: false; errors: string[] };

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

  /** Start over when the keyboard, or the keyboard language, isn't the one shown before */
  follow(uid: string, language: string): void {
    const key = `${uid}\n${language}`;
    if (this.#key === key) return;
    this.#key = key;
    this.#uid = uid;
    this.#reads++;
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

  /** Reads the sets, the settings and the export, then opens the set chosen (or the first that can be read) */
  async load(): Promise<void> {
    if (this.loading) return;
    const read = ++this.#reads;
    this.loading = true;
    this.error = null;
    try {
      const [sets, settings, layout] = await Promise.all([api.learningSets(), api.learningSettings(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.sets = sets;
      this.settings = settings;
      this.export = layout as unknown as LayoutExport;
      this.loaded = true;
      const readable = (id: string | null) => id !== null && sets.some((s) => s.id === id && !s.error);
      const chosen = readable(this.chosen) ? this.chosen : (sets.find((s) => !s.error)?.id ?? null);
      await this.open(chosen);
    } catch (error) {
      if (read !== this.#reads) return;
      this.error = failureMessage("Reading the lessons", error);
      this.loaded = true;
    } finally {
      if (read === this.#reads) this.loading = false;
    }
  }

  /** Reads the sets and the export again (after Fingers changes: the export, and so what is out of date) */
  async refresh(): Promise<void> {
    const read = this.#reads;
    try {
      const [sets, layout] = await Promise.all([api.learningSets(), api.learningExport()]);
      if (read !== this.#reads) return;
      this.sets = sets;
      this.export = layout as unknown as LayoutExport;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Reading the lessons", error));
    }
  }

  /** Opens a set: reads it whole with its progress; null closes the one open. Remembered for the keyboard. */
  async open(id: string | null): Promise<void> {
    const read = this.#reads;
    this.chosen = id;
    if (id !== null && this.#uid !== null) saveChosenSet(browserStorage(), this.#uid, id);
    if (id === null || this.sets.find((s) => s.id === id)?.error) {
      this.set = null;
      this.progress = null;
      return;
    }
    this.opening = true;
    try {
      const [set, progress] = await Promise.all([api.learningSet(id), api.learningProgress(id)]);
      if (read !== this.#reads || this.chosen !== id) return;
      this.set = readLessonSet(set);
      this.progress = progress as Progress;
    } catch (error) {
      if (read !== this.#reads || this.chosen !== id) return;
      this.set = null;
      this.progress = null;
      toasts.error(failureMessage(`Opening the lesson set ${id}`, error));
    } finally {
      if (read === this.#reads && this.chosen === id) this.opening = false;
    }
  }

  /** Imports a lesson set file (its text): checked and saved by the server, listed, and opened. The checker's
   * findings come back instead when it refuses the file; any other failure is a toast. */
  async importSet(text: string): Promise<ImportOutcome | null> {
    const read = this.#reads;
    try {
      const entry = await api.importLearningSet(text);
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
      if (read !== this.#reads) return true;
      this.sets = this.sets.filter((s) => s.id !== id);
      if (this.chosen === id) await this.open(this.sets.find((s) => !s.error)?.id ?? null);
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Removing the lesson set", error));
      return false;
    }
  }

  /** Records an exercise typed to the end; the server's best and attempts take the exercise's place in the progress */
  async recordAttempt(exercise: string, body: { at: string; chars: number; errors: number; seconds: number }): Promise<boolean> {
    const read = this.#reads;
    const set = this.chosen;
    if (set === null) return false;
    try {
      const record = await api.recordAttempt(set, exercise, body);
      if (read !== this.#reads || this.chosen !== set) return true;
      const progress = this.progress ?? { format: "vial-web-progress/1", lessonSet: set, layoutHash: "", exercises: {} };
      this.progress = { ...progress, exercises: { ...progress.exercises, [exercise]: record as Progress["exercises"][string] } };
      return true;
    } catch (error) {
      if (read === this.#reads) toasts.error(failureMessage("Saving the result", error));
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
