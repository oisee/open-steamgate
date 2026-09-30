#!/usr/bin/env node
// Build one classic ABAP report as a small native command. The report's
// selection screen is its command-line contract; the Go host is deliberately
// separate from OSGo's HTTP/OData/database host.
import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {home} from "./home.mjs";

const here = import.meta.dirname;
const report = resolve(process.argv[2] ?? join(here, "apps", "hello", "zhello.prog.abap"));
const name = basename(report).replace(/\.prog\.abap$/i, "").toUpperCase();
const className = `ZCL_OSABAP_${name.replace(/^Z/, "")}`;
const generated = join(here, ".out", "osabap-abap");
const dir = join(here, "go", "cmd", "osabap");
const targetGOOS = process.env.GOOS || (process.platform === "win32" ? "windows" : "");
const bin = join(here, ".out", targetGOOS === "windows" ? "osabap.exe" : "osabap");

rmSync(generated, {recursive: true, force: true});
mkdirSync(generated, {recursive: true});
mkdirSync(dir, {recursive: true});

const gui = join(home, ".local", "lars", "open-abap-gui");
const {convertProgram} = await import(join(gui, "converter", "src", "api.mjs"));
const source = readFileSync(report, "utf8");
const converted = await convertProgram({source, filename: basename(report), mode: "strict", className, transactionCode: name});
if (converted.supported !== true || converted.classSource === undefined) {
  throw new Error(`${report}: converter refused the report: ${JSON.stringify(converted.diagnostics)}`);
}
writeFileSync(join(generated, `${className.toLowerCase()}.clas.abap`), converted.classSource);
for (const helper of converted.helperSources ?? []) {
  writeFileSync(join(generated, `${helper.className.toLowerCase()}.clas.abap`), helper.source);
}

const selections = (converted.reportIR?.selections ?? []).flatMap((screen) => screen.elements ?? [])
  .filter((element) => element.name);
const selectionNames = [...new Set(selections.map((element) => element.name.toUpperCase()))];
const positionals = selections.filter((element) => element.kind === "parameter" && !/\bCHECKBOX\b/i.test(element.additions ?? ""))
  .map((element) => element.name.toUpperCase());
const checkboxes = selections.filter((element) => /\bCHECKBOX\b/i.test(element.additions ?? ""))
  .map((element) => element.name.toUpperCase());
const ranges = selections.filter((element) => element.kind === "select-option")
  .map((element) => element.name.toUpperCase());

const core = join(home, ".local", "lars", "open-abap-core", "src");
const appRuntime = join(here, "apps", "runtime");
const hostObjects = [join(gui, "framework"), join(gui, "framework", "host")]
  .flatMap((folder) => readdirSync(folder)
    .filter((file) => /^(?:zcl_gg_host|zcx_gg_).*\.clas\.abap$/i.test(file) && !/\.testclasses\./i.test(file))
    .map((file) => file.replace(/\.clas\.abap$/i, "")));
const program = compileProgram({
  folders: [generated, appRuntime, join(gui, "framework"), join(gui, "src"), core],
  objects: [className.toLowerCase(), ...hostObjects, "zcl_gg_workbench_utility",
    "cl_gui_control", "cl_gui_container", "cl_gui_cfw", "cl_gui_frontend_services", "zcl_osabap_runtime"],
  skip: (path) => /\.testclasses\.abap$/i.test(path),
});
writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
writeFileSync(join(dir, "zz_app.go"), `package main

import "osg/gogen/abap"

const appProgram = ${JSON.stringify(name)}
var appSelectionNames = []string{${selectionNames.map(JSON.stringify).join(", ")}}
var appPositionals = []string{${positionals.map(JSON.stringify).join(", ")}}
var appCheckboxes = map[string]bool{${checkboxes.map((name) => `${JSON.stringify(name)}: true`).join(", ")}}
var appRanges = map[string]bool{${ranges.map((name) => `${JSON.stringify(name)}: true`).join(", ")}}

func newReport(s *abap.Session) *${className} { return New_${className}(s) }
`);

execFileSync("gofmt", ["-w", dir], {stdio: "inherit"});
execFileSync("go", ["build", "-tags", "nodatabase", "-trimpath", "-ldflags=-s -w", "-o", bin, "./cmd/osabap"], {
  cwd: join(here, "go"), stdio: "inherit",
});
console.log(`osabap: ${name}, ${program.classes.length} classes, ${program.partial.length} statement stubs -> ${bin}`);
