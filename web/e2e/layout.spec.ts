import type { Page } from "@playwright/test";
import { api, expect, openSection, restoreAll, test } from "./fixtures";

// The Layout page on the simulated macropad, whose 2u key splits in two (its layout option "Split Backspace").

async function layoutOptions(page: Page): Promise<number> {
  return (await (await api(page).get("/api/keyboard")).json()).layoutOptions.value;
}

async function setLayoutOptions(page: Page, value: number): Promise<void> {
  const response = await api(page).put("/api/layout-options", { value });
  if (!response.ok()) throw new Error(`setting the layout options failed: ${response.status()}`);
}

test("a layout option changed is saved at once, and every drawing of the keyboard follows", async ({ macropad }) => {
  const before = await layoutOptions(macropad);
  expect(before).toBe(0);
  try {
    // the Keymap draws 13 keys (and 4 encoder directions): the 2u key, not the two 1u ones
    await expect(macropad.locator("button.key")).toHaveCount(13);
    await openSection(macropad, "Layout");
    await expect(macropad.getByText("Each change is saved to the keyboard at once")).toBeVisible();
    const board = macropad.locator(".board");
    await expect(board.locator(".key")).toHaveCount(13);
    await expect(board).toContainText("13 keys");
    const split = macropad.getByRole("switch", { name: "Split Backspace" });
    await expect(split).not.toBeChecked();
    await split.check();
    await expect.poll(() => layoutOptions(macropad)).toBe(1);
    await expect(split).toBeChecked();
    await expect(split).toBeFocused();
    await expect(board.locator(".key")).toHaveCount(14);
    await expect(board).toContainText("14 keys");
    await openSection(macropad, "Keymap");
    await expect(macropad.locator("button.key")).toHaveCount(14);
    // read again from the keyboard: kept
    await macropad.reload();
    await expect(macropad.locator("button.key")).toHaveCount(14);
    await openSection(macropad, "Layout");
    await expect(macropad.getByRole("switch", { name: "Split Backspace" })).toBeChecked();
    await macropad.getByRole("switch", { name: "Split Backspace" }).uncheck();
    await expect.poll(() => layoutOptions(macropad)).toBe(0);
    await expect(board.locator(".key")).toHaveCount(13);
  } finally {
    await restoreAll(() => setLayoutOptions(macropad, before));
  }
});

test("a layout option the keyboard didn't take puts the switch back, keeping the focus", async ({ macropad }) => {
  const route = "**/api/layout-options";
  try {
    await openSection(macropad, "Layout");
    const board = macropad.locator(".board");
    await expect(board.locator(".key")).toHaveCount(13);
    const split = macropad.getByRole("switch", { name: "Split Backspace" });
    await expect(split).not.toBeChecked();
    // the keyboard doesn't answer the write (page.request isn't routed: the tests' own reads go through)
    await macropad.route(route, (r) => r.request().method() === "PUT"
      ? r.fulfill({ status: 502, contentType: "application/json",
        body: JSON.stringify({ detail: "the keyboard didn't respond: timeout" }) })
      : r.fallback());
    // click, not check(): check() would click again when the switch goes back
    await split.click();
    await expect(macropad.getByRole("region", { name: "Notifications" }))
      .toContainText("Changing “Split Backspace” failed: The keyboard didn't respond.");
    await expect(split).not.toBeChecked();
    await expect(split).toBeFocused();
    await expect(board.locator(".key")).toHaveCount(13);
    expect(await layoutOptions(macropad)).toBe(0);

    // the keyboard answers again: the same click works
    await macropad.unroute(route);
    await split.click();
    await expect.poll(() => layoutOptions(macropad)).toBe(1);
    await expect(split).toBeChecked();
    await expect(board.locator(".key")).toHaveCount(14);
  } finally {
    await restoreAll(() => macropad.unroute(route), () => setLayoutOptions(macropad, 0));
  }
});

test("a keyboard without layout options has no Layout page", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button", { name: /^Keyboard/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Layout/ })).toHaveCount(0);
});
