import {expect} from "chai";
import express from "express";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {transpileIssues, withoutHostPaths} from "../tools/osd-build-issues.mjs";

// Activation against a real build, on a tree of a few objects of its own
// (vsp-i7's abapGit spike, 2026-10-02): a failed activation leaves its
// object inactive and the system as it was, the answer says why per line
// and names no host path, and what is saved and not activated is listed.
const CLASS = (text) => `CLASS zcl_osd_act DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS greet RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_osd_act IMPLEMENTATION.
  METHOD greet.
    rv = ${text}.
  ENDMETHOD.
ENDCLASS.
`;
const BROKEN = "REPORT zosd_act_bad.\nlv_first_missing = 1.\nlv_second_missing = 2.\n";
const TRIVIAL = (name) => `REPORT ${name.toLowerCase()}.\nDATA lv TYPE i.\nlv = 1.\n`;

describe("tools/adt-facade: a failed activation stays inactive", function () {
  this.timeout(120000);
  let root;
  let store;
  let server;
  let base;
  let token;
  let cookie;

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "osd-activation-")));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abaplint.jsonc"), readFileSync("abaplint.jsonc", "utf8"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({
      input_folder: "src", input_filter: [], output_folder: "output", libs: [], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"},
    }));
    writeFileSync(join(root, "package.json"), "{}");
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    // a tree of three objects has nothing to generate
    store = new ObjectStore({root, libs: [], build: {generators: false}});
    const app = express();
    app.use(express.raw({type: "*/*", limit: "16mb"}));
    app.use(adtRouter({store, watch: false}).router);
    await new Promise((done) => {
      server = app.listen(0, done);
    });
    base = `http://localhost:${server.address().port}/sap/bc/adt`;
    const res = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterEach(async () => {
    await new Promise((done) => server.close(done));
    rmSync(root, {recursive: true, force: true});
  });

  const uri = (type, name) => type === "CLAS" ? `/sap/bc/adt/oo/classes/${name.toLowerCase()}`
    : `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
  const activate = async (type, name) => {
    const res = await fetch(`${base}/activation?method=activate&preauditRequested=true`, {
      method: "POST",
      headers: {"content-type": "application/xml", "x-csrf-token": token, cookie},
      body: `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
        `<adtcore:objectReference adtcore:uri="${uri(type, name)}" adtcore:name="${name}"/></adtcore:objectReferences>`,
    });
    return {status: res.status, xml: await res.text(), build: res.headers.get("x-osd-build")};
  };
  const ok = (answer) => answer.xml.includes("<chkl:properties") && !answer.xml.includes('activationExecuted="false"');
  const live = (file) => {
    const output = join(root, "build", "live", "output");
    return existsSync(join(output, file)) ? readFileSync(join(output, file), "utf8") : undefined;
  };
  const inactive = async () => (await (await fetch(`${base}/activation/inactiveobjects`)).text());

  it("a failed activation, then a trivial one succeeds", async () => {
    store.write("PROG", "ZOSD_ACT_BAD", BROKEN);
    const failed = await activate("PROG", "ZOSD_ACT_BAD");
    expect(failed.xml).to.contain('activationExecuted="false"');

    store.write("PROG", "ZOSD_ACT_OK", TRIVIAL("ZOSD_ACT_OK"));
    const next = await activate("PROG", "ZOSD_ACT_OK");
    expect(ok(next), next.xml).to.equal(true);
    expect(live("zosd_act_ok.prog.mjs"), "the trivial program is live").to.be.a("string");
    expect(live("zosd_act_bad.prog.mjs"), "the failed one is not").to.equal(undefined);
    expect(store.stateOf(store.find("PROG", "ZOSD_ACT_BAD")).version).to.equal("inactive");
  });

  it("an object whose activation failed keeps serving its last active version", async () => {
    store.write("CLAS", "ZCL_OSD_ACT", CLASS("'hello'"));
    expect(ok(await activate("CLAS", "ZCL_OSD_ACT"))).to.equal(true);
    expect(live("zcl_osd_act.clas.mjs")).to.contain("hello");

    // saved broken, and its activation refused
    store.write("CLAS", "ZCL_OSD_ACT", CLASS("lv_not_declared"));
    expect((await activate("CLAS", "ZCL_OSD_ACT")).xml).to.contain('activationExecuted="false"');

    // somebody else activates: the build takes the last active version of
    // the class, not the saved one and not nothing
    store.write("PROG", "ZOSD_ACT_OK", TRIVIAL("ZOSD_ACT_OK"));
    const next = await activate("PROG", "ZOSD_ACT_OK");
    expect(ok(next), next.xml).to.equal(true);
    expect(live("zcl_osd_act.clas.mjs"), "the class is still served").to.contain("hello");
    expect(live("zosd_act_ok.prog.mjs")).to.be.a("string");
    // and the saved version is still what a client reads back
    expect(store.read("CLAS", "ZCL_OSD_ACT").source).to.contain("lv_not_declared");
  });

  it("the error answer has a message per line and no host path", async () => {
    store.write("PROG", "ZOSD_ACT_BAD", BROKEN);
    const failed = await activate("PROG", "ZOSD_ACT_BAD");
    const messages = [...failed.xml.matchAll(/<msg ([^>]*)>([\s\S]*?)<\/msg>/g)];
    expect(messages.length, failed.xml).to.be.greaterThan(0);
    for (const [, attrs, body] of messages) {
      expect(attrs).to.match(/type="E"/);
      expect(attrs).to.match(/href="\/sap\/bc\/adt\/programs\/programs\/zosd_act_bad\/source\/main#start=\d+,\d+"/);
      expect(body).to.match(/<shortText><txt>[^<]+<\/txt><\/shortText>/);
    }
    // the line of the message is the line of the cause, in the attribute and in the href
    expect(messages.some(([, attrs]) => /line="2"/.test(attrs) && /#start=2,/.test(attrs)), failed.xml).to.equal(true);
    expect(failed.xml).to.match(/<ioc:entry>\s*<ioc:object[^>]*>\s*<ioc:ref [^>]*adtcore:name="ZOSD_ACT_BAD"/);
    expect(failed.xml).not.to.contain(root);
    expect(failed.xml).not.to.match(/\/(tmp|home|Users)\//);
  });

  it("a build the transpiler refuses answers per object and line, without the log", () => {
    const refusal = 'check_syntax, "lv_a" not found, Target, zosd_x.prog.abap:2\n' +
      'check_syntax, "lv_b" not found, Target, zosd_x.prog.abap:3\n' +
      "unknown_types, Type x not found, zcl_y.clas.abap:12";
    expect(transpileIssues(refusal)).to.deep.equal([
      {type: "PROG", name: "ZOSD_X", issues: [
        {severity: "E", rule: "check_syntax", message: '"lv_a" not found, Target', file: "zosd_x.prog.abap", line: 2, column: 1},
        {severity: "E", rule: "check_syntax", message: '"lv_b" not found, Target', file: "zosd_x.prog.abap", line: 3, column: 1},
      ]},
      {type: "CLAS", name: "ZCL_Y", issues: [
        {severity: "E", rule: "unknown_types", message: "Type x not found", file: "zcl_y.clas.abap", line: 12, column: 1},
      ]},
    ]);
    const log = `osd-gui-convert: wrote ${root}/gen/gui/z.prog.abap from /home/someone/tree/src/z.prog.abap`;
    const clean = withoutHostPaths(log, root);
    expect(clean).not.to.contain(root);
    expect(clean).not.to.contain("/home/");
    expect(clean).to.contain("z.prog.abap");
  });

  it("a write without activation is listed as inactive, and an activation takes it off", async () => {
    expect(await inactive()).not.to.contain("ioc:entry");
    store.write("PROG", "ZOSD_ACT_OK", TRIVIAL("ZOSD_ACT_OK"));
    const listed = await inactive();
    expect(listed).to.match(/<ioc:entry>\s*<ioc:object[^>]*>\s*<ioc:ref [^>]*adtcore:uri="\/sap\/bc\/adt\/programs\/programs\/zosd_act_ok"[^>]*adtcore:name="ZOSD_ACT_OK"/);
    expect(ok(await activate("PROG", "ZOSD_ACT_OK"))).to.equal(true);
    expect(await inactive()).not.to.contain("ZOSD_ACT_OK");
  });

  it("the inactive set survives a restart, and a file changed on disk since is active", async () => {
    store.write("PROG", "ZOSD_ACT_BAD", BROKEN);
    store.write("PROG", "ZOSD_ACT_OK", TRIVIAL("ZOSD_ACT_OK"));
    const again = new ObjectStore({root, libs: []});
    expect(again.inactiveObjects().map((o) => o.name)).to.deep.equal(["ZOSD_ACT_BAD", "ZOSD_ACT_OK"]);
    // a checkout writes the file: the disk is the other editor, and active
    writeFileSync(join(root, store.find("PROG", "ZOSD_ACT_OK").file), TRIVIAL("ZOSD_ACT_OK") + "* changed\n");
    const third = new ObjectStore({root, libs: []});
    expect(third.inactiveObjects().map((o) => o.name)).to.deep.equal(["ZOSD_ACT_BAD"]);
    expect(readdirSync(join(root, "build", "inactive"))).to.include("inactive.json");
  });
});
