import {defineConfig} from "@playwright/test";
import {fileURLToPath} from "node:url";

// The browser-preview specs (npm run e2e:preview) against the OSGo preview:
// build/osgo-preview served at the root of STG_PREVIEW_PORT by
// tools/gogen/wasm/serve.mjs, started beside it (no webServer here: the
// port and the process are the caller's).
//   node tools/gogen/wasm/serve.mjs 4901 /=build/osgo-preview &
//   STG_PREVIEW_PORT=4901 npx playwright test --config tools/gogen/wasm/playwright.osgo.config.mjs
const PORT = Number(process.env.STG_PREVIEW_PORT ?? 4901);

export default defineConfig({
  testDir: fileURLToPath(new URL("../../../test/e2e", import.meta.url)),
  testMatch: /(preview|launchpad-navigation\.preview|taxi\.preview)\.spec\.mjs/,
  timeout: 120_000,
  expect: {timeout: 45_000},
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: fileURLToPath(new URL("../.out/playwright", import.meta.url)),
  use: {baseURL: `http://localhost:${PORT}`, headless: true, screenshot: "only-on-failure", serviceWorkers: "allow"},
});
