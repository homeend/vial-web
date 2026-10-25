<script lang="ts">
  import { api } from "../api/api";
  import { apiUrl } from "../api/client";
  import { causeMessage } from "../api/errors";
  import type { GeneratorFile } from "../api/types";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Button from "../ui/Button.svelte";
  import { formatSize, promptOf } from "./generator";

  // How to get a lesson set: an LLM writes it from the layout export and the generator's files, which the app serves
  // for download (GET /api/learning/generator/…, docs/learning/PROMPT.md and GENERATE.md). Vial calls no LLM itself.
  // Two recipes: a chat LLM that can run nothing, and Claude Code or another agent with a shell. The files are listed
  // from the server, so that the list and the pack never disagree with what the app carries.

  interface Props {
    /** unfolded: the keyboard has no lesson set yet, or the user unfolded it */
    open: boolean;
    ontoggle: (open: boolean) => void;
  }

  let { open, ontoggle }: Props = $props();

  const REPOSITORY = "https://github.com/homeend/vial-web";

  /** a generator file's address, with the keyboard language shown (the pack's export is in that language) */
  const fileUrl = (name: string) => apiUrl("/api/learning/generator/{name}", { name });
  const packUrl = () => apiUrl("/api/learning/generator/pack");

  let files = $state<GeneratorFile[] | null>(null);
  let filesError = $state<string | null>(null);
  /** the prompt to paste into the chat, read out of PROMPT.md */
  let prompt = $state<string | null>(null);
  let promptError = $state<string | null>(null);
  let copied = $state(false);
  let reading = false;

  // read once, when first unfolded (folded, the section costs nothing)
  $effect(() => {
    if (open && !reading) {
      reading = true;
      void read();
    }
  });

  async function read() {
    try {
      files = await api.learningGenerator();
    } catch (error) {
      filesError = causeMessage(error);
    }
    try {
      const response = await fetch(fileUrl("PROMPT.md"));
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      prompt = promptOf(await response.text());
      if (prompt === null) promptError = "PROMPT.md holds no prompt block";
    } catch (error) {
      promptError = causeMessage(error);
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } catch (error) {
      toasts.error(`Copying failed: ${causeMessage(error)}. Select the prompt below and copy it.`);
    }
  }
</script>

<!-- the browser fires toggle for the open attribute following the prop too: only what differs from the prop is
     the user folding or unfolding it -->
