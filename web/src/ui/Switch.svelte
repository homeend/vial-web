<script lang="ts">
  interface Props {
    id?: string;
    label: string;
    checked: boolean;
    /** a change is being saved: the switch keeps the focus, but takes nothing until it is done */
    busy?: boolean;
    disabled?: boolean;
    describedby?: string;
    onchange: (checked: boolean) => void;
  }

  let { id, label, checked, busy = false, disabled = false, describedby, onchange }: Props = $props();
  const uid = $props.id();
</script>

<label class="switch" for={id ?? uid}>
  <input
    id={id ?? uid}
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-checked={checked}
    aria-describedby={describedby}
    aria-disabled={busy || undefined}
    onclick={(event) => {
      if (busy) event.preventDefault();
    }}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  <span class="text">{label}</span>
</label>

<style>
  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  /* the real checkbox, invisible over the track: it takes the clicks and the focus */
  input {
    position: absolute;
    z-index: 1;
    width: 34px;
    height: 20px;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  input:disabled {
    cursor: not-allowed;
  }

  input[aria-disabled="true"] {
    cursor: progress;
  }

  .track {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background-color 0.12s;
  }

  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    transition: transform 0.12s;
  }

  input:checked + .track {
    background: var(--accent);
  }

  input:checked + .track .thumb {
    transform: translateX(14px);
  }

  input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  input:disabled + .track {
    opacity: 0.45;
  }
</style>
