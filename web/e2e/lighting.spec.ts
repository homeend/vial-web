import type { Page } from "@playwright/test";
import { api, expect, lightingOf, openSection, plugIn, restoreAll, setLighting, test } from "./fixtures";

// The Lighting page against the simulated keyboards: the Corne's VialRGB, and QMK's RGB light and backlight on the
// other Corne. Changes show at once and are kept only once saved: a replug (the simulator starts over with what its
// firmware keeps) tells. Each test puts back the lighting it changed, and saves it, so the next one finds it as before.

type Lighting = Awaited<ReturnType<typeof lightingOf>>;

/** The lighting as a request puts it back */
function restoreBody(l: Lighting) {
  return {
    ...(l.vialrgb ? { vialrgb: { mode: l.vialrgb.mode, speed: l.vialrgb.speed, hsv: l.vialrgb.hsv } } : {}),
    ...(l.rgblight ? { rgblight: { effect: l.rgblight.effect, hue: l.rgblight.hue, saturation: l.rgblight.saturation,
      brightness: l.rgblight.brightness } } : {}),
    ...(l.backlight ? { backlight: { brightness: l.backlight.brightness, effect: l.backlight.effect } } : {}),
  };
}

/** Puts the lighting back and keeps it so */
async function putBack(page: Page, l: Lighting) {
  await setLighting(page, restoreBody(l));
  const saved = await api(page).post("/api/lighting/save");
  if (!saved.ok()) throw new Error(`saving the lighting failed: ${saved.status()}`);
}

/** Unplugs the simulated keyboard and plugs it back in, and waits until the page has read it again */
async function replug(page: Page) {
  await plugIn(page, false);
  await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeVisible();
  await plugIn(page, true);
  await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeHidden({ timeout: 10_000 });
}

const status = (page: Page) => page.locator(".savebar [role=status]");

