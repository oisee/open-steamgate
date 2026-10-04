import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {activationFailureDocument, ADT_TYPE, uriOf} from "../tools/adt-documents.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {activeFixture} from "./helpers/source-snapshot.mjs";

const SUCCESS = '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>';
const FAILURE = '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/><msg objDescr="" type="W" line="0" href=""><shortText><txt>Activation was cancelled.</txt><txt>"Editing canceled" (EU 202)</txt></shortText></msg>';
const MISSING_METHOD = '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionParameterNotFound"/><message lang="EN">Parameter method could not be found.</message><localizedMessage lang="EN">Parameter method could not be found.</localizedMessage><properties><entry key="T100KEY-ID">SADT_RESOURCE</entry><entry key="T100KEY-NO">017</entry><entry key="T100KEY-V1">method</entry></properties></exc:exception>';
const SOURCE = "REPORT zwire.\n\nWRITE 'active'.\n";

describe("ADT activation: A4H wire bytes", function () {
  this.timeout(120000);
  let root, store, server, base, headers;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "adt-wire-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", libs: []}));
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({global: {files: "/src/**/*.*"}, syntax: {version: "v702"}, rules: {check_syntax: true}}));
    writeFileSync(join(root, "src", "zwire.prog.abap"), SOURCE);
    activeFixture(root);
    store = new ObjectStore({root, libs: []});
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store, watch: false, transpileOnActivate: false, abap: await adtAbap()}).router);
    server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    base = `http://localhost:${server.address().port}/sap/bc/adt`;
    const hello = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    headers = {"content-type": "application/xml", accept: "application/xml", "x-csrf-token": hello.headers.get("x-csrf-token"),
      cookie: hello.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")};
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });
  const activate = async (query = "method=activate&preauditRequested=true", body) => {
    const res = await fetch(base + "/activation" + (query === null ? "" : "?" + query), {method: "POST", headers,
      body: body ?? '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zwire"/></adtcore:objectReferences>'});
    return {status: res.status, contentType: res.headers.get("content-type"), body: await res.text()};
  };

  it("success is exactly the observed XML bytes and content type", async () => {
    store.write("PROG", "ZWIRE", SOURCE);
    expect(await activate()).to.deep.equal({status: 200, contentType: "application/xml; charset=utf-8", body: SUCCESS});
  });

  it("a syntax error at line 3 has properties, cancellation, and an unqualified diagnostic", async () => {
    store.write("PROG", "ZWIRE", "REPORT zwire.\n\nTHIS is invalid.\n");
    const checked = store.check("PROG", "ZWIRE").issues;
    expect(checked).to.have.length(1);
    expect(checked[0].line).to.equal(3);
    const expected = FAILURE + `<msg objDescr="Program ZWIRE" type="E" line="1" href="/sap/bc/adt/programs/programs/zwire/source/main#start=3,${checked[0].column}" forceSupported="true"><shortText><txt>${checked[0].message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}</txt></shortText></msg></chkl:messages>`;
    expect(await activate()).to.deep.equal({status: 200, contentType: "application/xml; charset=utf-8", body: expected});
    expect(await activate("method=activate&preauditRequested=false")).to.deep.equal(await activate());
  });

  it("preauditRequested false and true give identical success bytes", async () => {
    store.write("PROG", "ZWIRE", SOURCE);
    expect(await activate("method=activate&preauditRequested=false")).to.deep.equal(await activate());
  });

  it("other present methods, including empty, do no work and return 200 without content type", async () => {
    store.write("PROG", "ZWIRE", SOURCE);
    await activate();
    store.write("PROG", "ZWIRE", SOURCE.replace("active", "saved"));
    const original = store.activate;
    let calls = 0;
    store.activate = function (...args) { calls++; return original.apply(this, args); };
    try {
      for (const query of ["method=unknown", "method=ACTIVATE", "method=", "method=activate&method=unknown"]) {
        expect(await activate(query)).to.deep.equal({status: 200, contentType: null, body: ""});
        expect(store.inactiveSources().find(o => o.key === "PROG ZWIRE").files[0].before).to.equal(SOURCE);
        expect(store.stateOf(store.find("PROG", "ZWIRE")).version).to.equal("inactive");
      }
      expect(await activate("method=unknown", "malformed")).to.deep.equal({status: 200, contentType: null, body: ""});
      expect(calls).to.equal(0);
    } finally { store.activate = original; }
  });

  for (const query of ["preauditRequested=true", null]) {
    it(`missing method ${query === null ? "with no query" : "with another parameter"} returns exact 400 bytes without activation`, async () => {
      store.write("PROG", "ZWIRE", SOURCE);
      await activate();
      store.write("PROG", "ZWIRE", SOURCE.replace("active", "saved"));
      const before = store.inactiveSources();
      expect(await activate(query)).to.deep.equal({status: 400, contentType: "application/xml; charset=utf-8", body: MISSING_METHOD});
      expect(store.inactiveSources()).to.deep.equal(before);
      expect(store.inactiveSources().find(o => o.key === "PROG ZWIRE").files[0].before).to.equal(SOURCE);
      expect(store.stateOf(store.find("PROG", "ZWIRE")).version).to.equal("inactive");
    });
  }

  it("every ADT object type uses the same checklist; class include hrefs keep their source position", () => {
    for (const type of Object.keys(ADT_TYPE)) {
      const description = type === "PROG" ? "Program ZWIRE" : type === "CLAS" ? "Class ZWIRE" : "ZWIRE";
      expect(activationFailureDocument([{type, name: "ZWIRE", issues: [{message: "bad < &", line: 3, column: 0}]}]))
        .to.equal(FAILURE + `<msg objDescr="${description}" type="E" line="1" href="${uriOf(type, "ZWIRE") ?? ""}/source/main#start=3,0" forceSupported="true"><shortText><txt>bad &lt; &amp;</txt></shortText></msg></chkl:messages>`);
    }
    expect(activationFailureDocument([{type: "CLAS", name: "ZWIRE", issues: [{message: "bad", file: "/src/zwire.clas.testclasses.abap", line: 3, column: 0}]}]))
      .to.equal(FAILURE + '<msg objDescr="Class ZWIRE" type="E" line="1" href="/sap/bc/adt/oo/classes/zwire/includes/testclasses/source/main#start=3,0" forceSupported="true"><shortText><txt>bad</txt></shortText></msg></chkl:messages>');
  });
});
