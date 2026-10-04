// Corpus evidence, deliberately distinct from a language specification.
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {readFileSync, readdirSync, writeFileSync, existsSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {stageInput} from "./osd-unit-ci.mjs";
import {kernelWarnings, KERNEL_FORMS} from "./osd-kernel-compat.mjs";
import {rmSync} from "node:fs";
import {runsAs} from "./osd-main.mjs";

const root = resolve(import.meta.dirname, "..");
const ownerOf = (file) => basename(file).split(".")[0].replaceAll("#", "/").toUpperCase();
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve("@abaplint/transpiler/package.json"));
const core = coreRequire("@abaplint/core");
const syntaxPath = "@abaplint/core/build/src/abap/5_syntax/";
const {CurrentScope} = coreRequire(syntaxPath + "_current_scope");
const {Source} = coreRequire(syntaxPath + "expressions/source");
const {Target} = coreRequire(syntaxPath + "expressions/target");
const {DataDefinition} = coreRequire(syntaxPath + "expressions/data_definition");
const {ReferenceType} = coreRequire(syntaxPath + "_reference");
const {Rearranger} = require("@abaplint/transpiler/build/src/rearranger");
const {Expressions: E, Statements: S, BasicTypes: T} = core;

// Retain the dimensions abaplint resolves; unresolved types never acquire a guess.
function elementary(type) {
  if (!type || type instanceof T.VoidType || type instanceof T.UnknownType) return "unknown";
  const names = ["IntegerType", "Integer8Type", "PackedType", "HexType", "XStringType",
    "CharacterType", "StringType", "FloatType", "DecFloat16Type", "DecFloat34Type",
    "DateType", "TimeType", "NumericType", "UTCLongType"];
  return names.some((name) => T[name] && type instanceof T[name]) ? type.toABAP().replace(/\s+/g, " ") : undefined;
}

export function inventory(directory) {
  const staged = stageInput(directory, [], "osg-support");
  try {
    const input = staged.input ?? directory;
    const reg = new core.Registry(new core.Config(JSON.stringify({
      global: {files: "/**/*.*"}, syntax: {version: core.Version.OpenABAP}, rules: {},
    })));
    const files = readdirSync(input).filter((f) => /\.(abap|xml)$/.test(f)).sort();
    for (const file of files) reg.addFile(new core.MemoryFile(file, readFileSync(join(input, file), "utf8")));
    reg.parse();
    const constructs = new Map(), classes = new Set(), testOwners = new Set(), classLines = new Map();
    let lines = 0;
    const add = (kind, name, filename, token) => {
      if (name === undefined || !/\.clas\.(?:testclasses\.)?abap$/.test(filename)) return;
      const key = `${kind}: ${name}`;
      if (!constructs.has(key)) constructs.set(key, {kind, name, classes: new Set(), lines: new Set(), count: 0, seen: new Set()});
      const c = constructs.get(key), location = `${filename}:${token.getRow()}:${token.getCol()}`;
      if (c.seen.has(location)) return;
      c.seen.add(location); c.count++;
      c.classes.add(ownerOf(filename)); c.lines.add(`${filename}:${token.getRow()}`);
    };
    for (const file of files.filter((f) => /\.clas\.(?:testclasses\.)?abap$/.test(f))) {
      classes.add(ownerOf(file));
      if (file.endsWith(".clas.testclasses.abap")) testOwners.add(ownerOf(file));
      const text = readFileSync(join(input, file), "utf8");
      const count = text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0);
      lines += count; classLines.set(ownerOf(file), (classLines.get(ownerOf(file)) ?? 0) + count);
    }
    for (const obj of reg.getObjects()) {
      if (!obj.getABAPFiles) continue;
      const {spaghetti} = new core.SyntaxLogic(reg, obj).run();
      const scopes = (scope) => {
        const data = scope.getData();
        for (const ref of data.references) if (ref.referenceType === ReferenceType.BuiltinMethodReference)
          add("function", ref.position.getName().toLowerCase(), ref.position.getFilename(), ref.position.getToken());
        for (const id of [...Object.values(data.vars), ...Object.values(data.types)])
          add("type", elementary(id.getType()), id.getFilename(), id.getToken());
        for (const child of scope.getChildren()) scopes(child);
      };
      scopes(spaghetti.getTop());
      for (const file of obj.getABAPFiles()) {
        const filename = file.getFilename();
        if (!/\.clas\.(?:testclasses\.)?abap$/.test(filename)) continue;
        const tree = new Rearranger().run(obj.getType(), file.getStructure());
        if (!tree) continue;
        for (const statement of tree.findAllStatementNodes()) {
          add("statement", statement.get().constructor.name, filename, statement.getFirstToken());
          const current = spaghetti.lookupPosition(statement.getFirstToken().getStart(), filename);
          const scope = new CurrentScope(reg, obj); scope.current = current;
          const syntax = {scope, filename, issues: []};
          if (!current) continue;
          for (const definition of statement.findAllExpressions(E.DataDefinition)) {
            const id = DataDefinition.runSyntax(definition, syntax);
            if (id) add("type", elementary(id.getType()), filename, id.getToken());
          }
          if (!(statement.get() instanceof S.Move)) continue;
          const source = statement.findDirectExpression(E.Source);
          if (!source || !current) continue;
          for (const target of statement.findDirectExpressions(E.Target)) {
            const targetType = Target.runSyntax(target, syntax);
            const from = elementary(Source.runSyntax(source, syntax, targetType));
            const to = elementary(targetType);
            if (from !== undefined && to !== undefined) add("conversion", `${from} → ${to}`, filename, target.getFirstToken());
          }
        }
      }
    }
    return {classes: [...classes].sort(order), testOwners: [...testOwners].sort(order), classLines, lines, constructs, warnings: kernelWarnings(input, reg)};
  } finally { if (staged.staging) rmSync(staged.staging, {recursive: true, force: true}); }
}

