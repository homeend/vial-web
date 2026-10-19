import type { Page } from "@playwright/test";
import { comboAt, expect, keyIndex, serverUrl, setCombo, test } from "./fixtures";

// Going between the sections: the address, the back button, the page's title, where the focus goes, and what the
// Keymap page keeps while another page shows.

async function openSection(page: Page, name: "Keymap" | "Tap dance" | "Combos" | "Macros") {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("each section has its own title, and a new combo opens without a step back", async ({ app }) => {
  const before = await comboAt(app, 2);
  try {
    await expect(app).toHaveTitle("Keymap · Vial");
    await openSection(app, "Combos");
    await expect(app).toHaveTitle("Combos · Vial");
    await app.getByRole("button", { name: "New combo" }).click();
    await expect(app).toHaveURL(/#combos\/2$/);
    // Back leaves the page, rather than closing the new combo's address and nothing else
    await app.goBack();
    await expect(heading(app, "Keymap")).toBeVisible();
    await expect(app).toHaveTitle("Keymap · Vial");
    // the focus was on the combo, which went: it goes to the page's heading
    await expect(heading(app, "Keymap")).toBeFocused();
  } finally {
    await setCombo(app, 2, before);
  }
});

test("the back and forward buttons put the focus on the page's heading when it fell", async ({ app }) => {
  await openSection(app, "Tap dance");
  await app.locator("#tap-dance-0").getByRole("button", { name: "Base, left inner thumb" }).click();
  const key = app.locator(`[data-ref="key:${await keyIndex(app, 3, 5)}"]`);
  await expect(key).toBeFocused();

  await app.goBack();
  await expect(heading(app, "Tap dance")).toBeFocused();
  await expect(app).toHaveTitle("Tap dance · Vial");
  await app.goForward();
  await expect(heading(app, "Keymap")).toBeFocused();
  // a section shown from the nav keeps the focus on the nav
  const nav = app.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Macros/ });
  await nav.click();
  await expect(heading(app, "Macros")).toBeVisible();
  await expect(nav).toBeFocused();
});

test("the keymap keeps its layer, its selected key and what was looked for while another page shows", async ({ app }) => {
  const tab = app.getByRole("tab", { name: "2 Layer 2" });
  await tab.click();
  const key = app.locator(`[data-ref="key:${await keyIndex(app, 1, 3)}"]`);
  await key.click();
  const find = app.getByRole("searchbox", { name: "Find a character or key" });
  await find.fill("esc");

  await openSection(app, "Combos");
  await app.goBack();
  await expect(heading(app, "Keymap")).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await expect(find).toHaveValue("esc");

  // a key opened from another page wins over the one remembered
  await openSection(app, "Tap dance");
  await app.locator("#tap-dance-0").getByRole("button", { name: "Base, left inner thumb" }).click();
  await expect(app.getByRole("tab", { name: "0 Base" })).toHaveAttribute("aria-selected", "true");
  const thumb = app.locator(`[data-ref="key:${await keyIndex(app, 3, 5)}"]`);
  await expect(thumb).toHaveAttribute("aria-pressed", "true");
  await expect(thumb).toBeFocused();
});

test("an address naming a section the keyboard doesn't have shows the keymap, and says so", async ({ macropad }) => {
  await macropad.goto(serverUrl(macropad, "/#combos/2"));
  await expect(heading(macropad, "Keymap")).toBeVisible();
  await expect(macropad).toHaveURL(/#keymap$/);
  await expect(macropad).toHaveTitle("Keymap · Vial");
});
