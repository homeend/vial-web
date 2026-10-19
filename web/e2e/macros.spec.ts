import type { Page, Route } from "@playwright/test";
import { expect, macrosOf, openUnlockDialog, serverUrl, setMacros, simulatorUnlock, test, unlockAgain } from "./fixtures";

// Editing a macro: where the focus goes, a save that is slow or fails, a long macro, the memory the page counts, and
// recording keys. The server is shared by every test: each test that changes the macros puts them back, in its
// `finally` (setMacros throws when the server refuses them).

async function openMacros(page: Page) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Macros/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Macros" })).toBeVisible();
}

const macroCard = (page: Page, index: number) => page.locator(`#macro-${index}`);
/** The element with the focus is inside the locator's */
const focusedInside = (page: Page, selector: string) =>
  page.evaluate((s) => !!document.activeElement?.closest(s) && document.activeElement !== document.body, selector);
const text = (t: string) => ({ type: "text", text: t, keys: [], delay: null });

/** Holds back the page's saves of the macros until `release` is called; `reply` answers them instead, when given */
async function holdSaves(page: Page, reply?: (route: Route) => Promise<void>) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/macros", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    if (reply) return reply(route);
    await released;
    await route.continue();
  });
  return release;
}

test("Edit puts the focus on the first step, or on adding one; Cancel puts it on the card", async ({ app }) => {
  await openMacros(app);
  const card = macroCard(app, 0);
  await card.getByRole("button", { name: "Edit" }).click();
  await expect(card.getByLabel("Step 1: what it does")).toBeFocused();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(app.locator("#macro-0-title")).toBeFocused();

  // a new macro has no steps yet
  await app.getByRole("button", { name: "New macro" }).click();
  const added = macroCard(app, 2);
  await expect(added.getByRole("group", { name: "Add a step" }).getByRole("button", { name: "Type text" }))
    .toBeFocused();
  await added.getByRole("button", { name: "Cancel" }).click();
  await expect(app.locator("#macro-2-title")).toBeFocused();
});

test.describe("saving a macro", () => {
  test("keeps the focus while it is slow, and the steps take no change meanwhile", async ({ app }) => {
    const before = await macrosOf(app);
    try {
      await openMacros(app);
      const card = macroCard(app, 0);
      await card.getByRole("button", { name: "Edit" }).click();
      const first = card.getByLabel("Step 1: the text to type");
      await first.fill("git diff");

      const release = await holdSaves(app);
      const save = card.getByRole("button", { name: "Save" });
      await save.click();
      await expect(save).toBeFocused();
      await expect(save).toHaveAttribute("aria-disabled", "true");
      // nothing changes the steps being saved
      await card.getByRole("button", { name: "Remove step 1" }).click({ force: true });
      await card.getByRole("button", { name: "Move step 2 up" }).click({ force: true });
      await card.getByRole("button", { name: "Add key…" }).click({ force: true });
      await expect(app.getByRole("dialog", { name: "Choose a keycode" })).toBeHidden();
      await card.getByRole("group", { name: "Add a step" }).getByRole("button", { name: "Wait" }).click({ force: true });
      await first.press("x");
      await expect(card.locator(".steps > li")).toHaveCount(2);
      await expect(first).toHaveValue("git diff");
      await expect.poll(() => focusedInside(app, "#macro-0 .editor")).toBe(true);

      release();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect.poll(() => focusedInside(app, "#macro-0")).toBe(true);
      expect((await macrosOf(app))[0]).toEqual([text("git diff"), ...before[0].slice(1)]);
    } finally {
      await app.unrouteAll();
      await setMacros(app, before);
    }
  });

  test("keeps the draft and the focus on Save when it fails", async ({ app }) => {
    const before = await macrosOf(app);
    try {
      await openMacros(app);
      const card = macroCard(app, 0);
      await card.getByRole("button", { name: "Edit" }).click();
      await card.getByLabel("Step 1: the text to type").fill("git fetch");
      await holdSaves(app, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "No." }) }));
      const save = card.getByRole("button", { name: "Save" });
      await save.click();
      await expect(app.getByRole("region", { name: "Notifications" })).toContainText("Saving the macro failed");
      await expect(save).toBeFocused();
      await expect(card.getByLabel("Step 1: the text to type")).toHaveValue("git fetch");
      expect(await macrosOf(app)).toEqual(before);

      // it works once the keyboard takes it
      await app.unrouteAll();
      await save.click();
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      expect((await macrosOf(app))[0][0]).toEqual(text("git fetch"));
      await expect.poll(() => focusedInside(app, "#macro-0")).toBe(true);
    } finally {
      await app.unrouteAll();
      await setMacros(app, before);
    }
  });
});

