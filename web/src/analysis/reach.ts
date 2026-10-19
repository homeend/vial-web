// How each layer is reached: by which keys, tap dances and combos, from which layers, and whether the keyboard can get
// there at all from the base layer.
//
// Only what the keymap says is known: layer switching done in the firmware's own C code (tri-layer,
// layer_state_set_user) isn't visible over the Vial protocol.
import type { Described, KeyboardModel, LayerAction } from "../api/types";
import type { Placement } from "../keyboard/geometry";
import { refId, type KeyRef } from "../keyboard/refs";
import { isHeldSlot, slotCanBeHeld, tapDanceSlots, type SlotLabel } from "../keymap/tapdance";
import { codesOn, comboLayers, combosOf, type ComboInfo } from "./combos";
import { effectiveAt } from "./effective";

/** A tap dance slot that a way goes through */
export interface ViaSlot {
  tapDance: number;
  slot: SlotLabel;
}

type Via =
  /** layer 0: where the keyboard starts */
  | { type: "default" }
  /** a key (or encoder direction) set on a layer: a layer key, a layer-tap, or a tap dance with a layer in a slot */
  | { type: "key"; ref: KeyRef; layer: number; action: Described; slot: ViaSlot | null }
  /** a combo whose output is a layer key, or a tap dance with a layer in a slot */
  | { type: "combo"; combo: ComboInfo; slot: ViaSlot | null }
  /** Vial's tri-layer keys FN_MO13 and FN_MO23 held together: each key, and the layer it is set on */
  | { type: "tri-layer"; keys: { ref: KeyRef; layer: number }[] };

export interface Way {
  via: Via;
  /** what it does with the layer */
  action: LayerAction;
  /** the layers it works on (never the layer it reaches); empty for a combo whose keycodes aren't on any key */
  from: number[];
}

export interface LayerReach {
  layer: number;
  ways: Way[];
  /** whether the keyboard can get to it from the base layer, through the ways */
  reachable: boolean;
}

/** Whether a layer number is one of the keyboard's layers (a keycode can name a layer the keyboard doesn't have) */
function isLayer(model: Pick<KeyboardModel, "layers">, layer: number | null | undefined): layer is number {
  return layer != null && Number.isInteger(layer) && layer >= 0 && layer < model.layers.length;
}

interface Target {
  layer: number;
  action: LayerAction;
  slot: ViaSlot | null;
}

/** The layers a keycode reaches: a layer key or layer-tap's own layer, or each layer in a tap dance's slots. Layers the
 * keyboard doesn't have are left out. A slot the firmware never keeps held (see slotCanBeHeld: Double tap, and Tap
 * once Hold is set) is only ever tapped, as a key on an encoder is (see tappedAction). */
export function layerTargets(model: Pick<KeyboardModel, "layers" | "tapDance">, d: Described): Target[] {
  if ((d.kind === "layer" || d.kind === "layer-tap") && isLayer(model, d.layer) && d.layerAction) {
    return [{ layer: d.layer, action: d.layerAction, slot: null }];
  }
  if (d.kind !== "tap-dance" || d.index == null) return [];
  const td = model.tapDance[d.index];
  if (!td) return [];
  return tapDanceSlots(td).flatMap(({ label, action }) => {
    if ((action.kind !== "layer" && action.kind !== "layer-tap") || !isLayer(model, action.layer) || !action.layerAction) {
      return [];
    }
    const pressed = slotCanBeHeld(td, label) ? action.layerAction : tappedAction(action.layerAction);
    return pressed ? [{ layer: action.layer, action: pressed, slot: { tapDance: td.index, slot: label } }] : [];
  });
}

/** How many quick taps of a TT key toggle its layer: the firmware's TAPPING_TOGGLE, 5 unless the keyboard's firmware
 * sets another (which the Vial protocol doesn't tell) */
export const TAPPING_TOGGLE = 5;

/** What a target does when its key can only be tapped, as an encoder direction is (turning the knob taps it): it is
 * never held, so a layer held while the key is down (MO, LT, LM, a tap dance's held slots) is never on, and TT only
 * toggles (after TAPPING_TOGGLE quick turns; wayLabel says so). One-shot layers work as on a key.
 * null: never reached that way. */
function tapped(target: Target): Target | null {
  if (target.slot && isHeldSlot(target.slot.slot)) return null;
  const action = tappedAction(target.action);
  return action ? { ...target, action } : null;
}

/** What a layer key does when it is only tapped, never held: a layer held while the key is down is never on (null),
 * and TT only toggles */
function tappedAction(action: LayerAction): LayerAction | null {
  if (action === "while held" || action === "while held, with modifiers") return null;
  return action === "hold, or tap to toggle" ? "toggle" : action;
}

type Model = Pick<KeyboardModel, "layers" | "tapDance" | "combos">;

