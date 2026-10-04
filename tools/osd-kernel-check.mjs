// Strict test identities and a projection of the support page onto measured classes.
// Counts come from the pinned inventory, including folders outside a fast run.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {runsAs} from "./osd-main.mjs";
const identity = (row) => [row.class, row.testclass, row.method].join("/");
export const identityDigest = (rows) => createHash("sha256").update(rows.map(identity).sort().join("\n") + "\n").digest("hex");

export function compareFailures(result, known, {tests, exitCode, knownFile = ".github/ci/kernel-known-failures.json"} = {}) {
  const errors = [], seen = new Set(), failed = new Map();
  if (!Array.isArray(result.rows) || !result.rows.length) return ["missing test rows"];
  for (const row of result.rows) {
    const key = identity(row);
    if (!row.class || !row.testclass || !row.method) errors.push(`missing test identity: ${key} (${row.status})`);
    if (seen.has(key)) errors.push(`duplicate test: ${key}`);
    seen.add(key);
    if (row.status !== "SUCCESS") failed.set(key, row.status);
  }
  if (tests !== undefined && result.rows.length !== tests) errors.push(`test count: ${result.rows.length}, expected ${tests}`);
  const expected = new Map();
  for (const entry of known) {
    const key = identity(entry);
    if (entry.status !== "FAILURE" || !entry.reason || !/^https:\/\/github\.com\//.test(entry.upstream) || expected.has(key)) errors.push(`invalid known failure: ${key}`);
    expected.set(key, entry.status);
    if (!seen.has(key)) errors.push(`known failure missing: ${key}; restore the pinned test input`);
    else if (!failed.has(key)) errors.push(`known failure fixed: ${key}; remove this entry from ${knownFile}`);
    else if (failed.get(key) !== entry.status) errors.push(`known failure changed status: ${key}: ${failed.get(key)}`);
  }
  for (const [key, status] of failed) if (!expected.has(key)) errors.push(`new failure: ${key}: ${status}`);
  const totals = result.totals;
  for (const [key, status] of Object.entries({success: "SUCCESS", failure: "FAILURE", error: "ERROR", not_compiled: "NOT_COMPILED"})) {
    if (totals?.[key] !== result.rows.filter((row) => row.status === status).length) errors.push(`invalid totals.${key}`);
  }
  if (totals?.tests !== result.rows.length) errors.push("invalid totals.tests");
  const code = result.rows.some((row) => ["ERROR", "NOT_COMPILED"].includes(row.status)) ? 2 : failed.size ? 1 : 0;
  if (exitCode !== undefined && exitCode !== code) errors.push(`runner exit ${exitCode}, report expects ${code}`);
  return errors;
}

function table(page) {
  const rows = new Map();
  for (const line of page.split("\n")) {
    if (!/^\| (conversion|statement|type|function): /.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim().replaceAll("\\|", "|"));
    if (cells.length !== 6 || rows.has(cells[0])) throw new Error(`invalid support row: ${cells[0]}`);
    rows.set(cells[0], cells);
  }
  if (!rows.size) throw new Error("support page has no construct rows");
  return rows;
}

function claimedFailures(cell, classes) {
  if (/^runs(?:;|$)/.test(cell)) return [];
  const match = /^fails in (\d+) of (\d+) classes \(([^)]+)\); passes in (\d+)(?:;|$)/.exec(cell);
  if (!match || match[3].includes("…")) throw new Error(`unsupported/incomplete support claim: ${cell}`);
  const names = match[3].split(", ");
  if (names.length !== Number(match[1]) || new Set(names).size !== names.length || names.some((n) => !classes.has(n)) ||
      Number(match[2]) !== classes.size || Number(match[4]) !== classes.size - names.length) throw new Error(`inconsistent class counts in support claim: ${cell}`);
  return names.sort();
}

