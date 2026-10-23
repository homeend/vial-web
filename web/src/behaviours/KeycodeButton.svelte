<script lang="ts">
  import type { Described } from "../api/types";
  import KeyTipCard from "../keyboard/KeyTipCard.svelte";
  import { keyFace, keyTitle, type Names } from "../keyboard/labels";
  import { slotTip } from "../keyboard/tip";
  import { tipHandlers } from "../ui/tipping";

  interface Props {
    id?: string;
    /** what the keycode is for: "Trigger" */
    label: string;
    action: Described;
    names: Names;
    /** a change is being saved: the button keeps the focus, but takes nothing until it is done */
    busy: boolean;
    /** opens the keycode picker */
    onpick: () => void;
  }

  let { id, label, action, names, busy, onpick }: Props = $props();
  const set = $derived(action.kind !== "none");
  const face = $derived(keyFace(action, names));
  /** what it does, the hold too: "A — hold for Layer 2" */
  const what = $derived(set ? keyTitle(action, names) : "nothing");
  /** the button, while it is pointed at or reached with the keyboard: its tip shows */
  let tipped = $state<HTMLElement | null>(null);
  const tipping = tipHandlers((el) => (tipped = el), () => (tipped = null));
</script>

<button
  {id}
  type="button"
  class="slot"
  class:set
  aria-label="{label}: {what} · change it"
  aria-disabled={busy || undefined}
  onclick={() => {
    if (!busy) onpick();
  }}
  {...tipping}
>
  <span class="how">{label}</span>
  <span class="what tone-{face.tone}" data-tone={face.tone}>{set ? face.main || action.code : "nothing"}</span>
  {#if set && face.hold}<span class="hold">{face.hold}</span>{/if}
</button>
{#if tipped}
  <KeyTipCard tip={slotTip(label, action, names)} anchor={tipped} {names} />
{/if}

<style>
  /* as a tap dance's slots */
  .slot {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 3px;
    width: 100%;
    min-width: 0;
    min-height: 68px;
    padding: 7px 8px 9px;
    border: 1px dashed var(--border-strong);
    border-radius: 9px;
    background: transparent;
    text-align: center;
    cursor: pointer;
  }

  .slot.set {
    border-style: solid;
    border-color: var(--border);
    background: var(--board-bg);
  }

  .slot:hover {
    border-color: var(--accent);
  }

  .slot[aria-disabled="true"] {
    cursor: progress;
  }

  .how {
    color: var(--text-3);
    font-size: 11.5px;
    font-weight: 600;
  }

  .what {
    max-width: 100%;
    overflow: hidden;
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--fill);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot:not(.set) .what {
    border: 0;
    background: none;
    color: var(--text-3);
    font-size: 12.5px;
    font-weight: 450;
  }

  .hold {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
