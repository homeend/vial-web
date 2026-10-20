import type { Page } from "@playwright/test";
import { api, expect, openSection, restoreAll, screenshots, secondKeyboard, test } from "./fixtures";

// The keyboard selector: in the top bar only while there is more than one keyboard to choose from (the server's second
// simulated keyboard, the macropad, plugged in by the test hook). Switching shows the other keyboard as if it had just
// been plugged in, asks first when there is work not saved, and the choice is kept across a replug. Every test puts
// back the Corne, open and chosen, and unplugs the second keyboard.

interface Listed {
  keyboards: { id: string; name: string; open: boolean; plugged: boolean }[];
  chosen: string | null;
}

const selector = (page: Page) => page.getByRole("combobox", { name: "Keyboard", exact: true });
const shown = (page: Page) => selector(page).locator("option:checked");
const section = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) });
const emptyHeading = (page: Page) => page.locator(".empty h1");

async function listed(page: Page): Promise<Listed> {
  return (await api(page).get("/api/keyboards")).json();
}

async function select(page: Page, name: string): Promise<void> {
  const keyboard = (await listed(page)).keyboards.find((k) => k.name === name);
  if (!keyboard) throw new Error(`${name} isn't listed`);
  const response = await api(page).post("/api/keyboards/select", { id: keyboard.id });
  if (!response.ok()) throw new Error(`choosing ${name} failed: ${response.status()} ${await response.text()}`);
}

/** The second keyboard plugged in, and the selector showing it */
async function plugSecond(page: Page, unreadable = false): Promise<void> {
  await secondKeyboard(page, true, unreadable);
  await expect(selector(page).locator("option")).toHaveCount(2, { timeout: 10_000 });
}

/** The Corne open and chosen, the second keyboard unplugged, the page showing the Corne with no selector */
async function putBack(page: Page): Promise<void> {
  await restoreAll(
    () => select(page, "Simulated Corne"),
    () => secondKeyboard(page, false),
    async () => {
      await expect(selector(page)).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator(".topbar .name")).toHaveText("Simulated Corne");
      await expect(page.locator(".page.blocked")).toHaveCount(0);
    },
  );
}

test("with one keyboard there is no selector, only its name", async ({ twoKeyboards: page }) => {
  await expect(page.locator(".topbar .name")).toHaveText("Simulated Corne");
  await expect(selector(page)).toHaveCount(0);
  expect((await listed(page)).keyboards.map((k) => k.name)).toEqual(["Simulated Corne"]);
});

test("a second keyboard brings the selector; switching shows its keymap; unplugged, the selector goes", async ({
  twoKeyboards: page,
}) => {
  try {
    await plugSecond(page);
    await expect(selector(page).locator("option")).toHaveText(["Simulated Corne", "Simulated Macropad"]);
    await expect(shown(page)).toHaveText("Simulated Corne");
    await expect(page.locator(".topbar .name")).toHaveCount(0);

    await selector(page).selectOption({ label: "Simulated Macropad" });
    // the macropad: a layout option and encoders, no lighting
    await expect(section(page, "Layout")).toBeVisible();
    await expect(section(page, "Lighting")).toHaveCount(0);
    await expect(page.locator(".page.blocked")).toHaveCount(0);
    await expect(shown(page)).toHaveText("Simulated Macropad");
    await expect(selector(page)).toHaveAttribute("title", "Simulated Macropad");
    expect((await (await api(page).get("/api/session")).json()).device).toBe("Simulated: Simulated Macropad");

    await selector(page).selectOption({ label: "Simulated Corne" });
    await expect(section(page, "Lighting")).toBeVisible();
    await expect(section(page, "Layout")).toHaveCount(0);

    await secondKeyboard(page, false);
    await expect(selector(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".topbar .name")).toHaveText("Simulated Corne");
  } finally {
    await putBack(page);
  }
});

