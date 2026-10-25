import { api, codeAt, expect, keyIndex, macrosOf, open, openSection, setCodeAt, setMacros, test } from "./fixtures";

// Two tabs of one Vial: a write in one tab shows in the other at once (the server tells every tab "changed"; the
// writing tab, named in the event, keeps the reply it has), and a macro save carries the macros version it was edited
// from, so a stale copy never overwrites what another tab saved. Each test puts back what it wrote.

const text = (t: string) => ({ type: "text", text: t, keys: [], delay: null });

test("a key changed in one tab shows in another tab without a reload", async ({ app, corneUrl }) => {
  const other = await open(await app.context().newPage(), corneUrl);
  const index = await keyIndex(app, 0, 1);
  const before = await codeAt(app, 0, index);
  const inOther = other.locator(`[data-ref="key:${index}"]`);
  await expect(inOther).toBeVisible();
  try {
    // the picker in the first tab
    await app.locator(`[data-ref="key:${index}"]`).click();
    await app.getByRole("button", { name: "Change key" }).click();
    const picker = app.getByRole("dialog");
    await picker.getByRole("searchbox", { name: "Search keycodes" }).fill("esc");
    await picker.getByRole("button", { name: "Esc (KC_ESCAPE)" }).click();
    await expect(picker).toBeHidden();
    // the other tab follows by itself
    await expect(inOther).toContainText("Esc");
    expect(await codeAt(other, 0, index)).toBe("KC_ESCAPE");
    // and the first tab still shows it (its own write needed no re-read)
    await expect(app.locator(`[data-ref="key:${index}"]`)).toContainText("Esc");
  } finally {
    await setCodeAt(app, 0, index, before);
    await other.close();
  }
});

test("macros saved in one tab show in another, and a save from a stale copy is refused and read again", async ({ app, corneUrl }) => {
  const other = await open(await app.context().newPage(), corneUrl);
  const items = await macrosOf(app); // every macro's steps, as the server takes them
  try {
    await openSection(other, "Macros");
    const card = other.locator("#macro-0");
    await expect(card).toBeVisible();
    // written by hand through the API (no tab named): every tab reads again, the Macros page in the other tab shows it
    const changed = items.map((steps, i) => (i === 0 ? [text("from the api")] : steps));
    await setMacros(app, changed);
    await expect(card).toContainText("from the api");
    // a stale save: the version the API copy was read at is behind by one write
    const version = (await (await api(app).get("/api/keyboard")).json()).macros.version as number;
    const stale = await api(app).put("/api/macros", { items: items.map((steps, i) => (i === 1 ? [text("stale")] : steps)),
      expect: version - 1 });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("macrosChanged");
    const now = (await (await api(app).get("/api/keyboard")).json()).macros;
    expect(now.version).toBe(version);
    expect((now.items[1].actions as { text?: string }[]).map((a) => a.text)).not.toContain("stale"); // nothing written
    await expect(card).toContainText("from the api");
  } finally {
    await setMacros(app, items);
    await other.close();
  }
});
