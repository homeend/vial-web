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
  import { EMPTY_FACE, keyFace, keyLabel, keyTitle, layerLabel, namesOf } from "../keyboard/labels";
  import { actionAt, refId, whereIs, type KeyRef } from "../keyboard/refs";
  import { keyboard } from "../lib/keyboard.svelte";
  import { router } from "../lib/router.svelte";
  import { browserStorage } from "../lib/theme";
  import { toasts } from "../lib/toasts.svelte";
  import Picker from "../picker/Picker.svelte";
  import DropMenu from "./DropMenu.svelte";
  import Inspector from "./Inspector.svelte";
  import FindBox from "./FindBox.svelte";
  import KindLegend from "./KindLegend.svelte";
  import LayerTabs from "./LayerTabs.svelte";
  import {
    dropTarget, LONG_PRESS_MS, moveDone, movePlan, pickHint, pressState, stillApplies, undoOf, type Change, type MoveKind,
    type Press,
  } from "./move";
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

  /** A click on a key: selects it, or, while the other key of a move is being chosen, is that key */
  function clickKey(index: number) {
    if (picking) void pickTarget(index);
    else select(index);
  }

  async function focusSelected() {
    await tick();
    if (kept.selection) document.querySelector<HTMLElement>(`[data-ref="${refId(kept.selection)}"]`)?.focus();
  }

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
    if (event.key === "Escape" && press) {
      event.preventDefault();
      cancelPress();
      return;
    }
    if (picking) {
      onPickingKey(event, focused, direction, target === document.body);
      return;
    }
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

  // ---- Moving a key onto another of the layer shown: dragged there, or chosen with the keyboard (the Inspector) ----

  /** the area holding the keys: a press on one of its keys may become a drag, and the drop menu goes in it */
  let keysArea = $state<HTMLElement>();
  /** a press on a key that may become a drag (nothing shows: a plain click stays a click) */
  let press: { pointerId: number; source: number; start: Press; timer?: ReturnType<typeof setTimeout> } | null = null;
  /** the drag shown: the key dragged, where the pointer is, and the key it would drop on */
  let drag = $state<{ source: number; x: number; y: number; over: number | null } | null>(null);
  /** a drag that ended makes a click (on a key, or around it), which mustn't select anything */
  let dragEnded = false;
  /** the menu of a drop: on the key dropped on, offering to replace it or swap the two; working while it writes. It
   * names the keys as they were dropped, not as the first of two writes leaves them. */
  let drop = $state<{
    source: number; target: number; layer: number; working: MoveKind | null; sourceTitle: string; targetTitle: string;
  } | null>(null);
  /** the Inspector's Copy or Swap was chosen: the next key chosen is the other one (cursor: the key the arrows reached) */
  let picking = $state<{ kind: MoveKind; source: number; layer: number; cursor: number } | null>(null);

  /** What a placed key does on the layer shown, in words */
  function titleOf(index: number): string {
    const item = placement.items[index];
    const action = item ? actionAt(model, kept.layer, item) : undefined;
    return action ? keyTitle(action, names) : "Empty";
  }

  // what is being moved shows on the keys: the key dragged is faint, the one it would land on ringed
  const moveRings = $derived(
    placement.items.map((_, i) =>
      i === drag?.over || i === drop?.target || (picking && i === picking.cursor && i !== picking.source)
        ? "var(--accent)" : null),
  );
  const moveFaded = $derived(placement.items.map((_, i) => i === drag?.source || i === drop?.source));

  // a move is for the layer shown, on a keyboard that can be changed: otherwise it is given up
  $effect(() => {
    if (!keyboard.canEdit || kept.view !== "edit") {
      untrack(cancelPress);
      if (!drop?.working) drop = null;
      picking = null;
    }
    if (picking && picking.layer !== kept.layer) picking = null;
    if (drop && !drop.working && drop.layer !== kept.layer) drop = null;
  });

  /** The placed key an element is part of, in the keys area; -1 for none */
  function keyIndexAt(element: Element | null): number {
    const key = element?.closest<HTMLElement>("[data-ref]");
    if (!key || !keysArea?.contains(key)) return -1;
    return placement.items.findIndex((i) => refId(i) === key.dataset.ref);
  }

  function onpointerdown(event: PointerEvent) {
    dragEnded = false;
    if (event.button !== 0 || !event.isPrimary || press || picking) return;
    if (!keyboard.canEdit || keyboard.pending > 0 || drop?.working) return;
    const source = keyIndexAt(event.target as Element);
    if (source < 0 || placement.items[source].kind !== "key") return;
    const start = { x: event.clientX, y: event.clientY, time: event.timeStamp, touch: event.pointerType !== "mouse" };
    press = { pointerId: event.pointerId, source, start };
    // a finger (or pen) that holds the key still long enough picks it up, before it moves
    if (start.touch) press.timer = setTimeout(() => startDrag(start.x, start.y), LONG_PRESS_MS);
  }

  function startDrag(x: number, y: number) {
    if (!press || drag) return;
    clearTimeout(press.timer);
    drop = null;
    drag = { source: press.source, x, y, over: null };
  }

  function onpointermove(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!drag) {
      const state = pressState(press.start, event.clientX, event.clientY, event.timeStamp);
      if (state === "scroll") cancelPress();
      if (state !== "drag") return;
      startDrag(event.clientX, event.clientY);
    }
    if (!drag) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const index = keyIndexAt(under);
    const over = dropTarget(placement.items, drag.source, index >= 0 ? refId(placement.items[index]) : null);
    drag = { ...drag, x: event.clientX, y: event.clientY, over };
  }

  function onpointerup(event: PointerEvent) {
    // the click a release makes comes straight after it: only that one is swallowed after a drag
    setTimeout(() => (dragEnded = false));
    if (!press || event.pointerId !== press.pointerId) return;
    const dragged = drag;
    cancelPress();
    // not dragged: the key's click selects it
    if (!dragged || dragged.over === null) return; // dropped on the key itself, or outside the keyboard
    const { source, over: target } = dragged;
    drop = { source, target, layer: kept.layer, working: null, sourceTitle: titleOf(source), targetTitle: titleOf(target) };
  }

  /** Ends a press, and its drag, with no move */
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    if (drag) dragEnded = true;
    press = null;
    drag = null;
  }

  // the browser mustn't scroll the page while a finger drags a key (a passive listener can't stop it)
  $effect(() => {
    const area = keysArea;
    if (!area) return;
    const touchmove = (event: TouchEvent) => {
      if (drag) event.preventDefault();
    };
    area.addEventListener("touchmove", touchmove, { passive: false });
    return () => area.removeEventListener("touchmove", touchmove);
  });

  // the grabbing cursor wherever the pointer goes; none once the page goes (with a press it had)
  $effect(() => {
    document.documentElement.classList.toggle("dragging-key", drag !== null);
  });
  $effect(() => () => {
    untrack(cancelPress);
    document.documentElement.classList.remove("dragging-key");
  });

  /** Replace the target with the source key, or swap the two, on the layer shown. A toast says what was done and
   * offers to undo it. Returns whether it was done. */
  async function move(kind: MoveKind, source: number, target: number): Promise<boolean> {
    const from = placement.items[source];
    const to = placement.items[target];
    const layer = kept.layer;
    const fromAction = actionAt(model, layer, from);
    const toAction = actionAt(model, layer, to);
    if (!fromAction || !toAction) return false;
    const changes = movePlan(kind, { ref: from, code: fromAction.code }, { ref: to, code: toAction.code });
    const words = (ref: KeyRef, title: string) => ({ title, where: whereIs(model, ref).where });
    const said = moveDone(kind, words(from, titleOf(source)), words(to, titleOf(target)));
    if (changes.length === 0) {
      toasts.info(`Nothing to change: both keys already are ${titleOf(source)}.`);
      return true;
    }
    const done = await keyboard.setCodes(layer, changes, kind === "swap" ? "Swapping the keys" : "Copying the key");
    if (done) {
      const uid = model.uid;
      toasts.info(said, { label: "Undo", run: () => undoMove(uid, layer, changes, kind) });
    }
    return done;
  }

  /** Puts a move back, unless the keys were changed since (or it is another keyboard): that would undo something
   * else. Resolves to whether the toast offering it can go. */
  async function undoMove(uid: string, layer: number, changes: Change[], kind: MoveKind): Promise<boolean> {
    const action = kind === "swap" ? "Undoing the swap" : "Undoing the copy";
    const now = keyboard.model;
    if (!now || now.uid !== uid || !stillApplies(now, layer, changes)) {
      toasts.error(`${action} failed: the keys were changed since.`);
      return true;
    }
    if (keyboard.pending > 0) {
      toasts.error(`${action} failed: another change was still being saved. Try again.`);
      return false;
    }
    if (!keyboard.canEdit) {
      toasts.error(`${action} failed: the keyboard can't be changed just now.`);
      return false;
    }
    return keyboard.setCodes(layer, undoOf(changes), action);
  }

  /** The drop menu's choice: the menu stays while the keys are written; then the key dropped on is selected */
  async function chooseDrop(kind: MoveKind) {
    if (!drop || drop.working || keyboard.pending > 0) return;
    const { source, target } = drop;
    drop = { ...drop, working: kind };
    const done = await move(kind, source, target);
    drop = null;
    if (done) select(target);
    await focusSelected();
  }

  /** The Inspector's Copy or Swap: the next key chosen is the other one */
  function startPicking(kind: MoveKind) {
    if (!keyboard.canEdit || keyboard.pending > 0 || placement.items[selectedIndex]?.kind !== "key") return;
    drop = null;
    picking = { kind, source: selectedIndex, layer: kept.layer, cursor: selectedIndex };
    void focusSelected();
  }

  function stopPicking() {
    picking = null;
    void focusSelected();
  }

  /** The other key of a move chosen from the Inspector. Choosing the key itself gives up; an encoder isn't one. */
  async function pickTarget(index: number) {
    if (!picking || keyboard.pending > 0) return;
    const { kind, source } = picking;
    if (index === source) {
      stopPicking();
      return;
    }
    if (placement.items[index]?.kind !== "key") return;
    picking = null;
    if (await move(kind, source, index)) select(index);
    await focusSelected();
  }

  /** While the other key is chosen: the arrows move among the keys without selecting them, Enter chooses, Esc gives
   * up; Delete doesn't clear anything */
  function onPickingKey(event: KeyboardEvent, focused: number, direction: Direction | undefined, fromBody: boolean) {
    if (!picking) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stopPicking();
    } else if (direction && (focused >= 0 || fromBody)) {
      event.preventDefault();
      const cursor = neighbour(placement.items, focused >= 0 ? focused : picking.cursor, direction);
      picking = { ...picking, cursor };
      void tick().then(() =>
        document.querySelector<HTMLElement>(`[data-ref="${refId(placement.items[cursor])}"]`)?.focus());
    } else if (event.key === "Enter" && focused >= 0) {
      event.preventDefault();
      void pickTarget(focused);
    } else if ((event.key === "Delete" || event.key === "Backspace") && focused >= 0) {
      event.preventDefault();
    }
  }

  const current = $derived(kept.selection ? actionAt(model, kept.layer, kept.selection) : undefined);
  const comboUses = $derived(
    kept.selection
      ? combosUsing(analysis.combos, model, analysis.codes[kept.layer] ?? new Map(), kept.layer, kept.selection)
      : [],
  );
  const subject = $derived.by(() => {
    if (!kept.selection) return "";
    const { what, where } = whereIs(model, kept.selection);
    return `${what} ${where} on ${layerLabel(kept.layer, names)}`;
  });
