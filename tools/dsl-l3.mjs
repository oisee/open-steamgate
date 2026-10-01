#!/usr/bin/env node
// DSL L3: a set of L2 rules run as one unit, with a durable alert log and a
// trace from every alert to its rule line (docs/dsl-l3.md). A set is one
// manifest, `<set>.l3.yaml`, naming its rules by their `.l2.yaml` files; this
// compiler checks it, then renders through ZCL_OSD_TPL the set's runner class
// ZCL_L3_<SET> and its job report, each with a trace sidecar. It knows the
// set language and the L2 compiler's API, nothing of any domain.
//
//   node tools/dsl-l3.mjs build <set.l3.yaml> --out <dir> [--ddic <folder>]...
//   node tools/dsl-l3.mjs check <set.l3.yaml> --out <dir> [--ddic <folder>]...
//   node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<date>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve as resolvePath, sep} from "node:path";
import {pathToFileURL} from "node:url";
import yaml from "js-yaml";
import {compileRule, lineIndex, modelHash, renderModel, rulePath, RuleError} from "./dsl-l2.mjs";

export const SET_TEMPLATE = "recipes/l3-set/template.tpl";
export const JOB_TEMPLATE = "recipes/l3-job/template.tpl";

// the widths of ZOSD_L3_ALERT's columns the runner writes from the manifest
export const WIDTH = {set: 30, rule: 60, hash: 71, file: 128, jobname: 32};
// a set name: the class ZCL_L3_<SET>, the report ZL3_<SET> (whose converted
// class ZCL_OSD_GUITX_L3_<SET> has 30 characters at most) and the job names
// L3_<SET>_<nn> are made of it
export const SET_NAME = /^[a-z][a-z0-9_]{0,12}$/;
const KEYS = ["set", "title", "class", "report", "date", "rules"];
const RULE_KEYS = ["rule", "enabled"];
const CHAR = (length) => ({built_in: "CHAR", length});

export class SetError extends RuleError {}

const path = (file) => relative(process.cwd(), file).split(sep).join("/");

// The nearest line of a manifest path (`rules/2/enabled`), or of its parent.
function lineOf(index, key) {
  let current = `/${key}`;
  while (current) {
    if (index.has(current)) return index.get(current);
    current = current.slice(0, current.lastIndexOf("/"));
  }
  return 1;
}

// The generated check class of a rule sits beside its rule file, as
// `node tools/dsl-l2.mjs build <rule> --out <its folder>` writes it.
const sidecarOf = (ruleFile, className) => join(dirname(ruleFile), `${className}.clas.trace.json`);

