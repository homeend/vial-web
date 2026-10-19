<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, type Names } from "../keyboard/labels";
  import { actionAt } from "../keyboard/refs";
  import { unlockProgress, type Unlocker } from "../lib/unlock.svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    unlocker: Unlocker;
    /** the keyboard, to show the keys to hold on it; null while it can't be read yet (an unlock started earlier) */
    model: KeyboardModel | null;
    placement: Placement | null;
    names: Names | null;
  }

  let { unlocker, model, placement, names }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (unlocker.open && !dialog.open) {
      dialog.showModal();
      // its only control: the focus is on it, as nothing else is to be done there
      dialog.querySelector<HTMLButtonElement>(".buttons button")?.focus();
    } else if (!unlocker.open && dialog.open) {
      dialog.close();
    }
  });

  // The unlock keys are held on the keyboard in use, which types them into this page: while it waits, key presses do
  // nothing here (as in Qt's unlocker). Held Enter or Space would otherwise press Cancel, held Tab move the focus.
  $effect(() => {
    if (!unlocker.open) return;
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const kinds = ["keydown", "keypress", "keyup"] as const;
    for (const kind of kinds) window.addEventListener(kind, swallow, true);
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, swallow, true);
    };
  });

  const unlock = $derived(unlocker.state);
  const keys = $derived(unlock.keys);
  const progress = $derived(unlockProgress(unlock));
  const percent = $derived(Math.round(progress * 100));
  const held = $derived(unlock.total > 0 && unlock.remaining < unlock.total);

  // the keyboard as it is on the base layer: the keys to hold ringed, the others faint
  const drawing = $derived.by(() => {
    if (!model || !placement || !names) return null;
    const unlockKey = placement.items.map((item) => item.kind === "key" &&
      keys.some((k) => k.row === item.geometry.row && k.col === item.geometry.col));
    return {
      faces: placement.items.map((item) => {
        const d = actionAt(model, 0, item);
        return d ? keyFace(d, names) : EMPTY_FACE;
      }),
      highlights: unlockKey,
      faded: unlockKey.map((u) => !u),
      labels: placement.items.map(() => ""),
    };
  });

  const where = $derived(keys.map((k) => `row ${k.row}, column ${k.col}`).join(" and "));
</script>

<dialog
  bind:this={dialog}
  class="unlock"
  aria-labelledby="unlock-title"
  aria-describedby="unlock-help"
  oncancel={(event) => {
    // never closed by a key: Escape may be one of the unlock keys
    event.preventDefault();
  }}
>
  <!-- drawn only while open: its keyboard isn't one of the page's -->
  {#if unlocker.open}
  <div class="panel">
    <h2 id="unlock-title">Unlock the keyboard</h2>
    <p id="unlock-help">
      Vial firmware changes macros and the bootloader key only while the keyboard is unlocked. Unlock it only on a
      computer you trust.
    </p>

    <p class="instruction">
      {#if keys.length === 0}
        Waiting for the keyboard…
      {:else}
        Press and hold {keys.length === 1 ? "the highlighted key" : `the ${keys.length} highlighted keys`} until the
        bar fills.
      {/if}
    </p>

    {#if drawing && placement}
      <div class="drawing">
        <Keyboard
          {placement}
          faces={drawing.faces}
          labels={drawing.labels}
          highlights={drawing.highlights}
          faded={drawing.faded}
          selected={-1}
          onselect={() => undefined}
          interactive={false}
          compact
          maxUnit={44}
        />
      </div>
    {/if}
    {#if keys.length > 0}
      <p class="where">The keys at {where} of the keyboard's matrix.</p>
    {/if}

    <div
      class="bar"
      role="progressbar"
      aria-label="Unlocking"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={held ? `${percent} %, keep holding` : "not held yet"}
    >
      <span style="width: {percent}%"></span>
    </div>
    <p class="status" aria-live="polite">{held ? `Keep holding… ${percent} %` : "Not held yet"}</p>

    <p class="note">
      Keys pressed do nothing here meanwhile. To lock it again later, click “Unlocked” in the top bar, or unplug the
      keyboard.
    </p>
    <div class="buttons">
      <!-- never disabled: it has the focus -->
      <Button onclick={() => void unlocker.cancel()}>Cancel</Button>
    </div>
  </div>
  {/if}
</dialog>

<style>
  .unlock {
    width: min(720px, calc(100vw - 32px));
    max-width: none;
    max-height: calc(100vh - 32px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .unlock::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .panel {
    display: grid;
    gap: 12px;
    padding: 20px 22px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  #unlock-help,
  .note,
  .where {
    color: var(--text-2);
    font-size: 13px;
  }

  .instruction {
    font-weight: 600;
  }

  .drawing {
    padding: 14px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
  }

  .bar {
    height: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.18s linear;
  }

  .status {
    color: var(--text-2);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
  }
</style>
