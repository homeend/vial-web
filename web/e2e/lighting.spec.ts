import type { Page } from "@playwright/test";
import {
  api, codeAt, expect, keyIndex, lightingOf, open, openSection, plugIn, restoreAll, setCodeAt, setLighting, test,
} from "./fixtures";

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

/** The session says the keyboard is connected */
async function connected(page: Page): Promise<boolean> {
  return (await (await api(page).get("/api/session")).json()).status === "connected";
}

/** Puts the lighting back and keeps it so. A test that failed while its keyboard was unplugged left it so: it is
 * plugged in again first (nothing changes for one plugged in), and read again. */
async function putBack(page: Page, l: Lighting) {
  await plugIn(page, true);
  await expect.poll(() => connected(page), { timeout: 10_000 }).toBe(true);
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
    // the firmware starts at its most (RGB_MATRIX_MAXIMUM_BRIGHTNESS)
    await expect(brightness).toHaveAttribute("aria-valuetext", "100 %");
    await app.getByRole("slider", { name: "Speed" }).fill("10");
    await brightness.fill("100");
    await expect.poll(async () => (await lightingOf(app)).vialrgb.hsv[2]).toBe(100);
    expect((await lightingOf(app)).vialrgb.speed).toBe(10);
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    await undo.click();
    await expect.poll(async () => (await lightingOf(app)).vialrgb).toEqual(before.vialrgb);
    await expect(status(app)).toHaveText(/^No changes|^Saved/);
    await expect(undo).toBeFocused();
    // off: the keyboard takes no colour, and the page says so
    await app.getByLabel("Effect").selectOption({ label: "Disable" });
    await expect(app.getByText("The lights are off: the keyboard takes no colour or brightness")).toBeVisible();
    // the page shows the draft at once: the clean-up waits for the keyboard, or the change would reach it after
    await expect.poll(async () => (await lightingOf(app)).vialrgb.mode).toBe(0);
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
    // a drag: 100 moves at once, as fast as the browser sends them, down or up, whichever stays within 0-255
    const from = before.vialrgb.speed;
    const step = from >= 100 ? -1 : 1;
    const to = from + 100 * step;
    await speed.evaluate((input: HTMLInputElement, { from, step }: { from: number; step: number }) => {
      for (let i = 1; i <= 100; i++) {
        input.value = String(from + i * step);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, { from, step });
    await expect.poll(async () => (await lightingOf(app)).vialrgb.speed).toBe(to);
    await expect(status(app)).not.toHaveText(/Sending/);
    // the first move at once, then the last: nothing in between
    expect(puts.map((p) => JSON.parse(p))).toEqual([{ vialrgb: { speed: from + step } }, { vialrgb: { speed: to } }]);
    await expect(speed).toHaveValue(String(to));
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

test("QMK backlight breathing is kept at once, without a Save; an RGB light change is not", async ({ qmkLighting: page }) => {
  const before = await lightingOf(page);
  try {
    await openSection(page, "Lighting");
    await expect(page.getByText("Backlight breathing is the exception: the keyboard keeps it at once.")).toBeVisible();
    const breathing = page.getByRole("region", { name: "Backlight" }).getByRole("switch", { name: "Breathing" });
    await expect(breathing).not.toBeChecked();
    const hue = (before.rgblight.hue + 85) % 256;
    await page.getByRole("slider", { name: "Hue" }).fill(String(hue));
    await breathing.check();
    await expect.poll(async () => {
      const l = await lightingOf(page);
      return [l.rgblight.hue, l.backlight.effect];
    }).toEqual([hue, 1]);
    await expect(status(page)).toContainText("not saved");

    // not saved: a replug brings back the RGB light the keyboard kept, and the breathing it kept at once
    await replug(page);
    await expect.poll(async () => {
      const l = await lightingOf(page);
      return [l.rgblight.hue, l.backlight.effect];
    }).toEqual([before.rgblight.hue, 1]);
    await expect(breathing).toBeChecked();
    await expect(page.getByRole("slider", { name: "Hue" })).toHaveValue(String(before.rgblight.hue));
    await expect(status(page)).toHaveText("The backlight is kept as it is: the keyboard keeps a change of breathing at once.");
  } finally {
    await restoreAll(() => putBack(page, before));
  }
});

test("a keyboard without lighting has no Lighting page and says nothing of lighting", async ({ macropad }) => {
  const nav = macropad.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button", { name: /^Keyboard/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Lighting/ })).toHaveCount(0);
  // its address shows the keymap instead, from another page too
  await openSection(macropad, "Keyboard");
  await macropad.goto(macropad.url().replace(/#.*$/, "") + "#lighting");
  await expect(macropad).toHaveURL(/#keymap$/);
  await expect(macropad.getByRole("heading", { level: 1, name: "Keymap" })).toBeVisible();
  // every page in the navigation (the macropad has no tap dances, combos, key overrides, alt-repeat keys or QMK
  // settings), the Keymap too: its keycode picker offers no lighting keys on a keyboard without lighting, though Qt's
  // always does. (Outside <main>, the theme switch's "Light" is no lighting either.)
  const names = await nav.locator("button > span").allTextContents();
  expect(names).toEqual(["Learning", "Keymap", "Layout", "Macros", "Matrix tester", "Keyboard", "Version"]);
  for (const name of names) {
    await openSection(macropad, name);
    await expect(macropad.locator("main")).not.toContainText(/lighting|RGB|backlight/i);
  }
});

test("the keycode picker has no Lighting category on a keyboard without lighting, nor finds lighting keys",
  async ({ macropad, corneUrl }) => {
    const categories = async (page: Page) => {
      await openSection(page, "Keymap");
      await page.locator("button.key").first().click();
      await page.getByRole("complementary", { name: "Selected key" }).getByRole("button", { name: "Change key" }).click();
      const picker = page.getByRole("dialog");
      const tabs = await picker.getByRole("tablist", { name: "Keycode categories" }).getByRole("tab").allTextContents();
      await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("rgb");
      const found = await picker.locator(".grid button.kc").count();
      await picker.getByRole("button", { name: "Close" }).click();
      await expect(picker).toBeHidden();
      return { tabs: tabs.map((t) => t.trim()), found };
    };
    const without = await categories(macropad);
    expect(without.tabs).not.toContain("Lighting");
    expect(without.tabs).toContain("Media");
    expect(without.found).toBe(0);
    // the Corne has lighting: it is offered there (the fixtures share a page: the Corne gets a page of its own)
    const lit = await categories(await open(await macropad.context().newPage(), corneUrl));
    expect(lit.tabs).toContain("Lighting");
    expect(lit.found).toBeGreaterThan(0);
  });

test("on a keyboard without lighting, Any keycode still takes a lighting key, and the key shows it",
  async ({ macropad }) => {
    const index = await keyIndex(macropad, 0, 0);
    const before = await codeAt(macropad, 0, index);
    try {
      const key = macropad.locator(`[data-ref="key:${index}"]`);
      await key.click();
      await macropad.getByRole("button", { name: "Change key" }).click();
      const picker = macropad.getByRole("dialog");
      await picker.getByLabel("Any keycode").fill("RGB_TOG");
      await expect(picker.locator("#any-keycode-result")).toContainText("RGB_TOG");
      await picker.getByRole("button", { name: "Use", exact: true }).click();
      await expect(picker).toBeHidden();
      await expect.poll(() => codeAt(macropad, 0, index)).toBe("RGB_TOG");
      await expect(key).toContainText("RGB");
    } finally {
      await setCodeAt(macropad, 0, index, before);
    }
  });
