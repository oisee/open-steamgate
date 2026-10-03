import {test, expect} from "@playwright/test";
import {spawn} from "node:child_process";
import {delimiter} from "node:path";
// The generated cockpit of the fleet2 set, on the real service: "Runs fleet2"
// (list report, start dialog, run page with Live) and "Set fleet2" (settings,
// schedule, kill switch, doctor). Playwright opts into the demo pack
// demo/cockpit-fleet (three ships); ordinary ABAP Unit has no fleet rows.
//
// Two tests watch background jobs and need the job worker on the same rows,
// so they need a file database the worker can open too:
//   STG_DB=file STG_DB_PATH=<tmp>/cockpit.sqlite npx playwright test test/e2e/dsl-l3-cockpit.spec.mjs
const service = "/sap/opu/odata/sap/ZL3C_FLEET2_SRV";
const runsApp = "/app/zosd_fleet2/index.html", setApp = "/app/zosd_fleet2_s/index.html";
const shared = process.env.STG_DB === "file" && !!process.env.STG_DB_PATH;
const day = (y, m, d) => new Date(y, m - 1, d).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
const odata = (v) => encodeURIComponent(`'${v}'`);
test.describe.configure({mode: "serial"});

let worker;
function startWorker() {
  if (worker) return;
  const packs = [process.env.OSD_PACKS, "demo/cockpit-fleet"].filter(Boolean).join(delimiter);
  worker = spawn(process.execPath, ["tools/osd-batch-runs.mjs", "worker"], {env: {...process.env, OSD_PACKS: packs}, stdio: "ignore"});
}
test.afterAll(() => {if (worker) worker.kill();});

