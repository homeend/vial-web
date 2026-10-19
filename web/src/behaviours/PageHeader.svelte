<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** what the page is for, in a sentence or two */
    description: string;
    /** how changes on the page work, when that isn't what the other pages do */
    note?: string;
    /** the page's own action, e.g. "New tap dance" */
    action?: Snippet;
    id: string;
  }

  let { title, description, note, action, id }: Props = $props();
</script>

<header class="head">
  <div class="title">
    <!-- focusable from script: it takes the focus when the page is shown from the back button (App.svelte) -->
    <h1 {id} tabindex="-1">{title}</h1>
    <p>{description}</p>
    {#if note}<p class="note">{note}</p>{/if}
  </div>
  {#if action}<div class="action">{@render action()}</div>{/if}
</header>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px 16px;
  }

  .title {
    flex: 1 1 320px;
    min-width: 0;
  }

  h1:focus {
    outline: none;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .note {
    color: var(--text-3);
    font-size: 13px;
  }

  .action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