export function compileSet(file, {ddic, registry, out} = {}) {
  const text = readFileSync(file, "utf8");
  const where = path(file);
  const fail = (line, message) => { throw new SetError(where, line, message); };
  let doc;
  try {
    doc = yaml.load(text, {schema: yaml.FAILSAFE_SCHEMA, filename: where});
  } catch (error) {
    throw new SetError(where, (error.mark?.line ?? 0) + 1, error.reason ?? error.message);
  }
  const index = lineIndex(text);
  const line = (key) => lineOf(index, key);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(1, "a set is a mapping with set, title and rules");
  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) fail(line(key), `unknown key ${key} (${KEYS.join(", ")})`);
  const scalar = (key, required) => {
    const value = doc[key];
    if (value === undefined) {
      if (required) fail(1, `a set needs ${key}`);
      return undefined;
    }
    if (typeof value !== "string" || value.includes("\n")) fail(line(key), `${key} is one line of text`);
    return value;
  };
  const set = scalar("set", true);
  if (!SET_NAME.test(set)) fail(line("set"), `set ${JSON.stringify(set)} is a lower-case name of 1 to 13 letters, digits and _ starting with a letter`);
  const title = scalar("title", true);
  const className = (scalar("class") ?? `zcl_l3_${set}`).toLowerCase();
  if (!/^z[a-z0-9_]{1,29}$/.test(className)) fail(line("class"), `class ${className} is a Z name of at most 30 characters`);
  const report = (scalar("report") ?? `zl3_${set}`).toLowerCase();
  if (!/^z[a-z0-9_]{1,18}$/.test(report)) fail(line("report"), `report ${report} is a Z name of at most 19 characters (its converted class ZCL_OSD_GUITX_<name without Z> has 30)`);
  const date = scalar("date", true);
  if (date !== "$date" && date !== "today") fail(line("date"), `date is $date (the caller passes the check date) or today ($date, the current date when the caller passes none); L2 rules know no other parameter`);

  if (!Array.isArray(doc.rules)) fail(line("rules"), "rules is a list of {rule: <file.l2.yaml>, enabled: true|false}");
  if (!doc.rules.length) fail(line("rules"), "a set needs at least one rule");
  const seen = {file: new Map(), name: new Map(), class: new Map()};
  const all = doc.rules.map((entry, i) => {
    const at = line(`rules/${i}`);
    if (typeof entry === "string") entry = {rule: entry};
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(at, "a rule entry is {rule: <file.l2.yaml>} with an optional enabled: true|false");
    for (const key of Object.keys(entry)) if (!RULE_KEYS.includes(key)) fail(line(`rules/${i}/${key}`), `unknown key ${key} in a rule entry (${RULE_KEYS.join(", ")})`);
    if (typeof entry.rule !== "string" || !entry.rule.endsWith(".l2.yaml")) fail(at, "rule names a .l2.yaml file, relative to the set");
    const enabled = entry.enabled ?? "true";
    if (enabled !== "true" && enabled !== "false") fail(line(`rules/${i}/enabled`), `enabled is true or false, not ${JSON.stringify(enabled)}`);
    const ruleFile = resolvePath(dirname(file), entry.rule);
    if (!existsSync(ruleFile)) fail(at, `rule file ${entry.rule} does not exist (${path(ruleFile)})`);
    const twice = (kind, key, what) => {
      if (seen[kind].has(key)) fail(at, `${what} is already in the set at line ${seen[kind].get(key)}`);
      seen[kind].set(key, at);
    };
    twice("file", ruleFile, `rule file ${entry.rule}`);
    let compiled;
    try {
      // out: the rule's own folder, where its class is built, so a rule
      // outside a repository records the path its sidecar records
      compiled = compileRule(ruleFile, {out: dirname(ruleFile), ...(ddic ? {ddic} : {}), ...(registry ? {registry} : {})});
    } catch (error) {
      if (error instanceof RuleError) fail(at, `rule ${entry.rule} does not compile: ${error.message}`);
      throw error;
    }
    twice("name", compiled.rule, `rule ${compiled.rule}`);
    twice("class", compiled.class, `class ${compiled.class}`);
    if (compiled.rule.length > WIDTH.rule) fail(at, `rule name ${compiled.rule} is longer than ${WIDTH.rule} characters, the width of ZOSD_L3_ALERT-RULE`);
    const hash = modelHash(renderModel(compiled));
    const sidecar = sidecarOf(ruleFile, compiled.class);
    let committed;
    try { committed = JSON.parse(readFileSync(sidecar, "utf8")).model; } catch { committed = undefined; }
    if (committed === undefined) fail(at, `rule ${entry.rule} has no generated class beside it (${path(sidecar)}); build it with node tools/dsl-l2.mjs build ${path(ruleFile)} --out ${path(dirname(ruleFile))}`);
    if (committed !== hash) fail(at, `the generated class of ${entry.rule} is stale (its trace names ${committed}, the rule compiles to ${hash}); rebuild it with node tools/dsl-l2.mjs build ${path(ruleFile)} --out ${path(dirname(ruleFile))}`);
    const recorded = compiled.source;
    if (recorded.length > WIDTH.file) fail(at, `rule path ${recorded} is longer than ${WIDTH.file} characters, the width of ZOSD_L3_ALERT-RULE_FILE`);
    return {at, enabled: enabled === "true", compiled, hash, recorded};
  });
  const enabled = all.filter((r) => r.enabled);
  if (!enabled.length) fail(line("rules"), "every rule of the set is disabled; a set runs at least one");
  if (enabled.length > 99) fail(line("rules"), "a set runs at most 99 rules (the job name numbers them in two digits)");

  const id = `set/${set}`;
  const SET = set.toUpperCase();
  const node = (r, n) => ({
    "@id": `${id}/rule/${r.compiled.rule}`, set_line: r.at,
    name: r.compiled.rule, "name@type": CHAR(WIDTH.rule),
    hash: r.hash, "hash@type": CHAR(WIDTH.hash),
    check_class: r.compiled.class, "check_class@type": CHAR(30),
    file: r.recorded, "file@type": CHAR(WIDTH.file),
    // the alert line of the rule: what an alert row names; a rule whose
    // clauses carry their own alerts names its root line
    alert_line: String(r.compiled.alert?.rule_line ?? r.compiled.rule_line), "alert_line@type": {built_in: "INT4"},
    ...(n ? {index: String(n), jobname: `L3_${SET}_${String(n).padStart(2, "0")}`, "jobname@type": CHAR(WIDTH.jobname)} : {}),
  });
  const model = {
    "@id": id, set_line: line("set"),
    set, "set@type": CHAR(WIDTH.set), title, class: className, report, source: rulePath(file, out),
    jobs: `L3_${SET}_*`, "jobs@type": CHAR(WIDTH.jobname),
    date: {"@id": `${id}/date`, set_line: line("date"), today: date === "today"},
    rules: enabled.map((r, i) => node(r, i + 1)),
    disabled: all.filter((r) => !r.enabled).map((r) => node(r)),
  };
  Object.defineProperty(model, "where", {value: where});
  return model;
}

