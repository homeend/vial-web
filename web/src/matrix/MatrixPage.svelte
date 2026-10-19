<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { KeyGuard } from "../lib/keyGuard";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import MatrixGrid from "./MatrixGrid.svelte";
  import {
    layoutPositions, matrixCells, positionId, summaryText, testSummary, withPressed,
  } from "./matrix";
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
  let testing = $state(false);
  const keyGuard = new KeyGuard();
  let unwatch: (() => void) | null = null;

  function start() {
    if (testing) return;
    testing = true;
    unwatch = keyboard.watchMatrix();
    keyGuard.start();
    // the firmware shows the keys held only once it is unlocked: the unlock runs first
    if (keyboard.unlock.state.state !== "unlocked") void keyboard.unlock.start();
  }

  function stop() {
    testing = false;
    unwatch?.();
    unwatch = null;
    keyGuard.stop();
  }

  onDestroy(() => {
    unwatch?.();
    keyGuard.dispose();
  });

  const reading = $derived(testing ? keyboard.matrix : null);
  const locked = $derived(testing && (reading?.state === "locked" || keyboard.unlock.state.state !== "unlocked"));
  const held = $derived(new Set(reading?.state === "testing" ? reading.pressed.map(positionId) : []));
  // what is held is pressed: kept for the keyboard
  $effect(() => {
    if (reading?.state === "testing") {
      const pressed = reading.pressed;
      untrack(() => (kept.tested = withPressed(kept.tested, pressed)));
    }
  });

  const layout = $derived(layoutPositions(model));
  // plain keys: the kinds' colours would read as states of the test
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model))
    .map((face) => ({ ...face, tone: face.tone === "none" || face.tone === "transparent" ? face.tone : "normal" as const })));
  const ids = $derived(placement.items.map((item) => item.kind === "key" && item.geometry.row != null
    && item.geometry.col != null ? positionId({ row: item.geometry.row, col: item.geometry.col }) : null));
  const lit = $derived(ids.map((id) => id !== null && held.has(id)));
  const rings = $derived(ids.map((id) => (id !== null && kept.tested.has(id) && !held.has(id) ? "var(--ok)" : null)));
  const cells = $derived(matrixCells(model.rows, model.cols, layout, held, kept.tested));
  const summary = $derived(testSummary(layout, kept.tested));

  const status = $derived(!testing ? "Not testing."
    : reading === null ? "Starting…"
    : reading.state === "locked" ? "Waiting for the keyboard to be unlocked…"
    : reading.state === "disconnected" ? "The keyboard is unplugged."
    : reading.state === "unsupported" ? "This keyboard can't tell which keys are held."
    : held.size > 0 ? `Testing: ${held.size} held now.` : "Testing: press keys on the keyboard.");
</script>

<section class="page" aria-labelledby="matrix-title">
  <PageHeader
    id="matrix-title"
    title="Matrix tester"
    description="Press each key on the keyboard to check that it works: a key lights up while it is held, and keeps a green ring once it has been pressed."
    note="Vial firmware tells which keys are held only while the keyboard is unlocked, so the test unlocks it first. While it runs, keys pressed do nothing on this page: click Stop testing to use them again."
  >
    {#snippet action()}
      <!-- one button, so that the focus stays on it when the test starts or stops -->
      <Button variant="primary" disabled={!testing && !keyboard.canEdit}
        onclick={() => (testing ? stop() : start())}>{testing ? "Stop testing" : "Start testing"}</Button>
      <Button disabled={kept.tested.size === 0} onclick={() => kept.reset()}>Reset</Button>
    {/snippet}
  </PageHeader>

  <p class="status" class:active={testing} role="status">
    <span>{status}</span>
    <span>{summaryText(summary)}</span>
  </p>
  {#if locked}
    <p class="locked">
      The keyboard is locked: hold its unlock keys when asked.
      <Button size="sm" onclick={() => void keyboard.unlock.start()}>Unlock…</Button>
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
    gap: 10px;
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
