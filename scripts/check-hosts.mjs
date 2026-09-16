// Every way OSD is packaged, put through the same questions (SP4's control
// group, docs/bun-spike.md part four). A host is a command that answers the
// modes of bin/osd.mjs: the source under node, a bundle under node, a Bun
// binary, a Node single executable.
//
//   node scripts/check-hosts.mjs '["node","bin/osd.mjs"]' '["build/osd"]' …
//
// Per host: the generation it names, what a bundle did to the runtime class
// names, a workbench that serves OData, and Zork — one socket to the push
// channel, thirty-six commands, thirty-three expectations, which is the only
// test here that exercises the channel, a stateful handler, the Z-machine
// and a story file out of SMW0 at once.
import {execFileSync, spawn} from "node:child_process";
import {existsSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {parseScript, speedrun} from "../tools/zork-speedrun.mjs";

const root = process.cwd();
const SCRIPT = process.env.ZORK_SCRIPT ?? ".local/cpm-abap/test-games/MINIZORK_TEST.TXT";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(self) {
  const [cmd, ...prefix] = self;
  const name = self.join(" ");
  const row = {host: name};
  if (cmd !== "node" && cmd !== process.execPath && !existsSync(join(root, cmd))) {
    return {...row, note: "not built"};
  }
  try {
    row.doctor = /renamed by the bundle: (\d+)/.exec(execFileSync(cmd, [...prefix, "doctor"], {encoding: "utf8", cwd: root, timeout: 120000}))?.[1] ?? "?";
    row.generation = execFileSync(cmd, [...prefix, "build", "hash"], {encoding: "utf8", cwd: root, timeout: 600000}).trim().split(/\s+/).pop();
  } catch (error) {
    return {...row, note: `mode failed: ${String(error.message).split("\n")[0].slice(0, 60)}`};
  }
  const port = 3110 + Math.floor(Math.random() * 80);
  const database = join(root, ".local", "db", `check-${process.pid}-${port}.sqlite`);
  const child = spawn(cmd, [...prefix, "up"], {cwd: root, env: {...process.env, STG_PORT: String(port), STG_DB_PATH: database, STG_ADT_SID: "OSZ"}, stdio: ["ignore", "pipe", "pipe"]});
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 120000 && !ok) {
      ok = await fetch(`${base}/sap/opu/odata/sap/ZOSD_TEST_SRV/ItemSet?$top=1&$format=json`).then((r) => r.ok).catch(() => false);
      if (!ok) {
        await sleep(250);
      }
    }
    row.startMs = Date.now() - t0;
    row.odata = ok ? "ok" : "FAILED";
    if (ok && existsSync(SCRIPT)) {
      const result = await speedrun(base, parseScript(readFileSync(SCRIPT, "utf8")), {quiet: true});
      row.zork = result.failures.length === 0 ? `${result.checks}/${result.checks}` : `${result.checks - result.failures.length}/${result.checks}`;
      row.zorkMs = result.ms;
      if (result.failures.length > 0) {
        row.note = result.failures.map((f) => f.expect).join(", ").slice(0, 60);
      }
    } else if (ok) {
      row.zork = "no script";
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(8000).then(() => child.kill("SIGKILL"))]);
    for (const s of ["", "-wal", "-shm"]) {
      rmSync(database + s, {force: true});
    }
  }
  if (row.odata === "FAILED") {
    row.note = log.split("\n").filter((l) => /error|Error/.test(l))[0]?.slice(0, 60) ?? "no answer";
  }
  return row;
}

const hosts = process.argv.slice(2).map((a) => JSON.parse(a));
const rows = [];
for (const host of hosts) {
  process.stderr.write(`checking ${host.join(" ")} …\n`);
  rows.push(await check(host));
}
console.table(rows);
process.exit(rows.some((r) => r.odata === "FAILED" || (r.zork && !/^(\d+)\/\1$/.test(r.zork) && r.zork !== "no script")) ? 1 : 0);
