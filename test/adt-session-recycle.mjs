import {expect} from "chai";
import express from "express";
import {cpSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";

const BASE = "/sap/bc/adt";
const OBJECT = BASE + "/programs/programs/zosd_recycle";
const SOURCE = "REPORT zosd_recycle.\nWRITE 'before'.\n";
const mode = process.env.OSD_ADT_ONE_RUNTIME ?? "0";

for (const profile of ["file", "sqlite"]) describe(`ADT editing session across cold publication (mode ${mode}, ${profile})`, function () {
  this.timeout(180000);
  let root, store, runtime, server, base;
  const request = async (method, path, headers = {}, body) => {
    const response = await fetch(base + path, {method, headers, body, signal: AbortSignal.timeout(120000)});
    return {status: response.status, headers: response.headers, body: await response.text()};
  };
  const login = async () => {
    const response = await request("HEAD", BASE + "/core/discovery", {
      "x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful",
    });
    expect(response.status).to.equal(200);
    return {cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
      "x-csrf-token": response.headers.get("x-csrf-token"), "x-sap-adt-sessiontype": "stateful"};
  };
  const lock = async headers => {
    const response = await request("POST", OBJECT + "?_action=LOCK&accessMode=MODIFY", headers);
    expect(response.status, response.body).to.equal(200);
    return /<LOCK_HANDLE>([^<]+)/.exec(response.body)[1];
  };
  const put = (headers, handle, source) => request("PUT", OBJECT + `/source/main?lockHandle=${handle}`,
    {...headers, "content-type": "text/plain"}, source);
  const unlock = (headers, handle) => request("POST", OBJECT + `?_action=UNLOCK&lockHandle=${handle}`, headers);

  before(async () => {
    // Isolate both the published generation and the database. No suite's
    // activation may replace the output used by another suite.
    root = mkdtempSync(join(tmpdir(), "adt-session-recycle-"));
    for (const folder of ["src", "gen"]) cpSync(resolve(folder), join(root, folder), {recursive: true});
    for (const folder of ["test", "tools", "data", "packs", "webapp", "node_modules"]) {
      symlinkSync(resolve(folder), join(root, folder), "dir");
    }
    mkdirSync(join(root, ".local"));
    symlinkSync(resolve(".local/lars"), join(root, ".local/lars"), "dir");
    for (const file of ["abap_transpile.json", "abaplint.jsonc", "libs.lock.json", "package.json"]) {
      copyFileSync(resolve(file), join(root, file));
    }
    store = new ObjectStore({root, build: {generators: false}});
    store.warm().on = false;
    expect((await store.transpile()).ok).to.equal(true);
    store.buildOptions.generators = true;
    runtime = new ServingRuntime({root, env: {OSD_ADT_ONE_RUNTIME: mode, STG_DB: profile,
      STG_DB_PATH: profile === "file" ? join(root, "session.sqlite") : "", STG_TLS: "0", OSD_UNIT_WARM: "0",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${resolve("test/helpers/a9-child.mjs")}`].filter(Boolean).join(" ")}});
    store.served = runtime;
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store, watch: false, logMisses: false,
      abap: mode === "1" ? abapRunner({remote: runtime}) : await adtAbap()}).router);
    server = await new Promise(resolve => {const s = app.listen(0, "127.0.0.1", () => resolve(s));});
    server.keepAliveTimeout = 120000;
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await runtime?.stop();
    store?.unwatch();
    if (root) rmSync(root, {recursive: true, force: true});
  });

  for (const next of ["UNLOCK", "PUT"]) it(`keeps cookies, CSRF token and original handle for ${next} after a real cold activation`, async () => {
    const headers = await login();
    for (const [collection, name, element] of [["programs/programs", "ZOSD_RECYCLE", "program:program"], ["oo/classes", "ZOSD_RECYCLE_PEER", "class:class"]]) {
      const created = await request("POST", BASE + "/" + collection, {...headers, "content-type": "application/xml"},
        `<${element} xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}"><adtcore:packageRef adtcore:name="$TMP"/></${element}>`);
      expect(created.status, created.body).to.equal(201);
    }
    const handle = await lock(headers);
    const source = SOURCE.replace("before", next.toLowerCase());
    expect((await put(headers, handle, source)).status).to.equal(200);
    // The acceptance run's cleanup lists schema-drift databases. An
    // unchanged file schema masks a dropped carry by retaining its rows.
    // Add real DDIC input so this cold build must use the carry, as an
    // in-memory boot always does. No database/session response is mocked.
    const table = `zrecycle_${next.toLowerCase()}`;
    writeFileSync(join(root, "src/ddic", table + ".tabl.xml"),
      readFileSync(resolve("src/ddic/zstg_demo.tabl.xml"), "utf8").replaceAll("ZSTG_DEMO", table.toUpperCase()));
    const pid = runtime.child.pid;
    const driftCount = () => readdirSync(root).filter(name => name.startsWith("session.sqlite.") && name.endsWith(".drift")).length;
    const beforeDrift = driftCount();
    const activation = await request("POST", BASE + "/activation?method=activate", {...headers, "content-type": "application/xml"},
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${OBJECT}"/></adtcore:objectReferences>`);
    expect(activation.status, activation.body).to.equal(200);
    expect(activation.body, activation.body).to.contain('generationExecuted="true"');
    expect(activation.headers.get("x-osd-build")).to.match(/^cold/);
    expect(runtime.child.pid, "cold publication replaced the serving child").to.not.equal(pid);
    if (profile === "file") expect(driftCount(), "the new schema replaced the file database").to.equal(beforeDrift + 1);
    expect(store.read("PROG", "ZOSD_RECYCLE", "main", "active").source).to.equal(source);
    try {
      const response = next === "UNLOCK" ? await unlock(headers, handle) : await put(headers, handle, source + "* continued\n");
      const afterUnlock = next === "UNLOCK" ? await put(headers, handle, source + "* released\n") : undefined;
      expect(response.status, response.body).to.equal(200);
      expect(response.headers.get("x-csrf-token")).to.equal(headers["x-csrf-token"]);
      if (next === "UNLOCK") {
        expect(afterUnlock.status, afterUnlock.body).to.equal(409);
        expect(store.read("PROG", "ZOSD_RECYCLE").source).to.equal(source);
      } else {
        const peer = await login();
        expect((await put(peer, handle, source + "* foreign\n")).status).to.equal(409);
        expect(store.read("PROG", "ZOSD_RECYCLE").source).to.equal(source + "* continued\n");
        expect((await unlock(peer, handle)).status).to.equal(200);
        expect((await put(headers, handle, source + "* still owned\n")).status).to.equal(200);
        await request("GET", "/sap/public/bc/icf/logoff", peer);
      }
    } finally {
      await request("GET", "/sap/public/bc/icf/logoff", headers);
    }
    const beforeDead = store.read("PROG", "ZOSD_RECYCLE").source;
    expect((await put(headers, handle, source + "* dead\n")).status).to.equal(403);
    await runtime.recycle();
    expect((await put(headers, handle, source + "* resurrected\n")).status).to.equal(403);
    expect(store.read("PROG", "ZOSD_RECYCLE").source).to.equal(beforeDead);
    const fresh = await login();
    const taken = await lock(fresh);
    expect((await put(fresh, taken, source)).status).to.equal(200);
    expect((await request("DELETE", OBJECT, fresh)).status).to.equal(200);
    expect((await request("DELETE", BASE + "/oo/classes/zosd_recycle_peer", fresh)).status).to.equal(200);
    await request("GET", "/sap/public/bc/icf/logoff", fresh);
  });

  it("expiry during a recycle ends the session and ownership instead of renewing them", async () => {
    const headers = await login();
    const created = await request("POST", BASE + "/programs/programs", {...headers, "content-type": "application/xml"},
      '<program:program xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZOSD_RECYCLE"><adtcore:packageRef adtcore:name="$TMP"/></program:program>');
    expect(created.status, created.body).to.equal(201);
    const handle = await lock(headers);
    const source = store.read("PROG", "ZOSD_RECYCLE").source;
    const id = /sap-contextid=([0-9a-f]{24})/.exec(headers.cookie)[1];
    const sql = `UPDATE zosd_adt_sess SET touched = '20000101000000' WHERE id = '${id}'`;
    if (mode === "1") {
      // The existing fixture door executes SQL in the child's dialog step.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error("expiry fixture timed out")), 15000);
        const receive = message => {
          if (message?.type === "a9-answer" && message.id === 1) finish(message.error ? new Error(message.error) : undefined);
        };
        const finish = error => {clearTimeout(timer); runtime.child.off("message", receive); error ? reject(error) : resolve();};
        runtime.child.on("message", receive);
        runtime.child.send({type: "a9-sql", id: 1, sql});
      });
    } else {
      await dialogStep(() => globalThis.abap.context.databaseConnections.DEFAULT.execute(sql), "expiry fixture");
    }
    await runtime.recycle();
    expect((await put(headers, handle, source + "* expired\n")).status).to.equal(403);
    expect(store.read("PROG", "ZOSD_RECYCLE").source).to.equal(source);
    const peer = await login();
    const taken = await lock(peer);
    expect((await put(peer, taken, SOURCE)).status).to.equal(200);
    expect((await request("DELETE", OBJECT, peer)).status).to.equal(200);
    await request("GET", "/sap/public/bc/icf/logoff", peer);
  });
});
