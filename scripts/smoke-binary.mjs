// Linux release smoke: only the executable and OS files enter the namespace.
// Neither the build checkout nor any of its node_modules can mask missing assets.
import {spawn} from "node:child_process";
import {copyFileSync, mkdtempSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {join, resolve} from "node:path";

const file = process.argv[2];
if (!file || process.platform !== "linux") throw new Error("usage (Linux): node scripts/smoke-binary.mjs <seeded-binary>");
const port = process.env.STG_PORT || await new Promise((done, fail) => {
  const server = createServer();
  server.on("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const {port} = server.address();
    server.close(() => done(String(port)));
  });
});
const scratch = mkdtempSync("/tmp/osd-binary-smoke-");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let child;
let exited;
let log = "";
try {
  copyFileSync(resolve(file), join(scratch, "osd"));
  child = spawn("bwrap", [
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
    for (const path of paths) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {signal: AbortSignal.timeout(3000)});
        if (response.status !== 200 || !(await response.text()).length) ready = false;
      } catch { ready = false; }
    }
    // A supervisor may stay alive after its serving child aborts.
    if (/Aborted\(|ENOENT.*sql-wasm\.wasm/.test(log)) throw new Error(`binary startup aborted\n${log}`);
    if (ready) {
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
