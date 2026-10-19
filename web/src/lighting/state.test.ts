import { describe, expect, it } from "vitest";
import { LightingBaseline } from "./state.svelte";

const A = { backlight: { brightness: 0, effect: 0 } };
const B = { backlight: { brightness: 255, effect: 1 } };

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
});
