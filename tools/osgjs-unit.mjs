// A checkout CI runner: build and run in a disposable system, never build/live.
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {libraryPath} from "./osd-lib-path.mjs";
import {inputFoldersOf} from "./osd-packs.mjs";
import {unitInputs} from "./gogen/unit-inputs.mjs";
import {stageInput, summarize, printResult, run, kernelWarnings, applyKernelWarnings} from "./osd-unit-ci.mjs";

const root = resolve(import.meta.dirname, "..");
// Unit CI uses checkout layers only, regardless of installed or external packs.
const unitEnv = {OSD_PACKS: "", OSD_WEB_PACKS: ""};
const help = `Usage: npm run osgjs:unit -- <dir> [--json] [--kernel-strict] [--db sqlite|file] [--class NAME...]
Reads the immediate directory only (no recursion). Requires a checkout and synced libraries.
Builds the whole system in a temporary directory; runs only the selected owners.
--db file uses a private file-backed SQLite, removed after the run (default: sqlite / sql.js).
NODE_OPTIONS=--max-old-space-size=12288 raises the heap limit for scanning, building and running large folders.
Kernel compatibility warnings preserve compiler diagnostics and exit codes; --kernel-strict reports ERROR (exit 2).
Exit codes: 0 all SUCCESS, 1 FAILURE, 2 NOT_COMPILED/ERROR/SKIPPED, 3 no tests.`;

// Generators write to src/, gen/ and web/generated/: give them copies too.
function isolatedSystem(staging, input) {
  const home = join(staging, "checkout");
  mkdirSync(home);
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const folders = inputFoldersOf(root, config, {...process.env, ...unitEnv});
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    if (entry.isFile() && !entry.name.startsWith(".")) cpSync(join(root, entry.name), join(home, entry.name));
  }
  for (const dir of new Set(["src", "test", "tools", "scripts", "webapp", "web", "data", "deploy", ...folders])) {
    if (!existsSync(resolve(root, dir))) continue;
    // External input folders are copied into a numbered private layer below.
    if (resolve(root, dir).startsWith(root + "/")) cpSync(resolve(root, dir), resolve(home, dir), {recursive: true, dereference: true});
  }
  symlinkSync(join(root, "node_modules"), join(home, "node_modules"), "dir");
  mkdirSync(join(home, ".local", "lars"), {recursive: true});
  for (const lib of config.libs ?? []) {
    const name = lib.folder.split("/").at(-1);
    const path = existsSync(join(root, "libs.lock.json")) ? libraryPath(root, name) : root + lib.folder;
    symlinkSync(path, join(home, ".local", "lars", name), "dir");
  }
  // Copy external configured input layers into the private checkout.
  const privateFolders = folders.map((dir, i) => {
    if (resolve(root, dir).startsWith(root + "/")) return dir;
    const own = `inputs/${i}`;
    cpSync(resolve(root, dir), join(home, own), {recursive: true, dereference: true});
    return own;
  });
  config.input_folder = [...privateFolders, input];
  config.options.setup = {...config.options.setup, filename: "../test/setup.mjs"};
  writeFileSync(join(home, "abap_transpile.json"), JSON.stringify(config, null, 2));
  return home;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const json = args.includes("--json");
  let staging, result, warnings = [];
  const selected = [];
  try {
    let directory, database = "sqlite";
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json" || arg === "--kernel-strict") continue;
      if (arg === "--db") {
        database = args[++i];
        if (!["sqlite", "file"].includes(database)) throw new Error("--db must be sqlite or file");
      } else if (arg === "--class") {
        const start = selected.length;
        while (args[i + 1] && !args[i + 1].startsWith("--")) selected.push(args[++i].replaceAll("#", "/").toUpperCase());
        if (selected.length === start) throw new Error("--class needs at least one name (put <dir> first)");
      } else if (arg.startsWith("-") || directory) throw new Error(`unexpected argument: ${arg}`);
      else directory = resolve(arg);
    }
    if (!directory) throw new Error("<dir> is required; use --help for usage");
    const staged = stageInput(directory, selected, "osgjs-unit");
    staging = staged.staging;
    try { warnings = kernelWarnings(staged.input ?? directory); }
    catch (error) {
      warnings = [{kind: "scanner-error", message: `Kernel compatibility scanner failed: ${String(error.message ?? error).replace(/\s+/g, " ")}`}];
    }
    result = staged.result;
    if (!result) {
      const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
      const {overrides} = unitInputs({home: root, config, extraInputs: [staged.input], env: {...process.env, ...unitEnv}});
      for (const o of overrides) console.error(`Override ${o.object}: ${o.hidden} hidden by ${o.input}`);
      const home = isolatedSystem(staging, staged.input);
      const child = await run([process.execPath, join(home, "tools/osgjs-unit-run.mjs"), staged.input, ...staged.chosen], home, {
        ...unitEnv, OSD_LAYERS: "", STG_DB: database,
        STG_DB_PATH: database === "file" ? join(staging, "unit.sqlite") : "",
      });
      if (child.stderr) process.stderr.write(child.stderr);
      if (child.signal) throw new Error(`unit runner terminated by ${child.signal}`);
      if (child.status !== 0) throw new Error(child.stderr.trim() || `unit runner exited ${child.status}`);
      try { result = JSON.parse(child.stdout); }
      catch { throw new Error(child.stderr.trim() || `invalid unit result (exit ${child.status})`); }
      if (!Array.isArray(result.rows)) throw new Error("unit result has no rows");
      result.overrides = overrides;
    }
  } catch (error) {
    result = {classes: 0, compiled: 0, rows: [{status: "ERROR", message: error.message}], overrides: []};
  } finally { if (staging) rmSync(staging, {recursive: true, force: true}); }
  result.overrides ??= [];
  const summary = summarize(applyKernelWarnings(result, warnings, args.includes("--kernel-strict"), selected));
  printResult(summary.result, json);
  return summary.code;
}

if (runsAs("osgjs-unit.mjs")) process.exitCode = await main();
