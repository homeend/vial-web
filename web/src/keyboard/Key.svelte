<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { compactLegendSize, legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
  import { refId } from "./refs";
  import { legendFont } from "./textWidth.svelte";

  interface Props {
    item: PlacedKey;
    face: KeyFace;
    /** pixels per key unit */
    u: number;
    selected: boolean;
    /** everything the key says, in words: for screen readers, and the tooltip */
    label: string;
    /** reaches the key with Tab (the selected one, or the first) */
    focusable: boolean;
    /** part of a combo: underlined */
    combo?: boolean;
    /** produces what the find box looks for: highlighted */
    found?: boolean;
    /** a key to click; otherwise only a picture (the keyboard as a whole is labelled) */
    interactive?: boolean;
    /** a small key showing its main legend only, as large as it fits */
    compact?: boolean;
    onselect: () => void;
  }

  let {
    item, face, u, selected, label, focusable, combo = false, found = false, interactive = true, compact = false, onselect,
  }: Props = $props();

  const GAP = 0.09;
  /** space around the labels, in key units */
  const PAD = 0.04;
  const COMPACT_PAD = 0.015;
  const ROUND = 0.12;

  // the button covers both rectangles; everything inside is relative to its top-left corner
  const box = $derived.by(() => {
    const left = Math.min(0, item.hasSecond ? item.x2 : 0);
    const top = Math.min(0, item.hasSecond ? item.y2 : 0);
    const right = Math.max(item.w, item.hasSecond ? item.x2 + item.w2 : 0);
    const bottom = Math.max(item.h, item.hasSecond ? item.y2 + item.h2 : 0);
    return { left, top, width: right - left, height: bottom - top };
  });

  const rects = $derived.by(() => {
    const g = GAP * u;
    const shapes = [{ x: -box.left, y: -box.top, w: item.w, h: item.h }];
    if (item.hasSecond) shapes.push({ x: item.x2 - box.left, y: item.y2 - box.top, w: item.w2, h: item.h2 });
    return shapes.map((s) => ({ x: s.x * u + g / 2, y: s.y * u + g / 2, w: s.w * u - g, h: s.h * u - g }));
  });

  // the legends fit inside the primary rectangle, less the gap between keys and the padding
  // a small key keeps less space around its only legend
  const pad = $derived(compact ? COMPACT_PAD : PAD);
  const sizes = $derived.by(() => {
    const width = (item.w - GAP - 2 * pad) * u;
    const height = (item.h - GAP - 2 * pad) * u;
    return compact
      ? { main: compactLegendSize(face.main, width, height, u, legendFont.width), shifted: 0, hold: 0, holdLines: 0 }
      : legendSizes(face, width, height, u, legendFont.width);
  });

  const style = $derived(
    [
      `left: ${(item.x + box.left) * u}px`,
      `top: ${(item.y + box.top) * u}px`,
      `width: ${box.width * u}px`,
      `height: ${box.height * u}px`,
      `--u: ${u}px`,
      `--tap-size: ${sizes.main}px`,
      `--shifted-size: ${sizes.shifted}px`,
      `--hold-size: ${sizes.hold}px`,
      `--hold-lines: ${sizes.holdLines || 2}`,
      item.r ? `transform: rotate(${item.r}deg)` : "",
      item.r ? `transform-origin: ${(item.rx - item.x - box.left) * u}px ${(item.ry - item.y - box.top) * u}px` : "",
    ].filter(Boolean).join("; "),
  );

  // a line along the bottom of the primary rectangle, inside its outline
  const underline = $derived.by(() => {
    const r = rects[0];
    const thickness = Math.max(2, u * 0.07);
    const inset = Math.max(2, u * 0.12);
    const bottom = r.y + r.h - Math.max(1.5, u * 0.05);
    return { x: r.x + inset, y: bottom - thickness, w: Math.max(0, r.w - 2 * inset), h: thickness };
  });

  const legendStyle = $derived(
    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h}px; ` +
      `padding: ${pad * u}px`,
  );
</script>

{#snippet cap()}
  <svg class="cap" width={box.width * u} height={box.height * u} aria-hidden="true">
    <!-- outlines first, then the fills over them: two rectangles read as one key (ISO Enter) -->
    {#each rects as r, i (i)}
      <rect class="edge" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
    {#each rects as r, i (i)}
      <rect class="face" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
    {#if combo}
      <rect class="combo-mark" x={underline.x} y={underline.y} width={underline.w} height={underline.h}
        rx={underline.h / 2} />
    {/if}
  </svg>
  <span class="legend" style={legendStyle}>
    {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
    {#if face.shifted}<span class="shifted">{face.shifted}</span>{/if}
    <!-- may break after each "+" of a combination; on one line, so no space gets into the text -->
    <span class="tap">{#each face.main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
    {#if face.hold}<span class="hold">{face.hold}</span>{/if}
  </span>
{/snippet}

{#if interactive}
  <button
    type="button"
    class="key tone-{face.tone}" data-tone={face.tone}
    class:selected
    class:notched={item.hasSecond}
    class:combo
    class:found
    {style}
    aria-label={label}
    title={label}
    aria-pressed={selected}
    tabindex={focusable ? 0 : -1}
    data-ref={refId(item)}
    onclick={onselect}
  >
    {@render cap()}
  </button>
{:else}
  <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found {style}>
    {@render cap()}
  </div>
{/if}

<style>
  .key {
    position: absolute;
    padding: 0;
    border: 0;
    background: none;
    color: var(--key-text);
    cursor: pointer;
    border-radius: calc(var(--u) * 0.14);
  }

  .cap {
    position: absolute;
    inset: 0;
    overflow: visible;
    filter: drop-shadow(0 calc(var(--u) * 0.035) 0 var(--key-shadow));
  }

  .edge {
    fill: none;
    stroke: var(--line);
    stroke-width: 2;
  }

  .face {
    fill: var(--fill);
  }

  .tone-transparent .cap {
    filter: none;
  }

  .tone-transparent .face {
    fill: var(--board-bg);
  }

  .tone-transparent .edge {
    stroke-dasharray: 4 3;
    stroke-width: 1.5;
  }

  .tone-transparent,
  .tone-none {
    color: var(--text-3);
  }

  /* fills stay opaque: the two rectangles of an ISO Enter must hide each other's outline */
  .tone-none .face {
    fill: color-mix(in srgb, var(--key-bg) 55%, var(--board-bg));
  }

  .combo-mark {
    fill: var(--combo);
  }

  .static {
    cursor: inherit;
  }

  .key:not(.static):hover .face {
    fill: color-mix(in srgb, var(--fill) 88%, var(--accent));
  }

  .found .edge {
    stroke: var(--find);
    stroke-width: 4;
    stroke-dasharray: none;
  }

  .found .cap {
    filter: drop-shadow(0 0 calc(var(--u) * 0.12) color-mix(in srgb, var(--find) 70%, transparent));
  }

  .selected .edge {
    stroke: var(--accent);
    stroke-width: 5;
    stroke-dasharray: none;
  }

  /* a thin ring outside the key, apart from the thick outline of the selection; it turns with the key, and sits
     above its neighbours */
  .key:focus-visible {
    z-index: 1;
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* a key of two rectangles (ISO Enter) answers the pointer only where it is drawn, not in its notch */
  .notched {
    pointer-events: none;
  }

  .notched .cap rect {
    cursor: pointer;
    pointer-events: visiblePainted;
  }

  .legend {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    overflow: hidden;
  }

  /* breaks at spaces and after each "+"; a part still too wide ends in an ellipsis rather than spilling over */
  .tap {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    font-size: var(--tap-size);
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.01em;
    text-align: center;
    text-overflow: ellipsis;
    overflow-wrap: normal;
  }

  .shifted {
    margin-bottom: calc(var(--u) * 0.02);
    color: var(--text-2);
    font-size: var(--shifted-size);
    font-weight: 550;
    line-height: 1;
  }

  /* names of tap dances and macros can be long: two lines at most (three at the smallest size), smaller for longer
     names */
  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--u) * 0.04);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--hold-lines, 2);
    line-clamp: var(--hold-lines, 2);
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: var(--hold-size);
    font-weight: 550;
    line-height: 1.1;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .alt-gr {
    position: absolute;
    top: calc(var(--u) * 0.05);
    right: calc(var(--u) * 0.1);
    color: var(--tone-layer);
    font-size: max(10px, calc(var(--u) * 0.23));
    font-weight: 600;
  }
</style>
