// When an element's tip (ui/Tip.svelte) shows and goes: as a browser tooltip does, but at once.

/** The handlers of an element with a tip, to spread onto it: the tip shows while the element is pointed at, and
 * when it gets the focus other than by a press on it (Tab, arrows, the page moving the focus); a press on it takes
 * the tip away, and it stays away through the focus that follows the press. */
export function tipHandlers(show: (element: HTMLElement) => void, hide: () => void) {
  let pressed = false;
  return {
    onpointerenter: (e: PointerEvent) => show(e.currentTarget as HTMLElement),
    onpointerleave: () => hide(),
    onpointerdown: () => {
      pressed = true;
      hide();
    },
    // the focus comes between the press and its release; an element focused already gets no focus event
    onpointerup: () => {
      pressed = false;
    },
    onfocus: (e: FocusEvent) => {
      if (!pressed) show(e.currentTarget as HTMLElement);
      pressed = false;
    },
    onblur: () => hide(),
  };
}
