import {expect} from "chai";
import express from "express";
import {existsSync, readFileSync} from "node:fs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {TREE_CATEGORY, TREE_TYPE_LABEL, TREE_FOLDER, ADT_TYPE} from "../tools/adt-documents.mjs";
import {startServer} from "./start.mjs";

// The reference package, met the way a client meets it.
//
// $ZOSD_TEST holds a small, meant example of every kind the façade is
// supposed to carry reliably, so that "the tree shows the types" stops being
// a claim about a table in tools/ and becomes a thing that can fail. Every
// assertion here is about the façade's answer for a real object on disk
// under src/zosd_test/, not about a fixture built in the test.
//
// $ZOSD_TEST is a root of its own (FOLDER_PACKAGES in osd-store.mjs); the
// subpackages are named after the folders, which is all packagesOf reads.
const ROOT = "$ZOSD_TEST";
const DDIC = "$ZOSD_TEST_DDIC";
const SRC = "$ZOSD_TEST_SRC";
const CDS = "$ZOSD_TEST_CDS";
const SEGW = "$ZOSD_TEST_SEGW";

// type -> the object of that type the package carries, as the *store* types
// it. This list is the point of the whole package: a type that falls out of
// the tree fails here by name rather than by a count going down.
//
// Two of the rows are a kind wearing another kind's type code, and that is
// the façade's limit rather than a mistake in the package: the include
// ZOSD_TEST_DEMO_INC is indexed as PROG and the structure ZOSD_TEST_ITEM_S
// as TABL (ObjectStore#build skips every TYPES entry with sameFileAs and
// never looks inside a .tabl.xml for TABCLASS). The tests below assert both
// the kind the store does resolve and the type code the tree really shows,
// so the day the façade tells them apart this file says where.
const OBJECTS = [
  ["CLAS", "ZCL_ZOSD_TEST_DEMO", SRC],
  ["INTF", "ZIF_ZOSD_TEST_GREETER", SRC],
  ["PROG", "ZOSD_TEST_DEMO_PROG", SRC],
  ["PROG", "ZOSD_TEST_DEMO_INC", SRC],
  ["FUGR", "ZOSD_TEST_FG", SRC],
  ["MSAG", "ZOSD_TEST_MSG", SRC],
  ["TABL", "ZOSD_TEST_ITEM", DDIC],
  ["TABL", "ZOSD_TEST_ITEM_S", DDIC],
  ["DTEL", "ZOSD_TEST_STATUS", DDIC],
  ["DTEL", "ZOSD_TEST_NAME", DDIC],
  ["DOMA", "ZOSD_TEST_STATUS", DDIC],
  ["TTYP", "ZOSD_TEST_ITEM_T", DDIC],
  ["VIEW", "ZOSD_TEST_ITEM_V", DDIC],
  ["SHLP", "ZOSD_TEST_ITEM_SH", DDIC],
  ["DDLS", "ZOSD_TEST_I_ITEM", CDS],
  ["CLAS", "ZCL_ZOSD_TEST_MPC_EXT", SEGW],
  ["CLAS", "ZCL_ZOSD_TEST_DPC_EXT", SEGW],
];

// the OData service of the SEGW subpackage runs on the gateway, not on the
// façade, so it needs the listener test/start.mjs builds. One port above the
// one test/adt-facade.mjs takes, because a suite that runs both files runs
// them in one process.
const ODATA_PORT = Number(process.env.STG_PORT ?? 3030) + 1;
const ODATA = `http://localhost:${ODATA_PORT}/sap/opu/odata/sap/ZOSD_TEST_SRV`;

