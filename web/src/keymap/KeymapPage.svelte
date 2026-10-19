<script lang="ts">
  import { tick } from "svelte";
  import { analyse, comboMarksOf } from "../analysis/analysis";
  import { combosUsing } from "../analysis/combos";
  import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
  import { comboMarkLabel, foundLabel, type PhraseContext } from "../analysis/phrases";
  import type { KeyboardModel } from "../api/types";
  import { placeKeyboard } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, keyLabel, layerLabel, namesOf } from "../keyboard/labels";
  import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
  import { browserStorage } from "../lib/theme";
  import Picker from "../picker/Picker.svelte";
  import Inspector from "./Inspector.svelte";
  import FindBox from "./FindBox.svelte";
  import KindLegend from "./KindLegend.svelte";
  import LayerTabs from "./LayerTabs.svelte";
  import { neighbour, type Direction } from "./navigation";
  import Overview from "./Overview.svelte";
  import ReachList from "./ReachList.svelte";
  import { readReachOpen, readView, saveReachOpen, saveView, type KeymapView } from "./view";
  import ViewSwitch from "./ViewSwitch.svelte";

  interface Props {
    model: KeyboardModel;
  }

  let { model }: Props = $props();

  let view = $state<KeymapView>(readView(browserStorage()));
  let reachOpen = $state(readReachOpen(browserStorage()));
  let findText = $state("");
  let layer = $state(0);
  let selection = $state<KeyRef | null>(null);
  let pickerOpen = $state(false);
  // a pick can't be applied while the keyboard is unplugged or being re-read: close the picker
  $effect(() => {
    if (!keyboard.canEdit) pickerOpen = false;
  });

  const names = $derived(namesOf(model));
  const placement = $derived(placeKeyboard(model));
  // layers reached, combo keys, usage: worked out again from the model after every edit
  const analysis = $derived(analyse(model, placement));
  const phrases = $derived<PhraseContext>({ model, names, positions: analysis.positions });
  // what the find box looks for, everywhere the keymap produces it (in the keyboard language's legends)
  const found = $derived(
    findOnKeymap(model, placement, queryOf(findText, keyboard.catalogue), analysis.combos, analysis.usage,
      analysis.codes[0]),
  );
  const foundResults = $derived(
    found.map((f) => ({
      label: foundLabel(f, phrases),
      place: f.type === "key" ? { layer: f.layer, ref: f.ref } : f.key,
    })),
  );
  const highlighted = $derived(foundKeys(found, model.layers.length));
  const actions = $derived(placement.items.map((item) => actionAt(model, layer, item)));
  const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY_FACE)));
  const comboMarks = $derived(comboMarksOf(analysis, placement, layer));
  const highlights = $derived(placement.items.map((item) => highlighted[layer]?.has(refId(item)) ?? false));
  // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
  const labels = $derived(
    placement.items.map((item, i) => {
      const { what, where } = whereIs(model, item);
      const label = keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
      return `${label}${comboMarkLabel(comboMarks.combos[i])}${highlights[i] ? " · matches the search" : ""}`;
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

  function changeView(next: KeymapView) {
    view = next;
    saveView(browserStorage(), next);
  }

  /** From the Overview: the layer, in the Edit view, with the focus on its tab */
  async function openLayer(index: number) {
    layer = index;
    changeView("edit");
    await tick();
    document.getElementById(`layer-tab-${index}`)?.focus();
  }

  /** From a find result: the key, selected in the Edit view on its layer */
  async function openKey(place: Place) {
    layer = place.layer;
    selection = place.ref;
    changeView("edit");
    await focusSelected();
  }

  function select(index: number) {
    const item = placement.items[index];
    if (item) selection = { kind: item.kind, index: item.index };
  }

  async function focusSelected() {
    await tick();
    if (selection) document.querySelector<HTMLElement>(`[data-ref="${refId(selection)}"]`)?.focus();
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
    return selection ? keyboard.turnIntoTapDance(layer, selection).then((index) => index !== null) : Promise.resolve(false);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function onkeydown(event: KeyboardEvent) {
    // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
    if (view !== "edit" || document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey ||
      event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target as HTMLElement;
    // Enter and Delete act on the key that has the focus, never on one the focus merely fell from (to <body>);
    // the arrows also start from <body>, and leave every other control (buttons, tabs, fields) alone
    const ref = target instanceof HTMLElement ? target.getAttribute("data-ref") : null;
    const focused = ref === null ? -1 : placement.items.findIndex((i) => refId(i) === ref);
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
  const comboUses = $derived(
    selection ? combosUsing(analysis.combos, model, analysis.codes[layer] ?? new Map(), layer, selection) : [],
  );
  const subject = $derived.by(() => {
    if (!selection) return "";
    const { what, where } = whereIs(model, selection);
    return `${what} ${where} on ${layerLabel(layer, names)}`;
  });
</script>

<svelte:window {onkeydown} />

<section class="keymap" aria-labelledby="keymap-title">
  <header class="head">
    <div class="title">
      <h1 id="keymap-title">Keymap</h1>
      {#if view === "edit"}
        <p>Click a key to see what it does. Arrow keys move, Enter changes it, Delete or Backspace clears it.</p>
      {:else}
        <p>Every layer at once, and how each one is reached. Click a layer to edit it.</p>
      {/if}
    </div>
    <ViewSwitch {view} onchange={changeView} />
  </header>

  {#snippet find()}
    <FindBox bind:text={findText} results={foundResults} onopen={(place) => void openKey(place)} />
  {/snippet}

  {#if view === "overview"}
    {@render find()}
    <Overview
      {model} {phrases} {placement} {analysis} {highlighted} current={layer} onopen={(i) => void openLayer(i)}
    />
  {:else}
    <!-- the Inspector beside everything from the find box down, so that it starts high enough to fit the window -->
    <div class="workspace">
      <div class="main">
        {@render find()}
        <LayerTabs
          layers={model.layers}
          active={layer}
          canRename={keyboard.canEdit}
          onselect={(i) => (layer = i)}
          onrename={(i, name) => keyboard.rename("layers", i, name)}
        />
        <div class="layer" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{layer}">
          {#if analysis.reach[layer]}
            <ReachList
              reach={analysis.reach[layer]}
              ctx={phrases}
              open={reachOpen}
              ontoggle={(open) => {
                reachOpen = open;
                saveReachOpen(browserStorage(), open);
              }}
            />
          {/if}
          <div class="board">
            <Keyboard {placement} {faces} {labels} combos={comboMarks.colours} {highlights} selected={selectedIndex}
              onselect={select} />
            <KindLegend />
          </div>
        </div>
      </div>

      {#if selection && current}
        {#key refId(selection)}
          <Inspector
            {model}
            {names}
            {layer}
            {selection}
            canEdit={keyboard.canEdit && keyboard.pending === 0}
            {comboUses}
            comboColours={analysis.comboColours}
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
  {/if}
</section>

{#if view === "edit" && selection && current}
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

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px 16px;
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

  .main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    min-width: 0;
  }

  .layer {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
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
