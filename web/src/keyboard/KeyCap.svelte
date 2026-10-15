<script lang="ts">
  import { holdSize, legendScale, type KeyFace } from "./labels";

  interface Props {
    face: KeyFace;
    /** width and height, in pixels */
    size: number;
    round?: boolean;
  }

  // a key drawn on its own, not part of a keyboard: the selected key in the Inspector
  let { face, size, round = false }: Props = $props();
</script>

<div
  class="cap tone-{face.tone}" data-tone={face.tone}
  class:round
  style="--size: {size}px; --tap-size: {legendScale(face.main) * size}px;
    --hold-size: {face.hold ? holdSize(face.hold, size * 0.82, size) : 0}px"
  aria-hidden="true"
>
  {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
  {#if face.shifted}<span class="shifted">{face.shifted}</span>{/if}
  <span class="main">{face.main || "—"}</span>
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

  .main {
    max-width: 100%;
    font-size: var(--tap-size);
    font-weight: 650;
    line-height: 1.05;
    text-align: center;
  }

  .shifted {
    color: var(--text-2);
    font-size: calc(var(--size) * 0.2);
    font-weight: 550;
    line-height: 1;
  }

  .hold {
    display: -webkit-box;
    max-width: 100%;
    margin-top: calc(var(--size) * 0.04);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: color-mix(in srgb, var(--tone) var(--tone-text), var(--key-text));
    font-size: var(--hold-size);
    font-weight: 550;
    line-height: 1.1;
    text-align: center;
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
