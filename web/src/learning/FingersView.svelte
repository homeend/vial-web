<script lang="ts">
  import { tick, untrack } from "svelte";
  import { api } from "../api/api";
  import { causeMessage } from "../api/errors";
  import type { FingersIn, KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { whereIs } from "../keyboard/refs";
  import { router } from "../lib/router.svelte";
  import { capitalised } from "../lib/text";
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
  const fingerChoices = FINGERS.map((f) => ({ value: f, label: capitalised(f) }));
  const reachChoices = REACHES.map((r) => ({ value: r, label: capitalised(r) }));

  /** the fingers are being read; the last read failed (its toast said why): a Retry line */
  let reading = $state(false);
  let readFailed = $state(false);

  async function read() {
    if (reading) return;
    reading = true;
    readFailed = false;
    try {
      readFailed = !(await learning.loadFingers());
    } finally {
      reading = false;
    }
  }

  // read when the view opens, and again for another keyboard (follow() drops them); a failed read waits for Retry
  $effect(() => {
    if (learning.fingers === null) untrack(() => void read());
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
  /** the resting keys: drawn filled (aria-pressed). Sparse: an encoder's slot is left empty, so the Keyboard passes
   * it `undefined` and the encoder gets no aria-pressed (it can't be a resting key) */
  const home = $derived(ids.reduce<boolean[]>((out, id, i) => {
    if (id !== null) out[i] = keyOf(i)?.home ?? false;
    return out;
  }, []));
  const labels = $derived(ids.map((_, i) => {
    const key = keyOf(i);
    const legend = faces[i]?.main || "key";
    return key ? `${legend}: ${fingerLabel(key.finger, key.hand)}, ${key.reach}${key.home ? ", resting" : ""}` : legend;
  }));

  let selected = $state(-1);
  const selectedId = $derived(selected >= 0 ? ids[selected] : null);
  const where = $derived(selected >= 0 ? whereIs(model, placement.items[selected]) : null);
  let saving = $state(false);
  let resetting = $state(false);
  let exporting = $state(false);
  let exported = $state("");

  type Fix = Partial<{ finger: Finger; reach: Reach; home: boolean }>;
  /** what the fields show while a change is saved: the pick, until the store has it or it fails. Going back to what
   * is stored is then a change of `value` or `checked`, which puts the control back (as LayoutPage does). */
  let picked = $state<{ id: string; fix: Fix } | null>(null);
  const selectedKey = $derived.by(() => {
    const key = selectedId === null ? undefined : fingers?.keys[selectedId];
    return key && picked?.id === selectedId ? { ...key, ...picked.fix } : key;
  });
  /** the server gives a resting key that isn't a thumb's the rest reach, whatever is picked: said in the panel */
  const restingHand = $derived(selectedKey?.home === true && selectedKey.finger !== "thumb");

  /** Saves every key as it is now, with one change: the server stores the whole of it */
  async function change(id: string, fix: Fix) {
    if (!fingers || saving) return;
    const keys: FingersIn["keys"] = {};
    const resting: string[] = [];
    for (const [kid, key] of Object.entries(fingers.keys)) {
      const changed = kid === id ? { ...key, ...fix } : key;
      keys[kid] = { finger: changed.finger, reach: changed.reach };
      if (changed.home) resting.push(kid);
    }
    saving = true;
    picked = { id, fix };
    try {
      const saved = await learning.saveFingers({ keys, home: resting });
      // the control shows the pick before it goes back
      if (!saved) await tick();
    } finally {
      picked = null;
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
  note={fingers ? `${fingers.proposal ? "This is the app's proposal from the key positions: nothing corrected yet." : "Corrected by you."} Each change is saved at once on this computer; Reset to proposal forgets the corrections.` : undefined}>
  {#snippet action()}
    <Button id="export-layout" variant="primary" aria-disabled={exporting || undefined} onclick={() => void exportLayout()}>
      {exporting ? "Exporting…" : "Export"}
    </Button>
    <Button onclick={() => (resetting = true)} disabled={!fingers || fingers.proposal}>Reset to proposal</Button>
    <Button onclick={() => router.go("learning")}>Back to lessons</Button>
  {/snippet}
</PageHeader>

{#if exported}<p class="exported" role="status">{exported}</p>{/if}

{#if reading}
  <p class="reading" role="status">Reading the fingers…</p>
{:else if readFailed}
  <p class="reading" role="status">
    The fingers couldn't be read.
    <Button size="sm" onclick={() => void read()}>Retry</Button>
  </p>
{/if}

<Board>
  <div class="picture">
    <Keyboard {placement} {faces} {labels} {rings} chosen={home} {selected} onselect={(i) => (selected = i)}
      interactive={true} maxUnit={56} label="Keys, by finger" describedby="fingers-help" />
  </div>
  <ul class="legend" aria-label="Legend">
    {#each FINGERS as finger (finger)}
      <li><span class="swatch" style="border-color: {FINGER_COLOURS[finger]}"></span> {finger}</li>
    {/each}
    <li><span class="swatch home"></span> resting key</li>
  </ul>
  <p id="fingers-help" class="help">Click a key to change its finger.</p>
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
    <p class="hand">
      {capitalised(selectedKey.hand)} hand, {selectedKey.row} row.
      {#if restingHand}A resting key's reach is rest: a pick of another reach goes back.{/if}
    </p>
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

  .reading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  /* the resting keys are drawn filled (their aria-pressed, the Keyboard's chosen). The Key's own hover tint
   * (`.key:not(.static):hover .face`) is more specific and wins on purpose: a resting key still shows the hover. */
  .picture :global(.key[aria-pressed="true"] .face) {
    fill: color-mix(in srgb, var(--key-bg) 60%, var(--accent));
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .legend > li {
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
    margin: 0;
    color: var(--text-3);
    font-size: 12.5px;
    text-align: center;
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
