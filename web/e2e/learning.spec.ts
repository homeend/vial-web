import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, expect, keyIndex, openSection, restoreAll, screenshots, setCodeAt, test } from "./fixtures";

// The Learning page on the simulated Corne: the worked example imported, a lesson typed with the keyboard, the
// picture per exercise kind, the out-of-date banner, the Fingers view and its export, and the widths. Nothing here
// touches the keyboard but the one key the out-of-date test moves and puts back; the lesson set, the fingers and the
// settings are the server's files, put back after each test (the servers are shared by a worker's tests).

const EXAMPLE = fileURLToPath(new URL("../../docs/learning/examples/corne-sim-en.json", import.meta.url));
const example = JSON.parse(readFileSync(EXAMPLE, "utf-8")) as {
  id: string; title: string;
  lessons: { id: string; title: string; exercises: { id: string; kind: string; title: string; lines: string[] }[] }[];
};
const SET = example.id;
const [lesson1, lesson2] = example.lessons;
const DEFAULT_SETTINGS = { passAccuracy: 95, targetWpm: 30, pictureInWords: true };

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Imports the example through the page's Import button */
async function importExample(page: Page) {
  await openSection(page, "Learning");
  await page.locator('input[type="file"]').setInputFiles(EXAMPLE);
  // the server checks the file and builds the export: with every worker importing at once, over 5 s
  await expect(page.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET, { timeout: 15_000 });
}

/** Removes the set and its progress, the fingers and the settings: what the tests change on the server (the progress
 * outlives the set: left, it would show in the worker's next test) */
async function putBack(page: Page) {
  await restoreAll(
    async () => {
      const response = await api(page).delete(`/api/learning/sets/${SET}`);
      if (response.status() !== 204 && response.status() !== 404) throw new Error(`delete: ${response.status()}`);
    },
    () => api(page).delete(`/api/learning/progress/${SET}`),
    () => api(page).delete("/api/learning/fingers"),
    () => api(page).put("/api/learning/settings", DEFAULT_SETTINGS),
  );
}

