import {test, expect} from "@playwright/test";

test("NYC TLC analytical page renders chart and grouped table from OData", async ({page}) => {
  const calls = [];
  const failures = [];
  page.on("request", (request) => {
    if (request.url().includes("/sap/opu/odata/sap/")) {
      calls.push(decodeURIComponent(request.url() + " " + (request.postData() ?? "")));
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/sap/opu/odata/sap/") && response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto("/app/taxi/index.html");
  await expect(page.getByText("Manhattan").first()).toBeVisible();
  await expect(page.getByText("Queens").first()).toBeVisible();
  await expect(page.locator(".sapVizFrame svg, .sapSuiteUiCommonsChartContainer svg").first()).toBeVisible();
  expect(calls.some((url) => url.includes("$select=") && url.includes("BOROUGH") && url.includes("TRIPS"))).toBe(true);
  expect(calls.some((url) => url.includes("$select=BOROUGH,PICKUPZONE,PAYMENT,TRIPS"))).toBe(true);
  await expect(page.locator("body")).toContainText("Payment");
  if (process.env.OSD_TAXI_FULL === "1") {
    await expect(page.locator("body")).toContainText("Taxi trips (1,148)");
    await expect(page.locator("body")).toContainText("3,330,984");
  }

  // The compact filter bar must expose real value help, not merely free-text inputs.
  for (const field of ["PICKUPDAY", "PICKUPHOUR", "BOROUGH", "PICKUPZONE", "PAYMENT"]) {
    await expect(page.locator(`[id$="SmartFilterBar-filterItemControl_BASIC-${field}-vhi"]`)).toBeVisible();
  }
  await page.locator('[id$="SmartFilterBar-filterItemControl_BASIC-BOROUGH-vhi"]').click();
  const help = page.getByRole("dialog");
  const manhattan = help.getByRole("row", {name: /Manhattan/});
  await expect(manhattan).toBeVisible();
  const selectionId = (await manhattan.getAttribute("aria-owns")).split(" ")[0];
  await page.locator(`[id="${selectionId}"]`).click();
  await help.getByRole("button", {name: "OK", exact: true}).click();
  await expect(page.locator("body")).toContainText("Adapt Filters (1)");
  await expect(page.locator("body")).toContainText(process.env.OSD_TAXI_FULL === "1" ? "Taxi trips (326)" : "Taxi trips (331)");
  expect(failures).toEqual([]);
});