<details id="generate-lessons" class="generate" {open}
  ontoggle={(event) => {
    const now = (event.currentTarget as HTMLDetailsElement).open;
    if (now !== open) ontoggle(now);
  }}>
  <!-- the heading on a line of its own, aligned with the lesson tiles' text; the chevron at the right, as the
       header's buttons are -->
  <summary>
    <span class="heading">How to generate a lesson set</span>
    <span class="hint">An LLM writes the course for this keyboard from the layout export and the files below. Vial
      calls no LLM itself: the files are downloaded from here and given to one.</span>
    <span class="chevron" aria-hidden="true"></span>
  </summary>
  <div class="body">
    <p class="first">
      <strong>First, for either way:</strong> open
      <button type="button" class="link" onclick={() => router.go("learning", null, { path: ["fingers"] })}>the Fingers view</button>
      and check which finger rests on and reaches each key; correct it where it is wrong. The export, and so the
      lessons, follow these fingers, and the keyboard language chosen at the top of the page.
    </p>

    <div class="recipes">
      <section class="recipe" aria-labelledby="recipe-chat">
        <h3 id="recipe-chat">With a chat LLM (Claude, ChatGPT, Gemini…)</h3>
        <ol>
          <li>
            Download the <a id="generator-pack" href={packUrl()}>generator pack</a> and unzip it: the recipe
            (PROMPT.md), the instructions, the rules, the file format, an example, and this keyboard's layout export
            as it is now.
          </li>
          <li>
            Start a new chat, attach every file of the pack and send the prompt below (it is at the end of PROMPT.md).
          </li>
          <li>
            The LLM shows the course table first; read it over and say "go on". It then writes the lessons a few at a
            time; when a reply is cut off, ask it to continue and join the pieces into one JSON file.
          </li>
          <li>
            Save the file as <code>&lt;id&gt;.json</code> and <strong>Import…</strong> it below. Vial checks it: errors
            it lists go back to the chat for the corrected file.
          </li>
        </ol>
        <div class="prompt" aria-live="polite">
          <div class="prompt-head">
            <span class="prompt-title">The prompt</span>
            <Button id="copy-prompt" onclick={() => void copyPrompt()} disabled={!prompt}>
              {copied ? "Copied" : "Copy the prompt"}
            </Button>
          </div>
          {#if prompt}
            <pre>{prompt}</pre>
          {:else if promptError}
            <p class="problem">The prompt couldn't be read: {promptError}. It is at the end of PROMPT.md.</p>
          {:else}
            <p class="waiting">Reading the prompt…</p>
          {/if}
        </div>
      </section>

      <section class="recipe" aria-labelledby="recipe-agent">
        <h3 id="recipe-agent">With Claude Code or another agent that runs programs</h3>
        <ol>
          <li>Export the layout in <strong>Fingers…</strong>, or take <code>layout-export.json</code> from the pack.</li>
          <li>
            In a checkout of the <a href={REPOSITORY} target="_blank" rel="noreferrer">vial-web repository</a>, run the
            <code>generate-lessons</code> skill with the export (<code>/generate-lessons</code> in Claude Code). It
            follows GENERATE.md and checks the set with <code>util/learning/check_lessons.py</code> before handing
            it over.
          </li>
          <li>
            Without the repository: save <a href={fileUrl("SKILL.md")}>SKILL.md</a> as
            <code>.claude/skills/generate-lessons/SKILL.md</code> in your project, unzip the pack next to the export,
            and ask for the lessons. The agent can't run the checker then: Vial checks the file on import.
          </li>
          <li><strong>Import…</strong> the file it writes.</li>
        </ol>
      </section>
    </div>

    <h3 class="files-title">Files</h3>
    <p class="files-note">
      Every file is served by this Vial; the pack holds the ones marked <span class="tag">pack</span>, plus the layout
      export. A set is built for the layout it was exported from: after a change to the keymap or the fingers, export
      again and regenerate, or <strong>Re-fit</strong> an existing set.
    </p>
    {#if files}
      <ul class="files" aria-label="Generator files">
        {#each files as file (file.name)}
          <li>
            <a href={fileUrl(file.name)}>{file.name}</a>
            <span class="size">{formatSize(file.size)}</span>
            {#if file.packed}<span class="tag">pack</span>{/if}
            <span class="description">{file.description}</span>
          </li>
        {/each}
      </ul>
    {:else if filesError}
      <p class="problem">The file list couldn't be read: {filesError}</p>
    {:else}
      <p class="waiting">Reading the files…</p>
    {/if}
  </div>
</details>

<style>
  .generate {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 13.5px;
  }

  summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "heading chevron"
      "hint chevron";
    align-items: center;
    column-gap: 14px;
    row-gap: 4px;
    padding: 16px 18px 16px 14px;
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: 12px;
  }

  .chevron {
    grid-area: chevron;
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-left: 7px solid var(--text-3);
  }

  .generate[open] .chevron {
    transform: rotate(90deg);
  }

  .heading {
    grid-area: heading;
    font-size: 15px;
    font-weight: 600;
  }

  .hint {
    grid-area: hint;
    color: var(--text-2);
    font-size: 13px;
  }

  .body {
    display: grid;
    gap: 14px;
    padding: 0 14px 14px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  .first {
    margin: 0;
    color: var(--text-2);
  }

  .recipes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }

  .recipe {
    display: grid;
    gap: 8px;
    align-content: start;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
  }

  ol {
    display: grid;
    gap: 6px;
    margin: 0;
    padding-left: 22px;
    color: var(--text-2);
  }

  ol strong,
  .first strong {
    color: var(--text);
    font-weight: 600;
  }

  code {
    font-family: var(--mono);
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }

  a {
    color: var(--accent);
    font-weight: 550;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 550;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .prompt {
    display: grid;
    gap: 6px;
  }

  .prompt-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .prompt-title {
    font-weight: 600;
  }

  pre {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font: 12.5px / 1.45 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 220px;
    overflow: auto;
  }

  .files-title {
    margin-top: 2px;
  }

  .files-note {
    margin: -8px 0 0;
    color: var(--text-2);
  }

  .files {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .files li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    min-width: 0;
  }

  .size {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .tag {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent-weak);
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .description {
    flex: 1 1 240px;
    color: var(--text-2);
  }

  .problem {
    margin: 0;
    color: var(--danger);
  }

  .waiting {
    margin: 0;
    color: var(--text-3);
  }
</style>
