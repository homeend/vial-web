// Short messages in the corner: mostly why an edit failed.

export interface Toast {
  id: number;
  message: string;
}

const SHOW_MS = 7000;

class Toasts {
  items = $state<Toast[]>([]);
  #next = 1;

  error(message: string): void {
    const id = this.#next++;
    this.items.push({ id, message });
    setTimeout(() => this.dismiss(id), SHOW_MS);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
