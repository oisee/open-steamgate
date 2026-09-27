import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("browser SQLite preview makes a taxi year on request, serves its F4 values and applies the selection", async () => {
  const profile = await mkdtemp(join(tmpdir(), "osd-preview-taxi-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    serviceWorkers: "allow",
  });
  try {
    const page = await context.newPage();
    await page.goto("/index.html?stay=1");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 60_000});
    await page.goto("/app/taxi/index.html");
    // the preview starts with no synthetic rows, like every host; one year
    // is made in the browser's own database through ZOSD_TAXI_SRV
    await expect(page.getByText(/No sample data yet/).first()).toBeVisible();
    await page.getByRole("button", {name: "Generate data"}).click();
    const generate = page.getByRole("dialog");
    await generate.locator("input").fill("2025");
    await generate.getByRole("button", {name: "Generate", exact: true}).click();
    await expect(page.getByText(/Loaded: 2025/).first()).toBeVisible({timeout: 120_000});
    await expect(page.getByText("Manhattan").first()).toBeVisible();

    const valueHelp = page.locator('[id$="SmartFilterBar-filterItemControl_BASIC-BOROUGH-vhi"]');
    await expect(valueHelp).toBeVisible();
    await valueHelp.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Items (8)");
    const row = dialog.getByRole("row", {name: /Manhattan/});
    const selectionId = (await row.getAttribute("aria-owns")).split(" ")[0];
    await page.locator(`[id="${selectionId}"]`).click();
    await dialog.getByRole("button", {name: "OK", exact: true}).click();
    await expect(page.locator("body")).toContainText("Taxi trips (331)");
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