async function setting(request, param, value, note) {
  const r = await request.post(`${service}/SetSetting?Param=${odata(param)}&Value=${odata(value)}&Note=${odata(note)}`);
  expect((await r.json()).d.Answer).toBe("OK");
}
async function reset(request, param) {
  await request.post(`${service}/ResetSetting?Param=${odata(param)}&Note=${odata("browser test reset")}`);
}
async function run(request, id) {return (await (await request.get(`${service}/RunSet('${id}')`)).json()).d;}
async function startFromDialog(page, date, mode) {
  await page.goto(runsApp);
  await page.getByRole("button", {name: "Start run", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Start a run"});
  await expect(dialog).toBeVisible();
  const input = dialog.locator('[id$="--startDate-inner"]');
  await input.fill(date);
  await input.press("Enter");
  await dialog.getByRole("option", {name: mode}).click();
  return dialog;
}
// a control of the run page (the list has a refresh of its own with the same local id)
const op = (page, id) => page.locator(`[data-sap-ui$="ObjectPage.view.Details::RunSet--${id}"]`);
const runId = (page) => /RunSet\('([0-9A-F]{32})'\)/.exec(page.url())[1];

test("the start dialog: a date picker, the mode as a choice, the twin as a switch; the run's page in words", async ({page, request}) => {
  await page.goto(runsApp);
  // the list is titled by its set and starts at today's check date
  await expect(page.getByText("Runs fleet2", {exact: true}).first()).toBeVisible();
  await expect(page.locator('[id$="--listReportFilter-filterItemControl_BASIC-CheckDate"]')).toContainText(day(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()));
  await page.getByRole("button", {name: "Start run", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Start a run"});
  await expect(dialog).toBeVisible();
  // a date picker: its calendar opens from the field
  await dialog.locator('[id$="--startDate-icon"]').click();
  await expect(page.locator(".sapUiCal").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("option", {name: "In jobs"})).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("Background jobs carry the piles")).toBeVisible();
  // fleet2 has simulate:, so the twin is offered
  await expect(dialog.locator('[id$="--startSim"]')).toBeVisible();
  // and the switch says under which chaos profile, and where it is changed
  await expect(dialog).toContainText("Twin (sim), profile default");
  await expect(dialog).toContainText("change the profile in Set fleet2");
  await dialog.getByRole("button", {name: "Cancel"}).click();
  const now = await startFromDialog(page, day(2026, 10, 4), "Now");
  await expect(now.getByText("The piles run in this request")).toBeVisible();
  await now.getByRole("button", {name: "Start", exact: true}).click();
  await expect(now).toBeHidden();
  await expect(page).toHaveURL(/RunSet\('[0-9A-F]{32}'\)/);
  await expect(page.getByText("fleet2 / 2026-10-04").first()).toBeVisible();
  // whose state is which: the run's status in the header, the budget's in the progress table
  await expect(page.getByText("Run status", {exact: true}).first()).toBeVisible();
  await expect(op(page, "cockpitProgress")).toContainText("Budget state");
  const said = op(page, "cockpitAnswer");
  await expect(said).toContainText("Finished:");
  await expect(said).not.toContainText("{");
  await expect(said).not.toContainText("Answer");
  const r = await run(request, runId(page));
  expect(r.CheckDate).toBe("/Date(1791072000000)/");
  expect(r.RunLabel).toBe("2026-10-04 / Now");
  // a final run reads nothing on its own
  await expect(op(page, "liveSwitch").locator(".sapMSwt")).not.toHaveClass(/sapMSwtOn/);
});

test("Live refreshes a run's piles to DONE without a reload, then turns itself off", async ({page, request}) => {
  test.skip(!shared, "needs STG_DB=file and STG_DB_PATH, so the job worker reads the same rows");
  const dialog = await startFromDialog(page, day(2026, 10, 2), "In jobs");
  await dialog.getByRole("button", {name: "Start", exact: true}).click();
  await expect(page).toHaveURL(/RunSet\('[0-9A-F]{32}'\)/);
  const id = runId(page);
  await expect(op(page, "cockpitAnswer")).toContainText("Submitted:");
  // the run holds its date: the dialog says so before a second start
  const again = await startFromDialog(page, day(2026, 10, 2), "In jobs");
  await expect(again.locator('[id$="--startOpen"]')).toContainText("still open");
  await again.getByRole("button", {name: "Cancel"}).click();
  await page.goto(`${runsApp}#/RunSet('${id}')`);
  const live = op(page, "liveSwitch").locator(".sapMSwt");
  await expect(live).toHaveClass(/sapMSwtOn/);
  // the switch says ON where it is on, and Live reads on its own: the stamp moves without a click
  await expect(op(page, "liveSwitch")).toHaveAttribute("aria-checked", "true");
  await expect(op(page, "liveSwitch").locator(".sapMSwtLabelOn")).toBeVisible();
  const stamp = op(page, "liveStamp");
  const first = await stamp.innerText();
  await expect.poll(() => stamp.innerText(), {timeout: 15_000}).not.toBe(first);
  // off: it stops reading; on again: it reads again
  await live.click();
  await expect(live).not.toHaveClass(/sapMSwtOn/);
  await page.waitForTimeout(500);
  const stopped = await stamp.innerText();
  await page.waitForTimeout(7_000);
  await expect(stamp).toHaveText(stopped);
  await live.click();
  await expect(live).toHaveClass(/sapMSwtOn/);
  await expect.poll(() => stamp.innerText(), {timeout: 15_000}).not.toBe(stopped);
  const progress = op(page, "cockpitProgress");
  await expect(progress).toContainText("PLANNED");
  await expect(progress).not.toContainText("DONE");
  await page.evaluate(() => {window.cockpitNotReloaded = true;});
  startWorker();
  await expect(progress).toContainText("DONE", {timeout: 60_000});
  await expect(op(page, "liveStamp")).toContainText(/updated \d\d:\d\d:\d\d/);
  await expect.poll(async () => (await run(request, id)).Open, {timeout: 60_000}).toBe(false);
  await expect(live).not.toHaveClass(/sapMSwtOn/, {timeout: 20_000});
  expect(await page.evaluate(() => window.cockpitNotReloaded)).toBe(true);
});

test("Continue past glass is hidden without GLASS and shown with it, with the attention strip", async ({page, request}) => {
  test.skip(!shared, "needs STG_DB=file and STG_DB_PATH, so the job worker reads the same rows");
  startWorker();
  const done = (await (await request.get(`${service}/RunSet?$filter=Status eq 'DONE'`)).json()).d.results[0];
  await page.goto(`${runsApp}#/RunSet('${done.RunId}')`);
  await expect(page.getByText(done.Title).first()).toBeVisible();
  await expect(page.getByRole("button", {name: "Continue past glass"})).toHaveCount(0);
  await expect(op(page, "attentionBox")).toBeHidden();
  await setting(request, "budget.glass", "1", "browser glass fixture");
  try {
    const started = (await (await request.post(`${service}/StartRun?CheckDate='20261003'&Mode='P'`)).json()).d;
    expect(started.Answer).toContain("SUBMITTED");
    await expect.poll(async () => (await run(request, started.RunId)).Status, {timeout: 60_000}).toBe("GLASS");
    await page.goto(`${runsApp}#/RunSet('${started.RunId}')`);
    const header = page.locator('[id$="--action::ContinueGlass"], [id*="ContinueGlass"]').filter({hasText: "Continue past glass"}).first();
    await expect(header).toBeVisible();
    const attention = op(page, "attentionBox");
    await expect(attention).toBeVisible();
    await expect(attention).toContainText("Needs attention");
    await expect(op(page, "attentionGo")).toHaveClass(/sapMBtnEmphasized|sapMBtn/);
    await expect(op(page, "attentionGo").locator(".sapMBtnInner")).toHaveClass(/sapMBtnEmphasized/);
    await op(page, "attentionGo").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("New glass");
    // a status in red is a status, not an input in error
    await expect(page.getByText("Invalid entry")).toHaveCount(0);
    await dialog.locator("input").last().fill("browser continues");
    await dialog.getByRole("button", {name: "Continue past glass"}).click();
    await expect(op(page, "cockpitAnswer")).toContainText("Done.");
    await expect(page.getByRole("button", {name: "Continue past glass"})).toHaveCount(0, {timeout: 30_000});
  } finally {
    await reset(request, "budget.glass");
  }
});

test("a pile RUNNING in a job that is over: the run page says so and runs the doctor, then Resume in words", async ({page, request}) => {
  test.skip(!shared, "needs STG_DB=file and STG_DB_PATH, so the job worker reads the same rows");
  startWorker();
  // storm: the twin's candidates stage dumps, and a dumped job leaves its pile RUNNING
  await setting(request, "simulate.profile", "storm", "browser storm fixture");
  try {
    const started = (await (await request.post(`${service}/StartRun?CheckDate='20260928'&Mode='P'&Work='sim'`)).json()).d;
    expect(started.Answer).toContain("SUBMITTED");
    await expect.poll(async () => (await run(request, started.RunId)).PilesOrphaned, {timeout: 60_000}).toBeGreaterThan(0);
    await page.goto(`${runsApp}#/RunSet('${started.RunId}')`);
    const attention = op(page, "attentionBox");
    await expect(attention).toContainText("RUNNING without a live job");
    await expect(op(page, "attentionGo")).toHaveText("Run doctor");
    await op(page, "attentionGo").click();
    const dialog = page.getByRole("dialog", {name: "Run the doctor"});
    await dialog.getByRole("button", {name: "Run doctor"}).click();
    await expect(op(page, "cockpitAnswer")).toContainText(/pile\(s\) failed \(their job (ended|is gone)\)/);
    await expect(op(page, "cockpitAnswer")).not.toContainText("JOB-");
    await expect.poll(async () => (await run(request, started.RunId)).PilesFailed, {timeout: 30_000}).toBeGreaterThan(0);
    // the failed piles: Resume, named by the run and the count, with a button that says Resume
    await expect(attention).toContainText("failed", {timeout: 30_000});
    await op(page, "attentionGo").click();
    const resume = page.getByRole("dialog", {name: /^Resume: retry \d+ failed pile\(s\) of fleet2 \/ 2026-09-28$/});
    await expect(resume).toBeVisible();
    await expect(resume).not.toContainText(started.RunId);
    await expect(resume.getByRole("button", {name: "Confirm action"})).toHaveCount(0);
    await resume.getByRole("button", {name: "Resume", exact: true}).click();
    await expect(op(page, "cockpitAnswer")).toContainText(/pile\(s\) sent again/);
    await expect(op(page, "cockpitAnswer")).not.toContainText("RESUBMIT");
  } finally {
    await reset(request, "simulate.profile");
  }
});

test("Release is offered only on a HELD row", async ({page, request}) => {
  await setting(request, "budget.per_pile", "1", "browser held fixture");
  await setting(request, "piles.checks.size", "3", "browser held fixture");
  try {
    const started = (await (await request.post(`${service}/StartRun?CheckDate='20260930'&Mode='S'`)).json()).d;
    expect(started.RunId).toMatch(/^[0-9A-F]{32}$/);
    const held = (await (await request.get(`${service}/PileSet?$filter=RunId eq '${started.RunId}' and Status eq 'HELD'`)).json()).d.results;
    expect(held.length).toBeGreaterThan(0);
    await page.goto(`${runsApp}#/RunSet('${started.RunId}')`);
    await expect(op(page, "attentionBox")).toContainText("held");
    await page.getByRole("tab", {name: "Piles", exact: true}).click();
    const release = page.getByRole("button", {name: "Release held pile"});
    await expect(release).toBeDisabled();
    const rows = op(page, "Pile::Table").locator(".sapMListTblRow");
    const pick = (text) => rows.filter({hasText: text}).first().locator(".sapMLIBSelectS").click();
    // enabled for the held pile, disabled again for a done one (a transition, so the check waits for it)
    await pick(held[0].RuleName);
    await expect(release).toBeEnabled();
    await pick("DONE");
    await expect(release).toBeDisabled();
    await pick(held[0].RuleName);
    await expect(release).toBeEnabled();
    await release.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(held[0].RuleName);
    await dialog.locator("input").last().fill("browser reviewed pile");
    await dialog.getByRole("button", {name: "Release held pile"}).click();
    await expect(op(page, "cockpitAnswer")).toContainText("Done.");
    const events = (await (await request.get(`${service}/EventSet?$filter=RunId eq '${started.RunId}'`)).json()).d.results;
    expect(events.some((e) => e.Kind === "RELEASE" && e.Reason === "browser reviewed pile")).toBe(true);
  } finally {
    await reset(request, "budget.per_pile");
    await reset(request, "piles.checks.size");
  }
});

test("a section without rows is hidden, a section with rows is shown", async ({page, request}) => {
  const started = (await (await request.post(`${service}/StartRun?CheckDate='20260929'&Mode='S'`)).json()).d;
  const r = await run(request, started.RunId);
  const hidden = ["Stage", "Pile", "Budget", "Event", "Doctor", "Snapshot"].filter((s) => r[`Hide${s}`]);
  const shown = ["Stage", "Pile", "Budget", "Event", "Doctor", "Snapshot"].filter((s) => r[`Hide${s}`] === false);
  expect(hidden.length).toBeGreaterThan(0);
  expect(shown).toContain("Pile");
  const labels = {Stage: "Stages", Pile: "Piles", Budget: "Budget", Event: "Budget events", Doctor: "Doctor journal", Snapshot: "Settings of the run"};
  await page.goto(`${runsApp}#/RunSet('${started.RunId}')`);
  await expect(page.getByRole("tab", {name: "Progress", exact: true})).toBeVisible();
  for (const s of hidden) await expect(page.getByRole("tab", {name: labels[s], exact: true})).toHaveCount(0);
  // every section that is shown has rows (a table loads when its section comes into view)
  for (const s of shown) {
    await page.getByRole("tab", {name: labels[s], exact: true}).click();
    await expect(op(page, `${s}::Table`).locator("tbody .sapMListTblRow").first()).toBeVisible();
  }
});

test("the Set app changes a setting with a note, refuses one without, and shows the change log", async ({page, request}) => {
  await page.goto(setApp);
  await expect(page.getByText("Set fleet2", {exact: true}).first()).toBeVisible();
  for (const tab of ["Settings", "Schedule", "Kill switch", "Doctor"]) await expect(page.getByRole("tab", {name: tab})).toBeVisible();
  // every setting says what it means, in which unit
  await expect(page.locator("[id$=--settings] .sapMListTblRow").filter({hasText: "budget.narrow_at"})).toContainText("share of the glass in basis points from which piles are narrowed, 8000 = 80 %");
  await expect(page.locator("[id$=--settings] .sapMListTblRow").filter({hasText: "simulate.dump"})).toContainText("-1 = from the profile");
  const row = page.locator(".sapMListTblRow").filter({hasText: "budget.glass"}).first();
  await row.getByRole("button", {name: "Change"}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("budget.glass");
  const inputs = dialog.locator("input");
  await inputs.nth(0).fill("20");
  await dialog.getByRole("button", {name: "Confirm"}).click();
  // a change without a note is not sent
  await expect(dialog).toBeVisible();
  await inputs.nth(1).fill("browser capacity change");
  await dialog.getByRole("button", {name: "Confirm"}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[id$="--changes"]')).toContainText("browser capacity change");
  await expect(row).toContainText("20");
  const log = await request.get(`${service}/ChangeSet?$filter=NoteText eq 'browser capacity change'`);
  expect((await log.json()).d.results.length).toBeGreaterThan(0);
  // a value outside its bounds: the runner's refusal, in a message box
  await row.getByRole("button", {name: "Change"}).click();
  await inputs.nth(0).fill("0");
  await inputs.nth(1).fill("browser out of bounds");
  await dialog.getByRole("button", {name: "Confirm"}).click();
  await expect(page.getByRole("alertdialog")).toContainText("SetSetting");
  await page.getByRole("alertdialog").getByRole("button", {name: "Close"}).click();
  await reset(request, "budget.glass");
  // a setting with a value list (the twin's chaos profile) is chosen, not typed
  const profile = page.locator(".sapMListTblRow").filter({hasText: "simulate.profile"}).first();
  await expect(profile).toContainText("default, calm, squall, storm, flood, stuck, random");
  await profile.getByRole("button", {name: "Change"}).click();
  await dialog.locator(".sapMSlt").click();
  await page.getByRole("option", {name: "storm"}).click();
  await dialog.locator("input").last().fill("browser storm profile");
  await dialog.getByRole("button", {name: "Confirm"}).click();
  await expect(dialog).toBeHidden();
  await expect(profile).toContainText("storm");
  await reset(request, "simulate.profile");
  // the run page no longer carries the set's actions
  await page.goto(runsApp);
  await expect(page.getByRole("button", {name: "Run doctor"})).toHaveCount(0);
  // and the launchpad has both apps
  await page.goto("/app/flp.html");
  // "Runs fleet2" counts its open runs, "Set fleet2" is the second app
  const runsTile = page.locator(".sapMGT").filter({hasText: "Runs fleet2"});
  await expect(runsTile).toContainText(/\d+\s*open/);
  await expect(page.locator(".sapMGT").filter({hasText: "Set fleet2"})).toContainText("Settings, schedule, kill switch, doctor");
});
