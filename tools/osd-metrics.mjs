// Trend metrics per package and module: size, cyclomatic complexity, and Go
// test coverage -- to watch, not to gate (the size budget is the gate).
//
//   node tools/osd-metrics.mjs [--coverage] > snapshot.json
//   node tools/osd-metrics.mjs --compare old.json new.json   the jumps
//
// A snapshot is one JSON object: the commit, the date, and per Go package
// (tools/gogen/go/<pkg>) and per JS module (tools/**/*.mjs of 300 lines or
// more) the lines, the budget and its headroom (tools/osd-size-budget.json),
// the number of functions, the sum and the maximum of their complexity, how
// many are over 15, and the five most complex. --coverage adds `go test
// -cover` per package (slow: it runs the tests). The McCabe count is the
// same for both languages: 1 plus each branch (if, loop, case, catch, ?:,
// && || ??).
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import * as acorn from "acorn";
import {measure} from "./osd-size-budget.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GO = join(ROOT, "tools", "gogen", "go");
const JS_MIN_LINES = 300;

/** McCabe per function of a JS module: [{name, line, complexity}] */
export function jsFunctions(source) {
  let ast;
  try {
    ast = acorn.parse(source, {ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true});
  } catch {
    return undefined;
  }
  const out = [];
  const isFunction = (n) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
  const count = (node) => {
    let c = 1;
    const walk = (n) => {
      if (!n || typeof n.type !== "string") return;
      if (n !== node && isFunction(n)) return; // its own function
      switch (n.type) {
        case "IfStatement": case "ForStatement": case "ForInStatement": case "ForOfStatement":
        case "WhileStatement": case "DoWhileStatement": case "ConditionalExpression": case "CatchClause":
          c++; break;
        case "SwitchCase": if (n.test) c++; break;
        case "LogicalExpression": c++; break;
      }
      for (const key of Object.keys(n)) {
        if (key === "loc" || key === "start" || key === "end") continue;
        const v = n[key];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v.type === "string") walk(v);
      }
    };
    walk(node.body);
    return c;
  };
  const visit = (n, name) => {
    if (!n || typeof n.type !== "string") return;
    if (isFunction(n)) out.push({name: n.id?.name ?? name ?? "anonymous", line: n.loc.start.line, complexity: count(n)});
    for (const key of Object.keys(n)) {
      if (key === "loc") continue;
      const v = n[key];
      const childName = n.type === "MethodDefinition" || n.type === "Property" ? n.key?.name ?? n.key?.value
        : n.type === "VariableDeclarator" ? n.id?.name : undefined;
      if (Array.isArray(v)) v.forEach((x) => visit(x, childName));
      else if (v && typeof v.type === "string") visit(v, childName);
    }
  };
  visit(ast);
  return out;
}

export function summarize(functions) {
  const sorted = [...functions].sort((a, b) => b.complexity - a.complexity);
  return {
    functions: functions.length,
    sum: functions.reduce((n, f) => n + f.complexity, 0),
    max: sorted[0]?.complexity ?? 0,
    over15: functions.filter((f) => f.complexity > 15).length,
    top: sorted.slice(0, 5),
  };
}

function goCoverage() {
  const out = {};
  try {
    const text = execFileSync("go", ["test", "-cover", "./..."], {cwd: GO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1e8});
    for (const line of text.split("\n")) {
      const m = /^ok\s+osg\/gogen\/(\S+)\s.*coverage: ([\d.]+)% of statements/.exec(line);
      if (m) out[m[1]] = Number(m[2]);
    }
  } catch (e) {
    for (const line of String(e.stdout ?? "").split("\n")) {
      const m = /^ok\s+osg\/gogen\/(\S+)\s.*coverage: ([\d.]+)% of statements/.exec(line);
      if (m) out[m[1]] = Number(m[2]);
    }
  }
  return out;
}

export function snapshot({coverage = false} = {}) {
  const budget = JSON.parse(readFileSync(join(ROOT, "tools", "osd-size-budget.json"), "utf8"));
  const sizes = measure(budget);
  const goFns = JSON.parse(execFileSync("go", ["run", "./cmd/metrics", "."], {cwd: GO, encoding: "utf8", maxBuffer: 1e8}));
  const cov = coverage ? goCoverage() : {};
  const go = {};
  for (const [pkg, m] of Object.entries(goFns)) {
    const key = `go:${pkg}`;
    go[pkg] = {lines: sizes[key] ?? 0, budget: budget.budgets[key]?.lines ?? null,
      functions: m.functions, sum: m.sum, max: m.max, over15: m.over15, top: m.top,
      ...(cov[pkg] !== undefined ? {coverage: cov[pkg]} : {})};
  }
  const js = {};
  for (const [file, lines] of Object.entries(sizes)) {
    if (!file.endsWith(".mjs") || lines < JS_MIN_LINES) continue;
    const fns = jsFunctions(readFileSync(join(ROOT, file), "utf8"));
    if (fns === undefined) continue;
    js[file] = {lines, budget: budget.budgets[file]?.lines ?? null, ...summarize(fns)};
  }
  let commit = "";
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: ROOT, encoding: "utf8"}).trim(); } catch { /* not a checkout */ }
  return {commit, date: new Date().toISOString(), go, js};
}

/** what jumped between two snapshots, the biggest rise in max first */
export function compare(before, after) {
  const rows = [];
  for (const kind of ["go", "js"]) {
    for (const [name, now] of Object.entries(after[kind] ?? {})) {
      const was = before[kind]?.[name];
      if (!was) { rows.push({kind, name, new: true, max: now.max, sum: now.sum}); continue; }
      const dMax = now.max - was.max;
      const dSum = now.sum - was.sum;
      const rel = was.sum > 0 ? dSum / was.sum : 0;
      if (dMax > 0 || rel > 0.2 || (now.coverage !== undefined && was.coverage !== undefined && now.coverage < was.coverage - 2)) {
        rows.push({kind, name, max: now.max, dMax, sum: now.sum, dSum, rel: Math.round(rel * 100), coverage: now.coverage, dCoverage: now.coverage !== undefined && was.coverage !== undefined ? +(now.coverage - was.coverage).toFixed(1) : undefined});
      }
    }
  }
  return rows.sort((a, b) => (b.dMax ?? b.max) - (a.dMax ?? a.max));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const read = (p) => JSON.parse(readFileSync(p, "utf8"));
    for (const r of compare(read(args[1]), read(args[2]))) console.log(JSON.stringify(r));
  } else {
    process.stdout.write(JSON.stringify(snapshot({coverage: args.includes("--coverage")}), null, 1) + "\n");
  }
}

