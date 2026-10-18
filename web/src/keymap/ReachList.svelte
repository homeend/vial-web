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

  const name = $derived(layerLabel(reach.layer, ctx.names));
  const warning = $derived(unreachedReason(reach));
  const ways = $derived(reach.ways.map((w) => ({ label: wayLabel(w, ctx), detail: wayDetail(w, ctx) })));
</script>

<!-- above the keyboard, folded away by default: its summary line shows the first way in and how many more, or
     warns; opened, it lists them all -->
<details
  class="reach"
  class:unreached={warning !== null}
  {open}
  ontoggle={(event) => ontoggle((event.currentTarget as HTMLDetailsElement).open)}
>
  <summary>
    <span class="title" id="reach-title">How <span class="name" title={name}>{name}</span> is reached</span>
    {#if warning}
      <span class="warning">{warning}</span>
    {/if}
    {#if open || ways.length === 0}
      {#if !warning}<span class="count">{ways.length === 1 ? "1 way" : `${ways.length} ways`}</span>{/if}
    {:else}
      <span class="first" title={ways[0].label}>{ways[0].label}</span>
      {#if ways.length > 1}<span class="more">+{ways.length - 1} more</span>{/if}
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
    flex: none;
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
    flex: none;
    font-size: 13px;
    font-weight: 650;
    white-space: nowrap;
  }

  /* a long layer name is cut short; the tooltip has all of it */
  .name {
    display: inline-block;
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }

  /* the first way in, at the right end of the line, with how many more there are */
  .first {
    flex: 0 1 auto;
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    flex: none;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
  }

  summary:hover .more {
    background: var(--surface);
  }

  .count {
    color: var(--text-3);
    font-size: 12px;
  }

  .warning {
    flex: none;
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
