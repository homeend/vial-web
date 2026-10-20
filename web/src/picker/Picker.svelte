<script lang="ts">
  import { tick } from "svelte";
  import type { CatalogueKeycode, Described, KeycodeCategory } from "../api/types";
  import { keyFace, type Names } from "../keyboard/labels";
  import AnyKeycode from "./AnyKeycode.svelte";
  import { categoryIndex } from "./offered";
  import { searchKeycodes, searchTemplates } from "./search";
  import { fillTemplate } from "./template";

  interface Props {
    open: boolean;
    /** what the picker is for, e.g. "Key row 1, column 2 on Base" */
    subject: string;
    categories: KeycodeCategory[];
    /** the keycode the key has now */
    current: string;
    names: Names;
    /** the keycode picked, and what it is */
    onpick: (code: string, described: Described) => void;
  }

  let { open = $bindable(), subject, categories, current, names, onpick }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let gridArea = $state<HTMLDivElement>();
  let query = $state("");
  /** the category shown, by name: kept when another keyboard offers other categories, whose indexes differ */
  let categoryName = $state<string | null>(null);
  const category = $derived(categoryIndex(categories, categoryName));
  let anyKeycode = $state("");

  const results = $derived(query.trim() ? searchKeycodes(categories, query) : null);
  const shown = $derived<CatalogueKeycode[]>(results ?? categories[category]?.keycodes ?? []);
  const templates = $derived(results ? searchTemplates(categories, query) : (categories[category]?.templates ?? []));
  /** what a screen reader hears as the results change */
  const status = $derived.by(() => {
    if (!results) return "";
    if (results.length === 0 && templates.length === 0) return `No keycode matches “${query.trim()}”`;
    const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
    return count(results.length, "keycode") + (templates.length ? `, ${count(templates.length, "template")}` : "");
  });

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      query = "";
      anyKeycode = "";
      dialog.showModal(); // the search box has autofocus: it gets the focus straight away
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  /** a click closes the picker only if it started on the backdrop too: a drag out of the panel doesn't */
  let pressedOnBackdrop = false;

  function pick(code: string, described: Described) {
    open = false;
    onpick(code, described);
  }

  function useTemplate(template: string) {
    // e.g. "LSFT(kc)": fill in the any-keycode box and let the user type the inner keycode
    anyKeycode = fillTemplate(template);
    void tick().then(() => {
      const input = document.getElementById("any-keycode") as HTMLInputElement | null;
      input?.focus();
      input?.setSelectionRange(anyKeycode.length - 1, anyKeycode.length - 1);
    });
  }

  function onSearchKey(event: KeyboardEvent) {
    // an IME committing text (Safari sends keyCode 229 after isComposing is already false)
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      // the top result; an empty search has none (a double or held Enter on opening must not fill a template)
      if (!results) return;
      event.preventDefault();
      if (results?.[0]) pick(results[0].code, results[0]);
      else if (templates[0]) useTemplate(templates[0]);
    } else if (event.key === "ArrowDown") {
      const first = gridArea?.querySelector<HTMLButtonElement>("button");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const tabId = (i: number) => `picker-tab-${i}`;

  /** the tabs pattern: arrows, Home and End move along the categories and select */
  function onTabKey(event: KeyboardEvent) {
    const last = categories.length - 1;
    const next = ({
      ArrowLeft: category > 0 ? category - 1 : last,
      ArrowRight: category < last ? category + 1 : 0,
      Home: 0,
      End: last,
    } as Record<string, number>)[event.key];
    if (next === undefined || last < 0) return;
    event.preventDefault();
    categoryName = categories[next].name;
    document.getElementById(tabId(next))?.focus();
  }
</script>

<dialog
  bind:this={dialog}
  class="picker"
  aria-labelledby="picker-title"
  onclose={() => (open = false)}
  onpointerdown={(e) => (pressedOnBackdrop = e.target === dialog)}
  onclick={(e) => {
    if (pressedOnBackdrop && e.target === dialog) open = false;
    pressedOnBackdrop = false;
  }}
>
  <div class="panel">
    <header>
      <div>
        <h2 id="picker-title">Choose a keycode</h2>
        <p>{subject} · now <code>{current}</code></p>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </header>

    <div class="search">
      <!-- showModal() focuses the autofocus element: the search box gets the focus directly, not after the close button -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={query}
        type="search"
        placeholder="Search keycodes: name, label or alias"
        aria-label="Search keycodes"
        autocomplete="off"
        spellcheck="false"
        autofocus
        onkeydown={onSearchKey}
      />
      <p class="visually-hidden" aria-live="polite">{status}</p>
    </div>

    {#if !results}
      <div class="categories" role="tablist" aria-label="Keycode categories">
        {#each categories as c, i (c.name)}
          <button
            type="button"
            role="tab"
            id={tabId(i)}
            aria-selected={i === category}
            aria-controls="picker-panel"
            tabindex={i === category ? 0 : -1}
            class:active={i === category}
            onclick={() => (categoryName = c.name)}
            onkeydown={onTabKey}>{c.name}</button
          >
        {/each}
      </div>
    {/if}

    <div
      bind:this={gridArea}
      class="grid-area"
      id="picker-panel"
      role={results ? "region" : "tabpanel"}
      aria-label={results ? "Search results" : undefined}
      aria-labelledby={results ? undefined : tabId(category)}
    >
      {#if results && results.length === 0 && templates.length === 0}
        <p class="empty">No keycode matches “{query.trim()}”. Try the Any keycode box below.</p>
      {/if}
      <div class="grid">
        {#each shown as k, i (k.code)}
          {@const face = keyFace(k, names)}
          <button
            type="button"
            class="kc tone-{face.tone}"
            data-tone={face.tone}
            class:current={k.code === current}
            aria-current={k.code === current ? "true" : undefined}
            title={k.description ? `${k.code}: ${k.description}` : k.code}
            aria-label="{k.tap || k.code} ({k.code})"
            aria-describedby={k.description ? `picker-description-${i}` : undefined}
            onclick={() => pick(k.code, k)}
          >
            {#if face.altGr}<span class="alt-gr">{face.altGr}</span>{/if}
            {#if face.shifted}<span class="kc-shifted">{face.shifted}</span>{/if}
            <span class="kc-tap">{face.main || "∅"}</span>
            <span class="kc-code">{k.code.replace(/^KC_/, "")}</span>
            {#if k.description}<span id="picker-description-{i}" hidden>{k.description}</span>{/if}
          </button>
        {/each}
      </div>
      {#if templates.length > 0}
        <div class="templates">
          <span>Wrap another key:</span>
          {#each templates as t (t)}
            <button type="button" onclick={() => useTemplate(t)}>{t}</button>
          {/each}
        </div>
      {/if}
    </div>

    <footer>
      <AnyKeycode bind:value={anyKeycode} onpick={pick} />
    </footer>
  </div>
</dialog>

<style>
  .picker {
    width: min(920px, calc(100vw - 32px));
    max-width: none;
    height: min(680px, calc(100vh - 48px));
    max-height: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  .picker::backdrop {
    background: rgb(10 14 22 / 45%);
    backdrop-filter: blur(2px);
  }

  .panel {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    height: 100%;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px 10px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  header p {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-2);
  }

  .close svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .search {
    padding: 0 20px 10px;
  }

  .search input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 14px;
  }

  .categories {
    display: flex;
    gap: 4px;
    padding: 0 20px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
  }

  .categories button {
    flex: none;
    padding: 5px 11px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }

  .categories button:hover {
    color: var(--text);
  }

  .categories button.active {
    border-color: var(--accent);
    background: var(--accent-weak);
    color: var(--accent);
  }

  .grid-area {
    overflow-y: auto;
    padding: 14px 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 6px;
  }

  .kc {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 58px;
    padding: 6px 4px 5px;
    border: 1.5px solid var(--line);
    border-radius: 8px;
    background: var(--fill);
    box-shadow: 0 2px 0 var(--key-shadow);
    color: var(--key-text);
    cursor: pointer;
  }

  .kc:hover {
    border-color: var(--accent);
  }

  .kc.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .tone-transparent {
    border-style: dashed;
    background: transparent;
    box-shadow: none;
  }

  .kc-tap {
    max-width: 100%;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.1;
    text-align: center;
  }

  .kc-shifted {
    color: var(--text-2);
    font-size: 11px;
    line-height: 1;
  }

  .kc-code {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 9.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alt-gr {
    position: absolute;
    top: 3px;
    right: 6px;
    color: var(--tone-layer);
    font-size: 11px;
    font-weight: 650;
  }

  .templates {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    color: var(--text-2);
    font-size: 12px;
  }

  .templates button {
    padding: 3px 8px;
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    background: transparent;
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
  }

  .templates button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty {
    margin: 0 0 12px;
    color: var(--text-2);
  }

  footer {
    padding: 14px 20px 18px;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: 0 0 16px 16px;
  }
</style>
