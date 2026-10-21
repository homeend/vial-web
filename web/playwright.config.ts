import { defineConfig, devices } from "@playwright/test";

// Runs the built UI (npm run build) against `vial_web.py --fake`, started by the fixtures (e2e/fixtures.ts); with
// $E2E_VIAL_CMD set, against a built Vial executable instead (`E2E_VIAL_CMD=dist/Vial.exe npx playwright test`).
// The executable serves the web UI it was built with, so it must be rebuilt after the UI changes.
// Never touches a real keyboard: the server only ever runs with --fake and a temporary data dir.
// The tests run in parallel, each worker with its own servers, which keep every edit while the worker lasts. A worker
// runs its tests one at a time, and each test that changes a key, an encoder or a name puts it back (in a `finally`,
// through the API), leaving the server as it found it: no test may depend on another having run, or on the order.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // half the cores by default; $E2E_WORKERS sets another number (1 runs everything one after another)
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
});
