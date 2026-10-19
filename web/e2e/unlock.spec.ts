import { expect, openUnlockDialog, simulatorUnlock, test, unlockAgain, unlockState } from "./fixtures";

// The unlock dialog, as the owner uses it on the real keyboard: its unlock keys are held for a while (the fake server
// keeps the firmware's timing, with a short countdown: see servers.ts), on the keyboard that types into this page. A
// worker's server is shared by its tests: each one leaves the simulated keyboard unlocked, as the server started.

test("the unlock dialog takes no key presses, and keys still held once it closes press nothing", async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize({ width: 1920, height: 950 });
  try {
    const dialog = await openUnlockDialog(app);
    await expect(dialog.locator(".where"))
      .toHaveText("The keys at row 0, column 0 and row 4, column 0 of the keyboard's matrix.");
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(950);

    // the unlock keys may be any keys: none of them closes the dialog or presses Cancel
    await app.keyboard.press("Escape");
    await app.keyboard.press("Escape");
    await app.keyboard.press("Enter");
    await app.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    expect(await unlockState(app)).toBe("unlocking");
    const status = dialog.locator("[aria-live]");
    await expect(status).toHaveText("Not held yet");

    // the keys held type into the page too (the Corne's are Tab and Backspace; Enter here), until it is unlocked
    await app.keyboard.down("Tab");
    await app.keyboard.down("Enter");
    await simulatorUnlock(app, { keysHeld: true });
    const bar = dialog.getByRole("progressbar");
    await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    // the phase is announced, not every step of the bar
    await expect(status).toHaveText("Keep holding…");
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const lock = app.getByRole("button", { name: "Keyboard unlocked: lock it" });
    await expect(lock).toBeVisible();

    // still held once it closed, they repeat: Tab moves the focus nowhere...
    const focused = () => app.evaluate(() => document.activeElement?.outerHTML.slice(0, 60) ?? null);
    const before = await focused();
    await app.keyboard.down("Tab");
    await app.keyboard.down("Tab");
    expect(await focused()).toBe(before);
    // ...and Enter, on a button that would lock the keyboard again, presses nothing, nor does letting go of it
    await lock.focus();
    await app.keyboard.down("Enter");
    await app.keyboard.down("Enter");
    await app.keyboard.up("Enter");
    await app.keyboard.up("Tab");
    await app.waitForTimeout(500);
    expect(await unlockState(app)).toBe("unlocked");
    await expect(lock).toBeVisible();

    // keys pressed once they were let go work again
    await app.keyboard.press("Enter");
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
  } finally {
    await app.keyboard.up("Enter");
    await app.keyboard.up("Tab");
    await unlockAgain(app);
  }
});

test("the unlock dialog says when cancelling fails, and can be closed then", async ({ app }) => {
  test.setTimeout(60_000);
  try {
    const dialog = await openUnlockDialog(app);
    // closed by the browser rather than by the page, it shows again while the keyboard waits
    await dialog.evaluate((d: HTMLDialogElement) => d.close());
    await expect(dialog).toBeVisible();
    await app.keyboard.press("Enter");
    expect(await unlockState(app)).toBe("unlocking");
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
    await app.route("**/api/unlock/cancel", (route) => route.fulfill({ status: 502, body: "" }));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/^Cancelling the unlock failed: /);
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    // the keyboard still waits for its keys, and the server's updates don't bring the dialog back
    await app.waitForTimeout(1000);
    await expect(dialog).toBeHidden();
    expect(await unlockState(app)).toBe("unlocking");

    // asked again, it shows
    await app.getByRole("button", { name: "Keyboard locked: unlock it" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.unroute("**/api/unlock/cancel");
    await unlockAgain(app);
  }
});
