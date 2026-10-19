// Unlocking the keyboard. Vial firmware takes security-sensitive changes (macros, the bootloader key) only while it is
// unlocked, and unlocking needs the user to hold the keyboard's unlock keys until its countdown ends: the server follows
// that countdown and reports it in "unlock" events, which keep `state` here. The dialog shows while it runs.
import { api } from "../api/api";
import { failureMessage } from "../api/errors";
import type { UnlockState } from "../api/types";
import { toasts } from "./toasts.svelte";

export const LOCKED: UnlockState = { state: "locked", keys: [], remaining: 0, total: 0 };

/** How far the countdown has got, from 0 to 1: none before the keyboard's first reading */
export function unlockProgress(state: UnlockState): number {
  if (state.state === "unlocked") return 1;
  if (state.total <= 0) return 0;
  return Math.min(1, Math.max(0, (state.total - state.remaining) / state.total));
}

/** Whether the keyboard waits for its unlock keys (and takes nothing else meanwhile), followed or not */
export function isWaiting(state: UnlockState): boolean {
  return state.state === "unlocking" || state.state === "cancelled";
}

/** What an unlock came to; when it couldn't start and nobody was shown why, the start's failure */
export type UnlockOutcome = { unlocked: true } | { unlocked: false; failure?: unknown };

/** A caller of unlock() or unlockQuietly() */
type Waiter = { tell: (outcome: UnlockOutcome) => void; quiet: boolean };

export class Unlocker {
  state = $state.raw<UnlockState>(LOCKED);
  /** the unlock dialog shows */
  open = $state(false);
  /** a request to the server is on its way */
  busy = $state(false);
  /** callers of unlock() and unlockQuietly(): told whether the keyboard got unlocked */
  #waiting: Waiter[] = [];
  /** requests sent to the server so far */
  #sent = 0;
  /** updates (events and session reads) so far */
  #updates = 0;
  /** the start on its way: unlocks asked meanwhile wait for it instead of sending their own */
  #starting: Promise<void> | null = null;
  /** the start on its way was asked for by start() too: its failure is shown, whoever else waits for it */
  #startShown = false;

  /** The keyboard's unlock state changed (an event, or a session read): an unlock that runs shows the dialog, wherever
   * it was started; one that ends closes it */
  update(state: UnlockState): void {
    this.#updates++;
    this.#apply(state);
  }

  /** Unlock the keyboard (a change was refused as it is locked): resolves true once it is unlocked, false if the user
   * cancelled or it couldn't start. The server is asked even when the keyboard seems unlocked here: the refusal is
   * fresher than the state. */
  unlock(): Promise<boolean> {
    return new Promise((resolve) => this.#wait({ tell: (outcome) => resolve(outcome.unlocked), quiet: false }));
  }

  /** unlock() for a caller that reports a failure itself, as part of its own: a start that fails isn't shown when only
   * such callers wait for it, and they are told its failure instead */
  unlockQuietly(): Promise<UnlockOutcome> {
    return new Promise((tell) => this.#wait({ tell, quiet: true }));
  }

  #wait(waiter: Waiter): void {
    this.#waiting.push(waiter);
    if (this.state.state !== "unlocking") void this.#start(false);
  }

  /** Starts an unlock; the server answers "unlocked" without starting one when the keyboard is unlocked already */
  start(): Promise<void> {
    return this.#start(true);
  }

  /** `shown`: a failure is shown even when only quiet callers wait (the start was asked for by start()) */
  #start(shown: boolean): Promise<void> {
    if (this.#starting) {
      this.#startShown ||= shown;
      return this.#starting;
    }
    this.#startShown = shown;
    this.#starting = this.#send("Unlocking the keyboard", api.unlockStart, {
      // before anyone is told: an unlock asked by them sends a start of its own
      answered: () => (this.#starting = null),
      // the server sends no event then
      outdated: (state) => {
        if (state.state === "unlocked") this.#settle(true);
      },
      quiet: () => !this.#startShown && this.#waiting.length > 0 && this.#waiting.every((w) => w.quiet),
      failed: (failure) => {
        this.open = false;
        this.#settle(false, failure);
      },
    });
    return this.#starting;
  }

  cancel(): Promise<void> {
    return this.#send("Cancelling the unlock", api.unlockCancel);
  }

  lock(): Promise<void> {
    return this.#send("Locking the keyboard", api.lock);
  }

  #apply(state: UnlockState): void {
    this.state = state;
    if (state.state === "unlocking") {
      this.open = true;
    } else {
      this.open = false;
      this.#settle(state.state === "unlocked");
    }
  }

  /** Sends a request that answers with the unlock state. Only the latest request's answer is taken (an unlock
   * cancelled while it was starting stays cancelled), and only when no update came after it was sent: an event is
   * fresher than the answer. Then `outdated` gets the answer instead. A failure is shown unless `quiet` says its
   * callers show it (they are then handed it by `failed`). */
  async #send(
    action: string,
    request: () => Promise<UnlockState>,
    on: {
      answered?: () => void;
      outdated?: (state: UnlockState) => void;
      quiet?: () => boolean;
      failed?: (failure: unknown) => void;
    } = {},
  ): Promise<void> {
    const sent = ++this.#sent;
    const updates = this.#updates;
    this.busy = true;
    let state: UnlockState;
    try {
      state = await request();
    } catch (error) {
      on.answered?.();
      if (sent !== this.#sent) return;
      this.busy = false;
      const current = updates === this.#updates;
      const quiet = current && (on.quiet?.() ?? false);
      if (!quiet) toasts.error(failureMessage(action, error));
      if (current) on.failed?.(quiet ? error : undefined);
      return;
    }
    on.answered?.();
    if (sent !== this.#sent) return;
    this.busy = false;
    if (updates === this.#updates) this.#apply(state);
    else on.outdated?.(state);
  }

  /** Tells everyone waiting; `failure` is for the quiet ones, when the start failed without being shown */
  #settle(unlocked: boolean, failure?: unknown): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    const outcome: UnlockOutcome = unlocked ? { unlocked: true }
      : failure === undefined ? { unlocked: false } : { unlocked: false, failure };
    for (const { tell } of waiting) tell(outcome);
  }
}
