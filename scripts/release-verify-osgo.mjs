#!/usr/bin/env node
// Exercise the release executable from an empty working and data directory.
import {spawn} from "node:child_process";
import {mkdtempSync, rmSync, statSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const [name, tag, commit] = process.argv.slice(2);
if (!name || !tag || !commit) throw new Error("usage: release-verify-osgo.mjs <binary> <tag> <commit>");
const binary = resolve(name);
const scratch = mkdtempSync(join(tmpdir(), "osgo-release-"));
const home = join(scratch, "home");
const port = await new Promise((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const number = server.address().port;
    server.close(() => done(number));
  });
});
const args = ["-port", String(port), "-home", home, "-root", scratch];
const start = performance.now();
const child = spawn(binary, args, {cwd: scratch, stdio: ["ignore", "ignore", "pipe"]});
let log = "";
let exited;
child.stderr.on("data", (data) => { log = (log + data).slice(-4000); });
child.on("error", (error) => { exited = error.message; });
child.on("exit", (code, signal) => { exited = `${code ?? signal}`; });
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  const version = await new Promise((done, fail) => {
    const proc = spawn(binary, ["-version"], {cwd: scratch});
    let output = "";
    proc.stdout.on("data", (data) => { output += data; });
    proc.on("error", fail);
    proc.on("exit", (code) => code === 0 ? done(output.trim()) : fail(new Error(`-version exited ${code}`)));
  });
  if (version !== `osgo ${tag} (${commit})`) throw new Error(`wrong version: ${version}`);
  let ready;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline && exited === undefined) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        ready = await response.json();
        break;
      }
    } catch { /* still booting */ }
    await wait(250);
  }
  if (ready?.status !== "ready" || ready.version !== tag || ready.commit !== commit) {
    throw new Error(`readiness failed: ${JSON.stringify(ready)}; exited ${exited}; ${log}`);
  }
  const startMs = Math.round(performance.now() - start);
  const url = `${base}/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json`;
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok || !body.includes("Travel")) {
    throw new Error(`demo OData request returned ${response.status}: ${body.slice(0, 500)}`);
  }
  const db = join(home, "osgo.sqlite");
  if (statSync(db).size === 0) throw new Error("the fresh home has an empty database");
  console.log(JSON.stringify({ready: true, startMs, database: db, odataStatus: response.status}));
} finally {
  if (exited === undefined) child.kill("SIGTERM");
  await wait(200);
  if (exited === undefined) child.kill("SIGKILL");
  rmSync(scratch, {recursive: true, force: true});
}