/** A tri-layer key (FN_MO13, FN_MO23) on the keymap */
interface FnKey {
  ref: KeyRef;
  layer: number;
  /** its own layer (1 or 2) and the one both together turn on (3) */
  own: number;
  tri: number;
  worksOn: number[];
}

/** Holding two tri-layer keys of different layers: one pressed first from a layer it works on, which turns its own
 * layer on, where the other one must work (set there, or fallen through to). The second key is looked up on the first
 * key's layer, which extends the base-layer fall-through assumption of effectiveAt. The two must be different physical
 * keys. */
function triLayerWays(keys: FnKey[]): { target: number; way: Way }[] {
  const ways: { target: number; way: Way }[] = [];
  for (const a of keys) {
    for (const b of keys) {
      // one physical key can't be both: the key held keeps the layer it came from
      if (a.own >= b.own || a.tri !== b.tri || refId(a.ref) === refId(b.ref)) continue;
      const from = new Set([
        ...(b.worksOn.includes(a.own) ? a.worksOn : []),
        ...(a.worksOn.includes(b.own) ? b.worksOn : []),
      ]);
      from.delete(a.tri);
      if (from.size === 0) continue;
      ways.push({
        target: a.tri,
        way: {
          via: { type: "tri-layer", keys: [{ ref: a.ref, layer: a.layer }, { ref: b.ref, layer: b.layer }] },
          action: "while held",
          from: [...from].sort((x, y) => x - y),
        },
      });
    }
  }
  return ways;
}

/** For every layer, every way it is reached and from which layers, and whether it can be reached at all.
 *
 * - Keys: a key set on layer S works on S, and on the layers where that key is transparent when S is the base layer
 *   (see effectiveAt). A key on the layer it reaches doesn't reach it (it can only leave it), so isn't listed.
 * - Combos: a combo works on the layers where each of its keycodes is on some key (QMK matches combos by keycode on
 *   the active layers), transparent keys falling through to the base layer.
 * - Tri-layer keys: FN_MO13 and FN_MO23 held together turn on layer 3 (see triLayerWays).
 * - LM (a layer with modifiers) counts as a key held for its layer.
 * - Encoder directions are only ever tapped: they never hold a layer (see tapped).
 * - A tap dance's Double tap slot, and its Tap slot once Hold is set, are only ever tapped too (see layerTargets).
 * - Layer 0 is where the keyboard starts. A layer is reachable when a way to it works on a reachable layer; DF (a new
 *   default layer) counts like any other way.
 */
export function layerReach(model: Model, placement: Placement): LayerReach[] {
  const count = model.layers.length;
  const ways: Way[][] = Array.from({ length: count }, (_, layer) => (layer === 0
    ? [{ via: { type: "default" }, action: "default", from: [] }]
    : []));

  const refs = placement.items.map((i) => ({ kind: i.kind, index: i.index }));
  const fnKeys: FnKey[] = [];
  for (let layer = 0; layer < count; layer++) {
    for (const ref of refs) {
      const action = effectiveAt(model, layer, ref);
      // each key once, from the layer it is set on
      if (!action || action.layer !== layer) continue;
      const worksOn = Array.from({ length: count }, (_, l) => l).filter((l) => effectiveAt(model, l, ref)?.layer === layer);
      const d = action.action;
      // a tri-layer key on an encoder is never held, so it never makes up the pair
      if (ref.kind !== "encoder" && d.kind === "layer" && isLayer(model, d.layer) && isLayer(model, d.triLayer)) {
        fnKeys.push({ ref, layer, own: d.layer, tri: d.triLayer, worksOn });
      }
      for (const found of layerTargets(model, action.action)) {
        const target = ref.kind === "encoder" ? tapped(found) : found;
        if (!target) continue;
        const from = worksOn.filter((l) => l !== target.layer);
        if (from.length === 0) continue;
        ways[target.layer].push({
          via: { type: "key", ref, layer, action: action.action, slot: target.slot },
          action: target.action,
          from,
        });
      }
    }
  }

  for (const { target, way } of triLayerWays(fnKeys)) ways[target].push(way);

  const layerCodes = Array.from({ length: count }, (_, layer) => codesOn(model, placement, layer));
  for (const combo of combosOf(model, placement)) {
    const usable = comboLayers(combo, layerCodes);
    for (const target of layerTargets(model, combo.output)) {
      const from = usable.filter((l) => l !== target.layer);
      // one that only works on the layer it reaches only leaves it; one that works nowhere is still shown
      if (usable.length > 0 && from.length === 0) continue;
      ways[target.layer].push({ via: { type: "combo", combo, slot: target.slot }, action: target.action, from });
    }
  }

  const reachable = new Set(count > 0 ? [0] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (let layer = 0; layer < count; layer++) {
      if (!reachable.has(layer) && ways[layer].some((w) => w.from.some((l) => reachable.has(l)))) {
        reachable.add(layer);
        grew = true;
      }
    }
  }
  return ways.map((w, layer) => ({ layer, ways: w, reachable: reachable.has(layer) }));
}
