import type { Page } from "@playwright/test";
import {
  altRepeatAt, expect, keyOverrideAt, openSection, restoreAll, setAltRepeat, setKeyOverride, test,
} from "./fixtures";

// The Key overrides and Alt-repeat pages: each entry is edited in a draft and saved with Save. Every test puts back
// what it changed (the worker's server is shared by its tests).

const EMPTY_OVERRIDE = { trigger: "KC_NO", replacement: "KC_NO", layers: 0, triggerMods: 0, negativeModMask: 0,
  suppressedMods: 0, options: 0 };

/** The picker's any-keycode box: type a keycode and use it */
async function pickAnyKeycode(page: Page, code: string) {
  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Any keycode").fill(code);
  await expect(picker.locator("#any-keycode-result")).toContainText(code);
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
}

test("a new key override: trigger, replacement, modifiers, an option and layers, saved", async ({ app }) => {
  const before = await keyOverrideAt(app, 2);
  try {
    await openSection(app, "Key overrides");
    await expect(app).toHaveTitle("Key overrides · Vial");
    await app.getByRole("button", { name: "New key override" }).click();
    await expect(app).toHaveURL(/#key-overrides\/2$/);
    const card = app.locator("#key-override-2");
    await expect(card).toHaveClass(/editing/);
    await expect(card).toContainText("nothing is kept until you save it");
    // the focus goes to the trigger
    const trigger = card.getByRole("button", { name: /^Trigger: nothing/ });
    await expect(trigger).toBeFocused();
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

    await trigger.click();
    await pickAnyKeycode(app, "KC_A");
    await card.getByRole("button", { name: /^Replacement:/ }).click();
    await pickAnyKeycode(app, "KC_B");
    await card.getByRole("group", { name: "Trigger modifiers" }).getByRole("button", { name: "Left Ctrl" }).click();
    await card.getByRole("group", { name: "Trigger modifiers" }).getByRole("button", { name: "Left Alt" }).click();
    await card.getByRole("checkbox", { name: "Any one trigger modifier is enough" }).check();
    const layers = card.getByRole("group", { name: "Layers" });
    await layers.getByRole("button", { name: "None" }).click();
    await layers.getByRole("button", { name: "Layer 2", exact: true }).click();
    await expect(layers.getByRole("button", { name: "Layer 2", exact: true })).toHaveAttribute("aria-pressed", "true");
    // the sentence follows the draft
    await expect(card.locator(".sentence")).toHaveText("Left Ctrl or Left Alt + A sends B, on Layer 2 only.");
    // nothing is on the keyboard yet
    expect(await keyOverrideAt(app, 2)).toEqual(before);

    const save = card.getByRole("button", { name: "Save" });
    await save.click();
    await expect(card).not.toHaveClass(/editing/);
    await expect(card.getByRole("heading", { name: "KO 2" })).toBeFocused();
    expect(await keyOverrideAt(app, 2)).toEqual({ trigger: "KC_A", replacement: "KC_B", layers: 0b100,
      triggerMods: 0b101, negativeModMask: 0, suppressedMods: 0, options: 0x8f });
    await expect(app.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Key overrides/ }))
      .toContainText("3");

    // edited again: switched off, then removed
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("switch", { name: "Enabled" }).uncheck();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    expect((await keyOverrideAt(app, 2)).options).toBe(0x0f);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Remove" }).click();
    expect(await keyOverrideAt(app, 2)).toEqual(EMPTY_OVERRIDE);
  } finally {
    await setKeyOverride(app, 2, before);
  }
});

test("a key override on no layer, or with nothing to start it, says it never works; Cancel keeps it", async ({ app }) => {
  const before = await keyOverrideAt(app, 1);
  await openSection(app, "Key overrides");
  const card = app.locator("#key-override-1");
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("group", { name: "Layers" }).getByRole("button", { name: "None" }).click();
  await expect(card.locator(".problems")).toHaveText("It is on no layer of this keyboard, so it never works.");
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.locator(".problems")).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "KO 1" })).toBeFocused();
  expect(await keyOverrideAt(app, 1)).toEqual(before);
});

test("a key override's address opens and highlights its card", async ({ app }) => {
  await app.goto(new URL("#key-overrides/1", app.url()).toString());
  const card = app.locator("#key-override-1");
  await expect(card).toHaveClass(/target/);
  await expect(card.getByRole("heading", { name: "KO 1" })).toBeFocused();
  await expect(app).toHaveTitle("Key overrides · Vial");
});

test("an alt-repeat key is edited and saved", async ({ app }) => {
  const before = await altRepeatAt(app, 0);
  try {
    await openSection(app, "Alt-repeat");
    await expect(app).toHaveTitle("Alt-repeat · Vial");
    // the simulated keyboard has no Alt Repeat key
    await expect(app.getByRole("note")).toContainText("No key has Alt Repeat");
    const card = app.locator("#alt-repeat-0");
    await expect(card.locator(".sentence")).toHaveText(
      "After Left (alone, or with Shift), Alt Repeat sends Right, and the other way round.");
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(card.getByRole("button", { name: /^Last key: Left/ })).toBeFocused();
    await card.getByRole("button", { name: /^Alt key:/ }).click();
    await pickAnyKeycode(app, "KC_HOME");
    await card.getByRole("checkbox", { name: "Both ways" }).uncheck();
    await card.getByRole("group", { name: "Allowed modifiers" }).getByRole("button", { name: "Left Shift" }).click();
    await expect(card.locator(".sentence")).toHaveText("After Left, Alt Repeat sends Home.");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card).not.toHaveClass(/editing/);
    expect(await altRepeatAt(app, 0)).toEqual({ keycode: "KC_LEFT", altKeycode: "KC_HOME", allowedMods: 0, options: 0x0c });
  } finally {
    await restoreAll(() => setAltRepeat(app, 0, before));
  }
});
