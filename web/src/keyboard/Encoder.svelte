<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { compactLegendSize, legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
  import { refId } from "./refs";
  import { legendFont } from "./textWidth.svelte";

  interface Props {
    /** one direction of an encoder: 0 counter-clockwise, 1 clockwise */
    item: PlacedKey;
    face: KeyFace;
    u: number;
    selected: boolean;
    label: string;
    focusable: boolean;
    /** produces what the find box looks for: highlighted */
    found?: boolean;
    /** drawn faintly: a knob that doesn't matter here */
    faded?: boolean;
    /** a knob to choose (pressed) or not: aria-pressed says this instead of whether it is selected */
    chosen?: boolean;
    /** a knob to click; otherwise only a picture (the keyboard as a whole is labelled) */
    interactive?: boolean;
    /** a small knob showing its main legend only, as large as it fits */
    compact?: boolean;
    onselect: () => void;
  }

  let {
    item, face, u, selected, label, focusable, found = false, faded = false, chosen, interactive = true,
    compact = false, onselect,
  }: Props = $props();

  const clockwise = $derived(item.geometry.direction === 1);
  const size = $derived(Math.min(item.w, item.h) * u * 0.91);
  // the labels fit in the box inscribed in the knob, inside its border (2 px): 80 % of its width by 60 % of its height
  const inner = $derived(Math.max(0, size - 4));
  const sizes = $derived(
    compact
      ? { main: compactLegendSize(face.main, inner * 0.8, inner * 0.6, u * 0.9, legendFont.width), hold: 0, holdLines: 0 }
      : legendSizes({ ...face, shifted: null }, inner * 0.8, inner * 0.6, u * 0.9, legendFont.width),
  );

  // a round knob needs no rotation: it sits on the (rotated) centre of its key
  const style = $derived(
    [
      `left: ${item.cx * u - size / 2}px`,
      `top: ${item.cy * u - size / 2}px`,
      `width: ${size}px`,
      `height: ${size}px`,
      `--u: ${u}px`,
      `--tap-size: ${sizes.main}px`,
      `--hold-size: ${sizes.hold}px`,
      `--hold-lines: ${sizes.holdLines || 2}`,
    ].join("; "),
  );
</script>

{#snippet knob()}
  <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true" class:mirrored={!clockwise}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M17.5 3.5v4h-4" />
  </svg>
  <span class="legend">
    <!-- may break after each "+" of a combination; on one line, so no space gets into the text -->
    <span class="tap">{#each face.main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
    {#if !compact && face.hold}<span class="hold">{face.hold}</span>{/if}
  </span>
{/snippet}

{#if interactive}
  <button
    type="button"
    class="encoder tone-{face.tone}" data-tone={face.tone}
    class:selected
    class:found
    class:faded
    {style}
    aria-label={label}
    title={label}
    aria-pressed={chosen ?? selected}
    tabindex={focusable ? 0 : -1}
    data-ref={refId(item)}
    onclick={onselect}
  >
    {@render knob()}
  </button>
{:else}
  <div class="encoder static tone-{face.tone}" data-tone={face.tone} class:found class:faded {style}>
    {@render knob()}
  </div>
{/if}

<style>
  .encoder {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 2px solid var(--line);
    border-radius: 50%;
    background: var(--fill);
    box-shadow: 0 calc(var(--u) * 0.035) 0 var(--key-shadow);
    color: var(--key-text);
    cursor: pointer;
  }

  .static {
    cursor: inherit;
  }

  .tone-transparent {
    --fill: transparent;
    border-style: dashed;
    box-shadow: none;
    color: var(--text-3);
  }

  .tone-none {
    color: var(--text-3);
  }

  .found {
    border-color: var(--find);
    box-shadow: 0 0 0 2px var(--find);
  }

  /* and a ring outside the knob, apart from it (3 to 5 px out): found shows by shape as well as colour, and next to
     the selection's */
  .found::after {
    content: "";
    position: absolute;
    /* from the inside of the knob's border (2 px) */
    inset: -7px;
    border: 2px solid var(--find);
    border-radius: 50%;
    pointer-events: none;
  }

  .selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* a thin ring outside the knob, apart from the selection's */
  .encoder:focus-visible {
    z-index: 1;
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }

  /* outside the found ring */
  .found:focus-visible {
    outline-offset: 7px;
  }

  .arrow {
    position: absolute;
    top: 6%;
    left: 6%;
    width: 30%;
    height: 30%;
    fill: none;
    stroke: var(--text-3);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .arrow.mirrored {
    transform: scaleX(-1);
  }

  /* the box inscribed in the knob: what does not fit is cut there, not outside the knob */
  .legend {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 80%;
    height: 60%;
    overflow: hidden;
    pointer-events: none;
  }

  .tap {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    font-size: var(--tap-size);
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    text-overflow: ellipsis;
  }

  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--u) * 0.036);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--hold-lines, 2);
    line-clamp: var(--hold-lines, 2);
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: var(--hold-size);
    line-height: 1.1;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .faded {
    opacity: 0.38;
  }
</style>
