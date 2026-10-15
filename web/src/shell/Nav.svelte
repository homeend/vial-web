<script lang="ts" module>
  export interface Section {
    id: string;
    label: string;
    /** shown next to the label, e.g. how many layers */
    count?: number;
  }
</script>

<script lang="ts">
  interface Props {
    sections: Section[];
    active: string;
    onselect: (id: string) => void;
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
    {/each}
  </ul>
</nav>

<style>
  ul {
    display: flex;
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
