#!/usr/bin/env node
// Verified lift, the finding half (recipes/; the research note is
// docs/verified-lift.md on the research/verified-lift branch).
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
import {DEFAULT_DDIC, Refusal, registryFor, unresolved} from "./dsl-ddic.mjs";
import {abapKeyModel} from "./dsl-abap.mjs";
export {DEFAULT_DDIC, DDIC_PROVIDER, KEY_PROVIDERS} from "./dsl-ddic.mjs";

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

// Two types are the same for a key comparison when they are of one kind and
// have the same length and decimals; anything else converts, and a converted
// comparison is a different comparison.
function sameType(a, b) {
  return a.constructor === b.constructor
    && a.getLength?.() === b.getLength?.()
    && a.getDecimals?.() === b.getDecimals?.();
}
const describe = (type) => `${type.constructor.name.replace(/Type$/, "")}${type.getLength ? `(${type.getLength()})` : ""}`;

// The R1 model of the one loop in `method`, or a Refusal naming the obligation.
export function modelR1(path, method, ddicFolders = DEFAULT_DDIC) {
  return modelR1FromSource(basename(path), readFileSync(path, "utf8"), method, ddicFolders);
}

const LOOKUP = "lt_lookup";
const BUILTIN_TYPES = new Set(["B", "S", "I", "INT8", "P", "F", "C", "N", "D", "T", "X", "STRING", "XSTRING",
  "DECFLOAT16", "DECFLOAT34", "UTCLONG"]);
const HIT = "<ls_lookup>";

const children = (node) => node?.getChildren() ?? [];
const direct = (node, type) => children(node).filter((child) => child.get() instanceof type);
const word = (node) => (node?.concatTokens?.() ?? node?.getStr?.())?.toLowerCase();

function loopHead(statement) {
  const source = statement.findDirectExpression(Expressions.LoopSource);
  const target = statement.findDirectExpression(Expressions.LoopTarget);
  const field = source?.findAllExpressions(Expressions.FieldChain) ?? [];
  const symbol = target?.findAllExpressions(Expressions.FieldSymbol) ?? [];
  const simpleSource = field.length === 1 && field[0].findAllExpressions(Expressions.SourceField).length === 1
    && field[0].getTokens().length === 1 && source.getTokens().length === 1;
  const simpleTarget = symbol.length === 1 && target.getTokens().length === 2
    && word(target.getTokens()[0]) === "assigning";
  const other = children(statement).filter((child) => child !== source && child !== target
    && !["LOOP", "AT", "."].includes(child.concatTokens().toUpperCase()));
  if (simpleSource && simpleTarget && other.length === 0) return {table: word(field[0]), row: word(symbol[0])};
  const kind = other.some((child) => word(child) === "where") ? "shape/loop-where"
    : target && word(target.getTokens()[0]) === "into" ? "shape/loop-into"
      : simpleSource && simpleTarget ? "shape/loop-other" : "shape/loop-table";
  throw new Refusal(kind, `the loop is not LOOP AT itab ASSIGNING <fs>: ${statement.concatTokens()}`);
}

