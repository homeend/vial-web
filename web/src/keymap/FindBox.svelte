<script lang="ts">
  import type { Place } from "../analysis/find";

  interface Result {
    label: string;
    /** the key to open in the Edit view, if it is on one */
    place: Place | null;
  }

  interface Props {
    text: string;
    results: Result[];
    onopen: (place: Place) => void;
  }

  let { text = $bindable(), results, onopen }: Props = $props();

  /** more than this many places would only scroll: the highlighted keys show the rest */
  const SHOWN = 40;
  const searched = $derived(text.trim());
  const summary = $derived(
    !searched ? "" : results.length === 0 ? `“${searched}” is not on your keymap.`
      : `“${searched}”: ${results.length === 1 ? "1 place" : `${results.length} places`}`,
  );
</script>

<section class="find" aria-label="Find a character or key">
  <input
    type="search"
    bind:value={text}
    placeholder="Find a character or key: ą, @, Esc, MO(2)"
    aria-label="Find a character or key"
    aria-describedby={searched ? "find-results" : undefined}
    spellcheck="false"
    autocomplete="off"
  />
  <!-- said by screen readers as it changes; the same text is shown in the results -->
  <p class="visually-hidden" role="status">{summary}</p>
  {#if searched}
    <div id="find-results" class="results">
      {#if results.length === 0}
        <p class="none">{summary}</p>
      {:else}
        <p class="count">{summary}</p>
        <ul>
          {#each results.slice(0, SHOWN) as result, i (i)}
            <li>
              {#if result.place}
                {@const place = result.place}
                <button type="button" onclick={() => onopen(place)}>{result.label}</button>
              {:else}
                <span>{result.label}</span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if results.length > SHOWN}<p class="more">and {results.length - SHOWN} more, highlighted on the keys</p>{/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .find {
    display: grid;
    gap: 8px;
  }

  input {
    width: min(100%, 420px);
    padding: 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface);
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .results {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--find) 45%, var(--border));
    border-radius: 10px;
    background: color-mix(in srgb, var(--find) 7%, var(--surface));
    font-size: 13px;
  }

  p {
    margin: 0;
  }

  .count {
    margin-bottom: 6px;
    color: var(--text-2);
    font-weight: 600;
  }

  .none {
    color: var(--text-2);
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li > * {
    display: inline-block;
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
  }

  button {
    cursor: pointer;
  }

  button:hover {
    border-color: var(--find);
  }

  .more {
    margin-top: 6px;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
