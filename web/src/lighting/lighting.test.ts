import { describe, expect, it, vi } from "vitest";
import type { Lighting } from "../api/types";
import {
  brightnessTrack, degrees, hexToRgb, hsvToRgb, HUE_TRACK, percent, percentOf, pickedHueSat, rgbToHex, rgbToHsv,
  saturationTrack,
} from "./colour";
import {
  RGBLIGHT_EFFECTS, rgbLightChoices, rgbLightNote, VIALRGB_EFFECTS, vialRgbChoices, vialRgbNote,
} from "./effects";
import {
  hasLighting, lightingKinds, mergePatch, patchRequest, restorePatch, sameLighting, withPatch,
} from "./lighting";
import { LatestWriter, type Clock } from "./writer";

const ALL: Lighting = {
  vialrgb: { mode: 2, speed: 128, hsv: [0, 255, 128], maxBrightness: 200, supportedEffects: [0, 1, 2, 3] },
  rgblight: { effect: 1, speed: 0, hue: 0, saturation: 255, brightness: 128 },
  backlight: { brightness: 170, effect: 0 },
};

describe("effects", () => {
  it("names effects as Qt does, by number", () => {
    expect(VIALRGB_EFFECTS).toHaveLength(45);
    expect(VIALRGB_EFFECTS[44]).toBe("Pixel Fractal");
    expect(RGBLIGHT_EFFECTS).toHaveLength(37);
    expect(RGBLIGHT_EFFECTS[36]).toBe("Alternating");
  });

  it("lists the VialRGB effects the keyboard has, and the one it runs", () => {
    expect(vialRgbChoices([0, 2, 1], 2)).toEqual([
      { value: 0, label: "Disable" }, { value: 1, label: "Direct Control" }, { value: 2, label: "Solid Color" }]);
    expect(vialRgbChoices([0, 50], 7).map((c) => c.label)).toEqual(["Disable", "Band Sat", "Effect 50"]);
  });

  it("lists every RGB light effect, and one beyond them the keyboard runs", () => {
    expect(rgbLightChoices(3)).toHaveLength(37);
    expect(rgbLightChoices(40).at(-1)).toEqual({ value: 40, label: "Effect 40" });
  });

  it("says what the firmware ignores under some effects", () => {
    expect(vialRgbNote(0)).toMatch(/off/);
    expect(vialRgbNote(2)).toBeNull();
    expect(rgbLightNote(0)).toMatch(/off/);
    expect(rgbLightNote(1)).toBeNull();
    expect([2, 5].map(rgbLightNote).every((n) => n?.includes("brightness"))).toBe(true);
    expect([6, 14].map(rgbLightNote).every((n) => n?.includes("hue"))).toBe(true);
    expect(rgbLightNote(15)).toBeNull();
  });
});

