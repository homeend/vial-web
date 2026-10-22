import { test as base, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lighting } from "../src/api/types";
import { SERVER_FIXTURE_MS, SERVERS, startServer, type TestServer } from "./servers";

/** e2e/screenshots/, wherever the tests are run from */
const SCREENSHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));

/** Opens a server's link and waits for the keyboard to be drawn */
export async function open(page: Page, url: string): Promise<Page> {
  await page.goto(url); // the link with the token sets the session cookie
  await expect(page.locator("button.key").first()).toBeVisible();
  return page;
}

/** A simulated keyboard's server, started the first time a test of the worker asks for it and stopped when the
 * worker ends: the worker's tests run one at a time, so no two tests running at once share a keyboard */
function serverOf(
  args: string[],
): [(args: object, use: (url: string) => Promise<void>) => Promise<void>, { scope: "worker"; timeout: number }] {
  return [
    async ({}, use: (url: string) => Promise<void>) => {
      const server = await startServer(args);
      try {
        await use(server.url);
      } finally {
        await server.stop();
      }
    },
    { scope: "worker", timeout: SERVER_FIXTURE_MS },
  ];
}

/** The page, opened from a server's link, with the keyboard drawn: `app` shows the simulated Corne, `macropad` the
 * simulated macropad with encoders, `eightLayers` the simulated Corne with 8 layers (4-7 empty), `twentyLayers` with 20
 * layers (4-19 empty), `qmkLighting` the
 * simulated Corne with QMK's RGB light and backlight, `twoKeyboards` the simulated Corne of a server whose second
 * keyboard (the macropad) is plugged in by secondKeyboard(). `corneUrl` is the simulated Corne's link, for a test that
 * opens it itself. `ownServer` is a simulated Corne's server of the test's own, started for it and stopped after it,
 * for a test that ends it (Quit Vial). */
export const test = base.extend<
  {
    app: Page; macropad: Page; eightLayers: Page; twentyLayers: Page; qmkLighting: Page; twoKeyboards: Page;
    ownServer: TestServer;
  },
  {
    corneUrl: string; macropadUrl: string; eightLayersUrl: string; twentyLayersUrl: string; qmkLightingUrl: string;
    twoKeyboardsUrl: string;
  }
