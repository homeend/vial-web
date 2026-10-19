// A run of the matrix tester: while it tests, the keys held are watched, and keys typed do nothing on the page (as Qt's
// tester grabs the keyboard). Every key, Tab included, is swallowed then, so the page lets go of the keyboard as soon as
// it loses it: switching to another window (Alt+Tab, the Windows key) or hiding the tab stops the test. What was
// pressed is kept by the page (state.svelte.ts), not here.
import { KeyGuard, type Listened } from "../lib/keyGuard";

export class MatrixRun {
  /** the test runs */
  testing = $state(false);
  /** the keyboard tested (its uid) */
  #uid: string | null = null;
  #unwatch: (() => void) | null = null;
  readonly #watch: () => () => void;
  readonly #guard: KeyGuard;
  readonly #window: Listened;
  readonly #document: Listened;

  /** watch: starts watching the keys held, and returns what stops it (KeyboardStore.watchMatrix) */
  constructor(watch: () => () => void, win: Listened = window, doc: Listened = document) {
    this.#watch = watch;
    this.#window = win;
    this.#document = doc;
    this.#guard = new KeyGuard(win, doc);
  }

  /** Start testing the keyboard with this uid */
  start(uid: string): void {
    if (this.testing) return;
    this.testing = true;
    this.#uid = uid;
    this.#unwatch = this.#watch();
    this.#guard.start();
    this.#window.addEventListener("blur", this.stop);
    this.#document.addEventListener("visibilitychange", this.stop);
    this.#window.addEventListener("beforeunload", this.#askBeforeLeaving);
  }

  /** Stop testing (and watching); keys still held do nothing until they are let go, wherever the focus is then */
  readonly stop = (): void => {
    if (!this.testing) return;
    this.testing = false;
    this.#window.removeEventListener("blur", this.stop);
    this.#document.removeEventListener("visibilitychange", this.stop);
    this.#window.removeEventListener("beforeunload", this.#askBeforeLeaving);
    this.#unwatch?.();
    this.#unwatch = null;
    this.#guard.stop();
  };

  /** Whether the test must stop: the keyboard tested was unplugged, went to its bootloader, or another one (this uid)
   * took its place. Being read again (stale) isn't enough. */
  ends(keyboard: { connected: boolean; inBootloader: boolean }, uid: string): boolean {
    return this.testing && (!keyboard.connected || keyboard.inBootloader || uid !== this.#uid);
  }

  /** Whether the keys held, as read now, are the tested keyboard's: not while the keyboard is being read again (stale),
   * as another one may have taken its place */
  reads(stale: boolean, uid: string): boolean {
    return this.testing && !stale && uid === this.#uid;
  }

  readonly #askBeforeLeaving = (event: Event): void => {
    event.preventDefault();
  };
}
