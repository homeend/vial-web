<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { ArrangePreview, KeyboardModel } from "../api/types";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import {
    canStep, currentOrder, isCurrent, moveStep, moveTo, nameAfter, PreviewFollower, stoppedText, summaryText,
    triLayerWarning, writingLabel, type PreviewState,
  } from "./arrange";

  interface Props {
    open: boolean;
    model: KeyboardModel;
    analysis: Analysis;
    phrases: PhraseContext;
    /** Apply: resolves to whether it was done (the dialog then closes); report says why not */
    onapply: (order: number[], report: (message: string) => void) => Promise<boolean>;
    onfinish: (report: (message: string) => void) => Promise<boolean>;
    onputback: (report: (message: string) => void) => Promise<boolean>;
    /** closed, applied or not: the caller gives the focus back */
    onclose: () => void;
  }

  let { open, model, analysis, phrases, onapply, onfinish, onputback, onclose }: Props = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let list = $state<HTMLOListElement>();
  /** the layer (by its position now) at each position */
  let order = $state<number[]>([]);
  let previewState = $state<PreviewState<ArrangePreview>>({ state: "waiting" });
  /** the last preview read, shown (faint) while the next one is asked for */
  let lastPreview = $state<ArrangePreview | null>(null);
  /** Apply, Finish or Put back is being written */
  let working = $state<"apply" | "finish" | "put-back" | null>(null);
  let workingLabel = $state("");
  /** why the last Apply, Finish or Put back wasn't done */
  let failure = $state<string | null>(null);
  /** a row dragged by its handle */
  let drag = $state<{ layer: number; pointerId: number; before: number[] } | null>(null);
  let follower: PreviewFollower<ArrangePreview> | null = null;

  const unfinished = $derived(keyboard.unfinishedArrange);
  const canEdit = $derived(keyboard.canEdit);
  const preview = $derived(previewState.state === "ready" ? previewState.preview : null);
  const shownPreview = $derived(preview ?? lastPreview);
  const canApply = $derived(
    working === null && drag === null && preview !== null && preview.moves.length > 0 &&
      preview.problems.length === 0 && canEdit && keyboard.pending === 0,
  );
  const hasEncoders = $derived(model.encoders.length > 0);

  // opened: the current order, its preview asked for at once; closed: nothing more is asked
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      untrack(() => start());
      dialog.showModal();
      void tick().then(() => focusFirst());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // the keyboard read again (an edit, another tab, a reload): the preview is asked for again; another number of
  // layers starts over
  $effect(() => {
    const layers = model.layers.length;
    void model;
    untrack(() => {
      if (!follower || working !== null) return;
      if (order.length !== layers) order = currentOrder(layers);
      follower.refresh(order);
    });
  });

  // an arrange that stopped while the focus was on a button that went: the focus goes to what it says
  $effect(() => {
    if (unfinished && dialog?.open) {
      untrack(() => {
        void tick().then(() => {
          const focused = document.activeElement;
          if (!focused || focused === document.body || !dialog?.contains(focused)) {
            document.getElementById(`${uid}-stopped`)?.focus();
          }
        });
      });
    }
  });

  function start() {
    follower?.stop();
    order = currentOrder(model.layers.length);
    previewState = { state: "waiting" };
    lastPreview = null;
    working = null;
    failure = null;
    drag = null;
    follower = new PreviewFollower(api.previewArrange, (state) => {
      previewState = state;
      if (state.state === "ready") lastPreview = state.preview;
    });
    follower.refresh(order);
  }

  function focusFirst() {
    if (unfinished) document.getElementById(`${uid}-stopped`)?.focus();
    else if (order.length > 1) document.getElementById(rowId(order[1]))?.focus();
  }

  const rowId = (layer: number) => `${uid}-row-${layer}`;
  const stepId = (layer: number, step: -1 | 1) => `${uid}-${step < 0 ? "up" : "down"}-${layer}`;

  /** A new order shown: its preview is asked for after the pause */
  function show(next: number[]) {
    if (next === order) return;
    order = next;
    failure = null;
    follower?.follow(next);
  }

  /** ↑ or ↓ (or Alt+↑, Alt+↓) on the row at a position; the focus stays on what had it, in the row moved */
  async function step(position: number, direction: -1 | 1, keep: string) {
    if (working !== null || drag !== null || !canStep(order, position, direction)) return;
    show(moveStep(order, position, direction));
    await tick();
    document.getElementById(keep)?.focus();
  }

  function rowKeys(event: KeyboardEvent, position: number) {
    const layer = order[position];
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (direction === 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.altKey) {
      event.preventDefault();
      const target = event.target as HTMLElement;
      void step(position, direction, target.id || rowId(layer));
    } else if ((event.target as HTMLElement).classList.contains("handle")) {
      // plain arrows go from handle to handle
      event.preventDefault();
      const next = order[position + direction];
      if (next !== undefined && position + direction >= 1) document.getElementById(rowId(next))?.focus();
    }
  }

  // ---- dragging a row by its handle ----

  function grab(event: PointerEvent, layer: number) {
    if (event.button !== 0 || working !== null || drag !== null) return;
    // the row moves among the others as the pointer goes: its events are followed on the window (a pointer captured
    // by the handle would lose it as the handle moves in the page)
    event.preventDefault();
    drag = { layer, pointerId: event.pointerId, before: order };
  }

  function dragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId || !list) return;
    const from = order.indexOf(drag.layer);
    // the position the pointer is at: after every other row whose middle it has passed
    let to = 1;
    for (const row of list.querySelectorAll<HTMLElement>("li[data-layer]")) {
      if (Number(row.dataset.layer) === drag.layer) continue;
      const box = row.getBoundingClientRect();
      if (event.clientY > box.top + box.height / 2) to++;
    }
    if (to !== from) order = moveTo(order, from, to);
  }

  function drop(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const layer = drag.layer;
    const before = drag.before;
    drag = null;
    const next = order;
    order = before;
    show(next);
    document.getElementById(rowId(layer))?.focus();
  }

  function dragCancel(event: PointerEvent) {
    if (drag && event.pointerId === drag.pointerId) {
      order = drag.before;
      drag = null;
    }
  }

  // ---- the buttons ----

  function reset() {
    if (working !== null) return;
    show(currentOrder(model.layers.length));
    if (order.length > 1) document.getElementById(rowId(order[1]))?.focus();
  }

  async function run(kind: "apply" | "finish" | "put-back", label: string, act: () => Promise<boolean>) {
    if (working !== null) return;
    working = kind;
    workingLabel = label;
    failure = null;
    let done = false;
    try {
      done = await act();
    } finally {
      working = null;
    }
    if (done) {
      dialog?.close();
    } else {
      follower?.refresh(order);
    }
  }

  function apply() {
    if (!canApply || !preview) return;
    const chosen = [...order];
    void run("apply", writingLabel(preview), () => onapply(chosen, (message) => (failure = message)));
  }

  function finish() {
    if (!canEdit) return;
    void run("finish", "Finishing…", () => onfinish((message) => (failure = message)));
  }

  function putBack() {
    if (!canEdit) return;
    void run("put-back", "Putting back…", () => onputback((message) => (failure = message)));
  }

  /** A layer's own name, or null when it was never named */
  function ownName(layer: number): string | null {
    const shown = model.layers[layer];
    return shown?.customName ? shown.name : null;
  }

  /** Scrolls a part of the summary into view (the summary scrolls when it is longer than its room) */
  function reveal(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
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

<dialog
  bind:this={dialog}
  class="arrange-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-about"
  oncancel={(event) => {
    // Esc waits for a write; during a drag it only puts the row back
    if (working !== null) event.preventDefault();
    else if (drag !== null) {
      event.preventDefault();
      order = drag.before;
      drag = null;
    }
  }}
  onclose={() => {
    follower?.stop();
    follower = null;
    onclose();
  }}
>
  <header class="head">
    <h2 id="{uid}-title">Arrange layers</h2>
    <p id="{uid}-about">
      {#if unfinished}
        The last arrange didn't finish.
      {:else}
        Keys that reach a layer follow it to its new position, and so does its name. Layer 0 stays first.
      {/if}
    </p>
    {#if !unfinished}
      <p id="{uid}-keys" class="keys">Drag a layer by its handle, or use ↑ and ↓. On a handle, Alt+↑ and Alt+↓ move
        the layer.</p>
    {/if}
  </header>

  {#if unfinished}
    <div class="body">
      <div class="stopped" id="{uid}-stopped" tabindex="-1" role="group" aria-labelledby="{uid}-stopped-text">
        <p id="{uid}-stopped-text">{stoppedText(unfinished)}</p>
        {#if !canEdit}
          <p class="note">The keyboard can't be changed just now: once it is back, Finish and Put back work.</p>
        {/if}
      </div>
      {#if failure}<p class="problem" role="alert">{failure}</p>{/if}
    </div>
    <footer class="foot">
      <p class="saving">Finish and Put back write to the keyboard at once.</p>
      <Button aria-disabled={working !== null || undefined} onclick={() => {
        if (working === null) dialog?.close();
      }}>Close</Button>
      <Button aria-disabled={working !== null || !canEdit || undefined} onclick={putBack}>
        {working === "put-back" ? workingLabel : "Put back"}
      </Button>
      <Button variant="primary" aria-disabled={working !== null || !canEdit || undefined} onclick={finish}>
        {working === "finish" ? workingLabel : "Finish"}
      </Button>
    </footer>
  {:else}
    <div class="body rows-body">
      <ol class="rows" bind:this={list} aria-label="Layers, in their new order">
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
        {#each order.slice(1) as layer, i (layer)}
          {@const position = i + 1}
          <!-- the name it will have: a layer never named takes its new position's default name -->
          {@const name = nameAfter(model.layers[layer], position)}
          {@const reach = reachOf(layer)}
          <li class="row" class:dragging={drag?.layer === layer} class:moved={layer !== position} data-layer={layer}>
            <span class="position">{position}</span>
            <!-- the row's handle: dragged, or with the focus, Alt+↑ and Alt+↓ move the row; ↑ and ↓ go to the next -->
            <button
              type="button"
              id={rowId(layer)}
              class="handle"
              aria-label="{name}, position {position}{layer !== position ? `, was ${layer}` : ""}"
              aria-describedby="{uid}-keys"
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
                aria-disabled={!canStep(order, position, -1) || working !== null || undefined}
                onkeydown={(e) => rowKeys(e, position)}
                onclick={() => void step(position, -1, stepId(layer, -1))}>↑</button>
              <button type="button" id={stepId(layer, 1)} class="step" aria-label="Move {name} down"
                aria-disabled={!canStep(order, position, 1) || working !== null || undefined}
                onkeydown={(e) => rowKeys(e, position)}
                onclick={() => void step(position, 1, stepId(layer, 1))}>↓</button>
            </span>
          </li>
        {/each}
      </ol>
    </div>

    <!-- by the footer, whatever the list's length: why Apply is off, or what it warns of, is always in view. Longer
         than its room, it scrolls, its first line (the flags) staying put. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that can scroll takes the focus, for the keys) -->
    <section class="summary" class:waiting={previewState.state === "waiting"} aria-label="What Apply changes"
      tabindex="0">
      <div aria-live="polite">
        {#if previewState.state === "failed"}
          <p class="problem">Couldn't check this order: {causeMessage(previewState.error)}</p>
        {:else if shownPreview}
          {@const p = shownPreview}
          {#if p.problems.length > 0 || p.triLayer}
            <p class="flags">
              {#if p.problems.length > 0}
                <button type="button" class="flag bad" onclick={() => reveal(`${uid}-problems`)}>
                  Can't apply: {p.problems.length === 1 ? "a layer number wouldn't fit" :
                    `${p.problems.length} layer numbers wouldn't fit`}
                </button>
              {/if}
              {#if p.triLayer}
                <button type="button" class="flag warn" onclick={() => reveal(`${uid}-warning`)}>
                  ⚠ Fn1 and Fn2 will reach other layers
                </button>
              {/if}
            </p>
          {/if}
          <p class="will">{previewState.state === "waiting" ? "Checking… " : ""}{summaryText(p, hasEncoders)}</p>
          {#if p.problems.length > 0}
            <div class="problem" id="{uid}-problems">
              <p>This order can't be written: a layer number wouldn't fit where it must go.</p>
              <ul>
                {#each p.problems as problem, n (n)}<li>{problem}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if p.triLayer}
            <p class="warning" id="{uid}-warning">{triLayerWarning(p.triLayer, ownName, model.vialProtocol >= 6)}</p>
          {/if}
          {#if p.needsUnlock && p.moves.length > 0 && keyboard.unlock.state.state !== "unlocked"}
            <p class="note">Apply asks for the keyboard to be unlocked first: it moves QK_BOOT or changes macros.</p>
          {/if}
        {:else}
          <p class="will">Checking what this order changes…</p>
        {/if}
      </div>
      {#if failure}<p class="problem" role="alert">{failure}</p>{/if}
    </section>

    <footer class="foot">
      <p class="saving">Nothing is written until you Apply.</p>
      <div class="buttons">
        <Button aria-disabled={working !== null || isCurrent(order) || undefined} onclick={reset}>Reset</Button>
        <Button aria-disabled={working !== null || undefined} onclick={() => {
          if (working === null) dialog?.close();
        }}>Cancel</Button>
        <Button variant="primary" class={!canApply && working === null ? "off" : undefined}
          aria-disabled={!canApply || undefined} onclick={apply}>
          {working === "apply" ? workingLabel : "Apply"}
        </Button>
      </div>
    </footer>
  {/if}
</dialog>

<style>
  /* fits the window, whatever the number of layers: the rows and the summary scroll inside it */
  .arrange-dialog {
    width: min(620px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100vh - 32px);
    max-height: calc(100dvh - 32px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .arrange-dialog[open] {
    display: flex;
    flex-direction: column;
  }

  .arrange-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .head {
    padding: 18px 20px 10px;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 17px;
  }

  .head p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .head .keys {
    margin-top: 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .body {
    display: grid;
    gap: 12px;
    min-height: 0;
    padding: 4px 20px 12px;
    overflow-y: auto;
  }

  .rows {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 2px;
    list-style: none;
  }

  .row {
    display: grid;
    grid-template-columns: 26px 18px minmax(0, 1fr) auto;
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

  .row.dragging {
    border-color: var(--accent);
    background: var(--accent-weak);
    box-shadow: var(--shadow-lg);
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

  .handle {
    display: grid;
    place-items: center;
    height: 30px;
    border-radius: 6px;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }

  .handle {
    width: 18px;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .handle:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .row:focus-within {
    border-color: var(--border-strong);
  }

  .row.dragging .handle {
    cursor: grabbing;
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

  /* the rows scroll; the summary below them keeps its place by the footer */
  .rows-body {
    flex: 1 1 auto;
    min-height: 120px;
  }

  .summary {
    display: grid;
    flex: 0 0 auto;
    gap: 8px;
    max-height: 40vh;
    max-height: 40dvh;
    padding: 10px 20px 12px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }

  .summary > div {
    display: grid;
    gap: 8px;
  }

  .summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* why Apply is off, or what it warns of, in one line that stays while the summary scrolls */
  .flags {
    position: sticky;
    top: -10px;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -10px -4px 0;
    padding: 10px 4px 4px;
    background: var(--surface);
  }

  .flag {
    padding: 3px 9px;
    border: 1px solid;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .flag.bad {
    border-color: var(--danger-line);
    background: var(--danger-weak);
    color: var(--danger);
  }

  .flag.warn {
    border-color: color-mix(in srgb, var(--warning-text) 30%, var(--border));
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .summary p,
  .stopped p {
    margin: 0;
  }

  .summary.waiting .will {
    color: var(--text-3);
  }

  .warning {
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .problem {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
  }

  .problem p {
    margin: 0;
  }

  .problem ul {
    margin: 4px 0 0;
    padding-left: 18px;
    overflow-wrap: anywhere;
  }

  .note {
    color: var(--text-2);
  }

  .stopped {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .stopped:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px 12px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
  }

  .saving {
    flex: 1 1 auto;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  /* Apply that can't be used: it keeps the focus (aria-disabled), and looks off */
  .foot :global(.off) {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