test("work not saved is asked about first: Cancel keeps the keyboard, Switch keyboard opens the other", async ({
  twoKeyboards: page,
}) => {
  try {
    await plugSecond(page);
    await openSection(page, "Settings");
    const term = page.getByRole("textbox", { name: "Tapping Term" });
    await term.fill("250");

    await selector(page).selectOption({ label: "Simulated Macropad" });
    const dialog = page.getByRole("dialog", { name: "Switch to Simulated Macropad?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Vial closes Simulated Corne and opens Simulated Macropad.");
    await expect(dialog).toContainText("Not saved yet, and dropped if you switch: the changes on the Settings page.");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(shown(page)).toHaveText("Simulated Corne");
    await expect(selector(page)).toBeFocused();
    await expect(term).toHaveValue("250");
    expect((await listed(page)).keyboards.find((k) => k.open)?.name).toBe("Simulated Corne");

    // an editor open on the page shown counts too
    await openSection(page, "Combos");
    await page.locator("#combo-0").getByRole("button", { name: "Edit" }).click();
    await selector(page).selectOption({ label: "Simulated Macropad" });
    await expect(dialog).toContainText(
      "Not saved yet, and dropped if you switch: the combo being edited and the changes on the Settings page.");
    await dialog.getByRole("button", { name: "Switch keyboard" }).click();
    await expect(section(page, "Layout")).toBeVisible();
    await expect(shown(page)).toHaveText("Simulated Macropad");

    // the changes were dropped: back on the Corne, nothing asks, and the form shows what the keyboard holds
    await selector(page).selectOption({ label: "Simulated Corne" });
    await expect(section(page, "Lighting")).toBeVisible();
    await openSection(page, "Settings");
    await expect(page.getByRole("textbox", { name: "Tapping Term" })).toHaveValue("200");
  } finally {
    await putBack(page);
  }
});

test("a keyboard chosen with an arrow key on the closed selector is asked about first; a pointer choice isn't", async ({
  twoKeyboards: page,
}) => {
  try {
    await plugSecond(page);
    await selector(page).focus();
    await page.keyboard.press("ArrowDown");
    const dialog = page.getByRole("dialog", { name: "Switch to Simulated Macropad?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Vial closes Simulated Corne and opens Simulated Macropad.");
    await expect(dialog).not.toContainText("Not saved yet");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(shown(page)).toHaveText("Simulated Corne");
    await expect(selector(page)).toBeFocused();
    expect((await listed(page)).keyboards.find((k) => k.open)?.name).toBe("Simulated Corne");

    await page.keyboard.press("ArrowDown");
    await dialog.getByRole("button", { name: "Switch keyboard" }).click();
    await expect(section(page, "Layout")).toBeVisible();
    await expect(shown(page)).toHaveText("Simulated Macropad");

    // chosen with the pointer (selectOption): at once
    await selector(page).selectOption({ label: "Simulated Corne" });
    await expect(section(page, "Lighting")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await putBack(page);
  }
});

test("the chosen keyboard unplugged is waited for, and opened again once it is back", async ({
  twoKeyboards: page,
}) => {
  try {
    await plugSecond(page);
    await selector(page).selectOption({ label: "Simulated Macropad" });
    await expect(section(page, "Layout")).toBeVisible();

    await secondKeyboard(page, false);
    await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeVisible({ timeout: 10_000 });
    await expect(shown(page)).toHaveText("Simulated Macropad (unplugged)");
    // the Corne, still plugged in, isn't opened instead
    await expect(section(page, "Layout")).toBeVisible();
    expect((await listed(page)).keyboards.some((k) => k.open)).toBe(false);

    // back with firmware this Vial can't read: the banner says so, not that it is unplugged
    await secondKeyboard(page, true, true);
    await expect(page.getByRole("alert").filter({ hasText: "A keyboard was found, but couldn't be read" }))
      .toContainText("Its firmware speaks a protocol this Vial doesn't know", { timeout: 10_000 });
    await secondKeyboard(page, false);
    await expect(page.getByRole("alert").filter({ hasText: "Keyboard unplugged" })).toBeVisible({ timeout: 10_000 });

    // read afresh, the page says what it waits for
    await page.reload();
    await expect(emptyHeading(page)).toHaveText("Simulated Macropad is unplugged");
    await expect(page.locator(".empty")).toContainText("To use another keyboard, choose it at the top of the page.");

    await secondKeyboard(page, true);
    await expect(section(page, "Layout")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".page.blocked")).toHaveCount(0);
    await expect(shown(page)).toHaveText("Simulated Macropad");
  } finally {
    await putBack(page);
  }
});

test("a keyboard that can't be read says why, and the reason goes once it is unplugged", async ({
  twoKeyboards: page,
}) => {
  try {
    await plugSecond(page, true);
    await selector(page).selectOption({ label: "Simulated Macropad" });
    await expect(emptyHeading(page)).toHaveText("A keyboard was found, but couldn't be read");
    await expect(page.locator(".empty")).toContainText("Its firmware speaks a protocol this Vial doesn't know");

    // unplugged: no "disconnected" comes (nothing was loaded), and the error still goes
    await secondKeyboard(page, false);
    await expect(emptyHeading(page)).toHaveText("Simulated Macropad is unplugged", { timeout: 10_000 });
    await expect(page.getByText("Its firmware speaks a protocol")).toHaveCount(0);

    // plugged in again, the poll finds it can't be read: the error comes back
    await secondKeyboard(page, true, true);
    await expect(emptyHeading(page)).toHaveText("A keyboard was found, but couldn't be read", { timeout: 10_000 });
  } finally {
    await putBack(page);
  }
});

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [width, height] of [[1920, 950], [375, 812]] as const) {
  test(`${width} x ${height}: the top bar with two keyboards fits`, async ({ twoKeyboards: page }) => {
    await page.setViewportSize({ width, height });
    try {
      await plugSecond(page);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
      const box = (await selector(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await screenshots(page, `keyboards-topbar-${width}x${height}`);
      await selector(page).focus();
      await screenshots(page, `keyboards-topbar-focus-${width}x${height}`);
    } finally {
      await putBack(page);
    }
  });
}

test("the Keyboard page's About card shows the USB device of the keyboard shown, as Qt's About keyboard does", async ({
  twoKeyboards: page,
}) => {
  const fact = (label: string) =>
    page.locator("section.card .fact").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
      .locator(".value");
  try {
    await openSection(page, "Keyboard");
    const usb = page.locator("section.card .group").filter({ has: page.getByRole("heading", { name: "USB device" }) });
    await expect(usb.locator("dt")).toHaveText(["Manufacturer", "Product", "VID", "PID", "Device"]);
    await expect(fact("Manufacturer")).toHaveText("Simulated");
    await expect(fact("Product")).toHaveText("Simulated Corne");
    // the simulator's USB IDs (0xF00D, 0xCAFE), written as Qt writes them
    await expect(fact("VID")).toHaveText("F00D");
    await expect(fact("PID")).toHaveText("CAFE");
    await expect(fact("Device")).toHaveText("simulated:1");
    await expect(fact("Device")).toHaveAttribute("title", "simulated:1");
    await expect(usb.getByRole("button", { name: "Copy the device" })).toBeVisible();

    // another keyboard shown: its own
    await plugSecond(page);
    await selector(page).selectOption({ label: "Simulated Macropad" });
    await expect(section(page, "Layout")).toBeVisible();
    await openSection(page, "Keyboard");
    await expect(fact("Product")).toHaveText("Simulated Macropad");
    await expect(fact("Device")).toHaveText("simulated:2");
  } finally {
    await putBack(page);
  }
});

test("a long device path on the About card is cut short with a tooltip, and goes over lines on a phone", async ({
  app: page,
}) => {
  // a Windows device path, as hidapi gives it there: the list the page reads has it in place of the simulator's
  const path = "\\\\?\\HID#VID_55D4&PID_0461&MI_01#8&1f2a3b4c&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
  await page.route("**/api/keyboards", async (route) => {
    const listed = await (await route.fetch()).json();
    for (const k of listed.keyboards) k.path = path;
    await route.fulfill({ json: listed });
  });
  await page.reload();
  await openSection(page, "Keyboard");
  const device = page.locator("section.card .fact").filter({ has: page.locator("dt", { hasText: /^Device$/ }) })
    .locator(".value");
  await expect(device).toHaveText(path);
  await expect(device).toHaveAttribute("title", path);
  const cut = () => device.evaluate((e) => ({ cut: e.scrollWidth > e.clientWidth, height: e.clientHeight }));
  for (const [width, height] of [[1920, 950], [375, 812]] as const) {
    await page.setViewportSize({ width, height });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(0);
    const shown = await cut();
    if (width > 800) expect(shown.cut).toBe(true); // one line, cut short
    else expect(shown.height).toBeGreaterThan(30); // over lines
    await device.scrollIntoViewIfNeeded();
    await screenshots(page, `about-usb-${width}x${height}`);
  }
});
