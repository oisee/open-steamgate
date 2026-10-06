// Decide when CI needs the ADT lifecycle measurements. The job drives
// creation, edits and activation through both ADT clients on top of the
// shared build artifact; a change that cannot reach that path keeps the job
// skipped, and one that might runs it.
import {execFileSync} from "node:child_process";

// The rule fails closed: needsLifecycle runs the measurements unless every
// changed path is provably unrelated to the lifecycle job, meaning it
// matches one exemption below. Anything else runs -- all of src/, tools/,
// test/ outside e2e, scripts/, bin/, the in-tree packs/, data/, root
// configuration and lock files, .github/ci/, tools/abapfs-conformance/ --
// because the job executes the built server and both clients end to end,
// a needlessly measured PR costs minutes, and a silently skipped
// measurement costs the regression the job exists to catch.
const unrelatedPaths = [
  // Documentation, and markdown anywhere outside src/ (which covers the
  // root AGENDA/README/ANORMALIES notes and editor CHANGELOGs).
  /^docs\//,
  /^(?!src\/).*\.md$/,
  // The browser webapp: served pages, never part of the ABAP server the
  // lifecycle job drives.
  /^webapp\//,
  // The VS Code editor, except the launcher entry point installs execute
  // and the resources they ship.
  /^editors\/(?!vscode\/launcher\.js$|vscode\/resources\/)/,
  // Browser e2e specs, which run in their own job.
  /^test\/e2e\//,
  // Other workflows cannot redefine this job; this one (tests.yml) can.
  /^\.github\/workflows\/(?!tests\.yml$)[^/]+$/,
  // Issue templates are conversation, not code.
  /^\.github\/ISSUE_TEMPLATE\//,
  /^LICENSE$/,
];

export function needsLifecycle(paths) {
  return !paths.every((path) => unrelatedPaths.some((pattern) => pattern.test(path)));
}

function git(...args) { return execFileSync("git", args, {encoding: "utf8"}); }

if (process.argv[1]?.endsWith("osd-ci-lifecycle-gate.mjs")) {
  const [base, head] = process.argv.slice(2);
  if (!/^[0-9a-f]{40}$/.test(base ?? "") || !/^[0-9a-f]{40}$/.test(head ?? "")) {
    console.error("Usage: osd-ci-lifecycle-gate.mjs <base-sha> <head-sha>");
    process.exit(2);
  }
  // --no-renames so both endpoints of a rename count: a file moved out of
  // the ABAP sources into an exempt-looking directory still shows its
  // deletion. -z splits on NUL so no path can be quoted or split.
  const paths = git("diff", "--no-renames", "--name-only", "-z", base, head).split("\0").filter(Boolean);
  const run = needsLifecycle(paths);
  process.stdout.write(`OSD_CI_ADT_LIFECYCLE=${run ? "1" : "0"}\n`);
  console.error(`ADT lifecycle: ${run ? "run" : "skip"}; ${paths.length} changed path(s)`);
}
