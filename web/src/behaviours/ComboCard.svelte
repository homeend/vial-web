<script lang="ts">
  import type { Combo, Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import { keyFace, type Names } from "../keyboard/labels";
  import Button from "../ui/Button.svelte";
  import ComboKeys from "./ComboKeys.svelte";
  import EntryHead from "./EntryHead.svelte";
  import { MAX_COMBO_KEYS } from "./members";

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
    combo, model, placement, names, colour, sentence, notes, canEdit, target, draft, problem, onedit, onchoose, onremove,
    onaddbycode, onpickoutput, onsave, oncancel, onclear,
  }: Props = $props();

  const headingId = $derived(`combo-${combo.index}-title`);
  const members = $derived(draft ? draft.members : combo.keys.filter((k) => k.kind !== "none"));
  const output = $derived(draft ? draft.output : combo.output);
  const outputFace = $derived(keyFace(output, names));
</script>

<article class="card" class:target class:editing={draft !== null} id="combo-{combo.index}" aria-labelledby={headingId}
  style="--colour: var(--combo-{colour})">
  <EntryHead id="Combo {combo.index}" {headingId} name={null} tone="combo" {canEdit}>
    {#snippet actions()}
      {#if !draft}
        <Button size="sm" disabled={!canEdit} onclick={onedit}>Edit</Button>
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
      <div class="board" aria-describedby="combo-{combo.index}-hint">
        <ComboKeys {model} {placement} {names} {members} {colour} choosing {onchoose} maxUnit={44} />
      </div>
      <p class="problem" role="status">{problem ?? ""}</p>
      <div class="parts">
        <div class="part">
          <span class="part-label">Keys</span>
          <ul class="chips">
            {#each members as m (m.code)}
              <li>
                <span class="chip">{m.tap || m.code}</span>
                <button type="button" class="remove" aria-label="Take {m.tap || m.code} out of the combo"
                  onclick={() => onremove(m.code)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </li>
            {/each}
          </ul>
          <Button size="sm" disabled={members.length >= MAX_COMBO_KEYS} onclick={onaddbycode}>Add by keycode…</Button>
        </div>
        <div class="part">
          <span class="part-label">Output</span>
          <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone}>{output.kind === "none" ? "nothing" : outputFace.main || output.code}</span>
          <Button size="sm" onclick={onpickoutput}>Change output…</Button>
        </div>
      </div>
      <div class="buttons">
        <Button variant="danger" disabled={!canEdit} onclick={onclear}>Remove the combo</Button>
        <span class="spacer"></span>
        <Button onclick={oncancel}>Cancel</Button>
        <Button variant="primary" disabled={!canEdit} onclick={onsave}>Save</Button>
      </div>
    </div>
  {:else}
    <div class="row">
      <ComboKeys {model} {placement} {names} {members} {colour} label="Keys of combo {combo.index}: {sentence}" />
      <span class="arrow" aria-hidden="true">→</span>
      <span class="out tone-{outputFace.tone}" data-tone={outputFace.tone}>{output.kind === "none" ? "nothing" : outputFace.main || output.code}</span>
    </div>
    {#if notes.length > 0}
      <ul class="notes">
        {#each notes as note (note)}<li>{note}</li>{/each}
      </ul>
    {/if}
  {/if}
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px 14px 18px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--colour);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    scroll-margin-top: 80px;
  }

  .card.target {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--colour) 55%, transparent), var(--shadow);
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
</style>
