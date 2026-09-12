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

  // painted, not only present: an ancestor with height 0 and overflow hidden
  // would leave the row in the DOM and the page blank
  const painted = await page.getByText("Berlin to Copenhagen").evaluate((cell) => {
    const r = cell.getBoundingClientRect();
    return cell.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(painted).toBe(true);

  // the app really went through $metadata and the entity set
  expect(odata.some((r) => r.includes("$metadata"))).toBe(true);
  // in batch mode the entity-set request travels inside the $batch body
  expect(odata.some((r) => r.includes("TravelSet") && r.includes("$inlinecount=allpages"))).toBe(true);
  // nothing the app asked the service for came back as an error
  expect(failed, failed.join("\n")).toEqual([]);
});

test("F4 on Status: the value help dialog reads StatusVHSet, searches it, and its pick becomes $filter", async ({page}) => {
  const requests = [];
  page.on("request", (req) => {
    const text = req.url() + " " + (req.postData() || "");
    if (text.includes("/sap/opu/odata/sap/")) {
      requests.push(text.replace(/\r?\n/g, " "));
    }
  });
  await page.goto("/app/index.html");
  // Common.Text + TextArrangement: the column shows the text first
  await expect(page.getByText("Accepted (A)").first()).toBeVisible();

  const status = page.getByLabel(/^Status/).first();
  await status.focus();
  await page.keyboard.press("F4");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Cancelled")).toBeVisible();
  await expect(dialog.getByText("Accepted")).toBeVisible();
  expect(requests.some((r) => /StatusVHSet\?/.test(r) && r.includes("$select=Status%2cText"))).toBe(true);

  // the dialog's own search goes to the DPC as iv_search_string
  const search = dialog.getByRole("searchbox").or(dialog.getByPlaceholder("Search")).first();
  await search.fill("cancel");
  await search.press("Enter");
  await expect(dialog.getByText("Items (1)")).toBeVisible();
  expect(requests.some((r) => /StatusVHSet\?/.test(r) && r.includes("search=cancel"))).toBe(true);

  // pick the row (keyboard: Space on its cell toggles the selection, then OK)
  // and the filter bar fires $filter
  // after the search the table holds one row: Cancelled
  const pick = dialog.getByRole("gridcell", {name: "Click to Select"}).first();
  await pick.focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByText("No Items or Conditions Selected")).toBeHidden();
  await dialog.getByRole("button", {name: "OK"}).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", {name: "Go"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toBeHidden();
  expect(requests.some((r) => /\$filter=Status eq 'X'/.test(decodeURIComponent(r)))).toBe(true);
});

test("object page: navigation reads to_Bookings, Edit + Save sends MERGE with the changed field only", async ({page}) => {
  const requests = [];
  page.on("request", (req) => {
    const text = req.method() + " " + req.url() + " " + (req.postData() || "");
    if (text.includes("/sap/opu/odata/sap/")) {
      requests.push(text.replace(/\r?\n/g, " "));
    }
  });
  await page.goto("/app/index.html");
  const row = page.locator("tr.sapMListTblRow", {hasText: "Berlin to Copenhagen"}).first();
  await row.focus();
  await page.keyboard.press("Enter");

  // the object page: header, the General field group, bookings through the navigation property
  await expect(page).toHaveURL(/#\/TravelSet\('T0001'\)/);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  expect(requests.some((r) => r.includes("TravelSet('T0001')/to_Bookings?"))).toBe(true);

  // non-draft edit: Edit, change Seats, Save
  await page.getByRole("button", {name: "Edit"}).focus();
  await page.keyboard.press("Enter");
  const seats = page.getByLabel(/^Seats/).first();
  await expect(seats).toBeEditable();
  await seats.fill("3");
  await page.getByRole("button", {name: "Save"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", {name: "Edit"})).toBeVisible();

  const merge = requests.find((r) => /MERGE TravelSet\('T0001'\)/.test(r));
  expect(merge, requests.join("\n")).toBeDefined();
  expect(merge).toContain('"Seats":3');
  expect(merge).not.toContain('"Description"');

  // the gateway laid the request over the entity: the rest survived
  const travel = await page.evaluate(async () => (await fetch("../sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')?$format=json")).json());
  expect(travel.d.Seats).toBe(3);
  expect(travel.d.Description).toBe("Berlin to Copenhagen");
  expect(travel.d.Status).toBe("A");
});

test("\"Ber*\" in Description: Fiori sends startswith, the DPC makes it LIKE", async ({page}) => {
  const filters = [];
  page.on("request", (req) => {
    const text = req.url() + " " + (req.postData() || "");
    if (text.includes("TravelSet") && text.includes("$filter")) {
      filters.push(text);
    }
  });
  await page.goto("/app/index.html");
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  const description = page.getByLabel(/^Description/).first();
  await description.fill("Ber*");
  await description.press("Enter");
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
  await expect(page.getByText("Aarhus to Odense")).toBeHidden();
  await expect(page.getByText("Copenhagen to Aarhus")).toBeHidden();
  expect(filters.some((u) => /startswith\(Description,'Ber'\)/.test(decodeURIComponent(u))), filters.join("\n")).toBe(true);
});

test("the filter bar's search field goes to the DPC as iv_search_string", async ({page}) => {
  const searches = [];
  page.on("request", (req) => {
    const text = req.url() + " " + (req.postData() || "");
    if (text.includes("TravelSet") && /[?&]search=/.test(text)) {
      searches.push(text);
    }
  });
  await page.goto("/app/index.html");
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
  const search = page.getByRole("searchbox").or(page.getByPlaceholder("Search")).first();
  await search.fill("odense");
  await search.press("Enter");
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toBeHidden();
  expect(searches.some((u) => /search=odense/.test(u)), searches.join("\n")).toBe(true);
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
