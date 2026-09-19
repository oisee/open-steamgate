import {defineConfig} from "@playwright/test";

// The browser preview build (build/preview/), served as static files: the OData
// service is answered by the service worker, not by a Node process.
//
// The port is STG_PREVIEW_PORT, the same variable scripts/serve-build.mjs
// reads, so two sessions on one machine do not collide -- the ordinary
// Playwright config has read STG_PORT for that reason since the suites were
// written, and this one had 3031 spelled into it twice. It cost a run: the
// static server also opens the TLS port beside it (port + 1), that one was
// held by somebody else, and the whole preview suite reported "process from
// config.webServer was not able to start" with an EADDRINUSE for a port this
// file does not mention.
const PORT = Number(process.env.STG_PREVIEW_PORT ?? 3031);

export default defineConfig({
  testDir: "test/e2e",
  testMatch: /preview\.spec\.mjs/,
  timeout: 120_000,
  expect: {timeout: 45_000},
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/serve-build.mjs",
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
