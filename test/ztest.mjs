import {expect} from "chai";
import express from "express";
import {adtRouter} from "../tools/adt-facade.mjs";
import {TREE_CATEGORY, TREE_TYPE_LABEL, TREE_FOLDER, ADT_TYPE} from "../tools/adt-documents.mjs";

// The demo package, met the way a client meets it.
//
// $ZTEST holds one or two objects of every type the façade knows how to put
// in a tree, so that "the tree shows the types" stops being a claim about a
// table in tools/ and becomes a thing that can fail. Every assertion here is
// about the façade's answer for a real object on disk under src/ztest/, not
// about a fixture built in the test.
//
// The package names are $STG_ZTEST and its children rather than $ZTEST: the
// store derives a package name from the folder chain (ROOT_PACKAGES in
// tools/osd-store.mjs maps src -> $STG) and does not read DEVCLASS out of
// package.devc.xml. The folder layout is the one the brief asked for; the
// names are what this façade makes of it today.
const ROOT = "$STG_ZTEST";
const DDIC = "$STG_ZTEST_DDIC";
const SRC = "$STG_ZTEST_SRC";
const CDS = "$STG_ZTEST_CDS";

// type -> the object of that type the package carries. This list is the
// point of the whole package: a type that falls out of the tree fails here
// by name rather than by a count going down.
const OBJECTS = [
  ["CLAS", "ZCL_ZTEST_DEMO", SRC],
  ["INTF", "ZIF_ZTEST_GREETER", SRC],
  ["PROG", "ZTEST_DEMO_PROG", SRC],
  ["FUGR", "ZTEST_FG", SRC],
  ["MSAG", "ZTEST_MSG", SRC],
  ["TABL", "ZTEST_ITEM", DDIC],
  ["DTEL", "ZTEST_STATUS", DDIC],
  ["DTEL", "ZTEST_NAME", DDIC],
  ["DOMA", "ZTEST_STATUS", DDIC],
  ["TTYP", "ZTEST_ITEM_T", DDIC],
  ["VIEW", "ZTEST_ITEM_V", DDIC],
  ["SHLP", "ZTEST_ITEM_SH", DDIC],
  ["DDLS", "ZTEST_I_ITEM", CDS],
];