// Runner-owned provenance wins; legacy setup errors have no test identity.
const HARNESS_CRASH = /FATAL ERROR:.*(?:heap|allocation|memory)|heap exhaustion|(?:exited|terminated by|runner died:)\s*SIG(?:ABRT|KILL|SEGV)|spawn .*ENOENT/i;
const unmeasuredRow = (row) => row.source === "harness" ||
  (["ERROR", "FAILURE"].includes(row.status) && !row.method && !row.testclass);
const reasonOf = (message) => String(message ?? "setup failed").split(/\r?\n/).find((line) => HARNESS_CRASH.test(line))
  ?? String(message ?? "setup failed").split(/\r?\n/)[0];

function readRuns(paths, folderRuns = []) {
  const rows = new Map(), helpers = new Map(), unmeasured = new Map(), harness = new Map();
  paths = [...paths, ...folderRuns.filter((r) => r.file).map((r) => r.file)];
  for (const path of [...new Set(paths)].sort(order)) {
    const result = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(result.rows)) throw new Error(`run JSON has no rows: ${basename(path)}`);
    const setup = result.rows.filter((r) => unmeasuredRow(r, result));
    if (setup.length) harness.set(path, [...new Set(setup.map((r) => reasonOf(r.message)))].join("; "));
    for (const row of result.rows) {
      if (setup.includes(row)) {
        if (row.class) unmeasured.set(row.class.replaceAll("#", "/").toUpperCase(), reasonOf(row.message));
        continue;
      }
      if (!row.class || !["SUCCESS", "FAILURE", "ERROR", "NOT_COMPILED"].includes(row.status))
        throw new Error(`invalid run row: ${basename(path)}`);
      const cls = row.class.replaceAll("#", "/").toUpperCase();
      if (!rows.has(cls)) rows.set(cls, []);
      rows.get(cls).push(row);
    }
  }
  return {rows, helpers, unmeasured, harness, folderRuns};
}

