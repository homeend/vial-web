import type { Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, expect, open, openSection, restoreAll, serverUrl, test } from "./fixtures";

// The Learning page, second batch (learning.spec.ts has the first): where the focus goes between the views, deep links
// and the back button, a set file that isn't a lesson set, what a keydown means in the typing area, the picture in
// word exercises, Escape saving nothing, Next at the end of a lesson and of the set, a failed save, a lesson file's
// oddities (a character listed twice, a new entry without a key, long titles), the import's findings, the settings
// dialog's refusal, the out-of-date banner while the export loads, and the Fingers view's resting switch and failures.
// The keys are typed as keydown events dispatched on the typing area (keys.ts decides what counts), so an exercise is
// typed in a moment. Nothing touches the keyboard; the sets, the fingers and the settings are put back after each test.

const EXAMPLE = fileURLToPath(new URL("../../docs/learning/examples/corne-sim-en.json", import.meta.url));
type Exercise = { id: string; kind: string; title: string; lines: string[] };
type Lesson = { id: string; title: string; exercises: Exercise[] };
const example = JSON.parse(readFileSync(EXAMPLE, "utf-8")) as { id: string; title: string; lessons: Lesson[] };
const SET = example.id;
const [lesson1, lesson2] = example.lessons;
const DEFAULT_SETTINGS = { passAccuracy: 95, targetWpm: 30, pictureInWords: true };
const FAILING = { status: 500, contentType: "application/json", body: '{"detail":"boom"}' };

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const area = (page: Page) => page.getByRole("application", { name: "Typing area" });
/** the status line's numbers: "3 of 312 · 1 error · 66.7 % · 31 wpm · 0:48" */
const status = (page: Page) => area(page).locator(".status > span").first();
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
const lessonHeading = (page: Page, lesson: Lesson) => heading(page, new RegExp(`· ${lesson.title}$`));
const typingHeading = (page: Page, exercise: Exercise) => heading(page, new RegExp(`· ${exercise.title}$`));
const lessonRow = (page: Page, lesson: Lesson) => page.getByRole("button", { name: new RegExp(`^\\d+\\s*${lesson.title}`) });
/** what an exercise expects: its lines joined by a space, or by Enter for a text exercise */
const textOf = (exercise: Exercise) => exercise.lines.join(exercise.kind === "text" ? "\n" : " ");

/** Imports the example through the page's Import button */
async function importExample(page: Page) {
  await openSection(page, "Learning");
  await page.locator('input[type="file"]').setInputFiles(EXAMPLE);
  await expect(page.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET);
}

/** Imports a set built in the test, as a file of that name, through the Import button (the list must be shown) */
async function importJson(page: Page, name: string, set: unknown) {
  const buffer = Buffer.from(JSON.stringify(set));
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/json", buffer });
}

/** A one-lesson set for this keyboard (its layout from the export), teaching s on r1c1; `lesson` overrides the
 * lesson's fields, `hash` the layout hash (a wrong one is a warning) */
async function smallSet(page: Page, id: string, changes: { hash?: string; lesson?: Record<string, unknown> } = {}) {
  const layout = await (await api(page).get("/api/learning/export")).json();
  return {
    format: "vial-web-lessons/1", id, title: `Set ${id}`, language: "en",
    layout: { name: layout.keyboard.name, uid: layout.keyboard.uid, hash: changes.hash ?? layout.hash },
    lessons: [{
      id: "01", title: "A lesson", guidance: "Type.", new: [{ char: "s", key: "r1c1", layer: 0, via: "tap" }],
      exercises: [{ id: "e1", kind: "new-keys", title: "An exercise", lines: ["ss ss ss ss"] }], ...changes.lesson,
    }],
  };
}

/** Removes the sets (the example and the test's own), the fingers and the settings, and every route */
async function putBack(page: Page, ...sets: string[]) {
  await restoreAll(
    () => page.unrouteAll({ behavior: "ignoreErrors" }),
    ...[SET, ...sets].map((id) => async () => {
      const response = await api(page).delete(`/api/learning/sets/${id}`);
      if (response.status() !== 204 && response.status() !== 404) throw new Error(`delete ${id}: ${response.status()}`);
    }),
    () => api(page).delete("/api/learning/fingers"),
    () => api(page).put("/api/learning/settings", DEFAULT_SETTINGS),
  );
}

