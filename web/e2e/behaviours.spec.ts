import type { Page } from "@playwright/test";
import { expect, simulatorUnlock, test, unlockState } from "./fixtures";

// The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

/** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't, as the server started */
async function unlockAgain(page: Page) {
  await simulatorUnlock(page, { keysHeld: false });
  if ((await unlockState(page)) === "unlocked") return;
  // the simulator counts down while the keys are held
  await simulatorUnlock(page, { keysHeld: true });
  await page.request.post(new URL("/api/unlock/start", page.url()).toString());
  await expect.poll(() => unlockState(page), { timeout: 20_000 }).toBe("unlocked");
  await simulatorUnlock(page, { keysHeld: false });
}

test("the top bar locks and unlocks the keyboard; a cancelled unlock can be taken up again", async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await app.getByRole("button", { name: "Keyboard unlocked: lock it" }).click();
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
    expect(await unlockState(app)).toBe("locked");

    await app.getByRole("button", { name: "Keyboard locked: unlock it" }).click();
    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    // the keyboard still waits for its keys, and says so
    const banner = app.getByRole("status").filter({ hasText: "The keyboard still waits to be unlocked" });
    await expect(banner).toBeVisible();
    expect(await unlockState(app)).toBe("cancelled");

    await banner.getByRole("button", { name: "Unlock" }).click();
    await expect(dialog).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(app.getByRole("button", { name: "Keyboard unlocked: lock it" })).toBeVisible();
    await expect(banner).toBeHidden();
  } finally {
    await unlockAgain(app);
  }
});
