<script lang="ts">
  import { tick } from "svelte";
  import type { Combo, Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import ComboKeys from "./ComboKeys.svelte";
  import EntryHead from "./EntryHead.svelte";
  import { MAX_COMBO_KEYS, membersOf } from "./members";
  import { replayed } from "./target.svelte";

  interface Props {
    combo: Combo;
    model: KeyboardModel;
    placement: Placement;
    names: Names;
    /** its colour: a palette index */
    colour: number;
    /** what it does, in words, and why it may not fire */
    sentence: string;
    notes: string[];
    canEdit: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** being edited: the keycodes and output chosen so far */
    draft: { members: Described[]; output: Described } | null;
    /** why the last key clicked wasn't taken, while editing */
    problem: string | null;
    onedit: () => void;
    onchoose: (d: Described) => void;
    onremove: (code: string) => void;
    onaddbycode: () => void;
    onpickoutput: () => void;
    onsave: () => void;
    oncancel: () => void;
    onclear: () => void;
  }

  let {
    combo, model, placement, names, colour, sentence, notes, canEdit, busy, target, draft, problem, onedit, onchoose,
    onremove, onaddbycode, onpickoutput, onsave, oncancel, onclear,
  }: Props = $props();

  const headingId = $derived(`combo-${combo.index}-title`);
  // the keycodes the firmware reads: up to the first empty slot
  const members = $derived(draft ? draft.members : membersOf(combo));
  // a keycode listed twice (the editor lists each once) never gives two chips the same key
  const chips = $derived(members.map((m, i) => ({
    m, key: members.findIndex((other) => other.code === m.code) === i ? m.code : `${m.code}#${i}`,
  })));
  const output = $derived(draft ? draft.output : combo.output);
  const outputFace = $derived(keyFace(output, names));
  const outputText = $derived(output.kind === "none" ? "nothing" : outputFace.main || output.code);
  /** a combo of no keys never fires: it isn't saved (Remove the combo clears it) */
  const noKeys = $derived(draft !== null && draft.members.length === 0);
  let chipList = $state<HTMLUListElement>();

  /** Takes a keycode out. Its chip goes: the focus goes to the chip now in its place, or the one before, or (none is
   * left) Add by keycode */
  async function removeChip(code: string, at: number) {
    if (busy) return;
    onremove(code);
    await tick();
    const buttons = chipList?.querySelectorAll<HTMLElement>("button.remove") ?? [];
    (buttons[Math.min(at, buttons.length - 1)] ?? document.getElementById(`combo-${combo.index}-add`))?.focus();
  }
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing={draft !== null} id="combo-{combo.index}" aria-labelledby={headingId}
  style="--colour: var(--combo-{colour})">
  <EntryHead id="Combo {combo.index}" {headingId} name={null} tone="combo" {canEdit}>
    {#snippet actions()}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onedit}>Edit</Button>
      {/if}
    {/snippet}
  </EntryHead>

  <p class="sentence">{sentence}</p>

  {#if draft}
    <div class="editor">
      <p class="hint" id="combo-{combo.index}-hint">
        Click keys to add them to the combo, or click them again to take them out (at most {MAX_COMBO_KEYS}). Arrow keys
        move between them.
      </p>
      <div class="board">
        <ComboKeys {model} {placement} {names} {members} {colour} choosing {onchoose} maxUnit={44}
          label="Keys of combo {combo.index}" describedby="combo-{combo.index}-hint" />
      </div>
      <p class="problem" role="status">{problem ?? ""}</p>
      <div class="parts">
        <div class="part">
          <span class="part-label">Keys</span>
          <ul class="chips" bind:this={chipList}>
            {#each chips as { m, key }, i (key)}
              <li>
                <span class="chip">{m.tap || m.code}</span>
                <button type="button" class="remove" aria-label="Take {m.tap || m.code} out of the combo"
                  aria-disabled={busy || undefined} onclick={() => void removeChip(m.code, i)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </li>
            {/each}
          </ul>
          <Button id="combo-{combo.index}-add" size="sm" disabled={members.length >= MAX_COMBO_KEYS}
            aria-disabled={busy || undefined} onclick={onaddbycode}>Add by keycode…</Button>
        </div>
        <div class="part">
          <span class="part-label">Output</span>
          <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone} title={outputText}>{outputText}</span>
          <Button size="sm" aria-disabled={busy || undefined} onclick={onpickoutput}>Change output…</Button>
        </div>
      </div>
      <div class="buttons">
        <Button variant="danger" disabled={!canEdit} aria-disabled={busy || undefined} onclick={onclear}>
          Remove the combo
        </Button>
        <span class="spacer"></span>
        {#if noKeys}<span class="needs" id="combo-{combo.index}-needs">Choose at least one key</span>{/if}
        <Button aria-disabled={busy || undefined} onclick={oncancel}>Cancel</Button>
        <Button variant="primary" disabled={!canEdit || noKeys} aria-disabled={busy || undefined}
          aria-describedby={noKeys ? `combo-${combo.index}-needs` : undefined} onclick={onsave}>Save</Button>
      </div>
    </div>
  {:else}
    <div class="row">
      <ComboKeys {model} {placement} {names} {members} {colour} label="Keys of combo {combo.index}: {sentence}" />
      <span class="arrow" aria-hidden="true">→</span>
      <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone} title={outputText}>{outputText}</span>
    </div>
    {#if notes.length > 0}
      <ul class="notes">
        {#each notes as note (note)}<li>{note}</li>{/each}
      </ul>
    {/if}
  {/if}
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css), in the combo's colour, which also marks its left edge */
  .card {
    --card-accent: var(--colour);
    padding-left: 18px;
    border-left: 4px solid var(--colour);
  }

  .sentence {
    margin: 0;
    color: var(--text-2);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 360px) auto auto;
    align-items: center;
    justify-content: start;
    gap: 14px;
  }

  @media (max-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
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

  .notes {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 6px 10px 6px 26px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .editor {
    display: grid;
    gap: 10px;
  }

  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .board {
    padding: 14px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--board-bg);
  }

  .problem {
    min-height: 1.4em;
    margin: -4px 0 0;
    color: var(--warning-text);
    font-size: 12.5px;
  }

  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 28px;
  }

  .part {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .part-label {
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chips li {
    display: inline-flex;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--colour) 50%, var(--border));
    border-radius: 7px;
    background: color-mix(in srgb, var(--colour) 8%, var(--surface));
  }

  .chip {
    padding: 2px 4px 2px 9px;
    font-weight: 650;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .remove:hover {
    color: var(--danger);
  }

  .remove[aria-disabled="true"] {
    cursor: progress;
  }

  .remove svg {
    width: 11px;
    height: 11px;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .spacer {
    flex: 1;
  }

  .needs {
    align-self: center;
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
