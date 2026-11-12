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
//                         one it just wrote, and the state remembers it. A
//                         --dump also answers a pending round by hand.
//   --system <prefix>     required: the dump->layers converter names its
//                         layers <system>-<package>, and hana-src-gen
//                         --from-dump needs the prefix.
//   --out <dir>           where the loop keeps its files; default
//                         gen/hana-closure -- state.json,
//                         closure-request.json and closure-gaps.json, all
//                         carrying a real tenant's object names, which is
//                         why gen/hana-closure is on the private gen/ list
//                         (tools/osd-tmp.mjs). The dumps are NOT here: they
//                         go to .local/hana-closure/dump-<NNN>/ (gitignored,
//                         private), one directory per dumper round.
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
// their --from-dump is PR #926, feat/hana-ddic-from-dump, and a tool that
// does not know the flag is refused with a message saying so), then run the
// build's own validation over the tree -- the same channel hana-ddic-gen
// --from-build reads, the validationMessage exported from there, reused and
// not duplicated -- and classify every finding the transpiler emits:
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
// tenant, or a kind this route cannot source yet). The gaps file carries
// each gap's TADIR kind, the first finding that named it and the number of
// validation passes that have named it; a dump manifest's `closure.missing`
// -- the requested names the dictionary does not have -- joins them with
// the kind they are missing under, read on every continuation. No fresh
// names is the fixed point. Otherwise the request goes to
// closure-request.json -- schema 1, the file the dumper's reader reads:
// requested/seen under the nine upper-case TADIR kinds, seen = every name
// an earlier iteration asked (so the dumper skips it), gaps = the current
// gaps, generation = the hash the merge's manifest carries of the dump's
// own manifest -- and the dumper runs:
//
//   $OSD_HANA_DUMPER hana dump --host <HANA_HOST> --port <HANA_PORT> \
//       --user <HANA_USER> --schema <HANA_SCHEMA> \
//       --provenance "hana-closure iteration <n>: the closure request's names" \
//       --ddic-closure <out>/closure-request.json \
//       --out <root>/.local/hana-closure/dump-<NNN> --allow-in-repo
//
// A name the transpiler names without a dictionary kind (the `ddic` bucket:
// the message says only that the type is unknown) is requested under TABL,
// DTEL and TTYP -- SHLP too when the finding itself says search help; the
// dumper answers what exists and reports the rest in `closure.missing`.
//
// OSD_HANA_DUMPER names the binary and OSD_HANA_DUMP_ENV an env file with
// the connection (KEY=VALUE lines, `#` comments, `export ` allowed):
// HANA_HOST/HANA_PORT/HANA_USER/HANA_SCHEMA become the argv flags the real
// dumper marks required, and HANA_PASSWORD becomes VSP_HANA_PASSWORD in the
// child's environment -- the one thing the dumper reads from the
// environment, and the one secret: nothing from the env file but the
// connection flags is on the argv. The dump lands under .local/
// (gitignored, inside the working tree, which the dumper refuses -- hence
// --allow-in-repo). The dumper is a foreign binary -- another project's,
// with credentials of its own -- so it is spawned by the path the
// environment names, never through toolCommand/scriptCommandIn (which would
// dispatch it through `osd gen` or put a node interpreter in front of it)
// and never process.execPath.
//
// The request is written BEFORE any dumper round, and writing it marks its
// names asked (state.json) and the round pending: with the dumper
// configured the next run executes the pending round first; a hand-run dump
// is continued with --dump <dir>, and names still unresolved there surface
// as gaps. --dry-run writes and prints the request and stops;
// --max-iterations bounds the rounds of a run and stops with the pending
// request on disk.
//
// **No HANA from here**: everything above the dumper is tested against a
// scratch tree and a fake dumper that mimics the real CLI contract (the
// required flags, the schema-1 request, the git-tree refusal unless
// --allow-in-repo, the password from VSP_HANA_PASSWORD only) --
// test/hana-closure.mjs, fixtures ZOSD_H5C_*; the real iteration is dell's,
// on the bed.
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
// INTF or CLAS is a NAME-PREFIX heuristic (`if*` -> INTF, anything else
// CLAS), not a TADIR lookup: on the measured log every name in these shapes
// is IF_*, so it is correct there, but a dictionary object dragged into a
// type chain would be asked as CLAS and come back as a wrong-kind gap (the
// dumper answers what the TADIR kind names, and reports the rest missing).
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

// the nine TADIR kinds, in the order the request file lists them
const TADIR = ["TABL", "DTEL", "DOMA", "TTYP", "SHLP", "CLAS", "INTF", "FUGR", "PROG"];

