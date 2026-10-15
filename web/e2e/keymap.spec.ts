import { codeAt, expect, keyIndex, layerNameOf, screenshots, serverUrl, setCodeAt, setLayerName, test } from "./fixtures";

// The server is shared by every test: a test that changes a key or a name puts it back in its `finally`

test("loads the simulated Corne and draws its 42 keys", async ({ app }) => {
  await expect(app.locator(".topbar")).toContainText("Simulated Corne");
  await expect(app.locator(".topbar")).toContainText("simulated keyboard");
  await expect(app.locator("button.key")).toHaveCount(42);
});

test("picking a keycode from the search changes the key on the keyboard", async ({ app }) => {
  const index = await keyIndex(app, 0, 1); // base layer: W with Gui on hold
  const before = await codeAt(app, 0, index);
  try {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await key.click();
    await app.getByRole("button", { name: "Change key" }).click();
    const picker = app.getByRole("dialog");
    await expect(picker).toBeVisible();
    await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("esc");
    await picker.getByRole("button", { name: "Esc (KC_ESCAPE)" }).click();
    await expect(picker).toBeHidden();
    await expect(key).toContainText("Esc");
    expect(await codeAt(app, 0, index)).toBe("KC_ESCAPE");
  } finally {
    await setCodeAt(app, 0, index, before);
  }
});

test("the keyboard shortcuts select, change and clear keys", async ({ app }) => {
  const first = await keyIndex(app, 1, 1);
  const next = await keyIndex(app, 1, 2);
  const before = await codeAt(app, 0, next);
  try {
    await app.locator(`[data-ref="key:${first}"]`).click();
    await app.keyboard.press("ArrowRight");
    await expect(app.locator(`[data-ref="key:${next}"]`)).toBeFocused();
    await expect(app.locator(`[data-ref="key:${next}"]`)).toHaveAttribute("aria-pressed", "true");
    await app.keyboard.press("Enter");
    await expect(app.getByRole("dialog")).toBeVisible();
    await app.keyboard.press("Escape");
    await app.keyboard.press("Delete"); // straight after closing the picker: the key has the keyboard again
    await expect(app.getByRole("dialog")).toBeHidden();
    await expect.poll(() => codeAt(app, 0, next)).toBe("KC_NO");
  } finally {
    await setCodeAt(app, 0, next, before);
  }
});

test("any keycode: LT(1,KC_SPC) makes a layer-tap with a hold label", async ({ app }) => {
  const index = await keyIndex(app, 0, 2); // base layer: L
  const before = await codeAt(app, 0, index);
  try {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await key.click();
    await app.getByRole("button", { name: "Change key" }).click();
    const picker = app.getByRole("dialog");
    await picker.getByLabel("Any keycode").fill("LT(1,KC_SPC)");
    await expect(picker.locator("#any-keycode-result")).toContainText("LT1(KC_SPACE)");
    await picker.getByRole("button", { name: "Use", exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(key.locator(".tap")).toHaveText("Space");
    await expect(key.locator(".hold")).toHaveText("Layer 1");
    expect(await codeAt(app, 0, index)).toBe("LT1(KC_SPACE)");
  } finally {
    await setCodeAt(app, 0, index, before);
  }
});

test("change hold turns a key into a mod-tap", async ({ app }) => {
  const index = await keyIndex(app, 2, 1); // base layer: F
  const before = await codeAt(app, 0, index);
  try {
    const key = app.locator(`[data-ref="key:${index}"]`);
    await key.click();
    await app.getByRole("button", { name: "Change hold" }).click();
    const form = app.getByRole("form", { name: "Change hold action" });
    await form.getByLabel("Hold modifiers").check();
    await form.getByLabel("Ctrl").check();
    await expect(form).toContainText("MT(MOD_LCTL | MOD_LSFT, KC_F)");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(key.locator(".hold")).toHaveText("Ctrl+Shift");
    expect(await codeAt(app, 0, index)).toBe("C_S_T(KC_F)");
  } finally {
    await setCodeAt(app, 0, index, before);
  }
});

test("layer tabs switch layers, and a renamed layer keeps its name", async ({ app }) => {
  const before = await layerNameOf(app, 2);
  try {
    const index = await keyIndex(app, 4, 4); // layer 2 (navigation): Home
    await app.getByRole("tab", { name: "2 Layer 2" }).click();
    await expect(app.getByRole("tab", { name: "2 Layer 2" })).toHaveAttribute("aria-selected", "true");
    await expect(app.locator(`[data-ref="key:${index}"]`)).toContainText("Home");

    await app.getByRole("tab", { name: "2 Layer 2" }).dblclick();
    const keyboardReads: string[] = [];
    app.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/keyboard") keyboardReads.push(request.url());
    });
    const name = app.getByLabel("Name of layer 2");
    await name.fill("Nav");
    await name.press("Enter");
    await expect(app.getByRole("tab", { name: "2 Nav" })).toBeVisible();
    expect(keyboardReads).toEqual([]); // the rename's reply has the name to show: the keyboard isn't read again
    expect(await layerNameOf(app, 2)).toBe("Nav");

    await app.reload();
    await expect(app.getByRole("tab", { name: "2 Nav" })).toBeVisible();
  } finally {
    await setLayerName(app, 2, before);
  }
});

