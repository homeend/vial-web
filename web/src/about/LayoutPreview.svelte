<script lang="ts">
  import { onMount } from "svelte";
  import type { LayoutFilePreview } from "../api/types";
  import Button from "../ui/Button.svelte";
  import { changeTotal, previewSections, unchangedSections, type PreviewContext } from "./layoutFile";

  interface Props {
    /** the file's name */
    name: string;
    preview: LayoutFilePreview;
    context: PreviewContext;
    /** the keyboard is unlocked */
    unlocked: boolean;
    canLoad: boolean;
    /** a change is being saved: the buttons keep the focus, but take nothing until it is done */
    busy: boolean;
    /** the Settings page has changes not saved yet, which loading drops */
    settingsKept: boolean;
    onload: () => void;
    oncancel: () => void;
  }

  let { name, preview, context, unlocked, canLoad, busy, settingsKept, onload, oncancel }: Props = $props();

  const sections = $derived(previewSections(preview, context));
  const total = $derived(changeTotal(sections));
  const unchanged = $derived(unchangedSections(preview, context));
  let heading = $state<HTMLHeadingElement>();

  // opened from the Load button, which stays: the focus comes here, to what to read next
  onMount(() => heading?.focus());
</script>

<div class="preview" role="group" aria-labelledby="layout-preview-title">
  <h3 id="layout-preview-title" tabindex="-1" bind:this={heading}>
    <span class="file" title={name}>Load {name}?</span>
  </h3>
  {#if total === 0}
    <p class="lead">It holds what the keyboard holds already: loading it changes nothing.</p>
  {:else}
    <p class="lead">
      Loading it makes {total} {total === 1 ? "change" : "changes"} on the keyboard. Nothing is written until you
      choose Load it.
    </p>
    <ul class="sections">
      {#each sections as section (section.id)}
        <li>
          <h4>{section.title} <span class="count">{section.count}</span></h4>
          {#if section.summary}<p class="summary">{section.summary}</p>{/if}
          <ul class="items">
            {#each section.items as item, i (i)}<li>{item}</li>{/each}
            {#if section.more > 0}<li class="more">and {section.more} more</li>{/if}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
  {#if unchanged.length > 0 && total > 0}
    <p class="unchanged">Left as they are: {unchanged.join(", ")}.</p>
  {/if}
  {#if preview.ignored.length > 0}
    <p class="note">This keyboard has no room for some of the file, which is left out: {preview.ignored.join("; ")}.</p>
  {/if}
  {#if !preview.uid}
    <p class="note">The file doesn't say which keyboard it was saved from.</p>
  {/if}
  {#if settingsKept && total > 0}
    <p class="note">Changes on the Settings page not saved yet are dropped when it is loaded.</p>
  {/if}
  {#if preview.needsUnlock && !unlocked}
    <p class="note">
      It changes what only an unlocked keyboard takes (the macros, or a bootloader key): the keyboard asks to be
      unlocked first, and nothing is written until it is.
    </p>
  {/if}
  <div class="buttons">
    <Button aria-disabled={busy || undefined} onclick={() => {
      if (!busy) oncancel();
    }}>{total === 0 ? "Close" : "Cancel"}</Button>
    {#if total > 0}
      <!-- never disabled: it keeps the focus while the keyboard can't take it (read again after a change made
           elsewhere, say) -->
      <Button variant="primary" aria-disabled={busy || !canLoad || undefined} onclick={() => {
        if (!busy && canLoad) onload();
      }}>Load it</Button>
    {/if}
  </div>
</div>

<style>
  .preview {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    box-shadow: 0 0 0 1px var(--accent);
    background: var(--surface);
  }

  h3 {
    display: flex;
    min-width: 0;
    margin: 0;
    font-size: 15px;
  }

  h3:focus {
    outline: none;
  }

  .file {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lead,
  .unchanged {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 10px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .sections > li {
    min-width: 0;
  }

  h4 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    font-size: 13px;
  }

  .count {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent-weak);
    /* --accent alone is too light on --accent-weak in the light theme */
    color: color-mix(in srgb, var(--accent) 80%, var(--text));
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .items {
    display: grid;
    gap: 1px;
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 12.5px;
  }

  .items li {
    overflow-wrap: anywhere;
  }

  .more {
    color: var(--text-3);
    list-style: none;
  }

  .note {
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
