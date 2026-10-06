// The object store as a destination an ABAP screen can call (backlog G.8).
//
// **What these tests are really guarding.** The backlog called "where does
// an edit land?" the first item of G.8's estimate, and it had been answered
// on 2026-09-15 by the ADT facade without anybody writing the answer back:
// `ObjectStore.write()` lands an object in the file it came from. So the
// danger of this wave is not choosing a place -- it is *a second write
// path*, an editor that writes sources its own way, which would agree with
// Eclipse until the first day it did not.
//
// That is why the test that matters here is the third one: the file a WRITE
// reports is the file the READ before it reported, and the bytes on disk are
// the bytes sent. Nothing about the destination's own shape would catch a
// second write path; only asking where the object actually went does.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {build} from "../tools/osd-build.mjs";
import {StoreDestination, withSystem} from "../tools/osd-store-destination.mjs";
import {box, rows, answerOf} from "./helpers/destination.mjs";

// **In `src/`, not under `test/fixtures/`.** The probe has to be an object of
// the system, and a fixture is not one: `/test/fixtures/` is excluded from
// the build and, since 2026-09-19, from the object store with it. This suite
// planted its subject there and went red the moment the two lists were made
// to agree -- which is the rule it is testing, arriving from the other side.
const FOLDER = join("src", "store_destination_probe");
const NAME = "ZCL_STORE_DEST_PROBE";
const FILE = join(FOLDER, "zcl_store_dest_probe.clas.abap");
const XML = join(FOLDER, "zcl_store_dest_probe.clas.xml");

const CLEAN = `CLASS zcl_store_dest_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS answer RETURNING VALUE(rv_answer) TYPE i.
ENDCLASS.

CLASS zcl_store_dest_probe IMPLEMENTATION.
  METHOD answer.
    rv_answer = 42.
  ENDMETHOD.
ENDCLASS.
`;

/** a CALL FUNCTION ZOSD_STORE, with the parameters in mixed case on purpose */
async function call(destination, importing = {}) {
  // the defaults and the caller's parameters are merged WITHOUT case, which
  // the first version of this helper did not do: `IV_NAME: ""` from the
  // defaults and `iv_name: "ZCL_..."` from a caller both survived, the
  // destination found the first of the two, and the test read as "READ
  // answers an empty source". A fixture that can hold one parameter twice
  // is a fixture no runtime resembles.
  const merged = new Map();
  for (const [key, value] of Object.entries({
    IV_COMMAND: "LIST", IV_TYPE: "", IV_NAME: "", IV_INCLUDE: "",
    IV_SOURCE: undefined, IV_FILTER: "", IV_LIMIT: "",
    ...importing,
  })) {
    // the LAST spelling wins, and it keeps the caller's own casing, so the
    // names really do arrive mixed
    for (const seen of [...merged.keys()]) {
      if (seen.toLowerCase() === key.toLowerCase()) merged.delete(seen);
    }
    merged.set(key, value);
  }
  const signature = {
    exporting: Object.fromEntries([...merged.entries()]
      .filter(([, v]) => v !== undefined).map(([k, v]) => [k, box(String(v))])),
    importing: {
      ev_source: box("x"), EV_FILE: box("x"), ev_package: box("x"), EV_VERSION: box("x"),
      ev_writable: box("x"), EV_ACTIVE: box("x"), ev_live: box("x"), EV_NOTE: box("x"),
      ev_count: box("x"), EV_MS: box("x"), ev_error: box("x"),
      EV_JSON: box("x"),
    },
    tables: {
      et_object: rows(["TYPE", "NAME", "PACKAGE", "FILE", "WRITABLE", "VERSION", "CHANGED_AT"]),
      ET_ISSUE: rows(["OBJ_TYPE", "OBJ_NAME", "LINE", "COL", "RULE", "MESSAGE"]),
      et_type: rows(["TYPE", "COUNT"]),
      ET_TOKEN: rows(["LINE", "COL", "LEN", "KIND"]),
    },
  };
  await destination.call("ZOSD_STORE", signature);
  return answerOf(signature);
}

describe("store LIST: live generation input digests without a source snapshot", function () {
  this.timeout(60000);
  let root, generation;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "store-list-provenance-"));
    mkdirSync(join(root, FOLDER), {recursive: true});
    writeFileSync(join(root, FILE), CLEAN);
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", output_folder: "output", libs: [],
      options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: "compileError"}}));
    const result = await build({root, generators: false});
    generation = join(root, "build/by-input", result.hash);
    rmSync(join(generation, "source"), {recursive: true});
    rmSync(join(generation, "source-shared"));
    rmSync(join(root, "build/source-by-digest"), {recursive: true});
  });
  after(() => {if (root) rmSync(root, {recursive: true, force: true});});
  it("a fresh store proves matching working bytes from the recorded input digest", async () => {
    const destination = new StoreDestination({store: () => new ObjectStore({root, libs: []})});
    const answer = await call(destination, {IV_COMMAND: "LIST", IV_FILTER: NAME});
    expect(answer.EV_ERROR).to.equal("");
    expect(answer.ET_OBJECT.find(row => row.NAME === NAME).VERSION).to.equal("active");
    expect(readFileSync(join(generation, "source", FILE), "utf8")).to.equal(CLEAN);
  });
  it("a fresh store cannot claim edited bytes when the retained source is gone", async () => {
    rmSync(join(generation, "source"), {recursive: true});
    writeFileSync(join(root, FILE), CLEAN.replace("rv_answer = 42.", "rv_answer = 43."));
    const store = new ObjectStore({root, libs: []});
    const destination = new StoreDestination({store: () => store});
    const answer = await call(destination, {IV_COMMAND: "LIST", IV_FILTER: NAME});
    expect(answer.EV_ERROR).to.equal("");
    expect(answer.ET_OBJECT.find(row => row.NAME === NAME).VERSION).to.equal("inactive");
    expect(store.read("CLAS", NAME, "main", "active").source).to.equal("");
    expect(existsSync(join(generation, "source", FILE))).to.equal(false);
  });
});

