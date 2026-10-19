<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** what the page's changes are: "2 changes not saved yet" (announced when it changes) */
    status: string;
    /** the bar's buttons (Undo, Save) */
    children: Snippet;
  }

  let { status, children }: Props = $props();

  /** The bar's height: the window keeps that much room at its bottom when it scrolls a field into view (the focus moved
   * there with Tab), so the bar never covers the field. scroll-padding on the root element applies to the window's
   * scrolling, in Firefox and Chromium alike. */
  let barHeight = $state(0);
  $effect(() => {
    if (barHeight === 0) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${barHeight + 12}px`;
    return () => root.style.removeProperty("scroll-padding-bottom");
  });
</script>

<!-- stays in sight at the window's bottom -->
<div class="savebar" bind:clientHeight={barHeight}>
  <span class="status" role="status">{status}</span>
  <span class="spacer"></span>
  {@render children()}
</div>

<style>
  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    background: var(--surface);
    box-shadow: 0 -4px 12px rgb(16 24 40 / 8%);
  }

  .status {
    color: var(--text-2);
    font-size: 13px;
  }

  .spacer {
    flex: 1;
  }

  /* with nothing to do they look disabled, but keep the focus */
  .savebar :global(.btn.idle[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }
</style>
