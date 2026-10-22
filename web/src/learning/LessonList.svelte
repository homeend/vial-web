<script lang="ts">
  import { tick } from "svelte";
  import type { LessonSetSummary } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { causeMessage } from "../api/errors";
  import { router } from "../lib/router.svelte";
  import Banner from "../shell/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import { lessonStateText, listedErrors } from "./format";
  import { learning } from "./learning.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import { lessonStatus, outOfDate } from "./state";

  interface Props {
    /** what the page has to say about the address it came back from, if anything */
    note: string | null;
    onnote: (note: string | null) => void;
  }

  let { note, onnote }: Props = $props();

  /** the largest file the server takes (app.MAX_LESSON_SET) */
  const MAX_BYTES = 4 * 1024 * 1024;

  const sets = $derived(learning.sets);
  const set = $derived(learning.set);
  const chosenEntry = $derived(sets.find((s) => s.id === learning.chosen) ?? null);
  /** a set file the checker refuses is listed all the same, so that its error shows and it can be removed */
  const choiceLabel = (s: LessonSetSummary) => (s.error ? `${s.title} — error` : s.title);
  const choices = $derived(sets.length === 0
    ? [{ value: "", label: "No lesson set yet" }]
    : sets.map((s) => ({ value: s.id, label: choiceLabel(s) })));
  const stale = $derived(set !== null && outOfDate(set, learning.export?.hash));
  const rows = $derived(set
    ? set.lessons.map((lesson, i) => ({ lesson, number: i + 1,
      state: lessonStateText(lessonStatus(lesson, learning.progress, learning.settings)) }))
    : []);

  let fileInput = $state<HTMLInputElement>();
  /** a file is being read and checked */
  let importing = $state(false);
  /** the checker's findings on the file refused; the warnings on the one taken */
  let findings = $state<{ tone: "errors" | "warnings"; name: string; lines: string[] } | null>(null);
  let removing = $state(false);
  let settingsOpen = $state(false);

  async function importFile(file: File) {
    importing = true;
    findings = null;
    onnote(null);
    try {
      if (file.size > MAX_BYTES) {
        findings = { tone: "errors", name: file.name, lines: [`too large for a lesson set (at most ${MAX_BYTES / 1024 / 1024} MiB)`] };
        return;
      }
      const outcome = await learning.importSet(await file.text());
      if (!outcome) return;
      if (outcome.ok) {
        if (outcome.warnings.length > 0) findings = { tone: "warnings", name: file.name, lines: listedErrors(outcome.warnings) };
      } else {
        findings = { tone: "errors", name: file.name, lines: listedErrors(outcome.errors) };
      }
    } catch (error) {
      // reading the file fails when it was moved or changed since it was picked (importSet fails only into its outcome)
      findings = { tone: "errors", name: file.name, lines: [`the file can't be read: ${causeMessage(error)}`] };
    } finally {
      importing = false;
    }
  }

  function openLesson(lessonId: string) {
    if (!set) return;
    router.go("learning", null, { path: [set.id, lessonId] });
  }
</script>

