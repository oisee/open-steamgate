// The pictures README.md shows, taken from the running thing itself:
//
//   node test/run.mjs &            (or npm start)
//   node scripts/capture-docs-shots.mjs
//
// Everything below /sap/opu/odata/sap/ in these shots is answered by the
// transpiled ABAP over SQLite; the apps are SAPUI5 from SAP's CDN.
import {chromium} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(root, "docs/images");
const base = `http://localhost:${process.env.STG_PORT ?? 3030}`;
await mkdir(out, {recursive: true});

const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1200, height: 720}, deviceScaleFactor: 1});
const page = await context.newPage();
const shot = (name, options = {}) => page.screenshot({path: resolve(out, `${name}.png`), ...options});

try {
  // the launchpad with the four apps
  await page.goto(`${base}/app/flp.html`);
  await page.locator(".sapUshellTile").first().waitFor({timeout: 90_000});
  await page.waitForTimeout(1500);
  await shot("launchpad", {clip: {x: 0, y: 0, width: 1200, height: 430}});

  // the list report, pictures and all
  await page.goto(`${base}/app/index.html`);
  await page.getByText("Berlin to Copenhagen").waitFor({timeout: 90_000});
  await page.waitForTimeout(2500);
  await shot("list-report", {clip: {x: 0, y: 0, width: 1200, height: 520}});

  // the object page of a travel: header picture, its bookings below
  const row = page.locator("tr.sapMListTblRow", {hasText: "Berlin to Copenhagen"}).first();
  await row.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Ada Lovelace").waitFor({timeout: 60_000});
  await page.waitForTimeout(2000);
  await shot("object-page", {clip: {x: 0, y: 0, width: 1200, height: 620}});

  // the Service Builder as an app
  await page.goto(`${base}/app/segw/index.html`);
  await page.getByRole("treeitem", {name: "TravelId", exact: true}).first().waitFor({timeout: 90_000});
  await page.getByRole("treeitem", {name: "TravelId", exact: true}).first().click();
  await page.waitForTimeout(1500);
  await shot("segw-editor", {clip: {x: 0, y: 0, width: 1200, height: 660}});

  // the analytical list page over the cube
  await page.goto(`${base}/app/analytics/index.html`);
  await page.waitForTimeout(6000);
  // the chart and the table below it; the filter bar above is empty
  await shot("analytics", {clip: {x: 0, y: 248, width: 1200, height: 400}});

  console.log(`docs/images: launchpad, list-report, object-page, segw-editor, analytics`);
} finally {
  await context.close();
  await browser.close();
}