export function evidence(classes, run) {
  const failures = [], refusals = [], missing = [], reasons = [];
  for (const cls of classes) {
    const rows = run.rows.get(cls);
    if (!rows?.length) {
      const helper = run.helpers?.get(cls);
      if (helper?.status === "runs") reasons.push({class: cls, reason: helper.reason});
      else {
        missing.push(cls);
        const reason = helper?.reason ?? run.unmeasured?.get(cls);
        if (reason) reasons.push({class: cls, reason});
      }
      continue;
    }
    const incomplete = run.unmeasured?.get(cls);
    if (incomplete) { missing.push(cls); reasons.push({class: cls, reason: incomplete}); }
    for (const row of rows) {
      if (unmeasuredRow(row)) {
        missing.push(cls); reasons.push({class: cls, reason: reasonOf(row.message)});
        continue;
      }
      if ((row.status === "FAILURE" || row.status === "ERROR") && (row.method || row.testclass)) failures.push({class: cls, status: row.status, message: String(row.message ?? "").split(/\r?\n/)[0]});
      if (row.status === "NOT_COMPILED") refusals.push({class: cls, message: String(row.message ?? "").split(/\r?\n/)[0]});
    }
  }
  const share = classShare(classes, {failures, refusals, missing});
  // A failure takes precedence, but retain all refusals and missing owners too.
  return {status: failures.length ? "fails" : refusals.length ? "refused" : missing.length ? "not measured" : "runs",
    failures, refusals, missing, reasons, ...share};
}
function classShare(classes, {failures, refusals, missing}) {
  const failingClasses = [...new Set(failures.map((f) => f.class))].sort(order);
  const blocked = new Set([...failingClasses, ...refusals.map((f) => f.class), ...missing]);
  return {failingClasses, passingClasses: [...new Set(classes)].filter((cls) => !blocked.has(cls)).sort(order)};
}
function generatorContent() {
  const generatorFiles = ["tools/osg-support.mjs", "tools/osd-kernel-compat.mjs"].map((file) => ({
    file, blob: execFileSync("git", ["hash-object", "--no-filters", file], {cwd: root, encoding: "utf8"}).trim(),
  }));
  const revision = createHash("sha256").update(generatorFiles.map(({file, blob}) => `${file}:${blob}\n`).join("")).digest("hex").slice(0, 12);
  return {generatorFiles, revision};
}
const knownWarnings = () => KERNEL_FORMS.map(({form, anchor, title, rejects, rewrite, rejectedExample, acceptedExample}) =>
  ({form, anchor, title, rejects, rewrite, rejectedExample, acceptedExample}));

// Rerender a recorded inventory when its original generated ABAP inputs are absent.
// Preserve the source revision/date and every recorded count and test outcome.
export function generateRecorded(file, options = {}) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  const {generatorFiles, revision} = generatorContent();
  for (const c of report.constructs) for (const runtime of ["osgjs", "osgo"])
    Object.assign(c[runtime], classShare(c.classes, c[runtime]));
  Object.assign(report, {generatorFiles, openSteamgate: options["osg-rev"] ?? revision,
    date: options.date ?? report.date, knownWarnings: knownWarnings()});
  return {report, markdown: render(report)};
}
const git = (cwd, format) => execFileSync("git", ["log", "-1", `--format=${format}`], {cwd, encoding: "utf8"}).trim();
const safe = (value) => String(value).replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
const sectionOf = (r) => r.osgjs.status === "runs"
  ? r.osgo.status === "runs" ? "both" : "js"
  : r.osgjs.status === "fails" ? r.osgjs.passingClasses.length > r.classes.length / 2 ? "some" : "fails"
  : r.osgjs.status === "not measured" ? "none"
  : r.osgo.status === "runs" ? "go" : "none";

