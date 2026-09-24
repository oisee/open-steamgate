import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const ORIGIN = `http://localhost:${process.env.STG_PREVIEW_PORT ?? 3031}`;

test("one DuckDB-Wasm connection serves OData and Portable AMDP in Pages", async () => {
  test.setTimeout(300000);
  const profile = await mkdtemp(join(tmpdir(), "osg-preview-duckdb-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    page.on("console", (message) => console.log(`browser ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => console.log(`browser error: ${error.stack ?? error}`));
    page.on("response", async (response) => {
      if (response.status() >= 500) console.log(`HTTP ${response.status()} ${response.url()}: ${(await response.text().catch(() => "")).slice(0, 3000)}`);
    });
    context.on("serviceworker", (worker) => {
      console.log(`service worker: ${worker.url()}`);
      worker.on("console", (message) => console.log(`worker ${message.type()}: ${message.text()}`));
    });
    console.log("opening preview index");
    await page.goto(`${ORIGIN}/open-steamgate/main/index.html?stay=1`);
    console.log("waiting for service-worker control");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 60000});
    console.log("service worker controls the page");
    const mount = `${ORIGIN}/open-steamgate/main`;
    await page.goto(`${mount}/app/zvdb/`, {waitUntil: "domcontentloaded", timeout: 120000});
    console.log("Vector page loaded");
    await expect(page.getByText(/2002 query vectors in EGEMMA768/)).toBeVisible({timeout: 120000});
    await expect(page.getByText(/^DB: duckdb · memory$/)).toBeVisible({timeout: 120000});

    const facts = await page.evaluate(async () => {
      const response = await fetch("../../sap/opu/odata/sap/ZOSD_STATUS_SRV/DatabaseSet?$format=json");
      return {status: response.status, rows: (await response.json()).d.results};
    });
    expect(facts.status).toBe(200);
    expect(facts.rows.find((row) => row.Category === "Database" && row.Name === "Engine")?.Value).toBe("duckdb");

    await expect.poll(() => page.evaluate(() => {
      const element = document.querySelector("[id$='--engineSelect']");
      return sap.ui.getCore().byId(element.id).getSelectedKey();
    })).toBe("AMDP");
    await page.locator("[id$='--masterList'] .sapMLIB").first().click();
    await expect(page.getByText(/nearest texts, sorted by AMDP rank/)).toBeVisible({timeout: 120000});
    const firstSeven = async () => page.evaluate(() => {
      const element = document.querySelector("[id$='--engineSelect']");
      const state = sap.ui.getCore().byId(element.id).getModel("state");
      return state.getProperty("/results").slice(0, 7).map(({ResultId, Rank, Payload}) => ({ResultId, Rank, Payload}));
    });
    const amdp = await firstSeven();
    expect(amdp).toHaveLength(7);
    await page.evaluate(() => {
      const element = document.querySelector("[id$='--engineSelect']");
      const control = sap.ui.getCore().byId(element.id);
      if (!control.getItemByKey("AMDP").getEnabled()) throw new Error("Portable AMDP is disabled on DuckDB-Wasm");
      control.setSelectedKey("ANYDB");
      control.fireChange({selectedItem: control.getSelectedItem()});
    });
    await expect(page.getByText(/nearest texts, sorted by ANYDB rank/)).toBeVisible({timeout: 120000});
    expect(await firstSeven()).toEqual(amdp);
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

test("a broader root worker cannot steal the Pages-mounted OData requests", async () => {
  test.setTimeout(180000);
  const profile = await mkdtemp(join(tmpdir(), "osg-preview-scope-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    // Reproduce the order a user actually took: the local server's root
    // index explicitly registers /sw.js, then the app opens below the Pages
    // mount. A merely non-null controller would be the wrong one here.
    await page.goto(`${ORIGIN}/index.html?stay=1`);
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL === `${location.origin}/sw.js`,
      undefined, {timeout: 60000});
    const mount = `${ORIGIN}/open-steamgate/main`;
    const metadata = [];
    page.on("response", (response) => {
      if (response.url().includes("ZVDB_100_SRV/$metadata")) {
        metadata.push({status: response.status(), worker: response.fromServiceWorker()});
      }
    });
    await page.goto(`${mount}/app/zvdb/`, {waitUntil: "domcontentloaded"});
    await expect(page.getByText(/2002 query vectors in EGEMMA768/)).toBeVisible({timeout: 120000});
    const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    expect(controller).toBe(`${mount}/sw.js`);
    expect(metadata).toContainEqual({status: 200, worker: true});
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
