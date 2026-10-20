<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { trackDraft } from "../lib/unsaved";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import { shownEntries } from "./entries";
  import KeyOverrideCard from "./KeyOverrideCard.svelte";
  import KeyOverrideEditor from "./KeyOverrideEditor.svelte";
  import {
    clearedKeyOverride, freeKeyOverride, keyOverrideIsSet, keyOverrideRequest, newKeyOverride, NO_KEY,
    type KeyOverrideDraft,
  } from "./overrides";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    /** the key override to show (from the address), or null */
    item: number | null;
  }

  let { model, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but the key override being
   * edited takes no change until it is done (a change made meanwhile would be lost when the save closes the editor) */
  const busy = $derived(keyboard.pending > 0);
  /** key overrides opened that would not show otherwise: a new one */
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.keyOverrides.length, (i) => keyOverrideIsSet(model.keyOverrides[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeKeyOverride(model.keyOverrides));
  const unshown = $derived(model.keyOverrides.length - shown.length);

  useTarget(() => (item === null ? null : `key-override-${item}-title`));

  /** the key override being edited: one at a time */
  let draft = $state<{ index: number; value: KeyOverrideDraft } | null>(null);
  // opening another keyboard (the keyboard selector) asks first while it is open
  $effect(() => trackDraft(() => (draft ? "the key override being edited" : null)));

  // another keyboard (or none of the key override being edited): what was being edited or opened was the one before's
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    const gone = draft !== null && model.keyOverrides[draft.index] === undefined;
    untrack(() => {
      if (uid !== shownUid) {
        shownUid = uid;
        opened = [];
        draft = null;
        pickerOpen = false;
      } else if (gone) {
        draft = null;
      }
    });
  });

  function edit(index: number) {
    const override = model.keyOverrides[index];
    if (!override || busy) return;
    const { index: _, ...value } = override;
    // a new one starts as QMK's usual: on every layer, switched on
    draft = { index, value: keyOverrideIsSet(override) ? value : newKeyOverride(NO_KEY, model.layers.length) };
    void focusEditor(index);
  }

  /** The Edit button goes: the focus goes to the trigger, once it is drawn, after the card opened from the address
   * took the focus */
  async function focusEditor(index: number) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (draft?.index === index) document.getElementById(`key-override-${index}-trigger`)?.focus();
  }

  /** After the editor closes: the card's heading, or (the card went) the New key override button */
  async function focusCard(index: number) {
    await tick();
    (document.getElementById(`key-override-${index}-title`) ?? document.getElementById("new-key-override"))?.focus();
  }

  async function save(value: KeyOverrideDraft, action: string) {
    if (!draft || busy) return;
    const index = draft.index;
    if (await keyboard.setKeyOverride(index, keyOverrideRequest(value), action)) {
      if (draft?.index === index) draft = null;
      // removed: its card goes, unless the address names it
      // another keyboard may be plugged in meanwhile: it may have no such entry
      const now = model.keyOverrides[index];
      if (!now || !keyOverrideIsSet(now)) opened = opened.filter((i) => i !== index);
      await focusCard(index);
    }
  }

  function cancel() {
    if (!draft || busy) return;
    const index = draft.index;
    draft = null;
    // a new one, never saved: its card goes, and so does the address naming it (New set it, or a deep link to a free
    // entry, then Edit), so the focus goes to the New button
    if (!keyOverrideIsSet(model.keyOverrides[index])) {
      opened = opened.filter((i) => i !== index);
      if (index === item) router.go("key-overrides", null, { replace: true });
    }
    void focusCard(index);
  }

  function newOverride() {
    if (free === null || busy || draft !== null) return;
    opened = [...opened, free];
    // on the page shown: no step back, which would look like it did nothing
    router.go("key-overrides", free, { replace: true });
    edit(free);
  }

  // the keycode picker: the trigger or the replacement
  let pickerOpen = $state(false);
  let picking = $state<"trigger" | "replacement">("trigger");

  function pick(part: "trigger" | "replacement") {
    if (busy) return;
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="key-overrides-title">
  <PageHeader
    id="key-overrides-title"
    title="Key overrides"
    description="A key pressed with certain modifiers sends another key instead: Shift + Backspace sends Delete. Each one works on the layers you choose."
    note="Edit one, then Save to send it to the keyboard; Cancel leaves it as it was."
  >
    {#snippet action()}
      <Button id="new-key-override" variant="primary" disabled={!canEdit || free === null || draft !== null}
        aria-disabled={busy || undefined}
        title={free === null ? "Every key override is in use" : `Sets up key override ${free}`} onclick={newOverride}>
        New key override
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No key override is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    {@const override = model.keyOverrides[index]}
    <KeyOverrideCard
      {override}
      draft={draft?.index === index ? draft.value : null}
      layerCount={model.layers.length}
      {names}
      canEdit={canEdit && draft === null}
      {busy}
      target={index === item}
      onedit={() => edit(index)}
      editor={draft?.index === index ? editor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "key override is" : "key overrides are"} free, of {model.keyOverrides.length}.</p>
  {/if}
</section>

{#snippet editor()}
  {#if draft}
    <KeyOverrideEditor
      index={draft.index}
      draft={draft.value}
      layerCount={model.layers.length}
      {names}
      removable={keyOverrideIsSet(model.keyOverrides[draft.index])}
      canSave={canEdit}
      {busy}
      onchange={(change) => {
        if (draft && !busy) draft.value = { ...draft.value, ...change };
      }}
      onpick={pick}
      onsave={() => draft && void save(draft.value, "Saving the key override")}
      oncancel={cancel}
      onremove={() => void save(clearedKeyOverride(NO_KEY), "Removing the key override")}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="{picking === 'trigger' ? 'Trigger' : 'Replacement'} of key override {draft.index}"
    categories={keyboard.pickerCatalogue}
    current={draft.value[picking].code}
    {names}
    onpick={(_, d) => {
      if (draft && !busy) draft.value = { ...draft.value, [picking]: d };
    }}
  />
{/if}

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
