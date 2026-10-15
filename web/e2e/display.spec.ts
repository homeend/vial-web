import { expect, labelsCutOff, screenshots, test } from "./fixtures";

test.describe("width and fit", () => {
  test("1280 x 800: every label fits on its key", async ({ app }) => {
    await screenshots(app, "keymap-1280", { fullPage: true });
    expect(await labelsCutOff(app)).toEqual([]);
    // the whole name is in the tooltip
    await expect(app.getByRole("button", { name: /^Tap dance 0 · Tab \/ Caps Lock/ })).toHaveAttribute(
      "title", /Tab \/ Caps Lock/);
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
    await screenshots(app, "keymap-800", { fullPage: true });
  });
});

test.describe("Inspector and picker", () => {
  test("a layer-tap key is titled in words; the picker", async ({ app }) => {
    await app.getByRole("button", { name: /^Space — hold for Layer 1/ }).click();
    await expect(app.getByRole("heading", { name: "Space — hold for Layer 1" })).toBeVisible();
    await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("row 3 · column 4 · Base layer");
    await screenshots(app, "inspector-layer-tap");
    await app.getByRole("button", { name: "Change key" }).click();
    await expect(app.getByRole("dialog")).toBeVisible();
    await screenshots(app, "picker");
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