test("moving and removing steps and keys keeps the focus on the steps", async ({ app }) => {
  await openMacros(app);
  // the simulated Corne's macro 1: tap Home, press Shift, tap End, release Shift, wait 50 ms, tap Ctrl+C
  const card = macroCard(app, 1);
  await card.getByRole("button", { name: "Edit" }).click();
  // to the top: its Up arrow is disabled there, so the focus is on its Down one
  await card.getByRole("button", { name: "Move step 2 up" }).click();
  await expect(card.getByRole("button", { name: "Move step 1 down" })).toBeFocused();
  await expect(card.getByLabel("Step 1: what it does")).toHaveValue("down");
  await card.getByRole("button", { name: "Move step 5 down" }).click();
  await expect(card.getByRole("button", { name: "Move step 6 up" })).toBeFocused();
  await expect(card.getByLabel("Step 6: what it does")).toHaveValue("delay");

  // the last step removed: the one before it
  await card.getByRole("button", { name: "Remove step 6" }).click();
  await expect(card.getByRole("button", { name: "Remove step 5" })).toBeFocused();
  // a step's only key taken out: the button to choose one
  await card.getByRole("button", { name: "Take Home out of step 2" }).click();
  await expect(card.locator(".steps > li").nth(1).getByRole("button", { name: "Choose key…" })).toBeFocused();

  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("a wait keeps what is typed, and asks for whole milliseconds", async ({ app }) => {
  await openMacros(app);
  const card = macroCard(app, 1);
  await card.getByRole("button", { name: "Edit" }).click();
  const wait = card.getByLabel("Step 5: how long to wait, in ms");
  await expect(wait).toHaveValue("50");
  await wait.fill("");
  await expect(wait).toHaveValue("");
  await wait.pressSequentially("-");
  await expect(wait).toHaveValue("-");
  await wait.fill("1.5");
  await expect(card.locator(".problem")).toHaveText("Wait a whole number of ms, 0 to 64000.");
  await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
  await wait.fill("75");
  await expect(card.locator(".problem")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Save" })).toBeEnabled();
  await card.getByRole("button", { name: "Cancel" }).click();
});

test("Save stays in the window while a long macro is edited in a 1080p window", async ({ app }) => {
  const before = await macrosOf(app);
  try {
    await app.setViewportSize({ width: 1920, height: 950 }); // a 1080p screen, less the browser's own bars
    // text and taps in turn (texts one after the other would be read back as one)
    const steps = Array.from({ length: 30 }, (_, i) => i % 2 === 0 ? text(`step ${i + 1}`)
      : { type: "tap", text: null, keys: ["KC_ENTER"], delay: null });
    await setMacros(app, [steps, ...before.slice(1)]);
    await app.reload();
    await openMacros(app);
    const card = macroCard(app, 0);
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(card.getByLabel("Step 29: the text to type")).toHaveValue("step 29");
    expect((await card.boundingBox())!.height).toBeGreaterThan(950);
    const save = card.getByRole("button", { name: "Save" });
    await expect(save).toBeInViewport({ ratio: 1 });
    await card.getByLabel("Step 15: the text to type").focus();
    await expect(save).toBeInViewport({ ratio: 1 });
    await card.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await setMacros(app, before);
  }
});

test("at phone width each step's bytes stay on its row, beside its kind", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 800 });
  await openMacros(app);
  const pageWidth = () => app.evaluate(() => document.documentElement.scrollWidth);
  const width = await pageWidth();
  const card = macroCard(app, 1);
  await card.getByRole("button", { name: "Edit" }).click();
  const rows = card.locator(".steps > li");
  await expect(rows).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const row = (await rows.nth(i).boundingBox())!;
    const select = (await rows.nth(i).locator("select").boundingBox())!;
    const bytes = (await rows.nth(i).locator(".bytes").boundingBox())!;
    expect(bytes.x).toBeGreaterThanOrEqual(select.x + select.width);
    expect(bytes.x + bytes.width).toBeLessThanOrEqual(row.x + row.width);
    expect(bytes.y).toBeLessThan(select.y + select.height);
  }
  // the editor makes the page no wider
  expect(await pageWidth()).toBeLessThanOrEqual(width);
  await card.getByRole("button", { name: "Cancel" }).click();
});

