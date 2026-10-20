import type { Browser, Page } from "@playwright/test";
import {
  codeAt, expect, keyIndex, open, restoreAll, screenshots, setCodeAt, simulatorUnlock, test, unlockAgain,
} from "./fixtures";

// Moving a key onto another of the layer shown: dragged there with the mouse, or chosen from the Inspector with the
// keyboard. A worker's server is shared by the tests it runs: each puts back every key it changed, in its `finally`.

const keyOf = (page: Page, index: number) => page.locator(`[data-ref="key:${index}"]`);

/** The centre of a key, in the window */
async function centreOf(page: Page, index: number) {
  const box = (await keyOf(page, index).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses the mouse on a key and moves it, in steps, to a point (the button stays down) */
async function pickUp(page: Page, from: number, to: { x: number; y: number }) {
  const start = await centreOf(page, from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

/** Drags a key onto another with the mouse and lets go: the drop menu shows */
async function dragOnto(page: Page, from: number, to: number) {
  await pickUp(page, from, await centreOf(page, to));
  await page.mouse.up();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Two keys next to each other on the base layer, their keycodes, and what puts them back */
async function twoKeys(page: Page, row = 1, col = 1) {
  const a = await keyIndex(page, row, col);
  const b = await keyIndex(page, row, col + 1);
  const codeA = await codeAt(page, 0, a);
  const codeB = await codeAt(page, 0, b);
  expect(codeA).not.toBe(codeB);
  const restore = () => restoreAll(() => setCodeAt(page, 0, a, codeA), () => setCodeAt(page, 0, b, codeB));
  return { a, b, codeA, codeB, restore };
}

/** The keycodes of keys on the base layer, as the server reports them */
async function codesOf(page: Page, ...keys: number[]) {
  return Promise.all(keys.map((key) => codeAt(page, 0, key)));
}

const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

test("dragging a key onto another and choosing Swap both swaps them", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  try {
    const menu = await dragOnto(app, a, b);
    // the menu has the focus, the key dragged is faint, the one dropped on ringed
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await expect(keyOf(app, a)).toHaveClass(/faded/);
    await expect(keyOf(app, b)).toHaveClass(/ringed/);
    await menu.getByRole("menuitem", { name: "Swap both" }).click();
    await expect(menu).toBeHidden();
    // both keys: the second is written after the first
    await expect.poll(() => codesOf(app, a, b)).toEqual([codeB, codeA]);
    // the key dropped on is selected, with the focus, and the toast says what was done
    await expect(keyOf(app, b)).toHaveAttribute("aria-pressed", "true");
    await expect(keyOf(app, b)).toBeFocused();
    await expect(toasts(app)).toContainText("Swapped");
    await expect(keyOf(app, a)).not.toHaveClass(/faded/);
  } finally {
    await restore();
  }
});

test("Replace with changes only the key dropped on, and Undo puts it back", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  try {
    const menu = await dragOnto(app, a, b);
    await menu.getByRole("menuitem", { name: /^Replace with / }).click();
    await expect(menu).toBeHidden();
    await expect.poll(() => codeAt(app, 0, b)).toBe(codeA);
    expect(await codeAt(app, 0, a)).toBe(codeA);
    await expect(toasts(app)).toContainText("is now");
    await screenshots(app, "keymap-move-toast");

    await toasts(app).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => codeAt(app, 0, b)).toBe(codeB);
    expect(await codeAt(app, 0, a)).toBe(codeA);
    await expect(toasts(app).getByRole("button", { name: "Undo" })).toHaveCount(0);
  } finally {
    await restore();
  }
});

test("Esc cancels a drag and the drop menu; so do a drop on the key itself, outside the keyboard, or a click elsewhere", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  const ghost = app.locator(".drag-ghost");
  try {
    const before = await app.locator('button.key[aria-pressed="true"]').getAttribute("data-ref");

    // Esc while dragging: nothing more happens, and letting go selects nothing
    await pickUp(app, a, await centreOf(app, b));
    await expect(ghost).toBeVisible();
    await expect(keyOf(app, b)).toHaveClass(/ringed/);
    await app.keyboard.press("Escape");
    await expect(ghost).toBeHidden();
    await app.mouse.up();
    await expect(app.getByRole("menu")).toBeHidden();
    await expect(app.locator('button.key[aria-pressed="true"]')).toHaveAttribute("data-ref", before!);

    // Esc in the menu: it closes, the focus goes back to the selected key
    let menu = await dragOnto(app, a, b);
    await app.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(app.locator(`[data-ref="${before}"]`)).toBeFocused();

    // a click elsewhere closes it too
    menu = await dragOnto(app, a, b);
    await app.getByRole("heading", { name: "Keymap", level: 1 }).click();
    await expect(menu).toBeHidden();

    // dropped on the key itself, or outside the keyboard: no menu
    const start = await centreOf(app, a);
    await pickUp(app, a, { x: start.x + 40, y: start.y });
    await app.mouse.move(start.x, start.y, { steps: 4 });
    await app.mouse.up();
    await pickUp(app, a, { x: 5, y: 5 });
    await expect(keyOf(app, b)).not.toHaveClass(/ringed/);
    await app.mouse.up();
    await expect(app.getByRole("menu")).toBeHidden();
    await expect(ghost).toBeHidden();

    expect(await codeAt(app, 0, a)).toBe(codeA);
    expect(await codeAt(app, 0, b)).toBe(codeB);
  } finally {
    await restore();
  }
});

test("a click that moves a little still selects the key, and drags nothing", async ({ app }) => {
  const { b } = await twoKeys(app);
  const centre = await centreOf(app, b);
  await app.mouse.move(centre.x, centre.y);
  await app.mouse.down();
  await app.mouse.move(centre.x + 3, centre.y + 2);
  await expect(app.locator(".drag-ghost")).toHaveCount(0);
  await app.mouse.up();
  await expect(keyOf(app, b)).toHaveAttribute("aria-pressed", "true");
  await expect(app.getByRole("menu")).toHaveCount(0);
});

test("without a mouse: the Inspector's Swap and Copy choose the other key with the arrows and Enter", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  const inspector = app.getByRole("complementary", { name: "Selected key" });
  const hint = app.getByRole("status").filter({ hasText: "Esc cancels" });
  try {
    // the hint's live region is there before it has anything to say, so that screen readers say it when it does
    await expect(app.locator(".pick-hint [role=status]")).toHaveText("");
    await keyOf(app, a).click();
    await inspector.getByRole("button", { name: "Swap with another key…" }).click();
    await expect(hint).toContainText("Choose the key to swap");
    await expect(keyOf(app, a)).toBeFocused();
    await app.keyboard.press("ArrowRight");
    await expect(keyOf(app, b)).toBeFocused();
    // the arrows move among the keys, but the key being moved stays selected
    await expect(keyOf(app, a)).toHaveAttribute("aria-pressed", "true");
    await expect(keyOf(app, b)).toHaveClass(/ringed/);
    await app.keyboard.press("Enter");
    await expect(hint).toBeHidden();
    // both keys: the second is written after the first
    await expect.poll(() => codesOf(app, a, b)).toEqual([codeB, codeA]);
    await expect(keyOf(app, b)).toHaveAttribute("aria-pressed", "true");
    await expect(keyOf(app, b)).toBeFocused();
    await expect(app.getByRole("dialog")).toHaveCount(0); // Enter chose the key: it didn't open the picker

    // Copy, then Esc: nothing changes, and the key being copied has the focus again
    await inspector.getByRole("button", { name: "Copy to another key…" }).click();
    await expect(hint).toContainText("Choose the key to copy");
    await app.keyboard.press("ArrowLeft");
    await expect(keyOf(app, a)).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(hint).toBeHidden();
    await expect(keyOf(app, b)).toBeFocused();

    // Copy pressed again gives up, as Esc does
    const copy = inspector.getByRole("button", { name: "Copy to another key…" });
    await copy.click();
    await expect(copy).toHaveAttribute("aria-pressed", "true");
    await copy.click();
    await expect(hint).toBeHidden();
    await expect(copy).toHaveAttribute("aria-pressed", "false");

    // Copy, then a click on the other key
    await copy.click();
    await keyOf(app, a).click();
    await expect.poll(() => codeAt(app, 0, a)).toBe(codeA);
    expect(await codeAt(app, 0, b)).toBe(codeA);
  } finally {
    await restore();
  }
});

