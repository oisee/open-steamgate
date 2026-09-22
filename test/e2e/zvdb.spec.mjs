import {test, expect} from "@playwright/test";

test("launchpad shows the live vector count", async ({page}) => {
  await page.goto("/app/flp.html");
  await page.getByLabel("Group Navigation").getByText("Content packs", {exact: true}).click();
  const tile = page.locator(".sapUshellTile", {hasText: "Vector workbench"}).first();
  await expect(tile).toBeVisible();
  await expect(tile).toContainText(/[1-9][0-9]*/);
  await expect(tile).toContainText("vectors");
});

test("vector workbench filters a diverse Master and resizes it", async ({page}) => {
  await page.goto("/app/zvdb/");
  await expect(page.getByText(/query vectors in EGEMMA768/)).toBeVisible();

  const rows = () => page.evaluate(() => {
    const element = document.querySelector("[id$='--masterList']");
    const control = sap.ui.getCore().byId(element.id);
    return control.getModel("state").getProperty("/vectors");
  });
  const initial = await rows();
  expect(initial).toHaveLength(2002);
  expect(new Set(initial.slice(0, 20).map((row) => row.Group)).size).toBe(20);

  await page.locator("[id$='--randomButton']").click();
  await expect(page.getByText("20 random texts, one per distinct group.")).toBeVisible();
  const random = await rows();
  expect(random).toHaveLength(20);
  expect(new Set(random.map((row) => row.Group)).size).toBe(20);

  await page.locator("[id$='--masterSearch'] input").fill("буди");
  await expect(page.getByText(/matching query vectors in EGEMMA768/)).toBeVisible();
  const filtered = await rows();
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered.every((row) => row.Payload.toLocaleLowerCase("ru").includes("буди"))).toBe(true);

  const splitter = page.locator("[id$='--splitter']");
  const box = await splitter.boundingBox();
  expect(box.height).toBeGreaterThan(700);
  const bar = splitter.locator(".sapUiLoSplitterBar").first();
  const before = await bar.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + 100);
  await page.mouse.down();
  await page.mouse.move(before.x + 120, before.y + 100, {steps: 10});
  await page.mouse.up();
  const after = await bar.boundingBox();
  expect(after.x - before.x).toBeGreaterThan(80);
});

test("vector workbench exposes the original AMDP on DuckDB", async ({page}) => {
  await page.goto("/app/zvdb/");
  await expect(page.getByText(/query vectors in EGEMMA768/)).toBeVisible();
  const database = await page.getByText(/^DB:/).textContent();
  test.skip(!/duckdb/i.test(database || ""), "Portable AMDP product path is the DuckDB engine");
  await page.locator("[id$='--masterList'] .sapMLIB").first().click();
  await page.evaluate(() => {
    const element = document.querySelector("[id$='--engineSelect']");
    const control = sap.ui.getCore().byId(element.id);
    control.setSelectedKey("AMDP");
    control.fireChange({selectedItem: control.getSelectedItem()});
  });
  await expect(page.getByText(/nearest texts, sorted by AMDP rank/)).toBeVisible();
  await expect(page.locator(".sapMListTblRow", {hasText: "AMDP"}).first()).toBeVisible();
});

test("vector quality renders the published report", async ({page}) => {
  await page.goto("/app/zvdb/quality/");
  await expect(page.getByText("Published", {exact: true})).toBeVisible();
  await expect(page.getByText(/320 stratified queries/)).toBeVisible();
  await expect(page.getByText("Precision@10", {exact: true})).toBeVisible();
  await expect(page.getByText("Top-1 accuracy", {exact: true})).toBeVisible();
  await expect(page.getByText("ROC AUC", {exact: true})).toBeVisible();
  await expect(page.getByText("Best threshold F1", {exact: true})).toBeVisible();
  await expect(page.locator("svg[aria-label='Intent confusion matrix'] rect")).toHaveCount(1600);
  const content = page.locator(".sapMPageEnableScrolling").first();
  const contentBox = await content.boundingBox();
  expect(contentBox.height).toBeGreaterThan(500);

  await page.evaluate(() => {
    const element = document.querySelector("[id$='--bucketSelect']");
    const control = sap.ui.getCore().byId(element.id);
    control.setSelectedKey("QWEN31024");
    control.fireChange({selectedItem: control.getSelectedItem()});
  });
  await expect(page.getByText(/726 \/ 1024 matching bits/)).toBeVisible();
});
