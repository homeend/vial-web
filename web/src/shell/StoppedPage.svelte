<script lang="ts">
  import { onMount } from "svelte";

  let heading = $state<HTMLElement>();

  // it replaces the whole page (Vial stopped, from this tab or another): the focus, which was in what went, would fall
  // to the page's body
  onMount(() => heading?.focus());
</script>

<main class="stopped-page">
  <div class="stopped">
    <h1 bind:this={heading} tabindex="-1">Vial has stopped</h1>
    <p>You can close this tab.</p>
    <p class="hint">To use Vial again, start it again.</p>
  </div>
</main>

<style>
  .stopped-page {
    display: grid;
    justify-items: center;
    padding: 96px var(--shell-gutter) 48px;
  }

  .stopped {
    width: 100%;
    max-width: var(--list-max);
    padding: 48px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    text-align: center;
    color: var(--text-2);
  }

  .stopped h1 {
    margin: 0 0 6px;
    color: var(--text);
    font-size: 20px;
  }

  .stopped p {
    margin: 0;
  }

  .stopped p + p {
    margin-top: 6px;
  }

  .stopped .hint {
    font-size: 13px;
  }
</style>
