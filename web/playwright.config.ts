import { defineConfig, devices } from "@playwright/test";

// Runs the built UI (npm run build) against `vial_web.py --fake`, started by e2e/global-setup.ts.
// Never touches a real keyboard: the server only ever runs with --fake and a temporary data dir.
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
