<script lang="ts" module>
  /** the longest name a layer, tap dance or macro can have, the same as the server's (schemas.NameIn) */
  export const NAME_MAX = 40;

  /** What the dialog names */
  export interface NameSubject {
    /** "Rename layer 2" */
    title: string;
    /** the field's name for screen readers: "Name of layer 2" */
    label: string;
    /** what an empty name gives, after "Leave it empty for": "the default name, Layer 2" */
    empty: string;
    placeholder: string;
    /** what the field starts with: the own name, "" for a default one, or what a failed save had */
    text: string;
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";

  interface Props {
    /** what is being named, or null while the dialog is closed */
    subject: NameSubject | null;
    /** resolves to whether it worked: the dialog then closes, or stays open with what was typed (a toast says why) */
    onsave: (name: string) => Promise<boolean>;
    /** closed, saved or not: whatever opened it gets the focus back */
    onclose: () => void;
  }

  let { subject, onsave, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let saving = $state(false);
  /** what the dialog is open for: kept while it closes */
  let shown = $state<NameSubject | null>(null);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (subject !== null && !dialog.open) {
      shown = subject;
      draft = subject.text;
      saving = false;
      dialog.showModal();
      void tick().then(() => input?.select());
    } else if (subject === null && dialog.open) {
      dialog.close();
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (shown === null || saving) return;
    saving = true;
    const done = await onsave(draft.trim());
    saving = false;
    if (done) dialog?.close();
    else void tick().then(() => input?.focus());
  }
</script>

<dialog
  bind:this={dialog}
  class="name-dialog"
  aria-labelledby="{uid}-title"
  onclose={() => {
    if (shown !== null) onclose();
    shown = null;
  }}
>
  <form onsubmit={save}>
    <h2 id="{uid}-title">{shown?.title ?? ""}</h2>
    <label>
      <span class="visually-hidden">{shown?.label ?? ""}</span>
      <input
        bind:this={input}
        bind:value={draft}
        maxlength={NAME_MAX}
        placeholder={shown?.placeholder ?? ""}
        aria-describedby="{uid}-hint"
        spellcheck="false"
        autocomplete="off"
        disabled={saving}
      />
    </label>
    <p id="{uid}-hint" class="hint">
      <span>Leave it empty for {shown?.empty ?? "the default name"}.</span>
      <span class="count" class:full={draft.length >= NAME_MAX}>{draft.length} / {NAME_MAX}</span>
    </p>
    <div class="buttons">
      <Button onclick={() => dialog?.close()}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={saving}>Save</Button>
    </div>
  </form>
</dialog>

<style>
  /* wide enough for the longest name (40 characters) without scrolling */
  .name-dialog {
    width: min(calc(40ch + 90px), calc(100vw - 32px));
    max-width: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .name-dialog::backdrop {
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
