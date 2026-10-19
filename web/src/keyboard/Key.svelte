<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { compactLegendSize, legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
  import { comboMarks, dotSizes } from "./marks";
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
    /** the colours (palette indexes) of the combos it is part of, in combo order: one is an underline, several a row
     * of dots */
    combos?: number[];
    /** produces what the find box looks for: highlighted */
    found?: boolean;
    /** a ring around the key in this colour (a CSS colour), as the found ring is drawn: marks the keys of a combo */
    ring?: string | null;
    /** drawn faintly: a key that doesn't matter here */
    faded?: boolean;
    /** a key to choose (pressed) or not: aria-pressed says this instead of whether it is selected */
    chosen?: boolean;
    /** a key to click; otherwise only a picture (the keyboard as a whole is labelled) */
    interactive?: boolean;
    /** a small key showing its main legend only, as large as it fits */
    compact?: boolean;
    onselect: () => void;
  }

  let {
    item, face, u, selected, label, focusable, combos = [], found = false, ring = null, faded = false, chosen,
    interactive = true, compact = false, onselect,
  }: Props = $props();

  const combo = $derived(combos.length > 0);

  const GAP = 0.09;
  /** space around the labels, in key units */
  const PAD = 0.04;
  const COMPACT_PAD = 0.015;
  const ROUND = 0.12;
  /** the found ring, in pixels: its distance from the key's rectangle, and its width */
  const RING_GAP = 3.5;
  const RING_WIDTH = 2;

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

  // a line along the bottom of the primary rectangle, inside its outline: where the combo marks go
  const underline = $derived.by(() => {
    const r = rects[0];
    const thickness = Math.max(2, u * 0.07);
    const inset = Math.max(2, u * 0.12);
    const bottom = r.y + r.h - Math.max(1.5, u * 0.05);
    return { x: r.x + inset, y: bottom - thickness, w: Math.max(0, r.w - 2 * inset), h: thickness, bottom };
  });
  const dots = $derived(dotSizes(u));
  const marks = $derived(comboMarks(combos, underline.w, dots));
  // the marks keep their own space at the bottom of the key, which the legends don't go into
  const markSpace = $derived(
    marks.type === "none" ? 0 : rects[0].y + rects[0].h - (marks.type === "line" ? underline.y : underline.bottom - dots.dot),
  );
  const dotRow = $derived.by(() => {
    if (marks.type !== "dots") return null;
    const step = dots.dot + dots.gap;
    const width = marks.colours.length * step - dots.gap + (marks.more > 0 ? dots.more : 0);
    const left = underline.x + (underline.w - width) / 2;
    const cy = underline.bottom - dots.dot / 2;
    return {
      dots: marks.colours.map((colour, i) => ({ cx: left + i * step + dots.dot / 2, cy, colour })),
      more: marks.more > 0 ? { x: left + width, y: cy, text: `+${marks.more}` } : null,
    };
  });

  // the legends fit inside the primary rectangle, less the gap between keys, the padding and the combo marks
  // a small key keeps less space around its only legend
  const pad = $derived(compact ? COMPACT_PAD : PAD);
  const sizes = $derived.by(() => {
    const width = (item.w - GAP - 2 * pad) * u;
    const height = (item.h - GAP - 2 * pad) * u - markSpace;
    return compact
      ? { main: compactLegendSize(face.main, width, height, u, legendFont.width), shifted: 0, hold: 0, holdLines: 0 }
      : legendSizes(face, width, height, u, legendFont.width);
  });

  // a found key also gets a ring outside its outline, apart from it: found shows by shape as well as colour, on keys
  // of any kind and next to the selection's outline (5 px wide, so 2.5 px out). One shape: the key grown by the gap
  // and the ring, less the key grown by the gap (a mask), so that the two rectangles of an ISO Enter get one ring
  const ringShape = $derived.by(() => {
    const grow = (r: { x: number; y: number; w: number; h: number }, by: number) => ({
      x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by, rx: ROUND * u + by,
    });
    return { outer: rects.map((r) => grow(r, RING_GAP + RING_WIDTH)), inner: rects.map((r) => grow(r, RING_GAP)) };
  });
  const uid = $props.id();
  const ringMask = `find-ring-${uid}`;
  // the focus ring goes outside the found ring (the focus ring is offset from the button, which reaches half a gap
  // past the outline)
  const ringClear = $derived(RING_GAP + RING_WIDTH + 1 - (GAP * u) / 2);

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
      `--ring-clear: ${ringClear}px`,
      item.r ? `transform: rotate(${item.r}deg)` : "",
      item.r ? `transform-origin: ${(item.rx - item.x - box.left) * u}px ${(item.ry - item.y - box.top) * u}px` : "",
    ].filter(Boolean).join("; "),
  );

  const legendStyle = $derived(
    `left: ${rects[0].x}px; top: ${rects[0].y}px; width: ${rects[0].w}px; height: ${rects[0].h - markSpace}px; ` +
      `padding: ${pad * u}px`,
  );

  const ringColour = $derived(found ? "var(--find)" : ring);
