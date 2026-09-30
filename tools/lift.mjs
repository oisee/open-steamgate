#!/usr/bin/env node
// Verified lift, the finding half (docs/verified-lift.md, recipes/).
//
//   node tools/lift.mjs find <folder>...          database work inside loops, counted
//   node tools/lift.mjs model <file.abap> <method> [--ddic <folder>]...
//                                                 the R1 model of that method's loop, or why not
//   node tools/lift.mjs survey <folder> [--ddic <folder>]... [--list]
//                                                 R1 over every method with SELECT SINGLE in a loop:
//                                                 how many are accepted, and the refusals by obligation
//
// `find` counts two things abaplint's db_operation_in_loop does not tell
// apart: a database statement written inside LOOP/DO/WHILE, and a loop that
// calls a method of the same object whose body does one. The second is
// invisible to the rule, which reads one statement list at a time.
//
// `model` is what a recipe's template renders from. It refuses rather than
// guesses: every obligation it checks is named in the refusal, and the ones it
// did not check are listed in the model's `open`. The key and the types come
// from abaplint's own DDIC resolution and syntax, not from a parse of ours.

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
  return parseSources(paths.map((path) => ({name: basename(path), source: readFileSync(path, "utf8")})));
}

function parseSources(files) {
  const registry = new abaplint.Registry();
  for (const file of files) registry.addFile(new abaplint.MemoryFile(file.name, file.source));
  registry.parse();
  return registry.getObjects().filter((o) => o instanceof abaplint.ABAPObject).flatMap((o) => o.getABAPFiles());
}

const loopsOf = (structure) => [
  ...structure.findAllStructures(Structures.Loop),
  ...structure.findAllStructures(Structures.Do),
  ...structure.findAllStructures(Structures.While)];

const methodName = (method) =>
  method.getFirstStatement().findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase();

// A call is to a method of the same class only when nothing stands before the
// name, or `me->` does and nothing stands before `me`: `other->fetch( )`,
// `zcl_x=>fetch( )` and `other->me->fetch( )` are another object's, whatever
// the name. `CALL METHOD fetch` and `CALL METHOD me->fetch` count as well.
const RECEIVER = new Set(["->", "=>", "-"]);
function ownCalls(loop) {
  const names = [];
  for (const statement of loop.findAllStatementNodes()) {
    const tokens = statement.getTokens().map((t) => t.getStr().toLowerCase());
    if (tokens[0] === "call" && tokens[1] === "method") {
      // the target, then the arguments below as for any statement
      const self = tokens[2] === "me" && tokens[3] === "->";
      const at = self ? 4 : 2;
      if (/^[a-z_]\w*$/.test(tokens[at]) && !RECEIVER.has(tokens[at + 1])) names.push(tokens[at]);
    }
    for (const expression of statement.findAllExpressions(Expressions.MethodCall)) {
      const name = expression.findDirectExpression(Expressions.MethodName);
      if (!name) continue;
      const at = statement.getTokens().indexOf(name.getFirstToken());
      const before = tokens[at - 1];
      if (before === "->") {
        if (tokens[at - 2] !== "me" || RECEIVER.has(tokens[at - 3])) continue;
      } else if (RECEIVER.has(before)) {
        continue;
      }
      names.push(name.concatTokens().toLowerCase());
    }
  }
  return names;
}

export function find(folder) {
  const files = walk(folder, /\.abap$/);
  const result = {folder, files: files.length, loops: 0, loops_with_db: 0, loops_with_select_single: 0, loops_via_own_method: 0};
  for (const file of parse(files)) {
    const structure = file.getStructure();
    if (!structure) continue;
    for (const implementation of structure.findAllStructures(Structures.ClassImplementation)) {
      const dbMethods = new Set(implementation.findAllStructures(Structures.Method)
        .filter((m) => m.findAllStatementNodes().some(isDb)).map(methodName));
      for (const loop of loopsOf(implementation)) {
        result.loops++;
        const statements = loop.findAllStatementNodes();
        if (statements.some(isDb)) {
          result.loops_with_db++;
          if (statements.some((s) => s.get() instanceof Statements.Select && /^SELECT SINGLE /i.test(s.concatTokens()))) {
            result.loops_with_select_single++;
          }
          continue;
        }
        if (ownCalls(loop).some((name) => dbMethods.has(name))) result.loops_via_own_method++;
      }
    }
  }
  return result;
}

