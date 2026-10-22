<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";

  interface Props {
    /** whether it shows */
    open: boolean;
    title: string;
    message: string;
    /** the confirm button's text: "Reset" */
    confirmLabel: string;
    /** what confirming does can't be undone: the confirm button is red */
    danger?: boolean;
    /** resolves to whether it worked: the dialog then closes, or stays open (a toast says why) */
    onconfirm: () => Promise<boolean>;
    /** closed, confirmed or not: the caller gives the focus back to whatever opened it */
    onclose: () => void;
  }

  let { open, title, message, confirmLabel, danger = false, onconfirm, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let working = $state(false);
  const uid = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      working = false;
      dialog.showModal();
      // the safe choice has the focus: Enter doesn't confirm by accident
      void tick().then(() => cancelButton?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function confirm() {
    if (working) return;
    working = true;
    let done = false;
    try {
      done = await onconfirm();
    } finally {
      // a rejected onconfirm leaves it open, and usable again
      working = false;
    }
    if (done) dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-message"
  onkeydown={(event) => {
    // Esc waits for what is being done, as Cancel does: pressed again, the browser would close the dialog all the same
    // (a second close request can't be refused), so the key itself is stopped
    if (event.key === "Escape" && working) event.preventDefault();
  }}
  oncancel={(event) => {
    if (working) event.preventDefault();
  }}
  onclose={onclose}
>
  <h2 id="{uid}-title">{title}</h2>
  <p id="{uid}-message">{message}</p>
  <div class="buttons">
    <!-- a plain button: Button doesn't hand out its element, and this one takes the focus first -->
    <button bind:this={cancelButton} type="button" class="cancel" aria-disabled={working || undefined}
      onclick={() => {
        if (!working) dialog?.close();
      }}>Cancel</button>
    <Button variant={danger ? "danger" : "primary"} aria-disabled={working || undefined} onclick={() => void confirm()}>
      {working ? `${confirmLabel}…` : confirmLabel}
    </Button>
  </div>
</dialog>

<style>
  .confirm-dialog {
    width: min(440px, calc(100vw - 32px));
    max-width: none;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .confirm-dialog::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }

  p {
    margin: 0;
    color: var(--text-2);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .cancel {
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .cancel:hover:not([aria-disabled="true"]) {
    background: var(--surface-2);
  }

  /* taking nothing while the confirm button works (as Button.svelte): a disabled look, not a wait, since the
   * confirm button's text says what is under way ("Reset…") */
  .cancel[aria-disabled="true"] {
    cursor: default;
  }
</style>
