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
  /** milliseconds the typing pauses before screen readers are told what was found: once, not after every letter */
  const ANNOUNCE_DELAY = 250;
  const searched = $derived(text.trim());
  const summary = $derived(
    !searched ? "" : results.length === 0 ? `“${searched}” is not on your keymap.`
      : `“${searched}”: ${results.length === 1 ? "1 place" : `${results.length} places`}`,
  );

  // the results show at once; the announcement waits for the typing to pause
  let announced = $state("");
  $effect(() => {
    const next = summary;
    const timer = setTimeout(() => (announced = next), ANNOUNCE_DELAY);
    return () => clearTimeout(timer);
  });

  /** the first result that is on a key: Enter opens it */
  const first = $derived(results.find((r) => r.place)?.place ?? null);

  let input: HTMLInputElement;

  /** Empties the box, which turns the results and the highlights off, and leaves the focus in it */
  function clear() {
    text = "";
    input.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && text !== "") {
      event.preventDefault();
      clear();
    } else if (event.key === "Enter" && first) {
      event.preventDefault();
      onopen(first);
    }
  }
</script>

<search class="find" aria-label="Find a character or key">
  <div class="field">
    <input
      bind:this={input}
      type="search"
      bind:value={text}
      placeholder="Find a character or key: ą, @, Esc, MO(2)"
      aria-label="Find a character or key"
      aria-describedby={searched ? "find-summary" : undefined}
      spellcheck="false"
      autocomplete="off"
      {onkeydown}
    />
    {#if text !== ""}
      <button type="button" class="clear" aria-label="Clear the search" title="Clear the search (Esc)" onclick={clear}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    {/if}
  </div>
  <!-- said by screen readers once the typing pauses; the same text is shown in the results -->
  <p class="visually-hidden" role="status">{announced}</p>
  {#if searched}
    <div id="find-results" class="results">
      {#if results.length === 0}
        <p id="find-summary" class="none">{summary}</p>
      {:else}
        <p id="find-summary" class="count">{summary}</p>
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
</search>

<style>
  .find {
    display: grid;
    gap: 8px;
  }

  .field {
    position: relative;
    width: min(100%, 420px);
  }

  input {
    width: 100%;
    padding: 7px 36px 7px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface);
  }

  /* the box's own clear button, the same in every browser (Chromium's built-in one is hidden) */
  input::-webkit-search-cancel-button {
    display: none;
  }

  .clear {
    position: absolute;
    top: 50%;
    right: 5px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    transform: translateY(-50%);
  }

  .clear:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .clear svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 2;
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
    max-width: 100%;
    overflow-wrap: anywhere;
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

  /* a result no key runs (a tap dance nothing uses, a combo whose keys aren't on the keymap) opens nothing: it
     doesn't look like a button */
  li > span {
    border-style: dashed;
    background: transparent;
    color: var(--text-2);
  }

  .more {
    margin-top: 6px;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
