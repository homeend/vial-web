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

export interface Match {
  how: How;
  action: Described;
}

/** A key on a layer */
export interface Place {
  layer: number;
  ref: KeyRef;
}

export type Found =
  | ({ type: "key" } & Place & Match)
  | ({ type: "tap-dance"; tapDance: number; slot: SlotLabel; key: Place | null } & Match)
  | ({ type: "combo"; combo: ComboInfo; key: Place | null } & Match)
  | ({ type: "key-override"; keyOverride: number; trigger: Described; key: Place | null } & Match)
  | { type: "macro"; macro: number; how: How | "text"; text: string | null; action: Described | null; key: Place | null };

/** What the search compares a keycode with, folded once per search */
export interface Query {
  /** folded: case and spaces don't count */
  text: string;
  /** as typed, less the spaces around it: macro text is matched with case */
  raw: string;
  /** keycodes the text names (by name or alias, from the keycode catalogue) */
  named: Set<string>;
}

export function queryOf(text: string, catalogue: KeycodeCategory[]): Query {
  return { text: searchText(text), raw: text.normalize("NFC").trim(), named: codesNamed(catalogue, text) };
}

/** How a keycode produces the query, or null: its legend (what it types, with Shift, with AltGr in the chosen
 * keyboard language), or its name. Empty and transparent keys produce nothing. */
export function matchOf(d: Described, query: Query): How | null {
  if (!query.text || d.kind === "none" || d.kind === "transparent") return null;
  const same = (text: string | null | undefined) => !!text && searchText(text) === query.text;
  if (same(d.legend.main) || same(d.tap)) return "tap";
  if (same(d.legend.shifted)) return "shift";
  if (same(d.legend.altGr)) return "altgr";
  if (query.named.has(d.code) || searchText(d.code) === query.text) return "name";
  return null;
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos" | "keyOverrides" | "macros">;

/** The first key (on the keyboard as drawn) that runs a tap dance or macro, from its usage */
function firstKey(uses: Usage["tapDances"][number] | undefined): Place | null {
  const use = uses?.find((u) => u.type === "key");
  return use?.type === "key" ? { layer: use.layer, ref: use.ref } : null;
}

/** The first base-layer key with a keycode */
function baseKey(codes: Map<string, KeyRef[]> | undefined, code: string): Place | null {
  const ref = codes?.get(code)?.[0];
  return ref ? { layer: 0, ref } : null;
}

/** Everywhere the keymap produces what the query is: keys on every layer (the keyboard as drawn), tap dance slots,
 * combo outputs, key override replacements, and macros (their text, and the keys they tap). Results that aren't on a
 * key say which key runs them, when one does (`key`), so they can be shown. */
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
        found.push({ type: "tap-dance", tapDance: td.index, slot: label, how, action, key: firstKey(usage.tapDances[td.index]) });
      }
    }
  }
  for (const combo of combos) {
    const how = matchOf(combo.output, query);
    const member = combo.members.find((m) => m.keys.length > 0);
    const key = member ? { layer: 0, ref: member.keys[0] } : null;
    if (how) found.push({ type: "combo", combo, how, action: combo.output, key });
  }
  for (const o of model.keyOverrides) {
    const how = o.enabled ? matchOf(o.replacement, query) : null;
    if (how) {
      found.push({
        type: "key-override", keyOverride: o.index, trigger: o.trigger, how, action: o.replacement,
        key: baseKey(baseCodes, o.trigger.code),
      });
    }
  }
  for (const macro of model.macros.items) {
    const key = firstKey(usage.macros[macro.index]);
    const text = macro.actions.find((a) => a.type === "text" && a.text?.normalize("NFC").includes(query.raw));
    if (text) {
      found.push({ type: "macro", macro: macro.index, how: "text", text: text.text ?? null, action: null, key });
      continue;
    }
    for (const step of macro.actions) {
      const hit = step.type === "tap" || step.type === "down" ? step.keys.find((k) => matchOf(k, query)) : undefined;
      if (hit) {
        found.push({ type: "macro", macro: macro.index, how: matchOf(hit, query) ?? "tap", text: null, action: hit, key });
        break;
      }
    }
  }
  return found;
}

/** The keys to highlight on each layer: those that produce it, and those that run a tap dance, combo, key override
 * or macro that does */
export function foundKeys(found: Found[], layers: number): Set<string>[] {
  const keys = Array.from({ length: layers }, () => new Set<string>());
  for (const f of found) {
    const place = f.type === "key" ? f : f.key;
    if (place) keys[place.layer]?.add(refId(place.ref));
  }
  return keys;
}
