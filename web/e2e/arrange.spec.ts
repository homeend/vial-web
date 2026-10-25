import type { Locator, Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  api, codeAt, expect, keyIndex, layerNameOf, open, openSection, plugIn, screenshots, setCodeAt, setLayerName,
  setSettings, settingsOf, test,
} from "./fixtures";

// Arrange layers: the dialog (reordered by keyboard and by drag), Apply and its Undo, Esc, an arrange that stops
// partway (the fake server's PUT /api/simulator/fail-write) with Finish and Put back, the question about work not saved,
// the layers changed elsewhere (another tab's arrange, through the API), the start-up layer warning, and the dialog and
// the bar at five window sizes in both themes. Each test puts back the keyboard (its .vil file), the layer names and
// whatever arrange it left unfinished.

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
    // the keyboard open again (the server resets it after a write that failed: a Put back asked before then fails),
    // and no arrange left unfinished: Put back is asked again until it is done
    await expect.poll(async () => {
      const session = await (await api(page).get("/api/session")).json();
      if (session.status !== "connected") return "not connected";
      if (!session.arrange) return "done";
      await api(page).post("/api/layers/arrange/put-back");
      return "unfinished";
    }, { timeout: 15_000 }).toBe("done");
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
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return dialog.getByRole("button", { name: new RegExp(`^${escaped}, position`) });
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

/** Another tab arranges the layers (the API, as the page does) */
async function arrangeElsewhere(page: Page, order: number[]): Promise<void> {
  const response = await api(page).post("/api/layers/arrange", { order });
  if (!response.ok()) throw new Error(`arranging failed: ${response.status()} ${await response.text()}`);
}

const LAYOUT_FILE = "/api/layout-file";

