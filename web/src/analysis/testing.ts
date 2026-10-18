// For the analysis tests only: keyboard models built from keycode names, described roughly as the server does.
import type { Described, KeyGeometry, KeyboardModel, LayerAction, TapDance } from "../api/types";

const LAYER_ACTIONS: Record<string, LayerAction> = {
  MO: "while held", TG: "toggle", TO: "switch to", TT: "hold, or tap to toggle", OSL: "one-shot", DF: "default",
  PDF: "default (saved)",
};
const LABELS: Record<string, string> = { SPC: "Space", ESC: "Esc", ENT: "Enter", TAB: "Tab", CAPS: "Caps Lock" };
const MODS: Record<string, string> = { LSFT: "Shift", LCTL: "Ctrl", LALT: "Alt", LGUI: "Gui" };

function label(code: string): string {
  const name = code.replace(/^KC_/, "");
  return LABELS[name] ?? name;
}

/** A keycode described as the server would, for the kinds the analysis looks at */
export function described(code: string): Described {
  const base = {
    code, hold: null, layer: null, layerAction: null, index: null, description: null, tapCode: null, triLayer: null,
  };
  const plain = (kind: Described["kind"], tap: string, extra: Partial<Described> = {}): Described =>
    ({ ...base, kind, tap, legend: { main: tap }, ...extra });
  if (code === "KC_NO") return plain("none", "");
  if (code === "KC_TRNS") return { ...plain("transparent", ""), legend: { main: "▽" } };
  let m = /^TD\((\d+)\)$/.exec(code);
  if (m) return plain("tap-dance", `TD ${m[1]}`, { index: Number(m[1]) });
  m = /^M(\d+)$/.exec(code);
  if (m) return plain("macro", `M ${m[1]}`, { index: Number(m[1]) });
  m = /^(MO|TG|TO|TT|OSL|DF|PDF)\((\d+)\)$/.exec(code);
  if (m) return plain("layer", `${m[1]} ${m[2]}`, { layer: Number(m[2]), layerAction: LAYER_ACTIONS[m[1]] });
  m = /^LM\((\d+), ?(\w+)\)$/.exec(code);
  if (m) {
    // LM(n, 0) holds no modifiers: the server describes it as it does MO(n)
    const mods = m[2] === "0" ? null : (MODS[m[2].replace("MOD_", "")] ?? m[2]);
    return plain("layer", `LM ${m[1]}`, { layer: Number(m[1]),
      layerAction: mods ? "while held, with modifiers" : "while held", hold: mods });
  }
  m = /^FN_MO([12])3$/.exec(code);
  if (m) return plain("layer", `Fn${m[1]} (Fn3)`, { layer: Number(m[1]), layerAction: "while held", triLayer: 3 });
  m = /^LT(\d+)\((.+)\)$/.exec(code);
  if (m) {
    return plain("layer-tap", m[2] === "KC_NO" ? "" : label(m[2]),
      { layer: Number(m[1]), layerAction: "while held", hold: `layer ${m[1]}` });
  }
  m = /^(\w+)_T\((.+)\)$/.exec(code);
  if (m) return plain("mod-tap", label(m[2]), { hold: MODS[m[1]] ?? m[1] });
  return plain("basic", label(code));
}

/** Keys of a Corne as the simulator draws it: three rows of 6 + 6 keys (index = row * 12 + column, columns 0-5 the
 * left half, 6-11 the right), then the thumbs, left 36-38 and right 39-41, each from left to right */
export function corneKeys(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  const key = (row: number, col: number, x: number, y: number): KeyGeometry =>
    ({ row, col, x, y, w: 1, h: 1, x2: 0, y2: 0, w2: 1, h2: 1, r: 0, rx: 0, ry: 0, layoutIndex: -1, layoutOption: -1,
      decal: false });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) keys.push(key(r, c, c, r));
    for (let c = 0; c < 6; c++) keys.push(key(r + 4, 5 - c, 9 + c, r));
  }
  [3, 4, 5].forEach((x, i) => keys.push(key(3, 3 + i, x, 3)));
  [9, 10, 11].forEach((x, i) => keys.push(key(7, 5 - i, x, 3)));
  return keys;
}

export const KEY_COUNT = 42;
/** where the Corne's keys are, by index */
export const AT = {
  grid: (row: number, col: number) => row * 12 + col,
  leftOuterThumb: 36,
  leftMiddleThumb: 37,
  leftInnerThumb: 38,
  rightInnerThumb: 39,
  rightMiddleThumb: 40,
  rightOuterThumb: 41,
};

/** A layer of 42 keycodes: `fill` everywhere but the keys given */
export function layer(keys: Record<number, string>, fill = "KC_TRNS"): string[] {
  return Array.from({ length: KEY_COUNT }, (_, i) => keys[i] ?? fill);
}

