// Moving a key onto another of the layer shown, for the Keymap page: a press on a key that becomes a drag, the menu
// of its drop, and the other key chosen with the keyboard after the Inspector's Swap or Copy. The page hands over the
// keys area's events and its key presses; the rules themselves (when a press drags, where it drops, what is written)
// are in move.ts.
import { tick, untrack } from "svelte";
import type { KeyboardModel } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { keyTitle, type Names } from "../keyboard/labels";
import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
import { keyboard } from "../lib/keyboard.svelte";
import { toasts } from "../lib/toasts.svelte";
import {
  dropTarget, LONG_PRESS_MS, moveDone, movePlan, pickHint, pressState, stillApplies, undoOf, type Change, type MoveKind,
  type Press,
} from "./move";
import { neighbour, type Direction } from "./navigation";

/** What the mover needs of the page */
export interface MoverHost {
  placement(): Placement;
  model(): KeyboardModel;
  /** the layer shown */
  layer(): number;
  names(): Names;
  /** each placed key's position in words, by refId ("left home row, 3rd from the outside") */
  positions(): Map<string, string>;
  /** the Edit view shows: moves happen there only */
  editing(): boolean;
  select(index: number): void;
  focusSelected(): Promise<void>;
}

/** A press on a key, by a pointer, that may become a drag; timer: a finger's long press */
interface KeyPress {
  pointerId: number;
  source: number;
  start: Press;
  timer?: ReturnType<typeof setTimeout>;
}

interface Drag {
  source: number;
  x: number;
  y: number;
  /** the key it would drop on */
  over: number | null;
}

/** The menu of a drop. It names the keys as they were dropped, not as the first of two writes leaves them; working:
 * the move being written */
interface Drop {
  source: number;
  target: number;
  layer: number;
  working: MoveKind | null;
  sourceTitle: string;
  targetTitle: string;
}

/** The Inspector's Swap or Copy: the next key chosen is the other one (cursor: the key the arrows reached) */
interface Picking {
  kind: MoveKind;
  source: number;
  layer: number;
  cursor: number;
}

const WHAT: Record<MoveKind, string> = { replace: "Copying the key", swap: "Swapping the keys" };
const UNDO: Record<MoveKind, string> = { replace: "Undoing the copy", swap: "Undoing the swap" };

export class KeyMover {
  /** the area holding the keys (the page binds it): presses on its keys may become drags; the drop menu goes in it */
  area = $state<HTMLElement>();
  drag = $state<Drag | null>(null);
  drop = $state<Drop | null>(null);
  picking = $state<Picking | null>(null);

  readonly #host: MoverHost;
  /** a press on a key that may become a drag (nothing shows: a plain click stays a click) */
  #press: KeyPress | null = null;
  /** a drag that ended makes a click (on a key, or around it), which mustn't select anything */
  #dragEnded = false;

  /** Made while the page is set up: its effects are the page's */
  constructor(host: MoverHost) {
    this.#host = host;

    // a move is for the layer shown, on a keyboard that can be changed: otherwise it is given up
    $effect(() => {
      const layer = host.layer();
      if (!keyboard.canEdit || !host.editing()) {
        untrack(() => this.cancelPress());
        if (!this.drop?.working) this.drop = null;
        this.picking = null;
      }
      if (this.picking && this.picking.layer !== layer) this.picking = null;
      if (this.drop && !this.drop.working && this.drop.layer !== layer) this.drop = null;
    });

    // the browser mustn't scroll the page while a finger drags a key (a passive listener can't stop it)
    $effect(() => {
      const area = this.area;
      if (!area) return;
      const touchmove = (event: TouchEvent) => {
        if (this.drag) event.preventDefault();
      };
      area.addEventListener("touchmove", touchmove, { passive: false });
      return () => area.removeEventListener("touchmove", touchmove);
    });

    // a press whose release the page may never see: the window lost the focus, or the page was hidden
    $effect(() => {
      const blur = () => this.cancelPress();
      const hidden = () => {
        if (document.visibilityState === "hidden") this.cancelPress();
      };
      window.addEventListener("blur", blur);
      document.addEventListener("visibilitychange", hidden);
      return () => {
        window.removeEventListener("blur", blur);
        document.removeEventListener("visibilitychange", hidden);
      };
    });

    // the grabbing cursor wherever the pointer goes; none once the page goes (with a press it had)
    $effect(() => {
      document.documentElement.classList.toggle("dragging-key", this.drag !== null);
    });
    $effect(() => () => {
      untrack(() => this.cancelPress());
      document.documentElement.classList.remove("dragging-key");
    });
  }

