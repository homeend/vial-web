import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  codeAt, expect, keyIndex, macrosOf, openSection, restoreAll, screenshots, setCodeAt, setMacros, simulatorUnlock,
  test, unlockAgain,
} from "./fixtures";

// Saving the layout to a .vil file and loading it back, with the preview of what changes. Every test puts back what it
// changed.

/** Saves the layout from the Keyboard page; returns the file's path */
async function saveLayout(page: Page, path: string): Promise<string> {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save layout" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Simulated Corne.vil");
  await download.saveAs(path);
  return path;
}

async function chooseFile(page: Page, path: string) {
  await page.getByLabel("Layout file to load").setInputFiles(path);
}

test("a saved layout loaded back shows what changes, and confirming puts it back", async ({ app }, info) => {
  const key = await keyIndex(app, 0, 0);
  const before = await codeAt(app, 0, key);
  try {
    await openSection(app, "Keyboard");
    await expect(app).toHaveTitle("Keyboard · Vial");
    const file = await saveLayout(app, info.outputPath("saved.vil"));
    await expect(app.getByText("Saved Simulated Corne.vil.")).toBeVisible();

    await setCodeAt(app, 0, key, "KC_Z");
    await chooseFile(app, file);
    const preview = app.getByRole("group", { name: /^Load saved\.vil\?/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(preview).toContainText("Loading it makes 1 change");
    await expect(preview).toContainText("Base, left top row, 1st from the outside: Z → Tab");
    await expect(preview).toContainText("Left as they are: tap dances, combos");
    await screenshots(app, "layout-file-preview", { fullPage: true });
    // nothing was written yet
    expect(await codeAt(app, 0, key)).toBe("KC_Z");

    await preview.getByRole("button", { name: "Load it" }).click();
    await expect(preview).toBeHidden();
    await expect(app.getByText("Loaded saved.vil: 1 change written to the keyboard.")).toBeVisible();
    await expect(app.getByRole("button", { name: "Load layout…" })).toBeFocused();
    expect(await codeAt(app, 0, key)).toBe(before);
  } finally {
    await setCodeAt(app, 0, key, before);
  }
});

test("another keyboard's file, or a broken one, is refused with a clear error", async ({ app }, info) => {
  await openSection(app, "Keyboard");
  const saved = await saveLayout(app, info.outputPath("mine.vil"));
  // another keyboard's ID (the file's own is 64 bits, more than a JavaScript number keeps: it is replaced as text)
  writeFileSync(info.outputPath("other.vil"), readFileSync(saved, "utf-8").replace(/"uid": \d+/, '"uid": 4660'));
  await chooseFile(app, info.outputPath("other.vil"));
  await expect(app.getByRole("alert")).toHaveText(
    "other.vil can't be loaded: this layout file is for another keyboard (ID 0000000000001234), not this one (ID 5EEDC0DE00420042)");

  writeFileSync(info.outputPath("broken.vil"), "{ not json");
  await chooseFile(app, info.outputPath("broken.vil"));
  await expect(app.getByRole("alert")).toContainText("broken.vil can't be loaded: not a valid Vial layout file");
  await expect(app.getByRole("group", { name: /^Load / })).toHaveCount(0);
});

test("a file that changes the macros, loaded on a locked keyboard, asks to unlock it first", async ({ app }, info) => {
  test.setTimeout(60_000);
  const before = await macrosOf(app);
  try {
    await app.setViewportSize({ width: 1920, height: 950 });
    await openSection(app, "Keyboard");
    const file = await saveLayout(app, info.outputPath("macros.vil"));
    await setMacros(app, before.map((m, i) => (i === 0 ? [{ type: "text", text: "changed" }] : m)));
    await simulatorUnlock(app, { locked: true });
    await app.reload();
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();
    await expect(app.getByRole("heading", { level: 1, name: "Keyboard" })).toBeVisible();

    await chooseFile(app, file);
    const preview = app.getByRole("group", { name: /^Load macros\.vil\?/ });
    await expect(preview).toContainText("Macro 0: git status (2 steps)");
    await expect(preview).toContainText("the keyboard asks to be unlocked first");
    await preview.getByRole("button", { name: "Load it" }).click();

    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    // nothing was written while it is locked
    expect((await macrosOf(app))[0]).toEqual([{ type: "text", text: "changed", keys: [], delay: null }]);
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(app.getByText("Loaded macros.vil: 1 change written to the keyboard.")).toBeVisible();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await restoreAll(() => unlockAgain(app), () => setMacros(app, before));
  }
});
