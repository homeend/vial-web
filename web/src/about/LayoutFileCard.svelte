<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { KeyboardModel, LayoutFilePreview, SettingsDefinitions } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import { settingDefinitions } from "../settings/definitions";
  import { settingsEdits } from "../settings/state.svelte";
  import Button from "../ui/Button.svelte";
  import { changeTotal, layoutFileName, previewSections, type PreviewContext } from "./layoutFile";
  import LayoutPreview from "./LayoutPreview.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
  }

  let { model, analysis }: Props = $props();

  /** the largest file the server takes (app.MAX_LAYOUT_FILE) */
  const MAX_BYTES = 1024 * 1024;

  const canEdit = $derived(keyboard.canEdit);
  const busy = $derived(keyboard.pending > 0);
  let fileInput = $state<HTMLInputElement>();
  /** the file chosen, and what loading it would change */
  let chosen = $state<{ name: string; text: string; preview: LayoutFilePreview } | null>(null);
  /** reading or checking a file, or saving one */
  let working = $state<"reading" | "saving" | null>(null);
  /** why the file chosen can't be loaded */
  let problem = $state<string | null>(null);
  /** what was done last: "Saved Simulated Corne.vil." */
  let done = $state("");
  let definitions = $state.raw<SettingsDefinitions | null>(null);

  const context = $derived<PreviewContext>({
    model, names: namesOf(model), positions: analysis.positions, definitions,
  });

  // another keyboard: a file checked against the one before isn't checked against it. The focus, if it was in the
  // preview, goes back to the Load button.
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    untrack(() => {
      if (uid === shownUid) return;
      shownUid = uid;
      const box = document.getElementById("layout-preview-title")?.closest('[role="group"]');
      const hadFocus = box?.contains(document.activeElement) ?? false;
      chosen = null;
      problem = null;
      done = "";
      if (hadFocus) void tick().then(() => document.getElementById("load-layout")?.focus());
    });
  });

  async function saveFile() {
    if (working) return;
    working = "saving";
    done = "";
    try {
      const { blob, name } = await api.layoutFile();
      const fileName = name || layoutFileName(model.name);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      done = `Saved ${fileName}.`;
    } catch (error) {
      toasts.error(`Saving the layout failed: ${causeMessage(error)}`);
    } finally {
      working = null;
    }
  }

  async function check(file: File) {
    working = "reading";
    problem = null;
    done = "";
    chosen = null;
    // the keyboard the file is checked against: another one plugged in meanwhile makes the answer stale
    const uid = model.uid;
    try {
      if (file.size > MAX_BYTES) {
        problem = `${file.name} can't be loaded: it is too large for a layout file (at most ${MAX_BYTES / 1024} KiB).`;
        return;
      }
      const text = await file.text();
      // the setting names, for the changes to them (the preview says "Setting 7" without them)
      const [preview] = await Promise.all([api.previewLayoutFile(text),
        settingDefinitions().then((d) => (definitions = d), () => undefined)]);
      if (model.uid === uid) chosen = { name: file.name, text, preview };
    } catch (error) {
      if (model.uid === uid) problem = `${file.name} can't be loaded: ${causeMessage(error)}`;
    } finally {
      working = null;
    }
  }

  async function load() {
    if (!chosen || busy) return;
    const { name, preview } = chosen;
    const total = changeTotal(previewSections(preview, context));
    problem = null;
    if (await keyboard.loadLayoutFile(chosen.text)) {
      // the Settings page's changes not saved yet would go over the file's settings: what was loaded is what shows
      settingsEdits.clear();
      chosen = null;
      done = `Loaded ${name}: ${total} ${total === 1 ? "change" : "changes"} written to the keyboard.`;
      await tick();
      document.getElementById("load-layout")?.focus();
    } else if (chosen?.name === name) {
      // the store said why in a message of its own (or the keyboard can't be changed just now)
      problem = `Nothing was loaded from ${name}${keyboard.canEdit ? ": the message that came up says why." :
        ": the keyboard can't be changed just now."}`;
    }
  }

  async function cancel() {
    chosen = null;
    await tick();
    document.getElementById("load-layout")?.focus();
  }
</script>

<section class="card" aria-labelledby="layout-file-title">
  <h2 id="layout-file-title">Layout file</h2>
  <p class="about">
    A <code>.vil</code> file holds everything on these pages: the keymap, tap dances, combos, macros, key overrides,
    alt-repeat keys and QMK settings. Save one to keep a copy; load one to put a copy back. Loading shows what changes
    first.
  </p>
  <div class="buttons">
    <Button id="save-layout" aria-disabled={working !== null || undefined} onclick={() => void saveFile()}>Save layout</Button>
    <!-- never disabled: it takes the focus back after a load, while the keyboard is read again (and can't be edited) -->
    <Button id="load-layout" aria-disabled={working !== null || busy || !canEdit || undefined} onclick={() => {
      if (working === null && !busy && canEdit) fileInput?.click();
    }}>Load layout…</Button>
    <input
      bind:this={fileInput}
      class="visually-hidden"
      type="file"
      accept=".vil,application/json"
      tabindex="-1"
      aria-label="Layout file to load"
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) void check(file);
      }}
    />
  </div>
  <p class="status" role="status">
    {working === "saving" ? "Saving the layout…" : working === "reading" && !chosen ? "Reading the file…" : done}
  </p>
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  {#if chosen}
    <LayoutPreview name={chosen.name} preview={chosen.preview} {context} unlocked={keyboard.unlock.state.state === "unlocked"}
      canLoad={canEdit} {busy} settingsKept={settingsEdits.keptFor(model.uid)} onload={() => void load()} oncancel={() => void cancel()} />
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .about {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .status {
    min-height: 1.4em;
    margin: -4px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .problem {
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--danger-line);
    border-radius: 8px;
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 13px;
  }
</style>
