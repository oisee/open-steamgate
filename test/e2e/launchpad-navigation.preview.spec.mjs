import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {registerLaunchpadNavigationTests} from "./launchpad-navigation.shared.mjs";

// A persistent context keeps the service worker storage available on runners
// where Playwright's ephemeral page context cannot retain it between the
// installer page and the launchpad.
const previewTest = test.extend({
  launchpadPage: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), "stg-preview-launchpad-"));
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      serviceWorkers: "allow",
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
      await rm(profile, {recursive: true, force: true});
    }
  },
});

async function openLaunchpad(page) {
  await page.goto("/index.html?stay=1");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 60_000});
  await page.goto("/app/flp.html");
  await page.locator(".sapMGT").first().waitFor({timeout: 60_000});
}

registerLaunchpadNavigationTests({
  test: previewTest,
  expect,
  openLaunchpad,
  pageFixture: "launchpadPage",
});
