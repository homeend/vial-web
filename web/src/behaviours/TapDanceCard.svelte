<script lang="ts">
  import type { Use } from "../analysis/usage";
  import type { Described, TapDance } from "../api/types";
  import { actionSummary, keyFace, type Names } from "../keyboard/labels";
  import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
  import EntryHead from "./EntryHead.svelte";
  import { tapDanceSentence } from "./sentences";
  import UsedOn from "./UsedOn.svelte";

  interface Props {
    td: TapDance;
    names: Names;
    positions: Map<string, string>;
    uses: Use[];
    canEdit: boolean;
    /** the card opened from elsewhere: drawn out for a moment */
    target: boolean;
    /** choose what a slot does (with the keycode picker) */
    onpickslot: (slot: SlotLabel) => void;
    onclearslot: (slot: SlotLabel) => void;
    /** resolves to whether the keyboard took it */
    onterm: (ms: number) => Promise<boolean>;
    onrename: () => void;
    onopenuse: (use: Use) => void;
  }

  let { td, names, positions, uses, canEdit, target, onpickslot, onclearslot, onterm, onrename, onopenuse }: Props =
    $props();

  /** the longest tapping term the server takes (schemas.TAPPING_TERM_MAX) */
  const TERM_MAX = 10000;

  const slots = $derived(tapDanceSlots(td));
  const sentence = $derived(tapDanceSentence(td, names));
  const headingId = $derived(`tap-dance-${td.index}-title`);
  let termProblem = $state<string | null>(null);

  function what(d: Described): string {
    return actionSummary(d, names).tap;
  }

  async function changeTerm(input: HTMLInputElement) {
    const ms = input.valueAsNumber;
    if (!Number.isInteger(ms) || ms < 0 || ms > TERM_MAX) {
      termProblem = `A tapping term from 0 to ${TERM_MAX} ms.`;
      return;
    }
    termProblem = null;
    if (ms === td.tappingTerm) return;
    if (!(await onterm(ms))) input.value = String(td.tappingTerm);
  }
</script>

<article class="card" class:target id="tap-dance-{td.index}" aria-labelledby={headingId}>
  <EntryHead id="TD {td.index}" {headingId} name={td.name} tone="tap-dance" {canEdit} {onrename}
    renameLabel="Rename tap dance {td.index}" />

  <p class="plain">{sentence}</p>

  <ul class="slots" aria-label="What each press of tap dance {td.index} does">
    {#each slots as slot (slot.label)}
      {@const set = slot.action.kind !== "none"}
      {@const face = keyFace(slot.action, names)}
      <li class="slot" class:set>
        <button
          type="button"
          class="choose"
          disabled={!canEdit}
          aria-label="{slot.label}: {set ? what(slot.action) : 'nothing'} · change it"
          title="{slot.label}: {set ? `${what(slot.action)} (${slot.action.code})` : 'nothing'} · click to change"
          onclick={() => onpickslot(slot.label)}
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
            aria-label="Clear the {slot.label.toLowerCase()} of tap dance {td.index}"
            title="Clear"
            onclick={() => onclearslot(slot.label)}
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
        aria-describedby={termProblem ? `tap-dance-${td.index}-term-problem` : undefined}
        onchange={(e) => void changeTerm(e.currentTarget)}
      />
      <span>ms <span class="muted">(tapping term)</span></span>
    </label>
    {#if termProblem}<p class="problem" id="tap-dance-{td.index}-term-problem" role="alert">{termProblem}</p>{/if}
  </div>

  <UsedOn {uses} {names} {positions} keycode="TD({td.index})" onopen={onopenuse} />
</article>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    scroll-margin-top: 80px;
  }

  .card.target {
    border-color: var(--tone-tap-dance);
    box-shadow: 0 0 0 1px var(--tone-tap-dance), var(--shadow);
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
