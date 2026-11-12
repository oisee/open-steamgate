#!/usr/bin/env node
// DDIC from the real DD03L for the build (H3 A): the tables the generation
// references but no input folder defines, as abapGit *.tabl.xml in
// gen/hana-ddic/, which abap_transpile.json lists as an input folder BEFORE
// src/ -- a hand-written src/**/<table>.tabl.xml of the same name is a later
// folder and wins, so the real system's DDIC loses to an override only on
// purpose (docs/db-backends.md, "Shadow schema: the client lives in HANA").
//
//   node tools/hana-ddic-gen.mjs --tables <A,B,C> [--out <dir>]
//   node tools/hana-ddic-gen.mjs --from-build [--out <dir>]
//
//   --tables A,B,C   read these tables from the configured schema
//   --from-build     find them yourself: run the transpile's validation over
//                    the tree and read the names out of its own error output
//                    (a missing DDIC name surfaces as
//                    `check_syntax, Database table or view "x" not found` or
//                    `unknown_types, Variable ... contains unknown: X not
//                    found`) -- the transpiler's words, never a parse of ABAP
//   --out <dir>      where the XML lands; default gen/hana-ddic
//
// The DD03L -> shape mapping is tools/hana-ddic-map.mjs and the reads are
// tools/hana-ddic-probe.mjs's readTables: one mapping, one measured-column
// discipline, no second copy here. Like the probe, this tool constructs the
// client in the existing-schema mode, so it is a reader; on the bed it runs
// with OSD_CLIENT set like everything else in the mode.
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {runsAs} from "./osd-main.mjs";
import {HanaDatabaseClient} from "./hana-client.mjs";
import {nameList, readTables} from "./hana-ddic-probe.mjs";
import {ddicFields, tablXml} from "./hana-ddic-map.mjs";
import {excludePatterns, layers} from "./osd-inputs.mjs";
import {loadFiles, loadLibs, selectedModules} from "./osd-transpile.mjs";
import {orderRegistry} from "./osd-warm-order.mjs";

/** the table names out of a thrown transpiler validation: the two shapes a
 *  missing DDIC name surfaces in, upper-cased, de-duplicated, anything else in
 *  the same error ignored. Pure, so the contract is testable without a
 *  database or a full build. */
export function tablesFromValidation(message) {
  const names = new Set();
  for (const match of String(message ?? "").matchAll(/Database table or view "([A-Za-z0-9_]+)" not found/g)) {
    names.add(match[1].toUpperCase());
  }
  for (const match of String(message ?? "").matchAll(/contains unknown: ([A-Za-z0-9_]+) not found/g)) {
    names.add(match[1].toUpperCase());
  }
  return [...names].filter((name) => /^[A-Z0-9_\/#$]+$/.test(name)).sort();
}

/** run the build's own validation over the tree and return its error text --
 *  an empty string when the tree validates clean (nothing unresolved). The
 *  registry is built exactly the way tools/osd-transpile.mjs builds it, hidden
 *  layers excluded, so the names are the ones the build is missing and not
 *  artifacts of a different file selection. Heavy: it loads the libraries,
 *  like the transpile it stands in for. */
async function validationMessage(root) {
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const stack = layers(root, config);
  const listing = {...config, exclude_filter: [...(config.exclude_filter ?? []), ...excludePatterns(stack.hidden)]};
  const loaded = selectedModules(root);
  const {files} = await loadFiles(root, listing, loaded.core);
  const libs = await loadLibs(root, listing);
  const reg = new loaded.core.Registry();
  for (const file of files) reg.addFile(new loaded.core.MemoryFile(file.filename, file.contents));
  for (const lib of libs) reg.addDependency(new loaded.core.MemoryFile(lib.filename, lib.contents));
  orderRegistry(reg, loaded.core, files, libs);
  const settings = {...config.options};
  if (config.write_source_map !== true) settings.ignoreSourceMap = true;
  try {
    new loaded.Transpiler(settings, loaded.plugin).validate(reg);
  } catch (error) {
    return String(error?.message ?? "");
  }
  return "";
}

function take(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`hana-ddic-gen: ${name} needs a value`);
  args.splice(at, 2);
  return value;
}

function has(args, flag) {
  const at = args.indexOf(flag);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

export async function run(args = process.argv.slice(2)) {
  const out = take(args, "--out") ?? join("gen", "hana-ddic");
  const tables = take(args, "--tables");
  const fromBuild = has(args, "--from-build");
  if (args.length > 0) throw new Error(`unknown option ${args.find((a) => a.startsWith("--")) ?? args[0]}`);

  let names;
  if (fromBuild === true) {
    names = tablesFromValidation(await validationMessage(process.cwd()));
    console.log(`hana-ddic-gen: ${names.length} unresolved table name(s) in the generation`);
  } else {
    names = nameList(tables);
    if (names.length === 0) throw new Error("hana-ddic-gen: --tables A,B,C names what to read, or pass --from-build");
  }

  const db = new HanaDatabaseClient({existingSchema: true});
  await db.connect();
  try {
    const {tables: found, elements, domains, texts} = await readTables(db, names);
    mkdirSync(out, {recursive: true});
    for (const [name, table] of found) {
      const fields = ddicFields(table.rows, {elements, domains});
      const xml = tablXml({name, text: texts.get(name) ?? "",
        clidep: String(table.head.clidep ?? "").toUpperCase() === "X", fields});
      const file = join(out, `${name.toLowerCase()}.tabl.xml`);
      writeFileSync(file, xml);
      console.log(`hana-ddic-gen: ${name}: ${fields.length} fields -> ${file}`);
    }
    return 0;
  } finally {
    await db.disconnect();
  }
}

if (runsAs("hana-ddic-gen.mjs")) {
  run().then((code) => process.exit(code)).catch((error) => {
    console.error(`hana-ddic-gen: ${error?.message ?? error}`);
    process.exit(2);
  });
}
