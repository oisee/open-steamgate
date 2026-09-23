#!/usr/bin/env node
// SEGW closure: do the classes SEGW would generate for a foreign project
// compile against open-abap-odata?
//
// For every <project>.iwpr.xml under .local/corpus the generator
// (tools/segw-gen.mjs) produces the _MPC/_DPC pair and the empty _EXT
// subclasses, exactly as transaction SEGW leaves them. Those classes, plus
// the DDIC objects of the same repository, are syntax-checked by abaplint
// against open-abap-core, express-icf-shim and open-abap-odata. Every issue
// lands in one of three buckets:
//
//   ddic       a type the repository relies on and nobody ships: SAP-standard
//              data elements (PERNR_D, BU_PARTNER, ...), Gateway framework
//              tables an application exposes as an entity (/IWFND/SU_ERRLOG)
//              or objects the repository itself did not commit; not our concern
//   generator  the generated class is wrong in itself: duplicate methods or
//              types, a base class that does not compile; segw-gen's bug
//   odata      the generated class calls something open-abap-odata does not
//              have yet; the actionable list for the library
//
// The last two must be empty; the exit code says so. Without a corpus
// (CI) the script prints skip and exits 0.
//
//   npm run segw:closure            report per project
//   npm run segw:closure -- --names also list the missing DDIC names
//   npm run segw:closure -- --odata .local/fork/open-abap-odata
//   npm run segw:closure -- --corpus .local/corpus-sap --lib .local/corpus-sap/<EPM-FG-PACKAGE>
//                                  another folder of repos, function groups for the RFC-mapped ones
//                                   check against a fork instead of Lars's clone

import * as abaplint from "@abaplint/core";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {generate} from "./segw-gen.mjs";
import {loadFunctionGroups} from "./segw-gen-mapping.mjs";

const DEFAULT_CORPUS = ".local/corpus";
const DEFAULT_ODATA = ".local/lars/open-abap-odata";
// open-abap-core, the ICF shim, and open-steamgate's own SADL runtime
// (cl_sadl_gw_model_exposure, cl_sadl_gw_dpc_factory: what a DDIC- or
// CDS-mapped DPC calls; the interfaces come from open-abap-odata)
const LIBS = [".local/lars/open-abap-core/src", ".local/lars/express-icf-shim/src", "src/sadl", "src/cds"];
// released + deprecated S/4 DOMA/DTEL dump (abapedia), used when cloned:
// what Lars would rather not carry in open-abap-core comes from here
const OPTIONAL_LIBS = [".local/lars/s4-private-2022-doma-and-dtel/src"];
const ODATA_FOLDERS = ["src/oo", "src/ddic", "src/exceptions", "src/internal"];
// DDIC objects and the interfaces SEGW generates next to the classes (the
// BOP type copies the RFC templates refer to)
const DDIC_EXT = /\.(tabl|ttyp|dtel|doma|view|shlp|enqu|intf)\.(xml|abap)$/i;
const GEN_MARK = "/__segw_gen__/";

