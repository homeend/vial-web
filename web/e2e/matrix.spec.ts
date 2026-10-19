import type { Page } from "@playwright/test";
import { expect, keyIndex, openSection, pressKey, restoreAll, simulatorUnlock, test, unlockAgain, unlockState } from "./fixtures";

// The matrix tester on the simulated Corne: keys are pressed through the fake server's hook. Its unlock keys are Tab
// (row 0, column 0) and Backspace (row 4, column 0); row 3, column 0 has no key in its layout.

/** The key of the drawing at a matrix position (the drawing's keys are in the model's order: placement follows it) */
async function drawnKey(page: Page, row: number, col: number) {
  return page.locator(".board .key").nth(await keyIndex(page, row, col));
}

function cell(page: Page, row: number, col: number) {
  return page.locator("table tbody tr").nth(row).locator("td").nth(col).locator(".cell");
}

test("a locked keyboard is unlocked, then a key lights up while held and stays marked", async ({ app }) => {
  try {
    await simulatorUnlock(app, { locked: true });
    await openSection(app, "Matrix tester");
    const start = app.getByRole("button", { name: "Start testing" });
    await start.click();
    // the firmware hides the matrix until it is unlocked: the unlock runs first
    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(await unlockState(app)).toBe("unlocked");
    await simulatorUnlock(app, { keysHeld: false });
    await expect(app.locator(".board .key.pressed")).toHaveCount(0);

    const w = await drawnKey(app, 0, 1);
    await pressKey(app, 0, 1);
    await expect(w).toHaveClass(/pressed/);
    await expect(cell(app, 0, 1)).toHaveClass(/held/);
    await expect(app.getByRole("status").filter({ hasText: "Testing: 1 held now." })).toBeVisible();
    await pressKey(app, 0, 1, false);
    await expect(w).not.toHaveClass(/pressed/);
    await expect(w).toHaveClass(/ringed/);
    await expect(cell(app, 0, 1)).toHaveClass(/tested/);

    // a position with no key in the layout shows in the matrix
    await pressKey(app, 3, 0);
    await expect(cell(app, 3, 0)).toHaveClass(/held/);
    await expect(cell(app, 3, 0)).toHaveClass(/nokey/);
    await pressKey(app, 3, 0, false);
    await expect(app.getByText("Pressed without a key in the layout: row 3, column 0.")).toBeVisible();

    // Reset forgets what was pressed
    await app.getByRole("button", { name: "Reset" }).click();
    await expect(w).not.toHaveClass(/ringed/);
    await expect(cell(app, 0, 1)).toHaveClass(/untested/);
    await expect(app.getByText("0 of 42 keys pressed so far.")).toBeVisible();
  } finally {
    await restoreAll(() => pressKey(app, 0, 1, false), () => pressKey(app, 3, 0, false), () => unlockAgain(app));
  }
});

test("while testing, keys typed do nothing on the page; stopped, they work again", async ({ app }) => {
  await openSection(app, "Matrix tester");
  const button = app.getByRole("button", { name: "Start testing" });
  await button.focus();
  await app.keyboard.press("Enter");
  const stop = app.getByRole("button", { name: "Stop testing" });
  await expect(stop).toBeFocused();
  await expect(app.locator(".board.testing")).toBeVisible();
  // Tab doesn't move the focus, Enter doesn't press the button
  await app.keyboard.press("Tab");
  await app.keyboard.press("Enter");
  await expect(stop).toBeFocused();
  await expect(app.locator(".board.testing")).toBeVisible();
  await stop.click();
  await expect(button).toBeFocused();
  await app.keyboard.press("Tab");
  await expect(button).not.toBeFocused();
});

test("leaving the page stops the test", async ({ app }) => {
  await openSection(app, "Matrix tester");
  await app.getByRole("button", { name: "Start testing" }).click();
  await expect(app.getByRole("button", { name: "Stop testing" })).toBeVisible();
  await openSection(app, "Keymap");
  // keys work on the Keymap again: an arrow moves the selection
  const first = app.locator("button.key").first();
  await first.click();
  await app.keyboard.press("ArrowRight");
  await expect(first).not.toBeFocused();
  await openSection(app, "Matrix tester");
  await expect(app.getByRole("button", { name: "Start testing" })).toBeVisible();
});
