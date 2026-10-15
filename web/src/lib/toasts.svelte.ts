// Short messages in the corner: mostly why an edit failed.
// One rule for all of them: a toast goes away SHOW_MS after it appears, except while the pointer is on it or focus
// is in it; when both have left, it gets the full SHOW_MS again. Dismissing it removes it at once.

export interface Toast {
  id: number;
  message: string;
}

export type HoldReason = "hover" | "focus";

export const SHOW_MS = 7000;

export class Toasts {
  items = $state<Toast[]>([]);
  #next = 1;
  #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #holds = new Map<number, Set<HoldReason>>();

  error(message: string): void {
    const id = this.#next++;
    this.items.push({ id, message });
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
