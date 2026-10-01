// The size budget: monoliths may shrink, never grow (tools/osd-size-budget.json).
//
//   node tools/osd-size-budget.mjs              check; exit 1 on a breach
//   node tools/osd-size-budget.mjs --update     lower every budget to what is
//                                               there now, record new packages,
//                                               drop exemptions no longer needed
//   node tools/osd-size-budget.mjs --base <ref> also: a budget raised against
//                                               the one at <ref> needs a reason
//
// What it checks, each a ratchet that only loosens through an edit of the
// budget file a reviewer sees:
//   - every budgeted file and Go package is within its budget (physical lines;
//     a Go package without its tests and generated zz_ files);
//   - a .go file in go/abap without a budget has budget 0: new capabilities go
//     in a package of their own (tools/gogen/go/<name>), go/abap keeps binding;
//   - a Go file over fileLimits.go lines, or a tools/**/*.mjs over
//     fileLimits.mjs, needs a budget of its own;
//   - every package under tools/gogen/go has a budget (--update records a new
//     one), a README.md of at least three lines, and does not depend on
//     osg/gogen/abap -- unless it is on the exemption lists, which only shrink.
// It runs at pre-push (.githooks/pre-push) and in CI (gogen.yml).
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET = join(ROOT, "tools", "osd-size-budget.json");
const GO = join(ROOT, "tools", "gogen", "go");
const HINT = "carve it into a package of its own (docs/backlog/gogen-osgo.md, \"modules\"), or raise the budget in tools/osd-size-budget.json with a reason";

const lines = (file) => {
  const text = readFileSync(file, "utf8");
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};
const rel = (p) => relative(ROOT, p).split("\\").join("/");

/** the Go packages: directories under tools/gogen/go with .go files, but
 * not generated/ or testdata/ */
function goPackages() {
  const out = [];
  const walk = (dir) => {
    const names = readdirSync(dir).sort();
    if (names.some((n) => n.endsWith(".go"))) out.push(dir);
    for (const n of names) {
      const p = join(dir, n);
      if (n === "testdata" || n === "generated" || n.startsWith(".") || !statSync(p).isDirectory()) continue;
      walk(p);
    }
  };
  walk(GO);
  return out;
}

/** a package's own code: no tests, no generated zz_ files */
const ownGoFiles = (dir) => readdirSync(dir).sort()
  .filter((n) => n.endsWith(".go") && !n.endsWith("_test.go") && !n.startsWith("zz_"))
  .map((n) => join(dir, n));

const pkgName = (dir) => rel(dir).replace(/^tools\/gogen\/go\//, "");

function mjsFiles(dir = join(ROOT, "tools"), out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (n === "node_modules" || n === ".out" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) mjsFiles(p, out);
    else if (n.endsWith(".mjs")) out.push(p);
  }
  return out;
}