test("VialRGB: an effect and a colour show at once, and are kept once saved", async ({ app }) => {
  const before = await lightingOf(app);
  try {
    await openSection(app, "Lighting");
    const effect = app.getByLabel("Effect");
    await expect(effect).toHaveValue(String(before.vialrgb.mode));
    await effect.selectOption({ label: "Gradient Up Down" });
    await expect.poll(async () => (await lightingOf(app)).vialrgb.mode).toBe(4);
    await app.getByRole("slider", { name: "Hue" }).fill("170");
    await expect.poll(async () => (await lightingOf(app)).vialrgb.hsv[0]).toBe(170);
    await expect(app.getByRole("slider", { name: "Hue" })).toHaveAttribute("aria-valuetext", "240°");
    await expect(status(app)).toContainText("not saved");

    // not saved yet: a replug brings back what the keyboard kept
    await replug(app);
    await expect.poll(async () => (await lightingOf(app)).vialrgb.mode).toBe(before.vialrgb.mode);
    await expect(effect).toHaveValue(String(before.vialrgb.mode));

    await effect.selectOption({ label: "Gradient Up Down" });
    await app.getByRole("slider", { name: "Hue" }).fill("170");
    await expect(status(app)).toContainText("not saved");
    const save = app.locator(".savebar").getByRole("button", { name: "Save" });
    await save.click();
    await expect(status(app)).toHaveText("Saved: the keyboard keeps this lighting when it is unplugged.");
    await expect(save).toBeFocused();
    await replug(app);
    const after = await lightingOf(app);
    expect([after.vialrgb.mode, after.vialrgb.hsv[0]]).toEqual([4, 170]);
    await expect(effect).toHaveValue("4");
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("VialRGB: Undo puts back the lighting, and the brightness stops at the keyboard's most", async ({ app }) => {
  const before = await lightingOf(app);
  try {
    await openSection(app, "Lighting");
    const brightness = app.getByRole("slider", { name: "Brightness" });
    await expect(brightness).toHaveAttribute("max", "200");
    await expect(app.getByText("100 % is the brightest this keyboard's firmware allows: 78 % of what its lights can do.")).toBeVisible();
    await expect(brightness).toHaveAttribute("aria-valuetext", "64 %");
    await app.getByRole("slider", { name: "Speed" }).fill("10");
    await brightness.fill("200");
    await expect.poll(async () => (await lightingOf(app)).vialrgb.hsv[2]).toBe(200);
    expect((await lightingOf(app)).vialrgb.speed).toBe(10);
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    await undo.click();
    await expect.poll(async () => (await lightingOf(app)).vialrgb).toEqual(before.vialrgb);
    await expect(status(app)).toHaveText(/^No changes|^Saved/);
    await expect(undo).toBeFocused();
    // off: the keyboard takes no colour, and the page says so
    await app.getByLabel("Effect").selectOption({ label: "Disable" });
    await expect(app.getByText("The lights are off: the keyboard takes no colour or brightness")).toBeVisible();
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("a slider dragged quickly sends a few changes, the last one last", async ({ app }) => {
  const before = await lightingOf(app);
  const puts: string[] = [];
  app.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/lighting")) puts.push(r.postData() ?? "");
  });
  try {
    await openSection(app, "Lighting");
    const speed = app.getByRole("slider", { name: "Speed" });
    // a drag: 100 moves at once, as fast as the browser sends them
    await speed.evaluate((input: HTMLInputElement, from: number) => {
      for (let i = 1; i <= 100; i++) {
        input.value = String(from - i);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, before.vialrgb.speed);
    await expect.poll(async () => (await lightingOf(app)).vialrgb.speed).toBe(before.vialrgb.speed - 100);
    await expect(status(app)).not.toHaveText(/Sending/);
    // the first move at once, then the last: nothing in between
    expect(puts.length).toBeLessThanOrEqual(3);
    expect(JSON.parse(puts.at(-1)!)).toEqual({ vialrgb: { speed: before.vialrgb.speed - 100 } });
    await expect(speed).toHaveValue(String(before.vialrgb.speed - 100));
  } finally {
    await restoreAll(() => putBack(app, before));
  }
});

test("QMK RGB light and backlight: effect, colour, brightness steps and breathing, kept once saved", async ({ qmkLighting: page }) => {
  const before = await lightingOf(page);
  try {
    await openSection(page, "Lighting");
    await expect(page.getByRole("heading", { level: 2, name: "RGB light" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Backlight" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "RGB matrix" })).toHaveCount(0);

    await page.getByLabel("Effect").selectOption({ label: "Snake 1" });
    await page.getByRole("slider", { name: "Hue" }).fill("85");
    await page.getByRole("slider", { name: "Saturation" }).fill("200");
    await expect.poll(async () => {
      const l = (await lightingOf(page)).rgblight;
      return [l.effect, l.hue, l.saturation];
    }).toEqual([15, 85, 200]);

    // the backlight's three steps: 200 settles on 170
    const backlight = page.getByRole("region", { name: "Backlight" });
    await backlight.getByRole("slider", { name: "Brightness" }).fill("200");
    await expect.poll(async () => (await lightingOf(page)).backlight.brightness).toBe(170);
    await expect(backlight.getByRole("slider", { name: "Brightness" })).toHaveValue("170");
    await backlight.getByRole("switch", { name: "Breathing" }).check();
    await expect.poll(async () => (await lightingOf(page)).backlight.effect).toBe(1);

    // the RGB light turned off and on again takes the effect chosen (sent twice by the server)
    await page.getByLabel("Effect").selectOption({ label: "All Off" });
    await expect(page.getByText("The light is off: the keyboard takes no colour or brightness")).toBeVisible();
    await page.getByLabel("Effect").selectOption({ label: "Knight 1" });
    await expect.poll(async () => (await lightingOf(page)).rgblight.effect).toBe(21);

    await page.locator(".savebar").getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toHaveText("Saved: the keyboard keeps this lighting when it is unplugged.");
    await replug(page);
    const after = await lightingOf(page);
    expect([after.rgblight.effect, after.rgblight.hue, after.backlight.brightness, after.backlight.effect])
      .toEqual([21, 85, 170, 1]);
  } finally {
    await restoreAll(() => putBack(page, before));
  }
});

test("a keyboard without lighting has no Lighting page and says nothing of lighting", async ({ macropad }) => {
  const nav = macropad.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button", { name: /^Keyboard/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Lighting/ })).toHaveCount(0);
  // its address shows the keymap instead
  await macropad.goto(macropad.url().replace(/#.*$/, "") + "#lighting");
  await expect(macropad.getByRole("heading", { level: 1, name: "Keymap" })).toBeVisible();
  for (const name of ["Keyboard", "Layout", "Matrix tester"]) {
    await openSection(macropad, name);
    await expect(macropad.locator("main")).not.toContainText(/lighting|RGB|backlight/i);
  }
});
