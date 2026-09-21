import {test, expect} from "@playwright/test";

// The Fiori-native source loop. The broken source exists only in the Ace
// buffer: this test proves the browser Check path diagnoses it without a
// repository mutation. The disposable-store suite separately covers the ADT
// Save/Activate transport contract; it does not substitute for UI coverage.
test("Workbench: tile, ABAP editor and a diagnostic over the unsaved buffer", async ({page}) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/app/flp.html");
  const tile = page.getByRole("link", {name: /^Workbench\b/}).or(
    page.locator(".sapMGT, .sapUshellTile", {hasText: "Workbench"})
  ).first();
  await expect(tile).toBeVisible({timeout: 60_000});
  await tile.click();
  await expect(page).toHaveURL(/#Workbench-edit/);

  const object = page.getByText("ZCL_OSD_EDIT", {exact: true});
  await expect(object).toBeVisible({timeout: 60_000});
  await object.click();

  const editor = page.locator(".ace_editor").first();
  await expect(editor).toBeVisible();
  // The shared FLP bootstrap logs its own missing optional flexibility
  // bundles before an application starts. From here onward every error
  // belongs to the Workbench interaction this test owns.
  consoleErrors.length = 0;
  expect(await editor.evaluate((element) => window.ace.edit(element).getSession().getMode().$id))
    .toBe("ace/mode/abap");

  const sourceUrl = "/sap/bc/adt/oo/classes/zcl_osd_edit/source/main";
  const before = await page.evaluate((url) => fetch(url).then((response) => response.text()), sourceUrl);
  await expect(page.getByText("Saved", {exact: true})).toBeVisible();

  await page.route("**/adt/checkruns?**", async (route) => {
    await route.fulfill({status: 200, contentType: "application/vnd.sap.adt.checkmessages+xml",
      body: `<?xml version="1.0"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:status="notProcessed" chkrun:statusText="compiler unavailable"><chkrun:checkMessageList/></chkrun:checkReport></chkrun:checkRunReports>`});
  });
  await page.getByRole("button", {name: "Check", exact: true}).click();
  await expect(page.getByText("Check did not complete: compiler unavailable", {exact: true})).toBeVisible();
  await page.unroute("**/adt/checkruns?**");

  await page.getByRole("button", {name: "Check", exact: true}).click();
  await expect(page.getByText("Check passed. Nothing was saved or activated.", {exact: true}))
    .toBeVisible({timeout: 60_000});

  await editor.evaluate((element) => {
    const ace = window.ace.edit(element);
    if (!ace.find("METHOD esc.", {caseSensitive: true, wholeWord: false})) {
      throw new Error("edit anchor not found");
    }
    ace.navigateLineEnd();
    ace.focus();
  });
  await page.keyboard.type(" DATA lv_bad TYPE i. lv_bad = no_such_method( ).");
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Check", exact: true}).focus();
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();

  // A parent layout can invalidate the CodeEditor without changing its value
  // property. The live Ace buffer must survive that lifecycle.
  await editor.evaluate((element) => {
    const host = element.closest("[data-sap-ui]");
    const control = host && sap.ui.getCore().byId(host.id);
    if (!control) throw new Error("CodeEditor control not found");
    control.invalidate();
    sap.ui.getCore().applyChanges();
  });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue())).toContain("no_such_method");
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: "Check", exact: true}).click();
  await expect(page.getByText(/problem\(s\).*Nothing was saved or activated/i)).toBeVisible({timeout: 60_000});
  const problem = page.getByText(/Method .no_such_method. not found/i);
  await expect(problem).toBeVisible();
  await problem.click();
  await expect(page.locator(".ace_gutter-cell.ace_error")).toBeVisible();

  let saveIfMatch = "";
  await page.route("**/adt/oo/classes/zcl_osd_edit/source/main?**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saveIfMatch = route.request().headers()["if-match"] || "";
    await route.fulfill({status: 412, contentType: "application/xml",
      body: "<exc:exception xmlns:exc=\"http://www.sap.com/adt/exceptions\"><exc:type>ExceptionResourceIsModified</exc:type><exc:message>source changed since it was opened</exc:message></exc:exception>"});
  });
  await page.getByRole("button", {name: "Save inactive", exact: true}).click();
  await expect(page.getByText(/HTTP 412.*source changed since it was opened/i)).toBeVisible();
  expect(saveIfMatch).not.toBe("");
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue())).toContain("no_such_method");
  expect(consoleErrors).toHaveLength(1);
  expect(consoleErrors[0]).toContain("412 (Precondition Failed)");
  consoleErrors.length = 0;
  await page.unroute("**/adt/oo/classes/zcl_osd_edit/source/main?**");

  // A successful activation is not proof that the currently serving process
  // switched. Mock only the two replies and verify the identity-aware warning.
  const validEdit = before + "\n* unsaved activation probe\n";
  await editor.evaluate((element, source) => window.ace.edit(element).setValue(source, -1), validEdit);
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  const operationOrder = [];
  await page.route("**/adt/oo/classes/zcl_osd_edit/source/main?**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    operationOrder.push("put");
    await route.fulfill({status: 200, headers: {etag: "mock-saved-etag"}, body: ""});
  });
  let activationIfMatch = "";
  await page.route("**/adt/activation?**", async (route) => {
    operationOrder.push("activate");
    activationIfMatch = route.request().headers()["if-match"] || "";
    await route.fulfill({status: 200, contentType: "application/xml",
      body: "<chkl:messages xmlns:chkl=\"http://www.sap.com/adt/checklist\"><chkl:properties activationExecuted=\"true\"/></chkl:messages>"});
  });
  const identity = {commit: "0123456789abcdef", system: {source: "aaaaaaaa1111",
    live: "aaaaaaaa1111", serving: "bbbbbbbb3333", synchronized: false}};
  await page.route("**/adt/core/http/build", async (route) => {
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(identity)});
  });
  await page.getByRole("button", {name: "Activate", exact: true}).click();
  await expect(page.getByText(/Activated and built, but the serving runtime has not switched/i)).toBeVisible();
  expect(operationOrder).toEqual(["put", "activate"]);
  expect(activationIfMatch).toBe("mock-saved-etag");

  // Display prefixes may match while full generation IDs differ. That is not
  // enough evidence to claim the built source became live.
  identity.system.live = "aaaaaaaa2222";
  await page.getByRole("button", {name: "Activate", exact: true}).click();
  await expect(page.getByText(/Activation was accepted, but source, live and serving identities are not synchronized/i)).toBeVisible();

  await page.unroute("**/adt/oo/classes/zcl_osd_edit/source/main?**");
  await page.unroute("**/adt/activation?**");
  await page.unroute("**/adt/core/http/build");

  const after = await page.evaluate((url) => fetch(url).then((response) => response.text()), sourceUrl);
  expect(after).toBe(before);
  expect(consoleErrors).toEqual([]);
});
