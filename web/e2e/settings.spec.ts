import { api, expect, openSection, setSettings, settingsOf, test } from "./fixtures";

// The QMK settings form: changes stay in the form until Save; Undo puts back what the keyboard holds; Reset to defaults
// asks first. Every test puts the settings back as they were.

/** The simulated Corne's settings as its firmware has them (simulator/corne.py): what Reset to defaults gives */
const DEFAULTS = { 1: 0, 2: 50, 3: 0, 4: 175, 5: 5, 6: 5000, 7: 200, 9: 10, 10: 16, 11: 8, 12: 10, 13: 30, 14: 10,
  15: 80, 16: 8, 17: 40, 21: 0, 22: 0, 23: 0, 24: 0, 25: 100 };
const NO_CHANGES = "No changes: the form shows what the keyboard holds.";

test("a setting is changed, undone, changed again and saved; then everything is reset", async ({ app }) => {
  const before = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    await expect(app).toHaveTitle("Settings · Vial");
    const term = app.getByRole("textbox", { name: "Tapping Term" });
    const permissive = app.getByRole("switch", { name: "Permissive Hold" });
    const status = app.locator(".savebar [role=status]");
    const save = app.locator(".savebar").getByRole("button", { name: "Save" });
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    await expect(term).toHaveValue("200");
    await expect(status).toHaveText(NO_CHANGES);

    await term.fill("250");
    await permissive.check();
    await expect(status).toHaveText("2 changes not saved yet");
    await expect(app.getByRole("heading", { name: /^Tap-Hold/ })).toContainText("2 changes");
    await undo.click();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    await expect(status).toHaveText(NO_CHANGES);

    // a number out of its range can't be saved
    await term.fill("99999");
    await expect(term).toHaveAttribute("aria-invalid", "true");
    await expect(app.getByText("Not a whole number from 0 to 10000.")).toBeVisible();
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await term.fill("250");
    await permissive.check();
    await save.click();
    await expect(status).toHaveText(NO_CHANGES);
    // Save keeps the focus, though it has nothing left to save
    await expect(save).toBeFocused();
    const saved = await settingsOf(app);
    expect([saved[7], saved[22]]).toEqual([250, 1]);

    const reset = app.getByRole("button", { name: "Reset to defaults…" });
    await reset.click();
    const dialog = app.getByRole("dialog", { name: "Reset every setting?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Reset" }).click();
    await expect(dialog).toBeHidden();
    await expect(reset).toBeFocused();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    expect(await settingsOf(app)).toEqual(DEFAULTS);
  } finally {
    await setSettings(app, before);
  }
});

test("changes not saved stay while another page shows; Undo then drops them", async ({ app }) => {
  const before = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    const term = app.getByRole("textbox", { name: "Tapping Term" });
    const status = app.locator(".savebar [role=status]");
    await term.fill("250");
    await expect(status).toHaveText("1 change not saved yet");

    await openSection(app, "Alt-repeat");
    await openSection(app, "Settings");
    await expect(term).toHaveValue("250");
    await expect(status).toHaveText("1 change not saved yet");
    await expect(app.getByRole("heading", { name: /^Tap-Hold/ })).toContainText("1 change");

    await app.locator(".savebar").getByRole("button", { name: "Undo" }).click();
    await expect(term).toHaveValue("200");
    await expect(status).toHaveText(NO_CHANGES);
    // Undo dropped them for good
    await openSection(app, "Alt-repeat");
    await openSection(app, "Settings");
    await expect(term).toHaveValue("200");
    await expect(status).toHaveText(NO_CHANGES);
    expect(await settingsOf(app)).toEqual(before);
  } finally {
    await setSettings(app, before);
  }
});

test("a switch not saved is put over what the keyboard holds now: Save changes only its own bit", async ({ app }) => {
  const before = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    // two bits of one setting (Magic, 21)
    const swap = app.getByRole("switch", { name: "Swap Caps Lock and Left Control", exact: true });
    const treat = app.getByRole("switch", { name: "Treat Caps Lock as Control", exact: true });
    const status = app.locator(".savebar [role=status]");
    await expect(swap).not.toBeChecked();
    await expect(treat).not.toBeChecked();
    await swap.check();
    await expect(status).toHaveText("1 change not saved yet");

    // while another page shows, the setting's other bit changes on the keyboard, and the app reads it again
    await openSection(app, "Key overrides");
    await setSettings(app, { 21: before[21] | 0b10 });
    expect((await api(app).post("/api/reload")).ok()).toBe(true);

    await openSection(app, "Settings");
    await expect(treat).toBeChecked();
    await expect(swap).toBeChecked();
    await expect(status).toHaveText("1 change not saved yet");
    await expect(app.getByRole("heading", { name: /^Magic/ })).toContainText("1 change");
    await app.locator(".savebar").getByRole("button", { name: "Save" }).click();
    await expect(status).toHaveText(NO_CHANGES);
    expect((await settingsOf(app))[21]).toBe(before[21] | 0b11);
  } finally {
    await setSettings(app, before);
  }
});

test("1920 x 950: tabbing through the form never leaves the focused control under the Save bar", async ({ app }) => {
  await app.setViewportSize({ width: 1920, height: 950 });
  await openSection(app, "Settings");
  await expect(app.getByRole("heading", { level: 2, name: /^Tap-Hold/ })).toBeVisible();
  await app.getByRole("button", { name: "Reset to defaults…" }).focus();
  const focused = () => app.evaluate(() => {
    const element = document.activeElement!;
    const bar = document.querySelector(".savebar")!;
    return {
      name: element.getAttribute("aria-label") ?? element.id,
      inBar: bar.contains(element),
      bottom: element.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
    };
  });
  let controls = 0;
  for (;;) {
    await app.keyboard.press("Tab");
    const at = await focused();
    if (at.inBar) break;
    controls++;
    expect(controls, "the Save bar is reached").toBeLessThan(200);
    // the window scrolled the control into view above the bar
    await expect.poll(async () => {
      const now = await focused();
      return now.bottom <= now.barTop;
    }, { message: `${at.name} is above the Save bar` }).toBe(true);
  }
  // the form is longer than the window: it scrolled, with the bar standing over its bottom
  expect(await app.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
