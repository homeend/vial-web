// Quit Vial: the top bar's button stops the server, closing the keyboard first; every tab shows that Vial has stopped.
// A test that ends its server has one of its own (ownServer); the others use the worker's (app), and don't quit.
import { api, expect, keyIndex, open, openUnlockDialog, screenshots, test } from "./fixtures";
import type { TestServer } from "./servers";
import type { Page } from "@playwright/test";

/** seconds Vial has to exit once it has stopped */
const EXIT_WAIT = 10;

/** The server's exit code, once it has exited by itself; fails, saying so, if it hasn't within EXIT_WAIT seconds */
async function exitCode(server: TestServer): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    const fail = () => reject(new Error(`Vial didn't exit within ${EXIT_WAIT} s of stopping:\n${server.output()}`));
    timer = setTimeout(fail, EXIT_WAIT * 1000);
  });
  try {
    return await Promise.race([server.exited, late]);
  } finally {
    clearTimeout(timer);
  }
}

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
  expect(await exitCode(ownServer), ownServer.output()).toBe(0);
  // nothing tries to reach it any more, however long the tabs stay open: they still say that Vial has stopped
  const sockets: string[] = [];
  for (const tab of [page, other]) tab.on("websocket", (ws) => sockets.push(ws.url()));
  await page.waitForTimeout(6000);
  expect(sockets).toEqual([]);
  for (const tab of [page, other]) {
    await expect(stoppedHeading(tab)).toBeVisible();
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
  expect((await api(page).get("/api/session")).ok()).toBe(true);

  await quitButton(page).click();
  await dialog.getByRole("button", { name: "Quit Vial" }).click();
  await expect(stoppedHeading(page)).toBeFocused();
  expect(await exitCode(ownServer), ownServer.output()).toBe(0);
});

test("a write that fails after Quit Vial shows no toast: the page only says that Vial has stopped", async ({
  page,
  ownServer,
}) => {
  await open(page, ownServer.url);
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  // the key's write is held back until Vial has stopped, then fails
  const write = await holdKeyWrite(page);
  await page.locator(`[data-ref="key:${await keyIndex(page, 1, 1)}"]`).click();
  await page.keyboard.press("Delete");
  await write.held;

  await quitButton(page).click();
  await expect(stoppedHeading(page)).toBeFocused();
  expect(await exitCode(ownServer), ownServer.output()).toBe(0);

  await write.fail();
  // the page has had time to take the failure in
  await page.waitForTimeout(1000);
  expect(errors.map(String)).toEqual([]);
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
  expect(await exitCode(ownServer), ownServer.output()).toBe(0);

  await write.fail();
  // the page has had time to take the failure in
  await page.waitForTimeout(1000);
  expect(errors.map(String)).toEqual([]);
  await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  await expect(stoppedHeading(page)).toBeFocused();
});

test("the Quit Vial button fits the top bar from 375 px to 1080p, in both themes", async ({ app: page }) => {
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

test("recording a macro stops when Quit Vial asks first: Esc closes the question, and isn't recorded", async ({
  app: page,
}) => {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Macros/ }).click();
  const card = page.locator("#macro-0");
  await card.getByRole("button", { name: "Edit" }).click();
  const steps = await card.locator(".steps > li").count();
  await card.getByRole("button", { name: "Record, adding to the end" }).click();
  await expect(card.getByRole("button", { name: "Stop recording" })).toBeFocused();
  await page.keyboard.type("a");
  await expect(card.locator(".so-far")).toHaveText("“a”");

  // the macro being edited is work not saved: Quit Vial asks first, and its keys work
  await quitButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Quit Vial?" });
  await expect(dialog).toContainText("the macro being edited");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(quitButton(page)).toBeFocused();
  expect((await api(page).get("/api/session")).ok()).toBe(true);

  // the recording stopped as the question opened: only the key typed before it is a step
  await expect(card).toContainText(
    "Recording stopped for the dialog that opened, whose keys must work. 1 step recorded.");
  await expect(card.getByRole("button", { name: "Record, adding to the end" })).toBeVisible();
  await expect(card.locator(".steps > li")).toHaveCount(steps + 1);
  await expect(card.getByLabel(`Step ${steps + 1}: the text to type`)).toHaveValue("a");
  // nothing saved: the worker's keyboard keeps its macros
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("a tab showing the unlock dialog when Vial stops shows that Vial has stopped, with no dialog left", async ({
  page,
  context,
  ownServer,
}) => {
  await open(page, ownServer.url);
  const other = await open(await context.newPage(), ownServer.url);
  // an unlock started in the other tab: its dialog shows in every tab, over the Quit Vial button, so this tab quits
  // as the button does
  await openUnlockDialog(other);
  await expect(page.getByRole("dialog", { name: "Unlock the keyboard" })).toBeVisible();
  expect((await api(page).post("/api/shutdown")).status()).toBe(204);

  for (const tab of [other, page]) {
    await expect(stoppedHeading(tab)).toBeFocused();
    await expect(tab.getByRole("dialog")).toHaveCount(0);
    expect(await tab.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(0);
  }
  expect(await exitCode(ownServer), ownServer.output()).toBe(0);
});
