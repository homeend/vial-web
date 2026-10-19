<script lang="ts">
  import type { KeyboardModel } from "../api/types";
  import { toasts } from "../lib/toasts.svelte";
  import Button from "../ui/Button.svelte";
  import { aboutFacts, aboutText } from "./about";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  const groups = $derived(aboutFacts(model));
  /** what was copied last, said for a moment */
  let copied = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toasts.error(`Copying ${what} failed: the browser didn't allow it. Select the text and copy it instead.`);
      return;
    }
    copied = `Copied ${what}.`;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = ""), 3000);
  }

  $effect(() => () => clearTimeout(timer));

  /** A fact in a sentence: "the name", "the protocols", but "the Keyboard ID" */
  function factName(label: string): string {
    return `the ${label === "Keyboard ID" ? label : label.toLowerCase()}`;
  }
</script>

<section class="card" aria-labelledby="about-title">
  <header>
    <h2 id="about-title">About this keyboard</h2>
    <Button size="sm" onclick={() => void copy(aboutText(groups), "everything")}>Copy all</Button>
  </header>
  <div class="groups">
    {#each groups as group (group.title)}
      <div class="group">
        <h3>{group.title}</h3>
        <dl>
          {#each group.facts as fact (fact.label)}
            {@const what = factName(fact.label)}
            <div class="fact">
              <dt>{fact.label}</dt>
              <dd>
                <span class="value" class:code={fact.code} title={fact.value}>{fact.value}</span>
                {#if fact.copy}
                  <button type="button" class="copy" aria-label="Copy {what}" title="Copy"
                    onclick={() => void copy(fact.value, what)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
                    </svg>
                  </button>
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </div>
    {/each}
  </div>
  <p class="copied" role="status">{copied}</p>
</section>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    gap: 12px 24px;
  }

  .group {
    min-width: 0;
  }

  h3 {
    margin: 0 0 4px;
    color: var(--text-3);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  dl {
    display: grid;
    gap: 2px;
    margin: 0;
  }

  .fact {
    display: grid;
    grid-template-columns: minmax(0, 13em) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 28px;
    font-size: 13px;
  }

  /* a phone: a narrower label column, so the Keyboard ID shows whole */
  @media (max-width: 479px) {
    .fact {
      grid-template-columns: minmax(0, 8.5em) minmax(0, 1fr);
    }
  }

  dt {
    color: var(--text-2);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin: 0;
  }

  /* a long value (the keyboard's name) is cut short; the tooltip has all of it */
  .value {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.code {
    font-family: var(--mono);
    font-size: 12.5px;
  }

  .copy {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }

  .copy:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .copy svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }

  .copied {
    min-height: 1.4em;
    margin: 0;
    /* --ok alone is too light on white (4.1:1) */
    color: color-mix(in srgb, var(--ok) 80%, var(--text));
    font-size: 12.5px;
  }
</style>
