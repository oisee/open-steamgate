#!/usr/bin/env node
// Verified lift, the finding half (recipes/; the research note is
// docs/verified-lift.md on the research/verified-lift branch).
//
//   node tools/lift.mjs find <folder>...          database work inside loops, counted
//   node tools/lift.mjs model <file.abap> <method> [--recipe r1|r2] [--ddic <folder>]...
//                                                 the R1/R2 model of that method's loop, or why not
//   node tools/lift.mjs survey <folder> [--ddic <folder>]... [--list]
//                                                 R1/R2 over lookup SELECTs inside loops:
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
const isSelectIntoTablePerRow = (statement) => {
  if (!(statement.get() instanceof Statements.Select)) return false;
  const select = statement.findDirectExpression(Expressions.Select);
  return Boolean(select?.findDirectExpression(Expressions.SQLIntoTable)
    && !select.findDirectExpression(Expressions.SQLForAllEntries));
};

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
  const result = {folder, files: files.length, loops: 0, loops_with_db: 0, loops_with_select_single: 0,
    loops_with_select_into_table: 0, loops_via_own_method: 0};
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
          if (statements.some(isSelectIntoTablePerRow)) {
            result.loops_with_select_into_table++;
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
function keyTypeProven(registry, column, component) {
  if (!sameType(column.type, component)) return false;
  if (!(component instanceof abaplint.BasicTypes.IntegerType)) return true;
  // abaplint represents INT1, INT2 and INT4 with the same type. A data
  // element that resolves to INT4 is the only evidence of equal width.
  const element = [component.getDDICName?.(), component.getQualifiedName?.()]
    .filter((n) => n && !BUILTIN_TYPES.has(n.toUpperCase()))
    .map((n) => registry.getObject("DTEL", n.toUpperCase())).find(Boolean);
  return column.ddic === "INT4" && element?.getDataType(registry)?.toUpperCase() === "INT4";
}
const describe = (type) => `${type.constructor.name.replace(/Type$/, "")}${type.getLength ? `(${type.getLength()})` : ""}`;

// The R1 model of the one loop in `method`, or a Refusal naming the obligation.
export function modelR1(path, method, ddicFolders = DEFAULT_DDIC) {
  return modelR1FromSource(basename(path), readFileSync(path, "utf8"), method, ddicFolders);
}

export function modelR2(path, method, ddicFolders = DEFAULT_DDIC) {
  return modelR2FromSource(basename(path), readFileSync(path, "utf8"), method, ddicFolders);
}

const LOOKUP = "lt_lookup";
const BUILTIN_TYPES = new Set(["B", "S", "I", "INT8", "P", "F", "C", "N", "D", "T", "X", "STRING", "XSTRING",
  "DECFLOAT16", "DECFLOAT34", "UTCLONG"]);
const HIT = "<ls_lookup>";
const ALL_ROWS = "lt_all";
const ALL_ROW = "<ls_all>";
const R2_WORK = "ls_lift_r2";
const SAVED_SUBRC = "lv_lift_saved_subrc";
const SAVED_DBCNT = "lv_lift_saved_dbcnt";
const SAVED_TABIX = "lv_lift_saved_tabix";

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
  const fromSources = from.findAllExpressions(Expressions.SQLFromSource);
  const tables = fromSources[0]?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  if (fromSources.length !== 1 || tables.length !== 1 || fromSources[0].getTokens().length !== 1) throw shape();
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

// Shared parser, method, loop and generated-name context for the R1 and R2
// models. Both recipes make their decisions from the same abaplint tree.
function methodContext(name, source, method, ddicFolders, recipe, allowNestedLoops = false) {
  const registry = registryFor(ddicFolders, [{name, source}]);
  const object = registry.getObjects().find((o) => o instanceof abaplint.ABAPObject
    && o.getABAPFiles().some((f) => f.getFilename() === name));
  const file = object?.getABAPFiles().find((f) => f.getFilename() === name);
  if (!file) throw new Refusal("shape/parse", `${name} does not parse as an ABAP object`);
  if (!file.getStructure()) throw new Refusal("shape/parse", `${name} does not parse: ${file.getStatements().find((st) => st.get() instanceof abaplint.Unknown)?.concatTokens().slice(0, 80) ?? "no structure"}`);
  const m = file.getStructure().findAllStructures(Structures.Method).find((s) => methodName(s) === method.toLowerCase());
  if (!m) throw new Refusal("shape", `no method ${method} in ${name}`);
  const foundLoops = m.findAllStructures(Structures.Loop);
  if (allowNestedLoops) {
    const topLoops = foundLoops.filter((candidate) => !candidate.findParent(Structures.Loop));
    const candidates = topLoops.filter((candidate) => candidate.findAllStatementNodes().some(isSelectIntoTablePerRow));
    if (candidates.length === 1) {
      const targetLoop = candidates[0];
      const targetTable = targetLoop.getFirstStatement().getTokens()[2]?.getStr().toLowerCase();
      for (const candidate of topLoops) {
        if (candidate === targetLoop || !candidate.getFirstToken().getStart().isBefore(targetLoop.getFirstToken().getStart())) continue;
        const tokens = candidate.getFirstStatement().getTokens().map((token) => token.getStr().toLowerCase());
        if (tokens[0] === "loop" && tokens[1] === "at" && tokens[2] === targetTable
          && (tokens.includes("assigning") || (tokens.includes("reference") && tokens.includes("into")))) {
          throw new Refusal("loop table alias", `${candidate.getFirstStatement().concatTokens()} may retain a row alias of ${targetTable} before the selected loop`);
        }
      }
    }
  }
  const loops = allowNestedLoops ? foundLoops.filter((candidate) => !candidate.findParent(Structures.Loop)) : foundLoops;
  if (loops.length !== 1) throw new Refusal("shape/loops", `${loops.length} loops in ${method}, ${recipe} takes one${allowNestedLoops ? " outer" : ""}`);
  const loop = loops[0];
  const {table, row} = loopHead(loop.getFirstStatement());
  const signature = file.getStructure().findAllStatements(Statements.MethodDef)
    .filter((st) => st.findDirectExpression(Expressions.MethodName)?.concatTokens().toLowerCase() === method.toLowerCase());
  const used = new Set([...m.findAllStatementNodes(), ...signature]
    .flatMap((st) => st.getTokens().map((t) => t.getStr().toLowerCase())));
  return {registry, object, file, method: m, signature, loop, table, row, used};
}

function requireNamesFree(used, names, name) {
  for (const generated of names) {
    if (used.has(generated.toLowerCase())) throw new Refusal("names", `${generated} is already used in ${name}; the rewrite would declare it again`);
  }
}

export function modelR1FromSource(name, source, method, ddicFolders = DEFAULT_DDIC) {
  const {registry, object, file, method: m, loop, table, row, used} = methodContext(name, source, method, ddicFolders, "R1");
  // The method sees its own body and its signature; a parameter of that name
  // counts as much as a local declaration.
  requireNamesFree(used, [LOOKUP, HIT], name);

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
    if (!keyTypeProven(registry, column, component)) keysOpen = true;
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

function sourceCorrelation(compare, row) {
  const parts = children(compare);
  if (parts.length !== 5) return undefined;
  const [column, operator, rhs, dash, component] = parts;
  const chain = rhs?.findAllExpressions(Expressions.FieldChain) ?? [];
  const fs = chain[0]?.findAllExpressions(Expressions.FieldSymbol) ?? [];
  if (!(column.get() instanceof Expressions.SQLFieldName)
    || !(operator.get() instanceof Expressions.SQLCompareOperator) || !["=", "eq"].includes(word(operator))
    || !(rhs.get() instanceof Expressions.SQLSource) || chain.length !== 1 || fs.length !== 1
    || word(fs[0]) !== row || chain[0].getTokens().length !== 1
    || rhs.getTokens().filter((t) => word(t) !== "@").length !== 1
    || !(dash.get() instanceof abaplint.Tokens.Dash)
    || !(component.get() instanceof Expressions.SQLFieldName)) return undefined;
  return {column: word(column), component: word(component)};
}

// Conditions kept in the bulk SELECT are only a conjunction of loop-row key
// equalities and simple D-column comparisons with literals. An OR, host value,
// expression, subquery or other dynamic source changes that closed vocabulary.
function r2Conditions(cond, row) {
  const keys = [], constants = [];
  function visit(node) {
    for (const part of children(node)) {
      if (part.get() instanceof Expressions.SQLCompare) {
        const correlation = sourceCorrelation(part, row);
        if (correlation) {
          keys.push(correlation);
          continue;
        }
        const pieces = children(part);
        const [column, operator, rhs] = pieces;
        const literal = rhs?.findAllExpressions(Expressions.Constant) ?? [];
        if (pieces.length === 3 && column?.get() instanceof Expressions.SQLFieldName
          && operator?.get() instanceof Expressions.SQLCompareOperator
          && rhs?.get() instanceof Expressions.SQLSource && literal.length === 1
          && rhs.getTokens().length === literal[0].getTokens().length
          && !(rhs.findAllExpressions(Expressions.FieldChain) ?? []).length) {
          constants.push({column: word(column), text: part.concatTokens()});
          continue;
        }
        throw new Refusal("conditions", `condition "${part.concatTokens()}" is not a correlation equality or a D-field comparison with a constant`);
      }
      if (part.get() instanceof Expressions.SQLCond) {
        visit(part);
      } else if (part.get() instanceof abaplint.Tokens.Identifier && word(part) === "and") {
        continue;
      } else if (["WParenLeftW", "WParenRightW", "ParenRightW"].includes(part.get().constructor.name)) {
        continue;
      } else {
        throw new Refusal("conditions", `condition "${node.concatTokens()}" is not a conjunction of supported comparisons`);
      }
    }
  }
  visit(cond);
  if (!keys.length) throw new Refusal("correlation", "WHERE has no equality from the loop row");
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key.column)) throw new Refusal("correlation", `WHERE correlates ${key.column} more than once`);
    seen.add(key.column);
  }
  return {keys, constants};
}

