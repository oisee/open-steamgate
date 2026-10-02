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
});
