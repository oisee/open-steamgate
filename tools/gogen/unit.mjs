// ABAP Unit on gogen. Test includes are compiled only for selected owners.
// Results are JSON rows: {class, testclass, method, status, message}.
import {spawnSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo, referencedClasses} from "./emit-go.mjs";
import {reconcile} from "./unit-results.mjs";
import {home} from "./home.mjs";
import {inputFoldersOf} from "../osd-packs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const values = (flag) => args.flatMap((x, i) => x === flag ? [args[i + 1]] : []);
const selected = new Set(values("--class").map((x) => x.toUpperCase()));
const out = values("--out")[0] ?? join(here, ".out", "unit");
const fixture = values("--fixture")[0];
const config = JSON.parse(readFileSync(join(home, "abap_transpile.json"), "utf8"));
const skipped = new Set((config.options?.skip ?? config.skip ?? []).map((s) =>
  `${s.object}/${s.class}/${s.method}`.toUpperCase()));
const walk = (dir) => !existsSync(dir) ? [] : readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const sourceFolders = fixture ? [fixture] : [join(home, "test", "unit"), join(home, "src")];
const sources = sourceFolders.flatMap(walk)
  .filter((f) => f.endsWith(".clas.testclasses.abap"));
const owners = [...new Set(sources.map((f) => f.split("/").at(-1).replace(/\.clas\.testclasses\.abap$/, "").toUpperCase()))]
  .filter((o) => selected.size === 0 || selected.has(o));
if (selected.size && owners.length !== selected.size) throw new Error(`unknown test owner: ${[...selected].filter((x) => !owners.includes(x)).join(", ")}`);
// One bad generated method must not hide every other owner's verdict. Keep
// this sequential: cmd/unit is the compiler's scratch package, and the Go
// runtime has process-global class constructors.
if (args.includes("--per-owner") && !selected.size && !fixture) {
  const rows = [];
  const timingMs = {frontendClosureRounds: [], emit: 0, goBuild: 0, run: 0};
  for (const owner of owners) {
    const child = spawnSync("node", [join(here, "unit.mjs"), "--class", owner, "--unlayered", "--out", join(out, owner.toLowerCase())], {
      cwd: home, encoding: "utf8", timeout: 180000, maxBuffer: 20e6, env: process.env,
    });
    if (!child.stdout) {
      rows.push({class: owner, status: "NOT_COMPILED", message: child.stderr || child.error?.message || `exit ${child.status}`});
      continue;
    }
    try {
      const result = JSON.parse(child.stdout);
      rows.push(...result.rows);
      timingMs.frontendClosureRounds.push(...(result.timingMs?.frontendClosureRounds ?? []));
      for (const phase of ["emit", "goBuild", "run"]) timingMs[phase] += result.timingMs?.[phase] ?? 0;
    }
    catch { rows.push({class: owner, status: "NOT_COMPILED", message: child.stderr || "invalid child result"}); }
  }
  const compiled = owners.filter((owner) => {
    const own = rows.filter((r) => r.class === owner);
    return own.some((r) => r.status === "SUCCESS" || r.status === "FAILED")
      && own.every((r) => r.status !== "NOT_COMPILED");
  });
  console.log(JSON.stringify({classes: owners.length, compiled: compiled.length, rows, timingMs}));
  process.exit(rows.some((r) => r.status === "FAILED") ? 1 : rows.some((r) => r.status === "NOT_COMPILED" || r.status === "NEEDS_DB") ? 2 : 0);
}
const libDirs = ["open-abap-core/src", "express-icf-shim/src", "open-abap-apc/src", "open-abap-gui/src", "open-abap-gui/framework", "open-abap-odata/src", "ajson/src/core"]
  .map((x) => join(home, ".local", "lars", x)).filter(existsSync);
const folders = [...(fixture ? sourceFolders : inputFoldersOf(home, config).map((f) => join(home, f))), ...libDirs].filter(existsSync);
const excluded = (config.exclude_filter ?? []).map((p) => new RegExp(p));
const skip = (file) => excluded.some((re) => re.test("/" + file.slice(home.length + 1)));
const available = new Set(folders.flatMap(walk).filter((f) => !skip(f) && /\.(clas|intf)\.abap$/.test(f))
  .map((f) => f.split("/").at(-1).split(".")[0].replaceAll("#", "/").toUpperCase()));
