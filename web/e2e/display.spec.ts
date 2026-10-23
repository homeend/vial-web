import { expect, keyIndex, labelsCutOff, open, screenshots, test, useFont } from "./fixtures";

test.describe("width and fit", () => {
  test("1280 x 800: every label fits on its key", async ({ app }) => {
    await screenshots(app, "keymap-1280", { fullPage: true });
    expect(await labelsCutOff(app)).toEqual([]);
    // the whole name is in the tip (no browser tooltip)
    const key = app.getByRole("button", { name: /^Tap dance 0 · Tab \/ Caps Lock/ });
    await expect(key).not.toHaveAttribute("title");
    await key.hover();
    await expect(app.locator(".tip")).toContainText("Tab / Caps Lock", { timeout: 300 });
  });

  test("2560 x 1440: content stays at most 1100 px wide, and the keyboard fills its card", async ({ app }) => {
    await app.setViewportSize({ width: 2560, height: 1440 });
    await screenshots(app, "keymap-2560", { fullPage: true });
    const content = await app.locator("main.content").boundingBox();
    expect(content?.width).toBeLessThanOrEqual(1100);
    const card = await app.locator(".board").first().boundingBox();
    const keyboard = await app.locator(".plate").boundingBox();
    expect(keyboard!.width).toBeGreaterThanOrEqual(card!.width * 0.9);
    expect(keyboard!.width).toBeGreaterThanOrEqual(620);
    expect(await labelsCutOff(app)).toEqual([]);
  });

  test("800 wide: Inspector below the keyboard, no horizontal scroll", async ({ app }) => {
    await app.setViewportSize({ width: 800, height: 900 });
    // the keyboard rescales a frame after the resize (a ResizeObserver): measure until it has
    await expect(async () => {
      const board = await app.locator(".board").first().boundingBox();
      const inspector = await app.getByRole("complementary", { name: "Selected key" }).boundingBox();
      expect(board && inspector).toBeTruthy();
      expect(inspector!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
      const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const keys = app.locator("button.key");
      for (const box of await Promise.all((await keys.all()).map((k) => k.boundingBox()))) {
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(800);
      }
      expect(await labelsCutOff(app)).toEqual([]);
    }).toPass();
    await screenshots(app, "keymap-800", { fullPage: true });
  });

  // labels are sized by measuring them in the font the browser uses, which differs between systems (Segoe UI on
  // Windows, often the much wider DejaVu Sans on Linux): a wide font must fit too
  test("labels fit with a wide font, 800, 1280 and 2560 wide, in the Edit view, the Overview and the find views", async ({ page, corneUrl }) => {
    test.slow(); // three window sizes in two views and the find views, screenshots in two themes: slow on a busy machine
    const font = `Verdana, "DejaVu Sans", sans-serif`;
    await useFont(page, font);
    const app = await open(page, corneUrl);
    expect(await app.locator("button.key .tap").first().evaluate((e) => getComputedStyle(e).fontFamily)).toBe(font);
    for (const [width, height] of [[1280, 800], [2560, 1440], [800, 900]]) {
      await app.setViewportSize({ width, height });
      // the keyboard rescales a frame after the resize
      await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
      await screenshots(app, `keymap-wide-font-${width}`, { fullPage: true });
    }
    // the Overview's small keys too
    await app.getByRole("radio", { name: "Overview" }).check();
    for (const [width, height] of [[1280, 800], [2560, 1440], [800, 900]]) {
      await app.setViewportSize({ width, height });
      await expect(async () => {
        expect(await app.locator(".card .key .tap").count()).toBeGreaterThan(0);
        expect(await labelsCutOff(app)).toEqual([]);
      }).toPass({ timeout: 5_000 });
      await screenshots(app, `overview-wide-font-${width}`, { fullPage: true });
    }
    // and with keys highlighted by the find box, in the Overview and in the Edit view it opens
    await app.getByRole("searchbox", { name: "Find a character or key" }).fill("@");
    await expect(app.locator(".card .key.found")).toHaveCount(2);
    await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
    await screenshots(app, "find-wide-font", { fullPage: true });
    await app.locator("#find-results").getByRole("button", { name: /^Shift \+ 2/ }).click();
    await expect(app.locator("button.key.found")).toHaveCount(1);
    await expect(async () => expect(await labelsCutOff(app)).toEqual([])).toPass({ timeout: 5_000 });
  });
});

test.describe("Inspector and picker", () => {
  test("a layer-tap key is titled in words; the picker", async ({ app }) => {
    const space = app.locator(`[data-ref="key:${await keyIndex(app, 3, 4)}"]`); // base layer: Space, Layer 1 on hold
    await expect(space).toHaveAccessibleName(/^Space — hold for Layer 1/);
    await space.click();
    await expect(app.getByRole("heading", { name: "Space — hold for Layer 1" })).toBeVisible();
    await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("row 3 · column 4 · Base layer");
    await screenshots(app, "inspector-layer-tap");
    await app.getByRole("button", { name: "Change key" }).click();
    await expect(app.getByRole("dialog")).toBeVisible();
    await screenshots(app, "picker");
  });

  test("pointing at a key shows a tip at once: what it does, where it is; a tap dance's four ways", async ({ app }) => {
    const tip = app.locator(".tip");
    const space = app.locator(`[data-ref="key:${await keyIndex(app, 3, 4)}"]`); // Space, Layer 1 on hold
    await expect(space).not.toHaveAttribute("title");
    await expect(tip).toBeHidden();
    await space.hover();
    await expect(tip).toBeVisible({ timeout: 300 });
    await expect(tip).toContainText("Space — hold for Layer 1");
    await expect(tip).toContainText("row 3 · column 4 · Base layer");
    expect((await tip.locator(".ways .label").allTextContents()).map((t) => t.trim())).toEqual(["Tap", "Hold"]);
    await expect(tip).toContainText("Layer 1, while held");
    await expect(tip.locator("code")).toHaveText(/^LT1?\(/);
    await expect(tip).toHaveAttribute("aria-hidden", "true");
    await screenshots(app, "keymap-tip-layer-tap");

    const tapDance = app.getByRole("button", { name: /^Tap dance 0/ });
    await tapDance.hover();
    await expect(tip).toContainText("Tap dance 0 · Tab / Caps Lock", { timeout: 300 });
    expect((await tip.locator(".ways .label").allTextContents()).map((t) => t.trim()))
      .toEqual(["Tap", "Hold", "Double tap", "Tap, then hold"]);
    await expect(tip.locator(".chip")).toHaveCount(2); // Tab and Caps Lock; the two empty ways show a dash
    await expect(tip).toContainText("tapping term 200 ms");
    await screenshots(app, "keymap-tip-tap-dance");

    // a click takes the tip away, as a browser tooltip goes; leaving the key too
    await tapDance.click();
    await expect(tip).toBeHidden();
    await space.hover();
    await expect(tip).toBeVisible({ timeout: 300 });
    await app.getByRole("heading", { name: "Keymap" }).hover();
    await expect(tip).toBeHidden();

    // reached with the keyboard, the key shows its tip too
    await space.focus();
    await app.keyboard.press("ArrowLeft");
    await expect(tip).toBeVisible({ timeout: 300 });
  });

  test("a tap dance key is explained in place", async ({ app }) => {
    await app.getByRole("button", { name: /^Tap dance 0/ }).click();
    const tapDance = app.getByRole("region", { name: "Tap dance 0" });
    await expect(app.getByRole("heading", { name: "Tap dance 0 · Tab / Caps Lock" })).toBeVisible();
    const rows = await tapDance.locator("dt, dd").allTextContents();
    expect(rows.map((t) => t.trim())).toEqual([
      "Tap", "Tab", "Hold", "nothing", "Double tap", "Caps Lock", "Tap, then hold", "nothing",
    ]);
    await expect(tapDance).toContainText("Decides after 200 ms");
    await screenshots(app, "inspector-tap-dance");
  });
});
