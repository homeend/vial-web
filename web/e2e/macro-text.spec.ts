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

test("steps not finished come and go as text, flagged as the editor flags them; a wait without its number stays so", async ({
  app,
}) => {
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const card = macroCard(app, 1);
    await card.getByRole("button", { name: "Edit" }).click();
    const opener = card.getByRole("button", { name: "Open as text…" });
    await opener.click();
    const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
    const box = dialog.getByRole("textbox", { name: "Macro 1 as text" });
    // as Qt writes a step just added (an empty text step), a key step without keys and a wait without its number;
    // what follows the text of a text step is ignored, as Qt does
    await box.fill('[["text", ""], ["tap"], ["delay", null], ["text", "a", "extra"]]');
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.locator(".steps > li")).toHaveCount(4);
    await expect(card).toContainText("Type the text to send.");
    await expect(card).toContainText("Choose a key.");
    await expect(card).toContainText("Wait 0 to 64000 ms.");
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
    await opener.click();
    await expect(box).toHaveValue('[["text", ""], ["tap"], ["delay", null], ["text", "a"]]');
    await app.keyboard.press("Escape");
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await setMacros(app, before);
  }
});

test("a text too long for a macro says so, and isn't sent", async ({ app }) => {
  const before = await macrosOf(app);
  const parses: string[] = [];
  app.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/macros/parse") parses.push(r.url());
  });
  try {
    await openMacros(app);
    const card = macroCard(app, 1);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Open as text…" }).click();
    const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
    const box = dialog.getByRole("textbox", { name: "Macro 1 as text" });
    await box.evaluate((element: HTMLTextAreaElement) => {
      element.value = `[["text", "${"x".repeat(16 * 0xffff)}"]]`;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByRole("alert"))
      .toHaveText("The text wasn't applied: it is too long for a macro (at most 1023 KiB).");
    await expect(box).toBeFocused();
    expect(parses).toHaveLength(0);
    await app.keyboard.press("Escape");
    await card.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await setMacros(app, before);
  }
});

test("a text being applied when the dialog is closed (Esc twice) is dropped", async ({ app }) => {
  const before = await macrosOf(app);
  const route = "**/api/macros/parse";
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  try {
    await openMacros(app);
    const card = macroCard(app, 1);
    await card.getByRole("button", { name: "Edit" }).click();
    const steps = await card.locator(".steps > li").count();
    await app.route(route, async (r) => {
      await answered;
      await r.continue();
    });
    await card.getByRole("button", { name: "Open as text…" }).click();
    const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
    await dialog.getByRole("textbox").fill('[["text", "late"]]');
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByRole("button", { name: "Apply…" })).toBeVisible();
    // the first Esc waits for the text being read; a second one closes the dialog all the same
    await app.keyboard.press("Escape");
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const parsed = app.waitForResponse(route);
    answer();
    await parsed;
    await expect(card.locator(".steps > li")).toHaveCount(steps);
    await expect(card).not.toContainText("from the text");
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    answer();
    await app.unroute(route);
    await setMacros(app, before);
  }
});

test("Ctrl+S saves the text as a file on a layout whose letters aren't Latin too (by the key where S is)", async ({
  app,
}) => {
  await openMacros(app);
  const card = macroCard(app, 1);
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("button", { name: "Open as text…" }).click();
  const dialog = app.getByRole("dialog", { name: "Macro 1 as text" });
  await expect(dialog).toContainText("Ctrl+S saves the text as a file, Ctrl+O loads one.");
  const saving = app.waitForEvent("download");
  // a Russian layout: the key where S is types "ы"
  await dialog.getByRole("textbox").evaluate((element) => element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ы", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true })));
  expect((await saving).suggestedFilename()).toBe("macro-1.vim");
  await app.keyboard.press("Escape");
  await card.getByRole("button", { name: "Cancel" }).click();
});
