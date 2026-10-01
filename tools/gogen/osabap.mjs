#!/usr/bin/env node
// Build one classic ABAP report as a small native command. The report's
// selection screen is its command-line contract; the Go host is deliberately
// separate from OSGo's HTTP/OData/database host.
import {execFileSync} from "node:child_process";
import {copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {home} from "./home.mjs";
import {checkLibPins} from "./lib-pins.mjs";

const here = import.meta.dirname;
// node tools/gogen/osabap.mjs [report.prog.abap] [--lib <folder>]...
// --lib adds a folder of ABAP classes and interfaces the report may use; the
// classes, interfaces and dictionary beside the report are always part of it.
const cli = process.argv.slice(2);
const libs = cli.flatMap((arg, i) => {
  if (arg !== "--lib") return [];
  // a --lib without its folder would be the working directory, node_modules and all
  if (!cli[i + 1] || cli[i + 1].startsWith("-")) throw new Error("osabap: --lib needs a folder");
  return [resolve(cli[i + 1])];
});
const positional = cli.filter((arg, i) => arg !== "--lib" && cli[i - 1] !== "--lib");
const report = resolve(positional[0] ?? join(here, "apps", "hello", "zhello.prog.abap"));
const name = basename(report).replace(/\.prog\.abap$/i, "").toUpperCase();
const className = `ZCL_OSABAP_${name.replace(/^Z/, "")}`;
const generated = join(here, ".out", "osabap-abap");
const dir = join(here, "go", "cmd", "osabap");
const targetGOOS = process.env.GOOS || (process.platform === "win32" ? "windows" : "");
const bin = join(here, ".out", targetGOOS === "windows" ? "osabap.exe" : "osabap");

checkLibPins(home);
rmSync(generated, {recursive: true, force: true});
mkdirSync(generated, {recursive: true});
mkdirSync(dir, {recursive: true});

const gui = join(home, ".local", "lars", "open-abap-gui");
const {convertProgram} = await import(join(gui, "converter", "src", "api.mjs"));
const source = readFileSync(report, "utf8");
const converted = await convertProgram({source, filename: basename(report), mode: "strict", nativePassthrough: true, className, transactionCode: name});
if (converted.supported !== true || converted.classSource === undefined) {
  throw new Error(`${report}: converter refused the report: ${JSON.stringify(converted.diagnostics)}`);
}
writeFileSync(join(generated, `${className.toLowerCase()}.clas.abap`), converted.classSource);
// the report's own dictionary: tables, data elements, domains and table
// types beside the report file are part of it, the way a report on a system
// brings its tables along in its package
const ddic = readdirSync(dirname(report)).filter((file) => /\.(tabl|dtel|doma|ttyp)\.xml$/i.test(file)).sort();
for (const file of ddic) copyFileSync(join(dirname(report), file), join(generated, file.toLowerCase()));
// the report's own classes and interfaces: whatever sits beside it, tests and
// all (the build skips test classes), under the name abapGit gives them
const own = readdirSync(dirname(report)).filter((file) => /\.(clas|intf)\.(abap|xml|[a-z_]+\.abap)$/i.test(file)).sort();
for (const file of own) copyFileSync(join(dirname(report), file), join(generated, file.toLowerCase()));
// compiled by name: the report's classes and interfaces, and every one in a --lib folder
const objectsIn = (folder) => readdirSync(folder).filter((f) => /\.(clas|intf)\.abap$/i.test(f)).map((f) => f.split(".")[0].toLowerCase());
const ownObjects = [...new Set([...objectsIn(dirname(report)), ...libs.flatMap(objectsIn)])].sort();
// the open-abap-core classes and interfaces the program names are pulled in
// by name, and whatever those name in turn, local classes included, until
// nothing new turns up: a static call is not followed into the core the way a
// class of the program is, and a CLI should not need a list of them
const core = join(home, ".local", "lars", "open-abap-core", "src");
const coreFiles = new Map();
const walk = (folder) => {
  for (const entry of readdirSync(folder, {withFileTypes: true})) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(clas|intf)\.(abap|locals_imp\.abap|locals_def\.abap)$/i.test(entry.name)) {
      // abapGit writes /UI2/CL_JSON as #ui2#cl_json; the source names it with slashes
      const name = entry.name.split(".")[0].toLowerCase().replaceAll("#", "/");
      coreFiles.set(name, [...(coreFiles.get(name) ?? []), path]);
    }
  }
};
walk(core);
const namesIn = (text) => new Set(text.toLowerCase().match(/[a-z_/][a-z0-9_/]*/g) ?? []);
const ownSources = [source, ...[dirname(report), ...libs].flatMap((folder) => readdirSync(folder)
  .filter((f) => /\.(clas|intf)\.(abap|locals_imp\.abap|locals_def\.abap)$/i.test(f))
  .map((f) => readFileSync(join(folder, f), "utf8")))];
