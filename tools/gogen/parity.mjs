// Parity: OSG's own HTTP-level suites, run against OSG on Node and against
// OSGo, the same test files, each suite file on a fresh server of each kind.
//
//   node tools/gogen/parity.mjs [--root <checkout>] [--osgo <binary>] [--media <dir>]
//        [--port 4610] [--out <dir>] [--suites a,b] [--only node|osgo] [--reuse-node]
//        [--timeout 30000] [--no-count] [--e2e] [--report-only]
//
// --report-only reads the last run's results (<out>/node-reference.json and
// <out>/osgo-results.json) and only classifies and writes the summary again.
//
// How a suite reaches its server: 16 files of test/suites.json call
// startServer() from test/start.mjs, which builds an express host in the
// suite's own process, and then fetch http://localhost:STG_PORT. The harness
// runs mocha with a module hook (parity/hooks.mjs) that turns test/start.mjs
// into a stub, so those fetches go to a server started here instead: the
// Node reference (parity/node-server.mjs, the same inline host in a process
// of its own) or the osgo binary. A probe (parity/register.mjs) notes every
// request a test sends to that port, with the status and, for an error, the
// body; a test that sent none is in-process and not comparable.
//
// Score = tests passing on OSGo / tests passing on Node, over the tests that
// passed on Node and sent at least one request there. Every other suite of
// test/suites.json is in-process (it imports output/ or a tool directly) and
// is counted, not run (mocha --dry-run), as "not applicable".
//
// --e2e adds the Playwright specs of test/e2e (the browser against the
// server, SAPUI5 from SAP's CDN): one server per backend for the whole run,
// as playwright.config.mjs has it, and the specs' results joined the same
// way. Every spec is HTTP-level by construction.
//
// Writes <out>/parity.json and <out>/parity.md (default .local/parity/).
import {spawn, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {home} from "./home.mjs";

const here = import.meta.dirname;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const root = resolve(arg("root", home));
const osgoBin = resolve(arg("osgo", join(here, ".out", "osgo")));
const media = arg("media", join(dirname(osgoBin), "media"));
const basePort = Number(arg("port", 4610));
const out = resolve(arg("out", join(home, ".local", "parity")));
const only = arg("only");
const testTimeout = Number(arg("timeout", 30000));
const mocha = join(root, "node_modules", "mocha", "bin", "mocha.js");
mkdirSync(join(out, "runs"), {recursive: true});

const listed = JSON.parse(readFileSync(join(root, "test", "suites.json"), "utf8")).files;
// an HTTP suite: it starts the gateway through test/start.mjs, statically
const isHttp = (f) => {
  const text = readFileSync(join(root, f), "utf8");
  return /^import \{startServer\} from "\.\/start\.mjs";/m.test(text) && /startServer\(/.test(text);
};
const httpSuites = arg("suites") ? arg("suites").split(",") : listed.filter(isHttp);
const naSuites = listed.filter((f) => !httpSuites.includes(f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(port, child, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) return false;
    try {
      await fetch(`http://127.0.0.1:${port}/`, {redirect: "manual", signal: AbortSignal.timeout(2000)});
      return true;
    } catch { await sleep(300); }
  }
  return false;
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    const t = setTimeout(() => { try { process.kill(child.pid, "SIGKILL"); } catch {} }, 5000);
    child.once("exit", () => { clearTimeout(t); done(); });
    try { process.kill(child.pid, "SIGTERM"); } catch { done(); }
  });
}

function startBackend(kind, port, log) {
  const stream = createWriteStream(log);
  const env = {...process.env, STG_PORT: String(port), STG_TLS: "0"};
  delete env.STG_SERVE;
  delete env.STG_DB;
  delete env.STG_DB_PATH;
  const child = kind === "node"
    ? spawn(process.execPath, ["--max-old-space-size=4000", join(here, "parity", "node-server.mjs")], {cwd: root, env, stdio: ["ignore", "pipe", "pipe"]})
    : spawn(osgoBin, ["-port", String(port), "-addr", "127.0.0.1", "-root", root, ...(existsSync(media) ? ["-media", media] : [])], {cwd: dirname(osgoBin), env, stdio: ["ignore", "pipe", "pipe"]});
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  return child;
}

