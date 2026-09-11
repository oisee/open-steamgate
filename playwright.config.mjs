import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 90_000,
  expect: {timeout: 30_000},
  retries: 0,
  use: {
    baseURL: "http://localhost:3030",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node test/run.mjs",
    url: "http://localhost:3030/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
