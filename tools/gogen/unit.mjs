// ABAP Unit on gogen. Test includes are compiled only for selected owners.
// Results are JSON rows: {class, testclass, method, status, message}.
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo, referencedClasses} from "./emit-go.mjs";
import {reconcile} from "./unit-results.mjs";
import {home} from "./home.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const values = (flag) => args.flatMap((x, i) => x === flag ? [args[i + 1]] : []);
const selected = new Set(values("--class").map((x) => x.toUpperCase()));
const out = values("--out")[0] ?? join(here, ".out", "unit");
const fixture = values("--fixture")[0];
const walk = (dir) => !existsSync(dir) ? [] : readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const sourceFolders = fixture ? [fixture] : [join(home, "test", "unit"), join(home, "src")];
const sources = sourceFolders.flatMap(walk)
  .filter((f) => f.endsWith(".clas.testclasses.abap"));
const owners = [...new Set(sources.map((f) => f.split("/").at(-1).replace(/\.clas\.testclasses\.abap$/, "").toUpperCase()))]
  .filter((o) => selected.size === 0 || selected.has(o));
if (selected.size && owners.length !== selected.size) throw new Error(`unknown test owner: ${[...selected].filter((x) => !owners.includes(x)).join(", ")}`);
const libDirs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/framework", "open-abap-odata/src", "ajson/src/core"]
  .map((x) => join(home, ".local", "lars", x)).filter(existsSync);
const folders = [...sourceFolders, ...(fixture ? [] : [join(home, "gen")]), ...libDirs].filter(existsSync);
const available = new Set(folders.flatMap(walk).filter((f) => /\.(clas|intf)\.abap$/.test(f))
  .map((f) => f.split("/").at(-1).split(".")[0].replaceAll("#", "/").toUpperCase()));
const sourceByName = new Map(folders.flatMap(walk).filter((f) => /\.clas\.abap$/.test(f))
  .map((f) => [f.split("/").at(-1).split(".")[0].replaceAll("#", "/").toUpperCase(), f]));

