import { test as base, expect, type Page } from "@playwright/test";

async function open(page: Page, url: string | undefined): Promise<Page> {
  if (!url) throw new Error("the global setup did not start the server");
  await page.goto(url); // the link with the token sets the session cookie
  await expect(page.locator("button.key").first()).toBeVisible();
  return page;
}

/** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
 * simulated macropad with encoders */
export const test = base.extend<{ app: Page; macropad: Page }>({
  app: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_URL));
  },
  macropad: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_MACROPAD_URL));
  },
});

export { expect };

/** A URL of the server the page shows: the requests of page.request carry the page's session cookie */
export function serverUrl(page: Page, path: string): string {
  return new URL(path, page.url()).toString();
}

async function keyboardModel(page: Page) {
  return (await page.request.get(serverUrl(page, "/api/keyboard"))).json();
}

/** Index of the key at a matrix position in the keyboard model */
export async function keyIndex(page: Page, row: number, col: number): Promise<number> {
  const model = await keyboardModel(page);
  const index = model.keys.findIndex((k: { row: number; col: number }) => k.row === row && k.col === col);
  if (index < 0) throw new Error(`no key at row ${row}, column ${col}`);
  return index;
}

/** The keycode the server reports for a key on a layer */
export async function codeAt(page: Page, layer: number, index: number): Promise<string> {
  return (await keyboardModel(page)).layers[layer].keys[index].code;
}

/** The keycode the server reports for an encoder direction on a layer */
export async function encoderCodeAt(page: Page, layer: number, index: number): Promise<string> {
  return (await keyboardModel(page)).layers[layer].encoders[index].code;
}

/** Screenshots of the page in the light and the dark theme (the app follows the system's): <name>-light.png and
 * <name>-dark.png in e2e/screenshots/ */
export async function screenshots(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // animations "disabled" finishes colour transitions, which the switch of theme just started
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, animations: "disabled", ...options });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** The key labels that don't fit on their key. Tap dance and macro names wrap to two lines and shrink, and the main
 * legend makes room for them, rather than anything being cut off. (A line that is cut off shows as a whole line of
 * overflow; letters reaching a little past their line box, a few pixels, don't count.) */
export async function labelsCutOff(page: Page): Promise<string[]> {
  const labels = page.locator("button.key .hold, button.key .tap, button.key .shifted");
  const cut = await labels.evaluateAll((elements) => elements.filter((l) => {
    const key = l.closest("button")!.querySelector(".legend")!.getBoundingClientRect();
    const box = l.getBoundingClientRect();
    const font = parseFloat(getComputedStyle(l).fontSize);
    return l.scrollHeight - l.clientHeight > font * 0.3 || l.scrollWidth > l.clientWidth + 1 ||
      box.bottom > key.bottom + 1 || box.top < key.top - 1;
  }).map((l) => l.textContent ?? ""));
  return cut;
}
