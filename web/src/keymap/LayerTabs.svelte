<script lang="ts">
  import { tick } from "svelte";
  import type { Layer } from "../api/types";

  interface Props {
    layers: Layer[];
    active: number;
    canRename: boolean;
    onselect: (index: number) => void;
    /** an empty name gives the layer its default name back; resolves to whether it worked */
    onrename: (index: number, name: string) => Promise<boolean>;
  }

  let { layers, active, canRename, onselect, onrename }: Props = $props();

  let editing = $state<number | null>(null);
  let draft = $state("");
  let input = $state<HTMLInputElement>();

  const tabId = (index: number) => `layer-tab-${index}`;

  /** text: what the name field starts with (a failed rename gives back what was typed) */
  async function startRename(index: number, text?: string) {
    if (!canRename) return;
    onselect(index);
    editing = index;
    draft = text ?? (layers[index].customName ? layers[index].name : "");
    await tick();
    input?.select();
  }

  /** refocus: the layer's tab gets the focus back (Enter, Escape), rather than it staying where it went (a click) */
  async function finish(save: boolean, refocus: boolean) {
    if (editing === null) return;
    const index = editing;
    editing = null;
    const layer = layers[index];
    const name = draft.trim();
    if (refocus) {
      await tick();
      document.getElementById(tabId(index))?.focus();
    }
    if (save && name !== (layer.customName ? layer.name : "")) {
      // it failed (a toast says why): the field is back, with what was typed
      if (!(await onrename(index, name))) await startRename(index, name);
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(true, true);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      void finish(false, true);
    }
  }

  /** the tabs pattern: arrows, Home and End move along the layers and select; F2 renames */
  function tabKeys(event: KeyboardEvent, index: number) {
    const last = layers.length - 1;
    const next = ({
      ArrowLeft: index > 0 ? index - 1 : last,
      ArrowRight: index < last ? index + 1 : 0,
      Home: 0,
      End: last,
    } as Record<string, number>)[event.key];
    if (next !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onselect(next);
      document.getElementById(tabId(next))?.focus();
    } else if (event.key === "F2") {
      event.preventDefault();
      void startRename(index);
    }
  }
</script>

<!-- The tablist holds only the tabs; the rename button and the name field are drawn among them (by their order)
     but are outside it. While a layer is renamed its tab is hidden, and the field takes its place. -->
<div class="tabs">
  <div class="tablist" role="tablist" aria-label="Layers">
    {#each layers as layer (layer.index)}
      <button
        id={tabId(layer.index)}
        type="button"
        role="tab"
        class="tab"
        class:active={layer.index === active}
        style="order: {layer.index * 2}"
        hidden={editing === layer.index}
        aria-selected={layer.index === active}
        aria-controls="layer-panel"
        tabindex={layer.index === active ? 0 : -1}
        title={canRename ? "Double-click to rename" : undefined}
        onclick={() => onselect(layer.index)}
        ondblclick={() => startRename(layer.index)}
        onkeydown={(e) => tabKeys(e, layer.index)}
      >
        <span class="number">{layer.index}</span>
        <span class="name">{layer.name}</span>
      </button>
    {/each}
  </div>
  {#if editing !== null}
    <div class="tab active editing" style="order: {editing * 2}">
      <span class="number">{editing}</span>
      <input
        bind:this={input}
        bind:value={draft}
        maxlength="40"
        placeholder={editing === 0 ? "Base" : `Layer ${editing}`}
        aria-label="Name of layer {editing}"
        onblur={() => finish(true, false)}
        {onkeydown}
      />
    </div>
  {:else if canRename && layers[active]}
    <button
      type="button"
      class="rename"
      style="order: {active * 2 + 1}"
      aria-label="Rename layer {active}"
      title="Rename"
      onclick={() => startRename(active)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" />
      </svg>
    </button>
  {/if}
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

  /* its tabs are laid out with the rename button and the name field, in their order */
  .tablist {
    display: contents;
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

  .tab[hidden] {
    display: none;
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