test("an unplugged keyboard greys out the keymap and blocks edits until it is back", async ({ app }) => {
  const plug = (connected: boolean) => app.request.put(serverUrl(app, "/api/simulator/connection"), { data: { connected } });
  const index = await keyIndex(app, 0, 1);
  const before = await codeAt(app, 0, index);
  try {
    expect((await plug(false)).ok()).toBe(true);
    await expect(app.getByRole("alert")).toContainText("Keyboard unplugged");
    await expect(app.locator(".page")).toHaveAttribute("inert", "");
    await expect(app.getByRole("button", { name: "Change key" })).toBeDisabled();
    // the server refuses the edit too, not only the page
    const edit = await app.request.put(serverUrl(app, "/api/keymap/0/0/1"), { data: { code: "KC_ESCAPE" } });
    expect(edit.status()).toBe(503);
    await screenshots(app, "unplugged");
  } finally {
    await plug(true);
  }
  await expect(app.getByRole("alert")).toBeHidden();
  await expect(app.getByRole("button", { name: "Change key" })).toBeEnabled();
  expect(await codeAt(app, 0, index)).toBe(before);
});

test("a keyboard language relabels the keys", async ({ app }) => {
  const index = await keyIndex(app, 5, 3); // base layer: E with AltGr on hold
  const key = app.locator(`[data-ref="key:${index}"]`);
  await expect(key.locator(".alt-gr")).toHaveCount(0);
  await app.getByLabel("Keyboard language").selectOption({ label: "Polish (QWERTY)" });
  await expect(key.locator(".alt-gr")).toHaveText("ę");
  await screenshots(app, "polish");
  // remembered by this browser
  await app.reload();
  await expect(app.getByLabel("Keyboard language")).toHaveValue("polish-qwerty");
  await expect(key.locator(".alt-gr")).toHaveText("ę");
});

test("clearing a layer's name gives it its default name back", async ({ app }) => {
  const before = await layerNameOf(app, 3);
  try {
    await app.getByRole("tab", { name: /^3 / }).dblclick();
    const name = app.getByLabel("Name of layer 3");
    await name.fill("Numbers");
    await name.press("Enter");
    await expect(app.getByRole("tab", { name: "3 Numbers" })).toBeVisible();
    await app.getByRole("tab", { name: "3 Numbers" }).dblclick();
    await app.getByLabel("Name of layer 3").fill("");
    await app.getByLabel("Name of layer 3").press("Enter");
    await expect(app.getByRole("tab", { name: "3 Layer 3" })).toBeVisible();
  } finally {
    await setLayerName(app, 3, before);
  }
});
