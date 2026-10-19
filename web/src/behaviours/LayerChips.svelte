<script lang="ts">
  import type { Names } from "../keyboard/labels";
  import { allLayers, MASK_LAYERS, toggled } from "./overrides";

  interface Props {
    /** 16 bits, one per layer; bits of layers the keyboard doesn't have are kept as they are */
    mask: number;
    /** how many layers the keyboard has */
    count: number;
    names: Names;
    /** a change is being saved: the chips keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (mask: number) => void;
  }

  let { mask, count, names, busy, onchange }: Props = $props();
  const uid = $props.id();
  const shown = $derived(Array.from({ length: Math.min(count, MASK_LAYERS) }, (_, l) => l));
  /** the bits of layers the keyboard doesn't have: "All" and "None" leave them as they are */
  const beyond = $derived(mask & ~allLayers(count) & 0xffff);

  function change(next: number) {
    if (!busy) onchange(next);
  }
</script>

<fieldset class="layers" aria-describedby="{uid}-hint">
  <legend>Layers</legend>
  <p class="hint" id="{uid}-hint">
    It works only while one of these layers is on.{#if count > MASK_LAYERS} Layers {MASK_LAYERS} and up can't have
      key overrides: the firmware keeps {MASK_LAYERS} layers in its mask.{/if}
  </p>
  <div class="chips">
    {#each shown as layer (layer)}
      {@const name = names.layer(layer)}
      <button type="button" class="chip" aria-pressed={(mask & (1 << layer)) !== 0} aria-disabled={busy || undefined}
        title={name} onclick={() => change(toggled(mask, 1 << layer))}>
        <span class="number" aria-hidden="true">{layer}</span><span class="name">{name}</span>
      </button>
    {/each}
    <span class="shortcuts">
      <button type="button" class="link" aria-disabled={busy || undefined} onclick={() => change(beyond | allLayers(count))}>
        All layers
      </button>
      <button type="button" class="link" aria-disabled={busy || undefined} onclick={() => change(beyond)}>None</button>
    </span>
  </div>
</fieldset>

<style>
  .layers {
    display: grid;
    gap: 5px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    font-size: 13px;
    font-weight: 650;
  }

  .hint {
    margin: 0 0 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 180px;
    padding: 3px 9px 3px 4px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--accent);
  }

  .chip[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--tone-layer) 65%, var(--border));
    background: color-mix(in srgb, var(--tone-layer) 14%, var(--surface));
    color: var(--text);
    font-weight: 600;
  }

  .number {
    display: inline-grid;
    flex: none;
    place-items: center;
    min-width: 19px;
    height: 19px;
    border-radius: 999px;
    background: var(--surface-2);
    font: 650 11px/1 var(--mono);
  }

  .chip[aria-pressed="true"] .number {
    background: color-mix(in srgb, var(--tone-layer) 30%, var(--surface));
  }

  /* a long layer name is cut short; the tooltip has all of it */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shortcuts {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
  }

  .link {
    padding: 3px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .link:hover {
    background: var(--accent-weak);
  }

  .chip[aria-disabled="true"],
  .link[aria-disabled="true"] {
    cursor: progress;
  }
</style>
