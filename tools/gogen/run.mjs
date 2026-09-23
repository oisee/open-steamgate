// The Go backend spike, end to end:
//
//   node tools/gogen/run.mjs [samples-folder]
//
// 1. ABAP -> IR (frontend.mjs) -> Go (emit-go.mjs) -> go build
// 2. the same ABAP through @abaplint/transpiler -> JS, run in this process
// 3. the same cases on both, results compared, times side by side
//
// The expectations in CASES are ABAP's documented rules, not a measurement
// on a system; a disagreement between them and both backends is a question
// for A4H, not an answer.
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {readClass} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const samples = process.argv[2] ?? join(here, "samples");
const out = join(here, ".out");
rmSync(out, {recursive: true, force: true});
mkdirSync(join(out, "js"), {recursive: true});

const C = "ZCL_GOGEN_BENCH";
const CASES = [
  // semantics: ABAP's documented rules in `expect`
  {name: "7 / 2", method: "DIVIDE", args: [7, 2], expect: 4},
  {name: "-7 / 2", method: "DIVIDE", args: [-7, 2], expect: -4},
  {name: "5 / 3", method: "DIVIDE", args: [5, 3], expect: 2},
  {name: "-5 / 3", method: "DIVIDE", args: [-5, 3], expect: -2},
  {name: "0 / 0", method: "DIVIDE", args: [0, 0], expect: 0},
  {name: "1 / 0", method: "DIVIDE", args: [1, 0], expect: "CX_SY_ZERODIVIDE"},
  {name: "7 DIV 2", method: "INTEGER_DIV", args: [7, 2], expect: 3},
  {name: "-7 DIV 2", method: "INTEGER_DIV", args: [-7, 2], expect: -4},
  {name: "7 DIV -2", method: "INTEGER_DIV", args: [7, -2], expect: -3},
  {name: "-7 DIV -2", method: "INTEGER_DIV", args: [-7, -2], expect: 4},
  {name: "7 MOD 2", method: "MODULO", args: [7, 2], expect: 1},
  {name: "-7 MOD 2", method: "MODULO", args: [-7, 2], expect: 1},
  {name: "7 MOD -2", method: "MODULO", args: [7, -2], expect: 1},
  {name: "-7 MOD -2", method: "MODULO", args: [-7, -2], expect: 1},
  {name: "f 2.5 -> i", method: "FLOAT_TO_INT", args: [2.5], expect: 3},
  {name: "f -2.5 -> i", method: "FLOAT_TO_INT", args: [-2.5], expect: -3},
  {name: "f 1.4999 -> i", method: "FLOAT_TO_INT", args: [1.4999], expect: 1},
  {name: "f 3e9 -> i", method: "FLOAT_TO_INT", args: [3e9], expect: "CX_SY_CONVERSION_OVERFLOW"},
  {name: "i 3 / i 2 -> f", method: "DIVIDE_INTO_FLOAT", args: [3, 2], expect: 1.5},
  {name: "i -7 / i 2 -> f", method: "DIVIDE_INTO_FLOAT", args: [-7, 2], expect: -3.5},
  {name: "fib(20)", method: "FIB", args: [20], expect: 6765},
  // work: no expectation, the two backends must agree
  {name: "plasma frame", method: "PLASMA", args: [7], repeat: 20, bench: true},
  {name: "fib(25)", method: "FIB", args: [25], repeat: 10, bench: true},
  {name: "primes to 50 000", method: "PRIMES", args: [50000], repeat: 10, bench: true},
  {name: "table 1 000 000 rows", method: "TABLE_SUM", args: [1000000], repeat: 10, bench: true},
];

/* ------------------------------------------------------------------ Go side */
const t0 = performance.now();
const classes = readClass(samples);
const ir = JSON.stringify(classes, null, 1);
writeFileSync(join(out, "ir.json"), ir);
const goSource = emitGo(classes);
const genPath = join(here, "go", "cmd", "bench", "zz_generated.go");
writeFileSync(genPath, goSource);
execFileSync("gofmt", ["-w", genPath]);
const tFront = performance.now() - t0;
const bin = join(out, "bench");
const t1 = performance.now();
execFileSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", bin, "./cmd/bench"], {cwd: join(here, "go"), stdio: "inherit"});
const tBuild = performance.now() - t1;
const goCases = CASES.map((c) => ({name: c.name, method: `${C}=>${c.method}`, args: c.args, repeat: c.repeat ?? 0}));
const goResults = JSON.parse(execFileSync(bin, {input: JSON.stringify(goCases)}).toString());
// frames per second of the plasma kernel on 1 and on every core: one Session
// per goroutine, nothing shared, which is the work-process pool with the
// session not pinned to a process
const cores = (await import("node:os")).availableParallelism();
const FRAMES = 3200;
const parallel = JSON.parse(execFileSync(bin, {input: JSON.stringify([1, 2, 4, 8, cores].map((p) => (
  {name: `plasma x${p}`, method: `${C}=>PLASMA`, args: [7], repeat: FRAMES, parallel: p})))}).toString())
  .map((r, i) => ({goroutines: [1, 2, 4, 8, cores][i], framesPerSecond: Math.round(FRAMES / (r.wallNs / 1e9))}));