// Where a table's key and its types come from. A provider takes the registry
// and a table name and answers {keys: [{column, type}]}, undefined when the
// table is not its to answer, or a Refusal when it is and the key is not
// unambiguous. One provider now: the DDIC as abaplint resolves it (key
// includes and appends expanded, data elements and domains followed). CDS
// views and a database catalog are later providers of the same shape.
export const DEFAULT_DDIC = ["src", ".local/lars/open-abap-core/src"];
const DDIC_FILES = /\.(tabl|dtel|doma|view|ttyp)\.xml$/;
const unresolved = (type) => type instanceof abaplint.BasicTypes.UnknownType || type instanceof abaplint.BasicTypes.VoidType;

function ddicKey(registry, table) {
  const t = registry.getObject("TABL", table.toUpperCase());
  if (!t) return undefined;
  if (t.getTableCategory() !== "TRANSP") throw new Refusal("full key", `${table} is not a transparent table`);
  const raw = keyFields(registry, table, t);
  const type = t.parseType(registry);
  if (!(type instanceof abaplint.BasicTypes.StructureType)) throw new Refusal("full key", `${table} does not resolve: ${type.getQualifiedName?.() ?? type.constructor.name}`);
  const components = new Map(type.getComponents().map((c) => [c.name.toUpperCase(), c.type]));
  const keys = t.listKeys(registry).map((k) => k.toUpperCase());
  const missing = keys.find((k) => !components.has(k) || unresolved(components.get(k)));
  if (missing) throw new Refusal("full key", `${table}-${missing} does not resolve in the DDIC given`);
  const extra = [...raw.keys()].find((k) => !keys.includes(k));
  if (extra || raw.size !== keys.length) {
    throw new Refusal("full key", `${table}: abaplint lists ${keys.join(", ")}, the key fields are ${[...raw.keys()].join(", ")}`);
  }

  // A client column is CLNT: by its own type, or by its data element's.
  const isClient = (name) => {
    const field = raw.get(name);
    const rollname = field ? field.ROLLNAME : components.get(name).getDDICName?.();
    if (field?.ROLLNAME === "MANDT" && field.DATATYPE && field.DATATYPE !== "CLNT") {
      throw new Refusal("full key", `${table}-${name} has data element MANDT but type ${field.DATATYPE}`);
    }
    if (field?.DATATYPE === "CLNT") return true;
    if (!rollname) return false;
    const dtel = registry.getObject("DTEL", rollname.toUpperCase());
    return dtel ? dtel.getDataType(registry) === "CLNT" : rollname.toUpperCase() === "MANDT";
  };
  // CLIDEP is the one flag abaplint does not expose
  if (/<CLIDEP>X</.test(t.getXML() ?? "")) {
    const first = type.getComponents()[0]?.name.toUpperCase();
    if (first !== keys[0] || !isClient(first)) {
      throw new Refusal("full key", `${table} is client-dependent but its first field is not the client key field`);
    }
    keys.shift();
  }
  const stray = keys.find(isClient);
  if (stray) throw new Refusal("full key", `${table} has a second client-typed key field ${stray.toLowerCase()}`);
  return {keys: keys.map((k) => ({column: k.toLowerCase(), type: components.get(k), ddic: ddicType(registry, raw.get(k))}))};
}

