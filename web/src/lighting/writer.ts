// Sending changes that come quickly (a slider dragged) without flooding the keyboard: one write at a time, at most one
// every `gapMs`; changes made meanwhile are merged, so the latest value of each always reaches the keyboard last.

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class LatestWriter<T> {
  #pending: T | null = null;
  #writing = false;
  #timer: unknown = null;
  #lastStart = Number.NEGATIVE_INFINITY;
  #idle: (() => void)[] = [];
  readonly #write: (value: T) => Promise<unknown>;
  readonly #merge: (older: T, newer: T) => T;
  readonly #gapMs: number;
  readonly #onBusy: (busy: boolean) => void;
  readonly #clock: Clock;

  /**
   * write: sends one value (a failure is the writer's to report: the next value is sent all the same)
   * merge: one value with the changes of a newer one put over it
   * gapMs: the least time from the start of one write to the start of the next
   * onBusy: told whenever `busy` changes
   */
  constructor(write: (value: T) => Promise<unknown>, merge: (older: T, newer: T) => T, gapMs: number,
    onBusy: (busy: boolean) => void = () => undefined, clock: Clock = realClock) {
    this.#write = write;
    this.#merge = merge;
    this.#gapMs = gapMs;
    this.#onBusy = onBusy;
    this.#clock = clock;
  }

  /** a write is on its way, or a value waits to be sent */
  get busy(): boolean {
    return this.#writing || this.#pending !== null;
  }

  /** Send a value: at once if nothing is being written and the last write started long enough ago, else later, merged
   * with whatever else comes meanwhile */
  push(value: T): void {
    const was = this.busy;
    this.#pending = this.#pending === null ? value : this.#merge(this.#pending, value);
    this.#schedule();
    if (!was) this.#onBusy(true);
  }

  /** Resolves once everything pushed so far has been written (at once if nothing is) */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  #schedule(): void {
    if (this.#writing || this.#timer !== null || this.#pending === null) return;
    const wait = this.#lastStart + this.#gapMs - this.#clock.now();
    if (wait <= 0) {
      this.#send();
      return;
    }
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      this.#schedule();
    }, wait);
  }

  #send(): void {
    const value = this.#pending as T;
    this.#pending = null;
    this.#writing = true;
    this.#lastStart = this.#clock.now();
    void this.#write(value).catch(() => undefined).finally(() => {
      this.#writing = false;
      this.#schedule();
      if (!this.busy) {
        this.#onBusy(false);
        const waiting = this.#idle;
        this.#idle = [];
        for (const resolve of waiting) resolve();
      }
    });
  }
}