function structureComponents(type) {
  return type instanceof abaplint.BasicTypes.StructureType
    ? new Map(type.getComponents().map((c) => [c.name.toLowerCase(), c.type])) : undefined;
}

function sourceTextRange(source, startPosition, endPosition, baseIndent = startPosition.getCol() - 1) {
  const starts = [0];
  for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1)) starts.push(at + 1);
  const offset = (position) => starts[position.getRow() - 1] + position.getCol() - 1;
  const text = source.slice(offset(startPosition), offset(endPosition)).trim();
  return text.split("\n").map((line, index) => {
    if (index === 0) return line.startsWith("*") ? `"${line}` : line;
    let leading = 0;
    while (leading < line.length && line[leading] === " ") leading++;
    const content = line.slice(Math.min(baseIndent, leading));
    return `  ${content.startsWith("*") ? `"${content}` : content}`;
  }).join("\n");
}

function isChainedBodyStatement(statements) {
  const owners = new Map();
  for (const statement of statements) {
    for (const token of statement.getTokens()) {
      if (token.getStr() === ":") return statement;
      const owner = owners.get(token);
      if (owner && owner !== statement) return statement;
      owners.set(token, statement);
    }
  }
  return undefined;
}

function methodCall(statement) {
  const tokens = statement.getTokens().map((token) => token.getStr().toLowerCase());
  return statement.findAllExpressions(Expressions.MethodCall).length > 0
    || (tokens[0] === "call" && tokens[1] === "method");
}

