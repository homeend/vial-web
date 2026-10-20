import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, macrosOf, screenshots, setMacros, test } from "./fixtures";

// A macro as text, as Qt's text editor has it ("Open as text…" in the macro editor): the same JSON, applied to the
// macro being edited, then saved with the page's Save. Each test puts the macros back in its `finally`.

async function openMacros(page: Page) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Macros/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Macros" })).toBeVisible();
}

const macroCard = (page: Page, index: number) => page.locator(`#macro-${index}`);
const text = (t: string) => ({ type: "text", text: t, keys: [], delay: null });

/** The macro's steps as Qt's text editor writes them (json.dumps of each action's save()) */
function qtText(steps: unknown[]): string {
  return `[${(steps as { type: string; text: string | null; keys: string[]; delay: number | null }[]).map((s) => {
    const parts = s.type === "text" ? [s.text] : s.type === "delay" ? [s.delay] : s.keys;
    return `[${[s.type, ...parts].map((v) => JSON.stringify(v)).join(", ")}]`;
  }).join(", ")}]`;
}

test("the text editor shows the macro as Qt does; Apply puts its steps in the macro, Save writes them", async ({
  app,
}) => {
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const card = macroCard(app, 0);
    await card.getByRole("button", { name: "Edit" }).click();
    const opener = card.getByRole("button", { name: "Open as text…" });
    await opener.click();
    const dialog = app.getByRole("dialog", { name: "Macro 0 as text" });
    const box = dialog.getByRole("textbox", { name: "Macro 0 as text" });
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(qtText(before[0]));
    expect(qtText(before[0])).toBe('[["text", "git status"], ["tap", "KC_ENTER"]]');

    // Esc is Cancel: nothing changes, and the focus goes back
    await box.fill('[["text", "never"]]');
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(card.locator(".steps > li")).toHaveCount(before[0].length);

    // what can't be read says why, and stays: nothing is applied
    await opener.click();
    await expect(box).toHaveValue(qtText(before[0]));
    for (const [bad, why] of [
      ['[["tapp", "KC_A"]]', "The text wasn't applied. Step 1: unknown macro step 'tapp'."],
      ['[["text", "hi"], ["tap", "KC_NOPE"]]', "The text wasn't applied. Step 2: not a valid keycode: 'KC_NOPE'"],
      ['[["text", "hi"]', "The text wasn't applied. Not JSON: Expecting ',' delimiter (line 1, column 16)."],
    ] as const) {
      await box.fill(bad);
      await dialog.getByRole("button", { name: "Apply" }).click();
      await expect(dialog.getByRole("alert")).toContainText(why);
      await expect(box).toHaveAttribute("aria-invalid", "true");
      await expect(dialog).toBeVisible();
    }
    await expect(card.locator(".steps > li")).toHaveCount(before[0].length);

    // applied: the steps change in the editor, not on the keyboard
    await box.fill('[["text", "hello"], ["tap", "KC_ENTER", "KC_A"], ["delay", 20]]');
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(card).toContainText("3 steps from the text, in place of the 2 steps there before. Cancel puts back " +
      "the macro as the keyboard has it.");
    await expect(card.locator(".steps > li")).toHaveCount(3);
    await expect(card.getByLabel("Step 1: the text to type")).toHaveValue("hello");
    await expect(card.getByLabel("Step 3: how long to wait, in ms")).toHaveValue("20");
    expect(await macrosOf(app)).toEqual(before);
    // the page's Cancel puts the macro back
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();

    // applied and saved
    await card.getByRole("button", { name: "Edit" }).click();
    await opener.click();
    await box.fill('[["text", "ls"], ["tap", "KC_ENT"]]');
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
    const saved = await macrosOf(app);
    expect(saved[0]).toEqual([text("ls"), { type: "tap", text: null, keys: ["KC_ENTER"], delay: null }]);
    expect(saved.slice(1)).toEqual(before.slice(1));
  } finally {
    await setMacros(app, before);
  }
});

test("the text editor saves the text as a .vim file and loads one, without applying it yet", async ({ app }) => {
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const card = macroCard(app, 1);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Open as text…" }).click();
    const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
    const box = dialog.getByRole("textbox", { name: "Macro 1 as text" });

    const saving = app.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save as file…" }).click();
    const file = await saving;
    expect(file.suggestedFilename()).toBe("macro-1.vim");
    expect(await readFile(await file.path(), "utf8")).toBe(qtText(before[1]));
    await expect(dialog.getByRole("status")).toHaveText("Saved macro-1.vim.");

    await dialog.getByLabel("Macro file to load").setInputFiles({
      name: "other.vim", mimeType: "text/plain", buffer: Buffer.from('[["text", "from a file"]]'),
    });
    await expect(box).toHaveValue('[["text", "from a file"]]');
    await expect(dialog.getByRole("status")).toHaveText("Loaded other.vim: Apply puts its steps in the macro.");
    // not applied until Apply: Cancel leaves the macro as it was
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.locator(".steps > li")).toHaveCount(before[1].length);
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await setMacros(app, before);
  }
});

for (const [width, height] of [[1920, 950], [375, 812]] as const) {
  test(`${width} x ${height}: the text editor and the record choice fit, with no sideways scroll`, async ({ app }) => {
    await app.setViewportSize({ width, height });
    await openMacros(app);
    const card = macroCard(app, 1);
    await card.getByRole("button", { name: "Edit" }).click();
    const record = card.getByRole("group", { name: "Record from keyboard" });
    await expect(record.getByRole("button")).toHaveText(["Record, adding to the end", "Record, replacing the steps"]);
    await record.scrollIntoViewIfNeeded();
    await screenshots(app, `macro-record-choice-${width}x${height}`);

    await card.getByRole("button", { name: "Open as text…" }).click();
    const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
    await dialog.getByRole("textbox").fill('[["tapp", "KC_A"]]');
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
    await screenshots(app, `macro-text-editor-${width}x${height}`);
    await app.keyboard.press("Escape");
    await card.getByRole("button", { name: "Cancel" }).click();
  });
}