  /** What each placed key shows of a move: a ring on the one it would land on (or the arrows reached) */
  rings = $derived.by(() => {
    const { drag, drop, picking } = this;
    return this.#host.placement().items.map((_, i) =>
      i === drag?.over || i === drop?.target || (picking && i === picking.cursor && i !== picking.source)
        ? "var(--accent)" : null);
  });

  /** Which placed keys are faint: the one being moved */
  faded = $derived.by(() => {
    const { drag, drop } = this;
    return this.#host.placement().items.map((_, i) => i === drag?.source || i === drop?.source);
  });

  /** How to choose the other key, while it is chosen; "" otherwise */
  hint = $derived.by(() => (this.picking ? pickHint(this.picking.kind, this.#titleOf(this.picking.source)) : ""));

  /** The key the drop menu is on, in the keys area */
  get dropAnchor(): HTMLElement | null {
    const item = this.drop ? this.#host.placement().items[this.drop.target] : undefined;
    return item ? this.area?.querySelector<HTMLElement>(`[data-ref="${refId(item)}"]`) ?? null : null;
  }

  // ---- the pointer ----

  /** On the keys area: a press on a key may become a drag */
  pointerDown(event: PointerEvent): void {
    this.#dragEnded = false;
    if (event.button !== 0 || !event.isPrimary || this.#press || this.picking) return;
    if (!keyboard.canEdit || keyboard.pending > 0 || this.drop?.working) return;
    const source = this.#keyAt(event.target as Element);
    if (source < 0 || this.#host.placement().items[source].kind !== "key") return;
    // a finger or a pen pans the page: it holds the key still long enough to pick it up, before it moves
    const start = { x: event.clientX, y: event.clientY, time: event.timeStamp, touch: event.pointerType !== "mouse" };
    const press: KeyPress = { pointerId: event.pointerId, source, start };
    if (start.touch) press.timer = setTimeout(() => this.#startDrag(start.x, start.y), LONG_PRESS_MS);
    this.#press = press;
  }

  /** On the window */
  pointerMove(event: PointerEvent): void {
    const press = this.#press;
    if (!press || event.pointerId !== press.pointerId) return;
    // a mouse with no button held: its release went somewhere the page didn't see
    if (event.pointerType === "mouse" && event.buttons === 0) {
      this.cancelPress();
      return;
    }
    // by the moves' own times, not by when the page got to them: a busy page may run the long press's timer before
    // the moves of a quick swipe, and the swipe still scrolls the page (the drag it started goes)
    const state = pressState(press.start, event.clientX, event.clientY, event.timeStamp);
    if (state === "scroll") {
      this.cancelPress();
      return;
    }
    if (!this.drag) {
      if (state !== "drag") return;
      this.#startDrag(event.clientX, event.clientY);
    }
    if (!this.drag) return;
    const items = this.#host.placement().items;
    const index = this.#keyAt(document.elementFromPoint(event.clientX, event.clientY));
    const over = dropTarget(items, this.drag.source, index >= 0 ? refId(items[index]) : null);
    this.drag = { ...this.drag, x: event.clientX, y: event.clientY, over };
  }

  /** On the window: a drop on another key opens its menu */
  pointerUp(event: PointerEvent): void {
    // the click a release makes comes straight after it: only that one is swallowed after a drag
    setTimeout(() => (this.#dragEnded = false));
    const press = this.#press;
    if (!press || event.pointerId !== press.pointerId) return;
    const dragged = this.drag;
    this.cancelPress();
    // not dragged: the key's click selects it; dropped on the key itself or outside the keyboard: nothing
    if (!dragged || dragged.over === null) return;
    const { source, over: target } = dragged;
    this.drop = {
      source, target, layer: this.#host.layer(), working: null, sourceTitle: this.#titleOf(source),
      targetTitle: this.#titleOf(target),
    };
  }

  /** On the window: a pointer the browser took over (scrolling, say) */
  pointerCancel(event: PointerEvent): void {
    if (this.#press && event.pointerId === this.#press.pointerId) this.cancelPress();
  }

  /** On the keys area, in the capture phase: the click that ends a drag selects nothing */
  clickCapture(event: MouseEvent): void {
    if (!this.#dragEnded) return;
    this.#dragEnded = false;
    event.stopPropagation();
  }

  /** On the keys area: a finger holding a key picks it up, rather than asking for the browser's menu */
  contextMenu(event: MouseEvent): void {
    if (this.#press?.start.touch) event.preventDefault();
  }

  /** Ends a press, and its drag, with no move: Esc, or the pointer lost */
  cancelPress(): void {
    const press = this.#press;
    if (!press) return;
    clearTimeout(press.timer);
    if (this.drag) this.#dragEnded = true;
    this.#press = null;
    this.drag = null;
  }

  // ---- the keyboard, and clicks while the other key is chosen ----

  /** A key pressed on the page (no modifier, no dialog open), with the key that has the focus (-1 for none) and the
   * arrow's direction. Returns whether the mover took it: Esc ends a drag; while the other key is chosen, the arrows
   * move among the keys without selecting them, Enter chooses, Esc gives up, Delete clears nothing. */
  keydown(event: KeyboardEvent, focused: number, direction: Direction | undefined, fromBody: boolean): boolean {
    if (event.key === "Escape" && this.#press) {
      event.preventDefault();
      this.cancelPress();
      return true;
    }
    const picking = this.picking;
    if (!picking) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.stopPicking();
    } else if (direction && (focused >= 0 || fromBody)) {
      event.preventDefault();
      const items = this.#host.placement().items;
      const cursor = neighbour(items, focused >= 0 ? focused : picking.cursor, direction);
      this.picking = { ...picking, cursor };
      void tick().then(() => document.querySelector<HTMLElement>(`[data-ref="${refId(items[cursor])}"]`)?.focus());
    } else if (event.key === "Enter" && focused >= 0) {
      event.preventDefault();
      void this.pickTarget(focused);
    } else if ((event.key === "Delete" || event.key === "Backspace") && focused >= 0) {
      event.preventDefault();
    }
    return true;
  }

  /** A click on a key: while the other key is chosen, it is that key (returns true); else the page selects it */
  click(index: number): boolean {
    if (!this.picking) return false;
    void this.pickTarget(index);
    return true;
  }

  // ---- the moves ----

  /** The drop menu's choice: the menu stays while the keys are written; then the key dropped on is selected */
  async chooseDrop(kind: MoveKind): Promise<void> {
    const drop = this.drop;
    if (!drop || drop.working) return;
    if (this.#busy(kind)) return;
    this.drop = { ...drop, working: kind };
    const done = await this.#move(kind, drop.source, drop.target);
    this.drop = null;
    if (done) this.#host.select(drop.target);
    await this.#host.focusSelected();
  }

  /** The drop menu closed with no move: Esc or Cancel give the keys the focus back; a click elsewhere keeps it there */
  closeDrop(refocus: boolean): void {
    this.drop = null;
    if (refocus) void this.#host.focusSelected();
  }

  /** The Inspector's Swap or Copy for the selected key: the next key chosen is the other one. Pressed again, it gives
   * up. */
  togglePicking(kind: MoveKind, selected: number): void {
    if (this.picking?.kind === kind) {
      this.stopPicking();
      return;
    }
    if (!keyboard.canEdit || keyboard.pending > 0 || this.#host.placement().items[selected]?.kind !== "key") return;
    this.drop = null;
    this.picking = { kind, source: selected, layer: this.#host.layer(), cursor: selected };
    void this.#host.focusSelected();
  }

  stopPicking(): void {
    this.picking = null;
    void this.#host.focusSelected();
  }

  /** The other key of a move chosen from the Inspector. Choosing the key itself gives up; an encoder isn't one. */
  async pickTarget(index: number): Promise<void> {
    const picking = this.picking;
    if (!picking) return;
    const { kind, source } = picking;
    if (index === source) {
      this.stopPicking();
      return;
    }
    if (this.#host.placement().items[index]?.kind !== "key" || this.#busy(kind)) return;
    this.picking = null;
    if (await this.#move(kind, source, index)) this.#host.select(index);
    await this.#host.focusSelected();
  }

  /** Whether another change is still being saved: a toast says why nothing happened */
  #busy(kind: MoveKind): boolean {
    if (keyboard.pending === 0) return false;
    toasts.error(`${WHAT[kind]} failed: another change was still being saved. Try again.`);
    return true;
  }

  /** Replace the target with the source key, or swap the two, on the layer shown. A toast says what was done and
   * offers to undo it. Returns whether it was done. */
  async #move(kind: MoveKind, source: number, target: number): Promise<boolean> {
    const host = this.#host;
    const model = host.model();
    const layer = host.layer();
    const from = host.placement().items[source];
    const to = host.placement().items[target];
    const fromAction = actionAt(model, layer, from);
    const toAction = actionAt(model, layer, to);
    if (!fromAction || !toAction) return false;
    const changes = movePlan(kind, { ref: from, code: fromAction.code }, { ref: to, code: toAction.code });
    if (changes.length === 0) {
      toasts.info(`Nothing to change: both keys already are ${this.#titleOf(source)}.`);
      return true;
    }
    const words = (ref: KeyRef, index: number) => ({ title: this.#titleOf(index), where: this.#whereOf(ref) });
    const said = moveDone(kind, words(from, source), words(to, target));
    const placeOf = (ref: KeyRef) => this.#placeOf(ref);
    if (!(await keyboard.setCodes(layer, changes, WHAT[kind], placeOf))) return false;
    const opened = keyboard.opened;
    toasts.info(said, {
      label: "Undo", run: () => this.#undo(opened, layer, changes, kind, placeOf), onKeyboardShown: true,
    });
    return true;
  }

  /** Puts a move back, unless the keys were changed since (or it is another keyboard, even one alike: `opened` is
   * KeyboardStore.opened when the move was made): that would undo something else. Resolves to whether the toast
   * offering it can go. */
  async #undo(opened: number, layer: number, changes: Change[], kind: MoveKind, placeOf: (ref: KeyRef) => string) {
    const action = UNDO[kind];
    const now = keyboard.model;
    // seldom: its toast goes once another keyboard is shown (dropKeyboardActions)
    if (!now || keyboard.opened !== opened) {
      toasts.error(`${action} failed: another keyboard is shown now.`);
      return true;
    }
    if (!stillApplies(now, layer, changes)) {
      toasts.error(`${action} failed: the keys were changed since.`);
      return true;
    }
    if (keyboard.pending > 0) {
      toasts.error(`${action} failed: another change was still being saved. Try again.`);
      return false;
    }
    if (!keyboard.canEdit) {
      toasts.error(`${action} failed: the keyboard can't be changed just now.`);
      return false;
    }
    return keyboard.setCodes(layer, undoOf(changes), action, placeOf);
  }

  /** What a placed key does on the layer shown, in words */
  #titleOf(index: number): string {
    const item = this.#host.placement().items[index];
    const action = item ? actionAt(this.#host.model(), this.#host.layer(), item) : undefined;
    return action ? keyTitle(action, this.#host.names()) : "Empty";
  }

  /** "left home row, 3rd from the outside", else "row 1, column 2" */
  #whereOf(ref: KeyRef): string {
    return this.#host.positions().get(refId(ref)) ?? whereIs(this.#host.model(), ref).where;
  }

  /** A key in a message: "left home row, 3rd from the outside", else "the key at row 1, column 2" */
  #placeOf(ref: KeyRef): string {
    return this.#host.positions().get(refId(ref)) ?? `the key at ${whereIs(this.#host.model(), ref).where}`;
  }

  /** The placed key an element is part of, in the keys area; -1 for none */
  #keyAt(element: Element | null): number {
    const key = element?.closest<HTMLElement>("[data-ref]");
    if (!key || !this.area?.contains(key)) return -1;
    return this.#host.placement().items.findIndex((i) => refId(i) === key.dataset.ref);
  }

  #startDrag(x: number, y: number): void {
    const press = this.#press;
    if (!press || this.drag) return;
    clearTimeout(press.timer);
    this.drop = null;
    this.drag = { source: press.source, x, y, over: null };
  }
}