export function generate(directories, paths, options = {}) {
  // Explicit full-folder provenance prevents a --class subset from crediting helpers.
  const folderRuns = (paths.runs ?? []).flatMap((file) => {
    const entries = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(entries)) throw new Error("run manifest must be an array");
    return entries.map((r) => {
      if (!["osgo", "osgjs"].includes(r.runtime) || !r.folder || (!r.file && !r.reason))
        throw new Error("run manifest needs runtime, folder and file or crash reason");
      return {...r, file: r.file ? resolve(dirname(file), r.file) : undefined};
    });
  });
  const runs = Object.fromEntries(["osgjs", "osgo"].map((name) =>
    [name, readRuns(paths[name], folderRuns.filter((r) => r.runtime === name))]));
  const merged = new Map(), folders = [], warnings = new Map(), owners = new Set(), classLines = new Map();
  for (const directory of [...directories].sort(order)) {
    const inv = inventory(directory);
    for (const cls of inv.classes) {
      if (owners.has(cls)) throw new Error(`duplicate class across input folders: ${cls}`);
      owners.add(cls); classLines.set(cls, inv.classLines.get(cls));
    }
    if (folders.some((f) => f.name === basename(directory))) throw new Error("duplicate folder name");
    const folder = {name: basename(directory), classes: inv.classes.length, lines: inv.lines, evidence: {}};
    for (const [name, run] of Object.entries(runs)) {
      const full = run.folderRuns.filter((r) => r.folder === folder.name);
      if (full.length > 1) throw new Error(`duplicate full-folder run: ${folder.name}/${name}`);
      if (!full.length) continue;
      const entry = full[0];
      const result = entry.file ? JSON.parse(readFileSync(entry.file, "utf8")) : undefined;
      folder.provenance ??= {};
      folder.provenance[name] = entry.provenance ?? result?.provenance ?? {
        database: "not recorded", heap: "not recorded", versions: {},
      };
      const reason = entry.reason ?? run.harness.get(entry.file);
      if (reason) {
        folder.evidence[name] = `not measured: ${reason}`;
        for (const cls of inv.classes) run.unmeasured.set(cls, reason);
      }
      if (entry.wallSeconds !== undefined || entry.peakRssKiB !== undefined) {
        folder.measurements ??= {};
        folder.measurements[name] = {wallSeconds: entry.wallSeconds, peakRssKiB: entry.peakRssKiB};
      }
      if (!entry.file) continue;
      const rows = JSON.parse(readFileSync(entry.file, "utf8")).rows;
      if (rows.some((r) => r.class && !inv.classes.includes(r.class.replaceAll("#", "/").toUpperCase())))
        throw new Error(`run contains class outside folder: ${folder.name}/${name}`);
      if (reason) continue;
      const tests = rows.filter((r) => r.method).length;
      const covered = new Set(rows.map((r) => r.class.replaceAll("#", "/").toUpperCase()));
      const missingOwners = inv.testOwners.filter((cls) => !covered.has(cls));
      const passed = tests > 0 && !missingOwners.length && rows.every((r) => r.status === "SUCCESS");
      folder.evidence[name] = !tests ? "not measured: no executed tests; compiler diagnostics retained" : missingOwners.length ? `partial run; missing test owners: ${missingOwners.join(", ")}; helpers not measured`
        : passed ? `all ${tests} tests SUCCESS`
          : `full run: ${rows.filter((r) => r.method && r.status === "SUCCESS").length}/${tests} tests SUCCESS; ${rows.filter((r) => r.status === "FAILURE").length} FAILURE, ${rows.filter((r) => r.status === "ERROR").length} ERROR; helpers not measured`;
      if (missingOwners.length) continue;
      if (tests || rows.length) for (const cls of inv.classes) {
        if (inv.testOwners.includes(cls) || covered.has(cls)) continue;
        run.helpers.set(cls, {status: passed ? "runs" : "unknown", reason: passed
          ? `exercised by ${tests} tests in the same run` : "not measured: some rows in the same run did not succeed"});
      }
    }
    folders.push(folder);
    for (const [key, c] of inv.constructs) {
      if (!merged.has(key)) merged.set(key, {kind: c.kind, name: c.name, count: 0, classes: new Set(), lines: 0});
      const m = merged.get(key); m.count += c.count; m.lines += c.lines.size;
      for (const cls of c.classes) m.classes.add(cls);
    }
    for (const w of inv.warnings) warnings.set(w.form, (warnings.get(w.form) ?? 0) + 1);
  }
  for (const r of folderRuns) if (!folders.some((f) => f.name === r.folder))
    throw new Error(`run manifest names unknown folder: ${r.folder}`);
  const constructs = [...merged.values()].map((c) => ({...c, classes: [...c.classes].sort(order),
    osgo: evidence([...c.classes].sort(order), runs.osgo), osgjs: evidence([...c.classes].sort(order), runs.osgjs)}))
    .sort((a, b) => order(`${a.kind}: ${a.name}`, `${b.kind}: ${b.name}`));
  const runtime = Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, {
    classes: [...owners].filter((cls) => (run.rows.has(cls) || run.helpers.get(cls)?.status === "runs")).length,
    lines: [...owners].filter((cls) => (run.rows.has(cls) || run.helpers.get(cls)?.status === "runs")).reduce((sum, cls) => sum + classLines.get(cls), 0),
    tests: [...owners].flatMap((cls) => run.rows.get(cls) ?? []).filter((r) => r.method).length,
  }]));
  const abapiti = join(root, ".local/abapiti-src");
  const {generatorFiles, revision} = generatorContent();
  const date = existsSync(abapiti) ? git(abapiti, "%cs") : "unavailable";
  const report = {abapiti: existsSync(abapiti) ? git(abapiti, "%H") : "unavailable",
    openSteamgate: options["osg-rev"] ?? revision, generatorFiles, date: options.date ?? date, folders: folders.sort((a, b) => order(a.name, b.name)), runtime,
    constructs, warnings: [...warnings].sort(([a], [b]) => order(a, b)).map(([form, count]) => ({form, count})),
    knownWarnings: knownWarnings()};
  return {report, markdown: render(report)};
}

