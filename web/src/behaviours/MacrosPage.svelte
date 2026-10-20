<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Analysis } from "../analysis/analysis";
  import { api } from "../api/api";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { trackDraft } from "../lib/unsaved";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";
  import { describeCode } from "./codes";
  import { freeMacro, macroIsSet, shownEntries } from "./entries";
  import { memoryUsed, stepRequest, type Step } from "./macro";
  import MacroCard from "./MacroCard.svelte";
  import MacroEditor from "./MacroEditor.svelte";
  import MemoryBar from "./MemoryBar.svelte";
  import { openUse } from "./navigate";
  import PageHeader from "./PageHeader.svelte";
  import { macroRemoveNote } from "./sentences";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the macro to show (from the address), or null */
    item: number | null;
  }

  let { model, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but the macro being edited
   * takes no change until it is done (a change made meanwhile would be lost when the save closes the editor) */
  const busy = $derived(keyboard.pending > 0);
  /** macros opened that would not show otherwise: a new one */
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.macros.items.length,
    (i) => macroIsSet(model.macros.items[i]) || (analysis.usage.macros[i]?.length ?? 0) > 0,
    item === null ? opened : [...opened, item]));
  const free = $derived(freeMacro(model, analysis.usage));
  const unshown = $derived(model.macros.items.length - shown.length);

  useTarget(() => (item === null ? null : `macro-${item}-title`));

  /** the macro being edited: one at a time */
  let draft = $state<{ index: number; steps: Step[] } | null>(null);
  /** the macro being removed, asked first as something uses it: what the confirmation says */
  let removing = $state<{ index: number; note: string } | null>(null);
  // opening another keyboard (the keyboard selector) asks first while it is open
  $effect(() => trackDraft(() => (draft ? "the macro being edited" : null)));

  /** every macro's steps, the one being edited as it is now */
  const items = $derived(model.macros.items.map((m) => (draft?.index === m.index ? draft.steps : m.actions)));
  // while editing, worked out from the steps (as the keyboard will count them); else as the keyboard said
  const used = $derived(draft ? memoryUsed(items, model.vialProtocol) : model.macros.used);
  const blocked = $derived(used > model.macros.memory
    ? `The macros need ${used} bytes, but the keyboard has ${model.macros.memory}.` : null);

  // another keyboard (or none of the macro being edited): what was being edited or opened was for the one before
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    const gone = draft !== null && model.macros.items[draft.index] === undefined;
    untrack(() => {
      if (uid !== shownUid) {
        shownUid = uid;
        opened = [];
        draft = null;
        removing = null;
      } else if (gone) {
        draft = null;
        removing = null;
      }
    });
  });

  function edit(index: number) {
    const macro = model.macros.items[index];
    if (!macro || busy) return;
    // a copy: nothing changes on the card until the keyboard took it
    draft = { index, steps: macro.actions.map((a) => ({ ...a, keys: [...a.keys] })) };
    // the Edit button goes: the focus goes to the first step, or (there is none) to adding one
    void focusEditor(index);
  }

  /** Focuses the editor's first step once it is drawn, after the card opened from the address took the focus */
  async function focusEditor(index: number) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (draft?.index !== index) return;
    const editor = document.querySelector(`#macro-${index} .editor`);
    editor?.querySelector<HTMLElement>(".steps select, .add button:not(:disabled)")?.focus();
  }

  /** After the editor closes: the card's heading, or (the macro was removed, and its card went) the New macro button */
  async function focusCard(index: number) {
    await tick();
    (document.getElementById(`macro-${index}-title`) ?? document.getElementById("new-macro"))?.focus();
  }

  /** Saves the macro; the editor stays open, with the focus on Save, when that fails */
  async function save() {
    if (!draft || busy) return;
    const index = draft.index;
    if (await keyboard.setMacros(items.map((steps) => steps.map(stepRequest)))) {
      if (draft?.index === index) draft = null;
      await focusCard(index);
    }
  }

  /** Remove: the macro is written empty, which is how the firmware keeps no macro, and saved at once, as on the other
   * pages. When something uses it, a confirmation says what first. */
  async function remove() {
    if (!draft || busy) return;
    const index = draft.index;
    const note = macroRemoveNote(index, analysis.usage.macros[index] ?? []);
    if (note) removing = { index, note };
    else if (await removeNow(index)) await focusCard(index);
  }

  /** Saves the macro empty, the others as the keyboard has them. Its card goes, unless something uses it or the
   * address names it. The editor stays open when that fails. */
  async function removeNow(index: number): Promise<boolean> {
    if (draft?.index !== index) return false;
    const cleared = model.macros.items.map((m) => (m.index === index ? [] : m.actions.map(stepRequest)));
    if (!(await keyboard.setMacros(cleared, "Removing the macro"))) return false;
    if (draft?.index === index) draft = null;
    opened = opened.filter((i) => i !== index);
    return true;
  }

  function cancel() {
    if (!draft || busy) return;
    const index = draft.index;
    draft = null;
    void focusCard(index);
  }

  function pickKey(step: number) {
    if (busy) return;
    pickingStep = step;
    pickerOpen = true;
  }

  function newMacro() {
    if (free === null || busy) return;
    opened = [...opened, free];
    // on the page shown: no step back, which would look like it did nothing
    router.go("macros", free, { replace: true });
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
      <Button id="new-macro" variant="primary" disabled={!canEdit || free === null || draft !== null}
        aria-disabled={busy || undefined}
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
      {busy}
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
      onpickkey={pickKey}
      describe={(code) => describeCode(keyboard.catalogue, code, api.parse)}
      parseText={(text) => api.parseMacroText(text)}
      {blocked}
      canSave={canEdit}
      {busy}
      removable={macroIsSet(model.macros.items[draft.index])}
      onsave={() => void save()}
      oncancel={cancel}
      onremove={() => void remove()}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="Macro {draft.index}, step {pickingStep + 1}"
    categories={keyboard.pickerCatalogue}
    current={draft.steps[pickingStep]?.keys.at(-1)?.code ?? "KC_NO"}
    {names}
    onpick={(_, d) => {
      const step = draft?.steps[pickingStep];
      if (!step) return;
      // picked while a change was being saved (the picker was opened before it): it would be lost
      if (busy) toasts.error(`${d.tap || d.code} wasn't added to the step: a change was still being saved. Try again.`);
      else step.keys.push(d);
    }}
  />
{/if}

<ConfirmDialog
  open={removing !== null}
  title="Remove macro {removing?.index}?"
  message={removing?.note ?? ""}
  confirmLabel="Remove"
  danger
  onconfirm={() => (removing ? removeNow(removing.index) : Promise.resolve(true))}
  onclose={() => {
    const index = removing?.index;
    removing = null;
    if (index === undefined) return;
    // removed: the card's heading (something uses it, so it stays); else the Remove button that asked
    if (draft?.index === index) document.getElementById(`macro-${index}-remove`)?.focus();
    else void focusCard(index);
  }}
/>

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
