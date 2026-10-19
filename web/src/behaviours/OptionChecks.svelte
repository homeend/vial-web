<script lang="ts">
  import type { OptionInfo } from "./overrides";

  interface Props {
    legend: string;
    options: OptionInfo[];
    /** the option bits */
    value: number;
    /** a change is being saved: the boxes keep the focus, but take nothing until it is done */
    busy: boolean;
    onchange: (value: number) => void;
  }

  let { legend, options, value, busy, onchange }: Props = $props();
  const uid = $props.id();
</script>

<fieldset class="options">
  <legend>{legend}</legend>
  <ul>
    {#each options as option, i (option.bit)}
      <li>
        <input
          id="{uid}-{i}"
          type="checkbox"
          checked={(value & option.bit) !== 0}
          aria-describedby="{uid}-{i}-why"
          aria-disabled={busy || undefined}
          onclick={(event) => {
            // while busy the box stays as it was: the change would be lost
            if (busy) event.preventDefault();
          }}
          onchange={(event) => onchange(event.currentTarget.checked ? value | option.bit : value & ~option.bit)}
        />
        <label for="{uid}-{i}">{option.label}</label>
        <span class="why" id="{uid}-{i}-why">{option.explanation}</span>
      </li>
    {/each}
  </ul>
</fieldset>

<style>
  .options {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 650;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 6px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0 8px;
    align-items: start;
  }

  input {
    margin: 3px 0 0;
    accent-color: var(--accent);
  }

  input[aria-disabled="true"] {
    cursor: progress;
  }

  label {
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .why {
    grid-column: 2;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
