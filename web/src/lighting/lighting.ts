// Changes to the lighting as the page makes them (a patch: only what changed), what the page shows while they are on
// their way, and whether the keyboard shows what was saved.
import type { Backlight, Lighting, LightingIn, RgbLight, VialRgb } from "../api/types";

type VialRgbPatch = { mode?: number; speed?: number; hsv?: [number, number, number] };
type RgbLightPatch = { effect?: number; hue?: number; saturation?: number; brightness?: number };
type BacklightPatch = { brightness?: number; effect?: number };

export interface LightingPatch {
  vialrgb?: VialRgbPatch;
  rgblight?: RgbLightPatch;
  backlight?: BacklightPatch;
}

/** The kinds of lighting the keyboard has, as the page names them */
export function lightingKinds(lighting: Lighting): string[] {
  return [
    lighting.vialrgb ? "RGB matrix" : null,
    lighting.rgblight ? "RGB light" : null,
    lighting.backlight ? "backlight" : null,
  ].filter((k): k is string => k !== null);
}

/** Whether the keyboard has any lighting the page can change */
export function hasLighting(lighting: Lighting): boolean {
  return lightingKinds(lighting).length > 0;
}

/** `older` with `newer`'s changes put over it */
export function mergePatch(older: LightingPatch, newer: LightingPatch): LightingPatch {
  const out: LightingPatch = {};
  for (const kind of ["vialrgb", "rgblight", "backlight"] as const) {
    if (older[kind] || newer[kind]) Object.assign(out, { [kind]: { ...older[kind], ...newer[kind] } });
  }
  return out;
}

/** The lighting with a patch put over it: what the page shows while the patch is on its way */
export function withPatch(lighting: Lighting, patch: LightingPatch): Lighting {
  const out: Lighting = { ...lighting };
  if (lighting.vialrgb && patch.vialrgb) out.vialrgb = { ...lighting.vialrgb, ...patch.vialrgb } as VialRgb;
  if (lighting.rgblight && patch.rgblight) out.rgblight = { ...lighting.rgblight, ...patch.rgblight } as RgbLight;
  if (lighting.backlight && patch.backlight) out.backlight = { ...lighting.backlight, ...patch.backlight } as Backlight;
  return out;
}

/** The request for a patch: only the kinds the keyboard has */
export function patchRequest(patch: LightingPatch, lighting: Lighting): LightingIn {
  const out: LightingIn = {};
  if (lighting.vialrgb && patch.vialrgb) out.vialrgb = patch.vialrgb;
  if (lighting.rgblight && patch.rgblight) out.rgblight = patch.rgblight;
  if (lighting.backlight && patch.backlight) out.backlight = patch.backlight;
  return out;
}

/** What the keyboard shows that a patch can set: the same in both means the same lighting */
function settable(lighting: Lighting): LightingPatch {
  const { vialrgb: v, rgblight: r, backlight: b } = lighting;
  return {
    vialrgb: v ? { mode: v.mode, speed: v.speed, hsv: [v.hsv[0], v.hsv[1], v.hsv[2]] } : undefined,
    rgblight: r ? { effect: r.effect, hue: r.hue, saturation: r.saturation, brightness: r.brightness } : undefined,
    backlight: b ? { brightness: b.brightness, effect: b.effect } : undefined,
  };
}

export function sameLighting(a: Lighting, b: Lighting): boolean {
  return JSON.stringify(settable(a)) === JSON.stringify(settable(b));
}

/** The patch that brings `lighting` back: every value it can set */
export function restorePatch(lighting: Lighting): LightingPatch {
  const all = settable(lighting);
  const out: LightingPatch = {};
  if (all.vialrgb) out.vialrgb = all.vialrgb;
  if (all.rgblight) out.rgblight = all.rgblight;
  if (all.backlight) out.backlight = all.backlight;
  return out;
}
