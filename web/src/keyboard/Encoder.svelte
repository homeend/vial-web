<script lang="ts">
  import type { PlacedKey } from "./geometry";
  import { legendScale, type KeyFace } from "./labels";

  interface Props {
    /** one direction of an encoder: 0 counter-clockwise, 1 clockwise */
    item: PlacedKey;
    face: KeyFace;
    u: number;
    selected: boolean;
    label: string;
    focusable: boolean;
    onselect: () => void;
  }

  let { item, face, u, selected, label, focusable, onselect }: Props = $props();

  const clockwise = $derived(item.geometry.direction === 1);
  const size = $derived(Math.min(item.w, item.h) * u * 0.91);

  // a round knob needs no rotation: it sits on the (rotated) centre of its key
  const style = $derived(
    [
      `left: ${item.cx * u - size / 2}px`,
      `top: ${item.cy * u - size / 2}px`,
      `width: ${size}px`,
      `height: ${size}px`,
      `--u: ${u}px`,
      `--tap-size: ${legendScale(face.main) * u * 0.9}px`,
    ].join("; "),
  );
</script>

<button
  type="button"
  class="encoder tone-{face.tone}" data-tone={face.tone}
  class:selected
  {style}
  aria-label={label}
  title={label}
  aria-pressed={selected}
  tabindex={focusable ? 0 : -1}
  data-ref="{item.kind}:{item.index}"
  onclick={onselect}
>
  <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true" class:mirrored={!clockwise}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M17.5 3.5v4h-4" />
  </svg>
  <span class="tap">{face.main}</span>
  {#if face.hold}<span class="hold">{face.hold}</span>{/if}
</button>

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

  .tone-transparent {
    --fill: transparent;
    border-style: dashed;
    box-shadow: none;
    color: var(--text-3);
  }

  .tone-none {
    color: var(--text-3);
  }

  .selected,
  .encoder:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
    outline: none;
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

  .tap {
    max-width: 84%;
    font-size: max(9px, var(--tap-size));
    font-weight: 600;
    line-height: 1.05;
    text-align: center;
  }

  .hold {
    max-width: 80%;
    overflow: hidden;
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: max(8px, calc(var(--u) * 0.16));
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
