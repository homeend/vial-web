<script lang="ts">
  import { tick } from "svelte";
  import type { KeyboardModel } from "../api/types";
  import { placeKeyboard } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { keyFace, keyLabel, layerLabel, namesOf, type KeyFace } from "../keyboard/labels";
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
      const { what, where } = whereIs(model, item);
      return keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
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

  /** Runs an action of the Inspector. Its buttons are disabled meanwhile, and the one pressed may go away: the
   * focus would fall to the page. The selected key gets it back: when it fell, or when the action worked and the
   * focus is still where it started (not somewhere the user moved it meanwhile). */
  async function fromInspector(run: () => Promise<boolean>): Promise<boolean> {
    const origin = document.activeElement;
    const done = await run();
    await tick();
    const now = document.activeElement;
    if (!now || now === document.body || (done && now === origin)) await focusSelected();
    return done;
  }

  function turnIntoTapDance() {
    return selection ? keyboard.turnIntoTapDance(layer, selection) : Promise.resolve(false);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function onkeydown(event: KeyboardEvent) {
    // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
    if (document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target as HTMLElement;
    // Enter and Delete act on the key that has the focus, never on one the focus merely fell from (to <body>);
    // the arrows also start from <body>, and leave every other control (buttons, tabs, fields) alone
    const ref = target instanceof HTMLElement ? target.getAttribute("data-ref") : null;
    const focused = ref === null ? -1 : placement.items.findIndex((i) => `${i.kind}:${i.index}` === ref);
    const onKey = focused >= 0;
    const direction = ARROWS[event.key];
    const handled = direction || event.key === "Enter" || event.key === "Delete" || event.key === "Backspace";
    // the focused key may not be the selected one (focus moved without a click, a press dragged off a key before
    // its release): it is the one these keys act on, and the one the arrows move from
    if (handled && onKey && focused !== selectedIndex) select(focused);
    if (direction && (onKey || target === document.body) && selectedIndex >= 0) {
      event.preventDefault();
      select(neighbour(placement.items, selectedIndex, direction));
      void focusSelected();
    } else if (event.key === "Enter" && onKey && selection && keyboard.canEdit) {
      event.preventDefault();
      pickerOpen = true;
    } else if ((event.key === "Delete" || event.key === "Backspace") && onKey && selection) {
      // Backspace too: the Mac's "delete" key
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
    <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete or Backspace clears it.</p>
  </header>

  <LayerTabs
    layers={model.layers}
    active={layer}
    canRename={keyboard.canEdit}
    onselect={(i) => (layer = i)}
    onrename={(i, name) => keyboard.renameLayer(i, name)}
  />

  <div class="workspace">
    <div class="board" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{layer}">
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
          onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
          ontapdance={() => fromInspector(turnIntoTapDance)}
          onjump={(i) => {
            layer = i;
            void focusSelected();
          }}
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
    /* the Inspector goes beside the keyboard when the keymap itself is wide enough, whatever else is on the page */
    container: keymap / inline-size;
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
    /* not "auto": the keyboard measures this column, which must narrow with the window as well as widen */
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    min-width: 0;
    padding: 16px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--board-bg);
    box-shadow: var(--shadow);
  }

  @container keymap (min-width: 900px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 290px;
    }
  }
</style>
