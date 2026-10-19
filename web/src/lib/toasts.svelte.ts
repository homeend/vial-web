// Short messages in the corner: mostly why an edit failed; some say what was done, with an action (Undo).
// One rule for all of them: a toast goes away SHOW_MS after it appears, except while the pointer is on it or focus
// is in it; when both have left, it gets the full SHOW_MS again. Dismissing it removes it at once.

/** A button on a toast. run resolves to whether it did what it says: the toast then goes, else it stays (to try
 * again). */
export interface ToastAction {
  label: string;
  run: () => boolean | Promise<boolean>;
}

export interface Toast {
  id: number;
  message: string;
  /** why something failed, or what was done */
  tone: "error" | "info";
  action?: ToastAction;
}

export type HoldReason = "hover" | "focus";

export const SHOW_MS = 7000;

export class Toasts {
  items = $state<Toast[]>([]);
  #next = 1;
  #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #holds = new Map<number, Set<HoldReason>>();

  #acting = new Set<number>();

  error(message: string): void {
    this.#add({ message, tone: "error" });
  }

  /** What was done, maybe with an action (Undo) */
  info(message: string, action?: ToastAction): void {
    this.#add({ message, tone: "info", action });
  }

  /** Runs a toast's action, unless the toast has gone or its action is running already */
  async act(id: number): Promise<void> {
    const action = this.items.find((t) => t.id === id)?.action;
    if (!action || this.#acting.has(id)) return;
    this.#acting.add(id);
    try {
      if (await action.run()) this.dismiss(id);
    } finally {
      this.#acting.delete(id);
    }
  }

  #add(toast: Omit<Toast, "id">): void {
    const id = this.#next++;
    this.items.push({ id, ...toast });
    this.#holds.set(id, new Set());
    this.#countDown(id);
  }

  dismiss(id: number): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.#holds.delete(id);
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Keep the toast while it is being read (held) or let it count down again (released) */
  hold(id: number, reason: HoldReason, held: boolean): void {
    const holds = this.#holds.get(id);
    if (!holds) return; // already gone
    if (held) holds.add(reason);
    else holds.delete(reason);
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    if (holds.size === 0) this.#countDown(id);
  }

  #countDown(id: number): void {
    this.#timers.set(id, setTimeout(() => this.dismiss(id), SHOW_MS));
  }
}

export const toasts = new Toasts();
