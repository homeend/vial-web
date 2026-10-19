// Changes to the lighting as the page makes them (a patch: only what changed), what the page shows while they are on
// their way, and whether the keyboard shows what was saved.
import type { Backlight, Lighting, LightingIn, RgbLight, VialRgb } from "../api/types";
import { RGBLIGHT_STATIC, rgbLightIgnores, VIALRGB_OFF, VIALRGB_SOLID, vialRgbIgnores } from "./effects";

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

/** The patch that brings `lighting` back: every value it can set. The server sets the effect before the colour, so
 * a colour value the effect brought back ignores (see `rgbLightIgnores`, `vialRgbIgnores`) stays as the keyboard shows
 * it: `restorePatches` puts those back too. */
export function restorePatch(lighting: Lighting): LightingPatch {
  const all = settable(lighting);
  const out: LightingPatch = {};
  if (all.vialrgb) out.vialrgb = all.vialrgb;
  if (all.rgblight) out.rgblight = all.rgblight;
  if (all.backlight) out.backlight = all.backlight;
  return out;
}

/**
 * The patches that bring `kept` back from `shown` (what the keyboard shows now), to be sent one after the other, each
 * once the one before is done (not merged: `LatestWriter.push` would merge them into one).
 *
 * Usually one: `restorePatch(kept)`. When the effect brought back ignores a colour value that differs from the one
 * shown (VialRGB "Disable": the whole colour; RGB light "All Off": the whole colour, Breathing: the brightness, Rainbow
 * Mood and Swirl: the hue), a first patch puts the colour back under an effect that takes all of it (VialRGB Solid
 * Color, or another effect the keyboard has; RGB light Solid Color), then `restorePatch(kept)` brings the effect back.
 * A keyboard whose only VialRGB effect is "Disable" can't take a colour at all: its colour is left as it is.
 */
export function restorePatches(shown: Lighting, kept: Lighting): LightingPatch[] {
  const first: LightingPatch = {};
  const [v, sv] = [kept.vialrgb, shown.vialrgb];
  if (v && sv && vialRgbIgnores(v.mode).length > 0 && !sameColour(sv.hsv, v.hsv)) {
    const supported = v.supportedEffects;
    const mode = [VIALRGB_SOLID, ...supported].find((m) => m !== VIALRGB_OFF && supported.includes(m));
    if (mode !== undefined) first.vialrgb = { mode, hsv: [v.hsv[0], v.hsv[1], v.hsv[2]] };
  }
  const [r, sr] = [kept.rgblight, shown.rgblight];
  if (r && sr) {
    const differs = {
      hue: sr.hue !== r.hue, saturation: sr.saturation !== r.saturation, brightness: sr.brightness !== r.brightness,
    };
    if (rgbLightIgnores(r.effect).some((part) => differs[part])) {
      first.rgblight = { effect: RGBLIGHT_STATIC, hue: r.hue, saturation: r.saturation, brightness: r.brightness };
    }
  }
  return first.vialrgb || first.rgblight ? [first, restorePatch(kept)] : [restorePatch(kept)];
}

function sameColour(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
