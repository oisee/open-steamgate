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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lib") {
      libs.push(argv[++i]);
    } else if (a === "--no-default-libs") {
      defaultLibs = false;
    } else if (a === "--json") {
      json = true;
    } else {
      targets.push(a);
    }
  }
  return {targets, libs, defaultLibs, json};
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

// "Class "ZCL_FOO" not found", "Type "BAPIRET2" not found", ""lv_x" not found"
// abaplint phrases differ per site; the first quoted token is the object.
function classify(message) {
  const quoted = /"([^"]+)"/.exec(message);
  // "X unknown", "... in ZSEGW: MANDT not found, lookupDataElement"
  const bare = /(?:^|:\s*)([\w\/]+)\s+(?:unknown|not found)/i.exec(message);
  const name = quoted ? quoted[1].toUpperCase() : bare ? bare[1].toUpperCase() : undefined;
  const lower = message.toLowerCase();
  let kind = "other";
  if (lower.includes("not found")) {
    kind = "not found";
  } else if (lower.includes("unknown")) {
    kind = "unknown";
  } else if (lower.includes("not implemented") || lower.includes("implement")) {
    kind = "unimplemented";
  }
  return {name, kind};
}

function main() {
  const {targets, libs, defaultLibs, json} = parseArgs(process.argv.slice(2));
  if (targets.length === 0) {
    console.error("usage: closure-probe <file-or-folder>... [--lib <folder>]... [--no-default-libs] [--json]");
    process.exit(2);
  }
  const libFolders = [...(defaultLibs ? DEFAULT_LIBS.filter(existsSync) : []), ...libs];

  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(CONFIG)));
  const mainFiles = filesFrom(targets);
  const mainNames = new Set(mainFiles.map((f) => f.getFilename()));
  reg.addFiles(mainFiles);
  reg.addDependencies(filesFrom(libFolders));
  reg.parse();

  const issues = reg.findIssues().filter((i) => mainNames.has(i.getFilename()));

  const byName = new Map();
  const other = [];
  for (const i of issues) {
    const {name, kind} = classify(i.getMessage());
    const where = relative(process.cwd(), i.getFilename()) + ":" + i.getStart().getRow();
    if (name === undefined) {
      other.push({where, message: i.getMessage()});
      continue;
    }
    const row = byName.get(name) ?? {name, kind, count: 0, sites: new Set(), sample: i.getMessage()};
    row.count++;
    row.sites.add(where);
    byName.set(name, row);
  }
  const rows = [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (json) {
    console.log(JSON.stringify({
      targets, libs: libFolders, files: mainFiles.length, issues: issues.length,
      missing: rows.map((r) => ({...r, sites: [...r.sites]})), other,
    }, null, 2));
    return;
  }

  console.log(`# closure probe`);
  console.log(`targets: ${targets.join(", ")} (${mainFiles.length} files)`);
  console.log(`libs: ${libFolders.join(", ") || "(none)"}`);
  console.log(`issues in targets: ${issues.length}, distinct unresolved objects: ${rows.length}\n`);
  if (rows.length > 0) {
    console.log("| object | kind | refs | first site | sample message |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| ${r.name} | ${r.kind} | ${r.count} | ${[...r.sites][0]} | ${r.sample.replaceAll("|", "\\|")} |`);
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
