import { api, expect, openSection, screenshots, test } from "./fixtures";

// The Version page: what this Vial is (GET /api/version), reached from the sidebar and by its address; from source it
// says the checkout, against an executable (E2E_VIAL_CMD) the build record too. Nothing touches the keyboard.

interface Info {
  product: string; version: string; kind: "executable" | "source"; commit: string | null; fake: boolean;
  build: { ciRun: string | null } | null; dataDir: string | null; logFile: string | null;
}

test("the Version page says what this Vial is, from the sidebar and by its address", async ({ app }) => {
  await openSection(app, "Version");
  await expect(app.getByRole("heading", { level: 1, name: "Version" })).toBeVisible();
  await expect(app).toHaveURL(/#version$/);
  await expect(app).toHaveTitle("Version · Vial");
  const info = (await (await api(app).get("/api/version")).json()) as Info;
  const card = app.locator(".card");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(`${info.product} ${info.version}`);
  await expect(card.getByRole("button", { name: "Copy all" })).toBeVisible();
  const groups = card.locator("h3");
  await expect(card.getByText("Keyboard", { exact: true })).toBeVisible();
  await expect(card.getByText("simulated (--fake)")).toBeVisible();
  await expect(card.getByText("Data folder", { exact: true })).toBeVisible();
  expect(info.dataDir).not.toBeNull();
  await expect(card.getByText(info.dataDir!, { exact: true })).toBeVisible();
  await expect(card.getByText(info.logFile!, { exact: true })).toBeVisible();
  if (process.env.E2E_VIAL_CMD) {
    expect(info.kind).toBe("executable");
    await expect(groups).toHaveText(["Vial", "Build", "This computer"]);
    await expect(card.getByText("Built", { exact: true })).toBeVisible();
    await expect(card.getByText("Built with", { exact: true })).toBeVisible();
    expect(info.build).not.toBeNull(); // vial.spec writes the record
    expect(info.commit).not.toBeNull();
  } else {
    expect(info.kind).toBe("source");
    await expect(groups).toHaveText(["Vial", "This computer"]);
    await expect(card.getByText(/^source, /)).toBeVisible();
  }
  await screenshots(app, "version");

  // by its address, from another page
  await openSection(app, "Keyboard");
  await app.goto(app.url().replace(/#.*$/, "") + "#version");
  await expect(app.getByRole("heading", { level: 1, name: "Version" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(`${info.product} ${info.version}`);
});
