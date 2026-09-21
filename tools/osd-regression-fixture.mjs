#!/usr/bin/env node
// Executes only tracked/synthetic case-response fixtures. No network, no
// destination resolution and therefore no claim of wire coverage.
import {readFileSync} from "node:fs";
import {basename} from "node:path";
import {syntheticRunResult} from "./osd-regression-case.mjs";

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
export function runFixture(caseFile, responseFile) {
  const testCase = readJson(caseFile);
  const response = readJson(responseFile);
  return syntheticRunResult(testCase, response, {
    runId: `synthetic:${basename(caseFile)}:${basename(responseFile)}`,
  });
}

if (basename(process.argv[1] ?? "") === "osd-regression-fixture.mjs") {
  const [caseFile, responseFile] = process.argv.slice(2);
  if (!caseFile || !responseFile) {
    console.error("usage: osd-regression-fixture.mjs <case.json> <response.json>");
    process.exit(2);
  }
  try {
    const result = runFixture(caseFile, responseFile);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.outcome === "passed" ? 0 : result.outcome === "failed" ? 1 : 2);
  } catch (error) {
    console.error(`osd-regression-fixture: ${error.message}`);
    process.exit(2);
  }
}