test("layers reordered with the keyboard, applied, then undone: tabs, names and keys follow", async ({ app }) => {
  const restore = await keep(app);
  try {
    await setLayerName(app, 3, "Num");
    await app.reload();
    const start = await (await api(app).get(LAYOUT_FILE)).text();
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
    await expect(dialog.getByRole("status")).toHaveText("Num moved to position 1.");
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
    // the whole layout as it was
    expect(await (await api(app).get(LAYOUT_FILE)).text()).toBe(start);
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

test("Esc during a drag puts the row back, its handle keeping the focus; Home and End on the handles", async ({ app }) => {
  const dialog = await openDialog(app);
  const from = await handle(dialog, "Layer 1").boundingBox();
  const to = await dialog.locator(".row").nth(3).boundingBox();
  if (!from || !to) throw new Error("rows not drawn");
  await app.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await app.mouse.down();
  await app.mouse.move(from.x + from.width / 2, to.y + to.height - 4, { steps: 12 });
  await expect(dialog.locator(".row .was")).toHaveText(["← was 2", "← was 3", "← was 1"]);
  // nothing is selected while it is dragged
  expect(await app.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await app.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".row .was")).toHaveCount(0);
  await expect(handle(dialog, "Layer 1")).toBeFocused();
  await app.mouse.up();
  await expect(dialog.locator(".row .was")).toHaveCount(0);
  await expect(dialog.locator(".summary")).toContainText("Nothing to change.");

  // Home and End go to the first and the last handle; with Alt they move the layer there
  await app.keyboard.press("End");
  await expect(handle(dialog, "Layer 3")).toBeFocused();
  await app.keyboard.press("Home");
  await expect(handle(dialog, "Layer 1")).toBeFocused();
  await app.keyboard.press("Alt+End");
  await expect(dialog.locator(".row .was")).toHaveText(["← was 2", "← was 3", "← was 1"]);
  await expect(handle(dialog, "Layer 3")).toBeFocused();
  await expect(handle(dialog, "Layer 3")).toHaveAccessibleName("Layer 3, position 3, was 1");
  await expect(dialog.getByRole("status")).toHaveText("The layer that was 1 moved to position 3.");
  await app.keyboard.press("Alt+Home");
  await expect(dialog.locator(".row .was")).toHaveCount(0);
  await app.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Esc and Cancel write nothing; Reset goes back to the current order", async ({ app }) => {
  const before = await (await api(app).get(LAYOUT_FILE)).text();
  let dialog = await openDialog(app);
  await handle(dialog, "Layer 2").focus();
  await app.keyboard.press("Alt+ArrowDown");
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(dialog.locator(".row .was")).toHaveText(["← was 3", "← was 2"]);
  await expect(handle(dialog, "Layer 2")).toHaveAccessibleName("Layer 2, position 2, was 3");
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect(dialog.locator(".row .name")).toHaveText(["Base", "Layer 1", "Layer 2", "Layer 3"]);
  await expect(handle(dialog, "Layer 1")).toBeFocused();
  // the summary, short, needs no scrolling: no tab stop
  await expect(dialog.locator(".summary")).not.toHaveAttribute("tabindex");
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
  expect(await (await api(app).get(LAYOUT_FILE)).text()).toBe(before);
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
    await screenshots(app, "arrange-stopped-finish-1280");
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
    const before = await (await api(app).get(LAYOUT_FILE)).text();
    const space = await keyIndex(app, SPACE.row, SPACE.col);
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
    await api(app).put("/api/simulator/fail-write", { after: 20, unplug: true });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    // the failure is known once the server has given the unplugged keyboard up: at once now, but a slow runner once
    // took the transport's whole retry ladder (9.5 s) here, so the wait matches the bar's below
    await expect(dialog.getByRole("alert")).toContainText("Arranging the layers failed", { timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await plugIn(app, true);
    const bar = app.getByRole("region", { name: "Arranging the layers stopped" });
    await expect(bar).toContainText("stopped after 19 of", { timeout: 15_000 });
    await app.reload();
    await expect(bar).toBeVisible();
    // the page opened since doesn't know what stopped: the last try's count
    await expect(bar).toContainText("Arranging the layers stopped partway: the last try stopped after 19 of its");
    await screenshots(app, "arrange-bar-reloaded-1280");
    await bar.getByRole("button", { name: "Put back" }).click();
    await expect(bar).toBeHidden();
    await expect(app.locator("#keymap-title")).toBeFocused();
    expect(await codeAt(app, 0, space)).toBe("LT1(KC_SPACE)");
    expect(await (await api(app).get(LAYOUT_FILE)).text()).toBe(before);
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
    // the change not saved is dropped (when the test got that far), and the settings put back
    await app.keyboard.press("Escape");
    await openSection(app, "Settings");
    const undo = app.locator(".savebar").getByRole("button", { name: "Undo" });
    if (await undo.isVisible()) await undo.click();
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
    // off: not the progress cursor of a button waiting for a write
    await expect(button).toHaveCSS("cursor", "not-allowed");
    // clicked, it does nothing (forced: Playwright waits for a button aria-disabled to be enabled)
    await button.click({ force: true });
    await expect(dialogOf(app)).toBeHidden();
    await expect(app.getByRole("dialog", { name: "Arrange the layers?" })).toBeHidden();
  } finally {
    await plugIn(app, true);
  }
});

test("an Apply the layers changed under is refused, writing nothing; the dialog says so and shows the current order",
  async ({ app }) => {
    const restore = await keep(app);
    try {
      const space = await keyIndex(app, SPACE.row, SPACE.col);
      const dialog = await openDialog(app);
      await handle(dialog, "Layer 3").focus();
      await app.keyboard.press("Alt+ArrowUp");
      await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
      // another tab arranges the layers just before this Apply reaches the server
      await app.route("**/api/layers/arrange", async (route) => {
        await arrangeElsewhere(app, [0, 2, 1, 3]);
        await route.continue();
      }, { times: 1 });
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(dialog.locator(".changed")).toHaveText(
        "The layers were arranged again or a layout file was loaded since this was shown (in another tab, say), so " +
        "Apply wrote nothing. The order shown is the current one: arrange it again, then Apply.");
      await expect(dialog).toBeVisible();
      // only the other arrange was written: layer 1 (hold Space) is at position 2
      expect(await codeAt(app, 0, space)).toBe("LT2(KC_SPACE)");
      await expect(dialog.locator(".problem")).toHaveCount(0);
      // the current order again: a second click can't move the layers twice
      await expect(dialog.locator(".row .was")).toHaveCount(0);
      await expect(dialog.locator(".summary")).toContainText("Nothing to change.");
      await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");
      for (const width of [1280, 375]) {
        await app.setViewportSize({ width, height: width === 375 ? 740 : 800 });
        await screenshots(app, `arrange-stale-${width}`);
      }
      await app.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } finally {
      await app.setViewportSize({ width: 1280, height: 800 });
      await restore();
    }
  });

test("layers arranged elsewhere while the dialog is open: it says so, and shows the current order", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
    await arrangeElsewhere(app, [0, 2, 1, 3]);
    await expect(dialog.locator(".changed")).toHaveText(
      "The layers were arranged again or a layout file was loaded while this was open (in another tab, say). The " +
      "order shown is the current one: arrange it again, then Apply.");
    await expect(dialog.locator(".row .was")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toHaveAttribute("aria-disabled", "true");
    // arranged again: what the layers changing said is past, and Apply can be used
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".changed")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).not.toHaveAttribute("aria-disabled");
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await restore();
  }
});