export function compareDrift(report, page, inventory) {
  const errors = [];
  if (!report.folders.length || !report.constructs.length || !report.folders.some((f) => Object.keys(f.evidence).length)) errors.push("no measured support evidence");
  const pagePin = /ABAPiti commit: ([a-f0-9]{40})\./.exec(page)?.[1];
  if (pagePin !== report.abapiti || inventory.abapiti !== report.abapiti) return ["support corpus pin differs; update pin and page together"];
  const rows = table(page), full = new Map(), selected = new Map(), claims = new Map();
  const measured = new Set(report.folders.map((f) => f.name));
  for (const [folder, inv] of Object.entries(inventory.folders)) for (const c of inv.constructs) {
    const add = (map) => {
      const old = map.get(c.key) ?? {count: 0, lines: 0, classes: new Set()};
      old.count += c.count; old.lines += c.lines;
      for (const name of c.classes) old.classes.add(name);
      map.set(c.key, old);
    };
    add(full); if (measured.has(folder)) add(selected);
  }
  for (const [key, c] of full) {
    if (!selected.has(key)) continue;
    const cells = rows.get(key);
    if (!cells) { errors.push(`${key}: missing from support page`); continue; }
    if (Number(cells[1]) !== c.count || Number(cells[2]) !== c.classes.size || Number(cells[3]) !== c.lines) errors.push(`${key}: support inventory counts differ`);
    const byRuntime = {};
    for (const [runtime, column] of [["osgjs", 4], ["osgo", 5]]) {
      if (!report.folders.some((f) => f.evidence[runtime])) continue;
      try { byRuntime[runtime] = claimedFailures(cells[column], c.classes); }
      catch (error) { errors.push(`${key}: ${runtime}: ${error.message}`); }
    }
    claims.set(key, byRuntime);
  }
  const actual = new Map(report.constructs.map((c) => [`${c.kind}: ${c.name}`, c]));
  for (const [key, c] of selected) {
    const got = actual.get(key), cells = rows.get(key);
    if (!got || got.count !== c.count || got.lines !== c.lines || JSON.stringify([...c.classes].sort()) !== JSON.stringify(got.classes)) {
      errors.push(`${key}: measured inventory differs`); continue;
    }
    if (!cells) continue;
    for (const runtime of ["osgjs", "osgo"]) {
      if (!report.folders.some((f) => f.evidence[runtime])) continue;
      if (!claims.get(key)?.[runtime]) continue;
      const expected = claims.get(key)[runtime].filter((name) => c.classes.has(name));
      const evidence = got[runtime];
      if (evidence.missing.length || evidence.refusals.length ||
          JSON.stringify(evidence.failingClasses) !== JSON.stringify(expected) ||
          evidence.passingClasses.length !== c.classes.size - expected.length) errors.push(`${key}: ${runtime} disagrees with support page (expected failing: ${expected.join(", ") || "none"}; actual: ${evidence.failingClasses.join(", ") || evidence.status})`);
    }
  }
  for (const key of actual.keys()) if (!selected.has(key)) errors.push(`${key}: new measured construct`);
  return errors;
}

// Recheck an artifact or inject a synthetic failure without rebuilding the runtime.
export function main(args = process.argv.slice(2)) {
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].replace(/^--/, "");
      if (!args[i + 1] || !["result", "known", "tests", "runtime", "folder", "support", "page", "inventory"].includes(key)) throw new Error(`invalid option: ${args[i]}`);
      options[key] = args[i + 1];
    }
    const json = (path) => JSON.parse(readFileSync(path, "utf8"));
    let errors;
    if (options.result) {
      if (!options.known || !options.runtime || !options.folder || !/^[1-9][0-9]*$/.test(options.tests ?? "")) throw new Error("--result needs --known, --runtime, --folder and --tests");
      const known = json(options.known).entries.filter((e) => e.runtime === options.runtime && e.folder === options.folder);
      errors = compareFailures(json(options.result), known, {tests: Number(options.tests), knownFile: options.known});
    } else {
      if (!options.support || !options.page || !options.inventory) throw new Error("provide --result or --support, --page and --inventory");
      errors = compareDrift(json(options.support), readFileSync(options.page, "utf8"), json(options.inventory));
    }
    if (errors.length) { console.error(errors.join("\n")); return 1; }
    console.log("kernel evidence agrees"); return 0;
  } catch (error) { console.error(error.message); return 1; }
}
if (runsAs("osd-kernel-check.mjs")) process.exitCode = main();