// the nearest node with an @id on a trace path (1-based array indexes)
function provenance(model, tracePath) {
  let current = model, node = model;
  for (const part of String(tracePath ?? "").split("/").filter(Boolean)) {
    current = Array.isArray(current) ? current[Number(part) - 1] : current?.[part];
    if (current?.["@id"]) node = current;
  }
  return {node: node["@id"], set_line: node.set_line};
}

function sidecar(model, template, rendered) {
  return JSON.stringify({
    generator: "dsl-l3", set: model.source, template,
    model: `sha256:${createHash("sha256").update(JSON.stringify(model)).digest("hex")}`,
    rules: Object.fromEntries(model.rules.map((r) => [r.name, {file: r.file, class: r.check_class, model: r.hash}])),
    lines: rendered.trace.map((entry) => ({line: entry.line, template_line: entry.template_line, path: entry.path,
      ...provenance(model, entry.path)})),
  }, null, 1) + "\n";
}

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function classXml(model) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><VSEOCLASS><CLSNAME>${model.class.toUpperCase()}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xmlEscape(`L3 rule set ${model.set}`.slice(0, 60))}</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS></asx:values>
 </asx:abap>
</abapGit>
`;
}

function progXml(model) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><PROGDIR><NAME>${model.report.toUpperCase()}</NAME><DBAPL>S</DBAPL><SUBC>1</SUBC><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR></asx:values>
 </asx:abap>
</abapGit>
`;
}

// The files of a set, name -> content. What the abap profile refuses is a
// SetError at the manifest line of the node the line traces to.
export async function renderSet(model) {
  const {renderRecipe} = await import("./dsl-abap.mjs");
  const quiet = console.log;
  let runner, job;
  try {
    console.log = (...items) => console.error(...items); // runtime bootstrap diagnostics
    runner = await renderRecipe(model, SET_TEMPLATE, {profile: "abap"});
    job = await renderRecipe(model, JOB_TEMPLATE, {profile: "abap"});
  } finally {
    console.log = quiet;
  }
  const nodeLine = (nodeId) => {
    if (nodeId === model["@id"]) return model.set_line;
    return [model.date, ...model.rules, ...model.disabled].find((n) => n["@id"] === nodeId)?.set_line ?? model.set_line;
  };
  for (const [name, result] of [[`${model.class}.clas.abap`, runner], [`${model.report}.prog.abap`, job]]) {
    const error = result.findings.find((f) => f.severity === "E");
    if (error) throw new SetError(model.where ?? model.source, nodeLine(error.node), `the generated ${name} line ${error.line}: ${error.text} (${error.rule}, ${error.node})`);
  }
  return {
    files: {
      [`${model.class}.clas.abap`]: runner.text,
      [`${model.class}.clas.xml`]: classXml(model),
      [`${model.class}.clas.trace.json`]: sidecar(model, SET_TEMPLATE, runner),
      [`${model.report}.prog.abap`]: job.text,
      [`${model.report}.prog.xml`]: progXml(model),
      [`${model.report}.prog.trace.json`]: sidecar(model, JOB_TEMPLATE, job),
    },
    findings: [...runner.findings.map((f) => ({...f, file: `${model.class}.clas.abap`})),
      ...job.findings.map((f) => ({...f, file: `${model.report}.prog.abap`}))],
  };
}

export async function buildSet(file, out, options = {}) {
  const model = compileSet(file, {out, ...options});
  const rendered = await renderSet(model);
  mkdirSync(out, {recursive: true});
  for (const [name, content] of Object.entries(rendered.files)) writeFileSync(join(out, name), content);
  return {model, ...rendered};
}

