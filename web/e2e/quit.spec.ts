// Quit Vial: the top bar's button stops the server, closing the keyboard first; every tab shows that Vial has stopped.
// Each test ends its server, so each has one of its own (ownServer).
import { expect, keyIndex, open, screenshots, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** How far the page reaches past the window's right edge, in pixels */
const sideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const quitButton = (page: Page) => page.getByRole("button", { name: "Quit Vial" });
const stoppedHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Vial has stopped" });

/** Holds back the page's next write to a key: `held` resolves once it is made, `fail` answers it as a keyboard that
 * didn't respond and resolves once it is answered */
async function holdKeyWrite(page: Page): Promise<{ held: Promise<void>; fail: () => Promise<void> }> {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let made = () => {};
  const held = new Promise<void>((resolve) => (made = resolve));
  let answered = Promise.resolve();
  await page.route("**/api/keymap/**", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    made();
    answered = released.then(() => route.fulfill({ status: 502, contentType: "application/json",
      body: JSON.stringify({ detail: "the keyboard didn't respond: timeout" }) }));
    return answered;
  });
  return {
    held,
    fail: () => {
      release();
      return answered;
    },
  };
}

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

test("a write that fails after Quit Vial shows no toast: the page only says that Vial has stopped", async ({
  page,
  ownServer,
}) => {
  await open(page, ownServer.url);
  // the key's write is held back until Vial has stopped, then fails
  const write = await holdKeyWrite(page);
  await page.locator(`[data-ref="key:${await keyIndex(page, 1, 1)}"]`).click();
  await page.keyboard.press("Delete");
  await write.held;

  await quitButton(page).click();
  await expect(stoppedHeading(page)).toBeFocused();
  // the write fails once Vial has gone (its exit code is the first test's to check)
  await ownServer.exited;

  await write.fail();
  // the page has had time to take the failure in
  await page.waitForTimeout(1000);
  await expect(page.getByText(/failed/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  await expect(stoppedHeading(page)).toBeVisible();
});

test("an Undo still being saved when Vial stops ends without an error, its toast gone", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  // a key dropped on the one next to it replaces it, and the toast offers to undo that
  const [from, to] = [await keyIndex(page, 1, 1), await keyIndex(page, 1, 2)];
  const centre = async (index: number) => {
    const box = (await page.locator(`[data-ref="key:${index}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const [start, end] = [await centre(from), await centre(to)];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("menu").getByRole("menuitem", { name: /^Replace with / }).click();
  const undo = page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible();

  // Undo, with the focus on it, is held back until Vial has stopped, then fails
  const write = await holdKeyWrite(page);
  await undo.focus();
  await page.keyboard.press("Enter");
  await write.held;

  await quitButton(page).click();
  await expect(stoppedHeading(page)).toBeFocused();
  // the write fails once Vial has gone (its exit code is the first test's to check)
  await ownServer.exited;

  await write.fail();
  // the page has had time to take the failure in
  await page.waitForTimeout(1000);
  expect(errors.map(String)).toEqual([]);
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  await expect(stoppedHeading(page)).toBeFocused();
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
