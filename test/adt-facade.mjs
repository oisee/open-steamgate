import {expect} from "chai";
import {existsSync} from "node:fs";
import {startServer} from "./start.mjs";

// The façade against the real server, the way a client meets it: the same
// listener that serves OData also serves /sap/bc/adt/**, which is the whole
// point of the address.
const PORT = process.env.STG_PORT ?? 3030;
const ADT = `http://localhost:${PORT}/sap/bc/adt`;
const BASE_URL = `http://localhost:${PORT}`;

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

  // What an ABAP Cloud Project needs beyond the classic surface, written
  // against what A4H actually did behind a TLS terminator on 2026-09-14 —
  // the wizard opened, the tree filled, sources read and ABAP Unit ran.
  describe("the cloud flavour", () => {
    it("issues a reentrance ticket by sending the browser back to the client's own listener", async () => {
      const back = "http://localhost:62223/adt/redirect";
      const res = await fetch(
        `${ADT}/core/http/reentranceticket?redirect-url=${encodeURIComponent(back)}&_=12345`,
        {redirect: "manual"},
      );
      expect(res.status).to.equal(307);

      const to = new URL(res.headers.get("location"));
      expect(to.origin + to.pathname).to.equal(back);
      // the nonce comes back as it was sent: the client matches on it
      expect(to.searchParams.get("_")).to.equal("12345");
      expect(to.searchParams.get("reentrance-ticket")).to.be.a("string").with.length.greaterThan(16);

      // and the cookie is the part that actually carries the session
      // afterwards — Eclipse sent no Authorization header on any request
      const cookies = (res.headers.getSetCookie?.() ?? []).join("; ");
      expect(cookies).to.match(/SAP_SESSIONID_/);
      expect(cookies).to.match(/sap-usercontext=/);
    });

    // An open redirect that mints a credential on the way out would be worth
    // having by accident exactly once. Eclipse's listener is always loopback.
    it("refuses to bounce a browser anywhere but loopback", async () => {
      for (const target of ["https://example.invalid/adt/redirect", "http://192.0.2.1/adt/redirect"]) {
        const res = await fetch(
          `${ADT}/core/http/reentranceticket?redirect-url=${encodeURIComponent(target)}`,
          {redirect: "manual"},
        );
        expect(res.status, target).to.equal(400);
      }
    });

    it("answers the session poll with the links the client watches", async () => {
      const res = await call("/core/http/sessions");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.match(/adt\.core\.http\.session\.v3\+xml/);

      const body = await res.text();
      expect(body).to.match(/categories\/core\/http\/sessions\/securitysession/);
      expect(body).to.match(/categories\/core\/http\/sessions\/logoff/);
      expect(body).to.match(/categories\/core\/http\/system\/systeminformation/);
      expect(body).to.match(/inactivityTimeout/);
    });

    // The client polls this. A session identifier that changed per request
    // would read as the session ending over and over.
    it("names the same security session on every poll", async () => {
      const [first, second] = await Promise.all([call("/core/http/sessions"), call("/core/http/sessions")]);
      const idOf = async (res) => /sessions\/([0-9A-F]+)"/.exec(await res.text())?.[1];
      expect(await idOf(first)).to.equal(await idOf(second));
    });

    it("says who and what it is, which is what the window title shows", async () => {
      const res = await call("/core/http/systeminformation");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.match(/systeminformation\.v1\+json/);

      const info = await res.json();
      expect(info).to.include.keys("systemID", "userName", "userFullName", "client", "language");
      expect(info.systemID).to.be.a("string").with.length(3);
    });

    // A quarter of a working session's traffic, on a timer, and every one of
    // them empty because nothing had gone wrong. 404 here makes a client
    // report an error where the real answer is "nothing to report".
    it("answers the polled feeds with an empty feed, which is the true answer", async () => {
      for (const path of ["/runtime/dumps", "/runtime/systemmessages", "/gw/errorlog"]) {
        const res = await call(path);
        expect(res.status, path).to.equal(200);
        expect(res.headers.get("content-type"), path).to.match(/atom\+xml/);
        const body = await res.text();
        expect(body, path).to.match(/<atom:feed/);
        expect(body, path).to.not.match(/<atom:entry/);
      }
    });

    // The whole contract, measured: 200 and no body, to all three methods.
    it("answers the debugger poll with nothing, to every method it uses", async () => {
      for (const method of ["GET", "POST", "DELETE"]) {
        const res = await call("/debugger/listeners?debuggingMode=user", {method});
        expect(res.status, method).to.equal(200);
        expect(await res.text(), method).to.equal("");
      }
    });

    // Without this the client stops at "Pre-loading workbench object types"
    // and opens nothing at all.
    it("lists the object types it actually serves, and no others", async () => {
      const res = await call("/repository/typestructure", {method: "POST"});
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.match(/vnd\.sap\.as\+xml/);

      const body = await res.text();
      expect(body).to.match(/<asx:abap/);
      expect(body).to.match(/<OBJECT_TYPE>CLAS\/OC<\/OBJECT_TYPE>/);
      expect(body).to.match(/<OBJECT_TYPE>DEVC\/K<\/OBJECT_TYPE>/);

      // a list naming a type this façade does not serve is a 404 waiting for
      // the first click
      for (const [, template] of body.matchAll(/<URI_TEMPLATE>([^<]+)<\/URI_TEMPLATE>/g)) {
        expect(template, "URI template").to.match(/^\/sap\/bc\/adt\/[a-z]/);
      }
    });

    // A4H answers 404 here and the wizard carries on, so the façade needs no
    // route at all — this pins that the absence is deliberate.
    it("leaves /sap/public/bc/icf/virtualhost unanswered, as the real one does", async () => {
      const res = await fetch(BASE_URL + "/sap/public/bc/icf/virtualhost");
      expect(res.status).to.equal(404);
    });
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

    // This test used to assert the graph was empty, on the reasoning that a
    // compatibility graph grants a client the use of features and OSD had
    // measured none, so claiming nothing was the honest answer. The reasoning
    // was careful and the conclusion was wrong: an empty graph does not read
    // as "no opinion", it reads as "supports nothing", and a client acts on
    // it. This one deleted its content handler for object references, decided
    // activation was unsupported, and stopped filling in package contents —
    // three failures that looked unrelated and were one document.
    //
    // So the graph names the features this façade serves, and the test now
    // guards the property that matters: every feature declared must be one
    // there is a resource for. Claiming a feature invites its use, and a
    // claim that breaks on the first click is worse than a missing one.
    it("declares the features it serves, under the element a client looks for", async () => {
      const xml = await (await call("/compatibility/graph")).text();
      expect(xml, "the local name is not arbitrary").to.contain("<compatibility:graph");
      expect(xml).to.match(/<node nameSpace="COM\.SAP\.ADT\.RIS" name="search"\/>/);
      expect(xml).to.match(/<node nameSpace="COM\.SAP\.ADT\.ACTIVATION" name="activate"\/>/);

      // nothing is declared that this façade cannot answer for
      const declared = [...xml.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
      for (const promised of ["classes", "programs", "checkruns", "abapunit", "search"]) {
        expect(declared, promised).to.include(promised);
      }
      expect(declared, "a feature with no resource behind it").to.not.include("codeCompletion");
    });

    // Declaring the flags was not enough on its own, and this is why.
    //
    // An obligatory edge says a feature is incomplete without its partner, so
    // a client reading one whose obligations are missing treats the feature as
    // unusable — which was "Outdated content handler ... was deleted" and
    // "Activation is not supported on this project", both at once. Every
    // obligation must therefore be met by something also declared, or the
    // declaration is worse than silence.
    it("meets every obligation it declares", async () => {
      const xml = await (await call("/compatibility/graph")).text();
      const nodes = new Set([...xml.matchAll(/<node nameSpace="([^"]+)" name="([^"]+)"\/>/g)]
        .map((m) => `${m[1]}/${m[2]}`));
      const edges = [...xml.matchAll(
        /<edge isObligatory="([^"]+)"><sourceNode nameSpace="([^"]+)" name="([^"]+)"\/><targetNode nameSpace="([^"]+)" name="([^"]+)"\/><\/edge>/g)];

      expect(edges.length, "a graph with no edges declares nothing about its features").to.be.greaterThan(0);
      for (const [, obligatory, sourceSpace, source, targetSpace, target] of edges) {
        expect(nodes, `edge from ${source}`).to.include(`${sourceSpace}/${source}`);
        expect(nodes, `${obligatory === "true" ? "obligation" : "edge"} to ${target}`)
          .to.include(`${targetSpace}/${target}`);
      }
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
      expect(xml).to.contain('href="/sap/bc/adt/cts/transportchecks"');
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

    // This used to assert that a class answers at its own address with an
    // object structure, written when a class would not open in VS Code
    // because the path met the catch-all. Routing it was the fix; the
    // document was the part that was guessed.
    //
    // Both halves of that guess are now disproved. VS Code, handed the
    // structure, refuses with "Operation not supported for object CLAS/OC" —
    // it recognises the type and wants a class document. And A4H, asked with
    // Accept: */* and with the versioned class type, answers class:abapClass
    // to both, so there is nothing to negotiate.
    it("an object answers at its own address, which is how a class opens", async () => {
      const res = await call("/oo/classes/ZCL_STG_DISPATCHER");
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.match(/oo\.classes\.v4\+xml/);

      const xml = await res.text();
      expect(xml).to.contain("<class:abapClass");
      // the link a client follows to the source, which is the point of asking
      expect(xml).to.match(/rel="http:\/\/www\.sap\.com\/adt\/relations\/source"/);
    });

    // A class at its own address and its structure under /objectstructure are
    // two documents for two questions. They used to be the same one.
    it("the structure keeps its own address, and is not the class document", async () => {
      const object = await (await call("/oo/classes/ZCL_STG_DISPATCHER")).text();
      const structure = await (await call("/oo/classes/ZCL_STG_DISPATCHER/objectstructure")).text();
      expect(object).to.contain("<class:abapClass");
      expect(structure).to.contain("objectStructureElement");
      expect(object).to.not.equal(structure);
    });

    // The same document whichever way it is asked for, because that is what
    // the real system does and a client should not have to know which.
    it("answers a class as a class however the question is phrased", async () => {
      const res = await call("/oo/classes/ZCL_STG_DISPATCHER", {
        headers: {Accept: "*/*"},
      });
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.match(/oo\.classes\.v4\+xml/);

      const xml = await res.text();
      expect(xml).to.contain("<class:abapClass");
      expect(xml, "the editor follows this to the source").to.match(/rel="http:\/\/www\.sap\.com\/adt\/relations\/source"/);
      // the fields a client reads without checking whether they are there
      for (const attribute of ["adtcore:name", "adtcore:changedAt", "adtcore:version", "adtcore:responsible"]) {
        expect(xml, attribute).to.contain(attribute + "=");
      }
    });

    it("an object that is not there is a 404 at its own address too", async () => {
      expect((await call("/oo/classes/ZCL_NOPE_NOT_HERE")).status).to.equal(404);
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

    // $TMP is the local package of every ABAP system, so a client asks for
    // it by name without ever having been told it is there. The store has
    // none, because our packages are folders; the façade answers the
    // protocol's guarantee rather than letting a client meet a 404 for the
    // first node it opens.
    it("the local package resolves, because every client assumes it exists", async () => {
      const res = await call("/packages/%24TMP");
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("$TMP");
    });

    it("the local package expands, and is empty rather than invented", async () => {
      const res = await fetch(ADT + "/repository/nodestructure?parent_type=DEVC%2FK&parent_name=%24TMP", {
        method: "POST",
        headers: {"x-csrf-token": token, cookie: `sap-contextid=${context}`},
      });
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.not.contain("<OBJECT_NAME>ZCL");
    });

    // the simulation is one name and one failure: anything else the store
    // says is missing stays missing, or the façade would be inventing a tree
    it("a package that is genuinely absent is still a 404", async () => {
      expect((await call("/packages/%24NOPE_NOT_HERE")).status).to.equal(404);
    });

    // the instrument that decides what the next wave is. It used to see only
    // paths nothing was mounted on, so a client failing on every node it
    // opened left it empty and the empty list read as a clean bill of health
    it("a missing object is recorded, not only a missing resource", async () => {
      await call("/packages/%24NOPE_NOT_HERE");
      const missed = await (await fetch(`http://localhost:${PORT}/osd/not-served`)).json();
      const object = missed.find((m) => m.path.endsWith("NOPE_NOT_HERE"));
      expect(object, "the object miss was not recorded").to.not.equal(undefined);
      expect(object.kind).to.equal("object");
      expect(object.detail).to.contain("does not exist");
    });

    it("a resource nothing is mounted on is recorded as the other kind", async () => {
      await call("/atc/worklists");
      const missed = await (await fetch(`http://localhost:${PORT}/osd/not-served`)).json();
      expect(missed.find((m) => m.path.endsWith("/atc/worklists"))?.kind).to.equal("resource");
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

    // adt-fs asks this before it writes, and a 404 here is a write that never
    // happens. The answer is "no transport, and none needed", which is true
    // rather than convenient: every package in this tree is local, and the
    // boundary to a real system is an abapGit archive, not a transport.
    it("a transport check answers that nothing has to be recorded", async () => {
      const res = await fetch(ADT + "/cts/transportchecks", {
        method: "POST",
        headers: {
          "x-csrf-token": token,
          cookie: `sap-contextid=${context}`,
          "content-type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData",
        },
        body: `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><URI>/sap/bc/adt/oo/classes/zcl_stg_dispatcher</URI><DEVCLASS></DEVCLASS><OPERATION>I</OPERATION></DATA></asx:values></asx:abap>`,
      });
      expect(res.status).to.equal(200);
      const xml = await res.text();
      // the pair that tells a client not to prompt for one
      expect(xml).to.contain("<RECORDING></RECORDING>");
      expect(xml).to.contain("<REQUESTS/>");
      // a message of severity E, A or X makes the client throw, so there are none
      expect(xml).to.contain("<MESSAGES/>");
      // and it knows which object it answered about
      expect(xml).to.contain("<OBJECTNAME>ZCL_STG_DISPATCHER</OBJECTNAME>");
      expect(xml).to.contain("<DEVCLASS>$STG_GATEWAY</DEVCLASS>");
    });

    it("transport checks are advertised now that they answer", async () => {
      expect(await (await call("/discovery")).text()).to.contain("cts/transportchecks");
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
