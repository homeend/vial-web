import type { Locator, Page } from "@playwright/test";
import {
  comboAt, expect, keyIndex, macrosOf, screenshots, setCombo, setMacros, setTapDance, simulatorUnlock, tapDanceAt, test,
  unlockState,
} from "./fixtures";

// The server is shared by every test: a test that changes a tap dance, a combo or a macro puts it back in its `finally`

const EMPTY_COMBO = { keys: ["KC_NO", "KC_NO", "KC_NO", "KC_NO"], output: "KC_NO" };

async function openSection(page: Page, name: "Tap dance" | "Combos" | "Macros") {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);
const comboCard = (page: Page, index: number) => page.locator(`#combo-${index}`);
const macroCard = (page: Page, index: number) => page.locator(`#macro-${index}`);

/** The picker's any-keycode box: type a keycode and use it */
async function pickAnyKeycode(page: Page, code: string) {
  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Any keycode").fill(code);
  await expect(picker.locator("#any-keycode-result")).toContainText(code);
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
}

/** A full-page screenshot from the top: the sticky top bar is drawn where the page was scrolled to */
async function pageShots(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshots(page, name, { fullPage: true });
}

/** The element ends inside the window: nothing to scroll to */
async function expectInWindow(page: Page, element: Locator) {
  const box = (await element.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
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

/** The computed fill of an SVG shape */
const fillOf = (shape: Locator) => shape.evaluate((e) => getComputedStyle(e).fill);
/** A combo colour as the page computes it */
const comboColour = (page: Page, colour: number) => page.evaluate((c) => {
  const probe = document.createElement("i");
  probe.style.color = `var(--combo-${c})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}, colour);

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

test.describe("combos", () => {
  test("a combo made by clicking its keys is marked on them", async ({ app }) => {
    try {
      await openSection(app, "Combos");
      await app.getByRole("button", { name: "New combo" }).click();
      await expect(app).toHaveURL(/#combos\/2$/);
      const card = comboCard(app, 2);
      const l = card.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
      const r = card.locator(`[data-ref="key:${await keyIndex(app, 0, 3)}"]`);
      await l.click();
      await r.click();
      await expect(l).toHaveAttribute("aria-pressed", "true");
      await expect(r).toHaveAccessibleName(/· in the combo$/);
      await expect(card).toContainText("Press L + R together: it does nothing yet.");
      // clicking a chosen key takes it out; the arrow keys move between keys
      await r.click();
      await expect(r).toHaveAttribute("aria-pressed", "false");
      await r.press("Enter");
      await expect(r).toHaveAttribute("aria-pressed", "true");
      await pageShots(app, "combo-editor");
      await card.getByRole("button", { name: "Change output…" }).click();
      await pickAnyKeycode(app, "KC_TAB");
      await card.getByRole("button", { name: "Save" }).click();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      expect(await comboAt(app, 2)).toEqual({ keys: ["KC_L", "KC_R", "KC_NO", "KC_NO"], output: "KC_TAB" });
      await expect(card).toContainText("Press L + R together for Tab.");
      await expect(card.locator(".key.ringed")).toHaveCount(2);

      // the keymap marks them in the combo's colour: the third combo on the base layer, the third colour
      await app.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Keymap/ }).click();
      const key = app.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
      await expect(key).toHaveAccessibleName(/· in combo 2$/);
      expect(await fillOf(key.locator(".combo-mark"))).toBe(await comboColour(app, 2));
    } finally {
      await setCombo(app, 2, EMPTY_COMBO);
    }
  });

  test("a combo's card opens from the Inspector", async ({ app }) => {
    await app.locator(`[data-ref="key:${await keyIndex(app, 6, 2)}"]`).click(); // K
    await app.getByRole("region", { name: "Combos with this key" }).getByRole("button", { name: /with Y → Esc/ }).click();
    await expect(app).toHaveURL(/#combos\/0$/);
    await expect(comboCard(app, 0)).toHaveClass(/\btarget\b/);
    await expect(comboCard(app, 0).getByRole("heading", { level: 2 })).toBeFocused();
    await expect(comboCard(app, 0)).toContainText("Press K + Y together for Esc.");
    // the reload keeps the page
    await app.reload();
    await expect(app.getByRole("heading", { level: 1, name: "Combos" })).toBeVisible();
  });

  test("a combo of two layer keys says which layer it reaches", async ({ app }) => {
    const before = await comboAt(app, 2);
    try {
      await setCombo(app, 2, { keys: ["LT1(KC_SPC)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
      await app.reload();
      await openSection(app, "Combos");
      await expect(comboCard(app, 2)).toContainText(
        "Press Space (hold: Layer 1) + OSL(3) together → reaches Layer 2, while held.");
    } finally {
      await setCombo(app, 2, before);
    }
  });

  test("two combos sharing a key: dots in both colours on it, an underline in its own on each other key", async ({ app }) => {
    const before = await comboAt(app, 2);
    try {
      await setCombo(app, 2, { keys: ["KC_K", "KC_L", "KC_NO", "KC_NO"], output: "KC_X" });
      await app.reload();
      await expect(app.locator("button.key").first()).toBeVisible();
      const k = app.locator(`[data-ref="key:${await keyIndex(app, 6, 2)}"]`);
      const y = app.locator(`[data-ref="key:${await keyIndex(app, 6, 1)}"]`);
      const l = app.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
      await expect(k).toHaveAccessibleName(/· in combos 0 and 2$/);
      const dots = k.locator(".combo-dot");
      await expect(dots).toHaveCount(2);
      const [first, second] = [await fillOf(dots.nth(0)), await fillOf(dots.nth(1))];
      expect(first).not.toBe(second);
      expect(first).toBe(await comboColour(app, 0));
      expect(second).toBe(await comboColour(app, 2));
      await expect(k.locator(".combo-mark")).toHaveCount(0);
      expect(await fillOf(y.locator(".combo-mark"))).toBe(first);
      expect(await fillOf(l.locator(".combo-mark"))).toBe(second);
      await screenshots(app, "combo-dots");
    } finally {
      await setCombo(app, 2, before);
    }
  });
});

test.describe("macros", () => {
  test("a macro is built from every kind of step, and from keys recorded in the browser", async ({ app }) => {
    const before = await macrosOf(app);
    try {
      await openSection(app, "Macros");
      await expect(app.locator(".memory")).toContainText(/Uses \d+ of 900 bytes/);
      await app.getByRole("button", { name: "New macro" }).click();
      await expect(app).toHaveURL(/#macros\/2$/);
      const card = macroCard(app, 2);
      const add = card.getByRole("group", { name: "Add a step" });

      await add.getByRole("button", { name: "Type text" }).click();
      await card.getByLabel("Step 1: the text to type").fill("ls -la");
      await add.getByRole("button", { name: "Tap a key" }).click();
      await pickAnyKeycode(app, "KC_ENTER");
      await add.getByRole("button", { name: "Press a key" }).click();
      await pickAnyKeycode(app, "KC_LCTRL");
      await add.getByRole("button", { name: "Wait" }).click();
      await card.getByLabel("Step 4: how long to wait, in ms").fill("30");
      await add.getByRole("button", { name: "Release a key" }).click();
      await pickAnyKeycode(app, "KC_LCTRL");
      // moved: release before the wait
      await card.getByRole("button", { name: "Move step 5 up" }).click();

      await add.getByRole("button", { name: "Record from keyboard" }).click();
      await expect(card.getByRole("status")).toContainText("Recording");
      await app.keyboard.type("cd");
      await app.keyboard.press("Control+L");
      await app.keyboard.press("Escape");
      await expect(card).toContainText("2 steps recorded.");
      await pageShots(app, "macro-editor");

      await card.getByRole("button", { name: "Save" }).click();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      const saved = (await macrosOf(app))[2];
      expect(saved).toEqual([
        { type: "text", text: "ls -la", keys: [], delay: null },
        { type: "tap", text: null, keys: ["KC_ENTER"], delay: null },
        { type: "down", text: null, keys: ["KC_LCTRL"], delay: null },
        { type: "up", text: null, keys: ["KC_LCTRL"], delay: null },
        { type: "delay", text: null, keys: [], delay: 30 },
        { type: "text", text: "cd", keys: [], delay: null },
        { type: "tap", text: null, keys: ["LCTL(KC_L)"], delay: null },
      ]);
      await expect(card.locator(".chain")).toContainText("type “ls -la”tap Enterpress LCtrlrelease LCtrlwait 30 ms");
      // the memory the page counts is the keyboard's
      const used = await app.locator(".memory .count").textContent();
      const model = await (await app.request.get(new URL("/api/keyboard", app.url()).toString())).json();
      expect(used).toContain(`Uses ${model.macros.used} of 900 bytes`);
    } finally {
      await setMacros(app, before);
    }
  });

  test("a macro changed on a locked keyboard is saved once the keyboard is unlocked", async ({ app }) => {
    test.setTimeout(60_000);
    const before = await macrosOf(app);
    try {
      await app.setViewportSize({ width: 1920, height: 950 }); // a 1080p screen, less the browser's own bars
      await simulatorUnlock(app, { locked: true });
      await app.reload();
      await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
      await openSection(app, "Macros");
      const card = macroCard(app, 0);
      await card.getByRole("button", { name: "Edit" }).click();
      await card.getByLabel("Step 1: the text to type").fill("git log");
      await card.getByRole("button", { name: "Save" }).click();

      const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Press and hold the 2 highlighted keys");
      await expect(dialog.locator(".key.found")).toHaveCount(2);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await expectInWindow(app, dialog);
      // the unlock keys type into the page too: no key press cancels or closes it
      for (const key of ["Enter", "Space", "Escape", "Tab"]) await app.keyboard.press(key);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await screenshots(app, "unlock-dialog");
      await simulatorUnlock(app, { keysHeld: true });
      await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /keep holding/, { timeout: 5000 });
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      expect((await macrosOf(app))[0][0]).toEqual({ type: "text", text: "git log", keys: [], delay: null });
      await expect(app.getByRole("button", { name: "Keyboard unlocked: lock it" })).toBeVisible();
    } finally {
      await unlockAgain(app);
      await setMacros(app, before);
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
