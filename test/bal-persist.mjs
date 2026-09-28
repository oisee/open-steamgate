// Persistence gate for the public CL_BALI_* facade. Runs two OSD processes
// against one disposable SQLite file: write in the first, read in the second.
import {spawn, spawnSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {createServer} from "node:net";
import {join} from "node:path";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "osd-bal-persist-"));
const database = join(scratch, "business.sqlite");
const build = spawnSync("npm", ["run", "-s", "transpile"], {cwd: root, stdio: "inherit"});
if (build.status !== 0) process.exit(build.status ?? 1);

const port = await new Promise((resolve, reject) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const number = probe.address().port;
    probe.close(() => resolve(number));
  }).on("error", reject);
});
const base = `http://127.0.0.1:${port}`;
const env = {...process.env, STG_PORT: String(port), STG_DB: "file", STG_DB_PATH: database};

async function start(client) {
  const child = spawn(process.execPath, ["test/run.mjs"], {
    cwd: root, env: {...env, OSD_CLIENT: client}, stdio: ["ignore", "ignore", "inherit"],
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OSD exited during startup: ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/sap/bc/adt/discovery`);
      if (response.ok) return child;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error("OSD did not start within 120 seconds");
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("OSD did not stop")), 10_000);
    child.once("exit", () => { clearTimeout(deadline); resolve(); });
  });
}

async function classrun(name) {
  const discovery = await fetch(`${base}/sap/bc/adt/discovery`, {headers: {"x-csrf-token": "fetch"}});
  const token = discovery.headers.get("x-csrf-token");
  const cookie = (discovery.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
  if (!token) throw new Error("ADT did not return a CSRF token");
  const response = await fetch(`${base}/sap/bc/adt/oo/classrun/${name}`, {
    method: "POST", headers: {"x-csrf-token": token, cookie},
  });
  const output = await response.text();
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${output}`);
  return output;
}

let child;
try {
  child = await start("123");
  const written = await classrun("ZCL_OSD_BAL_PERSIST_WRITE");
  if (!written.includes("Saved 3 BAL logs:")) throw new Error(`write failed: ${written}`);
  const clientWritten = await classrun("ZCL_OSD_BAL_CLIENT_PROBE");
  if (!clientWritten.includes("client 123 wrote log")) throw new Error(`client write failed: ${clientWritten}`);
  await stop(child);
  child = undefined;

  child = await start("124");
  const denied = await classrun("ZCL_OSD_BAL_CLIENT_PROBE");
  if (!denied.includes("client 124 filter and handle denied")) {
    throw new Error(`cross-client read failed: ${denied}`);
  }
  await stop(child);
  child = undefined;

  child = await start("123");
  const read = await classrun("ZCL_OSD_BAL_PERSIST_READ");
  for (const expected of [
    "OSD_RESTART_OK1: 3 items, final S",
    "OSD_RESTART_OK2: 3 items, final S",
    "OSD_RESTART_ERR: 3 items, final E",
  ]) {
    if (!read.includes(expected)) throw new Error(`read after restart missing ${expected}: ${read}`);
  }
  if (read.includes("BAL read failed")) throw new Error(read);
  const clientRead = await classrun("ZCL_OSD_BAL_CLIENT_PROBE");
  if (!clientRead.includes("client 123 read succeeded")) {
    throw new Error(`client read after restart failed: ${clientRead}`);
  }
  console.log("BAL persistence: 3 logs and 9 items survived process restart; client isolation verified");
} finally {
  if (child) await stop(child);
  rmSync(scratch, {recursive: true, force: true});
}