const coreObjects = [];
const seen = new Set(ownObjects);
let pending = [...namesIn(ownSources.join("\n"))];
while (pending.length > 0) {
  const next = [];
  for (const name of pending) {
    if (seen.has(name) || !coreFiles.has(name)) continue;
    seen.add(name);
    coreObjects.push(name);
    for (const path of coreFiles.get(name)) next.push(...namesIn(readFileSync(path, "utf8")));
  }
  pending = next;
}
coreObjects.sort();
for (const helper of converted.helperSources ?? []) {
  writeFileSync(join(generated, `${helper.className.toLowerCase()}.clas.abap`), helper.source);
}

const selections = (converted.reportIR?.selections ?? []).flatMap((screen) => screen.elements ?? [])
  .filter((element) => element.name);
const selectionNames = [...new Set(selections.map((element) => element.name.toUpperCase()))];
// a checkbox is PARAMETERS ... AS CHECKBOX; MEMORY ID checkbox names a
// memory id, and a select-option is never one
const isCheckbox = (element) => element.kind === "parameter" && /\bAS\s+CHECKBOX\b/i.test(element.additions ?? "");
const positionals = selections.filter((element) => element.kind === "parameter" && !isCheckbox(element))
  .map((element) => element.name.toUpperCase());
const checkboxes = selections.filter(isCheckbox)
  .map((element) => element.name.toUpperCase());
const ranges = selections.filter((element) => element.kind === "select-option")
  .map((element) => element.name.toUpperCase());

const rttiObjects = readdirSync(join(core, "rtti"))
  .filter((file) => /^cl_abap_.*\.clas\.abap$/i.test(file))
  .map((file) => file.replace(/\.clas\.abap$/i, ""));
const appRuntime = join(here, "apps", "runtime");
const hostObjects = [join(gui, "framework"), join(gui, "framework", "host")]
  .flatMap((folder) => readdirSync(folder)
    .filter((file) => /^(?:zcl_gg_host|zcx_gg_).*\.clas\.abap$/i.test(file) && !/\.testclasses\./i.test(file))
    .map((file) => file.replace(/\.clas\.abap$/i, "")));
const program = compileProgram({
  folders: [generated, ...libs, appRuntime, join(gui, "framework"), join(gui, "src"), core],
  objects: [className.toLowerCase(), ...ownObjects, ...coreObjects, ...hostObjects, ...rttiObjects, "zcl_gg_workbench_utility",
    "cl_gui_control", "cl_gui_container", "cl_gui_cfw", "cl_gui_frontend_services", "zcl_osabap_runtime"],
  skip: (path) => /\.testclasses\.abap$/i.test(path),
});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));

// the report's own tables: their CREATE TABLEs, as the transpiler writes them
// for the Node host, go into the binary for -db; a report without tables is
// built without a database driver
const tables = ddic.filter((file) => /\.tabl\.xml$/i.test(file)).map((file) => file.replace(/\.tabl\.xml$/i, "").toUpperCase());
let schema = [];
if (tables.length > 0) {
  const {DatabaseSetup} = await import(join(home, "node_modules", "@abaplint", "transpiler", "build", "src", "db", "index.js"));
  const own = new Set(tables.map((t) => t.toLowerCase()));
  schema = new DatabaseSetup(program.reg).run().schemas.sqlite
    .filter((sql) => own.has(/^CREATE\s+TABLE\s+['"]?([\w/]+)/i.exec(sql)?.[1]?.toLowerCase()));
  if (schema.length !== tables.length) throw new Error(`osabap: ${tables.length} tables beside the report, ${schema.length} CREATE TABLEs`);
}
writeFileSync(join(dir, "zz_db.json"), JSON.stringify(schema));
writeFileSync(join(dir, "zz_app.go"), `package main

import (
	_ "embed"

	"osg/gogen/abap"
)

//go:embed zz_db.json
var appSchema []byte

var appTables = []string{${tables.map(JSON.stringify).join(", ")}}

const appProgram = ${JSON.stringify(name)}
var appSelectionNames = []string{${selectionNames.map(JSON.stringify).join(", ")}}
var appPositionals = []string{${positionals.map(JSON.stringify).join(", ")}}
var appCheckboxes = map[string]bool{${checkboxes.map((name) => `${JSON.stringify(name)}: true`).join(", ")}}
var appRanges = map[string]bool{${ranges.map((name) => `${JSON.stringify(name)}: true`).join(", ")}}

func newReport(s *abap.Session) *${className} { return New_${className}(s) }
`);

execFileSync("gofmt", ["-w", dir], {stdio: "inherit"});
execFileSync("go", ["build", ...(tables.length > 0 ? [] : ["-tags", "nodatabase"]), "-trimpath", "-ldflags=-s -w", "-o", bin, "./cmd/osabap"], {
  cwd: join(here, "go"), stdio: "inherit",
});
console.log(`osabap: ${name}, ${program.classes.length} classes, ${program.partial.length} statement stubs` +
  `${tables.length ? `, tables ${tables.join(", ")} (-db)` : ""} -> ${bin}`);
