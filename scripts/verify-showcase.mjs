#!/usr/bin/env node
// One command for the deployed journey, not just a direct app/index.html.
// Usage: npm run verify:showcase -- <origin> [--preview]
// Example: npm run verify:showcase -- http://localhost:31777/
import {chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const args = process.argv.slice(2);
const origin = new URL(args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3030/");
const preview = args.includes("--preview");
const profile = await mkdtemp(join(tmpdir(), "osd-showcase-"));
const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
try {
  const page = await context.newPage();
  const failures = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && /\/zosd_taxi_anal\/(?:manifest\.json|Component\.js)|\/ZSTG_SADL_SRV\//i.test(response.url())) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  if (preview) {
    await page.goto(new URL("index.html?stay=1", origin).href);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 60_000});
  }
  await page.goto(new URL("app/flp.html#Shell-home", origin).href);
  const tile = page.getByRole("link", {name: /^NYC taxi analytics/}).first();
  await tile.waitFor({timeout: 60_000});
  await tile.click();
  await page.waitForURL(/#Taxi-analyze/, {timeout: 60_000});
  await page.getByText("Manhattan").first().waitFor({timeout: 60_000});
  await page.locator(".sapVizFrame svg, .sapSuiteUiCommonsChartContainer svg").first().waitFor({timeout: 60_000});
  const helpButton = page.locator('[id$="SmartFilterBar-filterItemControl_BASIC-BOROUGH-vhi"]');
  await helpButton.waitFor({timeout: 60_000});
  await helpButton.click();
  await page.getByRole("dialog").getByRole("row", {name: /Manhattan/}).waitFor({timeout: 60_000});
  const body = await page.locator("body").innerText();
  if (body.includes("could not be loaded") || failures.length > 0) {
    throw new Error(`Taxi launchpad failed: ${failures.join("; ") || "UI5 component could not be loaded"}`);
  }
  console.log(`PASS Taxi launchpad, chart, OData and Borough F4: ${origin.href}`);
} finally {
  await context.close();
  await rm(profile, {recursive: true, force: true});
}
