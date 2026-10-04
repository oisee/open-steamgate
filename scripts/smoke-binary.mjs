// Linux release smoke: only the executable and OS files enter the namespace.
// Neither the build checkout nor any of its node_modules can mask missing assets.
import {spawn} from "node:child_process";
import {copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

// /osd/serving reports the runtime PID inside bwrap's private namespace.
// Match NSpid, then walk host PPids to prove it belongs to our child.
function ownsServingPid(child, pid) {
  if (!Number.isInteger(pid) || pid <= 0 || child.exitCode !== null || child.signalCode !== null) return false;
  const processes = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      processes.set(Number(entry), {
        parent: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),
        pid: Number(status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).at(-1)),
        alive: !/^State:\s+[ZX]/m.test(status),
      });
    } catch { /* A process can exit while /proc is read. */ }
  }
  if (!processes.get(child.pid)?.alive) return false;
  for (const [hostPid, state] of processes) {
    if (state.pid !== pid || !state.alive) continue;
    let ancestor = hostPid;
    const seen = new Set();
    while (ancestor && !seen.has(ancestor)) {
      if (ancestor === child.pid) return true;
      seen.add(ancestor);
      ancestor = processes.get(ancestor)?.parent;
    }
  }
  return false;
}

const freePort = (port = 0) => new Promise((done, fail) => {
  const server = createServer();
  server.on("error", fail);
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? fail(error) : done(address.port));
  });
});

export async function smokeBinary(file, {spawnChild = spawn} = {}) {
  if (!file || process.platform !== "linux") throw new Error("usage (Linux): node scripts/smoke-binary.mjs <seeded-binary>");
  const port = await freePort();
  const scratch = mkdtempSync("/tmp/osd-binary-smoke-");
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  let child;
  let exited;
  let log = "";
  try {
    copyFileSync(resolve(file), join(scratch, "osd"));
    await freePort(port); // Refuse an occupied port immediately before spawning.
    child = spawnChild("bwrap", [
      "--die-with-parent", "--unshare-pid",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/etc", "/etc", "--proc", "/proc", "--dev", "/dev",
      "--bind", scratch, "/tmp", "--chdir", "/tmp", "--", "/tmp/osd", "up",
    ], {
      cwd: scratch,
      env: {PATH: "/usr/bin:/bin", HOME: "/tmp/home", XDG_DATA_HOME: "/tmp/data", STG_PORT: String(port)},
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => { log = (log + data).slice(-16000); });
    child.stderr.on("data", (data) => { log = (log + data).slice(-16000); });
    child.on("exit", (code, signal) => { exited = {code, signal}; });
    child.on("error", (error) => { exited = {error: error.message}; });
    const paths = ["/osd/serving", "/sap/bc/adt/core/discovery"];
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline && exited === undefined) {
      let ready = true;
      let servingPid;
      for (const path of paths) {
        let response;
        let body;
        try {
          response = await fetch(`http://127.0.0.1:${port}${path}`, {signal: AbortSignal.timeout(3000)});
          body = await response.text();
        } catch { ready = false; }
        if (response?.status !== 200 || !body?.length) { ready = false; continue; }
        if (path === "/osd/serving") {
          let serving;
          try { serving = JSON.parse(body); } catch { /* Fail identity below. */ }
          if (serving?.ready === false) { ready = false; continue; }
          servingPid = serving?.pid;
          if (!ownsServingPid(child, servingPid)) throw new Error("binary smoke: /osd/serving answered from a foreign or dead process");
        }
      }
      // A supervisor may stay alive after its serving child aborts.
      if (/Aborted\(|ENOENT.*sql-wasm\.wasm/.test(log)) throw new Error(`binary startup aborted\n${log}`);
      if (ready) {
        if (exited !== undefined || !ownsServingPid(child, servingPid)) throw new Error("binary smoke: child exited before readiness was verified");
        console.log(`binary smoke: ${paths.join(" and ")} both HTTP 200; isolated checkout, empty HOME/XDG_DATA_HOME`);
        break;
      }
      await sleep(500);
    }
    if (exited !== undefined || Date.now() >= deadline) {
      throw new Error(`binary did not become ready (${JSON.stringify(exited ?? "timeout")})\n${log}`);
    }
  } finally {
    // Signal only the PID we spawned. The private PID namespace and
    // --die-with-parent also reap serving/build children, including on failure.
    if (child?.pid && exited === undefined) {
      child.kill("SIGTERM");
      for (let i = 0; i < 50 && exited === undefined; i++) await sleep(100);
      if (exited === undefined) child.kill("SIGKILL");
      for (let i = 0; i < 50 && exited === undefined; i++) await sleep(100);
    }
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await smokeBinary(process.argv[2]);
}