/** the TADIR kinds a classified name is requested under. A `ddic` name has
 *  no kind of its own -- the transpiler's wording says only that the type
 *  is unknown -- so it is asked under every dictionary kind the dumper
 *  resolves by name: TABL, DTEL and TTYP, plus SHLP when the finding
 *  itself says search help. The dumper resolves what exists and reports
 *  the rest in its manifest's `closure.missing`, which the loop reads into
 *  the gaps. Pure. */
export function tadirKinds(kind, finding) {
  if (kind === "ddic") {
    const kinds = ["TABL", "DTEL", "TTYP"];
    if (/search[ -]?help/i.test(String(finding ?? ""))) kinds.push("SHLP");
    return kinds;
  }
  const of = {tabl: "TABL", dtel: "DTEL", doma: "DOMA", clas: "CLAS", intf: "INTF", fugr: "FUGR"};
  return [of[kind] ?? "PROG"];
}

/** the request file's content, schema 1 -- exactly the keys the dumper's
 *  reader reads (`schema`, `iteration`, `requested`, `seen`; the rest is
 *  provenance for the walk): the fresh names per kind, every name an
 *  earlier iteration asked under the kinds it was requested under (so the
 *  dumper skips it), and the current gaps. Pure. */
export function requestFor({iteration, generation, fresh, asked, gaps}) {
  const perKind = () => {
    const kinds = {};
    for (const kind of TADIR) kinds[kind] = [];
    return kinds;
  };
  const requested = perKind();
  for (const n of fresh ?? []) {
    for (const kind of tadirKinds(n.kind, n.finding)) {
      if (requested[kind].includes(n.name) === false) requested[kind].push(n.name);
    }
  }
  const seen = perKind();
  for (const [name, a] of Object.entries(asked ?? {})) {
    const kinds = a.kinds ?? [String(a.kind ?? "").toUpperCase()].filter((k) => k !== "");
    for (const kind of kinds) {
      if (seen[kind] !== undefined && seen[kind].includes(name) === false) seen[kind].push(name);
    }
  }
  return {
    schema: 1,
    iteration,
    generation: generation ?? "",
    source: "transpile validate() findings",
    requested,
    seen,
    gaps: (gaps ?? []).map((g) => ({name: g.name, kind: g.kind, first_finding: g.first_finding, iterations_requested: g.iterations_requested})),
  };
}

/** the dumper's argv and child environment -- the contract the real binary
 *  refuses to run without (cobra MarkFlagRequired: host, user, schema,
 *  provenance, out): the connection flags from the env file's
 *  HANA_HOST/HANA_PORT/HANA_USER/HANA_SCHEMA, the request as a file, the
 *  dump directory inside gitignored .local/ -- inside the working tree,
 *  which the dumper refuses without --allow-in-repo -- and the password
 *  ONLY in the child's environment (VSP_HANA_PASSWORD), never on the argv.
 *  Throws when the env file cannot answer a required flag, before any
 *  connection travels. Pure. */
export function dumperCommand({dumper, connection, requestPath, dumpDir, provenance}) {
  for (const [key, flag] of [["HANA_HOST", "--host"], ["HANA_USER", "--user"], ["HANA_SCHEMA", "--schema"]]) {
    if (connection[key] === undefined || connection[key] === "") {
      throw new Error(`hana-closure: the env file carries no ${key}; the dumper refuses to run without ${flag}`);
    }
  }
  if (connection.HANA_PASSWORD === undefined || connection.HANA_PASSWORD === "") {
    throw new Error("hana-closure: the env file carries no HANA_PASSWORD (VSP_HANA_PASSWORD); the dumper refuses to run without a password");
  }
  const argv = [
    dumper, "hana", "dump",
    "--host", connection.HANA_HOST,
    ...(connection.HANA_PORT === undefined || connection.HANA_PORT === "" ? [] : ["--port", connection.HANA_PORT]),
    "--user", connection.HANA_USER,
    "--schema", connection.HANA_SCHEMA,
    "--provenance", provenance,
    "--ddic-closure", requestPath,
    "--out", dumpDir,
    "--allow-in-repo",
  ];
  return {argv, env: {VSP_HANA_PASSWORD: connection.HANA_PASSWORD}};
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
// -- and their exits are this loop's failures. A tool that does not know
// --from-dump yet (PR #926) is refused by its own "unknown option", and the
// message says what it needs.
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
      const hint = /unknown option/.test(tail)
        ? `\nhana-closure: ${script} refused --from-dump: needs PR #926 (hana-ddic-gen --from-dump)`
        : "";
      throw new Error(`hana-closure: ${script} exited ${child.status ?? "on a signal"} merging ${dump}${tail === "" ? "" : `:\n${tail}`}${hint}`);
    }
  }
}

