#!/usr/bin/env node
// Verified lift, the finding half (docs/verified-lift.md, recipes/).
//
//   node tools/lift.mjs find <folder>...          database work inside loops, counted
//   node tools/lift.mjs model <file.abap> <method> [--ddic <folder>]...
//                                                 the R1 model of that method's loop, or why not
//
// `find` counts two things abaplint's db_operation_in_loop does not tell
// apart: a database statement written inside LOOP/DO/WHILE, and a loop that
// calls a method of the same object whose body does one. The second is
// invisible to the rule, which reads one statement list at a time.
//
// `model` is what a recipe's template renders from. It refuses rather than
// guesses: every obligation it checks is named in the refusal, and the ones it
// cannot check yet are listed in recipes/r1-lookup-enrich/recipe.md.

import {createRequire} from "node:module";
import {readFileSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";

const require = createRequire(import.meta.url);
const abaplint = require("@abaplint/core");
const {Structures, Statements, Expressions} = abaplint;

const DB = [Statements.Select, Statements.SelectLoop, Statements.InsertDatabase,
  Statements.UpdateDatabase, Statements.ModifyDatabase, Statements.DeleteDatabase];
const isDb = (statement) => DB.some((c) => statement.get() instanceof c);

function walk(dir, pattern) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git" && entry.name !== "node_modules") out.push(...walk(path, pattern));
    } else if (pattern.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function parse(paths) {
  const registry = new abaplint.Registry();
  for (const path of paths) registry.addFile(new abaplint.MemoryFile(basename(path), readFileSync(path, "utf8")));
  registry.parse();
  return registry.getObjects().filter((o) => o instanceof abaplint.ABAPObject).flatMap((o) => o.getABAPFiles());
}

const loopsOf = (structure) => [
  ...structure.findAllStructures(Structures.Loop),
  ...structure.findAllStructures(Structures.Do),
  ...structure.findAllStructures(Structures.While)];

const methodName = (method) =>
  method.getFirstStatement().findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase();

export function find(folder) {
  const files = walk(folder, /\.abap$/);
  const result = {folder, files: files.length, loops: 0, direct: 0, via_own_method: 0, select_single_direct: 0};
  for (const file of parse(files)) {
    const structure = file.getStructure();
    if (!structure) continue;
    const dbMethods = new Set(structure.findAllStructures(Structures.Method)
      .filter((m) => m.findAllStatementNodes().some(isDb)).map(methodName));
    for (const loop of loopsOf(structure)) {
      result.loops++;
      const statements = loop.findAllStatementNodes();
      if (statements.some(isDb)) {
        result.direct++;
        if (statements.some((s) => s.get() instanceof Statements.Select && /^SELECT SINGLE /i.test(s.concatTokens()))) {
          result.select_single_direct++;
        }
        continue;
      }
      const called = loop.findAllExpressions(Expressions.MethodCall)
        .map((e) => e.findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase());
      if (called.some((name) => dbMethods.has(name))) result.via_own_method++;
    }
  }
  return result;
}

// The primary key of a transparent table from its abapGit XML, client left out.
export function primaryKey(table, ddicFolders) {
  const name = `${table.toLowerCase()}.tabl.xml`;
  for (const folder of ddicFolders) {
    const hit = walk(folder, /\.tabl\.xml$/).find((p) => basename(p) === name);
    if (!hit) continue;
    const xml = readFileSync(hit, "utf8");
    const fields = [...xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)].map((m) => ({
      name: /<FIELDNAME>([^<]+)</.exec(m[1])[1].toLowerCase(),
      key: /<KEYFLAG>X</.test(m[1]),
      client: /<ROLLNAME>MANDT</.test(m[1]),
    }));
    return fields.filter((f) => f.key && !f.client).map((f) => f.name);
  }
  return undefined;
}

class Refusal extends Error {
  constructor(obligation, detail) {
    super(`${obligation}: ${detail}`);
    this.obligation = obligation;
  }
}