// Regenerate into a scratch folder and compare byte for byte with `out`.
export async function checkSet(file, out, options = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "dsl-l3-"));
  try {
    const {files} = await buildSet(file, scratch, {...options, out});
    const drift = [];
    for (const name of Object.keys(files)) {
      let committed;
      try { committed = readFileSync(join(out, name)); } catch { drift.push(`${name}: missing in ${out}`); continue; }
      if (!committed.equals(readFileSync(join(scratch, name)))) drift.push(`${name}: differs from a fresh build`);
    }
    return drift;
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// explain: an alert key down to the rule line and the generated check lines

// `<set>/<rule>/<model hash>/<check date>/<seq>`; the hash is the full
// `sha256:<hex>` or at least eight of its hex digits.
export function parseAlertKey(key) {
  const parts = String(key).split("/");
  if (parts.length !== 5) throw new Error(`an alert key is <set>/<rule>/<model hash>/<check date>/<seq>, got ${JSON.stringify(key)}`);
  const [set, rule, hash, date, seq] = parts;
  const hex = hash.replace(/^sha256:/, "");
  if (!/^[0-9a-f]{8,64}$/.test(hex)) throw new Error(`model hash ${hash} is sha256:<hex> or at least 8 of its hex digits`);
  if (!/^\d{8}$/.test(date)) throw new Error(`check date ${date} is YYYYMMDD`);
  if (!/^\d+$/.test(seq) || Number(seq) < 1) throw new Error(`alert sequence ${seq} is a number from 1`);
  return {set, rule, hash: hex, date, seq: Number(seq)};
}

function setFiles(root = "src") {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".l3.yaml")) found.push(join(dir, entry.name));
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

const git = (args) => spawnSync("git", args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});

// The rule file and its check class's sidecar as they were when the class
// carried `hash`: the working tree when it still does, else the commit that
// wrote it, found by git's pickaxe on the sidecar.
function ruleVersion(entry, hash, base) {
  const ruleFile = join(base, entry.file);
  const sidecarPath = join(dirname(ruleFile), `${entry.check_class}.clas.trace.json`);
  const inRepo = (file) => relative(base, file).split(sep).join("/");
  const read = (file) => readFileSync(file, "utf8");
  const current = existsSync(sidecarPath) ? JSON.parse(read(sidecarPath)) : undefined;
  if (current?.model.replace(/^sha256:/, "").startsWith(hash)) {
    return {where: "the working tree", rule: read(ruleFile), check: read(sidecarPath.replace(/\.trace\.json$/, ".abap")), trace: current};
  }
  const log = git(["-C", base, "log", "--format=%H", "-S", hash, "--", inRepo(sidecarPath)]);
  for (const commit of log.status === 0 ? log.stdout.split("\n").filter(Boolean) : []) {
    const show = (file) => git(["-C", base, "show", `${commit}:${file}`]);
    const trace = show(inRepo(sidecarPath));
    if (trace.status !== 0) continue;
    const parsed = JSON.parse(trace.stdout);
    if (!parsed.model.replace(/^sha256:/, "").startsWith(hash)) continue;
    const rule = show(parsed.rule ?? inRepo(ruleFile));
    const check = show(inRepo(sidecarPath).replace(/\.trace\.json$/, ".abap"));
    if (rule.status !== 0 || check.status !== 0) continue;
    return {where: `commit ${commit.slice(0, 12)}`, rule: rule.stdout, check: check.stdout, trace: parsed};
  }
  return undefined;
}

function alertRow(db, key) {
  if (!db) return undefined;
  return import("node:sqlite").then(({DatabaseSync}) => {
    const handle = new DatabaseSync(db, {readOnly: true});
    try {
      return handle.prepare(`SELECT * FROM zosd_l3_alert WHERE set_name = ? AND rule = ? AND model_hash LIKE ?
        AND check_date = ? AND alert_seq = ?`).get(key.set, key.rule, `sha256:${key.hash}%`, key.date, key.seq);
    } finally { handle.close(); }
  });
}