export interface Setup {
  /** each layer's 42 keycodes */
  layers: string[][];
  /** tap, hold, double tap, tap then hold */
  tapDances?: [string, string, string, string][];
  combos?: { keys: string[]; output: string }[];
  /** steps of each macro (only their number matters) */
  macros?: number[];
  keyOverrides?: { trigger: string; replacement: string }[];
  altRepeatKeys?: { keycode: string; altKeycode: string }[];
}

/** A Corne keyboard model; layer 0 is called Base, the others "Layer N" */
export function corne(setup: Setup): KeyboardModel {
  const tapDance: TapDance[] = (setup.tapDances ?? []).map(([tap, hold, doubleTap, tapHold], index) => ({
    index, name: "", customName: false, tappingTerm: 200,
    tap: described(tap), hold: described(hold), doubleTap: described(doubleTap), tapHold: described(tapHold),
  }));
  return {
    name: "Test Corne", uid: "0", viaProtocol: 9, vialProtocol: 6, rows: 8, cols: 6,
    keys: corneKeys(), encoders: [], layoutOptions: null,
    layers: setup.layers.map((codes, index) => ({
      index, name: index === 0 ? "Base" : `Layer ${index}`, customName: false, keys: codes.map(described),
      encoders: [],
    })),
    tapDance,
    combos: (setup.combos ?? []).map((c, index) => ({
      index,
      keys: [...c.keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4).map(described),
      output: described(c.output),
    })),
    keyOverrides: (setup.keyOverrides ?? []).map((o, index) => ({
      index, trigger: described(o.trigger), replacement: described(o.replacement), layers: 0xffff, triggerMods: 0,
      negativeModMask: 0, suppressedMods: 0, options: 0, enabled: true,
    })),
    altRepeatKeys: (setup.altRepeatKeys ?? []).map((a, index) => ({
      index, keycode: described(a.keycode), altKeycode: described(a.altKeycode), allowedMods: 0, options: 0,
      enabled: true,
    })),
    macros: {
      count: (setup.macros ?? []).length, memory: 900, used: 0,
      items: (setup.macros ?? []).map((steps, index) => ({
        index, name: "", customName: false,
        actions: Array.from({ length: steps }, () => ({ type: "tap" as const, keys: [described("KC_A")] })),
      })),
    },
    settings: [], lighting: {}, features: [], unlocked: true,
  };
}

/** A simplified Corne shaped like the simulator's (simulator/corne.py), NOT a copy of it: the base layer is close, but
 * layers 1 and 3 hold only a few keys (layer 1 is mostly transparent) and the right-hand mod-taps use the left-hand
 * mods. Don't take its expected values as the real simulator's. */
export function simulatedCorne(): KeyboardModel {
  const grid = (rows: string[][]) => rows.flatMap((r) => r);
  const base = [
    ...grid([
      ["KC_TAB", "LGUI_T(KC_W)", "KC_L", "KC_R", "LT2(KC_B)", "KC_Z", "KC_Q", "KC_U", "KC_D", "KC_J", "KC_BSLS", "KC_BSPC"],
      ["KC_LCTL", "LT2(KC_S)", "LALT_T(KC_H)", "LCTL_T(KC_N)", "LSFT_T(KC_T)", "KC_COMM", "KC_DOT", "LGUI_T(KC_A)",
        "LALT_T(KC_E)", "LCTL_T(KC_O)", "LSFT_T(KC_I)", "KC_QUOT"],
      ["KC_LSFT", "KC_F", "KC_M", "KC_C", "KC_V", "KC_SLSH", "KC_G", "KC_P", "KC_X", "KC_K", "KC_Y", "KC_RSFT"],
    ]),
    "KC_ESC", "LT1(KC_SPC)", "TD(0)", "M0", "KC_ENT", "OSL(3)",
  ];
  return corne({
    layers: [
      base,
      layer({ [AT.grid(0, 1)]: "KC_1" }),
      layer({ [AT.grid(1, 7)]: "KC_LEFT" }),
      layer({ [AT.grid(1, 1)]: "KC_1", [AT.rightOuterThumb]: "TO(0)" }),
    ],
    tapDances: [["KC_TAB", "KC_NO", "KC_CAPS", "KC_NO"], ["KC_ESC", "KC_LCTL", "LCTL(KC_S)", "KC_NO"],
      ["KC_NO", "KC_NO", "KC_NO", "KC_NO"]],
    combos: [{ keys: ["KC_K", "KC_Y"], output: "KC_ESC" }, { keys: ["KC_M", "KC_C"], output: "KC_ENT" },
      { keys: [], output: "KC_NO" }],
    macros: [2, 6, 0],
  });
}