/** Opens a lesson's exercise from the list */
async function openExercise(page: Page, lesson: Lesson, exercise: Exercise) {
  await lessonRow(page, lesson).click();
  await expect(lessonHeading(page, lesson)).toBeVisible();
  await page.locator(".exercise", { has: page.locator(".title", { hasText: new RegExp(`^${exercise.title}$`) }) }).click();
  await expect(typingHeading(page, exercise)).toBeVisible();
  await expect(area(page)).toBeFocused();
}

/** what keys.ts reads of a keydown */
type KeyInit = Pick<KeyboardEventInit, "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat">;

/** One keydown on the typing area, as the browser would send it; whether the view took it (prevented its default) */
async function keydown(page: Page, init: KeyInit): Promise<boolean> {
  return area(page).evaluate(
    (element, init) => !element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })),
    init,
  );
}

/** Types a text into the typing area, a keydown per character (Enter for a line's end) */
async function typeAll(page: Page, text: string) {
  await area(page).evaluate((element, keys) => {
    for (const key of keys) element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }, Array.from(text).map((c) => (c === "\n" ? "Enter" : c)));
}

async function progressOf(page: Page, exercise: string) {
  return (await (await api(page).get(`/api/learning/progress/${SET}`)).json()).exercises[exercise] ?? null;
}

test("the focus follows the view: its heading, the typing area, or Import once no set is left", async ({ app }) => {
  const exercise = lesson1.exercises[0];
  try {
    await importExample(app);
    await app.getByRole("button", { name: "Fingers…" }).click();
    await expect(heading(app, "Fingers")).toBeFocused();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await expect(heading(app, "Learning")).toBeFocused();
    await lessonRow(app, lesson1).click();
    await expect(lessonHeading(app, lesson1)).toBeFocused();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await openExercise(app, lesson1, exercise);
    await app.getByRole("button", { name: "Back to the lesson" }).click();
    await expect(lessonHeading(app, lesson1)).toBeFocused();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await openExercise(app, lesson1, exercise);
    await app.keyboard.press("Escape");
    await expect(lessonHeading(app, lesson1)).toBeFocused();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await openExercise(app, lesson1, exercise);
    await typeAll(app, textOf(exercise));
    await expect(app.getByRole("region", { name: "Passed" })).toBeVisible();
    await app.getByRole("button", { name: "Again" }).click();
    await expect(area(app)).toBeFocused();
    await typeAll(app, textOf(exercise));
    await app.getByRole("button", { name: "Next exercise" }).click();
    await expect(typingHeading(app, lesson1.exercises[1])).toBeVisible();
    await expect(area(app)).toBeFocused();
    await app.getByRole("button", { name: "Back to the lesson" }).click();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await app.getByRole("button", { name: "Remove" }).click();
    await app.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(app.locator("#import-lessons")).toBeFocused();
  } finally {
    await putBack(app);
  }
});

