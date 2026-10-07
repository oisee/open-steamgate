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
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";
import {activationJournal} from "../tools/osd-activation-journal.mjs";

const runtimeFixture = runtimeRootFixture();
const probePath = file => join(runtimeFixture.root, file);

// Source fixtures borrow this checkout's registry, but own their journals.
// A persistent owner.pid from a previous sandbox may identify an unrelated
// process in this sandbox's PID namespace. Never alter the host's journal.
let probeJournalRoot;
before(() => {probeJournalRoot = mkdtempSync(join(tmpdir(), "store-probe-journal-"));});
after(() => {if (probeJournalRoot) rmSync(probeJournalRoot, {recursive: true, force: true});});
const probeJournal = () => activationJournal({root: probeJournalRoot});
const probeStore = () => Object.assign(new ObjectStore({root: runtimeFixture.root}), {activationJournal: probeJournal()});

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
    expect(() => store.read("CLAS", NAME, "main", "active")).to.throw("active version (main) does not exist");
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
    mkdirSync(probePath(FOLDER), {recursive: true});
    writeFileSync(probePath(FILE), CLEAN);
    writeFileSync(probePath(XML), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
<CLSNAME>${NAME}</CLSNAME><LANGU>E</LANGU><DESCRIPT>probe</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE>
</VSEOCLASS></asx:values></asx:abap></abapGit>
`);
    destination = new StoreDestination({store: () => probeStore()});
  });

  // the probe is put back after EVERY test, not at the end of the one that
  // changed it: a test that fails before its own restore leaves a broken
  // class behind, and the next test reports the damage as its own finding
  afterEach(() => {
    writeFileSync(probePath(FILE), CLEAN);
  });

  after(() => {
    rmSync(probePath(FOLDER), {recursive: true, force: true});
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
    expect(readFileSync(probePath(FILE), "utf8"), "and the bytes on disk are the bytes sent").to.equal(edited);
    expect(written.EV_VERSION, "written and not yet checked is a state a system has").to.equal("inactive");
  });

  it('WRITE returns the saved object revision in JSON and keeps scalar callers working', async () => {
    const previous = readFileSync(probePath(FILE), 'utf8');
    const edited = previous + '* saved revision\n';
    try {
      const written = await call(destination, {IV_COMMAND: 'WRITE', IV_TYPE: 'CLAS', IV_NAME: NAME, IV_SOURCE: edited});
      const json = JSON.parse(written.EV_JSON);
      expect(json).to.deep.equal({written: true, type: 'CLAS', name: NAME, revision: probeStore().activate('CLAS', NAME).revision});
      expect(json.revision).to.match(/^[a-f0-9]{64}$/);
      const repeated = await call(destination, {IV_COMMAND: 'WRITE', IV_TYPE: 'CLAS', IV_NAME: NAME, IV_SOURCE: edited});
      expect(JSON.parse(repeated.EV_JSON).revision).to.equal(json.revision);
      expect(written).to.include({EV_ERROR: '', EV_FILE: FILE, EV_WRITABLE: 'X', EV_VERSION: 'inactive'});
    } finally {await probeStore().write('CLAS', NAME, previous);}
  });

  it("a WRITE without a source writes NOTHING rather than emptying the object", async () => {
    // a screen that posts a form with no text area in it would otherwise
    // silently empty what it was showing
    const before = readFileSync(probePath(FILE), "utf8");
    const answer = await call(destination, {IV_COMMAND: "WRITE", IV_NAME: NAME, iv_type: "CLAS"});
    expect(answer.EV_ERROR).to.match(/without IV_SOURCE/);
    expect(readFileSync(probePath(FILE), "utf8")).to.equal(before);
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
    expect(readFileSync(probePath(FILE), "utf8"), "a check does not write").to.equal(CLEAN);
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
    const callerFile = probePath(join(FOLDER, "zcl_store_dest_caller.clas.abap"));
    writeFileSync(probePath(join(FOLDER, "zcl_store_dest_caller.clas.xml")), readFileSync(probePath(XML), "utf8")
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
    const fresh = new StoreDestination({store: () => probeStore()});
    // publish() is stubbed here and is tested on its own below: an
    // activation of a real object would transpile the whole tree, which is
    // twelve seconds, and this test is about which OBJECT is named
    fresh.store = undefined;
    const store = probeStore();
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
    writeFileSync(probePath(FILE), CLEAN.replaceAll("answer", "answer2"));
    const afterStore = probeStore();
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
    const store = probeStore();
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
    const store = probeStore();
    const written = join("gen", "cds", "zcl_stg_cds_probe_row.clas.abap");
    store.publish = async () => {
      mkdirSync(join(runtimeFixture.root, "gen", "cds"), {recursive: true});
      writeFileSync(join(runtimeFixture.root, written), "* written by a generator during publish\n");
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
      rmSync(join(runtimeFixture.root, written), {force: true});
    }
  });

  it("a build that fails leaves the object NOT active, and says why", async () => {
    const store = probeStore();
    store.write("CLAS", NAME, CLEAN);
    store.publish = async () => ({ok: false, transpile: {ok: false, error: "ENOSPC"}});
    const destination2 = new StoreDestination({store: () => store});
    const answer = await call(destination2, {IV_COMMAND: "ACTIVATE", IV_NAME: NAME, IV_TYPE: "CLAS"});
    expect(answer.EV_ACTIVE, "the check held and the system did not get the code").to.equal("");
    expect(answer.EV_NOTE).to.match(/ENOSPC/);
    expect(store.stateOf(store.find("CLAS", NAME)).version).to.equal("inactive");
  });

  it("a save during publication cannot activate the later source", async () => {
    const store = probeStore();
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
    expect(answer.EV_NOTE.split(" ")).to.deep.equal(["LIST", "READ", "WRITE", "CREATE", "DELETE", "CHECK", "ACTIVATE", "ACTIVATION_STATUS", "RUN_TESTS", "HISTORY", "REVISION", "CHECKRUN", "PARSE"]);
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
    const destination = new StoreDestination({store: () => { opened += 1; return probeStore(); }});
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
        root: runtimeFixture.root,
        activationJournal: probeJournal(),
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
  it('survives an asynchronous EPIPE event and fails the pending publication', async () => {
    const {EventEmitter} = await import('node:events');
    const {attachStoreIPC} = await import('../tools/osd-store-ipc.mjs');
    const {ActivationJournal} = await import('../tools/osd-activation-journal.mjs');
    const child = new EventEmitter();
    child.connected = true;
    const failure = Object.assign(new Error('write EPIPE'), {code: 'EPIPE'});
    const store = {root, activationJournal: new ActivationJournal(root), activate: () => ({active: true, issues: []})};
    let attempted;
    const done = new Promise(resolve => {
      child.send = (message, callback) => {
        attempted = message;
        setImmediate(() => { callback?.(failure); child.emit('error', failure); resolve(); });
        return true;
      };
    });
    attachStoreIPC(child, {storeDestination: new StoreDestination({store})});
    child.emit('message', {type: 'store-request', id: 7, step: 1,
      parameters: {IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: 'ZOP'}});
    await done;
    expect(attempted.id).to.equal(7);
    const operation = JSON.parse(attempted.values.EV_JSON);
    expect(store.activationJournal.lookup(operation.op_id)).to.include({state: 'failed', failure_stage: 'step'});
    child.emit('exit');
  });
  it('survives a real SIGKILL before a slow STORE answer and serves a later request', async () => {
    const {spawn} = await import('node:child_process');
    const child = spawn(process.execPath, [resolve('test/helpers/store-ipc-killed-peer.mjs'), 'parent', root],
      {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '';
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    expect(code, err).to.equal(0);
    const result = JSON.parse(out.trim());
    expect(result.survived).to.equal(true);
    expect(result.sendError).to.equal('EPIPE');
    expect(result.status).to.include({state: 'failed', failure_stage: 'step', active: false});
    expect(result.status.completed_at).to.not.equal('');
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

describe('STORE RUN_TESTS on a published generation', function () {
  this.timeout(180000);
  let root, store, destination, generation;
  const green = 'ZCL_STORE_UNIT_GREEN', red = 'ZCL_STORE_UNIT_RED';
  const main = name => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION. CLASS-METHODS answer RETURNING VALUE(rv_answer) TYPE i.
ENDCLASS.
CLASS ${name.toLowerCase()} IMPLEMENTATION.
  METHOD answer. rv_answer = 42. ENDMETHOD.
ENDCLASS.\n`;
  const tests = (name, exp = 42, hook = '') => `CLASS ltcl_probe DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    ${hook ? `CLASS-METHODS class_setup.` : ''}
    METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION.
  ${hook ? `METHOD class_setup. ${hook} ENDMETHOD.` : ''}
  METHOD check. cl_abap_unit_assert=>assert_equals( act = ${name.toLowerCase()}=>answer( ) exp = ${exp} ). ENDMETHOD.
ENDCLASS.\n`;
  const execute = async input => {
    const response = await call(destination, {IV_COMMAND: 'RUN_TESTS', IV_JSON: JSON.stringify(input)});
    expect(response.EV_ERROR, response.EV_JSON).to.equal('');
    return JSON.parse(response.EV_JSON);
  };
  const run = (names, extra = {}) => execute({targets: names.map(name => ({type: 'CLAS', name})), ...extra});
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'store-unit-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.local/lars'), {recursive: true});
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    symlinkSync(resolve('.local/lars/open-abap-core'), join(root, '.local/lars/open-abap-core'), 'junction');
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/setup.mjs'), `import {SQLiteDatabaseClient} from '@abaplint/database-sqlite';
export async function setup(abap, schemas, insert) {
  const db = new SQLiteDatabaseClient(); abap.context.databaseConnections.DEFAULT = db;
  await db.connect(); await db.execute(schemas.sqlite); await db.execute(insert);
}`);
    writeFileSync(join(root, 'abaplint.jsonc'), JSON.stringify({global: {files: '/src/**/*.*'}, syntax: {version: 'OpenABAP'}, rules: {}}));
    writeFileSync(join(root, 'abap_transpile.json'), JSON.stringify({input_folder: ['src'], output_folder: 'output',
      libs: [{folder: '/.local/lars/open-abap-core', exclude_filter: ['/src/tcp/']}],
      write_source_map: true, options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: 'compileError',
        setup: {filename: '../test/setup.mjs', preFunction: 'setup'}}}));
    for (const [name, exp, hook] of [[green, 42, ''], [red, 43, ''], ['ZCL_STORE_UNIT_BROKEN', 42, 'ASSERT 1 = 2.']]) {
      writeFileSync(join(root, `src/${name.toLowerCase()}.clas.abap`), main(name));
      writeFileSync(join(root, `src/${name.toLowerCase()}.clas.testclasses.abap`), tests(name, exp, hook));
    }
    // Separate setup and loop subjects exercise stage mapping and watchdogs.
    for (const name of ['ZCL_STORE_UNIT_SETUP', 'ZCL_STORE_UNIT_SETUP_ASSERT', 'ZCL_STORE_UNIT_LOOP', 'ZCL_STORE_UNIT_BOOT']) {
      writeFileSync(join(root, `src/${name.toLowerCase()}.clas.abap`), main(name));
    }
    writeFileSync(join(root, 'src/zcl_store_unit_setup.clas.testclasses.abap'), `CLASS ltcl_setup DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
