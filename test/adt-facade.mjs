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

  before(async () => {
    server = startServer(true);
    // the handshake, once, the way a client opens a session
    const res = await fetch(ADT + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    context = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
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
      // not served yet, and so not promised: this is the gatekeeper rule,
      // and it is what keeps "which tools work" answerable
      expect(xml).to.not.contain('href="/sap/bc/adt/activation"');
      expect(xml).to.not.contain('href="/sap/bc/adt/checkruns"');
      expect(xml).to.not.contain('href="/sap/bc/adt/abapunit/testruns"');
      expect(xml).to.not.contain('href="/sap/bc/adt/repository/nodestructure"');
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
