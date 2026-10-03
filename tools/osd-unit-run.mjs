// `npm run unit`, with a way to say "I ran nothing".
//
// **The honest provenance, because the one this was written for was wrong.**
// osg-osd-i7 reported eight tests that printed `OK` and never ran. They had
// run all along: the first reading was `npm run unit 2>&1 | tail -15` over a
// seventeen-line file, and the lines were in the middle. A log truncated by
// the command that produced it is indistinguishable from a log of something
// that never happened -- `tail -15` and "it did not run" look the same on a
// screen. So there was no green-without-a-run that day.
//
// This exists anyway, for two reasons that do not depend on that:
//
//   1. its first run found a REAL one -- `ZCL_EDITOR`, a test class that
//      genuinely never executes -- and named why (its folder is outside the
//      build). That is the check's finding, not anybody's report.
//   2. `OK` meant "nothing failed" and never "something passed", and the two
//      were printed with one word. "Nothing ran" is the third value of a
//      test run's verdict, the way "not measured" is the third value
//      everywhere else in this tree, and a verdict that cannot print its
//      third value will one day print the nearest of the other two.
//
// So the classes are counted from the **parse** -- every
// `*.clas.testclasses.abap` under an input folder -- and compared with the
// names the runtime reported. A class in the tree that never appears is
// named and the run fails. Nothing here checks whether a test PASSED: the
// runtime already does that, loudly.
import {spawn} from "./osd-child-process.mjs";
import {readdirSync, readFileSync, existsSync, statSync, mkdtempSync, openSync, closeSync, rmSync} from "node:fs";
import {basename, join} from "node:path";
import {tmpdir} from "node:os";
import {inputFoldersOf, winningByLayer} from "./osd-packs.mjs";

/** every test class the tree holds, from the files rather than from an index */
export function testClassesIn(root = process.cwd(), env = process.env) {
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const folders = inputFoldersOf(root, config, env).map((f) => join(root, f)).filter(existsSync);
  // **The build's own exclusions, not a second list.** The first run of this
  // check named `ZCL_EDITOR` -- a fixture under `test/fixtures/`, with its
  // own `abaplint.jsonc` and an empty test class, which exists so the ADT
  // editor tests have something to read. It never runs because
  // `exclude_filter` says `/test/fixtures/`, and a check that did not know
  // that would have cried wolf on its first run, which is how a check stops
  // being read. One source of truth for what the build skips.
  const excluded = (config.exclude_filter ?? []).map((p) => new RegExp(p));
  const skip = (path) => excluded.some((re) => re.test("/" + path.slice(root.length + 1)));
  const includes = new Map();
  const walk = (dir) => {
    const sources = [];
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, e.name);
      if (skip(path)) continue;
      if (e.isDirectory()) sources.push(...walk(path));
      else if (e.name.endsWith(".clas.abap")) sources.push(path);
      else if (e.name.endsWith(".clas.testclasses.abap")) {
        includes.set(path.replace(/\.testclasses\.abap$/, ".abap"), path);
      }
    }
    return sources;
  };
  const winners = winningByLayer(folders, (folder) => {
    return statSync(folder).isDirectory() ? walk(folder) : [];
  }, (path) => basename(path, ".clas.abap").toUpperCase());
  const found = new Set();
  for (const source of winners) {
    if (includes.has(source)) found.add(basename(source, ".clas.abap").toUpperCase());
  }
  const owned = new Set(winners.map((source) => basename(source, ".clas.abap").toUpperCase()));
  for (const include of includes.values()) {
    const name = basename(include, ".clas.testclasses.abap").toUpperCase();
    if (!owned.has(name)) found.add(name + "  (no .clas.abap beside it)");
  }
  return [...found].sort();
}

/** the classes the runtime said it was running */
export function reported(output) {
  return [...new Set([...String(output).matchAll(/^([A-Z][A-Z0-9_]*):\s+running\b/gm)].map((m) => m[1]))].sort();
}

export function missing(inTree, ran) {
  const seen = new Set(ran);
  return inTree.filter((name) => !seen.has(name.replace(/\s+\(.*$/, "")));
}

/**
 * Runs `node <args>` with stdout captured through a regular file (see below)
 * and resolves {code, signal, captured}. A child ended by a signal has
 * code === null, which is why both are returned.
 */
export async function runCaptured(args, {echo = true} = {}) {
  // The transpiled runner calls process.exit(0) immediately after logging.
  // Node can discard pending writes to a pipe, producing a false 0-ran report.
  // A regular file descriptor makes those writes synchronous on all hosts.
  const captureDir = mkdtempSync(join(tmpdir(), "osd-unit-"));
  const capturePath = join(captureDir, "stdout.log");
  const fd = openSync(capturePath, "w");
  try {
    const child = spawn("node", args, {stdio: ["inherit", fd, "inherit"]});
    const {code, signal} = await new Promise((resolve) => child.on("close", (c, s) => resolve({code: c, signal: s})));
    closeSync(fd);
    const captured = readFileSync(capturePath, "utf8");
    if (echo) process.stdout.write(captured);
    return {code, signal, captured};
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(captureDir, {recursive: true, force: true});
  }
}

/**
 * The exit code a finished child stands for. `process.exit(null)` exits 0,
 * so a child killed by a signal (code null) would have read as a pass even
 * after it had reported every class; anything but a clean 0 is a failure.
 */
export function exitCodeOf({code, signal}) {
  if (signal) return 1;
  if (code === 0) return 0;
  return Number.isInteger(code) && code > 0 ? code : 1;
}

if (basename(process.argv[1] ?? "") === "osd-unit-run.mjs") {
  const inTree = testClassesIn();
  // tools/osd-unit-all.mjs runs the generated harness's list but goes on
  // past a failure, so one red class no longer hides every class after it
  const result = await runCaptured(["--expose-gc", "--import", "./tools/osd-unit-bootstrap.mjs", "tools/osd-unit-all.mjs", ...process.argv.slice(2)]);
  const exitCode = exitCodeOf(result);
  if (result.signal) console.log(`\nunit: FAILED -- the run was ended by ${result.signal}`);
  // a failing run still gets its inventory: what never ran is a second
  // finding, not one the first should hide
  const ran = reported(result.captured);
  const never = missing(inTree, ran);
  // "12 of 11" reads like an error in the counter. They are two different
  // populations: what ran includes classes the libraries bring, and what the
  // tree holds is what this repository must not lose.
  console.log(`\nunit: ${ran.length} test classes ran; ${inTree.length} are in this tree, ` +
    `${never.length === 0 ? "all of them among them" : `${never.length} of them NOT`}`);
  if (never.length > 0) {
    console.log("unit: FAILED -- these are in the tree and never ran:");
    for (const name of never) console.log(`  ${name}`);
    console.log("\nA run that executes nothing must not print OK. 'Passed' and 'did not run' are");
    console.log("different claims, and only one of them used to be printable.");
    process.exit(1);
  }
  if (exitCode !== 0) process.exit(exitCode);
  console.log("OK");
}