// The key fields of a table as its DD03P rows, key includes expanded by hand.
// abaplint 2.120.55 cannot be trusted with this alone: listKeys drops a key
// .INCLUDE it cannot resolve, and parseType skips a missing CI_/SI_ include
// without a word, so the key it reports can be a prefix of the real one and
// still look complete. Every key include must resolve here, recursively, or
// the key is not known. A suffixed key include (.INCLU-xxx) listKeys keeps as
// a literal name that never resolves; it is refused here by name so the
// refusal says why.
function keyFields(registry, table, t, out = new Map(), seen = new Set()) {
  for (const field of t.getFields() ?? []) {
    if (field.KEYFLAG !== "X") continue;
    const name = field.FIELDNAME.toUpperCase();
    if (name === ".INCLUDE" || name.startsWith(".INCLU-")) {
      if (name !== ".INCLUDE") throw new Refusal("full key", `${table} has a key include with a suffix (${field.FIELDNAME})`);
      const include = field.PRECFIELD && registry.getObject("TABL", field.PRECFIELD.toUpperCase());
      if (!include && field.PRECFIELD && registry.getObject("VIEW", field.PRECFIELD.toUpperCase())) {
        throw new Refusal("full key", `${table} has a key include ${field.PRECFIELD} that is a view; R1 reads table includes only`);
      }
      if (!include) throw new Refusal("full key", `${table} has a key include ${field.PRECFIELD ?? "(no name)"} that is not in the DDIC given`);
      if (seen.has(include.getName())) throw new Refusal("full key", `${table} includes ${include.getName()} in a cycle`);
      // every field of a key include is key, whatever its own flags say
      const all = (include.getFields() ?? []).map((f) => ({...f, KEYFLAG: "X"}));
      keyFields(registry, table, {getFields: () => all}, out, new Set([...seen, include.getName()]));
    } else if (!name.startsWith(".")) {
      out.set(name, field);
    }
  }
  return out;
}

// The DDIC built-in type of a field: its own, or its data element's.
function ddicType(registry, field) {
  if (!field) return undefined;
  if (field.DATATYPE) return field.DATATYPE.toUpperCase();
  return field.ROLLNAME ? registry.getObject("DTEL", field.ROLLNAME.toUpperCase())?.getDataType(registry)?.toUpperCase() : undefined;
}

const KEY_PROVIDERS = [ddicKey];

function registryFor(ddicFolders, sources) {
  // abaplint's newest syntax: it reads 7.02 code as well, and corpora are not 7.02
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify({
    ...abaplint.Config.getDefault().get(), syntax: {...abaplint.Config.getDefault().get().syntax, errorNamespace: "."}})));
  for (const folder of ddicFolders) {
    let files = [];
    try {
      files = walk(folder, DDIC_FILES);
    } catch {
      continue;
    }
    for (const path of files) registry.addFile(new abaplint.MemoryFile(basename(path), readFileSync(path, "utf8")));
  }
  for (const file of sources) registry.addFile(new abaplint.MemoryFile(file.name, file.source));
  registry.parse();
  return registry;
}

// Two types are the same for a key comparison when they are of one kind and
// have the same length and decimals; anything else converts, and a converted
// comparison is a different comparison.
function sameType(a, b) {
  return a.constructor === b.constructor
    && a.getLength?.() === b.getLength?.()
    && a.getDecimals?.() === b.getDecimals?.();
}
const describe = (type) => `${type.constructor.name.replace(/Type$/, "")}${type.getLength ? `(${type.getLength()})` : ""}`;

// A refusal names the obligation; a sub-kind after a slash ("shape/body")
// says which part of it, so a survey can count what to widen first. The
// message starts with the obligation alone.
class Refusal extends Error {
  constructor(obligation, detail) {
    super(`${obligation.split("/")[0]}: ${detail}`);
    this.obligation = obligation;
  }
}

// The R1 model of the one loop in `method`, or a Refusal naming the obligation.
export function modelR1(path, method, ddicFolders = DEFAULT_DDIC) {
  return modelR1FromSource(basename(path), readFileSync(path, "utf8"), method, ddicFolders);
}

const LOOKUP = "lt_lookup";
const BUILTIN_TYPES = new Set(["B", "S", "I", "INT8", "P", "F", "C", "N", "D", "T", "X", "STRING", "XSTRING",
  "DECFLOAT16", "DECFLOAT34", "UTCLONG"]);
const HIT = "<ls_lookup>";

