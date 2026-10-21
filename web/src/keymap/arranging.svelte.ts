// Arrange layers around its dialog, for the Keymap page: opening it (asking first about work not saved), Apply with its
// toast and Undo, Finish and Put back after an arrange stopped partway, and the Edit view following the layer it showed
// to its new position. The order logic and the words are in arrange.ts.
import { tick } from "svelte";
import { keyboard } from "../lib/keyboard.svelte";
import { toasts } from "../lib/toasts.svelte";
import { unsavedWork } from "../lib/unsaved";
import { arrangeBlocked, positionAfter, reverseOrder, unsavedQuestion } from "./arrange";
import { keymapState } from "./state.svelte";

const UNDO = "Undoing the arrange";

export class LayerArranger {
  /** the dialog shows */
  open = $state(false);
  /** the question about work not saved, while it is asked */
  asking = $state<string | null>(null);
  /** the element (by id) that opened the dialog: it gets the focus back */
  #opener: string | null = null;
  /** the toast offering to undo the last arrange: it goes once another arrange is made */
  #undoToast: number | null = null;

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

  /** Apply in the dialog. report: the failure's message, which the dialog shows */
  async apply(order: number[], report: (message: string) => void): Promise<boolean> {
    const shown = keymapState.layer;
    const done = await keyboard.arrangeLayers(order, report);
    if (done) this.#arranged(order, shown);
    return done;
  }

  /** Finish an arrange that stopped partway: the Edit view follows its layer, and Undo is offered */
  async finish(report?: (message: string) => void): Promise<boolean> {
    const order = keyboard.unfinishedArrange?.order;
    const shown = keymapState.layer;
    const done = await keyboard.finishArrange(report);
    if (done && order) this.#arranged(order, shown);
    return done;
  }

  /** Put back an arrange that stopped partway */
  async putBack(report?: (message: string) => void): Promise<boolean> {
    const done = await keyboard.putBackArrange(report);
    if (done) toasts.info("The layers were put back as they were.");
    return done;
  }

  #arranged(order: number[], shown: number): void {
    keymapState.layer = positionAfter(order, shown);
    if (this.#undoToast !== null) toasts.dismiss(this.#undoToast);
    const opened = keyboard.opened;
    this.#undoToast = toasts.info("Layers arranged.", {
      label: "Undo", run: () => this.#undo(order, opened), onKeyboardShown: true,
    });
  }

  /** Arranges with the reverse order. Resolves to whether its toast can go. */
  async #undo(order: number[], opened: number): Promise<boolean> {
    if (keyboard.opened !== opened) {
      toasts.error(`${UNDO} failed: another keyboard is shown now.`);
      return true;
    }
    if (keyboard.unfinishedArrange) {
      toasts.error(`${UNDO} failed: an arrange is unfinished. Finish it or put it back first.`);
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
    const done = await keyboard.arrangeLayers(back, undefined, UNDO);
    if (done) {
      keymapState.layer = positionAfter(back, shown);
      this.#undoToast = null;
    }
    // stopped partway: the bar offers Finish and Put back from now on
    return done || keyboard.unfinishedArrange !== null;
  }

  async #focusOpener(): Promise<void> {
    await tick();
    const opener = this.#opener ? document.getElementById(this.#opener) : null;
    (opener ?? document.getElementById("keymap-title"))?.focus();
  }
}

export const layerArranger = new LayerArranger();
