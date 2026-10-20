<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import { trackDraft } from "../lib/unsaved";
  import { router } from "../lib/router.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import AltRepeatCard from "./AltRepeatCard.svelte";
  import AltRepeatEditor from "./AltRepeatEditor.svelte";
  import { shownEntries } from "./entries";
  import {
    altRepeatIsSet, altRepeatRequest, clearedAltRepeat, freeAltRepeat, newAltRepeat, NO_KEY, pressable,
    type AltRepeatDraft,
  } from "./overrides";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";

  interface Props {
    model: KeyboardModel;
    /** the alt-repeat key to show (from the address), or null */
    item: number | null;
  }

  let { model, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls stay enabled, so the one used keeps the focus, but the alt-repeat key being
   * edited takes no change until it is done */
  const busy = $derived(keyboard.pending > 0);
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.altRepeatKeys.length, (i) => altRepeatIsSet(model.altRepeatKeys[i]),
    item === null ? opened : [...opened, item]));
  const free = $derived(freeAltRepeat(model.altRepeatKeys));
  const unshown = $derived(model.altRepeatKeys.length - shown.length);
  /** the entries only matter with Alt Repeat somewhere it can be pressed: said when there are some */
  const noAltRepeatKey = $derived(!pressable("QK_ALT_REPEAT_KEY", model));

  useTarget(() => (item === null ? null : `alt-repeat-${item}-title`));

  let draft = $state<{ index: number; value: AltRepeatDraft } | null>(null);
  // opening another keyboard (the keyboard selector) asks first while it is open
  $effect(() => trackDraft(() => (draft ? "the alt-repeat key being edited" : null)));

  // another keyboard (or none of the entry being edited): what was being edited or opened was the one before's
  let shownUid = untrack(() => model.uid);
  $effect.pre(() => {
    const uid = model.uid;
    const gone = draft !== null && model.altRepeatKeys[draft.index] === undefined;
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
    const entry = model.altRepeatKeys[index];
    if (!entry || busy) return;
    const { index: _, ...value } = entry;
    draft = { index, value: altRepeatIsSet(entry) ? value : newAltRepeat(NO_KEY) };
    void focusEditor(index);
  }

  /** The Edit button goes: the focus goes to the last key, once it is drawn, after the card opened from the address
   * took the focus */
  async function focusEditor(index: number) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (draft?.index === index) document.getElementById(`alt-repeat-${index}-keycode`)?.focus();
  }

  async function focusCard(index: number) {
    await tick();
    (document.getElementById(`alt-repeat-${index}-title`) ?? document.getElementById("new-alt-repeat"))?.focus();
  }

  async function save(value: AltRepeatDraft, action: string) {
    if (!draft || busy) return;
    const index = draft.index;
    if (await keyboard.setAltRepeatKey(index, altRepeatRequest(value), action)) {
      if (draft?.index === index) draft = null;
      // another keyboard may be plugged in meanwhile: it may have no such entry
      const now = model.altRepeatKeys[index];
      if (!now || !altRepeatIsSet(now)) opened = opened.filter((i) => i !== index);
      await focusCard(index);
    }
  }

  function cancel() {
    if (!draft || busy) return;
    const index = draft.index;
    draft = null;
    // a new one, never saved: its card goes, and so does the address naming it (New set it, or a deep link to a free
    // entry, then Edit), so the focus goes to the New button
    if (!altRepeatIsSet(model.altRepeatKeys[index])) {
      opened = opened.filter((i) => i !== index);
      if (index === item) router.go("alt-repeat", null, { replace: true });
    }
    void focusCard(index);
  }

  function newEntry() {
    if (free === null || busy || draft !== null) return;
    opened = [...opened, free];
    router.go("alt-repeat", free, { replace: true });
    edit(free);
  }

  let pickerOpen = $state(false);
  let picking = $state<"keycode" | "altKeycode">("keycode");

  function pick(part: "keycode" | "altKeycode") {
    if (busy) return;
    picking = part;
    pickerOpen = true;
  }
</script>

<section class="page" aria-labelledby="alt-repeat-title">
  <PageHeader
    id="alt-repeat-title"
    title="Alt-repeat"
    description="Repeat (QK_REPEAT_KEY) sends the last key again; Alt Repeat (QK_ALT_REPEAT_KEY) sends its opposite. Each entry here says what Alt Repeat sends after a key, adding to or changing the firmware's own pairs; a default one replaces them for the other keys it covers."
    note="Edit one, then Save to send it to the keyboard; Cancel leaves it as it was."
  >
    {#snippet action()}
      <Button id="new-alt-repeat" variant="primary" disabled={!canEdit || free === null || draft !== null}
        aria-disabled={busy || undefined}
        title={free === null ? "Every alt-repeat key is in use" : `Sets up alt-repeat key ${free}`} onclick={newEntry}>
        New alt-repeat key
      </Button>
    {/snippet}
  </PageHeader>

  {#if noAltRepeatKey && shown.length > 0}
    <p class="warning" role="note">
      No key has Alt Repeat (<code>QK_ALT_REPEAT_KEY</code>), so these do nothing yet: put it on a key in the Keymap.
    </p>
  {/if}

  {#if shown.length === 0}
    <p class="empty">No alt-repeat key is set up yet.</p>
  {/if}
  {#each shown as index (index)}
    <AltRepeatCard
      entry={model.altRepeatKeys[index]}
      draft={draft?.index === index ? draft.value : null}
      {names}
      canEdit={canEdit && draft === null}
      {busy}
      target={index === item}
      onedit={() => edit(index)}
      editor={draft?.index === index ? editor : undefined}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "alt-repeat key is" : "alt-repeat keys are"} free, of {model.altRepeatKeys.length}.</p>
  {/if}
</section>

{#snippet editor()}
  {#if draft}
    <AltRepeatEditor
      index={draft.index}
      draft={draft.value}
      {names}
      removable={altRepeatIsSet(model.altRepeatKeys[draft.index])}
      canSave={canEdit}
      {busy}
      onchange={(change) => {
        if (draft && !busy) draft.value = { ...draft.value, ...change };
      }}
      onpick={pick}
      onsave={() => draft && void save(draft.value, "Saving the alt-repeat key")}
      oncancel={cancel}
      onremove={() => void save(clearedAltRepeat(NO_KEY), "Removing the alt-repeat key")}
    />
  {/if}
{/snippet}

{#if draft}
  <Picker
    bind:open={pickerOpen}
    subject="{picking === 'keycode' ? 'Last key' : 'Alt key'} of alt-repeat key {draft.index}"
    categories={keyboard.catalogue}
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

  .warning {
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--warning-weak);
    color: var(--warning-text);
    font-size: 13px;
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