for (const [width, height] of [[1280, 800], [1920, 950]]) {
  test(`${width} x ${height}: the drag and the drop menu, in both themes`, async ({ app }) => {
    await app.setViewportSize({ width, height });
    // a bottom-row key onto its neighbour: the menu must still fit the window
    const { a, b, restore } = await twoKeys(app, 2, 3);
    try {
      await pickUp(app, a, await centreOf(app, b));
      await expect(app.locator(".drag-ghost")).toBeVisible();
      await screenshots(app, `keymap-drag-${width}x${height}`);
      await app.mouse.up();
      const menu = app.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await screenshots(app, `keymap-drop-menu-${width}x${height}`);
      await app.keyboard.press("Escape");

      await keyOf(app, a).click();
      await app.getByRole("button", { name: "Swap with another key…" }).click();
      await screenshots(app, `keymap-pick-${width}x${height}`);
      await app.keyboard.press("Escape");
    } finally {
      await restore();
    }
  });
}

test("1920 x 950, eight layers: the Inspector with its Copy and Swap fits the window", async ({ eightLayers }) => {
  await eightLayers.setViewportSize({ width: 1920, height: 950 });
  const inspector = eightLayers.getByRole("complementary", { name: "Selected key" });
  await expect(inspector.getByRole("button", { name: "Swap with another key…" })).toBeVisible();
  const box = (await inspector.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(950);
  await screenshots(eightLayers, "keymap-inspector-eight-layers-1920x950");
});

type Point = { x: number; y: number };

/** A touch screen, small enough for the page to scroll, with the page open: touches sent through the DevTools
 * protocol. A touch says when it happens (`at`, ms since the epoch) when that matters: by default, when the browser
 * gets it, which on a busy machine can be long after the touch before it. */
async function touchScreen(browser: Browser, url: string) {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 500 } });
  const page = await open(await context.newPage(), url);
  // the keyboard can be changed (read again after the server's first event): a key pressed before then isn't picked up
  await expect(page.getByRole("button", { name: "Swap with another key…" })).toBeEnabled();
  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: number, x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y }], ...(at === undefined ? {} : { timestamp: at / 1000 }),
    });
  return {
    context,
    page,
    touch,
    /** Moves the finger to a point in 8 steps; at: when the first step is made, the others 16 ms apart */
    slide: async (from: Point, to: Point, at?: number) => {
      for (let step = 1; step <= 8; step++) {
        await touch("touchMove", at === undefined ? undefined : at + (step - 1) * 16,
          from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
      }
    },
    /** The page's scroll position once it has stopped moving: the same for 5 frames running. Until then the keys
     * aren't where they will be. */
    scrollAtRest: () => page.evaluate(() => new Promise<number>((resolve) => {
      let last = -1;
      let same = 0;
      const frame = () => {
        same = window.scrollY === last ? same + 1 : 0;
        last = window.scrollY;
        if (same === 5) resolve(last);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    })),
  };
}

test("a finger drags a key once it has held it still, and a swipe across the keys still scrolls", async ({ browser, corneUrl }) => {
  const { context, page, touch, slide, scrollAtRest } = await touchScreen(browser, corneUrl);
  const { a, b, codeA, codeB, restore } = await twoKeys(page, 2, 3);
  const ghost = page.locator(".drag-ghost");
  try {
    // a quick swipe up from a key: no drag, the page scrolls. The touches say when they happen, so that a busy
    // machine sending them late doesn't make it a finger holding the key; it stops before it lifts (no fling).
    const start = await centreOf(page, a);
    const now = Date.now();
    await touch("touchStart", now, start.x, start.y);
    await slide(start, { x: start.x, y: start.y - 150 }, now + 16);
    await touch("touchEnd", now + 8 * 16 + 100);
    await expect(ghost).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // held still, then moved onto the other key: the drop menu, and the page doesn't scroll meanwhile. Where the
    // keys are is read once the page has stopped scrolling.
    const scrolled = await scrollAtRest();
    const from = await centreOf(page, a);
    const to = await centreOf(page, b);
    await touch("touchStart", undefined, from.x, from.y);
    await expect(ghost).toBeVisible(); // picked up after the long press
    await expect(keyOf(page, a)).toHaveClass(/faded/);
    await slide(from, to);
    await expect(keyOf(page, b)).toHaveClass(/ringed/);
    await touch("touchEnd");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await menu.getByRole("menuitem", { name: "Swap both" }).tap();
    await expect.poll(() => codesOf(page, a, b)).toEqual([codeB, codeA]);
  } finally {
    await restore();
    await context.close();
  }
});

test("a quick swipe that a busy page gets only after the long press's time is still no drag", async ({ browser, corneUrl }) => {
  const { context, page, touch, slide } = await touchScreen(browser, corneUrl);
  const { a, b, codeA, codeB } = await twoKeys(page, 2, 3);
  const ghost = page.locator(".drag-ghost");
  try {
    // the page's timer picks the key up before it gets the moves; by their own times the finger moved at once
    const start = await centreOf(page, a);
    const now = Date.now();
    await touch("touchStart", now, start.x, start.y);
    await expect(ghost).toBeVisible();
    await slide(start, { x: start.x, y: start.y - 150 }, now + 16);
    await expect(ghost).toHaveCount(0);
    await touch("touchEnd", now + 8 * 16 + 100);
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await codesOf(page, a, b)).toEqual([codeA, codeB]);
  } finally {
    await context.close();
  }
});

