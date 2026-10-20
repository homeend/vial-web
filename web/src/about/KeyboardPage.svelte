<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import type { KeyboardModel } from "../api/types";
  import type { UsbDevice } from "./about";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import AboutCard from "./AboutCard.svelte";
  import BootloaderCard from "./BootloaderCard.svelte";
  import LayoutFileCard from "./LayoutFileCard.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the keyboard's USB device, from the keyboard list; null when the list hasn't it */
    usb: UsbDevice | null;
  }

  let { model, analysis, usb }: Props = $props();
</script>

<section class="page" aria-labelledby="keyboard-title">
  <PageHeader
    id="keyboard-title"
    title="Keyboard"
    description="What the keyboard is and what its firmware can do, its layout saved to a file or loaded from one, and a reboot into its bootloader to flash it."
  />
  <LayoutFileCard {model} {analysis} />
  <AboutCard {model} {usb} />
  <BootloaderCard />
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }
</style>