test("the memory counted while editing is what the keyboard counts once it is saved", async ({ app }) => {
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const count = app.locator(".memory .count");
    const usedNow = async () => Number((await count.textContent())!.match(/Uses (\d+) of 900 bytes/)![1]);
    const start = await usedNow();
    const card = macroCard(app, 0);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByLabel("Step 1: the text to type").fill("git status --short");
    await card.getByRole("group", { name: "Add a step" }).getByRole("button", { name: "Wait" }).click();
    // counted in the browser, as the steps are now
    await expect.poll(usedNow).toBe(start + " --short".length + 4);
    const counted = await usedNow();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
    const model = await (await app.request.get(serverUrl(app, "/api/keyboard"))).json();
    expect(model.macros.used).toBe(counted);
    expect(await usedNow()).toBe(counted);
  } finally {
    await setMacros(app, before);
  }
});

test("recording forgets modifiers let go out of the window's sight, and reads Caps Lock", async ({ app }) => {
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const card = macroCard(app, 0);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Record from keyboard" }).click();
    const stop = card.getByRole("button", { name: "Stop recording" });
    await expect(stop).toBeFocused();
    const status = card.getByRole("status");
    await expect(status).toContainText("Esc or Stop recording ends it, so Esc itself can't be recorded.");
    await expect(status).toContainText("Ctrl+W, Ctrl+T, Ctrl+N and Ctrl+Tab");
    // the other controls take nothing meanwhile
    await expect(card.getByLabel("Step 1: the text to type")).toBeDisabled();
    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

    await app.keyboard.type("a");
    // Alt+Tab to another window: it loses the focus while Alt is down, and won't see it let go
    await app.keyboard.down("Alt");
    await app.evaluate(() => window.dispatchEvent(new Event("blur")));
    await app.keyboard.press("b");
    await app.keyboard.up("Alt");
    // Alt let go elsewhere: the next key's event says it is up
    await app.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltLeft", key: "Alt", altKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", key: "c", altKey: false }));
      // with Caps Lock on, KeyH types "H": the text "h", which Caps Lock turns into "H" again
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", key: "H", modifierCapsLock: true }));
    });
    await expect(card.locator(".so-far")).toHaveText("“abch”");
    await app.keyboard.press("Escape");

    await expect(card).toContainText("1 step recorded.");
    await expect(card.getByRole("button", { name: "Record from keyboard" })).toBeFocused();
    await expect(card.getByLabel("Step 3: the text to type")).toHaveValue("abch");
    await expect(card.locator(".steps > li")).toHaveCount(3);
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await setMacros(app, before);
  }
});

test("recording stops when the unlock dialog opens: the unlock keys typed meanwhile aren't recorded", async ({ app }) => {
  // the unlock keys are held on the keyboard in use, which types them into the page (the Corne's are Tab and
  // Backspace): the dialog takes them, and the recorder, listening since before it opened, mustn't see them
  test.setTimeout(60_000);
  const before = await macrosOf(app);
  try {
    await openMacros(app);
    const card = macroCard(app, 0);
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("button", { name: "Record from keyboard" }).click();
    await app.keyboard.type("a");
    await expect(card.locator(".so-far")).toHaveText("“a”");

    const dialog = await openUnlockDialog(app);
    await app.keyboard.down("Tab");
    await app.keyboard.down("Backspace");
    await app.keyboard.press("x");
    await expect(dialog).toBeVisible();
    await simulatorUnlock(app, { keysHeld: true });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await app.keyboard.up("Backspace");
    await app.keyboard.up("Tab");

    await expect(card).toContainText("Recording stopped for the unlock, whose keys type into this page. 1 step recorded.");
    await expect(card.getByRole("button", { name: "Record from keyboard" })).toBeVisible();
    await expect(card.locator(".steps > li")).toHaveCount(before[0].length + 1);
    await expect(card.getByLabel(`Step ${before[0].length + 1}: the text to type`)).toHaveValue("a");
    await card.getByRole("button", { name: "Cancel" }).click();
    expect(await macrosOf(app)).toEqual(before);
  } finally {
    await app.keyboard.up("Backspace");
    await app.keyboard.up("Tab");
    await unlockAgain(app);
    await setMacros(app, before);
  }
});
