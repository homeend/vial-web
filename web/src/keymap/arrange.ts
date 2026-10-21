// Arrange layers: the order the dialog shows, the server's preview of it in words, and asking for that preview
// without flooding the server. An order lists, for each position, the layer that goes there (order[position] = layer
// now): [0, 3, 1, 2] puts layer 3 at position 1. Layer 0 never moves.
import type { ArrangePreview, ArrangeReferences, UnfinishedArrange } from "../api/types";

/** The fewest layers a keyboard needs for anything to be arranged: layer 0 stays first */
export const ARRANGE_MIN_LAYERS = 3;

/** How long (ms) the dialog waits after a change before it asks for the preview: quick moves make one request */
export const PREVIEW_PAUSE_MS = 300;

/** The order layers are in now: 0, 1, 2… */
export function currentOrder(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** Whether an order is the current one (nothing moves) */
export function isCurrent(order: number[]): boolean {
  return order.every((layer, position) => layer === position);
}

/** The order with the layer at `from` moved to `to` (the layers between shift by one); position 0 stays */
export function moveTo(order: number[], from: number, to: number): number[] {
  const target = Math.max(1, Math.min(order.length - 1, to));
  if (from < 1 || from >= order.length || target === from) return order;
  const next = [...order];
  const [layer] = next.splice(from, 1);
  next.splice(target, 0, layer);
  return next;
}

/** One step up (towards position 1) or down; unchanged at the end it is already at */
export function moveStep(order: number[], from: number, step: -1 | 1): number[] {
  return moveTo(order, from, from + step);
}

/** Whether the layer at a position can go one step up (towards position 1) or down */
export function canStep(order: number[], position: number, step: -1 | 1): boolean {
  const to = position + step;
  return position >= 1 && to >= 1 && to < order.length;
}

/** The order that puts layers back where they were before `order` was applied: what Undo arranges */
export function reverseOrder(order: number[]): number[] {
  const back = new Array<number>(order.length);
  order.forEach((layer, position) => {
    back[layer] = position;
  });
  return back;
}

/** Where a layer is after `order` was applied */
export function positionAfter(order: number[], layer: number): number {
  const at = order.indexOf(layer);
  return at < 0 ? layer : at;
}

/** The name a layer shows once the order is applied: its own name if it has one, else the default name of its new
 * position ("Layer 1"; "Base" for layer 0), as a layer never named has no name to take along */
export function nameAfter(layer: { name: string; customName: boolean } | undefined, position: number): string {
  if (layer?.customName) return layer.name;
  return position === 0 ? "Base" : `Layer ${position}`;
}

/** An order as a key, to tell answers apart */
export function orderKey(order: number[]): string {
  return order.join(",");
}

// ---- the preview in words ----

const PLACES: [keyof ArrangeReferences, string, string][] = [
  ["keymap", "in the keymap", "in the keymap"],
  ["encoders", "on an encoder", "on encoders"],
  ["tapDance", "in a tap dance", "in tap dances"],
  ["combos", "in a combo", "in combos"],
  ["keyOverrides", "in a key override", "in key overrides"],
  ["altRepeatKeys", "in an alt-repeat key", "in alt-repeat keys"],
  ["macros", "in a macro", "in macros"],
];

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What Apply would change, in one sentence: "Will change: 3 layers move · 94 keys rewritten · 4 layer keys renumbered
 * (4 in the keymap) · the layers of 1 key override". encoders: the keyboard has encoders (the keys count their
 * directions too). "Nothing to change" for the current order. */