</script>

{#snippet cap()}
  <svg class="cap" width={box.width * u} height={box.height * u} aria-hidden="true">
    {#if ringColour}
      <!-- white keeps, black cuts away: mask values, not colours that show -->
      <mask id={ringMask}>
        {#each ringShape.outer as r, i (i)}
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="white" />
        {/each}
        {#each ringShape.inner as r, i (i)}
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} fill="black" />
        {/each}
      </mask>
      {#each ringShape.outer as r, i (i)}
        <rect class="ring" x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} mask="url(#{ringMask})"
          style="fill: {ringColour}" />
      {/each}
    {/if}
    <!-- outlines first, then the fills over them: two rectangles read as one key (ISO Enter) -->
    {#each rects as r, i (i)}
      <rect class="edge" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
    {#each rects as r, i (i)}
      <rect class="face" x={r.x} y={r.y} width={r.w} height={r.h} rx={ROUND * u} />
    {/each}
    {#if marks.type === "line"}
      <rect class="combo-mark" x={underline.x} y={underline.y} width={underline.w} height={underline.h}
        rx={underline.h / 2} style="fill: var(--combo-{marks.colour})" />
    {:else if dotRow}
      {#each dotRow.dots as d, i (i)}
        <circle class="combo-dot" cx={d.cx} cy={d.cy} r={dots.dot / 2} style="fill: var(--combo-{d.colour})" />
      {/each}
      {#if dotRow.more}
        <text class="combo-more" x={dotRow.more.x} y={dotRow.more.y} text-anchor="end" dominant-baseline="central"
          font-size={Math.max(8, dots.dot * 1.5)}>{dotRow.more.text}</text>
      {/if}
    {/if}
  </svg>
  <span class="legend" style={legendStyle}>
    {#if !compact && face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
    {#if !compact && face.shifted}<span class="shifted">{face.shifted}</span>{/if}
    <!-- may break after each "+" of a combination; on one line, so no space gets into the text -->
    <span class="tap">{#each face.main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
    {#if !compact && face.hold}<span class="hold">{face.hold}</span>{/if}
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
    class:ringed={ringColour !== null}
    class:faded
    {style}
    aria-label={label}
    title={label}
    aria-pressed={chosen ?? selected}
    tabindex={focusable ? 0 : -1}
    data-ref={refId(item)}
    onclick={onselect}
  >
    {@render cap()}
  </button>
{:else}
  <div class="key static tone-{face.tone}" data-tone={face.tone} class:combo class:found class:ringed={ringColour !== null}
    class:faded {style}>
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

  .combo-more {
    fill: var(--text-2);
    font-weight: 700;
  }

  .faded {
    opacity: 0.38;
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

  /* the ring reaches into the gap between keys (past it, on small keys): a ringed key sits above its neighbours */
  .ringed {
    z-index: 1;
  }

  .selected .edge {
    stroke: var(--accent);
    stroke-width: 5;
    stroke-dasharray: none;
  }

  /* a thin ring outside the key, apart from the thick outline of the selection; it turns with the key, and sits
     above its neighbours (found ones included) */
  .key:focus-visible {
    z-index: 2;
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .ringed:focus-visible {
    outline-offset: max(2px, var(--ring-clear));
  }

  /* a key of two rectangles (ISO Enter) answers the pointer only where it is drawn, not in its notch */
  .notched {
    pointer-events: none;
  }

  .notched .cap rect {
    cursor: pointer;
    pointer-events: visiblePainted;
  }

  /* a picture's keys take no clicks: a found one, raised above its neighbours, must not take them from what holds
     the picture (an Overview card opens on a click anywhere) */
  .static,
  .static .cap rect {
    pointer-events: none;
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
