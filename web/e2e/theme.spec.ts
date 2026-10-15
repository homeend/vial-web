import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LIGHT_BG = "rgb(243, 244, 247)"; // --bg of the light palette
const DARK_BG = "rgb(16, 18, 23)"; // --bg of the dark palette

// the colour the background settles on: colour transitions are finished first, so a read in the middle of one can't
// pass for the end colour
const background = (page: Page) => page.evaluate(() => {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
  return getComputedStyle(document.body).backgroundColor;
});

test("the theme can be chosen, and the choice is kept", async ({ app }) => {
  const problems: string[] = [];
  app.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await app.emulateMedia({ colorScheme: "light" });
  const theme = app.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
  await expect.poll(() => background(app)).toBe(LIGHT_BG);

  await theme.getByRole("radio", { name: "Dark" }).check();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => background(app)).toBe(DARK_BG);

  // applied by index.html before the first paint (the Content-Security-Policy lets that inline script run)
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => background(app)).toBe(DARK_BG);
  await expect(app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Light" }).check();
  await app.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(app)).toBe(LIGHT_BG); // a chosen theme wins over the system's

  await app.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "System" }).check();
  await expect(app.locator("html")).not.toHaveAttribute("data-theme");
  await expect.poll(() => background(app)).toBe(DARK_BG); // the system's again
  expect(problems.filter((p) => /Content Security Policy/i.test(p))).toEqual([]);
});
