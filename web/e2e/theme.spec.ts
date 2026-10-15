import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LIGHT_BG = "rgb(243, 244, 247)"; // --bg of the light palette
const DARK_BG = "rgb(16, 18, 23)"; // --bg of the dark palette

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeAttribute = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test("the theme can be chosen, and the choice is kept", async ({ app }) => {
  const problems: string[] = [];
  app.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await app.emulateMedia({ colorScheme: "light" });
  const theme = app.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
  expect(await background(app)).toBe(LIGHT_BG);

  await theme.getByRole("radio", { name: "Dark" }).check();
  expect(await themeAttribute(app)).toBe("dark");
  expect(await background(app)).toBe(DARK_BG);

  // applied by index.html before the first paint (the Content-Security-Policy lets that inline script run)
  await app.reload();
  expect(await themeAttribute(app)).toBe("dark");
  expect(await background(app)).toBe(DARK_BG);
  await expect(app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Light" }).check();
  await app.emulateMedia({ colorScheme: "dark" });
  expect(await background(app)).toBe(LIGHT_BG); // a chosen theme wins over the system's

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "System" }).check();
  expect(await themeAttribute(app)).toBeNull();
  expect(await background(app)).toBe(DARK_BG); // the system's again
  expect(problems.filter((p) => /Content Security Policy/i.test(p))).toEqual([]);
});
