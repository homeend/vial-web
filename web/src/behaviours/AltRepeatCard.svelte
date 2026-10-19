<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AltRepeatKey, Described } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import {
    ALT_REPEAT_OPTIONS, altRepeatIsSet, altRepeatSentence, type AltRepeatDraft,
  } from "./overrides";
  import { replayed } from "./target.svelte";

  interface Props {
    entry: AltRepeatKey;
    /** while it is edited: what the editor holds */
    draft: AltRepeatDraft | null;
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

  let { entry, draft, names, canEdit, busy, target, editor, onedit }: Props = $props();

  const headingId = $derived(`alt-repeat-${entry.index}-title`);
  const shown = $derived<AltRepeatDraft>(draft ?? entry);
  const sentence = $derived(altRepeatSentence(shown, names));
  const isNew = $derived(!altRepeatIsSet(entry));
  /** the options set, by their labels */
  const options = $derived(ALT_REPEAT_OPTIONS.filter((o) => shown.options & o.bit).map((o) => o.label));

  /** empty: "nothing", or for the last key of a default alt key (which answers for every key no entry covers),
   * "any key" */
  function face(d: Described, empty = "nothing") {
    const f = keyFace(d, names);
    return { tone: f.tone, text: d.kind === "none" ? empty : f.main || d.code };
  }
  const isDefault = $derived((shown.options & ALT_REPEAT_OPTIONS[0].bit) !== 0);
  const from = $derived(face(shown.keycode, isDefault ? "any key" : "nothing"));
  const to = $derived(face(shown.altKeycode));
  /** both ways: only with an alt key to go back from, and a last key to go back to (with none, Alt Repeat sends
   * nothing after the alt key: the sentence says so) */
  const both = $derived((shown.options & ALT_REPEAT_OPTIONS[1].bit) !== 0 && shown.altKeycode.kind !== "none" &&
    shown.keycode.kind !== "none");
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing={draft !== null}
  class:off={!shown.enabled} id="alt-repeat-{entry.index}" aria-labelledby={headingId}>
  <EntryHead id="AR {entry.index}" {headingId} name={null} tone="override" {canEdit}>
    {#snippet actions()}
      {#if !shown.enabled && !isNew}<span class="state" title="Switched off: it does nothing until it is switched on">Off</span>{/if}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>
  {#if isNew && draft}
    <p class="new"><strong>New alt-repeat key:</strong> nothing is kept until you save it. Cancel, and it is gone.</p>
  {/if}

  {#if editor}
    {@render editor()}
  {:else}
    <div class="row" aria-hidden="true">
      <span class="out tone-{from.tone}" data-tone={from.tone} title={from.text}>{from.text}</span>
      <span class="arrow">{both ? "⇄" : "→"}</span>
      <span class="out tone-{to.tone}" data-tone={to.tone} title={to.text}>{to.text}</span>
    </div>
    {#if options.length > 0}
      <p class="details">{options.join(" · ")}</p>
    {/if}
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

  .arrow {
    color: var(--text-3);
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
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