test("Undo goes once the layers are arranged elsewhere: it would undo what it no longer knows", async ({ app }) => {
  const restore = await keep(app);
  try {
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(app, "Layers arranged.")).toBeVisible();
    await arrangeElsewhere(app, [0, 2, 1, 3]);
    const after = await (await api(app).get(LAYOUT_FILE)).text();
    await expect(toast(app, "Layers arranged.")).toBeHidden();
    await expect(app.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await (await api(app).get(LAYOUT_FILE)).text()).toBe(after);
  } finally {
    await restore();
  }
});

test("a PDF key's layer moved: the start-up layer it may have saved is warned of, and Apply still works",
  async ({ app }) => {
    const restore = await keep(app);
    try {
      await setCodeAt(app, 1, await keyIndex(app, 3, 3), "PDF(2)");
      await app.reload();
      const dialog = await openDialog(app);
      await handle(dialog, "Layer 2").focus();
      await app.keyboard.press("Alt+ArrowUp");
      await expect(dialog.locator(".flag")).toHaveText(["⚠ A saved start-up layer keeps its number"]);
      await expect(dialog.locator(".start-up")).toHaveText(
        "If a PDF key saved layer 2 as the start-up layer, the keyboard still starts on layer 2 after a restart, " +
        "which is now a different layer. Press the PDF key (now for layer 1) once to save it again.");
      await expect(dialog.getByRole("button", { name: "Apply", exact: true })).not.toHaveAttribute("aria-disabled");
      for (const width of [1280, 375]) {
        await app.setViewportSize({ width, height: width === 375 ? 740 : 800 });
        await screenshots(app, `arrange-start-up-${width}`);
      }
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(dialog).toBeHidden();
      // the key follows its layer
      expect(await codeAt(app, 2, await keyIndex(app, 3, 3))).toBe("PDF(1)");
    } finally {
      await app.setViewportSize({ width: 1280, height: 800 });
      await restore();
    }
  });

test("Finish keeps a key changed since the stop, and says so", async ({ app }) => {
  const restore = await keep(app);
  try {
    // a key of layer 1 that the arrange rewrites (layer 3 holds another keycode there)
    const model = await (await api(app).get("/api/keyboard")).json();
    const index = model.keys.findIndex((_: unknown, i: number) =>
      model.layers[1].keys[i].code !== model.layers[3].keys[i].code && model.keys[i].row !== null);
    const dialog = await openDialog(app);
    await handle(dialog, "Layer 3").focus();
    await app.keyboard.press("Alt+ArrowUp");
    await app.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("Will change: 3 layers move");
    await api(app).put("/api/simulator/fail-write", { after: 10 });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const finish = dialog.getByRole("button", { name: "Finish" });
    await expect(finish).not.toHaveAttribute("aria-disabled", { timeout: 15_000 });
    // changed since the stop, to what neither order has there
    await setCodeAt(app, 1, index, "KC_F13");
    await finish.click();
    await expect(dialog).toBeHidden();
    const kept = toast(app, "Layers arranged. 1 change made since the stop was kept as it is.");
    await expect(kept).toBeVisible();
    expect(await codeAt(app, 1, index)).toBe("KC_F13");
    for (const width of [1280, 375]) {
      await app.setViewportSize({ width, height: width === 375 ? 740 : 800 });
      await kept.hover(); // the toast stays while it is read
      await screenshots(app, `arrange-kept-${width}`);
    }
  } finally {
    await app.setViewportSize({ width: 1280, height: 800 });
    await restore();
  }
});

