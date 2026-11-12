#!/usr/bin/env node
// The dependency closure, by iteration (H5c). CLAUDE.md's Sprint-0
// prediction, made into a loop: a real service's classes transpile against
// this tree's libraries and its own sources -- everything else they name is
// the service's closure (its facades, their interfaces and exceptions, the
// DDIC their variables and SELECTs are typed by, the function groups their
// mapped operations live in) -- and the closure is the long pole. This tool
// walks it: validate, read the transpiler's own words, ask the dumper for
// what is missing, merge the answer into the build's inputs, repeat until a
// fixed point.
//
//   node tools/hana-closure.mjs --dump <dir> --system <prefix>
//        [--out <dir>] [--max-iterations <n>] [--dry-run]
//
//   --dump <dir>          the current dump directory (iteration 1's input;
//                         what `vsp hana dump` wrote for the service, the
//                         same directory hana-ddic-gen --from-dump reads).
//                         After a dumper round the loop's own dump is the
//                         one it just wrote, and the state remembers it.
//   --system <prefix>     required: the dump->layers converter names its
//                         layers <system>-<package>, and hana-src-gen
//                         --from-dump needs the prefix.
//   --out <dir>           where the loop keeps its files; default
//                         gen/hana-closure (untracked: dumps hold a real
//                         tenant's content, and so do the request's raw
//                         findings). Inside: state.json (the iteration, the
//                         current dump, every name asked so far with its
//                         kind, its iteration and the first finding that
//                         named it), closure-request.json (the request the
//                         dumper answers), closure-gaps.json, and one
//                         dump-<NNN>/ directory per dumper round.
//   --max-iterations <n>  at most n dumper rounds in this run (default 10).
//                         The cap stops the loop AFTER writing the pending
//                         request, so the next run picks up where this one
//                         stopped; the budget is per run, not per closure.
//   --dry-run             merge, validate, classify, write and print the
//                         request -- and stop, even when the dumper is
//                         configured.
//
// One iteration: merge the current dump into the inputs (hana-ddic-gen
// --from-dump writes gen/hana-ddic, hana-src-gen --from-dump runs the
// converter and writes gen/hana-src -- both spawned through
// tools/osd-host.mjs's toolCommandIn, the way every tool a tool starts is;
// their --from-dump is PR #926, feat/hana-ddic-from-dump, and until it
// merges this loop needs that branch's tools), then run the build's own
// validation over the tree -- the same channel hana-ddic-gen --from-build
// reads, the validationMessage exported from there, reused and not
// duplicated -- and classify every finding the transpiler emits:
//
//   DDIC            `Database table or view "x" not found` (TABL);
//                   `contains unknown: X not found` (data element or the
//                   DDIC kind the dumper resolves, DTEL when the fix says
//                   lookupDataElement); `Contains unknown, X not found`
//                   (the error's first line); `contains unknown: X,
//                   lookupDomain` (DOMA); `field not part of structure
//                   x-comp` (a TABL structure)
//   program object  `Class x not found`, `Unknown class x` (CLAS, INTF for
//                   an if_* name), `CATCH, unknown class CX_*` (CLAS),
//                   `could not resolve top X` / `unable to resolve x`
//                   (INTF for an IF_* name), and a `parser_error` naming
//                   "FUNCTION" in a `*.fugr.*` file (the function group
//                   itself, its name read off the file)
//   cascade         `Method (or attribute) "m" not found`, `Component "c"
//                   not found in structure`, `Not an object reference`,
//                   `not a table type mt_*`, `... not found in class or
//                   interface`, `"param" not found` with fix findTop/Target
//                   -- the search-help exits' TABLES signatures, whose
//                   types arrive with the function group. Skipped: the name
//                   is not the thing that is missing.
//
// Names are upper-cased, de-duplicated, and split into fresh (never asked)
// and gaps (asked in an earlier round, still unresolved -- not in the
// tenant, or a kind this route cannot source yet) -- the gaps file carries
// each name's kind and the first finding that named it. No fresh names is
// the fixed point. Otherwise a request goes to closure-request.json (names
// per kind, the iteration, what was asked before) and the dumper runs:
//
//   $OSD_HANA_DUMPER hana dump --name <every name so far, comma-joined>
//                    --ddic --out <out>/dump-<NNN>
//
// OSD_HANA_DUMPER names the binary and OSD_HANA_DUMP_ENV an env file with
// the connection (KEY=VALUE lines, `#` comments, `export ` allowed); the
// file's variables are merged into the child's environment. The dumper is
// a foreign binary -- another project's, with credentials of its own -- so
// it is spawned by the path the environment names, never through
// toolCommand/scriptCommandIn (which would dispatch it through `osd gen` or
// put a node interpreter in front of it) and never process.execPath. The
// names are the whole closure, not only the fresh ones: the dumper writes
// a complete dump each round, which is what makes the merge a --from-dump
// of one directory. Without both variables the loop stops and prints the
// command, and the next run continues from the dumped directory.
//
// **No HANA from here**: everything above the dumper is tested against a
// scratch tree and a fake dumper (test/hana-closure.mjs, fixtures
// ZOSD_H5C_*); the real iteration is dell's, on the bed.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {join, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {toolCommandIn} from "./osd-host.mjs";
import {validationMessage} from "./hana-ddic-gen.mjs";

