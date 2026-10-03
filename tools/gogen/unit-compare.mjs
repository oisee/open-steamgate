// Compare per-method outcomes from the instrumented Node Unit lifecycle
// with gogen's. Run `npm run transpile` first, or pass --node-json <file>.
import {spawnSync} from "../osd-child-process.mjs";
import {closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {home} from "./home.mjs";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
// One knob for both runs; a full inventory on a slow machine can take longer
// than a quarter of an hour, so the default is generous and a timeout is loud.
const timeoutMs = Number(process.env.GOGEN_COMPARE_TIMEOUT_MS ?? 3600000);
const classes = args.flatMap((x, i) => x === "--class" ? [args[i + 1].toUpperCase()] : []);
const nodeJson = args.includes("--node-json") ? value("--node-json") : join(home, "output", "output.json");
if (!args.includes("--node-json")) {
  const script = join(home, "output", "index.mjs");
  if (!existsSync(script)) throw new Error("output/index.mjs is absent; run npm run transpile first");
  const run = spawnSync("node", ["--expose-gc", join(home, "tools", "gogen", "node-unit-results.mjs"), "--out", nodeJson,
    ...classes.flatMap((c) => ["--class", c])], {
    cwd: home, encoding: "utf8", timeout: timeoutMs, maxBuffer: 20e6,
  });
  if (run.signal) throw new Error(`Node Unit run stopped by ${run.signal}: ${run.error?.code === "ETIMEDOUT" ? `timeout after ${timeoutMs} ms (GOGEN_COMPARE_TIMEOUT_MS)` : run.error?.message ?? "killed"}`);
  if (run.status !== 0) throw new Error(`Node Unit run failed: ${run.stderr || run.stdout || run.error?.message}`);
}
const rawNode = JSON.parse(readFileSync(nodeJson, "utf8"));
let result;
if (args.includes("--go-json")) result = JSON.parse(readFileSync(value("--go-json"), "utf8"));
else {
  // The Go results go to a file, not a pipe: a full inventory prints more than
  // a pipe buffer holds, and a run cut short by the timeout must say so
  // instead of failing later on half a JSON document.
  const goDir = mkdtempSync(join(tmpdir(), "gogen-compare-"));
  const goJson = join(goDir, "go.json");
  const out = openSync(goJson, "w");
  const go = spawnSync("node", [join(home, "tools", "gogen", "unit.mjs"), ...classes.flatMap((c) => ["--class", c])], {
    cwd: home, stdio: ["ignore", out, "pipe"], encoding: "utf8", timeout: timeoutMs, maxBuffer: 20e6,
  });
  closeSync(out);
  if (go.signal) throw new Error(`Go Unit runner stopped by ${go.signal}: ${go.error?.code === "ETIMEDOUT" ? `timeout after ${timeoutMs} ms (GOGEN_COMPARE_TIMEOUT_MS)` : go.error?.message ?? "killed"}; partial output kept in ${goJson}`);
  const text = readFileSync(goJson, "utf8");
  if (!text.trim()) throw new Error(`Go Unit runner produced no results: ${go.stderr || go.error?.message}`);
  result = JSON.parse(text);
  rmSync(goDir, {recursive: true, force: true});
}
const key = (r) => `${r.class}/${r.testclass}/${r.method}`;
const norm = (r) => ({class: String(r.class ?? r.class_name).toUpperCase(),
  testclass: String(r.testclass ?? r.testclass_name).toUpperCase(), method: String(r.method ?? r.method_name).toUpperCase(),
  status: String(r.status).toUpperCase(), message: String(r.message ?? "").trim()});
const nodeRows = rawNode.map(norm);
// Older runner JSON labelled a reached tolerant stub FAILED. Never let an
// oracle with the same error text turn that into a SAME result.
const goRows = result.rows.map((r) => {
  const row = norm(r);
  if (row.message.includes("NOT_COMPILED in ")) row.status = "NOT_COMPILED";
  return row;
});
const owners = new Set(classes.length ? classes : [...nodeRows, ...goRows].map((r) => r.class));
const node = new Map(nodeRows.filter((r) => owners.has(r.class)).map((r) => [key(r), r]));
const gorows = new Map(goRows.filter((r) => owners.has(r.class)).map((r) => [key(r), r]));
// Reviewed against the assertion in each ABAP Unit method and the mixed-client
// seed. Keep exact messages so a new failure cannot inherit an exception.
const searchHelpRefusal = 'CX_SY_DYNAMIC_OSQL_SEMANTICS in SELECT * FROM (mv_selmethod) INTO CORRESPONDING FIELDS OF TABLE <lt_rows> WHERE (lv_where) ORDER BY PRIMARY KEY.: a literal on the left of a condition ("1" at 0) is not a column';
const knownNodeAnomalies = new Map([
  ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/STATUS_VALUE_HELP", ["ANOMALY-2026-09-24-dynamic-where-pasted", "upstream search-help library emits 1 = 1 for an empty WHERE; A4H raises semantics", searchHelpRefusal]],
  ["ZCL_STG_SHLP_TEST/LTCL_SHLP/ALL_STATUSES_SORTED", ["ANOMALY-2026-09-24-dynamic-where-pasted", "upstream search-help library emits 1 = 1 for an empty WHERE; A4H raises semantics", searchHelpRefusal]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/ENTITY_SET", ["ANOMALY-2026-09-11-no-implicit-mandt", "the assertion expects client 001 travel T0009 in the four-row entity set", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:383"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/PAGING_AND_INLINECOUNT", ["ANOMALY-2026-09-11-no-implicit-mandt", "the four-row ordering assertion includes T0009 and changes the page", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:399"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/COUNT", ["ANOMALY-2026-09-11-no-implicit-mandt", "Node counts four seeded travels; the logon client has three", "Expected '4', got '3'"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_FILTER/THROUGH_DISPATCHER", ["ANOMALY-2026-09-11-no-implicit-mandt", "the filtered result expects other-client T0009", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:735"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_SADL/ENTITY_SET_WITH_FILTER", ["ANOMALY-2026-09-11-no-implicit-mandt", "the filtered result expects T0009 and a four-row count", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:1758"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_SADL/ANALYTICS_GROUP_BY", ["ANOMALY-2026-09-11-no-implicit-mandt", "the grouped seats include the other-client travel", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:1806"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_ODC/QUERY_OPTIONS_TRAVEL_ALONG", ["ANOMALY-2026-09-11-no-implicit-mandt", "the page explicitly expects other-client T0009", "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:1961"]],
  ["ZCL_STG_PHASE0_TEST/LTCL_PHASE0/ENTITYSET_READS_SQLITE", ["ANOMALY-2026-09-11-no-implicit-mandt", "the assertion documents four rows versus three in client 123", "Expected '4', got '3'"]],
  ["ZCL_STG_PHASE0_TEST/LTCL_PHASE0/ENTITYSET_SELECT_OPTIONS", ["ANOMALY-2026-09-11-no-implicit-mandt", "the filter includes T0009, giving two rows instead of one", "Expected '2', got '1'"]],
  ["ZCL_STG_GATEWAY_TEST/LTCL_FUNCTION_IMPORT/PRIMITIVE_RETURNING_ACTION", ["ANOMALY-2026-09-11-no-implicit-mandt", "the action counts three active travels including T0009; client 123 has two", "Expected '{\"d\":{\"TravelCount\":3}}', got '{\"d\":{\"TravelCount\":2}}'"]],
  ["ZCL_OSD_BATCH_RUNNER_TEST/LTCL_BATCH_REPORT/STATIC_SUBMIT_RANGE_BT_AND_E", ["ANOMALY-2026-09-29-runtime-in-options", "Node compareIn throws on BT with E EQ; Go executes the measured range", ""]],
]);
// A4H runs each local test class in a fresh internal session. The Node
// runner still carries CLASS-DATA into LTC_B; match the assertion result,
// rather than treating every failure in this method as the same anomaly.
const unitStaticsNodeAnomalies = new Map([
  ["ZCL_OSD_STATICS_TEST/LTC_B/M1_FIRST", "Expected '1', got '3'"],
]);
const methods = {same: [], different: [], nodeAnomaly: [], nodeOnly: [], goOnly: [], skipped: []};
for (const [k, n] of node) {
  const g = gorows.get(k);
  if (n.status === "SKIPPED" && g?.status === "SKIPPED") methods.skipped.push({key: k, node: n, go: g});
  else if (n.status === "SKIPPED" || g?.status === "SKIPPED") methods.different.push({key: k, node: n, go: g});
  else if (!g || g.status === "NOT_COMPILED" || g.status === "NEEDS_DB") methods.nodeOnly.push({key: k, node: n, go: g});
  else if (g.status === n.status && g.message === n.message) methods.same.push(k);
  else {
    const known = knownNodeAnomalies.get(k);
    const statics = unitStaticsNodeAnomalies.get(k);
    if (statics && n.status === "FAILED" && n.message === statics && g.status === "SUCCESS" && g.message === "") {
      methods.nodeAnomaly.push({key: k, entry: "ANOMALY-2026-09-30-unit-statics-across-test-classes", why: "Node carries class statics into the next ABAP Unit test class", node: n, go: g});
    } else if (known && g?.message === known[2] &&
        (known[0].includes("runtime-in-options") ? n.message === "compareIn todo" && g.status === "SUCCESS" : n.status === "SUCCESS" && g.status === "FAILED")) {
      methods.nodeAnomaly.push({key: k, entry: known[0], why: known[1], node: n, go: g});
    } else methods.different.push({key: k, node: n, go: g});
  }
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
