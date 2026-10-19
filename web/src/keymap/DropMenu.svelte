<script lang="ts">
  import { tick } from "svelte";
  import { menuPlace, type MoveKind } from "./move";

  interface Props {
    /** the key dropped on: the menu goes below it (above when the window has no room below) */
    anchor: HTMLElement;
    /** what holds the menu (positioned): the menu stays inside its width */
    within: HTMLElement;
    /** what the key dragged does, and the key dropped on */
    source: string;
    target: string;
    /** the move being written: the menu stays, keeping the focus, and takes nothing until it is done */
    working: MoveKind | null;
    onchoose: (kind: MoveKind) => void;
    /** closed without a move. refocus: the focus goes back to the keyboard (Esc, Cancel), or stays where a click
     * elsewhere put it */
    oncancel: (refocus: boolean) => void;
  }

  let { anchor, within, source, target, working, onchoose, oncancel }: Props = $props();

  let menu = $state<HTMLElement>();
  let place = $state<{ left: number; top: number } | null>(null);
  const uid = $props.id();

  function position() {
    if (!menu) return;
    place = menuPlace(anchor.getBoundingClientRect(), within.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.offsetHeight }, window.innerHeight);
  }

  // placed once it can be measured; then the first item has the focus, as a menu's does
  let focused = false;
  $effect(() => {
    if (!menu) return;
    position();
    if (focused) return;
    focused = true;
    // once it shows: a hidden element doesn't take the focus
    void tick().then(() => menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  });

  function items(): HTMLElement[] {
    return menu ? Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]")) : [];
  }

  function onkeydown(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = ({
      ArrowDown: (at + 1) % all.length,
      ArrowUp: (at - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    } as Record<string, number>)[event.key];
    if (next !== undefined) {
      event.preventDefault();
      all[next]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      // the keymap's own keys (Esc, the arrows) aren't for it
      event.preventDefault();
      if (!working) oncancel(true);
    }
  }

  function choose(kind: MoveKind) {
    if (!working) onchoose(kind);
  }
</script>

<svelte:window
  onresize={position}
  onpointerdown={(event) => {
    if (!working && menu && !menu.contains(event.target as Node)) oncancel(false);
  }}
/>

<!-- the moves a drop can make, under what is dropped onto what (outside the menu, which has menu items only); hidden
     until it is placed, so it doesn't show where it isn't -->
<div
  bind:this={menu}
  class="drop-menu"
  style:left="{place?.left ?? 0}px"
  style:top="{place?.top ?? 0}px"
  style:visibility={place ? null : "hidden"}
>
  <p class="title" id="{uid}-title"><span title={source}>{source}</span> onto <span title={target}>{target}</span></p>
  <div class="items" role="menu" tabindex="-1" aria-labelledby="{uid}-title" aria-busy={working !== null || undefined}
    {onkeydown}>
    <button type="button" role="menuitem" tabindex="-1" aria-disabled={working !== null || undefined}
      onclick={() => choose("replace")}>
      <span class="label" title="Replace {target} with {source}">
        {working === "replace" ? "Replacing…" : `Replace with ${source}`}
      </span>
      <span class="detail">the key dragged stays as it is</span>
    </button>
    <button type="button" role="menuitem" tabindex="-1" aria-disabled={working !== null || undefined}
      onclick={() => choose("swap")}>
      <span class="label">{working === "swap" ? "Swapping…" : "Swap both"}</span>
      <span class="detail">the two keys trade keycodes</span>
    </button>
    <button type="button" role="menuitem" tabindex="-1" aria-disabled={working !== null || undefined}
      onclick={() => {
        if (!working) oncancel(true);
      }}>
      <span class="label">Cancel</span>
    </button>
  </div>
</div>

<style>
  .drop-menu {
    position: absolute;
    z-index: 20;
    width: 230px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    outline: none;
  }

  .items {
    display: grid;
    outline: none;
  }

  /* what is dropped onto what: names can be long, each is cut short (the tooltip has all of it) */
  .title {
    display: flex;
    gap: 4px;
    margin: 2px 6px 6px;
    color: var(--text-3);
    font-size: 12px;
    white-space: nowrap;
  }

  .title span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-2);
    font-weight: 600;
    text-overflow: ellipsis;
  }

  button {
    display: grid;
    gap: 1px;
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  /* the item with the focus shows, however it got it (the first one has it when the menu opens after a drag) */
  button:hover,
  button:focus {
    background: var(--surface-2);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  button[aria-disabled="true"] {
    cursor: progress;
  }

  .label {
    overflow: hidden;
    font-size: 13.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
