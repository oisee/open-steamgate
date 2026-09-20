import {expect} from "chai";
import {serviceOf, channelOf, handlerRows, mountServices, services, channels} from "../tools/osd-icf.mjs";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// SICF, and the APC application beside it: which class answers which URL.
// The shapes are abapGit's, so these are read from the real serialisations
// rather than from a format we invented.
describe("tools/osd-icf: the table that says who answers where", () => {

  const SICF = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SICF">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>
   <URL>/sap/bc/zo4d_demo/</URL>
   <ICFSERVICE><ICF_NAME>ZO4D_DEMO</ICF_NAME></ICFSERVICE>
   <ICFDOCU><ICF_DOCU>Oisee/4D (Alice V) Demo</ICF_DOCU></ICFDOCU>
   <ICFHANDLER_TABLE><ICFHANDLER>
     <ICF_NAME>ZO4D_DEMO</ICF_NAME><ICFORDER>01</ICFORDER>
     <ICFHANDLER>ZCL_O4D_HTTP_HANDLER</ICFHANDLER>
   </ICFHANDLER></ICFHANDLER_TABLE>
 </asx:values></asx:abap></abapGit>`;

  const SAPC = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SAPC">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><SAPC><HEADER>
   <APPLICATION_ID>ZO4D_DEMO</APPLICATION_ID>
   <PATH>/sap/bc/apc/sap/zo4d_demo</PATH>
   <CLASS_NAME>ZCL_O4D_APC_HANDLER</CLASS_NAME>
   <STATEFUL>X</STATEFUL>
 </HEADER><TEXT><DESCRIPTION>ZO4D Demo</DESCRIPTION></TEXT></SAPC></asx:values></asx:abap></abapGit>`;

  it("a service node is a path and the class that answers on it", () => {
    const service = serviceOf(SICF, "x");
    expect(service.path).to.equal("/sap/bc/zo4d_demo");
    expect(service.handler).to.equal("ZCL_O4D_HTTP_HANDLER");
    expect(service.description).to.equal("Oisee/4D (Alice V) Demo");
  });

  // ICFHANDLER names both the table row and the field inside it, so a reader
  // that takes the first match gets the row and not the class
  it("the handler is the class, not the element that wraps it", () => {
    expect(serviceOf(SICF, "x").handler).to.not.contain("TABLE");
    expect(serviceOf(SICF, "x").handler.startsWith("ZCL_")).to.equal(true);
  });

  // **ICFTYP was serialised in every node from the day they were written and
  // read by nothing.** It is the handler's kind -- what the name in
  // ICFHANDLER refers to -- and reading it is what lets a node say where it
  // works instead of every node being assumed to be an ABAP class.
  const TYPED = `<asx:values>
   <URL>/sap/bc/osd/status/</URL>
   <ICFHANDLER_TABLE>
    <ICFHANDLER><ICF_NAME>Z</ICF_NAME><ICFORDER>01</ICFORDER><ICFTYP>A</ICFTYP><ICFHANDLER>ZCL_PARENT</ICFHANDLER></ICFHANDLER>
    <ICFHANDLER><ICF_NAME>Z</ICF_NAME><ICFORDER>02</ICFORDER><ICFTYP>A</ICFTYP><ICFHANDLER>ZCL_OSD_STATUS_HTTP</ICFHANDLER></ICFHANDLER>
   </ICFHANDLER_TABLE>
 </asx:values>`;

  it("the handler rows are rows, and each carries its own type", () => {
    const rows = handlerRows(TYPED);
    // the nesting is what tells a row from the field of the same name; a
    // reader that took the last match of one regex saw one row out of two
    expect(rows.map((r) => r.handler)).to.deep.equal(["ZCL_PARENT", "ZCL_OSD_STATUS_HTTP"]);
    expect(rows.map((r) => r.order)).to.deep.equal(["01", "02"]);
    expect(rows.every((r) => r.icftyp === "A")).to.equal(true);
  });

  it("a *.sicf.xml is an ABAP node, and that follows from the file it is in", () => {
    const service = serviceOf(TYPED, "x");
    expect(service.handler, "the last of the chain answers").to.equal("ZCL_OSD_STATUS_HTTP");
    expect(service.type).to.equal("ABAP");
    // it is a SAP object, so it transports -- not because a flag says so
    expect(service.travels).to.equal(true);
  });

  it("a fixture with no ICFTYP is still a class, and does not claim to be measured", () => {
    // abapGit has written the field for every node this tree has seen; a
    // hand-written fixture may not. The only thing a *.sicf.xml can name is
    // a class, so that is the reading -- and `icftyp` stays undefined so
    // nobody can later report the assumption as a measurement.
    const service = serviceOf(SICF, "x");
    expect(service.type).to.equal("ABAP");
    expect(service.icftyp).to.equal(undefined);
  });

  it("a handler type we do not implement is refused out loud, not guessed at", () => {
    const odd = TYPED.replace("<ICFTYP>A</ICFTYP><ICFHANDLER>ZCL_OSD_STATUS_HTTP", "<ICFTYP>Q</ICFTYP><ICFHANDLER>ZCL_OSD_STATUS_HTTP");
    const service = serviceOf(odd, "x");
    expect(service.icftyp).to.equal("Q");
    expect(service.type, "the letter comes back; it is not renamed into ABAP").to.equal("Q");

    // and the mount refuses it rather than running the name as a class,
    // which would be a guess with a 500 at the end of it
    const dir = mkdtempSync(join(tmpdir(), "osd-icf-typ-"));
    mkdirSync(join(dir, "src"), {recursive: true});
    writeFileSync(join(dir, "src", "zq.sicf.xml"), odd);
    const said = [];
    const app = {all: () => { throw new Error("an unimplemented handler type must not be mounted"); }};
    const mounted = mountServices(app, () => {}, {root: dir, roots: ["src"], say: (m) => said.push(m)});
    expect(mounted).to.deep.equal([]);
    expect(said.join(" ")).to.contain("not mounted");
    rmSync(dir, {recursive: true, force: true});
  });

  // a node that carries no handler is a real thing — an alias, or a node that
  // only holds authentication for its children — and mounting it would put a
  // route on the listener that can only fail
  it("a node with no handler is not servable, and says so by having none", () => {
    const bare = serviceOf(`<asx:values><URL>/sap/bc/apc/sap/zo4d_demo/</URL></asx:values>`, "x");
    expect(bare.path).to.equal("/sap/bc/apc/sap/zo4d_demo");
    expect(bare.handler).to.equal(undefined);
  });

  // the websocket half. The SICF node beside an APC application has no
  // handler at all, which is why reading only SICF finds the route and never
  // the thing that answers on it
  it("a push channel takes its class from the APC application, not from SICF", () => {
    const channel = channelOf(SAPC, "x");
    expect(channel.path).to.equal("/sap/bc/apc/sap/zo4d_demo");
    expect(channel.handler).to.equal("ZCL_O4D_APC_HANDLER");
    expect(channel.stateful).to.equal(true);
  });

  it("this tree's own demo service is found where a client would look for it", () => {
    const found = services(process.cwd()).find((s) => s.path === "/sap/bc/zstg_icf_demo");
    expect(found, "the demo SICF node was not picked up").to.not.equal(undefined);
    expect(found.handler).to.equal("ZCL_STG_ICF_DEMO");
  });

  it("a longer path sorts first, so a parent cannot swallow its child", () => {
    const paths = services(process.cwd()).map((s) => s.path);
    const lengths = paths.map((p) => p.length);
    expect(lengths).to.deep.equal([...lengths].sort((a, b) => b - a));
  });

  // against a fixture rather than the tree. What is under local/ is imported,
  // gitignored, and different on every machine: a test that asserts over it
  // passes here and fails on a clean clone, which is a test that reports the
  // checkout rather than the code. The first version of this asserted no APC
  // application existed, and it was true until one was imported an hour later.
  it("an APC application is found wherever it was imported", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-icf-"));
    try {
      mkdirSync(join(dir, "local", "demo"), {recursive: true});
      writeFileSync(join(dir, "local", "demo", "zo4d_demo.sapc.xml"), SAPC);
      const found = channels(dir);
      expect(found).to.have.length(1);
      expect(found[0].handler).to.equal("ZCL_O4D_APC_HANDLER");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  // two copies of one node is not hypothetical: a narrowed import beside the
  // whole repository produced exactly that, and which of the two answered
  // came down to the order express matched in
  it("one route per path, however many nodes name it", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-icf-"));
    try {
      mkdirSync(join(dir, "local", "whole"), {recursive: true});
      mkdirSync(join(dir, "local", "narrow"), {recursive: true});
      writeFileSync(join(dir, "local", "whole", "a.sicf.xml"), SICF);
      writeFileSync(join(dir, "local", "narrow", "a.sicf.xml"), SICF);
      const found = services(dir).filter((s) => s.path === "/sap/bc/zo4d_demo");
      expect(found).to.have.length(1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
