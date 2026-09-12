import {test, expect} from "@playwright/test";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// A Fiori Elements V2 Analytical List Page over the flight cube: the chart
// and the table are $select requests on dimensions and measures, which the
// SADL runtime answers with GROUP BY. Needs network access for the UI5 runtime.
test("analytical list page: chart and table over the flight cube", async ({page}) => {
  const odata = [];
  page.on("request", (req) => {
    if (req.url().includes("/sap/opu/odata/sap/")) {
      odata.push(req.method() + " " + decodeURIComponent(req.url().replace(`http://localhost:${PORT}`, "")) + " " + decodeURIComponent(req.postData() || ""));
    }
  });
  const failed = [];
  page.on("response", (res) => {
    if (res.url().includes("/sap/opu/odata/sap/") && res.status() >= 400) {
      failed.push(res.status() + " " + res.url());
    }
  });

  await page.goto("/app/analytics/index.html");
  // the table shows the airlines of the seeds, aggregated
  await expect(page.getByText("SQ").first()).toBeVisible();
  await expect(page.getByText("LH").first()).toBeVisible();
  // the chart rendered (a VizFrame is an svg)
  await expect(page.locator(".sapVizFrame svg, .sapSuiteUiCommonsChartContainer svg").first()).toBeVisible();

  // the cube was read with $select on dimensions and measures, never row by row
  const cube = odata.filter((r) => r.includes("Zc_Stg_FlightcubeSet"));
  expect(cube.length).toBeGreaterThan(0);
  expect(cube.some((r) => /\$select=[^&]*AIRLINE/.test(r) && /\$select=[^&]*(SEATS|REVENUE)/.test(r))).toBe(true);
  expect(failed).toEqual([]);
});
