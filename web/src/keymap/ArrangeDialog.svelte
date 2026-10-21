<script lang="ts">
  // The Arrange layers dialog: the rows in their new order (ArrangeRows), what Apply would change (ArrangeSummary),
  // and Apply; or, while an arrange is unfinished, what stopped and Finish or Put back.
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import type { PhraseContext } from "../analysis/phrases";
  import { api } from "../api/api";
  import type { ArrangePreview, KeyboardModel } from "../api/types";
  import { keyboard, type ArrangeStop, type Report } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import { currentOrder, isCurrent, PreviewFollower, stoppedText, writingLabel, type PreviewState } from "./arrange";
  import ArrangeRows from "./ArrangeRows.svelte";
  import ArrangeSummary from "./ArrangeSummary.svelte";
  import { isLayoutChanged } from "./arranging.svelte";

  interface Props {
    open: boolean;
    model: KeyboardModel;
    analysis: Analysis;
    phrases: PhraseContext;
    /** Apply, the order chosen for layout version `expect` (its preview's): resolves to whether it was done (the dialog
     * then closes); report says why not */
    onapply: (order: number[], expect: number, report: Report) => Promise<boolean>;
    onfinish: (report: Report) => Promise<boolean>;
    onputback: (report: Report) => Promise<boolean>;
    /** closed, applied or not: the caller gives the focus back */
    onclose: () => void;
  }

  let { open, model, analysis, phrases, onapply, onfinish, onputback, onclose }: Props = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let rows = $state<ReturnType<typeof ArrangeRows>>();
  /** the layer (by its position now) at each position */
  let order = $state<number[]>([]);
  let previewState = $state<PreviewState<ArrangePreview>>({ state: "waiting" });
  /** the last preview read, shown (faint) while the next one is asked for */
  let lastPreview = $state<ArrangePreview | null>(null);
  /** Apply, Finish or Put back is being written */
  let working = $state<"apply" | "finish" | "put-back" | null>(null);
  let workingLabel = $state("");
  /** the model the rows showed when Apply was asked for: kept while it writes, as the keyboard's reply (the order
   * applied) replaces the model before the dialog closes */
  let writingModel = $state.raw<KeyboardModel | null>(null);
  /** why the last Apply, Finish or Put back wasn't done */
  let failure = $state<string | null>(null);
  /** the stop that Apply, Finish or Put back made (keyboard.arrangeStop), if it may have stopped partway: while the
   * stop shown is that one, its text says why (the failure isn't said twice) */
  let failureStop = $state.raw<ArrangeStop | null>(null);
  /** the layers changed while the dialog was open (another tab arranged them, or loaded a layout file): applied, Apply
   * was refused for it; reset, the order shown went back to the current one */
  let changed = $state<{ applied: boolean; reset: boolean } | null>(null);
  /** the layout version the dialog last took in: another one means the layers changed */
  let seenVersion: number | null = null;
  /** whether an arrange was unfinished, as the dialog last saw */
  let wasStopped = false;
  /** a row is being dragged by its handle */
  let dragging = $state(false);
  let follower: PreviewFollower<ArrangePreview> | null = null;

  const unfinished = $derived(keyboard.unfinishedArrange);
  const canEdit = $derived(keyboard.canEdit);
  const shownModel = $derived(writingModel ?? model);
  const preview = $derived(previewState.state === "ready" ? previewState.preview : null);
  const canApply = $derived(
    working === null && !dragging && preview !== null && preview.moves.length > 0 &&
      preview.problems.length === 0 && canEdit && keyboard.pending === 0,
  );
  const stoppedNow = $derived(unfinished
    ? stoppedText(unfinished, keyboard.unfinishedBy, keyboard.unfinishedStop?.cause) : "");
  /** the failure, unless the stop shown says it */
  const failureShown = $derived(failureStop !== null && keyboard.unfinishedStop === failureStop ? null : failure);

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

  // the page goes (another keyboard is shown) with the dialog open: nothing more is asked
  $effect(() => () => {
    follower?.stop();
    follower = null;
  });

  // the keyboard read again (an edit, another tab, a reload), or its layers changed (another tab arranged them, or
  // loaded a layout file): the preview is asked for again; another number of layers starts over. The order chosen
  // was for the layers as they were: the dialog says so.
  $effect(() => {
    const layers = model.layers.length;
    const version = keyboard.layoutVersion;
    void model;
    untrack(() => {
      if (!follower || working !== null) return;
      const moved = version !== seenVersion;
      seenVersion = version;
      const reset = order.length !== layers;
      if (moved && !unfinished && !isCurrent(order)) {
        changed = { applied: changed?.applied ?? false, reset: reset || (changed?.reset ?? false) };
      }
      if (reset) order = currentOrder(layers);
      follower.refresh(order);
    });
  });

  // an arrange stopped while the focus was on a button that went: the focus goes to what it says. One finished or
  // put back elsewhere (another tab) while the dialog said so: the rows come back, of the layers as they are now,
  // and the focus goes to them if it was on what went.
  $effect(() => {
    const stopped = unfinished !== null;
    untrack(() => {
      const ended = wasStopped && !stopped && working === null;
      wasStopped = stopped;
      if (!dialog?.open || (!stopped && !ended)) return;
      if (ended) {
        order = currentOrder(model.layers.length);
        failure = null;
        failureStop = null;
        changed = null;
        seenVersion = keyboard.layoutVersion;
        follower?.refresh(order);
      }
      void tick().then(() => {
        const focused = document.activeElement;
        if (focused && focused !== document.body && dialog?.contains(focused)) return;
        focusFirst();
      });
    });
  });

  function start() {
    follower?.stop();
    order = currentOrder(model.layers.length);
    previewState = { state: "waiting" };
    lastPreview = null;
    working = null;
    writingModel = null;
    failure = null;
    failureStop = null;
    changed = null;
    seenVersion = keyboard.layoutVersion;
    wasStopped = unfinished !== null;
    dragging = false;
    follower = new PreviewFollower(api.previewArrange, (state) => {
      previewState = state;
      if (state.state === "ready") lastPreview = state.preview;
    });
    follower.refresh(order);
  }

  function focusFirst() {
    if (unfinished) document.getElementById(`${uid}-stopped`)?.focus();
    else rows?.focusFirst();
  }

  /** Another order shown: its preview is asked for after the pause */
  function show(next: number[]) {
    order = next;
    failure = null;
    follower?.follow(next);
  }

  // ---- the buttons ----

  async function reset() {
    if (working !== null || dragging || isCurrent(order)) return;
    show(currentOrder(model.layers.length));
    // once the rows are drawn in that order
    await tick();
    rows?.focusFirst();
  }

  /** Apply, Finish or Put back. Why it wasn't done is said once: by the stop, when it stopped partway (the stopped
   * text says how far it got, and why); as the layers having changed, when it was refused for that; else on its
   * own. */
  async function run(kind: "apply" | "finish" | "put-back", label: string, act: (report: Report) => Promise<boolean>) {
    if (working !== null) return;
    working = kind;
    workingLabel = label;
    writingModel = model;
    failure = null;
    failureStop = null;
    changed = null;
    const stopBefore = keyboard.arrangeStop;
    let done = false;
    try {
      done = await act((message, error) => {
        // nothing written: the preview is asked for again, of the layers as they are now (the version they
        // changed to is taken in then)
        if (isLayoutChanged(error)) changed = { applied: true, reset: false };
        else failure = message;
      });
    } finally {
      working = null;
    }
    // what this wrote moved the layout version on: not a change made elsewhere
    if (!changed) seenVersion = keyboard.layoutVersion;
    if (keyboard.arrangeStop !== stopBefore) failureStop = keyboard.arrangeStop;
    if (done) {
      dialog?.close();
    } else {
      writingModel = null;
      follower?.refresh(order);
    }
  }

  function apply() {
    if (!canApply || !preview) return;
    const chosen = [...order];
    const expect = preview.layoutVersion;
    void run("apply", writingLabel(preview, model.encoders.length > 0), (report) => onapply(chosen, expect, report));
  }

  function finish() {
    if (!canEdit) return;
    void run("finish", "Finishing…", onfinish);
  }

  function putBack() {
    if (!canEdit) return;
    void run("put-back", "Putting back…", onputback);
  }

  /** Esc waits for a write (pressed twice, the browser would close the dialog all the same: the key is stopped
   * here); during a drag it only puts the row back */
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (working !== null || rows?.cancelDrag()) event.preventDefault();
  }
