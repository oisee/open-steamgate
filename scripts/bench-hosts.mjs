// The same workbench under different hosts, timed (docs/bun-spike.md part
// four): cold start to the ADT façade and to the serving child, a forced
// build, a hundred OData reads, and memory. Usage:
//   node scripts/bench-hosts.mjs '["build/osd"]' '["node","build/osd-node/osd.mjs"]' '["build/osd-sea"]'
import {execFileSync, spawn} from "node:child_process";
import {rmSync} from "node:fs";
import {join} from "node:path";

const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (probe, limit = 120000) => {
  const t0 = performance.now();
  while (performance.now() - t0 < limit) {
    if (await probe().catch(() => false)) {
      return performance.now() - t0;
    }
    await sleep(25);
  }
  return NaN;
};
const rss = (pid) => {
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {encoding: "utf8"})) / 1024;
  } catch {
    return NaN;
  }
};

async function bench(self) {
  const [cmd, ...prefix] = self;
  const port = 3200 + Math.floor(Math.random() * 300);
  const database = join(root, ".local", "db", `bench-${process.pid}-${port}.sqlite`);
  const base = `http://127.0.0.1:${port}`;
  const odata = `${base}/sap/opu/odata/sap/ZOSD_TEST_SRV/ItemSet?$top=5&$format=json`;
  const t0 = performance.now();
  const child = spawn(cmd, [...prefix, "up"], {cwd: root, env: {...process.env, STG_PORT: String(port), STG_DB_PATH: database, STG_ADT_SID: "OSY"}, stdio: ["ignore", "pipe", "pipe"]});
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const out = {host: self.join(" ")};
  try {
    out.adtMs = Math.round(await until(async () => (await fetch(`${base}/sap/bc/adt/discovery`)).ok));
    out.odataMs = Math.round(await until(async () => (await fetch(odata)).ok) + out.adtMs);
    const times = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      const r = await fetch(odata);
      await r.text();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    out.readP50Ms = times[50].toFixed(1);
    out.readP95Ms = times[95].toFixed(1);
    out.parentRssMb = Math.round(rss(child.pid));
    const childPid = /serving generation \w+ on http:\/\/127\.0\.0\.1:\d+ \((\d+)\)/.exec(log)?.[1];
    out.childRssMb = childPid ? Math.round(rss(childPid)) : NaN;
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    for (const s of ["", "-wal", "-shm"]) {
      rmSync(database + s, {force: true});
    }
  }
  const tb = performance.now();
  execFileSync(cmd, [...prefix, "build", "--force", "--no-switch"], {cwd: root, stdio: "pipe"});
  out.forcedBuildMs = Math.round(performance.now() - tb);
  return out;
}

const rows = [];
for (const arg of process.argv.slice(2)) {
  rows.push(await bench(JSON.parse(arg)));
}
console.table(rows);
