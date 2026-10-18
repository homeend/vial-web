<script lang="ts">
  import { unreachedReason, wayDetail, wayLabel, type PhraseContext } from "../analysis/phrases";
  import type { LayerReach } from "../analysis/reach";
  import { layerLabel } from "../keyboard/labels";

  interface Props {
    /** the layer shown */
    reach: LayerReach;
    ctx: PhraseContext;
    /** open or folded away: the same for every layer, until changed */
    open: boolean;
    ontoggle: (open: boolean) => void;
  }

  let { reach, ctx, open, ontoggle }: Props = $props();

  const title = $derived(`How ${layerLabel(reach.layer, ctx.names)} is reached`);
  const warning = $derived(unreachedReason(reach));
  const ways = $derived(reach.ways.map((w) => ({ label: wayLabel(w, ctx), detail: wayDetail(w, ctx) })));
</script>

<!-- above the keyboard, folded away by default: its summary line says how many ways in, or warns -->
<details
  class="reach"
  class:unreached={warning !== null}
  {open}
  ontoggle={(event) => ontoggle((event.currentTarget as HTMLDetailsElement).open)}
>
  <summary>
    <span class="title" id="reach-title">{title}</span>
    {#if warning}
      <span class="warning">{warning}</span>
    {:else}
      <span class="count">{ways.length === 1 ? "1 way" : `${ways.length} ways`}</span>
    {/if}
  </summary>
  <section aria-labelledby="reach-title">
    {#if ways.length > 0}
      <ul>
        {#each ways as way, i (i)}
          <li>
            <span class="what">{way.label}</span>
            <span class="detail">{way.detail}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">No key, tap dance or combo switches to this layer.</p>
    {/if}
  </section>
</details>

<style>
  .reach {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .reach.unreached {
    border-color: color-mix(in srgb, var(--warning-text) 35%, var(--border));
  }

  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 8px 12px;
    border-radius: 10px;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  /* the fold's arrow: right when folded, down when open */
  summary::before {
    content: "";
    width: 6px;
    height: 6px;
    margin: 0 2px;
    border-right: 2px solid var(--text-2);
    border-bottom: 2px solid var(--text-2);
    transform: rotate(-45deg);
    transition: transform 0.15s;
  }

  .reach[open] summary::before {
    transform: rotate(45deg);
  }

  summary:hover {
    background: var(--surface-2);
  }

  .title {
    font-size: 13px;
    font-weight: 650;
  }

  .count {
    color: var(--text-3);
    font-size: 12px;
  }

  .warning {
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12px;
    font-weight: 600;
  }

  section {
    padding: 2px 12px 12px 30px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    align-content: start;
    gap: 1px;
    padding-left: 10px;
    border-left: 3px solid color-mix(in srgb, var(--tone-layer) 55%, transparent);
  }

  .what {
    font-size: 13px;
    font-weight: 600;
  }

  .detail,
  .none {
    color: var(--text-3);
    font-size: 12px;
  }

  .none {
    margin: 0;
  }
</style>
