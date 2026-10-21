import type { Locator, Page } from "@playwright/test";
import {
  api, codeAt, expect, keyIndex, layerNameOf, openSection, plugIn, restoreAll, screenshots, setCodeAt, setLayerName,
  setSettings, settingsOf, test,
} from "./fixtures";

// Arrange layers: the dialog (reordered by keyboard and by drag), Apply and its Undo, Esc, an arrange that stops
// partway (the fake server's PUT /api/simulator/fail-write) with Finish and Put back, the question about work not saved,
// and the dialog and the bar at five window sizes in both themes. Each test puts back the keyboard (its .vil file), the
// layer names and whatever arrange it left unfinished.

/** The Corne's base layer: LT1(Space) on the left middle thumb (row 3, column 4) */
const SPACE = { row: 3, col: 4 };

/** What the test changes, put back afterwards: the layout (a .vil file holds every key, tap dance, combo, macro…),
 * every layer's name (an arrange moves them), and an arrange left unfinished */
async function keep(page: Page) {
  const vil = await (await api(page).get("/api/layout-file")).text();
  const count = (await (await api(page).get("/api/keyboard")).json()).layers.length;
  const layers = Array.from({ length: count }, (_, i) => i);
  const names = await Promise.all(layers.map((l) => layerNameOf(page, l)));
  return async () => {
    await plugIn(page, true);
    await api(page).put("/api/simulator/fail-write", { after: null });
    await expect.poll(async () => (await (await api(page).get("/api/session")).json()).status).toBe("connected");
    const session = await (await api(page).get("/api/session")).json();
    if (session.arrange) await api(page).post("/api/layers/arrange/put-back");
    const loaded = await api(page).post("/api/layout-file", vil);
    if (!loaded.ok()) throw new Error(`putting the layout back failed: ${await loaded.text()}`);
    for (const [i, layer] of layers.entries()) await setLayerName(page, layer, names[i]);
  };
}

function toast(page: Page, text: string): Locator {
  return page.getByRole("region", { name: "Notifications" }).getByText(text);
}

function dialogOf(page: Page): Locator {
  return page.getByRole("dialog", { name: "Arrange layers" });
}

/** The handle of a layer's row, by its name and position */
function handle(dialog: Locator, name: string): Locator {
  return dialog.getByRole("button", { name: new RegExp(`^${name}, position`) });
}

async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Arrange layers…" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".summary")).toContainText("Nothing to change.");
  return dialog;
}

async function tabNames(page: Page): Promise<string[]> {
  return page.getByRole("tab").locator(".name").allTextContents();
}

test("layers reordered with the keyboard, applied, then undone: tabs, names and keys follow", async ({ app }) => {
  const restore = await keep(app);
  try {
    await setLayerName(app, 3, "Num");
    await app.reload();
    const space = await keyIndex(app, SPACE.row, SPACE.col);
    // the Edit view shows Num: it still does after the arrange, at its new position
    await app.getByRole("tab", { name: /Num/ }).click();
    const dialog = await openDialog(app);
    await expect(handle(dialog, "Layer 1")).toBeFocused();
    await expect(dialog).toContainText("Nothing is written until you Apply.");
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");

    await handle(dialog, "Num").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await app.keyboard.press("Alt+ArrowUp");
    await expect(handle(dialog, "Num")).toBeFocused();
    await expect(handle(dialog, "Num")).toHaveAccessibleName("Num, position 1, was 3");
    await expect(dialog.locator(".row").nth(1)).toContainText("← was 3");
    await expect(dialog.locator(".summary")).toContainText(
      "Will change: 3 layers move · 94 keys rewritten · 4 layer keys renumbered (4 in the keymap).");
    const apply = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(apply).not.toHaveAttribute("aria-disabled");
    await apply.click();
    await expect(dialog).toBeHidden();
    await expect(app.locator("#arrange-layers")).toBeFocused();
    await expect(toast(app, "Layers arranged.")).toBeVisible();
    expect(await tabNames(app)).toEqual(["Base", "Num", "Layer 2", "Layer 3"]);
    await expect(app.getByRole("tab", { selected: true })).toContainText("Num");
    expect(await codeAt(app, 0, space)).toBe("LT2(KC_SPACE)");
    expect(await layerNameOf(app, 1)).toBe("Num");

    await app.getByRole("button", { name: "Undo" }).click();
    await expect(toast(app, "Layers arranged.")).toBeHidden();
    expect(await tabNames(app)).toEqual(["Base", "Layer 1", "Layer 2", "Num"]);
    await expect(app.getByRole("tab", { selected: true })).toContainText("Num");
    expect(await codeAt(app, 0, space)).toBe("LT1(KC_SPACE)");
    expect([await layerNameOf(app, 1), await layerNameOf(app, 3)]).toEqual([null, "Num"]);
  } finally {
    await restore();
  }
});

