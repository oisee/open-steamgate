#!/usr/bin/env node
// Where the time of a SELECT into an internal table goes, and what the
// table costs in heap: the instrument of docs/research-db-itab-shared-memory.md.
//
//   node research/shmem/measure.mjs [rows] [sqlite,duckdb] [eager,lazy]
//
// A build that includes the research pack is required:
//   OSD_PACKS=research/shmem/pack npm run transpile
//
// For every (store, mode) a child process boots the transpiled runtime the
// way bench-cube does (STG_DB, STG_DATA_SCALE) and calls the static methods
// of ZCL_OSD_SHMEM_BENCH, real transpiled ABAP, one at a time. The whole
// sequence runs REPEAT times in the child; reported per step: the median
// and the best wall time (performance.now), and the heap after a forced GC.
//
// Three layers are told apart by wrapping, not by simulation:
//   engine   the engine's own call (sql.js exec / DuckDB runAndReadAll)
//   client   DatabaseClient.select: engine + turning the result into rows
//   total    abap.statements.select: client + building the internal table
// so  rows = client - engine  and  itab = total - client.
//
// Positive controls, so that a zero means something: the wrappers count
// their calls, the row count is checked against the scale asked for, a
// timer control sleeps 100 ms, a heap control allocates a million small
// objects, and in lazy mode the PoC's own counters say how many rows and
// fields were materialised by which step.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {performance} from "node:perf_hooks";

const REPEAT = Number(process.env.SHMEM_REPEAT ?? 3);
const STEPS = ["select_all", "count_lines", "read_sparse", "loop_one_field", "loop_all_fields", "abap_cube", "copy_table", "release", "select_narrow", "select_cube"];

const heap = () => {
  globalThis.gc();
  globalThis.gc();
  const m = process.memoryUsage();
  return {heap_mb: m.heapUsed / 1048576, external_mb: (m.external + m.arrayBuffers) / 1048576, rss_mb: m.rss / 1048576};
};

async function child() {
  const from = (file) => import(new URL(`../../output/${file}`, import.meta.url).href);
  const bootStart = performance.now();
  const {initializeABAP} = await from("init.mjs");
  await initializeABAP();
  const {zcl_osd_shmem_bench: bench} = await from("zcl_osd_shmem_bench.clas.mjs");
  const boot = performance.now() - bootStart;
  const abap = globalThis.abap;
  const db = abap.context.databaseConnections.DEFAULT;

  // the three layers
  const t = {engine: 0, client: 0, total: 0, engineCalls: 0, clientCalls: 0, totalCalls: 0};
  const wrap = (object, name, slot) => {
    const original = object[name];
    object[name] = function (...args) {
      const started = performance.now();
      const done = () => { t[slot] += performance.now() - started; t[slot + "Calls"]++; };
      let result;
      try { result = original.apply(this, args); } catch (e) { done(); throw e; }
      if (typeof result?.then === "function") return result.finally(done);
      done();
      return result;
    };
  };
  if (db.sqlite !== undefined) wrap(db.sqlite, "exec", "engine");
  else if (db.connection !== undefined) wrap(db.connection, "runAndReadAll", "engine");
  else throw new Error("measure: no engine to wrap on this client");
  wrap(db, "select", "client");
  wrap(abap.statements, "select", "total");

  const out = {store: process.env.STG_DB ?? "sqlite", rows: Number(process.env.STG_DATA_SCALE ?? 0),
    mode: process.env.OSD_LAZY_ITAB === "1" ? "lazy" : "eager", boot_ms: boot, steps: {}, controls: {}};

  // controls
  {
    const started = performance.now();
    await new Promise((r) => setTimeout(r, 100));
    out.controls.timer_100ms = performance.now() - started;
    const before = heap();
    let keep = [];
    for (let i = 0; i < 1000000; i++) keep.push({a: i, b: "x" + i});
    out.controls.heap_1m_objects_mb = heap().heap_mb - before.heap_mb;
    out.controls.kept = keep.length;
    keep = undefined;
  }

  const lazy = globalThis.osdLazyItab;
  const base = heap();
  const samples = {};
  for (let run = 0; run < REPEAT; run++) {
    for (const step of STEPS) {
      Object.assign(t, {engine: 0, client: 0, total: 0, engineCalls: 0, clientCalls: 0, totalCalls: 0});
      const counters = lazy?.reset();
      const started = performance.now();
      const answer = await bench[step]();
      const ms = performance.now() - started;
      const after = heap();
      const value = answer === undefined ? undefined : String(answer.get());
      (samples[step] ??= []).push({ms, engine: t.engine, client: t.client, total: t.total,
        calls: [t.engineCalls, t.clientCalls, t.totalCalls], heap_mb: after.heap_mb - base.heap_mb,
        external_mb: after.external_mb - base.external_mb, rss_mb: after.rss_mb, value, lazy: counters === undefined ? undefined : lazy.read()});
    }
  }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  for (const step of STEPS) {
    const s = samples[step];
    const values = new Set(s.map((x) => x.value));
    if (values.size !== 1) throw new Error(`measure: ${step} answered differently between runs: ${[...values].join(" / ")}`);
    const isSelect = step.startsWith("select_");
    if (isSelect && s.some((x) => x.calls.some((c) => c !== 1))) {
      throw new Error(`measure: ${step}: the wrappers were not each hit once (${JSON.stringify(s.map((x) => x.calls))}); the split would be a guess`);
    }
    out.steps[step] = {
      median_ms: median(s.map((x) => x.ms)), best_ms: Math.min(...s.map((x) => x.ms)),
      ...(isSelect ? {engine_ms: median(s.map((x) => x.engine)), rows_ms: median(s.map((x) => x.client - x.engine)), itab_ms: median(s.map((x) => x.total - x.client))} : {}),
      heap_mb: median(s.map((x) => x.heap_mb)), external_mb: median(s.map((x) => x.external_mb)), rss_mb: Math.max(...s.map((x) => x.rss_mb)),
      value: s[0].value, lazy: s[s.length - 1].lazy,
    };
  }
  // the row count is the scale asked for plus the 24 seed rows
  if (Number(out.steps.select_all.value) !== out.rows + 24) {
    throw new Error(`measure: ${out.steps.select_all.value} rows selected, ${out.rows + 24} expected: the data was not scaled`);
  }
  out.semantics = String((await bench.semantics()).get());
  process.stdout.write("MEASURE " + JSON.stringify(out) + "\n");
  process.exit(0);
}

