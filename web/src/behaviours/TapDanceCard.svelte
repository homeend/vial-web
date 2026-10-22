<script lang="ts">
  import type { Use } from "../analysis/usage";
  import type { Described, KeyboardModel, TapDance } from "../api/types";
  import { keyFace, keyTitle, type Names } from "../keyboard/labels";
  import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
  import EntryHead from "./EntryHead.svelte";
  import { replayed } from "./target.svelte";
  import { tapDanceIsSet } from "./entries";
  import { tapDanceSentence } from "./sentences";
  import UsedOn from "./UsedOn.svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    td: TapDance;
    /** the keyboard, for its layers: a slot's layer it doesn't have says so */
    model: Pick<KeyboardModel, "layers">;
    names: Names;
    positions: Map<string, string>;
    uses: Use[];
    canEdit: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    /** the card opened from elsewhere: drawn out for a moment (the highlight fades) */
    target: boolean;
    /** the tap dance being worked on: the card keeps its highlight */
    editing: boolean;
    /** choose what a slot does (with the keycode picker) */
    onpickslot: (slot: SlotLabel) => void;
    onclearslot: (slot: SlotLabel) => void;
    /** empty all four slots (the tapping term stays) */
    onclear: () => void;
    /** resolves to whether the keyboard took it */
    onterm: (ms: number) => Promise<boolean>;
    onrename: () => void;
    onopenuse: (use: Use) => void;
  }

  let {
    td, model, names, positions, uses, canEdit, busy, target, editing, onpickslot, onclearslot, onclear, onterm, onrename,
    onopenuse,
  }: Props = $props();

  /** the longest tapping term the server takes (schemas.TAPPING_TERM_MAX) */
  const TERM_MAX = 10000;

  const slots = $derived(tapDanceSlots(td));
  const sentence = $derived(tapDanceSentence(td, names, model));
  const headingId = $derived(`tap-dance-${td.index}-title`);
  /** a new one: no slot does anything and no key uses it, so the page lists it only while it is open */
  const isNew = $derived(!tapDanceIsSet(td) && uses.length === 0);
  /** what is wrong with the tapping term typed, or what was done about it; null when nothing is */
  let termProblem = $state<string | null>(null);
  /** the field holds a tapping term that can't be saved (until it is put back on leaving the field) */
  let termInvalid = $state(false);
  /** each slot's choose button, by its label */
  const chooseButtons: Partial<Record<SlotLabel, HTMLButtonElement>> = {};

  /** what a slot does, the hold too: "A — hold for Layer 2" */
  function what(d: Described): string {
    return keyTitle(d, names);
  }

  function clearSlot(slot: SlotLabel) {
    if (busy) return;
    onclearslot(slot);
    // the clear button goes once the slot is empty: the focus stays on the slot
    chooseButtons[slot]?.focus();
  }

  async function changeTerm(input: HTMLInputElement) {
    const ms = input.valueAsNumber;
    // what the keyboard holds is fine as it is, even above the longest term the server takes for a change
    if (ms === td.tappingTerm) {
      termProblem = null;
      termInvalid = false;
      return;
    }
    if (!Number.isInteger(ms) || ms < 0 || ms > TERM_MAX) {
      termProblem = `A tapping term from 0 to ${TERM_MAX} ms.`;
      termInvalid = true;
      return;
    }
    termProblem = null;
    termInvalid = false;
    if (busy || !(await onterm(ms))) input.value = String(td.tappingTerm);
  }

  /** Leaving the field with a tapping term that can't be saved puts back the one the keyboard holds */
  function leaveTerm(input: HTMLInputElement) {
    if (!termInvalid) return;
    input.value = String(td.tappingTerm);
    termInvalid = false;
    termProblem = `Not a tapping term from 0 to ${TERM_MAX} ms: it stays at ${td.tappingTerm} ms.`;
  }
</script>

