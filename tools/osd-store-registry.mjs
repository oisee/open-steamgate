// Registry construction, diagnostics and temporary source borrowing.
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import * as abaplint from "@abaplint/core";
import {ddlsIssues} from "./osd-store-ddls.mjs";
import {TYPES} from "./osd-store-types.mjs";

// Parsing the system costs seconds and every store of the same tree parses
// the same thing, so the answer is kept per root and dropped the moment
// anything is written. A façade that makes a store per request pays once.
const PARSED = new Map();

export function forgetRegistry(store) {
  store.parsed = undefined;
  PARSED.delete(store.root);
}

export function walkStoreFiles(store, dir, out) {
  let entries;
  try {
    // sorted, so two walks of one tree index it the same way
    entries = readdirSync(join(store.root, dir)).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") {
      continue;
    }
    const relative = join(dir, entry);
    if (statSync(join(store.root, relative)).isDirectory()) {
      walkStoreFiles(store, relative, out);
    } else {
      // the build's exclusions, matched the way the transpiler matches them
      // -- against the path with a leading slash
      if (store.excluded.some((re) => re.test("/" + relative))) {
        continue;
      }
      out.push(relative);
    }
  }
  return out;
}

// Why a write throws the whole parse away, when abaplint can be told what
// changed instead.
//
// The fast path works and is wrong. Telling the registry about the file
// and parsing again takes twenty milliseconds where a full parse takes
// four seconds, and the object that changed is checked correctly
// afterwards. Its callers are not: abaplint reparses the object whose
// file moved and leaves the results it already has for everything else,
// so a class that renames a method its callers use comes back clean from
// a caller's check that a full parse fails. Measured on exactly the case
// activation exists to catch, the one that used to answer with an empty
// success.
//
// So a write costs four seconds of reparse at the next check, and an
// activation pays it once. That is the honest price of knowing what the
// system contains, and the transpile after it costs more anyway.
// the parsed system, for whoever needs more than an object: the
// cross-reference derives from the same parse the check runs on
// the whole registry, so a check sees the system and not one file
export function buildRegistry(store, configPath = "abaplint.jsonc") {
  if (store.parsed !== undefined) {
    return store.parsed;
  }
  const shared = PARSED.get(store.root);
  if (shared !== undefined) {
    store.parsed = shared;
    return shared;
  }
  const text = readFileSync(join(store.root, configPath), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const config = JSON.parse(text);
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify({
    global: {files: "/**/*.*"},
    syntax: config.syntax,
    rules: {parser_error: true, check_syntax: true, unknown_types: true, implement_methods: true},
  })));
  // everything, not only what the index calls an object: a class needs its
  // local includes, and a type pool is not an ADT object but the check
  // still needs it
  for (const root of [...store.roots, ...store.libs]) {
    for (const file of root.files ?? walkStoreFiles(store, root.path, [])) {
      if (/\.(abap|xml|asddls)$/.test(file) === false) {
        continue;
      }
      registry.addFile(new abaplint.MemoryFile("/" + file, readFileSync(join(store.root, file), "utf8")));
    }
  }
  registry.parse();
  store.parsed = registry;
  PARSED.set(store.root, registry);
  return registry;
}

// the issues of one object, in the shape the façade returns
export function registryIssues(registry, type, name) {
  // an include is a program to abaplint: the registry files it as PROG,
  // and asking for INCL finds nothing and calls a clean include broken
  const object = registry.getObject(TYPES[type]?.sameFileAs ?? type, name);
  if (object === undefined) {
    return {type, name, issues: [{severity: "E", message: `${type} ${name} is not in the registry`, line: 1, column: 1}]};
  }
  // **A CDS view was checked by nobody.** `findIssuesObject` answers `[]`
  // for a DDLS whatever it contains: measured on `ZC_OSD_PACK` mangled to
  // `definnnne vieeew` and on one selecting from a table that does not
  // exist -- both "no issues", and `npm run lint` agreed, 0 of 416. The
  // build then failed naming a CONSUMER (`zcl_zosd_status_dpc:43`, "ZC_OSD_PACK
  // not found") and never the file somebody had just edited. For a screen
  // with a Check button that is the worst of the three: it says fine, and
  // Activate fails somewhere else (2026-09-19).
  //
  // The generator already reads these, and its refusals are named. So the
  // check asks it: "the check passed" now means "the thing that has to
  // read this can", which is what activation will need anyway.
  const extra = type === "DDLS" ? ddlsIssues(registry, object) : [];
  const issues = [...extra, ...registry.findIssuesObject(object).map((issue) => ({
    severity: "E",
    rule: issue.getKey(),
    message: issue.getMessage(),
    file: issue.getFilename(),
    line: issue.getStart().getRow(),
    column: issue.getStart().getCol(),
  }))];
  return {type, name, issues};
}

// the given text stands in for one file, for the length of one call. The
// shared parse is borrowed rather than rebuilt, because rebuilding it is
// seconds and a human is waiting; the file goes back in a finally, and
// nothing between the two lines is asynchronous, so no other caller can
// see the substitution. abaplint reparses only what the swap dirtied.
export function withSource(store, file, source, fn) {
  const registry = store.registry();
  const filename = "/" + file;
  const before = registry.getFileByName(filename);
  const replacement = new abaplint.MemoryFile(filename, source);
  try {
    if (before === undefined) {
      registry.addFile(replacement);
    } else {
      registry.updateFile(replacement);
    }
    registry.parse();
    return fn(registry);
  } finally {
    if (before === undefined) {
      registry.removeFile(replacement);
    } else {
      registry.updateFile(before);
    }
    registry.parse();
  }
}
