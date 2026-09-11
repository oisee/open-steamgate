#!/usr/bin/env node
// Sprint-0 dependency-closure probe.
//
// Loads a set of ABAP files (typically one real _DPC_EXT / _MPC_EXT pair and
// whatever you already have of their dependencies) as the *main* files of an
// abaplint registry, the open-abap libs as *dependencies*, and reports every
// object the syntax check cannot resolve. That list is the dependency closure
// still to be shimmed before the transpiler can run the class.
//
//   node tools/closure-probe.mjs <file-or-folder>... [--lib <folder>]...
//                                [--no-default-libs] [--json]
//
// Default libs: .local/lars/{open-abap-core,express-icf-shim}/src,
// .local/fork/open-abap-odata/src/{oo,ddic,exceptions,internal}, and this
// repo's src/. Pass --lib to add e.g. abaplint/deps or a folder of stubs you
// are building up; re-run until the table is empty.
//
// Static only. The dynamic complement is `abap_transpile` with
// "unknownTypes": "runtimeError", which compiles anyway and throws on first
// touch of a missing type.

import * as abaplint from "@abaplint/core";
import {readdirSync, readFileSync, statSync, existsSync} from "node:fs";
import {join, relative} from "node:path";

const ABAP_EXT = /\.(abap|xml|asddls|ddls)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "output" || entry === ".git") {
        continue;
      }
      walk(p, out);
    } else if (ABAP_EXT.test(entry) && !entry.endsWith(".clas.testclasses.abap")) {
      out.push(p);
    }
  }
  return out;
}

function filesFrom(paths) {
  const files = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error("not found: " + p);
      continue;
    }
    const list = statSync(p).isDirectory() ? walk(p) : [p];
    for (const f of list) {
      files.push(new abaplint.MemoryFile(f, readFileSync(f, "utf8")));
    }
  }
  return files;
}

function parseArgs(argv) {
  const targets = [];
  const libs = [];
  let defaultLibs = true;
  let json = false;
  let closure;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lib") {
      libs.push(argv[++i]);
    } else if (a === "--closure") {
      closure = argv[++i];
    } else if (a === "--no-default-libs") {
      defaultLibs = false;
    } else if (a === "--json") {
      json = true;
    } else {
      targets.push(a);
    }
  }
  return {targets, libs, defaultLibs, json, closure};
}

// --closure <repo>: start from the repo's *_DPC* / *_MPC* classes and pull in
// the repo's own objects they reference until nothing own is missing. What
// is still unresolved then is the SAP-standard closure of the service itself,
// not of the whole repository.
function objectFiles(repo) {
  const index = new Map();
  for (const f of walk(repo)) {
    const base = f.split("/").pop().toLowerCase();
    const m = /^(.+?)\.(clas|intf|tabl|dtel|ttyp|doma|view|fugr|msag|enqu|shlp|type)\./.exec(base);
    if (m) {
      const name = m[1].replaceAll("#", "/").toUpperCase();
      if (!index.has(name)) {
        index.set(name, []);
      }
      index.get(name).push(f);
    }
  }
  return index;
}

function seeds(repo) {
  return walk(repo).filter((f) => /_[dm]pc(_ext)?\.clas\.(abap|xml)$/i.test(f.split("/").pop()));
}

const DEFAULT_LIBS = [
  ".local/lars/open-abap-core/src",
  ".local/lars/express-icf-shim/src",
  ".local/fork/open-abap-odata/src/oo",
  ".local/fork/open-abap-odata/src/ddic",
  ".local/fork/open-abap-odata/src/exceptions",
  ".local/fork/open-abap-odata/src/internal",
  "src",
];

const CONFIG = {
  global: {files: "/**/*.*"},
  syntax: {version: "open-abap", errorNamespace: "."},
  rules: {
    parser_error: true,
    check_syntax: true,
    unknown_types: true,
    implement_methods: true,
    check_ddic: true,
  },
};

// abaplint phrases the same root cause many ways; pull out the object that is
// actually missing and tag cascades (symptoms of an already-listed miss).
//   Variable "X" contains unknown: N not found, lookupDataElement  -> N (dtel)
//   Unknown/un-resolveable type in T: N not found, lookupView      -> N (view/tabl)
//   Database table or view "N" not found                            -> N (tabl)
//   Class N not found / Unknown class N / CATCH, unknown class N    -> N (class)
//   Method "x" not found, methodCallChain                           -> cascade
//   "X" not found, findTop|Target|SourceFieldSymbol                 -> cascade
function classify(message) {
  const m = message;
  let r;
  const kindOf = (suffix) => ({
    lookupDataElement: "dtel", lookupDomain: "doma", lookupView: "tabl/view",
    lookupTableType: "ttyp", lookup: "type",
  })[suffix] ?? "type";

  if ((r = /(?:contains unknown:|type in [^:]+:|Contains unknown,|Unknown type,|not a table type,)\s*([\w\/<>=]+)(?: not found)?,\s*(lookup\w*)/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: kindOf(r[2]), cascade: false};
  }
  if ((r = /^([\w\/]+) not found, (lookup\w*)/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: kindOf(r[2]), cascade: false};
  }
  if ((r = /Database table or view "([^"]+)" not found/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: "tabl", cascade: false};
  }
  if ((r = /(?:Class|Interface|Super class|Implemented interface|Class or type) "?([\w\/]+)"? not found/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: "class/intf", cascade: false};
  }
  if ((r = /unknown class ([\w\/]+)/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: "class/intf", cascade: false};
  }
  if ((r = /Function module "([^"]+)" not found/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: "func", cascade: false};
  }
  if ((r = /unable to resolve ([\w\/]+)/i.exec(m))) {
    return {name: r[1].toUpperCase(), kind: "type", cascade: false};
  }
  if (/Method "[^"]+" not found|not found, (findTop|Target|SourceFieldSymbol)|definition "[^"]+" not found|Not an object reference|No source type|unknown, /i.test(m)) {
    return {name: undefined, kind: "cascade", cascade: true};
  }
  const q = /"([^"]+)"/.exec(m);
  return {name: q ? q[1].toUpperCase() : undefined, kind: "other", cascade: false};
}

