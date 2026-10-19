import type { Locator, Page } from "@playwright/test";
import { expect, openSection, screenshots, test } from "./fixtures";

// The Key overrides, Alt-repeat, Settings and Keyboard pages at every window size, in both themes: no sideways scroll,
// at most 860 px wide, editors and dialogs inside a 1080p window. Nothing here changes the keyboard.

const PAGES = [
  ["Key overrides", "key-overrides"], ["Alt-repeat", "alt-repeat"], ["Settings", "settings"], ["Keyboard", "keyboard"],
] as const;

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function expectInWindow(page: Page, element: Locator) {
  const box = (await element.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

/** Every page settled: the settings read, so the screenshot shows them */
async function settled(page: Page, id: string) {
  if (id === "settings") await expect(page.getByRole("heading", { level: 2, name: /^Tap-Hold/ })).toBeVisible();
}

test.describe("screenshots of the feature pages", () => {
  for (const [width, height] of [[800, 900], [1280, 800], [2560, 1440], [1920, 950]]) {
    test(`${width} x ${height}: no sideways scroll, at most 860 px wide`, async ({ app }) => {
      await app.setViewportSize({ width, height });
      for (const [name, id] of PAGES) {
        await openSection(app, name);
        await settled(app, id);
        expect(await sidewaysScroll(app), name).toBeLessThanOrEqual(0);
        const page = (await app.locator(".page.list").boundingBox())!;
        expect(page.width).toBeLessThanOrEqual(860);
        await screenshots(app, `${id}-${width}x${height}`, { fullPage: true });
      }
    });
  }

  test("1920 x 950: the editors and the reset dialog fit the window", async ({ app }) => {
    await app.setViewportSize({ width: 1920, height: 950 });
    await openSection(app, "Key overrides");
    const card = app.locator("#key-override-0");
    await card.getByRole("button", { name: "Edit" }).click();
    const editor = card.locator(".editor");
    await expect(editor).toBeVisible();
    // the card scrolled into view takes no more than the window
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(950 - 80);
    await card.scrollIntoViewIfNeeded();
    await screenshots(app, "key-override-editor-1920x950");
    await card.getByRole("button", { name: "Cancel" }).click();

    await openSection(app, "Alt-repeat");
    const ark = app.locator("#alt-repeat-0");
    await ark.getByRole("button", { name: "Edit" }).click();
    await expect(ark.locator(".editor")).toBeVisible();
    await screenshots(app, "alt-repeat-editor-1920x950");
    await ark.getByRole("button", { name: "Cancel" }).click();

    await openSection(app, "Settings");
    await settled(app, "settings");
    await app.getByRole("button", { name: "Reset to defaults…" }).click();
    const dialog = app.getByRole("dialog", { name: "Reset every setting?" });
    await expect(dialog).toBeVisible();
    await expectInWindow(app, dialog);
    await screenshots(app, "settings-reset-dialog-1920x950");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(app.getByRole("button", { name: "Reset to defaults…" })).toBeFocused();
    // the Save bar stays at the window's bottom on a long form
    const bar = app.locator(".savebar");
    await expectInWindow(app, bar);
  });
});

test("375 px wide (a phone): the feature pages and their editors don't scroll sideways", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 812 });
  for (const [name, id] of PAGES) {
    await openSection(app, name);
    await settled(app, id);
    expect(await sidewaysScroll(app), name).toBeLessThanOrEqual(0);
    await screenshots(app, `${id}-375`, { fullPage: true });
  }
  await openSection(app, "Key overrides");
  await app.locator("#key-override-0").getByRole("button", { name: "Edit" }).click();
  await expect(app.locator("#key-override-0 .editor")).toBeVisible();
  expect(await sidewaysScroll(app), "the key override editor").toBeLessThanOrEqual(0);
  await screenshots(app, "key-override-editor-375", { fullPage: true });
  await app.locator("#key-override-0").getByRole("button", { name: "Cancel" }).click();
  await openSection(app, "Alt-repeat");
  await app.locator("#alt-repeat-0").getByRole("button", { name: "Edit" }).click();
  expect(await sidewaysScroll(app), "the alt-repeat editor").toBeLessThanOrEqual(0);
  await app.locator("#alt-repeat-0").getByRole("button", { name: "Cancel" }).click();
});
