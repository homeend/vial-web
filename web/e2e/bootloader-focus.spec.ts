import { api, expect, openSection, restoreAll, test, unlockAgain } from "./fixtures";

// After a reboot to bootloader the banner that says so has the focus. When the keyboard comes back, the banner goes,
// and the focus goes to the page's heading rather than falling to the page's body.

test("the focus goes to the page heading when the bootloader banner goes", async ({ app }) => {
  const plug = (connected: boolean) => api(app).put("/api/simulator/connection", { connected });
  try {
    await unlockAgain(app);
    await openSection(app, "Keyboard");
    await app.getByRole("button", { name: "Reboot to bootloader…" }).click();
    await app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" })
      .getByRole("button", { name: "Reboot" }).click();
    const banner = app.locator("#bootloader-banner");
    await expect(banner).toBeFocused({ timeout: 20_000 });

    // plugged back in: the banner goes, and the focus with it to the heading
    expect((await plug(true)).ok()).toBe(true);
    await expect(banner).toBeHidden({ timeout: 10_000 });
    await expect(app.locator(".page.blocked")).toHaveCount(0);
    await expect(app.getByRole("heading", { level: 1, name: "Keyboard" })).toBeFocused();
    expect(await app.evaluate(() => document.activeElement === document.body)).toBe(false);
  } finally {
    await restoreAll(() => plug(true), async () => {
      await expect.poll(async () => (await (await api(app).get("/api/session")).json()).status, { timeout: 10_000 })
        .toBe("connected");
    }, () => unlockAgain(app));
  }
});
