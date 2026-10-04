// Capture each consumer command without hiding its exit status. Keep results
// outside transpiler input folders; summary also works after setup failures.
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = join(root, ".local", "consumer-smoke-results");
const checks = {
  sqlite: {file: "slice", timeoutMs: 8 * 60_000, env: {SLICE_SKIP_UI: "1", SLICE_L2_DRIFT: "warn"}},
  duckdb: {file: "slice", timeoutMs: 8 * 60_000, env: {SLICE_SKIP_UI: "1", SLICE_L2_DRIFT: "warn", STG_DB: "duckdb"}},
  cli: {file: "cli", env: {}},
  jobs: {file: "jobs", env: {}},
  l3: {file: "l3", env: {}},
  iti: {file: "iti", env: {}},
};
const repro = (check) => ['OSD_HOME="/absolute/path/to/open-steamgate"', ...Object.entries(check.env).map(([k, v]) => `${k}=${v}`), `node test/${check.file}.mjs`].join(" ");

// Consumer scripts (including npm lifecycle scripts) cannot write runner command
// files or obtain Actions service tokens. All forwarded bytes share one fenced
// stream, including stderr, so the resume marker follows all consumer output.
export async function runConsumer(command, args, {env = process.env, cwd = process.cwd(),
  timeoutMs = 6 * 60_000, log, output = process.stdout} = {}) {
  const safeEnv = Object.fromEntries(Object.entries(env).filter(([name]) =>
    !/^GITHUB_(STEP_SUMMARY|ENV|OUTPUT|PATH|STATE)$|^ACTIONS_/i.test(name)));
  // npm install/ci must forward dependency lifecycle output into the fence,
  // even when the caller configures npm to run those scripts in the background.
  safeEnv.npm_config_foreground_scripts = "true";
  // Our own .npmrc sets ignore-scripts, and `npm run` exports it to children
  // as npm_config_ignore_scripts. The consumer's install follows its own
  // configuration, not ours, so the inherited setting is dropped.
  for (const name of Object.keys(safeEnv)) if (/^npm_config_ignore_scripts$/i.test(name)) delete safeEnv[name];
  const token = randomUUID();
  const start = performance.now();
  let timedOut = false;
  let spawnFailed = false;
  writeFileSync(log, "");
  output.write(`::stop-commands::${token}\n`);
  try {
    return await new Promise((done) => {
      const child = spawn(command, args, {
        cwd, env: safeEnv, detached: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        appendFileSync(log, `timeout after ${timeoutMs} ms\n`);
        // A detached POSIX child leads a process group; kill npm/transpilers,
        // servers and grandchildren together, even if the leader has exited.
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }, timeoutMs);
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => { appendFileSync(log, chunk); output.write(chunk); });
      }
      child.on("error", (error) => {
        spawnFailed = true;
        appendFileSync(log, `${error.message}\n`);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        done({code: timedOut ? 124 : (spawnFailed ? 1 : (code ?? 1)), signal, timedOut,
          seconds: (performance.now() - start) / 1000});
      });
    });
  } finally {
    // The consumer's last line may lack a newline.
    output.write(`\n::${token}::\n`);
  }
}

async function main() {
  const [mode, key] = process.argv.slice(2);
  if (mode === "pin") {
    const pin = JSON.parse(readFileSync(join(root, "consumers.lock.json"), "utf8"))["osg-demo"];
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin?.repo ?? "") || !/^[0-9a-f]{40}$/.test(pin?.ref ?? "")) {
      throw new Error("consumers.lock.json: osg-demo needs a GitHub repository and a full commit SHA");
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `repo=${pin.repo}\nref=${pin.ref}\n`);
  } else if (mode === "run" || mode === "install") {
    const check = checks[key];
    if (mode === "run" && !check) throw new Error(`Unknown consumer check: ${key}`);
    if (!process.env.OSD_HOME) throw new Error("OSD_HOME must name the runtime checkout");
    if (mode === "install" && !existsSync("package.json")) {
      console.log("Pinned consumer has no package.json: no npm dependencies to install.");
      return;
    }
    mkdirSync(results, {recursive: true});
    const name = mode === "install" ? "install" : key;
    const record = await runConsumer(mode === "install" ? "npm" : process.execPath,
      mode === "install" ? ["ci"] : [`test/${check.file}.mjs`], {
        env: {...process.env, ...check?.env}, timeoutMs: check?.timeoutMs,
        log: join(results, `${name}.log`),
      });
    writeFileSync(join(results, `${name}.json`), `${JSON.stringify(record)}\n`);
    process.exitCode = record.code;
  } else if (mode === "summary") {
    const lines = ["## Consumer smoke (advisory)", "", "| Step | Result | Time |", "| --- | --- | ---: |"];
    const failures = [];
    const drift = [];
    for (const [name, check] of Object.entries(checks)) {
      const path = join(results, `${name}.json`);
      const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
      lines.push(`| ${name} | ${record ? (record.timedOut ? "timeout" : (record.code === 0 ? "pass" : "fail")) : "not run (setup/cancellation)"} | ${record ? `${record.seconds.toFixed(1)} s` : "—"} |`);
      if (record?.code !== 0) failures.push([name, check]);
      const log = join(results, `${name}.log`);
      if (existsSync(log)) {
        for (const line of readFileSync(log, "utf8").split(/\r?\n/)) {
          if (/drift/i.test(line)) drift.push(`[${name}] ${line}`);
        }
      }
    }
    lines.push("", "## Consumer impact", "");
    if (drift.length) {
      lines.push("generator output changed for consumers:", "", "~~~~text", ...drift.map((line) => line.replaceAll("~", "&#126;")), "~~~~", "");
    } else lines.push("No L2 drift warnings captured.", "");
    for (const [name, check] of failures) {
      lines.push(`Reproduce ${name} from the pinned osg-demo checkout (Node 24; Go 1.26 for cli; cc for iti):`, "", "```sh", repro(check), "```", "");
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  } else {
    throw new Error("usage: node tools/consumer-smoke.mjs pin|install|run <check>|summary");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
