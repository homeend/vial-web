<script lang="ts">
  import type { Analysis } from "../analysis/analysis";
  import type { KeyboardModel, TapDance, TapDanceIn } from "../api/types";
  import { namesOf } from "../keyboard/labels";
  import { freeTapDance, type SlotLabel } from "../keymap/tapdance";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import NameDialog, { type NameSubject } from "../ui/NameDialog.svelte";
  import { shownEntries, tapDanceIsSet } from "./entries";
  import { openUse } from "./navigate";
  import PageHeader from "./PageHeader.svelte";
  import { useTarget } from "./target.svelte";
  import TapDanceCard from "./TapDanceCard.svelte";

  interface Props {
    model: KeyboardModel;
    analysis: Analysis;
    /** the tap dance to show (from the address), or null */
    item: number | null;
  }

  let { model, analysis, item }: Props = $props();

  const names = $derived(namesOf(model));
  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: another one would be made from the tap dance as it was before it, so it waits. The
   * controls stay enabled meanwhile, so the one used keeps the focus. */
  const busy = $derived(keyboard.pending > 0);
  /** tap dances opened that would not show otherwise: a new one, or one opened from elsewhere */
  let opened = $state<number[]>([]);
  const shown = $derived(shownEntries(model.tapDance.length,
    (i) => tapDanceIsSet(model.tapDance[i]) || (analysis.usage.tapDances[i]?.length ?? 0) > 0,
    item === null ? opened : [...opened, item]));
  const free = $derived(freeTapDance(model));
  const unshown = $derived(model.tapDance.length - shown.length);

  useTarget(() => (item === null ? null : `tap-dance-${item}-title`));

  const FIELDS: Record<SlotLabel, "tap" | "hold" | "doubleTap" | "tapHold"> = {
    Tap: "tap", Hold: "hold", "Double tap": "doubleTap", "Tap, then hold": "tapHold",
  };

  function body(td: TapDance, change: Partial<TapDanceIn> = {}): TapDanceIn {
    return {
      tap: td.tap.code, hold: td.hold.code, doubleTap: td.doubleTap.code, tapHold: td.tapHold.code,
      tappingTerm: td.tappingTerm, ...change,
    };
  }

  function setSlot(index: number, slot: SlotLabel, code: string) {
    const td = model.tapDance[index];
    const action = `Changing the ${slot.toLowerCase()}`;
    if (!td) return;
    // a keycode picked while another change is still being saved (the picker was opened before it)
    if (busy) toasts.error(`${action} failed: another change was still being saved. Try again.`);
    else void keyboard.setTapDance(index, body(td, { [FIELDS[slot]]: code }), action);
  }

  function setTerm(index: number, ms: number): Promise<boolean> {
    const td = model.tapDance[index];
    if (!td || busy) return Promise.resolve(false);
    return keyboard.setTapDance(index, body(td, { tappingTerm: ms }), "Changing the tapping term");
  }

  // the keycode picker, for one slot at a time
  let pickerOpen = $state(false);
  let picking = $state<{ index: number; slot: SlotLabel } | null>(null);
  const pickingCurrent = $derived(picking ? model.tapDance[picking.index]?.[FIELDS[picking.slot]]?.code ?? "KC_NO" : "KC_NO");

  function pickSlot(index: number, slot: SlotLabel) {
    if (busy) return;
    picking = { index, slot };
    pickerOpen = true;
  }

  // naming, in the name dialog
  let renaming = $state<number | null>(null);
  const subject = $derived<NameSubject | null>(renaming === null ? null : {
    title: `Rename tap dance ${renaming}`,
    label: `Name of tap dance ${renaming}`,
    empty: "a name made from what it does",
    placeholder: "",
    text: model.tapDance[renaming]?.customName ? model.tapDance[renaming].name : "",
  });

  function newTapDance() {
    if (free === null) return;
    opened = [...opened, free];
    // on the page shown: no step back, which would look like it did nothing
    router.go("tap-dance", free, { replace: true });
  }
</script>

<section class="page" aria-labelledby="tap-dance-title">
  <PageHeader
    id="tap-dance-title"
    title="Tap dance"
    description="One key, up to four actions: tapped, held, tapped twice, or tapped then held. Click a slot to change it."
  >
    {#snippet action()}
      <Button variant="primary" disabled={!canEdit || free === null}
        title={free === null ? "Every tap dance is in use" : `Sets up tap dance ${free}`} onclick={newTapDance}>
        New tap dance
      </Button>
    {/snippet}
  </PageHeader>

  {#if shown.length === 0}
    <p class="empty">No tap dance is set up yet. Make one here, or with “Turn into tap dance” on a key.</p>
  {/if}
  {#each shown as index (index)}
    {@const td = model.tapDance[index]}
    <TapDanceCard
      {td}
      {model}
      {names}
      positions={analysis.positions}
      uses={analysis.usage.tapDances[index] ?? []}
      {canEdit}
      {busy}
      target={index === item}
      onpickslot={(slot) => pickSlot(index, slot)}
      onclearslot={(slot) => setSlot(index, slot, "KC_NO")}
      onterm={(ms) => setTerm(index, ms)}
      onrename={() => (renaming = index)}
      onopenuse={openUse}
    />
  {/each}
  {#if unshown > 0}
    <p class="more">{unshown} more {unshown === 1 ? "tap dance is" : "tap dances are"} free, of {model.tapDance.length}.</p>
  {/if}
</section>

{#if picking}
  <Picker
    bind:open={pickerOpen}
    subject="Tap dance {picking.index}, {picking.slot.toLowerCase()}"
    categories={keyboard.catalogue}
    current={pickingCurrent}
    {names}
    onpick={(code) => {
      if (picking) setSlot(picking.index, picking.slot, code);
    }}
  />
{/if}

<NameDialog
  {subject}
  onsave={(name) => {
    const index = renaming;
    if (index === null) return Promise.resolve(true);
    const td = model.tapDance[index];
    if (name === (td?.customName ? td.name : "")) return Promise.resolve(true);
    try {
      return keyboard.rename("tapDance", index, name);
    } catch {
      // the tap dance is gone (another keyboard was plugged in meanwhile, say)
      toasts.error(`Renaming the tap dance failed: this keyboard has no tap dance ${index}.`);
      return Promise.resolve(false);
    }
  }}
  onclose={() => {
    const index = renaming;
    renaming = null;
    if (index !== null) document.getElementById(`tap-dance-${index}`)?.querySelector<HTMLElement>(".rename")?.focus();
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
