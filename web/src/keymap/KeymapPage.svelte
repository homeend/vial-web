<script lang="ts">
  import { tick } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { placeKeyboard } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { keyFace, keyTitle, layerLabel, namesOf, type KeyFace } from "../keyboard/labels";
  import { actionAt, whereIs, type KeyRef } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
  import Picker from "../picker/Picker.svelte";
  import Inspector from "./Inspector.svelte";
  import KindLegend from "./KindLegend.svelte";
  import LayerTabs from "./LayerTabs.svelte";
  import { neighbour, type Direction } from "./navigation";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  let layer = $state(0);
  let selection = $state<KeyRef | null>(null);
  let pickerOpen = $state(false);
  // a pick can't be applied while the keyboard is unplugged or being re-read: close the picker
  $effect(() => {
    if (!keyboard.canEdit) pickerOpen = false;
  });

  const names = $derived(namesOf(model));
  const placement = $derived(placeKeyboard(model));
  const actions = $derived(placement.items.map((item) => actionAt(model, layer, item)));
  const EMPTY: KeyFace = { main: "", shifted: null, altGr: null, hold: null, tone: "none" };
  const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY)));
  // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
  const labels = $derived(
    placement.items.map((item, i) => {
      const action = actions[i];
      const { what, where } = whereIs(model, item);
      return `${action ? keyTitle(action, names) : "Empty"} (${what.toLowerCase()} ${where})`;
    }),
  );
  const selectedIndex = $derived(
    selection ? placement.items.findIndex((i) => i.kind === selection?.kind && i.index === selection.index) : -1,
  );

  // a layer or key that no longer exists (another keyboard, other layout options) falls back to the first one
  $effect(() => {
    if (layer >= model.layers.length) layer = 0;
    if (selectedIndex === -1 && placement.items.length > 0) {
      const first = placement.items[0];
      selection = { kind: first.kind, index: first.index };
    }
  });

  function select(index: number) {
    const item = placement.items[index];
    if (item) selection = { kind: item.kind, index: item.index };
  }

  async function focusSelected() {
    await tick();
    if (selection) document.querySelector<HTMLElement>(`[data-ref="${selection.kind}:${selection.index}"]`)?.focus();
  }

  function setCode(code: string, action = "Changing the key") {
    return selection ? keyboard.setCode(layer, selection, code, action) : Promise.resolve(false);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function onkeydown(event: KeyboardEvent) {
    // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
    if (document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, dialog, [role=tab]")) return;
    const onKey = target === document.body || target.hasAttribute("data-ref");
    const direction = ARROWS[event.key];
    if (direction && selectedIndex >= 0) {
      event.preventDefault();
      select(neighbour(placement.items, selectedIndex, direction));
      void focusSelected();
    } else if (event.key === "Enter" && onKey && selection && keyboard.canEdit) {
      event.preventDefault();
      pickerOpen = true;
    } else if (event.key === "Delete" && onKey && selection) {
      event.preventDefault();
      void setCode("KC_NO", "Clearing the key");
    }
  }

  const current = $derived(selection ? actionAt(model, layer, selection) : undefined);
  const subject = $derived.by(() => {
    if (!selection) return "";
    const { what, where } = whereIs(model, selection);
    return `${what} ${where} on ${layerLabel(layer, names)}`;
  });
</script>

<svelte:window {onkeydown} />

<section class="keymap" aria-labelledby="keymap-title">
  <header class="head">
    <h1 id="keymap-title">Keymap</h1>
    <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete clears it.</p>
  </header>

  <LayerTabs
    layers={model.layers}
    active={layer}
    canRename={keyboard.canEdit}
    onselect={(i) => (layer = i)}
    onrename={(i, name) => keyboard.renameLayer(i, name)}
  />

  <div class="workspace">
    <div class="board">
      <Keyboard {placement} {faces} {labels} selected={selectedIndex} onselect={select} />
      <KindLegend />
    </div>

    {#if selection && current}
      {#key `${selection.kind}:${selection.index}`}
        <Inspector
          {model}
          {names}
          {layer}
          {selection}
          canEdit={keyboard.canEdit && keyboard.pending === 0}
          onchangekey={() => (pickerOpen = true)}
          onsetcode={setCode}
          ontapdance={() => selection && keyboard.turnIntoTapDance(layer, selection)}
          onjump={(i) => (layer = i)}
        />
      {/key}
    {/if}
  </div>
</section>

{#if selection && current}
  <Picker
    bind:open={pickerOpen}
    {subject}
    categories={keyboard.catalogue}
    current={current.code}
    {names}
    onpick={(code) => {
      void setCode(code).then(() => focusSelected());
    }}
  />
{/if}

<style>
  .keymap {
    display: grid;
    gap: 16px;
  }

  .head h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  .head p {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .board {
    display: grid;
    gap: 14px;
    min-width: 0;
    padding: 16px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  @media (min-width: 1000px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 290px;
    }
  }
</style>
