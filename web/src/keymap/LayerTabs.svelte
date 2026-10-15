<script lang="ts">
  import { tick } from "svelte";
  import type { Layer } from "../api/types";

  interface Props {
    layers: Layer[];
    active: number;
    canRename: boolean;
    onselect: (index: number) => void;
    /** an empty name gives the layer its default name back */
    onrename: (index: number, name: string) => void;
  }

  let { layers, active, canRename, onselect, onrename }: Props = $props();

  let editing = $state<number | null>(null);
  let draft = $state("");
  let input = $state<HTMLInputElement>();

  async function startRename(index: number) {
    if (!canRename) return;
    onselect(index);
    editing = index;
    draft = layers[index].customName ? layers[index].name : "";
    await tick();
    input?.select();
  }

  function finish(save: boolean) {
    if (editing === null) return;
    const index = editing;
    editing = null;
    const layer = layers[index];
    const name = draft.trim();
    if (save && name !== (layer.customName ? layer.name : "")) onrename(index, name);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter") finish(true);
    else if (event.key === "Escape") {
      event.stopPropagation();
      finish(false);
    }
  }

  function tabKeys(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      const next = (index + step + layers.length) % layers.length;
      onselect(next);
      document.getElementById(`layer-tab-${next}`)?.focus();
    } else if (event.key === "F2") {
      void startRename(index);
    }
  }
</script>

<div class="tabs" role="tablist" aria-label="Layers">
  {#each layers as layer (layer.index)}
    {#if editing === layer.index}
      <div class="tab active editing">
        <span class="number">{layer.index}</span>
        <input
          bind:this={input}
          bind:value={draft}
          maxlength="40"
          placeholder={layer.index === 0 ? "Base" : `Layer ${layer.index}`}
          aria-label="Name of layer {layer.index}"
          onblur={() => finish(true)}
          {onkeydown}
        />
      </div>
    {:else}
      <button
        id="layer-tab-{layer.index}"
        type="button"
        role="tab"
        class="tab"
        class:active={layer.index === active}
        aria-selected={layer.index === active}
        tabindex={layer.index === active ? 0 : -1}
        title={canRename ? "Double-click to rename" : undefined}
        onclick={() => onselect(layer.index)}
        ondblclick={() => startRename(layer.index)}
        onkeydown={(e) => tabKeys(e, layer.index)}
      >
        <span class="number">{layer.index}</span>
        <span class="name">{layer.name}</span>
      </button>
      {#if layer.index === active && canRename}
        <button
          type="button"
          class="rename"
          aria-label="Rename layer {layer.index}"
          title="Rename"
          onclick={() => startRename(layer.index)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" />
          </svg>
        </button>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-2);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 5px 14px 5px 6px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    font-weight: 550;
    cursor: pointer;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    border-color: var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  .number {
    display: inline-grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tone-layer) 14%, transparent);
    color: var(--tone-layer);
    font-size: 12px;
    font-weight: 700;
  }

  .editing input {
    width: 150px;
    padding: 3px 6px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
    outline: none;
  }

  .rename {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: -4px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .rename:hover {
    background: var(--surface);
    color: var(--text);
  }

  .rename svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
