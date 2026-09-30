// Compare per-method outcomes from the instrumented Node Unit lifecycle
// with gogen's. Run `npm run transpile` first, or pass --node-json <file>.
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {home} from "./home.mjs";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const classes = args.flatMap((x, i) => x === "--class" ? [args[i + 1].toUpperCase()] : []);
const nodeJson = args.includes("--node-json") ? value("--node-json") : join(home, "output", "output.json");
if (!args.includes("--node-json")) {
  const script = join(home, "output", "index.mjs");
  if (!existsSync(script)) throw new Error("output/index.mjs is absent; run npm run transpile first");
  const run = spawnSync("node", ["--expose-gc", join(home, "tools", "gogen", "node-unit-results.mjs"), "--out", nodeJson,
    ...classes.flatMap((c) => ["--class", c])], {
    cwd: home, encoding: "utf8", timeout: 300000, maxBuffer: 20e6,
  });
  if (run.status !== 0) throw new Error(`Node Unit run failed: ${run.stderr || run.stdout || run.error?.message}`);
}
const rawNode = JSON.parse(readFileSync(nodeJson, "utf8"));
let result;
if (args.includes("--go-json")) result = JSON.parse(readFileSync(value("--go-json"), "utf8"));
else {
  const go = spawnSync("node", [join(home, "tools", "gogen", "unit.mjs"), ...classes.flatMap((c) => ["--class", c])], {
    cwd: home, encoding: "utf8", timeout: 900000, maxBuffer: 20e6,
  });
  if (!go.stdout) throw new Error(`Go Unit runner produced no results: ${go.stderr || go.error?.message}`);
  result = JSON.parse(go.stdout);
}
const key = (r) => `${r.class}/${r.testclass}/${r.method}`;
const norm = (r) => ({class: String(r.class ?? r.class_name).toUpperCase(),
  testclass: String(r.testclass ?? r.testclass_name).toUpperCase(), method: String(r.method ?? r.method_name).toUpperCase(),
  status: String(r.status).toUpperCase(), message: String(r.message ?? "").trim()});
const nodeRows = rawNode.map(norm);
const goRows = result.rows.map(norm);
const owners = new Set(classes.length ? classes : [...nodeRows, ...goRows].map((r) => r.class));
const node = new Map(nodeRows.filter((r) => owners.has(r.class)).map((r) => [key(r), r]));
const gorows = new Map(goRows.filter((r) => owners.has(r.class)).map((r) => [key(r), r]));
const methods = {same: [], different: [], nodeOnly: [], goOnly: [], skipped: []};
for (const [k, n] of node) {
  const g = gorows.get(k);
  if (n.status === "SKIPPED" && g?.status === "SKIPPED") methods.skipped.push({key: k, node: n, go: g});
  else if (n.status === "SKIPPED" || g?.status === "SKIPPED") methods.different.push({key: k, node: n, go: g});
  else if (!g || g.status === "NOT_COMPILED" || g.status === "NEEDS_DB") methods.nodeOnly.push({key: k, node: n, go: g});
  else if (g.status === n.status && g.message === n.message) methods.same.push(k);
  else methods.different.push({key: k, node: n, go: g});
}
for (const [k, g] of gorows) if (!node.has(k)) methods.goOnly.push({key: k, go: g});
const compiled = [];
const notCompiled = [];
for (const owner of owners) {
  const rows = goRows.filter((r) => r.class === owner);
  const first = rows.find((r) => r.status === "NOT_COMPILED" || r.status === "NEEDS_DB");
  if (first) notCompiled.push({class: owner, reason: `${first.status}: ${first.message}`});
  else if (rows.some((r) => r.status === "SUCCESS" || r.status === "FAILED")) compiled.push(owner);
  else if (rows.length && rows.every((r) => r.status === "SKIPPED")) notCompiled.push({class: owner, reason: "all methods skipped by configuration"});
  else notCompiled.push({class: owner, reason: "no test methods discovered"});
}
const summary = {classes: {compiled, notCompiled}, methods};
console.log(JSON.stringify(summary, null, 2));
if (notCompiled.length || !methods.same.length || methods.different.length || methods.goOnly.length || methods.nodeOnly.length) process.exitCode = 1;
