import {defineConfig} from "@playwright/test";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

export default defineConfig({
  testDir: "test/e2e",
  // the preview build has its own config (playwright.preview.config.mjs)
  testIgnore: /preview\.spec\.mjs/,
  // one worker: every spec talks to the same gateway and the same in-memory
  // database, so specs that create or delete rows collide when they run in
  // parallel (a Travel another spec expects disappears, and the run has been
  // seen losing the server). 13 specs, 41 seconds.
  workers: 1,
  timeout: 90_000,
  expect: {timeout: 30_000},
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node test/run.mjs",
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
