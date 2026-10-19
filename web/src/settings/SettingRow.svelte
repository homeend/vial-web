<script lang="ts">
  import type { SettingField } from "../api/types";
  import Switch from "../ui/Switch.svelte";
  import { isOn } from "./qmkSettings";

  interface Props {
    field: SettingField;
    /** the setting's value in the form */
    value: number;
    /** what an integer field's box holds, while it differs from value (being typed, or not a number it takes) */
    text: string | null;
    /** why the number typed can't be saved, or null */
    problem: string | null;
    /** the form shows another value than the keyboard holds */
    changed: boolean;
    disabled: boolean;
    /** a change is being saved: the controls keep the focus, but take nothing until it is done */
    busy: boolean;
    /** a boolean switched */
    ontoggle: (on: boolean) => void;
    /** a number typed */
    ontext: (text: string) => void;
  }

  let { field, value, text, problem, changed, disabled, busy, ontoggle, ontext }: Props = $props();
  const uid = $props.id();
</script>

<div class="row" class:changed class:invalid={problem !== null} class:wide={field.type === "integer"}>
  {#if field.type === "boolean"}
    <Switch id="{uid}-input" label={field.title} checked={isOn(field, value)} {disabled} {busy}
      describedby={changed ? `${uid}-changed` : undefined} onchange={ontoggle} />
  {:else}
    <label class="title" for="{uid}-input">{field.title}</label>
    <span class="number">
      <input
        id="{uid}-input"
        type="text"
        inputmode="numeric"
        value={text ?? String(value)}
        {disabled}
        readonly={busy}
        aria-invalid={problem !== null}
        aria-describedby="{uid}-range{problem ? ` ${uid}-problem` : ''}{changed ? ` ${uid}-changed` : ''}"
        oninput={(e) => ontext(e.currentTarget.value)}
      />
      <span class="range" id="{uid}-range">{field.min ?? 0}–{field.max ?? 0}</span>
    </span>
    {#if problem}<p class="problem" id="{uid}-problem">{problem}</p>{/if}
  {/if}
  {#if changed}<span class="mark" id="{uid}-changed">changed</span>{/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 14px;
    min-height: 40px;
    padding: 6px 12px 6px 14px;
    border-radius: 8px;
  }

  /* a number's title can be long: its row takes the whole width of the group */
  .row.wide {
    grid-column: 1 / -1;
  }

  .row.changed {
    background: var(--accent-weak);
  }

  /* a bar on the left edge marks a changed setting */
  .row.changed::before {
    content: "";
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 3px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .title {
    flex: 1 1 240px;
    min-width: 0;
    font-size: 13px;
    font-weight: 550;
  }

  .number {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  input {
    width: 88px;
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface-2);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  input[aria-invalid="true"] {
    border-color: var(--danger);
  }

  .range {
    min-width: 72px;
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .problem {
    flex-basis: 100%;
    margin: 0;
    color: var(--danger);
    font-size: 12.5px;
    text-align: right;
  }

  .mark {
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 650;
  }

  /* a switch's row: the label is the switch's own, the mark goes at the end */
  .row :global(.switch) {
    flex: 1 1 auto;
  }
</style>
