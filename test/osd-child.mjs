// The workbench shape, end to end: the way a server is started (test/run.mjs)
// puts the system in a child, and this process holds no ABAP. Everything a
// client reaches must still be there — through a proxy or a door.
import {expect} from "chai";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {services} from "../tools/osd-icf.mjs";
import {createRequire} from "node:module";

const {Osd, objectOf, outcomes} = createRequire(import.meta.url)("../editors/vscode/lib.js");

const PORT = Number(process.env.STG_PORT ?? 3091) + 7;
const BASE = `http://localhost:${PORT}`;
const ADT = `${BASE}/sap/bc/adt`;

describe("test/run.mjs: the workbench shape, one generation and one database", function () {
  this.timeout(180000);
  let child;
  let token;
  let cookie;
  let databaseDir;
  let testIdentity;
  const log = [];

  before(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), "osd-child-"));
    testIdentity = `osd-child-${randomUUID()}`;
    const backend = process.env.STG_DB === "duckdb" ? "duckdb" : "file";
    child = spawn(process.execPath, ["test/run.mjs"], {
      // Always use a private file, never an inherited HANA connection.
      env: {...process.env, STG_DB: backend, STG_PORT: String(PORT), STG_TLS: "0", STG_SERVE: undefined,
        OSD_USER_FULL: testIdentity, STG_DB_BASE: join(databaseDir, "base"),
        STG_DB_PATH: join(databaseDir, backend === "duckdb" ? "osd.duckdb" : "osd.sqlite")},
      stdio: ["ignore", "pipe", "pipe"],
    });
    delete child.spawnargs; // keep the env clean: STG_SERVE unset means run.mjs picks child
    child.stdout.on("data", (d) => log.push(String(d)));
    child.stderr.on("data", (d) => log.push(String(d)));
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${ADT}/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
        if (res.status === 200) {
          token = res.headers.get("x-csrf-token");
          cookie = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=[^;]+/)?.[0];
          break;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(token, `the façade came up: ${log.join("").slice(-800)}`).to.be.a("string");
    // A fixed test port can already belong to another OSD. Never send the
    // write below until this listener proves it is the process we spawned.
    const build = await (await call("/core/http/build")).json();
    expect(build.identity?.userFullName, `port ${PORT} belongs to this test process`)
      .to.equal(testIdentity);
    expect(child.exitCode, "the spawned façade is still running").to.equal(null);
  });
  after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    if (databaseDir) rmSync(databaseDir, {recursive: true, force: true});
  });

  const call = (path, options = {}) => fetch(ADT + path, {...options, headers: {cookie, "x-csrf-token": token, ...(options.headers ?? {})}});

  it("this process holds no ABAP: the build endpoint says the rows are read through the door", async () => {
    // the child starts at the first request that needs it; ask for one
    await fetch(`${BASE}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
    const body = await (await call("/core/http/build")).json();
    expect(body.system, "three names and a database").to.include.keys("source", "live", "serving", "database");
    expect(body.system.database.preview, "the preview reads through the runtime's door").to.equal("serving");
    expect(body.system.serving, "the child runs the live build").to.equal(body.system.live);
    // a tree with unbuilt edits is honestly not synchronized; the flag must
    // say so, and say the opposite when there are none
    expect(body.system.synchronized).to.equal(body.system.source === body.system.live);
  });

  it("OData is proxied to the child, which names its generation", async () => {
    const res = await fetch(`${BASE}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("x-osd-generation")).to.match(/^[0-9a-f]{16}$/);
  });

  it("F8 on a table reads the rows the application serves", async () => {
    const res = await call("/datapreview/ddic?rowNumber=3&ddicEntityName=ZSTG_DEMO", {method: "POST",
      body: "SELECT ZSTG_DEMO~TRAVEL_ID FROM ZSTG_DEMO"});
    expect(res.status).to.equal(200);
    const xml = await res.text();
    expect((xml.match(/<dataPreview:data>/g) ?? []).length, "rows through the door").to.be.greaterThan(0);
    const wrong = await call("/datapreview/freestyle", {method: "POST", body: "DROP TABLE zstg_demo"});
    expect(wrong.status, "a refusal keeps its code across the door").to.equal(400);
  });

  it("an OData write is immediately visible in F8 and the SQL Pane without a restart", async () => {
    const id = "T0898";
    const description = "Live OData to ADT";
    const odata = `${BASE}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet`;
    const sql = `SELECT travel_id, description FROM zstg_demo WHERE travel_id = '${id}'`;
    const preview = (path, query) => call(path, {method: "POST", body: query});
    const before = await preview("/datapreview/freestyle?rowNumber=2", sql);
    expect(before.status).to.equal(200);
    expect(await before.text(), "the isolated database has no test row yet")
      .to.contain("<dataPreview:totalRows>0</dataPreview:totalRows>");

    const buildBefore = await (await call("/core/http/build")).json();
    expect(buildBefore.identity?.userFullName, "the write target is still our isolated OSD").to.equal(testIdentity);
    const generation = buildBefore.system?.serving;
    expect(generation).to.match(/^[0-9a-f]{16}$/);
    const workProcess = async () => {
      const response = await fetch(`${BASE}/sap/opu/odata/sap/ZOSD_STATUS_SRV/ProcessSet?$format=json`);
      expect(response.status, await response.clone().text()).to.equal(200);
      const work = (await response.json()).d.results.find((row) => row.Role === "work");
      expect(work, "the live runtime is in the status snapshot").to.include.keys("Pid", "Since");
      return {pid: work.Pid, since: work.Since};
    };
    const workerBefore = await workProcess();
    const created = await fetch(odata, {
      method: "POST",
      headers: {"content-type": "application/json", "x-csrf-token": "open-steamgate"},
      body: JSON.stringify({Project: "ZSTG_MAPPED", TravelId: id, Description: description, Status: "O", Seats: 2}),
    });
    expect(created.status, await created.text()).to.equal(201);

    const read = await fetch(`${odata}('${id}')?$format=json`);
    expect(read.status).to.equal(200);
    expect((await read.json()).d.Description).to.equal(description);

    const f8 = await preview("/datapreview/ddic?rowNumber=2&ddicEntityName=ZSTG_DEMO",
      `SELECT ZSTG_DEMO~TRAVEL_ID, ZSTG_DEMO~DESCRIPTION FROM ZSTG_DEMO WHERE ZSTG_DEMO~TRAVEL_ID = '${id}'`);
    expect(f8.status, await f8.clone().text()).to.equal(200);
    const f8Xml = await f8.text();
    expect(f8Xml).to.contain("<dataPreview:totalRows>1</dataPreview:totalRows>");
    expect(f8Xml).to.contain(`<dataPreview:data>${id}</dataPreview:data>`);
    expect(f8Xml).to.contain(`<dataPreview:data>${description}</dataPreview:data>`);

    const pane = await preview("/datapreview/freestyle?rowNumber=2", sql);
    expect(pane.status, await pane.clone().text()).to.equal(200);
    const paneXml = await pane.text();
    expect(paneXml).to.contain("<dataPreview:totalRows>1</dataPreview:totalRows>");
    expect(paneXml).to.contain(`<dataPreview:data>${id}</dataPreview:data>`);
    expect(paneXml).to.contain(`<dataPreview:data>${description}</dataPreview:data>`);
    expect(pane.headers.get("x-osd-generation"), "the same build answered after the write").to.equal(generation);
    const buildAfter = await (await call("/core/http/build")).json();
    expect(buildAfter.started, "the façade did not restart").to.equal(buildBefore.started);
    expect(await workProcess(), "the work process did not restart").to.deep.equal(workerBefore);
  });

  it("every ICF service the tree declares is reachable through the parent", async () => {
    const declared = services(process.cwd()).filter((s) => s.handler !== undefined && !s.path.startsWith("/sap/opu/odata") && !s.path.startsWith("/sap/bc/adt"));
    expect(declared.length, "the tree declares services").to.be.greaterThan(0);
    for (const service of declared) {
      const res = await fetch(BASE + service.path);
      // whatever the handler answers to a bare GET is its business; what
      // matters is that the child answered it, which its header proves
      expect(res.headers.get("x-osd-generation"), `${service.path} (${service.handler}) answered by the child, status ${res.status}`).to.match(/^[0-9a-f]{16}$/);
    }
  });

  it("the child's own doors (/osd/serving, /osd/dumps, /osd/sql) answer through the parent", async () => {
    const serving = await fetch(`${BASE}/osd/serving`);
    expect(serving.status, "/osd/serving").to.equal(200);
    expect(await serving.json()).to.be.an("object");
    const dumps = await fetch(`${BASE}/osd/dumps`);
    expect(dumps.status, "/osd/dumps").to.equal(200);
    expect(await dumps.json()).to.be.an("array");
    const sql = await fetch(`${BASE}/osd/sql`, {method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({sql: "SELECT COUNT(*) AS n FROM zstg_demo"})});
    expect(sql.status, `/osd/sql: ${await sql.clone().text()}`).to.equal(200);
  });

  it("the VS Code extension's client discovers and runs one method through the parent", async () => {
    const client = new Osd(BASE);
    expect((await client.serving()).generation).to.be.a("string");
    const object = objectOf("test/unit/zcl_osd_form_test.clas.testclasses.abap");
    const found = await client.discover(object);
    const testClass = found.classes.find((c) => c.name === "LTCL_FORM");
    expect(testClass.methods.map((m) => m.name)).to.include("A_PAIR");
    const results = outcomes(await client.run(object, "LTCL_FORM", "A_PAIR"));
    expect(results.map((r) => [r.method, r.passed])).to.deep.equal([["A_PAIR", true]]);
  });

  it("an ADT answer names the same generation the child runs", async () => {
    const adt = await call("/core/discovery");
    const odata = await fetch(`${BASE}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
    expect(adt.headers.get("x-osd-generation")).to.equal(odata.headers.get("x-osd-generation"));
  });
});