const TOOLS = fileURLToPath(new URL(".", import.meta.url));

// ------------------------------------------------------------ findings ----

// one line of the validation's own words: `rule, message[, fix], file:line`
// -- the fix and the message both carry commas, so the split is anchored on
// the tail: a fix is a single word, and the file is a comma-free,
// space-free, colon-free path followed by a line number. The build's log
// prefix (`osd-build: FAILED: `) is tolerated, so a build log parses the
// same way the thrown error does.
const FINDING = /^([a-z_]+), (.*?)(?:, ([A-Za-z][A-Za-z0-9_]*))?, ([^,\s:]+):(\d+)$/;

/** the findings of a validation message, in order, as
 *  {rule, message, fix, file, line, raw}. Lines that are not findings --
 *  build chatter, empty lines -- are dropped; classifying them is
 *  classifyFindings's job. Pure. */
export function parseFindings(message) {
  const findings = [];
  for (const raw of String(message ?? "").split("\n")) {
    const line = raw.replace(/^(?:osd-build|osd): FAILED: /, "");
    const m = FINDING.exec(line);
    if (m !== null) {
      findings.push({rule: m[1], message: m[2], fix: m[3], file: m[4], line: Number(m[5]), raw: line});
    }
  }
  return findings;
}

const NAME = "[A-Za-z0-9_/#$]+";
const cascadeOf = (message) => [
  [/^Method (?:or attribute )?"[^"]*" not found$/, "method"],
  [/^Component "[^"]*" not found in structure$/, "component"],
  [/^Not an object reference/, "reference"],
  [/^"[^"]*" not found$/, "fugr-signature"],
  [/not a table type [A-Za-z0-9_/#$]+$/, "local-type"],
  [/ not found in class or interface$/, "local-type"],
  [/contains unknown: Select, [A-Za-z]+ not found$/, "select-type"],
  [/contains unknown: Type error,/, "type-error"],
].find(([re]) => re.test(message));

// an abapGit file name's object part to the name it stands for: the
// namespace is escaped as #ns#, one rule for both directions
// (tools/hana-ddic-map.mjs abapGitFileName)
const nameFromAbapFile = (part) => part.replace(/^#([^#]+)#/, "/$1/").toUpperCase();
const objectKind = (name) => (/^if/i.test(name) ? "intf" : "clas");

/** what a validation asks for: `names` carries every requestable name with
 *  its kind (tabl/dtel/doma/ddic -- the DDIC the dumper resolves --
 *  and clas/intf/fugr) and the first finding that named it, in
 *  first-named order, de-duplicated; `cascades` counts the findings whose
 *  name is not the thing that is missing; `unclassified` carries the raw
 *  lines this classifier has no shape for, so a new transpiler wording is
 *  visible instead of silently dropped. Pure. */
export function classifyFindings(findings) {
  const names = [];
  const seen = new Set();
  let cascades = 0;
  const unclassified = [];
  const ask = (name, kind, finding) => {
    if (/^[A-Z0-9_/#$]+$/.test(name) === false || seen.has(name)) return;
    seen.add(name);
    names.push({name, kind, finding: finding.raw});
  };
  for (const finding of findings) {
    const {message, fix, file} = finding;
    let m;
    if ((m = new RegExp(`^Database table or view "(${NAME})" not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "tabl", finding);
    } else if ((m = new RegExp(`field not part of structure (${NAME})-`).exec(message))) {
      ask(m[1].toUpperCase(), "tabl", finding);
    } else if ((m = new RegExp(`^Contains unknown, (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`contains unknown: (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), fix === "lookupDataElement" ? "dtel" : "ddic", finding);
    } else if (fix === "lookupDomain" && (m = new RegExp(`contains unknown: (${NAME})$`).exec(message))) {
      // the domain lookup reports no "not found": its fix field is the shape
      ask(m[1].toUpperCase(), "doma", finding);
    } else if ((m = new RegExp(`^(${NAME}) not found$`).exec(message)) !== null) {
      // the bare shape: a type name alone (`X not found`), the way a missing
      // table type surfaces
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`not a table type, (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`^Class (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`^Unknown class (${NAME})$`).exec(message))) {
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = new RegExp(`^CATCH, unknown class (${NAME})$`).exec(message))) {
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`could not resolve top (${NAME})$`, "i").exec(message))) {
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = new RegExp(`unable to resolve (${NAME})$`).exec(message))) {
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if (message.startsWith("Statement does not exist in the configured ABAP version") === true) {
      // the function-group compile shape: the transpiler compiles a *.abap
      // include as a program, and "FUNCTION" is not in its dialect -- the
      // name of what to dump is the file's own
      const fugr = /^([^.]+)\.fugr\./.exec(file);
      if (fugr !== null) ask(nameFromAbapFile(fugr[1]), "fugr", finding);
      else unclassified.push(finding.raw);
    } else if (cascadeOf(message) !== undefined) {
      cascades++;
    } else {
      unclassified.push(finding.raw);
    }
  }
  return {names, cascades, unclassified};
}

// ------------------------------------------------------------- request ----

/** the request file's content: the iteration it asks for, the dump it
 *  extends, the directory the dumper writes, the fresh names per kind, the
 *  names asked before (name -> kind, iteration, first finding), and every
 *  name so far -- the dumper writes the whole closure each round, which is
 *  what makes each dump self-contained for the next merge. Pure. */
export function requestFor({iteration, dump, dumpDir, fresh, asked, names}) {
  const newNames = {};
  for (const kind of ["tabl", "dtel", "doma", "ddic", "clas", "intf", "fugr"]) {
    const list = fresh.filter((n) => n.kind === kind).map((n) => n.name);
    if (list.length > 0) newNames[kind] = list;
  }
  return {
    iteration,
    generated_at: new Date().toISOString(),
    dump,
    out: dumpDir,
    new: newNames,
    asked_before: asked,
    names,
  };
}

/** the dumper's connection: KEY=VALUE lines, `#` comments, `export `
 *  allowed. Values are taken as written -- quoting is the dumper's dialect,
 *  not this file's. Throws on a line it cannot read, so a typo'd env file
 *  is refused before the connection travels anywhere. Pure. */
export function parseEnvFile(text) {
  const vars = {};
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (m === null) throw new Error(`hana-closure: the env file carries a line that is not KEY=VALUE: ${JSON.stringify(trimmed)}`);
    vars[m[1]] = m[2];
  }
  return vars;
}

// ---------------------------------------------------------------- loop ----

const loadState = (out) => {
  try {
    return JSON.parse(readFileSync(join(out, "state.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

const saveState = (out, state) => {
  writeFileSync(join(out, "state.json"), JSON.stringify(state, null, 2) + "\n");
};

// the current dump into the build's inputs: gen/hana-ddic and gen/hana-src,
// the two folders abap_transpile.json already lists before src/. Both tools
// are tools of this tree, so they start through toolCommandIn -- in a
// compiled binary that is `osd gen <name>`, not a path off import.meta.url
// -- and their exits are this loop's failures.
function mergeInputs(root, dump, system, env, say) {
  const steps = [
    ["hana-ddic-gen.mjs", ["--from-dump", dump, "--out", join(root, "gen", "hana-ddic")]],
    ["hana-src-gen.mjs", ["--from-dump", "--dump", dump, "--system", system, "--out", join(root, "gen", "hana-src")]],
  ];
  for (const [script, argv] of steps) {
    const [command, ...args] = toolCommandIn(env, join(TOOLS, script), argv);
    say(`merge: ${script} --from-dump ${dump}`);
    const child = spawnSync(command, args, {cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024});
    if (child.status !== 0) {
      const tail = [child.stdout, child.stderr].filter(Boolean).join("\n").slice(-2000);
      throw new Error(`hana-closure: ${script} exited ${child.status ?? "on a signal"} merging ${dump}${tail === "" ? "" : `:\n${tail}`}`);
    }
  }
}

function take(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`hana-closure: ${name} needs a value`);
  args.splice(at, 2);
  return value;
}

function has(args, flag) {
  const at = args.indexOf(flag);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

/** one iteration to the fixed point, or one stop on the way to it. The
 *  result says which: "fixed-point" (everything the closure names is in the
 *  build or in the gaps file), "dry-run", "no-dumper" (with the command to
 *  run by hand), or "cap" (with the pending request on disk). */
export async function run(args = process.argv.slice(2), options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const env = options.env ?? process.env;
  const say = options.say ?? ((m) => console.log(`hana-closure: ${m}`));
  const out = resolve(root, take(args, "--out") ?? join("gen", "hana-closure"));
  const dumpArg = take(args, "--dump");
  const system = take(args, "--system");
  const maxIterations = Number(take(args, "--max-iterations") ?? "10");
  const dryRun = has(args, "--dry-run");
  if (args.length > 0) throw new Error(`hana-closure: unknown option ${args.find((a) => a.startsWith("--")) ?? args[0]}`);
  if (Number.isInteger(maxIterations) === false || maxIterations < 0) {
    throw new Error("hana-closure: --max-iterations needs a number >= 0");
  }
  if (system === undefined) {
    throw new Error("hana-closure: --system <prefix> is required (the dump->layers converter names its layers <system>-<package>)");
  }
  mkdirSync(out, {recursive: true});
  const state = loadState(out) ?? {iteration: 1, asked: {}};
  if (dumpArg === undefined && state.dump === undefined) {
    throw new Error(`hana-closure: no dump known: pass --dump <dir> (the dump the build's inputs are made of)`);
  }
  if (dumpArg !== undefined) state.dump = resolve(root, dumpArg);
  let dump = resolve(root, state.dump);
  saveState(out, state);

  // the dumper budget of this run; a resumed run has its own
  let rounds = 0;
  for (;;) {
    mergeInputs(root, dump, system, env, say);
    const {names, cascades, unclassified} = classifyFindings(parseFindings(await validationMessage(root)));
    const fresh = names.filter((n) => state.asked[n.name] === undefined);
    const gaps = names.filter((n) => state.asked[n.name] !== undefined).map((n) => ({
      name: n.name,
      kind: n.kind,
      iteration: state.asked[n.name].iteration,
      finding: state.asked[n.name].finding,
    }));
    // recomputed every pass: a gap that a later round resolves leaves the
    // file on its own
    writeFileSync(join(out, "closure-gaps.json"), JSON.stringify({gaps}, null, 2) + "\n");
    say(`iteration ${state.iteration}: ${fresh.length} new name(s), ${gaps.length} gap(s), ${cascades} cascade finding(s) skipped, ${unclassified.length} unclassified`);
    for (const line of unclassified) say(`unclassified: ${line}`);

    if (fresh.length === 0) {
      say(`fixed point: every unresolved name has been asked and nothing new is named; ${gaps.length} gap(s) -> ${join(out, "closure-gaps.json")}`);
      return {stopped: "fixed-point", iteration: state.iteration, gaps, cascades, unclassified};
    }

    const iteration = state.iteration + 1;
    const dumpDir = join(out, `dump-${String(iteration).padStart(3, "0")}`);
    const allNames = [...new Set([...Object.keys(state.asked), ...fresh.map((n) => n.name)])].sort();
    const request = requestFor({iteration, dump, dumpDir, fresh, asked: state.asked, names: allNames});
    writeFileSync(join(out, "closure-request.json"), JSON.stringify(request, null, 2) + "\n");
    say(`request ${iteration}: ${allNames.length} name(s), ${fresh.length} new -> ${join(out, "closure-request.json")}`);

    if (dryRun === true) {
      say(`dry run: stopping before the dumper; run it by hand and continue with --dump ${dumpDir}`);
      return {stopped: "dry-run", iteration, request, fresh, gaps, cascades, unclassified};
    }
    if (rounds >= maxIterations) {
      say(`cap: --max-iterations ${maxIterations} reached after ${rounds} dumper round(s); the pending request is ${join(out, "closure-request.json")}`);
      return {stopped: "cap", iteration, request, fresh, gaps, cascades, unclassified};
    }
    const dumper = env.OSD_HANA_DUMPER;
    const envFile = env.OSD_HANA_DUMP_ENV;
    if (dumper === undefined || dumper === "" || envFile === undefined || envFile === "") {
      const command = `${dumper === undefined || dumper === "" ? "$OSD_HANA_DUMPER" : dumper} hana dump --name ${allNames.join(",")} --ddic --out ${dumpDir}`;
      say(`no dumper here: OSD_HANA_DUMPER (the binary) and OSD_HANA_DUMP_ENV (an env file with the connection) are not both set. The request is ${join(out, "closure-request.json")}; run the dumper by hand and continue with --dump ${dumpDir}:`);
      say(`  ${command}`);
      return {stopped: "no-dumper", iteration, request, command, fresh, gaps, cascades, unclassified};
    }

    // a foreign binary, spawned by the path the environment names (see the
    // header); its connection is the env file's variables in its own
    // environment, and its failure is this loop's failure
    const connection = parseEnvFile(readFileSync(envFile, "utf8"));
    say(`dump: ${dumper} hana dump --name ${allNames.join(",")} --ddic --out ${dumpDir}`);
    const child = spawnSync(dumper, ["hana", "dump", "--name", allNames.join(","), "--ddic", "--out", dumpDir],
      {cwd: root, env: {...env, ...connection}, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024});
    if (child.status !== 0) {
      const tail = [child.stdout, child.stderr].filter(Boolean).join("\n").slice(-2000);
      throw new Error(`hana-closure: the dumper exited ${child.status ?? "on a signal"}${tail === "" ? "" : `:\n${tail}`}`);
    }
    for (const n of fresh) {
      state.asked[n.name] = {kind: n.kind, iteration, finding: n.finding};
    }
    state.iteration = iteration;
    state.dump = dumpDir;
    saveState(out, state);
    rounds++;
    dump = dumpDir;
  }
}

if (runsAs("hana-closure.mjs")) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`hana-closure: ${error?.message ?? error}`);
    process.exit(2);
  });
}