</script>

<svelte:window {onkeydown} {onpointermove} {onpointerup} onpointercancel={(e) => {
  if (press && e.pointerId === press.pointerId) cancelPress();
}} />

<section class="keymap" aria-labelledby="keymap-title">
  <header class="head">
    <div class="title">
      <!-- focusable from script: it takes the focus when the page is shown from the back button (App.svelte) -->
      <h1 id="keymap-title" tabindex="-1">Keymap</h1>
      {#if kept.view === "edit"}
        <p>
          Click a key to see what it does, or drag it onto another to copy or swap it. Arrow keys move, Enter changes
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

  {#if kept.view === "overview"}
    {@render find()}
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
            {#if picking}
              <div class="pick-hint">
                <p role="status">{pickHint(picking.kind, titleOf(picking.source))}</p>
                <button type="button" onclick={stopPicking}>Cancel</button>
              </div>
            {/if}
            <!-- a press on a key may become a drag: the click that ends one mustn't select a key -->
            <div
              class="keys"
              class:dragging={drag !== null}
              role="presentation"
              bind:this={keysArea}
              {onpointerdown}
              onclickcapture={(e) => {
                if (dragEnded) {
                  dragEnded = false;
                  e.stopPropagation();
                }
              }}
              oncontextmenu={(e) => {
                // a finger holding a key picks it up, rather than asking for the browser's menu
                if (press?.start.touch) e.preventDefault();
              }}
            >
              <Keyboard {placement} {faces} {labels} combos={comboMarks.colours} {highlights} selected={selectedIndex}
                rings={moveRings} faded={moveFaded} tabStop={picking?.cursor} onselect={clickKey} />
              {#if drop && keysArea}
                {@const anchor = keysArea.querySelector<HTMLElement>(`[data-ref="${refId(placement.items[drop.target])}"]`)}
                {#if anchor}
                  <DropMenu
                    {anchor}
                    within={keysArea}
                    source={drop.sourceTitle}
                    target={drop.targetTitle}
                    working={drop.working}
                    onchoose={(kind) => void chooseDrop(kind)}
                    oncancel={(refocus) => {
                      drop = null;
                      if (refocus) void focusSelected();
                    }}
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
            moving={picking?.kind ?? null}
            onmove={startPicking}
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

{#if drag}
  <!-- the key dragged, beside the pointer -->
  <div class="drag-ghost" style:left="{drag.x}px" style:top="{drag.y}px" aria-hidden="true">
    <KeyCap face={faces[drag.source]} size={52} />
  </div>
{/if}

{#if kept.view === "edit" && kept.selection && current}
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

  .pick-hint {
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
