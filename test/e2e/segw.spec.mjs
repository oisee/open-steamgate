import {test, expect} from "@playwright/test";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// SEGW as an application: webapp/segw/ over ZSTG_SEGW_SRV. The seeded
// project is ZSTG_MAPPED (data/zstg_sb*.tabu.json, the generator fixture);
// the app shows its tree, edits a property in place, adds and deletes one,
// and Generate runs segw-gen over the rows through the dev server.
const SERVICE = "/sap/opu/odata/sap/ZSTG_SEGW_SRV";

test("SEGW editor: the project tree, a property edited in place, Generate over the tables", async ({page}) => {
  const requests = [];
  page.on("request", (req) => {
    const text = req.method() + " " + req.url().replace(`http://localhost:${PORT}`, "") + " " + (req.postData() || "");
    if (text.includes("/sap/opu/odata/sap/") || text.includes("/segw/")) {
      requests.push(text.replace(/\r?\n/g, " "));
    }
  });
  const failed = [];
  page.on("response", (res) => {
    if ((res.url().includes("/sap/opu/odata/sap/") || res.url().includes("/segw/generate")) && res.status() >= 400) {
      failed.push(res.status() + " " + res.url());
    }
  });

  await page.goto("/app/segw/index.html");

  // the tree of the seeded project, expanded: the entity type, its property
  await expect(page.getByText("ZSTG_MAPPED", {exact: true}).first()).toBeVisible();
  await expect(page.getByText("Entity Types")).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "Travel", exact: true})).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "TravelId", exact: true})).toBeVisible();
  // the service implementation levels sit directly under their parent, a
  // mapping row names the property and the module parameter
  await expect(page.getByRole("treeitem", {name: "GetEntitySet (Query)"}).first()).toBeVisible();
  await expect(page.getByRole("treeitem", {name: /TravelId -> /}).first()).toBeVisible();

  // a property: its row shown as a form, keys read-only, MaxLength edited
  await page.getByRole("treeitem", {name: "TravelId", exact: true}).click();
  await expect(page.getByText("Property: TravelId")).toBeVisible();
  await expect(page.getByLabel("AbapField", {exact: true})).toHaveValue("TRAVEL_ID");
  await expect(page.getByLabel("NodeUuid", {exact: true})).not.toBeEditable();
  const maxLength = page.getByLabel("MaxLength", {exact: true});
  await expect(maxLength).toHaveValue("8");
  await maxLength.fill("12");
  await page.getByRole("button", {name: "Save"}).click();
  await expect(page.getByText("Saved")).toBeVisible();
  expect(requests.some((r) => r.includes("MERGE PropertySet(Project='ZSTG_MAPPED',NodeUuid='pr-a')") && r.includes('"MaxLength":"12"'))).toBe(true);
  const saved = await (await page.request.get(`${SERVICE}/PropertySet(Project='ZSTG_MAPPED',NodeUuid='pr-a')?$format=json`)).json();
  expect(saved.d.MaxLength).toBe("12");

  // a property added below the entity type: POST, then it is in the tree
  await page.getByRole("treeitem", {name: "Travel", exact: true}).click();
  await expect(page.getByText("EntityType: Travel")).toBeVisible();
  await page.getByRole("button", {name: "Add property"}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Price");
  await dialog.getByRole("button", {name: "Add"}).click();
  await expect(page.getByRole("treeitem", {name: "Price", exact: true})).toBeVisible();
  expect(requests.some((r) => r.includes("POST PropertySet") && r.includes('"Name":"Price"') && r.includes('"ParentUuid":"et-1"'))).toBe(true);

  // Generate: the dev server pulls the rows back into an IWPR and runs
  // segw-gen; the new property is in the generated MPC
  await page.getByRole("button", {name: "Generate"}).click();
  // a MessageBox is an alertdialog
  const generated = page.getByRole("alertdialog");
  await expect(generated).toContainText("zcl_zstg_mapped_mpc.clas.abap");
  await expect(generated).toContainText("zcl_zstg_mapped_dpc_ext.clas.abap");
  await generated.getByRole("button", {name: "OK"}).click();
  const gen = await (await page.request.post("/segw/generate/ZSTG_MAPPED")).json();
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("iv_property_name = 'Price' iv_abap_fieldname = 'PRICE'");
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("set_maxlength( iv_max_length = 12 )");
  // Export IWPR: GET ExportSet('ZSTG_MAPPED'), the IWPR written in ABAP,
  // handed over as the abapGit file
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "Export IWPR"}).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("zstg_mapped.iwpr.xml");
  const iwpr = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  expect(iwpr).toContain("<NAME>Price</NAME>");
  expect(iwpr).toContain('<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWPR"');
  expect(requests.some((r) => r.includes("ExportSet('ZSTG_MAPPED')"))).toBe(true);

  // deleted again: DELETE by key, gone from the tree
  await page.getByRole("treeitem", {name: "Price", exact: true}).click();
  await page.getByRole("button", {name: "Delete"}).click();
  await page.getByRole("alertdialog").getByRole("button", {name: "OK"}).click();
  await expect(page.getByText("Deleted")).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "Price", exact: true})).toHaveCount(0);
  // inside the $batch changeset, like the MERGE
  expect(requests.some((r) => r.includes("DELETE PropertySet(Project='ZSTG_MAPPED',NodeUuid='"))).toBe(true);

  // Import IWPR: the file goes to ImportSet as one POST, the imported
  // project is selected and its tree shown
  await page.getByRole("button", {name: "Import IWPR"}).click();
  await page.locator("#stg-segw-import").setInputFiles("test/fixtures/segw/zstg_mini.iwpr.xml");
  await expect(page.getByText(/zstg_mini\.iwpr\.xml: \d+ rows in \d+ tables of ZSTG_MINI/)).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "ZSTG_MINI", exact: true})).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "Travel", exact: true})).toBeVisible();
  expect(requests.some((r) => r.includes("POST ImportSet") && r.includes("LCL_OBJECT_IWPR"))).toBe(true);

  expect(failed, failed.join("\n")).toEqual([]);
});

test("launchpad: the SEGW tile opens the editor", async ({page}) => {
  await page.goto("/app/flp.html");
  const tile = page.getByRole("link", {name: /SEGW/}).or(page.locator(".sapUshellTile", {hasText: "SEGW"})).first();
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page).toHaveURL(/#SegwProject-manage/);
  await expect(page.getByText("Entity Types")).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "TravelId", exact: true})).toBeVisible();
});