<article class="card behaviour-card" class:target class:again={target && replayed()} class:editing id="tap-dance-{td.index}" aria-labelledby={headingId}>
  <EntryHead id="TD {td.index}" {headingId} name={td.name} tone="tap-dance" {canEdit} {onrename}
    renameLabel="Rename tap dance {td.index}" />

  <p class="plain">{sentence}</p>
  {#if isNew}
    <p class="new">
      <strong>New tap dance:</strong> nothing is kept until you choose what one of its slots does. Left empty, it is gone
      once you leave the page.
    </p>
  {/if}

  <ul class="slots" aria-label="What each press of tap dance {td.index} does">
    {#each slots as slot (slot.label)}
      {@const set = slot.action.kind !== "none"}
      {@const face = keyFace(slot.action, names)}
      <li class="slot" class:set>
        <button
          bind:this={chooseButtons[slot.label]}
          type="button"
          class="choose"
          disabled={!canEdit}
          aria-disabled={busy || undefined}
          aria-label="{slot.label}: {set ? what(slot.action) : 'nothing'} · change it"
          title="{slot.label}: {set ? `${what(slot.action)} (${slot.action.code})` : 'nothing'} · click to change"
          onclick={() => {
            if (!busy) onpickslot(slot.label);
          }}
        >
          <span class="how">{slot.label}</span>
          <span class="what tone-{face.tone}" data-tone={face.tone}>{set ? face.main || slot.action.code : "nothing"}</span>
          {#if set && face.hold}<span class="hold">{face.hold}</span>{/if}
        </button>
        {#if set}
          <button
            type="button"
            class="clear"
            disabled={!canEdit}
            aria-disabled={busy || undefined}
            aria-label="Clear “{slot.label}” of tap dance {td.index}"
            title="Clear"
            onclick={() => clearSlot(slot.label)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="foot">
    <label class="term">
      <span>Decides after</span>
      <input
        type="number"
        min="0"
        max={TERM_MAX}
        step="10"
        value={td.tappingTerm}
        disabled={!canEdit}
        readonly={busy}
        aria-invalid={termInvalid}
        aria-describedby={termProblem ? `tap-dance-${td.index}-term-problem` : undefined}
        onchange={(e) => void changeTerm(e.currentTarget)}
        onblur={(e) => leaveTerm(e.currentTarget)}
      />
      <span>ms <span class="muted">(tapping term)</span></span>
    </label>
    {#if termProblem}<p class="problem" id="tap-dance-{td.index}-term-problem" role="alert">{termProblem}</p>{/if}
  </div>

  <div class="end">
    <UsedOn {uses} {names} {positions} keycode="TD({td.index})" onopen={onopenuse} />
    {#if tapDanceIsSet(td)}
      <Button id="tap-dance-{td.index}-clear" variant="danger" disabled={!canEdit} aria-disabled={busy || undefined}
        title="Empties all four slots of tap dance {td.index}; the tapping term stays" onclick={() => !busy && onclear()}>
        Clear
      </Button>
    {/if}
  </div>
</article>

<style>
  /* its frame and highlight: .behaviour-card (app.css) */
  .card {
    --card-accent: var(--tone-tap-dance);
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

  .plain {
    margin: 0;
    color: var(--text-2);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (max-width: 640px) {
    .slots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .slot {
    position: relative;
    min-width: 0;
  }

  .choose {
    display: grid;
    justify-items: center;
    gap: 3px;
    width: 100%;
    min-height: 74px;
    padding: 8px 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: 9px;
    background: transparent;
    text-align: center;
    cursor: pointer;
  }

  .set .choose {
    border-style: solid;
    border-color: var(--border);
    background: var(--board-bg);
  }

  .choose:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .choose:disabled {
    cursor: not-allowed;
  }

  .choose[aria-disabled="true"],
  .clear[aria-disabled="true"] {
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

  .clear {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .clear:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--danger);
  }

  .clear svg {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .foot {
    display: grid;
    gap: 4px;
  }

  /* where it is used, and Clear at the right */
  .end {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }

  .end > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }

  .end > :global(.btn) {
    flex: none;
  }

  .term {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13px;
  }

  .term input {
    width: 88px;
    padding: 3px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface-2);
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--text-3);
  }

  .problem {
    margin: 0;
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