>({
  corneUrl: serverOf(SERVERS.corne),
  macropadUrl: serverOf(SERVERS.macropad),
  eightLayersUrl: serverOf(SERVERS.eightLayers),
  twentyLayersUrl: serverOf(SERVERS.twentyLayers),
  qmkLightingUrl: serverOf(SERVERS.qmkLighting),
  twoKeyboardsUrl: serverOf(SERVERS.twoKeyboards),
  app: async ({ page, corneUrl }, use) => {
    await use(await open(page, corneUrl));
  },
  macropad: async ({ page, macropadUrl }, use) => {
    await use(await open(page, macropadUrl));
  },
  eightLayers: async ({ page, eightLayersUrl }, use) => {
    await use(await open(page, eightLayersUrl));
  },
  twentyLayers: async ({ page, twentyLayersUrl }, use) => {
    await use(await open(page, twentyLayersUrl));
  },
  qmkLighting: async ({ page, qmkLightingUrl }, use) => {
    await use(await open(page, qmkLightingUrl));
  },
  twoKeyboards: async ({ page, twoKeyboardsUrl }, use) => {
    await use(await open(page, twoKeyboardsUrl));
  },
  ownServer: [
    async ({}, use) => {
      const server = await startServer(SERVERS.corne);
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { timeout: SERVER_FIXTURE_MS },
  ],
});

export { expect };

/** A URL of the server the page shows: the requests of page.request carry the page's session cookie */
export function serverUrl(page: Page, path: string): string {
  return new URL(path, page.url()).toString();
}

/** The server's API, with the page's session: each request on a connection of its own. The server closes a connection
 * left idle for 5 s, and a request sent on it just then fails (ECONNRESET): a browser sends it again, Playwright's
 * requests don't. */
export function api(page: Page) {
  const headers = { connection: "close" };
  return {
    get: (path: string) => page.request.get(serverUrl(page, path), { headers }),
    put: (path: string, data: unknown) => page.request.put(serverUrl(page, path), { data, headers }),
    post: (path: string, data?: unknown) => page.request.post(serverUrl(page, path), { data, headers }),
    delete: (path: string) => page.request.delete(serverUrl(page, path), { headers }),
  };
}

async function keyboardModel(page: Page) {
  return (await api(page).get("/api/keyboard")).json();
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
  const response = await api(page).put(path, data);
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
  return nameOf(page, "layers", layer);
}

/** The custom name of a layer, tap dance or macro, or null when it has its default name */
export async function nameOf(page: Page, kind: "layers" | "tapDance" | "macros", index: number): Promise<string | null> {
  const names = await (await api(page).get("/api/names")).json();
  return names[kind]?.[String(index)] ?? null;
}

/** Names a layer through the API; null gives it its default name back */
export async function setLayerName(page: Page, layer: number, name: string | null): Promise<void> {
  await setNameOf(page, "layers", layer, name);
}

/** Names a layer, tap dance or macro through the API; null gives it its default name back */
export async function setNameOf(page: Page, kind: "layers" | "tapDance" | "macros", index: number,
  name: string | null): Promise<void> {
  await put(page, `/api/names/${kind}/${index}`, { name });
}

/** Runs every one of a test's restores, even after one fails, then fails with the first failure (each is reported) */
export async function restoreAll(...restores: (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const restore of restores) {
    try {
      await restore();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${failures.length} restores failed`);
}

/** Screenshots of the page in the light and the dark theme (the app follows the system's): <name>-light.png and
 * <name>-dark.png in e2e/screenshots/. A full-page one is taken from the top, with sticky elements (the top bar, the
 * macro editor's footer) where they are in the page: the browser would draw them where the window was scrolled to,
 * over what is there. The scroll position is put back afterwards. */
export async function screenshots(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  const unstuck = options.fullPage ? await unstick(page) : null;
  try {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // animations "disabled" finishes colour transitions, which the switch of theme just started
      await page.screenshot({ path: join(SCREENSHOTS, `${name}-${scheme}.png`), animations: "disabled", ...options });
    }
    await page.emulateMedia({ colorScheme: null });
  } finally {
    await unstuck?.();
  }
}

/** Scrolls to the top and makes every sticky element static; returns what undoes both */
async function unstick(page: Page): Promise<() => Promise<void>> {
  const scrolled = await page.evaluate(() => {
    const at = { x: window.scrollX, y: window.scrollY };
    window.scrollTo(0, 0);
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (getComputedStyle(element).position === "sticky") element.setAttribute("data-shot-unstuck", "");
    }
    const style = document.createElement("style");
    style.id = "shot-unstuck";
    style.textContent = "[data-shot-unstuck] { position: static !important; }";
    document.head.append(style);
    return at;
  });
  return async () => {
    await page.evaluate((at) => {
      document.getElementById("shot-unstuck")?.remove();
      for (const element of Array.from(document.querySelectorAll("[data-shot-unstuck]"))) {
        element.removeAttribute("data-shot-unstuck");
      }
      window.scrollTo(at.x, at.y);
    }, scrolled);
  };
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

/** A tap dance's slots and tapping term, as the server takes them */
export async function tapDanceAt(page: Page, index: number) {
  const td = (await keyboardModel(page)).tapDance[index];
  return { tap: td.tap.code, hold: td.hold.code, doubleTap: td.doubleTap.code, tapHold: td.tapHold.code,
    tappingTerm: td.tappingTerm };
}

/** Sets a tap dance through the API */
export async function setTapDance(page: Page, index: number, body: Awaited<ReturnType<typeof tapDanceAt>>) {
  await put(page, `/api/tap-dance/${index}`, body);
}

/** Every macro's steps, as the server takes them */
export async function macrosOf(page: Page): Promise<unknown[][]> {
  const model = await keyboardModel(page);
  return model.macros.items.map((m: { actions: { type: string; text: string | null; keys: { code: string }[];
    delay: number | null }[] }) => m.actions.map((a) => ({ ...a, keys: a.keys.map((k) => k.code) })));
}

/** Sets every macro through the API (the simulated keyboard must be unlocked) */
export async function setMacros(page: Page, items: unknown[][]): Promise<void> {
  await put(page, "/api/macros", { items });
}

/** The fake server's test hook: the user holds the simulated keyboard's unlock keys (or lets go), or it is locked */
export async function simulatorUnlock(page: Page, change: { keysHeld?: boolean; locked?: boolean }): Promise<void> {
  await put(page, "/api/simulator/unlock", change);
}

/** The keyboard's unlock state, as the server tells */
export async function unlockState(page: Page): Promise<string> {
  return (await (await api(page).get("/api/session")).json()).unlock.state;
}

/** Locks the keyboard from the top bar and starts unlocking it there: the unlock dialog shows */
export async function openUnlockDialog(page: Page) {
  await page.getByRole("button", { name: "Keyboard unlocked: lock it" }).click();
  await page.getByRole("button", { name: "Keyboard locked: unlock it" }).click();
  const dialog = page.getByRole("dialog", { name: "Unlock the keyboard" });
  await expect(dialog).toBeVisible();
  expect(await unlockState(page)).toBe("unlocking");
  return dialog;
}

/** Lets go of the unlock keys, and unlocks the simulated keyboard again if it isn't (the fake server keeps the
 * firmware's timing: about 2 s with the tests' countdown, see servers.ts) */
export async function unlockAgain(page: Page): Promise<void> {
  await simulatorUnlock(page, { keysHeld: false });
  if ((await unlockState(page)) === "unlocked") return;
  // the simulator counts down while the keys are held
  await simulatorUnlock(page, { keysHeld: true });
  await api(page).post("/api/unlock/start");
  await expect.poll(() => unlockState(page), { timeout: 20_000 }).toBe("unlocked");
  await simulatorUnlock(page, { keysHeld: false });
}

/** A key override as the server takes it */
export async function keyOverrideAt(page: Page, index: number) {
  const o = (await keyboardModel(page)).keyOverrides[index];
  return { trigger: o.trigger.code, replacement: o.replacement.code, layers: o.layers, triggerMods: o.triggerMods,
    negativeModMask: o.negativeModMask, suppressedMods: o.suppressedMods, options: o.options };
}

/** Sets a key override through the API */
export async function setKeyOverride(page: Page, index: number, body: Awaited<ReturnType<typeof keyOverrideAt>>) {
  await put(page, `/api/key-overrides/${index}`, body);
}

/** An alt-repeat key as the server takes it */
export async function altRepeatAt(page: Page, index: number) {
  const a = (await keyboardModel(page)).altRepeatKeys[index];
  return { keycode: a.keycode.code, altKeycode: a.altKeycode.code, allowedMods: a.allowedMods, options: a.options };
}

/** Sets an alt-repeat key through the API */
export async function setAltRepeat(page: Page, index: number, body: Awaited<ReturnType<typeof altRepeatAt>>) {
  await put(page, `/api/alt-repeat/${index}`, body);
}

/** The keyboard's QMK settings, by qsid */
export async function settingsOf(page: Page): Promise<Record<number, number>> {
  const settings: { qsid: number; value: number }[] = (await keyboardModel(page)).settings;
  return Object.fromEntries(settings.map((s) => [s.qsid, s.value]));
}

/** Puts QMK settings back through the API, those that differ */
export async function setSettings(page: Page, settings: Record<number, number>): Promise<void> {
  const now = await settingsOf(page);
  for (const [qsid, value] of Object.entries(settings)) {
    if (now[Number(qsid)] !== value) await put(page, `/api/qmk-settings/${qsid}`, { value });
  }
}

/** The keyboard's lighting, as the server reports it. A test knows which kinds its keyboard has, so every kind is
 * typed as there: one the keyboard hasn't is null all the same. */
export async function lightingOf(page: Page): Promise<{ [K in keyof Lighting]-?: NonNullable<Lighting[K]> }> {
  return (await keyboardModel(page)).lighting;
}

/** Changes the lighting through the API (shown, not saved): tests put back what they changed */
export async function setLighting(page: Page, body: unknown): Promise<void> {
  await put(page, "/api/lighting", body);
}

/** The fake server's test hook: a key of the simulated keyboard's matrix is pressed, or let go */
export async function pressKey(page: Page, row: number, col: number, pressed = true): Promise<void> {
  await put(page, "/api/simulator/matrix", { row, col, pressed });
}

/** The fake server's test hook: the simulated keyboard is plugged in, or unplugged */
export async function plugIn(page: Page, connected: boolean): Promise<void> {
  await put(page, "/api/simulator/connection", { connected });
}

/** The fake server's test hook: its second simulated keyboard is plugged in (unreadable: with firmware this Vial can't
 * read), or unplugged */
export async function secondKeyboard(page: Page, connected: boolean, unreadable = false): Promise<void> {
  await put(page, "/api/simulator/second-keyboard", { connected, unreadable });
}

/** Shows a section from the navigation and waits for its heading */
export async function openSection(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}
