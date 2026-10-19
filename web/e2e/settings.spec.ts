import { expect, openSection, setSettings, settingsOf, test } from "./fixtures";

// The QMK settings form: changes stay in the form until Save; Undo puts back what the keyboard holds; Reset to defaults
// asks first. The test puts the settings back as they were.

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
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");

    await term.fill("250");
    await permissive.check();
    await expect(status).toHaveText("2 changes not saved yet");
    await expect(app.getByRole("heading", { name: /^Tap-Hold/ })).toContainText("2 changes");
    await undo.click();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");

    // a number out of its range can't be saved
    await term.fill("99999");
    await expect(term).toHaveAttribute("aria-invalid", "true");
    await expect(app.getByText("Not a whole number from 0 to 10000.")).toBeVisible();
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await term.fill("250");
    await permissive.check();
    await save.click();
    await expect(status).toHaveText("No changes: the form shows what the keyboard holds.");
    // Save keeps the focus, though it has nothing left to save
    await expect(save).toBeFocused();
    const saved = await settingsOf(app);
    expect([saved[7], saved[22]]).toEqual([250, 1]);

    await app.getByRole("button", { name: "Reset to defaults…" }).click();
    const dialog = app.getByRole("dialog", { name: "Reset every setting?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Reset" }).click();
    await expect(dialog).toBeHidden();
    await expect(term).toHaveValue("200");
    await expect(permissive).not.toBeChecked();
    const reset = await settingsOf(app);
    expect([reset[7], reset[22]]).toEqual([200, 0]);
  } finally {
    await setSettings(app, before);
  }
});