function run(store, rows, mode) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--expose-gc", "--max-old-space-size=12000", fileURLToPath(import.meta.url), "--child"], {
      env: {...process.env, STG_DB: store, STG_DATA_SCALE: String(rows), OSD_LAZY_ITAB: mode === "lazy" ? "1" : "", STG_DB_PATH: ""},
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; });
    p.on("exit", (code) => {
      const line = buf.split("\n").find((l) => l.startsWith("MEASURE "));
      if (code !== 0 || !line) reject(new Error(`${store}/${mode}: exit ${code}, no result\n${buf.slice(-2000)}`));
      else resolve(JSON.parse(line.slice(8)));
    });
  });
}

const f = (n) => (n === undefined ? "" : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

if (process.argv.includes("--child")) {
  await child();
} else {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rows = Number(args[0] ?? 100000);
  const stores = (args[1] ?? "sqlite,duckdb").split(",");
  const modes = (args[2] ?? "eager").split(",");
  const results = [];
  for (const store of stores) {
    for (const mode of modes) results.push(await run(store, rows, mode));
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(results, null, 1));
  }
  console.log(`\nZSTG_FLIGHTFACT, ${rows.toLocaleString("en")} facts + 24 seeds, median of ${REPEAT} (best) in ms; heap = retained after GC, MB over the booted runtime\n`);
  const head = results.map((r) => `${r.store}/${r.mode}`);
  console.log(["step", ...head].join("\t"));
  for (const step of STEPS) {
    console.log([step, ...results.map((r) => `${f(r.steps[step].median_ms)} (${f(r.steps[step].best_ms)})`)].join("\t"));
    if (step.startsWith("select_")) {
      for (const part of ["engine_ms", "rows_ms", "itab_ms"]) {
        console.log(["  " + part.replace("_ms", ""), ...results.map((r) => f(r.steps[step][part]))].join("\t"));
      }
    }
    console.log(["  heap MB", ...results.map((r) => f(r.steps[step].heap_mb))].join("\t"));
    if (results.some((r) => r.steps[step].lazy !== undefined)) {
      console.log(["  materialised", ...results.map((r) => (r.steps[step].lazy === undefined ? "-" : JSON.stringify(r.steps[step].lazy)))].join("\t"));
    }
  }
  console.log(["peak rss MB", ...results.map((r) => f(Math.max(...STEPS.map((s) => r.steps[s].rss_mb))))].join("\t"));
  console.log(["control: 100 ms timer", ...results.map((r) => f(r.controls.timer_100ms))].join("\t"));
  console.log(["control: 1M objects, MB", ...results.map((r) => f(r.controls.heap_1m_objects_mb))].join("\t"));
  // identical answers, step by step and for the semantics digest, across every store and mode
  for (const step of [...STEPS, "semantics"]) {
    const answers = new Set(results.map((r) => (step === "semantics" ? r.semantics : r.steps[step].value)));
    console.log(`answers ${step}: ${answers.size === 1 ? "identical" : "DIFFERENT"}${step === "semantics" ? ` (${results[0].semantics.length} characters)` : ` (${results[0].steps[step].value ?? "-"})`}`);
    if (answers.size !== 1) {
      process.exitCode = 1;
      if (step === "semantics") results.forEach((r) => console.log(`  ${r.store}/${r.mode}: ${r.semantics}`));
      else results.forEach((r) => console.log(`  ${r.store}/${r.mode}: ${r.steps[step].value}`));
    }
  }
}
