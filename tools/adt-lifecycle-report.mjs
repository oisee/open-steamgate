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
  for (const row of report.results ?? []) {
    if (row.status !== "PASS" || row.sample === undefined) continue;
    const key = `${row.client}/${row.type}/${row.operation}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.ms);
  }
  return Object.fromEntries([...groups].map(([key, samples]) => [key, {median: median(samples), samples}]));
}
function functionalErrors(report) {
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
  return errors;
}

export const TIMING_RULE = {baselines: 5, margin: 1.3, several: 2, large: 2};
// The fixed CLAS/INTF pair supplies four cheap, unchanged control medians.
// Exclude the larger program/include/CDS source reads and all compilation work.
export const REFERENCE_KEYS = ["CLAS", "INTF"].flatMap(type =>
  ["edit", "readback-active"].map(operation => `ABAP-FS/${type}/${operation}`));
export function timingReference(report) {
  const measured = metrics(report);
  const values = REFERENCE_KEYS.map(key => measured[key]?.median);
  return values.every(value => Number.isFinite(value) && value > 0) ? median(values) : undefined;
}
export function baselineIssue(report, baseline) {
  if (!baseline || !Array.isArray(baseline.results) || functionalErrors(baseline).length) return "Baseline lifecycle evidence is invalid";
  for (const key of ["recipe", "sdk", "vsp", "runtime", "node", "platform", "arch"]) {
    if (!report.identity?.[key] || report.identity[key] !== baseline.identity?.[key]) return `Incompatible baseline identity: ${key}`;
  }
  if (!timingReference(baseline)) return "Baseline timing reference is unavailable or zero";
}
export function checkReport(report, history) {
  // Only current functional evidence contributes to the required job result.
  const errors = functionalErrors(report), comparisons = [], warnings = [];
  const notes = Array.isArray(history?.notes) ? [...history.notes] : [];
  const candidates = Array.isArray(history) ? history : Array.isArray(history?.reports) ? history.reports :
    history && !Object.hasOwn(history, "reports") ? [history] : [];
  if (history && Object.hasOwn(history, "reports") && !Array.isArray(history.reports)) notes.push("Invalid timing history: reports must be an array");
  const baselines = [];
  for (const baseline of candidates) {
    const issue = baselineIssue(report, baseline);
    if (issue) { notes.push(issue); continue; }
    baselines.push({report: baseline, reference: timingReference(baseline), metrics: metrics(baseline)});
    if (baselines.length === TIMING_RULE.baselines) break;
  }
  const reference = timingReference(report);
  if (!reference) notes.push("Current timing reference is unavailable or zero");
  if (reference && baselines.length) {
    for (const [key, metric] of Object.entries(metrics(report))) {
      const available = baselines.filter(base => base.metrics[key]?.median > 0);
      if (!available.length) { notes.push(`Missing baseline metric: ${key}`); continue; }
      // Normalize each historical run before taking its median: raw ms from
      // differently paced runners must never be pooled as the denominator.
      const normalized = metric.median / reference;
      const baselineNormalized = median(available.map(base => base.metrics[key].median / base.reference));
      const ratio = normalized / baselineNormalized;
      comparisons.push({key, current: metric.median, normalized,
        baseline: median(available.map(base => base.metrics[key].median)), baselineNormalized,
        baselineCount: available.length, ratio, elevated: ratio > TIMING_RULE.margin,
        large: ratio >= TIMING_RULE.large});
    }
    const elevated = comparisons.filter(value => value.elevated);
    if (elevated.length >= TIMING_RULE.several || comparisons.some(value => value.large)) {
      warnings.push(`Advisory timing slowdown: ${elevated.length} operations above ${TIMING_RULE.margin}x; ` +
        elevated.map(value => `${value.key}: ${value.current} ms, main ${value.baseline} ms, normalized ${value.ratio.toFixed(3)}x`).join("; "));
    }
  }
  const timing = {status: warnings.length ? "WARN" : comparisons.length ? "QUIET" : "PENDING", reference,
    baselines: baselines.map(base => ({commit: base.report.identity?.commit, reference: base.reference})), notes};
  return {errors, comparisons, warnings, timing};
}
export function renderReport(report, history) {
  const verdict = checkReport(report, history);
  const counts = {};
  for (const row of report.results ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const safe = value => String(value ?? "").replaceAll("|", "/").replaceAll("\n", " ").replaceAll("<", "&lt;");
  const timingRows = Object.entries(metrics(report)).map(([key, value]) => {
    const compared = verdict.comparisons.find(row => row.key === key);
    const result = compared ? compared.large ? "large" : compared.elevated ? "above margin" : "quiet" : "pending";
    return `| ${key} | ${Math.round(value.median)} | ${value.samples.join(", ")} | ${compared ? Math.round(compared.baseline) : "—"} | ${compared ? compared.normalized.toFixed(3) : "—"} | ${compared ? compared.baselineNormalized.toFixed(3) : "—"} | ${compared ? compared.ratio.toFixed(3) + "x" : "—"} | ${compared?.baselineCount ?? 0} | ${result} |`;
  });
  return [
    `### ADT lifecycle: ${verdict.errors.length ? "FAIL" : "PASS"}`, "",
    `Commit: ${safe(report.identity?.commit)} · SDK ${safe(report.identity?.sdk)} · VSP ${safe(report.identity?.vsp)}`, "",
    Object.entries(counts).map(([status,n])=>`${n} ${status}`).join(", "), "",
    "Functional operations, active readback, cleanup and warm-swap checks determine the required gate.", "",
    ...verdict.errors.map(error => `- ${safe(error)}`), "",
    `#### Timing advisory: ${verdict.timing.status === "WARN" ? "⚠️ WARN" : verdict.timing.status}`, "",
    "Client wall time in ms. VSP update includes Check and Activate. Cold REPORT/DDLS are measured too. Parallel CI job; operations within each server are sequential.", "",
    `Reference: median of ${REFERENCE_KEYS.join(", ")}; current ${verdict.timing.reference ?? "unavailable"} ms.`, "",
    `History: ${verdict.timing.baselines.length}/${TIMING_RULE.baselines} compatible green main runs (newest first; fewer when unavailable). Each run is normalized by its own reference before taking the main median.`, "",
    ...verdict.timing.baselines.map(base => `- Main ${safe(base.commit || "unknown commit")}: reference ${base.reference} ms`), "",
    `Warn when at least ${TIMING_RULE.several} operations exceed ${TIMING_RULE.margin}x, or any operation reaches ${TIMING_RULE.large}x. Timing never fails the CI gate.`, "",
    ...(verdict.timing.status === "PENDING" ? ["No usable compatible main comparison; comparison pending.", ""] : []),
    ...verdict.warnings.map(warning => `- ${safe(warning)}`), ...verdict.timing.notes.map(note => `- ${safe(note)}`), "",
    "| Client/type/operation | Median ms | Samples ms | main ms (raw median) | Current/reference | main normalized median | Ratio | Main runs | Timing |",
    "|---|---:|---|---:|---:|---:|---:|---:|---|", ...timingRows, "",
    "| Client | Type | Operation | Result | ms | Note |", "|---|---|---|---|---:|---|",
    ...(report.results ?? []).map(row => `| ${row.client} | ${row.type} | ${row.operation}${row.sample === undefined ? "" : ` #${row.sample + 1}`} | ${row.status} | ${row.ms ?? ""} | ${safe(row.note)} |`), "",
  ].join("\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  let history;
  if (process.argv[3]) {
    try { history = JSON.parse(readFileSync(process.argv[3], "utf8")); }
    catch (error) { history = {reports: [], notes: [`Unreadable timing history: ${error.message}`]}; }
  }
  const text = renderReport(report, history);
  if (process.argv[4]) writeFileSync(process.argv[4], text);
  console.log(text);
  const verdict = checkReport(report, history);
  for (const warning of verdict.warnings) {
    const escaped = warning.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.log(`::warning title=ADT lifecycle timing::${escaped}`);
  }
  process.exitCode = verdict.errors.length ? 1 : 0;
}
