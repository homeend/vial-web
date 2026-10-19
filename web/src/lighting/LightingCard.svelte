<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** what it is, in a sentence */
    about: string;
    children: Snippet;
  }

  let { title, about, children }: Props = $props();
  const uid = $props.id();
</script>

<!-- the controls of one kind of lighting; a .note inside says what the keyboard does with them -->
<section class="card" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{title}</h2>
  <p class="about">{about}</p>
  {@render children()}
</section>

<style>
  .card {
    display: grid;
    gap: 12px;
    min-width: 0;
    padding: 14px 16px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .about {
    margin: -8px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .card :global(.note) {
    margin: -6px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
