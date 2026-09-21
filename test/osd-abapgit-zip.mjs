// What goes into a zip that reaches a real system, and what must not.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {layout, preparePack} from "../tools/osd-abapgit-zip.mjs";
import {icfNodeFile, pageFile} from "../tools/osd-bsp-app.mjs";
import {SAP_DELIVERED} from "../tools/osd-nodes.mjs";

const node = (url, name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SICF">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>
   <URL>${url}</URL>
   <ICFSERVICE><ICF_NAME>${name}</ICF_NAME><ORIG_NAME>${name.toLowerCase()}</ORIG_NAME></ICFSERVICE>
 </asx:values></asx:abap></abapGit>`;

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
    const made = layout(dir, out, "a probe");
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
    expect(() => layout(dir, out, "a probe")).to.throw(/a real system delivers itself/);
    expect(() => layout(dir, out, "a probe")).to.throw(url);
  });

  it("refuses rather than dropping it, because a zip with a hole is worse", () => {
    // the same judgement this function already makes about a nested folder:
    // a build that quietly produced a smaller zip printed "23 files" over
    // the hole, and that cost a day
    const url = Object.keys(SAP_DELIVERED)[0];
    writeFileSync(join(dir, "zosd_ok.sicf.xml"), node("/sap/bc/osd/ok/", "ZOSD_OK"));
    writeFileSync(join(dir, "zosd_claim.sicf.xml"), node(`${url}/`, "ZOSD_CLAIM"));
    expect(() => layout(dir, out, "a probe")).to.throw();
    // and nothing of the folder was copied on the way to refusing
    expect(readdirSync(join(out, "src")).filter((f) => f.endsWith(".sicf.xml"))).to.deep.equal([]);
  });

  it("a child of a delivered node is not a delivered node", () => {
    // `/sap/bc/ui5_ui5/sap/zosd_008_app/` is exactly how a Fiori
    // application reaches a system, measured on A4H; a gate that stopped
    // it would stop the thing that works
    writeFileSync(join(dir, "zosd_008.sicf.xml"),
      node("/sap/bc/ui5_ui5/sap/zosd_008_app/", "ZOSD_008_APP"));
    expect(() => layout(dir, out, "a probe")).to.not.throw();
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

    const made = layout(prepared.objects, out, "Pack probe", prepared.data);
    expect(made.rows.carried).to.deep.equal(["zprobe"]);
    expect(readFileSync(join(out, "data", "zprobe.tabu.json"), "utf8")).to.contain('"ID": "1"');
    expect(made.objects.get("WAPA")).to.deep.equal(new Set([app.toLowerCase()]));
  });
});