function runMocha(files, port, recordFile, reportFile, extra = []) {
  const env = {...process.env, STG_PORT: String(port), PARITY_OUT: recordFile, STG_TLS: "0"};
  delete env.STG_SERVE;
  const r = spawnSync(process.execPath, [
    "--import", join(here, "parity", "register.mjs"), mocha,
    "--require", join(here, "parity", "root-hooks.mjs"),
    "--timeout", String(testTimeout), "--reporter", "json", "--reporter-option", `output=${reportFile}`,
    ...extra, ...files,
  ], {cwd: root, env, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 64 << 20});
  const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };
  return {status: r.status, signal: r.signal, stderr: String(r.stderr ?? "").slice(-3000), records: read(recordFile) ?? [], report: read(reportFile)};
}

const slug = (f) => f.replace(/^test\//, "").replace(/\.mjs$/, "");

async function runSuite(kind, file, port) {
  const base = join(out, "runs", `${kind}-${slug(file)}`);
  const child = startBackend(kind, port, `${base}.server.log`);
  const t0 = Date.now();
  const up = await waitUp(port, child, kind === "node" ? 240_000 : 120_000);
  const boot = Date.now() - t0;
  if (!up) {
    await stop(child);
    return {file, kind, up: false, boot, records: [], hookFailures: [], serverDied: true, log: tail(`${base}.server.log`)};
  }
  const m = runMocha([file], port, `${base}.records.json`, `${base}.mocha.json`);
  const died = child.exitCode !== null || child.signalCode !== null;
  await stop(child);
  // failures that are not a test: a hook ("before all" ...), which leaves the tests under it unrun
  const hookFailures = (m.report?.failures ?? []).filter((f) => /"(before|after) (all|each)" hook/.test(f.title))
    .map((f) => ({title: f.fullTitle, message: String(f.err?.message ?? "").slice(0, 600)}));
  const ran = (m.report?.tests ?? []).length;
  console.log(`  ${kind.padEnd(4)} ${file.padEnd(28)} boot ${String(boot).padStart(6)} ms  ${m.records.filter((r) => r.state === "passed").length}/${m.records.length} passed${hookFailures.length ? `, ${hookFailures.length} hook failure(s)` : ""}${died ? ", SERVER DIED" : ""}${m.report ? "" : ` (no report: exit ${m.status} ${m.signal ?? ""})`}`);
  return {file, kind, up: true, boot, ran, records: m.records, hookFailures, serverDied: died, mochaExit: m.status, mochaStderr: m.report ? undefined : m.stderr, log: died ? tail(`${base}.server.log`) : undefined};
}

function tail(f) {
  try { return readFileSync(f, "utf8").split("\n").slice(-15).join("\n"); } catch { return ""; }
}

// ---- run -----------------------------------------------------------------
const results = {node: {}, osgo: {}};
const cachePath = join(out, "node-reference.json");
const osgoPath = join(out, "osgo-results.json");
const reportOnly = flag("report-only");
if (reportOnly) {
  results.node = JSON.parse(readFileSync(cachePath, "utf8"));
  results.osgo = JSON.parse(readFileSync(osgoPath, "utf8"));
  for (const f of Object.keys(results.osgo)) if (!httpSuites.includes(f)) httpSuites.push(f);
}
if (flag("reuse-node") && existsSync(cachePath)) {
  results.node = JSON.parse(readFileSync(cachePath, "utf8"));
  console.log(`node reference: reused ${cachePath}`);
}
if (!reportOnly && !existsSync(osgoBin) && only !== "node") {
  console.error(`no osgo binary at ${osgoBin} (node tools/gogen/osgo.mjs builds it)`);
  process.exit(2);
}
console.log(`parity: ${httpSuites.length} HTTP suites, checkout ${root}, osgo ${osgoBin}`);
for (const file of reportOnly ? [] : httpSuites) {
  if (only !== "osgo" && results.node[file] === undefined) results.node[file] = await runSuite("node", file, basePort + 1);
  if (only !== "node") results.osgo[file] = await runSuite("osgo", file, basePort + 2);
}

// the Playwright specs, one server per backend for the whole run
async function runE2e(kind, port) {
  const base = join(out, "runs", `${kind}-e2e`);
  const config = `${base}.playwright.config.mjs`;
  writeFileSync(config, `export default ${JSON.stringify({
    testDir: join(root, "test", "e2e"), testIgnore: "**/*preview*.spec.mjs", workers: 1, timeout: 90_000, expect: {timeout: 30_000}, retries: 0,
    outputDir: `${base}.artifacts`, reporter: [["json", {outputFile: `${base}.playwright.json`}]],
    use: {baseURL: `http://localhost:${port}`, headless: true},
  })};\n`);
  const child = startBackend(kind, port, `${base}.server.log`);
  const up = await waitUp(port, child, kind === "node" ? 240_000 : 120_000);
  const records = [];
  if (up) {
    const env = {...process.env, STG_PORT: String(port)};
    spawnSync(process.execPath, [join(root, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", config],
      {cwd: root, env, encoding: "utf8", timeout: 40 * 60_000, maxBuffer: 64 << 20});
    let report;
    try { report = JSON.parse(readFileSync(`${base}.playwright.json`, "utf8")); } catch {}
    const walk = (suite, path) => {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const r = t.results?.[t.results.length - 1];
          const status = r?.status ?? "skipped";
          const msg = String(r?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "");
          records.push({title: `e2e ${[...path, spec.title].join(" ")}`, state: status === "passed" ? "passed" : status === "skipped" ? "pending" : "failed",
            duration: r?.duration, err: status === "passed" ? undefined : {message: msg.slice(0, 800), timeout: /Timeout \d+ms exceeded|timed out/i.test(msg)},
            // a spec drives the browser at the server, so every one is HTTP-level; its requests are not probed
            requests: [{method: "BROWSER", path: spec.file ?? suite.file ?? "", status: status === "passed" ? 200 : 0}]});
        }
      }
      for (const sub of suite.suites ?? []) walk(sub, [...path, sub.title]);
    };
    for (const s of report?.suites ?? []) walk(s, []);
  }
  const died = child.exitCode !== null || child.signalCode !== null;
  await stop(child);
  console.log(`  ${kind.padEnd(4)} test/e2e (playwright)         ${records.filter((r) => r.state === "passed").length}/${records.length} passed${died ? ", SERVER DIED" : ""}`);
  return {file: "test/e2e", kind, up, boot: 0, records, hookFailures: [], serverDied: died, log: died ? tail(`${base}.server.log`) : undefined};
}
if (flag("e2e") && !reportOnly) {
  httpSuites.push("test/e2e");
  if (only !== "osgo" && results.node["test/e2e"] === undefined) results.node["test/e2e"] = await runE2e("node", basePort + 1);
  if (only !== "node") results.osgo["test/e2e"] = await runE2e("osgo", basePort + 2);
}
if (!reportOnly && only !== "osgo") writeFileSync(cachePath, JSON.stringify(results.node));
if (!reportOnly && only !== "node") writeFileSync(osgoPath, JSON.stringify(results.osgo));

// the in-process suites, counted
let naCount;
if (reportOnly && existsSync(join(out, "runs", "na.mocha.json"))) {
  const r = JSON.parse(readFileSync(join(out, "runs", "na.mocha.json"), "utf8"));
  naCount = {suites: naSuites.length, tests: r.stats?.tests, counted: true};
} else if (!flag("no-count")) {
  const m = runMocha(naSuites, basePort + 3, join(out, "runs", "na.records.json"), join(out, "runs", "na.mocha.json"), ["--dry-run"]);
  naCount = {suites: naSuites.length, tests: m.report?.stats?.tests ?? (m.report?.tests ?? []).length, counted: m.report !== undefined};
}

// ---- compare ---------------------------------------------------------------
const tests = [];
for (const file of httpSuites) {
  const n = results.node[file];
  const g = results.osgo[file];
  if (!n || !g) continue;
  const byTitle = new Map(g.records.map((r) => [r.title, r]));
  for (const r of n.records) {
    const o = byTitle.get(r.title);
    tests.push({file, title: r.title, node: r, osgo: o, osgoRun: g});
  }
}
const http = tests.filter((t) => t.node.requests.length > 0);
const inProcess = tests.filter((t) => t.node.requests.length === 0);
const denom = http.filter((t) => t.node.state === "passed");
const passed = denom.filter((t) => t.osgo?.state === "passed");
const failing = denom.filter((t) => t.osgo?.state !== "passed");
const osgoOnly = http.filter((t) => t.node.state !== "passed" && t.osgo?.state === "passed");

function dumpKey(body) {
  let text = body;
  try { const j = JSON.parse(body); text = j?.error?.message?.value ?? body; } catch {}
  return String(text).replace(/\s+/g, " ").trim();
}
// where a missing route belongs: the ICF service (/sap/bc/<x>), the OData service, else the first two segments
const routeOf = (p) => {
  const path = p.split("?")[0];
  const odata = path.match(/^\/sap\/opu\/odata\/sap\/[^/]+/);
  if (odata) return odata[0];
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "sap" && seg[1] === "bc") return "/" + seg.slice(0, 3).join("/");
  return "/" + seg.slice(0, 2).join("/");
};
const shape = (p) => p.split("?")[0].replace(/\('[^']*'\)|\([^)]*=[^)]*\)|\(\d+\)/g, "(…)");

// Differences where OSGo answers what a system answers and Node does not
// ("go-matches-system": Go = system, Node = anomaly, each backed by an
// ANORMALIES entry). Such a test is no work for OSGo: the headline score
// leaves it out of the denominator, and the report lists it apart as
// closer to the reference, with the anomaly it rests on.
//
// Implicit MANDT: the seed row T0009 ("Other client, must not leak") is client
// 001. The transpiler has no implicit client, so OSG on Node serves it and the
// suites expect it (docs/shift-right-and-quick-wins.md B.6 keeps it visible on
// purpose); OSGo adds the logon client to the WHERE as a system does and
// filters it, so every count over ZSTG_DEMO is one lower. OSGo is the one
// that behaves like SAP here.
const KNOWN = [
  {name: "Go = system, Node = anomaly: implicit MANDT (ANORMALIES ANOMALY-2026-09-11-no-implicit-mandt): T0009 (client 001) filtered by OSGo, served by Node",
    test: (t, text) => /T0009/.test(text) ||
      (/Travel|list report/i.test(`${t.title} ${t.osgo?.requests?.map((q) => q.path).join(" ") ?? ""}`) &&
        /2 != 3|length 3, not 4|does not contain 4|expected 2 to equal 3|length of 4 but got 3|expected '3' to equal '4'|Expected: 4\s+Received: 3|Expected: 3\s+Received: 2/.test(text))},
];

function classify(t) {
  const o = t.osgo;
  if (o !== undefined && o.state !== "passed") {
    const text = `${o.err?.message ?? ""} ${o.err?.expected ?? ""} ${o.err?.actual ?? ""}`;
    const nc = o.requests.some((q) => q.status >= 500);
    const known = nc ? undefined : KNOWN.find((k) => k.test(t, text));
    if (known) return {cat: "go-matches-system", key: known.name, detail: text.replace(/\s+/g, " ").slice(0, 200)};
  }
  if (o === undefined) {
    const hook = t.osgoRun.hookFailures[0];
    if (t.osgoRun.serverDied || !t.osgoRun.up) return {cat: "crash", key: "server did not start or died", detail: t.osgoRun.log};
    return {cat: "hook", key: `hook: ${(hook?.message ?? "not run").split("\n")[0].slice(0, 120)}`, detail: hook?.title};
  }
  const reqs = o.requests;
  const err = o.err ?? {};
  if (t.file === "test/e2e") {
    // the browser's requests are not probed: the spec file is the key, the first line of the error the detail
    const spec = reqs[0]?.path?.split("/").pop() ?? "?";
    return {cat: err.timeout ? "timeout" : "different answer", key: `e2e ${spec}`, detail: String(err.message ?? o.state).split("\n").filter(Boolean).slice(0, 2).join(" / ").slice(0, 300)};
  }
  if (reqs.some((q) => /ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|fetch failed|socket hang up/.test(q.error ?? ""))) {
    return {cat: "crash", key: "connection refused or reset", detail: reqs.find((q) => q.error)?.error};
  }
  const nc = reqs.find((q) => q.status >= 500 && /NOT_COMPILED/.test(q.body ?? ""));
  if (nc) {
    const text = dumpKey(nc.body);
    // "NOT_COMPILED in <method>: <reason>" -- the method and the reason both, the reason names what is missing
    const key = text.slice(text.indexOf("NOT_COMPILED") + "NOT_COMPILED".length).replace(/^[:\s]+/, "").replace(/^in /, "");
    return {cat: "NOT_COMPILED", key: key.slice(0, 160), detail: `${nc.method} ${nc.path}: ${text.slice(0, 300)}`};
  }
  // the first request whose status differs from Node's for the same request
  const nreqs = t.node.requests;
  let diff;
  for (let i = 0; i < reqs.length; i++) {
    const q = reqs[i];
    const nq = nreqs.find((x, j) => j >= i && x.method === q.method && x.path === q.path) ?? nreqs[i];
    if (nq && nq.status !== q.status) { diff = {q, nq}; break; }
  }
  if (err.timeout) return {cat: "timeout", key: diff ? `${diff.q.method} ${shape(diff.q.path)}` : `timeout in ${t.file}`, detail: err.message};
  if (diff && diff.q.status >= 500) {
    return {cat: "dump", key: dumpKey(diff.q.body ?? "").slice(0, 140) || `${diff.q.status} ${shape(diff.q.path)}`, detail: `${diff.q.method} ${diff.q.path} -> ${diff.q.status} (Node ${diff.nq.status}): ${dumpKey(diff.q.body ?? "").slice(0, 300)}`};
  }
  // express's "Cannot GET /x" is no route at all, whatever Node answered there (a 400 or a 403 of a route it has)
  const noRoute = diff && diff.q.status === 404 && /<pre>Cannot /.test(diff.q.body ?? "") && diff.nq.status !== 404;
  if (diff && (noRoute || ((diff.q.status === 404 || diff.q.status === 501 || diff.q.status === 503) && diff.nq.status < 400))) {
    const refused = /not served by OSGo|is not in this program|not compiled/i.test(diff.q.body ?? "");
    return {cat: refused ? "missing service" : "missing route", key: `${routeOf(diff.q.path)}`, detail: `${diff.q.method} ${diff.q.path.slice(0, 120)} -> ${diff.q.status} (Node ${diff.nq.status}): ${(diff.q.body ?? "").replace(/\s+/g, " ").slice(0, 160)}`};
  }
  if (diff) {
    return {cat: "different answer", key: `${diff.q.method} ${shape(diff.q.path)}: ${diff.nq.status} -> ${diff.q.status}`, detail: `${(diff.q.body ?? "").replace(/\s+/g, " ").slice(0, 200)} | ${String(err.message ?? "").split("\n")[0].slice(0, 200)}`};
  }
  const msg = String(err.message ?? o.state).split("\n")[0].slice(0, 160);
  const last = reqs[reqs.length - 1];
  return {cat: "different answer", key: `${t.file}: ${last ? `${last.method} ${shape(last.path)}` : "no request"}`,
    detail: `${msg}${err.expected !== undefined ? ` | expected ${err.expected.slice(0, 120)} | actual ${String(err.actual).slice(0, 120)}` : ""}`};
}

const groups = new Map();
for (const t of failing) {
  const c = classify(t);
  t.cat = c;
  const k = `${c.cat}\u0000${c.key}`;
  if (!groups.has(k)) groups.set(k, {category: c.cat, key: c.key, tests: []});
  groups.get(k).tests.push({file: t.file, title: t.title, detail: c.detail});
}
const ranked = [...groups.values()].sort((a, b) => b.tests.length - a.tests.length || a.key.localeCompare(b.key));
const byCat = {};
for (const g of ranked) byCat[g.category] = (byCat[g.category] ?? 0) + g.tests.length;

const perSuite = httpSuites.map((file) => {
  const all = tests.filter((t) => t.file === file);
  const h = all.filter((t) => t.node.requests.length > 0);
  const d = h.filter((t) => t.node.state === "passed");
  return {file, tests: all.length, http: h.length, nodePassed: d.length,
    osgoPassed: d.filter((t) => t.osgo?.state === "passed").length,
    nodeBootMs: results.node[file]?.boot, osgoBootMs: results.osgo[file]?.boot,
    osgoHookFailures: results.osgo[file]?.hookFailures?.length ?? 0, osgoServerDied: results.osgo[file]?.serverDied ?? false};
});

const summary = {
  when: new Date().toISOString(), root, osgo: osgoBin,
  score: denom.length ? passed.length / denom.length : null,
  totals: {suitesHttp: httpSuites.length, testsInHttpSuites: tests.length, httpTests: http.length, inProcessTestsInHttpSuites: inProcess.length,
    nodePassed: denom.length, nodeFailed: http.length - denom.length, osgoPassed: passed.length, osgoFailed: failing.length, osgoOnlyPassed: osgoOnly.length,
    notApplicableSuites: naCount?.suites ?? naSuites.length, notApplicableTests: naCount?.tests},
  byCategory: byCat, perSuite,
  groups: ranked,
  osgoOnly: osgoOnly.map((t) => ({file: t.file, title: t.title})),
  nodeFailures: http.filter((t) => t.node.state !== "passed").map((t) => ({file: t.file, title: t.title, message: String(t.node.err?.message ?? "").split("\n")[0].slice(0, 200)})),
  inProcess: inProcess.map((t) => ({file: t.file, title: t.title})),
};
writeFileSync(join(out, "parity.json"), JSON.stringify(summary, null, 1));

// the headline leaves the go-matches-system tests out of the denominator:
// OSGo answers them as a system does (scoreRaw keeps them in)
const known = failing.filter((t) => t.cat.cat === "go-matches-system").length;
summary.scoreRaw = summary.score;
summary.score = denom.length - known ? passed.length / (denom.length - known) : null;
summary.totals.goMatchesSystem = known;
summary.closerToReference = failing.filter((t) => t.cat.cat === "go-matches-system").map((t) => ({file: t.file, title: t.title, why: t.cat.key}));
writeFileSync(join(out, "parity.json"), JSON.stringify(summary, null, 1));
const pct = (x) => x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
const md = [];
md.push(`# OSG parity: Node vs OSGo`, "", `${summary.when}, checkout \`${root}\`.`, "");
md.push(`**Score: ${pct(summary.score)}** -- ${passed.length} of ${denom.length - known} HTTP-level tests that pass on Node also pass on OSGo, not counting the ${known} where OSGo is closer to the reference (below).`, "");
md.push(`Counting those as failures: ${pct(summary.scoreRaw)} (${passed.length} of ${denom.length}).`, "");
if (known) {
  md.push(`**Closer to the reference** (go-matches-system: OSGo answers as a system does, Node's answer is an ANORMALIES entry) -- ${known} test(s):`, "");
  const why = new Map();
  for (const t of summary.closerToReference) why.set(t.why, (why.get(t.why) ?? 0) + 1);
  for (const [w, n] of why) md.push(`- ${n}: ${w}`);
  md.push("");
}
md.push(`| | count |`, `|---|---:|`);
for (const [k, v] of Object.entries(summary.totals)) md.push(`| ${k} | ${v ?? "?"} |`);
md.push("", "## Failures by category", "", "| category | tests |", "|---|---:|");
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
md.push("", "## Per suite", "", "| suite | tests | http | Node pass | OSGo pass | OSGo boot ms | notes |", "|---|---:|---:|---:|---:|---:|---|");
for (const s of perSuite) md.push(`| ${s.file} | ${s.tests} | ${s.http} | ${s.nodePassed} | ${s.osgoPassed} | ${s.osgoBootMs ?? ""} | ${[s.osgoHookFailures ? `${s.osgoHookFailures} hook failure(s)` : "", s.osgoServerDied ? "server died" : ""].filter(Boolean).join(", ")} |`);
md.push("", "## Failure groups, ranked by tests unblocked", "");
ranked.forEach((g, i) => {
  md.push(`### ${i + 1}. [${g.category}] ${g.key.replace(/\|/g, "\\|")} -- ${g.tests.length} test(s)`, "");
  for (const t of g.tests.slice(0, 8)) md.push(`- ${t.file}: ${t.title}${t.detail ? `  \n  \`${String(t.detail).split("\n")[0].replace(/`/g, "'").slice(0, 260)}\`` : ""}`);
  if (g.tests.length > 8) md.push(`- ... and ${g.tests.length - 8} more`);
  md.push("");
});
// what OSGo itself logged as a dump, over every run: the e2e specs' only view of the server side
{
  const dumps = new Map();
  for (const file of httpSuites) {
    let text = "";
    try { text = readFileSync(join(out, "runs", `osgo-${file === "test/e2e" ? "e2e" : slug(file)}.server.log`), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const m = line.match(/runtime error: \S+ (\S+): (.*?)  at /);
      if (!m) continue;
      const k = m[2].slice(0, 160);
      const e = dumps.get(k) ?? {n: 0, suites: new Set(), example: m[1]};
      e.n++; e.suites.add(file); dumps.set(k, e);
    }
  }
  summary.serverDumps = [...dumps].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => ({dump: k, count: e.n, suites: [...e.suites], example: e.example}));
  writeFileSync(join(out, "parity.json"), JSON.stringify(summary, null, 1));
  if (dumps.size) {
    md.push("## Dumps OSGo logged (all runs, e2e included)", "", "| count | dump | suites | e.g. |", "|---:|---|---|---|");
    for (const d of summary.serverDumps.slice(0, 40)) md.push(`| ${d.count} | ${d.dump.replace(/\|/g, "\\|")} | ${d.suites.join(", ")} | \`${d.example.slice(0, 80)}\` |`);
    md.push("");
  }
}
if (osgoOnly.length) md.push("## Pass on OSGo, fail on Node", "", ...osgoOnly.map((t) => `- ${t.file}: ${t.title}`), "");
writeFileSync(join(out, "parity.md"), md.join("\n"));
console.log(`\nscore ${pct(summary.score)} (${passed.length}/${denom.length - known}, ${known} closer to the reference left out); ${pct(summary.scoreRaw)} counting them (${passed.length}/${denom.length})`);
console.log(`${failing.length} failing in ${ranked.length} groups; not applicable: ${summary.totals.notApplicableSuites} suites, ${summary.totals.notApplicableTests ?? "?"} tests`);
console.log(`-> ${join(out, "parity.md")}`);
