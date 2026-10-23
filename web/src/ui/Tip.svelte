<script lang="ts">
  // A card next to an element, shown at once while the element is pointed at or has the focus: a tooltip of our own
  // in place of the browser's, which comes late and holds one line of plain text. It goes above the element, or below
  // when there is no room above, with an arrow towards it, and is kept inside the window. Whoever shows it decides
  // when it goes (pointer leave, blur, scroll). A screen reader hears the same from the element's own name and
  // description, so the card itself is hidden from it.
  import type { Snippet } from "svelte";

  interface Props {
    /** the element it is about */
    anchor: HTMLElement;
    /** the colour family of its border (a key's tone); none for the plain border */
    tone?: string;
    children: Snippet;
  }

  let { anchor, tone, children }: Props = $props();

  /** from the element, and from the window's edges */
  const GAP = 10;
  const MARGIN = 8;

  let card = $state<HTMLDivElement>();
  let place = $state({ left: 0, top: 0, arrow: 0, above: true, ready: false });

  function put() {
    if (!card) return;
    const key = anchor.getBoundingClientRect();
    const size = card.getBoundingClientRect();
    const above = key.top - size.height - GAP >= MARGIN;
    const left = Math.min(Math.max(MARGIN, key.left + key.width / 2 - size.width / 2),
      window.innerWidth - size.width - MARGIN);
    place = {
      left, top: above ? key.top - size.height - GAP : key.bottom + GAP, arrow: key.left + key.width / 2 - left,
      above, ready: true,
    };
  }

  // placed again for another element, and whenever what it shows changes size
  $effect(() => {
    if (!card) return;
    void anchor;
    put();
    const watch = new ResizeObserver(() => put());
    watch.observe(card);
    return () => watch.disconnect();
  });
</script>

<div
  bind:this={card}
  class="tip"
  class:above={place.above}
  class:below={!place.above}
  data-tone={tone ?? "normal"}
  style:left="{place.left}px"
  style:top="{place.top}px"
  style:--arrow="{place.arrow}px"
  style:visibility={place.ready ? "visible" : "hidden"}
  aria-hidden="true"
>
  {@render children()}
</div>

<style>
  .tip {
    position: fixed;
    z-index: 10;
    width: max-content;
    max-width: min(340px, calc(100vw - 16px));
    padding: 9px 12px 9px;
    border: 1.5px solid color-mix(in srgb, var(--tone) 70%, var(--border));
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.35;
    text-align: left;
    white-space: normal;
    pointer-events: none;
  }

  /* the arrow, towards the element */
  .tip::after {
    content: "";
    position: absolute;
    left: var(--arrow, 50%);
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border: inherit;
    border-width: 0 1.5px 1.5px 0;
    border-radius: 0;
    background: var(--surface);
  }

  .tip.above::after {
    bottom: -6.5px;
    transform: rotate(45deg);
  }

  .tip.below::after {
    top: -6.5px;
    transform: rotate(-135deg);
  }
</style>
