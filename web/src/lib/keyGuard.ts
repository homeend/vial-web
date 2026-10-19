// Keys pressed on the keyboard doing nothing on the page: while the unlock dialog waits for the unlock keys to be held,
// and while the matrix tester tests keys (as Qt's tester grabs the keyboard). Held Enter or Space would otherwise press
// a button, held Tab move the focus. Keys still held when it ends would repeat or be let go on whatever has the focus
// then (Enter on the top bar's Lock, Tab then Backspace on a key): those keys do nothing until they are let go.

const KINDS = ["keydown", "keypress", "keyup"] as const;

export interface Listened {
  addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}

export class KeyGuard {
  /** the keys pressed while it was on and not let go since (event.code) */
  readonly #pressed = new Set<string>();
  /** the listeners are on */
  #listening = false;
  /** every key does nothing */
  #on = false;
  readonly #window: Listened;
  readonly #document: Listened;

  constructor(win: Listened = window, doc: Listened = document) {
    this.#window = win;
    this.#document = doc;
  }

  /** whether keys do nothing now */
  get on(): boolean {
    return this.#on;
  }

  /** From now on every key does nothing */
  start(): void {
    this.#on = true;
    if (this.#listening) return;
    this.#listening = true;
    for (const kind of KINDS) this.#window.addEventListener(kind, this.#swallow, true);
    this.#window.addEventListener("blur", this.#forget);
    this.#document.addEventListener("visibilitychange", this.#forget);
  }

  /** Keys work again, but those still held from before do nothing until they are let go */
  stop(): void {
    this.#on = false;
    if (this.#pressed.size === 0) this.dispose();
  }

  /** Keys work again at once, those held too */
  dispose(): void {
    this.#on = false;
    this.#pressed.clear();
    if (!this.#listening) return;
    this.#listening = false;
    for (const kind of KINDS) this.#window.removeEventListener(kind, this.#swallow, true);
    this.#window.removeEventListener("blur", this.#forget);
    this.#document.removeEventListener("visibilitychange", this.#forget);
  }

  readonly #swallow = (event: Event): void => {
    const key = event as KeyboardEvent;
    const code = key.code || key.key;
    // once it is off, only the keys still held from before
    if (!this.#on && !this.#pressed.has(code)) return;
    if (event.type === "keydown" && this.#on) this.#pressed.add(code);
    else if (event.type === "keyup") this.#pressed.delete(code);
    event.preventDefault();
    // nothing else sees them, not even listeners on the window added after these ones. The macro recorder's, added
    // before them when a recording started first, leaves the keys alone while the unlock dialog shows (it stops
    // recording).
    event.stopImmediatePropagation();
    if (!this.#on && this.#pressed.size === 0) this.dispose();
  };

  /** The page lost the keyboard: a key let go meanwhile isn't told, and keys pressed afterwards work again */
  readonly #forget = (): void => {
    this.#pressed.clear();
    if (!this.#on) this.dispose();
  };
}
