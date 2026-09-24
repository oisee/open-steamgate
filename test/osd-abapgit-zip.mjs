// What goes into a zip that reaches a real system, and what must not.
import {expect} from "chai";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {createHash} from "node:crypto";
import {layout, preparePack} from "../tools/osd-abapgit-zip.mjs";
import {buildApp, icfNodeFile, pageFile} from "../tools/osd-bsp-app.mjs";
import {SAP_DELIVERED} from "../tools/osd-nodes.mjs";
import {MANIFEST, loadManifest, objectOf, unitFor} from "../tools/osd-deploy-manifest.mjs";
import {compileFile} from "../tools/stg-compile.mjs";
import {renameAll} from "../tools/osd-rename.mjs";

const node = (url, name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SICF">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>
   <URL>${url}</URL>
   <ICFSERVICE><ICF_NAME>${name}</ICF_NAME><ORIG_NAME>${name.toLowerCase()}</ORIG_NAME></ICFSERVICE>
 </asx:values></asx:abap></abapGit>`;

// the deploy unit a probe folder is, listing exactly what each test puts in
const probe = (...objects) => ({name: "probe", objects});

describe("tools/osd-abapgit-zip: what may leave for a system", () => {
  it("the LSD service has the filename required by the A4H abapGit SICF mapper", () => {
    const service = readdirSync("packs/lsd/src").filter((f) => f.endsWith(".sicf.xml"));
    const hash = createHash("sha1").update("/sap/bc/lsd/").digest("hex").slice(0, 25);
    const apcHash = createHash("sha1").update("/sap/bc/apc/sap/zapc_lsd/").digest("hex").slice(0, 25);
    expect(service).to.have.members([
      `${"zlsd".padEnd(15, " ")}${hash}.sicf.xml`,
      `${"zapc_lsd".padEnd(15, " ")}${apcHash}.sicf.xml`,
    ]);
  });

  it("the LSD W3MI payload names match the extensions in their metadata", () => {
    const files = readdirSync("packs/lsd/src");
    expect(files).to.include("zlsd-show.w3mi.data.gz");
    expect(files).to.include("zlsd-music.w3mi.data.m4a");
  });

  it("the LSD SAPC matches the working plain WebSocket application on A4H", () => {
    const xml = readFileSync("packs/lsd/src/zapc_lsd.sapc.xml", "utf8");
    expect(xml).to.include("<STATEFUL>X</STATEFUL>");
    expect(xml).to.not.include("<CONNECTION_TYPE>");
    expect(xml).to.not.include("<PROTOCOL_TYPE_ID>V10.PCP.SAP.COM</PROTOCOL_TYPE_ID>");
  });

  let dir;
  let out;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zip-in-"));
    out = mkdtempSync(join(tmpdir(), "zip-out-"));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(out, {recursive: true, force: true});
  });

  it("an ordinary node of ours goes in", () => {
    writeFileSync(join(dir, "zosd_thing.sicf.xml"), node("/sap/bc/osd/thing/", "ZOSD_THING"));
    const made = layout(dir, out, "a probe", undefined, probe("SICF /sap/bc/osd/thing"));
    expect(made.objects.get("SICF")).to.not.equal(undefined);
    expect(readdirSync(join(out, "src"))).to.include("zosd_thing.sicf.xml");
  });

  it("a node a real system delivers is refused, and the message names it", () => {
    // **`travels: false` was an annotation nothing enforced.** Two tools
    // read it -- the inventory that computes it and the test over that --
    // and no packaging path did: this function copied every file of the
    // folder, so `segw:zip src/webgui` carried the WebGUI node verbatim.
    // An adversarial review found it. "It is written down in the
    // inventory" is not a gate.
    const url = Object.keys(SAP_DELIVERED)[0];
    writeFileSync(join(dir, "zosd_claim.sicf.xml"), node(`${url}/`, "ZOSD_CLAIM"));
    const unit = probe(`SICF ${url}`);
    expect(() => layout(dir, out, "a probe", undefined, unit)).to.throw(/a real system delivers itself/);
    expect(() => layout(dir, out, "a probe", undefined, unit)).to.throw(url);
  });

  it("refuses rather than dropping it, because a zip with a hole is worse", () => {
    // the same judgement this function already makes about a nested folder:
    // a build that quietly produced a smaller zip printed "23 files" over
    // the hole, and that cost a day
    const url = Object.keys(SAP_DELIVERED)[0];
    writeFileSync(join(dir, "zosd_ok.sicf.xml"), node("/sap/bc/osd/ok/", "ZOSD_OK"));
    writeFileSync(join(dir, "zosd_claim.sicf.xml"), node(`${url}/`, "ZOSD_CLAIM"));
    expect(() => layout(dir, out, "a probe", undefined, probe("SICF /sap/bc/osd/ok", `SICF ${url}`))).to.throw();
    // and nothing of the folder was copied on the way to refusing
    expect(readdirSync(join(out, "src")).filter((f) => f.endsWith(".sicf.xml"))).to.deep.equal([]);
  });

  it("a child of a delivered node is not a delivered node", () => {
    // `/sap/bc/ui5_ui5/sap/zosd_008_app/` is exactly how a Fiori
    // application reaches a system, measured on A4H; a gate that stopped
    // it would stop the thing that works
    writeFileSync(join(dir, "zosd_008.sicf.xml"),
      node("/sap/bc/ui5_ui5/sap/zosd_008_app/", "ZOSD_008_APP"));
    expect(() => layout(dir, out, "a probe", undefined, probe("SICF /sap/bc/ui5_ui5/sap/zosd_{nnn}_app"))).to.not.throw();
  });

  it("builds a complete pack: compiled SEGW, authored override, TABU and WAPA", () => {
    const pack = join(dir, "probe-pack");
    const src = join(pack, "src");
    const data = join(pack, "data");
    const webapp = join(pack, "webapp");
    mkdirSync(src, {recursive: true});
    mkdirSync(data, {recursive: true});
    mkdirSync(webapp, {recursive: true});
    writeFileSync(join(pack, "osd-pack.json"), JSON.stringify({
      name: "probe-pack",
      description: "Pack probe",
    }));
    writeFileSync(join(src, "zprobe.stg.yaml"), `project: ZPROBE
service: ZPROBE_SRV
entities:
  Item:
    keys: [Id]
    properties:
      Id: String(8)
`);
    const authored = "CLASS zcl_zprobe_dpc_ext DEFINITION PUBLIC. ENDCLASS.\n";
    writeFileSync(join(src, "zcl_zprobe_dpc_ext.clas.abap"), authored);
    writeFileSync(join(data, "zprobe.conf.json"), "{}\n");
    writeFileSync(join(data, "zprobe.tabu.json"), '[{"MANDT":"001","ID":"1"}]\n');
    writeFileSync(join(webapp, "index.html"), "<!doctype html><title>probe</title>\n");
    writeFileSync(join(webapp, "manifest.json"), JSON.stringify({
      "sap.app": {
        dataSources: {
          main: {type: "OData", uri: "/sap/opu/odata/sap/ZPROBE_SRV/"},
        },
      },
    }));

    const objects = join(dir, "objects");
    const prepared = preparePack(pack, objects);
    expect(readFileSync(join(objects, "zcl_zprobe_dpc_ext.clas.abap"), "utf8")).to.equal(authored);
    expect(readdirSync(objects)).to.include("zprobe.iwpr.xml");

    const app = "ZPROBE_PACK";
    expect(readdirSync(objects)).to.include(`${app.toLowerCase()}.wapa.xml`);
    expect(readdirSync(objects)).to.include(pageFile(app, "index.html"));
    expect(readdirSync(objects)).to.include(icfNodeFile(app));
    const carriedManifest = JSON.parse(readFileSync(join(objects, pageFile(app, "manifest.json")), "utf8"));
    expect(carriedManifest["sap.app"].dataSources.main.uri).to.equal("../../../../opu/odata/sap/ZPROBE_SRV/");

    const made = layout(prepared.objects, out, "Pack probe", prepared.data, probe(
      "IWPR ZPROBE", "IWSV ZPROBE_SRV 0001", "IWMO ZPROBE_MDL 0001",
      "CLAS ZCL_ZPROBE_MPC", "CLAS ZCL_ZPROBE_MPC_EXT", "CLAS ZCL_ZPROBE_DPC", "CLAS ZCL_ZPROBE_DPC_EXT",
      `WAPA ${app}`, `SICF /sap/bc/ui5_ui5/sap/${app}`, "TABU ZPROBE"));
    expect(made.rows.carried).to.deep.equal(["zprobe"]);
    expect(readFileSync(join(out, "data", "zprobe.tabu.json"), "utf8")).to.contain('"ID": "1"');
    expect(made.objects.get("WAPA")).to.deep.equal(new Set([app.toLowerCase()]));
  });
});

describe("deploy/manifest.json: only listed objects leave, never an SAP-owned name", () => {
  let dir;
  let out;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "allow-in-"));
    out = mkdtempSync(join(tmpdir(), "allow-out-"));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(out, {recursive: true, force: true});
  });
  const clas = (file, name) => {
    writeFileSync(join(dir, `${file}.clas.abap`), `CLASS ${name} DEFINITION PUBLIC. ENDCLASS.\n`);
    writeFileSync(join(dir, `${file}.clas.xml`), "<abapGit/>\n");
  };
  const copied = () => readdirSync(join(out, "src")).filter((f) => f !== "package.devc.xml");

  it("an object the unit does not list is refused, by name, and nothing is copied", () => {
    clas("zcl_osd_listed", "zcl_osd_listed");
    clas("zcl_osd_stray", "zcl_osd_stray");
    const unit = probe("CLAS ZCL_OSD_LISTED");
    expect(() => layout(dir, out, "p", undefined, unit)).to.throw(/CLAS ZCL_OSD_STRAY[\s\S]*not-in-manifest/);
    expect(copied()).to.deep.equal([]);
  });

  it("without a unit nothing goes: fail closed, not open", () => {
    clas("zcl_osd_listed", "zcl_osd_listed");
    expect(() => layout(dir, out, "p")).to.throw(/no-unit/);
  });

  it("a file that is not <object>.<type>.<ext> is refused", () => {
    writeFileSync(join(dir, "README"), "notes\n");
    expect(() => layout(dir, out, "p", undefined, probe())).to.throw(/not-an-object/);
  });

  it("an SAP-named shim is refused even when it is listed", () => {
    // the public API this tree reimplements under SAP's names; imported, it
    // would overwrite the system's own class
    clas("cl_http_client", "cl_http_client");
    clas("zcl_osd_ok", "zcl_osd_ok");
    const unit = probe("CLAS CL_HTTP_CLIENT", "CLAS ZCL_OSD_OK");
    expect(() => layout(dir, out, "p", undefined, unit)).to.throw(/CLAS CL_HTTP_CLIENT[\s\S]*sap-api-name/);
    expect(copied()).to.deep.equal([]);
  });

  it("IF_ and CX_ are SAP's too, and so is a standard DDIC name", () => {
    writeFileSync(join(dir, "if_http_extension.intf.abap"), "INTERFACE if_http_extension PUBLIC. ENDINTERFACE.\n");
    writeFileSync(join(dir, "cx_sy_conversion_error.clas.abap"), "CLASS cx_sy_conversion_error DEFINITION PUBLIC. ENDCLASS.\n");
    writeFileSync(join(dir, "t000.tabl.xml"), "<abapGit/>\n");
    const unit = probe("INTF IF_HTTP_EXTENSION", "CLAS CX_SY_CONVERSION_ERROR", "TABL T000");
    let message = "";
    try { layout(dir, out, "p", undefined, unit); } catch (e) { message = e.message; }
    expect(message).to.match(/INTF IF_HTTP_EXTENSION[\s\S]*sap-api-name/);
    expect(message).to.match(/CLAS CX_SY_CONVERSION_ERROR[\s\S]*sap-api-name/);
    expect(message).to.match(/TABL T000[\s\S]*sap-name/);
  });

  it("any /namespace/ that is not declared ours is refused, /OSD/ and /IWBEP/ alike", () => {
    writeFileSync(join(dir, "#osd#smoke.tabl.xml"), "<abapGit/>\n");
    clas("#iwbep#cl_mgw_abs_data", "/iwbep/cl_mgw_abs_data");
    clas("#ui2#cl_json", "/ui2/cl_json");
    const unit = probe("TABL /OSD/SMOKE", "CLAS /IWBEP/CL_MGW_ABS_DATA", "CLAS /UI2/CL_JSON");
    let message = "";
    try { layout(dir, out, "p", undefined, unit); } catch (e) { message = e.message; }
    expect(message).to.match(/TABL \/OSD\/SMOKE[\s\S]*foreign-namespace/);
    expect(message).to.match(/CLAS \/IWBEP\/CL_MGW_ABS_DATA[\s\S]*foreign-namespace/);
    expect(message).to.match(/CLAS \/UI2\/CL_JSON[\s\S]*foreign-namespace/);
    expect(copied()).to.deep.equal([]);
  });

  it("a namespace the manifest declares as ours is a customer name", () => {
    clas("#zns#cl_thing", "/zns/cl_thing");
    expect(() => layout(dir, out, "p", undefined, {...probe("CLAS /ZNS/CL_THING"), customerNamespaces: ["/ZNS/"]}))
      .to.not.throw();
  });

  it("an SAP-owned name goes only when its entry says why it is intended", () => {
    clas("cl_http_client", "cl_http_client");
    expect(() => layout(dir, out, "p", undefined, probe({object: "CLAS CL_HTTP_CLIENT", intended: ""}))).to.throw(/sap-api-name/);
    expect(() => layout(dir, out, "p", undefined,
      probe({object: "CLAS CL_HTTP_CLIENT", intended: "a probe of the rule itself"}))).to.not.throw();
  });

  it("a table's rows travel only if the unit lists them", () => {
    clas("zcl_osd_ok", "zcl_osd_ok");
    const data = join(dir, "..", `${basename(dir)}-data`);
    mkdirSync(data, {recursive: true});
    try {
      writeFileSync(join(data, "zosd_rows.tabu.json"), "[]\n");
      writeFileSync(join(data, "zosd_rows.conf.json"), "{}\n");
      expect(() => layout(dir, out, "p", data, probe("CLAS ZCL_OSD_OK"))).to.throw(/TABU ZOSD_ROWS[\s\S]*not-in-manifest/);
      expect(() => layout(dir, out, "p", data, probe("CLAS ZCL_OSD_OK", "TABU ZOSD_ROWS"))).to.not.throw();
    } finally {
      rmSync(data, {recursive: true, force: true});
    }
  });

  // ------------------------------------------------ what is deployed today

  const manifest = loadManifest(MANIFEST);
  const unit = (name) => ({...unitFor(manifest, undefined, name), customerNamespaces: manifest.customerNamespaces});

  it("every unit's sources name the unit", () => {
    for (const [name, u] of Object.entries(manifest.units)) {
      for (const s of u.sources) expect(unitFor(manifest, s).name).to.equal(name);
    }
    expect(() => unitFor(manifest, "src/gateway")).to.throw(/not the source of any deploy unit/);
  });

  it("the demo service passes as compiled, and as a numbered attempt with its DDIC", () => {
    const objects = join(dir, "demo");
    compileFile("src/demo/zstg_demo.stg.yaml", objects);
    expect(() => layout(objects, out, "demo", "data", unit("demo"))).to.not.throw();

    // the attempt as the levels were assembled: compiled, the authored _EXT
    // pair over it, the demo's DDIC beside it, renamed ZSTG_ -> ZOSD_004_
    for (const f of readdirSync("src/demo").filter((x) => x.endsWith(".clas.abap"))) {
      cpSync(join("src/demo", f), join(objects, f));
    }
    for (const f of ["zstg_demo.tabl.xml", "zstg_demo_bk.tabl.xml", "zstg_photo.tabl.xml",
      "zstg_status.tabl.xml", "zstg_status_sh.shlp.xml"]) {
      cpSync(join("src/ddic", f), join(objects, f));
    }
    const attempt = join(dir, "attempt");
    renameAll([objects], attempt, "ZSTG_", "ZOSD_004_");
    const made = layout(attempt, out, "demo 004", undefined, unit("demo"));
    expect([...made.objects.get("TABL")]).to.include("zosd_004_demo");
    expect([...made.objects.get("IWSV")][0]).to.match(/^zosd_004_demo_srv +0001$/);

    // a prefix that is not an attempt is not the unit
    const stray = join(dir, "stray");
    renameAll([objects], stray, "ZSTG_", "ZOSD_X_");
    expect(() => layout(stray, out, "demo x", undefined, unit("demo"))).to.throw(/ZOSD_X_DEMO[\s\S]*not-in-manifest/);
  });

  it("the demo app passes as a BSP application and its node", () => {
    const objects = join(dir, "app");
    mkdirSync(objects);
    buildApp({from: "webapp", app: "ZOSD_008_APP", out: objects, text: "demo app", service: "ZOSD_006_DEMO_SRV"});
    expect(() => layout(objects, out, "app", undefined, unit("demo-app"))).to.not.throw();
  });

  it("the LSD installation and the ZVDB pack pass", () => {
    expect(() => layout("deploy/lsd-a4h-011/src", out, "lsd", undefined, unit("lsd-a4h-011"))).to.not.throw();
    const objects = join(dir, "zvdb");
    const prepared = preparePack("packs/zvdb", objects);
    const made = layout(objects, out, "zvdb", prepared.data, unit("zvdb"));
    expect(made.rows.carried).to.deep.equal(["zvdb_100_vec"]);
  });

  it("packs/lsd is not a deployable: its player node is named LSD, outside the customer namespace", () => {
    // which is why the installation on a system is deploy/lsd-a4h-011, where
    // the node is ZOSD_011_LSD
    const everything = probe(...readdirSync("packs/lsd/src").map((f) => {
      const o = objectOf(f, () => readFileSync(join("packs/lsd/src", f), "utf8"));
      return o.key;
    }));
    expect(() => layout("packs/lsd/src", out, "lsd", undefined, everything)).to.throw(/SICF \/sap\/bc\/lsd[\s\S]*sap-name/);
  });
});