test("a layer dragged by its handle, then applied", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    const from = await handle(dialog, "Layer 1").boundingBox();
    const to = await dialog.locator(".row").nth(3).boundingBox();
    if (!from || !to) throw new Error("rows not drawn");
    await app.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await app.mouse.down();
    await app.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 12 });
    await app.mouse.up();
    // never named, each layer shows its new position's name, and where it was
    await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
    await expect(dialog.locator(".row .was")).toHaveText(["← was 2", "← was 3", "← was 1"]);
    await expect(dialog.locator(".summary")).toContainText("Will change: 3 layers move");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toBeHidden();
    // layer 1 (hold Space) is at position 3 now
    expect(await codeAt(app, 0, await keyIndex(app, SPACE.row, SPACE.col))).toBe("LT3(KC_SPACE)");
  } finally {
    await restore();
  }
});

test("Esc and Cancel write nothing; Reset goes back to the current order", async ({ app }) => {
  const before = await (await api(app).get("/api/layout-file")).text();
  let dialog = await openDialog(app);
  await handle(dialog, "Layer 2").focus();
  await app.keyboard.press("Alt+ArrowDown");
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(dialog.locator(".row .was")).toHaveText(["← was 3", "← was 2"]);
  await expect(handle(dialog, "Layer 2")).toHaveAccessibleName("Layer 2, position 2, was 3");
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(handle(dialog, "Layer 1")).toBeFocused();
  await handle(dialog, "Layer 2").focus();
  await app.keyboard.press("Alt+ArrowDown");
  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(app.locator("#arrange-layers")).toBeFocused();
  // opened again, it starts from the current order
  dialog = await openDialog(app);
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await (await api(app).get("/api/layout-file")).text()).toBe(before);
});

test("an arrange that stops partway is finished from the dialog", async ({ app }) => {
  const restore = await keep(app);
  try {
    await setLayerName(app, 3, "Num");
    await app.reload();
    const dialog = await openDialog(app);
    await handle(dialog, "Num").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("94 keys rewritten");
    await api(app).put("/api/simulator/fail-write", { after: 10 });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const stopped = dialog.locator(".stopped");
    await expect(stopped).toContainText(
      "Arranging the layers stopped after 9 of 94 writes: the keyboard didn't respond.", { timeout: 15_000 });
    // said once: the failure is the stop's
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(stopped).toBeFocused();
    // the server opens the keyboard again (a USB reset): then Finish works
    const finish = dialog.getByRole("button", { name: "Finish" });
    await expect(finish).not.toHaveAttribute("aria-disabled", { timeout: 15_000 });
    await screenshots(app, "arrange-stopped-1280");
    await finish.click();
    await expect(dialog).toBeHidden();
    await expect(toast(app, "Layers arranged.")).toBeVisible();
    expect(await tabNames(app)).toEqual(["Base", "Num", "Layer 2", "Layer 3"]);
    expect(await codeAt(app, 0, await keyIndex(app, SPACE.row, SPACE.col))).toBe("LT2(KC_SPACE)");
  } finally {
    await restore();
  }
});

test("an arrange cut short by an unplug is put back from the bar, after a replug and a reload", async ({ app }) => {
  const restore = await keep(app);
  try {
    const before = await (await api(app).get("/api/layout-file")).text();
    const space = await keyIndex(app, SPACE.row, SPACE.col);
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
    await api(app).put("/api/simulator/fail-write", { after: 20, unplug: true });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Arranging the layers failed");
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await plugIn(app, true);
    const bar = app.getByRole("region", { name: "Arranging the layers stopped" });
    await expect(bar).toContainText("stopped after 19 of", { timeout: 15_000 });
    await app.reload();
    await expect(bar).toBeVisible();
    await screenshots(app, "arrange-bar-1280");
    await bar.getByRole("button", { name: "Put back" }).click();
    await expect(bar).toBeHidden();
    await expect(app.locator("#keymap-title")).toBeFocused();
    expect(await codeAt(app, 0, space)).toBe("LT1(KC_SPACE)");
    expect(await (await api(app).get("/api/layout-file")).text()).toBe(before);
  } finally {
    await restore();
  }
});

test("work not saved is asked about first", async ({ app }) => {
  const settings = await settingsOf(app);
  try {
    await openSection(app, "Settings");
    await app.getByRole("textbox", { name: "Tapping Term" }).fill("250");
    await openSection(app, "Keymap");
    const button = app.locator("#arrange-layers");
    await button.click();
    const question = app.getByRole("dialog", { name: "Arrange the layers?" });
    await expect(question).toContainText("Not saved yet: the changes on the Settings page.");
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect(question).toBeHidden();
    await expect(button).toBeFocused();
    await expect(dialogOf(app)).toBeHidden();
    await button.click();
    await question.getByRole("button", { name: "Arrange layers" }).click();
    await expect(dialogOf(app)).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(button).toBeFocused();
  } finally {
    await openSection(app, "Settings");
    await app.locator(".savebar").getByRole("button", { name: "Undo" }).click();
    await setSettings(app, settings);
  }
});

