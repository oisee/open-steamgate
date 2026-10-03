// The common folder CI contract for the Go and JavaScript ABAP Unit hosts.
import {spawn} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync} from "node:fs";
import {basename, join, resolve} from "node:path";

const ownerOf = (file) => basename(file).split(".")[0].replaceAll("#", "/").toUpperCase();

export {kernelWarnings, kernelWarningForms, KERNEL_FORMS} from "./osd-kernel-compat.mjs";

export function applyKernelWarnings(result, warnings, strict = false, selected = []) {
  for (const warning of warnings) console.error(warning.message);
  const findings = warnings.filter((w) => w.kind === "kernel-reject");
  const rows = result.rows.map((row) => {
    const alerts = findings.filter((w) => ownerOf(w.file) === row.class).map((w) => w.message);
    return alerts.length ? {...row, alerts: [...(row.alerts ?? []), ...alerts],
      ...(strict && (!selected.length || selected.includes(row.class)) ? {status: "ERROR", message: [row.message, ...alerts].filter(Boolean).join("\n")} : {})} : row;
  });
  if (strict) for (const owner of new Set(findings.map((w) => ownerOf(w.file)))) {
    if ((selected.length && !selected.includes(owner)) || rows.some((r) => r.class === owner)) continue;
    const alerts = findings.filter((w) => ownerOf(w.file) === owner).map((w) => w.message);
    rows.push({class: owner, status: "ERROR", message: alerts.join("\n"), alerts});
  }
  return {...result, rows, warnings};
}

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
    if (row.source === "harness" && status === "FAILURE") status = "ERROR";
    if (!["SUCCESS", "FAILURE", "NOT_COMPILED", "ERROR"].includes(status)) status = "ERROR";
    totals[status.toLowerCase()]++;
    if (row.method) totals.tests++;
    return {...row, status};
  });
  const code = totals.not_compiled || totals.error ? 2 : !totals.tests ? 3 : totals.failure ? 1 : 0;
  return {result: {...result, rows, totals, overrides: result.overrides ?? []}, code};
}

export function stageInput(directory, selected, prefix) {
  const files = readdirSync(directory, {withFileTypes: true}).filter((e) => e.isFile()).map((e) => e.name).sort();
  const names = files.filter((f) => f.endsWith(".clas.testclasses.abap") && files.includes(f.replace(".testclasses.abap", ".abap")))
    .map((f) => f.replace(/\.clas\.testclasses\.abap$/, "").replaceAll("#", "/").toUpperCase());
  for (const name of selected) if (!names.includes(name)) throw new Error(`unknown test owner: ${name}`);
  const chosen = [...new Set(selected.length ? selected : names)];
  if (!chosen.length) return {chosen, result: {classes: 0, compiled: 0, rows: [], timingMs: {}}};
  const local = resolve(import.meta.dirname, "../.local");
  mkdirSync(local, {recursive: true});
  const staging = mkdtempSync(join(local, prefix + "-"));
  const input = join(staging, "input");
  try {
    mkdirSync(input);
    const errors = [];
    // Return validation failures along with the directory so both callers clean it.
    for (const file of files.filter((f) => /\.(abap|xml)$/.test(f))) {
      if (file.endsWith(".abap")) readFileSync(join(directory, file), "utf8").split(/\r\n|\n|\r/).forEach((line, i) => {
        if ([...line].length > 255) errors.push({status: "ERROR", message: `${file}:${i + 1}: line exceeds 255 characters (the kernel refuses it)`});
      });
      copyFileSync(join(directory, file), join(input, file));
    }
    for (const file of files.filter((f) => f.endsWith(".clas.abap"))) {
      const name = file.replace(/\.clas\.abap$/, "");
      if (!existsSync(join(input, `${name}.clas.xml`))) writeFileSync(join(input, `${name}.clas.xml`), metadata(name.replaceAll("#", "/").toUpperCase()));
    }
    return {chosen, staging, input, result: errors.length ? {classes: chosen.length, compiled: 0, rows: errors, timingMs: {}} : undefined};
  } catch (error) {
    rmSync(staging, {recursive: true, force: true});
    throw error;
  }
}

export function printResult(result, json) {
  if (json) console.log(JSON.stringify(result));
  else {
    for (const row of result.rows.filter((r) => r.status !== "SUCCESS"))
      console.log(`${[row.class, row.testclass, row.method].filter(Boolean).join("/") || "run"}: ${row.status} ${String(row.message ?? "").replace(/\s+/g, " ")}`);
    const t = result.totals;
    console.log(`Tests: ${t.tests}, SUCCESS: ${t.success}, FAILURE: ${t.failure}, NOT_COMPILED: ${t.not_compiled}, ERROR: ${t.error}`);
  }
}

export const run = (command, cwd, env = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command[0], command.slice(1), {cwd, env: {...process.env, OSG_HOME: cwd, OSD_ROOT: cwd, ...env}, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"]});
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