// alert -> set and rule -> the rule version -> its alert line -> the lines of
// the generated check that trace to it. `row` is the alert row when known.
export async function explainAlert(key, {sets = setFiles(), db, row} = {}) {
  const k = typeof key === "string" ? parseAlertKey(key) : key;
  const found = sets.map((file) => ({file, model: compileSet(file)})).find((s) => s.model.set === k.set);
  if (!found) throw new Error(`no set ${k.set} in ${sets.map(path).join(", ") || "(no .l3.yaml found)"}`);
  const {model} = found;
  const entry = [...model.rules, ...model.disabled].find((r) => r.name === k.rule);
  if (!entry) throw new Error(`set ${k.set} (${path(found.file)}) has no rule ${k.rule}`);
  const top = git(["rev-parse", "--show-toplevel"]);
  const base = top.status === 0 ? top.stdout.trim() : process.cwd();
  const version = ruleVersion(entry, k.hash, base);
  if (!version) throw new Error(`rule ${k.rule}: no version with model hash ${k.hash} in the working tree or in git history of ${entry.file}`);
  const alertRowFound = row ?? await alertRow(db, k);
  const ruleLines = version.rule.split("\n");
  const ruleLine = alertRowFound?.rule_line ? Number(alertRowFound.rule_line) : Number(entry.alert_line);
  const checkLines = version.check.split("\n");
  const generated = version.trace.lines.filter((l) => l.rule_line === ruleLine).map((l) => l.line);
  const runnerTrace = JSON.parse(readFileSync(join(dirname(found.file), `${model.class}.clas.trace.json`), "utf8"));
  const runnerLines = runnerTrace.lines.filter((l) => l.node === entry["@id"]).map((l) => l.line);
  const out = [
    `alert   ${k.set}/${k.rule}/sha256:${k.hash.slice(0, 12)}.../${k.date}/${k.seq}`,
    ...(alertRowFound ? [`text    ${String(alertRowFound.alert_text).trimEnd()}`, `run     ${String(alertRowFound.run_id).trim()} at ${alertRowFound.run_ts}`] : []),
    `set     ${path(found.file)}:${entry.set_line}: ${readFileSync(found.file, "utf8").split("\n")[entry.set_line - 1].trim()}`,
    `rule    ${k.rule}, ${entry.file} as of ${version.where}, model ${version.trace.model}`,
    `line    ${entry.file}:${ruleLine}: ${(ruleLines[ruleLine - 1] ?? "").trim()}`,
    `check   ${entry.check_class}.clas.abap, ${generated.length} line(s) trace to rule line ${ruleLine}:`,
    ...generated.map((n) => `  ${String(n).padStart(5)}  ${checkLines[n - 1]}`),
    `runner  ${model.class}.clas.abap lines ${compress(runnerLines)} trace to set line ${entry.set_line}`,
  ];
  return {text: out.join("\n"), set: found.file, rule: entry, ruleLine, generated, runnerLines, version: version.where};
}

const compress = (numbers) => {
  const out = [];
  for (const n of numbers) {
    const last = out.at(-1);
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
};

async function main(args) {
  const [command, target, ...rest] = args;
  const ddic = [];
  const sets = [];
  let out, db;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") out = rest[++i];
    else if (rest[i] === "--ddic") ddic.push(rest[++i]);
    else if (rest[i] === "--set") sets.push(rest[++i]);
    else if (rest[i] === "--db") db = rest[++i];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (command === "explain" && target) {
    const {text} = await explainAlert(target, {...(sets.length ? {sets} : {}), db});
    console.log(text);
    return 0;
  }
  if (!["build", "check"].includes(command) || !target || !out) {
    console.error("Usage: node tools/dsl-l3.mjs <build|check> <set.l3.yaml> --out <dir> [--ddic <folder>]...\n"
      + "       node tools/dsl-l3.mjs explain <set>/<rule>/<model hash>/<date>/<seq> [--set <set.l3.yaml>]... [--db <sqlite file>]");
    return 2;
  }
  const options = ddic.length ? {ddic} : {};
  if (command === "check") {
    const drift = await checkSet(target, out, options);
    for (const line of drift) console.error(line);
    console.log(drift.length ? `${target}: ${drift.length} file(s) drifted; rebuild with: node tools/dsl-l3.mjs build ${target} --out ${out}`
      : `${target}: generated files match`);
    return drift.length ? 1 : 0;
  }
  const {files, findings} = await buildSet(target, out, options);
  for (const name of Object.keys(files)) console.log(`wrote ${join(out, name)}`);
  console.log(`abap profile: ${findings.length} finding(s)`);
  for (const f of findings) console.log(`${f.severity} ${f.file}:${f.line} ${f.rule}: ${f.text} (${f.node})`);
  return findings.some((f) => f.severity === "E") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
