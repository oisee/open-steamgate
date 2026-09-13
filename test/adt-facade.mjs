import {expect} from "chai";
import {existsSync} from "node:fs";
import {startServer} from "./start.mjs";

// The façade against the real server, the way a client meets it: the same
// listener that serves OData also serves /sap/bc/adt/**, which is the whole
// point of the address.
const PORT = process.env.STG_PORT ?? 3030;
const ADT = `http://localhost:${PORT}/sap/bc/adt`;

describe("tools/adt-facade: OSD answers ADT", () => {
  let server;
  let token;
  let context;

  before(async function () {
    // parsing the system is seconds over a big one, and every structure read
    // shares the one parse. Paying it here keeps it out of whichever test
    // happens to be first, where it would look like that test being slow.
    this.timeout(120000);
    server = startServer(true);
    // the handshake, once, the way a client opens a session
    const res = await fetch(ADT + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    context = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
    await fetch(ADT + "/oo/classes/ZCL_STG_DISPATCHER/objectstructure", {headers: {cookie: `sap-contextid=${context}`}});
  });

  after(() => server.close());

  const call = (path, options = {}) => fetch(ADT + path, {
    ...options,
    headers: {cookie: `sap-contextid=${context}`, "x-csrf-token": token, ...(options.headers ?? {})},
  });

  describe("wave 0: the handshake", () => {
    it("HEAD on core/discovery works, because a client tries it before GET", async () => {
      const res = await fetch(ADT + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      expect(res.status).to.equal(200);
      expect(res.headers.get("x-csrf-token")).to.be.a("string").with.length.greaterThan(8);
    });

    it("the discovery document is an Atom service document", async () => {
      const res = await call("/core/discovery");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("atomsvc+xml");
      const xml = await res.text();
      expect(xml).to.contain("<app:service");
      expect(xml).to.contain("<app:workspace>");
    });

    // abap-adt-api's login() calls this one resource and reads three things
    // off it: the status, the token header, and the cookies. The body it
    // never opens. So these are the assertions that decide whether a real
    // VS Code client can log on, and they are deliberately the client's
    // three and not a shape we find pleasing.
    it("the logon probe answers, which is what lets an IDE log on at all", async () => {
      const res = await fetch(ADT + "/compatibility/graph?sap-client=001&sap-language=EN", {
        headers: {"x-csrf-token": "fetch", authorization: "Basic " + Buffer.from("DEVELOPER:secret").toString("base64")},
      });
      expect(res.status).to.equal(200);
      expect(res.headers.get("x-csrf-token")).to.be.a("string").with.length.greaterThan(8);
      expect((res.headers.getSetCookie?.() ?? []).join("; ")).to.contain("sap-contextid=");
    });

    it("HEAD on the logon probe works too, since a token is fetched with it", async () => {
      const res = await fetch(ADT + "/compatibility/graph", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      expect(res.status).to.equal(200);
      expect(res.headers.get("x-csrf-token")).to.be.a("string").with.length.greaterThan(8);
    });

    // the graph is empty on purpose: a compatibility graph is a system
    // granting a client use of resources at versions, and OSD has measured
    // no such thing. Well formed, and claiming nothing.
    it("the compatibility graph is well formed and grants nothing", async () => {
      const xml = await (await call("/compatibility/graph")).text();
      expect(xml).to.contain("<adtcomp:graph");
      expect(xml).to.not.contain("<adtcomp:resource");
    });

    it("it answers at both of its names, because a client uses both", async () => {
      const core = await call("/core/discovery");
      const plain = await call("/discovery");
      expect(plain.status).to.equal(200);
      expect(await plain.text()).to.equal(await core.text());
    });

    it("discovery advertises what is mounted and nothing else", async () => {
      const xml = await (await call("/discovery")).text();
      // served today
      expect(xml).to.contain('href="/sap/bc/adt/oo/classes"');
      expect(xml).to.contain('href="/sap/bc/adt/oo/interfaces"');
      expect(xml).to.contain('href="/sap/bc/adt/programs/programs"');
      expect(xml).to.contain('href="/sap/bc/adt/datapreview/freestyle"');
      expect(xml).to.contain('href="/sap/bc/adt/activation"');
      expect(xml).to.contain('href="/sap/bc/adt/checkruns"');
      expect(xml).to.contain('href="/sap/bc/adt/abapunit/testruns"');
      // not served yet, and so not promised: this is the gatekeeper rule, and
      // it is what keeps "which tools work" answerable by asking the server
      expect(xml).to.not.contain('href="/sap/bc/adt/atc"');
      expect(xml).to.not.contain('href="/sap/bc/adt/debugger"');
    });

    it("a client scanning for hrefs finds every collection with its full path", async () => {
      const xml = await (await call("/discovery")).text();
      for (const href of [...xml.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
        expect(href).to.match(/^\/sap\/bc\/adt\//);
      }
    });
  });

  describe("the thin slice: one source, one table", () => {
    it("reads the source of a class", async () => {
      const res = await call("/oo/classes/ZCL_STG_DISPATCHER/source/main");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("text/plain");
      const source = await res.text();
      expect(source).to.contain("CLASS zcl_stg_dispatcher DEFINITION");
    });

    it("reads the source of an interface", async () => {
      const res = await call("/oo/interfaces/ZIF_STG_CDS_SOURCE/source/main");
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("INTERFACE zif_stg_cds_source");
    });

    it("reads a class's test include, which ADT calls an include", async () => {
      const res = await call("/oo/classes/ZCL_STG_SEGW_TEST/includes/testclasses/source/main");
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("CLASS ltcl");
    });

    it("a namespaced name arrives URL-encoded and still resolves", async () => {
      // the library clones carry /IWBEP/-namespaced objects; skip where they
      // are not cloned rather than fail for a reason that is not ours
      const probe = await call("/oo/classes/" + encodeURIComponent("/IWBEP/CL_MGW_ABS_DATA") + "/source/main");
      if (probe.status === 404) {
        return;
      }
      expect(probe.status).to.equal(200);
      expect((await probe.text()).toLowerCase()).to.contain("class /iwbep/cl_mgw_abs_data");
    });

    it("an object that is not there is a 404, not a 500", async () => {
      const res = await call("/oo/classes/ZCL_NOT_A_THING/source/main");
      expect(res.status).to.equal(404);
    });

    it("reads table contents through freestyle SQL", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=3", {
        method: "POST",
        body: "SELECT travel_id, description FROM zstg_demo",
      });
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<dataPreview:tableData");
      expect(xml).to.contain('dataPreview:name="TRAVEL_ID"');
      expect(xml).to.contain("<dataPreview:data>T0001</dataPreview:data>");
      expect(xml).to.contain("<dataPreview:totalRows>3</dataPreview:totalRows>");
    });

    it("the row limit is the client's, and it is applied", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=1", {method: "POST", body: "SELECT * FROM zstg_demo"});
      expect(await res.text()).to.contain("<dataPreview:totalRows>1</dataPreview:totalRows>");
    });

    it("the cross-reference tables answer the query the client's graph layer makes", async () => {
      const res = await call("/datapreview/freestyle", {
        method: "POST",
        body: "SELECT include, name FROM wbcrossgt WHERE name LIKE 'CL_ABAP_Z%'",
      });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("<dataPreview:tableData");
      // the rows themselves are derived rather than authored, so they are
      // there only where the generator has run (npm run osd:xref -- --write)
      if (existsSync("data/wbcrossgt.tabu.json")) {
        const again = await call("/datapreview/freestyle", {
          method: "POST",
          body: "SELECT include, name FROM wbcrossgt WHERE name LIKE 'CL_ABAP_Z%'",
        });
        expect(await again.text()).to.contain("CL_ABAP_ZIP");
      }
    });

    it("a statement that is not a SELECT is refused, and is not a 403", async () => {
      const res = await call("/datapreview/freestyle", {method: "POST", body: "DROP TABLE zstg_demo"});
      expect(res.status).to.equal(400);
      expect(await res.text()).to.contain("only SELECT");
    });
  });

  describe("wave 1: the shapes the round trip asked for", () => {
    it("the object structure of a class lists its methods with their visibility", async () => {
      const res = await call("/oo/classes/ZCL_STG_DISPATCHER/objectstructure");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("objectstructure.v2+xml");
      const xml = await res.text();
      expect(xml).to.contain('adtcore:name="ZCL_STG_DISPATCHER"');
      expect(xml).to.contain('adtcore:type="CLAS/OC"');
      expect(xml).to.contain('adtcore:name="DISPATCH"');
      expect(xml).to.contain('adtcore:type="CLAS/OM"');
      // dispatch is public, origin is private: the difference is the reason a
      // client reads this document at all
      expect(xml).to.match(/adtcore:name="DISPATCH"[^>]*abapsource:visibility="public"/);
      expect(xml).to.match(/adtcore:name="ORIGIN"[^>]*abapsource:visibility="private"/);
    });

    it("a method carries the source position a client asks for it by", async () => {
      const xml = await (await call("/oo/classes/ZCL_STG_DISPATCHER/objectstructure")).text();
      expect(xml).to.match(/abapsource:sourceUri="source\/main#start=\d+,\d+;end=\d+,\d+"/);
    });

    it("a method carries the whole range of its body, both ends", async () => {
      // a client slices one method out of the main source between the two
      // ends of this range. Half a range is no range: without the end it
      // reads nothing, which is what "no implementation" meant.
      const xml = await (await call("/oo/classes/ZCL_STG_SEGW_REPO/objectstructure")).text();
      const at = xml.match(/adtcore:name="FILES"[^>]*source\/main#start=(\d+),\d+;end=(\d+),\d+/);
      expect(at, "FILES carries a start and an end").to.not.equal(null);
      const source = (await (await call("/oo/classes/ZCL_STG_SEGW_REPO/source/main")).text()).split("\n");
      expect(source[Number(at[1]) - 1].toUpperCase()).to.contain("METHOD FILES");
      expect(source[Number(at[2]) - 1].toUpperCase()).to.contain("ENDMETHOD");
      expect(Number(at[2])).to.be.greaterThan(Number(at[1]));
    });

    it("every method of a class carries a range, not only the first", async () => {
      const xml = await (await call("/oo/classes/ZCL_STG_SEGW_REPO/objectstructure")).text();
      const methods = [...xml.matchAll(/adtcore:type="CLAS\/OM"[^>]*sourceUri="([^"]+)"/g)].map((m) => m[1]);
      expect(methods.length).to.be.greaterThan(3);
      for (const uri of methods) {
        expect(uri, uri).to.match(/#start=\d+,\d+;end=\d+,\d+$/);
      }
    });

    it("the range a client reads is a link inside the method, not an attribute on it", async () => {
      // an attribute is where we put it first and nobody reads it there; a
      // client walks the element's links and picks the one by its relation
      const xml = await (await call("/oo/classes/ZCL_STG_SEGW_REPO/objectstructure")).text();
      const element = xml.match(/<abapsource:objectStructureElement adtcore:name="FILES"[\s\S]*?<\/abapsource:objectStructureElement>/);
      expect(element, "FILES is an element with children").to.not.equal(null);
      expect(element[0]).to.contain('rel="http://www.sap.com/adt/relations/source/implementationBlock"');
      expect(element[0]).to.contain('rel="http://www.sap.com/adt/relations/source/definitionBlock"');
      const body = element[0].match(/implementationBlock" href="source\/main#start=(\d+),\d+;end=(\d+),\d+"/);
      expect(body, "the implementation link carries a range").to.not.equal(null);
      const source = (await (await call("/oo/classes/ZCL_STG_SEGW_REPO/source/main")).text()).split("\n");
      expect(source[Number(body[1]) - 1].toUpperCase()).to.contain("METHOD FILES");
      expect(source[Number(body[2]) - 1].toUpperCase()).to.contain("ENDMETHOD");
    });

    it("the declaration link points at the whole signature, not the name alone", async () => {
      const xml = await (await call("/oo/classes/ZCL_STG_SEGW_REPO/objectstructure")).text();
      const element = xml.match(/<abapsource:objectStructureElement adtcore:name="FILES"[\s\S]*?<\/abapsource:objectStructureElement>/)[0];
      const declaration = element.match(/definitionBlock" href="source\/main#start=(\d+),\d+;end=(\d+),\d+"/);
      expect(declaration).to.not.equal(null);
      const source = (await (await call("/oo/classes/ZCL_STG_SEGW_REPO/source/main")).text()).split("\n");
      expect(source[Number(declaration[1]) - 1].toUpperCase()).to.contain("METHODS FILES");
      // a declaration with parameters runs over several lines
      expect(Number(declaration[2])).to.be.greaterThan(Number(declaration[1]));
    });

    it("a class's other includes are elements of the structure too", async () => {
      const xml = await (await call("/oo/classes/ZCL_STG_SEGW_TEST/objectstructure")).text();
      expect(xml).to.contain('adtcore:name="TESTCLASSES"');
      expect(xml).to.contain('abapsource:sourceUri="includes/testclasses/source/main"');
    });

    it("the object structure of an interface answers too", async () => {
      const res = await call("/oo/interfaces/ZIF_STG_CDS_SOURCE/objectstructure");
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain('adtcore:type="INTF/OI"');
    });

    it("a structure asked of an object that is not there is a 404", async () => {
      expect((await call("/oo/classes/ZCL_NOT_A_THING/objectstructure")).status).to.equal(404);
    });

    it("search finds objects by name and points at where they live", async () => {
      const res = await call("/repository/informationsystem/search?operation=quickSearch&query=ZCL_STG_DISPATCHER&maxResults=10");
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<adtcore:objectReferences");
      expect(xml).to.contain('adtcore:name="ZCL_STG_DISPATCHER"');
      expect(xml).to.contain('adtcore:type="CLAS/OC"');
      expect(xml).to.contain('adtcore:uri="/sap/bc/adt/oo/classes/zcl_stg_dispatcher"');
    });

    it("a star in the pattern anchors the match, the way a client means it", async () => {
      const xml = await (await call("/repository/informationsystem/search?query=" + encodeURIComponent("ZCL_STG_SEGW*") + "&maxResults=50")).text();
      const names = [...xml.matchAll(/adtcore:name="([^"]+)"/g)].map((m) => m[1]);
      expect(names.length).to.be.greaterThan(0);
      for (const name of names) {
        expect(name).to.match(/^ZCL_STG_SEGW/);
      }
    });

    it("the result count is the client's to cap", async () => {
      const xml = await (await call("/repository/informationsystem/search?query=Z&maxResults=3")).text();
      expect([...xml.matchAll(/<adtcore:objectReference /g)].length).to.be.at.most(3);
    });

    it("the base resource of a class include answers, which is what a method read hits first", async () => {
      const res = await call("/oo/classes/ZCL_STG_SEGW_TEST/includes/testclasses");
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("abapClassInclude");
      expect(xml).to.contain('class:includeType="testclasses"');
      expect(xml).to.contain("includes/testclasses/source/main");
    });

    it("a client that asks the include for text gets the source itself", async () => {
      const res = await call("/oo/classes/ZCL_STG_SEGW_TEST/includes/testclasses", {headers: {accept: "text/plain"}});
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("text/plain");
      expect(await res.text()).to.contain("CLASS ltcl");
    });

    it("packages are findable by search, which is how a client discovers the tree to open", async () => {
      const res = await call("/repository/informationsystem/search?query=" + encodeURIComponent("$STG_SEGW*") + "&objectType=DEVC%2FK&maxResults=20");
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain('adtcore:type="DEVC/K"');
      expect(xml).to.contain('adtcore:name="$STG_SEGW"');
      expect(xml).to.contain('adtcore:uri="/sap/bc/adt/packages/');
    });

    it("a package says what it is and what is above it", async () => {
      const res = await call("/packages/$STG_GEN_SEGW");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.contain("packages.v1+xml");
      const xml = await res.text();
      expect(xml).to.contain('adtcore:name="$STG_GEN_SEGW"');
      expect(xml).to.contain('adtcore:type="DEVC/K"');
      expect(xml).to.contain('adtcore:name="$STG_GEN"');
    });

    it("a package that is not there is a 404 like any other missing object", async () => {
      expect((await call("/packages/$NOT_A_PACKAGE")).status).to.equal(404);
    });

    it("a subpackage appears once, not twice, though the store holds it both ways", async () => {
      const xml = await (await call("/repository/nodestructure?parent_name=" + encodeURIComponent("$STG_SEGW"), {method: "POST"})).text();
      const names = [...xml.matchAll(/<OBJECT_NAME>([^<]+)<\/OBJECT_NAME>/g)].map((m) => m[1]);
      expect(names).to.include("$STG_SEGW_DDIC");
      expect(names.filter((n) => n === "$STG_SEGW_DDIC")).to.have.length(1);
    });

    it("the node structure walks one level: subpackages and objects", async () => {
      const res = await call("/repository/nodestructure?parent_type=DEVC%2FK&parent_name=" + encodeURIComponent("$STG_GEN_SEGW"), {method: "POST"});
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<TREE_CONTENT>");
      expect(xml).to.contain("<OBJECT_TYPE>CLAS/OC</OBJECT_TYPE>");
      expect(xml).to.contain("<OBJECT_URI>/sap/bc/adt/oo/classes/");
    });

    it("a subpackage is expandable and an object is not, which is what a tree needs", async () => {
      const parent = await (await call("/repository/nodestructure?parent_name=" + encodeURIComponent("$STG_GEN"), {method: "POST"})).text();
      expect(parent).to.match(/<OBJECT_TYPE>DEVC\/K<\/OBJECT_TYPE>[\s\S]*?<EXPANDABLE>X<\/EXPANDABLE>/);
    });

    it("search is advertised now that it answers", async () => {
      const xml = await (await call("/discovery")).text();
      expect(xml).to.contain('href="/sap/bc/adt/repository/informationsystem/search"');
      expect(xml).to.contain('href="/sap/bc/adt/packages"');
      expect(xml).to.contain('href="/sap/bc/adt/repository/nodestructure"');
    });
  });

  describe("what the client infers from a shape", () => {
    it("a write without a token is the only 403 the façade gives", async () => {
      const res = await fetch(ADT + "/datapreview/freestyle", {method: "POST", body: "SELECT * FROM zstg_demo"});
      expect(res.status).to.equal(403);
      expect(res.headers.get("x-csrf-token")).to.equal("Required");
    });

    it("no answer is ever a redirect", async () => {
      for (const path of ["/core/discovery", "/discovery", "/oo/classes/ZCL_STG_DISPATCHER/source/main"]) {
        const res = await call(path, {redirect: "manual"});
        expect([301, 302, 303, 307, 308], path).to.not.include(res.status);
      }
    });

    it("every answer carries a token, which is how a client knows it is still logged on", async () => {
      for (const path of ["/core/discovery", "/oo/classes/ZCL_STG_DISPATCHER/source/main"]) {
        const res = await call(path);
        expect(res.headers.get("x-csrf-token"), path).to.be.a("string").with.length.greaterThan(8);
      }
    });

    it("the OData front is still on the same listener, which is why one address is enough", async () => {
      const res = await fetch(`http://localhost:${PORT}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
      expect(res.status).to.equal(200);
    });
  });
});
