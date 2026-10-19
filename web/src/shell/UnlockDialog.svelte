<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, type Names } from "../keyboard/labels";
  import { onDestroy } from "svelte";
  import { andList } from "../analysis/phrases";
  import { actionAt } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
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
    if (unlocker.open && !dialog.open) show(dialog);
    else if (!unlocker.open && dialog.open) dialog.close();
  });

  function show(d: HTMLDialogElement) {
    d.showModal();
    guard();
    // its only control: the focus is on it, as nothing else is to be done there
    d.querySelector<HTMLButtonElement>(".buttons button")?.focus();
  }

  function onclose() {
    if (!dialog || dialog.open) return; // shown again meanwhile
    // closed by the browser (not by the unlocker): it shows as long as the keyboard waits
    if (unlocker.open) show(dialog);
    else release();
  }

  // The unlock keys are held on the keyboard in use, which types them into this page: while it waits, key presses do
  // nothing here (as in Qt's unlocker). Held Enter or Space would otherwise press Cancel, held Tab move the focus. They
  // are still held when it closes, and repeat or are let go on whatever has the focus then (Enter on the top bar's
  // Lock, Tab then Backspace on a key): the keys pressed while it showed do nothing until they are let go.
  const KINDS = ["keydown", "keypress", "keyup"] as const;
  /** the keys pressed while the dialog showed and not let go since (event.code) */
  const pressed = new Set<string>();
  /** the listeners are on */
  let guarding = false;
  /** the dialog shows: every key does nothing */
  let showing = false;

  function swallow(event: KeyboardEvent) {
    const code = event.code || event.key;
    // once it closed, only the keys still held from it
    if (!showing && !pressed.has(code)) return;
    if (event.type === "keydown" && showing) pressed.add(code);
    else if (event.type === "keyup") pressed.delete(code);
    event.preventDefault();
    // nothing else sees them, not even listeners on the window added after these ones. The macro recorder's, added
    // before them when a recording started first, leaves the keys alone while the dialog shows (it stops recording).
    event.stopImmediatePropagation();
    if (!showing && pressed.size === 0) unguard();
  }

  /** The page lost the keyboard: a key let go meanwhile isn't told, and keys pressed afterwards work again */
  function forget() {
    pressed.clear();
    if (!showing) unguard();
  }

  function guard() {
    showing = true;
    if (guarding) return;
    guarding = true;
    for (const kind of KINDS) window.addEventListener(kind, swallow, true);
    window.addEventListener("blur", forget);
    document.addEventListener("visibilitychange", forget);
  }

  /** The dialog closed: the keys still held from it go on doing nothing until they are let go */
  function release() {
    showing = false;
    if (pressed.size === 0) unguard();
  }

  function unguard() {
    showing = false;
    pressed.clear();
    if (!guarding) return;
    guarding = false;
    for (const kind of KINDS) window.removeEventListener(kind, swallow, true);
    window.removeEventListener("blur", forget);
    document.removeEventListener("visibilitychange", forget);
  }

  onDestroy(unguard);

  const unlock = $derived(unlocker.state);
  const keys = $derived(unlock.keys);
  const progress = $derived(unlockProgress(unlock));
  const percent = $derived(Math.round(progress * 100));
  const held = $derived(unlock.total > 0 && unlock.remaining < unlock.total);
  /** announced when it changes: the percentage is the progress bar's */
  const phase = $derived(unlock.state === "unlocked" ? "Unlocked" : held ? "Keep holding…" : "Not held yet");
  /** what went wrong, said here as the toasts are behind the dialog */
  const problem = $derived(unlocker.problem ??
    (keyboard.link === "open" ? null
      : "The connection to Vial was lost: the bar can't follow the keyboard until it is back (it reconnects by itself)."));

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

  const where = $derived(`The ${keys.length === 1 ? "key" : "keys"} at ` +
    `${andList(keys.map((k) => `row ${k.row}, column ${k.col}`))} of the keyboard's matrix.`);
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
  {onclose}
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
        The keyboard names no unlock keys, so none can be shown to hold.
      {:else}
        Press and hold {keys.length === 1 ? "the highlighted key" : `the ${keys.length} highlighted keys`} until the
        bar fills.
      {/if}
    </p>

    {#if drawing && placement && keys.length > 0}
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
      <p class="where">{where}</p>
    {:else}
      <p class="where">
        If the bar doesn't fill by itself, cancel, then unplug the keyboard and plug it back in: until then it takes no
        changes.
      </p>
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
    <p class="status">
      <span aria-live="polite">{phase}</span>{#if held}<span aria-hidden="true"> {percent} %</span>{/if}
    </p>
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {/if}

    <p class="note">
      Keys pressed do nothing here meanwhile. To lock it again later, click “Unlocked” in the top bar, or unplug the
      keyboard.
    </p>
    <!-- pointer only: a key pressed here does nothing, the unlock keys may be any -->
    <div class="buttons">
      <!-- never disabled: it has the focus -->
      <Button onclick={() => void unlocker.cancel()}>Cancel</Button>
      {#if problem}
        <!-- not trapped meanwhile; the keyboard may still wait for its keys -->
        <Button onclick={() => unlocker.dismiss()}>Close</Button>
      {/if}
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

  .problem {
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-left: 4px solid var(--danger);
    border-radius: 10px;
    background: var(--danger-weak);
    font-size: 13px;
  }

  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
