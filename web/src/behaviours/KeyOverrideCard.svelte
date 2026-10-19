<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Described, KeyOverride } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import {
    keyOverrideDetails, keyOverrideIsSet, keyOverrideProblems, keyOverrideSentence, modNames, type KeyOverrideDraft,
  } from "./overrides";
  import { replayed } from "./target.svelte";

  interface Props {
    override: KeyOverride;
    /** while it is edited: what the editor holds */
    draft: KeyOverrideDraft | null;
    layerCount: number;
    names: Names;
    canEdit: boolean;
    /** a change is being saved: Edit keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** the editor, while it is edited */
    editor?: Snippet;
    onedit: () => void;
  }

  let { override, draft, layerCount, names, canEdit, busy, target, editor, onedit }: Props = $props();

  const headingId = $derived(`key-override-${override.index}-title`);
  /** what is shown: the editor's version while editing */
  const shown = $derived<KeyOverrideDraft>(draft ?? override);
  const sentence = $derived(keyOverrideSentence(shown, layerCount, names));
  const details = $derived(keyOverrideDetails(shown));
  const problems = $derived(keyOverrideProblems(shown, layerCount));
  /** a new one: nothing of it is on the keyboard yet */
  const isNew = $derived(!keyOverrideIsSet(override));
  const mods = $derived(modNames(shown.triggerMods));
  /** why it can't work: not for an empty one not being edited, nor while a draft has no trigger yet (its sentence
   * says so, and it can't be saved); one on the keyboard with no trigger is told that it starts on every key press */
  const showProblems = $derived(problems.length > 0 && (!isNew || draft !== null) &&
    !(draft !== null && shown.trigger.kind === "none" && shown.triggerMods === 0));

  function face(d: Described) {
    const f = keyFace(d, names);
    return { tone: f.tone, text: d.kind === "none" ? "nothing" : f.main || d.code };
  }
  const trigger = $derived(face(shown.trigger));
  const replacement = $derived(face(shown.replacement));
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing={draft !== null}
  class:off={!shown.enabled} id="key-override-{override.index}" aria-labelledby={headingId}>
  <EntryHead id="KO {override.index}" {headingId} name={null} tone="override" {canEdit}>
    {#snippet actions()}
      {#if !shown.enabled && !isNew}<span class="state" title="Switched off: it does nothing until it is switched on">Off</span>{/if}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>
  {#if isNew && draft}
    <p class="new">
      <strong>New key override:</strong> nothing is kept until you save it. Cancel, and it is gone.
    </p>
  {/if}

  {#if editor}
    {@render editor()}
  {:else}
    <div class="row" aria-hidden="true">
      <span class="from">
        {#each mods as mod (mod)}<span class="mod">{mod}</span><span class="plus">+</span>{/each}
        <span class="out tone-{trigger.tone}" data-tone={trigger.tone} title={trigger.text}>{trigger.text}</span>
      </span>
      <span class="arrow">→</span>
      <span class="out tone-{replacement.tone}" data-tone={replacement.tone} title={replacement.text}>{replacement.text}</span>
    </div>
    {#if details.length > 0}
      <ul class="details">
        {#each details as detail (detail)}<li>{detail}</li>{/each}
      </ul>
    {/if}
  {/if}
  {#if showProblems}
    <ul class="problems">
      {#each problems as problem (problem)}<li>{problem}</li>{/each}
    </ul>
  {/if}
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css) */
  .card {
    --card-accent: var(--accent);
  }

  .sentence {
    margin: 0;
    color: var(--text-2);
  }

  .off:not(.editing) .row {
    opacity: 0.55;
  }

  .state {
    align-self: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
  }

  .new {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 8px;
    background: var(--accent-weak);
    color: var(--text);
    font-size: 13px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }

  .from {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .mod {
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--tone-mod) 60%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--tone-mod) 12%, var(--surface));
    font-size: 13px;
    font-weight: 650;
    white-space: nowrap;
  }

  .plus,
  .arrow {
    color: var(--text-3);
  }

  .arrow {
    font-size: 20px;
  }

  .out {
    max-width: 220px;
    overflow: hidden;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--fill);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .details {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-3);
    font-size: 12.5px;
  }

  .details li + li::before {
    content: "·";
    margin: 0 8px 0 -10px;
  }

  .problems {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 6px 10px 6px 26px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

</style>