describe("src/ztest: the demo package of every type the façade shows", () => {
  let server;
  let port;
  let store;
  let token;
  let context;

  before(async function () {
    // parsing the system is seconds, and the first request pays for it
    this.timeout(180000);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.raw({type: "*/*", limit: "16mb"}));
    // the transpile after an activation rewrites output/ underneath the rest
    // of the suite, so this asks for the verdict and not for the modules
    const facade = adtRouter({transpileOnActivate: false});
    store = facade.store;
    app.use(facade.router);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
      // a test here pauses for seconds on one kept-alive socket
      server.keepAliveTimeout = 120000;
      server.headersTimeout = 125000;
    });
    port = server.address().port;

    const res = await fetch(base() + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    context = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
  });

  after(() => server?.close());

  const base = () => `http://127.0.0.1:${port}/sap/bc/adt`;
  const call = (path, options = {}) => fetch(base() + path, {
    ...options,
    headers: {cookie: `sap-contextid=${context}`, "x-csrf-token": token, ...(options.headers ?? {})},
  });

  const tree = async (name, type = "DEVC%2FK") => {
    const res = await call(`/repository/nodestructure?parent_type=${type}&parent_name=${encodeURIComponent(name)}`,
      {method: "POST"});
    expect(res.status, name).to.equal(200);
    return res.text();
  };

  // one <SEU_ADT_OBJECT_TYPE_INFO> row, as fields
  const typeInfo = (xml) => [...xml.matchAll(/<SEU_ADT_OBJECT_TYPE_INFO>([\s\S]*?)<\/SEU_ADT_OBJECT_TYPE_INFO>/g)]
    .map((m) => Object.fromEntries([...m[1].matchAll(/<(\w+)(?:\/>|>([^<]*)<\/\1>)/g)].map((f) => [f[1], f[2] ?? ""])));

  const contentRows = (xml) => [...xml.matchAll(/<SEU_ADT_REPOSITORY_OBJ_NODE>([\s\S]*?)<\/SEU_ADT_REPOSITORY_OBJ_NODE>/g)]
    .map((m) => Object.fromEntries([...m[1].matchAll(/<(\w+)(?:\/>|>([^<]*)<\/\1>)/g)].map((f) => [f[1], f[2] ?? ""])));

  describe("the store holds it", () => {
    it("every object of the list is an object of the system", () => {
      for (const [type, name] of OBJECTS) {
        expect(store.exists(type, name), `${type} ${name}`).to.equal(true);
      }
    });

    it("the three subpackages sit under the package, which sits under $STG", () => {
      const packages = store.packages();
      const root = packages.find((p) => p.name === ROOT);
      expect(root, ROOT).to.not.equal(undefined);
      expect(root.parent).to.equal("$STG");
      expect(root.subpackages).to.have.members([DDIC, SRC, CDS]);
      // the text comes from package.devc.xml, which is the only thing that
      // file is read for today
      expect(root.description).to.contain("ZTEST");
    });

    it("each object is in the subpackage its folder names", () => {
      for (const [type, name, pkg] of OBJECTS) {
        expect(store.find(type, name).package, `${type} ${name}`).to.equal(pkg);
      }
    });
  });

  describe("the tree shows it", () => {
    it("the package expands to its three subpackages, each expandable", async () => {
      const xml = await tree(ROOT);
      const rows = contentRows(xml);
      const subpackages = rows.filter((r) => r.OBJECT_TYPE === "DEVC/K");
      expect(subpackages.map((r) => r.OBJECT_NAME)).to.have.members([DDIC, SRC, CDS]);
      for (const row of subpackages) {
        expect(row.EXPANDABLE, row.OBJECT_NAME).to.equal("X");
      }
    });

    it("every type in the package has its own drawer, with a label and a category", async () => {
      const seen = new Map();
      const labels = new Map();
      for (const pkg of [DDIC, SRC, CDS]) {
        const xml = await tree(pkg);
        for (const info of typeInfo(xml)) {
          seen.set(info.OBJECT_TYPE, info);
        }
        // the drawer's category is a tag on the type row; the words a person
        // reads come from the CATEGORIES table beside it
        for (const m of xml.matchAll(/<CATEGORY>([^<]*)<\/CATEGORY><CATEGORY_LABEL>([^<]*)<\/CATEGORY_LABEL>/g)) {
          labels.set(m[1], m[2]);
        }
      }
      for (const [type] of OBJECTS) {
        const info = seen.get(ADT_TYPE[type]);
        expect(info, `${type} has no drawer`).to.not.equal(undefined);
        // an empty label is what the client shows as the bare type in angle
        // brackets, and an unnamed category is what it shows as ???
        expect(info.OBJECT_TYPE_LABEL, `${type} drawer has no name`).to.not.equal("");
        expect(info.OBJECT_TYPE_LABEL).to.equal(TREE_FOLDER[type]?.[1] ?? TREE_TYPE_LABEL[type]);
        expect(info.CATEGORY_TAG, `${type} category`).to.equal(TREE_CATEGORY[type]);
        expect(labels.get(info.CATEGORY_TAG), `${type} category has no name`)
          .to.be.oneOf(["Source Code Library", "Dictionary"]);
        expect(info.NODE_ID).to.match(/^\d{6}$/);
      }
    });

    it("every object is a row of its package, addressable and versioned", async () => {
      const rows = new Map();
      for (const pkg of [DDIC, SRC, CDS]) {
        for (const row of contentRows(await tree(pkg))) {
          rows.set(`${row.OBJECT_TYPE} ${row.OBJECT_NAME}`, row);
        }
      }
      for (const [type, name] of OBJECTS) {
        const row = rows.get(`${ADT_TYPE[type]} ${name}`);
        expect(row, `${type} ${name} is not in the tree`).to.not.equal(undefined);
        expect(row.OBJECT_URI, `${type} ${name}`).to.match(/^\/sap\/bc\/adt\//);
        // the client accepts exactly two spellings and silently drops the rest
        expect(["A", "I"], `${type} ${name} version`).to.include(row.VERSION);
      }
    });

    it("the source types open at the address the tree gives", async () => {
      for (const [type, name] of OBJECTS.filter(([t]) => ["CLAS", "INTF", "PROG", "DDLS"].includes(t))) {
        const res = await call(`/${{CLAS: "oo/classes", INTF: "oo/interfaces", PROG: "programs/programs", DDLS: "ddic/ddl/sources"}[type]}/${name.toLowerCase()}/source/main`);
        expect(res.status, `${type} ${name}`).to.equal(200);
        expect(await res.text(), `${type} ${name}`).to.not.equal("");
      }
    });

    it("the class is a folder holding the test include it really has", async () => {
      const xml = await tree("ZCL_ZTEST_DEMO", "CLAS%2FOC");
      const names = contentRows(xml).map((r) => r.OBJECT_NAME);
      expect(names).to.include("ZCL_ZTEST_DEMO.main");
      expect(names).to.include("ZCL_ZTEST_DEMO.testclasses");
    });

    it("the data element opens as a data element, which is what the editor needs", async () => {
      const res = await call("/ddic/dataelements/ztest_status");
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain('adtcore:type="DTEL/DE"');
      expect(xml).to.contain("<dtel:shortFieldLabel>Status</dtel:shortFieldLabel>");
    });
  });

  describe("the cloud tree shows it", () => {
    const REQ = '<vfs:virtualFoldersRequest xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders" objectSearchPattern="*">';
    const pre = (facet, ...values) => `<vfs:preselection facet="${facet}">` +
      values.map((v) => `<vfs:value>${v}</vfs:value>`).join("") + "</vfs:preselection>";
    const order = (...facets) => "<vfs:facetorder>" + facets.map((f) => `<vfs:facet>${f}</vfs:facet>`).join("") + "</vfs:facetorder>";
    const ask = async (...parts) => {
      const res = await call("/repository/informationsystem/virtualfolders/contents", {
        method: "POST", headers: {"content-type": "application/xml"},
        body: REQ + parts.join("") + "</vfs:virtualFoldersRequest>",
      });
      expect(res.status).to.equal(200);
      const xml = await res.text();
      const attrs = (tag) => [...xml.matchAll(new RegExp(`<vfs:${tag} ([^>]*)>`, "g"))]
        .map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
      return {xml, count: Number(/objectCount="(\d+)"/.exec(xml)[1]), folders: attrs("virtualFolder"), objects: attrs("object")};
    };

    it("the package opens to its subpackages and counts its whole subtree", async () => {
      const {folders, count} = await ask(pre("package", ROOT), order("package", "group", "type"));
      expect(folders.map((f) => f.name)).to.include.members([DDIC, SRC, CDS]);
      expect(count).to.equal(OBJECTS.length + 3);
    });

    it("the dictionary subpackage opens to one drawer per DDIC type", async () => {
      const {folders} = await ask(pre("group", "DICTIONARY"), pre("package", DDIC), order("type"));
      const names = folders.map((f) => f.name);
      expect(names).to.have.members(["TABL", "DTEL", "DOMA", "TTYP", "VIEW", "SHLP"]);
      for (const folder of folders) {
        expect(folder.facet).to.equal("TYPE");
        expect(folder.displayName, folder.name).to.not.equal("");
      }
      expect(folders.find((f) => f.name === "DTEL").counter, "two data elements").to.equal("2");
    });

    it("the source subpackage lists its objects with a servable link", async () => {
      const {objects} = await ask(pre("group", "SOURCE_LIBRARY"), pre("package", SRC), pre("type", "CLAS"), order());
      expect(objects.map((o) => o.name)).to.deep.equal(["ZCL_ZTEST_DEMO"]);
      expect(objects[0].package).to.equal(SRC);
      expect(objects[0].uri).to.match(/^\/sap\/bc\/adt\/oo\/classes\//);
    });
  });

  describe("the table answers with its rows", () => {
    it("Data Preview reads the seeded items", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=100", {
        method: "POST",
        body: "SELECT item_id, name, status, quantity FROM ztest_item",
      });
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<dataPreview:tableData");
      for (const column of ["ITEM_ID", "NAME", "STATUS", "QUANTITY"]) {
        expect(xml, column).to.contain(`dataPreview:name="${column}"`);
      }
      expect(xml).to.contain("<dataPreview:totalRows>6</dataPreview:totalRows>");
      expect(xml).to.contain("Bearing, 6203-2RS");
    });

    it("the CDS view over the table is a view the database has", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=100", {
        method: "POST",
        body: "SELECT * FROM zvtestitem",
      });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("<dataPreview:totalRows>6</dataPreview:totalRows>");
    });
  });

  describe("the source objects activate", () => {
    const activate = (...objects) => call("/activation?method=activate&preauditRequested=true", {
      method: "POST",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
${objects.map(([uri, name]) => `  <adtcore:objectReference adtcore:uri="${uri}" adtcore:name="${name}"/>`).join("\n")}
</adtcore:objectReferences>`,
    });

    it("the class, the interface, the program and the CDS view all activate clean", async function () {
      this.timeout(180000);
      const res = await activate(
        ["/sap/bc/adt/oo/classes/zcl_ztest_demo", "ZCL_ZTEST_DEMO"],
        ["/sap/bc/adt/oo/interfaces/zif_ztest_greeter", "ZIF_ZTEST_GREETER"],
        ["/sap/bc/adt/programs/programs/ztest_demo_prog", "ZTEST_DEMO_PROG"],
        ["/sap/bc/adt/ddic/ddl/sources/ztest_i_item", "ZTEST_I_ITEM"],
      );
      expect(res.status).to.equal(200);
      // an activation that held says so by its properties; an activation
      // that did not carries messages and activationExecuted="false"
      const xml = await res.text();
      expect(xml).to.contain('activationExecuted="true"');
      expect(xml, "a message here is a finding, and there should be none").to.not.contain("<msg:msg");
    });

    // The limit, asserted rather than described: activation resolves an
    // object reference through the collections of SOURCE_TYPES only (the
    // types with source: true in tools/osd-store.mjs), so a URI under
    // ddic/tables resolves to nothing and the request names no object at
    // all. A DDIC object of this package therefore cannot be activated
    // through the façade today, and this test is what will notice when it
    // can.
    it("no type without source can be activated through the façade yet", async () => {
      const uris = [
        ["/sap/bc/adt/ddic/tables/ztest_item", "ZTEST_ITEM"],
        ["/sap/bc/adt/ddic/dataelements/ztest_status", "ZTEST_STATUS"],
        ["/sap/bc/adt/ddic/domains/ztest_status", "ZTEST_STATUS"],
        ["/sap/bc/adt/ddic/tabletypes/ztest_item_t", "ZTEST_ITEM_T"],
        ["/sap/bc/adt/ddic/views/ztest_item_v", "ZTEST_ITEM_V"],
        ["/sap/bc/adt/ddic/searchhelps/ztest_item_sh", "ZTEST_ITEM_SH"],
        ["/sap/bc/adt/messageclass/ztest_msg", "ZTEST_MSG"],
        ["/sap/bc/adt/functions/groups/ztest_fg", "ZTEST_FG"],
      ];
      for (const one of uris) {
        const res = await activate(one);
        expect(res.status, one[1]).to.equal(400);
        expect(await res.text(), one[1]).to.contain("no object references");
      }
    });

    it("but the store checks those objects like any other", () => {
      for (const [type, name] of [["TABL", "ZTEST_ITEM"], ["DTEL", "ZTEST_STATUS"], ["DOMA", "ZTEST_STATUS"],
        ["TTYP", "ZTEST_ITEM_T"], ["VIEW", "ZTEST_ITEM_V"], ["SHLP", "ZTEST_ITEM_SH"],
        ["MSAG", "ZTEST_MSG"], ["FUGR", "ZTEST_FG"]]) {
        expect(store.check(type, name).issues, `${type} ${name}`).to.deep.equal([]);
      }
    });
  });

  describe("the tests run", () => {
    const testRun = (name) => call("/abapunit/testruns", {
      method: "POST",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit" xmlns:adtcore="http://www.sap.com/adt/core">
  <external><coverage active="false"/></external>
  <adtcore:objectReferences>
    <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/${String(name).toLowerCase()}"/>
  </adtcore:objectReferences>
</aunit:runConfiguration>`,
    });

    let xml;

    before(async function () {
      this.timeout(180000);
      const res = await testRun("ZCL_ZTEST_DEMO");
      expect(res.status).to.equal(200);
      xml = await res.text();
    });

    it("the class comes back as one test class with two methods", () => {
      expect(xml).to.contain('adtcore:name="ZCL_ZTEST_DEMO"');
      expect(xml).to.contain('<testClass adtcore:name="LTCL_ZTEST_DEMO"');
      const methods = [...xml.matchAll(/<testMethod adtcore:name="([^"]+)"/g)].map((m) => m[1]);
      expect(methods).to.have.members(["GREETING_PASSES", "DELIBERATE_FAILURE"]);
    });

    // A run that only ever reports passes says nothing about whether a
    // failure reaches the client at all, which is why the package carries
    // one of each.
    it("one method passes, which is an empty alerts element", () => {
      const method = /<testMethod adtcore:name="GREETING_PASSES"[\s\S]*?<\/testMethod>/.exec(xml)[0];
      expect(method).to.contain("<alerts>");
      expect(method).to.not.contain("<alert ");
    });

    it("the other fails, and the failure carries its message and a place to jump to", () => {
      const method = /<testMethod adtcore:name="DELIBERATE_FAILURE"[\s\S]*?<\/testMethod>/.exec(xml)[0];
      expect(method).to.contain('<alert kind="failedAssertion"');
      expect(method).to.contain('severity="critical"');
      expect(method).to.contain("ZTEST: this assertion fails on purpose");
      expect(method).to.match(/navigationUri="[^"]*\/includes\/testclasses\/source\/main#start=\d+,\d+"/);
    });

    it("exactly one of the two failed", () => {
      const failed = [...xml.matchAll(/<testMethod [\s\S]*?<\/testMethod>/g)]
        .filter((m) => m[0].includes("<alert ")).length;
      expect(failed).to.equal(1);
    });
  });
});
