// Capture each consumer command without hiding its exit status. Keep results
// outside transpiler input folders; summary also works after setup failures.
import {spawn} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = join(root, ".local", "consumer-smoke-results");
const checks = {
  sqlite: {file: "slice", env: {SLICE_SKIP_UI: "1", SLICE_L2_DRIFT: "warn"}},
  duckdb: {file: "slice", env: {SLICE_SKIP_UI: "1", SLICE_L2_DRIFT: "warn", STG_DB: "duckdb"}},
  cli: {file: "cli", env: {}},
  jobs: {file: "jobs", env: {}},
  l3: {file: "l3", env: {}},
  iti: {file: "iti", env: {}},
};
const repro = (check) => ["OSD_HOME=<your checkout>", ...Object.entries(check.env).map(([k, v]) => `${k}=${v}`), `node test/${check.file}.mjs`].join(" ");

const [mode, key] = process.argv.slice(2);
if (mode === "pin") {
  const pin = JSON.parse(readFileSync(join(root, "consumers.lock.json"), "utf8"))["osg-demo"];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin?.repo ?? "") || !/^[0-9a-f]{40}$/.test(pin?.ref ?? "")) {
    throw new Error("consumers.lock.json: osg-demo needs a GitHub repository and a full commit SHA");
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `repo=${pin.repo}\nref=${pin.ref}\n`);
} else if (mode === "run") {
  const check = checks[key];
  if (!check) throw new Error(`Unknown consumer check: ${key}`);
  if (!process.env.OSD_HOME) throw new Error("OSD_HOME must name the runtime checkout");
  mkdirSync(results, {recursive: true});
  const log = join(results, `${key}.log`);
  writeFileSync(log, "");
  const start = performance.now();
  const child = spawn(process.execPath, [`test/${check.file}.mjs`], {
    env: {...process.env, ...check.env}, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on("data", (chunk) => { appendFileSync(log, chunk); output.write(chunk); });
  }
  child.on("error", (error) => appendFileSync(log, `${error.message}\n`));
  child.on("close", (code, signal) => {
    const record = {code: code ?? 1, signal, seconds: (performance.now() - start) / 1000};
    writeFileSync(join(results, `${key}.json`), `${JSON.stringify(record)}\n`);
    process.exitCode = record.code;
  });
} else if (mode === "summary") {
  const lines = ["## Consumer smoke (advisory)", "", "| Step | Result | Time |", "| --- | --- | ---: |"];
  const failures = [];
  const drift = [];
  for (const [name, check] of Object.entries(checks)) {
    const path = join(results, `${name}.json`);
    const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    lines.push(`| ${name} | ${record ? (record.code === 0 ? "pass" : "fail") : "not run (setup/cancellation)"} | ${record ? `${record.seconds.toFixed(1)} s` : "—"} |`);
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
  throw new Error("usage: node tools/consumer-smoke.mjs pin|run <check>|summary");
}
