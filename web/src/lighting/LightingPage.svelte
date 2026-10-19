<script lang="ts">
  import { untrack } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { keyboard } from "../lib/keyboard.svelte";
  import Button from "../ui/Button.svelte";
  import SaveBar from "../ui/SaveBar.svelte";
  import BacklightCard from "./BacklightCard.svelte";
  import {
    lightingKinds, mergePatch, patchRequest, restorePatches, withPatch, type LightingPatch,
  } from "./lighting";
  import RgbLightCard from "./RgbLightCard.svelte";
  import { lightingBaseline as baseline } from "./state.svelte";
  import VialRgbCard from "./VialRgbCard.svelte";
  import { LatestWriter } from "./writer";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  /** the least time from one change sent to the next: a slider dragged sends about 12 a second */
  const WRITE_GAP_MS = 80;

  const canEdit = $derived(keyboard.canEdit);
  /** the changes not yet confirmed by the keyboard: shown meanwhile, then what it confirmed is */
  let draft = $state<LightingPatch>({});
  /** changes are on their way */
  let sending = $state(false);
  /** Undo is putting the lighting back, in more than one write maybe: the draft shows where it ends meanwhile */
  let undoing = $state(false);
  const writer = new LatestWriter<LightingPatch>(
    async (patch) => {
      const before = model.lighting;
      if (await keyboard.setLighting(patchRequest(patch, before))) baseline.confirmed(before, model.lighting);
    },
    mergePatch,
    WRITE_GAP_MS,
    (busy) => {
      sending = busy;
      if (!busy && !undoing) draft = {};
    },
  );
  /** Save or Undo are being done: they take nothing more meanwhile (the focus stays on them) */
  const busy = $derived(sending || undoing || keyboard.pending > 0);

  const shown = $derived(withPatch(model.lighting, draft));
  const kinds = $derived(lightingKinds(model.lighting));

  // what the keyboard showed when this page first showed it, or what was saved here since (for this keyboard). A
  // pre-effect runs at once, before the first render; it follows the keyboard (its uid), not each change of its
  // lighting.
  $effect.pre(() => {
    const uid = model.uid;
    untrack(() => baseline.follow(uid, model.lighting));
  });
  /** Undo has something to put back */
  const changed = $derived(baseline.changed(model.lighting));
  /** the keyboard would lose a change unplugged: all but a change of backlight breathing, which it keeps at once */
  const unsaved = $derived(baseline.unsaved(model.lighting));

  function change(patch: LightingPatch) {
    if (!canEdit) return;
    draft = mergePatch(draft, patch);
    writer.push(patch);
  }

  /** nothing to save: what the keyboard shows was saved here */
  const saved = $derived(baseline.saved && !unsaved);

  async function save() {
    if (busy || saved || !canEdit) return;
    await writer.idle();
    if (await keyboard.saveLighting()) baseline.save(model.lighting);
  }

  async function undo() {
    if (busy || !changed || !baseline.lighting || !canEdit) return;
    // nothing is on its way (not busy): the model is what the keyboard shows
    const patches = restorePatches(model.lighting, baseline.lighting);
    undoing = true;
    draft = patches.reduce(mergePatch, draft);
    try {
      // in turn: merged, a colour the effect brought back ignores would stay as the keyboard shows it
      await writer.pushInTurn(patches);
    } finally {
      undoing = false;
      draft = {};
    }
  }

  const status = $derived(sending || undoing ? "Sending the change to the keyboard…"
    : unsaved ? "The keyboard shows changes not saved: unplugged, it goes back to the lighting saved before."
    : changed ? "The backlight is kept as it is: the keyboard keeps a change of breathing at once."
    : baseline.saved ? "Saved: the keyboard keeps this lighting when it is unplugged."
    : "No changes since this page first showed the keyboard's lighting.");

  const note = $derived("Changes show on the keyboard at once, and it keeps them only once you Save: unplugged before "
    + "that, it goes back to the lighting it had saved. "
    + (model.lighting.backlight ? "Backlight breathing is the exception: the keyboard keeps it at once. " : "")
    + "Undo puts back the lighting saved here last, or what it showed when this page first opened.");
</script>

<!-- a keyboard without lighting has no Lighting page: nothing here mentions lighting then -->
{#if kinds.length > 0}
  <section class="page" aria-labelledby="lighting-title">
    <PageHeader
      id="lighting-title"
      title="Lighting"
      description="This keyboard's {kinds.join(' and ')}. Only what its firmware has is shown."
      {note}
    />

    {#if shown.vialrgb}
      <VialRgbCard value={shown.vialrgb} disabled={!canEdit} onchange={change} />
    {/if}
    {#if shown.rgblight}
      <RgbLightCard value={shown.rgblight} disabled={!canEdit} onchange={change} />
    {/if}
    {#if shown.backlight}
      <BacklightCard value={shown.backlight} disabled={!canEdit} onchange={change} />
    {/if}

    <SaveBar {status}>
      <Button class={!changed ? "idle" : undefined} aria-disabled={busy || !changed || undefined} disabled={!canEdit}
        onclick={() => void undo()}>Undo</Button>
      <!-- what the keyboard shows may not be what it keeps until it is saved here once -->
      <Button class={saved ? "idle" : undefined} variant="primary" disabled={!canEdit}
        aria-disabled={busy || saved || undefined} onclick={() => void save()}>Save</Button>
    </SaveBar>
  </section>
{/if}

<style>
  .page {
    display: grid;
    gap: 14px;
  }
</style>
