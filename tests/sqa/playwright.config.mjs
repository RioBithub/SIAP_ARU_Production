import { defineConfig } from "@playwright/test";
import path from "node:path";
import { baseURL, repoRoot, sqaDirectory } from "../../scripts/sqa/config.mjs";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: path.join(sqaDirectory, "test-results"),
  reporter: [
    ["line"],
    ["json", { outputFile: path.join(sqaDirectory, "report.json") }],
  ],
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.SIAP_SQA_CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: "node scripts/sqa/app.mjs start",
    cwd: repoRoot,
    url: baseURL + "/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
