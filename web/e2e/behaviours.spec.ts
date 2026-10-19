import type { Page } from "@playwright/test";
import { expect, keyIndex, setTapDance, simulatorUnlock, tapDanceAt, test, unlockState } from "./fixtures";

// The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

async function openSection(page: Page, name: "Tap dance" | "Combos" | "Macros") {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);

/** The picker's any-keycode box: type a keycode and use it */
async function pickAnyKeycode(page: Page, code: string) {
  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Any keycode").fill(code);
  await expect(picker.locator("#any-keycode-result")).toContainText(code);
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
}

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

test.describe("tap dance", () => {
  test("a slot is changed with the picker, and \"used on\" goes to the key", async ({ app }) => {
    const before = await tapDanceAt(app, 0);
    try {
      await openSection(app, "Tap dance");
      const card = tapDanceCard(app, 0);
      await expect(card).toContainText("Tap for Tab, double-tap for Caps Lock.");
      await card.getByRole("button", { name: /^Hold: nothing/ }).click();
      await pickAnyKeycode(app, "KC_LSHIFT");
      await expect(card).toContainText("Tap for Tab, hold for LShift, double-tap for Caps Lock.");
      expect((await tapDanceAt(app, 0)).hold).toBe("KC_LSHIFT");

      // TD 1 isn't on any key
      await expect(tapDanceCard(app, 1)).toContainText("Nothing uses it yet: put TD(1) on a key");

      await card.getByRole("button", { name: "Base, left inner thumb" }).click();
      await expect(app).toHaveURL(/#keymap$/);
      const key = app.locator(`[data-ref="key:${await keyIndex(app, 3, 5)}"]`);
      await expect(key).toHaveAttribute("aria-pressed", "true");
      await expect(key).toBeFocused();
      await expect(app.getByRole("complementary", { name: "Selected key" })).toContainText("Tap dance 0");
    } finally {
      await setTapDance(app, 0, before);
    }
  });

  test("the tapping term, and a long name cut short with a tooltip", async ({ app }) => {
    const before = await tapDanceAt(app, 1);
    const long = "Escape on a tap, Control held, save twice";
    try {
      await openSection(app, "Tap dance");
      const card = tapDanceCard(app, 1);
      const term = card.getByRole("spinbutton");
      await term.fill("250");
      await term.press("Enter");
      await expect.poll(async () => (await tapDanceAt(app, 1)).tappingTerm).toBe(250);

      await card.getByRole("button", { name: "Rename tap dance 1" }).click();
      const dialog = app.getByRole("dialog", { name: "Rename tap dance 1" });
      await dialog.getByLabel("Name of tap dance 1").fill(long);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      const name = card.locator(".name");
      await expect(name).toHaveAttribute("title", long.slice(0, 40));
      await expect(card.getByRole("button", { name: "Rename tap dance 1" })).toBeFocused();
    } finally {
      await setTapDance(app, 1, before);
      await app.request.put(new URL("/api/names/tapDance/1", app.url()).toString(), { data: { name: null } });
    }
  });

  test("turning a key into a tap dance opens its card", async ({ app }) => {
    const index = await keyIndex(app, 0, 2); // base layer: L
    const before = await tapDanceAt(app, 2);
    try {
      await app.locator(`[data-ref="key:${index}"]`).click();
      await app.getByRole("button", { name: "Turn into tap dance" }).click();
      await expect(app).toHaveURL(/#tap-dance\/2$/);
      const card = tapDanceCard(app, 2);
      await expect(card).toHaveClass(/\btarget\b/);
      await expect(card).toContainText("Tap for L.");
      await expect(card.getByRole("heading", { level: 2 })).toBeFocused();
    } finally {
      await app.request.put(new URL("/api/keymap/0/0/2", app.url()).toString(), { data: { code: "KC_L" } });
      await setTapDance(app, 2, before);
    }
  });
});

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
