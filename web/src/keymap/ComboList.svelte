<script lang="ts">
  import type { ComboUse } from "../analysis/combos";
  import { comboUseLabel, missingPartners } from "../analysis/phrases";
  import type { Names } from "../keyboard/labels";
  import SectionTitle from "../ui/SectionTitle.svelte";

  interface Props {
    /** the combos the selected key is part of, on the layer shown */
    uses: ComboUse[];
    names: Names;
    /** the key is transparent: the combos are those of the key below, which it falls through to */
    through?: boolean;
  }

  let { uses, names, through = false }: Props = $props();
</script>

<section class="combos" aria-labelledby="combos-title">
  <SectionTitle id="combos-title">Combos with this key</SectionTitle>
  {#if through}<p class="through">It falls through to the base layer's key, so these combos still fire.</p>{/if}
  <ul>
    {#each uses as use (use.combo.index)}
      {@const missing = missingPartners(use, names)}
      <li>
        <span class="what">{comboUseLabel(use, names)}</span>
        <span class="detail">Combo {use.combo.index}{missing ? ` · ${missing}` : ""}</span>
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
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    gap: 1px;
    padding-left: 10px;
    border-left: 3px solid var(--combo);
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
