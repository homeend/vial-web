<script lang="ts">
  // The card on a tap dance or macro in the picker, shown at once while the key is pointed at or has the focus: what
  // it does, drawn (its slots or steps as keycaps). A screen reader hears the same from the key's description, so
  // the card itself is hidden from it.
  import type { Described } from "../api/types";
  import { stepVerb } from "../behaviours/macro";
  import { keyFace, type Names } from "../keyboard/labels";
  import type { EntryDetail } from "./offered";

  interface Props {
    detail: EntryDetail;
    /** the key it is about: the card goes above it, or below when there is no room above */
    anchor: HTMLElement;
    names: Names;
  }

  let { detail, anchor, names }: Props = $props();

  /** the most steps a macro's card shows; it says how many more there are */
  const MOST_STEPS = 6;
  /** from the key, and from the window's edges */
  const GAP = 10;
  const MARGIN = 8;

  let card = $state<HTMLDivElement>();
  let place = $state({ left: 0, top: 0, arrow: 0, above: true, ready: false });

  $effect(() => {
    if (!card) return;
    void detail; // placed again for another key or what it shows
    const key = anchor.getBoundingClientRect();
    const size = card.getBoundingClientRect();
    const above = key.top - size.height - GAP >= MARGIN;
    const left = Math.min(Math.max(MARGIN, key.left + key.width / 2 - size.width / 2),
      window.innerWidth - size.width - MARGIN);
    place = {
      left, top: above ? key.top - size.height - GAP : key.bottom + GAP, arrow: key.left + key.width / 2 - left,
      above, ready: true,
    };
  });

  function chip(d: Described): { label: string; hold: string | null; tone: string } {
    const face = keyFace(d, names);
    return { label: face.main || d.code, hold: face.hold, tone: face.tone };
  }
</script>

{#snippet keycap(d: Described)}
  {@const c = chip(d)}
  <span class="chip" data-tone={c.tone}>{c.label}{#if c.hold}<i>{c.hold}</i>{/if}</span>
{/snippet}

<div
  bind:this={card}
  class="entry-card"
  class:above={place.above}
  class:below={!place.above}
  data-tone={detail.kind}
  style:left="{place.left}px"
  style:top="{place.top}px"
  style:--arrow="{place.arrow}px"
  style:visibility={place.ready ? "visible" : "hidden"}
  aria-hidden="true"
>
  {#if detail.name}<p class="name">{detail.name}</p>{/if}
  {#if detail.kind === "tap-dance"}
    <div class="ways">
      {#each detail.slots as slot (slot.label)}
        <div class="way" class:off={!slot.action}>
          <span class="label">{slot.label}</span>
          {#if slot.action}{@render keycap(slot.action)}{:else}<span class="none">—</span>{/if}
        </div>
      {/each}
    </div>
    <div class="term">⏱ tapping term {detail.tappingTerm} ms</div>
  {:else}
    <ol class="steps">
      {#each detail.steps.slice(0, MOST_STEPS) as step, i (i)}
        <li>
          <span class="verb">{stepVerb(step)}</span>
          {#if step.type === "text"}
            <span class="text">“{(step.text ?? "").replace(/\n/g, "⏎").replace(/\t/g, "⇥")}”</span>
          {:else if step.type === "delay"}
            <span class="wait">⏱ {step.delay ?? 0} ms</span>
          {:else if step.keys.length === 0}
            <span class="none">no key yet</span>
          {:else}
            {#each step.keys as key, k (k)}{@render keycap(key)}{/each}
          {/if}
        </li>
      {/each}
      {#if detail.steps.length > MOST_STEPS}
        {@const more = detail.steps.length - MOST_STEPS}
        <li class="more">and {more} more {more === 1 ? "step" : "steps"}</li>
      {/if}
    </ol>
  {/if}
</div>

<style>
  .entry-card {
    position: fixed;
    z-index: 10;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    padding: 10px 12px 9px;
    border: 1.5px solid color-mix(in srgb, var(--tone) 70%, var(--border));
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 13px;
    text-align: left;
    pointer-events: none;
  }

  /* the arrow, towards the key */
  .entry-card::after {
    content: "";
    position: absolute;
    left: var(--arrow, 50%);
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border: inherit;
    border-width: 0 1.5px 1.5px 0;
    border-radius: 0;
    background: var(--surface);
  }

  .entry-card.above::after {
    bottom: -6.5px;
    transform: rotate(45deg);
  }

  .entry-card.below::after {
    top: -6.5px;
    transform: rotate(-135deg);
  }

  .name {
    margin: 0 0 7px;
    color: color-mix(in srgb, var(--tone) 75%, var(--text));
    font-weight: 650;
  }

  /* a tap dance: the four ways of pressing, two by two */
  .ways {
    display: grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 6px 8px;
  }

  .way {
    display: contents;
  }

  .label {
    color: var(--text-2);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .way > :nth-child(2) {
    justify-self: start;
  }

  .way:nth-child(odd) > :nth-child(2) {
    margin-right: 10px;
  }

  .way.off > * {
    opacity: 0.4;
  }

  .chip {
    display: inline-flex;
    align-items: baseline;
    justify-content: center;
    gap: 4px;
    min-width: 30px;
    max-width: 150px;
    padding: 3px 7px;
    overflow: hidden;
    border: 1.5px solid var(--line);
    border-radius: 6px;
    background: var(--fill);
    box-shadow: 0 1.5px 0 var(--key-shadow);
    color: var(--key-text);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip i {
    color: var(--text-2);
    font-size: 10.5px;
    font-style: normal;
    font-weight: 550;
  }

  .none {
    color: var(--text-3);
    font-size: 12px;
  }

  .term {
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid var(--border);
    color: var(--text-3);
    font-size: 11.5px;
  }

  /* a macro: its steps, in order */
  .steps {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 7px;
  }

  .verb {
    min-width: 54px;
    color: color-mix(in srgb, var(--tone-macro) 80%, var(--text));
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .text {
    max-width: 220px;
    padding: 2px 7px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wait {
    color: var(--text-2);
    font-size: 12px;
  }

  .more {
    color: var(--text-3);
    font-size: 11.5px;
  }
</style>
