import {test, expect} from "@playwright/test";
const service = "/sap/opu/odata/sap/ZL3C_FLEET2_SRV";
// The real service seeds the run; the page is the generated Fiori Elements app.
test("run cockpit: list, object facets, confirmed runner action and refusal", async ({page, request}) => {
  // Playwright opts into the cockpit demo pack; normal ABAP Unit stays empty.
  const warn = await request.post(service + "/SetSetting?Param='budget.warn'&Value='1'&Note='browser timeline fixture'");
  expect(warn.ok()).toBeTruthy();
  const start = await request.post(service + "/StartRun?CheckDate='20261002'&Mode='S'");
  expect(start.ok()).toBeTruthy();
  const run = (await start.json()).d;
  const piles = await request.get(service + `/PileSet?$filter=RunId eq '${run.RunId}'`);
  expect((await piles.json()).d.results.length).toBeGreaterThan(0);
  const events = await request.get(service + `/EventSet?$filter=RunId eq '${run.RunId}'`);
  expect((await events.json()).d.results.length).toBeGreaterThan(0);
  await page.goto("/app/zosd_fleet2/index.html");
  await expect(page.getByText(run.RunId).first()).toBeVisible();
  await page.getByText(run.RunId).first().click();
  await expect(page.getByRole("heading", {name: "Pile", exact: true}).first()).toBeVisible();
  await expect(page.getByRole("heading", {name: "Event", exact: true}).first()).toBeVisible();
  // Object-page tables load when their section is brought into view.
  await page.getByRole("tab", {name: "Event", exact: true}).click();
  await expect(page.getByText("WARN", {exact: true}).first()).toBeVisible();
  await page.getByRole("tab", {name: "Run cockpit", exact: true}).click();
  await expect(page.getByRole("button", {name: "Change setting", exact: true})).toBeVisible();
  await expect(page.locator('[id$="--cockpitProgress"]')).toContainText("DONE");
  await page.getByRole("button", {name: "Change setting", exact: true}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const inputs = dialog.locator("input");
  await inputs.nth(0).fill("budget.glass");
  await inputs.nth(1).fill("20");
  await dialog.getByRole("button", {name: "Confirm action"}).click();
  await expect(dialog).toBeVisible();
  await inputs.nth(2).fill("browser capacity change");
  await dialog.getByRole("button", {name: "Confirm action"}).click();
  const answer = page.locator('[id$="--cockpitAnswer"]');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText(/OK$/);
  await expect(answer).not.toContainText("REFUSED");
  const log = await request.get(service + "/ChangeSet?$filter=NoteText eq 'browser capacity change'");
  expect((await log.json()).d.results.length).toBeGreaterThan(0);
  await page.getByRole("button", {name: "Change setting", exact: true}).click();
  await inputs.nth(0).fill("budget.glass");
  await inputs.nth(1).fill("0");
  await inputs.nth(2).fill("browser out of bounds");
  await dialog.getByRole("button", {name: "Confirm action"}).click();
  await expect(answer).toContainText("REFUSED: SetSetting: ");
  // The list toolbar can start the first run in an empty installation.
  await page.goto("/app/zosd_fleet2/index.html");
  await expect(page.getByRole("button", {name: "Start run", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Start run", exact: true}).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", {name: "Confirm action"}).click();
  await expect(page.locator('[id$="--listCockpitAnswer"]')).toContainText('"Answer":');
});
