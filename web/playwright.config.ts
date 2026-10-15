import { defineConfig, devices } from "@playwright/test";

// Runs the built UI (npm run build) against `vial_web.py --fake`, started by e2e/global-setup.ts.
// Never touches a real keyboard: the server only ever runs with --fake and a temporary data dir.
// The two servers are shared by every test and keep every edit for the whole run. So the tests run one at a time,
// and each test that changes a key, an encoder or a name puts it back (in a `finally`, through the API), leaving the
// server as it found it: no test may depend on another having run, or on the order.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
});
