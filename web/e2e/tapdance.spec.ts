import type { Page } from "@playwright/test";
import { expect, setTapDance, tapDanceAt, test } from "./fixtures";

// Editing a tap dance keeps the focus where it was. The server is shared by every test: each test puts back the tap
// dance it changed, in its `finally` (setTapDance throws when the server refuses it).

async function openTapDance(page: Page) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Tap dance/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tap dance" })).toBeVisible();
}

const tapDanceCard = (page: Page, index: number) => page.locator(`#tap-dance-${index}`);

/** A slot's choose button: 0 tap, 1 hold, 2 double tap, 3 tap then hold */
const slotButton = (page: Page, index: number, slot: number) =>
  tapDanceCard(page, index).locator(".slot").nth(slot).locator("button.choose");

/** The picker's any-keycode box: type a keycode and use it */
async function pickAnyKeycode(page: Page, code: string) {
  const picker = page.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Any keycode").fill(code);
  await expect(picker.locator("#any-keycode-result")).toContainText(code);
  await picker.getByRole("button", { name: "Use", exact: true }).click();
  await expect(picker).toBeHidden();
}

test.describe("editing a tap dance keeps the focus", () => {
  test("on the slot picked", async ({ app }) => {
    const before = await tapDanceAt(app, 0);
    try {
      await openTapDance(app);
      const hold = slotButton(app, 0, 1);
      await expect(hold).toHaveAccessibleName(/^Hold: nothing/);
      await hold.click();
      await pickAnyKeycode(app, "KC_LSHIFT");
      await expect.poll(async () => (await tapDanceAt(app, 0)).hold).toBe("KC_LSHIFT");
      await expect(hold).toHaveAccessibleName(/^Hold: LShift/);
      await expect(hold).toBeFocused();
    } finally {
      await setTapDance(app, 0, before);
    }
  });

  test("on the slot cleared", async ({ app }) => {
    const before = await tapDanceAt(app, 0);
    try {
      await openTapDance(app);
      const card = tapDanceCard(app, 0);
      const clear = card.getByRole("button", { name: "Clear “Double tap” of tap dance 0" });
      await clear.click();
      await expect.poll(async () => (await tapDanceAt(app, 0)).doubleTap).toBe("KC_NO");
      await expect(clear).toHaveCount(0);
      const doubleTap = slotButton(app, 0, 2);
      await expect(doubleTap).toHaveAccessibleName(/^Double tap: nothing/);
      await expect(doubleTap).toBeFocused();
    } finally {
      await setTapDance(app, 0, before);
    }
  });

  test("in the tapping term, saved with Enter", async ({ app }) => {
    const before = await tapDanceAt(app, 1);
    try {
      await openTapDance(app);
      const term = tapDanceCard(app, 1).getByRole("spinbutton");
      await term.fill("300");
      await term.press("Enter");
      await expect.poll(async () => (await tapDanceAt(app, 1)).tappingTerm).toBe(300);
      await expect(term).toBeEnabled();
      await expect(term).toBeFocused();
      await expect(term).toHaveValue("300");

      // the spinner's arrow keys save too, and keep the focus
      await term.press("ArrowUp");
      await term.press("Enter"); // a number field takes the change on Enter or on leaving it
      await expect.poll(async () => (await tapDanceAt(app, 1)).tappingTerm).toBe(310);
      await expect(term).toBeFocused();
    } finally {
      await setTapDance(app, 1, before);
    }
  });
});

test("a tapping term out of range says what is wrong, isn't saved, and is put back on leaving the field", async ({ app }) => {
  const before = await tapDanceAt(app, 1);
  try {
    await openTapDance(app);
    const card = tapDanceCard(app, 1);
    const term = card.getByRole("spinbutton");
    const problem = card.getByRole("alert");

    for (const wrong of ["20000", "250.5", ""]) {
      await term.fill(wrong);
      await term.press("Enter");
      await expect(problem).toHaveText("A tapping term from 0 to 10000 ms.");
      await expect(term).toHaveAttribute("aria-invalid", "true");
      await expect(term).toBeFocused();
    }
    expect((await tapDanceAt(app, 1)).tappingTerm).toBe(before.tappingTerm);

    // leaving the field puts back what the keyboard holds, and says so
    await term.blur();
    await expect(term).toHaveValue(String(before.tappingTerm));
    await expect(term).toHaveAttribute("aria-invalid", "false");
    await expect(problem).toHaveText(`Not a tapping term from 0 to 10000 ms: it stays at ${before.tappingTerm} ms.`);

    // the next good one is saved, and the message goes
    await term.fill("220");
    await term.press("Enter");
    await expect.poll(async () => (await tapDanceAt(app, 1)).tappingTerm).toBe(220);
    await expect(problem).toHaveCount(0);
    await expect(term).toHaveAttribute("aria-invalid", "false");
  } finally {
    await setTapDance(app, 1, before);
  }
});
