// The workbench shape, end to end: the way a server is started (test/run.mjs)
// puts the system in a child, and this process holds no ABAP. Everything a
// client reaches must still be there — through a proxy or a door.
import {expect} from "chai";
import {spawn} from "node:child_process";
import {services} from "../tools/osd-icf.mjs";

const PORT = Number(process.env.STG_PORT ?? 3091) + 7;
const BASE = `http://localhost:${PORT}`;
const ADT = `${BASE}/sap/bc/adt`;

describe("test/run.mjs: the workbench shape, one generation and one database", function () {
  this.timeout(180000);
  let child;
  let token;
  let cookie;
  const log = [];

  before(async () => {
    child = spawn(process.execPath, ["test/run.mjs"], {
      env: {...process.env, STG_PORT: String(PORT), STG_TLS: "0", STG_SERVE: undefined},
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
  });
  after(() => {
    child?.kill("SIGTERM");
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

  it("an ADT answer names the same generation the child runs", async () => {
    const adt = await call("/core/discovery");
    const odata = await fetch(`${BASE}/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata`);
    expect(adt.headers.get("x-osd-generation")).to.equal(odata.headers.get("x-osd-generation"));
  });
});
