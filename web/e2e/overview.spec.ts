import type { Page } from "@playwright/test";
import {
  codeAt, comboAt, expect, keyIndex, screenshots, setCodeAt, setCombo, test,
} from "./fixtures";

// The server is shared by every test: a test that changes a key or a combo puts it back in its `finally`

async function showOverview(page: Page) {
  await page.getByRole("radio", { name: "Overview" }).check();
  await expect(page.getByRole("region", { name: "Overview of the layers" })).toBeVisible();
}

const card = (page: Page, layer: number) => page.locator(`.card[data-layer="${layer}"]`);

/** "How … is reached", above the keyboard in the Edit view */
const reachFold = (page: Page) => page.locator("details.reach");

/** Opens "How … is reached" (folded away by default) and gives its list */
async function openReach(page: Page, title: string) {
  const fold = reachFold(page);
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) await fold.locator("summary").click();
  const list = page.getByRole("region", { name: title });
  await expect(list).toBeVisible();
  return list;
}

test("the Overview shows every layer and how it is reached; clicking one opens it", async ({ app }) => {
  await showOverview(app);
  const overview = app.getByRole("region", { name: "Overview of the layers" });
  await expect(overview.locator(".card")).toHaveCount(4);
  await expect(overview.getByRole("button")).toHaveText([/^0\s*Base$/, /^1\s*Layer 1$/, /^2\s*Layer 2$/, /^3\s*Layer 3$/]);
  await expect(overview.getByRole("button", { name: "Base — reached by default layer; switch to it from Layer 3 (right outer thumb)" }))
    .toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 1 — reached by hold Space" })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 2 — reached by hold B; hold S" })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Layer 3 — reached by one-shot (right outer thumb)" })).toBeVisible();
  await expect(overview).toContainText("layer_state_set_user");
  // the current layer is marked for screen readers too
  await expect(overview.getByRole("button", { name: /^Base —/ })).toHaveAttribute("aria-current", "true");
  await expect(overview.locator("[aria-current]")).toHaveCount(1);
  // small keys show their main legend only: no shifted, AltGr or hold legends (LT1(KC_SPC) has a hold)
  await expect(overview.locator(".card .key .tap").first()).toBeVisible();
  await expect(overview.locator(".card .key").locator(".hold, .shifted, .alt-gr")).toHaveCount(0);
  // the simulated Corne's second tap dance and second macro are on no key
  await expect(overview.getByRole("region", { name: "Not used" })).toContainText(
    "Tap dance 1 · Esc / LCtrl / Ctrl+S is set up, but nothing uses it.");
  await expect(overview.getByRole("region", { name: "Not used" })).toContainText(
    "Macro 1 · Home is set up, but nothing uses it.");

  await overview.getByRole("button", { name: /^Layer 2 —/ }).click();
  await expect(app.getByRole("tab", { name: "2 Layer 2" })).toHaveAttribute("aria-selected", "true");
  await expect(app.getByRole("tab", { name: "2 Layer 2" })).toBeFocused();
  await expect(app.getByRole("radio", { name: "Edit" })).toBeChecked();
  await expect(reachFold(app).locator("summary")).toHaveText(/How Layer 2 is reached\s*2 ways/);
  await expect(await openReach(app, "How Layer 2 is reached")).toContainText("hold B");
});

test("the chosen view is remembered", async ({ app }) => {
  await showOverview(app);
  await app.reload();
  await expect(app.getByRole("region", { name: "Overview of the layers" })).toBeVisible();
  await expect(app.getByRole("radio", { name: "Overview" })).toBeChecked();
  await app.getByRole("radio", { name: "Edit" }).check();
  await app.reload();
  await expect(app.getByRole("tablist", { name: "Layers" })).toBeVisible();
});