export function summaryText(preview: ArrangePreview, encoders = false): string {
  if (preview.moves.length === 0) return "Nothing to change.";
  const parts = [count(preview.moves.length, "layer moves", "layers move")];
  if (preview.keys > 0) {
    parts.push(`${count(preview.keys, encoders ? "key or encoder direction" : "key",
      encoders ? "keys and encoder directions" : "keys")} rewritten`);
  }
  const places = PLACES.filter(([place]) => preview.references[place] > 0)
    .map(([place, one, many]) => `${preview.references[place]} ${preview.references[place] === 1 ? one : many}`);
  const references = PLACES.reduce((sum, [place]) => sum + preview.references[place], 0);
  if (references > 0) {
    parts.push(`${count(references, "layer key", "layer keys")} renumbered (${places.join(", ")})`);
  }
  if (preview.keyOverrides > 0) {
    parts.push(`the layers of ${count(preview.keyOverrides, "key override", "key overrides")}`);
  }
  return `Will change: ${parts.join(" · ")}.`;
}

/** "Nav, Sym and Num" */
function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The tri-layer warning: FN_MO13 and FN_MO23 turn on layers 1, 2 and 3 by number, which hold other layers after the
 * order. triLayer: the layers (by their position now) that end up at positions 1, 2 and 3. Layers are called by their
 * position now, as the rows' "← was N" does, with their own name if they have one (ownName: null for none).
 * protocol6: on Vial protocol 6 these layers are the firmware's tri-layer setting, 1, 2 and 3 unless the firmware's
 * code sets others (protocol 5 fixes them). */
export function triLayerWarning(triLayer: (number | null)[], ownName: (layer: number) => string | null,
  protocol6: boolean): string {
  const which = protocol6 ? "layers 1, 2 and 3 by number (the firmware's tri-layer layers, unless its code sets others)"
    : "layers 1, 2 and 3 by number";
  const keys = ["Fn1 turns on", "Fn2 turns on", "both held turn on"];
  const was = (layer: number) => {
    const name = ownName(layer);
    return name ? `${layer} (“${name}”)` : `${layer}`;
  };
  const changes = triLayer.flatMap((layer, i) => (layer === null || layer === i + 1 ? [] :
    [`${keys[i]} the layer that was ${was(layer)} instead of the one that was ${was(i + 1)}`]));
  return `Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow their layers: they use ${which}. After this, ` +
    `${changes.join("; ")}.`;
}

/** What Apply's button says while it writes: "Writing 94 keys…", or with other writes, "Writing 96 changes…" */
export function writingLabel(preview: ArrangePreview | null): string {
  if (!preview || preview.writes === 0) return "Writing…";
  if (preview.writes === preview.keys) return `Writing ${count(preview.keys, "key", "keys")}…`;
  return `Writing ${count(preview.writes, "change", "changes")}…`;
}

/** What an arrange stopped partway did, and what is left to do */
export function stoppedText(unfinished: UnfinishedArrange): string {
  const done = unfinished.done === 0 ? "at its first write" : `after ${unfinished.done} of ${unfinished.total} writes`;
  return `Arranging the layers stopped ${done}. The keyboard may hold part of the new order: finish it, or put it ` +
    "back as it was. Names move once it is finished.";
}

/** Why an order chosen earlier wasn't written, or Undo wasn't done: the layout version moved on since (the server's
 * 409 "layoutChanged", or the session said so first) */
export const LAYERS_CHANGED = "the layers were arranged again or a layout file was loaded since, so nothing was written.";

/** What the dialog says once the layers changed while it was open (another tab arranged them, or loaded a layout
 * file). applied: Apply was refused for it, nothing written; reset: the order shown is the current one again, as the
 * number of layers changed; else the rows keep the order chosen, of the layers as they are now. */
export function layersChangedText(applied: boolean, reset: boolean): string {
  const what = applied
    ? "The layers were arranged again or a layout file was loaded since this was shown (in another tab, say), so " +
      "Apply wrote nothing."
    : "The layers were arranged again or a layout file was loaded while this was open (in another tab, say).";
  return `${what} ${reset ? "The number of layers changed: the order shown is the current one again."
    : "The rows keep your order, with the layers as they are now: check it, then Apply."}`;
}

