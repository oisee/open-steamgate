// Native Unix smoke for one extracted private bundle; writes only a temp SQLite DB.
// Usage: node scripts/release/smoke.mjs /absolute/path/to/extracted-bundle
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomInt} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {createServer, connect} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

if (!process.argv[2] || process.platform === "win32") throw new Error("Pass an extracted Unix bundle on its native host");
const bundle = resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function portFree(port) {
  return await new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", () => resolveResult(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveResult(true)));
  });
}
let instance;
for (let attempt = 0; attempt < 40; attempt++) {
  const candidate = String(randomInt(50, 90));
  const free = await Promise.all([`80${candidate}`, `32${candidate}`, `33${candidate}`].map((p) => portFree(Number(p))));
  if (free.every(Boolean)) {
    instance = candidate; break;
  }
}
if (!instance) throw new Error("No free test instance in 50..89");
const data = mkdtempSync(join(tmpdir(), "osd-bun-smoke-"));
const base = `http://127.0.0.1:80${instance}`;
const service = `${base}/sap/opu/odata/sap/ZSTG_DEMO_SRV`;
let child;
let log = "";
function start() {
  child = spawn("sh", ["run.sh"], {cwd: bundle,
    env: {...process.env, INSTANCE: instance, STG_PORT: `80${instance}`, OSD_DATA_DIR: data, STG_TLS: "0"},
    stdio: ["ignore", "pipe", "pipe"]});
  child.stdout.on("data", (b) => { log = (log + b).slice(-12000); });
  child.stderr.on("data", (b) => { log = (log + b).slice(-12000); });
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`OSD exited before ready:\n${log}`);
    try {
      const r = await fetch(`${base}/sap/bc/adt/core/http/build`, {signal: AbortSignal.timeout(3000)});
      if (r.ok && (await r.json()).system?.serving) return;
    } catch { /* still starting */ }
    await sleep(1000);
  }
  throw new Error(`OSD did not become ready:\n${log}`);
}
async function request(url, options = {}) {
  return fetch(url, {...options, signal: AbortSignal.timeout(10000)});
}
async function listening(port) {
  await new Promise((resolveResult, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(5000, () => socket.destroy(new Error("timeout")));
    socket.once("error", reject);
    socket.once("connect", () => { socket.end(); resolveResult(); });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolveResult) => child.once("exit", resolveResult));
  child.kill("SIGTERM");
  if (await Promise.race([stopped.then(() => true), sleep(10000).then(() => false)]) === false) {
    child.kill("SIGKILL");
    throw new Error(`Launcher did not stop cleanly; test data retained at ${data}`);
  }
}
let clean = false;
try {
  start(); await ready();
  const zork = await request(`${base}/sap/bc/zork`);
  assert.equal(zork.status, 200);
  assert.match(await zork.text(), /<title>ZORK on Off-Stack Doppelganger<\/title>/);
  for (const path of ["/sap/bc/lsd", "/sap/bc/zo4d_demo"]) {
    assert.equal((await request(`${base}${path}`)).status, 200, path);
  }
  assert.ok((await (await request(`${service}/TravelSet?$top=1&$format=json`)).json()).d.results.length);
  await listening(Number(`32${instance}`));
  await listening(Number(`33${instance}`));
  const id = `T${instance}${String(randomInt(0, 100000)).padStart(5, "0")}`;
  const created = await request(`${service}/TravelSet`, {method: "POST",
    headers: {"content-type": "application/json", "x-csrf-token": "open-steamgate"},
    body: JSON.stringify({TravelId: id, Description: "Bun bundle smoke", Status: "A", Seats: 1})});
  assert.equal(created.status, 201, await created.text());
  await stop();
  start(); await ready();
  const saved = await request(`${service}/TravelSet('${id}')?$format=json`);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).d.Description, "Bun bundle smoke");
  await stop();
  clean = true;
  console.log(`PASS instance ${instance}: ADT, OData write/restart, packs, DIAG/RFC listeners`);
} finally {
  if (child?.exitCode === null) await stop();
  if (clean) rmSync(data, {recursive: true});
}
