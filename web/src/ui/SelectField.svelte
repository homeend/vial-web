<script lang="ts">
  interface Choice {
    value: string;
    label: string;
  }

  interface Props {
    id?: string;
    /** what is chosen, said before the list */
    label: string;
    value: string;
    choices: Choice[];
    disabled?: boolean;
    /** a change is being saved: the list keeps the focus, but takes nothing until it is done */
    busy?: boolean;
    describedby?: string;
    onchange: (value: string) => void;
  }

  let { id, label, value, choices, disabled = false, busy = false, describedby, onchange }: Props = $props();
  const uid = $props.id();
  const inputId = $derived(id ?? `${uid}-select`);
</script>

<div class="field">
  <label for={inputId}>{label}</label>
  <select
    id={inputId}
    {value}
    {disabled}
    aria-disabled={busy || undefined}
    aria-describedby={describedby}
    onchange={(event) => {
      const chosen = event.currentTarget.value;
      // a list can't refuse a choice: while busy it goes back to what is chosen
      if (busy) {
        event.currentTarget.value = value;
        return;
      }
      onchange(chosen);
    }}
  >
    {#each choices as choice (choice.value)}
      <option value={choice.value}>{choice.label}</option>
    {/each}
  </select>
</div>

<style>
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 14px;
    min-width: 0;
  }

  label {
    font-size: 13px;
    font-weight: 550;
  }

  select {
    min-width: min(100%, 220px);
    max-width: 100%;
    padding: 5px 8px;
    /* its edge stands out from the card (3:1, WCAG 1.4.11) */
    border: 1px solid color-mix(in srgb, var(--text-3) 80%, var(--text));
    border-radius: 7px;
    background: var(--surface-2);
    text-overflow: ellipsis;
  }

  select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  select[aria-disabled="true"] {
    cursor: progress;
  }
</style>
