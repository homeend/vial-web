<script lang="ts">
  // A combo's keys drawn on the base layer: a picture with its keys ringed in the combo's colour, or (choosing) keys
  // to click, arrow keys moving between them, each click adding a key or taking it out.
  import { tick } from "svelte";
  import type { Described, KeyboardModel } from "../api/types";
  import type { Placement } from "../keyboard/geometry";
  import Keyboard from "../keyboard/Keyboard.svelte";
  import { EMPTY_FACE, keyFace, keyLabel, type Names } from "../keyboard/labels";
  import { actionAt, refId, whereIs } from "../keyboard/refs";
  import { neighbour, type Direction } from "../keymap/navigation";
  import { memberProblem } from "./members";

  interface Props {
    model: KeyboardModel;
    placement: Placement;
    names: Names;
    /** the combo's keycodes */
    members: Described[];
    /** the combo's colour: a palette index */
    colour: number;
    /** keys to click (choosing the members); otherwise a picture */
    choosing?: boolean;
    /** a key clicked while choosing: its keycode on the base layer */
    onchoose?: (d: Described) => void;
    maxUnit?: number;
    /** what the picture is called, for screen readers (choosing, the keys say it themselves) */
    label?: string;
  }

  let { model, placement, names, members, colour, choosing = false, onchoose, maxUnit = 24, label = "" }: Props = $props();

  let root = $state<HTMLDivElement>();
  let cursor = $state(0);
  /** the keys have the focus: the one the arrow keys move from is outlined */
  let focused = $state(false);

  const codes = $derived(new Set(members.map((m) => m.code)));
  const actions = $derived(placement.items.map((item) => (item.kind === "key" ? actionAt(model, 0, item) : undefined)));
  const isMember = $derived(actions.map((d) => d !== undefined && codes.has(d.code)));
  const usable = $derived(actions.map((d) => memberProblem(d) === null));
  const faces = $derived(placement.items.map((item) => {
    const d = actionAt(model, 0, item);
    return d ? keyFace(d, names) : EMPTY_FACE;
  }));
  const rings = $derived(isMember.map((m) => (m ? `var(--combo-${colour})` : null)));
  const faded = $derived(choosing ? usable.map((u) => !u) : isMember.map((m) => !m));
  const labels = $derived(placement.items.map((item, i) => {
    if (!choosing) return "";
    const { what, where } = whereIs(model, item);
    const state = isMember[i] ? "in the combo" : usable[i] ? "not in the combo" : "can't be in a combo";
    return `${keyLabel(actions[i], names, `${what.toLowerCase()} ${where}`)} · ${state}`;
  }));

  function choose(index: number) {
    cursor = index;
    const d = actions[index];
    if (d) onchoose?.(d);
  }

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  async function onkeydown(event: KeyboardEvent) {
    const direction = ARROWS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    cursor = neighbour(placement.items, cursor, direction);
    await tick();
    const item = placement.items[cursor];
    if (item) root?.querySelector<HTMLElement>(`[data-ref="${refId(item)}"]`)?.focus();
  }
</script>

{#if choosing}
  <!-- the arrow keys move between the keys, as in the keymap -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="keys choosing"
    bind:this={root}
    {onkeydown}
    onfocusin={() => (focused = true)}
    onfocusout={(e) => (focused = root?.contains(e.relatedTarget as Node | null) ?? false)}
  >
    <Keyboard {placement} {faces} {labels} {rings} {faded} chosen={isMember} selected={focused ? cursor : -1}
      onselect={choose} {maxUnit} />
  </div>
{:else}
  <div class="keys" role="img" aria-label={label}>
    <Keyboard {placement} {faces} {labels} {rings} {faded} selected={-1} onselect={() => undefined} interactive={false}
      compact {maxUnit} />
  </div>
{/if}

<style>
  .keys {
    min-width: 0;
  }
</style>