describe("the store, as the destination an editor screen calls", function () {
  // a check parses the system whole, which is seconds and is the price of
  // knowing what the system contains (tools/osd-store.mjs says why the fast
  // path is wrong)
  this.timeout(180000);
  let destination;

  before(() => {
    mkdirSync(FOLDER, {recursive: true});
    writeFileSync(FILE, CLEAN);
    writeFileSync(XML, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
<CLSNAME>${NAME}</CLSNAME><LANGU>E</LANGU><DESCRIPT>probe</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE>
</VSEOCLASS></asx:values></asx:abap></abapGit>
`);
    destination = new StoreDestination({store: () => new ObjectStore({root: process.cwd()})});
  });

  // the probe is put back after EVERY test, not at the end of the one that
  // changed it: a test that fails before its own restore leaves a broken
  // class behind, and the next test reports the damage as its own finding
  afterEach(() => {
    writeFileSync(FILE, CLEAN);
  });

  after(() => {
    rmSync(FOLDER, {recursive: true, force: true});
  });

  it("LIST names the object, its package, its file and whether it may be written", async () => {
    const answer = await call(destination, {IV_COMMAND: "list", iv_filter: "STORE_DEST"});
    const row = answer.ET_OBJECT.find((r) => r.NAME === NAME);
    expect(row, "the planted class is an object of this system").to.not.equal(undefined);
    expect(row.TYPE).to.equal("CLAS");
    expect(row.FILE).to.equal(FILE);
    expect(row.WRITABLE, "an object of the tree is writable; a library object is not").to.equal("X");
    // This probe was planted after the system's build and has never been
    // activated. Existence and clean syntax do not prove live provenance.
    expect(row.VERSION).to.equal("inactive");
    expect(answer.EV_ERROR).to.equal("");
  });

  it("a tally per type comes back, so a limit cannot hide a whole type", async () => {
    // fable-osd, using the screen: the list is cut at 300 and the types sort
    // together, so 607 classes filled it and not one CDS view was visible.
    // The screen said "300 shown of 1140" and was honest; a person who did
    // not already know to ask for DDLS still could not find one.
    const answer = await call(destination, {IV_COMMAND: "LIST", IV_LIMIT: "5"});
    const byType = Object.fromEntries(answer.ET_TYPE.map((r) => [r.TYPE, r.COUNT]));
    expect(Object.keys(byType).length, "more than one kind of object in this tree").to.be.greaterThan(3);
    expect(byType.CLAS, JSON.stringify(byType)).to.be.greaterThan(100);
    expect(byType.DDLS, "the type the limit was hiding").to.be.greaterThan(0);
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    expect(String(total), "the tally adds up to the count, both being of what matched")
      .to.equal(answer.EV_COUNT);
    expect(answer.ET_OBJECT.length, "and the rows are still cut at the limit").to.equal(5);
  });

  it("the tally is of what the FILTER matched, before the type narrows it", async () => {
    // otherwise asking for one type would answer "that type is all there is",
    // and the tally would confirm whatever the person already chose
    const answer = await call(destination, {IV_COMMAND: "LIST", IV_TYPE: "DDLS"});
    const kinds = answer.ET_TYPE.map((r) => r.TYPE);
    expect(kinds, "the other types are still counted").to.include("CLAS");
    expect(answer.ET_OBJECT.every((r) => r.TYPE === "DDLS"), "while the rows are only the type asked for")
      .to.equal(true);
  });

  it("the count is of what MATCHED, not of what was shown", async () => {
    // a list cut at its limit that reports the cut length tells a person the
    // system is smaller than it is -- and a screen's paging is built on it
    const all = await call(destination, {IV_COMMAND: "LIST", iv_type: "CLAS"});
    const one = await call(destination, {IV_COMMAND: "LIST", iv_type: "CLAS", IV_LIMIT: "1"});
    expect(Number(all.EV_COUNT)).to.be.greaterThan(1);
    expect(one.ET_OBJECT.length, "one row was asked for").to.equal(1);
    expect(one.EV_COUNT, "and the count still says how many there are").to.equal(all.EV_COUNT);
  });

  it("a WRITE lands in the file the READ came from, and nowhere else", async () => {
    const read = await call(destination, {IV_COMMAND: "READ", iv_name: NAME, IV_TYPE: "CLAS"});
    expect(read.EV_SOURCE).to.equal(CLEAN);
    expect(read.EV_FILE).to.equal(FILE);

    const edited = CLEAN.replace("rv_answer = 42.", "rv_answer = 43.");
    const written = await call(destination, {IV_COMMAND: "WRITE", IV_NAME: NAME, iv_type: "CLAS", IV_SOURCE: edited});
    expect(written.EV_ERROR).to.equal("");
    expect(written.EV_FILE, "the same file, which is the whole point: one write path, not two")
      .to.equal(read.EV_FILE);
    expect(readFileSync(FILE, "utf8"), "and the bytes on disk are the bytes sent").to.equal(edited);
    expect(written.EV_VERSION, "written and not yet checked is a state a system has").to.equal("inactive");
  });

  it("a WRITE without a source writes NOTHING rather than emptying the object", async () => {
    // a screen that posts a form with no text area in it would otherwise
    // silently empty what it was showing
    const before = readFileSync(FILE, "utf8");
    const answer = await call(destination, {IV_COMMAND: "WRITE", IV_NAME: NAME, iv_type: "CLAS"});
    expect(answer.EV_ERROR).to.match(/without IV_SOURCE/);
    expect(readFileSync(FILE, "utf8")).to.equal(before);
  });

  it("CHECK reads the source it is GIVEN, so a screen can check before it saves", async () => {
    const broken = CLEAN.replace("rv_answer = 42.", "rv_answer = this_is_not_a_thing( ).");
    const answer = await call(destination, {IV_COMMAND: "CHECK", IV_NAME: NAME, iv_type: "CLAS", IV_SOURCE: broken});
    expect(answer.EV_ACTIVE, "a source with an error in it is not active").to.equal("");
    expect(answer.ET_ISSUE.length, "and the screen is told where").to.be.greaterThan(0);
    expect(answer.ET_ISSUE[0].LINE).to.be.greaterThan(0);
    expect(answer.ET_ISSUE[0].MESSAGE).to.be.a("string").and.not.equal("");
    expect(answer.ET_ISSUE[0].OBJ_NAME, "an issue belongs to an object, which is not always the one asked about")
      .to.equal(NAME);
    expect(readFileSync(FILE, "utf8"), "a check does not write").to.equal(CLEAN);
  });

  it("CHECK of what is on disk is clean, so the two directions are not one answer", async () => {
    const answer = await call(destination, {IV_COMMAND: "CHECK", IV_NAME: NAME, iv_type: "CLAS"});
    expect(answer.ET_ISSUE, JSON.stringify(answer.ET_ISSUE)).to.have.length(0);
    expect(answer.EV_ACTIVE).to.equal("X");
  });

  it("CHECK, CHECKRUN and ACTIVATE reject a mangled static call through the JSON seam", async () => {
    const broken = CLEAN.replace("rv_answer = 42.", "rv_answer = zcl_store_dest_probe=u003eanswer( ).");
    const written = await call(destination, {IV_COMMAND: "WRITE", IV_NAME: NAME, IV_TYPE: "CLAS", IV_SOURCE: broken});
    expect(written.EV_ERROR).to.equal("");
    const check = await call(destination, {IV_COMMAND: "CHECK", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(JSON.parse(check.EV_JSON).active).to.equal(false);
    expect(JSON.parse(check.EV_JSON).issues).to.have.length.greaterThan(0);
    const report = await call(destination, {IV_COMMAND: "CHECKRUN", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(JSON.parse(report.EV_JSON).status).to.equal("processed");
    expect(JSON.parse(report.EV_JSON).issues).to.have.length.greaterThan(0);
    const activation = await call(destination, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(activation.EV_ACTIVE).to.equal("");
    expect(JSON.parse(activation.EV_JSON).active).to.equal(false);
    expect(JSON.parse(activation.EV_JSON).issues).to.have.length.greaterThan(0);
  });

  it("ACTIVATE refuses over a CALLER, and says which one", async () => {
    // the case activation exists for, and the one a check of the object
    // alone reports clean: the object stays self-consistent while the
    // system it lives in stops compiling. A screen that showed "active" here
    // would be the false green the store's own comment was written about.
    const callerFile = join(FOLDER, "zcl_store_dest_caller.clas.abap");
    writeFileSync(join(FOLDER, "zcl_store_dest_caller.clas.xml"), readFileSync(XML, "utf8")
      .replace(NAME, "ZCL_STORE_DEST_CALLER"));
    writeFileSync(callerFile, `CLASS zcl_store_dest_caller DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS ask RETURNING VALUE(rv_answer) TYPE i.
ENDCLASS.

CLASS zcl_store_dest_caller IMPLEMENTATION.
  METHOD ask.
    DATA lo_probe TYPE REF TO zcl_store_dest_probe.
    CREATE OBJECT lo_probe.
    rv_answer = lo_probe->answer( ).
  ENDMETHOD.
ENDCLASS.
`);
    // a fresh destination, because the store indexes the tree once and this
    // class was planted after the last one opened it
    const fresh = new StoreDestination({store: () => new ObjectStore({root: process.cwd()})});
    // publish() is stubbed here and is tested on its own below: an
    // activation of a real object would transpile the whole tree, which is
    // twelve seconds, and this test is about which OBJECT is named
    fresh.store = undefined;
    const store = new ObjectStore({root: process.cwd()});
    store.publish = async () => ({ok: true, recycled: false, generation: "probe-generation"});
    fresh.opener = () => store;
    fresh.opened = false;
    const good = await call(fresh, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(good.EV_ACTIVE, JSON.stringify(good.ET_ISSUE)).to.equal("X");

    // The method the caller uses, RENAMED -- not deleted. A deletion breaks
    // the probe's own implementation, the activation stops at the object's
    // own check and the dependent is never reached, which is a different
    // test that looks like this one. The rename leaves the probe perfectly
    // self-consistent and breaks only its caller, which is the whole point
    // of checking the callers at all.
    writeFileSync(FILE, CLEAN.replaceAll("answer", "answer2"));
    const afterStore = new ObjectStore({root: process.cwd()});
    afterStore.publish = async () => { throw new Error("a refused activation must not build"); };
    const after = new StoreDestination({store: () => afterStore});
    const refused = await call(after, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(refused.EV_ACTIVE, "the system does not compile, so the activation does not hold").to.equal("");
    const names = refused.ET_ISSUE.map((i) => i.OBJ_NAME);
    expect(names, `the caller is named, not the object asked about: ${JSON.stringify(refused.ET_ISSUE)}`)
      .to.include("ZCL_STORE_DEST_CALLER");
    expect(refused.ET_ISSUE[0].COL, "and the column is a number, not an empty field nobody assigned")
      .to.be.a("number");
  });

  it("an activation that holds BUILDS, and says whether the running system took it", async () => {
    // "activated" over a system that goes on answering with the old code is
    // a worse sentence than a slow button. The verdict and the modules are
    // two steps, and only the second reaches the runtime -- so the screen is
    // told which of them happened.
    const store = new ObjectStore({root: process.cwd()});
    let built = 0;
    store.publish = async () => { built += 1; return {ok: true, recycled: false, generation: "probe-generation"}; };
    const destination2 = new StoreDestination({store: () => store});
    const answer = await call(destination2, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(answer.EV_ACTIVE).to.equal("X");
    expect(built, "the check held, so the modules are written").to.equal(1);
    expect(answer.EV_LIVE, "nothing was recycled, and the answer does not pretend otherwise").to.equal("");
    expect(answer.EV_NOTE, "and it says so in words a person can act on")
      .to.match(/still runs the code it started with/);
  });

  it("an activation says WHICH generated objects it rewrote, because no count is right", async () => {
    // A class edit rewrites one file; a CDS view rewrites its two DDIC views,
    // its source class and the registry; a published view rewrites the whole
    // service under it -- three files for a label, seven for a renamed field,
    // on a view that owns fourteen (fable-osd, measured). So the screen is
    // given the list, and the generators are represented by what they
    // actually wrote rather than by a number that is wrong for every case but
    // one.
    const store = new ObjectStore({root: process.cwd()});
    const written = join("gen", "cds", "zcl_stg_cds_probe_row.clas.abap");
    store.publish = async () => {
      mkdirSync(join(process.cwd(), "gen", "cds"), {recursive: true});
      writeFileSync(join(process.cwd(), written), "* written by a generator during publish\n");
      return {ok: true, recycled: false, generation: "probe-generation"};
    };
    try {
      const answer = await call(new StoreDestination({store: () => store}),
        {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
      expect(answer.EV_ACTIVE).to.equal("X");
      const rewritten = answer.ET_OBJECT.map((r) => r.FILE);
      expect(rewritten, JSON.stringify(answer.ET_OBJECT)).to.include(written);
      expect(answer.ET_OBJECT.find((r) => r.FILE === written).VERSION).to.equal("generated");
      expect(answer.EV_NOTE, "and the note counts what the list holds").to.match(/generated object/);
    } finally {
      rmSync(join(process.cwd(), written), {force: true});
    }
  });

  it("a build that fails leaves the object NOT active, and says why", async () => {
    const store = new ObjectStore({root: process.cwd()});
    store.write("CLAS", NAME, CLEAN);
    store.publish = async () => ({ok: false, transpile: {ok: false, error: "ENOSPC"}});
    const destination2 = new StoreDestination({store: () => store});
    const answer = await call(destination2, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(answer.EV_ACTIVE, "the check held and the system did not get the code").to.equal("");
    expect(answer.EV_NOTE).to.match(/ENOSPC/);
    expect(store.stateOf(store.find("CLAS", NAME)).version).to.equal("inactive");
  });

  it("a save during publication cannot activate the later source", async () => {
    const store = new ObjectStore({root: process.cwd()});
    store.write("CLAS", NAME, CLEAN);
    let release;
    let entered;
    const publishing = new Promise(resolve => { entered = resolve; });
    store.publish = () => new Promise((resolve) => { release = resolve; entered(); });
    const running = call(new StoreDestination({store: () => store}),
      {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    // The whole-tree check can take seconds. Synchronize on publication,
    // rather than racing that check against a one-second polling budget.
    await Promise.race([publishing, running.then(() => {throw new Error("activation ended before publication");})]);
    expect(release).to.be.a("function");
    store.write("CLAS", NAME, CLEAN.replace("42", "43"));
    release({ok: true, recycled: false});
    const answer = await running;
    expect(answer.EV_ACTIVE).to.equal("");
    expect(answer.EV_NOTE).to.match(/source changed during activation/);
    expect(store.stateOf(store.find("CLAS", NAME)).version).to.equal("inactive");
  });

  it("TOKENS is not a command any more: the editor colours in ABAP", async () => {
    // The screen scans its own text (ZCL_OSD_ABAP_TOKENS, a word list, the
    // same on every host), so the host no longer parses the system to colour
    // a display. A caller that still asks is told so by name, the way any
    // unknown command is (host-tools review 2026-09-25, S1/C2).
    const answer = await call(destination, {IV_COMMAND: "TOKENS", IV_NAME: NAME, IV_TYPE: "CLAS", IV_SOURCE: CLEAN});
    expect(answer.EV_ERROR).to.match(/unknown store command TOKENS/);
    expect(answer.ET_TOKEN).to.have.length(0);
  });

  it("CAPABILITIES names what this host can do, so a screen draws only those buttons", async () => {
    // Node holds the compiler and the build, so all of them; OSGo answers
    // without CHECK and ACTIVATE and the editor then offers neither
    const answer = await call(destination, {IV_COMMAND: "CAPABILITIES"});
    expect(answer.EV_ERROR).to.equal("");
    expect(answer.EV_NOTE.split(" ")).to.deep.equal(["LIST", "READ", "WRITE", "CREATE", "DELETE", "CHECK", "ACTIVATE", "ACTIVATION_STATUS", "HISTORY", "REVISION", "CHECKRUN", "PARSE"]);
  });

  it("an object nobody has is NAMED, not answered with an empty source", async () => {
    const answer = await call(destination, {IV_COMMAND: "READ", IV_NAME: "ZCL_NOT_HERE_AT_ALL", iv_type: "CLAS"});
    expect(answer.EV_ERROR).to.match(/ZCL_NOT_HERE_AT_ALL/);
    expect(answer.EV_SOURCE, "and the source is not quietly empty").to.equal("");
  });

  it("a command nobody implemented is NAMED, not answered with the list", async () => {
    const answer = await call(destination, {IV_COMMAND: "UNIMPLEMENTED"});
    expect(answer.EV_ERROR).to.match(/unknown store command UNIMPLEMENTED/);
    expect(answer.ET_OBJECT).to.have.length(0);
  });

  it("the parameter name is matched WITHOUT case, or every command is the default", async () => {
    // the ST05 screen was rendered, said "off" and showed no error for
    // exactly this: a lookup that misses returns a default, and a default is
    // indistinguishable from an answer
    const answer = await call(destination, {iv_command: "READ", iv_name: NAME, Iv_Type: "CLAS"});
    expect(answer.EV_SOURCE).to.equal(CLEAN);
  });
});

describe("where there is no tree, the answer says so", () => {
  it("an opener that fails becomes the sentence on the screen, not an empty system", async () => {
    // the browser preview serves a built system: there are no sources in a
    // page. An empty object list would read as "this system has nothing in
    // it", which is a different and false statement
    const destination = new StoreDestination({
      store: () => { throw new Error("the browser preview serves a built system: there is no source tree in a page"); },
    });
    const answer = await call(destination, {IV_COMMAND: "LIST"});
    expect(answer.EV_ERROR).to.match(/no object store here/);
    expect(answer.EV_ERROR).to.match(/no source tree in a page/);
    expect(answer.ET_OBJECT).to.have.length(0);
  });

  it("the store is opened once, and not at all until something asks", async () => {
    let opened = 0;
    const destination = new StoreDestination({store: () => { opened += 1; return new ObjectStore({root: process.cwd()}); }});
    expect(opened, "installing a destination must not index the tree").to.equal(0);
    await call(destination, {IV_COMMAND: "LIST", iv_filter: "ZCL_STG_DISPATCHER"});
    await call(destination, {IV_COMMAND: "LIST", iv_filter: "ZCL_STG_DISPATCHER"});
    expect(opened).to.equal(1);
  });
});


describe("request-bound STORE commands", () => {
  it("writes, checks, lists and completes activation on each bound store", async () => {
    const destination = new StoreDestination({store: () => { throw new Error("default store must not open"); }});
    for (const name of ["ZONE", "ZTWO"]) {
      let source, built;
      const calls = [];
      const entry = {type: "PROG", name, writable: true};
      const store = {
        root: process.cwd(),
        write: (type, object, value) => { source = value; return entry; },
        check: () => { calls.push(["check", source]); return {issues: []}; },
        list: () => [entry], find: () => entry, stateOf: () => ({version: "inactive"}),
        activate: () => { calls.push(["activate", source]); return {active: true, issues: []}; },
        publish: async () => { calls.push(["publish", source]); built = {[name]: "hash"}; return {ok: true, generation: "probe-generation", transpile: {built}}; },
        completeActivation: (result, hashes) => { expect(hashes).to.equal(built); calls.push(["complete", source]); return true; },
      };
      await withSystem(() => {}, async () => {
        const args = {IV_TYPE: "PROG", IV_NAME: name};
        expect((await call(destination, {...args, IV_COMMAND: "WRITE", IV_SOURCE: name})).EV_ERROR).to.equal("");
        expect((await call(destination, {...args, IV_COMMAND: "CHECK"})).EV_ACTIVE).to.equal("X");
        expect((await call(destination, {IV_COMMAND: "LIST"})).ET_OBJECT.map((r) => r.NAME)).to.deep.equal([name]);
        expect((await call(destination, {...args, IV_COMMAND: "ACTIVATE"})).EV_ACTIVE).to.equal("X");
      }, {store});
      expect(calls).to.deep.equal(["check", "activate", "publish", "complete"].map((command) => [command, name]));
    }
  });
});

describe('STORE CREATE/DELETE repository lifecycle', function () {
  this.timeout(60000);
  let root, store, destination, abap;
  const name = 'ZCL_STORE_CRUD_PROBE';
  const owner = 'store-crud-owner', other = 'store-crud-other';
  before(async () => {
    const {initializeABAP} = await import('../output/init.mjs');
    await initializeABAP();
    abap = globalThis.abap;
  });
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'store-crud-'));
    mkdirSync(join(root, 'src'), {recursive: true});
    writeFileSync(join(root, 'abap_transpile.json'), JSON.stringify({input_folder: ['src']}));
    store = new ObjectStore({root, libs: []});
    destination = new StoreDestination({store});
  });
  afterEach(async () => {
    const {endEnqSession} = await import('../tools/osd-enq-host.mjs');
    endEnqSession(owner); endEnqSession(other);
    rmSync(root, {recursive: true, force: true});
  });
  async function execute(command, {user = 'CREATOR', session = owner, json = '{}', source} = {}) {
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession} = await import('../tools/osd-enq-host.mjs');
    reviveEnqSession(session);
    return dialogStep(async () => {
      bindEnqSession(session, {user});
      abap.builtin.sy.get().uname.set(user);
      return destination.execute({IV_COMMAND: box(command), IV_TYPE: box('CLAS'), IV_NAME: box(name),
        IV_JSON: box(json), ...(source === undefined ? {} : {IV_SOURCE: box(source)})});
    }, 'STORE CRUD probe');
  }
  it('creates inactive abapGit source with caller ownership, reads it and deletes both files', async () => {
    const result = await execute('CREATE', {json:'{"description":"STORE probe"}', source:CLEAN.replaceAll('zcl_store_dest_probe', name.toLowerCase())});
    expect(result.EV_ERROR).to.equal('');
    const made = JSON.parse(result.EV_JSON);
    expect(made).to.include({created:true, changedBy:'CREATOR', package:'$TMP', version:'inactive'});
    expect(readFileSync(join(root, made.file), 'utf8')).to.contain('rv_answer = 42.');
    expect(existsSync(join(root, made.file.replace('.abap','.xml')))).to.equal(true);
    expect((await execute('CREATE')).EV_ERROR).to.contain('already exists');
    expect((await execute('DELETE')).EV_ERROR).to.equal('');
    expect(store.find('CLAS', name)).to.equal(undefined);
    expect(existsSync(join(root, made.file))).to.equal(false);
    expect(existsSync(join(root, made.file.replace('.abap','.xml')))).to.equal(false);
    expect(JSON.parse((await execute('DELETE')).EV_JSON).error.code).to.equal('NOT_FOUND');
  });
  it('refuses deletion under an Eclipse lock and preserves source bytes', async () => {
    const made = JSON.parse((await execute('CREATE')).EV_JSON);
    const before = readFileSync(join(root,made.file));
    const {enqTake, enqDrop, reviveEnqSession} = await import('../tools/osd-enq-host.mjs');
    reviveEnqSession(other);
    const input = {mode_zosd_adt_lock:'X', objtype:'CLAS', objname:name, x_objtype:'X', x_objname:'X', _scope:'1'};
    expect(enqTake(other,'EDITOR','ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input).subrc).to.equal(0);
    const refusal = await execute('DELETE');
    expect(JSON.parse(refusal.EV_JSON).error.code).to.equal('CONFLICT');
    expect(readFileSync(join(root,made.file))).to.deep.equal(before);
    enqDrop(other,'ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input);
    expect((await execute('DELETE')).EV_ERROR).to.equal('');
  });
  it('creates and deletes through the actual ABAP CALL FUNCTION destination', async () => {
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession} = await import('../tools/osd-enq-host.mjs');
    const previous = abap.context.RFCDestinations.STORE;
    abap.context.RFCDestinations.STORE = destination;
    try {
      await dialogStep(async () => {
        reviveEnqSession(owner); bindEnqSession(owner,{user:'ABAPCALLER'});
        abap.builtin.sy.get().uname.set('ABAPCALLER');
        const json = new abap.types.String(), error = new abap.types.String();
        const exporting = command => ({iv_command:new abap.types.String().set(command),
          iv_type:new abap.types.String().set('CLAS'), iv_name:new abap.types.String().set(name)});
        await abap.statements.callFunction({name:'ZOSD_STORE',destination:'STORE',
          exporting:exporting('CREATE'), importing:{ev_json:json,ev_error:error}});
        expect(error.get()).to.equal('');
        expect(JSON.parse(json.get())).to.include({created:true,changedBy:'ABAPCALLER'});
        await abap.statements.callFunction({name:'ZOSD_STORE',destination:'STORE',
          exporting:exporting('DELETE'), importing:{ev_json:json,ev_error:error}});
        expect(error.get()).to.equal('');
        expect(JSON.parse(json.get())).to.include({deleted:true,name});
      }, 'ABAP STORE CRUD');
      expect(store.find('CLAS',name)).to.equal(undefined);
    } finally {abap.context.RFCDestinations.STORE = previous;}
  });
  it('forwards guarded IPC creation with the caller identity and refuses a locked delete before sending', async () => {
    const {EventEmitter} = await import('node:events');
    const {StoreIPCClient} = await import('../tools/osd-store-ipc.mjs');
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession, enqTake, enqDrop} = await import('../tools/osd-enq-host.mjs');
    const channel = new EventEmitter();
    channel.connected = true;
    const sent = [];
    channel.send = message => {
      if (message.type !== 'store-request') return;
      sent.push(message);
      queueMicrotask(() => channel.emit('message', {type:'store-response', id:message.id,
        values:{EV_JSON:JSON.stringify({created:true, changedBy:message.repositoryUser}), EV_ERROR:''}}));
    };
    const client = new StoreIPCClient(channel);
    const invoke = command => dialogStep(async () => {
      reviveEnqSession(owner); bindEnqSession(owner, {user:'IPCCALLER'});
      abap.builtin.sy.get().uname.set('IPCCALLER');
      const signature = {exporting:{IV_COMMAND:box(command), IV_TYPE:box('CLAS'), IV_NAME:box(name)},
        importing:{EV_ERROR:box(''),EV_JSON:box('')}};
      await client.call('ZOSD_STORE', signature);
      return answerOf(signature);
    }, 'STORE CRUD IPC probe');
    const input = {mode_zosd_adt_lock:'X',objtype:'CLAS',objname:name,x_objtype:'X',x_objname:'X',_scope:'1'};
    try {
      expect(JSON.parse((await invoke('CREATE')).EV_JSON)).to.include({created:true,changedBy:'IPCCALLER'});
      expect(sent).to.have.length(1);
      reviveEnqSession(other);
      expect(enqTake(other,'EDITOR','ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input).subrc).to.equal(0);
      expect(JSON.parse((await invoke('DELETE')).EV_JSON).error.code).to.equal('CONFLICT');
      expect(sent).to.have.length(1);
      enqDrop(other,'ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input);
    } finally {client.close();}
  });
  it('records bound session ownership despite a changed sy-uname', async () => {
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession} = await import('../tools/osd-enq-host.mjs');
    const result = await dialogStep(async () => {
      reviveEnqSession(owner); bindEnqSession(owner,{user:'BOUNDOWNER'});
      abap.builtin.sy.get().uname.set('SPOOF');
      return destination.execute({IV_COMMAND:box('CREATE'),IV_TYPE:box('CLAS'),IV_NAME:box(name)});
    }, 'STORE bound author');
    expect(JSON.parse(result.EV_JSON).changedBy).to.equal('BOUNDOWNER');
  });
  it('refuses INCL deletion of a PROG whose editor lock is held', async () => {
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession, enqTake, enqDrop} = await import('../tools/osd-enq-host.mjs');
    const made = store.create('PROG','ZSTORE_ALIAS',{package:'$TMP'});
    const input = {mode_zosd_adt_lock:'X',objtype:'PROG',objname:'ZSTORE_ALIAS',x_objtype:'X',x_objname:'X',_scope:'1'};
    reviveEnqSession(other);
    expect(enqTake(other,'EDITOR','ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input).subrc).to.equal(0);
    const result = await dialogStep(async () => {
      reviveEnqSession(owner); bindEnqSession(owner,{user:'CREATOR'});
      return destination.execute({IV_COMMAND:box('DELETE'),IV_TYPE:box('INCL'),IV_NAME:box('ZSTORE_ALIAS')});
    }, 'STORE alias lock');
    expect(JSON.parse(result.EV_JSON).error.code).to.equal('CONFLICT');
    expect(existsSync(join(root,made.file))).to.equal(true);
    enqDrop(other,'ZOSD_ADT_LOCK','EZOSD_ADT_OBJ',input);
  });
  it('cancels queued parent mutation when the child session ends', async () => {
    const {EventEmitter} = await import('node:events');
    const {StoreIPCClient,attachStoreIPC} = await import('../tools/osd-store-ipc.mjs');
    const {withSourceLock} = await import('../tools/osd-store-source-lock.mjs');
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession,reviveEnqSession,endEnqSession} = await import('../tools/osd-enq-host.mjs');
    const parent = new EventEmitter(), channel = new EventEmitter();
    parent.connected = channel.connected = true;
    let sent;
    const dispatched = new Promise(resolve => {sent=resolve;});
    parent.send = message => queueMicrotask(() => channel.emit('message',message));
    channel.send = message => queueMicrotask(() => {
      parent.emit('message',message);
      if(message.type==='store-request') sent();
    });
    attachStoreIPC(parent,{storeDestination:destination});
    const client=new StoreIPCClient(channel);
    let release;
    const hold=new Promise(resolve=>{release=resolve;});
    const locked=withSourceLock(store,()=>hold);
    await new Promise(resolve=>setImmediate(resolve));
    const result=dialogStep(async()=>{
      reviveEnqSession(owner);bindEnqSession(owner,{user:'CALLER'});
      const signature={exporting:{IV_COMMAND:box('create'),IV_TYPE:box('CLAS'),IV_NAME:box(name)},
        importing:{EV_ERROR:box(''),EV_JSON:box('')}};
      await client.call('ZOSD_STORE',signature);
      return answerOf(signature);
    },'STORE cancel parent');
    try {
      await dispatched;
      endEnqSession(owner);
      await new Promise(resolve=>setImmediate(resolve));
      release();await locked;
      expect(JSON.parse((await result).EV_JSON).error.code).to.equal('CONFLICT');
      expect(store.find('CLAS',name)).to.equal(undefined);
    } finally {release();client.close();parent.connected=false;parent.emit('disconnect');}
  });
  it('cancels queued local creation when the caller session ends', async () => {
    const {withSourceLock} = await import('../tools/osd-store-source-lock.mjs');
    const {endEnqSession} = await import('../tools/osd-enq-host.mjs');
    let release;
    const hold=new Promise(resolve=>{release=resolve;});
    const locked=withSourceLock(store,()=>hold);
    await new Promise(resolve=>setImmediate(resolve));
    const creating=execute('CREATE');
    await new Promise(resolve=>setImmediate(resolve));
    endEnqSession(owner);
    release();await locked;
    expect(JSON.parse((await creating).EV_JSON).error.code).to.equal('CONFLICT');
    expect(store.find('CLAS',name)).to.equal(undefined);
  });
  it('reports invalid creation options and refuses executable kernel source before mutation', async () => {
    expect(JSON.parse((await execute('CREATE',{json:'[]'})).EV_JSON).error.code).to.equal('INVALID_NAME');
    expect(JSON.parse((await execute('CREATE',{json:'{"package":4}'})).EV_JSON).error.code).to.equal('INVALID_NAME');
    for (const source of ["WRITE '@KERNEL console.log(1);'.", "WRITE / '@KERNEL console.log(1);'.", "WRITE: '@KERNEL console.log(1);'."]) {
      expect(JSON.parse((await execute('CREATE',{source})).EV_JSON).error.code).to.equal('NOT_SUPPORTED');
    }
    expect(store.find('CLAS',name)).to.equal(undefined);
  });
});

describe('STORE activation operation tracking', function () {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'activation-operation-')); });
  afterEach(() => { rmSync(root, {recursive: true, force: true}); });
  it('returns pending, publishes after the step, and lookup never publishes again', async () => {
    let continuation, publishes = 0;
    const store = {root,
      activate: () => ({active: true, issues: [], revision: 'source-1'}),
      publish: async () => { publishes++; return {ok: true, generation: 'generation-1', recycled: true, transpile: {built: {}}}; },
      completeActivation: () => true};
    const destination = new StoreDestination({store: () => store});
    const answer = await withSystem(() => {}, () => destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}),
      {store, deferActivate: work => { continuation = work; }});
    const pending = JSON.parse(answer.EV_JSON);
    expect(pending.state).to.equal('pending');
    expect(pending.op_id).to.be.a('string').and.not.equal('');
    expect(pending.generation_id).to.equal('');
    expect(publishes).to.equal(0);
    await continuation();
    const lookup = () => destination.execute({IV_COMMAND: 'ACTIVATION_STATUS', IV_JSON: JSON.stringify({op_id: pending.op_id})});
    const published = JSON.parse((await lookup()).EV_JSON);
    expect(published.state).to.equal('published');
    expect(published.generation_id).to.equal('generation-1');
    expect(JSON.parse((await lookup()).EV_JSON)).to.deep.equal(published);
    expect(publishes).to.equal(1);
  });
  it('retains validation refusal diagnostics and marks a dumped step failed', async () => {
    let continuation;
    const store = {root, activate: () => ({active: false, issues: [{message: 'bad source', line: 2}]})};
    const destination = new StoreDestination({store: () => store});
    const rejected = JSON.parse((await destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'})).EV_JSON);
    expect(rejected.state).to.equal('failed');
    expect(rejected.failure_stage).to.equal('validation');
    expect(rejected.issues[0].MESSAGE).to.equal('bad source');
    store.activate = () => ({active: true, issues: []});
    const pending = JSON.parse((await withSystem(() => {}, () => destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}),
      {store, deferActivate: work => { continuation = work; }})).EV_JSON);
    continuation.fail('activation step dumped');
    const failed = JSON.parse((await destination.execute({IV_COMMAND: 'ACTIVATION_STATUS', IV_JSON: JSON.stringify({op_id: pending.op_id})})).EV_JSON);
    expect(failed.state).to.equal('failed');
    expect(failed.failure_stage).to.equal('step');
  });
  it('recovers unfinished operations conservatively and expires terminal entries after 24h', async () => {
    const {ActivationJournal} = await import('../tools/osd-activation-journal.mjs');
    let time = Date.now();
    const first = new ActivationJournal(root, {now: () => time});
    const pending = first.create('CLAS', 'ZOP');
    first.update(pending.op_id, {state: 'pending'});
    const restarted = new ActivationJournal(root, {now: () => time});
    const failed = restarted.lookup(pending.op_id);
    expect(failed.state).to.equal('failed');
    expect(failed.failure_stage).to.equal('recovery');
    const completed = failed.completed_at;
    time += 23 * 60 * 60 * 1000;
    expect(restarted.lookup(pending.op_id).completed_at).to.equal(completed);
    time += 60 * 60 * 1000;
    expect(() => restarted.lookup(pending.op_id)).to.throw('not found or expired');
    expect(() => restarted.lookup('')).to.throw('needs op_id');
  });
  it('returns an operation ID even when validation throws', async () => {
    const destination = new StoreDestination({store: () => ({root, activate: () => {
      throw Object.assign(new Error('object not found'), {code: 'NOT_FOUND'});
    }})});
    const response = await destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZMISSING'});
    const operation = JSON.parse(response.EV_JSON);
    expect(operation.state).to.equal('failed');
    expect(operation.op_id).to.be.a('string').and.not.equal('');
    expect(operation.error.code).to.equal('NOT_FOUND');
  });
  it('fails a pending operation if its publication scheduler throws', async () => {
    const store = {root, activate: () => ({active: true, issues: []})};
    const destination = new StoreDestination({store: () => store});
    const {activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const response = await withSystem(() => {}, () => destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}),
      {store, deferActivate: () => { throw new Error('scheduler lost'); }});
    expect(response.EV_ERROR).to.contain('scheduler lost');
    const operations = Object.values(activationJournal(store).entries);
    expect(operations[0].state).to.equal('failed');
    expect(operations[0].failure_stage).to.equal('step');
  });
  it('fails a deferred operation on IPC disconnect without waiting for exit', async () => {
    const {EventEmitter} = await import('node:events');
    const {attachStoreIPC} = await import('../tools/osd-store-ipc.mjs');
    const child = new EventEmitter();
    child.connected = true;
    const store = {root, activate: () => ({active: true, issues: []})};
    const destination = new StoreDestination({store: () => store});
    const response = new Promise(resolve => { child.send = resolve; });
    attachStoreIPC(child, {storeDestination: destination});
    child.emit('message', {type: 'store-request', id: 1, name: 'ZOSD_STORE', step: 1,
      parameters: {IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}});
    const pending = JSON.parse((await response).values.EV_JSON);
    child.connected = false;
    child.emit('disconnect');
    const status = JSON.parse((await destination.execute({IV_COMMAND: 'ACTIVATION_STATUS', IV_JSON: JSON.stringify({op_id: pending.op_id})})).EV_JSON);
    expect(status.state).to.equal('failed');
    expect(status.failure_stage).to.equal('step');
  });
  it('isolates journals for different instance ports', async () => {
    const {ActivationJournal} = await import('../tools/osd-activation-journal.mjs');
    const first = new ActivationJournal(root, {host: 'http-8090'});
    const pending = first.create('CLAS', 'ZOP');
    first.update(pending.op_id, {state: 'pending'});
    const other = new ActivationJournal(root, {host: 'http-8091'});
    expect(Object.keys(other.entries)).to.have.length(0);
    expect(first.lookup(pending.op_id).state).to.equal('pending');
  });
  it('refuses direct in-step publication before a caller can dump', async () => {
    await import('../output/init.mjs');
    const {exclusive} = await import('../tools/osd-dialog-step.mjs');
    let publishes = 0, response;
    const destination = new StoreDestination({store: () => ({root,
      activate: () => ({active: true, issues: []}),
      publish: () => { publishes++; throw new Error('unsafe publish'); }})});
    try {
      await exclusive(async () => {
        response = await destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'});
        throw new Error('caller dumped');
      }, 'activation caller', {dialog: true});
    } catch (error) { expect(error.message).to.equal('caller dumped'); }
    expect(publishes).to.equal(0);
    expect(JSON.parse(response.EV_JSON).state).to.equal('failed');
    expect(JSON.parse(response.EV_JSON).failure_stage).to.equal('step');
  });
  it('returns the failed ticket when publication throws', async () => {
    const destination = new StoreDestination({store: () => ({root,
      activate: () => ({active: true, issues: []}),
      publish: () => { throw new Error('compiler stopped'); }})});
    const response = await destination.execute({IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'});
    const operation = JSON.parse(response.EV_JSON);
    expect(operation.state).to.equal('failed');
    expect(operation.failure_stage).to.equal('build');
    expect(operation.op_id).to.be.a('string').and.not.equal('');
    const lookedUp = JSON.parse((await destination.execute({IV_COMMAND: 'ACTIVATION_STATUS', IV_JSON: JSON.stringify({op_id: operation.op_id})})).EV_JSON);
    expect(lookedUp).to.deep.equal(operation);
  });
  it('fails when IPC disconnects before continuation registration', async () => {
    const {EventEmitter} = await import('node:events');
    const {attachStoreIPC} = await import('../tools/osd-store-ipc.mjs');
    const {activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const child = new EventEmitter();
    child.connected = true;
    child.send = () => {};
    let open;
    const store = {root, activate: () => ({active: true, issues: []})};
    const opened = new Promise(resolve => { open = resolve; });
    const destination = new StoreDestination({store: () => opened});
    attachStoreIPC(child, {storeDestination: destination});
    child.emit('message', {type: 'store-request', id: 1, name: 'ZOSD_STORE', step: 1,
      parameters: {IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}});
    child.connected = false;
    child.emit('disconnect');
    open(store);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const operations = Object.values(activationJournal(store).entries);
    expect(operations).to.have.length(1);
    expect(operations[0].state).to.equal('failed');
    expect(operations[0].failure_stage).to.equal('step');
  });
});