// Z*/Y*/namespace-less names are the repo's own objects (or those of a sibling
// package it forgot to ship); everything else is SAP standard to be shimmed.
function isStandard(name) {
  return !/^[ZY]/.test(name) && !/^\/[A-Z0-9]+\/[ZY]/.test(name) && !name.startsWith("<");
}

function main() {
  const {targets, libs, defaultLibs, json, closure} = parseArgs(process.argv.slice(2));
  if (targets.length === 0 && closure === undefined) {
    console.error("usage: closure-probe <file-or-folder>... [--lib <folder>]... [--no-default-libs] [--json]");
    console.error("       closure-probe --closure <repo> [--json]   (DPC/MPC seeds, pull own objects to fixpoint)");
    process.exit(2);
  }
  const libFolders = [...(defaultLibs ? DEFAULT_LIBS.filter(existsSync) : []), ...libs];
  const libFiles = filesFrom(libFolders);

  let mainPaths = targets;
  let pulled = 0;
  let rounds = 0;
  if (closure !== undefined) {
    const index = objectFiles(closure);
    const chosen = new Set(seeds(closure));
    for (rounds = 1; rounds <= 12; rounds++) {
      const {rows} = probe([...chosen], libFiles);
      let added = 0;
      for (const r of rows) {
        if (r.standard) {
          continue;
        }
        for (const f of index.get(r.name) ?? []) {
          if (!chosen.has(f)) {
            chosen.add(f);
            added++;
          }
        }
      }
      pulled += added;
      if (added === 0) {
        break;
      }
    }
    mainPaths = [...chosen];
    targets.push(`closure(${closure})`);
  }

  const {issues, rows, standard, cascades, other, mainFiles} = probe(mainPaths, libFiles);

  report({targets, libFolders, mainFiles, issues, rows, standard, cascades, other, json, pulled, rounds});
}

function probe(mainPaths, libFiles) {
  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(CONFIG)));
  const mainFiles = filesFrom(mainPaths);
  const mainNames = new Set(mainFiles.map((f) => f.getFilename()));
  reg.addFiles(mainFiles);
  reg.addDependencies(libFiles);
  reg.parse();
  const issues = reg.findIssues().filter((i) => mainNames.has(i.getFilename()));

  const byName = new Map();
  const other = [];
  let cascades = 0;
  for (const i of issues) {
    const {name, kind, cascade} = classify(i.getMessage());
    const where = relative(process.cwd(), i.getFilename()) + ":" + i.getStart().getRow();
    if (cascade) {
      cascades++;
      continue;
    }
    if (name === undefined) {
      other.push({where, message: i.getMessage()});
      continue;
    }
    const row = byName.get(name) ?? {name, kind, standard: isStandard(name), count: 0, sites: new Set(), sample: i.getMessage()};
    row.count++;
    row.sites.add(where);
    byName.set(name, row);
  }
  const rows = [...byName.values()].sort((a, b) => Number(b.standard) - Number(a.standard) || b.count - a.count || a.name.localeCompare(b.name));
  const standard = rows.filter((r) => r.standard);
  return {issues, rows, standard, cascades, other, mainFiles};
}

function report({targets, libFolders, mainFiles, issues, rows, standard, cascades, other, json, pulled, rounds}) {
  if (json) {
    console.log(JSON.stringify({
      targets, libs: libFolders, files: mainFiles.length, pulled, rounds, issues: issues.length, cascades,
      standard: standard.length, own: rows.length - standard.length,
      missing: rows.map((r) => ({...r, sites: [...r.sites]})), other,
    }, null, 2));
    return;
  }

  console.log(`# closure probe`);
  console.log(`targets: ${targets.join(", ")} (${mainFiles.length} files${pulled ? `, ${pulled} pulled in over ${rounds} rounds` : ""})`);
  console.log(`libs: ${libFolders.join(", ") || "(none)"}`);
  console.log(`issues in targets: ${issues.length} (${cascades} cascades), unresolved objects: ${rows.length} (${standard.length} SAP standard, ${rows.length - standard.length} own)\n`);
  if (rows.length > 0) {
    console.log("| object | kind | std | refs | first site |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| ${r.name} | ${r.kind} | ${r.standard ? "yes" : ""} | ${r.count} | ${[...r.sites][0]} |`);
    }
  }
  if (other.length > 0) {
    console.log(`\n## other issues (${other.length})`);
    for (const o of other.slice(0, 40)) {
      console.log(`- ${o.where}: ${o.message}`);
    }
    if (other.length > 40) {
      console.log(`- … ${other.length - 40} more`);
    }
  }
  process.exitCode = rows.length > 0 ? 1 : 0;
}

main();
