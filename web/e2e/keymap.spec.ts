import { api, codeAt, expect, keyIndex, layerNameOf, plugIn, screenshots, setCodeAt, setLayerName, test } from "./fixtures";

// A worker's server is shared by the tests it runs: a test that changes a key or a name puts it back in its `finally`

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
  const index = await keyIndex(app, 0, 1);
  const before = await codeAt(app, 0, index);
  try {
    await plugIn(app, false);
    await expect(app.getByRole("alert")).toContainText("Keyboard unplugged");
    await expect(app.locator(".page")).toHaveAttribute("inert", "");
    await expect(app.getByRole("button", { name: "Change key" })).toBeDisabled();
    // the server refuses the edit too, not only the page
    const edit = await api(app).put("/api/keymap/0/0/1", { code: "KC_ESCAPE" });
    expect(edit.status()).toBe(503);
    await screenshots(app, "unplugged");
  } finally {
    await plugIn(app, true);
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

test("a long layer name is renamed in a dialog that shows all of it, and cut short with a tooltip elsewhere", async ({ app }) => {
  const before = await layerNameOf(app, 2);
  const long = "Navigation and arrows with the mouse keys"; // 41: one more than a name can have
  const kept = long.slice(0, 40);
  try {
    await app.getByRole("tab", { name: "2 Layer 2" }).dblclick();
    const dialog = app.getByRole("dialog", { name: "Rename layer 2" });
    await expect(dialog).toBeVisible();
    const name = dialog.getByLabel("Name of layer 2");
    await expect(name).toBeFocused();
    await name.pressSequentially(long);
    await expect(name).toHaveValue(kept);
    await expect(dialog).toContainText("40 / 40");
    // all 40 characters fit in the field
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await screenshots(app, "rename-dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(app.getByRole("tab", { name: `2 ${kept}` })).toBeFocused();
    expect(await layerNameOf(app, 2)).toBe(kept);

    // cut short, with all of it in the tooltip: the tab, the Inspector, how the layer is reached
    const tab = app.getByRole("tab", { name: `2 ${kept}` });
    await expect(tab).toHaveAttribute("title", `${kept} · double-click to rename`);
    expect(await tab.locator(".name").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    const position = app.locator(".inspector .position");
    await expect(position).toHaveAttribute("title", new RegExp(`${kept} layer$`));
    const inspector = (await app.getByRole("complementary", { name: "Selected key" }).boundingBox())!;
    expect(await app.locator(".inspector").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(inspector.width).toBeLessThanOrEqual(291);
    const reachName = app.locator("details.reach summary .name");
    await expect(reachName).toHaveAttribute("title", `Layer 2 · ${kept}`);
    expect(await reachName.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await screenshots(app, "long-layer-name", { fullPage: true });

    // Escape leaves the name as it was
    await tab.dblclick();
    await dialog.getByLabel("Name of layer 2").fill("Something else");
    await dialog.getByLabel("Name of layer 2").press("Escape");
    await expect(dialog).toBeHidden();
    expect(await layerNameOf(app, 2)).toBe(kept);
  } finally {
    await setLayerName(app, 2, before);
  }
});

test("the picker offers only the tap dances and macros set up, each with a card saying what it does", async ({ app }) => {
  const model = await (await api(app).get("/api/keyboard")).json();
  type Slot = { kind: string; code: string };
  type TapDance = Record<"tap" | "hold" | "doubleTap" | "tapHold", Slot> & { index: number; tappingTerm: number };
  const tapDances: TapDance[] = model.tapDance.filter((td: TapDance) =>
    [td.tap, td.hold, td.doubleTap, td.tapHold].some((s) => s.kind !== "none"));
  const macros = model.macros.items.filter((m: { actions: unknown[] }) => m.actions.length > 0)
    .map((m: { index: number }) => m.index);
  expect(tapDances.length).toBeGreaterThan(0);
  expect(tapDances.length).toBeLessThan(model.tapDance.length);
  expect(macros.length).toBeGreaterThan(0);
  expect(macros.length).toBeLessThan(model.macros.items.length);

  await app.locator(`[data-ref="key:${await keyIndex(app, 0, 1)}"]`).click();
  await app.getByRole("button", { name: "Change key" }).click();
  const picker = app.getByRole("dialog", { name: "Choose a keycode" });
  await expect(picker).toBeVisible();
  const card = picker.locator(".entry-card");

  await picker.getByRole("tab", { name: "Tap dance" }).click();
  const tdKeys = picker.locator(".grid .kc");
  await expect(tdKeys).toHaveCount(tapDances.length);
  await expect(picker.getByText("Only the tap dances set up are shown.")).toBeVisible();
  // no browser tooltip, which comes late: a card at once, without the key's own TD(n)
  await expect(tdKeys.first()).not.toHaveAttribute("title");
  await tdKeys.first().hover();
  await expect(card).toBeVisible({ timeout: 300 });
  await expect(card).toContainText(`tapping term ${tapDances[0].tappingTerm} ms`);
  await expect(card).toContainText("Tap, then hold");
  await expect(card).not.toContainText(`TD(${tapDances[0].index})`);
  await expect(card).toHaveAttribute("aria-hidden", "true");
  // a screen reader hears the same from the key's description
  await expect(tdKeys.first()).toHaveAccessibleDescription(/tapping term \d+ ms$/);
  await screenshots(app, "picker-tap-dance-card");
  await picker.getByRole("heading", { name: "Choose a keycode" }).hover();
  await expect(card).toBeHidden();
  // the keyboard's focus shows it too, and moving on hides it
  await tdKeys.first().focus();
  await expect(card).toBeVisible();
  await picker.getByRole("searchbox", { name: "Search keycodes" }).focus();
  await expect(card).toBeHidden();

  await picker.getByRole("tab", { name: "Macros" }).click();
  await expect(picker.locator(".grid .kc")).toHaveCount(macros.length + 5); // and the five dynamic macro keys
  await expect(picker.getByRole("button", { name: /DYN_REC_START1/ })).toBeVisible();
  await expect(picker.getByText("Only the macros set up are shown.")).toBeVisible();
  await picker.locator(".grid .kc").first().hover();
  await expect(card).toBeVisible({ timeout: 300 });
  await expect(card.locator(".steps li").first()).toBeVisible();
  await screenshots(app, "picker-macro-card");
  // the dynamic macro keys keep the browser's tooltip, and get no card
  await picker.getByRole("button", { name: /DYN_REC_START1/ }).hover();
  await expect(card).toBeHidden();
  await expect(picker.getByRole("button", { name: /DYN_REC_START1/ })).toHaveAttribute("title", /DYN_REC_START1/);
  await picker.getByRole("button", { name: "Close" }).click();
});
