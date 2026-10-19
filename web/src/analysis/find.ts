// Finding a character or key: everywhere the keymap produces it. "@" is Shift + 2 on a US keyboard, its own key
// (KC_AT), or a combo's output; "ą" is AltGr + A with the Polish keyboard language. The legends come from the server
// in the chosen keyboard language, so what a key types follows it.
import type { Described, KeyboardModel, KeycodeCategory } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { actionAt, refId, type KeyRef } from "../keyboard/refs";
import { tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
import { codesNamed, searchText } from "../picker/search";
import type { ComboInfo } from "./combos";
import type { Usage } from "./usage";

/** How a keycode produces what was searched for: tapped, with Shift, with AltGr, or by its name ("Esc", "MO(2)") */
export type How = "tap" | "shift" | "altgr" | "name";

interface Match {
  how: How;
  action: Described;
}

/** A key on a layer */
export interface Place {
  layer: number;
  ref: KeyRef;
}

/** The keys that run a result that isn't on a key: all of them (`keys`, highlighted), and the first (`key`, the one
 * the result opens), or null when no key does */
interface RunBy {
  key: Place | null;
  keys: Place[];
}

export type Found =
  | ({ type: "key" } & Place & Match)
  | ({ type: "tap-dance"; tapDance: number; slot: SlotLabel } & RunBy & Match)
  | ({ type: "combo"; combo: ComboInfo } & RunBy & Match)
  | ({ type: "key-override"; keyOverride: number; trigger: Described } & RunBy & Match)
  | ({ type: "macro"; macro: number; how: How | "text"; text: string | null; action: Described | null } & RunBy);

/** What the search compares a keycode with, folded once per search */
interface Query {
  /** folded: case and spaces don't count */
  text: string;
  /** as typed, less the spaces around it: macro text is matched with case */
  raw: string;
  /** keycodes the text names (by name or alias, from the keycode catalogue); none for a single character */
  named: Set<string>;
}

/** A single character is what a key types, never a keycode's name: with German (QWERTZ), "y" is the key KC_Z, whose
 * legend is Y, and not KC_Y, which types Z. "KC_Y" still names KC_Y. */
export function queryOf(text: string, catalogue: KeycodeCategory[]): Query {
  const folded = searchText(text);
  const named = [...folded].length > 1 ? codesNamed(catalogue, text) : new Set<string>();
  return { text: folded, raw: text.normalize("NFC").trim(), named };
}

/** How a keycode produces the query, or null: its legend (what it types, with Shift, with AltGr in the chosen
 * keyboard language), or its name, or the name of the keycode a layer-tap or mod-tap key taps ("KC_ESC" finds
 * LT1(KC_ESCAPE)). Empty and transparent keys produce nothing. */
export function matchOf(d: Described, query: Query): How | null {
  if (!query.text || d.kind === "none" || d.kind === "transparent") return null;
  const same = (text: string | null | undefined) => !!text && searchText(text) === query.text;
  if (same(d.legend.main) || same(d.tap)) return "tap";
  if (same(d.legend.shifted)) return "shift";
  if (same(d.legend.altGr)) return "altgr";
  if (query.named.has(d.code) || searchText(d.code) === query.text) return "name";
  // a hold-only key (LT1(KC_NO)) taps nothing
  if (d.tapCode && d.tapCode !== "KC_NO" && query.named.has(d.tapCode)) return "name";
  return null;
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverrides" | "macros">;

/** These keys, the first of them the one a result opens */
function runBy(keys: Place[]): RunBy {
  return { key: keys[0] ?? null, keys };
}

/** The keys (on the keyboard as drawn) that run a tap dance or macro, from its usage */
function keysOf(uses: Usage["tapDances"][number] | undefined): RunBy {
  return runBy((uses ?? []).flatMap((u) => (u.type === "key" ? [{ layer: u.layer, ref: u.ref }] : [])));
}

/** The base-layer keys with a keycode */
function baseKeys(codes: Map<string, KeyRef[]> | undefined, code: string): RunBy {
  return runBy((codes?.get(code) ?? []).map((ref) => ({ layer: 0, ref })));
}

/** Everywhere the keymap produces what the query is: keys on every layer (the keyboard as drawn), tap dance slots,
 * combo outputs, key override replacements, and macros (their text, and the keys they tap). Results that aren't on a
 * key say which keys run them (`keys`, and the first of them, `key`), so they can be shown:
 * - a tap dance or macro: every key that runs it, on every layer;
 * - a combo: its members' base-layer keys;
 * - a key override: the base-layer keys with its trigger. */
export function findOnKeymap(
  model: Model,
  placement: Placement,
  query: Query,
  combos: ComboInfo[],
  usage: Usage,
  baseCodes: Map<string, KeyRef[]> | undefined,
): Found[] {
  if (!query.text) return [];
  const found: Found[] = [];
  model.layers.forEach((_, layer) => {
    for (const item of placement.items) {
      const ref = { kind: item.kind, index: item.index };
      const action = actionAt(model, layer, ref);
      const how = action ? matchOf(action, query) : null;
      if (action && how) found.push({ type: "key", layer, ref, how, action });
    }
  });
  for (const td of model.tapDance) {
    for (const { label, action } of tapDanceSlots(td)) {
      const how = matchOf(action, query);
      if (how) {
        found.push({
          type: "tap-dance", tapDance: td.index, slot: label, how, action, ...keysOf(usage.tapDances[td.index]),
        });
      }
    }
  }
  for (const combo of combos) {
    const how = matchOf(combo.output, query);
    const keys = combo.members.flatMap((m) => m.keys.map((ref) => ({ layer: 0, ref })));
    if (how) found.push({ type: "combo", combo, how, action: combo.output, ...runBy(keys) });
  }
  for (const o of model.keyOverrides) {
    const how = o.enabled ? matchOf(o.replacement, query) : null;
    if (how) {
      found.push({
        type: "key-override", keyOverride: o.index, trigger: o.trigger, how, action: o.replacement,
        ...baseKeys(baseCodes, o.trigger.code),
      });
    }
  }
  for (const macro of model.macros.items) {
    const keys = keysOf(usage.macros[macro.index]);
    const text = macro.actions.find((a) => a.type === "text" && a.text?.normalize("NFC").includes(query.raw));
    if (text) {
      found.push({ type: "macro", macro: macro.index, how: "text", text: text.text ?? null, action: null, ...keys });
      continue;
    }
    for (const step of macro.actions) {
      const hit = step.type === "tap" || step.type === "down" ? step.keys.find((k) => matchOf(k, query)) : undefined;
      if (hit) {
        const how = matchOf(hit, query) ?? "tap";
        found.push({ type: "macro", macro: macro.index, how, text: null, action: hit, ...keys });
        break;
      }
    }
  }
  return found;
}

/** The keys to highlight on each layer: those that produce it, and every key that runs a tap dance, combo, key
 * override or macro that does. A place on a layer beyond `layers` is left out. */
export function foundKeys(found: Found[], layers: number): Set<string>[] {
  const keys = Array.from({ length: layers }, () => new Set<string>());
  for (const f of found) {
    for (const place of f.type === "key" ? [f] : f.keys) keys[place.layer]?.add(refId(place.ref));
  }
  return keys;
}
