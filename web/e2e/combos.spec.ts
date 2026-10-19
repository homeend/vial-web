import type { Locator, Page } from "@playwright/test";
import { comboAt, expect, keyIndex, setCombo, test } from "./fixtures";

// Editing a combo: a combo listing a keycode twice, where the focus goes, and the key chooser's cursor. A worker's
// server is shared by the tests it runs: each test puts back the combo it changed, in its `finally` (setCombo throws
// when the server refuses it).

async function openCombos(page: Page) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Combos/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Combos" })).toBeVisible();
}

const comboCard = (page: Page, index: number) => page.locator(`#combo-${index}`);
const chooser = (page: Page, index: number) => page.getByRole("group", { name: `Keys of combo ${index}` });
/** The element with the focus is inside the locator's */
const focusedInside = (page: Page, selector: string) =>
  page.evaluate((s) => !!document.activeElement?.closest(s) && document.activeElement !== document.body, selector);

/** The card's top border colour, once any highlight animation has ended */
const borderOf = (card: Locator) =>
  card.evaluate(async (e) => {
    await Promise.all(e.getAnimations().map((a) => a.finished.catch(() => {})));
    return getComputedStyle(e).borderTopColor;
  });

test("the combo being edited keeps its border in the combo's colour until the editing ends", async ({ app }) => {
  await openCombos(app);
  const card = comboCard(app, 0);
  const plain = await borderOf(card);
  await card.getByRole("button", { name: "Edit" }).click();
  await expect(card).toHaveClass(/\bediting\b/);
  expect(await borderOf(card)).not.toBe(plain);
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card).not.toHaveClass(/\bediting\b/);
  expect(await borderOf(card)).toBe(plain);
});

test("a combo listing a keycode twice can be edited, and saving it lists the keycode once", async ({ app }) => {
  const before = await comboAt(app, 2);
  try {
    await setCombo(app, 2, { keys: ["KC_L", "KC_L", "KC_NO", "KC_NO"], output: "KC_TAB" });
    await app.reload();
    await openCombos(app);
    const card = comboCard(app, 2);
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(chooser(app, 2)).toBeVisible();
    await expect(card.getByRole("button", { name: /^Take .* out of the combo$/ })).toHaveCount(1);
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(await comboAt(app, 2)).toEqual({ keys: ["KC_L", "KC_NO", "KC_NO", "KC_NO"], output: "KC_TAB" });
  } finally {
    await setCombo(app, 2, before);
  }
});

test.describe("editing a combo keeps the focus", () => {
  test("in the editor once it opens, and on the card once it is saved", async ({ app }) => {
    const before = await comboAt(app, 0);
    try {
      await openCombos(app);
      const card = comboCard(app, 0);
      await card.getByRole("button", { name: "Edit" }).click();
      await expect(chooser(app, 0)).toBeVisible();
      await expect.poll(() => focusedInside(app, "#combo-0 .editor")).toBe(true);

      await card.getByRole("button", { name: "Save" }).click();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect.poll(() => focusedInside(app, "#combo-0")).toBe(true);
    } finally {
      await setCombo(app, 0, before);
    }
  });

  test("on Save when saving fails, with the draft kept", async ({ app }) => {
    const before = await comboAt(app, 0);
    try {
      await openCombos(app);
      const card = comboCard(app, 0);
      await card.getByRole("button", { name: "Edit" }).click();
      const l = card.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
      await l.click();
      await expect(l).toHaveAttribute("aria-pressed", "true");

      await app.route("**/api/combos/0", (route) => route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "No." }) })
        : route.fallback());
      const save = card.getByRole("button", { name: "Save" });
      await save.click();
      await expect(app.getByRole("region", { name: "Notifications" })).toContainText("Saving the combo failed");
      await expect(save).toBeFocused();
      await expect(l).toHaveAttribute("aria-pressed", "true");
      expect(await comboAt(app, 0)).toEqual(before);

      // it works once the keyboard takes it
      await app.unroute("**/api/combos/0");
      await save.click();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      expect(await comboAt(app, 0)).toEqual({ keys: ["KC_K", "KC_Y", "KC_L", "KC_NO"], output: before.output });
      await expect.poll(() => focusedInside(app, "#combo-0")).toBe(true);
    } finally {
      await app.unrouteAll();
      await setCombo(app, 0, before);
    }
  });
});

test("the arrow keys move the chooser's cursor, and Tab comes back to it", async ({ app }) => {
  await openCombos(app);
  const card = comboCard(app, 0);
  await card.getByRole("button", { name: "Edit" }).click();
  const keys = chooser(app, 0);
  await expect(keys).toBeVisible();
  const first = keys.locator("[data-ref]").first();
  await expect(first).toBeFocused();
  await expect(first).toHaveClass(/\bselected\b/);

  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowRight");
  const cursor = keys.locator("[data-ref].selected");
  await expect(cursor).toHaveCount(1);
  const ref = await cursor.getAttribute("data-ref");
  expect(ref).not.toBe(await first.getAttribute("data-ref"));
  await expect(keys.locator(`[data-ref="${ref}"]`)).toBeFocused();
  // the cursor key is the only one Tab reaches
  await expect(keys.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(keys.locator('[tabindex="0"]')).toHaveAttribute("data-ref", ref!);

  // out of the chooser and back: the cursor key, still where the arrows left it
  await app.keyboard.press("Tab");
  await expect.poll(() => focusedInside(app, "#combo-0 .keys")).toBe(false);
  await expect(keys.locator("[data-ref].selected")).toHaveCount(0);
  await app.keyboard.press("Shift+Tab");
  await expect(keys.locator(`[data-ref="${ref}"]`)).toBeFocused();
  await expect(keys.locator(`[data-ref="${ref}"]`)).toHaveClass(/\bselected\b/);

  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("the combo editor fits a 1080p window", async ({ app }) => {
  await app.setViewportSize({ width: 1920, height: 950 });
  await openCombos(app);
  const card = comboCard(app, 0);
  await card.getByRole("button", { name: "Edit" }).click();
  await expect(chooser(app, 0)).toBeVisible();
  const topBar = await app.locator("header.topbar").boundingBox();
  const box = await card.boundingBox();
  expect(box!.height + topBar!.height).toBeLessThanOrEqual(950);
  await card.getByRole("button", { name: "Cancel" }).click();
});
