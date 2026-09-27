import {test, expect} from "@playwright/test";

const TAXI = "/sap/opu/odata/sap/ZOSD_TAXI_SRV";

/** ResetData over HTTP, whatever the page got to; never throws */
async function resetTaxi(request) {
  try {
    const head = await request.get(TAXI + "/", {headers: {"x-csrf-token": "fetch"}});
    await request.post(TAXI + "/ResetData", {headers: {"x-csrf-token": head.headers()["x-csrf-token"] ?? ""}});
  } catch {
    // the server may be gone; the database is in memory
  }
}

test("NYC TLC analytical page renders chart and grouped table from OData", async ({page}) => {
  try {
    await taxiPage(page);
  } finally {
    // the year the page made goes, also when an assertion stopped it midway
    if (process.env.OSD_TAXI_FULL !== "1") await resetTaxi(page.request);
  }
});

async function taxiPage(page) {
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
  // nothing synthetic at start: the page says so, and one click makes a year
  // (ZOSD_TAXI_SRV, the same rows for the same year on every host)
  const full = process.env.OSD_TAXI_FULL === "1";
  if (!full) {
    await expect(page.getByText(/No sample data yet/).first()).toBeVisible();
    await page.getByRole("button", {name: "Generate data"}).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input").fill("2025");
    await dialog.getByRole("button", {name: "Generate", exact: true}).click();
    await expect(page.getByText(/Loaded: 2025/).first()).toBeVisible();
  }
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
  await expect(page.locator("body")).toContainText(full ? "Taxi trips (326)" : "Taxi trips (331)");
  expect(failures).toEqual([]);

  if (!full) {
    // and back: the confirmation is in the page, and names what goes
    await page.getByRole("button", {name: "Reset to minimal data"}).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Remove 2025 (83 894 trips in 20 000 rows)?");
    await confirm.getByRole("button", {name: "Remove"}).click();
    await expect(page.getByText(/No sample data yet/).first()).toBeVisible();
  }
}
