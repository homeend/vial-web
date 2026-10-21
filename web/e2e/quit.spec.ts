// Quit Vial: the top bar's button stops the server, closing the keyboard first; every tab shows that Vial has stopped.
// Each test ends its server, so each has one of its own (ownServer).
import { expect, open, screenshots, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** How far the page reaches past the window's right edge, in pixels */
const sideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const quitButton = (page: Page) => page.getByRole("button", { name: "Quit Vial" });
const stoppedHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Vial has stopped" });

test("Quit Vial stops the server; every tab says so and stops reconnecting", async ({ page, context, ownServer }) => {
  await open(page, ownServer.url);
  const other = await open(await context.newPage(), ownServer.url);

  await quitButton(page).click();
  await expect(stoppedHeading(page)).toBeFocused();
  await expect(page.getByText("You can close this tab.")).toBeVisible();
  await expect(page).toHaveTitle("Vial has stopped");
  // the other tab is told too
  await expect(stoppedHeading(other)).toBeVisible();
  await expect(stoppedHeading(other)).toBeFocused();
  await expect(page.getByRole("button", { name: "Quit Vial" })).toHaveCount(0);

  // the server process ends by itself
  expect(await ownServer.exited, ownServer.output()).toBe(0);
  // nothing tries to reach it any more: no "lost contact" banner comes, however long the tabs stay open
  const sockets: string[] = [];
  for (const tab of [page, other]) tab.on("websocket", (ws) => sockets.push(ws.url()));
  await page.waitForTimeout(6000);
  expect(sockets).toEqual([]);
  for (const tab of [page, other]) {
    await expect(stoppedHeading(tab)).toBeVisible();
    await expect(tab.getByText("Lost contact with Vial")).toHaveCount(0);
  }

  for (const [width, height] of [[375, 812], [800, 900], [1920, 950]] as const) {
    await page.setViewportSize({ width, height });
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    await screenshots(page, `quit-stopped-${width}`);
  }
});

test("Quit Vial asks first when there is work not saved; Cancel keeps Vial running", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("textbox", { name: "Tapping Term" }).fill("250");

  await quitButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Quit Vial?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Vial stops and lets go of the keyboard. Not saved yet, and lost if you quit: the changes on the Settings page.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await screenshots(page, "quit-confirm");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(quitButton(page)).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Tapping Term" })).toHaveValue("250");
  expect((await page.request.get(new URL("/api/session", page.url()).toString())).ok()).toBe(true);

  await quitButton(page).click();
  await dialog.getByRole("button", { name: "Quit Vial" }).click();
  await expect(stoppedHeading(page)).toBeFocused();
  expect(await ownServer.exited, ownServer.output()).toBe(0);
});

test("the Quit Vial button fits the top bar from 375 px to 1080p, in both themes", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  for (const [width, height] of [[375, 812], [800, 900], [1280, 800], [1920, 950]] as const) {
    await page.setViewportSize({ width, height });
    await expect(quitButton(page)).toBeVisible();
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    await screenshots(page, `quit-topbar-${width}`);
  }
  await quitButton(page).focus();
  await expect(quitButton(page)).toBeFocused();
  // the focus ring shows: an outline drawn around it
  expect(await quitButton(page).evaluate((b) => getComputedStyle(b).outlineStyle)).not.toBe("none");
});
