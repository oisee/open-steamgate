import {defineConfig} from "@playwright/test";

// The browser preview build (build/), served as static files: the OData
// service is answered by the service worker, not by a Node process.
export default defineConfig({
  testDir: "test/e2e",
  testMatch: /preview\.spec\.mjs/,
  timeout: 120_000,
  expect: {timeout: 45_000},
  retries: 0,
  use: {
    baseURL: "http://localhost:3031",
    headless: true,
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/serve-build.mjs",
    url: "http://localhost:3031/index.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
