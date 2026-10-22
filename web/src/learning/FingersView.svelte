<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { FingersIn, KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { whereIs } from "../keyboard/refs";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toasts.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import Switch from "../ui/Switch.svelte";
  import Board from "./Board.svelte";
  import { FINGER_COLOURS, FINGERS, fingerLabel } from "./fingers";
  import { exportFileName } from "./format";
  import { learning } from "./learning.svelte";
  import { keyIdOf } from "./picture";
  import type { Finger, Reach } from "./types";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  const REACHES: readonly Reach[] = ["rest", "up", "down", "inner", "outer"];
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const fingerChoices = FINGERS.map((f) => ({ value: f, label: capital(f) }));
  const reachChoices = REACHES.map((r) => ({ value: r, label: capital(r) }));

  // read when the view opens
  $effect(() => {
    if (learning.fingers === null) void learning.loadFingers();
  });

  const fingers = $derived(learning.fingers);
  const names = $derived(namesOf(model));
  const faces = $derived(layerFaces(model, placement.items, 0, names));
  /** each placed item's export key id (null for an encoder) */
  const ids = $derived(placement.items.map((item) => (item.kind === "key" ? keyIdOf(item.geometry) : null)));
  const keyOf = (i: number) => (ids[i] === null ? undefined : fingers?.keys[ids[i]]);
  const rings = $derived(ids.map((_, i) => {
    const key = keyOf(i);
    return key ? FINGER_COLOURS[key.finger] : null;
  }));
  /** the resting keys: drawn filled (aria-pressed) */
  const home = $derived(ids.map((_, i) => keyOf(i)?.home ?? false));
  const labels = $derived(ids.map((_, i) => {
    const key = keyOf(i);
    const legend = faces[i]?.main || "key";
    return key ? `${legend}: ${fingerLabel(key.finger, key.hand)}, ${key.reach}${key.home ? ", resting" : ""}` : legend;
  }));

  let selected = $state(-1);
  const selectedId = $derived(selected >= 0 ? ids[selected] : null);
  const selectedKey = $derived(selectedId === null ? undefined : fingers?.keys[selectedId]);
  const where = $derived(selected >= 0 ? whereIs(model, placement.items[selected]) : null);
  let saving = $state(false);
  let resetting = $state(false);
  let exporting = $state(false);
  let exported = $state("");

  /** Saves every key as it is now, with one change: the server stores the whole of it */
  async function change(id: string, fix: Partial<{ finger: Finger; reach: Reach; home: boolean }>) {
    if (!fingers || saving) return;
    const keys: FingersIn["keys"] = {};
    const resting: string[] = [];
    for (const [kid, key] of Object.entries(fingers.keys)) {
      const changed = kid === id ? { ...key, ...fix } : key;
      keys[kid] = { finger: changed.finger, reach: changed.reach };
      if (changed.home) resting.push(kid);
    }
    saving = true;
    try {
      await learning.saveFingers({ keys, home: resting });
    } finally {
      saving = false;
    }
  }

  async function exportLayout() {
    if (exporting) return;
    exporting = true;
    exported = "";
    try {
      const layout = await api.learningExport();
      const name = exportFileName(model.name);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 1)], { type: "application/json" }));
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      exported = `Saved ${name}. Run the generate-lessons skill in Claude Code with this file, then Import the lesson set it writes.`;
    } catch (error) {
      toasts.error(`Exporting the layout failed: ${causeMessage(error)}`);
    } finally {
      exporting = false;
    }
  }
</script>

<PageHeader id="learning-title" title="Fingers"
  description="Which finger rests on and reaches each key. The export tells the lesson generator; correct the proposal where it is wrong."
  note={fingers?.proposal ? "This is the app's proposal from the key positions: nothing corrected yet." : fingers ? "Corrected by you; Reset to proposal forgets the corrections." : undefined}>
  {#snippet action()}
    <Button id="export-layout" variant="primary" aria-disabled={exporting || undefined} onclick={() => void exportLayout()}>
      {exporting ? "Exporting…" : "Export"}
    </Button>
    <Button onclick={() => (resetting = true)} disabled={!fingers || fingers.proposal}>Reset to proposal</Button>
    <Button onclick={() => router.go("learning")}>Back to lessons</Button>
  {/snippet}
</PageHeader>

{#if exported}<p class="exported" role="status">{exported}</p>{/if}

<Board>
  <div class="picture">
    <Keyboard {placement} {faces} {labels} {rings} chosen={home} {selected} onselect={(i) => (selected = i)}
      interactive={true} maxUnit={56} label="Keys, by finger" describedby="fingers-help" />
  </div>
  <p id="fingers-help" class="legend">
    {#each FINGERS as finger (finger)}
      <span><span class="swatch" style="border-color: {FINGER_COLOURS[finger]}"></span> {finger}</span>
    {/each}
    <span><span class="swatch home"></span> resting key</span>
    <span class="help">Click a key to change its finger.</span>
  </p>
</Board>

{#if selectedId !== null && selectedKey && where}
  <section class="panel" aria-labelledby="finger-key-title">
    <h2 id="finger-key-title">{faces[selected]?.main || "Key"} <span class="where">· {selectedId} ({where.where})</span></h2>
    <div class="fields">
      <SelectField label="Finger" value={selectedKey.finger} choices={fingerChoices} busy={saving}
        onchange={(finger) => void change(selectedId, { finger: finger as Finger })} />
      <SelectField label="Reach" value={selectedKey.reach} choices={reachChoices} busy={saving}
        onchange={(reach) => void change(selectedId, { reach: reach as Reach })} />
      <Switch label="Resting key" checked={selectedKey.home} busy={saving}
        onchange={(checked) => void change(selectedId, { home: checked })} />
    </div>
    <p class="hand">{capital(selectedKey.hand)} hand, {selectedKey.row} row.</p>
  </section>
{:else if selectedId === null && selected >= 0}
  <p class="hand">An encoder has no finger.</p>
{/if}

<ConfirmDialog open={resetting} title="Reset the fingers to the proposal?"
  message="Your corrections are forgotten: every key gets the finger the app proposes from its position."
  confirmLabel="Reset" danger onconfirm={() => learning.saveFingers(null)}
  onclose={() => {
    resetting = false;
    void tick().then(() => document.getElementById("export-layout")?.focus());
  }} />

<style>
  .exported {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--accent-weak);
    color: var(--text);
    font-size: 13px;
  }

  /* the resting keys are drawn filled (their aria-pressed, the Keyboard's chosen) */
  .picture :global(.key[aria-pressed="true"] .face) {
    fill: color-mix(in srgb, var(--key-bg) 60%, var(--accent));
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 3px solid;
    border-radius: 4px;
    background: var(--key-bg);
  }

  .swatch.home {
    border-color: var(--border);
    background: color-mix(in srgb, var(--key-bg) 60%, var(--accent));
  }

  .help {
    color: var(--text-3);
  }

  .panel {
    display: grid;
    gap: 10px;
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

  .where {
    color: var(--text-3);
    font-weight: 400;
    font-size: 13px;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px 24px;
    align-items: center;
  }

  .hand {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
