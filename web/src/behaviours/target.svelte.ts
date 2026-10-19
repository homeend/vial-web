// A card opened from elsewhere (the address names it): scrolled to, with the focus on its heading.
import { tick } from "svelte";

/** Each time `id` names another element, scroll to it and focus it, once it is drawn */
export function useTarget(id: () => string | null): void {
  $effect(() => {
    const target = id();
    if (target === null) return;
    void tick().then(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ block: "center" });
      element?.focus({ preventScroll: true });
    });
  });
}
