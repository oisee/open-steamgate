import {test, expect} from "@playwright/test";

// A Fiori Elements V2 list report (SAPUI5 from the CDN) against the
// transpiled DPC. Needs network access for the UI5 runtime.
test("list report shows the travels served by the transpiled DPC", async ({page}) => {
  const odata = [];
  page.on("request", (req) => {
    if (req.url().includes("/sap/opu/odata/sap/")) {
      odata.push(req.method() + " " + req.url().replace("http://localhost:3030", "") + " " + (req.postData() || ""));
    }
  });
  const failed = [];
  page.on("response", (res) => {
    if (res.url().includes("/sap/opu/odata/sap/") && res.status() >= 400) {
      failed.push(res.status() + " " + res.url());
    }
  });

  await page.goto("/app/index.html");

  // the table renders one row per travel
  const rows = page.locator("table tbody tr.sapMListTblRow, .sapUiTableRow:has(.sapUiTableCell)");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(rows).toHaveCount(4);

  // the app really went through $metadata and the entity set
  expect(odata.some((r) => r.includes("$metadata"))).toBe(true);
  // in batch mode the entity-set request travels inside the $batch body
  expect(odata.some((r) => r.includes("TravelSet") && r.includes("$inlinecount=allpages"))).toBe(true);
  // nothing the app asked the service for came back as an error
  expect(failed, failed.join("\n")).toEqual([]);
});

test("filter bar sends $filter that the DPC honours", async ({page}) => {
  await page.goto("/app/index.html");
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();

  const filters = [];
  page.on("request", (req) => {
    const text = decodeURIComponent(req.url() + " " + (req.postData() || ""));
    if (text.includes("TravelSet") && text.includes("$filter")) {
      filters.push(text);
    }
  });
  const status = page.getByRole("combobox", {name: /Status/}).or(page.getByLabel(/^Status/).first());
  await status.first().fill("X");
  await status.first().press("Enter");

  await expect(page.getByText("Berlin to Copenhagen")).toHaveCount(0);
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  expect(filters.some((u) => /\$filter=Status eq 'X'/.test(u)), filters.join("\n")).toBe(true);
});

test("Delete in the list report goes through a $batch changeset to the DPC", async ({page}) => {
  const deletes = [];
  page.on("request", (req) => {
    const text = req.postData() || "";
    if (req.url().includes("$batch") && /DELETE TravelSet/.test(text)) {
      deletes.push(text);
    }
  });
  await page.goto("/app/index.html");
  const row = page.locator("tr.sapMListTblRow", {hasText: "Aarhus to Odense"});
  await expect(row).toBeVisible();

  // select the row the keyboard way (focus a cell, Space); pointer clicks
  // never pass Playwright's "stable" check under the WSL headless
  // compositor, the same reason screenshots come out blank there
  await row.locator("td").nth(1).focus();
  await page.keyboard.press("Space");
  const del = page.getByRole("button", {name: "Delete"}).first();
  await expect(del).toBeEnabled();
  await del.focus();
  await page.keyboard.press("Enter");
  // sap.m.MessageBox renders as an alertdialog
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", {name: /^(Delete|OK)$/});
  await confirm.focus();
  await page.keyboard.press("Enter");

  // the row is gone from the table (the closed MessageBox may linger in the
  // static area for a moment, so look at rows, not at any text)
  await expect(page.locator("tr.sapMListTblRow", {hasText: "Aarhus to Odense"})).toHaveCount(0);
  await expect(page.locator("table tbody tr.sapMListTblRow")).toHaveCount(3);
  expect(deletes.some((t) => /DELETE TravelSet\('T0003'\)/.test(t)), deletes.join("\n")).toBe(true);

  const res = await fetch("http://localhost:3030/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0003')");
  expect(res.status).toBe(404);
});
