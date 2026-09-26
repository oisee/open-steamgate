// Classic reports through open-abap-gui's converter, wired as transactions
// this system's webgui can enter (spike, docs/gui-reports.md).
//
// Two different things, kept apart the way test/transaction.mjs keeps its
// three apart: that tools/osd-gui-convert.mjs turns a *.prog.abap into ABAP
// that at least parses (a generator test, no server), and that the three
// examples packs/gui-examples fetches actually run as transactions once the
// tree is built -- an HTTP test, the browser played by hand the way
// test/transaction.mjs plays ZOSD_NOTE.
import {expect} from "chai";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {generate, namesOf, programNameOf} from "../tools/osd-gui-convert.mjs";
import {startServer} from "./start.mjs";

const {Registry, Config, MemoryFile} = createRequire(import.meta.url)("@abaplint/core");
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/gui/sap/its/webgui/`;

// a parse-level check only: whether the generated source is well-formed
// ABAP at all, the "structure" issues abaplint's own parser raises (an
// unresolved type like ZIF_GG_REPORT_V1 is expected here -- this registry
// holds one file and none of open-abap-gui's -- and is not what this test
// is for; npm run transpile is the real gate for that, and CI runs it).
function structuralIssues(filename, source) {
  const registry = new Registry(Config.getDefault());
  registry.addFile(new MemoryFile(filename, source));
  registry.parse();
  return registry.findIssues().filter((issue) => issue.getKey() === "structure");
}

const EXAMPLES = ["ZGG_EX_001", "ZGG_EX_012", "ZGG_EX_043"];

describe("osd-gui-convert: three of Lars's example reports", () => {
  let reports;

  before(async () => {
    const result = await generate(["packs/gui-examples/upstream"], ".local/scratch/gui-convert-test");
    reports = result.reports;
  });

  it("converts all three in strict mode and wires a transaction for each", () => {
    for (const program of EXAMPLES) {
      const entry = reports.find((r) => r.programName === program);
      expect(entry, `${program} was not converted at all`).to.not.equal(undefined);
      expect(entry.mode, `${program}'s conversion mode`).to.equal("strict");
      expect(entry.supported, `${program} was not supported`).to.equal(true);
      expect(entry.wired, `${program} was not wired as a transaction`).to.equal(true);
      expect(entry.className).to.equal(namesOf(program).className);
      expect(entry.tcode).to.equal(namesOf(program).tcode);
    }
  });

  it("names the wrapper class and tcode from the REPORT statement, not the file name", () => {
    expect(programNameOf("REPORT zgg_ex_001.\n")).to.equal("ZGG_EX_001");
    expect(programNameOf("REPORT zgg_ex_099 MESSAGE-ID zz.\n")).to.equal("ZGG_EX_099");
    expect(programNameOf("* an include, no REPORT statement\nWRITE 'x'.\n")).to.equal(undefined);
    const names = namesOf("ZGG_EX_001");
    expect(names).to.deep.equal({
      base: "GG_EX_001", className: "ZCL_OSD_GUI_GG_EX_001",
      wrapperClassName: "ZCL_OSD_GUITX_GG_EX_001", tcode: "ZGUI_GG_EX_001",
    });
  });

  it("the converted report and its wrapper both parse (abaplint, structure only)", () => {
    for (const program of EXAMPLES) {
      const entry = reports.find((r) => r.programName === program);
      const classIssues = structuralIssues(`${entry.className.toLowerCase()}.clas.abap`, readWritten(entry.className));
      expect(classIssues, `${entry.className}: ${classIssues.map((i) => i.getMessage()).join("; ")}`).to.have.length(0);
      const wrapperIssues = structuralIssues(`${entry.wrapperClassName.toLowerCase()}.clas.abap`, readWritten(entry.wrapperClassName));
      expect(wrapperIssues, `${entry.wrapperClassName}: ${wrapperIssues.map((i) => i.getMessage()).join("; ")}`).to.have.length(0);
    }
  });
});

function readWritten(className) {
  return readFileSync(`.local/scratch/gui-convert-test/${className.toLowerCase()}.clas.abap`, "utf8");
}

// ---------------------------------------------------------------- HTTP

