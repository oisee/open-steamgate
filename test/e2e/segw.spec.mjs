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

  // what SEGW's Create makes, from the folders: an entity type, a set with
  // its five operations under Service Implementation, a function import
  // returning it; from a row: a navigation property needs an association
  await page.getByRole("treeitem", {name: "Entity Types", exact: true}).click();
  await page.getByRole("button", {name: "Add entity type"}).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Plane");
  await page.getByRole("dialog").getByRole("button", {name: "Add"}).click();
  await expect(page.getByRole("treeitem", {name: "Plane", exact: true})).toBeVisible();
  await page.getByRole("treeitem", {name: "Entity Sets", exact: true}).click();
  await page.getByRole("button", {name: "Add entity set"}).click();
  const setDialog = page.getByRole("dialog");
  await setDialog.getByRole("textbox").fill("PlaneSet");
  // sap.m.Select: the visible control, then the option in its popover
  await setDialog.locator(".sapMSlt").first().click();
  await page.getByRole("option", {name: "Plane"}).click();
  await setDialog.getByRole("button", {name: "Add"}).click();
  // once under Entity Sets, once under Service Implementation, with the operations
  await expect(page.getByRole("treeitem", {name: "PlaneSet", exact: true})).toHaveCount(2);
  await expect(page.getByRole("treeitem", {name: "Update", exact: true})).toBeVisible();
  expect(requests.some((r) => r.includes("POST EntitySetSet") && r.includes('"Name":"PlaneSet"') && r.includes("POST OperationSet") && r.includes('"ImpMethod":"PLANESET_GET_ENTITYSET"'))).toBe(true);
  await page.getByRole("treeitem", {name: "Function Imports", exact: true}).click();
  await page.getByRole("button", {name: "Add function import"}).click();
  const fiDialog = page.getByRole("dialog");
  await fiDialog.getByRole("textbox").fill("Refuel");
  await fiDialog.locator(".sapMSlt").nth(1).click();
  await page.getByRole("option", {name: "Plane"}).click();
  await fiDialog.getByRole("button", {name: "Add"}).click();
  await expect(page.getByRole("treeitem", {name: "Refuel", exact: true})).toBeVisible();
  expect(requests.some((r) => r.includes("POST FunctionImportSet") && r.includes('"ReturnTypeKind":"ETYP"'))).toBe(true);
  await page.getByRole("treeitem", {name: "Associations", exact: true}).click();
  await page.getByRole("button", {name: "Add association"}).click();
  const asoDialog = page.getByRole("dialog");
  await asoDialog.getByRole("textbox").fill("PlaneToTravel");
  await asoDialog.locator(".sapMSlt").nth(0).click();
  await page.getByRole("option", {name: "Plane"}).click();
  await asoDialog.getByRole("button", {name: "Add"}).click();
  await expect(page.getByRole("treeitem", {name: "PlaneToTravel", exact: true})).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "PlaneToTravelSet", exact: true})).toBeVisible();
  await page.getByRole("treeitem", {name: "Plane", exact: true}).click();
  await page.getByRole("button", {name: "Add navigation property"}).click();
  const npDialog = page.getByRole("dialog");
  await npDialog.getByRole("textbox").fill("to_Travels");
  await npDialog.getByRole("button", {name: "Add"}).click();
  await expect(page.getByRole("treeitem", {name: "to_Travels", exact: true})).toBeVisible();

  // the function group the mapped operations need: a fugr.xml through the
  // same Import button goes to FunctionGroupSet (module signatures)
  await page.getByRole("button", {name: "Import IWPR"}).click();
  await page.locator("#stg-segw-import").setInputFiles("test/fixtures/segw/zstg_rfc.fugr.xml");
  await expect(page.getByText(/zstg_rfc\.fugr\.xml: \d+ modules, \d+ parameters/)).toBeVisible();
  expect(requests.some((r) => r.includes("POST FunctionGroupSet") && r.includes("LCL_OBJECT_FUGR"))).toBe(true);

  // Generate: GenerateSet of the service (segw-gen in ABAP) lists the
  // files; a file opens as source; Save to gen/ lands them through the dev
  // server, whose answer carries the same contents
  await page.getByRole("button", {name: "Generate"}).click();
  const generated = page.getByRole("dialog", {name: /Generated ZSTG_MAPPED/});
  await expect(generated).toContainText("zcl_zstg_mapped_mpc.clas.abap");
  await expect(generated).toContainText("zcl_zstg_mapped_dpc_ext.clas.abap");
  expect(requests.some((r) => r.includes("GenerateSet") && r.includes("Project eq 'ZSTG_MAPPED'") || r.includes("Project%20eq%20%27ZSTG_MAPPED%27"))).toBe(true);
  await generated.getByText("zcl_zstg_mapped_mpc.clas.abap").click();
  const source = page.getByRole("dialog", {name: "zcl_zstg_mapped_mpc.clas.abap"});
  await expect(source.getByRole("textbox")).toHaveValue(/iv_property_name = 'Price' iv_abap_fieldname = 'PRICE'/);
  await source.getByRole("button", {name: "Close"}).click();
  await generated.getByRole("button", {name: "Save to gen/"}).click();
  await expect(page.getByText(/\d+ files in gen\/segw-editor\/zstg_mapped/)).toBeVisible();
  await generated.getByRole("button", {name: "Close"}).click();
  const gen = await (await page.request.post("/segw/generate/ZSTG_MAPPED")).json();
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("iv_property_name = 'Price' iv_abap_fieldname = 'PRICE'");
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("set_maxlength( iv_max_length = 12 )");
  // the nodes created from the folders are in the generated model too
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("model->create_entity_type( iv_entity_type_name = 'Plane'");
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("'PlaneSet'");
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("lo_action = model->create_action( 'Refuel' )");
  expect(gen.files["zcl_zstg_mapped_mpc.clas.abap"]).toContain("'to_Travels'");
  expect(gen.files["zcl_zstg_mapped_dpc.clas.abap"]).toContain("planeset_get_entityset");
  // the RFC-mapped operation has its body, from the signatures just imported
  expect(gen.files["zcl_zstg_mapped_dpc.clas.abap"]).toContain("CALL FUNCTION lv_rfc_name");
  expect(gen.files["zcl_zstg_mapped_dpc.clas.abap"]).toContain("iv_travel_id");

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

  // an entity type with sets is refused before anything is sent
  await page.getByRole("treeitem", {name: "Travel", exact: true}).click();
  await page.getByRole("button", {name: "Delete"}).click();
  await expect(page.getByRole("alertdialog")).toContainText("used by TravelSet");
  await page.getByRole("alertdialog").getByRole("button", {name: "Close"}).click();

  // the property deleted again: DELETE NodeSet (the subtree delete of the
  // service), gone from the tree
  await page.getByRole("treeitem", {name: "Price", exact: true}).click();
  await page.getByRole("button", {name: "Delete"}).click();
  await page.getByRole("alertdialog").getByRole("button", {name: "OK"}).click();
  await expect(page.getByText("Deleted")).toBeVisible();
  await expect(page.getByRole("treeitem", {name: "Price", exact: true})).toHaveCount(0);
  // inside the $batch changeset, like the MERGE
  expect(requests.some((r) => r.includes("DELETE NodeSet(Project='ZSTG_MAPPED',NodeUuid='"))).toBe(true);

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