function render(report) {
  const incomplete = report.folders.some((f) => !f.evidence.osgjs || f.evidence.osgjs.startsWith("not measured:") || f.evidence.osgjs.includes("missing test owners"));
  const out = ["# OSG support evidence", "",
    "Runs means all using classes passed their recorded tests; fails means some had FAILURE/ERROR rows, and fails in some classes means most passed. Not measured means evidence is missing or incomplete, including harness crashes; class results do not prove each construct correct.",
    "The osgo column records the Go runtime's results for the same classes; refused means the compiler rejected them.",
    "The VS Code column is OSG-JS, the JavaScript runtime used by the extension.", "",
    ...(incomplete ? ["The JS column is incomplete; remeasurement in progress.", ""] : [])];
  const provenance = [`ABAPiti commit: ${report.abapiti}.`,
    `open-steamgate generator content: ${report.openSteamgate}. Date: ${report.date}.`,
    ...report.generatorFiles.map(({file, blob}) => `Generator file: ${file} (git blob ${blob}).`), "",
    "Counts include owner class sources and test includes; lines per construct are distinct starting source lines, and occurrences count AST nodes. In a declared full-folder run where every test owner has rows and every row is SUCCESS, helpers without Unit rows count as runs: exercised by the tests in the same run. In partial runs, passing classes retain their results; omitted test owners and helpers in incomplete or failing runs are not measured. A harness crash, heap exhaustion or setup failure before any class is not measured, with its reason; fails applies only to FAILURE/ERROR test results.", "",
    "Folders: " + report.folders.map((f) => `${safe(f.name)} (${f.classes} classes, ${f.lines} lines)`).join("; ") + ".", "",
    "| Runtime | Classes with evidence | Lines in classes with evidence | Tests |", "|---|---:|---:|---:|"];
  for (const [name, r] of Object.entries(report.runtime)) provenance.push(`| ${name === "osgjs" ? "VS Code (OSG-JS)" : name} | ${r.classes} | ${r.lines} | ${r.tests} |`);
  provenance.push("", "Folder run evidence:", "");
  for (const folder of report.folders) for (const name of ["osgjs", "osgo"]) {
    const measurement = folder.measurements?.[name];
    const metrics = measurement ? ` (${measurement.wallSeconds} s; peak RSS ${measurement.peakRssKiB} KiB)` : "";
    provenance.push(`- ${safe(folder.name)} / ${name === "osgjs" ? "VS Code (OSG-JS)" : name}: ${safe(folder.evidence[name] ?? "not measured: no full-folder run declared; per-class rows retained")}${metrics}`);
  }
  provenance.push("", "Folder run provenance (snapshotted from installed tools; no clock or rendering environment):", "",
    "| Folder | Runtime | Database backend | Heap setting | Installed versions |", "|---|---|---|---|---|");
  for (const folder of report.folders) for (const name of ["osgjs", "osgo"]) {
    const p = folder.provenance?.[name];
    const versions = p ? Object.entries(p.versions).sort(([a], [b]) => order(a, b)).map(([tool, v]) => `${tool} ${v}`).join("; ") : "not recorded";
    provenance.push(`| ${safe(folder.name)} | ${name === "osgjs" ? "VS Code (OSG-JS)" : name} | ${safe(p?.database ?? "not recorded")} | ${safe(p?.heap ?? "not recorded")} | ${safe(versions || "not recorded")} |`);
  }
  const warned = () => {
    out.push("", "## Warned", "", "The shared kernel compatibility scanner knows these forms (including forms absent from this corpus):", "");
    for (const {anchor, title, rejects, rewrite, rejectedExample, acceptedExample} of report.knownWarnings)
      out.push(`<a id="${anchor}"></a>`, `### ${title}`, "", rejects, "", "Rejected by SAP:", "", "```abap", rejectedExample, "```", "",
        rewrite, "", "Correct rewrite:", "", "```abap", acceptedExample, "```", "");
    out.push("", "| Observed form | Findings |", "|---|---:|");
    for (const w of report.warnings) out.push(`| ${safe(w.form)} | ${w.count} |`);
    if (!report.warnings.length) out.push("| None | 0 |");
  };
  for (const [section, title] of [["both", "Runs on JS (osgo agrees)"], ["js", "JS only"], ["go", "osgo only"], ["fails", "Fails on JS"], ["some", "Fails in some classes on JS"], ["none", "Not measured on JS"]]) {
    const rows = report.constructs.filter((r) => sectionOf(r) === section);
    if (["fails", "some"].includes(section)) rows.sort((a, b) =>
      b.osgjs.failingClasses.length / b.classes.length - a.osgjs.failingClasses.length / a.classes.length
      || order(`${a.kind}: ${a.name}`, `${b.kind}: ${b.name}`));
    out.push("", `## ${title} (${rows.length})`, "", "| Construct | Occurrences | Classes | Lines | VS Code (OSG-JS) | osgo |", "|---|---:|---:|---:|---|---|");
    const describe = (e, total) => {
      const remainder = total - e.failingClasses.length - e.passingClasses.length;
      return [e.status === "fails"
      ? `fails in ${e.failingClasses.length} of ${total} classes (${e.failingClasses.slice(0, 3).join(", ")}${e.failingClasses.length > 3 ? ", …" : ""}); passes in ${e.passingClasses.length}${remainder ? `; not measured in ${remainder}` : ""}` : e.status,
      ...e.failingClasses.slice(0, 3).map((cls) => e.failures.find((f) => f.class === cls)).map((f) => `${f.class}: ${f.status}${f.message ? ": " + f.message : ""}`),
      ...e.reasons.map((f) => `${f.class}: ${f.reason}`),
      ...e.refusals.map((f) => `${f.class}: ${f.message}`),
      ...(e.missing.length ? [`missing: ${e.missing.join(", ")}`] : [])].map(safe).join("; ");
    };
    for (const r of rows) out.push(`| ${safe(r.kind + ": " + r.name)} | ${r.count} | ${r.classes.length} | ${r.lines} | ${describe(r.osgjs, r.classes.length)} | ${describe(r.osgo, r.classes.length)} |`);
    if (!rows.length) out.push("| None | | | | | |");
  }
  warned();
  out.push("", "## Provenance", "", ...provenance);
  return out.join("\n") + "\n";
}