export function modelR1FromSource(name, source, method, ddicFolders = DEFAULT_DDIC) {
  const registry = registryFor(ddicFolders, [{name, source}]);
  const object = registry.getObjects().find((o) => o instanceof abaplint.ABAPObject && o.getABAPFiles().some((f) => f.getFilename() === name));
  const file = object?.getABAPFiles().find((f) => f.getFilename() === name);
  if (!file) throw new Refusal("shape/parse", `${name} does not parse as an ABAP object`);
  if (!file.getStructure()) throw new Refusal("shape/parse", `${name} does not parse: ${file.getStatements().find((st) => st.get() instanceof abaplint.Unknown)?.concatTokens().slice(0, 80) ?? "no structure"}`);
  const m = file.getStructure()?.findAllStructures(Structures.Method).find((s) => methodName(s) === method.toLowerCase());
  if (!m) throw new Refusal("shape", `no method ${method} in ${name}`);
  const loops = m.findAllStructures(Structures.Loop);
  if (loops.length !== 1) throw new Refusal("shape/loops", `${loops.length} loops in ${method}, R1 takes one`);
  const loop = loops[0];
  // The method sees its own body and its signature; a parameter of that name
  // counts as much as a local declaration.
  const signature = file.getStructure().findAllStatements(Statements.MethodDef)
    .filter((st) => st.findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase() === method.toLowerCase());
  const used = new Set([...m.findAllStatementNodes(), ...signature]
    .flatMap((st) => st.getTokens().map((t) => t.getStr().toLowerCase())));
  for (const generated of [LOOKUP, HIT]) {
    if (used.has(generated)) throw new Refusal("names", `${generated} is already used in ${name}; the rewrite would declare it again`);
  }

  const head = loop.getFirstStatement().concatTokens().replace(/\s+/g, " ");
  const at = /^LOOP AT (\w+) ASSIGNING (<\w+>)\.$/i.exec(head);
  if (!at) {
    const kind = / WHERE /i.test(head) ? "shape/loop-where" : / INTO /i.test(head) ? "shape/loop-into"
      : /^LOOP AT \w+ ASSIGNING/i.test(head) ? "shape/loop-other" : "shape/loop-table";
    throw new Refusal(kind, `the loop is not LOOP AT itab ASSIGNING <fs>: ${head}`);
  }
  const [, table, row] = at;

  const body = loop.findAllStatementNodes().slice(1, -1);
  if (body.length !== 1 || !(body[0].get() instanceof Statements.Select)) {
    throw new Refusal("shape/body", `the loop body is ${body.length} statements, not one SELECT`);
  }
  const select = body[0].concatTokens().replace(/\s+/g, " ");
  const parts = /^SELECT SINGLE ([\w ]+?) FROM (\w+) INTO (\([^)]*\)|\S+) WHERE (.+)\.$/i.exec(select);
  if (!parts) throw new Refusal("shape/select", `not SELECT SINGLE cols FROM dbtab INTO target WHERE ...: ${select}`);
  const [, columnList, dbtab, into, where] = parts;
  const columns = columnList.trim().split(" ").map((c) => c.toLowerCase());
  const targets = into.startsWith("(") ? into.slice(1, -1).split(",").map((t) => t.trim()) : [into];
  if (columns.length !== targets.length) throw new Refusal("shape/select", "columns and targets differ in number");
  const fields = columns.map((column, i) => {
    const t = new RegExp(`^${row.replace(/[<>]/g, "\\$&")}-(\\w+)$`, "i").exec(targets[i]);
    if (!t) throw new Refusal("shape/select", `target ${targets[i]} is not a component of ${row}`);
    return {column, component: t[1].toLowerCase()};
  });

  const keys = where.split(/ AND /i).map((condition) => {
    const c = new RegExp(`^(\\w+) = ${row.replace(/[<>]/g, "\\$&")}-(\\w+)$`, "i").exec(condition.trim());
    if (!c) throw new Refusal("full key", `condition "${condition.trim()}" is not column = ${row}-component`);
    return {column: c[1].toLowerCase(), component: c[2].toLowerCase()};
  });
  let resolved;
  for (const provider of KEY_PROVIDERS) {
    resolved = provider(registry, dbtab);
    if (resolved) break;
  }
  if (!resolved) throw new Refusal("full key", `no provider knows ${dbtab} (DDIC from ${ddicFolders.join(", ")})`);
  const primary = resolved.keys.map((k) => k.column);
  const asked = keys.map((k) => k.column);
  if (asked.length !== primary.length || primary.some((k) => !asked.includes(k))) {
    throw new Refusal("full key", `WHERE names ${asked.join(", ")}; the primary key of ${dbtab} is ${primary.join(", ")}`);
  }
  keys.sort((a, b) => primary.indexOf(a.column) - primary.indexOf(b.column));

  // Key types. FOR ALL ENTRIES reads `table-component`, so the components are
  // the loop table's row's, not the field symbol's: the two are checked to
  // agree, then each key is compared on its own. A key whose type does not
  // resolve stays open; one that resolves and differs refuses, whatever the
  // others do.
  const open = ["no concurrent writes to the table during the loop", "reads confined to one client"];
  const syntax = new abaplint.SyntaxLogic(registry, object).run();
  const scope = syntax.spaghetti.lookupPosition(body[0].getStart(), name);
  const componentsOf = (type) => type instanceof abaplint.BasicTypes.StructureType
    ? new Map(type.getComponents().map((c) => [c.name.toLowerCase(), c.type])) : undefined;
  const tableType = scope?.findVariable(table)?.getType();
  const lineType = tableType instanceof abaplint.BasicTypes.TableType ? tableType.getRowType() : undefined;
  if (tableType?.isGeneric?.() || lineType?.isGeneric?.()) {
    throw new Refusal("shape/generic-table", `${table} is typed generically; FOR ALL ENTRIES needs its components`);
  }
  // with a header line, `IS NOT INITIAL` in the template would test the
  // header and not the body the loop runs over
  if (tableType?.isWithHeader?.()) throw new Refusal("shape/header-line", `${table} has a header line`);
  const line = componentsOf(lineType);
  const symbolType = scope?.findVariable(row)?.getType();
  if (symbolType && !unresolved(symbolType) && (symbolType.isGeneric?.() || !(symbolType instanceof abaplint.BasicTypes.StructureType))) {
    throw new Refusal("shape/row", `${row} is not typed as a structure (${symbolType.constructor.name.replace(/Type$/, "")}); R1 needs it typed like a line of ${table}`);
  }
  const symbol = componentsOf(symbolType);
  let symbolOpen = !line || !symbol;
  // the symbol is read by name in the SELECT and the table by name in FOR
  // ALL ENTRIES, but LOOP ASSIGNING maps them by position: the two must be
  // the same layout, component for component, not just agree on the names
  // touched
  if (line && symbol) {
    const mine = [...symbol.entries()];
    const theirs = [...line.entries()];
    const at = theirs.findIndex(([n], i) => mine[i]?.[0] !== n);
    if (mine.length !== theirs.length || at >= 0) {
      throw new Refusal("shape/row", `${row} is not laid out like a line of ${table}: ${mine.map(([n]) => n).join(", ")} against ${theirs.map(([n]) => n).join(", ")}`);
    }
    for (const [n, t] of theirs) {
      const own = symbol.get(n);
      if (unresolved(own) || unresolved(t)) symbolOpen = true;
      else if (!sameType(own, t)) {
        throw new Refusal("shape/row", `${row}-${n} is ${describe(own)}, ${table}-${n} is ${describe(t)}; ${row} is not typed like its line`);
      }
    }
  }
  const touched = [...new Set([...keys.map((k) => k.component), ...fields.map((f) => f.component)])];
  if (line) {
    for (const component of touched) {
      if (!line.has(component)) throw new Refusal("shape/row", `${table} has no component ${component}; ${row} is not typed like its line`);
      if (!symbol) continue;
      const own = symbol.get(component);
      const theirs = line.get(component);
      if (!own) throw new Refusal("shape/row", `${row} has no component ${component}; it is not typed like a line of ${table}`);
      if (unresolved(own) || unresolved(theirs)) {
        symbolOpen = true;
      } else if (!sameType(own, theirs)) {
        throw new Refusal("shape/row", `${row}-${component} is ${describe(own)}, ${table}-${component} is ${describe(theirs)}; ${row} is not typed like its line`);
      }
    }
  }
  if (symbolOpen) open.unshift(`${row} typed like a line of ${table}`);
  let keysOpen = !line;
  for (const k of keys) {
    const column = resolved.keys.find((r) => r.column === k.column);
    const component = line?.get(k.component);
    if (!component || unresolved(component)) {
      keysOpen = true;
      continue;
    }
    if (!sameType(column.type, component)) {
      throw new Refusal("key types", `${table}-${k.component} is ${describe(component)}, ${dbtab}-${k.column} is ${describe(column.type)}`);
    }
    // abaplint gives INT1, INT2 and INT4 one IntegerType with no width, so
    // equal constructors do not prove equal types there. Only INT4 on both
    // sides counts, and on the row's side only a data element proves it: a
    // component without a DDIC name may be TYPE i, or an INT1 field of a
    // DDIC structure, and the type does not say which
    if (component instanceof abaplint.BasicTypes.IntegerType) {
      // abaplint names a data element-typed component by the element, in
      // the qualified name rather than the DDIC name; it counts only if that
      // element is there
      // a built-in integer answers its own name ("I") as qualified name,
      // which a data element of that name must not be mistaken for
      const dtel = [component.getDDICName?.(), component.getQualifiedName?.()]
        .filter((n) => n && !BUILTIN_TYPES.has(n.toUpperCase()))
        .map((n) => registry.getObject("DTEL", n.toUpperCase())).find(Boolean);
      const theirs = dtel?.getDataType(registry)?.toUpperCase();
      if (column.ddic !== "INT4" || theirs !== "INT4") keysOpen = true;
    }
  }
  if (keysOpen) open.unshift("key types equal column types");

  return {
    recipe: "R1",
    loop: {table: table.toLowerCase(), row: row.toLowerCase()},
    source: {table: dbtab.toLowerCase(), keys},
    fields,
    lookup: LOOKUP,
    hit: HIT,
    // checked here: shape, names, full key and (where the row resolves) key
    // types against the DDIC. Not checked: what `open` lists.
    open,
  };
}

