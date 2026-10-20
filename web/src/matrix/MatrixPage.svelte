<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import MatrixGrid from "./MatrixGrid.svelte";
  import {
    drawnPositions, layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed,
  } from "./matrix";
  import { MatrixRun } from "./run.svelte";
  import { matrixTest as kept } from "./state.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  // what was pressed so far is kept while another page shows, for this keyboard
  untrack(() => kept.follow(model.uid));
  $effect.pre(() => kept.follow(model.uid));

  /** the test runs: the keys held are read, and keys pressed do nothing on the page */
  const run = new MatrixRun(() => keyboard.watchMatrix());
  const testing = $derived(run.testing);

  function toggle() {
    if (run.testing) {
      run.stop();
      return;
    }
    if (!keyboard.canEdit) return;
    run.start(model.uid);
    // the firmware shows the keys held only once it is unlocked: the unlock runs first
    if (keyboard.unlock.state.state !== "unlocked") void keyboard.unlock.start();
  }

  // keys still held when the page goes do nothing until they are let go
  onDestroy(run.stop);

  // the keyboard tested is gone (unplugged, in its bootloader, another one in its place): so is the test
  $effect(() => {
    if (run.ends(keyboard, model.uid)) untrack(() => run.stop());
  });

  const reading = $derived(run.reads(keyboard.stale, model.uid) ? keyboard.matrix : null);
  const locked = $derived(reading?.state === "locked");
  const held = $derived(new Set(reading?.state === "testing" ? reading.pressed.map(positionId) : []));
  // what is held is pressed: kept for the keyboard
  $effect(() => {
    if (reading?.state === "testing") {
      const pressed = reading.pressed;
      untrack(() => (kept.tested = withPressed(kept.tested, pressed)));
    }
  });

  const layout = $derived(layoutPositions(model));
  const drawn = $derived(drawnPositions(placement));
  // plain keys: the kinds' colours would read as states of the test
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model))
    .map((face) => ({ ...face, tone: face.tone === "none" || face.tone === "transparent" ? face.tone : "normal" as const })));
  const ids = $derived(placement.items.map((item) => item.kind === "key" && item.geometry.row != null
    && item.geometry.col != null ? positionId({ row: item.geometry.row, col: item.geometry.col }) : null));
  const lit = $derived(ids.map((id) => id !== null && held.has(id)));
  const rings = $derived(ids.map((id) => (id !== null && kept.tested.has(id) && !held.has(id) ? "var(--ok)" : null)));
  const cells = $derived(matrixCells(model.rows, model.cols, layout, held, kept.tested));
  const summary = $derived(testSummary(drawn, layout, kept.tested));

  // the live region says only how the test goes and how far, not every key pressed and let go
  const status = $derived(!testing ? "Not testing."
    : reading === null ? "Starting…"
    : reading.state === "locked" ? "Waiting for the keyboard to be unlocked…"
    : reading.state === "disconnected" ? "The keyboard is unplugged."
    : reading.state === "unsupported" ? "This keyboard can't tell which keys are held."
    : "Testing: press keys on the keyboard.");
  /** what is shown instead while keys are held, without telling a screen reader (it hears the status above) */
  const heldNow = $derived(reading?.state === "testing" && held.size > 0 ? `Testing: ${held.size} held now.` : null);
  /** nothing to start (the keyboard can't be used now) or to reset: looks disabled, but keeps the focus */
  const startIdle = $derived(!testing && !keyboard.canEdit);
  const resetIdle = $derived(kept.tested.size === 0);
</script>

<section class="page" aria-labelledby="matrix-title">
  <PageHeader
    id="matrix-title"
    title="Matrix tester"
    description="Press each key on the keyboard to check that it works: a key lights up while it is held, and keeps a green ring once it has been pressed."
    note="Vial firmware tells which keys are held only while the keyboard is unlocked, so the test unlocks it first. While it runs, keys pressed do nothing on this page. Click Stop testing or switch to another window (Alt+Tab, ⌘Tab, the Windows key) to stop it; Start testing goes on from there."
  >
    {#snippet action()}
      <!-- one button, so that the focus stays on it when the test starts or stops; neither is ever disabled, which
           would drop the focus -->
      <Button class={startIdle ? "idle" : undefined} variant="primary" aria-disabled={startIdle || undefined}
        onclick={toggle}>{testing ? "Stop testing" : "Start testing"}</Button>
      <Button class={resetIdle ? "idle" : undefined} aria-disabled={resetIdle || undefined}
        onclick={() => {
          if (!resetIdle) kept.reset();
        }}>Reset</Button>
    {/snippet}
  </PageHeader>

  <p class="status" class:active={testing} role="status">
    <span>
      <span class:visually-hidden={heldNow !== null}>{status}</span>
      {#if heldNow !== null}<span aria-hidden="true">{heldNow}</span>{/if}
    </span>
    <span>{summaryText(summary)}</span>
  </p>
  {#if locked}
    <p class="locked">
      The keyboard is locked: hold its unlock keys when asked.
      <!-- after a cancelled unlock the app's banner offers Unlock -->
      {#if keyboard.unlock.state.state !== "cancelled"}
        <Button size="sm" onclick={() => void keyboard.unlock.start()}>Unlock…</Button>
      {/if}
    </p>
  {/if}

  <div class="board" class:testing>
    <Keyboard {placement} {faces} labels={[]} pressed={lit} {rings} selected={-1} onselect={() => undefined}
      interactive={false} maxUnit={64} />
    <p class="legend" aria-hidden="true">
      <span><span class="swatch held"></span> held now</span>
      <span><span class="swatch ring"></span> pressed before</span>
    </p>
  </div>

  <section class="card" aria-labelledby="matrix-grid-title">
    <h2 id="matrix-grid-title">Switch matrix</h2>
    <p class="about">
      Every row and column the firmware reads, {model.rows} × {model.cols}. A position with no key in the layout that
      lights up has a key the layout doesn't show, or a fault in the wiring.
    </p>
    <MatrixGrid {cells} />
    {#if summary.strays.length > 0}
      <p class="strays">
        Pressed without a key in the layout: {summary.strays.map((p) => `row ${p.row}, column ${p.col}`).join("; ")}.
      </p>
    {/if}
  </section>
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px;
  }

  /* with nothing to start or reset they look disabled, but keep the focus */
  .page :global(.btn.idle[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }

  .status.active {
    border-color: var(--accent);
    color: var(--text);
  }

  .locked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 16px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  /* the thing being tested keeps a visible border */
  .board.testing {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }

  .swatch.held {
    background: var(--accent);
  }

  .swatch.ring {
    border: 2px solid var(--ok);
    background: var(--key-bg);
  }

  .card {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .about,
  .strays {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .strays {
    color: var(--text);
  }
</style>