// the identity of the inputs the findings came from, for the request's
// `generation`: the sha256 the dump->layers converter recorded of the
// dump's manifest.json, copied into gen/hana-src/manifest.json by the
// merge; empty when no merge has written one yet. (The build here is
// validationMessage over the tree -- it writes no manifest of its own; the
// dump's is the manifest on the path.)
const generationOf = (root) => {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "gen", "hana-src", "manifest.json"), "utf8"));
    return String(manifest.dump?.manifest_sha256 ?? "");
  } catch {
    return "";
  }
};

const provenanceFor = (iteration) =>
  `hana-closure iteration ${iteration}: the closure request's names (tools/hana-closure.mjs)`;

const dumperConfigured = (env) =>
  env.OSD_HANA_DUMPER !== undefined && env.OSD_HANA_DUMPER !== "" &&
  env.OSD_HANA_DUMP_ENV !== undefined && env.OSD_HANA_DUMP_ENV !== "";

// one dumper round, when the dumper is configured: undefined when it is
// not (the caller prints the command instead), a throw when the round
// fails. The binary is foreign (see the header): spawned by the path the
// environment names, its connection the env file's flags on the argv and
// the password in the child's environment only.
function dumpRound({root, env, say, requestPath, dumpDir, provenance}) {
  if (dumperConfigured(env) === false) return undefined;
  const connection = parseEnvFile(readFileSync(env.OSD_HANA_DUMP_ENV, "utf8"));
  const {argv, env: childEnv} = dumperCommand({dumper: env.OSD_HANA_DUMPER, connection, requestPath, dumpDir, provenance});
  say(`dump: ${argv.slice(1).join(" ")}`);
  const child = spawnSync(argv[0], argv.slice(1), {cwd: root, env: {...env, ...childEnv}, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024});
  if (child.status !== 0) {
    const tail = [child.stdout, child.stderr].filter(Boolean).join("\n").slice(-2000);
    throw new Error(`hana-closure: the dumper exited ${child.status ?? "on a signal"}${tail === "" ? "" : `:\n${tail}`}`);
  }
}

