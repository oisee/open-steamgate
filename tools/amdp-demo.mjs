// A small, honest progress surface for Portable AMDP.
//
// It executes the tracked clean-room corpus through the real compiler and
// DuckDB runtime, then renders the same result as terminal text, JSON, or one
// self-contained HTML file.  The HTML deliberately has no application
// backend: it is a report over a run, not a second test runner.
import {copyFileSync, readFileSync, readdirSync, mkdirSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createServer} from "node:http";
import {extract} from "./amdp-extract.mjs";
import {compileProcedure} from "./sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "./sqlscript-procedure-ir.mjs";
import {refTo, seamType} from "./sqlscript-ir.mjs";
import {DuckDBDatabaseClient} from "./duckdb-client.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const corpusRoot = join(root, "test/fixtures/amdp-cleanroom");

const readJson = (name) => JSON.parse(readFileSync(join(corpusRoot, name), "utf8"));
const seed = () => readJson("seed-data.json");

const rankLeft = [
  {key_id: 1, group_id: 9, amount: 5, day_value: "20240101", note_text: "A"},
  {key_id: 2, group_id: 9, amount: 5, day_value: "20240102", note_text: "B"},
  {key_id: 3, group_id: 9, amount: 3, day_value: null, note_text: "C"},
  {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
  {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
];
const flowCells = [
  {cell_id: 1, bucket_id: 4, amount: 2.5, stamp: "20240229", label_text: "MiXeD"},
  {cell_id: 2, bucket_id: 4, amount: 0, stamp: null, label_text: null},
  {cell_id: 3, bucket_id: 5, amount: -1.25, stamp: "20240301", label_text: "xaxb"},
  {cell_id: 4, bucket_id: 5, amount: 7, stamp: "20240302", label_text: " "},
];
const simpleCells = [
  {cell_id: 1, label_text: "same", code_text: "A"},
  {cell_id: 2, label_text: null, code_text: "B"},
  {cell_id: 3, label_text: "left", code_text: "C"},
];
const searchCells = [
  {cell_id: 10, label_text: "AMBER", code_text: "A"},
  {cell_id: 11, label_text: "amber field", code_text: "B"},
  {cell_id: 12, label_text: "cobalt plain", code_text: "C"},
  {cell_id: 13, label_text: null, code_text: null},
];

// Inputs are demonstration data, not expected answers.  The compiler and
// runtime decide whether a case is executable; this registry only gives a
// supported method something typed to run against.
const scenarios = {
  squares: [{inputs: {IV_COUNT: 4}}],
  mix_rows: [{inputs: {IV_LIMIT: 10}, relations: () => ({
    IT_LEFT: seed().leftRows, IT_RIGHT: seed().rightRows,
  })}],
  rank_rows: [{relations: () => ({
    IT_LEFT: rankLeft, IT_RIGHT: [1, 2, 3, 4].map((key_id) => ({key_id, code_text: "Q", factor: 1})),
  })}],
  transform: [
    {label: "portable branch", inputs: {IV_SWITCH: 0}, relations: () => ({IT_CELLS: flowCells})},
    {label: "session branch", inputs: {IV_SWITCH: 10}, session: {values: {NEUTRAL_MODE: "portable"}},
      relations: () => ({IT_CELLS: flowCells})},
  ],
  difference_cells: [{relations: () => ({
    IT_LEFT: [simpleCells[0], simpleCells[0], simpleCells[1], simpleCells[2]],
    IT_RIGHT: [simpleCells[0], simpleCells[1]],
  })}],
  identity_cells: [{session: {currentUser: "DEMO_USER", currentSchema: "DEMO_SCHEMA"},
    relations: () => ({IT_CELLS: simpleCells})}],
  search_cells: [{inputs: {IV_QUERY: "amber"}, relations: () => ({IT_CELLS: searchCells})}],
  expand_values: [{}],
  optional_value: [{inputs: {IV_SEED: 11}}],
  scalar_value: [{inputs: {IV_SEED: -3}}],
  control_rows: [{inputs: {IV_LIMIT: 2}, relations: () => ({IT_LEFT: seed().leftRows})}],
};

const duckType = (type) => {
  if (type.abap === "I") return "INTEGER";
  if (type.abap === "P") return `DECIMAL(${type.len},${type.dec ?? 0})`;
  if (type.abap === "D") return "DATE";
  if (type.abap === "C") return `VARCHAR(${type.len})`;
  if (type.abap === "STRING") return "VARCHAR";
  throw new UnsupportedSqlScript(`demo has no DuckDB fixture type for ${type.abap}`);
};

async function materialize(client, name, rows, schema) {
  const columns = Object.entries(schema);
  const quoted = `"${name}"`;
  await client.execute(`CREATE TABLE ${quoted} (` +
    columns.map(([column, type]) => `"${column}" ${duckType(type)}`).join(", ") + ")");
  for (const row of rows) {
    await client.native({
      sql: `INSERT INTO ${quoted} VALUES (${columns.map(() => "?").join(", ")})`,
      params: columns.map(([column, type]) => ({
        name: column,
        value: row[column.toLowerCase()] ?? null,
        type: seamType(type),
        isNull: row[column.toLowerCase()] == null,
      })),
      expect: "none",
    });
  }
  return refTo({ref: quoted, kind: "materialised", reason: "typed demo fixture"}, schema);
}

function specimens() {
  const result = [];
  const demoSource = readFileSync(join(root, "src/amdp/zcl_osd_amdp_demo.clas.abap"), "utf8");
  const demo = extract(demoSource, "zcl_osd_amdp_demo.clas.abap");
  result.push({className: demo.className, method: demo.methods.find((one) => one.name === "squares"), types: demo.types});
  for (const file of readdirSync(corpusRoot).filter((name) => name.endsWith(".clas.abap.txt")).sort()) {
    // Match the logical clean-room filenames used by the compiler tests.
    // Extraction associates class definitions with their repository name;
    // feeding the archive-style fixture name here loses the signature even
    // though the method bodies remain visible.
    const logical = file.replace(/\.txt$/, "").replace(/^neutral_/, "cl_neutral_");
    const parsed = extract(readFileSync(join(corpusRoot, file), "utf8"), logical);
    for (const method of parsed.methods) result.push({className: parsed.className, method, types: parsed.types});
  }
  return result;
}

const shortError = (error) => ({
  code: error?.code ?? error?.name ?? "ERROR",
  message: String(error?.message ?? error).replace(/\s+/g, " ").trim(),
  ...(error?.line === undefined ? {} : {line: error.line, column: error.col}),
});

async function executeScenario(compiled, spec, index) {
  if (compiled.outputType !== undefined) {
    const answer = await runProcedure(compiled, {inputs: spec.inputs ?? {}});
    return {label: spec.label ?? `scenario ${index + 1}`, status: "executed", value: answer.value, trace: answer.trace};
  }
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  try {
    const relationInputs = {};
    const rowsByName = spec.relations?.() ?? {};
    for (const parameter of compiled.relationParameters) {
      const rows = rowsByName[parameter.name];
      if (rows === undefined) throw new UnsupportedSqlScript(`demo has no rows for ${parameter.name}`);
      relationInputs[parameter.name] = await materialize(client, `DEMO_${index}_${parameter.name}`, rows, parameter.schema);
    }
    const answer = await runProcedure(compiled, {
      client, dialect: "duckdb", inputs: spec.inputs ?? {}, relationInputs, inputCatalogue: {DUMMY: {}},
      session: spec.session ?? {},
    });
    return {
      label: spec.label ?? `scenario ${index + 1}`,
      status: "executed",
      rows: answer.rows,
      columns: answer.columns?.map((one) => one.name),
      trace: answer.trace,
    };
  } finally {
    await client.disconnect();
  }
}

export async function buildDemoReport() {
  const cases = [];
  for (const specimen of specimens()) {
    const name = specimen.method.name.toLowerCase();
    const item = {
      id: `${specimen.className}=>${specimen.method.name}`,
      className: specimen.className,
      method: specimen.method.name,
      source: specimen.method.body.trim(),
      native: {status: "not-run", reason: "HANA comparison is optional and was not requested for this run"},
      portable: {backend: "duckdb"},
    };
    let compiled;
    try {
      compiled = compileProcedure(specimen.method, specimen.types);
      item.portable.compile = "passed";
    } catch (error) {
      item.portable = {...item.portable, status: "refused", phase: "compile", error: shortError(error)};
      cases.push(item);
      continue;
    }
    const runs = [];
    for (const [index, spec] of (scenarios[name] ?? [{}]).entries()) {
      try {
        runs.push(await executeScenario(compiled, spec, index));
      } catch (error) {
        runs.push({label: spec.label ?? `scenario ${index + 1}`, status: "refused", error: shortError(error)});
      }
    }
    const executed = runs.filter((one) => one.status === "executed").length;
    item.portable.status = executed === runs.length ? "executed" : executed > 0 ? "partial" : "refused";
    item.portable.phase = executed === 0 ? "execute" : undefined;
    item.portable.runs = runs;
    cases.push(item);
  }
  const counts = Object.fromEntries(["executed", "partial", "refused"].map((status) =>
    [status, cases.filter((one) => one.portable.status === status).length]));
  return {
    schema: "osg-amdp-demo/v1",
    title: "Portable AMDP progress",
    generatedAt: new Date().toISOString(),
    backend: "DuckDB",
    policy: "Unsupported semantics are refused; no HANA fallback is available in this run.",
    counts,
    cases,
  };
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[char]);

export function renderDemoHtml(report) {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title><style>
:root{color-scheme:dark;--bg:#0b1726;--panel:#13243a;--line:#29435f;--text:#edf5ff;--muted:#9fb2c7;--ok:#44d19d;--partial:#ffc857;--no:#ff6b7a;--accent:#66b7ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}header{padding:22px 28px;border-bottom:1px solid var(--line);background:linear-gradient(120deg,#10243d,#182d49)}h1{margin:0 0 4px;font-size:25px}.muted{color:var(--muted)}.summary{display:flex;gap:12px;margin-top:15px;flex-wrap:wrap}.badge{padding:6px 10px;border:1px solid var(--line);border-radius:999px}.layout{display:grid;grid-template-columns:minmax(280px,34%) 1fr;height:calc(100vh - 132px)}nav{overflow:auto;border-right:1px solid var(--line);padding:12px}button.case{width:100%;text-align:left;background:transparent;color:var(--text);border:0;border-bottom:1px solid var(--line);padding:12px;cursor:pointer}button.case:hover,button.case.active{background:var(--panel)}.status{font-weight:700;text-transform:uppercase;font-size:11px}.executed{color:var(--ok)}.partial{color:var(--partial)}.refused{color:var(--no)}main{overflow:auto;padding:24px}section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}h2,h3{margin-top:0}pre{white-space:pre-wrap;word-break:break-word;background:#08121f;border-radius:8px;padding:14px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid var(--line);padding:7px}.trace{color:var(--accent)}@media(max-width:760px){.layout{display:block;height:auto}nav{border-right:0;max-height:38vh}main{padding:12px}}
</style></head><body><header><h1>${escapeHtml(report.title)}</h1><div class="muted">${escapeHtml(report.policy)}</div><div class="summary"><span class="badge executed">${report.counts.executed} executed</span><span class="badge partial">${report.counts.partial} partial</span><span class="badge refused">${report.counts.refused} refused</span><span class="badge">${escapeHtml(report.backend)}</span><span class="badge">${escapeHtml(report.generatedAt)}</span></div></header><div class="layout"><nav id="cases"></nav><main id="detail"></main></div>
<script>const report=${data};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pretty=v=>JSON.stringify(v,null,2);const nav=document.querySelector('#cases'),detail=document.querySelector('#detail');function show(item,button){document.querySelectorAll('.case').forEach(x=>x.classList.remove('active'));button?.classList.add('active');const p=item.portable;const runs=(p.runs??[]).map(run=>'<section><h3>'+esc(run.label)+' · <span class="status '+esc(run.status)+'">'+esc(run.status)+'</span></h3>'+(run.error?'<pre>'+esc(pretty(run.error))+'</pre>':'')+(run.value!==undefined?'<pre>value = '+esc(pretty(run.value))+'</pre>':'')+(run.rows?'<pre>'+esc(pretty(run.rows))+'</pre>':'')+(run.trace?'<div class="trace">trace</div><pre>'+esc(pretty(run.trace))+'</pre>':'')+'</section>').join('');detail.innerHTML='<h2>'+esc(item.id)+'</h2><section><b>Portable / '+esc(p.backend)+'</b> · <span class="status '+esc(p.status)+'">'+esc(p.status)+'</span>'+(p.error?'<pre>'+esc(pretty(p.error))+'</pre>':'')+'</section>'+runs+'<section><h3>Original SQLScript body</h3><pre>'+esc(item.source)+'</pre></section><section><h3>Native HANA</h3><div class="muted">'+esc(item.native.reason)+'</div></section>'}report.cases.forEach((item,i)=>{const b=document.createElement('button');b.className='case';b.innerHTML='<span class="status '+esc(item.portable.status)+'">'+esc(item.portable.status)+'</span><br>'+esc(item.id);b.onclick=()=>show(item,b);nav.appendChild(b);if(i===0)show(item,b)});</script></body></html>`;
}

export function terminalSummary(report) {
  const lines = [report.title, `${report.counts.executed} executed · ${report.counts.partial} partial · ${report.counts.refused} refused`, ""];
  for (const item of report.cases) {
    lines.push(`${item.portable.status.padEnd(8)} ${item.id}`);
    if (item.portable.error) lines.push(`         ${item.portable.error.message}`);
    for (const run of item.portable.runs ?? []) if (run.status === "refused") lines.push(`         ${run.label}: ${run.error.message}`);
  }
  return lines.join("\n");
}

export function writeDemoArtifacts(report, outFile) {
  const out = resolve(outFile);
  const story = join(dirname(out), "story.html");
  if (out === story) throw new Error("--out must not resolve to the companion story.html");
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, renderDemoHtml(report));
  copyFileSync(join(root, "docs/portable-amdp-report.html"), story);
  return {out, story};
}

export function resolveDemoRequest(requestUrl, artifacts) {
  const pathname = new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/" || pathname === "/index.html") return {status: 200, file: artifacts.out};
  if (pathname === "/story.html") return {status: 200, file: artifacts.story};
  return {status: 404};
}

async function main(argv) {
  const report = await buildDemoReport();
  const json = argv.includes("--json");
  const outAt = argv.indexOf("--out");
  const outFile = outAt >= 0 ? argv[outAt + 1] : join(root, ".local/amdp-demo/index.html");
  if (!outFile) throw new Error("--out needs a file path");
  const artifacts = writeDemoArtifacts(report, outFile);
  console.log(json ? JSON.stringify(report, null, 2) : terminalSummary(report));
  console.log(`\nLive ledger: ${artifacts.out}`);
  console.log(`Story: ${artifacts.story}`);
  const serveAt = argv.indexOf("--serve");
  if (serveAt >= 0) {
    const port = Number(argv[serveAt + 1] ?? 3037);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--serve needs a TCP port");
    createServer((request, response) => {
      const resolved = resolveDemoRequest(request.url, artifacts);
      if (resolved.status === 404) {
        response.writeHead(404, {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"});
        response.end("Not found\n");
        return;
      }
      response.writeHead(200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"});
      response.end(readFileSync(resolved.file));
    }).listen(port, "0.0.0.0", () => console.log(`Serving http://0.0.0.0:${port}/`));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
