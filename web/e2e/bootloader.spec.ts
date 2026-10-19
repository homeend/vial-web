import type { Page } from "@playwright/test";
import { api, expect, openSection, plugIn, restoreAll, screenshots, simulatorUnlock, test, unlockAgain, unlockState } from "./fixtures";

// Reboot to bootloader on the simulated Corne, which drops off the bus when it jumps. The test plugs it back in.

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

async function sessionStatus(page: Page): Promise<string> {
  return (await (await api(page).get("/api/session")).json()).status;
}

/** The reboots the page asks the server for (page.request's own requests aren't counted) */
function countReboots(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/bootloader") posts.push(request.url());
  });
  return posts;
}

/** Puts the keyboard back: plugged in, connected, its unlock keys let go and unlocked. The page is loaded again first,
 * so that a reboot it still waits to send (on an unlock, say) is forgotten rather than sent during the clean-up. */
async function putBack(page: Page): Promise<void> {
  await restoreAll(() => page.reload(), () => plugIn(page, true), () => simulatorUnlock(page, { keysHeld: false }),
    async () => {
      await expect.poll(() => sessionStatus(page), { timeout: 10_000 }).toBe("connected");
    }, () => unlockAgain(page));
}

test("the keyboard is unlocked, restarts into its bootloader and is shown gone until it comes back", async ({ app }) => {
  const posts = countReboots(app);
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
    // cancelled: nothing was sent, and the keyboard wasn't unlocked
    expect(posts).toHaveLength(0);
    expect(await unlockState(app)).toBe("locked");

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
    expect(await sessionStatus(app)).toBe("disconnected");
    await screenshots(app, "bootloader-gone-1280x800");

    // plugged back in: it is read again, and works
    await simulatorUnlock(app, { keysHeld: false });
    await plugIn(app, true);
    await expect(banner).toBeHidden({ timeout: 10_000 });
    await expect(app.locator(".page.blocked")).toHaveCount(0);
    await expect.poll(() => sessionStatus(app), { timeout: 10_000 }).toBe("connected");
    await expect(reboot).toBeEnabled();
    await openSection(app, "Keymap");
    await expect(app.locator("button.key").first()).toBeVisible();
    // sent exactly once: refused as locked (423), then sent again once unlocked, which jumped
    expect(posts).toHaveLength(2);
  } finally {
    await putBack(app);
  }
});

test("Esc in the confirmation sends nothing, and gives the focus back", async ({ app }) => {
  const posts = countReboots(app);
  try {
    await unlockAgain(app);
    await openSection(app, "Keyboard");
    const reboot = app.getByRole("button", { name: "Reboot to bootloader…" });
    await reboot.click();
    const confirm = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(reboot).toBeFocused();
    expect(posts).toHaveLength(0);
    expect(await sessionStatus(app)).toBe("connected");
  } finally {
    await putBack(app);
  }
});

test("a locked keyboard whose unlock is cancelled stays, and says why", async ({ app }) => {
  const posts = countReboots(app);
  try {
    await simulatorUnlock(app, { locked: true });
    await openSection(app, "Keyboard");
    const reboot = app.getByRole("button", { name: "Reboot to bootloader…" });
    await reboot.click();
    const confirm = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await confirm.getByRole("button", { name: "Reboot" }).click();
    const unlock = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(unlock).toBeVisible();
    await unlock.getByRole("button", { name: "Cancel" }).click();
    await expect(toasts(app))
      .toContainText("Restarting the keyboard into its bootloader failed: The keyboard is locked, and it wasn't unlocked.");
    // refused once (423), and not sent again
    expect(posts).toHaveLength(1);
    expect(await sessionStatus(app)).toBe("connected");
    await expect(app.locator("#bootloader-banner")).toHaveCount(0);
    await expect(app.locator(".page.blocked")).toHaveCount(0);
    // the confirmation stays, to be cancelled or tried again
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(reboot).toBeFocused();
    expect(posts).toHaveLength(1);
  } finally {
    await putBack(app);
  }
});

test("firmware built without the bootloader jump says so, and the keyboard stays", async ({ app }) => {
  const route = "**/api/bootloader";
  const detail = "this keyboard's firmware can't restart into its bootloader from Vial (it is built without that)";
  const posts = countReboots(app);
  try {
    await unlockAgain(app);
    await openSection(app, "Keyboard");
    // the server's answer for such firmware (test_matrix.py), without a keyboard built so
    await app.route(route, (r) => r.fulfill({ status: 422, contentType: "application/json",
      body: JSON.stringify({ detail }) }));
    const reboot = app.getByRole("button", { name: "Reboot to bootloader…" });
    await reboot.click();
    const confirm = app.getByRole("dialog", { name: "Restart the keyboard into its bootloader?" });
    await confirm.getByRole("button", { name: "Reboot" }).click();
    await expect(toasts(app)).toContainText(`Restarting the keyboard into its bootloader failed: ${detail}`);
    expect(posts).toHaveLength(1);
    await expect(app.locator("#bootloader-banner")).toHaveCount(0);
    await expect(app.locator(".page.blocked")).toHaveCount(0);
    expect(await sessionStatus(app)).toBe("connected");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(reboot).toBeFocused();
  } finally {
    await restoreAll(() => app.unroute(route), () => putBack(app));
  }
});
