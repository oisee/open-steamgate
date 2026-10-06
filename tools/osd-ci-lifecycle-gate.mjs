// Decide when CI needs the ADT lifecycle measurements. The job drives
// creation, edits and activation through both ADT clients on top of the
// shared build artifact; a change that cannot reach that path keeps the job
// skipped, and one that might runs it.
import {execFileSync} from "node:child_process";

// Any match runs the ADT lifecycle job. The rule is fail closed: when a path
// is unsure, it belongs here -- a needlessly measured PR costs minutes, a
// silently skipped measurement costs the regression the job exists to catch.
const adtPaths = [
  /^src\/(?:adt|classrun)\//,
  /^tools\/adt-[^/]*\.mjs$/,
  // The runtime pieces the lifecycle server and its clients execute:
  // store, enqueue, build, warm/hot caches, transpile, dialog steps,
  // serving, ABAP Unit, activation, build inputs, packs, libs and pins.
  /^tools\/osd-(?:store|enq|build|warm|hot|transpile|dialog-step|serve|unit|activation|inputs|packs|libs|link|lock|fetch)[^/]*\.mjs$/,
  /^tools\/osd-ci-lifecycle-gate\.mjs$/,
  /^test\/adt-[^/]*\.mjs$/,
  /^test\/suites\.d\/adt\.json$/,
  /^bin\//,
  /^scripts\/build-binary\.mjs$/,
  /^(?:abap_transpile|libs\.lock|package(?:-lock)?)\.json$/,
  /^\.github\/workflows\/tests\.yml$/,
];

export function needsLifecycle(paths) {
  return paths.some((path) => adtPaths.some((pattern) => pattern.test(path)));
}

function git(...args) { return execFileSync("git", args, {encoding: "utf8"}); }

if (process.argv[1]?.endsWith("osd-ci-lifecycle-gate.mjs")) {
  const [base, head] = process.argv.slice(2);
  if (!/^[0-9a-f]{40}$/.test(base ?? "") || !/^[0-9a-f]{40}$/.test(head ?? "")) {
    console.error("Usage: osd-ci-lifecycle-gate.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  const paths = git("diff", "--name-only", base, head).trim().split("\n").filter(Boolean);
  const run = needsLifecycle(paths);
  process.stdout.write(`OSD_CI_ADT_LIFECYCLE=${run ? "1" : "0"}\n`);
  console.error(`ADT lifecycle: ${run ? "run" : "skip"}; ${paths.length} changed path(s)`);
}