export function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log("Usage: npm run osg:support -- <dir>... [--recorded <inventory.json>] [--osgo <json>]... [--osgjs <json>]... [--out <file.md>] [--json <file>] [--check <file.md>] [--runs <manifest.json>] [--osg-rev <hex-id>] [--date <yyyy-mm-dd>]"); return 0;
  }
  try {
    const directories = [], paths = {osgo: [], osgjs: [], runs: []}, options = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (["--recorded", "--osgo", "--osgjs", "--out", "--json", "--check", "--runs", "--osg-rev", "--date"].includes(arg)) {
        const value = args[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
        if (arg === "--osgo" || arg === "--osgjs" || arg === "--runs") paths[arg.slice(2)].push(value);
        else options[arg.slice(2)] = value;
      } else if (arg.startsWith("-")) throw new Error(`unexpected argument: ${arg}`);
      else directories.push(resolve(arg));
    }
    if (!directories.length && !options.recorded) throw new Error("at least one input directory or --recorded inventory is required");
    if (options.recorded && (directories.length || Object.values(paths).some((p) => p.length)))
      throw new Error("--recorded cannot be combined with input directories or run files");
    if (options["osg-rev"] && !/^[a-f0-9]{7,40}$/i.test(options["osg-rev"])) throw new Error("--osg-rev needs a hexadecimal revision id");
    if (options.date && (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) ||
      new Date(options.date).toISOString().slice(0, 10) !== options.date)) throw new Error("--date needs yyyy-mm-dd");
    const {report, markdown} = options.recorded ? generateRecorded(options.recorded, options) : generate(directories, paths, options);
    if (options.check) {
      const old = existsSync(options.check) ? readFileSync(options.check, "utf8") : "";
      if (old !== markdown) {
        const a = old.split("\n"), b = markdown.split("\n");
        const first = b.findIndex((line, i) => line !== a[i]);
        console.error(`support differs: first changed line ${first < 0 ? b.length : first + 1}; ${a.length} → ${b.length} lines`);
        return 1;
      }
    }
    if (options.out) writeFileSync(options.out, markdown);
    if (options.json) writeFileSync(options.json, JSON.stringify(report, null, 2) + "\n");
    if (!options.out && !options.check) process.stdout.write(markdown);
    return 0;
  } catch (error) { console.error(error.message); return 2; }
}
if (runsAs("osg-support.mjs")) process.exitCode = main();
