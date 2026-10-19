<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import AboutCard from "./AboutCard.svelte";
  import LayoutFileCard from "./LayoutFileCard.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
  }

  let { model, analysis }: Props = $props();
</script>

<section class="page" aria-labelledby="keyboard-title">
  <PageHeader
    id="keyboard-title"
    title="Keyboard"
    description="What the keyboard is and what its firmware can do, and its layout saved to a file or loaded from one."
  />
  <LayoutFileCard {model} {analysis} />
  <AboutCard {model} />
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }
</style>
