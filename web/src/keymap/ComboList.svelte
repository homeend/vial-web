<script lang="ts">
  import type { ComboUse } from "../analysis/combos";
  import { comboUseLabel, missingPartners } from "../analysis/phrases";
  import type { Names } from "../keyboard/labels";
  import SectionTitle from "../ui/SectionTitle.svelte";

  interface Props {
    /** the combos the selected key is part of, on the layer shown */
    uses: ComboUse[];
    names: Names;
    /** each combo's colour (a palette index), by combo index */
    colours: Map<number, number>;
    /** the key is transparent: the combos are those of the key below, which it falls through to */
    through?: boolean;
    /** open the combo's card on the Combos page */
    onopen: (index: number) => void;
  }

  let { uses, names, colours, through = false, onopen }: Props = $props();

  const entries = $derived(uses.map((use) => ({ use, missing: missingPartners(use, names) })));
  // a transparent key lets the combos of the key below through: those that can fire at all
  const firing = $derived(entries.filter((e) => e.missing === null).length);
</script>

<section class="combos" aria-labelledby="combos-title">
  <SectionTitle id="combos-title">Combos with this key</SectionTitle>
  {#if through && firing > 0}
    <p class="through">
      It falls through to the base layer's key, so {firing === entries.length ? "these combos still fire"
        : "the combos that can fire still do"}.
    </p>
  {/if}
  <ul>
    {#each entries as { use, missing } (use.combo.index)}
      <li style="--colour: var(--combo-{colours.get(use.combo.index) ?? 0})">
        <button type="button" title="Open combo {use.combo.index} on the Combos page" onclick={() => onopen(use.combo.index)}>
          <span class="what">{comboUseLabel(use, names)}</span>
          <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .through {
    margin: 0 0 8px;
    color: var(--text-3);
    font-size: 12px;
  }

  ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: grid;
    gap: 1px;
    width: 100%;
    padding: 4px 8px 4px 10px;
    border: 0;
    border-left: 3px solid var(--colour);
    border-radius: 0 8px 8px 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: var(--surface-2);
  }

  .what {
    font-size: 13px;
    font-weight: 600;
  }

  .detail {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
