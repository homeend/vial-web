<script lang="ts">
  // The tip on a key (tip.ts: KeyTip), in a Tip card next to it: what the key is, where it is, the ways of pressing
  // it (a tap dance's four, drawn as keycaps; a tap and a hold in words), a macro's steps, its notes and keycode.
  import type { Described } from "../api/types";
  import { stepVerb } from "../behaviours/macro";
  import Tip from "../ui/Tip.svelte";
  import { keyFace, type Names } from "./labels";
  import type { KeyTip } from "./tip";

  interface Props {
    tip: KeyTip;
    /** the key it is about */
    anchor: HTMLElement;
    names: Names;
  }

  let { tip, anchor, names }: Props = $props();

  /** the most steps a macro's card shows; it says how many more there are */
  const MOST_STEPS = 6;

  function chip(d: Described): { label: string; hold: string | null; tone: string } {
    const face = keyFace(d, names);
    return { label: face.main || d.code, hold: face.hold, tone: face.tone };
  }

  const asCaps = $derived(tip.ways?.some((w) => "action" in w) ?? false);
</script>

{#snippet keycap(d: Described)}
  {@const c = chip(d)}
  <span class="chip" data-tone={c.tone}>{c.label}{#if c.hold}<i>{c.hold}</i>{/if}</span>
{/snippet}

<Tip {anchor} tone={tip.tone}>
  <div class="key-tip">
    <p class="title">{tip.title}</p>
    {#if tip.place}<p class="place">{tip.place}</p>{/if}
    {#if tip.ways && tip.ways.length > 0}
      <div class="ways" class:caps={asCaps} class:words={!asCaps}>
        {#each tip.ways as way (way.label)}
          <div class="way" class:off={"action" in way && !way.action}>
            <span class="label">{way.label}</span>
            {#if "text" in way}
              <span class="text">{way.text}</span>
            {:else if way.action}
              {@render keycap(way.action)}
            {:else}
              <span class="none">—</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if tip.tappingTerm !== undefined}
      <div class="term">⏱ tapping term {tip.tappingTerm} ms</div>
    {/if}
    {#if tip.steps}
      <ol class="steps">
        {#each tip.steps.slice(0, MOST_STEPS) as step, i (i)}
          <li>
            <span class="verb">{stepVerb(step)}</span>
            {#if step.type === "text"}
              <span class="macro-text">“{(step.text ?? "").replace(/\n/g, "⏎").replace(/\t/g, "⇥")}”</span>
            {:else if step.type === "delay"}
              <span class="wait">⏱ {step.delay ?? 0} ms</span>
            {:else if step.keys.length === 0}
              <span class="none">no key yet</span>
            {:else}
              {#each step.keys as key, k (k)}{@render keycap(key)}{/each}
            {/if}
          </li>
        {/each}
        {#if tip.steps.length > MOST_STEPS}
          {@const more = tip.steps.length - MOST_STEPS}
          <li class="more">and {more} more {more === 1 ? "step" : "steps"}</li>
        {/if}
      </ol>
    {/if}
    {#if tip.notes || tip.code}
      <div class="foot">
        {#if tip.notes}{#each tip.notes as note, i (i)}<span class="note">{note}</span>{/each}{/if}
        {#if tip.code}<code>{tip.code}</code>{/if}
      </div>
    {/if}
  </div>
</Tip>

<style>
  .key-tip {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title {
    margin: 0;
    color: color-mix(in srgb, var(--tone) 65%, var(--text));
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  .place {
    margin: -4px 0 0;
    color: var(--text-3);
    font-size: 11.5px;
  }

  /* a tap dance: the four ways of pressing, two by two */
  .ways.caps {
    display: grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 6px 8px;
    margin-top: 2px;
  }

  .ways.caps .way {
    display: contents;
  }

  .ways.caps .way > :nth-child(2) {
    justify-self: start;
  }

  .ways.caps .way:nth-child(odd) > :nth-child(2) {
    margin-right: 10px;
  }

  /* a tap and a hold, in words, one under the other */
  .ways.words {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
  }

  .ways.words .way {
    display: contents;
  }

  .label {
    color: var(--text-2);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .text {
    overflow-wrap: anywhere;
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
    margin-top: 2px;
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
    margin: 2px 0 0;
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

  .macro-text {
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

  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    align-items: baseline;
    justify-content: space-between;
    margin-top: 1px;
    color: var(--text-3);
    font-size: 11.5px;
  }

  .note {
    overflow-wrap: anywhere;
  }

  .foot code {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
  }
</style>
