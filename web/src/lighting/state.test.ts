import { describe, expect, it } from "vitest";
import type { Lighting } from "../api/types";
import { LightingBaseline } from "./state.svelte";

const A = { backlight: { brightness: 0, effect: 0 } };
const B = { backlight: { brightness: 255, effect: 1 } };

const LIGHT = { effect: 1, hue: 0, saturation: 255, brightness: 128, speed: 0 };
/** an RGB light and a backlight, the backlight's brightness and breathing as given */
function lit(brightness: number, effect: number, hue = 0): Lighting {
  return { rgblight: { ...LIGHT, hue }, backlight: { brightness, effect } };
}

describe("LightingBaseline", () => {
  it("keeps what a keyboard showed first, until it is saved, and starts over for another keyboard", () => {
    const baseline = new LightingBaseline();
    baseline.follow("one", A);
    baseline.follow("one", B);
    expect(baseline.lighting).toBe(A);
    expect(baseline.saved).toBe(false);
    baseline.save(B);
    expect([baseline.lighting, baseline.saved]).toEqual([B, true]);
    baseline.follow("two", A);
    expect([baseline.lighting, baseline.saved]).toEqual([A, false]);
  });

  it("tells a change, and a change not kept", () => {
    const baseline = new LightingBaseline();
    expect([baseline.changed(A), baseline.unsaved(A)]).toEqual([false, false]);
    baseline.follow("one", lit(85, 0));
    expect([baseline.changed(lit(85, 0)), baseline.unsaved(lit(85, 0))]).toEqual([false, false]);
    expect([baseline.changed(lit(170, 0)), baseline.unsaved(lit(170, 0))]).toEqual([true, true]);
    expect([baseline.changed(lit(85, 0, 40)), baseline.unsaved(lit(85, 0, 40))]).toEqual([true, true]);
  });

  it("counts a change of backlight breathing as kept: the keyboard keeps the backlight then", () => {
    const baseline = new LightingBaseline();
    baseline.follow("one", lit(85, 0));
    baseline.save(lit(85, 0));
    // the brightness alone isn't kept
    baseline.confirmed(lit(85, 0), lit(170, 0));
    expect(baseline.unsaved(lit(170, 0))).toBe(true);
    // breathing turned on keeps the backlight, with the brightness it runs at
    baseline.confirmed(lit(170, 0), lit(170, 1));
    expect(baseline.unsaved(lit(170, 1))).toBe(false);
    // Undo still has something to put back, and Save nothing to keep
    expect(baseline.changed(lit(170, 1))).toBe(true);
    // what else changes isn't kept
    expect(baseline.unsaved(lit(170, 1, 40))).toBe(true);
    expect(baseline.unsaved(lit(255, 1))).toBe(true);
    // breathing turned off again keeps the backlight once more
    baseline.confirmed(lit(170, 1), lit(85, 0));
    expect([baseline.changed(lit(85, 0)), baseline.unsaved(lit(85, 0))]).toEqual([false, false]);
  });

  it("counts nothing as kept when the breathing didn't change, or the keyboard has no backlight", () => {
    const baseline = new LightingBaseline();
    baseline.follow("one", lit(85, 0));
    // asked to breathe, a firmware without breathing reads 0: nothing kept
    baseline.confirmed(lit(85, 0), lit(170, 0));
    expect(baseline.unsaved(lit(170, 0))).toBe(true);
    const light = { rgblight: LIGHT };
    baseline.follow("two", light);
    baseline.confirmed(light, { rgblight: { ...LIGHT, hue: 9 } });
    expect(baseline.unsaved({ rgblight: { ...LIGHT, hue: 9 } })).toBe(true);
  });

  it("forgets the backlight kept once saved, or for another keyboard", () => {
    const baseline = new LightingBaseline();
    baseline.follow("one", lit(85, 0));
    baseline.confirmed(lit(85, 0), lit(85, 1));
    baseline.save(lit(85, 1, 40));
    expect(baseline.unsaved(lit(85, 0, 40))).toBe(true);
    baseline.confirmed(lit(85, 1, 40), lit(85, 0, 40));
    baseline.follow("two", lit(85, 1));
    expect(baseline.unsaved(lit(85, 0))).toBe(true);
  });
});
