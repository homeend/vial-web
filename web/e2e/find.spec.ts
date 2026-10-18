import type { Page } from "@playwright/test";
import { expect, keyIndex, screenshots, test } from "./fixtures";

// Read-only: these tests change no key, so there is nothing to put back

const findBox = (page: Page) => page.getByRole("searchbox", { name: "Find a character or key" });
const results = (page: Page) => page.locator("#find-results");

test("finding @ lists Shift + 2 and the @ key, highlights them, and opens one", async ({ app }) => {
  await findBox(app).fill("@");
  await expect(results(app)).toContainText("“@”: 2 places");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "@ on Layer 1 (left top row, 3rd from the outside)",
    "Shift + 2 on Layer 3 (left home row, 3rd from the outside)",
  ]);
  // and said to screen readers
  await expect(app.getByRole("search", { name: "Find a character or key" }).getByRole("status")).toHaveText(
    "“@”: 2 places");

  // highlighted in the Overview, on the layers they are on
  await app.getByRole("radio", { name: "Overview" }).check();
  for (const [layer, count] of [[0, 0], [1, 1], [2, 0], [3, 1]]) {
    await expect(app.locator(`.card[data-layer="${layer}"] .key.found`)).toHaveCount(count);
  }
  await screenshots(app, "find-overview", { fullPage: true });

  // a result opens its key in the Edit view
  await results(app).getByRole("button", { name: /^Shift \+ 2 on Layer 3/ }).click();
  const two = app.locator(`[data-ref="key:${await keyIndex(app, 1, 2)}"]`);
  await expect(app.getByRole("tab", { name: "3 Layer 3" })).toHaveAttribute("aria-selected", "true");
  await expect(two).toHaveAttribute("aria-pressed", "true");
  await expect(two).toBeFocused();
  await expect(two).toHaveClass(/\bfound\b/);
  await screenshots(app, "find-edit");
});

test("Enter in the find box opens the first result on a key, which says it matches", async ({ app }) => {
  await app.getByRole("radio", { name: "Overview" }).check();
  await findBox(app).fill("@");
  await findBox(app).press("Enter");
  // the first result: "@ on Layer 1 (left top row, 3rd from the outside)"
  const at = app.locator(`[data-ref="key:${await keyIndex(app, 0, 2)}"]`);
  await expect(app.getByRole("radio", { name: "Edit" })).toBeChecked();
  await expect(app.getByRole("tab", { name: "1 Layer 1" })).toHaveAttribute("aria-selected", "true");
  await expect(at).toBeFocused();
  await expect(at).toHaveAttribute("aria-label", /· matches the search$/);
  await expect(app.locator(`[data-ref="key:${await keyIndex(app, 0, 1)}"]`)).not.toHaveAttribute("aria-label", /matches/);
});

test("a character that is nowhere on the keymap says so", async ({ app }) => {
  await findBox(app).fill("ż");
  await expect(results(app)).toHaveText("“ż” is not on your keymap.");
  await expect(app.locator(".key.found")).toHaveCount(0);
  await findBox(app).fill("");
  await expect(results(app)).toHaveCount(0);
});

test("keys, tap dances, combos, key overrides and macros are found by name", async ({ app }) => {
  await findBox(app).fill("Esc");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "Esc on Base (left outer thumb)",
    "tap dance 1, tap: Esc",
    "combo K + Y → Esc",
  ]);
  await findBox(app).fill("OSL(3)");
  await expect(results(app).getByRole("listitem")).toHaveText(["OSL 3 on Base (right outer thumb)"]);
  await findBox(app).fill("git");
  await expect(results(app).getByRole("listitem")).toHaveText(["macro 0 types \"git status\""]);
  await findBox(app).fill("Del");
  await expect(results(app).getByRole("listitem")).toHaveText([
    "Del on Layer 2 (right top row, 1st from the outside)",
    "key override 0: Del instead of Bksp",
  ]);
});

test("with the Polish keyboard language, ą is AltGr + A", async ({ app }) => {
  await app.getByLabel("Keyboard language").selectOption({ label: "Polish (QWERTY)" });
  await findBox(app).fill("ą");
  await expect(results(app).getByRole("listitem")).toHaveText(["AltGr + A on Base (right home row, 5th from the outside)"]);
});

test("the clear button and Escape empty the find box and turn the results and highlights off", async ({ app }) => {
  const clear = app.getByRole("button", { name: "Clear the search" });
  await expect(clear).toHaveCount(0);
  await findBox(app).fill("Esc");
  await expect(results(app)).toBeVisible();
  await expect(app.locator(".key.found")).not.toHaveCount(0);
  await screenshots(app, "find-clear");
  await clear.click();
  await expect(findBox(app)).toHaveValue("");
  await expect(findBox(app)).toBeFocused();
  await expect(results(app)).toHaveCount(0);
  await expect(app.locator(".key.found")).toHaveCount(0);
  await expect(clear).toHaveCount(0);

  await findBox(app).fill("@");
  await expect(results(app)).toBeVisible();
  await findBox(app).press("Escape");
  await expect(findBox(app)).toHaveValue("");
  await expect(results(app)).toHaveCount(0);
});
