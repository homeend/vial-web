<script lang="ts">
  import { untrack } from "svelte";
  import { causeMessage } from "../api/errors";
  import type { KeyboardModel, SettingField, SettingsDefinitions } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import { settingDefinitions } from "./definitions";
  import {
    changeCount, changed, fieldChanged, groupChanges, numberProblem, settingGroups, valuesOf, withBit,
  } from "./qmkSettings";
  import SettingRow from "./SettingRow.svelte";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but take nothing until it
   * is done */
  const busy = $derived(keyboard.pending > 0);

  let definitions = $state.raw<SettingsDefinitions | null>(null);
  let loadProblem = $state<string | null>(null);

  function loadDefinitions() {
    loadProblem = null;
    settingDefinitions().then(
      (d) => (definitions = d),
      (error: unknown) => (loadProblem = causeMessage(error)),
    );
  }
  $effect(() => untrack(loadDefinitions));

  const groups = $derived(definitions ? settingGroups(definitions, model.settings) : []);
  /** what the keyboard holds */
  const held = $derived(valuesOf(model.settings));
  /** the values changed in the form, by qsid (a boolean changes a bit of its setting's value) */
  let edits = $state<Record<number, number>>({});
  /** what the number boxes hold while it isn't the value: being typed, or not a number they take */
  let texts = $state<Record<number, string>>({});
  /** the form: what the keyboard holds, with the changes made here */
  const form = $derived(new Map([...held, ...Object.entries(edits).map(([q, v]) => [Number(q), v] as const)]));
  const changes = $derived(changed(held, form));
  const problems = $derived(groups.flatMap((g) => g.fields)
    .filter((f) => f.type === "integer" && texts[f.qsid] !== undefined)
    .map((f) => ({ qsid: f.qsid, problem: numberProblem(f, texts[f.qsid], held.get(f.qsid)) }))
    .filter((p) => p.problem !== null));
  const blocked = $derived(problems.length > 0);
  /** nothing to undo */
  const idle = $derived(changes.length === 0 && Object.keys(texts).length === 0);

  // another keyboard: the changes were for the one before
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    untrack(() => {
      if (uid === shownUid) return;
      shownUid = uid;
      edits = {};
      texts = {};
    });
  });

  function toggle(field: SettingField, on: boolean) {
    if (busy) return;
    const value = form.get(field.qsid);
    if (value !== undefined) edits[field.qsid] = withBit(field, value, on);
  }

  function type(field: SettingField, text: string) {
    texts[field.qsid] = text;
    if (numberProblem(field, text, held.get(field.qsid)) === null) edits[field.qsid] = Number(text);
  }

  function undo() {
    if (busy) return;
    edits = {};
    texts = {};
  }

  async function save() {
    if (busy || blocked || changes.length === 0) return;
    const sent = changes;
    await keyboard.setSettings(sent);
    // what the keyboard took is what it holds now: those changes are done (a failed one stays, and says so)
    for (const { qsid, value } of sent) {
      if (held.get(qsid) === value && edits[qsid] === value) {
        delete edits[qsid];
        delete texts[qsid];
      }
    }
  }

  let confirming = $state(false);

  /** the Save bar's height: the window keeps that much room at its bottom when it scrolls a field into view (the
   * focus moved there with Tab), so the bar never covers the field. scroll-padding on the root element applies to the
   * window's scrolling, in Firefox and Chromium alike. */
  let barHeight = $state(0);
  $effect(() => {
    if (barHeight === 0) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${barHeight + 12}px`;
    return () => root.style.removeProperty("scroll-padding-bottom");
  });
</script>

<section class="page" aria-labelledby="settings-title">
  <PageHeader
    id="settings-title"
    title="Settings"
    description="QMK's own settings, kept on the keyboard: tap-hold timing, Auto Shift, one-shot keys, mouse keys and more. Only those this keyboard's firmware has are shown."
    note="Change what you like, then Save sends the changes to the keyboard; Undo puts back what it holds."
  >
    {#snippet action()}
      <Button id="reset-settings" variant="danger" disabled={!canEdit || groups.length === 0}
        aria-disabled={busy || undefined} onclick={() => {
          if (!busy) confirming = true;
        }}>
        Reset to defaults…
      </Button>
    {/snippet}
  </PageHeader>

  {#if loadProblem}
    <p class="problem" role="alert">
      The list of settings couldn't be read: {loadProblem}
      <Button size="sm" onclick={loadDefinitions}>Try again</Button>
    </p>
  {:else if !definitions}
    <p class="loading" aria-busy="true">Reading the settings…</p>
  {:else}
    {#each groups as group (group.name)}
      {@const count = groupChanges(group, held, form)}
      {@const headingId = `settings-${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      <section class="group" aria-labelledby={headingId}>
        <h2 id={headingId}>
          {group.name}
          {#if count > 0}<span class="count">{changeCount(count)}</span>{/if}
        </h2>
        <div class="fields">
          {#each group.fields as field, i (`${field.qsid}:${field.bit ?? i}`)}
            {@const value = form.get(field.qsid) ?? 0}
            <SettingRow
              {field}
              {value}
              text={field.type === "integer" ? (texts[field.qsid] ?? null) : null}
              problem={field.type === "integer" ? (problems.find((p) => p.qsid === field.qsid)?.problem ?? null) : null}
              changed={fieldChanged(field, held, form) && !(field.type === "integer" && texts[field.qsid] !== undefined &&
                problems.some((p) => p.qsid === field.qsid))}
              disabled={!canEdit}
              {busy}
              ontoggle={(on) => toggle(field, on)}
              ontext={(text) => type(field, text)}
            />
          {/each}
        </div>
      </section>
    {/each}

    <div class="savebar" bind:clientHeight={barHeight}>
      <span class="status" role="status">
        {#if blocked}
          A number can't be saved: see the field marked in red.
        {:else if changes.length > 0}
          {changeCount(changes.length)} not saved yet
        {:else}
          No changes: the form shows what the keyboard holds.
        {/if}
      </span>
      <span class="spacer"></span>
      <!-- with nothing to undo or save they look disabled, but keep the focus (Save, once it has saved) -->
      <Button class={idle ? "idle" : undefined} aria-disabled={busy || idle || undefined} disabled={!canEdit}
        onclick={undo}>Undo</Button>
      <Button class={blocked || changes.length === 0 ? "idle" : undefined} variant="primary" disabled={!canEdit}
        aria-disabled={busy || blocked || changes.length === 0 || undefined} onclick={() => void save()}>Save</Button>
    </div>
  {/if}
</section>

<ConfirmDialog
  open={confirming}
  title="Reset every setting?"
  message="All of this keyboard's QMK settings go back to its firmware's defaults. Changes not saved here are dropped too."
  confirmLabel="Reset"
  danger
  onconfirm={async () => {
    const done = await keyboard.resetSettings();
    if (done) {
      edits = {};
      texts = {};
    }
    return done;
  }}
  onclose={() => {
    confirming = false;
    document.getElementById("reset-settings")?.focus();
  }}
/>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .group {
    min-width: 0;
    padding: 12px 10px 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 6px 6px;
    font-size: 15px;
  }

  .count {
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
  }

  /* switches side by side where there is room; numbers take a row each (SettingRow) */
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 2px 8px;
  }

  .problem,
  .loading {
    margin: 0;
    color: var(--text-2);
  }

  .problem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--danger);
  }

  /* Save and Undo stay in sight at the window's bottom */
  .savebar {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    background: var(--surface);
    box-shadow: 0 -4px 12px rgb(16 24 40 / 8%);
  }

  .status {
    color: var(--text-2);
    font-size: 13px;
  }

  .spacer {
    flex: 1;
  }

  .savebar :global(.btn.idle[aria-disabled="true"]) {
    opacity: 0.45;
    cursor: default;
  }
</style>
