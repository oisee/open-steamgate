// $TMP as a package of OSD, against what A4H answered
// (test/fixtures/tmp-package/a4h.json, tools/osd-tmp.mjs).
import {expect} from "chai";
import express from "express";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {inputFoldersOf} from "../tools/osd-packs.mjs";
import {admit} from "../tools/osd-deploy-manifest.mjs";
import {layout} from "../tools/osd-abapgit-zip.mjs";

const A4H = JSON.parse(readFileSync(new URL("./fixtures/tmp-package/a4h.json", import.meta.url), "utf8"));
// where $TMP lives (tools/osd-tmp.mjs), spelt out so the test does not lean
// on the module it checks
const TMP_FOLDER = "local/tmp";

describe("$TMP, the local package", () => {
  let root;
  let server;
  let base;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-tmp-package-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    writeFileSync(join(root, "src", "zcl_tmp_neighbour.clas.abap"),
      "CLASS zcl_tmp_neighbour DEFINITION PUBLIC. ENDCLASS.\nCLASS zcl_tmp_neighbour IMPLEMENTATION. ENDCLASS.\n");
    const app = express();
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, logMisses: false}).router);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });

  // a logon as `user`: the session cookie and its token
  const logon = async (user) => {
    const authorization = "Basic " + Buffer.from(`${user}:x`).toString("base64");
    const res = await fetch(`${base}/core/discovery`, {headers: {"x-csrf-token": "fetch", authorization}});
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const token = res.headers.get("x-csrf-token");
    return (path, options = {}) => fetch(base + path, {...options,
      headers: {cookie, "x-csrf-token": token, authorization, ...(options.headers ?? {})}});
  };
  const createProg = (call, name, pkg = "$TMP") => call("/programs/programs", {
    method: "POST",
    headers: {"content-type": "application/vnd.sap.adt.programs.programs.v2+xml"},
    body: `<?xml version="1.0" encoding="UTF-8"?><program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="tmp probe" adtcore:name="${name}" adtcore:type="PROG/P"><adtcore:packageRef adtcore:name="${pkg}"/></program:abapProgram>`,
  });
  const treeOf = async (call, query = "") => {
    const xml = await (await call(`/repository/nodestructure?parent_type=DEVC%2FK&parent_name=%24TMP${query}`, {method: "POST"})).text();
    return [...xml.matchAll(/<OBJECT_TYPE>([^<]*)<\/OBJECT_TYPE><OBJECT_NAME>([^<]*)<\/OBJECT_NAME>/g)].map((m) => `${m[1]} ${m[2]}`);
  };

  it("exists before anything is put in it: one package, no parent, local, never transported", async () => {
    expect(A4H.tdevc.rows, "A4H: one $TMP, not one per user").to.equal(1);
    const store = new ObjectStore({root, libs: []});
    const pkg = store.package("$TMP");
    expect(pkg.parent, "A4H: PARENTCL is empty").to.equal(undefined);
    expect(pkg.description).to.equal(A4H.tdevc.texts.E);
    const call = await logon("ALICE");
    const res = await call("/packages/%24tmp");
    expect(res.status).to.equal(200);
    const doc = await res.text();
    expect(doc).to.contain('adtcore:name="$TMP"');
    expect(doc, "no superPackage").to.not.contain("superPackage");
    expect(doc, "A4H: DLVUNIT LOCAL").to.contain('pak:softwareComponent pak:name="LOCAL"');
  });

  it("takes a create, which lands in local/tmp and carries its author", async () => {
    const call = await logon("ALICE");
    const res = await createProg(call, "ZOSD_TMP_PROBE");
    expect(res.status, await res.clone().text()).to.equal(201);
    expect(existsSync(join(root, TMP_FOLDER, "zosd_tmp_probe.prog.abap"))).to.equal(true);
    const authors = JSON.parse(readFileSync(join(root, TMP_FOLDER, "tadir.json"), "utf8"));
    expect(authors["PROG ZOSD_TMP_PROBE"].author).to.equal("ALICE");
    const doc = await (await call("/programs/programs/zosd_tmp_probe")).text();
    expect(doc).to.contain('adtcore:createdBy="ALICE"');
    expect(doc).to.match(/packageRef[^>]*adtcore:name="\$TMP"/);
    // and once it exists, it is a layer of the build
    const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
    expect(inputFoldersOf(root, config, {})).to.include(TMP_FOLDER);
  });

  it("shows its objects to their author only, unless a user is named", async () => {
    const alice = await logon("ALICE");
    const bob = await logon("BOB");
    expect((await createProg(alice, "ZOSD_TMP_ALICE")).status).to.equal(201);
    expect((await createProg(bob, "ZOSD_TMP_BOB")).status).to.equal(201);
    const mine = await treeOf(alice);
    expect(mine, "A4H: the logged-on user's objects").to.include("PROG/P ZOSD_TMP_ALICE");
    expect(mine, "A4H: not another user's").to.not.include("PROG/P ZOSD_TMP_BOB");
    // the local packages above nothing, as on A4H (here: every root of ours)
    expect(mine).to.include("DEVC/K $STG");
    expect(await treeOf(bob)).to.include("PROG/P ZOSD_TMP_BOB").and.not.include("PROG/P ZOSD_TMP_ALICE");
    expect(await treeOf(bob, "&user_name=ALICE")).to.include("PROG/P ZOSD_TMP_ALICE");
  });

  it("is never deleted, and is nobody's child", async () => {
    const call = await logon("ALICE");
    expect((await call("/packages/%24tmp", {method: "DELETE"})).status).to.be.oneOf([403, 405, 501]);
    expect((await call("/packages/%24tmp")).status, "still there").to.equal(200);
    const child = await call("/packages", {method: "POST", body:
      `<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="$TMP" adtcore:description="x"><pak:superPackage adtcore:name="$STG"/></pak:package>`});
    expect(child.status, "a second $TMP under another package").to.equal(409);
  });

  it("never travels: the deploy gate refuses its objects by name, the zip refuses its folder", async () => {
    const call = await logon("ALICE");
    expect((await createProg(call, "ZOSD_TMP_PROBE")).status).to.equal(201);
    const unit = {name: "probe", objects: ["PROG ZOSD_TMP_PROBE"]};
    const refusals = admit({files: ["zosd_tmp_probe.prog.abap"], read: () => "<NAME>ZOSD_TMP_PROBE</NAME>", unit, root});
    expect(refusals.map((r) => r.rule)).to.include("local-object");
    const previous = process.env.OSD_ROOT;
    process.env.OSD_ROOT = root;
    try {
      expect(() => layout(join(root, TMP_FOLDER), join(root, "zip.dir"), "x", undefined, unit)).to.throw(/never transported/);
      expect(existsSync(join(root, "zip.dir")), "nothing written").to.equal(false);
    } finally {
      if (previous === undefined) delete process.env.OSD_ROOT;
      else process.env.OSD_ROOT = previous;
    }
  });

  // ---- review round (codex on b3f68a9b)

  const createPackage = (call, name, parent = "$TMP") => call("/packages", {method: "POST", body:
    `<pack:package xmlns:pack="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:description="x"><pack:superPackage adtcore:name="${parent}"/></pack:package>`});

  it("refuses a name that is not a repository name, and never writes outside its root", async () => {
    const call = await logon("ALICE");
    for (const name of ["$TMP_../../src", "$TMP_..", "$TMP_A/../../B", "$TMP_A B"]) {
      const res = await createPackage(call, name);
      expect(res.status, name).to.be.oneOf([400, 501]);
      expect(res.status, name).to.not.equal(201);
    }
    for (const name of ["../ZX", "ZX/../../Y", "Z.X", "Z X"]) {
      expect((await createProg(call, name)).status, name).to.equal(400);
    }
    expect(existsSync(join(root, "src", "package.devc.xml")), "src/package.devc.xml was not written").to.equal(false);
    expect(existsSync(join(root, "package.devc.xml"))).to.equal(false);
    expect(existsSync(join(root, "local", "package.devc.xml"))).to.equal(false);
  });

  it("takes an ordinary local package as a child, as A4H does, and shows it to its author", async () => {
    expect(A4H.subpackage.EXPECT).to.equal("A4H");
    const alice = await logon("ALICE");
    const bob = await logon("BOB");
    const res = await createPackage(alice, "$ZOSD_KID");
    expect(res.status, await res.clone().text()).to.equal(201);
    expect(existsSync(join(root, TMP_FOLDER, "$zosd_kid", "package.devc.xml"))).to.equal(true);
    const store = new ObjectStore({root, libs: []});
    expect(store.package("$ZOSD_KID").parent).to.equal("$TMP");
    expect(await treeOf(alice)).to.include("DEVC/K $ZOSD_KID");
    expect(await treeOf(bob), "another user's package is not in the tree").to.not.include("DEVC/K $ZOSD_KID");
    // and a program goes into it
    expect((await createProg(alice, "ZOSD_IN_KID", "$ZOSD_KID")).status).to.equal(201);
    expect(existsSync(join(root, TMP_FOLDER, "$zosd_kid", "zosd_in_kid.prog.abap"))).to.equal(true);
  });

  it("refuses a $TMP object in every key form the manifest can list it", async () => {
    mkdirSync(join(root, TMP_FOLDER), {recursive: true});
    writeFileSync(join(root, TMP_FOLDER, "zosd_srv                           0001.iwsv.xml"), "<TECHNICAL_NAME>ZOSD_SRV</TECHNICAL_NAME><VERSION>0001</VERSION>");
    writeFileSync(join(root, TMP_FOLDER, "zosd_node.sicf.xml"), "<URL>/sap/bc/zosd/</URL><ICF_NAME>ZOSD_NODE</ICF_NAME>");
    writeFileSync(join(root, TMP_FOLDER, "zosd_fg.fugr.xml"), "<FUNCNAME>ZOSD_TMP_FM</FUNCNAME>");
    const unit = {name: "probe", objects: ["IWSV ZOSD_SRV 0001", "SICF /sap/bc/zosd", "FUGR ZOTHER"]};
    const text = {
      "zosd_srv 0001.iwsv.xml": "<TECHNICAL_NAME>ZOSD_SRV</TECHNICAL_NAME><VERSION>0001</VERSION>",
      "zcopy.sicf.xml": "<URL>/sap/bc/zosd/</URL><ICF_NAME>ZCOPY</ICF_NAME>",
      "zother.fugr.xml": "<FUNCNAME>ZOSD_TMP_FM</FUNCNAME>",
    };
    const refusals = admit({files: Object.keys(text), read: (f) => text[f], unit, root});
    const local = refusals.filter((r) => r.rule === "local-object").map((r) => r.key);
    expect(local, "padding normalised").to.include("IWSV ZOSD_SRV 0001");
    expect(local, "SICF by its URL").to.include("SICF /sap/bc/zosd");
    expect(local.some((k) => k.includes("FUNC ZOSD_TMP_FM")), "a module a local group creates").to.equal(true);
  });

  it("stays out of a preview: OSD_TMP=off drops the layer and the store root, and a generation with it is named", async () => {
    const call = await logon("ALICE");
    expect((await createProg(call, "ZOSD_TMP_PROBE")).status).to.equal(201);
    const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
    expect(inputFoldersOf(root, config, {OSD_TMP: "off"})).to.not.include(TMP_FOLDER);
    const previous = process.env.OSD_TMP;
    process.env.OSD_TMP = "off";
    try {
      const store = new ObjectStore({root, libs: []});
      expect(store.roots.map((r) => r.path)).to.not.include(TMP_FOLDER);
      expect(store.find("PROG", "ZOSD_TMP_PROBE")).to.equal(undefined);
    } finally {
      if (previous === undefined) delete process.env.OSD_TMP;
      else process.env.OSD_TMP = previous;
    }
    const {tmpModulesIn} = await import("../tools/osd-tmp.mjs");
    const {localObjectKeys} = await import("../tools/osd-deploy-manifest.mjs");
    mkdirSync(join(root, "output"));
    writeFileSync(join(root, "output", "zosd_tmp_probe.prog.mjs"), "");
    expect(tmpModulesIn(join(root, "output"), localObjectKeys(root))).to.deep.equal(["PROG ZOSD_TMP_PROBE"]);
    const preview = readFileSync(new URL("../scripts/build-preview.mjs", import.meta.url), "utf8");
    expect(preview, "the preview build sets it and checks output/").to.match(/OSD_TMP = "off"[\s\S]*tmpModulesIn\(/);
  });

  it("shows nothing of $TMP to a caller without a user, nor an object nobody authored", async () => {
    const call = await logon("ALICE");
    expect((await createProg(call, "ZOSD_TMP_PROBE")).status).to.equal(201);
    writeFileSync(join(root, TMP_FOLDER, "zosd_by_hand.prog.abap"), "REPORT zosd_by_hand.\n");
    const {packageOf} = await import("../tools/adt-documents.mjs");
    const store = new ObjectStore({root, libs: []});
    expect(packageOf(store, "$TMP").objects, "no user, nothing").to.deep.equal([]);
    expect(packageOf(store, "$TMP", {user: "ALICE"}).objects.map((o) => o.name)).to.deep.equal(["ZOSD_TMP_PROBE"]);
  });

  it("keeps its ownership record whole, and fails closed when it cannot read it", async () => {
    const call = await logon("ALICE");
    expect((await createProg(call, "ZOSD_TMP_ONE")).status).to.equal(201);
    expect((await createProg(call, "ZOSD_TMP_TWO")).status).to.equal(201);
    const {readdirSync} = await import("node:fs");
    expect(readdirSync(join(root, TMP_FOLDER)).filter((f) => f.endsWith(".tmp")), "no temp file left").to.deep.equal([]);
    const record = readFileSync(join(root, TMP_FOLDER, "tadir.json"), "utf8");
    expect(Object.keys(JSON.parse(record))).to.deep.equal(["PROG ZOSD_TMP_ONE", "PROG ZOSD_TMP_TWO"]);
    const source = readFileSync(new URL("../tools/osd-tmp.mjs", import.meta.url), "utf8");
    expect(source, "written by rename").to.match(/renameSync\(temp, file\)/);
    // truncated, the way an interrupted write would leave it
    writeFileSync(join(root, TMP_FOLDER, "tadir.json"), record.slice(0, 20));
    const errors = [];
    const original = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    try {
      const fresh = await logon("ALICE");
      expect(await treeOf(fresh), "nothing of $TMP is shown").to.not.include("PROG/P ZOSD_TMP_ONE");
      expect(errors.join("\n"), "and it says so").to.match(/tadir\.json cannot be read/);
      expect((await createProg(fresh, "ZOSD_TMP_THREE")).status, "nor overwritten by the next create").to.not.equal(201);
      expect(readFileSync(join(root, TMP_FOLDER, "tadir.json"), "utf8")).to.equal(record.slice(0, 20));
    } finally {
      console.error = original;
    }
  });

  it("tells ABAP which TADIR rows are local: $TMP only for an object of $TMP", async () => {
    const call = await logon("ALICE");
    expect((await createProg(call, "ZOSD_TMP_PROBE")).status).to.equal(201);
    const {tadirWithTmp} = await import("../tools/osd-tmp.mjs");
    const {localObjectKeys} = await import("../tools/osd-deploy-manifest.mjs");
    const row = (type, name) => `INSERT INTO "tadir" ("pgmid", "object", "obj_name", "devclass", "korrnum")\n      VALUES ('R3TR', '${type}', '${name}', '$TMP', '');`;
    const out = tadirWithTmp([row("PROG", "ZOSD_TMP_PROBE"), row("CLAS", "ZCL_TMP_NEIGHBOUR"), "INSERT INTO \"other\" VALUES ('$TMP');"], localObjectKeys(root));
    expect(out[0]).to.contain("'ZOSD_TMP_PROBE', '$TMP'");
    expect(out[1]).to.contain("'ZCL_TMP_NEIGHBOUR', ''");
    expect(out[2]).to.contain("'$TMP'");
    const setup = readFileSync(new URL("./setup.mjs", import.meta.url), "utf8");
    expect(setup, "the database setup applies it").to.match(/insert = await withTmpPackages\(insert\)/);
  });
});