PRIVATE SECTION. METHODS setup. METHODS check FOR TESTING. ENDCLASS.
CLASS ltcl_setup IMPLEMENTATION. METHOD setup. ASSERT 1 = 2. ENDMETHOD. METHOD check. ENDMETHOD. ENDCLASS.`);
    writeFileSync(join(root, 'src/zcl_store_unit_setup_assert.clas.testclasses.abap'), `CLASS ltcl_setup_assert DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
PRIVATE SECTION. METHODS setup. METHODS check FOR TESTING. ENDCLASS.
CLASS ltcl_setup_assert IMPLEMENTATION.
METHOD setup. cl_abap_unit_assert=>assert_equals( act = 42 exp = 43 ). ENDMETHOD.
METHOD check. ENDMETHOD. ENDCLASS.`);
    writeFileSync(join(root, 'src/zcl_store_unit_loop.clas.testclasses.abap'), `CLASS ltcl_loop DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
PRIVATE SECTION. METHODS loop FOR TESTING. METHODS later FOR TESTING. ENDCLASS.
CLASS ltcl_loop IMPLEMENTATION. METHOD loop. DO. ENDDO. ENDMETHOD. METHOD later. ENDMETHOD. ENDCLASS.`);
    writeFileSync(join(root, 'src/zcl_store_unit_boot.clas.testclasses.abap'), tests('ZCL_STORE_UNIT_BOOT', 42, 'DO. ENDDO.'));
    const built = await build({root, generators: false});
    generation = built.hash;
    store = new ObjectStore({root, build: {generators: false}});
    activationJournal(store).recordGeneration(generation);
    destination = new StoreDestination({store});
  });
  after(() => {if (root) rmSync(root, {recursive: true, force: true});});
  it('advertises RUN_TESTS in COMMANDS and CAPABILITIES', async () => {
    expect(JSON.parse((await call(destination, {IV_COMMAND: 'COMMANDS'})).EV_JSON).commands).to.include('RUN_TESTS');
    expect((await call(destination, {IV_COMMAND: 'CAPABILITIES'})).EV_NOTE.split(' ')).to.include('RUN_TESTS');
  });
  it('returns a green run on the requested generation', async () => {
    const result = await run([green], {expected_generation: generation});
    expect(result).to.include({state: 'ran', generation_id: generation, expected_generation: generation});
    expect(result).not.to.have.property('op_id');
    expect(result.counts).to.deep.equal({classes: 1, methods: 1, pass: 1, fail: 0, error: 0, skipped: 0});
    expect(result.classes[0]).to.include({name: 'LTCL_PROBE', state: 'ok'});
    expect(result.classes[0].target).to.deep.equal({type: 'CLAS', name: green});
  });
  it('keeps red assertions separate from execution errors, including expected/actual and source stack', async () => {
    const result = await run([red]);
    expect(result.state).to.equal('ran');
    expect(result.classes[0].state).to.equal('ok');
    expect(result.counts).to.include({fail: 1, error: 0});
    const method = result.classes[0].methods[0];
    expect(method.verdict).to.equal('fail');
    expect(method.alerts[0]).to.include({kind: 'failedAssertion', expected: '43', actual: '42'});
    expect(method.alerts[0].stack.some(e => e.type === 'CLAS' && e.name === red && e.include === 'testclasses' && e.line > 0)).to.equal(true);
  });
  it('reports broken class_setup beside a green target and continues', async () => {
    const result = await run(['ZCL_STORE_UNIT_BROKEN', green]);
    expect(result.state).to.equal('ran');
    expect(result.classes[0].state).to.equal('error');
    expect(result.classes[0].error).to.include({stage: 'class_setup'});
    expect(result.classes[0].error.text).not.to.equal('');
    expect(result.classes[1].methods[0].verdict).to.equal('pass');
  });
  it('reports setup as a class error and a method execution error', async () => {
    const result = await run(['ZCL_STORE_UNIT_SETUP', green]);
    expect(result.state).to.equal('ran');
    expect(result.classes[0].error.stage).to.equal('setup');
    expect(result.classes[0].methods[0].verdict).to.equal('error');
    expect(result.classes[1].methods[0].verdict).to.equal('pass');
  });
  it('preserves fail for a failed assertion even when raised from setup', async () => {
    const result = await run(['ZCL_STORE_UNIT_SETUP_ASSERT']);
    expect(result.state).to.equal('ran');
    expect(result.classes[0].error.stage).to.equal('setup');
    expect(result.classes[0].methods[0].verdict).to.equal('fail');
    expect(result.counts).to.include({fail: 1, error: 0});
  });
  it('refuses a generation mismatch before executing a looping subject', async () => {
    const result = await run(['ZCL_STORE_UNIT_LOOP'], {expected_generation: 'old-generation'});
    expect(result.state).to.equal('not_run');
    expect(result.error).to.include({code: 'GENERATION_MISMATCH', expected_generation: 'old-generation', current_generation: generation});
    expect(result.classes).to.deep.equal([]);
    expect(result.counts.methods).to.equal(0);
  });
  it('omitted expected_generation uses published discovery and modules despite an inactive edit', async () => {
    const file = join(root, `src/${green.toLowerCase()}.clas.testclasses.abap`);
    const original = readFileSync(file, 'utf8');
    try {
      await store.write('CLAS', green, tests(green, 99).replaceAll('ltcl_probe', 'ltcl_inactive'), 'testclasses');
      const result = await run([green]);
      expect(result).to.include({state: 'ran', generation_id: generation, expected_generation: null});
      expect(result.classes[0]).to.include({name: 'LTCL_PROBE', state: 'ok'});
      expect(result.counts.pass).to.equal(1);
    } finally {await store.write('CLAS', green, original, 'testclasses');}
  });
  it('unknown target is a class not_found error and leaves the other target runnable', async () => {
    const result = await run(['ZCL_STORE_UNIT_UNKNOWN', green]);
    expect(result.state).to.equal('ran');
    expect(result.classes[0]).to.include({state: 'error'});
    expect(result.classes[0].error.stage).to.equal('not_found');
    expect(result.classes[1].methods[0].verdict).to.equal('pass');
  });
  it('rejects unsupported PROG and malformed requests with precise JSON refusals', async () => {
    expect((await execute({targets: [{type: 'PROG', name: 'ZREPORT'}]})).error).to.include({code: 'NOT_SUPPORTED'});
    for (const input of [{targets: []}, {targets: ['ZCL_X']}, {targets: [{type: 'CLAS', name: '../BAD'}]},
      {targets: [{type: 'CLAS', name: green}], expected_generation: null}]) {
      expect((await execute(input)).error.code).to.equal('INVALID_NAME');
    }
  });
  it('echoes the current and expected generations on every validation refusal', async () => {
    for (const targets of [[], ['ZCL_X'], [{type: 'CLAS', name: '../BAD'}], [{type: 'PROG', name: 'ZREPORT'}]]) {
      const result = await execute({targets, expected_generation: 'caller-generation'});
      expect(result).to.include({state: 'not_run', generation_id: generation, expected_generation: 'caller-generation'});
      expect(result.classes).to.deep.equal([]);
    }
    const malformed = await call(destination, {IV_COMMAND: 'RUN_TESTS', IV_JSON: '{'});
    expect(JSON.parse(malformed.EV_JSON)).to.include({state: 'not_run', generation_id: generation});
    const {runStoreTests} = await import('../tools/osd-store-tests.mjs');
    const rootless = await runStoreTests({served: {running: true, generation}}, JSON.stringify({targets: [{type: 'CLAS', name: green}]}));
    expect(rootless).to.include({state: 'not_run', generation_id: generation});
    expect(rootless.error.code).to.equal('NOT_SUPPORTED');
  });
  it('caps requests at 50 targets with INVALID_INPUT before any execution', async () => {
    const {UnitRun} = await import('../tools/osd-unit.mjs');
    const previous = UnitRun.prototype.runDetached;
    let executions = 0;
    UnitRun.prototype.runDetached = async () => {executions++; throw new Error('target cap execution canary');};
    try {
      const result = await run(Array(51).fill('ZCL_STORE_UNIT_LOOP'), {expected_generation: generation});
      expect(result).to.include({state: 'not_run', generation_id: generation, expected_generation: generation});
      expect(result.error.code).to.equal('INVALID_INPUT');
      expect(result.error.text).to.contain('50');
      expect(result.classes).to.deep.equal([]);
      expect(executions).to.equal(0);
    } finally {UnitRun.prototype.runDetached = previous;}
  });
  it('de-duplicates identical targets after normalization', async () => {
    const result = await execute({targets: [{type: 'clas', name: green.toLowerCase()}, {type: 'CLAS', name: green}]});
    expect(result.state).to.equal('ran');
    expect(result.counts).to.include({classes: 1, methods: 1, pass: 1});
  });
  it('uses INVALID_INPUT for invalid timeout values', async () => {
    const previous = process.env.OSD_STORE_TEST_METHOD_MS;
    try {
      process.env.OSD_STORE_TEST_METHOD_MS = 'invalid';
      const result = await run(['ZCL_STORE_UNIT_LOOP']);
      expect(result).to.include({state: 'not_run', generation_id: generation});
      expect(result.error.code).to.equal('INVALID_INPUT');
      expect(result.classes).to.deep.equal([]);
    } finally {
      if (previous === undefined) delete process.env.OSD_STORE_TEST_METHOD_MS;
      else process.env.OSD_STORE_TEST_METHOD_MS = previous;
    }
  });
  it('refuses absent-checkpoint fallback after STORE WRITE and an external build', async () => {
    const {UnitRun} = await import('../tools/osd-unit.mjs');
    const {switchTo} = await import('../tools/osd-build.mjs');
    const journal = activationJournal(store), previous = UnitRun.prototype.runDetached;
    const file = join(root, `src/${green.toLowerCase()}.clas.testclasses.abap`), original = readFileSync(file, 'utf8');
    let executions = 0;
    UnitRun.prototype.runDetached = async () => {executions++; throw new Error('inactive execution canary');};
    try {
      rmSync(journal.generationFile, {force: true});
      const written = await call(destination, {IV_COMMAND: 'WRITE', IV_TYPE: 'CLAS', IV_NAME: green,
        IV_INCLUDE: 'testclasses', IV_SOURCE: tests(green, 99)});
      expect(written.EV_ERROR).to.equal('');
      const external = await build({root, generators: false});
      expect(external.hash).not.to.equal(generation);
      const result = await run([green]);
      expect(result).to.include({state: 'not_run', generation_id: external.hash});
      expect(result.error.code).to.equal('GENERATION_UNAVAILABLE');
      expect(result.classes).to.deep.equal([]);
      expect(executions).to.equal(0);
      // A failed tracked build must not record this external generation as
      // a trusted baseline while inactive source exists.
      const transpile = store.transpile;
      store.transpile = async () => ({ok: false});
      try {expect((await store.publish({activate: [{type: 'CLAS', name: green}]})).ok).to.equal(false);}
      finally {store.transpile = transpile;}
      const afterFailedBuild = await run([green]);
      expect(afterFailedBuild).to.include({state: 'not_run', generation_id: external.hash});
      expect(afterFailedBuild.error.code).to.equal('GENERATION_UNAVAILABLE');
      expect(executions).to.equal(0);
    } finally {
      UnitRun.prototype.runDetached = previous;
      await store.write('CLAS', green, original, 'testclasses');
      switchTo(root, generation); journal.recordGeneration(generation);
    }
  });
  it('checkpoint recording failure never fails publish or promotion or leaves a ticket pending', async () => {
    const {switchTo, liveHash} = await import('../tools/osd-build.mjs');
    const journal = activationJournal(store), previous = journal.recordGeneration, warn = console.warn;
    let attempts = 0;
    const warnings = [];
    journal.recordGeneration = () => {attempts++; throw Object.assign(new Error('injected checkpoint failure'), {code: 'ENOSPC'});};
    console.warn = message => warnings.push(message);
    try {
      const published = await store.publish();
      expect(published.ok).to.equal(true);
      expect(published.generation).to.equal(liveHash(root));
      const response = await call(destination, {IV_COMMAND: 'ACTIVATE', IV_TYPE: 'CLAS', IV_NAME: green});
      expect(response).to.include({EV_ERROR: '', EV_ACTIVE: 'X'});
      const ticket = JSON.parse(response.EV_JSON);
      expect(ticket.state).to.equal('published');
      expect(ticket.generation_id).to.equal(liveHash(root));
      expect(journal.lookup(ticket.op_id).state).to.equal('published');
      expect(attempts).to.be.at.least(5); // baseline, publish, activation baseline, promotion and ticket update
      expect(warnings).to.have.length(1);
      const result = await run(['ZCL_STORE_UNIT_LOOP']);
      expect(result.state).to.equal('not_run');
      expect(result.error.code).to.equal('GENERATION_UNAVAILABLE');
      expect(result.classes).to.deep.equal([]);
    } finally {
      journal.recordGeneration = previous; console.warn = warn;
      switchTo(root, generation);
      journal.recordGenerationBestEffort(generation); store.generationRecordingFailed = false;
    }
  });
  it('a per-target parse failure becomes a discovery error beside a runnable green target', async () => {
    const {Registry} = await import('@abaplint/core');
    const previous = Registry.prototype.parse;
    Registry.prototype.parse = function (...args) {
      if ([...this.getFiles()].some(f => f.getFilename().includes(red.toLowerCase()))) throw new Error('injected target parse failure');
      return previous.apply(this, args);
    };
    try {
      const result = await run([red, green]);
      expect(result.state).to.equal('ran');
      expect(result.classes[0]).to.include({state: 'error', name: red});
      expect(result.classes[0].error).to.deep.equal({stage: 'discovery', text: 'injected target parse failure'});
      expect(result.classes[1].methods[0].verdict).to.equal('pass');
    } finally {Registry.prototype.parse = previous;}
  });
  it('a child that dies during boot without JSON is a class execution error and other targets continue', async () => {
    const file = join(root, 'test/setup.mjs'), original = readFileSync(file, 'utf8');
    // The plan is passed to the real child; fail only the red target's boot.
    writeFileSync(file, original.replace('export async function setup(abap, schemas, insert) {',
      `export async function setup(abap, schemas, insert) {\nif (process.argv[3] === '${red}') throw new Error('injected broken boot');`));
    try {
      const result = await run([red, green]);
      expect(result.state).to.equal('ran');
      expect(result.classes[0]).to.include({state: 'error', name: 'LTCL_PROBE'});
      expect(result.classes[0].error.stage).to.equal('execution');
      expect(result.classes[0].error.text).to.contain('injected broken boot');
      expect(result.classes[0].methods).to.deep.equal([]);
      expect(result.classes[1].methods[0].verdict).to.equal('pass');
    } finally {writeFileSync(file, original);}
  });
  it('never starts tests while an activation is pending', async () => {
    const {activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const journal = activationJournal(store), pending = journal.create('CLAS', green);
    try {
      const result = await run(['ZCL_STORE_UNIT_LOOP']);
      expect(result.state).to.equal('not_run');
      expect(result.error.code).to.equal('PUBLICATION_PENDING');
      expect(result.counts.methods).to.equal(0);
    } finally {journal.update(pending.op_id, {state: 'failed', failure_stage: 'step'});}
  });
  it('refuses an unconfirmed build after failed promotion, including after journal reload', async () => {
    const {ActivationJournal, activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const journal = activationJournal(store);
    journal.recordGeneration('previous-confirmed-generation');
    const ticket = journal.create('CLAS', green);
    journal.update(ticket.op_id, {state: 'failed', failure_stage: 'revision'});
    try {
      const reloaded = new ActivationJournal(root, {host: journal.directory.split('/').at(-1)});
      expect(reloaded.currentGeneration(generation)).to.equal('previous-confirmed-generation');
      const result = await run(['ZCL_STORE_UNIT_LOOP']);
      expect(result.state).to.equal('not_run');
      expect(result.error.code).to.equal('GENERATION_UNAVAILABLE');
      expect(result.counts.methods).to.equal(0);
    } finally {journal.recordGeneration(generation);}
  });
  it('pins discovery and execution when the live generation changes during a run', async () => {
    const {UnitRun} = await import('../tools/osd-unit.mjs');
    const {switchTo} = await import('../tools/osd-build.mjs');
    const {activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const journal = activationJournal(store), previous = UnitRun.prototype.runDetached;
    const alternate = 'new-published-generation';
    mkdirSync(join(root, 'build/by-input', alternate, 'output'), {recursive: true});
    UnitRun.prototype.runDetached = async function (...args) {
      // The new pointer has no test modules. Resolving output through it
      // instead of the selected copy would fail the real detached run.
      switchTo(root, alternate);
      journal.recordGeneration(alternate);
      return previous.apply(this, args);
    };
    try {
      const result = await run([green], {expected_generation: generation});
      expect(result).to.include({state: 'ran', generation_id: generation});
      expect(result.counts.pass).to.equal(1);
    } finally {
      UnitRun.prototype.runDetached = previous;
      switchTo(root, generation); journal.recordGeneration(generation);
      rmSync(join(root, 'build/by-input', alternate), {recursive: true, force: true});
    }
  });
  it('interrupts a synchronous test loop with a timeout alert and continues the green class', async () => {
    const {runStoreTests} = await import('../tools/osd-store-tests.mjs');
    const result = await runStoreTests(store, JSON.stringify({targets: [
      {type: 'CLAS', name: 'ZCL_STORE_UNIT_LOOP'}, {type: 'CLAS', name: green}]}), {testTimeout: 100, runTimeout: 30000});
    expect(result.state).to.equal('ran');
    expect(result.classes[0].methods[0]).to.include({name: 'LOOP', verdict: 'error'});
    expect(result.classes[0].methods[0].alerts[0].kind).to.equal('timeout');
    expect(result.classes[0].methods[1].verdict).to.equal('skipped');
    expect(result.classes[1].methods[0].verdict).to.equal('pass');
    expect(result.counts).to.include({error: 1, skipped: 1, pass: 1});
  });
  it('a whole-run timeout is failed at the run level', async () => {
    const {runStoreTests} = await import('../tools/osd-store-tests.mjs');
    const result = await runStoreTests(store, JSON.stringify({targets: [{type: 'CLAS', name: 'ZCL_STORE_UNIT_BOOT'}]}),
      {testTimeout: 10000, runTimeout: 1500});
    expect(result).to.include({state: 'failed', failure_stage: 'timeout'});
    expect(result.error.code).to.equal('RUN_TIMEOUT');
  });
  it('includes a queued source-lock wait in the whole-run timeout and never starts late work', async () => {
    const {runStoreTests} = await import('../tools/osd-store-tests.mjs');
    const {withSourceLock} = await import('../tools/osd-store-source-lock.mjs');
    let release;
    const hold = new Promise(resolve => {release = resolve;});
    const locked = withSourceLock(store, () => hold);
    await new Promise(resolve => setImmediate(resolve));
    try {
      const result = await runStoreTests(store, JSON.stringify({targets: [{type: 'CLAS', name: green}]}), {runTimeout: 20});
      expect(result).to.include({state: 'failed', failure_stage: 'timeout'});
      expect(result.error.code).to.equal('RUN_TIMEOUT');
      expect(result.classes).to.deep.equal([]);
    } finally {release(); await locked;}
    // Draining the expired callback must leave the next run available.
    expect((await run([green])).counts.pass).to.equal(1);
  });
  it('a broken runner is failed at the run level, distinct from a broken test class', async () => {
    const {UnitRun} = await import('../tools/osd-unit.mjs');
    const previous = UnitRun.prototype.runDetached;
    UnitRun.prototype.runDetached = async () => {throw new Error('runner transport stopped');};
    try {
      const result = await run([green]);
      expect(result).to.include({state: 'failed', failure_stage: 'runner'});
      expect(result.error.text).to.equal('runner transport stopped');
    } finally {UnitRun.prototype.runDetached = previous;}
  });
  it('returns unknown and expired activation IDs as EV_JSON, retaining INVALID_NAME', async () => {
    const {activationJournal} = await import('../tools/osd-activation-journal.mjs');
    const lookup = op_id => call(destination, {IV_COMMAND: 'ACTIVATION_STATUS', IV_JSON: JSON.stringify({op_id})});
    let result = await lookup('no-such-operation');
    expect(result.EV_ERROR).to.equal('');
    expect(JSON.parse(result.EV_JSON)).to.deep.equal({state: 'not_found', code: 'NOT_FOUND', op_id: 'no-such-operation'});
    expect(JSON.parse((await lookup('__proto__')).EV_JSON)).to.deep.equal({state: 'not_found', code: 'NOT_FOUND', op_id: '__proto__'});
    const journal = activationJournal(store), ticket = journal.create('CLAS', green);
    journal.update(ticket.op_id, {state: 'failed', failure_stage: 'validation'});
    journal.entries[ticket.op_id].completed_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    result = await lookup(ticket.op_id);
    expect(result.EV_ERROR).to.equal('');
    expect(JSON.parse(result.EV_JSON)).to.deep.equal({state: 'not_found', code: 'NOT_FOUND', op_id: ticket.op_id});
    result = await lookup('');
    expect(JSON.parse(result.EV_JSON).error.code).to.equal('INVALID_NAME');
    expect(result.EV_ERROR).not.to.equal('');
  });
  it('runs synchronously through parent STORE IPC with the runner owning its timeout', async () => {
    const {EventEmitter} = await import('node:events');
    const {StoreIPCClient, attachStoreIPC} = await import('../tools/osd-store-ipc.mjs');
    const parent = new EventEmitter(), channel = new EventEmitter();
    parent.connected = channel.connected = true;
    parent.send = message => queueMicrotask(() => channel.emit('message', message));
    channel.send = message => queueMicrotask(() => parent.emit('message', message));
    attachStoreIPC(parent, {storeDestination: destination});
    const client = new StoreIPCClient(channel);
    const signature = {exporting: {IV_COMMAND: box('RUN_TESTS'), IV_JSON: box(JSON.stringify({
      targets: [{type: 'CLAS', name: green}], expected_generation: generation}))}, importing: {EV_JSON: box(''), EV_ERROR: box('')}};
    try {
      const pending = client.call('ZOSD_STORE', signature);
      expect([...client.pending.values()][0].timer).to.equal(undefined);
      await pending;
      const response = answerOf(signature);
      expect(response.EV_ERROR).to.equal('');
      expect(JSON.parse(response.EV_JSON)).to.include({state: 'ran', generation_id: generation});
      expect(JSON.parse(response.EV_JSON).counts.pass).to.equal(1);
    } finally {client.close(); parent.connected = false; parent.emit('disconnect');}
  });
  it('PIA acceptance runs CREATE/ACTIVATE/status/red/fix/green/mismatch/DELETE through the ABAP host', async () => {
    const {initializeABAP} = await import('../output/init.mjs');
    await initializeABAP();
    const abap = globalThis.abap;
    const {zcl_osd_adt_host: host} = await import('../output/zcl_osd_adt_host.clas.mjs');
    const {dialogStep} = await import('../tools/osd-dialog-step.mjs');
    const {bindEnqSession, reviveEnqSession, endEnqSession} = await import('../tools/osd-enq-host.mjs');
    const previous = abap.context.RFCDestinations.STORE;
    const subject = 'ZCL_PIA_P3B_SUBJECT', carrier = 'ZCL_PIA_P3B_TESTS', owner = 'pia-p3b-acceptance';
    const abapCall = async (command, params = {}) => {
      const values = Object.fromEntries(Object.entries({iv_command: command, ...params})
        .map(([k, v]) => [k, new abap.types.String().set(v)]));
      const answer = await host.store(values);
      return answer.get().json.get() ? JSON.parse(answer.get().json.get()) : null;
    };
    const step = work => dialogStep(() => {
      reviveEnqSession(owner); bindEnqSession(owner, {user: 'PIA'});
      return work();
    }, 'PIA P3b acceptance');
    const activate = async name => {
      let continuation;
      const pending = await step(() => withSystem(() => {}, () => abapCall('ACTIVATE', {iv_type: 'CLAS', iv_name: name}),
        {store, deferActivate: work => {continuation = work;}}));
      expect(pending.state).to.equal('pending');
      await continuation();
      const published = await step(() => abapCall('ACTIVATION_STATUS', {iv_json: JSON.stringify({op_id: pending.op_id})}));
      expect(published.state, JSON.stringify(published)).to.equal('published');
      return published.generation_id;
    };
    const runABAP = gen => step(() => abapCall('RUN_TESTS', {iv_json: JSON.stringify({targets: [{type: 'CLAS', name: carrier}], expected_generation: gen})}));
    abap.context.RFCDestinations.STORE = destination;
    try {
      await step(() => host.require({iv_command: new abap.types.String().set('RUN_TESTS')}));
      for (const name of [subject, carrier]) {
        expect((await step(() => abapCall('CREATE', {iv_type: 'CLAS', iv_name: name, iv_source: main(name)}))).created).to.equal(true);
      }
      await step(() => abapCall('WRITE', {iv_type: 'CLAS', iv_name: carrier, iv_include: 'testclasses', iv_source: tests(subject, 43)}));
      await activate(subject);
      const x = await activate(carrier);
      const redRun = await runABAP(x);
      const callerDatabase = abap.context.databaseConnections.DEFAULT;
      expect(redRun.state).to.equal('ran');
      expect(redRun.classes[0].methods[0]).to.include({verdict: 'fail'});
      expect(redRun.classes[0].methods[0].alerts[0]).to.include({expected: '43', actual: '42'});
      await step(() => abapCall('WRITE', {iv_type: 'CLAS', iv_name: carrier, iv_include: 'testclasses', iv_source: tests(subject, 42)}));
      const y = await activate(carrier);
      expect(y).not.to.equal(x);
      expect((await runABAP(y)).counts).to.include({pass: 1, fail: 0, error: 0});
      expect(globalThis.abap).to.equal(abap);
      expect(abap.context.databaseConnections.DEFAULT).to.equal(callerDatabase);
      const mismatch = await runABAP(x);
      expect(mismatch.state).to.equal('not_run');
      expect(mismatch.error).to.include({code: 'GENERATION_MISMATCH', expected_generation: x, current_generation: y});
      const absent = await step(() => abapCall('ACTIVATION_STATUS', {iv_json: '{"op_id":"unknown-pia-operation"}'}));
      expect(absent).to.deep.equal({state: 'not_found', code: 'NOT_FOUND', op_id: 'unknown-pia-operation'});
    } finally {
      try {
        for (const name of [carrier, subject]) if (store.find('CLAS', name)) {
          expect((await step(() => abapCall('DELETE', {iv_type: 'CLAS', iv_name: name}))).deleted).to.equal(true);
          expect(store.find('CLAS', name)).to.equal(undefined);
        }
      } finally {abap.context.RFCDestinations.STORE = previous; endEnqSession(owner);}
    }
  });
  it('follows publication and promotion through the shared ObjectStore path used by ADT', async () => {
    await store.write('CLAS', green, tests(green, 41), 'testclasses');
    const checked = store.activate('CLAS', green);
    expect(checked.active).to.equal(true);
    const published = await store.publish({activate: [{type: 'CLAS', name: green}]});
    expect(published.ok).to.equal(true);
    // Before promotion, the generation's new modules cannot run as published.
    expect((await run([green])).error.code).to.equal('GENERATION_UNAVAILABLE');
    expect(await store.completeActivation(checked, published.transpile.built)).to.equal(true);
    const result = await run([green], {expected_generation: published.generation});
    expect(result.state).to.equal('ran');
    expect(result.counts.fail).to.equal(1);
    expect(result.classes[0].methods[0].alerts[0]).to.include({expected: '41', actual: '42'});
  });
});