// The document inside the HTML viewer's sandboxed iframe, escaping taken
// off -- the same trick test/transaction.mjs plays for ZOSD_NOTE.
function frameDocument(page) {
  const match = /srcdoc="([^"]*)"/.exec(page);
  if (match === null) return undefined;
  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

const statusBar = (page) => /<span class="msg" id="msg">([^<]*)/.exec(page)?.[1] ?? "";
const field = (doc, name) => new RegExp(`name="${name}" value="([^"]*)"`).exec(doc)?.[1];

// The rendered page has more than one <form>: Lars's own workbench chrome
// (framework/zcl_gg_workbench_utility) renders three hidden command forms
// of its own (wb-command-transaction, -workbench, -dispatch) ahead of the
// page's real content form, and the chrome's own dispatch one shares the
// same rewritten action -- so this takes the *last* form whose action
// carries our dispatch route, which is the content form in document order.
const dispatchForm = (doc) => [...doc.matchAll(/<form[^>]*action="([^"]*okcode=dispatch[^"]*)"[^>]*>/g)].at(-1)?.[1];

async function enter(tcode) {
  const page = await (await fetch(`${BASE}?okcode=${encodeURIComponent(tcode)}`)).text();
  const doc = frameDocument(page);
  expect(doc, `${tcode} drew nothing: ${statusBar(page)}`).to.not.equal(undefined);
  return doc;
}

// what a plain HTML form posts: its own hidden fields plus whatever the
// caller overrides or adds (a submitted button's own name/value, a typed
// field) -- request_of on the wrapper's side reads exactly these names.
async function post(doc, overrides) {
  const url = new URL(dispatchForm(doc), BASE);
  const body = new URLSearchParams({
    osdsid: field(doc, "osdsid"),
    gg_control: field(doc, "gg_control"),
    session_id: field(doc, "session_id"),
    page_id: field(doc, "page_id"),
    ...overrides,
  });
  const page = await (await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: body.toString(),
  })).text();
  return frameDocument(page);
}

describe("webgui: converted reports run as transactions (docs/gui-reports.md)", () => {
  let server;

  before(() => {
    server = startServer(true);
  });

  after(() => {
    server.close();
  });

  it("ZGUI_GG_EX_001: a plain WRITE report renders its list, no click needed", async () => {
    const doc = await enter("ZGUI_GG_EX_001");
    expect(doc).to.contain("hello world");
    expect(doc).to.contain("ZCL_OSD_GUI_GG_EX_001");
  });

  it("ZGUI_GG_EX_012: Execute on the selection screen comes back with the date", async () => {
    const doc = await enter("ZGUI_GG_EX_012");
    // the default INITIALIZATION set: P_DATE=20260101, shown formatted
    expect(doc).to.contain('name="P_DATE"');
    expect(doc).to.contain('value="ONLI"');
    const after = await post(doc, {P_DATE: "20260101", gg_ucomm: "ONLI"});
    expect(after, "the report's own WRITE of what it read back").to.contain("20260101");
    expect(after, "a list page can go BACK to the selection screen").to.contain('value="BACK"');
  });

  it("ZGUI_GG_EX_012: Cancel comes back too, without running the report", async () => {
    const doc = await enter("ZGUI_GG_EX_012");
    const after = await post(doc, {gg_action: "EXIT"});
    // canceled goes back to a fresh selection screen, not to the list a run
    // would have produced (aria-label="List output" is the list's own
    // container; "gg-list-line" is also a class the shared stylesheet
    // defines, so it is in every page's <style> block whether or not one is
    // drawn -- the aria-label only appears where a list is actually there)
    expect(after, "back on the selection screen").to.contain("Selection work area");
    expect(after, "not the list a run would have produced").to.not.contain('aria-label="List output"');
  });

  it("ZGUI_GG_EX_043: the list renders, and clicking a line comes back", async () => {
    const doc = await enter("ZGUI_GG_EX_043");
    expect(doc).to.contain('value="LINE:2|H-1-2"');
    const after = await post(doc, {action: "SUBMIT", "gg_action": "LINE:2|H-1-2"});
    // AT LINE-SELECTION's own WRITE / gv_id, appended below the three lines
    // the click was made against -- a fourth line, with no LINE action of
    // its own (docs/gui-reports.md: the request_of subset this bridges)
    expect(after).to.contain('data-line-index="4"');
    expect(after).to.contain('value="BACK"');
  });
});
