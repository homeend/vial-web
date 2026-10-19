// Going to where something is used: the key in the Keymap, or the combo, tap dance or macro on its page.
import type { Use } from "../analysis/usage";
import { router } from "../lib/router.svelte";

export function openUse(use: Use): void {
  switch (use.type) {
    case "key":
      router.openKey({ layer: use.layer, ref: use.ref });
      break;
    case "combo":
      router.go("combos", use.combo);
      break;
    case "tap-dance":
      router.go("tap-dance", use.tapDance);
      break;
    case "macro":
      router.go("macros", use.macro);
      break;
    default:
      break; // key overrides and alt-repeat keys have no page yet
  }
}
