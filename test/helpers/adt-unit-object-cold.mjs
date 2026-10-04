// A fresh workbench process for both the latency regression and the benchmark.
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {performance} from "node:perf_hooks";

const helper = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function coldUnitObject({mode = process.env.OSD_ADT_ONE_RUNTIME ?? "0",
  name = "ZCL_STG_SEGW_TEST", profile, timeoutMs = 120000} = {}) {
  const started = performance.now();
  const child = spawn(process.execPath, [helper, "--server"], {
    env: {...process.env, STG_SERVE: "child", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0",
      OSD_ADT_ONE_RUNTIME: String(mode), OSD_UNIT_WARM: "1", OSD_BIND: "127.0.0.1"},
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let tail = "";
  const log = data => {tail = (tail + data).slice(-12000);};
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  const command = (action, path) => new Promise((resolve, reject) => {
    const listen = message => {
      if (message.action !== action) return;
      child.off("message", listen);
      if (message.error) reject(new Error(message.error)); else resolve(message);
    };
    child.on("message", listen);
    child.send({action, path});
  });
  const base = `http://127.0.0.1:${process.env.STG_PORT ?? 3030}`;
  try {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${tail}`);
      if (performance.now() - started > timeoutMs) throw new Error(`readiness timed out: ${tail}`);
      try {
        const response = await fetch(base + "/osd/serving", {signal: AbortSignal.timeout(2000)});
        const body = await response.json();
        if (body.ready === true && body.generation !== undefined) break;
      } catch { /* The listening socket and runtime boot independently. */ }
      await sleep(25);
    }
    const readyMs = performance.now() - started;
    if (profile) await command("profile-start");
    const request = async () => {
      const at = performance.now();
      const response = await fetch(base + `/sap/bc/adt/core/http/unit/object?type=CLAS&name=${encodeURIComponent(name)}`,
        {signal: AbortSignal.timeout(timeoutMs)});
      const body = await response.json();
      const ms = performance.now() - at;
      if (response.status !== 200 || body.riskError || !body.classes?.length)
        throw new Error(`unit object ${response.status}: ${JSON.stringify(body)}; ${tail}`);
      return {ms, body};
    };
    const first = await request();
    if (profile) await command("profile-stop", profile);
    const warm = await request();
    return {mode: String(mode), readyMs, firstMs: first.ms, warmMs: warm.ms,
      classes: first.body.classes.length, writesTotal: first.body.writesTotal, log: tail};
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.send({action: "stop"});
      const kill = setTimeout(() => child.kill("SIGKILL"), 10000);
      try {await exited;} finally {clearTimeout(kill);}
    }
  }
}

if (process.argv[2] === "--server") {
  // Same startup settings and entry point as test/run.mjs; retain the server
  // handle so every benchmark shuts down its supervised runtime before the next.
  const {Session} = await import("node:inspector");
  const {writeFileSync} = await import("node:fs");
  const session = new Session();
  const post = (method, params = {}) => new Promise((resolve, reject) =>
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  const {startServer} = await import("../start.mjs");
  const server = startServer();
  process.on("message", async ({action, path}) => {
    try {
      if (action === "stop") {await server.close(); process.exit(0);}
      if (action === "profile-start") {
        session.connect();
        await post("Profiler.enable");
        await post("Profiler.start");
      }
      if (action === "profile-stop") {
        const {profile} = await post("Profiler.stop");
        writeFileSync(path, JSON.stringify(profile));
        session.disconnect();
      }
      process.send({action});
    } catch (error) {process.send({action, error: String(error.stack ?? error)});}
  });
}