test("a drag whose mouse release was lost ends at the next move with no button held: the next click opens no menu", async ({ app }) => {
  const { a, b, codeA, codeB } = await twoKeys(app);
  const to = await centreOf(app, b);
  await pickUp(app, a, to);
  await expect(app.locator(".drag-ghost")).toBeVisible();
  // the release went somewhere the page didn't see (another window, say): the mouse moves again, no button held
  await app.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: x + 5, clientY: y, bubbles: true,
    }));
  }, to);
  await expect(app.locator(".drag-ghost")).toHaveCount(0);
  await expect(keyOf(app, b)).not.toHaveClass(/ringed/);
  await app.mouse.up();
  await keyOf(app, b).click();
  await expect(app.getByRole("menu")).toHaveCount(0);
  await expect(keyOf(app, b)).toHaveAttribute("aria-pressed", "true");
  expect(await codesOf(app, a, b)).toEqual([codeA, codeB]);

  // the window losing the focus ends a drag too
  await pickUp(app, a, to);
  await expect(app.locator(".drag-ghost")).toBeVisible();
  await app.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(app.locator(".drag-ghost")).toHaveCount(0);
  await app.mouse.up();
  await expect(app.getByRole("menu")).toHaveCount(0);
});

test("a swap with the bootloader key on a locked keyboard writes nothing when its unlock is cancelled", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  try {
    await setCodeAt(app, 0, b, "QK_BOOT"); // the simulated keyboard starts unlocked
    await app.reload();
    await expect(keyOf(app, b)).toContainText("Boot");
    await simulatorUnlock(app, { locked: true });
    await expect(app.getByRole("button", { name: "Keyboard locked: unlock it" })).toBeVisible();

    // QK_BOOT goes where the key dragged was: the firmware refuses it while locked, so it is written first
    const menu = await dragOnto(app, a, b);
    await menu.getByRole("menuitem", { name: "Swap both" }).click();
    const dialog = app.getByRole("dialog", { name: "Unlock the keyboard" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(toasts(app)).toContainText("Swapping the keys failed: The keyboard is locked, and it wasn't unlocked.");
    await expect(toasts(app)).not.toContainText("put back");
    expect(await codesOf(app, a, b)).toEqual([codeA, "QK_BOOT"]);
  } finally {
    await restoreAll(() => unlockAgain(app), () => restore());
  }
  expect(await codesOf(app, a, b)).toEqual([codeA, codeB]);
});

test("choosing the other key while another change is being saved says why nothing happened", async ({ app }) => {
  const { a, b, codeA, codeB, restore } = await twoKeys(app);
  const inspector = app.getByRole("complementary", { name: "Selected key" });
  try {
    await keyOf(app, a).click();
    await inspector.getByRole("button", { name: "Copy to another key…" }).click();
    // a slow change, started meanwhile: the key being copied is cleared
    await app.route("**/api/keymap/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await inspector.getByRole("button", { name: "Clear" }).click();
    await keyOf(app, b).click();
    await expect(toasts(app)).toContainText("Copying the key failed: another change was still being saved. Try again.");
    await expect.poll(() => codeAt(app, 0, a)).toBe("KC_NO");
    expect(await codeAt(app, 0, b)).toBe(codeB);
  } finally {
    await app.unroute("**/api/keymap/**");
    await restore();
  }
  expect(await codesOf(app, a, b)).toEqual([codeA, codeB]);
});
