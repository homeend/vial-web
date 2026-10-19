<script lang="ts">
  import Encoder from "./Encoder.svelte";
  import { encoderKnobs, type Placement } from "./geometry";
  import Key from "./Key.svelte";
  import type { KeyFace } from "./labels";
  import { refId } from "./refs";

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
    /** for each placed key, the colours of the combos it is part of (an underline, or dots), aligned with
     * placement.items */
    combos?: number[][];
    /** keys to click and move between; otherwise a picture, hidden from screen readers (what shows it says what it
     * is) */
    interactive?: boolean;
    /** small keys, main legends only, as large as they fit (the Overview's) */
    compact?: boolean;
    /** which placed keys produce what the find box looks for (highlighted), aligned with placement.items */
    highlights?: boolean[];
    /** a ring in a colour (CSS) around some keys, aligned with placement.items */
    rings?: (string | null)[];
    /** which placed keys are drawn faintly, aligned with placement.items */
    faded?: boolean[];
    /** keys to choose: whether each is chosen (its aria-pressed), aligned with placement.items */
    chosen?: boolean[];
    /** the key reached with Tab, when it isn't the selected one (a cursor shown only while the keys have the focus) */
    tabStop?: number;
    /** what the keys are called, for screen readers */
    label?: string;
    /** the id of what says how to use the keys */
    describedby?: string;
  }

  let {
    placement, faces, labels, selected, onselect, maxUnit = 72, combos = [], interactive = true, compact = false,
    highlights = [], rings = [], faded = [], chosen, tabStop, label = "Keyboard", describedby,
  }: Props = $props();

  let width = $state(0);
  // as big as fits the width, never bigger than maxUnit
  const u = $derived(placement.width > 0 ? Math.min(maxUnit, width / placement.width) : 0);

  const knobs = $derived(encoderKnobs(placement));

  // reached with Tab: the one asked for, else the selected key, or the first one when none is (or the selection is not
  // on this board)
  const inRange = (i: number | undefined): i is number => i !== undefined && i >= 0 && i < placement.items.length;
  const focusIndex = $derived(inRange(tabStop) ? tabStop : inRange(selected) ? selected : 0);
</script>

<div class="keyboard" bind:clientWidth={width} aria-hidden={interactive ? undefined : "true"}>
  <div
    class="plate"
    role={interactive ? "group" : undefined}
    aria-label={interactive ? label : undefined}
    aria-describedby={interactive ? describedby : undefined}
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
      {#each placement.items as item, i (refId(item))}
        {#if item.kind === "key"}
          <Key {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            combos={combos[i] ?? []} found={highlights[i] ?? false} ring={rings[i] ?? null} faded={faded[i] ?? false}
            chosen={chosen?.[i]} {interactive} {compact} onselect={() => onselect(i)} />
        {:else}
          <Encoder {item} face={faces[i]} {u} selected={i === selected} label={labels[i]} focusable={i === focusIndex}
            found={highlights[i] ?? false} faded={faded[i] ?? false} chosen={chosen?.[i]} {interactive} {compact}
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