test("a deep link opens a lesson; one to nothing shows the list with a note, and Back leaves Learning", async ({ app }) => {
  try {
    await importExample(app);
    await app.goto(serverUrl(app, `/#learning/${SET}/${lesson2.id}`));
    await expect(lessonHeading(app, lesson2)).toBeVisible();
    const links: [string, string | null][] = [
      [`#learning/${SET}/nope`, "Lesson nope isn't in"], ["#learning/nope/01", "Lesson set nope isn't here."],
      ["#learning/foo", null], // a path of one name that isn't "fingers" is the list, with nothing to say
    ];
    for (const [hash, note] of links) {
      await app.goto(serverUrl(app, "/#keymap"));
      await expect(heading(app, "Learning")).toHaveCount(0);
      await app.goto(serverUrl(app, `/${hash}`));
      await expect(heading(app, "Learning")).toBeVisible();
      await expect(app).toHaveURL(/#learning$/);
      if (note) await expect(app.getByRole("status").filter({ hasText: note })).toBeVisible();
      else await expect(app.getByRole("status").filter({ hasText: /isn't/ })).toHaveCount(0);
      await app.goBack();
      await expect(app).toHaveURL(/#keymap$/);
      await expect(heading(app, "Learning")).toHaveCount(0);
    }
  } finally {
    await putBack(app);
  }
});

test("Next replaces the step back, crosses into the next lesson, and is off after the set's last", async ({ app }) => {
  const lastOf1 = lesson1.exercises[lesson1.exercises.length - 1];
  const lastOf2 = lesson2.exercises[lesson2.exercises.length - 1];
  try {
    await importExample(app);
    await openExercise(app, lesson1, lastOf1);
    await typeAll(app, textOf(lastOf1));
    await app.getByRole("button", { name: "Next exercise" }).click();
    await expect(heading(app, new RegExp(`^2 · ${lesson2.title} · ${lesson2.exercises[0].title}$`))).toBeVisible();
    await app.goBack();
    await expect(lessonHeading(app, lesson1)).toBeVisible();
    await app.getByRole("button", { name: "Back to lessons" }).click();

    await openExercise(app, lesson2, lastOf2);
    expect(lastOf2.kind).toBe("text");
    await typeAll(app, textOf(lastOf2));
    const next = app.getByRole("button", { name: "Next exercise" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveAttribute("title", "This is the last exercise of the set");
    await next.click({ force: true }); // Playwright itself won't click an aria-disabled button: a user can
    await expect(typingHeading(app, lastOf2)).toBeVisible();
  } finally {
    await putBack(app);
  }
});

test("a file that isn't a lesson set is listed with its error, chosen, and removed", async ({ page, ownServer }) => {
  await open(page, ownServer.url);
  const uid = (await (await api(page).get("/api/keyboard")).json()).uid as string;
  const setsDir = join(ownServer.dataDir, "fake", "learning", uid, "sets");
  await importExample(page);
  await importJson(page, "second.json", await smallSet(page, "second"));
  const select = page.getByRole("combobox", { name: "Lesson set" });
  await expect(select).toHaveValue("second");
  writeFileSync(join(setsDir, "second.json"), "{not json");
  await page.reload();
  await openSection(page, "Learning");
  await expect(select).toHaveValue(SET); // the readable one opens
  await expect(page.getByRole("option", { name: "second — error" })).toHaveCount(1);
  await select.selectOption("second");
  const problem = page.getByRole("alert").filter({ hasText: "This file can't be opened: not a JSON file" });
  await expect(problem).toBeVisible();
  await expect(page.getByRole("list", { name: /^Lessons of/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(select).toHaveValue(SET);
  await expect(page.getByRole("option", { name: "second — error" })).toHaveCount(0);
  await expect(problem).toHaveCount(0);

  // the only file broken: chosen, with its error, rather than a blank selector
  writeFileSync(join(setsDir, `${SET}.json`), "[]");
  await page.reload();
  await openSection(page, "Learning");
  await expect(select).toHaveValue(SET);
  await expect(page.getByRole("option", { name: `${SET} — error` })).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "This file can't be opened:" })).toBeVisible();
});

test("Backspace clears a wrong key or goes back in the word; shortcuts, repeats and Dead do nothing", async ({ app }) => {
  const exercise = lesson1.exercises[0]; // "sa sa ei ei …"
  try {
    await importExample(app);
    await openExercise(app, lesson1, exercise);
    const of = textOf(exercise).length;
    await keydown(app, { key: "x" });
    await expect(app.locator(".run.wrong")).toHaveCount(1);
    await expect(status(app)).toHaveText(new RegExp(`^0 of ${of} · 1 error`));
    await keydown(app, { key: "Backspace" });
    await expect(app.locator(".run.wrong")).toHaveCount(0);
    await keydown(app, { key: "s" });
    await expect(status(app)).toHaveText(new RegExp(`^1 of ${of} · 1 error`));
    await keydown(app, { key: "Backspace" });
    await expect(status(app)).toHaveText(new RegExp(`^0 of ${of} · 1 error`));
    await keydown(app, { key: "s" });
    // nothing a drill needs: a browser shortcut (left to the browser), auto-repeat (of the expected key too), a dead key
    expect(await keydown(app, { key: "r", ctrlKey: true })).toBe(false);
    await keydown(app, { key: "a", repeat: true });
    await keydown(app, { key: "Dead" });
    await expect(status(app)).toHaveText(new RegExp(`^1 of ${of} · 1 error`));
    // AltGr comes as Ctrl+Alt on Windows: its character is typed (wrong here)
    await keydown(app, { key: "ą", ctrlKey: true, altKey: true });
    await expect(status(app)).toHaveText(new RegExp(`^1 of ${of} · 2 errors`));
    await keydown(app, { key: "Backspace" });
    await keydown(app, { key: "a" });
    await keydown(app, { key: " " });
    await expect(status(app)).toHaveText(new RegExp(`^3 of ${of} · 2 errors`));
    // Backspace at a word's start stays there
    await keydown(app, { key: "Backspace" });
    await expect(status(app)).toHaveText(new RegExp(`^3 of ${of} · 2 errors`));
    // a Space held down: its repeats are swallowed (the page would scroll) and count nothing
    for (let i = 0; i < 3; i++) expect(await keydown(app, { key: " ", repeat: true })).toBe(true);
    await expect(status(app)).toHaveText(new RegExp(`^3 of ${of} · 2 errors`));
  } finally {
    await putBack(app);
  }
});

test("Enter ends a line of a text exercise, and is a wrong key in a word exercise", async ({ app }) => {
  const text = lesson2.exercises.find((e) => e.kind === "text")!;
  const words = lesson1.exercises.find((e) => e.kind === "words")!;
  try {
    await importExample(app);
    await openExercise(app, lesson2, text);
    const first = text.lines[0];
    await typeAll(app, first);
    await expect(status(app)).toHaveText(new RegExp(`^${first.length} of \\d+ · 0 errors`));
    await expect(app.locator(".run.end.typed")).toHaveCount(0);
    await keydown(app, { key: "Enter" });
    await expect(status(app)).toHaveText(new RegExp(`^${first.length + 1} of \\d+ · 0 errors`));
    await expect(app.locator(".run.end.typed")).toHaveCount(1);
    await app.keyboard.press("Escape");
    await expect(lessonHeading(app, lesson2)).toBeVisible();
    await app.getByRole("button", { name: "Back to lessons" }).click();

    await openExercise(app, lesson1, words);
    await keydown(app, { key: "Enter" });
    await expect(status(app)).toHaveText(/^0 of \d+ · 1 error/);
    await expect(app.locator(".run.wrong")).toHaveCount(1);
  } finally {
    await putBack(app);
  }
});

test("the picture in word exercises follows the setting, and lights no key there", async ({ app }) => {
  const words = lesson1.exercises.find((e) => e.kind === "words")!;
  const pictureInWords = async () => (await (await api(app).get("/api/learning/settings")).json()).pictureInWords;
  const flip = async () => {
    await app.locator("#learning-settings").click();
    const dialog = app.getByRole("dialog", { name: "Learning settings" });
    await dialog.getByRole("switch", { name: "Show the picture in word exercises" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  };
  try {
    await importExample(app);
    await flip();
    expect(await pictureInWords()).toBe(false);
    await openExercise(app, lesson1, words);
    await expect(app.locator(".board")).toHaveCount(0);
    await app.keyboard.press("Escape");
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await flip();
    expect(await pictureInWords()).toBe(true);
    await openExercise(app, lesson1, words);
    await expect(app.locator(".board")).toHaveCount(1);
    await expect(app.locator(".board .key.found")).toHaveCount(0);
    await expect(app.getByText(/^Next: /)).toHaveCount(0);
  } finally {
    await putBack(app);
  }
});

test("Escape in the middle of an exercise saves nothing", async ({ app }) => {
  const exercise = lesson1.exercises[2];
  try {
    await importExample(app);
    const before = await progressOf(app, exercise.id);
    await lessonRow(app, lesson1).click();
    const best = app.locator(".exercise", { hasText: exercise.title }).locator(".best");
    const shown = await best.textContent();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await openExercise(app, lesson1, exercise);
    await typeAll(app, textOf(exercise).slice(0, 12));
    await expect(status(app)).toHaveText(/^12 of /);
    await app.keyboard.press("Escape");
    await expect(lessonHeading(app, lesson1)).toBeFocused();
    await expect(best).toHaveText(shown ?? "");
    expect(await progressOf(app, exercise.id)).toEqual(before);
  } finally {
    await putBack(app);
  }
});

test("a result the server doesn't take stays on the page, marked not saved", async ({ app }) => {
  const exercise = lesson1.exercises[0];
  try {
    await importExample(app);
    const before = await progressOf(app, exercise.id);
    await openExercise(app, lesson1, exercise);
    await app.route(/\/api\/learning\/progress\//, (route) => route.fulfill(FAILING));
    await typeAll(app, textOf(exercise));
    const result = app.getByRole("region", { name: "Passed" });
    await expect(result).toBeVisible();
    await expect(result.getByRole("status")).toHaveText(/^Not saved/);
    await expect(result).toContainText("Accuracy100.0 %");
    await expect(result.getByRole("button", { name: "Again" })).toBeVisible();
    await app.unrouteAll();
    expect(await progressOf(app, exercise.id)).toEqual(before);
  } finally {
    await putBack(app);
  }
});

test("a lesson listing a character twice, and a new entry without a key, shows as it is", async ({ app }) => {
  const s = { char: "s", key: "r1c1", layer: 0, via: "tap" };
  try {
    await openSection(app, "Learning");
    const set = await smallSet(app, "twice", { lesson: {
      new: [s, { ...s }, { char: "h" }],
      exercises: [{ id: "e1", kind: "new-keys", title: "An exercise", lines: ["sh sh hs hs"] }],
    } });
    await importJson(app, "twice.json", set);
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue("twice");
    await expect(app.getByRole("status").filter({ hasText: "with warnings" })).toBeVisible();
    await app.getByRole("button", { name: /^1\s*A lesson/ }).click();
    await expect(heading(app, "1 · A lesson")).toBeVisible();
    await expect(app.getByRole("alert")).toHaveCount(0);
    const chars = app.getByRole("list", { name: "New characters" }).getByRole("listitem");
    await expect(chars).toHaveCount(3);
    await expect(chars.nth(0)).toHaveText(/^s\s*— /);
    await expect(chars.nth(1)).toHaveText(/^s\s*— /);
    await expect(chars.nth(2)).toHaveText("h");
    await expect(app.getByRole("list", { name: "Exercises" }).getByRole("button")).toHaveCount(1);
  } finally {
    await putBack(app, "twice");
  }
});

test("a long lesson title is cut short, the whole in a tooltip, in the list and over the typing area", async ({ app }) => {
  const lessonTitle = "A lesson whose title goes on ".repeat(4).trim(); // 115 characters, under the format's 120
  const exerciseTitle = "An exercise with a long title ".repeat(2).trim();
  try {
    await app.setViewportSize({ width: 375, height: 812 });
    await openSection(app, "Learning");
    await importJson(app, "long.json", await smallSet(app, "long", { lesson: {
      title: lessonTitle, exercises: [{ id: "e1", kind: "new-keys", title: exerciseTitle, lines: ["ss ss ss ss"] }],
    } }));
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue("long");
    const row = app.getByRole("list", { name: "Lessons of Set long" }).getByRole("button");
    await expect(row.locator(".title")).toHaveAttribute("title", lessonTitle);
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await row.click();
    await expect(app.locator("h1#learning-title")).toHaveAttribute("title", `1 · ${lessonTitle}`);
    await app.locator(".exercise").click();
    await expect(area(app)).toBeFocused();
    await expect(app.locator("h1#learning-title")).toHaveAttribute("title", `1 · ${lessonTitle} · ${exerciseTitle}`);
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
  } finally {
    await putBack(app, "long");
  }
});

test("the import lists the checker's errors, gone with the next import, and a taken file's warnings", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    const bad = await smallSet(app, "bad", { lesson: {
      exercises: [{ id: "e1", kind: "bogus", title: "An exercise", lines: ["ss ss"] }],
    } });
    await importJson(app, "bad.json", bad);
    const errors = app.getByRole("alert").filter({ hasText: "bad.json wasn't imported:" });
    await expect(errors).toBeVisible();
    await expect(errors.getByRole("listitem").filter({ hasText: "unknown kind 'bogus'" })).toHaveCount(1);
    await expect(app.getByRole("option", { name: /^Set bad/ })).toHaveCount(0);
    await importExample(app);
    await expect(errors).toHaveCount(0);

    await importJson(app, "warned.json", await smallSet(app, "warned", { hash: "sha256:0123456789abcdef" }));
    const warnings = app.getByRole("status").filter({ hasText: "warned.json was imported, with warnings:" });
    await expect(warnings).toBeVisible();
    await expect(warnings.getByRole("listitem").filter({ hasText: "differs from the export's hash" })).toHaveCount(1);
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue("warned");
    await expect(app.getByText("Built for another layout.")).toBeVisible();
  } finally {
    await putBack(app, "bad", "warned");
  }
});

test("the settings dialog refuses 120 % on the focused input; Escape gives the focus back to the gear", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    await app.locator("#learning-settings").click();
    const dialog = app.getByRole("dialog", { name: "Learning settings" });
    const accuracy = dialog.getByRole("spinbutton", { name: /Pass accuracy/ });
    await expect(accuracy).toBeFocused();
    await accuracy.fill("120");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(accuracy).toBeFocused();
    await expect(accuracy).toHaveAttribute("aria-invalid", "true");
    const problem = dialog.getByRole("alert");
    await expect(problem).toHaveText("The pass accuracy is a whole number from 50 to 100.");
    await expect(accuracy).toHaveAttribute("aria-describedby", (await problem.getAttribute("id")) ?? "none");
    await app.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(app.locator("#learning-settings")).toBeFocused();
    expect(await (await api(app).get("/api/learning/settings")).json()).toEqual(DEFAULT_SETTINGS);
  } finally {
    await putBack(app);
  }
});

test("no out-of-date banner before the export is read, and none once it is and the hash matches", async ({ app }) => {
  const banner = app.getByText("Built for another layout.");
  try {
    await importExample(app);
    await app.route(/\/api\/learning\/export(\?|$)/, async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ response });
    });
    await app.reload();
    await openSection(app, "Learning");
    const reading = app.getByText("Reading the lessons…");
    await expect(reading).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(reading).toBeHidden();
    await expect(app.getByRole("list", { name: `Lessons of ${example.title}` })).toBeVisible();
    await expect(banner).toHaveCount(0);
  } finally {
    await putBack(app);
  }
});

test("the Resting switch makes a key a resting one, saved at once, with the rest reach", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    await app.getByRole("button", { name: "Fingers…" }).click();
    await expect(app.getByText(/saved at once/)).toBeVisible();
    // a key that isn't a resting one, and isn't a thumb's (a resting thumb key keeps its reach)
    await app.locator('.board .key[aria-pressed="false"]:not([title*="thumb"])').first().click();
    const key = app.locator(".board .key.selected");
    await expect(key).toHaveAttribute("aria-pressed", "false");
    await app.getByRole("switch", { name: "Resting key" }).click();
    await expect(key).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByRole("combobox", { name: "Reach" })).toHaveValue("rest");
    await expect(app.getByText("A resting key's reach is rest: a pick of another reach goes back.")).toBeVisible();
    const fingers = await (await api(app).get("/api/learning/fingers")).json();
    expect(fingers.proposal).toBe(false);
    await expect(app.locator('.board .key[aria-pressed="true"]')).toHaveCount(fingers.home.length);
  } finally {
    await putBack(app);
  }
});

