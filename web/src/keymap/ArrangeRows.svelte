<script lang="ts">
  import { tick } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { KeyboardModel } from "../api/types";
  import { canStep, dropPosition, moveTo, nameAfter } from "./arrange";

  interface Props {
    /** the layer (by its position now) at each position */
    order: number[];
    model: KeyboardModel;
    analysis: Analysis;
    phrases: PhraseContext;
    /** Apply, Finish or Put back is being written: nothing moves */
    busy: boolean;
    /** what the ids are made from */
    uid: string;
    /** the id of what describes the keys */
    keysId: string;
    /** another order chosen (a step, a drop): its preview is asked for */
    onorder: (next: number[]) => void;
    /** a row is dragged, or no longer */
    ondrag: (dragging: boolean) => void;
  }

  let { order, model, analysis, phrases, busy, uid, keysId, onorder, ondrag }: Props = $props();

  let list = $state<HTMLOListElement>();
  /** a row dragged by its handle, and the order shown while it moves (chosen once it is dropped) */
  let drag = $state<{ layer: number; pointerId: number; order: number[] } | null>(null);
  /** what the last move did, for a screen reader: "Nav moved to position 3." */
  let moved = $state("");

  const shown = $derived(drag?.order ?? order);

  const rowId = (layer: number) => `${uid}-row-${layer}`;
  const stepId = (layer: number, step: -1 | 1) => `${uid}-${step < 0 ? "up" : "down"}-${layer}`;

  /** The focus goes to a layer's handle */
  export function focusRow(layer: number): void {
    document.getElementById(rowId(layer))?.focus();
  }

  /** The focus goes to the first row that moves */
  export function focusFirst(): void {
    if (order.length > 1) focusRow(order[1]);
  }

  /** Esc during a drag: the row goes back, keeping the focus. Returns whether a row was dragged. */
  export function cancelDrag(): boolean {
    if (!drag) return false;
    void endDrag(drag.layer);
    return true;
  }

  /** The layer at a position moved to another (clamped to the positions that move); the focus stays on what had it
   * (keep: its id), in the row moved */
  async function moveLayer(position: number, to: number, keep: string) {
    if (busy || drag) return;
    const next = moveTo(order, position, to);
    if (next === order) return;
    const layer = order[position];
    onorder(next);
    announce(layer, next);
    await tick();
    document.getElementById(keep)?.focus();
  }

  function announce(layer: number, next: number[]) {
    const at = next.indexOf(layer);
    const own = model.layers[layer]?.customName ? model.layers[layer].name : null;
    moved = `${own ?? `The layer that was ${layer}`} moved to position ${at}.`;
  }

  /** On a handle: ↑ and ↓ go from handle to handle, Home and End to the first and the last; with Alt they move the
   * layer (also on its ↑ and ↓ buttons) */
  function rowKeys(event: KeyboardEvent, position: number) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const last = order.length - 1;
    const to = { ArrowUp: position - 1, ArrowDown: position + 1, Home: 1, End: last }[event.key];
    if (to === undefined) return;
    const target = event.target as HTMLElement;
    const onHandle = target.classList.contains("handle");
    if (event.altKey && (onHandle || event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      void moveLayer(position, to, target.id || rowId(order[position]));
    } else if (!event.altKey && onHandle) {
      event.preventDefault();
      if (to >= 1 && to <= last) focusRow(order[to]);
    }
  }

  // ---- dragging a row by its handle ----

  function grab(event: PointerEvent, layer: number) {
    if (event.button !== 0 || busy || drag) return;
    // the row moves among the others as the pointer goes: its events are followed on the window (a pointer captured
    // by the handle would lose it as the handle moves in the page)
    event.preventDefault();
    drag = { layer, pointerId: event.pointerId, order };
    ondrag(true);
  }

  function dragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId || !list) return;
    const dragged = drag.layer;
    const others = [...list.querySelectorAll<HTMLElement>("li[data-layer]")]
      .filter((row) => Number(row.dataset.layer) !== dragged)
      .map((row) => row.getBoundingClientRect());
    const from = drag.order.indexOf(dragged);
    const to = dropPosition(others, event.clientY);
    if (to !== from) drag = { ...drag, order: moveTo(drag.order, from, to) };
  }

  function drop(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { layer, order: next } = drag;
    if (next.join() !== order.join()) {
      onorder(next);
      announce(layer, next);
    }
    void endDrag(layer);
  }

  function dragCancel(event: PointerEvent) {
    if (drag && event.pointerId === drag.pointerId) void endDrag(drag.layer);
  }

  /** The drag is over: the row is where it was dropped, or back; its handle keeps the focus, once it is drawn */
  async function endDrag(layer: number) {
    drag = null;
    ondrag(false);
    await tick();
    focusRow(layer);
  }

  /** How a layer is reached, in one line: the Overview's labels */
  function reachOf(layer: number): string {
    const reach = analysis.reach[layer];
    if (!reach) return "";
    const warning = unreachedReason(reach);
    const ways = reach.ways.map((w) => wayLabel(w, phrases)).join("; ");
    return warning ? `${warning}${ways ? `: ${ways}` : ""}` : ways;
  }
