<script lang="ts" module>
  import type { SectionId } from "../lib/route";

  export interface Section {
    id: SectionId;
    label: string;
    /** shown next to the label, e.g. how many layers */
    count?: number;
    /** a thin line under it: the sections after it are another group (Learning above the editing pages) */
    lineAfter?: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    sections: Section[];
    active: SectionId;
    onselect: (id: SectionId) => void;
  }

  let { sections, active, onselect }: Props = $props();
</script>

<nav class="nav" aria-label="Sections">
  <ul>
    {#each sections as s (s.id)}
      <li>
        <button
          type="button"
          class:active={s.id === active}
          aria-current={s.id === active ? "page" : undefined}
          onclick={() => onselect(s.id)}
        >
          <span>{s.label}</span>
          {#if s.count !== undefined}<em>{s.count}</em>{/if}
        </button>
      </li>
      {#if s.lineAfter}
        <li class="line" aria-hidden="true"></li>
      {/if}
    {/each}
  </ul>
</nav>

<style>
  /* a narrow window: the sections take as many rows as they need rather than widen the page */
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    font-weight: 550;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  button.active {
    background: var(--accent-weak);
    color: var(--accent);
    font-weight: 650;
  }

  em {
    color: inherit;
    font-size: 12px;
    font-style: normal;
    opacity: 0.7;
  }

  /* the line between the groups: decoration only, in both themes. In the column (wide windows) it is a 1 px row; a
     narrow window wraps the sections into rows, where it takes a whole row of its own, so the groups stay apart */
  .line {
    flex: 0 0 auto;
    height: 1px;
    margin: 6px 12px;
    background: var(--border-strong);
  }

  @media (max-width: 999px) {
    .line {
      flex-basis: 100%;
      margin: 2px 0;
    }
  }

  @media (max-width: 600px) {
    button {
      gap: 8px;
      padding: 8px 10px;
    }
  }

  @media (min-width: 1000px) {
    .nav {
      position: sticky;
      top: 76px;
    }

    ul {
      flex-direction: column;
    }
  }
</style>
