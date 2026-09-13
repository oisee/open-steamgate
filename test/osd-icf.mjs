import {expect} from "chai";
import {serviceOf, channelOf, services, channels} from "../tools/osd-icf.mjs";

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

  it("no APC application in this tree yet, and the reader says so rather than guessing", () => {
    expect(channels(process.cwd())).to.deep.equal([]);
  });
});
