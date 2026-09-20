#!/usr/bin/env node
// Choose one free SAP-shaped test instance without touching a live showcase.
import {randomInt} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RANGE = Array.from({length: 40}, (_, index) => index + 50);

export function portsFor(instance) {
  if (!Number.isInteger(instance) || instance < 50 || instance > 89) {
    throw new RangeError("E2E instance must be 50..89");
  }
  return {
    localHttp: 3000 + instance,
    diag: 3200 + instance,
    rfc: 3300 + instance,
    publicHttp: 8000 + instance,
    https: 44300 + instance,
  };
}

function shuffledInstances() {
  const result = [...RANGE];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function bindable(port, host, ipv6Only = false) {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", (error) => resolveResult(ipv6Only && error.code === "EAFNOSUPPORT"));
    server.listen({port, host, ipv6Only, exclusive: true}, () => server.close(() => resolveResult(true)));
  });
}

export async function freePorts(instance, canBind = bindable) {
  for (const port of Object.values(portsFor(instance))) {
    // Separate IPv4 and IPv6 checks catch listeners bound to either family.
    if (!await canBind(port, "0.0.0.0") || !await canBind(port, "::", true)) return false;
  }
  return true;
}

function lockPath(instance) {
  return join(tmpdir(), `osd-e2e-instance-${instance}.lock`);
}

function acquire(instance) {
  const path = lockPath(instance);
  if (existsSync(path)) {
    // An interrupted run may leave its own lock. Reclaim only when its PID
    // is certainly gone; never remove a lock held by another live process.
    try {
      const pid = Number(readFileSync(join(path, "pid"), "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
      try { process.kill(pid, 0); return undefined; }
      catch (error) { if (error.code !== "ESRCH") return undefined; }
      rmSync(path, {recursive: true, force: true});
    } catch { return undefined; }
  }
  try {
    mkdirSync(path);
    writeFileSync(join(path, "pid"), String(process.pid));
    return path;
  } catch { return undefined; }
}

export async function selectInstance(order = shuffledInstances()) {
  for (const instance of order) {
    const lock = acquire(instance);
    if (lock === undefined) continue;
    if (await freePorts(instance)) return {instance, lock, ports: portsFor(instance)};
    rmSync(lock, {recursive: true, force: true});
  }
  throw new Error("No free E2E instance in 50..89 (30NN/32NN/33NN/80NN/443NN)");
}

async function run(args) {
  const remaining = shuffledInstances();
  while (remaining.length > 0) {
    const selected = await selectInstance(remaining);
    remaining.splice(remaining.indexOf(selected.instance), 1);
    const {instance, lock, ports} = selected;
    const env = {...process.env,
      OSD_INSTANCE: String(instance),
      STG_PORT: String(ports.localHttp),
      STG_TLS_PORT: String(ports.https),
      STG_TLS: process.env.STG_TLS ?? "0",
      STG_DB: process.env.STG_DB ?? "sqlite",
    };
    if (env.STG_DB === "file" && !env.STG_DB_PATH) env.STG_DB_PATH = join(lock, "osd.sqlite");
    if (env.STG_DB === "sqlite") env.STG_DB_PATH = "";
    console.log(`E2E instance ${instance}: HTTP ${ports.localHttp}, DIAG ${ports.diag}, RFC ${ports.rfc}, public HTTP ${ports.publicHttp}, HTTPS ${ports.https}`);
    let output = "";
    const child = spawn(join(ROOT, "node_modules/.bin/playwright"), ["test", ...args], {
      cwd: ROOT, env, stdio: ["inherit", "pipe", "pipe"],
    });
    const relay = (source, destination) => source.on("data", (chunk) => {
      destination.write(chunk);
      output = (output + chunk.toString()).slice(-16000);
    });
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    const forward = (signal) => child.kill(signal);
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    const code = await new Promise((done) => {
      child.once("error", (error) => { output += String(error); done(1); });
      child.once("exit", (status) => done(status ?? 1));
    });
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
    rmSync(lock, {recursive: true, force: true});
    if (code === 0) return 0;
    if (!/EADDRINUSE/.test(output)) return code;
    console.error(`E2E instance ${instance} was taken during startup; trying another one`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"))
    .then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
