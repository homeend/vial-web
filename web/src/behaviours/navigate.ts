// Going to where something is used: the key in the Keymap, or the combo, tap dance, macro, key override or alt-repeat
// key on its page. One on the
// page shown (a tap dance another one runs) opens without a step back, which would look like it did nothing.
import type { Use } from "../analysis/usage";
import type { SectionId } from "../lib/route";
import { router } from "../lib/router.svelte";

function open(section: SectionId, item: number): void {
  router.go(section, item, { replace: router.route.section === section });
}

export function openUse(use: Use): void {
  switch (use.type) {
    case "key":
      router.openKey({ layer: use.layer, ref: use.ref });
      break;
    case "combo":
      open("combos", use.combo);
      break;
    case "tap-dance":
      open("tap-dance", use.tapDance);
      break;
    case "macro":
      open("macros", use.macro);
      break;
    case "key-override":
      open("key-overrides", use.keyOverride);
      break;
    case "alt-repeat":
      open("alt-repeat", use.altRepeat);
      break;
  }
}
