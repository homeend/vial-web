<script lang="ts">
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { VersionInfo } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Banner from "../shell/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import { versionFacts, versionText } from "./version";

  // What this Vial is (GET /api/version): shown with or without a keyboard. The facts and their layout are the About
  // card's (AboutCard.svelte), with a link for the CI run.

  let info = $state<VersionInfo | null>(null);
  let error = $state<string | null>(null);
  let reading = $state(false);

  async function read() {
    reading = true;
    error = null;
    try {
      info = await api.version();
    } catch (e) {
      error = causeMessage(e);
    } finally {
      reading = false;
    }
  }

  $effect(() => {
    void read();
  });

  const groups = $derived(info ? versionFacts(info) : []);

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
</script>

<section class="page" aria-labelledby="version-title">
  <PageHeader id="version-title" title="Version"
    description="What this Vial is: its version, where it runs from and the commit it came from, how the executable was built, and where its files are." />
  {#if error}
    <Banner tone="danger" title="Couldn't read the version" message={error} actionLabel="Retry" onaction={() => void read()} />
  {:else if !info}
    <p class="reading" role="status">{reading ? "Reading…" : ""}</p>
  {:else}
    <section class="card" aria-labelledby="version-card-title">
      <header>
        <h2 id="version-card-title">{info.product} {info.version}</h2>
        <Button size="sm" onclick={() => void copy(versionText(groups), "everything")}>Copy all</Button>
      </header>
      <div class="groups">
        {#each groups as group (group.title)}
          <div class="group">
            <h3>{group.title}</h3>
            <dl>
              {#each group.facts as fact (fact.label)}
                <div class="fact">
                  <dt>{fact.label}</dt>
                  <dd>
                    {#if fact.href}
                      <a class="value" class:long={fact.long} href={fact.href} target="_blank" rel="noreferrer" title={fact.href}>{fact.value}</a>
                    {:else}
                      <span class="value" class:code={fact.code} class:long={fact.long} title={fact.value}>{fact.value}</span>
                    {/if}
                    {#if fact.copy}
                      <button type="button" class="copy" aria-label="Copy the {fact.label.toLowerCase()}" title="Copy"
                        onclick={() => void copy(fact.value, `the ${fact.label.toLowerCase()}`)}>
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
  {/if}
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .reading {
    margin: 0;
    color: var(--text-2);
    font-size: 13.5px;
  }

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
    grid-template-columns: minmax(0, 9em) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 28px;
    font-size: 13px;
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

  .value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.code {
    font-family: var(--mono);
    font-size: 12.5px;
  }

  a.value {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* a path or a system name: cut short on a wide screen, over a few lines on a phone */
  @media (max-width: 479px) {
    .fact {
      grid-template-columns: minmax(0, 7em) minmax(0, 1fr);
    }

    .value.long {
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }

  .copy {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }

  .copy:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .copy svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
  }

  .copied {
    min-height: 1.2em;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }
</style>
