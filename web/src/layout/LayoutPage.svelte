<script lang="ts">
  import { tick } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import PageHeader from "../behaviours/PageHeader.svelte";
  import { withLayoutChoice, type Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { layerFaces, namesOf } from "../keyboard/labels";
  import { keyboard } from "../lib/keyboard.svelte";
  import SelectField from "../ui/SelectField.svelte";
  import Switch from "../ui/Switch.svelte";
  import { canChoose, optionRows, type OptionRow } from "./options";

  interface Props {
    model: KeyboardModel;
    /** the keys as the layout options chosen place them */
    placement: Placement;
  }

  let { model, placement }: Props = $props();

  const canEdit = $derived(keyboard.canEdit);
  /** a change is being saved: the controls keep the focus, but take nothing until it is done */
  const busy = $derived(keyboard.pending > 0);
  const options = $derived(model.layoutOptions);
  const rows = $derived(options ? optionRows(options) : []);
  const faces = $derived(layerFaces(model, placement.items, 0, namesOf(model)));
  const keyCount = $derived(placement.items.filter((i) => i.kind === "key").length);
  /** the keys that belong to an option, ringed */
  const rings = $derived(placement.items.map((i) => (i.geometry.layoutIndex !== -1 ? "var(--accent)" : null)));

  /** what a control shows while its change is saved: the pick, until the keyboard has it or it fails. Going back to
   * what the keyboard holds is then a change of `checked` or `value`, which puts the control back (Svelte sets only
   * what changed); the control stays, and keeps the focus. */
  const picked = $state<Record<number, number>>({});

  async function choose(row: OptionRow, choice: number) {
    if (!options || choice === row.choice) return;
    picked[row.index] = choice;
    const saved = !busy && canChoose(options, row.index, choice)
      && await keyboard.setLayoutOptions(withLayoutChoice(options, row.index, choice), `Changing “${row.name}”`);
    // the control shows the pick before it goes back, even when nothing was sent
    if (!saved) await tick();
    delete picked[row.index];
  }
</script>

<section class="page" aria-labelledby="layout-title">
  <PageHeader
    id="layout-title"
    title="Layout"
    description="Which of the layouts its design allows this keyboard is built with: a split Backspace, another bottom row and the like. The keymap then draws the keys it has."
    note="Each change is saved to the keyboard at once, and kept when it is unplugged."
  />

  {#if rows.length > 0}
    <section class="card" aria-labelledby="layout-options-title">
      <h2 id="layout-options-title">Layout options</h2>
      <ul class="options">
        {#each rows as row (row.index)}
          {@const shown = picked[row.index] ?? row.choice}
          <li class="option">
            {#if row.kind === "switch"}
              <Switch label={row.name} checked={shown === 1} disabled={!canEdit} {busy}
                onchange={(on) => choose(row, on ? 1 : 0)} />
            {:else}
              <SelectField label={row.name} value={String(shown)} disabled={!canEdit} {busy}
                choices={row.choices.map((label, i) => ({ value: String(i), label }))}
                onchange={(value) => choose(row, Number(value))} />
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="none">This keyboard has no layout options.</p>
  {/if}

  <div class="board">
    <Keyboard {placement} {faces} labels={[]} {rings} selected={-1} onselect={() => undefined} interactive={false}
      maxUnit={56} />
    <p class="caption">
      {#if rows.length > 0}
        The base layer, as drawn with the options above: {keyCount} {keyCount === 1 ? "key" : "keys"}. The keys ringed
        change with them.
      {:else}
        The base layer: {keyCount} {keyCount === 1 ? "key" : "keys"}.
      {/if}
    </p>
  </div>
</section>

<style>
  .page {
    display: grid;
    gap: 14px;
  }

  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 16px 12px 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  .caption {
    margin: 0;
    color: var(--text-2);
    font-size: 12.5px;
    text-align: center;
  }

  .none {
    margin: 0;
    color: var(--text-2);
  }

  .card {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 14px 16px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .options {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .option {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 4px 0;
    border-top: 1px solid var(--border);
  }

  .option:first-child {
    border-top: 0;
  }

  .option > :global(*) {
    flex: 1;
  }
</style>