function dynamicAssign(tokens) {
  return tokens[0] === "assign" && tokens[1] === "(";
}

function refHash(tokens) {
  return tokens.some((token, i) => token === "ref" && (tokens[i + 1] === "#" || tokens[i + 1] === "#("));
}

function getReferenceOf(tokens) {
  return tokens.some((token, i) => token === "get" && tokens[i + 1] === "reference" && tokens[i + 2] === "of");
}

function referencesRowOrTable(tokens, row, table) {
  return (tokens.includes(row) || tokens.includes(table)) && (refHash(tokens) || getReferenceOf(tokens));
}

function tableType(scope, name, obligation) {
  const type = scope?.findVariable(name)?.getType();
  if (!(type instanceof abaplint.BasicTypes.TableType) || type.isGeneric?.() || type.isWithHeader?.()) {
    throw new Refusal(obligation, `${name} is not a resolved table without a header line`);
  }
  return type;
}

// R2: gather one row per database key across T, then rebuild the original
// INTO TABLE target at the SELECT's position. The generated body preserves
// the old result table and its statement order while keeping the bulk query
// outside the row loop.
export function modelR2FromSource(name, source, method, ddicFolders = DEFAULT_DDIC) {
  const {registry, object, method: m, signature, loop, table, row, used} = methodContext(name, source, method, ddicFolders, "R2", true);
  requireNamesFree(used, [ALL_ROWS, ALL_ROW, R2_WORK, SAVED_SUBRC, SAVED_DBCNT, SAVED_TABIX], name);
  const items = children(loop.findDirectStructure(Structures.Body));
  const bodyStatements = items.flatMap((item) => item.findAllStatementNodes());
  const chain = isChainedBodyStatement(bodyStatements);
  if (chain) throw new Refusal("chain/body", `the loop body contains an ABAP chain: ${chain.concatTokens()}`);
  const selects = bodyStatements.filter((st) => st.get() instanceof Statements.Select);
  if (selects.length !== 1) throw new Refusal("shape/select", `the loop body has ${selects.length} SELECT statements; R2 takes one`);
  const selectStatement = selects[0];
  if (bodyStatements.some((st) => isDb(st) && st !== selectStatement)) {
    throw new Refusal("no other database statement in the loop", "the loop body has a database statement besides its SELECT INTO TABLE");
  }
  const position = items.findIndex((item) => item.findAllStatementNodes().includes(selectStatement));
  if (position < 0 || items[position].getFirstStatement() !== selectStatement
    || items[position].findAllStatementNodes().length !== 1) {
    throw new Refusal("shape/select-position", "SELECT INTO TABLE must be a top-level statement of the loop body");
  }
  const select = selectStatement.findDirectExpression(Expressions.Select);
  const fieldsNode = select?.findDirectExpression(Expressions.SQLFieldList);
  const from = select?.findDirectExpression(Expressions.SQLFrom);
  const into = select?.findDirectExpression(Expressions.SQLIntoTable);
  const cond = select?.findDirectExpression(Expressions.SQLCond);
  const order = select?.findDirectExpression(Expressions.SQLOrderBy);
  const shape = () => new Refusal("shape/select", `not SELECT columns FROM one table INTO TABLE lt_x WHERE ... ORDER BY PRIMARY KEY: ${selectStatement.concatTokens()}`);
  if (!select || !fieldsNode || !from || !into || !cond || word(select.getTokens()[1]) === "single") throw shape();
  // No JOIN, alias, aggregate, DISTINCT, limit, GROUP BY or other clause is
  // represented in the model. The order check is deliberately exact.
  if (!order || order.getTokens().map(word).join(" ") !== "order by primary key") {
    throw new Refusal("order", "R2 requires ORDER BY PRIMARY KEY so each row's result order can be restored");
  }
  const clauses = children(select);
  const known = new Set([fieldsNode, from, into, cond, order]);
  const extras = clauses.filter((part) => !known.has(part)
    && !(part.get() instanceof abaplint.Tokens.Identifier && ["select", "where"].includes(word(part))));
  if (extras.length) throw shape();
  const fromSources = from.findAllExpressions(Expressions.SQLFromSource);
  const tables = fromSources[0]?.findAllExpressions(Expressions.DatabaseTable) ?? [];
  if (fromSources.length !== 1 || tables.length !== 1 || fromSources[0].getTokens().length !== 1) throw shape();
  const dbtab = word(tables[0]);
  const selectFields = fieldsNode.findAllExpressions(Expressions.SQLField);
  if (!selectFields.length || selectFields.some((f) => direct(f, Expressions.SQLFieldName).length !== 1 || f.getTokens().length !== 1)) {
    throw new Refusal("shape/select", "the SELECT list must contain simple database columns only");
  }
  const columns = selectFields.map((f) => word(direct(f, Expressions.SQLFieldName)[0]));
  if (new Set(columns).size !== columns.length) throw new Refusal("shape/select", "the SELECT list repeats a column");
  const targets = direct(into, Expressions.SQLTarget);
  const intoExtra = children(into).find((child) => !(child.get() instanceof Expressions.SQLTarget)
    && !["into", "table"].includes(word(child)));
  if (targets.length !== 1 || intoExtra || targets[0].getTokens().length !== 1
    || !targets[0].findDirectExpression(Expressions.Target)?.findDirectExpression(Expressions.TargetField)) throw shape();
  const resultTable = word(targets[0].findDirectExpression(Expressions.Target)?.findDirectExpression(Expressions.TargetField));
  const {keys, constants} = r2Conditions(cond, row);
  const resolved = abapKeyModel(registry, dbtab);
  if (!resolved) throw new Refusal("full key", `no provider knows ${dbtab} (DDIC from ${ddicFolders.join(", ")})`);
  const primary = resolved.keys;
  const primaryNames = primary.map((k) => k.column);
  for (const key of keys) {
    if (!primaryNames.includes(key.column)) throw new Refusal("correlation", `${key.column} is not a key field of ${dbtab}`);
  }
  const tableObject = registry.getObject("TABL", dbtab.toUpperCase());
  const dbType = tableObject?.parseType(registry);
  const dbFields = structureComponents(dbType);
  if (!dbFields) throw new Refusal("full key", `${dbtab} does not resolve to a table structure`);
  for (const condition of constants) {
    if (!dbFields.has(condition.column)) throw new Refusal("conditions", `${dbtab} has no field ${condition.column}`);
  }
  const projected = columns.map((column, i) => ({column, component: i}));
  const sourceColumns = [...new Set([...primaryNames, ...columns])];
  const keyList = keys.map((key) => ({...key}));
  const keyTypes = new Map(primary.map((key) => [key.column, key]));

  const syntax = new abaplint.SyntaxLogic(registry, object).run();
  const scope = syntax.spaghetti.lookupPosition(selectStatement.getStart(), name);
  const preLoopStatements = m.findAllStatementNodes().filter((st) => st.getStart().isBefore(loop.getFirstToken().getStart()));
  const tableVariable = scope?.findVariable(table);
  const bodyWritePositions = syntax.spaghetti.listWritePositions(name);
  const inStatement = (ref, st) => !ref.getStart().isBefore(st.getStart()) && !ref.getStart().isAfter(st.getEnd());
  for (const st of preLoopStatements) {
    const tokens = st.getTokens().map((token) => token.getStr().toLowerCase());
    if (dynamicAssign(tokens)) {
      throw new Refusal("dynamic ASSIGN", `${st.concatTokens()} uses a dynamic ASSIGN before the loop`);
    }
    const namesTableWithAliasOperation = tokens.includes(table) && (
      tokens.includes("assigning")
      || tokens.includes("assign")
      || (tokens.includes("reference") && tokens.includes("into"))
      || refHash(tokens)
      || getReferenceOf(tokens));
    if (namesTableWithAliasOperation) {
      throw new Refusal("loop table alias", `${st.concatTokens()} may retain a row alias of ${table} before the loop`);
    }
  }
  const formalByReferenceTable = signature.some((st) => {
    const tokens = st.getTokens().map((token) => token.getStr().toLowerCase());
    const at = tokens.indexOf(table);
    if (at < 0 || tokens[at - 2] === "value" || tokens[at - 1] === "value") return false;
    const direction = tokens.slice(0, at).reverse().find((token) => ["importing", "changing", "exporting", "returning"].includes(token));
    return direction === "importing" || direction === "changing";
  });
  if ((tableVariable?.constructor?.name !== "TypedIdentifier" || formalByReferenceTable) && bodyStatements.some(methodCall)) {
    const call = bodyStatements.find(methodCall);
    throw new Refusal("loop table method call", `${call.concatTokens()} may change nonlocal loop table ${table}`);
  }
  for (const st of bodyStatements) {
    const tokens = st.getTokens().map((token) => token.getStr().toLowerCase());
    if (dynamicAssign(tokens)) {
      throw new Refusal("dynamic ASSIGN", `${st.concatTokens()} uses a dynamic ASSIGN in the loop body`);
    }
    if (referencesRowOrTable(tokens, row, table)) {
      throw new Refusal("loop row reference", `${st.concatTokens()} may retain a reference to ${row} or ${table}`);
    }
    if (tokens.includes("->") && bodyWritePositions.some((ref) => inStatement(ref, st))) {
      throw new Refusal("dereference write", `${st.concatTokens()} writes through a dereference`);
    }
    for (const ref of bodyWritePositions.filter((candidate) => inStatement(candidate, st)
      && candidate.getName().startsWith("<") && candidate.getName().toLowerCase() !== row)) {
      throw new Refusal("field-symbol write", `${st.concatTokens()} writes through field symbol ${ref.getName()}`);
    }
  }
  const loopType = tableType(scope, table, "shape/loop-table");
  const lineType = loopType.getRowType();
  const line = structureComponents(lineType);
  const symbolType = scope?.findVariable(row)?.getType();
  const symbol = structureComponents(symbolType);
  if (!line || !symbol || symbolType.isGeneric?.()) {
    throw new Refusal("shape/row", `${row} and ${table} must resolve to structured rows`);
  }
  const lineEntries = [...line.keys()], symbolEntries = [...symbol.keys()];
  if (lineEntries.length !== symbolEntries.length || lineEntries.some((component, i) => component !== symbolEntries[i])) {
    throw new Refusal("shape/row", `${row} is not laid out like a line of ${table}: ${symbolEntries.join(", ")} against ${lineEntries.join(", ")}`);
  }
  for (const [component, type] of line) {
    const own = symbol.get(component);
    if (unresolved(type) || unresolved(own) || !sameType(type, own)) {
      throw new Refusal("shape/row", `${row}-${component} does not resolve to the same type as ${table}-${component}`);
    }
  }
  for (const key of keyList) {
    const keyColumn = keyTypes.get(key.column);
    const component = line.get(key.component), rowComponent = symbol.get(key.component);
    if (!component || !rowComponent) throw new Refusal("key types", `${table} or ${row} has no component ${key.component}`);
    if (unresolved(component) || !keyTypeProven(registry, keyColumn, component)) {
      throw new Refusal("key types", `${table}-${key.component} cannot be proven to match ${dbtab}-${key.column}`);
    }
  }

  const targetType = tableType(scope, resultTable, "shape/result-table");
  if (targetType.getAccessType() !== "STANDARD") {
    throw new Refusal("shape/result-table", `${resultTable} must be a standard table so APPEND preserves SELECT order`);
  }
  const resultLine = targetType.getRowType();
  const resultFields = structureComponents(resultLine);
  if (!resultFields || resultFields.size !== columns.length) {
    throw new Refusal("shape/result-table", `${resultTable} must have a structured line with one component per selected column`);
  }
  const resultComponents = [...resultFields.keys()];
  const assignments = columns.map((column, i) => {
    const dbField = dbFields.get(column), targetComponent = resultComponents[i], targetField = resultFields.get(targetComponent);
    if (!dbField || unresolved(dbField) || unresolved(targetField) || !sameType(dbField, targetField)) {
      throw new Refusal("shape/result-types", `${resultTable}-${targetComponent} must resolve to the same type as ${dbtab}-${column}`);
    }
    return {column, component: targetComponent};
  });
  for (const key of keys) {
    const component = line.get(key.component), symbolComponent = symbol.get(key.component);
    if (!component || !symbolComponent) throw new Refusal("key types", `${row} has no component ${key.component}`);
    if (!sameType(component, symbolComponent)) throw new Refusal("key types", `${row}-${key.component} and ${table}-${key.component} differ`);
  }

  const reads = syntax.spaghetti.listReadPositions(name).filter((ref) => ref.getName().toLowerCase() === resultTable);
  const writes = syntax.spaghetti.listWritePositions(name).filter((ref) => ref.getName().toLowerCase() === resultTable);
  const insideLoop = (ref) => !ref.getStart().isBefore(loop.getFirstToken().getStart())
    && !ref.getStart().isAfter(loop.getLastToken().getStart());
  if (writes.some((ref) => insideLoop(ref) && !inStatement(ref, selectStatement))) {
    throw new Refusal("result written only by SELECT", `${resultTable} is written by a loop statement besides the SELECT`);
  }
  const afterStatements = items.slice(position + 1).flatMap((item) => item.findAllStatementNodes());
  if (!reads.some((ref) => afterStatements.some((st) => inStatement(ref, st)))) {
    throw new Refusal("result read after SELECT", `${resultTable} is not read after the SELECT inside the iteration`);
  }
  if (reads.some((ref) => ref.getStart().isAfter(loop.getLastToken().getStart())
    && ref.getStart().isBefore(m.getLastToken().getStart()))) {
    throw new Refusal("result read after loop", `${resultTable} is read after the loop`);
  }
  for (const [index, item] of items.entries()) {
    if (index === position) continue;
    for (const st of item.findAllStatementNodes()) {
      const tokens = st.getTokens().map((t) => t.getStr().toLowerCase());
      if (tokens.includes(table)) throw new Refusal("key not written before the read", `${st.concatTokens()} touches loop table ${table} outside the SELECT`);
      if (index < position && st.get() instanceof Statements.Assign && tokens.includes(row)) {
        throw new Refusal("key not written before the read", `${st.concatTokens()} may alias ${row} before the SELECT`);
      }
      if (index >= position) continue;
      const rowRefs = syntax.spaghetti.listWritePositions(name).filter((ref) => inStatement(ref, st) && ref.getName().toLowerCase() === row);
      for (const ref of rowRefs) {
        const at = st.getTokens().indexOf(ref.getToken());
        const component = tokens[at + 1] === "-" ? tokens[at + 2] : undefined;
        if (!component || keys.some((key) => key.component === component)) {
          throw new Refusal("key not written before the read", `${st.concatTokens()} writes ${row}${component ? `-${component}` : ""}`);
        }
      }
      if (st.findAllExpressions(Expressions.MethodCall).length && tokens.includes(row)) {
        throw new Refusal("key not written before the read", `${st.concatTokens()} passes ${row} to a method`);
      }
    }
  }

  const before = position === 0 ? [] : [{text: sourceTextRange(source, items[0].getFirstToken().getStart(),
    selectStatement.getFirstToken().getStart(), items[0].getFirstToken().getStart().getCol() - 1)}];
  const after = position === items.length - 1 ? [] : [{text: sourceTextRange(source, selectStatement.getLastToken().getEnd(),
    items[items.length - 1].getLastToken().getEnd(), items[position + 1].getFirstToken().getStart().getCol() - 1)}];
  const sort = [...keys.map((key) => key.column), ...primaryNames].filter((column, i, all) => all.indexOf(column) === i);
  return {
    recipe: "R2",
    position,
    before,
    after,
    loop: {table: table.toLowerCase(), row: row.toLowerCase()},
    source: {table: dbtab, keys: keyList, primary: primary.map((key) => ({column: key.column})),
      fields: sourceColumns.map((column) => ({column})), conditions: constants,
      sort: sort.map((column) => ({column}))},
    result: {table: resultTable, assignments},
    names: {all: ALL_ROWS, all_row: ALL_ROW, work: R2_WORK, saved_subrc: SAVED_SUBRC, saved_dbcnt: SAVED_DBCNT, saved_tabix: SAVED_TABIX},
    order: "ORDER BY PRIMARY KEY",
    open: ["no concurrent writes to the database table during the loop",
      "reads confined to one client", "prefetch may read keys whose loop iteration skips the SELECT"],
  };
}

