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

export class Unlocker {
  state = $state<UnlockState>(LOCKED);
  /** the unlock dialog shows */
  open = $state(false);
  /** a request to the server is on its way */
  busy = $state(false);
  /** callers of unlock(): told whether the keyboard got unlocked */
  #waiting: ((unlocked: boolean) => void)[] = [];
  /** requests sent to the server so far */
  #sent = 0;

  /** The keyboard's unlock state changed (an event, or a session read): an unlock that runs shows the dialog, wherever
   * it was started; one that ends closes it */
  update(state: UnlockState): void {
    this.state = state;
    if (state.state === "unlocking") {
      this.open = true;
    } else {
      this.open = false;
      this.#settle(state.state === "unlocked");
    }
  }

  /** Unlock the keyboard (a change was refused as it is locked): resolves true once it is unlocked, false if the user
   * cancelled or it couldn't start */
  unlock(): Promise<boolean> {
    if (this.state.state === "unlocked") return Promise.resolve(true);
    const done = new Promise<boolean>((resolve) => this.#waiting.push(resolve));
    if (this.state.state !== "unlocking") void this.start();
    this.open = true;
    return done;
  }

  start(): Promise<void> {
    return this.#send("Unlocking the keyboard", api.unlockStart, () => {
      this.open = false;
      this.#settle(false);
    });
  }

  cancel(): Promise<void> {
    return this.#send("Cancelling the unlock", api.unlockCancel);
  }

  lock(): Promise<void> {
    return this.#send("Locking the keyboard", api.lock);
  }

  /** Sends a request that answers with the unlock state. Only the latest one's answer is taken: an unlock cancelled
   * while it was starting stays cancelled. */
  async #send(action: string, request: () => Promise<UnlockState>, failed?: () => void): Promise<void> {
    const sent = ++this.#sent;
    this.busy = true;
    try {
      const state = await request();
      if (sent === this.#sent) this.update(state);
    } catch (error) {
      toasts.error(failureMessage(action, error));
      if (sent === this.#sent) failed?.();
    } finally {
      if (sent === this.#sent) this.busy = false;
    }
  }

  #settle(unlocked: boolean): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const resolve of waiting) resolve(unlocked);
  }
}
