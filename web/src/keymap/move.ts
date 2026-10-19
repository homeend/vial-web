// Moving a key's keycode onto another key of the layer shown: dragged with the pointer, or chosen with the keyboard
// from the Inspector. Either replaces the other key with this one, or swaps the two.
import type { KeyboardModel } from "../api/types";
import type { PlacedKey } from "../keyboard/geometry";
import { actionAt, refId, type KeyRef } from "../keyboard/refs";

export type MoveKind = "replace" | "swap";

/** How far (px) a mouse press moves before it drags the key rather than clicks it */
export const DRAG_THRESHOLD = 6;
/** How long (ms) a finger or pen holds a key still before it can drag it: moving sooner scrolls the page, as a pen
 * pans the page as a finger does */
export const LONG_PRESS_MS = 350;
/** How far (px) a finger or pen may wander while it holds a key, before it is taken as scrolling */
export const TOUCH_SLOP = 10;

/** Where and when a press on a key started, and whether by a finger or pen (touch) rather than a mouse */
export interface Press {
  x: number;
  y: number;
  time: number;
  touch: boolean;
}

/** What a press is once the pointer is at (x, y) at a time: still a click ("press"), a drag, or a finger or pen
 * scrolling the page (given up). A mouse drags once it has moved DRAG_THRESHOLD; a finger or pen must first hold the
 * key still for LONG_PRESS_MS (wandering TOUCH_SLOP at most), so that a swipe across the keyboard still scrolls. */
export function pressState(press: Press, x: number, y: number, time: number): "press" | "drag" | "scroll" {
  const moved = Math.hypot(x - press.x, y - press.y);
  if (press.touch && time - press.time < LONG_PRESS_MS) return moved > TOUCH_SLOP ? "scroll" : "press";
  return moved >= DRAG_THRESHOLD ? "drag" : "press";
}

/** The placed key a drag from items[source] would drop on, given the data-ref of what is under the pointer: a key of
 * the drawing other than the one dragged; null outside the keyboard, on the key itself or for encoders */
export function dropTarget(items: Pick<PlacedKey, "kind" | "index">[], source: number, under: string | null): number | null {
  if (under === null || items[source]?.kind !== "key") return null;
  const index = items.findIndex((item) => refId(item) === under);
  return index >= 0 && index !== source && items[index].kind === "key" ? index : null;
}

/** One key's keycode to write: what it was, for putting it back */
export interface Change {
  ref: KeyRef;
  code: string;
  was: string;
}

interface KeyCode {
  ref: KeyRef;
  code: string;
}

/** What to write: replacing changes the target to the source's keycode; swapping does that, then changes the source
 * to the target's. Nothing that already is so. */
export function movePlan(kind: MoveKind, source: KeyCode, target: KeyCode): Change[] {
  const changes = [{ ref: target.ref, code: source.code, was: target.code }];
  if (kind === "swap") changes.push({ ref: source.ref, code: target.code, was: source.code });
  return changes.filter((c) => c.code !== c.was);
}

/** The keycode whose writing needs an unlocked keyboard, wherever it goes: the firmware refuses it while locked. The
 * server's rule (protocol set_key and set_encoder, edits._needs_unlock): writing RESET_KEYCODE where it isn't yet. */
export const UNLOCK_KEYCODE = "QK_BOOT";

/** The changes in the order to write them: those a locked keyboard refuses first, so that a refusal (and an unlock
 * that doesn't happen) comes before anything is written; the others in their order */
export function unlockFirst(changes: Change[]): Change[] {
  const needs = (c: Change) => c.code === UNLOCK_KEYCODE && c.was !== UNLOCK_KEYCODE;
  return [...changes.filter(needs), ...changes.filter((c) => !needs(c))];
}

/** What puts changes back: each key to what it was, the last one first */
export function undoOf(changes: Change[]): Change[] {
  return changes.map((c) => ({ ref: c.ref, code: c.was, was: c.code })).reverse();
}

/** Whether the keys still have what changes wrote on the layer: undoing them would otherwise undo something else */
export function stillApplies(model: Pick<KeyboardModel, "layers">, layer: number, changes: Change[]): boolean {
  return changes.every((c) => actionAt(model, layer, c.ref)?.code === c.code);
}

/** How to choose the other key, once the Inspector's Copy or Swap was chosen */
export function pickHint(kind: MoveKind, source: string): string {
  const what = kind === "replace" ? `copy ${source} to` : `swap ${source} with`;
  return `Choose the key to ${what}: click it, or move to it with the arrow keys and press Enter. Esc cancels.`;
}

/** A key as said in the messages: what it does, and where it is ("row 1, column 2") */
export interface KeyWords {
  title: string;
  where: string;
}

/** What a move did, said in the toast that offers to undo it */
export function moveDone(kind: MoveKind, source: KeyWords, target: KeyWords): string {
  if (kind === "swap") return `Swapped ${source.title} (${source.where}) and ${target.title} (${target.where}).`;
  const where = target.where.charAt(0).toUpperCase() + target.where.slice(1);
  return `${where} is now ${source.title} (it was ${target.title}).`;
}

/** A box in the window, in pixels */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Between the key dropped on and its menu, in pixels */
export const MENU_GAP = 8;

/** Where the menu of a drop goes, relative to the area that holds it: below the key, centred on it and kept inside the
 * area's width; above it when the window has no room for it below but has above */
export function menuPlace(
  key: Box, area: Box, menu: { width: number; height: number }, windowHeight: number,
): { left: number; top: number } {
  const centre = (key.left + key.right) / 2 - area.left;
  const left = Math.max(0, Math.min(centre - menu.width / 2, area.right - area.left - menu.width));
  const above = key.bottom + MENU_GAP + menu.height > windowHeight && key.top - MENU_GAP - menu.height >= 0;
  const top = above ? key.top - area.top - MENU_GAP - menu.height : key.bottom - area.top + MENU_GAP;
  return { left, top };
}
