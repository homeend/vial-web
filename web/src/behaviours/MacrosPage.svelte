<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import { api } from "../api/api";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";
  import { describeCode } from "./codes";
  import { freeMacro, macroIsSet, shownEntries } from "./entries";
  import { memoryUsed, stepRequest, type Step } from "./macro";
  import MacroCard from "./MacroCard.svelte";
  import MacroEditor from "./MacroEditor.svelte";
  import MemoryBar from "./MemoryBar.svelte";
  import { openUse } from "./navigate";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the macro to show (from the address), or null */
    item: number | null;
  }

  let { model, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit && keyboard.pending === 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.macros.items.length,
    (i) => macroIsSet(model.macros.items[i]) || (analysis.usage.macros[i]?.length ?? 0) > 0,
    item === null ? opened : [...opened, item]));
  const free = $derived(freeMacro(model, analysis.usage));
  const unshown = $derived(model.macros.items.length - shown.length);

  useTarget(() => (item === null ? null : `macro-${item}-title`));

  /** the macro being edited: one at a time */
  let draft = $state<{ index: number; steps: Step[] } | null>(null);

  /** every macro's steps, the one being edited as it is now */
  const items = $derived(model.macros.items.map((m) => (draft?.index === m.index ? draft.steps : m.actions)));
  // while editing, worked out from the steps (as the keyboard will count them); else as the keyboard said
  const used = $derived(draft ? memoryUsed(items, model.vialProtocol) : model.macros.used);
  const blocked = $derived(used > model.macros.memory
    ? `The macros need ${used} bytes, but the keyboard has ${model.macros.memory}.` : null);

  function edit(index: number) {
    const macro = model.macros.items[index];
    // a copy: nothing changes on the card until the keyboard took it
    draft = { index, steps: macro.actions.map((a) => ({ ...a, keys: [...a.keys] })) };
  }

  async function save() {
    if (!draft) return;
    const index = draft.index;
    if (await keyboard.setMacros(items.map((steps) => steps.map(stepRequest)))) {
      draft = null;
      document.getElementById(`macro-${index}-title`)?.focus();
    }
  }

  function cancel() {
    const index = draft?.index;
    draft = null;
    if (index !== undefined) document.getElementById(`macro-${index}-title`)?.focus();
  }

  function newMacro() {
    if (free === null) return;
    opened = [...opened, free];
    router.go("macros", free);
    edit(free);
  }

  // the keycode picker, for a step's keys
  let pickerOpen = $state(false);
  let pickingStep = $state(0);

  // naming, in the name dialog
  let renaming = $state<number | null>(null);
  const subject = $derived<NameSubject | null>(renaming === null ? null : {
    title: `Rename macro ${renaming}`,
    label: `Name of macro ${renaming}`,
    empty: "a name made from what it types",
    placeholder: "",
    text: model.macros.items[renaming]?.customName ? model.macros.items[renaming].name : "",
  });
</script>

<section class="page" aria-labelledby="macros-title">
  <PageHeader
    id="macros-title"
    title="Macros"
    description="One key types text, taps keys and waits, step by step. All macros share the keyboard's macro memory."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null || draft !== null}
        title={free === null ? "Every macro is in use" : `Sets up macro ${free}`} onclick={newMacro}>
        New macro
      </Button>
    {/snippet}
  </PageHeader>

  <MemoryBar {used} memory={model.macros.memory} />

  {#if shown.length === 0}
    <p class="empty">No macro is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    {@const macro = model.macros.items[index]}
    <MacroCard
      {macro}
      {names}
      positions={analysis.positions}
      uses={analysis.usage.macros[index] ?? []}
      vialProtocol={model.vialProtocol}
      canEdit={canEdit && draft === null}
      target={index === item}
      onedit={() => edit(index)}
      onrename={() => (renaming = index)}
      onopenuse={openUse}
      editor={draft?.index === index ? stepEditor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "macro is" : "macros are"} free, of {model.macros.items.length}.</p>
  {/if}
</section>

{#snippet stepEditor()}
  {#if draft}
    <MacroEditor
      index={draft.index}
      bind:steps={draft.steps}
      vialProtocol={model.vialProtocol}
      onpickkey={(step) => {
        pickingStep = step;
        pickerOpen = true;
      }}
      describe={(code) => describeCode(keyboard.catalogue, code, api.parse)}
      {blocked}
      canSave={canEdit}
      onsave={() => void save()}
      oncancel={cancel}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="Macro {draft.index}, step {pickingStep + 1}"
    categories={keyboard.catalogue}
    current={draft.steps[pickingStep]?.keys.at(-1)?.code ?? "KC_NO"}
    {names}
    onpick={(_, d) => draft?.steps[pickingStep]?.keys.push(d)}
  />
{/if}

<NameDialog
  {subject}
  onsave={(name) => {
    const index = renaming;
    if (index === null) return Promise.resolve(true);
    const macro = model.macros.items[index];
    return name === (macro?.customName ? macro.name : "") ? Promise.resolve(true) : keyboard.rename("macros", index, name);
  }}
  onclose={() => {
    const index = renaming;
    renaming = null;
    if (index !== null) document.getElementById(`macro-${index}`)?.querySelector<HTMLElement>(".rename")?.focus();
  }}
/>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .empty,
  .more {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .empty {
    padding: 28px 16px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    text-align: center;
  }
</style>
