<script lang="ts">
  import { tick, untrack } from "svelte";
  import { comboMarksOf, type Analysis } from "../analysis/analysis";
  import { combosUsing } from "../analysis/combos";
  import { findOnKeymap, foundKeys, queryOf, type Place } from "../analysis/find";
  import { comboMarkLabel, foundLabel, type PhraseContext } from "../analysis/phrases";
  import type { KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import KeyCap from "../keyboard/KeyCap.svelte";
  import { EMPTY_FACE, keyFace, keyLabel, layerLabel, namesOf } from "../keyboard/labels";
  import { actionAt, refId, whereIs } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import { browserStorage } from "../lib/theme";
  import Picker from "../picker/Picker.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import ArrangeBar from "./ArrangeBar.svelte";
  import ArrangeDialog from "./ArrangeDialog.svelte";
  import { layerArranger } from "./arranging.svelte";
  import DropMenu from "./DropMenu.svelte";
  import Inspector from "./Inspector.svelte";
  import FindBox from "./FindBox.svelte";
  import KindLegend from "./KindLegend.svelte";
  import LayerTabs from "./LayerTabs.svelte";
  import { KeyMover } from "./move.svelte";
  import { neighbour, type Direction } from "./navigation";
  import Overview from "./Overview.svelte";
  import ReachList from "./ReachList.svelte";
  import { keymapState } from "./state.svelte";
  import { readReachOpen, saveReachOpen, saveView, type KeymapView } from "./view";
  import ViewSwitch from "./ViewSwitch.svelte";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    /** layers reached, combo keys, usage: worked out again from the model after every edit */
    analysis: Analysis;
  }

  let { model, placement, analysis }: Props = $props();

  // the layer, the selected key, the find text and the view outlast the page (see state.svelte.ts)
  const kept = keymapState;
  untrack(() => kept.follow(model.uid));
  $effect.pre(() => kept.follow(model.uid));
  let reachOpen = $state(readReachOpen(browserStorage()));
  let pickerOpen = $state(false);
  // a pick can't be applied while the keyboard is unplugged or being re-read: close the picker
  $effect(() => {
    if (!keyboard.canEdit) pickerOpen = false;
  });

  const names = $derived(namesOf(model));
  const phrases = $derived<PhraseContext>({ model, names, positions: analysis.positions });
  // what the find box looks for, everywhere the keymap produces it (in the keyboard language's legends)
  const found = $derived(
    findOnKeymap(model, placement, queryOf(kept.findText, keyboard.catalogue), analysis.combos, analysis.usage,
      analysis.codes[0]),
  );
  const foundResults = $derived(
    found.map((f) => ({
      label: foundLabel(f, phrases),
      place: f.type === "key" ? { layer: f.layer, ref: f.ref } : f.key,
    })),
  );
  const highlighted = $derived(foundKeys(found, model.layers.length));
  const actions = $derived(placement.items.map((item) => actionAt(model, kept.layer, item)));
  const faces = $derived(actions.map((d) => (d ? keyFace(d, names) : EMPTY_FACE)));
  const comboMarks = $derived(comboMarksOf(analysis, placement, kept.layer));
  const highlights = $derived(placement.items.map((item) => highlighted[kept.layer]?.has(refId(item)) ?? false));
  // what each key does, in words: what screen readers say, and the tooltip (with names a key cap may cut short)
  const labels = $derived(
    placement.items.map((item, i) => {
      const { what, where } = whereIs(model, item);
      const label = keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`);
      return `${label}${comboMarkLabel(comboMarks.combos[i])}${highlights[i] ? " · matches the search" : ""}`;
    }),
  );
  const selectedIndex = $derived.by(() => {
    const selection = kept.selection;
    return selection ? placement.items.findIndex((i) => i.kind === selection.kind && i.index === selection.index) : -1;
  });

  // a layer or key that no longer exists (another keyboard, other layout options) falls back to the first one
  $effect(() => {
    if (kept.layer >= model.layers.length) kept.layer = 0;
    if (selectedIndex === -1 && placement.items.length > 0) {
      const first = placement.items[0];
      kept.selection = { kind: first.kind, index: first.index };
    }
  });

  function changeView(next: KeymapView) {
    kept.view = next;
    saveView(browserStorage(), next);
  }

  /** From the Overview: the layer, in the Edit view, with the focus on its tab */
  async function openLayer(index: number) {
    kept.layer = index;
    changeView("edit");
    await tick();
    document.getElementById(`layer-tab-${index}`)?.focus();
  }

  // a key to show, from another page ("used on" of a tap dance or macro)
  $effect(() => {
    if (router.keyTarget) {
      untrack(() => {
        const place = router.takeKeyTarget();
        if (place) void openKey(place);
      });
    }
  });

  /** From a find result or another page: the key, selected in the Edit view on its layer */
  async function openKey(place: Place) {
    kept.layer = place.layer;
    kept.selection = place.ref;
    changeView("edit");
    await focusSelected();
  }

  function select(index: number) {
    const item = placement.items[index];
    if (item) kept.selection = { kind: item.kind, index: item.index };
  }

  async function focusSelected() {
    await tick();
    if (kept.selection) document.querySelector<HTMLElement>(`[data-ref="${refId(kept.selection)}"]`)?.focus();
  }

  // Arrange layers is for the keyboard this page shows: another one makes the page anew, without it
  $effect(() => () => layerArranger.dropped());

  // a key dragged onto another, or chosen after the Inspector's Swap or Copy (move.svelte.ts)
  const mover = new KeyMover({
    placement: () => placement,
    model: () => model,
    layer: () => kept.layer,
    names: () => names,
    positions: () => analysis.positions,
    editing: () => kept.view === "edit",
    select,
    focusSelected,
  });

  function setCode(code: string, action = "Changing the key") {
    return kept.selection ? keyboard.setCode(kept.layer, kept.selection, code, action) : Promise.resolve(false);
  }

  /** Runs an action of the Inspector. Its buttons take nothing meanwhile (they stay enabled, keeping the focus), and
   * the one pressed may go away or be disabled once it is done: the focus would fall to the page. The selected key
   * gets it back: when it fell, or when the action worked and the focus is still where it started (not somewhere the
   * user moved it meanwhile). Not when it showed another page (a tap dance made opens on its page): that page has the
   * focus, or takes it, whatever order the two pages' updates run in. */
  async function fromInspector(run: () => Promise<boolean>): Promise<boolean> {
    const origin = document.activeElement;
    const done = await run();
    if (router.route.section !== "keymap") return done;
    await tick();
    if (router.route.section !== "keymap") return done;
    const now = document.activeElement;
    if (!now || now === document.body || (done && now === origin)) await focusSelected();
    return done;
  }

  /** The tap dance made opens on its page */
  async function turnIntoTapDance() {
    const index = kept.selection ? await keyboard.turnIntoTapDance(kept.layer, kept.selection) : null;
    if (index !== null) router.go("tap-dance", index);
    return index !== null;
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function onkeydown(event: KeyboardEvent) {
    // a dialog that is open (the picker) has the keyboard; its "close" event comes a moment after it closes
    if (kept.view !== "edit" || document.querySelector("dialog[open]") || event.defaultPrevented || event.altKey ||
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
    if (mover.keydown(event, focused, direction, target === document.body)) return;
    const handled = direction || event.key === "Enter" || event.key === "Delete" || event.key === "Backspace";
    // the focused key may not be the selected one (focus moved without a click, a press dragged off a key before
    // its release): it is the one these keys act on, and the one the arrows move from
    if (handled && onKey && focused !== selectedIndex) select(focused);
    if (direction && (onKey || target === document.body) && selectedIndex >= 0) {
      event.preventDefault();
      select(neighbour(placement.items, selectedIndex, direction));
      void focusSelected();
    } else if (event.key === "Enter" && onKey && kept.selection && keyboard.canEdit) {
      event.preventDefault();
      pickerOpen = true;
    } else if ((event.key === "Delete" || event.key === "Backspace") && onKey && kept.selection) {
      // Backspace too: the Mac's "delete" key
      event.preventDefault();
      void setCode("KC_NO", "Clearing the key");
    }
  }

  const current = $derived(kept.selection ? actionAt(model, kept.layer, kept.selection) : undefined);
  const comboUses = $derived(
    kept.selection
      ? combosUsing(analysis.combos, model, analysis.codes[kept.layer] ?? new Map(), kept.layer, kept.selection)
      : [],
  );
  /** Finish or Put back from the bar: the bar goes once it is done (or once the session says nothing is unfinished:
   * another tab finished it), and the focus, if it was on it, to the heading */
  async function fromBar(run: () => Promise<boolean>): Promise<boolean> {
    const done = await run();
    await tick();
    const focused = document.activeElement;
    if (!focused || focused === document.body) document.getElementById("keymap-title")?.focus();
    return done;
  }

  const subject = $derived.by(() => {
    if (!kept.selection) return "";
    const { what, where } = whereIs(model, kept.selection);
    return `${what} ${where} on ${layerLabel(kept.layer, names)}`;
  });
</script>

<svelte:window
  {onkeydown}
  onpointermove={(e) => mover.pointerMove(e)}
  onpointerup={(e) => mover.pointerUp(e)}
  onpointercancel={(e) => mover.pointerCancel(e)}
/>

<section class="keymap" aria-labelledby="keymap-title">
  <header class="head">
    <div class="title">
      <!-- focusable from script: it takes the focus when the page is shown from the back button (App.svelte) -->
      <h1 id="keymap-title" tabindex="-1">Keymap</h1>
      {#if kept.view === "edit"}
        <p>
          Click a key to see what it does, or drag it onto another to swap or copy it. Arrow keys move, Enter changes
          it, Delete or Backspace clears it.
        </p>
      {:else}
        <p>Every layer at once, and how each one is reached. Click a layer to edit it.</p>
      {/if}
    </div>
    <ViewSwitch view={kept.view} onchange={changeView} />
  </header>

  {#snippet find()}
    <FindBox bind:text={kept.findText} results={foundResults} onopen={(place) => void openKey(place)} />
  {/snippet}

  {#if keyboard.unfinishedArrange}
    <ArrangeBar
      unfinished={keyboard.unfinishedArrange}
      stop={keyboard.unfinishedStop}
      canEdit={keyboard.canEdit}
      onfinish={() => fromBar(() => layerArranger.finish())}
      onputback={() => fromBar(() => layerArranger.putBack())}
    />
  {/if}

  {#if kept.view === "overview"}
    {@render find()}
    <!-- above the layer cards; aria-disabled rather than disabled, so that its tooltip says why it does nothing -->
    <div class="arrange-tools">
      <Button id="arrange-layers-overview" size="sm" class={layerArranger.blocked !== null ? "off" : undefined}
        aria-disabled={layerArranger.blocked !== null || undefined}
        title={layerArranger.blocked ?? "Move layers to other positions; keys that reach them follow"}
        onclick={() => layerArranger.start("arrange-layers-overview")}>Arrange layers…</Button>
    </div>
    <Overview
      {model} {phrases} {placement} {analysis} {highlighted} current={kept.layer} onopen={(i) => void openLayer(i)}
    />
  {:else}
    <!-- the Inspector beside everything from the find box down, so that it starts high enough to fit the window -->
    <div class="workspace">
      <div class="main">
        {@render find()}
        <LayerTabs
          layers={model.layers}
          active={kept.layer}
          canRename={keyboard.canEdit}
          onselect={(i) => (kept.layer = i)}
          onrename={(i, name) => keyboard.rename("layers", i, name)}
          arrangeBlocked={layerArranger.blocked}
          onarrange={() => layerArranger.start("arrange-layers")}
        />
        <div class="layer" role="tabpanel" id="layer-panel" aria-labelledby="layer-tab-{kept.layer}">
          {#if analysis.reach[kept.layer]}
            <ReachList
              reach={analysis.reach[kept.layer]}
              ctx={phrases}
              open={reachOpen}
              ontoggle={(open) => {
                reachOpen = open;
                saveReachOpen(browserStorage(), open);
              }}
            />
          {/if}
          <div class="board">
            <!-- always there, so that screen readers say the hint when it shows; hidden while it is empty -->
            <div class="pick-hint" class:shown={mover.picking !== null}>
              <p role="status">{mover.hint}</p>
              {#if mover.picking}
                <button type="button" onclick={() => mover.stopPicking()}>Cancel</button>
              {/if}
            </div>
            <!-- a press on a key may become a drag: the click that ends one mustn't select a key -->
            <div
              class="keys"
              role="presentation"
              bind:this={mover.area}
              onpointerdown={(e) => mover.pointerDown(e)}
              onclickcapture={(e) => mover.clickCapture(e)}
              oncontextmenu={(e) => mover.contextMenu(e)}
            >
              <Keyboard {placement} {faces} {labels} combos={comboMarks.colours} {highlights} selected={selectedIndex}
                rings={mover.rings} faded={mover.faded} tabStop={mover.picking?.cursor}
                onselect={(i) => mover.click(i) || select(i)} />
              {#if mover.drop && mover.area}
                {@const anchor = mover.dropAnchor}
                {#if anchor}
                  <DropMenu
                    {anchor}
                    within={mover.area}
                    source={mover.drop.sourceTitle}
                    target={mover.drop.targetTitle}
                    working={mover.drop.working}
                    onchoose={(kind) => void mover.chooseDrop(kind)}
                    oncancel={(refocus) => mover.closeDrop(refocus)}
                  />
                {/if}
              {/if}
            </div>
            <KindLegend />
          </div>
        </div>
      </div>

      {#if kept.selection && current}
        {#key refId(kept.selection)}
          <Inspector
            {model}
            {names}
            layer={kept.layer}
            selection={kept.selection}
            canEdit={keyboard.canEdit}
            busy={keyboard.pending > 0}
            {comboUses}
            comboColours={analysis.comboColours}
            onopencombo={(index) => router.go("combos", index)}
            onchangekey={() => (pickerOpen = true)}
            onsetcode={(code, action) => fromInspector(() => setCode(code, action))}
            moving={mover.picking?.kind ?? null}
            onmove={(kind) => mover.togglePicking(kind, selectedIndex)}
            ontapdance={() => fromInspector(turnIntoTapDance)}
            onjump={(i) => {
              kept.layer = i;
              void focusSelected();
            }}
          />
        {/key}
      {/if}
    </div>
  {/if}
</section>

{#if mover.drag}
  <!-- the key dragged, beside the pointer -->
  <div class="drag-ghost" style:left="{mover.drag.x}px" style:top="{mover.drag.y}px" aria-hidden="true">
    <KeyCap face={faces[mover.drag.source]} size={52} />
  </div>
{/if}

<ArrangeDialog
  open={layerArranger.open}
  {model}
  {analysis}
  {phrases}
  onapply={(order, expect, report) => layerArranger.apply(order, expect, report)}
  onfinish={(report) => layerArranger.finish(report)}
  onputback={(report) => layerArranger.putBack(report)}
  onclose={() => layerArranger.closed()}
/>
<ConfirmDialog
  open={layerArranger.asking !== null}
  title="Arrange the layers?"
  message={layerArranger.asking ?? ""}
  confirmLabel="Arrange layers"
  onconfirm={async () => {
    layerArranger.confirm();
    return true;
  }}
  onclose={() => layerArranger.questionClosed()}
/>

{#if kept.view === "edit" && kept.selection && current}
  <Picker
    bind:open={pickerOpen}
    {subject}
    categories={keyboard.pickerCatalogue}
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

  .head h1:focus {
    outline: none;
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

  .arrange-tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: -6px;
  }

  .arrange-tools :global(.off) {
    opacity: 0.5;
    cursor: not-allowed;
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
    position: relative;
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

  .keys {
    position: relative;
    /* a key's labels aren't text to select: a drag from one mustn't select the page instead */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  :global(html.dragging-key),
  :global(html.dragging-key *) {
    cursor: grabbing !important;
  }

  .drag-ghost {
    position: fixed;
    z-index: 60;
    /* beside the pointer, not under it: the key it is over shows */
    transform: translate(10px, 10px);
    pointer-events: none;
    opacity: 0.92;
    filter: drop-shadow(0 6px 14px rgb(16 24 40 / 28%));
  }

  /* empty, it is there for screen readers only: out of the board's grid, and unseen */
  .pick-hint:not(.shown) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .pick-hint.shown {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
    border-radius: 10px;
    background: var(--accent-weak);
    font-size: 13px;
  }

  .pick-hint p {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  .pick-hint button {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text);
    font-size: 12.5px;
    font-weight: 550;
    cursor: pointer;
  }

  .pick-hint button:hover {
    background: var(--surface-2);
  }

  @container keymap (min-width: 900px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 290px;
    }
  }
</style>
