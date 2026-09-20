import {expect} from "chai";
import {serviceOf, channelOf, handlerRows, mountServices, services, servicesFromRows, channels} from "../tools/osd-icf.mjs";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import express from "express";
import {serviceForPath} from "../tools/osd-icf-routing.mjs";

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

  it("XML handler selection follows ICFORDER rather than document position", () => {
    const reversedOrder = TYPED.replace("<ICFORDER>01</ICFORDER>", "<ICFORDER>03</ICFORDER>");
    expect(serviceOf(reversedOrder, "fixture").handler).to.equal("ZCL_PARENT");
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

  // **The registry as a system holds it, which is the truth at runtime.**
  // The objects on disk are a transport (docs/registry-drift.md): a node
  // edited from ABAP is a row and not a file, so a host that mounted from
  // the files would serve what the repository says and not what the system
  // says -- and the screen over the registry would be a picture of it.
  const ROWS = {
    ICFSERVICE: [
      {ICF_NAME: "ZORK", ICFPARGUID: "P", URL: "/sap/bc/zork/", ICFACTIVE: "X", ICF_DOCU: "Zork"},
      {ICF_NAME: "ZOFF", ICFPARGUID: "P", URL: "/sap/bc/off/", ICFACTIVE: " ", ICF_DOCU: "off"},
      {ICF_NAME: "ZDEEP", ICFPARGUID: "P", URL: "/sap/bc/zork/deep/", ICFACTIVE: "X", ICF_DOCU: "deeper"},
    ],
    ICFHANDLER: [
      {ICF_NAME: "ZORK", ICFPARGUID: "P", ICFORDER: "01", ICFTYP: "A", ICFHANDLER: "ZCL_INHERITED"},
      {ICF_NAME: "ZORK", ICFPARGUID: "P", ICFORDER: "02", ICFTYP: "A", ICFHANDLER: "ZCL_ZORK_HTTP_HANDLER"},
      {ICF_NAME: "ZOFF", ICFPARGUID: "P", ICFORDER: "01", ICFTYP: "A", ICFHANDLER: "ZCL_OFF"},
      {ICF_NAME: "ZDEEP", ICFPARGUID: "P", ICFORDER: "01", ICFTYP: "A", ICFHANDLER: "ZCL_DEEP"},
    ],
  };

  it("an inactive node remains a routing barrier", () => {
    const found = servicesFromRows(ROWS);
    expect(found.find((s) => s.path === "/sap/bc/off").active).to.equal(false);
    expect(found.map((s) => s.path)).to.include("/sap/bc/zork");
  });

  it("the last of the handler chain answers, and the earlier rows are inherited", () => {
    const zork = servicesFromRows({...ROWS, ICFHANDLER: [...ROWS.ICFHANDLER].reverse()})
      .find((s) => s.path === "/sap/bc/zork");
    expect(zork.handler).to.equal("ZCL_ZORK_HTTP_HANDLER");
    expect(zork.type, "ICFTYP A is an ABAP class").to.equal("ABAP");
  });

  for (const disabled of ["ZORK", "ZDEEP"]) {
    it(`HTTP and preview block an inactive ${disabled} subtree while siblings still answer`, async () => {
      const rows = {...ROWS, ICFSERVICE: ROWS.ICFSERVICE.map((s) => ({...s,
        ICFACTIVE: s.ICF_NAME === disabled ? " " : "X"}))};
      const from = servicesFromRows(rows);
      const app = express();
      const called = [];
      mountServices(app, async ({res, class: handler}) => {
        called.push(handler);
        res.send(handler);
      }, {from});
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (const path of ["/sap/bc/zork/deep", "/sap/bc/zork/deep/page.html"]) {
          expect((await fetch(origin + path)).status).to.equal(404);
          expect(serviceForPath(from, path), "browser selection agrees").to.equal(undefined);
        }
        expect(called).to.deep.equal([]);
        const sibling = disabled === "ZORK" ? "/sap/bc/off/" : "/sap/bc/zork/other/";
        expect((await fetch(origin + sibling)).status).to.equal(200);
        expect(serviceForPath(from, sibling).handler).to.equal(called[0]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  }

  it("a handlerless active child inherits, but a handlerless inactive child blocks", () => {
    const rows = {...ROWS, ICFHANDLER: ROWS.ICFHANDLER.filter((h) => h.ICF_NAME !== "ZDEEP")};
    expect(serviceForPath(servicesFromRows(rows), "/sap/bc/zork/deep/page").handler)
      .to.equal("ZCL_ZORK_HTTP_HANDLER");
    rows.ICFSERVICE = ROWS.ICFSERVICE.map((s) => s.ICF_NAME === "ZDEEP" ? {...s, ICFACTIVE: " "} : s);
    expect(serviceForPath(servicesFromRows(rows), "/sap/bc/zork/deep/page")).to.equal(undefined);
    expect(serviceForPath(servicesFromRows(rows), "/sap/bc/zork/deeper/page").handler)
      .to.equal("ZCL_ZORK_HTTP_HANDLER");
  });

  it("a child sorts before its parent, so a parent cannot swallow it", () => {
    // the same rule `routes()` applies to the files, for the same reason,
    // and it has to hold on whichever of the two a host mounts from
    const paths = servicesFromRows(ROWS).map((s) => s.path);
    expect(paths.indexOf("/sap/bc/zork/deep")).to.be.lessThan(paths.indexOf("/sap/bc/zork"));
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
