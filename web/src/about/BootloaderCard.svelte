<script lang="ts">
  import { tick } from "svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  let confirming = $state(false);
  const busy = $derived(keyboard.pending > 0);
  // it looks disabled, but keeps the focus (given back to it when the confirmation closes)
  const unusable = $derived(!keyboard.canEdit || busy);

  /** The confirmation closed: rebooted, the page can't be used, and the banner that says so takes the focus; else the
   * focus goes back to the button, unless the keyboard went meanwhile (the page greyed out can't take it): then to the
   * page's entry in the sections, rather than to nowhere */
  function giveFocusBack() {
    const target = document.getElementById(keyboard.inBootloader ? "bootloader-banner" : "reboot-bootloader");
    target?.focus();
    if (!target || document.activeElement !== target) {
      document.querySelector<HTMLElement>('nav [aria-current="page"]')?.focus();
    }
  }
</script>

<!-- the Keyboard page's danger zone: what can't be undone from Vial -->
<section class="card" aria-labelledby="bootloader-title">
  <h2 id="bootloader-title">Reboot to bootloader</h2>
  <p>
    Reboots the keyboard into its bootloader, to flash new firmware with a flashing tool. Until it is flashed, or
    unplugged and plugged back in, it usually doesn't work as a keyboard and Vial can't see it (some bootloaders, as
    on a Pro Micro, start the firmware again by themselves after a few seconds). Vial firmware does this only for an
    unlocked keyboard: a locked one is unlocked first.
  </p>
  <div>
    <Button id="reboot-bootloader" variant="danger" aria-disabled={unusable || undefined}
      onclick={() => {
        if (!unusable) confirming = true;
      }}>Reboot to bootloader…</Button>
  </div>
</section>

<ConfirmDialog
  open={confirming}
  title="Reboot the keyboard into its bootloader?"
  message="It stops working as a keyboard and disappears from Vial, usually until it is flashed, or unplugged and plugged back in. If it is locked, you hold its unlock keys first."
  confirmLabel="Reboot"
  danger
  onconfirm={async () => {
    // closed whether it worked or not: a failure's toast says why, and Reboot to bootloader… is there to try again
    await keyboard.rebootToBootloader();
    return true;
  }}
  onclose={() => {
    confirming = false;
    void tick().then(giveFocusBack);
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
