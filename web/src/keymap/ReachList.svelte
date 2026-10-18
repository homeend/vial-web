<script lang="ts">
  import { unreachedReason, wayDetail, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { LayerReach } from "../analysis/reach";
  import { layerLabel } from "../keyboard/labels";
  import SectionTitle from "../ui/SectionTitle.svelte";

  interface Props {
    /** the layer shown */
    reach: LayerReach;
    ctx: PhraseContext;
  }

  let { reach, ctx }: Props = $props();

  const warning = $derived(unreachedReason(reach));
  const ways = $derived(reach.ways.map((w) => ({ label: wayLabel(w, ctx), detail: wayDetail(w, ctx) })));
</script>

<section class="reach" aria-labelledby="reach-title">
  <SectionTitle id="reach-title">How {layerLabel(reach.layer, ctx.names)} is reached</SectionTitle>
  {#if warning}
    <p class="warning" role="note">{warning}</p>
  {/if}
  {#if ways.length > 0}
    <ul>
      {#each ways as way, i (i)}
        <li>
          <span class="what">{way.label}</span>
          <span class="detail">{way.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .warning {
    margin: 0 0 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
    font-weight: 600;
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
    border-left: 3px solid color-mix(in srgb, var(--tone-layer) 55%, transparent);
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