test("a combo of two layer keys whose output is a layer key reaches that layer", async ({ app }) => {
  const space = await keyIndex(app, 3, 4); // base layer: Space, Layer 1 on hold
  const oneShot = await keyIndex(app, 7, 3); // base layer: OSL(3)
  const before = await comboAt(app, 2);
  try {
    await setCombo(app, 2, { keys: ["LT1(KC_SPC)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
    await app.reload(); // the UI only knows of its own edits

    for (const [index, partner] of [[space, "OSL(3)"], [oneShot, "Space (hold: Layer 1)"]] as const) {
      const key = app.locator(`[data-ref="key:${index}"]`);
      await expect(key).toHaveClass(/\bcombo\b/);
      await key.click();
      const combos = app.getByRole("region", { name: "Combos with this key" });
      await expect(combos).toContainText(`with ${partner} → Layer 2, while held`);
      await expect(combos).toContainText("Combo 2");
    }
    await screenshots(app, "inspector-combo", { fullPage: true });

    await app.getByRole("tab", { name: "2 Layer 2" }).click();
    await expect(await openReach(app, "How Layer 2 is reached")).toContainText("combo: Space (hold: Layer 1) + OSL(3)");

    await showOverview(app);
    await expect(card(app, 2).getByRole("button")).toHaveAccessibleName(
      "Layer 2 — reached by hold B; hold S; combo: Space (hold: Layer 1) + OSL(3)");
    await expect(card(app, 2).locator(".reach")).toContainText("combo: Space (hold: Layer 1) + OSL(3)");
  } finally {
    await setCombo(app, 2, before);
  }
});

test("combo keys are underlined, in the Edit view and the Overview", async ({ app }) => {
  // K + Y and M + C on the base layer
  const members = await Promise.all([[6, 2], [6, 1], [2, 2], [2, 3]].map(([r, c]) => keyIndex(app, r, c)));
  for (const index of members) {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await expect(key).toHaveClass(/\bcombo\b/);
    await expect(key).toHaveAccessibleName(/· part of a combo$/);
    await expect(key.locator(".combo-mark")).toHaveCount(1);
  }
  await expect(app.locator("button.key.combo")).toHaveCount(4);
  const fill = await app.locator("button.key.combo .combo-mark").first().evaluate((r) => getComputedStyle(r).fill);
  expect(fill).toMatch(/^rgb\((2[0-5]\d), \d{1,2}, \d{2,3}\)$/); // red
  await app.locator(`[data-ref="key:${members[0]}"]`).click();
  await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText("with Y → Esc");

  // layer 1 is transparent on K: not underlined, but the Inspector says the combo still fires through it
  await app.getByRole("tab", { name: "1 Layer 1" }).click();
  const k = app.locator(`[data-ref="key:${members[0]}"]`);
  await expect(k).not.toHaveClass(/\bcombo\b/);
  await k.click();
  const combos = app.getByRole("region", { name: "Combos with this key" });
  await expect(combos).toContainText("with Y → Esc");
  await expect(combos).toContainText("falls through to the base layer's key");

  await showOverview(app);
  // the other layers have other keys there, or transparent ones, which aren't marked
  for (const [layer, count] of [[0, 4], [1, 0], [2, 0], [3, 0]]) {
    await expect(card(app, layer).locator(".key.combo")).toHaveCount(count);
  }
});

test("an edit shows in the Overview at once", async ({ app }) => {
  const index = await keyIndex(app, 0, 2); // base layer: L
  const before = await codeAt(app, 0, index);
  try {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await key.click();
    await app.getByRole("button", { name: "Change key" }).click();
    const picker = app.getByRole("dialog");
    await picker.getByLabel("Any keycode").fill("TG(3)");
    await expect(picker.locator("#any-keycode-result")).toContainText("TG(3)");
    await picker.getByRole("button", { name: "Use", exact: true }).click();
    await expect(picker).toBeHidden();
    await showOverview(app);
    await expect(card(app, 3).getByRole("button")).toHaveAccessibleName(
      "Layer 3 — reached by toggle (left top row, 3rd from the outside); one-shot (right outer thumb)");
  } finally {
    await setCodeAt(app, 0, index, before);
  }
});

/** On the 8-layer server, as on the owner's W-CORNE: the base layer's left outer thumb (Esc) becomes MO(5), and combo
 * 2 is MO(5) + OSL(3) → MO(2). Returns what puts them back. */
async function likeTheWCorne(page: Page): Promise<() => Promise<void>> {
  const escape = await keyIndex(page, 3, 3);
  const key = await codeAt(page, 0, escape);
  const combo = await comboAt(page, 2);
  const restore = async () => {
    await setCodeAt(page, 0, escape, key);
    await setCombo(page, 2, combo);
  };
  try {
    await setCodeAt(page, 0, escape, "MO(5)");
    await setCombo(page, 2, { keys: ["MO(5)", "OSL(3)", "KC_NO", "KC_NO"], output: "MO(2)" });
  } catch (error) {
    await restore();
    throw error;
  }
  await page.reload(); // the UI only knows of its own edits
  await expect(page.locator("button.key").first()).toBeVisible();
  return restore;
}

async function expectFits(page: Page, width: number) {
  await expect(async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const content = (await page.locator("main.content").boundingBox())!;
    expect(content.width).toBeLessThanOrEqual(1100);
    for (const box of await Promise.all((await page.locator(".card").all()).map((c) => c.boundingBox()))) {
      expect(box!.x).toBeGreaterThanOrEqual(content.x - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(width, content.x + content.width) + 0.5);
    }
    for (const box of await Promise.all((await page.locator(".card .plate").all()).map((c) => c.boundingBox()))) {
      expect(box!.width).toBeGreaterThan(0);
    }
  }).toPass();
}

/** Waits for the keyboards to be drawn again at the window's size: they measure their width a frame after it changes */
async function settled(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Every label of the small keyboards is at least 8 px and fits on its key, once they are drawn at this width */
async function expectReadable(page: Page) {
  await settled(page);
  await expect(async () => {
    const labels = await page.locator(".card .key .tap").evaluateAll((elements) => elements
      .filter((l) => (l.textContent ?? "").trim() !== "")
      .map((l) => ({
        text: l.textContent ?? "",
        size: parseFloat(getComputedStyle(l).fontSize),
        cut: l.scrollWidth > l.clientWidth || l.scrollHeight - l.clientHeight > parseFloat(getComputedStyle(l).fontSize) * 0.3,
      })));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((l) => l.size < 8)).toEqual([]);
    expect(labels.filter((l) => l.cut)).toEqual([]);
  }).toPass();
}

test.describe("8 layers", () => {
  test("fit the Overview without scrolling sideways", async ({ eightLayers: app }) => {
    const restore = await likeTheWCorne(app);
    try {
      await showOverview(app);
      await expect(app.locator(".card")).toHaveCount(8);
      await expect(card(app, 2).getByRole("button")).toHaveAccessibleName(
        "Layer 2 — reached by hold B; hold S; combo: MO(5) + OSL(3)");
      await expect(card(app, 5).getByRole("button")).toHaveAccessibleName(
        "Layer 5 — reached by hold (left outer thumb)");
      for (const layer of [4, 6, 7]) {
        await expect(card(app, layer).getByRole("button")).toHaveAccessibleName(
          `Layer ${layer} — Nothing reaches this layer`);
        await expect(card(app, layer)).toHaveClass(/\bunreached\b/);
      }

      for (const [width, height] of [[2560, 1440], [1280, 800], [800, 900]]) {
        await app.setViewportSize({ width, height });
        await expectFits(app, width);
        const [first, second] = await Promise.all([card(app, 0).boundingBox(), card(app, 1).boundingBox()]);
        // two to a row, or one below the other where two would make the keys too small to read
        if (width >= 1280) expect(second!.y).toBe(first!.y);
        else expect(second!.y).toBeGreaterThan(first!.y + first!.height);
        await expectReadable(app);
        await screenshots(app, `overview-8-layers-${width}`, { fullPage: true });
      }
    } finally {
      await restore();
    }
  });

  test("the Inspector shows the combo on both of its keys; an unreached layer warns above the keyboard", async ({ eightLayers: app }) => {
    const restore = await likeTheWCorne(app);
    try {
      await app.locator(`[data-ref="key:${await keyIndex(app, 3, 3)}"]`).click();
      await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText(
        "with OSL(3) → Layer 2, while held");
      await app.locator(`[data-ref="key:${await keyIndex(app, 7, 3)}"]`).click();
      await expect(app.getByRole("region", { name: "Combos with this key" })).toContainText(
        "with MO(5) → Layer 2, while held");
      await app.getByRole("tab", { name: "4 Layer 4" }).click();
      // folded away, it still warns
      await expect(reachFold(app)).not.toHaveAttribute("open");
      await expect(reachFold(app).locator("summary")).toHaveText(/How Layer 4 is reached\s*Nothing reaches this layer/);
      await expect(reachFold(app)).toHaveClass(/\bunreached\b/);
      await screenshots(app, "reach-unreached", { fullPage: true });
      await expect(await openReach(app, "How Layer 4 is reached")).toContainText(
        "No key, tap dance or combo switches to this layer.");
    } finally {
      await restore();
    }
  });
});

test.describe("screenshots", () => {
  for (const [width, height] of [[800, 900], [1280, 800], [2560, 1440]]) {
    test(`the Overview at ${width} wide`, async ({ app }) => {
      await app.setViewportSize({ width, height });
      await showOverview(app);
      await expectFits(app, width);
      await expectReadable(app);
      await screenshots(app, `overview-${width}`, { fullPage: true });
    });
  }
});

test("a keyboard with encoders and rotated keys is drawn in the Overview as pictures", async ({ macropad }) => {
  await showOverview(macropad);
  const overview = macropad.getByRole("region", { name: "Overview of the layers" });
  await expect(overview.locator(".card")).toHaveCount(4);
  await expect(overview.locator(".card .encoder")).toHaveCount(16);
  // only the cards are buttons: their keys and encoders are part of the picture
  await expect(overview.getByRole("button")).toHaveCount(4);
  await screenshots(macropad, "overview-macropad", { fullPage: true });
});

test("how a layer is reached is above the keyboard, folded away until opened, and stays as left", async ({ app }) => {
  await expect(app.getByRole("complementary", { name: "Selected key" })).not.toContainText("is reached");
  const fold = reachFold(app);
  await expect(fold).not.toHaveAttribute("open");
  await expect(fold.locator("summary")).toHaveText(/How Base is reached\s*2 ways/);
  // between the layer tabs and the keyboard
  const [tabs, summary, board] = await Promise.all([
    app.getByRole("tab", { name: "0 Base" }).boundingBox(), fold.boundingBox(), app.locator(".board").boundingBox()]);
  expect(summary!.y).toBeGreaterThan(tabs!.y + tabs!.height - 1);
  expect(board!.y).toBeGreaterThan(summary!.y + summary!.height - 1);

  const list = await openReach(app, "How Base is reached");
  await expect(list).toContainText("default layer");
  await screenshots(app, "reach-open", { fullPage: true });
  // open on another layer, and after a reload
  await app.getByRole("tab", { name: "1 Layer 1" }).click();
  await expect(app.getByRole("region", { name: "How Layer 1 is reached" })).toContainText("hold Space");
  await app.reload();
  await expect(app.getByRole("region", { name: "How Base is reached" })).toBeVisible();
  // folded again: stays folded
  await fold.locator("summary").click();
  await expect(fold).not.toHaveAttribute("open");
  await app.reload();
  await expect(reachFold(app)).not.toHaveAttribute("open");
});