const CONFIG = {
  global: {files: "/**/*.*"},
  syntax: {version: "open-abap", errorNamespace: "."},
  rules: {
    parser_error: true,
    check_syntax: true,
    unknown_types: true,
    implement_methods: true,
    method_implemented_twice: true,
    check_ddic: true,
    check_abstract: true,
    begin_end_names: true,
    unreachable_code: true,
  },
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== ".git" && entry !== "node_modules") {
        walk(p, out);
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

function memoryFiles(paths) {
  return paths.map((p) => new abaplint.MemoryFile(p, readFileSync(p, "utf8")));
}

// the repository's own DDIC, one file per object name (some repos carry copies)
function repoDdic(repo) {
  const seen = new Set();
  const out = [];
  for (const f of walk(repo).filter((p) => DDIC_EXT.test(p))) {
    const base = f.split("/").pop().toLowerCase();
    if (!seen.has(base)) {
      seen.add(base);
      out.push(f);
    }
  }
  return out;
}

//   Variable "X" contains unknown: N not found, lookupDataElement -> N
//   Unknown/un-resolveable type in T: N not found, lookupDomain     -> N
const missingName = (message) => /([A-Za-z0-9_/]+) not found/.exec(message)?.[1]?.toUpperCase();

function bucketOf(issue) {
  const generated = issue.getFilename().includes(GEN_MARK);
  const rule = issue.getKey();
  const message = issue.getMessage();
  const name = missingName(message);
  if (generated) {
    if (rule === "method_implemented_twice" || /already defined|Super class .* contains errors|Could not resolve top/.test(message)) {
      return {bucket: "generator", name};
    }
    if (rule === "unknown_types" || rule === "check_ddic") {
      return name?.startsWith("/IWBEP/") ? {bucket: "odata", name} : {bucket: "ddic", name};
    }
    return {bucket: "odata", name};
  }
  return {bucket: rule === "unknown_types" || rule === "check_ddic" ? "ddic" : "repo", name};
}

function checkProject(iwprPath, repo, libFiles, functionGroupDirs = []) {
  // RFC-mapped operations need the function group of the module: the repo may carry it, --lib adds folders
  const {model, files, ext, skipped} = generate(readFileSync(iwprPath, "utf8"), {functionModules: loadFunctionGroups([repo, ...functionGroupDirs]), warnings: []});
  if (skipped) {
    return {project: model.project, skipped};
  }
  const genDir = join(repo, "__segw_gen__");
  const main = Object.entries({...files, ...ext}).map(([name, content]) => new abaplint.MemoryFile(join(genDir, name), content));
  main.push(...memoryFiles(repoDdic(repo)));
  const mainNames = new Set(main.map((f) => f.getFilename()));

  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(CONFIG)));
  reg.addFiles(main);
  reg.addDependencies(libFiles);
  reg.parse();

  const buckets = {ddic: 0, generator: 0, odata: 0, repo: 0};
  const ddicNames = new Set();
  const actionable = [];
  for (const issue of reg.findIssues().filter((i) => mainNames.has(i.getFilename()))) {
    const {bucket, name} = bucketOf(issue);
    buckets[bucket]++;
    if (bucket === "ddic" && name) {
      ddicNames.add(name);
    }
    if (bucket === "generator" || bucket === "odata") {
      actionable.push(`${bucket}: ${relative(repo, issue.getFilename())}:${issue.getStart().getRow()} ${issue.getMessage()}`);
    }
  }
  return {project: model.project, entityTypes: model.entityTypes.length, buckets, ddicNames: [...ddicNames].sort(), actionable};
}

function main(argv) {
  const names = argv.includes("--names");
  const odata = argv.includes("--odata") ? argv[argv.indexOf("--odata") + 1] : DEFAULT_ODATA;
  const CORPUS = argv.includes("--corpus") ? argv[argv.indexOf("--corpus") + 1] : DEFAULT_CORPUS;
  const libs = argv.flatMap((a, i) => (a === "--lib" ? [argv[i + 1]] : []));
  if (!existsSync(CORPUS)) {
    console.log(`segw-closure: no ${CORPUS}, skip`);
    return 0;
  }
  const libDirs = [...LIBS, ...OPTIONAL_LIBS.filter((d) => existsSync(d)), ...ODATA_FOLDERS.map((f) => join(odata, f))];
  const missing = libDirs.filter((d) => !existsSync(d));
  if (missing.length > 0) {
    console.log(`segw-closure: libs not cloned (${missing.join(", ")}), skip`);
    return 0;
  }
  const libFiles = memoryFiles(libDirs.flatMap((d) => walk(d)));

  const iwprs = walk(CORPUS).filter((p) => p.endsWith(".iwpr.xml")).sort();
  const allDdic = new Set();
  let bad = 0;
  for (const iwpr of iwprs) {
    const repo = join(CORPUS, relative(CORPUS, iwpr).split("/")[0]);
    const r = checkProject(iwpr, repo, libFiles, libs);
    if (r.skipped) {
      console.log(`${r.project}: skip, ${r.skipped}`);
      continue;
    }
    const b = r.buckets;
    const total = b.ddic + b.generator + b.odata + b.repo;
    console.log(`${r.project} (${relative(CORPUS, repo)}, ${r.entityTypes} entity types): ${total} issues, ddic ${b.ddic} / generator ${b.generator} / odata ${b.odata}${b.repo ? ` / repo ${b.repo}` : ""}`);
    for (const line of r.actionable) {
      console.log("  " + line);
    }
    if (names && r.ddicNames.length > 0) {
      console.log("  ddic: " + r.ddicNames.join(", "));
    }
    r.ddicNames.forEach((n) => allDdic.add(n));
    bad += b.generator + b.odata;
  }
  if (names) {
    const standard = [...allDdic].filter((n) => !/^[ZY]/.test(n)).sort();
    console.log(`\nmissing standard DDIC across the corpus (${standard.length}): ${standard.join(", ")}`);
  }
  console.log(bad === 0 ? "\nsegw-closure: closed, every generated class compiles against open-abap-odata" : `\nsegw-closure: ${bad} generator/odata issue(s)`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && /segw-closure\.mjs$/.test(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
