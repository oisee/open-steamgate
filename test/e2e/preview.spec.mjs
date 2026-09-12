import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

// The static preview build: no server answers /sap/opu/odata/sap/, the
// service worker does, with the transpiled DPC over sql.js.
//
// A persistent profile, because Chromium refuses service worker storage in
// Playwright's ephemeral context on some setups ("Failed to access storage").
test("the list report runs against the gateway in the service worker", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    const answered = [];
    page.on("response", (res) => {
      if (res.url().includes("/sap/opu/odata/sap/")) {
        answered.push(res.status() + " " + res.url().replace("http://localhost:3031", "") + (res.fromServiceWorker() ? " (sw)" : ""));
      }
    });

    // a deep link into the app, without the installer page first
    await page.goto("http://localhost:3031/app/index.html");

    const rows = page.locator("table tbody tr.sapMListTblRow, .sapUiTableRow:has(.sapUiTableCell)");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
    await expect(page.getByText("Aarhus to Odense")).toBeVisible();
    await expect(rows).toHaveCount(4);

    // painted, not only present: an ancestor with height 0 and overflow hidden
    // would leave the row in the DOM and the page blank
    const painted = await rows.first().evaluate((row) => {
      const r = row.getBoundingClientRect();
      return row.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(painted).toBe(true);

    expect(answered.some((r) => r.includes("$metadata") && r.startsWith("200"))).toBe(true);
    expect(answered.some((r) => r.includes("(sw)"))).toBe(true);
    expect(answered.filter((r) => !r.startsWith("2"))).toEqual([]);

    // the absolute URLs the gateway hands out point at the mount, not at a Node server
    const travels = await page.evaluate(async () => (await fetch("../sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json")).json());
    expect(travels.d.results[0].__metadata.uri).toMatch(/^http:\/\/localhost:3031\/sap\/opu\/odata\/sap\/ZSTG_DEMO_SRV\/TravelSet\(/);

    // a write goes through the DPC in the worker and survives a reload
    const created = await page.evaluate(async () => {
      const res = await fetch("../sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet", {
        method: "POST",
        headers: {"content-type": "application/json", "x-csrf-token": "open-steamgate"},
        body: JSON.stringify({TravelId: "T0900", Description: "Preview roundtrip"}),
      });
      return res.status;
    });
    expect(created).toBe(201);
    await page.reload();
    await expect(page.getByText("Preview roundtrip")).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
