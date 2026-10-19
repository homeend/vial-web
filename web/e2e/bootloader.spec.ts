import { api, expect, openSection, plugIn, restoreAll, screenshots, simulatorUnlock, test, unlockAgain } from "./fixtures";

// Reboot to bootloader on the simulated Corne, which drops off the bus when it jumps. The test plugs it back in.

test("the keyboard is unlocked, restarts into its bootloader and is shown gone until it comes back", async ({ app }) => {
  try {
    await simulatorUnlock(app, { locked: true });
    await openSection(app, "Keyboard");
    const reboot = app.getByRole("button", { name: "Reboot to bootloader…" });
    await reboot.click();
    const confirm = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await expect(confirm).toContainText("disappears from Vial until it is flashed, or unplugged and plugged back in");
    // the safe choice has the focus
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(reboot).toBeFocused();

    await reboot.click();
    await confirm.getByRole("button", { name: "Reboot" }).click();
    // locked: the unlock runs first, then the change is sent again
    const unlock = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(unlock).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    const banner = app.locator("#bootloader-banner");
    await expect(banner).toContainText("The keyboard is in its bootloader", { timeout: 20_000 });
    await expect(confirm).toBeHidden();
    await expect(banner).toBeFocused();
    await expect(app.locator(".page.blocked")).toBeVisible();
    const session = await (await api(app).get("/api/session")).json();
    expect(session.status).toBe("disconnected");
    await screenshots(app, "bootloader-gone-1280x800");

    // plugged back in: it is read again, and works
    await simulatorUnlock(app, { keysHeld: false });
    await plugIn(app, true);
    await expect(banner).toBeHidden({ timeout: 10_000 });
    await expect(app.locator(".page.blocked")).toHaveCount(0);
  } finally {
    await restoreAll(() => plugIn(app, true), () => simulatorUnlock(app, { keysHeld: false }), async () => {
      await expect.poll(async () => (await (await api(app).get("/api/session")).json()).status, { timeout: 10_000 })
        .toBe("connected");
    }, () => unlockAgain(app));
  }
});
