// Arrange layers around its dialog, for the Keymap page: opening it (asking first about work not saved), Apply with its
// toast and Undo, Finish and Put back after an arrange stopped partway, and the Edit view following the layer it showed
// to its new position. The order logic and the words are in arrange.ts.
import { tick } from "svelte";
import { ApiError } from "../api/errors";
import type { ArrangedModel } from "../api/types";
import { keyboard, type Report } from "../lib/keyboard.svelte";
import { toasts } from "../lib/toasts.svelte";
import { unsavedWork } from "../lib/unsaved";
import { arrangeBlocked, keptText, LAYERS_CHANGED, positionAfter, reverseOrder, unsavedQuestion } from "./arrange";
import { keymapState } from "./state.svelte";

const UNDO = "Undoing the arrange";

/** Whether a failure is the server's refusal of an order chosen for layers that changed since (nothing was written) */
export function isLayoutChanged(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "layoutChanged";
}

export class LayerArranger {
  /** the dialog shows */
  open = $state(false);
  /** the question about work not saved, while it is asked */
  asking = $state<string | null>(null);
  /** the element (by id) that opened the dialog: it gets the focus back */
  #opener: string | null = null;
  /** the toast offering to undo the last arrange, and the layout version that arrange left: the toast goes once
   * another arrange is made, or the layout version moves past it (another tab's arrange, a layout file loaded) */
  #undo: { toast: number; version: number } | null = null;

  constructor() {
    keyboard.onLayoutVersion((version) => {
      if (this.#undo && version !== null && version > this.#undo.version) this.#dropUndo();
    });
  }

  /** Why the Arrange layers button does nothing just now, or null */
  get blocked(): string | null {
    return arrangeBlocked(keyboard.model?.layers.length ?? 0, keyboard.canEdit);
  }

  /** The Arrange layers button (its id: the focus goes back to it): work not saved is asked about first */
  start(opener: string): void {
    if (this.blocked !== null || this.open || this.asking !== null) return;
    this.#opener = opener;
    const work = unsavedWork(keyboard.model);
    if (work.length > 0) this.asking = unsavedQuestion(work);
    else this.open = true;
  }

  /** The question's answer: arrange all the same */
  confirm(): void {
    this.asking = null;
    this.open = true;
  }

  /** The question closed; the focus goes back unless the dialog opened */
  questionClosed(): void {
    this.asking = null;
    if (!this.open) void this.#focusOpener();
  }

  /** The dialog closed (applied or not) */
  closed(): void {
    this.open = false;
    void this.#focusOpener();
  }

  /** The Keymap page went (another keyboard is shown, which makes it anew): its dialog and question go with it, and
   * nothing gets the focus back */
  dropped(): void {
    this.open = false;
    this.asking = null;
    this.#opener = null;
  }

  /** Apply in the dialog: `order` chosen for layout version `expect` (its preview's). report: the failure's message,
   * which the dialog shows. Resolves to whether it was done. */
  async apply(order: number[], expect: number | null, report: Report): Promise<boolean> {
    const shown = keymapState.layer;
    const opened = keyboard.opened;
    const arranged = await keyboard.arrangeLayers(order, expect, report);
    if (arranged) this.#arranged(order, shown, opened, arranged);
    return arranged !== null;
  }

  /** Finish an arrange that stopped partway: the Edit view follows its layer, and Undo is offered */
  async finish(report?: Report): Promise<boolean> {
    const order = keyboard.unfinishedArrange?.order;
    const shown = keymapState.layer;
    const opened = keyboard.opened;
    const arranged = await keyboard.finishArrange(report);
    if (arranged && order) this.#arranged(order, shown, opened, arranged);
    return arranged !== null;
  }

  /** Put back an arrange that stopped partway */
  async putBack(report?: Report): Promise<boolean> {
    const arranged = await keyboard.putBackArrange(report);
    if (arranged) toasts.info(this.#withKept("The layers were put back as they were.", arranged));
    return arranged !== null;
  }

  /** Done: the Edit view follows the layer it showed, and Undo is offered; not when another keyboard is shown now
   * (opened: keyboard.opened when it was asked for), where neither would make sense */
  #arranged(order: number[], shown: number, opened: number, arranged: ArrangedModel): void {
    if (keyboard.opened !== opened) return;
    keymapState.layer = positionAfter(order, shown);
    this.#dropUndo();
    const version = arranged.layoutVersion;
    const toast = toasts.info(this.#withKept("Layers arranged.", arranged), {
      label: "Undo", run: () => this.#runUndo(order, opened, version), onKeyboardShown: true,
    });
    this.#undo = { toast, version };
  }

  /** What was done, and what was kept as it was (Finish, Put back) */
  #withKept(done: string, arranged: ArrangedModel): string {
    return arranged.kept > 0 ? `${done} ${keptText(arranged.kept)}` : done;
  }

  #dropUndo(): void {
    if (this.#undo) toasts.dismiss(this.#undo.toast);
    this.#undo = null;
  }

  /** Arranges with the reverse order, refused when the layers changed since the arrange it undoes (version: the
   * layout version that left). Resolves to whether its toast can go. */
  async #runUndo(order: number[], opened: number, version: number): Promise<boolean> {
    if (keyboard.opened !== opened) {
      toasts.error(`${UNDO} failed: another keyboard is shown now.`);
      return true;
    }
    if (keyboard.unfinishedArrange) {
      toasts.error(`${UNDO} failed: an arrange is unfinished. Finish it or put it back first.`);
      return true;
    }
    const now = keyboard.layoutVersion;
    if (now !== null && now > version) {
      toasts.error(`${UNDO} failed: ${LAYERS_CHANGED}`);
      return true;
    }
    if (keyboard.pending > 0) {
      toasts.error(`${UNDO} failed: another change was still being saved. Try again.`);
      return false;
    }
    if (!keyboard.canEdit) {
      toasts.error(`${UNDO} failed: the keyboard can't be changed just now.`);
      return false;
    }
    const back = reverseOrder(order);
    const shown = keymapState.layer;
    // its own arrange moves the layout version on: the toast goes when it is done, not before
    const held = this.#undo;
    this.#undo = null;
    let changed = false;
    const arranged = await keyboard.arrangeLayers(back, version, (message, error) => {
      changed = isLayoutChanged(error);
      toasts.error(changed ? `${UNDO} failed: ${LAYERS_CHANGED}` : message);
    }, "undo");
    if (arranged) {
      if (keyboard.opened === opened) keymapState.layer = positionAfter(back, shown);
      return true;
    }
    // stopped partway: the bar offers Finish and Put back from now on
    if (changed || keyboard.unfinishedArrange !== null) return true;
    if (held && this.#undo === null) this.#undo = held;
    return false;
  }

  async #focusOpener(): Promise<void> {
    await tick();
    const opener = this.#opener ? document.getElementById(this.#opener) : null;
    (opener ?? document.getElementById("keymap-title"))?.focus();
  }
}

export const layerArranger = new LayerArranger();
