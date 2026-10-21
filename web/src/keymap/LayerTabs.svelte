<script lang="ts">
  import type { Layer } from "../api/types";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";

  interface Props {
    layers: Layer[];
    active: number;
    canRename: boolean;
    onselect: (index: number) => void;
    /** an empty name gives the layer its default name back; resolves to whether it worked */
    onrename: (index: number, name: string) => Promise<boolean>;
    /** why Arrange layers does nothing just now, or null */
    arrangeBlocked: string | null;
    /** opens Arrange layers */
    onarrange: () => void;
  }

  let { layers, active, canRename, onselect, onrename, arrangeBlocked, onarrange }: Props = $props();

  /** the layer being renamed, in the dialog */
  let renaming = $state<number | null>(null);

  const tabId = (index: number) => `layer-tab-${index}`;
  const ownName = (index: number) => (layers[index]?.customName ? layers[index].name : "");

  function startRename(index: number) {
    if (!canRename) return;
    onselect(index);
    renaming = index;
  }

  /** an unchanged name isn't sent */
  function save(index: number, name: string): Promise<boolean> {
    return name === ownName(index) ? Promise.resolve(true) : onrename(index, name);
  }

  const subject = $derived<NameSubject | null>(renaming === null ? null : {
    title: `Rename layer ${renaming}`,
    label: `Name of layer ${renaming}`,
    empty: `the default name, ${renaming === 0 ? "Base" : `Layer ${renaming}`}`,
    placeholder: renaming === 0 ? "Base" : `Layer ${renaming}`,
    text: ownName(renaming),
  });

  function closed() {
    const index = renaming;
    renaming = null;
    if (index !== null) document.getElementById(tabId(index))?.focus();
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

<!-- The tablist holds only the tabs; the rename button is drawn among them (after the active tab, by its order)
     but is outside it. Renaming happens in a dialog, wide enough for the longest name. -->
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
        aria-selected={layer.index === active}
        aria-controls="layer-panel"
        tabindex={layer.index === active ? 0 : -1}
        title={canRename ? `${layer.name} · double-click to rename` : layer.name}
        onclick={() => onselect(layer.index)}
        ondblclick={() => startRename(layer.index)}
        onkeydown={(e) => tabKeys(e, layer.index)}
      >
        <span class="number">{layer.index}</span>
        <span class="name">{layer.name}</span>
      </button>
    {/each}
  </div>
  {#if canRename && layers[active]}
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
  <!-- after every tab; aria-disabled rather than disabled, so that its tooltip says why it does nothing -->
  <button
    id="arrange-layers"
    type="button"
    class="arrange"
    style="order: {layers.length * 2 + 1}"
    aria-disabled={arrangeBlocked !== null || undefined}
    title={arrangeBlocked ?? "Move layers to other positions; keys that reach them follow"}
    onclick={() => {
      if (arrangeBlocked === null) onarrange();
    }}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 2.5v10M2.5 10.5l2 2 2-2M11.5 13.5v-10M9.5 5.5l2-2 2 2" />
      </svg>
    Arrange layers…
  </button>
</div>

<NameDialog {subject} onsave={(name) => (renaming === null ? Promise.resolve(true) : save(renaming, name))} onclose={closed} />

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

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    border-color: var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  /* a long name is cut short; the tooltip has all of it */
  .name {
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .arrange {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .arrange:hover:not([aria-disabled="true"]) {
    border-color: var(--border);
    background: var(--surface);
    color: var(--text);
  }

  .arrange[aria-disabled="true"] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .arrange svg,
  .rename svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
