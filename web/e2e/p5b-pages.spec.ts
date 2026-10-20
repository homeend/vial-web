import type { Page } from "@playwright/test";
import { expect, openSection, pressKey, restoreAll, screenshots, test } from "./fixtures";

// The Lighting, Layout and Matrix tester pages, and the Keyboard page's reboot, at every window size and in both
// themes: no sideways scroll, at most 860 px wide, dialogs inside a 1080p window. Nothing here changes the keyboard.

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const SIZES = [[800, 900], [1280, 800], [2560, 1440], [1920, 950], [375, 812]] as const;

async function check(page: Page, name: string, shot: string) {
  await openSection(page, name);
  expect(await sidewaysScroll(page), name).toBeLessThanOrEqual(0);
  const box = (await page.locator(".page.list").boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(860);
  await screenshots(page, shot, { fullPage: true });
}

// one keyboard per test: the fixtures' pages are one and the same page
for (const [width, height] of SIZES) {
  test(`${width} x ${height}: Lighting (VialRGB), Matrix tester and Keyboard on the Corne`, async ({ app }) => {
    await app.setViewportSize({ width, height });
    await check(app, "Lighting", `lighting-vialrgb-${width}x${height}`);
    await check(app, "Matrix tester", `matrix-${width}x${height}`);
    await check(app, "Keyboard", `keyboard-${width}x${height}`);
  });

  test(`${width} x ${height}: Lighting (QMK RGB light and backlight)`, async ({ qmkLighting }) => {
    await qmkLighting.setViewportSize({ width, height });
    await check(qmkLighting, "Lighting", `lighting-qmk-${width}x${height}`);
  });

  test(`${width} x ${height}: Layout on the macropad`, async ({ macropad }) => {
    await macropad.setViewportSize({ width, height });
    await check(macropad, "Layout", `layout-${width}x${height}`);
  });
}

test("1920 x 950: the matrix tester while testing, and the reboot confirmation, fit the window", async ({ app }) => {
  await app.setViewportSize({ width: 1920, height: 950 });
  try {
    await openSection(app, "Matrix tester");
    await app.getByRole("button", { name: "Start testing" }).click();
    await pressKey(app, 0, 1);
    await pressKey(app, 2, 2);
    await expect(app.locator(".board .key.pressed")).toHaveCount(2);
    await pressKey(app, 2, 2, false);
    await pressKey(app, 3, 0);
    await expect(app.locator(".board .key.pressed")).toHaveCount(1);
    // the drawing and the whole switch matrix card (with its line about the position held that has no key) together
    // in one window (a bounding box is where it is in the window)
    await expect(app.locator(".strays")).toBeVisible();
    const card = (await app.locator("section.card", { has: app.locator("table") }).boundingBox())!;
    const board = (await app.locator(".board").boundingBox())!;
    expect(board.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(950);
    await screenshots(app, "matrix-testing-1920x950", { fullPage: true });
    await app.getByRole("button", { name: "Stop testing" }).click();

    await openSection(app, "Keyboard");
    await app.getByRole("button", { name: "Reboot to bootloader…" }).click();
    const dialog = app.getByRole("dialog", { name: "Reboot the keyboard into its bootloader?" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(950);
    // the safe choice has the focus
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await screenshots(app, "bootloader-confirm-1920x950");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await restoreAll(() => pressKey(app, 0, 1, false), () => pressKey(app, 2, 2, false), () => pressKey(app, 3, 0, false));
  }
});
