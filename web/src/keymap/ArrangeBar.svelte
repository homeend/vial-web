<script lang="ts">
  import type { UnfinishedArrange } from "../api/types";
  import type { ArrangeStop } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import { stoppedText } from "./arrange";

  interface Props {
    unfinished: UnfinishedArrange;
    /** what of this tab's stopped it, and why (keyboard.unfinishedStop), or null when not known */
    stop: ArrangeStop | null;
    canEdit: boolean;
    onfinish: () => Promise<boolean>;
    onputback: () => Promise<boolean>;
  }

  let { unfinished, stop, canEdit, onfinish, onputback }: Props = $props();

  let working = $state<"finish" | "put-back" | null>(null);
  /** why the buttons do nothing just now */
  const blocked = $derived(canEdit ? undefined : "The keyboard can't be changed just now.");

  async function run(kind: "finish" | "put-back", act: () => Promise<boolean>) {
    if (working !== null || !canEdit) return;
    working = kind;
    try {
      await act();
    } finally {
      working = null;
    }
  }
</script>

<!-- until Finish or Put back succeeds: the keyboard may hold part of the new order. The buttons stay (keeping the
     focus) while one runs; the bar goes once it is done, and the focus with it goes to the page's heading. -->
<div class="bar" role="region" aria-label="Arranging the layers stopped">
  <p>{stoppedText(unfinished, stop?.kind ?? null, stop?.cause)}</p>
  <!-- aria-disabled rather than disabled, so that their tooltips say why they do nothing -->
  <div class="buttons">
    <Button class={!canEdit && working === null ? "off" : undefined} title={blocked}
      aria-disabled={working !== null || !canEdit || undefined} onclick={() => void run("put-back", onputback)}>
      {working === "put-back" ? "Putting back…" : "Put back"}
    </Button>
    <Button variant="primary" class={!canEdit && working === null ? "off" : undefined} title={blocked}
      aria-disabled={working !== null || !canEdit || undefined} onclick={() => void run("finish", onfinish)}>
      {working === "finish" ? "Finishing…" : "Finish"}
    </Button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--warning-text) 25%, var(--border));
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  p {
    flex: 1 1 320px;
    min-width: 0;
    margin: 0;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  /* a button that can't be used just now: no progress cursor (a write waited for) nor hover */
  .buttons :global(.btn.off[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .buttons :global(.btn.off[aria-disabled="true"]:hover) {
    background: var(--surface);
  }

  .buttons :global(.btn.primary.off[aria-disabled="true"]:hover) {
    background: var(--accent);
  }
</style>
