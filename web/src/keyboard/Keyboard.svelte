<script lang="ts">
  import Encoder from "./Encoder.svelte";
  import { encoderKnobs, type Placement } from "./geometry";
  import Key from "./Key.svelte";
  import type { KeyFace } from "./labels";

  interface Props {
    placement: Placement;
    /** what each placed key shows, aligned with placement.items */
    faces: KeyFace[];
    /** what a screen reader says for each placed key */
    labels: string[];
    /** index into placement.items, or -1 */
    selected: number;
    onselect: (index: number) => void;
    /** largest key size, in pixels */
    maxUnit?: number;
  }

  let { placement, faces, labels, selected, onselect, maxUnit = 72 }: Props = $props();

  let width = $state(0);
  // as big as fits the width, never bigger than maxUnit
  const u = $derived(placement.width > 0 ? Math.min(maxUnit, width / placement.width) : 0);

  const knobs = $derived(encoderKnobs(placement));

  // reached with Tab: the selected key, or the first one when none is (or the selection is not on this board)
  const focusIndex = $derived(selected >= 0 && selected < placement.items.length ? selected : 0);
</script>

<div class="keyboard" bind:clientWidth={width}>
  <div
    class="plate"
    role="group"
    aria-label="Keyboard"
    style="width: {placement.width * u}px; height: {placement.height * u}px"
  >
    {#if u > 0}
      {#each knobs as knob (knob.encoder)}
        <div
          class="knob"
          style="left: {(knob.cx - knob.length / 2) * u}px; top: {(knob.cy - knob.thickness / 2) * u}px;
            width: {knob.length * u}px; height: {knob.thickness * u}px; transform: rotate({knob.angle}deg)"
        ></div>
      {/each}
      {#each placement.items as item, i (`${item.kind}:${item.index}`)}
        {#if item.kind === "key"}
          <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            onselect={() => onselect(i)} />
        {:else}
          <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            onselect={() => onselect(i)} />
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .keyboard {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .plate {
    position: relative;
    flex: none;
  }

  .knob {
    position: absolute;
    border: 1px dashed var(--border-strong);
    border-radius: 999px;
    background: var(--surface-2);
  }
</style>