</script>

<svelte:window onpointermove={dragMove} onpointerup={drop} onpointercancel={dragCancel} />

<ol class="rows" class:dragging={drag !== null} bind:this={list} aria-label="Layers, in their new order">
  <li class="row fixed">
    <span class="position">0</span>
    <svg class="lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
    <span class="text">
      <span class="line"><span class="name" title={nameAfter(model.layers[0], 0)}>{nameAfter(model.layers[0], 0)}</span></span>
      <span class="reach">always first: the keyboard starts on it</span>
    </span>
  </li>
  {#each shown.slice(1) as layer, i (layer)}
    {@const position = i + 1}
    <!-- the name it will have: a layer never named takes its new position's default name -->
    {@const name = nameAfter(model.layers[layer], position)}
    {@const reach = reachOf(layer)}
    <li class="row" class:dragged={drag?.layer === layer} class:moved={layer !== position} data-layer={layer}>
      <span class="position">{position}</span>
      <!-- the row's handle: dragged, or with the focus, Alt+↑ and Alt+↓ move the row; ↑ and ↓ go to the next -->
      <button
        type="button"
        id={rowId(layer)}
        class="handle"
        aria-label="{name}, position {position}{layer !== position ? `, was ${layer}` : ""}"
        aria-describedby={keysId}
        title="Drag to move {name}"
        onkeydown={(e) => rowKeys(e, position)}
        onpointerdown={(e) => grab(e, layer)}
      >
        <svg viewBox="0 0 10 16" aria-hidden="true">
          {#each [3, 8, 13] as y (y)}<circle cx="3" cy={y} r="1.3" /><circle cx="7" cy={y} r="1.3" />{/each}
        </svg>
      </button>
      <span class="text">
        <span class="line">
          <span class="name" title={name}>{name}</span>
          {#if layer !== position}<span class="was">← was {layer}</span>{/if}
        </span>
        <span class="reach" title={reach || undefined}>{reach || "nothing reaches it"}</span>
      </span>
      <span class="steps">
        <button type="button" id={stepId(layer, -1)} class="step" aria-label="Move {name} up"
          aria-disabled={!canStep(order, position, -1) || busy || undefined}
          onkeydown={(e) => rowKeys(e, position)}
          onclick={() => {
            if (canStep(order, position, -1)) void moveLayer(position, position - 1, stepId(layer, -1));
          }}>↑</button>
        <button type="button" id={stepId(layer, 1)} class="step" aria-label="Move {name} down"
          aria-disabled={!canStep(order, position, 1) || busy || undefined}
          onkeydown={(e) => rowKeys(e, position)}
          onclick={() => {
            if (canStep(order, position, 1)) void moveLayer(position, position + 1, stepId(layer, 1));
          }}>↓</button>
      </span>
    </li>
  {/each}
</ol>
<p class="visually-hidden" role="status">{moved}</p>

<style>
  .rows {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 2px;
    list-style: none;
  }

  /* while a row is dragged: the pointer says so wherever it is over the rows, and nothing gets selected */
  .rows.dragging,
  .rows.dragging :global(*) {
    cursor: grabbing;
    user-select: none;
    -webkit-user-select: none;
  }

  .row {
    display: grid;
    grid-template-columns: 26px 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 8px 7px 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .row.fixed {
    background: var(--surface-2);
  }

  .row.moved {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .row.dragged {
    border-color: var(--accent);
    background: var(--accent-weak);
    box-shadow: var(--shadow-lg);
  }

  .row:focus-within {
    border-color: var(--border-strong);
  }

  .position {
    display: inline-grid;
    place-items: center;
    height: 22px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tone-layer) 14%, transparent);
    color: var(--tone-layer);
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .lock {
    width: 15px;
    height: 15px;
    justify-self: center;
    fill: none;
    stroke: var(--text-3);
    stroke-width: 1.4;
  }

  /* 24 px wide at least: a target the pointer finds (WCAG 2.5.8) */
  .handle {
    display: grid;
    place-items: center;
    width: 24px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }

  .handle:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .handle svg {
    width: 10px;
    height: 16px;
    fill: currentColor;
  }

  .text {
    display: grid;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  /* a long name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .was {
    flex: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }

  .reach {
    overflow: hidden;
    color: var(--text-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .steps {
    display: flex;
    gap: 4px;
  }

  .step {
    width: 30px;
    height: 30px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    font-size: 14px;
    cursor: pointer;
  }

  .step:hover:not([aria-disabled="true"]) {
    background: var(--surface-2);
  }

  .step[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
  }
</style>