test("only the layer names left to save: said so, with why but no count, and Finish saves them",
  async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  await setLayerName(page, 3, "Num");
  await page.reload();
  // the names file can't be written: a folder where it is written first
  const blocker = join(ownServer.dataDir, "fake", "names.json.tmp");
  mkdirSync(blocker, { recursive: true });
  try {
    const dialog = await openDialog(page);
    await handle(dialog, "Num").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(dialog.locator(".summary")).toContainText("94 keys rewritten");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const stopped = dialog.locator(".stopped");
    await expect(stopped).toHaveText("The layers are arranged; only the layer names still need saving: they couldn't " +
      "be saved (see vial.log). Finish saves them; Put back puts the layers back as they were.");
    // said once: the failure is the stop's
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByText("couldn't be saved")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Arranging the layers stopped" })).toContainText(
      "only the layer names still need saving");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 740 : 800 });
      await screenshots(page, `arrange-names-only-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    rmSync(blocker, { recursive: true, force: true });
    await dialog.getByRole("button", { name: "Finish" }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, "Layers arranged.")).toBeVisible();
    expect(await tabNames(page)).toEqual(["Base", "Num", "Layer 2", "Layer 3"]);
    expect(await layerNameOf(page, 1)).toBe("Num");
  } finally {
    rmSync(blocker, { recursive: true, force: true });
  }
});

test("Finish refused as another tab put the arrange back meanwhile: the rows come back, with the focus",
  async ({ app }) => {
    const restore = await keep(app);
    try {
      const dialog = await openDialog(app);
      await handle(dialog, "Layer 3").focus();
      await app.keyboard.press("Alt+ArrowUp");
      await expect(dialog.locator(".summary")).toContainText("Will change: 2 layers move");
      await api(app).put("/api/simulator/fail-write", { after: 10 });
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      const finish = dialog.getByRole("button", { name: "Finish" });
      await expect(finish).not.toHaveAttribute("aria-disabled", { timeout: 15_000 });
      // another tab puts the layers back just before this Finish reaches the server, and this tab hears of it first
      await app.route("**/api/layers/arrange/finish", async (route) => {
        try {
          const response = await api(app).post("/api/layers/arrange/put-back");
          if (!response.ok()) throw new Error(`putting back failed: ${response.status()} ${await response.text()}`);
          await expect(dialog.locator(".rows")).toBeVisible();
        } finally {
          await route.continue();
        }
      }, { times: 1 });
      await finish.click();
      await expect(dialog.locator(".summary .problem")).toContainText("Finishing the arrange failed");
      // the button clicked went with the stopped view: the focus is on the rows, not lost to the page
      await expect(dialog.locator(".rows .handle").first()).toBeFocused();
    } finally {
      await restore();
    }
  });

// ---- the dialog in every window, with a warning, a problem, and stopped ----

/** The window sizes the owner's checks name: a phone, a small window, and the 1080p screen */
const SHORT_SIZES = [{ width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1920, height: 950 }];

const SIZES = [
  { width: 375, height: 740 }, { width: 800, height: 900 }, { width: 1280, height: 800 },
  { width: 1920, height: 950 }, { width: 2560, height: 1300 },
];

/** Why Apply is off, or what it warns of, is in view by the footer, however long the list: the flags line, and the
 * summary's first line */
async function reasonsInView(dialog: Locator, flags: string[]) {
  await expect(dialog.locator(".flag")).toHaveText(flags);
  for (const flag of await dialog.locator(".flag").all()) await expect(flag).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator(".will")).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport({ ratio: 1 });
}

/** The dialog is inside the window, and the page doesn't scroll sideways. Measured until it holds: right after a
 * window resize the layout may not have settled (on a loaded CI runner the dialog was still the wider one). */
async function fits(page: Page, dialog: Locator) {
  const size = page.viewportSize()!;
  await expect(async () => {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  }).toPass({ timeout: 5_000 });
}

/** 40 characters, the longest name a layer can have */
const LONG_NAME = "A very long layer name of forty chars...";

test("the dialog with the tri-layer warning, 8 layers and long names, at five window sizes", async ({ eightLayers }) => {
  const page = eightLayers;
  const restore = await keep(page);
  try {
    expect(LONG_NAME).toHaveLength(40);
    await setCodeAt(page, 1, await keyIndex(page, 3, 3), "FN_MO13");
    await setLayerName(page, 2, "Navigation, arrows and the page keys");
    await setLayerName(page, 5, LONG_NAME);
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
      // a long name is whole in its tooltip, and cut short where the row is narrow
      const name = dialog.locator(".row .name", { hasText: /^A very long/ });
      await expect(name).toHaveAttribute("title", LONG_NAME);
      if (size.width === 375) expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
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
      // a tab stop only while it scrolls, for the keys to scroll it: on a phone it does, in larger windows it needn't
      const summary = dialog.locator(".summary");
      if (size.width === 375) await expect(summary).toHaveAttribute("tabindex", "0");
      else await expect(summary).not.toHaveAttribute("tabindex");
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
    await restore();
  }
});