// Every method of every class in `folder` whose loop holds a SELECT SINGLE,
// put through R1: what a recipe can take today, and what stops the rest.
export function survey(folder, ddicFolders = DEFAULT_DDIC) {
  const result = {folder, candidates: 0, accepted: 0, refused: {}, cases: []};
  for (const path of walk(folder, /\.clas\.abap$/)) {
    const source = readFileSync(path, "utf8");
    const [file] = parseSources([{name: basename(path), source}]);
    for (const method of file?.getStructure()?.findAllStructures(Structures.Method) ?? []) {
      const hit = loopsOf(method).some((l) => l.findAllStatementNodes()
        .some((st) => st.get() instanceof Statements.Select && /^SELECT SINGLE /i.test(st.concatTokens())));
      if (!hit) continue;
      result.candidates++;
      const where = `${basename(path)}:${methodName(method)}`;
      try {
        modelR1FromSource(basename(path), source, methodName(method), ddicFolders);
        result.accepted++;
        result.cases.push({where, accepted: true});
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        result.refused[e.obligation] = (result.refused[e.obligation] ?? 0) + 1;
        result.cases.push({where, refused: e.message});
      }
    }
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "find") {
    for (const folder of args) console.log(JSON.stringify(find(folder)));
  } else if (command === "survey") {
    const ddic = [];
    let list = false;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--ddic") ddic.push(args[++i]);
      else if (args[i] === "--list") list = true;
      else rest.push(args[i]);
    }
    const r = survey(rest[0], ddic.length ? ddic : DEFAULT_DDIC);
    const {cases, ...counts} = r;
    console.log(JSON.stringify(counts));
    if (list) for (const c of cases) console.log(`  ${c.where}  ${c.accepted ? "ACCEPTED" : c.refused}`);
  } else if (command === "model") {
    const ddic = [];
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--ddic") ddic.push(args[++i]);
      else rest.push(args[i]);
    }
    try {
      console.log(JSON.stringify(modelR1(rest[0], rest[1], ddic.length ? ddic : DEFAULT_DDIC), null, 2));
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      console.error(`R1 refused -- ${e.message}`);
      process.exit(1);
    }
  } else {
    console.error("usage: node tools/lift.mjs find <folder>... | model <file.abap> <method> [--ddic <folder>]... | survey <folder> [--ddic <folder>]... [--list]");
    process.exit(2);
  }
}