function callsIn(node, out) {
  if (Array.isArray(node)) { for (const n of node) callsIn(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.e === "call") {
    if (node.owner) out.add(node.owner);
    if (node.receiver?.type?.k === "ref" && !node.receiver.type.intf) out.add(node.receiver.type.name);
  }
  if (node.e === "new") out.add(node.cls);
  for (const [k, v] of Object.entries(node)) if (k !== "type") callsIn(v, out);
  return out;
}

// Grow from actual compiled references, not every object in a library. The
// registry sees the entire library, so an omitted class remains typeable.
let wanted = new Set([...owners, "CL_ABAP_UNIT_ASSERT"]);
let program;
for (let round = 0; round < 12; round++) {
  program = compileProgram({folders, objects: [...wanted], tolerant: true, includeTests: new Set(owners)});
  const refs = new Set(referencedClasses(program));
  for (const name of wanted) {
    const sup = program.reg.getObject("CLAS", name)?.getDefinition()?.getSuperClass();
    if (sup) refs.add(sup.toUpperCase());
    const file = sourceByName.get(name);
    if (file) {
      const contents = readFileSync(file, "utf8") + (owners.includes(name) ? "\n" + readFileSync(sources.find((f) => f.split("/").at(-1).startsWith(name.toLowerCase() + ".")), "utf8") : "");
      for (const ref of contents.matchAll(/\b(?:ZCL|ZCX|CL|CX)_[A-Z0-9_]+\b/gi)) refs.add(ref[0].toUpperCase());
    }
  }
  for (const c of program.classes) {
    if (c.super) refs.add(c.super);
    for (const m of c.methods) callsIn(m.body, refs);
  }
  const more = [...refs].filter((x) => available.has(x) && !wanted.has(x) && !x.includes(":"));
  if (!more.length) break;
  for (const x of more) wanted.add(x);
  if (round === 11) throw new Error(`dependency closure did not settle: ${more.join(", ")}`);
}

function testsOf(program) {
  const classes = new Map(program.classes.map((c) => [c.name, c]));
  const rows = [];
  for (const owner of owners) {
    const obj = program.reg.getObject("CLAS", owner);
    if (!obj) { rows.push({class: owner, status: "NOT_COMPILED", message: "class absent from the registry"}); continue; }
    for (const f of obj.getABAPFiles().filter((x) => x.getFilename().endsWith(".testclasses.abap"))) {
      for (const def of f.getInfo().listClassDefinitions()) {
        if (!def.isForTesting || def.isGlobal || def.isAbstract) continue;
        const testclass = def.name.toUpperCase();
        const cls = classes.get(`${owner}:${testclass}`);
        for (const m of def.methods.filter((x) => x.isForTesting)) {
          const method = m.name.toUpperCase();
          const compiled = cls?.methods.some((x) => x.name === method);
          const why = cls?.stubs.find((x) => x.name === method)?.reason
            ?? program.skipped.find((x) => x.startsWith(`${owner}:${testclass}=>${method}:`))
            ?? (compiled ? "" : "test method missing from generated class");
          rows.push({class: owner, testclass, method, status: compiled ? "READY" : "NOT_COMPILED", message: why});
        }
      }
    }
  }
  return rows;
}

const rows = testsOf(program);
const classes = new Map(program.classes.map((c) => [c.name, c]));
// No DB fixture is opened by this runner yet. Exclude a test if its class or
// a reachable method does SQL, including methods in other compiled classes.
const sql = /^(select_|sql_|db_|insert_db|update_db|delete_db|modify_db|commit_work|rollback_work)/i;
function needsDb(key, seen = new Set()) {
  if (seen.has(key)) return false;
  seen.add(key);
  const [name, method] = key.split("=>");
  const m = classes.get(name)?.methods.find((x) => x.name === method);
  if (!m) return false;
  const visit = (n) => {
    if (Array.isArray(n)) return n.some(visit);
    if (!n || typeof n !== "object") return false;
    if (n.s && sql.test(n.s)) return true;
    if (n.e === "call") {
      const target = n.owner ?? (n.receiver?.type?.k === "ref" ? n.receiver.type.name : name);
      if (target && needsDb(`${target}=>${n.method}`, seen)) return true;
    }
    return Object.entries(n).some(([k, v]) => k !== "type" && visit(v));
  };
  return visit(m.body);
}
for (const row of rows) if (row.status === "READY") {
  const key = `${row.class}:${row.testclass}`;
  if ([row.method, "SETUP", "CLASS_SETUP"].some((m) => needsDb(`${key}=>${m}`))) {
    row.status = "NEEDS_DB";
    row.message = "requires a seeded, isolated database for this test class";
  }
}

const goName = (x) => x.toUpperCase().replace(/=>|~|-/g, "__").replace(/[^A-Z0-9_]/g, "_");
const ready = rows.filter((x) => x.status === "READY");
const groups = [...Map.groupBy(ready, (r) => `${r.class}:${r.testclass}`)].map(([key, methods]) => ({key, methods}));
const generated = ["package main", "", "import (\"encoding/json\"; \"fmt\"; \"os\"; \"osg/gogen/abap\")", "",
  "type result struct { Class string `json:\"class\"`; Testclass string `json:\"testclass\"`; Method string `json:\"method\"`; Status string `json:\"status\"`; Message string `json:\"message\"` }",
  "func caught(f func()) (msg string) { defer func() { if x := recover(); x != nil { msg = fmt.Sprint(x) } }(); f(); return }",
  "func main() { results := []result{}", "s := &abap.Session{}"];
for (const {key, methods} of groups) {
  const [owner, local] = key.split(":");
  const c = classes.get(key);
  const T = goName(key);
  const special = (name, receiver) => c.methods.some((m) => m.name === name)
    ? `${receiver}.${goName(name)}(s)` : "";
  generated.push("{", "classError := \"\"");
  if (c.methods.some((m) => m.name === "CLASS_SETUP")) generated.push(`classError = caught(func(){ ${T}_CLASS_SETUP(s) })`);
  for (const row of methods) {
    generated.push(`{ r := result{Class:${JSON.stringify(owner)}, Testclass:${JSON.stringify(local)}, Method:${JSON.stringify(row.method)}, Status:"SUCCESS"}`,
      "if classError != \"\" { r.Status = \"FAILED\"; r.Message = \"class_setup: \" + classError } else {",
      `test := New_${T}(s)`,
      `err := caught(func(){ ${special("SETUP", "test")} })`,
      "if err == \"\" { err = caught(func(){ test." + goName(row.method) + "(s) }) }",
      `tear := caught(func(){ ${special("TEARDOWN", "test")} })`,
      "if err == \"\" && tear != \"\" { err = \"teardown: \" + tear }",
      "if err != \"\" { r.Status = \"FAILED\"; r.Message = err }", "}", "results = append(results, r)", "}");
  }
  if (c.methods.some((m) => m.name === "CLASS_TEARDOWN")) generated.push(
    `if err := caught(func(){ ${T}_CLASS_TEARDOWN(s) }); err != "" && len(results) > 0 { results[len(results)-1].Status = "FAILED"; results[len(results)-1].Message += " class_teardown: " + err }`);
  generated.push("}");
}
generated.push("enc := json.NewEncoder(os.Stdout); if err := enc.Encode(results); err != nil { panic(err) }", "}");
mkdirSync(out, {recursive: true});
const dir = join(here, "go", "cmd", "unit");
mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "zz_main.go"), generated.join("\n") + "\n");
const summary = {classes: owners.length, compiled: new Set(ready.map((r) => r.class)).size, rows};
writeFileSync(join(out, "plan.json"), JSON.stringify(summary, null, 2));
if (!ready.length || args.includes("--build-only")) { console.log(JSON.stringify(summary)); process.exit(ready.length ? 0 : 2); }
const bin = join(out, "unit");
const build = spawnSync("go", ["build", "-trimpath", "-o", bin, "./cmd/unit"], {
  cwd: join(here, "go"), encoding: "utf8", env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/gogen-unit-gocache"}, maxBuffer: 5e6,
});
if (build.status !== 0) {
  const message = (build.stderr || build.error?.message || "go build failed").trim().split("\n").slice(0, 12).join("\n");
  for (const r of ready) { r.status = "NOT_COMPILED"; r.message = message; }
  console.log(JSON.stringify({...summary, rows}));
  process.exit(2);
}
const run = spawnSync(bin, [], {encoding: "utf8", timeout: 120000, maxBuffer: 20e6});
if (run.status !== 0) {
  for (const r of ready) { r.status = "FAILED"; r.message = `runner: ${run.stderr || run.error?.message || run.signal || run.status}`; }
  console.log(JSON.stringify({...summary, rows})); process.exit(1);
}
const reconciled = reconcile(ready, JSON.parse(run.stdout));
for (let i = 0; i < ready.length; i++) { ready[i].status = reconciled[i].status; ready[i].message = reconciled[i].message; }
console.log(JSON.stringify({...summary, rows}));
if (ready.some((x) => x.status === "FAILED")) process.exit(1);