const sourceByName = new Map(folders.flatMap(walk).filter((f) => !skip(f) && /\.clas\.abap$/.test(f))
  .map((f) => [f.split("/").at(-1).split(".")[0].replaceAll("#", "/").toUpperCase(), f]));
const objectByName = new Map(folders.flatMap(walk).filter((f) => !skip(f) && /\.(clas|intf)\.abap$/.test(f))
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
let wanted = new Set([...owners, "CL_ABAP_UNIT_ASSERT", "KERNEL_CX_ASSERT"]);
const sourceQueue = [...wanted];
while (sourceQueue.length) {
  const name = sourceQueue.shift();
  const file = sourceByName.get(name);
  if (!file) continue;
  const testFile = owners.includes(name) ? sources.find((f) => f.split("/").at(-1).startsWith(name.toLowerCase() + ".")) : undefined;
  const contents = readFileSync(file, "utf8") + (testFile ? "\n" + readFileSync(testFile, "utf8") : "");
  for (const ref of contents.matchAll(/\b(?:ZCL|ZCX|CL|CX)_[A-Z0-9_]+\b/gi)) {
    const target = ref[0].toUpperCase();
    if (available.has(target) && !wanted.has(target)) { wanted.add(target); sourceQueue.push(target); }
  }
}
let program;
let registry;
const timingMs = {frontendClosureRounds: [], emit: 0, goBuild: 0, run: 0};
for (let round = 0; round < 12; round++) {
  const started = performance.now();
  program = compileProgram({folders, objects: [...wanted], tolerant: true, includeTests: new Set(owners), skip, registry});
  registry = program.reg;
  const refs = new Set(referencedClasses(program));
  for (const name of wanted) {
    const sup = program.reg.getObject("CLAS", name)?.getDefinition()?.getSuperClass();
    if (sup) refs.add(sup.toUpperCase());
  }
  for (const c of program.classes) {
    if (c.super) refs.add(c.super);
    for (const m of c.methods) callsIn(m.body, refs);
  }
  const more = [...refs].filter((x) => available.has(x) && !wanted.has(x) && !x.includes(":"));
  timingMs.frontendClosureRounds.push(Math.round(performance.now() - started));
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
          const skip = skipped.has(`${owner}/${testclass}/${method}`);
          rows.push({class: owner, testclass, method, status: skip ? "SKIPPED" : compiled ? "READY" : "NOT_COMPILED",
            message: skip ? "skipped due to configuration" : why});
        }
      }
    }
  }
  return rows;
}

const rows = testsOf(program);
const classes = new Map(program.classes.map((c) => [c.name, c]));
function alertsOf(key, seen = new Set()) {
  if (seen.has(key)) return [];
  seen.add(key);
  const [name, method] = key.split("=>");
  const cls = classes.get(name);
  const m = cls?.methods.find((x) => x.name === method);
  if (!m) return cls?.stubs.find((x) => x.name === method)?.reason ? [cls.stubs.find((x) => x.name === method).reason] : [];
  const alerts = [];
  const visit = (n) => {
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (!n || typeof n !== "object") return;
    if (n.s === "stub") alerts.push(n.reason);
    if (n.e === "call") {
      const target = n.owner ?? (n.receiver?.type?.k === "ref" ? n.receiver.type.name : name);
      if (target) alerts.push(...alertsOf(`${target}=>${n.method}`, seen));
    }
    for (const [k, v] of Object.entries(n)) if (k !== "type") visit(v);
  };
  visit(m.body);
  return alerts;
}
for (const row of rows) if (row.status === "READY") {
  const name = `${row.class}:${row.testclass}`;
  row.alerts = [...new Set([row.method, "SETUP", "TEARDOWN", "CLASS_SETUP", "CLASS_TEARDOWN"]
    .flatMap((method) => alertsOf(`${name}=>${method}`)).filter(Boolean))];
}
// A test whose method or hooks reach SQL gets a fresh in-memory database for
// its class. Schema and generated object rows come from the same transpiler
// DatabaseSetup the Node init uses; TABU rows use test/seed.mjs.
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
  if ([row.method, "SETUP", "TEARDOWN", "CLASS_SETUP", "CLASS_TEARDOWN"].some((m) => needsDb(`${key}=>${m}`))) {
    row.db = true;
  }
}