// Every method of every class in `folder` whose loop holds an R1 or R2 lookup,
// put through the corresponding model: what it accepts and what stops the rest.
export function survey(folder, ddicFolders = DEFAULT_DDIC) {
  const result = {folder, candidates: 0, accepted: 0, refused: {}, cases: []};
  for (const path of walk(folder, /\.clas\.abap$/)) {
    const source = readFileSync(path, "utf8");
    const [file] = parseSources([{name: basename(path), source}]);
    for (const method of file?.getStructure()?.findAllStructures(Structures.Method) ?? []) {
      const selects = loopsOf(method).flatMap((l) => l.findAllStatementNodes()
        .filter((st) => st.get() instanceof Statements.Select));
      const candidate = selects.find(isSelectIntoTablePerRow)
        ?? selects.find((st) => /^SELECT SINGLE /i.test(st.concatTokens()));
      if (!candidate) continue;
      const recipe = candidate.findDirectExpression(Expressions.Select)?.findDirectExpression(Expressions.SQLIntoTable) ? "R2" : "R1";
      result.candidates++;
      const where = `${basename(path)}:${methodName(method)}`;
      try {
        if (recipe === "R2") modelR2FromSource(basename(path), source, methodName(method), ddicFolders);
        else modelR1FromSource(basename(path), source, methodName(method), ddicFolders);
        result.accepted++;
        result.cases.push({where, recipe, accepted: true});
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        result.refused[e.obligation] = (result.refused[e.obligation] ?? 0) + 1;
        result.cases.push({where, recipe, refused: e.message});
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
    let recipe = "r1";
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--ddic") ddic.push(args[++i]);
      else if (args[i] === "--recipe") recipe = (args[++i] ?? "").toLowerCase();
      else rest.push(args[i]);
    }
    try {
      if (!["r1", "r2"].includes(recipe)) throw new Refusal("recipe", `unknown recipe ${recipe}`);
      const model = recipe === "r2" ? modelR2 : modelR1;
      console.log(JSON.stringify(model(rest[0], rest[1], ddic.length ? ddic : DEFAULT_DDIC), null, 2));
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      console.error(`${recipe.toUpperCase()} refused -- ${e.message}`);
      process.exit(1);
    }
  } else {
    console.error("usage: node tools/lift.mjs find <folder>... | model <file.abap> <method> [--recipe r1|r2] [--ddic <folder>]... | survey <folder> [--ddic <folder>]... [--list]");
    process.exit(2);
  }
}