test("the button is in the Overview too, and says why it does nothing with the keyboard unplugged", async ({ app }) => {
  try {
    await app.getByRole("radio", { name: "Overview" }).check();
    const button = app.locator("#arrange-layers-overview");
    await screenshots(app, "arrange-overview-button-1280");
    await button.click();
    await expect(dialogOf(app)).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await plugIn(app, false);
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAttribute("title", "The keyboard can't be changed just now.");
  } finally {
    await plugIn(app, true);
    await expect(app.locator("#arrange-layers-overview")).not.toHaveAttribute("aria-disabled");
    await app.getByRole("radio", { name: "Edit" }).check();
  }
});

// ---- the dialog in every window, with a warning, a problem, and stopped ----

/** The window sizes the owner's checks name: a phone, a small window, and the 1080p screen */
const SHORT_SIZES = [{ width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1920, height: 950 }];

const SIZES = [
  { width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1280, height: 800 },
  { width: 1920, height: 950 }, { width: 2560, height: 1300 },
];

/** The dialog is inside the window, and the page doesn't scroll sideways */
/** Why Apply is off, or what it warns of, is in view by the footer, however long the list: the flags line, and the
 * summary's first line */
async function reasonsInView(dialog: Locator, flags: string[]) {
  await expect(dialog.locator(".flag")).toHaveText(flags);
  for (const flag of await dialog.locator(".flag").all()) await expect(flag).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator(".will")).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport({ ratio: 1 });
}

async function fits(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

test("the dialog with the tri-layer warning, 8 layers and long names, at five window sizes", async ({ eightLayers }) => {
  const page = eightLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await setLayerName(page, 2, "Navigation, arrows and the page keys");
    await setLayerName(page, 5, "A very long layer name of forty chars..");
    await page.reload();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      await handle(dialog, "Layer 3").focus();
      await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press("Alt+ArrowUp");
      await expect(dialog.locator(".warning")).toContainText("Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow");
      await fits(page, dialog);
      await reasonsInView(dialog, ["⚠ Fn1 and Fn2 will reach other layers"]);
      // the flag shows the whole warning
      await dialog.locator(".flag.warn").click();
      await expect(dialog.locator(".warning")).toBeInViewport({ ratio: 1 });
      // a long name is cut short, and whole in its tooltip
      const name = dialog.locator(".row .name", { hasText: /^A very long/ });
      await expect(name).toHaveAttribute("title", "A very long layer name of forty chars..");
      await screenshots(page, `arrange-warning-${size.width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("a problem: a layer number that wouldn't fit turns Apply off", async ({ twentyLayers }) => {
  const page = twentyLayers;
  const dialog = await openDialog(page);
  // layer 2 (LT2 on the base layer) to position 19: LT holds layers 0 to 15
  await handle(dialog, "Layer 2").focus();
  for (let i = 0; i < 17; i++) await page.keyboard.press("Alt+ArrowDown");
  await expect(dialog.locator(".problem")).toContainText("This order can't be written");
  await expect(dialog.locator(".problem")).toContainText("LT keys hold layers 0 to 15: layer 2 can't go to position 19");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await fits(page, dialog);
    await reasonsInView(dialog, ["Can't apply: 3 layer numbers wouldn't fit"]);
    await screenshots(page, `arrange-problem-${size.width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("20 layers: a warning and a problem at once stay in view by the footer", async ({ twentyLayers }) => {
  const page = twentyLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await page.reload();
    for (const size of SHORT_SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      await handle(dialog, "Layer 2").focus();
      for (let i = 0; i < 17; i++) await page.keyboard.press("Alt+ArrowDown");
      await fits(page, dialog);
      await reasonsInView(dialog, ["Can't apply: 3 layer numbers wouldn't fit", "⚠ Fn1 and Fn2 will reach other layers"]);
      await dialog.locator(".flag.bad").click();
      await expect(dialog.locator(".problem").first()).toBeInViewport();
      await screenshots(page, `arrange-both20-${size.width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("8 layers: the warning stays in view by the footer at the owner's sizes", async ({ eightLayers }) => {
  const page = eightLayers;
  const restore = await keep(page);
  try {
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await page.reload();
    for (const size of SHORT_SIZES) {
      await page.setViewportSize(size);
      const dialog = await openDialog(page);
      // the last layer first: the list is as long as it gets
      await handle(dialog, "Layer 1").focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press("Alt+ArrowDown");
      await fits(page, dialog);
      await reasonsInView(dialog, ["⚠ Fn1 and Fn2 will reach other layers"]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("the stopped dialog and the bar at five window sizes", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change");
    await api(app).put("/api/simulator/fail-write", { after: 5 });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Finish" })).not.toHaveAttribute("aria-disabled",
      { timeout: 15_000 });
    for (const size of SIZES) {
      await app.setViewportSize(size);
      await fits(app, dialog);
      await screenshots(app, `arrange-stopped-${size.width}`);
    }
    await dialog.getByRole("button", { name: "Close" }).click();
    const bar = app.getByRole("region", { name: "Arranging the layers stopped" });
    for (const size of SIZES) {
      await app.setViewportSize(size);
      await expect(bar).toBeVisible();
      await screenshots(app, `arrange-bar-${size.width}`);
      expect(await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);
    }
  } finally {
    await app.setViewportSize({ width: 1280, height: 800 });
    await restoreAll(restore);
  }
});