// A package can import only packages below it. Promote a class when its
// static type or a direct call points upward; this also keeps class cycles
// together. Test include classes live in unit, ordinary repository classes
// in app, and the imported libraries in core.
const layer = new Map(program.classes.map((c) => {
  const owner = c.name.split(":")[0];
  const file = sourceByName.get(owner);
  return [c.name, c.name.includes(":") && owners.includes(owner) ? 2
    : file && libDirs.some((dir) => file.startsWith(dir + "/")) ? 0 : 1];
}));
const initialLayer = new Map(layer);
const interfaceLayer = new Map([...program.interfaceMethods.keys()].map((name) => {
  const file = objectByName.get(name);
  return [name, file && libDirs.some((dir) => file.startsWith(dir + "/")) ? 0 : 1];
}));
const structLayer = new Map([...program.structs.keys()].map((name) => [name, 0]));
const typeLayer = (t) => !t ? 0 : t.k === "table" ? typeLayer(t.row)
  : t.k === "struct" ? (structLayer.get(t.go) ?? 0)
    : t.k === "ref" ? (t.intf ? interfaceLayer.get(t.name) : layer.get(t.name)) ?? 0 : 0;
const classRefs = (c) => {
  const refs = new Set(referencedClasses({...program, classes: [c], structs: new Map()}));
  if (c.super) refs.add(c.super);
  for (const m of c.methods) callsIn(m.body, refs);
  for (const m of c.stubs ?? []) callsIn(m.body, refs);
  return refs;
};
const edges = new Map(program.classes.map((c) => [c.name, [...classRefs(c)].filter((ref) => layer.has(ref))]));
const index = new Map();
const low = new Map();
const stack = [];
const onStack = new Set();
const crossLayerCycles = [];
function visitCycle(name) {
  index.set(name, index.size);
  low.set(name, index.get(name));
  stack.push(name);
  onStack.add(name);
  for (const ref of edges.get(name) ?? []) {
    if (!index.has(ref)) { visitCycle(ref); low.set(name, Math.min(low.get(name), low.get(ref))); }
    else if (onStack.has(ref)) low.set(name, Math.min(low.get(name), index.get(ref)));
  }
  if (low.get(name) !== index.get(name)) return;
  const component = [];
  let member;
  do { member = stack.pop(); onStack.delete(member); component.push(member); } while (member !== name);
  if (component.length < 2 || new Set(component.map((n) => initialLayer.get(n))).size < 2) return;
  component.sort();
  crossLayerCycles.push(component);
  for (const n of component) if (layer.get(n) < 2) layer.set(n, 1);
}
for (const name of layer.keys()) if (!index.has(name)) visitCycle(name);
let promoted = true;
while (promoted) {
  promoted = false;
  for (const [name, st] of program.structs) {
    const next = Math.max(structLayer.get(name), ...st.fields.map((f) => typeLayer(f.type)));
    if (next > structLayer.get(name)) { structLayer.set(name, next); promoted = true; }
  }
  for (const [name, sigs] of program.interfaceMethods) {
    const next = Math.max(interfaceLayer.get(name), ...sigs.flatMap((m) => [typeLayer(m.returning?.type), ...m.params.map((p) => typeLayer(p.type))]));
    if (next > interfaceLayer.get(name)) { interfaceLayer.set(name, next); promoted = true; }
  }
  for (const c of program.classes) {
    let next = layer.get(c.name);
    for (const ref of classRefs(c)) next = Math.max(next, layer.get(ref) ?? 0);
    for (const intf of c.interfaces ?? []) next = Math.max(next, interfaceLayer.get(intf) ?? 0);
    for (const a of c.attributes ?? []) next = Math.max(next, typeLayer(a.type));
    for (const m of [...c.methods, ...(c.stubs ?? []), ...(c.constructor ? [c.constructor] : [])]) {
      next = Math.max(next, typeLayer(m.returning?.type));
      for (const p of m.params ?? []) next = Math.max(next, typeLayer(p.type));
      for (const l of m.locals ?? []) next = Math.max(next, typeLayer(l.type));
    }
    if (next > layer.get(c.name)) { layer.set(c.name, next); promoted = true; }
  }
}
const layerClasses = [0, 1, 2].map((i) => program.classes.filter((c) => layer.get(c.name) === i));
const allClassNames = new Set(program.classes.map((c) => c.name));
const layerInfo = {
  classes: Object.fromEntries(["core", "app", "unit"].map((name, i) => [name, layerClasses[i].length])),
  crossLayerCycles,
  promoted: [...layer].filter(([name, value]) => value > initialLayer.get(name))
    .map(([name, value]) => ({class: name, from: ["core", "app", "unit"][initialLayer.get(name)], to: ["core", "app", "unit"][value]})),
};
const eventsFor = (i) => new Map([...program.events].filter(([, ev]) =>
  (layer.get(ev.decl) ?? interfaceLayer.get(ev.decl) ?? 0) === i));