/** What Finish or Put back left as it was: what was changed since the arrange stopped (an edit, a layout file
 * loaded), which held neither the old order's value nor the new one's. The server counts each key, encoder direction,
 * whole tap dance, combo, key override or alt-repeat key, and macro. encoders: the keyboard has encoders. */
export function keptText(kept: number, encoders = false): string {
  const direction = encoders ? ["an encoder direction, ", "encoder directions, "] : ["", ""];
  return kept === 1
    ? `1 change made since the stop was kept as it is (a key, ${direction[0]}a tap dance, combo, key override or ` +
      "alt-repeat key, or a macro)."
    : `${kept} changes made since the stop were kept as they are (keys, ${direction[1]}tap dances, combos, key ` +
      "overrides, alt-repeat keys or macros).";
}

// ---- asking for the preview ----

/** What the preview follower says about the order shown */
export type PreviewState<T> =
  | { state: "waiting" }
  | { state: "ready"; preview: T }
  | { state: "failed"; error: unknown };

interface Timers {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Asks for the preview of the order shown, PREVIEW_PAUSE_MS after its last change, so that quick moves make one
 * request. An answer is used only while its order is still the one shown, and only if no answer asked for later was
 * used already: a newer answer replaces an older one, an answer for an order no longer shown is dropped. */
export class PreviewFollower<T> {
  #fetch: (order: number[]) => Promise<T>;
  #show: (state: PreviewState<T>) => void;
  #timers: Timers;
  #pause: number;
  #timer: unknown = null;
  /** the order shown, as a key */
  #shown = "";
  /** requests sent so far, and the one (by that count) whose answer is shown */
  #sent = 0;
  #used = 0;
  #stopped = false;

  constructor(fetch: (order: number[]) => Promise<T>, show: (state: PreviewState<T>) => void,
    timers: Timers = browserTimers, pause = PREVIEW_PAUSE_MS) {
    this.#fetch = fetch;
    this.#show = show;
    this.#timers = timers;
    this.#pause = pause;
  }

  /** The order shown changed (or is shown first): its preview is asked for after the pause */
  follow(order: number[]): void {
    if (this.#stopped) return;
    this.#shown = orderKey(order);
    this.#show({ state: "waiting" });
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    const asked = [...order];
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      void this.#ask(asked);
    }, this.#pause);
  }

  /** Ask again now for the order shown (after the keyboard changed) */
  refresh(order: number[]): void {
    if (this.#stopped) return;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#shown = orderKey(order);
    void this.#ask([...order]);
  }

  /** Nothing more is asked or shown (the dialog closed) */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
  }

  async #ask(order: number[]): Promise<void> {
    const at = ++this.#sent;
    const key = orderKey(order);
    let state: PreviewState<T>;
    try {
      state = { state: "ready", preview: await this.#fetch(order) };
    } catch (error) {
      state = { state: "failed", error };
    }
    if (!this.#usable(key, at)) return;
    this.#used = at;
    this.#show(state);
  }

  /** The stale-answer rule */
  #usable(key: string, at: number): boolean {
    return !this.#stopped && key === this.#shown && at > this.#used;
  }
}

// ---- around the dialog ----

/** Why the Arrange layers button does nothing, or null when it opens the dialog */
export function arrangeBlocked(layers: number, canEdit: boolean): string | null {
  if (layers < ARRANGE_MIN_LAYERS) {
    return "Layer 0 always stays first, so a keyboard needs 3 layers or more for anything to be arranged.";
  }
  if (!canEdit) return "The keyboard can't be changed just now.";
  return null;
}

/** What the question before the dialog says about the work not saved (lib/unsaved): arranging neither saves it nor
 * changes it, so a layer it names by number keeps that number */
export function unsavedQuestion(work: string[]): string {
  return `Not saved yet: ${andList(work)}. Arranging the layers doesn't save ${work.length === 1 ? "it" : "them"} ` +
    "and doesn't change " + (work.length === 1 ? "it" : "them") + ": a layer named there by its number keeps " +
    "that number, whichever layer is at it afterwards.";
}