/** package -> does it depend on osg/gogen/abap; undefined without Go */
export function abapDependents() {
  try {
    const listing = execFileSync("go", ["list", "-f", "{{.ImportPath}} {{join .Deps \" \"}}", "./..."], {cwd: GO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    const out = new Map();
    for (const line of listing.trim().split("\n")) {
      const [path, ...deps] = line.split(" ");
      out.set(path.replace(/^osg\/gogen\//, ""), deps.includes("osg/gogen/abap"));
    }
    return out;
  } catch {
    return undefined;
  }
}

/** what is there now: {key: lines} for files and packages */
export function measure(budget) {
  const sizes = {};
  for (const dir of goPackages()) {
    const files = ownGoFiles(dir);
    sizes[`go:${pkgName(dir)}`] = files.reduce((n, f) => n + lines(f), 0);
    for (const f of files) sizes[rel(f)] = lines(f);
  }
  for (const f of mjsFiles()) sizes[rel(f)] = lines(f);
  for (const f of budget.watched ?? []) if (existsSync(join(ROOT, f))) sizes[f] = lines(join(ROOT, f));
  return sizes;
}

export function check(budget, sizes, {deps, base} = {}) {
  const errors = [];
  const b = budget.budgets;
  const limitGo = budget.fileLimits?.go ?? 800;
  const limitMjs = budget.fileLimits?.mjs ?? 1000;
  for (const [key, entry] of Object.entries(b)) {
    if (sizes[key] === undefined) continue;
    if (sizes[key] > entry.lines) errors.push(`${key}: ${sizes[key]} lines, budget ${entry.lines} -- ${HINT}`);
  }
  for (const [key, n] of Object.entries(sizes)) {
    if (b[key]) continue;
    if (key.startsWith("tools/gogen/go/abap/") && key.endsWith(".go")) {
      errors.push(`${key}: a new file in go/abap (budget 0) -- a new capability goes in tools/gogen/go/<name> with a README; go/abap keeps binding glue`);
    } else if (key.endsWith(".go") && n > limitGo) {
      errors.push(`${key}: ${n} lines, over ${limitGo} without a budget -- ${HINT}`);
    } else if (key.endsWith(".mjs") && n > limitMjs) {
      errors.push(`${key}: ${n} lines, over ${limitMjs} without a budget -- ${HINT}`);
    } else if ((budget.watched ?? []).includes(key)) {
      errors.push(`${key}: watched, without a budget -- run --update`);
    } else if (key.startsWith("go:")) {
      errors.push(`${key}: a package without a budget -- run node tools/osd-size-budget.mjs --update to record it`);
    }
  }
  for (const key of Object.keys(sizes).filter((k) => k.startsWith("go:"))) {
    const name = key.slice(3);
    if (name === "abap" || name.startsWith("cmd/")) continue;
    const readme = join(GO, name, "README.md");
    const short = !existsSync(readme) || lines(readme) < 3;
    if (short && !(budget.readmeMissing ?? []).includes(name)) {
      errors.push(`tools/gogen/go/${name}: no README.md of at least three lines (what it is, its API, its invariants)`);
    }
    if (deps?.get(name) && !(name in (budget.importsAbap ?? {}))) {
      errors.push(`tools/gogen/go/${name}: depends on osg/gogen/abap -- a package takes a narrow interface; only go/abap imports packages`);
    }
  }
  if (base) {
    for (const [key, entry] of Object.entries(b)) {
      const was = base.budgets?.[key];
      if (was && entry.lines > was.lines && (!entry.reason || entry.reason === was.reason)) {
        errors.push(`${key}: budget raised ${was.lines} -> ${entry.lines} without a new reason`);
      }
    }
  }
  return errors;
}

export function update(budget, sizes, {deps} = {}) {
  const b = budget.budgets;
  for (const [key, entry] of Object.entries(b)) {
    if (sizes[key] === undefined) delete b[key];
    else if (sizes[key] < entry.lines) entry.lines = sizes[key];
  }
  // a new package is recorded; a new go/abap file or an oversize file is not
  // (those need a budget written by hand, with a reason)
  for (const [key, n] of Object.entries(sizes)) {
    if (key.startsWith("go:") && !b[key]) b[key] = {lines: n, reason: "recorded by --update"};
    if ((budget.watched ?? []).includes(key) && !b[key]) b[key] = {lines: n, reason: "recorded by --update"};
  }
  budget.readmeMissing = (budget.readmeMissing ?? []).filter((name) => {
    const readme = join(GO, name, "README.md");
    return sizes[`go:${name}`] !== undefined && (!existsSync(readme) || lines(readme) < 3);
  });
  if (deps) {
    budget.importsAbap = Object.fromEntries(Object.entries(budget.importsAbap ?? {}).filter(([name]) => deps.get(name)));
  }
  budget.budgets = Object.fromEntries(Object.entries(b).sort(([a], [c]) => a.localeCompare(c)));
  return budget;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const budget = JSON.parse(readFileSync(BUDGET, "utf8"));
  const sizes = measure(budget);
  const deps = abapDependents();
  if (args.includes("--update")) {
    writeFileSync(BUDGET, JSON.stringify(update(budget, sizes, {deps}), null, 2) + "\n");
    console.log("osd-size-budget: budgets lowered to what is there, new packages recorded");
  } else {
    let base;
    const at = args.indexOf("--base");
    if (at >= 0) {
      try {
        base = JSON.parse(execFileSync("git", ["show", `${args[at + 1]}:tools/osd-size-budget.json`], {cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}));
      } catch {
        base = undefined; // the base has no budget file yet
      }
    }
    const errors = check(budget, sizes, {deps, base});
    if (deps === undefined) console.error("osd-size-budget: no Go toolchain -- the dependency direction was not checked");
    if (errors.length > 0) {
      console.error(`osd-size-budget: ${errors.length} breach(es):`);
      for (const e of errors) console.error(`  ${e}`);
      process.exit(1);
    }
    console.log(`osd-size-budget: ${Object.keys(budget.budgets).length} budgets, all within`);
  }
}
