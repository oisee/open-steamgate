import {readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

export const MISSING_VALIDATIONS = new Set(["PROG", "INCL", "DDLS"]);
const clients = ["ABAP-FS", "VSP"];
const types = ["DEVC", "CLAS", "INTF", "PROG", "INCL", "DDLS"];
export function checkVspSyntax(response) {
  const texts = response.content?.filter(b => b.type === "text").map(b => b.text);
  if (response.isError || !texts?.length) throw Error("Missing VSP syntax diagnostics");
  const diagnostics = JSON.parse(texts.join("\n"));
  if (diagnostics !== null && !Array.isArray(diagnostics)) throw Error("Invalid VSP syntax diagnostics");
  if ((diagnostics ?? []).some(d => /^[EAX]$/i.test(d.severity ?? d.Severity ?? ""))) throw Error(`VSP syntax errors: ${JSON.stringify(diagnostics)}`);
  return diagnostics;
}
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function metrics(report) {
  const groups = new Map();
  for (const row of report.results) {
    if (row.status !== "PASS" || row.sample === undefined) continue;
    const key = `${row.client}/${row.type}/${row.operation}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.ms);
  }
  return Object.fromEntries([...groups].map(([key, samples]) => [key, {median: median(samples), samples}]));
}
export function checkReport(report, baseline) {
  const errors = [];
  if (report.schema !== 1 || report.complete !== true || report.fatal) errors.push(`Incomplete lifecycle report: ${report.fatal ?? "run did not finish"}`);
  if (!Number.isInteger(report.repeats) || report.repeats < 3) errors.push("At least three timing samples required");
  const rows = report.results ?? [];
  for (const row of rows) {
    if (row.status === "FAIL") errors.push(`${row.client}/${row.type}/${row.operation}: ${row.note}`);
    if (row.status === "MISSING" && !(row.client === "ABAP-FS" && row.operation === "validate" && MISSING_VALIDATIONS.has(row.type))) errors.push(`Unexpected missing operation: ${row.client}/${row.type}/${row.operation}`);
    if (row.status === "PASS" && (!Number.isFinite(row.ms) || row.ms < 0)) errors.push("Invalid measurement");
  }
  for (const client of clients) for (const type of types) {
    const operations = type === "DEVC" ? ["create", "delete+confirmed-404"] : client === "ABAP-FS"
      ? ["create", "write-initial", "edit", "check", "activate-edit", "readback-active", "delete+confirmed-404"]
      : ["create+write+activate", "edit+check+activate", "check-explicit", "activate-explicit", "readback-vsp", "delete+confirmed-404"];
    for (const operation of operations) {
      const found = rows.filter(r => r.client === client && r.type === type && r.operation === operation && r.status === "PASS");
      const repeated = ["edit", "check", "activate-edit", "readback-active", "edit+check+activate"].includes(operation);
      if (found.length !== (repeated ? report.repeats : 1) || (repeated && new Set(found.map(r => r.sample)).size !== report.repeats)) errors.push(`Missing successful evidence: ${client}/${type}/${operation}`);
    }
    if (client === "ABAP-FS" && !rows.some(r => r.client === client && r.type === type && r.operation === "validate" && (r.status === "PASS" || (MISSING_VALIDATIONS.has(type) && r.status === "MISSING")))) errors.push(`Missing validation evidence: ${type}`);
  }
  if (!rows.some(r => r.client === "ABAP-FS" && r.type === "ALL5" && r.operation === "activate-initial" && r.status === "PASS")) errors.push("Missing initial activation evidence");
  const comparisons = [];
  if (baseline) {
    const previous = checkReport(baseline);
    if (previous.errors.length) errors.push("Baseline lifecycle evidence is invalid");
    for (const key of ["recipe", "sdk", "vsp", "runtime", "node", "platform", "arch"]) {
      if (!report.identity?.[key] || report.identity[key] !== baseline.identity?.[key]) errors.push(`Incompatible baseline identity: ${key}`);
    }
    const current = metrics(report), base = metrics(baseline);
    for (const [key, metric] of Object.entries(current)) {
      if (!base[key]) { errors.push(`Missing baseline metric: ${key}`); continue; }
      // A 50% increase AND an extra second is a regression. The absolute
      // allowance keeps millisecond network operations from failing on noise.
      const limit = Math.max(base[key].median * 1.5, base[key].median + 1000);
      const regression = metric.median > limit;
      comparisons.push({key, current:metric.median, baseline:base[key].median, limit, regression});
      if (regression) errors.push(`Slowdown ${key}: median ${metric.median} ms, main ${base[key].median} ms, limit ${limit} ms`);
    }
  }
  return {errors, comparisons};
}
export function renderReport(report, baseline) {
  const verdict = checkReport(report, baseline);
  const counts = {};
  for (const row of report.results ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const safe = value => String(value ?? "").replaceAll("|", "/").replaceAll("\n", " ").replaceAll("<", "&lt;");
  const timing = Object.entries(metrics(report)).map(([key, value]) => {
    const compared = verdict.comparisons.find(r => r.key === key);
    return `| ${key} | ${Math.round(value.median)} | ${value.samples.join(", ")} | ${compared ? Math.round(compared.baseline) : "—"} | ${compared?.regression ? "SLOW" : compared ? "PASS" : "measured"} |`;
  });
  return [`### ADT lifecycle: ${verdict.errors.length ? "FAIL" : "PASS"}`, "", `Commit: ${safe(report.identity?.commit)} · SDK ${safe(report.identity?.sdk)} · VSP ${safe(report.identity?.vsp)}`, "", Object.entries(counts).map(([status,n])=>`${n} ${status}`).join(", "), "", "Client wall time in ms. VSP update includes Check and Activate. Cold REPORT/DDLS are measured too. Parallel CI job; operations within each server are sequential.", "", "| Client/type/operation | Median ms | Samples ms | main ms | Result |", "|---|---:|---|---:|---|", ...timing, "", baseline ? "Compared with compatible successful main evidence: fails above both +50% and +1000 ms." : "No compatible main baseline yet; functional and warm-swap checks still apply. Timing is measured, comparison pending.", "", ...verdict.errors.map(e=>`- ${safe(e)}`), "", "| Client | Type | Operation | Result | ms | Note |", "|---|---|---|---|---:|---|", ...(report.results ?? []).map(r=>`| ${r.client} | ${r.type} | ${r.operation}${r.sample === undefined ? "" : ` #${r.sample + 1}`} | ${r.status} | ${r.ms ?? ""} | ${safe(r.note)} |`), ""].join("\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const baseline = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : undefined;
  const text = renderReport(report, baseline);
  if (process.argv[4]) writeFileSync(process.argv[4], text);
  console.log(text);
  process.exitCode = checkReport(report, baseline).errors.length ? 1 : 0;
}
