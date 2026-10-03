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
  // The list toolbar starts a run through its own dialog: a date picker, the
  // mode as a choice, the twin as a switch; the new run's page opens with the
  // answer in words, never the raw response object.
  await page.goto("/app/zosd_fleet2/index.html");
  await page.getByRole("button", {name: "Start run", exact: true}).click();
  const start = page.getByRole("dialog", {name: "Start a run"});
  await expect(start).toBeVisible();
  await expect(start.locator('[id$="--startDate"]')).toHaveClass(/sapMDP/);
  await expect(start.getByRole("option", {name: "In jobs"})).toHaveAttribute("aria-selected", "true");
  await expect(start.locator('[id$="--startSim"]')).toBeVisible();
  await start.locator('[id$="--startDate-inner"]').fill(new Date(2026, 9, 4).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"}));
  await start.locator('[id$="--startDate-inner"]').press("Enter");
  await start.getByRole("option", {name: "Now"}).click();
  await expect(start).toContainText("The piles run in this request");
  await start.getByRole("button", {name: "Start", exact: true}).click();
  await expect(start).toBeHidden();
  await expect(page).toHaveURL(/RunSet\('[0-9A-F]{32}'\)/);
  const said = page.locator('[id$="--cockpitAnswer"]');
  await expect(said).toContainText("Finished: every stage is done.");
  await expect(said).not.toContainText("{");
  const started = (await (await request.get(service + "/RunSet")).json()).d.results.filter((r) => r.CheckDate === "/Date(1791072000000)/");
  expect(started.length).toBe(1);
});