/* ------------------------------------------------------------------ JS side */
const require = createRequire(join(here, "..", "..", "package.json"));
const {Transpiler} = require("@abaplint/transpiler");
const files = readdirSync(samples).sort().map((f) => ({filename: f, contents: readFileSync(join(samples, f), "utf8")}));
const t2 = performance.now();
const transpiled = await new Transpiler({unknownTypes: "runtimeError"}).runRaw(files);
const tTranspile = performance.now() - t2;
let jsBytes = 0;
for (const o of transpiled.objects) {
  const code = o.chunk.getCode();
  jsBytes += Buffer.byteLength(code);
  writeFileSync(join(out, "js", o.filename), code);
}
writeFileSync(join(out, "js", "init.mjs"), transpiled.initializationScript);
await import(pathToFileURL(join(out, "js", "init.mjs")).href);
const cls = globalThis.abap.Classes[C];

async function runJs(c) {
  const call = async () => {
    try {
      const input = {};
      const sig = classes[0].methods.find((m) => m.name === c.method);
      sig.params.forEach((p, i) => { input[p.name.toLowerCase()] = c.args[i]; });
      const r = await cls[c.method.toLowerCase()](input);
      // an f answers get() with ABAP's text form ("1,5000000000000000E+00");
      // the number is getRaw()
      const v = r.get();
      return {value: typeof v === "number" ? v : Number(r.getRaw?.() ?? v)};
    } catch (e) {
      const name = e?.constructor?.name ?? String(e);
      if (/^cx_/i.test(name)) return {error: name.toUpperCase()};
      // the runtime raised the right class, which this harness does not load
      // (no open-abap-core here): count the raise, say it was not loaded
      const missing = /Global class (CX_\w+) not found/.exec(String(e?.message));
      if (missing) return {error: missing[1], note: "class not loaded in the harness"};
      return {error: `${name}: ${e?.message ?? ""}`.slice(0, 80)};
    }
  };
  const first = await call();
  const ns = [];
  for (let i = 0; i < (c.repeat ?? 0); i += 1) {
    const t = process.hrtime.bigint();
    await call();
    ns.push(Number(process.hrtime.bigint() - t));
  }
  return {...first, ns};
}

const jsResults = [];
for (const c of CASES) jsResults.push(await runJs(c));

/* ------------------------------------------------------------------ report */
const median = (xs) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const show = (r) => (r.error ? r.error : Number.isInteger(r.value) ? String(r.value) : r.value.toPrecision(6));
const rows = CASES.map((c, i) => {
  const g = goResults[i];
  const j = jsResults[i];
  const gv = g.error ? g.error : g.value;
  const jv = j.error ? j.error : j.value;
  return {
    name: c.name,
    expect: c.expect,
    go: show(g),
    js: show(j),
    goOk: c.expect === undefined ? undefined : gv === c.expect,
    jsOk: c.expect === undefined ? undefined : jv === c.expect,
    agree: gv === jv,
    goMs: median(g.ns ?? []) / 1e6,
    jsMs: median(j.ns) / 1e6,
  };
});
const report = {
  frontEndMs: Math.round(tFront),
  goBuildMs: Math.round(tBuild),
  goBinaryBytes: statSync(bin).size,
  goSourceBytes: Buffer.byteLength(goSource),
  jsTranspileMs: Math.round(tTranspile),
  jsSourceBytes: jsBytes,
  rows,
  parallel,
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));

const pad = (s, n) => String(s ?? "").padEnd(n);
console.log(`\nfront end + emit ${report.frontEndMs} ms · go build ${report.goBuildMs} ms · binary ${(report.goBinaryBytes / 1e6).toFixed(2)} MB`);
console.log(`generated Go ${report.goSourceBytes} B · transpiled JS ${report.jsSourceBytes} B (transpile ${report.jsTranspileMs} ms)\n`);
console.log(`${pad("case", 22)}${pad("ABAP rule", 26)}${pad("Go", 26)}${pad("JS", 26)}`);
for (const r of rows.filter((x) => x.expect !== undefined)) {
  const mark = (ok) => (ok ? "  " : "✗ ");
  console.log(`${pad(r.name, 22)}${pad(r.expect, 26)}${pad(mark(r.goOk) + r.go, 26)}${pad(mark(r.jsOk) + r.js, 26)}`);
}
console.log(`\n${pad("work", 22)}${pad("Go ms (median)", 18)}${pad("JS ms (median)", 18)}${pad("JS / Go", 10)}agree`);
for (const r of rows.filter((x) => x.expect === undefined)) {
  console.log(`${pad(r.name, 22)}${pad(r.goMs.toFixed(3), 18)}${pad(r.jsMs.toFixed(3), 18)}${pad((r.jsMs / r.goMs).toFixed(1) + "×", 10)}${r.agree ? "yes" : `NO  go=${r.go} js=${r.js}`}`);
}
const plasmaJs = rows.find((r) => r.name === "plasma frame");
console.log(`\nplasma frames/s: JS one thread ${Math.round(1000 / plasmaJs.jsMs)}; Go ` +
  parallel.map((p) => `${p.goroutines} goroutine${p.goroutines > 1 ? "s" : ""} ${p.framesPerSecond}`).join(" · "));