/** Opens a lesson's exercise from the list */
async function openExercise(page: Page, lesson: { title: string }, exercise: { title: string }) {
  await page.getByRole("button", { name: new RegExp(`^\\d+\\s*${lesson.title}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`· ${lesson.title}$`) })).toBeVisible();
  // the row's name is its kind, title and best: the title alone tells the rows apart ("Key exercise 1" is in "New key
  // exercise 1" too)
  await page.locator(".exercise", { has: page.locator(".title", { hasText: new RegExp(`^${exercise.title}$`) }) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`· ${exercise.title}$`) })).toBeVisible();
  await expect(page.getByRole("application", { name: "Typing area" })).toBeFocused();
}

type ExerciseProgress = Record<string, { best: unknown; attempts: unknown[] } | undefined>;

/** The set's progress, by exercise id */
async function progressOf(page: Page): Promise<ExerciseProgress> {
  return (await (await api(page).get(`/api/learning/progress/${SET}`)).json()).exercises;
}

async function attemptsOf(page: Page, exercise: string): Promise<number> {
  return (await progressOf(page))[exercise]?.attempts.length ?? 0;
}

/** The state a lesson's row shows for the progress: "" or "n of m done". An exercise's results outlive the set (its
 * progress file stays for the set imported again), so a test of the worker run earlier may have done one. */
function rowState(lesson: (typeof example.lessons)[number], progress: ExerciseProgress): string {
  const main = lesson.exercises.filter((e) => ["new-keys", "keys", "words", "blind", "text"].includes(e.kind));
  const done = main.filter((e) => progress[e.id]?.best).length;
  if (done === main.length) throw new Error(`every main exercise of ${lesson.title} is done: the row would say passed`);
  return done === 0 ? "" : `${done} of ${main.length} done`;
}

test("Learning is the first section, a line under it, and Keymap still the one shown first", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("button").first()).toHaveText("Learning");
  await expect(nav.getByRole("button").nth(1)).toHaveText(/^Keymap/);
  await expect(nav.getByRole("button").nth(1)).toHaveAttribute("aria-current", "page"); // the default section
  await expect(app.getByRole("heading", { level: 1, name: "Keymap" })).toBeVisible();
  // the line sits between them, decoration only (not in the accessibility tree)
  const items = nav.locator("ul > li");
  await expect(items.nth(1)).toHaveClass(/line/);
  await expect(items.nth(1)).toHaveAttribute("aria-hidden", "true");
  await expect(nav.getByRole("listitem")).toHaveCount((await items.count()) - 1);
  expect(await items.nth(1).evaluate((el) => getComputedStyle(el).height)).toBe("1px");
  await screenshots(app, "learning-nav");
  // a narrow window wraps the sections into rows: the line takes a row of its own, 1 px tall, and nothing is hidden
  await app.setViewportSize({ width: 600, height: 800 });
  await expect(nav.getByRole("button").first()).toBeVisible();
  expect(await items.nth(1).evaluate((el) => el.getBoundingClientRect().height)).toBe(1);
  expect(await items.nth(1).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(300);
  await screenshots(app, "learning-nav-narrow");
});

test("the example imports, lists its lessons with empty states, and isn't out of date", async ({ app }) => {
  try {
    await importExample(app);
    await expect(app.getByRole("option", { name: example.title })).toHaveCount(1);
    const rows = app.getByRole("list", { name: `Lessons of ${example.title}` }).getByRole("button");
    await expect(rows).toHaveCount(example.lessons.length);
    const progress = await progressOf(app);
    for (const [i, lesson] of example.lessons.entries()) {
      await expect(rows.nth(i)).toHaveText(new RegExp(`^${i + 1}\\s*${lesson.title}\\s*${rowState(lesson, progress)}$`));
    }
    await expect(app.getByText("Built for another layout.")).toHaveCount(0);
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-list");
  } finally {
    await putBack(app);
  }
});

test("an import while the page's first read is still under way is listed and opened", async ({ app }) => {
  // the listing asked before the import doesn't know the set: its late answer must not put the list back as it was
  // (on a slow machine the page's read is still running when the file is chosen)
  await app.route(/\/api\/learning\/sets(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(); // asked now (before the import), answered late
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ response });
  });
  try {
    const listing = app.waitForResponse((r) => /\/api\/learning\/sets(\?.*)?$/.test(r.url()) && r.request().method() === "GET");
    await openSection(app, "Learning");
    await expect(app.getByText("Reading the lessons…")).toBeVisible(); // the first read is under way
    await app.locator('input[type="file"]').setInputFiles(EXAMPLE);
    await listing; // the late answer, listing nothing, has landed
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET, { timeout: 15_000 });
    await expect(app.getByRole("list", { name: `Lessons of ${example.title}` }).getByRole("button")).toHaveCount(
      example.lessons.length,
    );
    await expect(app.getByText("Reading the lessons…")).toHaveCount(0);
  } finally {
    await app.unrouteAll({ behavior: "ignoreErrors" });
    await putBack(app);
  }
});

test("typing lesson 1's first exercise passes it, records the attempt, and the lesson row says so", async ({ app }) => {
  const exercise = lesson1.exercises[0];
  try {
    await importExample(app);
    const before = await attemptsOf(app, exercise.id);
    await openExercise(app, lesson1, exercise);
    await expect(app.locator(".board")).toHaveCount(1);
    await app.keyboard.type(exercise.lines.join(" "));
    const result = app.getByRole("region", { name: "Passed" });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Accuracy100.0 %");
    await expect(result).toContainText("Errors0");
    await expect(result.getByRole("status")).toHaveText("Saved.");
    expect(await attemptsOf(app, exercise.id)).toBe(before + 1);
    const progress = await progressOf(app);
    const best = progress[exercise.id]!.best as { accuracy: number; chars: number };
    expect(best.accuracy).toBe(100);
    expect(best.chars).toBe(exercise.lines.join(" ").length);

    // back in the list: the lesson's main exercises done, this one among them
    const state = rowState(lesson1, progress);
    expect(state).toMatch(/^[1-9]\d* of \d+ done$/);
    await app.getByRole("button", { name: "Back to the lesson" }).first().click();
    await app.getByRole("button", { name: "Back to lessons" }).click();
    await expect(app.getByRole("button", { name: new RegExp(`^1\\s*${lesson1.title}`) })).toContainText(state);
  } finally {
    await putBack(app);
  }
});

test("a wrong key counts an error, and the right one goes on", async ({ app }) => {
  const exercise = lesson1.exercises[1];
  try {
    await importExample(app);
    await openExercise(app, lesson1, exercise);
    const text = exercise.lines.join(" ");
    const wrong = text[0] === "x" ? "q" : "x";
    await app.keyboard.type(wrong);
    await expect(app.locator(".run.wrong")).toHaveCount(1);
    await app.keyboard.type(text);
    const result = app.getByRole("region", { name: "Passed" });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Errors1");
    const accuracy = await result.locator("dd").first().textContent();
    expect(parseFloat(accuracy ?? "100")).toBeLessThan(100);
    expect(parseFloat(accuracy ?? "0")).toBeGreaterThan(95);
    await expect(result.getByRole("status")).toHaveText("Saved.");
  } finally {
    await putBack(app);
  }
});

test("a blind exercise hides the picture; a keys exercise shows it with the next key lit", async ({ app }) => {
  const blind = lesson2.exercises.find((e) => e.kind === "blind")!;
  const keys = lesson1.exercises.find((e) => e.kind === "keys")!;
  try {
    await importExample(app);
    await openExercise(app, lesson2, blind);
    await expect(app.locator(".board")).toHaveCount(0);
    await app.keyboard.press("Escape");
    await expect(app.getByRole("heading", { level: 1, name: new RegExp(`· ${lesson2.title}$`) })).toBeVisible();
    await app.getByRole("button", { name: "Back to lessons" }).click();

    await openExercise(app, lesson1, keys);
    await expect(app.locator(".board")).toHaveCount(1);
    await expect(app.locator(".board .key.found")).toHaveCount(1);
    await expect(app.locator(".board .key.faded").first()).toBeVisible();
    await expect(app.getByText(/^Next: /)).toBeVisible();
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-typing");
  } finally {
    await putBack(app);
  }
});

test("a set built for another character map is out of date", async ({ app }) => {
  const index = await keyIndex(app, 1, 1);
  const before = (await (await api(app).get("/api/keyboard")).json()).layers[0].keys[index].code as string;
  try {
    await importExample(app);
    await expect(app.getByText("Built for another layout.")).toHaveCount(0);
    await setCodeAt(app, 0, index, "KC_Q");
    // the page shown again reads the export again: no reload needed
    await openSection(app, "Keymap");
    await openSection(app, "Learning");
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET);
    await expect(app.getByText("Built for another layout.")).toBeVisible();
    // and after a reload, from the server's listing
    await app.reload();
    await openSection(app, "Learning");
    await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET);
    await expect(app.getByText("Built for another layout.")).toBeVisible();
  } finally {
    await restoreAll(() => setCodeAt(app, 0, index, before), () => putBack(app));
  }
});

test("the Fingers view rings every key by finger, and the export downloads the layout", async ({ app }) => {
  try {
    await openSection(app, "Learning");
    await app.getByRole("button", { name: "Fingers…" }).click();
    await expect(app.getByRole("heading", { level: 1, name: "Fingers" })).toBeVisible();
    const keys = app.locator(".board .key");
    await expect(keys.first()).toBeVisible();
    await expect(app.locator(".board .key.ringed")).toHaveCount(await keys.count()); // once the fingers are read
    expect(await app.locator('.board .key[aria-pressed="true"]').count()).toBeGreaterThan(0);

    // a key's finger changed, saved; back to the proposal
    await keys.first().click();
    await app.getByRole("combobox", { name: "Finger" }).selectOption("thumb");
    await expect.poll(async () => (await (await api(app).get("/api/learning/fingers")).json()).proposal).toBe(false);
    await app.getByRole("button", { name: "Reset to proposal" }).click();
    await app.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await expect.poll(async () => (await (await api(app).get("/api/learning/fingers")).json()).proposal).toBe(true);

    const waiting = app.waitForEvent("download");
    await app.getByRole("button", { name: "Export" }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe("Simulated Corne-layout-export.json");
    const text = readFileSync((await download.path())!, "utf-8");
    const layout = JSON.parse(text);
    expect(layout.format).toBe("vial-web-layout-export/1");
    expect(layout.keys.length).toBeGreaterThan(0);
    await expect(app.getByRole("status").filter({ hasText: "generate-lessons" })).toBeVisible();
    expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    await screenshots(app, "learning-fingers");
  } finally {
    await putBack(app);
  }
});

for (const [width, height] of [[800, 900], [375, 812]] as const) {
  test(`${width} x ${height}: the list and the typing view have no sideways scroll`, async ({ app }) => {
    const exercise = lesson1.exercises[0];
    try {
      await app.setViewportSize({ width, height });
      await importExample(app);
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
      await openExercise(app, lesson1, exercise);
      await expect(app.locator(".board")).toHaveCount(1);
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
      await app.getByRole("button", { name: "Back to the lesson" }).click();
      await app.getByRole("button", { name: "Back to lessons" }).click();
      await app.getByRole("button", { name: "Fingers…" }).click();
      await expect(app.locator(".board .key").first()).toBeVisible();
      expect(await sidewaysScroll(app)).toBeLessThanOrEqual(0);
    } finally {
      await putBack(app);
    }
  });
}

test("1920 x 950: the typing view with the picture and six lines of text fits the window", async ({ app }) => {
  const text = lesson2.exercises.find((e) => e.kind === "text")!;
  try {
    await app.setViewportSize({ width: 1920, height: 950 });
    await importExample(app);
    await openExercise(app, lesson2, text);
    const board = (await app.locator(".board").boundingBox())!;
    expect(board.y).toBeGreaterThanOrEqual(0);
    expect(board.y + board.height).toBeLessThanOrEqual(950);
    const area = (await app.getByRole("application", { name: "Typing area" }).boundingBox())!;
    expect(area.y + area.height).toBeLessThanOrEqual(950);
    // the text's lines one under another, at most six in view
    await expect(app.locator(".text br")).toHaveCount(text.lines.length - 1);
  } finally {
    await putBack(app);
  }
});
