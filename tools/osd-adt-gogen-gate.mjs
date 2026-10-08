#!/usr/bin/env node
import {readFileSync} from "node:fs";

const adtEntry = /^Z(?:CL|IF|CX)_OSD_ADT_/;

export function checkGate(report, allowlist) {
  const allowed = new Map(allowlist.map(entry => [`${entry.kind}: ${entry.entry}`, entry.reason]));
  const observed = new Set();
  const unmatched = [];
  for (const [kind, entries] of [["statement stub", report.statementStubs], ["method not compiled", report.methodsNotCompiled]]) {
    if (!Array.isArray(entries)) throw new Error(`report ${kind}s must be an array`);
    for (const entry of entries) {
      if (typeof entry !== "string" || !adtEntry.test(entry)) continue;
      const key = `${kind}: ${entry}`;
      if (observed.has(key)) unmatched.push(`${key}: duplicate`);
      observed.add(key);
      if (!allowed.has(key)) unmatched.push(key);
    }
  }
  const obsolete = [...allowed.keys()].filter(key => !observed.has(key));
  return {observed: [...observed], unmatched, obsolete};
}

function main() {
  if (process.argv.length !== 4) {
    console.error("usage: node tools/osd-adt-gogen-gate.mjs <compile-report.json> <allowlist.json>");
    return 2;
  }
  const result = checkGate(JSON.parse(readFileSync(process.argv[2], "utf8")), JSON.parse(readFileSync(process.argv[3], "utf8")));
  for (const entry of result.observed) console.log(`ADT compile gap: ${entry}`);
  for (const entry of result.unmatched) console.error(`not allowed: ${entry}`);
  for (const entry of result.obsolete) console.error(`allowlist entry no longer occurs: ${entry}`);
  console.log(`${result.observed.length} ADT statement stubs/methods not compiled; ${result.unmatched.length + result.obsolete.length} gate failures`);
  return result.unmatched.length || result.obsolete.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
