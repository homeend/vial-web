import { encoderCodeAt, expect, screenshots, test } from "./fixtures";

// web/e2e/fixtures/macropad.vial.json: 3x3 keys, a 2u key that splits in two (a layout option), an ISO Enter, two
// rotated keys, a decal and two encoders
test("draws a keyboard with encoders, rotated keys and an ISO Enter", async ({ macropad }) => {
  await expect(macropad.locator(".topbar")).toContainText("Simulated Macropad");
  // 16 keys in the layout: no decal, and of the layout option only its first choice (one 2u key, not two 1u keys)
  await expect(macropad.locator("button.key")).toHaveCount(13);
  await expect(macropad.locator("button.encoder")).toHaveCount(4);
  await expect(macropad.locator(".knob")).toHaveCount(2);
  await screenshots(macropad, "macropad");
});

test("an encoder direction is selected and changed through the picker", async ({ macropad }) => {
  // encoders are listed in the layout's order: encoder 0 counter-clockwise, encoder 0 clockwise, ...
  const clockwise = macropad.locator('[data-ref="encoder:1"]');
  await clockwise.click();
  await expect(clockwise).toHaveAttribute("aria-pressed", "true");
  const inspector = macropad.getByRole("complementary", { name: "Selected key" });
  await expect(inspector).toContainText("encoder 0 · clockwise · Base layer");
  await inspector.getByRole("button", { name: "Change key" }).click();
  const picker = macropad.getByRole("dialog");
  await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("volu");
  await picker.getByRole("button", { name: /^Vol \+ \(/ }).click();
  await expect(picker).toBeHidden();
  await expect(clockwise).toContainText("Vol +");
  expect(await encoderCodeAt(macropad, 0, 1)).toBe("KC_VOLU");
  expect(await encoderCodeAt(macropad, 0, 0)).toBe("KC_NO");
});
