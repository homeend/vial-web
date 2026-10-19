import { test as base, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** e2e/screenshots/, wherever the tests are run from */
const SCREENSHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));

/** Opens a server's link and waits for the keyboard to be drawn */
export async function open(page: Page, url: string | undefined): Promise<Page> {
  if (!url) throw new Error("the global setup did not start the server");
  await page.goto(url); // the link with the token sets the session cookie
  await expect(page.locator("button.key").first()).toBeVisible();
  return page;
}

/** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
 * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty) */
export const test = base.extend<{ app: Page; macropad: Page; eightLayers: Page }>({
  app: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_URL));
  },
  macropad: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_MACROPAD_URL));
  },
  eightLayers: async ({ page }, use) => {
    await use(await open(page, process.env.VIAL_EIGHT_LAYERS_URL));
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

async function put(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.put(serverUrl(page, path), { data });
  if (!response.ok()) throw new Error(`PUT ${path} failed: ${response.status()} ${await response.text()}`);
}

/** Sets a key on a layer through the API: tests put back what they changed, as the servers are shared */
export async function setCodeAt(page: Page, layer: number, index: number, code: string): Promise<void> {
  const { row, col } = (await keyboardModel(page)).keys[index];
  await put(page, `/api/keymap/${layer}/${row}/${col}`, { code });
}

/** Sets an encoder direction on a layer through the API, `index` as in encoderCodeAt */
export async function setEncoderCodeAt(page: Page, layer: number, index: number, code: string): Promise<void> {
  const { encoder, direction } = (await keyboardModel(page)).encoders[index];
  await put(page, `/api/encoders/${layer}/${encoder}/${direction}`, { code });
}

/** A combo's keycodes (all four slots) and output, as the server reports them */
export async function comboAt(page: Page, index: number): Promise<{ keys: string[]; output: string }> {
  const combo = (await keyboardModel(page)).combos[index];
  return { keys: combo.keys.map((k: { code: string }) => k.code), output: combo.output.code };
}

/** Sets a combo through the API: four keycodes (KC_NO for an empty slot) and the output */
export async function setCombo(page: Page, index: number, combo: { keys: string[]; output: string }): Promise<void> {
  await put(page, `/api/combos/${index}`, combo);
}

/** The custom name of a layer, or null when it has its default name */
export async function layerNameOf(page: Page, layer: number): Promise<string | null> {
  const names = await (await page.request.get(serverUrl(page, "/api/names"))).json();
  return names.layers?.[String(layer)] ?? null;
}

/** Names a layer through the API; null gives it its default name back */
export async function setLayerName(page: Page, layer: number, name: string | null): Promise<void> {
  await put(page, `/api/names/layers/${layer}`, { name });
}

/** Screenshots of the page in the light and the dark theme (the app follows the system's): <name>-light.png and
 * <name>-dark.png in e2e/screenshots/ */
export async function screenshots(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // animations "disabled" finishes colour transitions, which the switch of theme just started
    await page.screenshot({ path: join(SCREENSHOTS, `${name}-${scheme}.png`), animations: "disabled", ...options });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** Makes the page draw all its text in a font family from the start, before the app first measures text, as a
 * system with other fonts would (call it before opening the page) */
export async function useFont(page: Page, family: string): Promise<void> {
  await page.addInitScript((font) => {
    const apply = () => document.documentElement.style.setProperty("--font", font, "important");
    if (document.documentElement) {
      apply();
      return;
    }
    // the script may run before the document has its root element
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      apply();
      observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }, family);
}

/** The key labels that don't fit on their key. Tap dance and macro names wrap to two lines and shrink, and the main
 * legend makes room for them, rather than anything being cut off. (A line that is cut off shows as a whole line of
 * overflow; letters reaching a little past their line box, a few pixels, don't count.) */
export async function labelsCutOff(page: Page): Promise<string[]> {
  // the keys of the Edit view (buttons) and of the Overview's small keyboards (pictures)
  const labels = page.locator(".key .hold, .key .tap, .key .shifted");
  const cut = await labels.evaluateAll((elements) => elements.filter((l) => {
    const key = l.closest(".key")!.querySelector(".legend")!.getBoundingClientRect();
    const box = l.getBoundingClientRect();
    const font = parseFloat(getComputedStyle(l).fontSize);
    return l.scrollHeight - l.clientHeight > font * 0.3 || l.scrollWidth > l.clientWidth + 1 ||
      box.bottom > key.bottom + 1 || box.top < key.top - 1;
  }).map((l) => l.textContent ?? ""));
  return cut;
}

/** The fake server's test hook: the user holds the simulated keyboard's unlock keys (or lets go), or it is locked */
export async function simulatorUnlock(page: Page, change: { keysHeld?: boolean; locked?: boolean }): Promise<void> {
  await put(page, "/api/simulator/unlock", change);
}

/** The keyboard's unlock state, as the server tells */
export async function unlockState(page: Page): Promise<string> {
  return (await (await page.request.get(serverUrl(page, "/api/session"))).json()).unlock.state;
}
