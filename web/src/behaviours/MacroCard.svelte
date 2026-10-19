<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Use } from "../analysis/usage";
  import type { Macro } from "../api/types";
  import type { Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import EntryHead from "./EntryHead.svelte";
  import { replayed } from "./target.svelte";
  import { macroBytes } from "./macro";
  import StepChain from "./StepChain.svelte";
  import UsedOn from "./UsedOn.svelte";

  interface Props {
    macro: Macro;
    names: Names;
    positions: Map<string, string>;
    uses: Use[];
    vialProtocol: number;
    canEdit: boolean;
    /** a change is being saved: Edit keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** the step editor, while this macro is edited */
    editor?: Snippet;
    onedit: () => void;
    onrename: () => void;
    onopenuse: (use: Use) => void;
  }

  let {
    macro, names, positions, uses, vialProtocol, canEdit, busy, target, editor, onedit, onrename, onopenuse,
  }: Props = $props();

  const headingId = $derived(`macro-${macro.index}-title`);
  const bytes = $derived(macroBytes(macro.actions, vialProtocol));
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} id="macro-{macro.index}" aria-labelledby={headingId}>
  <EntryHead id="M {macro.index}" {headingId} name={macro.name} tone="macro" {canEdit} {onrename}
    renameLabel="Rename macro {macro.index}">
    {#snippet actions()}
      {#if !editor}
        <span class="bytes">{bytes} {bytes === 1 ? "byte" : "bytes"}</span>
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  {#if editor}
    {@render editor()}
  {:else}
    <StepChain steps={macro.actions} />
  {/if}

  <UsedOn {uses} {names} {positions} keycode="M{macro.index}" onopen={onopenuse} />
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css) */
  .card {
    --card-accent: var(--tone-macro);
  }

  .bytes {
    align-self: center;
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
</style>