// The R1 model of the one loop in `method`, or a Refusal naming the obligation.
export function modelR1(path, method, ddicFolders) {
  const [file] = parse([path]);
  const m = file.getStructure()?.findAllStructures(Structures.Method).find((s) => methodName(s) === method.toLowerCase());
  if (!m) throw new Refusal("shape", `no method ${method} in ${basename(path)}`);
  const loops = m.findAllStructures(Structures.Loop);
  if (loops.length !== 1) throw new Refusal("shape", `${loops.length} loops in ${method}, R1 takes one`);
  const loop = loops[0];

  const head = loop.getFirstStatement().concatTokens().replace(/\s+/g, " ");
  const at = /^LOOP AT (\w+) ASSIGNING (<\w+>)\.$/i.exec(head);
  if (!at) throw new Refusal("shape", `the loop is not LOOP AT itab ASSIGNING <fs>: ${head}`);
  const [, table, row] = at;

  const body = loop.findAllStatementNodes().slice(1, -1);
  if (body.length !== 1 || !(body[0].get() instanceof Statements.Select)) {
    throw new Refusal("shape", "the loop body is not one SELECT");
  }
  const select = body[0].concatTokens().replace(/\s+/g, " ");
  const parts = /^SELECT SINGLE ([\w ]+?) FROM (\w+) INTO (\S+) WHERE (.+)\.$/i.exec(select);
  if (!parts) throw new Refusal("shape", `not SELECT SINGLE cols FROM dbtab INTO target WHERE ...: ${select}`);
  const [, columnList, source, into, where] = parts;
  const columns = columnList.trim().split(" ").map((c) => c.toLowerCase());
  const targets = into.startsWith("(") ? into.slice(1, -1).split(",").map((t) => t.trim()) : [into];
  if (columns.length !== targets.length) throw new Refusal("shape", "columns and targets differ in number");
  const fields = columns.map((column, i) => {
    const t = new RegExp(`^${row.replace(/[<>]/g, "\\$&")}-(\\w+)$`, "i").exec(targets[i]);
    if (!t) throw new Refusal("shape", `target ${targets[i]} is not a component of ${row}`);
    return {column, component: t[1].toLowerCase()};
  });

  const keys = where.split(/ AND /i).map((condition) => {
    const c = new RegExp(`^(\\w+) = ${row.replace(/[<>]/g, "\\$&")}-(\\w+)$`, "i").exec(condition.trim());
    if (!c) throw new Refusal("full key", `condition "${condition.trim()}" is not column = ${row}-component`);
    return {column: c[1].toLowerCase(), component: c[2].toLowerCase()};
  });
  const primary = primaryKey(source, ddicFolders);
  if (!primary) throw new Refusal("full key", `no DDIC for ${source} in ${ddicFolders.join(", ")}`);
  const asked = keys.map((k) => k.column);
  if (asked.length !== primary.length || primary.some((k) => !asked.includes(k))) {
    throw new Refusal("full key", `WHERE names ${asked.join(", ")}; the primary key of ${source} is ${primary.join(", ")}`);
  }
  keys.sort((a, b) => primary.indexOf(a.column) - primary.indexOf(b.column));

  return {
    recipe: "R1",
    loop: {table: table.toLowerCase(), row: row.toLowerCase()},
    source: {table: source.toLowerCase(), keys},
    fields,
    lookup: "lt_lookup",
    hit: "<ls_lookup>",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "find") {
    for (const folder of args) console.log(JSON.stringify(find(folder)));
  } else if (command === "model") {
    const ddic = [];
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--ddic") ddic.push(args[++i]);
      else rest.push(args[i]);
    }
    try {
      console.log(JSON.stringify(modelR1(rest[0], rest[1], ddic.length ? ddic : ["src"]), null, 2));
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      console.error(`R1 refused -- ${e.message}`);
      process.exit(1);
    }
  } else {
    console.error("usage: node tools/lift.mjs find <folder>... | model <file.abap> <method> [--ddic <folder>]...");
    process.exit(2);
  }
}
