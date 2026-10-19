<script lang="ts">
  import type { Described } from "../api/types";
  import { actionSummary, keyFace, type Names } from "../keyboard/labels";

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
  const what = $derived(set ? actionSummary(action, names).tap : "nothing");
</script>

<button
  {id}
  type="button"
  class="slot"
  class:set
  aria-label="{label}: {what} · change it"
  title="{label}: {set ? `${what} (${action.code})` : 'nothing'} · click to change"
  aria-disabled={busy || undefined}
  onclick={() => {
    if (!busy) onpick();
  }}
>
  <span class="how">{label}</span>
  <span class="what tone-{face.tone}" data-tone={face.tone}>{set ? face.main || action.code : "nothing"}</span>
  {#if set && face.hold}<span class="hold">{face.hold}</span>{/if}
</button>

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
