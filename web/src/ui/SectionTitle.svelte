<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** for aria-labelledby */
    id?: string;
    children: Snippet;
  }

  // the small upper-case title of a section of a panel (the Inspector's)
  let { id, children }: Props = $props();
</script>

<h3 {id}>{@render children()}</h3>

<style>
  h3 {
    margin: 0 0 8px;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
