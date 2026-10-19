<script lang="ts">
  import { tick } from "svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  let confirming = $state(false);
  const busy = $derived(keyboard.pending > 0);
</script>

<!-- the Keyboard page's danger zone: what can't be undone from Vial -->
<section class="card" aria-labelledby="bootloader-title">
  <h2 id="bootloader-title">Reboot to bootloader</h2>
  <p>
    Restarts the keyboard into its bootloader, to flash new firmware with a flashing tool. Until it is flashed, or
    unplugged and plugged back in, it doesn't work as a keyboard and Vial can't see it. Vial firmware does this only
    for an unlocked keyboard: a locked one is unlocked first.
  </p>
  <div>
    <Button id="reboot-bootloader" variant="danger" disabled={!keyboard.canEdit} aria-disabled={busy || undefined}
      onclick={() => {
        if (!busy) confirming = true;
      }}>Reboot to bootloader…</Button>
  </div>
</section>

<ConfirmDialog
  open={confirming}
  title="Restart the keyboard into its bootloader?"
  message="It stops working as a keyboard and disappears from Vial until it is flashed, or unplugged and plugged back in. If it is locked, you hold its unlock keys first."
  confirmLabel="Reboot"
  danger
  onconfirm={() => keyboard.rebootToBootloader()}
  onclose={() => {
    confirming = false;
    // gone: the page can't be used, and the banner that says so takes the focus
    void tick().then(() => document.getElementById(keyboard.inBootloader ? "bootloader-banner" : "reboot-bootloader")
      ?.focus());
  }}
/>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--danger-line);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  p {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
