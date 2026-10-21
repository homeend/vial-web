<script lang="ts">
  import { causeMessage } from "../api/errors";
  import type { ArrangePreview, KeyboardModel } from "../api/types";
  import { keyboard } from "../lib/keyboard.svelte";
  import { layersChangedText, savedDefaultWarning, summaryText, triLayerWarning, type PreviewState } from "./arrange";

  interface Props {
    /** what the preview follower says about the order shown */
    previewState: PreviewState<ArrangePreview>;
    /** the last preview read: shown (faint) while the next one is asked for */
    lastPreview: ArrangePreview | null;
    model: KeyboardModel;
    uid: string;
    /** the keyboard can be changed: else Apply waits, and this says so */
    canEdit: boolean;
    /** the layers changed while the dialog was open (see layersChangedText) */
    changed: { applied: boolean; reset: boolean } | null;
    /** why the last Apply wasn't done */
    failure: string | null;
  }

  let { previewState, lastPreview, model, uid, canEdit, changed, failure }: Props = $props();

  const shownPreview = $derived(previewState.state === "ready" ? previewState.preview : lastPreview);
  const hasEncoders = $derived(model.encoders.length > 0);
  const triText = $derived(shownPreview?.triLayer
    ? triLayerWarning(shownPreview.triLayer, ownName, model.vialProtocol >= 6) : null);
  const pdfText = $derived(shownPreview ? savedDefaultWarning(shownPreview.savedDefault, ownName) : null);
  /** what a screen reader is told: the summary sentence of each preview read, not "Checking…" in between */
  const announced = $derived(lastPreview ? summaryText(lastPreview, hasEncoders) : "");

  /** A layer's own name, or null when it was never named */
  function ownName(layer: number): string | null {
    const shown = model.layers[layer];
    return shown?.customName ? shown.name : null;
  }

  /** Scrolls a part of the summary into view (the summary scrolls when it is longer than its room) */
  function reveal(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }
</script>

<!-- by the footer, whatever the list's length: why Apply is off, or what it warns of, is always in view. Longer than
     its room, it scrolls, its first line (the flags) staying put. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that can scroll takes the focus, for the keys) -->
<section class="summary" class:waiting={previewState.state === "waiting"} aria-label="What Apply changes" tabindex="0">
  <p class="visually-hidden" aria-live="polite">{announced}</p>
  {#if previewState.state === "failed"}
    <p class="problem" role="alert">Couldn't check this order: {causeMessage(previewState.error)}</p>
  {:else if shownPreview}
    {@const p = shownPreview}
    {#if p.problems.length > 0 || triText || pdfText}
      <p class="flags">
        {#if p.problems.length > 0}
          <button type="button" class="flag bad" onclick={() => reveal(`${uid}-problems`)}>
            Can't apply: {p.problems.length === 1 ? "a layer number wouldn't fit" :
              `${p.problems.length} layer numbers wouldn't fit`}
          </button>
        {/if}
        {#if triText}
          <button type="button" class="flag warn" onclick={() => reveal(`${uid}-warning`)}>
            ⚠ Fn1 and Fn2 will reach other layers
          </button>
        {/if}
        {#if pdfText}
          <button type="button" class="flag warn" onclick={() => reveal(`${uid}-start-up`)}>
            ⚠ A saved start-up layer keeps its number
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
    {#if triText}
      <p class="warning" id="{uid}-warning">{triText}</p>
    {/if}
    {#if pdfText}
      <p class="warning start-up" id="{uid}-start-up">{pdfText}</p>
    {/if}
    {#if p.needsUnlock && p.moves.length > 0 && keyboard.unlock.state.state !== "unlocked"}
      <p class="note">Apply asks for the keyboard to be unlocked first: it moves QK_BOOT or changes macros.</p>
    {/if}
  {:else}
    <p class="will">Checking what this order changes…</p>
  {/if}
  {#if !canEdit}
    <p class="note">The keyboard can't be changed just now: Apply works once it can.</p>
  {/if}
  {#if changed}<p class="changed" role="alert">{layersChangedText(changed.applied, changed.reset)}</p>{/if}
  {#if failure}<p class="problem" role="alert">{failure}</p>{/if}
</section>

<style>
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

  .summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .summary p {
    margin: 0;
  }

  /* why Apply is off, or what it warns of, in one line that stays while the summary scrolls */
  .flags {
    position: sticky;
    top: -10px;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
  }

  .problem ul {
    margin: 4px 0 0;
    padding-left: 18px;
    overflow-wrap: anywhere;
  }

  .note {
    color: var(--text-2);
  }

  .changed {
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 8px;
    background: var(--accent-weak);
    color: var(--text);
  }
</style>