<PageHeader id="learning-title" title="Learning" description="A typing course for this keyboard, lesson by lesson."
  note="Results are kept on this computer, per keyboard.">
  {#snippet action()}
    <Button onclick={() => router.go("learning", null, { path: ["fingers"] })}>Fingers…</Button>
    <Button id="learning-settings" aria-label="Settings" title="Pass accuracy, target speed, the picture"
      onclick={() => (settingsOpen = true)}>
      <svg viewBox="0 0 20 20" aria-hidden="true" class="gear">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
      </svg>
    </Button>
  {/snippet}
</PageHeader>

{#if note}<p class="note" role="status">{note}</p>{/if}

<div class="row">
  <div class="select">
    <!-- not busy while a set opens: a pick during an open wins (the store keeps only the latest open's answer) -->
    <SelectField id="lesson-set" label="Lesson set" value={learning.chosen ?? ""} {choices}
      title={chosenEntry ? choiceLabel(chosenEntry) : undefined}
      disabled={sets.length === 0} onchange={(id) => void learning.open(id)} />
  </div>
  <div class="buttons">
    <Button id="import-lessons" aria-disabled={importing || undefined} onclick={() => {
      if (!importing) fileInput?.click();
    }}>{importing ? "Importing…" : "Import…"}</Button>
    <input bind:this={fileInput} class="visually-hidden" type="file" accept=".json,application/json" tabindex="-1"
      aria-label="Lesson set file to import"
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) void importFile(file);
      }} />
    {#if chosenEntry}
      <Button variant="danger" onclick={() => (removing = true)}>Remove</Button>
    {/if}
  </div>
</div>

{#if findings}
  <div class="findings {findings.tone}" role={findings.tone === "errors" ? "alert" : "status"}>
    <strong>{findings.tone === "errors" ? `${findings.name} wasn't imported:` : `${findings.name} was imported, with warnings:`}</strong>
    <ul>
      {#each findings.lines as line, i (i)}<li>{line}</li>{/each}
    </ul>
  </div>
{/if}

{#if chosenEntry?.error}
  <p class="problem" role="alert">This file can't be opened: {chosenEntry.error}</p>
{/if}

{#if stale}
  <Banner tone="warning" title="Built for another layout." message="Export again and regenerate, or carry on." />
{/if}

{#if learning.loading}
  <p class="empty">Reading the lessons…</p>
{:else if sets.length === 0 && learning.loaded && !learning.error}
  <p class="empty">
    No lesson set yet? <strong>Fingers…</strong> → Export, then run the <code>generate-lessons</code> skill in Claude
    Code and <strong>Import</strong> the file it writes.
  </p>
{:else if set}
  <ol class="lessons" aria-label="Lessons of {set.title}">
    {#each rows as row (row.lesson.id)}
      <li>
        <button type="button" class="lesson" onclick={() => openLesson(row.lesson.id)}>
          <span class="number">{row.number}</span>
          <span class="title" title={row.lesson.title}>{row.lesson.title}</span>
          <span class="state" class:star={row.state.startsWith("★")}>{row.state}</span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<ConfirmDialog open={removing} title="Remove {chosenEntry?.title ?? 'the lesson set'}?"
  message="The lesson set file is removed from this keyboard's lessons. Its results stay, for the set imported again."
  confirmLabel="Remove" danger
  onconfirm={() => (chosenEntry ? learning.deleteSet(chosenEntry.id) : Promise.resolve(true))}
  onclose={() => {
    removing = false;
    // the last set removed: the selector is disabled, so the focus goes to Import (never to the body)
    void tick().then(() => document.getElementById(learning.sets.length === 0 ? "import-lessons" : "lesson-set")?.focus());
  }} />

<SettingsDialog open={settingsOpen} settings={learning.settings} onsave={(s) => learning.saveSettings(s)}
  onclose={() => {
    settingsOpen = false;
    void tick().then(() => document.getElementById("learning-settings")?.focus());
  }} />

<style>
  .gear {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .note {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
  }

  /* the selector shrinks to the row (a long set title gets its ellipsis) rather than widening the page */
  .select {
    flex: 1 1 280px;
    min-width: 0;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .findings {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid;
    border-radius: 8px;
    font-size: 13px;
    /* a finding quotes the file (a long id, a line of text): it wraps rather than widening the page at 375 px */
    overflow-wrap: anywhere;
  }

  .findings.errors {
    border-color: var(--danger-line);
    background: var(--danger-weak);
    color: var(--danger);
  }

  .findings.warnings {
    border-color: color-mix(in srgb, var(--warning-text) 30%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  .findings ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }

  .problem {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .empty {
    margin: 0;
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    color: var(--text-2);
    font-size: 13.5px;
    text-align: center;
  }

  .empty code {
    font-family: var(--mono);
  }

  .lessons {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lesson {
    display: grid;
    grid-template-columns: 2.2em minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .lesson:hover {
    background: var(--surface-2);
  }

  .number {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .state {
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .state.star {
    color: var(--ok);
  }

  @media (max-width: 480px) {
    .lesson {
      grid-template-columns: 2.2em minmax(0, 1fr);
    }

    .state {
      grid-column: 2;
      white-space: normal;
    }
  }
</style>