function selectParts(statement, row) {
  const select = statement.findDirectExpression(Expressions.Select);
  const fields = select?.findDirectExpression(Expressions.SQLFieldList);
  const from = select?.findDirectExpression(Expressions.SQLFrom);
  const into = select?.findDirectExpression(Expressions.SQLIntoStructure)
    ?? select?.findDirectExpression(Expressions.SQLIntoList);
  const cond = select?.findDirectExpression(Expressions.SQLCond);
  const shape = () => new Refusal("shape/select", `not SELECT SINGLE cols FROM dbtab INTO target WHERE ...: ${statement.concatTokens()}`);
  if (!select || !fields || !from || !into || !cond || word(select.getTokens()[1]) !== "single") throw shape();
  // These are the only clauses whose semantics the R1 template reproduces.
  // abaplint supplies the clause expressions, but no single "plain SELECT"
  // flag, so compare the direct children rather than re-reading SQL text.
  const clauses = children(select).filter((child) => ![fields, from, into, cond].includes(child));
  if (clauses.length !== 3 || clauses.map(word).join(" ") !== "select single where") throw shape();
  const source = from.findAllExpressions(Expressions.SQLFromSource);
  const tables = source[0]?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  if (source.length !== 1 || tables.length !== 1 || source[0].getTokens().length !== 1) throw shape();
  const dbtab = word(tables[0]);
  const columnNodes = fields.findAllExpressions(Expressions.SQLField);
  if (!columnNodes.length || columnNodes.some((f) => direct(f, Expressions.SQLFieldName).length !== 1
    || f.getTokens().length !== 1)) throw shape();
  const columns = columnNodes.map((f) => word(direct(f, Expressions.SQLFieldName)[0]));
  const targets = direct(into, Expressions.SQLTarget);
  // INTO holds its targets and nothing else: CORRESPONDING FIELDS OF,
  // INDICATORS and the like change what is written
  const intoExtra = children(into).find((child) => !(child.get() instanceof Expressions.SQLTarget)
    && !["into", "(", ")", ","].includes(word(child)));
  if (intoExtra) throw new Refusal("shape/select", `INTO has more than its targets: ${into.concatTokens()}`);
  if (columns.length !== targets.length) throw new Refusal("shape/select", "columns and targets differ in number");
  const mapped = columns.map((column, i) => {
    const target = targets[i].findDirectExpression(Expressions.Target);
    const symbol = target?.findDirectExpression(Expressions.TargetFieldSymbol);
    const component = target?.findDirectExpression(Expressions.ComponentName);
    const tokens = children(target);
    if (!symbol || !component || tokens.length !== 3 || word(symbol) !== row
      || !(tokens[1].get() instanceof abaplint.Tokens.Dash)) {
      throw new Refusal("shape/select", `target ${targets[i].concatTokens()} is not a component of ${row}`);
    }
    return {column, component: word(component)};
  });
  const comparisons = [];
  function readCond(node) {
    const parts = children(node);
    for (const part of parts) {
      if (part.get() instanceof Expressions.SQLCompare) comparisons.push(part);
      else if (part.get() instanceof Expressions.SQLCond) readCond(part);
      else if (part.get() instanceof abaplint.Tokens.Identifier && word(part) === "and") continue;
      else if (["WParenLeftW", "WParenRightW", "ParenRightW"].includes(part.get().constructor.name)) continue;
      else throw new Refusal("full key", `condition "${node.concatTokens()}" is not column = ${row}-component`);
    }
  }
  readCond(cond);
  const keys = comparisons.map((compare) => {
    const parts = children(compare);
    const [column, operator, rhs, dash, component] = parts;
    const chain = rhs?.findAllExpressions(Expressions.FieldChain) ?? [];
    const fs = chain[0]?.findAllExpressions(Expressions.FieldSymbol) ?? [];
    if (parts.length !== 5 || !(column.get() instanceof Expressions.SQLFieldName)
      || !(operator.get() instanceof Expressions.SQLCompareOperator) || !["=", "eq"].includes(word(operator))
      || !(rhs.get() instanceof Expressions.SQLSource) || chain.length !== 1 || fs.length !== 1
      || word(fs[0]) !== row || chain[0].getTokens().length !== 1
      || rhs.getTokens().filter((t) => word(t) !== "@").length !== 1
      || !(dash.get() instanceof abaplint.Tokens.Dash)
      || !(component.get() instanceof Expressions.SQLFieldName)) {
      throw new Refusal("full key", `condition "${compare.concatTokens()}" is not column = ${row}-component`);
    }
    return {column: word(column), component: word(component)};
  });
  return {dbtab, fields: mapped, keys};
}

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

  const {table, row} = loopHead(loop.getFirstStatement());

  const body = loop.findAllStatementNodes().slice(1, -1);
  const selects = body.map((st, i) => st.get() instanceof Statements.Select ? i : -1).filter((i) => i >= 0);
  if (selects.length !== 1 || body.some((st, i) => i !== selects[0] && isDb(st))) {
    throw new Refusal(body.some((st, i) => i !== selects[0] && isDb(st)) ? "no other database statement in the loop" : "shape/body",
      `the loop body needs exactly one SELECT SINGLE and no other database statement`);
  }
  const position = selects[0];
  const {dbtab, fields, keys} = selectParts(body[position], row);
  const resolved = abapKeyModel(registry, dbtab);
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
  const open = ["no concurrent writes to the table during the loop", "reads confined to one client",
    "sy-subrc and sy-dbcnt after the loop not read"];
  const syntax = new abaplint.SyntaxLogic(registry, object).run();
  const scope = syntax.spaghetti.lookupPosition(body[position].getStart(), name);
  if (body.length > 1) {
    const writes = syntax.spaghetti.listWritePositions(name);
    const reads = syntax.spaghetti.listReadPositions(name);
    const inStatement = (ref, st) => !ref.getStart().isBefore(st.getStart()) && !ref.getStart().isAfter(st.getEnd());
    const tokens = (st) => st.getTokens().map((t) => t.getStr().toLowerCase());
    const sysField = (ts, field) => ts.some((t, i) => t === "sy" && ts[i + 1] === "-" && ts[i + 2] === field);
    // The prefetch reads every row's key before the loop, so the loop table
    // may not be touched anywhere in the body: a write through it, even after
    // the read, can change the key of a later row (conservative: any mention)
    for (const st of body.filter((_, i) => i !== position)) {
      if (tokens(st).includes(table)) {
        throw new Refusal("key not written before the read", `${st.concatTokens()} touches the loop table ${table}`);
      }
    }
    for (const st of body.slice(0, position)) {
      const ts = tokens(st);
      // the prefetch sets sy-subrc and sy-dbcnt before the loop starts
      if (sysField(ts, "subrc") || sysField(ts, "dbcnt")) {
        throw new Refusal("system fields before the read", `${st.concatTokens()} reads a system field the prefetch sets`);
      }
      if ((st.get() instanceof Statements.Assign && ts.includes(row))
        || (st.get() instanceof Statements.ModifyInternal && ts.includes(table))) {
        throw new Refusal("key not written before the read", `${st.concatTokens()} may alias or modify the key`);
      }
      for (const ref of writes.filter((r) => inStatement(r, st) && r.getName().toLowerCase() === row)) {
        const at = st.getTokens().indexOf(ref.getToken());
        const component = ts[at + 1] === "-" ? ts[at + 2] : undefined;
        if (!component || keys.some((k) => k.component === component)) {
          throw new Refusal("key not written before the read", `${st.concatTokens()} writes ${row}${component ? `-${component}` : ""}`);
        }
      }
      // Calls and indirect assignments are conservative when the syntax cannot
      // establish which component of the row they change.
      if (st.findAllExpressions(Expressions.MethodCall).length && ts.includes(row)) {
        throw new Refusal("key not written before the read", `${st.concatTokens()} passes ${row} to a method`);
      }
    }
    for (const st of body.slice(position + 1)) {
      const ts = tokens(st);
      if (reads.some((r) => inStatement(r, st) && r.getName().toLowerCase() === "sy")
        && ts.some((t, i) => t === "sy" && ts[i + 1] === "-" && ts[i + 2] === "dbcnt")) {
        throw new Refusal("sy-dbcnt after the read", `${st.concatTokens()} reads sy-dbcnt`);
      }
    }
  }
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

  if (body.length > 1) open.push("prefetch may read keys the loop skips");
  return {
    recipe: body.length === 1 ? "R1" : "R1b",
    ...(body.length === 1 ? {} : {position, before: body.slice(0, position).map((st) => ({text: st.concatTokens()})),
      after: body.slice(position + 1).map((st) => ({text: st.concatTokens()}))}),
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
