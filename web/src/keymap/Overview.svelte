<script lang="ts">
  import { comboMarksOf, type Analysis } from "../analysis/analysis";
  import { unreachedReason, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { EMPTY_FACE, keyFace, layerLabel } from "../keyboard/labels";
  import { actionAt, refId } from "../keyboard/refs";
  import KindLegend from "./KindLegend.svelte";
  import LayerCard from "./LayerCard.svelte";

  interface Props {
    model: KeyboardModel;
    /** the model, its names and the key positions, for the labels saying how each layer is reached */
    phrases: PhraseContext;
    placement: Placement;
    analysis: Analysis;
    /** by layer: the keys (refIds) the find box highlights */
    highlighted: Set<string>[];
    /** the layer the Edit view shows */
    current: number;
    onopen: (layer: number) => void;
  }

  let { model, phrases, placement, analysis, highlighted, current, onopen }: Props = $props();

  const names = $derived(phrases.names);

  // small keyboards show the tap action only (compact keys): the colour says what kind of key it is
  const cards = $derived(
    model.layers.map((layer) => {
      const reach = analysis.reach[layer.index];
      return {
        index: layer.index,
        title: layerLabel(layer.index, names),
        reachedBy: reach ? reach.ways.map((w) => wayLabel(w, phrases)) : [],
        warning: reach ? unreachedReason(reach) : null,
        faces: placement.items.map((item) => {
          const d = actionAt(model, layer.index, item);
          return d ? keyFace(d, names) : EMPTY_FACE;
        }),
        combos: comboMarksOf(analysis, placement, layer.index).colours,
      };
    }),
  );
  // apart from the cards: typing in the find box changes only these
  const highlights = $derived(
    model.layers.map((layer) => placement.items.map((item) => highlighted[layer.index]?.has(refId(item)) ?? false)),
  );

  const unused = $derived([
    ...analysis.unused.tapDances.map((i) => {
      const name = names.tapDance(i);
      return `Tap dance ${i}${name ? ` · ${name}` : ""} is set up, but nothing uses it.`;
    }),
    ...analysis.unused.macros.map((i) => {
      const name = names.macro(i);
      return `Macro ${i}${name ? ` · ${name}` : ""} is set up, but nothing uses it.`;
    }),
  ]);
</script>

<div class="overview" role="region" aria-label="Overview of the layers">
  <p class="limit">
    Layer switching done in the keyboard's firmware code (for example a tri-layer made in code with
    <code>update_tri_layer_state</code>, or <code>layer_state_set_user</code>) can't be seen over the Vial protocol, so
    it isn't shown here.
  </p>
  <div class="layers">
    {#each cards as card (card.index)}
      <LayerCard
        index={card.index}
        title={card.title}
        reachedBy={card.reachedBy}
        warning={card.warning}
        {placement}
        faces={card.faces}
        combos={card.combos}
        highlights={highlights[card.index] ?? []}
        current={card.index === current}
        onopen={() => onopen(card.index)}
      />
    {/each}
  </div>

  <KindLegend />

  {#if unused.length > 0}
    <section class="notes" aria-labelledby="unused-title">
      <h2 id="unused-title">Not used</h2>
      <ul>
        {#each unused as note (note)}
          <li>{note}</li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .overview {
    display: grid;
    gap: 14px;
    container: overview / inline-size;
  }

  .layers {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  /* two to a row once the small keyboards stay big enough to read (about 30 px a key for a Corne) */
  @container overview (min-width: 760px) {
    .layers {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .notes {
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .notes h2 {
    margin: 0 0 4px;
    font-size: 13px;
  }

  .notes ul {
    margin: 0;
    padding-left: 18px;
  }

  .limit {
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
