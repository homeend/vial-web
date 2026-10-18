<script lang="ts">
  import { VIEWS, type KeymapView } from "./view";

  interface Props {
    view: KeymapView;
    onchange: (view: KeymapView) => void;
  }

  let { view, onchange }: Props = $props();
</script>

<fieldset class="switch">
  <legend class="visually-hidden">View</legend>
  {#each VIEWS as v (v.value)}
    <label class:on={view === v.value}>
      <input type="radio" name="keymap-view" value={v.value} checked={view === v.value} onchange={() => onchange(v.value)} />
      {v.label}
    </label>
  {/each}
</fieldset>

<style>
  .switch {
    display: inline-flex;
    gap: 2px;
    margin: 0;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }

  label {
    position: relative;
    padding: 5px 14px;
    border-radius: 8px;
    color: var(--text-2);
    font-weight: 550;
    cursor: pointer;
  }

  label:hover {
    color: var(--text);
  }

  label.on {
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* the radio button covers its label, invisibly */
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
