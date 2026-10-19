// A card opened from elsewhere (the address names it): scrolled to, with the focus on its heading, and drawn out for a
// moment (.behaviour-card.target in app.css).
import { tick } from "svelte";
import { router } from "../lib/router.svelte";

/** Each time `id` names another element, or the route naming it is shown again (the same card opened again), scroll to
 * it and focus it, once it is drawn */
export function useTarget(id: () => string | null): void {
  $effect(() => {
    const target = id();
    void router.visits;
    if (target === null) return;
    void tick().then(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ block: "center" });
      element?.focus({ preventScroll: true });
    });
  });
}

/** Whether the card shown is drawn out with the highlight's second name (.again): it changes each time a route is
 * shown, so that the same card opened again while it already is the one shown starts its highlight over */
export function replayed(): boolean {
  return router.visits % 2 === 1;
}