function writeGeneratedGo(dir) {
  if (args.includes("--unlayered") || fixture) {
    writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
    return;
  }
  const coreDir = join(here, "go", "generated", "core");
  const appDir = join(here, "go", "generated", "app");
  mkdirSync(coreDir, {recursive: true});
  mkdirSync(appDir, {recursive: true});
  const coreNames = new Set(layerClasses[0].map((c) => c.name));
  const appNames = new Set(layerClasses[1].map((c) => c.name));
  const coreInterfaces = new Set([...interfaceLayer].filter(([, i]) => i === 0).map(([name]) => name));
  const appInterfaces = new Set([...interfaceLayer].filter(([, i]) => i === 1).map(([name]) => name));
  const structsAt = (i) => new Map([...program.structs].filter(([name]) => structLayer.get(name) === i));
  const constsAt = (i) => new Map([...program.consts].filter(([name, c]) => {
    const owner = [...layer.keys()].find((cls) => name.startsWith(cls.replace(/[^A-Z0-9_]/g, "_") + "__"));
    return Math.max(owner ? layer.get(owner) : 0, typeLayer(c.type)) === i;
  }));
  writeFileSync(join(coreDir, "zz_generated.go"), emitGo(program, "core", {
    classes: layerClasses[0], structs: structsAt(0), consts: constsAt(0),
    interfaces: coreInterfaces, events: eventsFor(0), externalClasses: new Set([...allClassNames].filter((n) => !coreNames.has(n))),
    marker: "GogenCoreLayer",
  }));
  writeFileSync(join(appDir, "zz_generated.go"), emitGo(program, "app", {
    classes: layerClasses[1], structs: structsAt(1), consts: constsAt(1),
    interfaces: appInterfaces, events: eventsFor(1), externalClasses: new Set([...allClassNames].filter((n) => !appNames.has(n))),
    imports: ["osg/gogen/generated/core"], importMarkers: ["GogenCoreLayer"], marker: "GogenAppLayer",
  }));
  writeFileSync(join(dir, "zz_generated.go"), emitGo(program, "main", {
    classes: layerClasses[2], structs: structsAt(2), consts: constsAt(2),
    interfaces: new Set(), events: eventsFor(2), externalClasses: new Set([...allClassNames].filter((n) => layer.get(n) < 2)),
    imports: ["osg/gogen/generated/core", "osg/gogen/generated/app"],
    importMarkers: ["GogenCoreLayer", "GogenAppLayer"],
  }));
}

