import { defineConfig, devices } from "@playwright/test";

// Both servers are owned by the test run. Never reuse the interactive demo on 8000.
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "./output/playwright/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "./output/playwright/report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: process.env.CASEDESK_CHROMIUM_PATH
      ? { executablePath: process.env.CASEDESK_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/start-test-backend.mjs",
      url: "http://127.0.0.1:8001/api/health",
      timeout: 45_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      timeout: 45_000,
      reuseExistingServer: false,
      env: { CASEDESK_API_TARGET: "http://127.0.0.1:8001" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