describe("colours", () => {
  it("converts QMK's hue, saturation and brightness to RGB as Qt does", () => {
    expect(hsvToRgb(0, 255, 255)).toEqual([255, 0, 0]);
    expect(hsvToRgb(85, 255, 255)).toEqual([0, 255, 0]);
    expect(hsvToRgb(170, 255, 255)).toEqual([0, 0, 255]);
    expect(hsvToRgb(255, 255, 255)).toEqual([255, 0, 0]); // 360°
    expect(hsvToRgb(40, 0, 128)).toEqual([128, 128, 128]);
    expect(hsvToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("converts back, a grey with hue 0", () => {
    expect(rgbToHsv([255, 0, 0])).toEqual([0, 255, 255]);
    expect(rgbToHsv([0, 0, 255])).toEqual([170, 255, 255]);
    expect(rgbToHsv([255, 0, 255])).toEqual([213, 255, 255]);
    expect(rgbToHsv([90, 90, 90])).toEqual([0, 0, 90]);
    for (const [h, s, v] of [[10, 200, 255], [128, 255, 200], [200, 100, 255]]) {
      const [h2, s2, v2] = rgbToHsv(hsvToRgb(h, s, v));
      expect(Math.abs(h2 - h)).toBeLessThanOrEqual(2);
      expect(Math.abs(s2 - s)).toBeLessThanOrEqual(2);
      expect(v2).toBe(v);
    }
  });

  it("reads and writes hex colours", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(hexToRgb("#FF8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("red")).toBeNull();
  });

  it("takes the hue and saturation of a colour picked; a grey keeps the hue", () => {
    expect(pickedHueSat("#0000ff", 10)).toEqual({ hue: 170, saturation: 255 });
    expect(pickedHueSat("#808080", 10)).toEqual({ hue: 10, saturation: 0 });
    expect(pickedHueSat("nope", 10)).toBeNull();
  });

  it("says hues in degrees and levels in percent", () => {
    expect(degrees(0)).toBe("0°");
    expect(degrees(128)).toBe("181°");
    expect(degrees(255)).toBe("0°");
    expect(percent(255)).toBe("100 %");
    expect(percent(200)).toBe("78 %");
  });

  it("says a brightness as a share of the keyboard's most", () => {
    expect(percentOf(128, 200)).toBe("64 %");
    expect(percentOf(200, 200)).toBe("100 %");
    expect(percentOf(0, 0)).toBe("0 %");
  });

  it("paints the slider tracks", () => {
    expect(HUE_TRACK).toContain("hsl(0 100% 50%)");
    expect(saturationTrack(0)).toBe("linear-gradient(to right, #ffffff, #ff0000)");
    expect(brightnessTrack(0, 255)).toBe("linear-gradient(to right, #000000, #ff0000)");
    expect(brightnessTrack(0, 255, 128)).toBe("linear-gradient(to right, #000000, #800000)");
  });
});

describe("patches", () => {
  it("names the kinds the keyboard has", () => {
    expect(lightingKinds(ALL)).toEqual(["RGB matrix", "RGB light", "backlight"]);
    expect(lightingKinds({ backlight: ALL.backlight })).toEqual(["backlight"]);
    expect(hasLighting({})).toBe(false);
    expect(hasLighting({ vialrgb: null, rgblight: null, backlight: null })).toBe(false);
  });

  it("merges newer changes over older ones, kind by kind", () => {
    expect(mergePatch({ vialrgb: { mode: 1, speed: 2 } }, { vialrgb: { speed: 3 }, backlight: { effect: 1 } }))
      .toEqual({ vialrgb: { mode: 1, speed: 3 }, backlight: { effect: 1 } });
  });

  it("shows a patch over the lighting, and asks only for the kinds the keyboard has", () => {
    const shown = withPatch({ vialrgb: ALL.vialrgb }, { vialrgb: { hsv: [1, 2, 3] }, backlight: { effect: 1 } });
    expect(shown).toEqual({ vialrgb: { ...ALL.vialrgb, hsv: [1, 2, 3] } });
    expect(patchRequest({ vialrgb: { mode: 1 }, rgblight: { effect: 2 } }, { vialrgb: ALL.vialrgb }))
      .toEqual({ vialrgb: { mode: 1 } });
  });

  it("compares what can be set, and brings it back", () => {
    expect(sameLighting(ALL, structuredClone(ALL))).toBe(true);
    expect(sameLighting(ALL, { ...ALL, backlight: { brightness: 255, effect: 0 } })).toBe(false);
    // the keyboard's maximum and effect list aren't settings
    expect(sameLighting(ALL, { ...ALL, vialrgb: { ...ALL.vialrgb!, supportedEffects: [] } })).toBe(true);
    expect(restorePatch(ALL)).toEqual({
      vialrgb: { mode: 2, speed: 128, hsv: [0, 255, 128] },
      rgblight: { effect: 1, hue: 0, saturation: 255, brightness: 128 },
      backlight: { brightness: 170, effect: 0 },
    });
    expect(restorePatch({ backlight: ALL.backlight })).toEqual({ backlight: { brightness: 170, effect: 0 } });
  });
});

/** A clock the test moves by hand */
function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const clock: Clock = {
    now: () => now,
    setTimeout: (run, ms) => {
      timers.push({ at: now + ms, run, id: ++ids });
      return ids;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.run();
      }
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LatestWriter", () => {
  function writer(gap = 100) {
    const { clock, advance } = fakeClock();
    const writes: { value: Record<string, number>; done: () => void; fail: () => void }[] = [];
    const busy: boolean[] = [];
    const w = new LatestWriter<Record<string, number>>(
      (value) => new Promise<void>((resolve, reject) => writes.push({ value, done: resolve, fail: () => reject(new Error("no")) })),
      (a, b) => ({ ...a, ...b }), gap, (b) => busy.push(b), clock,
    );
    return { w, writes, busy, advance };
  }

  it("sends the first change at once", () => {
    const { w, writes, busy } = writer();
    w.push({ a: 1 });
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }]);
    expect(w.busy).toBe(true);
    expect(busy).toEqual([true]);
  });

  it("merges what comes while a write is on its way, and sends the latest of each once it is done", async () => {
    const { w, writes, advance } = writer();
    w.push({ a: 1 });
    w.push({ a: 2 });
    w.push({ b: 5 });
    w.push({ a: 3 });
    expect(writes).toHaveLength(1);
    advance(150);
    writes[0].done();
    await flush();
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 3, b: 5 }]);
  });

  it("leaves at least the gap between the starts of two writes", async () => {
    const { w, writes, advance } = writer(100);
    w.push({ a: 1 });
    writes[0].done();
    await flush();
    w.push({ a: 2 });
    expect(writes).toHaveLength(1);
    advance(99);
    expect(writes).toHaveLength(1);
    advance(1);
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("goes on after a failed write, and tells when it is idle", async () => {
    const { w, writes, busy, advance } = writer();
    const idle = vi.fn();
    w.push({ a: 1 });
    w.push({ a: 2 });
    void w.idle().then(idle);
    writes[0].fail();
    await flush();
    advance(100);
    expect(writes.map((x) => x.value)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(idle).not.toHaveBeenCalled();
    writes[1].done();
    await flush();
    expect(idle).toHaveBeenCalled();
    expect(w.busy).toBe(false);
    expect(busy).toEqual([true, false]);
    await expect(w.idle()).resolves.toBeUndefined();
  });

  it("sends a burst of slider moves as a handful of writes, the last value last", async () => {
    const { w, writes, advance } = writer(100);
    for (let v = 0; v <= 255; v++) {
      w.push({ v });
      advance(4);
      // each write takes 30 ms
      if (writes.length && !("ended" in writes.at(-1)!)) {
        const last = writes.at(-1)!;
        Object.assign(last, { ended: true });
        setTimeout(last.done, 0);
        await flush();
      }
    }
    advance(200);
    await flush();
    writes.at(-1)!.done();
    await flush();
    advance(200);
    await flush();
    for (const x of writes) x.done();
    await flush();
    expect(writes.length).toBeLessThan(20);
    expect(writes.at(-1)!.value).toEqual({ v: 255 });
  });
});