// the command a human runs by hand when no dumper is configured here: the
// real argv, with the env file's values when it is readable and
// placeholders when it is not -- and no password, ever (it is env-only)
function printedCommand(env, requestPath, dumpDir, provenance) {
  let connection;
  try {
    connection = parseEnvFile(readFileSync(env.OSD_HANA_DUMP_ENV ?? "", "utf8"));
  } catch {
    connection = undefined;
  }
  const shown = dumperConfigured(env) === false && (env.OSD_HANA_DUMPER === undefined || env.OSD_HANA_DUMPER === "")
    ? "$OSD_HANA_DUMPER" : env.OSD_HANA_DUMPER;
  const value = (key, placeholder) =>
    connection?.[key] !== undefined && connection?.[key] !== "" ? connection[key] : placeholder;
  return [
    shown, "hana", "dump",
    `--host ${value("HANA_HOST", "<HANA_HOST>")}`,
    `--port ${value("HANA_PORT", "<HANA_PORT>")}`,
    `--user ${value("HANA_USER", "<HANA_USER>")}`,
    `--schema ${value("HANA_SCHEMA", "<HANA_SCHEMA>")}`,
    `--provenance ${JSON.stringify(provenance)}`,
    `--ddic-closure ${requestPath}`,
    `--out ${dumpDir}`,
    "--allow-in-repo",
  ].join(" ");
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
  state.missing ??= {};
  if (dumpArg === undefined && state.dump === undefined) {
    throw new Error(`hana-closure: no dump known: pass --dump <dir> (the dump the build's inputs are made of)`);
  }
  if (dumpArg !== undefined) state.dump = resolve(root, dumpArg);
  let dump = resolve(root, state.dump);
  saveState(out, state);
  const requestPath = join(out, "closure-request.json");

  // a pending round: a request was written and its names are asked, but no
  // dump has answered it yet. With the dumper configured this run executes
  // the pending round first (the promise the dry-run and the cap make: the
  // next run picks up where the last one stopped); --dump on the command
  // line is a hand-run answer and supersedes it; without the dumper the
  // pending command is printed again, and nothing is merged -- the pending
  // dump does not exist.
  if (state.pending !== undefined && dumpArg === undefined) {
    if (existsSync(requestPath) === false) {
      throw new Error(`hana-closure: the state's pending round (iteration ${state.pending.iteration}) has no request on disk: ${requestPath} is gone; remove state.json's pending or start over`);
    }
    if (dumperConfigured(env) === false) {
      const dumpDir = state.pending.dumpDir;
      const command = printedCommand(env, requestPath, dumpDir, provenanceFor(state.pending.iteration));
      say(`no dumper here: OSD_HANA_DUMPER (the binary) and OSD_HANA_DUMP_ENV (an env file with the connection) are not both set. The pending request is ${requestPath}; run the dumper by hand and continue with --dump ${dumpDir}:`);
      say(`  ${command}`);
      return {stopped: "no-dumper", iteration: state.pending.iteration, command};
    }
    dumpRound({root, env, say, requestPath, dumpDir: state.pending.dumpDir, provenance: provenanceFor(state.pending.iteration)});
    state.dump = state.pending.dumpDir;
    state.iteration = state.pending.iteration;
    delete state.pending;
    saveState(out, state);
    dump = resolve(root, state.dump);
  }

  // the dumper budget of this run; a resumed run has its own
  let rounds = 0;
  for (;;) {
    // what the dump's own manifest says the dictionary answered, read on
    // every continuation: every name in closure.missing (the requested
    // names the dictionary does not have) joins the gaps with the kind it
    // is missing under; a name a later round reports resolved leaves them.
    // A hand-written dump without a manifest answers nothing here.
    try {
      const manifest = JSON.parse(readFileSync(join(dump, "manifest.json"), "utf8"));
      for (const list of Object.values(manifest.closure?.resolved ?? {})) {
        for (const name of list) delete state.missing[String(name).trim().toUpperCase()];
      }
      for (const [kind, list] of Object.entries(manifest.closure?.missing ?? {})) {
        for (const name of list) {
          const upper = String(name).trim().toUpperCase();
          if (state.asked[upper] !== undefined) {
            state.missing[upper] = {kind, iteration: state.asked[upper].iteration};
          }
        }
      }
      saveState(out, state);
    } catch {
      // no manifest, no closure: the findings are the only word
    }

    mergeInputs(root, dump, system, env, say);
    const {names, cascades, unclassified} = classifyFindings(parseFindings(await validationMessage(root)));
    const fresh = names.filter((n) => state.asked[n.name] === undefined);
    // asked and still unresolved; the dumper's missing answer names the kind
    // when it has one. iterations_requested counts the validation passes
    // that have named the gap, the first one included.
    const gapNames = new Set();
    const gaps = [];
    const gapOf = (name, kind, a) => {
      gapNames.add(name);
      return {
        name,
        kind,
        first_finding: a.finding,
        iterations_requested: state.iteration - a.iteration + 2,
      };
    };
    for (const n of names) {
      const a = state.asked[n.name];
      if (a === undefined) continue;
      gaps.push(gapOf(n.name, state.missing[n.name]?.kind ?? a.kinds[0], a));
    }
    for (const name of Object.keys(state.missing).sort()) {
      const a = state.asked[name];
      if (a === undefined || gapNames.has(name)) continue;
      gaps.push(gapOf(name, state.missing[name].kind, a));
    }
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
    const dumpDir = join(root, ".local", "hana-closure", `dump-${String(iteration).padStart(3, "0")}`);
    const freshCount = fresh.length;
    const request = requestFor({iteration, generation: generationOf(root), fresh, asked: state.asked, gaps});
    writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n");
    say(`request ${iteration}: ${freshCount} new name(s) -> ${requestPath}`);

    // the request is written: its names are ASKED from this moment, so a
    // hand-run dump + --dump continuation sees them as asked and gaps the
    // ones still unresolved; the round is pending until a dump answers it
    for (const n of fresh) {
      state.asked[n.name] = {kinds: tadirKinds(n.kind, n.finding), iteration, finding: n.finding};
    }
    state.iteration = iteration;
    state.pending = {iteration, dumpDir};
    saveState(out, state);

    if (dryRun === true) {
      say(`dry run: stopping before the dumper; run it by hand and continue with --dump ${dumpDir}`);
      return {stopped: "dry-run", iteration, request, fresh, gaps, cascades, unclassified};
    }
    if (rounds >= maxIterations) {
      say(`cap: --max-iterations ${maxIterations} reached after ${rounds} dumper round(s); the pending request is ${requestPath}`);
      return {stopped: "cap", iteration, request, fresh, gaps, cascades, unclassified};
    }
    if (dumperConfigured(env) === false) {
      const command = printedCommand(env, requestPath, dumpDir, provenanceFor(iteration));
      say(`no dumper here: OSD_HANA_DUMPER (the binary) and OSD_HANA_DUMP_ENV (an env file with the connection) are not both set. The request is ${requestPath}; run the dumper by hand and continue with --dump ${dumpDir}:`);
      say(`  ${command}`);
      return {stopped: "no-dumper", iteration, request, command, fresh, gaps, cascades, unclassified};
    }
    dumpRound({root, env, say, requestPath, dumpDir, provenance: provenanceFor(iteration)});
    state.dump = dumpDir;
    delete state.pending;
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