</script>

<dialog
  bind:this={dialog}
  class="arrange-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-about"
  onkeydown={escape}
  oncancel={(event) => {
    // a close asked for some other way (a gesture) waits too
    if (working !== null || dragging) event.preventDefault();
    rows?.cancelDrag();
  }}
  onclose={() => {
    follower?.stop();
    follower = null;
    writingModel = null;
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
        the layer; Alt+Home and Alt+End, to position 1 or the end.</p>
    {/if}
  </header>

  {#if unfinished}
    <div class="body">
      <div class="stopped" id="{uid}-stopped" tabindex="-1" role="group" aria-labelledby="{uid}-stopped-text">
        <p id="{uid}-stopped-text">{stoppedNow}</p>
        {#if !canEdit}
          <p class="note">The keyboard can't be changed just now: once it is back, Finish and Put back work.</p>
        {/if}
      </div>
      {#if failureShown}<p class="problem" role="alert">{failureShown}</p>{/if}
    </div>
    <footer class="foot">
      <p class="saving">Finish and Put back write to the keyboard at once.</p>
      <div class="buttons">
        <Button aria-disabled={working !== null || undefined} onclick={() => {
          if (working === null) dialog?.close();
        }}>Close</Button>
        <Button class={!canEdit && working === null ? "off" : undefined}
          aria-disabled={working !== null || !canEdit || undefined} onclick={putBack}>
          {working === "put-back" ? workingLabel : "Put back"}
        </Button>
        <Button variant="primary" class={!canEdit && working === null ? "off" : undefined}
          aria-disabled={working !== null || !canEdit || undefined} onclick={finish}>
          {working === "finish" ? workingLabel : "Finish"}
        </Button>
      </div>
    </footer>
  {:else}
    <div class="body rows-body">
      <ArrangeRows
        bind:this={rows}
        {order}
        model={shownModel}
        {analysis}
        {phrases}
        busy={working !== null}
        {uid}
        keysId="{uid}-keys"
        onorder={show}
        ondrag={(on) => (dragging = on)}
      />
    </div>

    <ArrangeSummary
      {previewState}
      {lastPreview}
      model={shownModel}
      {uid}
      {canEdit}
      {changed}
      failure={failureShown}
    />

    <footer class="foot">
      <p class="saving">Nothing is written until you Apply.</p>
      <div class="buttons">
        <Button class={isCurrent(order) && working === null ? "off" : undefined}
          aria-disabled={working !== null || isCurrent(order) || undefined} onclick={() => void reset()}>Reset</Button>
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

  /* the rows scroll; the summary below them keeps its place by the footer */
  .rows-body {
    flex: 1 1 auto;
    min-height: 120px;
  }

  .stopped p {
    margin: 0;
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

  /* a button that can't be used just now: it keeps the focus (aria-disabled), and looks off, with neither the
     progress cursor of a button waiting for a write nor a hover (outranking the Button's own rules) */
  .foot :global(.btn.off[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .foot :global(.btn.off[aria-disabled="true"]:hover) {
    background: var(--surface);
  }

  .foot :global(.btn.primary.off[aria-disabled="true"]:hover) {
    background: var(--accent);
  }
</style>
