import {test, expect} from "@playwright/test";

// A Fiori Elements V2 list report (SAPUI5 from the CDN) against the
// transpiled DPC. Needs network access for the UI5 runtime.
test("list report shows the travels served by the transpiled DPC", async ({page}) => {
  const odata = [];
  page.on("request", (req) => {
    if (req.url().includes("/sap/opu/odata/sap/")) {
      odata.push(req.method() + " " + req.url().replace("http://localhost:3030", ""));
    }
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/app/index.html");

  // the table renders one row per travel
  const rows = page.locator("table tbody tr.sapMListTblRow, .sapUiTableRow:has(.sapUiTableCell)");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(rows).toHaveCount(4);

  // the app really went through $metadata and the entity set
  expect(odata.some((r) => r.includes("$metadata"))).toBe(true);
  expect(odata.some((r) => r.includes("/TravelSet") && r.includes("$inlinecount=allpages"))).toBe(true);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("filter bar sends $filter that the DPC honours", async ({page}) => {
  await page.goto("/app/index.html");
  await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();

  const status = page.getByRole("combobox", {name: /Status/}).or(page.getByLabel(/^Status/).first());
  await status.first().fill("X");
  await page.getByRole("button", {name: "Go"}).click();

  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toHaveCount(0);
});