test("a failed read of the fingers offers Retry; a failed save puts the field back", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    await app.route(/\/api\/learning\/fingers(\?|$)/, (route) => route.fulfill(FAILING));
    await app.reload();
    await openSection(app, "Learning");
    await app.getByRole("button", { name: "Fingers…" }).click();
    const failed = app.getByRole("status").filter({ hasText: "The fingers couldn't be read." });
    await expect(failed).toBeVisible();
    const keys = app.locator(".board .key");
    await expect(keys.first()).toBeVisible();
    await expect(app.locator(".board .key.ringed")).toHaveCount(0);
    await app.unrouteAll();
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(failed).toHaveCount(0);
    await expect(app.locator(".board .key.ringed")).toHaveCount(await keys.count());

    await app.route(/\/api\/learning\/fingers(\?|$)/, (route) =>
      route.request().method() === "PUT" ? route.fulfill(FAILING) : route.fallback());
    await keys.first().click();
    const finger = app.getByRole("combobox", { name: "Finger" });
    const stored = await finger.inputValue();
    await finger.selectOption(stored === "thumb" ? "index" : "thumb");
    await expect(app.getByRole("region", { name: "Notifications" }).getByText(/^Saving the fingers failed/)).toBeVisible();
    await expect(finger).toHaveValue(stored);
    expect((await (await api(app).get("/api/learning/fingers")).json()).proposal).toBe(true);
  } finally {
    await putBack(app);
  }
});

test("a lesson link whose set can't be opened shows the list, with a note", async ({ app }) => {
  try {
    await importExample(app);
    await app.route(new RegExp(`/api/learning/sets/${SET}(\\?|$)`), (route) => route.fulfill(FAILING));
    await app.goto(serverUrl(app, `/#learning/${SET}/${lesson1.id}`));
    await app.reload();
    await expect(heading(app, "Learning")).toBeVisible();
    await expect(app.getByRole("status").filter({ hasText: `Lesson set ${SET} couldn't be opened.` })).toBeVisible();
    await expect(app).toHaveURL(/#learning$/);
    await expect(app.getByRole("list", { name: /^Lessons of/ })).toHaveCount(0);
  } finally {
    await putBack(app);
  }
});
