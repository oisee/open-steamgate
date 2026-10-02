// CI entry point for generated abapGit classes. The caller's directory is read only.
import {spawn} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {compiled, hosted, toolCommand} from "./osd-host.mjs";
import {runsAs} from "./osd-main.mjs";

const help = `Usage: npm run osgo:unit -- <dir> [--json] [--jobs N] [--class NAME...]
Reads the immediate directory only (no recursion). Default jobs: 4.
osd unit --go accepts the same arguments in a checkout.
The compiled binary carries neither Go nor the gogen tree; use the checkout
command with Node dependencies, synced libraries and Go 1.26 installed.
Exit codes: 0 all SUCCESS, 1 FAILURE, 2 NOT_COMPILED/ERROR, 3 no tests.`;

export function metadata(name) {
  const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
  <CLSNAME>${xml(name)}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xml(name)}</DESCRIPT>
  <EXPOSURE>2</EXPOSURE><STATE>1</STATE><UNICODE>X</UNICODE><FIXPT>X</FIXPT><WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>
 </VSEOCLASS></asx:values></asx:abap>
</abapGit>
`;
}

export function summarize(result) {
  const totals = {success: 0, failure: 0, not_compiled: 0, error: 0, tests: 0};
  const rows = result.rows.map((row) => {
    let status = row.status === "FAILED" ? "FAILURE" : row.status;
    // A process failure is infrastructure, not a failed ABAP assertion.
    if (status === "FAILURE" && /^(runner:|seed image:)/.test(row.message ?? "")) status = "ERROR";
    if (!["SUCCESS", "FAILURE", "NOT_COMPILED", "ERROR"].includes(status)) status = "ERROR";
    totals[status.toLowerCase()]++;
    if (row.method) totals.tests++;
    return {...row, status};
  });
  const code = totals.not_compiled || totals.error ? 2 : !totals.tests ? 3 : totals.failure ? 1 : 0;
  return {result: {...result, rows, totals}, code};
}

const run = (command, cwd) => new Promise((resolveRun, reject) => {
  const child = spawn(command[0], command.slice(1), {cwd, env: {...process.env, OSG_HOME: cwd, OSD_ROOT: cwd}, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "", stderr = "", interrupted;
  // Only this invocation's process group is ours. Let its children finish before cleanup.
  const stop = (signal) => {
    interrupted = signal;
    if (!child.pid) return;
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const onInt = () => stop("SIGINT"), onTerm = () => stop("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  child.on("error", reject);
  child.on("close", (status, signal) => {
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
    resolveRun({stdout, stderr, status, signal: interrupted ?? signal});
  });
});

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const json = args.includes("--json");
  let staging, result;
  try {
    if (compiled) throw new Error("osd unit --go requires a checkout: the binary carries neither Go nor the gogen tree. Run npm run osgo:unit -- <dir>.");
    let directory, jobs = 4;
    const selected = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json") continue;
      if (arg === "--jobs") {
        jobs = Number(args[++i]);
        if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 256) throw new Error("--jobs must be an integer from 1 to 256");
      } else if (arg === "--class") {
        const start = selected.length;
        while (args[i + 1] && !args[i + 1].startsWith("--")) selected.push(args[++i].replaceAll("#", "/").toUpperCase());
        if (selected.length === start) throw new Error("--class needs at least one name (put <dir> first)");
      } else if (arg.startsWith("-") || directory) throw new Error(`unexpected argument: ${arg}`);
      else directory = resolve(arg);
    }
    if (!directory) throw new Error("<dir> is required; use --help for usage");
    const files = readdirSync(directory, {withFileTypes: true}).filter((e) => e.isFile()).map((e) => e.name).sort();
    const owners = files.filter((file) => file.endsWith(".clas.testclasses.abap"))
      .map((file) => file.replace(/\.clas\.testclasses\.abap$/, ""))
      .filter((name) => files.includes(`${name}.clas.abap`));
    const names = owners.map((name) => name.replaceAll("#", "/").toUpperCase());
    for (const name of selected) if (!names.includes(name)) throw new Error(`unknown test owner: ${name}`);
    const chosen = selected.length ? selected : names;
    if (!chosen.length) result = {classes: 0, compiled: 0, rows: [], timingMs: {}};
    else {
      // Under the checkout, and removed even if compilation or JSON decoding fails.
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      mkdirSync(join(root, ".local"), {recursive: true});
      staging = mkdtempSync(join(root, ".local", "osgo-unit-"));
      const input = join(staging, "input");
      mkdirSync(input);
      const errors = [];
      for (const file of files.filter((file) => /\.(abap|xml)$/.test(file))) {
        // Only osgo-unit enforces this for now; src/ needs a whole-tree audit first.
        if (file.endsWith(".abap")) readFileSync(join(directory, file), "utf8").split(/\r\n|\n|\r/).forEach((line, i) => {
          if ([...line].length > 255) errors.push({status: "ERROR", message: `${file}:${i + 1}: line exceeds 255 characters (the kernel refuses it)`});
        });
        copyFileSync(join(directory, file), join(input, file));
      }
      if (errors.length) result = {classes: chosen.length, compiled: 0, rows: errors, timingMs: {}};
      else {
        for (const file of files.filter((file) => file.endsWith(".clas.abap"))) {
          const name = file.replace(/\.clas\.abap$/, "");
          if (!existsSync(join(input, `${name}.clas.xml`))) writeFileSync(join(input, `${name}.clas.xml`), metadata(name.replaceAll("#", "/").toUpperCase()));
        }
        const command = toolCommand(join(root, "tools", "gogen", "unit.mjs"),
          ["--input", input, "--jobs", String(jobs), "--out", join(staging, "out"), "--no-cache", ...chosen.flatMap((name) => ["--class", name])]);
        // Hosted dispatch uses a unique name: gogen's unit.mjs and osd-unit.mjs differ.
        if (hosted()) command[JSON.parse(process.env.OSD_SELF).length + 1] = "gogen-unit.mjs";
        const child = await run(command, root);
        if (child.stderr) process.stderr.write(child.stderr);
        if (child.signal) throw new Error(`unit runner terminated by ${child.signal}`);
        try { result = JSON.parse(child.stdout); }
        catch { throw new Error(child.stderr.trim() || `invalid unit result (exit ${child.status})`); }
        if (!Array.isArray(result.rows)) throw new Error("unit result has no rows");
        if (child.status && child.status !== 2 && !result.rows.length) throw new Error(child.stderr.trim() || `unit runner exited ${child.status} without results`);
      }
    }
  } catch (error) {
    result = {classes: 0, compiled: 0, rows: [{status: "ERROR", message: error.message}], timingMs: {}};
  } finally { if (staging) rmSync(staging, {recursive: true, force: true}); }
  const summary = summarize(result);
  if (json) console.log(JSON.stringify(summary.result));
  else {
    for (const row of summary.result.rows.filter((row) => row.status !== "SUCCESS"))
      console.log(`${[row.class, row.testclass, row.method].filter(Boolean).join("/") || "run"}: ${row.status} ${String(row.message ?? "").replace(/\s+/g, " ")}`);
    const t = summary.result.totals;
    console.log(`Tests: ${t.tests}, SUCCESS: ${t.success}, FAILURE: ${t.failure}, NOT_COMPILED: ${t.not_compiled}, ERROR: ${t.error}`);
  }
  return summary.code;
}

if (runsAs("osgo-unit.mjs")) process.exitCode = await main();
