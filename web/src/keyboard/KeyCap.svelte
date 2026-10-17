<script lang="ts">
  import { legendSizes, PLUS_BREAK, type KeyFace } from "./labels";
  import { legendFont } from "./textWidth.svelte";

  interface Props {
    face: KeyFace;
    /** width and height, in pixels */
    size: number;
    round?: boolean;
  }

  // a key drawn on its own, not part of a keyboard: the selected key in the Inspector
  let { face, size, round = false }: Props = $props();

  const main = $derived(face.main || "—");
  // inside the padding (7 % each side) and the border (2 px each side); a round cap fits its labels in the box
  // inscribed in the circle
  const inner = $derived(size * 0.86 - 4);
  const sizes = $derived(
    round
      ? legendSizes({ ...face, main }, inner * 0.8, inner * 0.6, size, legendFont.width)
      : legendSizes({ ...face, main }, inner, inner, size, legendFont.width),
  );
</script>

<div
  class="cap tone-{face.tone}" data-tone={face.tone}
  class:round
  style="--size: {size}px; --tap-size: {sizes.main}px; --shifted-size: {sizes.shifted}px;
    --hold-size: {sizes.hold}px; --hold-lines: {sizes.holdLines || 2}"
  aria-hidden="true"
>
  {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
  {#if face.shifted}<span class="shifted">{face.shifted}</span>{/if}
  <!-- may break after each "+" of a combination; on one line, so no space gets into the text -->
  <span class="main">{#each main.split(PLUS_BREAK) as part, i (i)}{#if i > 0}<wbr />{/if}{part}{/each}</span>
  {#if face.hold}<span class="hold">{face.hold}</span>{/if}
</div>
<style>
  .cap {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    padding: calc(var(--size) * 0.07);
    border: 2px solid var(--line);
    border-radius: calc(var(--size) * 0.16);
    background: var(--fill);
    box-shadow: 0 calc(var(--size) * 0.045) 0 var(--key-shadow);
    color: var(--key-text);
    overflow: hidden;
  }

  .round {
    border-radius: 50%;
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

  /* breaks at spaces and after each "+"; a part still too wide ends in an ellipsis rather than spilling over */
  .main {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    font-size: var(--tap-size);
    font-weight: 650;
    line-height: 1.15;
    text-align: center;
    text-overflow: ellipsis;
  }

  .shifted {
    color: var(--text-2);
    font-size: var(--shifted-size);
    font-weight: 550;
    line-height: 1;
  }

  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--size) * 0.04);
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
    top: calc(var(--size) * 0.05);
    right: calc(var(--size) * 0.1);
    color: var(--tone-layer);
    font-size: calc(var(--size) * 0.22);
    font-weight: 600;
  }
</style>