describe("src/zosd_test: the reference package of every type the façade shows", () => {
  let server;
  let port;
  let store;
  let token;
  let context;
  let gateway;

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

    const was = process.env.STG_PORT;
    process.env.STG_PORT = String(ODATA_PORT);
    gateway = startServer(true);
    if (was === undefined) {
      delete process.env.STG_PORT;
    } else {
      process.env.STG_PORT = was;
    }
  });

  after(() => {
    server?.close();
    gateway?.close();
  });

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

  const PACKAGES = [DDIC, SRC, CDS, SEGW];

  describe("the store holds it", () => {
    it("every object of the list is an object of the system", () => {
      for (const [type, name] of OBJECTS) {
        expect(store.exists(type, name), `${type} ${name}`).to.equal(true);
      }
    });

    it("the four subpackages sit under the package, which is a root of its own", () => {
      const packages = store.packages();
      const root = packages.find((p) => p.name === ROOT);
      expect(root, ROOT).to.not.equal(undefined);
      expect(root.parent, "a root of its own").to.equal(undefined);
      expect(root.subpackages).to.have.members(PACKAGES);
      // the text comes from package.devc.xml, which is the only thing that
      // file is read for today
      expect(root.description).to.contain("ZOSD_TEST");
      for (const name of PACKAGES) {
        expect(store.package(name).description, name).to.contain("ZOSD_TEST");
      }
    });

    it("each object is in the subpackage its folder names", () => {
      for (const [type, name, pkg] of OBJECTS) {
        expect(store.find(type, name).package, `${type} ${name}`).to.equal(pkg);
      }
    });

    it("the include and the structure resolve as their own kinds", () => {
      const include = store.find("INCL", "ZOSD_TEST_DEMO_INC");
      expect(include, "INCL ZOSD_TEST_DEMO_INC").to.not.equal(undefined);
      expect(include.file).to.equal("src/zosd_test/src/zosd_test_demo_inc.prog.abap");
      const structure = store.find("STRU", "ZOSD_TEST_ITEM_S");
      expect(structure, "STRU ZOSD_TEST_ITEM_S").to.not.equal(undefined);
      expect(structure.file).to.equal("src/zosd_test/ddic/zosd_test_item_s.tabl.xml");
      // and the table beside it is not a structure
      expect(store.find("STRU", "ZOSD_TEST_ITEM"), "a transparent table is no structure").to.equal(undefined);
    });

    it("the program really reaches the include", () => {
      const {source} = store.read("PROG", "ZOSD_TEST_DEMO_PROG");
      expect(source).to.contain("INCLUDE zosd_test_demo_inc.");
      expect(source).to.contain("PERFORM describe_total");
      expect(store.read("INCL", "ZOSD_TEST_DEMO_INC").source).to.contain("FORM describe_total");
    });

    it("the function group carries the one function module, and it calls the class", () => {
      const group = readFileSync("src/zosd_test/src/zosd_test_fg.fugr.xml", "utf8");
      expect(group).to.contain("<FUNCNAME>Z_OSD_TEST_STATUS_TEXT</FUNCNAME>");
      expect(readFileSync("src/zosd_test/src/zosd_test_fg.fugr.z_osd_test_status_text.abap", "utf8"))
        .to.contain("zcl_zosd_test_demo=>status_text");
    });

    // The transaction is on disk, abapGit-shaped, and the transpiler accepts
    // TRAN; the store does not, because TYPES in tools/osd-store.mjs has no
    // TRAN entry at all. So the object exists in the repository and in
    // output/, and no client can see it. This is the assertion that will
    // notice the day the entry is added.
    it("the transaction is a file of the package and not yet an object of it", () => {
      const file = "src/zosd_test/src/zosd_test_demo.tran.xml";
      expect(existsSync(file), file).to.equal(true);
      const xml = readFileSync(file, "utf8");
      expect(xml).to.contain("<TCODE>ZOSD_TEST_DEMO</TCODE>");
      expect(xml).to.contain("<PGMNA>ZOSD_TEST_DEMO_PROG</PGMNA>");
      expect(store.find("TRAN", "ZOSD_TEST_DEMO"), "TRAN is not a type of the store yet").to.equal(undefined);
    });

    // Same shape, one level up: the SEGW project, the service and the model
    // registration are files of the package (and the reason the OData
    // service below answers), but IWPR/IWSV/IWMO are not types of the store.
    it("the SEGW project, service and model are files of the package and not yet objects of it", () => {
      for (const file of ["src/zosd_test/segw/zosd_test.iwpr.xml",
        "src/zosd_test/segw/zosd_test_srv                     0001.iwsv.xml",
        "src/zosd_test/segw/zosd_test_mdl                     0001.iwmo.xml"]) {
        expect(existsSync(file), file).to.equal(true);
      }
      for (const type of ["IWPR", "IWSV", "IWMO"]) {
        expect(store.find(type, "ZOSD_TEST"), `${type} is not a type of the store yet`).to.equal(undefined);
      }
    });
  });

  describe("the tree shows it", () => {
    it("the package expands to its four subpackages, each expandable", async () => {
      const xml = await tree(ROOT);
      const rows = contentRows(xml);
      const subpackages = rows.filter((r) => r.OBJECT_TYPE === "DEVC/K");
      expect(subpackages.map((r) => r.OBJECT_NAME)).to.have.members(PACKAGES);
      for (const row of subpackages) {
        expect(row.EXPANDABLE, row.OBJECT_NAME).to.equal("X");
      }
    });

    it("every type in the package has its own drawer, with a label and a category", async () => {
      const seen = new Map();
      const labels = new Map();
      for (const pkg of PACKAGES) {
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
      for (const pkg of PACKAGES) {
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

    // Written down as a test rather than as a comment: the include is in the
    // tree under PROG/P and the structure under TABL/DT, which is what the
    // store types them as. When ObjectStore#build learns to tell them apart
    // this fails and says so.
    it("the include and the structure are in the tree under the neighbouring type code", async () => {
      const rows = new Map();
      for (const pkg of [SRC, DDIC]) {
        for (const row of contentRows(await tree(pkg))) {
          rows.set(row.OBJECT_NAME, row);
        }
      }
      expect(rows.get("ZOSD_TEST_DEMO_INC").OBJECT_TYPE, "PROG/I would be the kind it is").to.equal("PROG/P");
      expect(rows.get("ZOSD_TEST_ITEM_S").OBJECT_TYPE, "TABL/DS would be the kind it is").to.equal("TABL/DT");
    });

    it("the source types open at the address the tree gives", async () => {
      const collection = {CLAS: "oo/classes", INTF: "oo/interfaces", PROG: "programs/programs", DDLS: "ddic/ddl/sources"};
      for (const [type, name] of OBJECTS.filter(([t]) => collection[t] !== undefined)) {
        const res = await call(`/${collection[type]}/${name.toLowerCase()}/source/main`);
        expect(res.status, `${type} ${name}`).to.equal(200);
        expect(await res.text(), `${type} ${name}`).to.not.equal("");
      }
    });

    it("the include opens as an include too, at its own collection", async () => {
      const res = await call("/programs/includes/zosd_test_demo_inc/source/main");
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("FORM describe_total");
    });

    const uri = {
      CLAS: "oo/classes", INTF: "oo/interfaces", PROG: "programs/programs", DDLS: "ddic/ddl/sources",
      FUGR: "functions/groups", MSAG: "messageclass", TABL: "ddic/tables", DTEL: "ddic/dataelements",
      DOMA: "ddic/domains", TTYP: "ddic/tabletypes", VIEW: "ddic/views", SHLP: "ddic/searchhelps",
    };
    // the kinds whose editor document the façade serves today; the rest
    // are in the tree and in the search, and open to a refusal
    const DOCUMENTED = new Set(["CLAS", "INTF", "PROG", "DDLS", "TABL", "DTEL"]);

    it("the document of every object the façade serves answers, and names the object", async () => {
      for (const [type, name] of OBJECTS.filter(([type]) => DOCUMENTED.has(type))) {
        const res = await call(`/${uri[type]}/${name.toLowerCase()}`);
        expect(res.status, `${type} ${name}`).to.equal(200);
        const body = await res.text();
        expect(body, `${type} ${name}`).to.not.equal("");
        expect(body, `${type} ${name}`).to.contain(name);
      }
    });

    it("the document of a kind the façade does not serve yet is a refusal a client can read, not a hang", async () => {
      // FUGR, MSAG, DOMA, TTYP, VIEW, SHLP: each has an editor format of its
      // own and none is written yet. Until one is, the answer is the 404 in
      // the client's exception vocabulary; when one lands, this list shrinks
      for (const [type, name] of OBJECTS.filter(([type]) => !DOCUMENTED.has(type))) {
        const res = await call(`/${uri[type]}/${name.toLowerCase()}`);
        expect(res.status, `${type} ${name}`).to.equal(404);
        expect(await res.text(), `${type} ${name}`).to.contain("ExceptionResourceNotFound");
      }
    });

    it("the class is a folder holding the test include it really has", async () => {
      const xml = await tree("ZCL_ZOSD_TEST_DEMO", "CLAS%2FOC");
      const names = contentRows(xml).map((r) => r.OBJECT_NAME);
      expect(names).to.include("ZCL_ZOSD_TEST_DEMO.main");
      expect(names).to.include("ZCL_ZOSD_TEST_DEMO.testclasses");
    });

    it("the data element opens as a data element, which is what the editor needs", async () => {
      const res = await call("/ddic/dataelements/zosd_test_status");
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
      expect(folders.map((f) => f.name)).to.include.members(PACKAGES);
      expect(count).to.equal(OBJECTS.length + PACKAGES.length);
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
      expect(folders.find((f) => f.name === "TABL").counter, "the table and the structure").to.equal("2");
    });

    it("the source subpackage lists its objects with a servable link", async () => {
      const {objects} = await ask(pre("group", "SOURCE_LIBRARY"), pre("package", SRC), pre("type", "CLAS"), order());
      expect(objects.map((o) => o.name)).to.deep.equal(["ZCL_ZOSD_TEST_DEMO"]);
      expect(objects[0].package).to.equal(SRC);
      expect(objects[0].uri).to.match(/^\/sap\/bc\/adt\/oo\/classes\//);
    });

    it("the SEGW subpackage lists the two classes a developer owns", async () => {
      const {objects} = await ask(pre("group", "SOURCE_LIBRARY"), pre("package", SEGW), pre("type", "CLAS"), order());
      expect(objects.map((o) => o.name)).to.have.members(["ZCL_ZOSD_TEST_MPC_EXT", "ZCL_ZOSD_TEST_DPC_EXT"]);
    });
  });

  describe("the table answers with its rows", () => {
    it("Data Preview reads the seeded items", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=100", {
        method: "POST",
        body: "SELECT item_id, name, status, quantity FROM zosd_test_item",
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
        body: "SELECT * FROM zvosdtestitem",
      });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("<dataPreview:totalRows>6</dataPreview:totalRows>");
    });

    it("the projection view over the table answers too", async () => {
      const res = await call("/datapreview/freestyle?rowNumber=100", {
        method: "POST",
        body: "SELECT * FROM zosd_test_item_v",
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

    it("the class, the interface, the program, the include and the CDS view all activate clean", async function () {
      this.timeout(180000);
      const res = await activate(
        ["/sap/bc/adt/oo/classes/zcl_zosd_test_demo", "ZCL_ZOSD_TEST_DEMO"],
        ["/sap/bc/adt/oo/interfaces/zif_zosd_test_greeter", "ZIF_ZOSD_TEST_GREETER"],
        ["/sap/bc/adt/programs/programs/zosd_test_demo_prog", "ZOSD_TEST_DEMO_PROG"],
        ["/sap/bc/adt/programs/includes/zosd_test_demo_inc", "ZOSD_TEST_DEMO_INC"],
        ["/sap/bc/adt/ddic/ddl/sources/zosd_test_i_item", "ZOSD_TEST_I_ITEM"],
      );
      expect(res.status).to.equal(200);
      // an activation that held says so by its properties; an activation
      // that did not carries messages and activationExecuted="false"
      const xml = await res.text();
      expect(xml).to.contain('activationExecuted="true"');
      expect(xml, "a message here is a finding, and there should be none").to.not.contain("<msg:msg");
    });

    it("the two SEGW classes activate as well", async function () {
      this.timeout(180000);
      const res = await activate(
        ["/sap/bc/adt/oo/classes/zcl_zosd_test_mpc_ext", "ZCL_ZOSD_TEST_MPC_EXT"],
        ["/sap/bc/adt/oo/classes/zcl_zosd_test_dpc_ext", "ZCL_ZOSD_TEST_DPC_EXT"],
      );
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain('activationExecuted="true"');
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
        ["/sap/bc/adt/ddic/tables/zosd_test_item", "ZOSD_TEST_ITEM"],
        ["/sap/bc/adt/ddic/tables/zosd_test_item_s", "ZOSD_TEST_ITEM_S"],
        ["/sap/bc/adt/ddic/dataelements/zosd_test_status", "ZOSD_TEST_STATUS"],
        ["/sap/bc/adt/ddic/domains/zosd_test_status", "ZOSD_TEST_STATUS"],
        ["/sap/bc/adt/ddic/tabletypes/zosd_test_item_t", "ZOSD_TEST_ITEM_T"],
        ["/sap/bc/adt/ddic/views/zosd_test_item_v", "ZOSD_TEST_ITEM_V"],
        ["/sap/bc/adt/ddic/searchhelps/zosd_test_item_sh", "ZOSD_TEST_ITEM_SH"],
        ["/sap/bc/adt/messageclass/zosd_test_msg", "ZOSD_TEST_MSG"],
        ["/sap/bc/adt/functions/groups/zosd_test_fg", "ZOSD_TEST_FG"],
      ];
      for (const one of uris) {
        const res = await activate(one);
        expect(res.status, one[1]).to.equal(400);
        expect(await res.text(), one[1]).to.contain("no object references");
      }
    });

    it("but the store checks those objects like any other", () => {
      for (const [type, name] of [["TABL", "ZOSD_TEST_ITEM"], ["TABL", "ZOSD_TEST_ITEM_S"],
        ["DTEL", "ZOSD_TEST_STATUS"], ["DOMA", "ZOSD_TEST_STATUS"],
        ["TTYP", "ZOSD_TEST_ITEM_T"], ["VIEW", "ZOSD_TEST_ITEM_V"], ["SHLP", "ZOSD_TEST_ITEM_SH"],
        ["MSAG", "ZOSD_TEST_MSG"], ["FUGR", "ZOSD_TEST_FG"]]) {
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
      const res = await testRun("ZCL_ZOSD_TEST_DEMO");
      expect(res.status).to.equal(200);
      xml = await res.text();
    });

    it("the class comes back as one test class with two methods", () => {
      expect(xml).to.contain('adtcore:name="ZCL_ZOSD_TEST_DEMO"');
      expect(xml).to.contain('<testClass adtcore:name="LTCL_ZOSD_TEST_DEMO"');
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
      expect(method).to.contain("ZOSD_TEST: this assertion fails on purpose");
      expect(method).to.match(/navigationUri="[^"]*\/includes\/testclasses\/source\/main#start=\d+,\d+"/);
    });

    it("exactly one of the two failed", () => {
      const failed = [...xml.matchAll(/<testMethod [\s\S]*?<\/testMethod>/g)]
        .filter((m) => m[0].includes("<alert ")).length;
      expect(failed).to.equal(1);
    });
  });

  // The SEGW subpackage is the one that is only proved by running it: the
  // project tree compiles to an MPC and a DPC, the IWSV/IWMO register them,
  // and the service either answers or it does not.
  describe("the service of the SEGW project answers", () => {
    it("$metadata carries the entity type and the entity set", async function () {
      this.timeout(120000);
      const res = await fetch(ODATA + "/$metadata");
      expect(res.status).to.equal(200);
      expect(res.headers.get("dataserviceversion")).to.equal("2.0");
      const xml = await res.text();
      expect(xml).to.contain('<EntityType Name="Item"');
      expect(xml).to.contain('<EntitySet Name="ItemSet" EntityType="ZOSD_TEST_SRV.Item"');
      expect(xml).to.contain('<Property Name="ItemId"');
      expect(xml).to.contain('<Property Name="Quantity"');
    });

    it("the entity set is the rows of the table", async function () {
      this.timeout(120000);
      const res = await fetch(ODATA + "/ItemSet?$format=json");
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body.d.results).to.have.length(6);
      expect(body.d.results.map((r) => r.ItemId)).to.include("I0001");
      const first = body.d.results.find((r) => r.ItemId === "I0001");
      expect(first.Name).to.equal("Bearing, 6203-2RS");
      expect(first.Quantity).to.equal(12);
    });

    it("one entry by key, and $filter reaches the table", async function () {
      this.timeout(120000);
      const one = await fetch(ODATA + "/ItemSet('I0003')?$format=json");
      expect(one.status).to.equal(200);
      expect((await one.json()).d.Name).to.equal("Shaft, 12 mm");

      const some = await fetch(ODATA + "/ItemSet?$format=json&$filter=Status eq 'O'");
      expect(some.status).to.equal(200);
      expect((await some.json()).d.results.map((r) => r.ItemId)).to.deep.equal(["I0002", "I0003"]);
    });
  });
});
