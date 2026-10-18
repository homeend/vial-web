<script lang="ts">
  import { tick } from "svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    /** the layer renamed, or null while the dialog is closed */
    layer: number | null;
    /** what the field starts with: the layer's own name, "" if it has its default one, or what a failed save had */
    text: string;
    /** resolves to whether it worked: the dialog then closes, or stays open with what was typed (a toast says why) */
    onsave: (layer: number, name: string) => Promise<boolean>;
    /** closed, saved or not: the layer's tab gets the focus back */
    onclose: (layer: number) => void;
  }

  let { layer, text, onsave, onclose }: Props = $props();

  /** the longest name a layer can have, the same as the server's */
  const MAX = 40;

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let saving = $state(false);
  /** the layer the dialog is open for: kept while it closes, for onclose */
  let shownFor = $state<number | null>(null);

  const defaultName = $derived(layer === 0 ? "Base" : `Layer ${layer}`);

  $effect(() => {
    if (!dialog) return;
    if (layer !== null && !dialog.open) {
      shownFor = layer;
      draft = text;
      saving = false;
      dialog.showModal();
      void tick().then(() => input?.select());
    } else if (layer === null && dialog.open) {
      dialog.close();
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (shownFor === null || saving) return;
    saving = true;
    const done = await onsave(shownFor, draft.trim());
    saving = false;
    if (done) dialog?.close();
    else void tick().then(() => input?.focus());
  }
</script>

<dialog
  bind:this={dialog}
  class="rename-dialog"
  aria-labelledby="rename-title"
  onclose={() => {
    if (shownFor !== null) onclose(shownFor);
    shownFor = null;
  }}
>
  <form onsubmit={save}>
    <h2 id="rename-title">Rename layer {shownFor ?? layer}</h2>
    <label>
      <span class="visually-hidden">Name of layer {shownFor ?? layer}</span>
      <input
        bind:this={input}
        bind:value={draft}
        maxlength={MAX}
        placeholder={defaultName}
        aria-describedby="rename-hint"
        spellcheck="false"
        autocomplete="off"
        disabled={saving}
      />
    </label>
    <p id="rename-hint" class="hint">
      <span>Leave it empty for the default name, {defaultName}.</span>
      <span class="count" class:full={draft.length >= MAX}>{draft.length} / {MAX}</span>
    </p>
    <div class="buttons">
      <Button onclick={() => dialog?.close()}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={saving}>Save</Button>
    </div>
  </form>
</dialog>

<style>
  /* wide enough for the longest name (40 characters) without scrolling */
  .rename-dialog {
    width: min(calc(40ch + 90px), calc(100vw - 32px));
    max-width: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .rename-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  form {
    display: grid;
    gap: 10px;
    padding: 18px 20px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface-2);
    font-size: 14px;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hint {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .count.full {
    color: var(--warning-text);
    font-weight: 600;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
