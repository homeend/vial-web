import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, expect, openSection, restoreAll, screenshots, test } from "./fixtures";

// The "Generate a lesson set" section of the Learning page: unfolded while the keyboard has no lesson set, folded once
// it has one, the two recipes, the prompt read out of the real PROMPT.md, the file list served by the app, and the
// generator pack downloaded with this keyboard's export in it. Nothing touches the keyboard.

const EXAMPLE = fileURLToPath(new URL("../../docs/learning/examples/corne-sim-en.json", import.meta.url));
const SET = (JSON.parse(readFileSync(EXAMPLE, "utf-8")) as { id: string }).id;
const FILES = ["PROMPT.md", "GENERATE.md", "lesson-rules.md", "lesson-format.md", "lesson-set.schema.json",
  "corne-sim-en.json", "corne-sim-layout-export.json", "ansi-60-en.json", "course-method.md", "SKILL.md"];
const PACKED = FILES.slice(0, 6);

async function putBack(page: Page) {
  await restoreAll(
    async () => {
      const response = await api(page).delete(`/api/learning/sets/${SET}`);
      if (response.status() !== 204 && response.status() !== 404) throw new Error(`delete: ${response.status()}`);
    },
    () => api(page).delete(`/api/learning/progress/${SET}`),
  );
}

test("the Generate section is unfolded without a set, shows both recipes and the prompt, and folds once a set is imported",
  async ({ app }) => {
    try {
      await openSection(app, "Learning");
      const section = app.locator("#generate-lessons");
      await expect(section).toBeVisible();
      await expect(section).toHaveJSProperty("open", true); // no lesson set yet
      await expect(section.getByRole("heading", { level: 3, name: "With a chat LLM (Claude, ChatGPT, Gemini…)" })).toBeVisible();
      await expect(section.getByRole("heading", { level: 3, name: "With Claude Code or another agent that runs programs" })).toBeVisible();
      // the prompt of the real docs/learning/PROMPT.md, served by this Vial
      await expect(section.locator("pre")).toContainText("You write a touch-typing course for my keyboard.");
      await expect(section.locator("pre")).toContainText("Follow GENERATE.md step by step.");
      await expect(section.getByRole("button", { name: "Copy the prompt" })).toBeEnabled();
      await screenshots(app, "learning-generate", { fullPage: true });
      // the file list, in the server's order, each a link to the server with the pack ones marked
      const items = section.getByRole("list", { name: "Generator files" }).getByRole("listitem");
      await expect(items).toHaveCount(FILES.length);
      for (const [i, name] of FILES.entries()) {
        const item = items.nth(i);
        await expect(item.getByRole("link")).toHaveText(name);
        await expect(item.getByRole("link")).toHaveAttribute("href", `/api/learning/generator/${name}`);
        await expect(item.locator(".tag")).toHaveCount(PACKED.includes(name) ? 1 : 0);
      }
      await expect(items.nth(7)).toContainText("18 lessons");
      // the agent recipe links the skill file; the empty state points at the section
      await expect(section.getByRole("link", { name: "SKILL.md" }).first()).toHaveAttribute("href", "/api/learning/generator/SKILL.md");
      await expect(app.locator(".empty")).toContainText("Generate a lesson set");

      // every file downloads from this server, as an attachment of its name
      for (const name of FILES) {
        const response = await api(app).get(`/api/learning/generator/${name}`);
        expect(response.status(), name).toBe(200);
        expect(response.headers()["content-disposition"], name).toBe(`attachment; filename="${name}"`);
      }

      // the pack: a zip named after the keyboard, with the packed files and this keyboard's export in it
      const waiting = app.waitForEvent("download");
      await section.locator("#generator-pack").click();
      const download = await waiting;
      expect(download.suggestedFilename()).toBe("Simulated Corne-lesson-generator.zip");
      const bytes = readFileSync((await download.path())!);
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      const names = bytes.toString("latin1"); // a zip stores its file names as they are
      for (const name of [...PACKED, "layout-export.json"]) expect(names, name).toContain(name);
      expect(names).not.toContain("ansi-60-en.json");
      // the page is still the list, unfolded (a download leaves the page)
      await expect(section).toHaveJSProperty("open", true);

      // a set imported: the section folds; the user can unfold it again
      await app.locator('input[type="file"]').setInputFiles(EXAMPLE);
      await expect(app.getByRole("combobox", { name: "Lesson set" })).toHaveValue(SET, { timeout: 15_000 });
      await expect(section).toHaveJSProperty("open", false);
      await expect(section.getByRole("heading", { level: 3 })).toHaveCount(0);
      await section.locator("summary").click();
      await expect(section).toHaveJSProperty("open", true);
      await expect(section.locator("pre")).toContainText("You write a touch-typing course");
    } finally {
      await putBack(app);
    }
  });

test("375 px: the unfolded Generate section has no sideways scroll", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 812 });
  await openSection(app, "Learning");
  const section = app.locator("#generate-lessons");
  await expect(section).toHaveJSProperty("open", true);
  await expect(section.locator("pre")).toContainText("You write");
  await expect(section.getByRole("list", { name: "Generator files" }).getByRole("listitem")).toHaveCount(FILES.length);
  expect(await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});
