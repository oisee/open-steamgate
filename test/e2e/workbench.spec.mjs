import {test, expect} from "@playwright/test";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
};

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

  await page.setViewportSize({width: 1600, height: 900});
  await page.goto("/app/flp.html");
  const tile = page.getByRole("link", {name: /^Workbench\b/}).or(
    page.locator(".sapMGT, .sapUshellTile", {hasText: "Workbench"})
  ).first();
  await expect(tile).toBeVisible({timeout: 60_000});
  await tile.click();
  await expect(page).toHaveURL(/#Workbench-edit/);

  const application = page.locator("#application-Workbench-edit");
  await expect(application).not.toHaveClass(/sapUShellApplicationContainerLimitedWidth/);
  expect((await application.boundingBox()).width).toBeGreaterThan(1500);

  const currentType = () => page.evaluate(() => [...document.querySelectorAll("[data-sap-ui]")]
    .map((element) => sap.ui.getCore().byId(element.id))
    .find((control) => control?.getId?.().endsWith("--objectType"))?.getSelectedKey());
  const chooseType = (key) => page.evaluate((wanted) => {
    const select = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--objectType"));
    if (!select) throw new Error("Object type Select not found");
    select.setSelectedKey(wanted);
    select.fireChange({selectedItem: select.getSelectedItem()});
  }, key);

  await page.evaluate(() => {
    const search = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--search"));
    search.fireLiveChange({newValue: "DOES_NOT_EXIST*"});
  });
  await chooseType("INTF/OI");
  await expect(page.getByText("ZIF_OSD_LUW", {exact: true})).toBeVisible({timeout: 60_000});
  await page.waitForTimeout(400);
  await expect(page.getByText("ZIF_OSD_LUW", {exact: true})).toBeVisible();
  await chooseType("PROG/P");
  await expect(page.getByText("ZOSD_TEST_DEMO_PROG", {exact: true})).toBeVisible({timeout: 60_000});
  await chooseType("DDLS/DF");
  const cds = page.getByText("ZC_OSD_DATABASE", {exact: true});
  await expect(cds).toBeVisible({timeout: 60_000});
  await cds.click();

  const editor = page.locator(".ace_editor").first();
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate((element) =>
    window.ace.edit(element).getSession().getMode().$id)).toBe("ace/mode/sql");

  await chooseType("CLAS/OC");
  const object = page.getByText("ZCL_OSD_EDIT", {exact: true});
  await expect(object).toBeVisible({timeout: 60_000});
  await object.click();
  // The shared FLP bootstrap logs its own missing optional flexibility
  // bundles before an application starts. From here onward every error
  // belongs to the Workbench interaction this test owns.
  consoleErrors.length = 0;
  expect(await editor.evaluate((element) => window.ace.edit(element).getSession().getMode().$id))
    .toBe("ace/mode/abap");

  const sourceUrl = "/sap/bc/adt/oo/classes/zcl_osd_edit/source/main";
  const before = await page.evaluate((url) => fetch(url).then((response) => response.text()), sourceUrl);
  await expect(page.getByText("Saved", {exact: true})).toBeVisible();

  const gitState = await page.evaluate(() => fetch(
    "/sap/bc/adt/core/http/git/object?type=CLAS%2FOC&name=ZCL_OSD_EDIT"
  ).then((response) => response.json()));
  expect(gitState).toMatchObject({available: true, tracked: true, status: "clean"});
  expect(gitState.head).toMatch(/^[0-9a-f]{40}$/);
  expect(gitState.file).toMatch(/zcl_osd_edit\.clas\.abap$/);
  expect(gitState.history.length).toBeGreaterThan(0);
  expect(gitState.history[0]).toEqual(expect.objectContaining({
    revision: expect.stringMatching(/^[0-9a-f]{40}$/), author: expect.any(String), subject: expect.any(String)
  }));
  const committed = await page.evaluate((revision) => fetch("/sap/bc/adt/core/http/git/object/revision?" +
    "type=CLAS%2FOC&name=ZCL_OSD_EDIT&revision=" + revision).then((response) => response.text()), gitState.history[0].revision);
  expect(committed).toBe(before);
  const invalidRevisionStatus = await page.evaluate(() => fetch(
    "/sap/bc/adt/core/http/git/object/revision?type=CLAS%2FOC&name=ZCL_OSD_EDIT&revision=HEAD"
  ).then((response) => response.status));
  expect(invalidRevisionStatus).toBe(400);
  await expect(page.getByText("Git history", {exact: true})).toBeVisible();
  consoleErrors.length = 0; // the rejected fetch is the expected negative control
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--gitPanel"));
    panel.setExpanded(true);
  });
  await expect(page.getByText(/Stored inactive source vs HEAD/)).toBeVisible();
  await expect(page.getByText("Stored source matches HEAD.", {exact: true})).toBeVisible();

  await expect(page.getByText(gitState.history[0].subject, {exact: true}).first()).toBeVisible();
  await page.evaluate((revision) => {
    const table = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--gitVersions"));
    const item = table.getItems().find((row) => row.getBindingContext("ui")?.getObject()?.revision === revision);
    if (!item) throw new Error("Git revision row not found");
    table.setSelectedItem(item);
    table.fireSelectionChange({listItem: item});
  }, gitState.history[0].revision);

  const restore = page.getByRole("button", {name: "Restore version", exact: true});
  await expect(restore).toBeEnabled();
  await page.route("**/adt/core/http/git/object/revision?**", async (route) => {
    await route.fulfill({status: 200, contentType: "text/plain",
      body: before + "\n* restored from Git\n"});
  });
  await restore.click();
  const restoreDialog = page.getByRole("alertdialog", {name: /Restore Git version/});
  await expect(restoreDialog).toBeVisible();
  await restoreDialog.getByRole("button", {name: "OK", exact: true}).click();
  await expect(page.getByText(/Git version loaded into the editor.*Save inactive.*Check.*Activate/i))
    .toBeVisible();
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue()))
    .toContain("restored from Git");
  await page.unroute("**/adt/core/http/git/object/revision?**");
  await page.getByRole("button", {name: "Discard edits", exact: true}).click();
  const restoredDiscard = page.getByRole("alertdialog", {name: /Unsaved edits/});
  await expect(restoredDiscard).toBeVisible();
  await restoredDiscard.getByRole("button", {name: "OK", exact: true}).click();
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

  await chooseType("INTF/OI");
  let typeDialog = page.getByRole("alertdialog", {name: /Unsaved edits/});
  await expect(typeDialog).toBeVisible();
  await typeDialog.getByRole("button", {name: "Cancel", exact: true}).click();
  await expect.poll(currentType).toBe("CLAS/OC");
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue())).toContain("no_such_method");

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

  await page.getByRole("button", {name: "Discard edits", exact: true}).click();
  let discardDialog = page.getByRole("alertdialog", {name: /Unsaved edits/});
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", {name: "Cancel", exact: true}).click();
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue())).toContain("no_such_method");

  await page.getByRole("button", {name: "Discard edits", exact: true}).click();
  discardDialog = page.getByRole("alertdialog", {name: /Unsaved edits/});
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", {name: "OK", exact: true}).click();
  await expect(page.getByText("Unsaved edits discarded. Stored inactive source is unchanged.", {exact: true})).toBeVisible();
  await expect(page.getByText("Saved", {exact: true})).toBeVisible();
  expect(await editor.evaluate((element) => window.ace.edit(element).getValue())).not.toContain("no_such_method");

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

  await editor.evaluate((element, source) => window.ace.edit(element).setValue(source + "\n* type switch probe\n", -1), before);
  await expect(page.getByText("Modified", {exact: true})).toBeVisible();
  await chooseType("INTF/OI");
  typeDialog = page.getByRole("alertdialog", {name: /Unsaved edits/});
  await expect(typeDialog).toBeVisible();
  await typeDialog.getByRole("button", {name: "OK", exact: true}).click();
  await expect.poll(currentType).toBe("INTF/OI");
  await expect(page.getByText("ZIF_OSD_LUW", {exact: true})).toBeVisible();
  await expect.poll(() => editor.evaluate((element) => window.ace.edit(element).getValue())).toBe("");

  // Browse-only DDIC objects expose their generated definition and real rows
  // without pretending that the Workbench can safely rewrite abapGit XML.
  await chooseType("TABL/DT");
  const tableObject = page.getByText("ZOSD_TEST_ITEM", {exact: true});
  await expect(tableObject).toBeVisible({timeout: 60_000});
  await tableObject.click();
  await expect(page.getByText("Browse only", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Save inactive", exact: true})).toBeDisabled();
  await expect.poll(() => editor.evaluate((element) => window.ace.edit(element).getValue()))
    .toContain("define table zosd_test_item");
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--objectTools"));
    tabs.setExpanded(true);
    tabs.setSelectedKey("data");
  });
  await page.getByRole("button", {name: "Preview Data", exact: true}).click();
  await expect(page.getByText("Bearing, 6203-2RS", {exact: true})).toBeVisible({timeout: 60_000});
  await expect(page.getByText(/6 row\(s\), 6 column\(s\)/)).toBeVisible();

  // A late preview belongs to the object that started it, never to whichever
  // object happens to be selected when the response arrives.
  const previewStarted = deferred();
  const releasePreview = deferred();
  const previewFinished = deferred();
  await page.route("**/adt/datapreview/ddic?**", async (route) => {
    previewStarted.resolve();
    await releasePreview.promise;
    await route.fulfill({status: 200, contentType: "application/xml", body:
      '<result><columns><metadata name="STALE"/><data>STALE-PREVIEW-MUST-NOT-APPEAR</data></columns>' +
      '<totalRows>1</totalRows><queryExecutionTime>1</queryExecutionTime></result>'});
    previewFinished.resolve();
  });
  await page.getByRole("button", {name: "Preview Data", exact: true}).click();
  await previewStarted.promise;

  // The Tests tab discovers ownership before execution and can run exactly
  // one selected method through the same isolated runner as ADT.
  await chooseType("CLAS/OC");
  releasePreview.resolve();
  await previewFinished.promise;
  await page.unroute("**/adt/datapreview/ddic?**");
  await expect(page.getByText("STALE-PREVIEW-MUST-NOT-APPEAR", {exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll("[data-sap-ui]")]
    .map((element) => sap.ui.getCore().byId(element.id))
    .find((control) => control?.getId?.().endsWith("--page"))
    ?.getModel("ui").getProperty("/preview/message")))
    .toBe("Run Preview Data to read up to 100 rows.");
  await page.evaluate(() => {
    const search = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--search"));
    search.setValue("ZCL_ZOSD_TEST_DEMO");
    search.fireSearch({query: "ZCL_ZOSD_TEST_DEMO"});
  });
  const testedClass = page.getByText("ZCL_ZOSD_TEST_DEMO", {exact: true});
  await expect(testedClass).toBeVisible({timeout: 60_000});
  await testedClass.click();
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("[data-sap-ui]")]
      .map((element) => sap.ui.getCore().byId(element.id))
      .find((control) => control?.getId?.().endsWith("--objectTools"));
    tabs.setExpanded(true);
    tabs.setSelectedKey("tests");
  });
  await expect(page.getByText("GREETING_PASSES", {exact: true})).toBeVisible({timeout: 60_000});
  await expect(page.getByText("DELIBERATE_FAILURE", {exact: true})).toBeVisible();
  await page.getByText("GREETING_PASSES", {exact: true}).click();
  await page.getByRole("button", {name: "Run selected", exact: true}).click();
  await expect(page.getByText("ABAP Unit passed.", {exact: true})).toBeVisible({timeout: 180_000});
  await expect(page.getByText("Passed", {exact: true})).toBeVisible();

  // Setup/transpilation failures can be class-level and contain no method
  // result. They must clear an old green result and surface the diagnostic.
  await page.route("**/adt/core/http/unit/object/run?**", async (route) => {
    const selectedClass = new URL(route.request().url()).searchParams.get("testClass");
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({
      ok: false, ms: 1, counts: {classes: 1, methods: 0, passed: 0, failed: 0, classAlerts: 1},
      testClasses: [{name: selectedClass, alerts: [{title: "SETUP-FAILURE-MUST-BE-VISIBLE", details: []}], testMethods: []}],
    })});
  });
  await page.getByRole("button", {name: "Run selected", exact: true}).click();
  await expect(page.getByText("Blocked", {exact: true})).toBeVisible();
  await expect(page.getByText("SETUP-FAILURE-MUST-BE-VISIBLE", {exact: true})).toBeVisible();
  await page.unroute("**/adt/core/http/unit/object/run?**");

  await page.getByText("DELIBERATE_FAILURE", {exact: true}).click();
  await page.getByRole("button", {name: "Run selected", exact: true}).click();
  await expect(page.getByText("ABAP Unit reported failures.", {exact: true})).toBeVisible({timeout: 180_000});
  await expect(page.getByText("Failed", {exact: true})).toBeVisible();
  await expect(page.getByText(/this assertion fails on purpose/i)).toBeVisible();

  const runStarted = deferred();
  const releaseRun = deferred();
  const runFinished = deferred();
  await page.route("**/adt/core/http/unit/object/run?**", async (route) => {
    runStarted.resolve();
    await releaseRun.promise;
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({
      ok: false, ms: 1, counts: {classes: 1, methods: 0, passed: 0, failed: 0, classAlerts: 1},
      testClasses: [{name: "LTCL_DEMO", alerts: [{title: "STALE-RUN-MUST-NOT-APPEAR", details: []}], testMethods: []}],
    })});
    runFinished.resolve();
  });
  await page.getByRole("button", {name: "Run selected", exact: true}).click();
  await runStarted.promise;
  await chooseType("INTF/OI");
  releaseRun.resolve();
  await runFinished.promise;
  await page.unroute("**/adt/core/http/unit/object/run?**");
  await expect(page.getByText("STALE-RUN-MUST-NOT-APPEAR", {exact: true})).toHaveCount(0);
  await expect(page.getByText("ABAP Unit reported failures.", {exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll("[data-sap-ui]")]
    .map((element) => sap.ui.getCore().byId(element.id))
    .find((control) => control?.getId?.().endsWith("--page"))
    ?.getModel("ui").getProperty("/tests/rows"))).toEqual([]);

  const after = await page.evaluate((url) => fetch(url).then((response) => response.text()), sourceUrl);
  expect(after).toBe(before);
  expect(consoleErrors).toEqual([]);
});