const emitStarted = performance.now();
const goName = (x) => x.toUpperCase().replace(/=>|~|-/g, "__").replace(/[^A-Z0-9_]/g, "_");
const ready = rows.filter((x) => x.status === "READY");
const groups = [...Map.groupBy(ready, (r) => `${r.class}:${r.testclass}`)].map(([key, methods]) => ({key, methods}));
const generated = ["package main", "", "import (_ \"embed\"; \"encoding/json\"; \"fmt\"; \"os\"; \"osg/gogen/abap\")", "",
  "//go:embed zz_db.json", "var dbScript []byte", "",
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
  if (methods.some((m) => m.db)) generated.push("classError = caught(func(){ if err := abap.OpenDB(dbScript); err != nil { panic(err) } })");
  if (c.methods.some((m) => m.name === "CLASS_SETUP")) generated.push(`if classError == "" { classError = caught(func(){ ${T}_CLASS_SETUP(s) }) }`);
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
writeGeneratedGo(dir);
writeFileSync(join(dir, "zz_main.go"), generated.join("\n") + "\n");
if (ready.some((r) => r.db)) {
  const {DatabaseSetup} = await import(`${home}/node_modules/@abaplint/transpiler/build/src/db/index.js`);
  const {seedStatements} = await import(`${home}/test/seed.mjs`);
  process.env.OSD_ROOT ??= home;
  const db = new DatabaseSetup(program.reg).run();
  writeFileSync(join(dir, "zz_db.json"), JSON.stringify([...db.schemas.sqlite, ...db.insert, ...seedStatements()]));
} else writeFileSync(join(dir, "zz_db.json"), "[]");
timingMs.emit = Math.round(performance.now() - emitStarted);
const summary = {classes: owners.length, compiled: new Set(ready.map((r) => r.class)).size, rows, timingMs, layers: layerInfo};
writeFileSync(join(out, "plan.json"), JSON.stringify(summary, null, 2));
if (!ready.length || args.includes("--build-only")) { console.log(JSON.stringify(summary)); process.exit(ready.length ? 0 : 2); }
const bin = join(out, "unit");
// The Go compiler can reject a method that the IR frontend accepted. Find
// its ABAP source position, retain its typed signature, and emit a method
// that raises NOT_COMPILED when reached. The next build reports any further
// errors, so unrelated owners can still share this one binary.
function stubGoErrors(diagnostics) {
  let changed = 0;
  for (const line of diagnostics.split("\n")) {
    const match = /^([^:\n]+\.abap):(\d+):\s*(.+)$/.exec(line);
    if (!match) continue;
    const [, file, rowText, reason] = match;
    const row = Number(rowText);
    const candidates = program.classes.flatMap((cls) =>
      [...cls.methods, ...(cls.constructor ? [cls.constructor] : [])]
        .filter((m) => m.pos?.file === file && m.pos.row <= row)
        .map((m) => ({cls, method: m})));
    candidates.sort((a, b) => b.method.pos.row - a.method.pos.row);
    const target = candidates[0];
    if (!target) continue;
    const {cls, method} = target;
    if (method.name === "CONSTRUCTOR") continue;
    cls.methods.splice(cls.methods.indexOf(method), 1);
    cls.stubs.push({...method, reason: `Go compiler: ${reason}`});
    changed++;
  }
  return changed;
}
let build;
for (let attempt = 0; attempt < 100; attempt++) {
  const buildStarted = performance.now();
  build = spawnSync("go", ["build", ...(process.env.GOGEN_GO_BUILD_X ? ["-x"] : []), "-trimpath", "-o", bin, "./cmd/unit"], {
    cwd: join(here, "go"), encoding: "utf8", env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/gogen-unit-gocache"}, maxBuffer: 5e6,
  });
  if (process.env.GOGEN_GO_BUILD_X) appendFileSync(join(out, "go-build-x.log"), build.stderr ?? "");
  timingMs.goBuild += Math.round(performance.now() - buildStarted);
  if (build.status === 0) break;
  if (!stubGoErrors(build.stderr ?? "")) break;
  const emitRetryStarted = performance.now();
  writeGeneratedGo(dir);
  timingMs.emit += Math.round(performance.now() - emitRetryStarted);
}
if (build.status !== 0) {
  const message = (build.stderr || build.error?.message || "go build failed").trim().split("\n").slice(0, 12).join("\n");
  for (const r of ready) { r.status = "NOT_COMPILED"; r.message = message; }
  console.log(JSON.stringify({...summary, rows}));
  process.exit(2);
}
const runStarted = performance.now();
const run = spawnSync(bin, [], {encoding: "utf8", timeout: 120000, maxBuffer: 20e6});
timingMs.run = Math.round(performance.now() - runStarted);
if (run.status !== 0) {
  for (const r of ready) { r.status = "FAILED"; r.message = `runner: ${run.stderr || run.error?.message || run.signal || run.status}`; }
  console.log(JSON.stringify({...summary, rows})); process.exit(1);
}
const reconciled = reconcile(ready, JSON.parse(run.stdout));
for (let i = 0; i < ready.length; i++) { ready[i].status = reconciled[i].status; ready[i].message = reconciled[i].message; }
console.log(JSON.stringify({...summary, rows}));
if (ready.some((x) => x.status === "FAILED")) process.exit(1);
