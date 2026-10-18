<script lang="ts">
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import type { KeyFace } from "../keyboard/labels";

  interface Props {
    index: number;
    /** "Layer 1 · Symbols", "Base" */
    title: string;
    /** how it is reached, in short labels */
    reachedBy: string[];
    /** why nothing gets to it, or null when something does */
    warning: string | null;
    placement: Placement;
    faces: KeyFace[];
    combos: boolean[];
    /** keys the find box highlights */
    highlights: boolean[];
    /** the layer the Edit view shows */
    current: boolean;
    onopen: () => void;
  }

  let { index, title, reachedBy, warning, placement, faces, combos, highlights, current, onopen }: Props = $props();

  const name = $derived(
    `${title}${warning ? ` — ${warning}` : ""}${reachedBy.length > 0 ? ` — reached by ${reachedBy.join("; ")}` : ""}`,
  );
  const labels = $derived(faces.map(() => ""));
</script>

<article class="card" class:current class:unreached={warning !== null} data-layer={index}>
  <button type="button" class="open" aria-label={name} title="Open in the Edit view" onclick={onopen}>
    <span class="number">{index}</span>
    <span class="title">{title}</span>
  </button>
  <ul class="reach" aria-hidden="true">
    {#if warning}<li class="warning">{warning}</li>{/if}
    {#each reachedBy as label, i (i)}
      <li>{label}</li>
    {/each}
  </ul>
  <div class="drawing">
    <Keyboard {placement} {faces} {labels} {combos} {highlights} selected={-1} onselect={() => undefined} interactive={false}
      compact maxUnit={44} />
  </div>
</article>

<style>
  .card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
    padding: 10px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
    transition: border-color 0.12s;
  }

  .card:hover {
    border-color: var(--border-strong);
  }

  .card.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow);
  }

  .card:has(.open:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .card.unreached {
    border-style: dashed;
  }

  /* the whole card opens the layer */
  .open {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .open::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  .open:focus-visible {
    outline: none;
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

  .title {
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reach {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .reach li {
    padding: 1px 8px;
    border: 1px solid color-mix(in srgb, var(--tone-layer) 30%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--tone-layer) 8%, var(--surface));
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.5;
  }

  .reach li.warning {
    border-color: color-mix(in srgb, var(--warning-text) 35%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
    font-weight: 600;
  }

  .drawing {
    padding-top: 4px;
  }
</style>
