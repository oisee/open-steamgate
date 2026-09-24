// The imperative half of portable SQLScript.
//
// Control flow stays in the host; every table value stays a relational plan
// and is executed by the selected database. This module deliberately starts
// with constructors and an interpreter independent of the parser: the first
// tests pin the semantics of immutable relation rebinding and scalar capture
// before a syntax tree is allowed to produce these nodes.
import {effects, schemaOf, col, cast, project, filter, bin, lit, limit, scan, order, refTo, T} from "./sqlscript-ir.mjs";
import {lower, Refused} from "./sqlscript-lower.mjs";
import {childBodies, containsRelationStatement, readsRelations, containsWrite} from "./sqlscript-blocks.mjs";
import {columnType} from "./ir-host-relation.mjs";

/** a snapshot's column type: the host relation's, and on SQLite a CHAR
 *  compared as the transpiler's schema compares it, blanks at the end ignored */
const snapshotColumnType = (type, dialect) => {
  const base = columnType(type, dialect);
  if (base === undefined) return undefined;
  return dialect === "sqlite" && ["C", "D"].includes(type?.abap) ? `${base} COLLATE RTRIM` : base;
};
export {childBodies};
import {packedText, WriteError} from "./ir-writes.mjs";

export class UnsupportedSqlScript extends Error {
  constructor(message, node) {
    super(message);
    this.code = "UNSUPPORTED_SQLSCRIPT";
    this.line = node?.source?.line ?? node?.line;
    this.col = node?.source?.col ?? node?.col;
  }
}

const upper = (name) => String(name).toUpperCase();

export const procedure = ({parameters = [], relationParameters = [], body = [], output, outputSchema, outputType,
  outputs, outputInitialWhenUnassigned, catalogue = {}}) =>
  ({ir: "sqlscript-procedure", parameters, relationParameters, body, output: upper(output), outputSchema, outputType,
    ...(Array.isArray(outputs) ? {outputs: outputs.map((one) => (one.scalar !== undefined
      ? {name: upper(one.name), scalar: one.scalar} : {name: upper(one.name), schema: one.schema}))} : {}),
    ...(outputInitialWhenUnassigned === true ? {outputInitialWhenUnassigned: true} : {}),
    catalogue});
export const declareScalar = (name, type, initial, source) =>
  ({stmt: "declare-scalar", name: upper(name), type, initial, source});
export const assignScalar = (name, expr, source) =>
  ({stmt: "assign-scalar", name: upper(name), expr, source});
export const assignRelation = (name, rel, source) =>
  ({stmt: "assign-relation", name: upper(name), rel, source});
/** a write to a database table: a tools/ir-writes.mjs node */
export const writeTable = (write, source) => ({stmt: "write", write, source});
export const whileLoop = (condition, body, source) =>
  ({stmt: "while", condition, body, source});
/** `FOR row AS cursor DO body END FOR`: the cursor's relation, its row
 *  schema, and the order its rows are known to come in (orderOf) */
export const forCursor = (row, cursorName, cursor, schema, body, order, source) =>
  ({stmt: "for-cursor", row, cursorName, cursor, schema, body, order, source});
/** `FOR i IN [REVERSE] from .. to DO body END FOR` over a declared integer */
export const forRange = (variable, from, to, reverse, body, source) =>
  ({stmt: "for-range", variable, from, to, reverse, body, source});
export const ifElse = (branches, otherwise = [], source) =>
  ({stmt: "if", branches, otherwise, source});
// `SELECT ... INTO a, b [DEFAULT x, y]`: the relation, the scalars it
// fills in column order, and the DEFAULT values for the no-row case
export const selectInto = (rel, targets, defaults, source) =>
  ({stmt: "select-into", rel, targets: targets.map(upper), ...(defaults === undefined ? {} : {defaults}), source});
/** what HANA raises for SELECT ... INTO with no row (and no DEFAULT) or more than one */
export class SelectIntoRows extends Error {}
export const callProcedure = (name, input, output, source) =>
  ({stmt: "call-procedure", procedure: upper(name), input: upper(input), output: upper(output), source});

function integer(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
    throw new UnsupportedSqlScript(`${name} is outside SQLScript INTEGER`);
  }
  return n;
}

/** what an assignment may put into a declared variable (measured on A4H) */
export function assignable(from, to) {
  const text = (t) => ["C", "STRING"].includes(t?.abap);
  const whole = (t) => ["I", "INT8"].includes(t?.abap);
  if (JSON.stringify(from) === JSON.stringify(to)) return true;
  if (text(to)) return text(from) || whole(from);
  if (whole(to)) return whole(from) && (to.bits === undefined || JSON.stringify(from) === JSON.stringify(to));
  return false;
}

/** what the database raises when a text is longer than the variable (A4H) */
export class ScalarTooLong extends Error {}

/**
 * A value into a declared variable, as SQLScript does it on A4H: a text is
 * kept as it is -- trailing blanks too, never padded -- and one longer than a
 * declared length raises; a number into a text becomes its digits; a BIGINT
 * into an INTEGER is range-checked; NULL stays NULL.
 */
function intoVariable(value, fromType, type, name) {
  if (value == null) return null;
  if (type?.abap === "C" || type?.abap === "STRING") {
    const text = typeof value === "string" ? value : String(value);
    // a character outside the BMP raised on A4H even with room to spare
    // (NVARCHAR(10), two of them), and JavaScript counts it as two: refused
    if (/[\uD800-\uDFFF]/.test(text)) {
      throw new UnsupportedSqlScript(`${name}: a character outside the Basic Multilingual Plane is not carried (HANA raised on it, measured)`);
    }
    if (type.abap === "C" && Number.isInteger(type.len) && text.length > type.len) {
      throw new ScalarTooLong(`${name}: ${JSON.stringify(text)} is longer than its ${type.len} characters; HANA raises CX_AMDP_EXECUTION_FAILED here`);
    }
    return text;
  }
  if (type?.abap === "INT8") {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new UnsupportedSqlScript(`${name}: ${value} is outside the BIGINT range carried here`);
    return n;
  }
  return scalarForType(value, type, name);
}

/** ABAP's initial value of a scalar output type */
function initialOf(type) {
  if (type?.abap === "I" || type?.abap === "INT8") return 0;
  return "";
}

/**
 * A scalar into an ABAP output (measured on A4H): a fixed-length character
 * output takes the value without its trailing blanks and raises when it is
 * longer than the field; a STRING keeps it as it is.
 */
function intoOutput(value, type, name) {
  // NULL into a scalar output is its initial value: 0 for i, '' for string
  // and c LENGTH 3, alone or beside others, OUT or RETURNING (measured on A4H)
  if (value == null) return initialOf(type);
  if (type?.abap === "C") {
    const text = String(value).replace(/ +$/, "");
    // a guard, not the rule: the body's variable of this type was assigned
    // through intoVariable, which raises first
    if (Number.isInteger(type.len) && text.length > type.len) {
      throw new ScalarTooLong(`output ${name}: ${JSON.stringify(text)} is longer than its ${type.len} characters; HANA raises CX_AMDP_EXECUTION_FAILED here`);
    }
    return text;
  }
  if (type?.abap === "STRING") return String(value);
  return scalarForType(value, type, name);
}

function scalarForType(value, type, name) {
  // SQL NULL stays SQL NULL. Number(null) is 0 in JavaScript, which is a
  // particularly dangerous accidental answer for an INTEGER parameter.
  if (value == null) return null;
  if (type?.abap === "I") return integer(value, name);
  // a packed input given as text binds as that text (abap-types bindValue),
  // so it must be the decimal string of its type: '1.5E3' or '12.50 ' would
  // otherwise reach the engine as they are (the #55 critic)
  if (type?.abap === "P" && typeof value === "string") {
    try { return packedText(value, type, name); }
    catch (error) {
      if (error instanceof WriteError) throw new UnsupportedSqlScript(error.message);
      throw error;
    }
  }
  if (type?.abap === "STRING" && typeof value !== "string") {
    throw new UnsupportedSqlScript(`${name} is not a SQLScript string`);
  }

  if (type?.abap === "BOOL" && typeof value !== "boolean") {
    throw new UnsupportedSqlScript(`${name} is not a SQLScript boolean`);
  }
  return value;
}

/** What the kernel binds for a fixed-length character INPUT, measured on
 *  A4H: trailing blanks removed, a leading blank kept, initial as ''
 *  (docs/sqlscript-hana-observed.md). Only at the input boundary: a scalar
 *  the body declares is an NVARCHAR, and HANA keeps its blanks. Today the
 *  host evaluates INTEGER scalars only, so no character value is ever built
 *  inside a program; when string scalars arrive, the trim must stay here and
 *  not move into scalarForType, and that is the test to write with them.
 *  A value longer than the field is not one ABAP could have passed: refused,
 *  not cut. */
// INT2 on A4H: -32768 .. 32767 in and out; outside it the kernel raises
// CX_AMDP_EXECUTION_FAILED at the output boundary rather than wrapping, and
// an ABAP int2 input can never be outside it, so a JavaScript caller's value
// that is, is refused the same way
const isInt2 = (type) => type?.abap === "I" && type.bits === 16;
export class Int2OutOfRange extends Error {}
function inInt2Range(value, where) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < -32768 || n > 32767) {
    throw new Int2OutOfRange(`${where}: ${value} is outside INT2 (-32768..32767); HANA raises CX_AMDP_EXECUTION_FAILED here`);
  }
}

function boundCharacter(value, type, name) {
  if (value == null) return null;
  if (typeof value !== "string") throw new UnsupportedSqlScript(`${name} is not a character value`);
  const trimmed = value.replace(/ +$/, "");
  if (trimmed.length > type.len) throw new UnsupportedSqlScript(`${name} is longer than its ${type.len} characters`);
  return trimmed;
}

/** A fixed RAW input, measured on A4H: always its n bytes, initial as n zero
 *  bytes, compared byte-wise. The ABAP database seam holds RAW as canonical
 *  upper-case hex text, so that is the bound form: a shorter value is padded
 *  with zero bytes on the right (as ABAP pads x), a longer one or one that
 *  is not hex is refused. */
function boundBytes(value, type, name) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^([0-9A-Fa-f]{2})*$/.test(value)) {
    throw new UnsupportedSqlScript(`${name} is not a RAW value as hex text`);
  }
  if (value.length > type.len * 2) throw new UnsupportedSqlScript(`${name} is longer than its ${type.len} bytes`);
  return value.toUpperCase().padEnd(type.len * 2, "0");
}

/** A date or time input, measured on A4H: always its 8 / 6 digits, the
 *  initial value as zeros ('00000000', '000000'), never ''. An empty or
 *  blank value from the caller is the initial value; anything that is not
 *  that many digits is refused rather than passed as a date. */
function boundDateTime(value, kind, name) {
  if (value == null) return null;
  if (typeof value !== "string") throw new UnsupportedSqlScript(`${name} is not a ${kind === "DATS" ? "date" : "time"} value`);
  const width = kind === "DATS" ? 8 : 6;
  const trimmed = value.trim();
  if (trimmed === "") return "0".repeat(width);
  if (!new RegExp(`^\\d{${width}}$`).test(trimmed)) {
    throw new UnsupportedSqlScript(`${name} is not ${width} digits, so not a ${kind === "DATS" ? "date" : "time"}`);
  }
  return trimmed;
}

function booleanOrNull(value, context) {
  if (value == null || typeof value === "boolean") return value;
  throw new UnsupportedSqlScript(`${context} requires a boolean or NULL`);
}

function sqlAnd(a, b) {
  booleanOrNull(a, "AND left operand");
  booleanOrNull(b, "AND right operand");
  if (a === false || b === false) return false;
  if (a == null || b == null) return null;
  return true;
}

function sqlOr(a, b) {
  booleanOrNull(a, "OR left operand");
  booleanOrNull(b, "OR right operand");
  if (a === true || b === true) return true;
  if (a == null || b == null) return null;
  return false;
}

/** Evaluate the deliberately small scalar subset owned by P1. */
export function evaluateScalar(expr, scalars) {
  if (expr === undefined || expr === null) throw new UnsupportedSqlScript("missing scalar expression");
  if (expr.node === "lit") return expr.value;
  if (expr.node === "param") {
    const name = upper(expr.name);
    if (!scalars.has(name)) throw new UnsupportedSqlScript(`unknown scalar :${name.toLowerCase()}`, expr);
    return scalars.get(name).value;
  }
  if (expr.node === "isnull") return evaluateScalar(expr.expr, scalars) == null;
  if (expr.node === "not") {
    const value = booleanOrNull(evaluateScalar(expr.expr, scalars), "NOT operand");
    return value == null ? null : !value;
  }
  if (expr.node === "call" && expr.fn === "COALESCE") {
    if (expr.window !== undefined || (expr.orderBy ?? []).length > 0 || expr.star === true) {
      throw new UnsupportedSqlScript("scalar COALESCE does not accept window, ordering, or star decorations", expr);
    }
    if (expr.args.length !== 2) throw new UnsupportedSqlScript("scalar COALESCE currently requires exactly two arguments", expr);
    const first = evaluateScalar(expr.args[0], scalars);
    return first == null ? evaluateScalar(expr.args[1], scalars) : first;
  }
  if (expr.node === "call" && (expr.fn === "UPPER" || expr.fn === "LOWER") && (expr.args ?? []).length === 1) {
    const value = evaluateScalar(expr.args[0], scalars);
    if (value == null) return null;
    // one character in, one out, as on A4H: UPPER('äö') is 'ÄÖ', and
    // UPPER('straße') keeps its ß (length 6) where JavaScript would write SS
    return [...String(value)].map((ch) => {
      const mapped = expr.fn === "UPPER" ? ch.toUpperCase() : ch.toLowerCase();
      return [...mapped].length === 1 ? mapped : ch;
    }).join("");
  }
  if (expr.node !== "bin") throw new UnsupportedSqlScript(`scalar ${expr.node} is not supported yet`, expr);
  const left = evaluateScalar(expr.left, scalars);
  const right = evaluateScalar(expr.right, scalars);
  if (expr.op === "AND") return sqlAnd(left, right);
  if (expr.op === "OR") return sqlOr(left, right);
  if (["=", "<>", "!=", "<", ">", "<=", ">="].includes(expr.op)) {
    if (left == null || right == null) return null;
    if (expr.op === "=") return left === right;
    if (expr.op === "<>" || expr.op === "!=") return left !== right;
    if (expr.op === "<") return left < right;
    if (expr.op === ">") return left > right;
    if (expr.op === "<=") return left <= right;
    return left >= right;
  }
  if (left == null || right == null) return null;
  if (expr.op === "||") return String(left) + String(right);
  if (expr.op === "+") return integer(integer(left, "left operand") + integer(right, "right operand"), "sum");
  if (expr.op === "-") return integer(integer(left, "left operand") - integer(right, "right operand"), "difference");
  if (expr.op === "*") return integer(integer(left, "left operand") * integer(right, "right operand"), "product");
  throw new UnsupportedSqlScript(`scalar operator ${expr.op} is not supported yet`, expr);
}

function assertPortableHostExpression(expr, context, scalars) {
  if (expr == null) return;
  if (expr.node === "param") {
    const declared = scalars.get(upper(expr.name));
    if (declared === undefined) throw new UnsupportedSqlScript(`unknown scalar :${upper(expr.name).toLowerCase()}`, expr);
    if (JSON.stringify(expr.type) !== JSON.stringify(declared.type)) {
      throw new UnsupportedSqlScript(`${context} parameter :${upper(expr.name).toLowerCase()} changes its measured type`, expr);
    }
  }
  for (const key of ["left", "right", "expr", "pattern", "escape", "otherwise"]) {
    assertPortableHostExpression(expr[key], context, scalars);
  }
  for (const item of expr.args ?? []) assertPortableHostExpression(item, context, scalars);
  for (const item of expr.values ?? []) assertPortableHostExpression(item, context, scalars);
  for (const item of expr.whens ?? []) {
    assertPortableHostExpression(item.when, context, scalars);
    assertPortableHostExpression(item.then, context, scalars);
  }
}

function freezeExpr(expr, scalars, freezeRel, session) {
  if (expr === undefined || expr === null) return expr;
  if (expr.node === "param") {
    const name = upper(expr.name);
    const scalar = scalars.get(name);
    if (scalar === undefined) throw new UnsupportedSqlScript(`unknown scalar :${name.toLowerCase()}`, expr);
    return {...expr, type: scalar.type ?? expr.type, value: scalar.value, isNull: scalar.value == null};
  }
  if (expr.node === "session") {
    if (!["user", "schema", "context"].includes(expr.kind)
        || typeof expr.name !== "string" || expr.name.length === 0) {
      throw new UnsupportedSqlScript("SQLScript session node has an unknown kind or name");
    }
    if (expr.type?.abap !== "STRING" || Object.keys(expr.type).length !== 1) {
      throw new UnsupportedSqlScript(`SQLScript session ${expr.kind} ${expr.name} must have the measured STRING type`);
    }
    let present = false;
    let value;
    if (expr.kind === "user") {
      present = Object.hasOwn(session, "currentUser");
      value = session.currentUser;
    } else if (expr.kind === "schema") {
      present = Object.hasOwn(session, "currentSchema");
      value = session.currentSchema;
    } else if (expr.kind === "context") {
      present = Object.hasOwn(session.values ?? {}, expr.name);
      value = session.values?.[expr.name];
    }
    if (!present) throw new UnsupportedSqlScript(`missing explicit SQLScript session ${expr.kind} ${expr.name}`);
    if (value !== null && typeof value !== "string") {
      throw new UnsupportedSqlScript(`SQLScript session ${expr.kind} ${expr.name} must be a string or NULL`);
    }
    if (expr.kind !== "context" && value === null) {
      throw new UnsupportedSqlScript(`SQLScript session ${expr.kind} ${expr.name} cannot be NULL`);
    }
    return {node: "param", name: `SESSION_${expr.kind.toUpperCase()}_${expr.name}`,
      type: expr.type, value, isNull: value == null};
  }
  const copy = {...expr};
  for (const key of ["left", "right", "expr", "pattern", "escape", "otherwise"]) {
    if (copy[key] !== undefined) copy[key] = freezeExpr(copy[key], scalars, freezeRel, session);
  }
  for (const key of ["args", "values"]) {
    if (copy[key] !== undefined) copy[key] = copy[key].map((one) => freezeExpr(one, scalars, freezeRel, session));
  }
  if (copy.whens !== undefined) {
    copy.whens = copy.whens.map((one) => ({
      when: freezeExpr(one.when, scalars, freezeRel, session),
      then: freezeExpr(one.then, scalars, freezeRel, session),
    }));
  }
  if (copy.window !== undefined) {
    copy.window = {
      ...copy.window,
      partitionBy: (copy.window.partitionBy ?? []).map((one) => freezeExpr(one, scalars, freezeRel, session)),
      orderBy: (copy.window.orderBy ?? []).map((one) => one.expr === undefined ? one : ({
        ...one, expr: freezeExpr(one.expr, scalars, freezeRel, session),
      })),
    };
  }
  if (copy.node === "sub") copy.rel = freezeRel(copy.rel);
  return copy;
}

/** Resolve table variables and capture every scalar value now.
 *
 * This is the semantic centre of table rebinding. The complete right-hand
 * plan is frozen before the caller replaces the name on the left, so
 * `t = SELECT ... FROM :t` points at the previous version and a loop's
 * `:i` points at that iteration's value.
 */
/**
 * A frozen cursor relation rewritten so the order its rows are known to come
 * in is an ORDER BY at the top: the keys of an ORDER BY, carried as hidden
 * columns through the projections above it, or the position of each row of
 * a table given as rows (a caller's table input), numbered. Undefined when
 * no such order is known -- the compiler refused those, and a table input
 * that turns out to be a database table at run time is refused here.
 */
export function orderedRelation(rel) {
  let hidden = 0;
  const singleRow = (r) => r?.rel === "project" && r.input?.rel === "scan" && upper(r.input.table) === "DUMMY";
  // `ties`: the output columns an ORDER BY sorted by (null: no ties). Only
  // the cursor query's own ORDER BY counts -- one inside, as a caller's
  // relation or a table variable brings it, HANA may drop (the compiler's
  // rule, orderOf)
  const ordered = (r, top) => {
    switch (r?.rel) {
      case "order": {
        if (!top) return undefined;
        let input = r.input;
        // a key the projection below does not output is added to it
        if (input?.rel === "project") {
          const names = new Set(input.items.map((one) => upper(one.as)));
          const missing = r.keys.filter((k) => !names.has(upper(k.col)));
          // widening a DISTINCT changes what it removes
          if (input.distinct && missing.length > 0) return undefined;
          if (missing.length > 0) input = {...input, items: [...input.items, ...missing.map((k) => ({as: k.col, expr: col(k.col, undefined)}))]};
        }
        return {rel: input, keys: r.keys, ties: new Set(r.keys.map((k) => upper(k.col)))};
      }
      case "filter": { const o = ordered(r.input, false); return o && {rel: {...r, input: o.rel}, keys: o.keys, ties: o.ties}; }
      case "alias": { const o = ordered(r.input, false); return o && {rel: {...r, input: o.rel}, keys: o.keys, ties: o.ties}; }
      case "project": {
        if (r.distinct) return undefined;
        const o = ordered(r.input, false);
        if (o === undefined) return undefined;
        const carried = o.keys.map((k) => ({key: k, as: `__ORD${hidden++}`}));
        // below a projection nothing has ties: only the cursor's own ORDER BY
        // makes them, and it is accepted at the top only; the keys carried up
        // are positions, one row each
        return {rel: {...r, input: o.rel, items: [...r.items, ...carried.map((c) => ({as: c.as, expr: col(c.key.col, undefined)}))]},
          keys: carried.map((c) => ({col: c.as, desc: c.key.desc})), ties: null};
      }
      case "scan": return upper(r.table) === "DUMMY" ? {rel: r, keys: [], ties: null} : undefined;
      // a host relation (tools/ir-host-relation.mjs): the caller's rows,
      // numbered by the host, as the union of single rows below is
      case "ref": return r.ordinal === undefined ? undefined : {rel: r, keys: [{col: r.ordinal, desc: false}], ties: null};
      case "union": {
        if (r.all !== true || !r.inputs.every(singleRow)) return undefined;
        const name = `__ORD${hidden++}`;
        return {rel: {...r, inputs: r.inputs.map((part, i) => ({...part, items: [...part.items, {as: name, expr: lit(i, T.int)}]}))},
          keys: [{col: name, desc: false}], ties: null};
      }
      default: return undefined;
    }
  };
  return ordered(rel, true);
}

export function freezeRelation(rel, relations, scalars, session = {}) {
  const freeze = (node) => {
    if (node === undefined || node === null || node.rel === undefined) {
      throw new UnsupportedSqlScript("a relational assignment has no relation");
    }
    if ((node.hints ?? []).includes("NO_INLINE")) {
      throw new UnsupportedSqlScript("NO_INLINE requires a materialisation barrier; the one-query procedural executor refuses it", node);
    }
    if (node.rel === "var") {
      const name = upper(node.name);
      const known = relations.get(name);
      if (known === undefined) throw new UnsupportedSqlScript(`unknown table variable :${name.toLowerCase()}`, node);
      return known;
    }
    const copy = {...node};
    for (const key of ["input", "left", "right"]) {
      if (copy[key] !== undefined) copy[key] = freeze(copy[key]);
    }
    if (copy.inputs !== undefined) copy.inputs = copy.inputs.map(freeze);
    for (const key of ["pred", "on", "n"]) {
      if (copy[key] !== undefined) copy[key] = freezeExpr(copy[key], scalars, freeze, session);
    }
    if (copy.rel === "limit") {
      const count = copy.n?.value;
      if (copy.n?.type?.abap !== "I" || !Number.isInteger(count) || count < 0) {
        throw new UnsupportedSqlScript("LIMIT count must be a non-negative SQLScript INTEGER", copy.n ?? copy);
      }
    }
    if (copy.items !== undefined) {
      copy.items = copy.items.map((item) => ({...item, expr: freezeExpr(item.expr, scalars, freeze, session)}));
    }
    if (copy.aggs !== undefined) {
      copy.aggs = copy.aggs.map((item) => ({...item, expr: freezeExpr(item.expr, scalars, freeze, session)}));
    }
    return copy;
  };
  return freeze(rel);
}

function assertExpandedRelationBudget(rel, {nodes, depth, parameters}) {
  let seen = 0;
  let bound = 0;
  const visit = (level, node) => {
    seen += 1;
    if (seen > nodes) throw new UnsupportedSqlScript(`SQLScript expanded plan limit ${nodes} exceeded`, node);
    if (level > depth) throw new UnsupportedSqlScript(`SQLScript plan depth limit ${depth} exceeded`, node);
  };
  const expression = (expr, level) => {
    if (expr == null) return;
    visit(level, expr);
    // Literals are parameters too: lowering binds them instead of putting
    // their values in SQL text. Dialect rewrites may bind one expression
    // more than once, so runProcedure also checks the compiled count.
    if (expr.node === "param" || expr.node === "lit") {
      bound += 1;
      if (bound > parameters) {
        throw new UnsupportedSqlScript(`SQLScript bound parameter limit ${parameters} exceeded`, expr);
      }
    }
    for (const key of ["left", "right", "expr", "pattern", "escape", "otherwise"]) expression(expr[key], level + 1);
    for (const one of expr.args ?? []) expression(one, level + 1);
    for (const one of expr.values ?? []) expression(one, level + 1);
    for (const one of expr.whens ?? []) { expression(one.when, level + 1); expression(one.then, level + 1); }
    for (const one of expr.window?.partitionBy ?? []) expression(one, level + 1);
    for (const one of expr.window?.orderBy ?? []) expression(one.expr, level + 1);
    if (expr.node === "sub") relation(expr.rel, level + 1);
  };
  const relation = (node, level) => {
    visit(level, node);
    expression(node.pred, level + 1);
    expression(node.on, level + 1);
    expression(node.n, level + 1);
    for (const one of node.items ?? []) expression(one.expr, level + 1);
    for (const one of node.aggs ?? []) expression(one.expr, level + 1);
    for (const key of ["input", "left", "right"]) if (node[key] !== undefined) relation(node[key], level + 1);
    for (const one of node.inputs ?? []) relation(one, level + 1);
  };
  relation(rel, 1);
}

/** Interpret control flow, then execute the final relation once. */
export async function runProcedure(program, {
  client, dialect, inputs = {}, relationInputs = {}, inputCatalogue = program.catalogue ?? {}, maxSteps = 10000, maxPlanNodes = 10000,
  maxPlanDepth = 256, maxParameters = 10000, maxCallDepth = 16, session = {}, procedures = new Map(),
  callDepth = 0, deferRelation = false, closedRelationInputs = false,
} = {}) {
  if (program?.ir !== "sqlscript-procedure") throw new UnsupportedSqlScript("not a SQLScript procedure IR");
  // every statement sent to the database is counted here, whatever sent it
  // (a scalar the host does not evaluate, SELECT ... INTO, an INT2 probe, the
  // answer), so the trace says the database was used when it was
  let dbStatements = 0;
  let dbParams = 0;
  // what each FOR loop relied on for its order, for the trace
  const orderTrace = [];
  // table variables materialised before a write to the table they read;
  // dropped when the call ends, however it ends
  const snapshots = [];
  let snapshotCount = 0;
  const readsDatabase = (node) => {
    if (node === null || typeof node !== "object") return false;
    if (node.rel === "scan" && upper(node.table) !== "DUMMY") return true;
    if (node.rel === "tfcall") return true;
    return Object.values(node).some((value) => (Array.isArray(value) ? value.some(readsDatabase) : readsDatabase(value)));
  };
  const snapshot = async (name, rel) => {
    let compiled;
    try { compiled = lower(rel, dialect, {relationRef: (handle) => client.relationRef(handle)}); }
    catch (error) {
      if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
      throw error;
    }
    const schema = schemaOf(rel, inputCatalogue);
    const columns = Object.keys(schema);
    // a table of the column types, filled by INSERT ... SELECT: CREATE TABLE
    // AS keeps no collation, and SQLite's CHAR columns compare with RTRIM
    const types = columns.map((c) => snapshotColumnType(schema[c], dialect));
    let handle;
    const quoteId = (ident) => `"${ident.replace(/"/g, '""')}"`;
    if (typeof client.write === "function" && types.every((t) => t !== undefined)) {
      // through the LUW's own writes, created, filled and (at the end) dropped
      // in its order: DuckDB replays the LUW after a failed statement, and a
      // write that read a snapshot the replay did not recreate failed there
      // with "table ... does not exist" (the #64 critic)
      snapshotCount += 1;
      const ident = `OSD_SNAP_${String(name).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}_${globalThis.process?.pid ?? 0}_${snapshotCount}`;
      handle = {ident, ref: quoteId(ident), kind: "materialised", reason: "a table variable read before a write", viaWrite: true};
      await client.write({sql: `CREATE TABLE ${handle.ref} (${columns.map((c, i) => `${quoteId(c)} ${types[i]}`).join(", ")})`});
      snapshots.push(handle);
      await client.write({sql: `INSERT INTO ${handle.ref} ${compiled.sql}`, params: compiled.params});
    } else if (client.relationDdl === true && types.every((t) => t !== undefined)) {
      const quote = (ident) => `"${ident.replace(/"/g, '""')}"`;
      handle = await client.defineRelation({name: `snap_${name}`, materialise: "a table variable read before a write",
        ddl: (ref) => `CREATE TABLE ${ref} (${columns.map((c, i) => `${quote(c)} ${types[i]}`).join(", ")})`});
      snapshots.push(handle);
      await client.native({sql: `INSERT INTO ${client.relationRef(handle)} ${compiled.sql}`, params: compiled.params, expect: "none"});
    } else {
      handle = await client.defineRelation({name: `snap_${name}`, sql: compiled.sql, params: compiled.params,
        materialise: "a table variable read before a write"});
      snapshots.push(handle);
    }
    dbStatements += 1;
    return refTo(handle, schema);
  };
  const ask = (compiled) => {
    dbStatements += 1;
    dbParams += compiled.params.length;
    return client.native({...compiled, expect: "rows"});
  };
  const traced = (hostSteps, extra = {}) => ({engine: dbStatements > 0 ? dialect : "host", fallback: false, hostSteps, ...extra,
    databaseStatements: dbStatements, boundParameters: dbParams, ...(orderTrace.length > 0 ? {order: orderTrace} : {})});
  session = session ?? {};
  if (typeof session !== "object" || Array.isArray(session)) {
    throw new UnsupportedSqlScript("SQLScript session must be an object");
  }
  if (session.values != null && (typeof session.values !== "object" || Array.isArray(session.values))) {
    throw new UnsupportedSqlScript("SQLScript session values must be an object");
  }
  if (program.outputType !== undefined && !["I", "C", "STRING"].includes(program.outputType?.abap)) {
    throw new UnsupportedSqlScript("portable scalar outputs are limited to ABAP INTEGER, fixed-length character and STRING");
  }
  if (program.outputType !== undefined && !readsRelations(program.body ?? [])
      && ((program.relationParameters ?? []).length > 0 || containsRelationStatement(program.body ?? []))) {
    throw new UnsupportedSqlScript("scalar-only portable functions cannot contain relational inputs or statements");
  }
  if (program.outputType === undefined && client?.supportsNative !== true) {
    throw new UnsupportedSqlScript("the selected database has no native relational channel");
  }
  for (const [name, value] of Object.entries({maxSteps, maxPlanNodes, maxPlanDepth, maxParameters, maxCallDepth})) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new UnsupportedSqlScript(`${name} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(callDepth) || callDepth < 0 || callDepth > maxCallDepth) {
    throw new UnsupportedSqlScript(`SQLScript nested call depth limit ${maxCallDepth} exceeded`);
  }
  const scalars = new Map();
  const relations = new Map();
  const supplied = new Map(Object.entries(inputs).map(([name, value]) => [upper(name), value]));
  const suppliedRelations = new Map(Object.entries(relationInputs).map(([name, value]) => [upper(name), value]));
  for (const parameter of program.parameters) {
    const name = upper(parameter.name);
    if (parameter.optional !== undefined && typeof parameter.optional !== "boolean") {
      throw new UnsupportedSqlScript(`portable scalar input ${name} has a malformed OPTIONAL flag`);
    }
    const typeKeys = parameter.type && typeof parameter.type === "object" ? Object.keys(parameter.type).sort() : [];
    const exactScalar = (typeKeys.length === 1 && typeKeys[0] === "abap" && ["I", "STRING"].includes(parameter.type.abap))
      || (typeKeys.join() === "abap,bits" && isInt2(parameter.type));
    const fixedChar = typeKeys.join() === "abap,len" && ["C", "X"].includes(parameter.type.abap)
      && Number.isInteger(parameter.type.len) && parameter.type.len > 0;
    if (!exactScalar && !fixedChar) {
      throw new UnsupportedSqlScript("portable scalar inputs require the exact ABAP INTEGER, STRING, fixed-length character or fixed-length RAW type");
    }
    if (!supplied.has(name) && parameter.optional !== true) throw new UnsupportedSqlScript(`missing input ${name}`);
    if (parameter.default !== undefined && typeof parameter.default !== (parameter.type?.abap === "I" ? "number" : "string")) {
      throw new UnsupportedSqlScript(`portable scalar input ${name} has a DEFAULT of the wrong kind`);
    }
    // an omitted input takes its DEFAULT when the signature has one, and
    // ABAP's initial value only for a bare OPTIONAL
    const initial = parameter.default !== undefined ? parameter.default
      : parameter.type?.abap === "I" ? 0 : ["STRING", "C"].includes(parameter.type?.abap) ? ""
        : parameter.type?.abap === "X" ? "0".repeat(parameter.type.len * 2) : null;
    const raw = supplied.has(name) ? supplied.get(name) : initial;
    if (parameter.kind !== undefined && !["DATS", "TIMS"].includes(parameter.kind)) {
      throw new UnsupportedSqlScript(`portable scalar input ${name} has an unknown kind ${parameter.kind}`);
    }
    if (parameter.kind !== undefined && !(parameter.type.abap === "C" && parameter.type.len === (parameter.kind === "DATS" ? 8 : 6))) {
      throw new UnsupportedSqlScript(`portable scalar input ${name} is a ${parameter.kind} but not C(${parameter.kind === "DATS" ? 8 : 6})`);
    }
    if (isInt2(parameter.type)) inInt2Range(raw, `input ${name}`);
    const value = parameter.kind !== undefined ? boundDateTime(raw, parameter.kind, name)
      : parameter.type.abap === "C" ? boundCharacter(raw, parameter.type, name)
      : parameter.type.abap === "X" ? boundBytes(raw, parameter.type, name) : scalarForType(raw, parameter.type, name);
    // the same refusal as for a variable: a character outside the BMP raised
    // on A4H, and JavaScript would count it as two
    if (typeof value === "string" && ["C", "STRING"].includes(parameter.type.abap) && /[\uD800-\uDFFF]/.test(value)) {
      throw new UnsupportedSqlScript(`input ${name}: a character outside the Basic Multilingual Plane is not carried (HANA raised on it, measured)`);
    }
    scalars.set(name, {type: parameter.type, value});
  }
  if (program.outputType !== undefined) {
    scalars.set(program.output, {type: program.outputType, value: null});
  }
  for (const one of program.outputs ?? []) {
    if (one.scalar !== undefined) scalars.set(one.name, {type: one.scalar, value: null});
  }
  for (const parameter of program.relationParameters ?? []) {
    const name = upper(parameter.name);
    const supplied = suppliedRelations.get(name);
    if (supplied?.rel === undefined) throw new UnsupportedSqlScript(`missing typed relation input ${name}`);
    // An input is already outside the procedure: it may not capture the
    // procedure's scalars or unresolved table variables. Close it with empty
    // environments, applying the same NO_INLINE and unknown-param refusals
    // as an assignment inside the body.
    const budget = {nodes: maxPlanNodes, depth: maxPlanDepth, parameters: maxParameters};
    assertExpandedRelationBudget(supplied, budget);
    // External relation inputs must be closed here. A nested CALL passes a
    // plan already frozen by its parent; freezing it again with an empty
    // scalar scope would reject the deliberately captured parameter values.
    const value = closedRelationInputs ? supplied : freezeRelation(supplied, new Map(), new Map());
    assertExpandedRelationBudget(value, budget);
    let actual;
    try { actual = schemaOf(value, inputCatalogue); }
    catch (error) { throw new UnsupportedSqlScript(`cannot prove schema of relation input ${name}: ${error.message}`); }
    const expectedShape = JSON.stringify(parameter.schema);
    if (JSON.stringify(actual) !== expectedShape) {
      throw new UnsupportedSqlScript(`relation input ${name} schema does not match its AMDP signature`);
    }
    // INT2 columns of a table input: an ABAP caller cannot hand over a value
    // outside -32768..32767, so one that does came from a JavaScript caller
    // and is refused at the bind, as the scalar input is (foreman-dell)
    const int2Inputs = Object.entries(parameter.schema).filter(([, type]) => isInt2(type)).map(([column]) => column);
    if (int2Inputs.length > 0) {
      if (closedRelationInputs || client?.native === undefined) {
        throw new UnsupportedSqlScript(`relation input ${name} has INT2 columns (${int2Inputs.join(", ")}); their range check needs the database and is not carried across a CALL`);
      }
      const outside = int2Inputs.map((column) => bin("OR",
        bin("<", col(column, T.int2), lit(-32768, T.int), T.bool),
        bin(">", col(column, T.int2), lit(32767, T.int), T.bool), T.bool))
        .reduce((a, b) => bin("OR", a, b, T.bool));
      let probe;
      try { probe = lower(limit(filter(value, outside), 1), dialect, {relationRef: (handle) => client.relationRef(handle)}); }
      catch (error) { throw new UnsupportedSqlScript(`cannot check INT2 columns of relation input ${name}: ${error.message}`); }
      const found = await ask(probe);
      if (found.rows.length > 0) {
        throw new Int2OutOfRange(`relation input ${name}: a row is outside INT2 (-32768..32767) in ${int2Inputs.join(", ")}; an ABAP int2 table cannot carry it`);
      }
    }
    relations.set(name, value);
  }
  let steps = 0;
  let nestedSteps = 0;
  let nestedCalls = 0;
  const assignedScalars = new Set();
  const step = (node) => {
    steps += 1;
    if (steps > maxSteps) throw new UnsupportedSqlScript(`SQLScript step limit ${maxSteps} exceeded`, node);
  };
  // A scalar expression the host evaluates (INTEGER / BOOLEAN arithmetic and
  // comparisons), or one the database evaluates: any text in it goes to the
  // engine as SELECT <expr> FROM DUMMY, rendered by the same lower() as a
  // query, so a string scalar means what the same expression in a SELECT
  // means on that engine (measured against HANA through the value tests).
  const textual = (e) => e != null && (["C", "STRING"].includes(e.type?.abap)
    || (e.node === "param" && ["C", "STRING"].includes(scalars.get(upper(e.name))?.type?.abap))
    || ["left", "right", "expr", "pattern", "escape", "otherwise"].some((k) => textual(e[k]))
    || (e.args ?? []).some(textual) || (e.values ?? []).some(textual)
    || (e.whens ?? []).some((w) => textual(w.when) || textual(w.then)));
  // a parameter node must carry the type its scalar was declared with,
  // whichever side evaluates it: a forged type is refused before routing
  const sameParamTypes = (e, context) => {
    if (e == null) return;
    if (e.node === "param") {
      const declared = scalars.get(upper(e.name));
      if (declared === undefined) throw new UnsupportedSqlScript(`unknown scalar :${upper(e.name).toLowerCase()}`, e);
      if (JSON.stringify(e.type) !== JSON.stringify(declared.type)) {
        throw new UnsupportedSqlScript(`${context} parameter :${upper(e.name).toLowerCase()} changes its measured type`, e);
      }
    }
    for (const k of ["left", "right", "expr", "pattern", "escape", "otherwise"]) sameParamTypes(e[k], context);
    for (const one of [...(e.args ?? []), ...(e.values ?? [])]) sameParamTypes(one, context);
    for (const w of e.whens ?? []) { sameParamTypes(w.when, context); sameParamTypes(w.then, context); }
  };
  // what evaluateScalar does itself: literals, scalars, arithmetic,
  // comparisons, AND / OR / NOT, IS NULL, a two-argument COALESCE. Text
  // stays on the host where the rule is the one measured on A4H and not an
  // engine's: `||` (NULL wins), `=` / `<>` (trailing blanks count, 'x  '
  // <> 'x'). Ordering a text and arithmetic on one are the engine's until
  // measured, so the semantics are HANA's on every backend and the IR needs
  // no engine for what the corpus mostly does.
  const hostCapable = (e) => e == null || (
    ["lit", "param"].includes(e.node)
    || (e.node === "isnull" && hostCapable(e.expr))
    || (e.node === "not" && hostCapable(e.expr))
    || (e.node === "bin" && hostCapable(e.left) && hostCapable(e.right)
      && (!(textual(e.left) || textual(e.right)) || ["||", "AND", "OR"].includes(e.op)
        || (["=", "<>", "!="].includes(e.op) && textual(e.left) && textual(e.right))))
    || (e.node === "call" && e.fn === "COALESCE" && (e.args ?? []).length === 2 && e.args.every(hostCapable))
    || (e.node === "call" && ["UPPER", "LOWER"].includes(e.fn) && (e.args ?? []).length === 1 && hostCapable(e.args[0])));
  // a comparison of a text with a number is not measured on HANA, and the
  // engines disagree (DuckDB raises, SQLite answers false): refused
  // decided by the type of each SIDE, not by any text below it:
  // LENGTH(:s) = 3 compares two numbers (the critic's N1)
  const textTyped = (e) => ["C", "STRING"].includes(e.type?.abap)
    || (e.node === "param" && ["C", "STRING"].includes(scalars.get(upper(e.name))?.type?.abap));
  const mixedComparison = (e) => e != null && (
    (e.node === "bin" && ["=", "<>", "!=", "<", ">", "<=", ">="].includes(e.op)
      && e.left != null && e.right != null && textTyped(e.left) !== textTyped(e.right))
    || ["left", "right", "expr", "otherwise"].some((k) => mixedComparison(e[k]))
    || (e.args ?? []).some(mixedComparison) || (e.values ?? []).some(mixedComparison)
    || (e.whens ?? []).some((w) => mixedComparison(w.when) || mixedComparison(w.then)));
  const evaluate = async (expr, context) => {
    sameParamTypes(expr, context);
    if (mixedComparison(expr)) {
      throw new UnsupportedSqlScript(`${context}: comparing a text with a number is not measured on HANA yet`);
    }
    if (hostCapable(expr)) {
      assertPortableHostExpression(expr, context, scalars);
      return evaluateScalar(expr, scalars);
    }
    if (client?.native === undefined) {
      throw new UnsupportedSqlScript(`${context}: a scalar the host does not evaluate goes to the database, and this run has none`);
    }
    const frozen = freezeExpr(expr, scalars, (rel) => freezeRelation(rel, relations, scalars, session), session);
    let compiled;
    try { compiled = lower(project(scan("DUMMY"), [{as: "V", expr: frozen}]), dialect, {relationRef: (handle) => client.relationRef(handle)}); }
    catch (error) {
      if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
      throw error;
    }
    const answer = await ask(compiled);
    const value = answer.rows[0]?.V ?? null;
    if (typeof value === "bigint") return Number(value);
    // SQLite answers a comparison as 1 / 0
    if (expr.type?.abap === "BOOL" && (value === 0 || value === 1)) return value === 1;
    return value;
  };

  const execute = async (body) => {
    for (const statement of body) {
      step(statement);
      if (statement.stmt === "declare-scalar") {
        const raw = statement.initial === undefined ? null : await evaluate(statement.initial, "scalar declaration");
        const value = intoVariable(raw, statement.initial?.type, statement.type, statement.name);
        scalars.set(statement.name, {type: statement.type, value});
      } else if (statement.stmt === "assign-scalar") {
        const current = scalars.get(statement.name);
        if (current === undefined) throw new UnsupportedSqlScript(`assignment to undeclared scalar ${statement.name}`, statement);
        if (!assignable(statement.expr?.type, current.type)) {
          throw new UnsupportedSqlScript(`scalar assignment ${statement.name} requires an identical measured type`, statement);
        }
        const value = intoVariable(await evaluate(statement.expr, "scalar assignment"), statement.expr?.type, current.type, statement.name);
        scalars.set(statement.name, {type: current.type, value});
        assignedScalars.add(statement.name);
      } else if (statement.stmt === "select-into") {
        // measured on A4H: one row assigns, none raises unless DEFAULT is
        // given, two raise always (CX_AMDP_EXECUTION_FAILED); a NULL in the
        // row assigns NULL. Two rows are asked for, which is enough to tell.
        if (client?.native === undefined) {
          throw new UnsupportedSqlScript("SELECT ... INTO needs the database, and this run has none", statement);
        }
        const budget = {nodes: maxPlanNodes, depth: maxPlanDepth, parameters: maxParameters};
        assertExpandedRelationBudget(statement.rel, budget);
        const frozen = freezeRelation(statement.rel, relations, scalars, session);
        assertExpandedRelationBudget(frozen, budget);
        let compiled;
        try { compiled = lower(limit(frozen, 2), dialect, {relationRef: (handle) => client.relationRef(handle)}); }
        catch (error) {
          if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
          throw error;
        }
        const answer = await ask(compiled);
        let values;
        if (answer.rows.length > 1) {
          throw new SelectIntoRows(`SELECT ... INTO ${statement.targets.join(", ")} found more than one row; HANA raises CX_AMDP_EXECUTION_FAILED here`);
        } else if (answer.rows.length === 0) {
          if (statement.defaults === undefined) {
            throw new SelectIntoRows(`SELECT ... INTO ${statement.targets.join(", ")} found no row; HANA raises CX_AMDP_EXECUTION_FAILED here`);
          }
          values = statement.defaults.map((expr) => {
            assertPortableHostExpression(expr, "SELECT ... INTO DEFAULT", scalars);
            return evaluateScalar(expr, scalars);
          });
        } else {
          const columns = Object.keys(schemaOf(frozen, inputCatalogue));
          values = columns.map((column) => answer.rows[0][column] ?? null);
        }
        statement.targets.forEach((target, i) => {
          const current = scalars.get(target);
          if (current === undefined) throw new UnsupportedSqlScript(`SELECT ... INTO undeclared scalar ${target}`, statement);
          if (values[i] !== null && current.type?.abap === "I" && current.type.bits === undefined) {
            const n = Number(values[i]);
            if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
              throw new UnsupportedSqlScript(`SELECT ... INTO ${target}: ${values[i]} does not fit an INTEGER; the overflow is not measured, so it is refused`, statement);
            }
          }
          scalars.set(target, {type: current.type, value: intoVariable(values[i], undefined, current.type, target)});
          assignedScalars.add(target);
        });
      } else if (statement.stmt === "assign-relation") {
        // Reject hostile/deep input before recursive freezing or effects()
        // can exhaust the JavaScript stack. A var reference is cheap here;
        // the expanded previous version is checked again after substitution.
        const budget = {nodes: maxPlanNodes, depth: maxPlanDepth, parameters: maxParameters};
        assertExpandedRelationBudget(statement.rel, budget);
        const value = freezeRelation(statement.rel, relations, scalars, session);
        assertExpandedRelationBudget(value, budget);
        if (effects(value).nonDeterministic) {
          throw new UnsupportedSqlScript("non-deterministic relational execution is outside the P1a subset", statement);
        }
        relations.set(statement.name, value);
      } else if (statement.stmt === "write") {
        if (client?.native === undefined || typeof client.defineRelation !== "function") {
          throw new UnsupportedSqlScript("a write to a table needs the database, and this run has none", statement);
        }
        if (deferRelation) throw new UnsupportedSqlScript("a write inside a nested CALL is not carried yet", statement);
        // A table variable read before the write keeps the rows it read
        // (measured on HXE: `lt = SELECT FROM t; DELETE FROM t;` and :lt
        // still has them). This executor keeps a variable as a plan, so a
        // plan that reads the table is materialised before the write runs.
        // the snapshots, too, are made inside the LUW: a ROLLBACK then takes
        // back their tables with the writes, and a COMMIT keeps neither
        await client.beginTransaction?.();
        // Conservatively: every plan that reads the database at all -- a view
        // or a table function reads the table written as surely as a scan of
        // it does, and which tables a view reads is not known here (the #63
        // critic: a variable over a view saw the DELETE)
        for (const [name, rel] of [...relations]) {
          if (readsDatabase(rel)) relations.set(name, await snapshot(name, rel));
        }
        const frozenRel = (rel) => freezeRelation(rel, relations, scalars, session);
        const frozen = (expr) => freezeExpr(expr, scalars, frozenRel, session);
        const w = {...statement.write};
        if (w.from !== undefined) w.from = frozenRel(w.from);
        if (w.pred !== undefined) w.pred = frozen(w.pred);
        if (w.set !== undefined) w.set = w.set.map((one) => ({...one, expr: frozen(one.expr)}));
        if (w.rows !== undefined) w.rows = w.rows.map((row) => row.map(frozen));
        let compiled;
        try { compiled = lower(w, dialect, {relationRef: (handle) => client.relationRef(handle)}); }
        catch (error) {
          if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
          throw error;
        }
        // measured on HXE: an UPSERT ... SELECT that brings one key twice
        // raises "unique constraint violated"; SQLite would take the last
        // and DuckDB refuse in its own words, so the query is asked first
        if (w.write === "upsert" && w.from !== undefined) {
          // the query is asked twice, so it must answer the same both times
          if (effects(w.from).nonDeterministic) {
            throw new UnsupportedSqlScript(`UPSERT ${w.table}: a query that may answer differently twice is not carried`, statement);
          }
          const produced = Object.keys(schemaOf(w.from, inputCatalogue));
          const keyOut = w.key.map((k) => produced[w.columns.indexOf(k)]);
          const inner = lower(w.from, dialect, {relationRef: (handle) => client.relationRef(handle)});
          const quoteId = (id) => `"${String(id).replace(/"/g, '""')}"`;
          // a NULL in the key: a key column is NOT NULL on HANA, and a
          // composite key on SQLite would take it (the #64 critic)
          const nulls = await ask({sql: `SELECT 1 AS "N" FROM (${inner.sql}) AS "q" WHERE ${keyOut.map((k) => `${quoteId(k)} IS NULL`).join(" OR ")}`, params: inner.params});
          if (nulls.rows.length > 0) {
            throw new UnsupportedSqlScript(`UPSERT ${w.table}: the query brings a NULL in a key column, which HANA's NOT NULL key refuses`, statement);
          }
          const twice = await ask({sql: `SELECT 1 AS "D" FROM (${inner.sql}) AS "q" GROUP BY ${keyOut.map(quoteId).join(", ")} HAVING COUNT(*) > 1`, params: inner.params});
          if (twice.rows.length > 0) {
            throw new UnsupportedSqlScript(`UPSERT ${w.table}: the query brings one key twice; HANA raises "unique constraint violated" here`, statement);
          }
        }
        step(statement);
        dbStatements += 1;
        dbParams += compiled.params.length;
        // in the caller's LUW, as an Open SQL write is: a ROLLBACK WORK (or
        // a dump ending the dialog step) takes it back
        if (typeof client.write === "function") await client.write(compiled);
        else {
          await client.beginTransaction?.();
          await client.native({...compiled, expect: "none"});
        }
      } else if (statement.stmt === "for-range") {
        // measured on HXE: the bounds are evaluated once, inclusive; from >
        // to runs no time; REVERSE counts down; the counter is the loop's
        // own -- an assignment to the variable inside lasts to the end of
        // that turn -- and the variable keeps the last value it was given
        const from = await evaluate(statement.from, "FOR bound");
        const to = await evaluate(statement.to, "FOR bound");
        // a NULL bound runs no turn and leaves the variable as it was
        // (measured on HXE: `FOR i IN 1 .. :nn` with nn NULL); a NULL literal
        // does not compile there, which the compiler refuses
        if (from === null || to === null) continue;
        // a BIGINT bound past 2^53 would make `c += 1` a no-op in a JavaScript
        // number; refused rather than counted wrongly
        for (const bound of [from, to]) {
          if (!Number.isSafeInteger(Number(bound))) {
            throw new UnsupportedSqlScript(`FOR ${statement.variable}: a bound past 2^53 (${bound}) is not counted exactly here`, statement);
          }
        }
        const current = scalars.get(statement.variable);
        // the number of turns by arithmetic, not by building them: a range
        // past what is left of the step budget is refused before its first
        // turn, so no turn runs for a loop that cannot finish
        const first = Number(from);
        const last = Number(to);
        const count = Math.max(0, last - first + 1);
        if (steps + count > maxSteps) throw new UnsupportedSqlScript(`SQLScript step limit ${maxSteps} exceeded`, statement);
        for (let k = 0; k < count; k += 1) {
          const c = statement.reverse ? last - k : first + k;
          step(statement);
          scalars.set(statement.variable, {type: current.type, value: intoVariable(c, undefined, current.type, statement.variable)});
          assignedScalars.add(statement.variable);
          await execute(statement.body);
        }
      } else if (statement.stmt === "for-cursor") {
        if (client?.native === undefined) {
          throw new UnsupportedSqlScript(`FOR over cursor ${statement.cursorName}: its rows come from the database, and this run has none`, statement);
        }
        // the checks an assignment and SELECT ... INTO make
        const budget = {nodes: maxPlanNodes, depth: maxPlanDepth, parameters: maxParameters};
        assertExpandedRelationBudget(statement.cursor, budget);
        const frozen = freezeRelation(statement.cursor, relations, scalars, session);
        assertExpandedRelationBudget(frozen, budget);
        if (effects(frozen).nonDeterministic) {
          throw new UnsupportedSqlScript(`FOR over cursor ${statement.cursorName}: a non-deterministic relation is outside the portable subset`, statement);
        }
        const known = orderedRelation(frozen);
        if (known === undefined) {
          const refusal = new UnsupportedSqlScript(`FOR over cursor ${statement.cursorName}: the order of its rows is not known at run time`, statement);
          refusal.reason = "order";
          throw refusal;
        }
        const outside = known.ties === null ? [] : Object.keys(statement.schema).filter((column) => !known.ties.has(upper(column)));
        if (outside.length > 0) {
          const refusal = new UnsupportedSqlScript(`FOR over cursor ${statement.cursorName}: rows equal in its ORDER BY come in any order, and its row carries ${outside.join(", ")} too`, statement);
          refusal.reason = "order";
          throw refusal;
        }
        const query = known.keys.length > 0 ? order(known.rel, known.keys) : known.rel;
        let compiled;
        try { compiled = lower(query, dialect, {relationRef: (handle) => client.relationRef(handle)}); }
        catch (error) {
          if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
          throw error;
        }
        const answer = await ask(compiled);
        const seen = orderTrace.find((one) => one.cursor === statement.cursorName);
        if (seen !== undefined) seen.opened += 1;
        else orderTrace.push({cursor: statement.cursorName, order: `${statement.order.kind}(${statement.order.why})`,
          basis: statement.order.basis ?? "assumed", keys: known.keys.map((k) => k.col), opened: 1});
        for (const row of answer.rows) {
          step(statement);
          for (const [column, type] of Object.entries(statement.schema)) {
            const raw = row[column] ?? row[column.toLowerCase()] ?? null;
            // the INTEGER range and a BIGINT's precision, as SELECT ... INTO has them
            if (raw !== null && type?.abap === "I" && type.bits === undefined) {
              const n = Number(raw);
              if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
                throw new UnsupportedSqlScript(`FOR over cursor ${statement.cursorName}: ${raw} does not fit an INTEGER`, statement);
              }
            }
            scalars.set(`${upper(statement.row)}.${upper(column)}`, {type, value: intoVariable(raw, undefined, type, `${statement.row}.${column}`)});
          }
          await execute(statement.body);
        }
      } else if (statement.stmt === "while") {
        while (booleanOrNull(await evaluate(statement.condition, "WHILE condition"), "WHILE condition") === true) {
          step(statement);
          await execute(statement.body);
        }
      } else if (statement.stmt === "if") {
        let selected;
        for (const branch of statement.branches) {
          if (booleanOrNull(await evaluate(branch.condition, "IF condition"), "IF condition") === true) {
            selected = branch.body;
            break;
          }
        }
        await execute(selected ?? statement.otherwise);
      } else if (statement.stmt === "call-procedure") {
        const child = procedures instanceof Map
          ? procedures.get(upper(statement.procedure))
          : procedures?.[upper(statement.procedure)];
        if (child?.ir !== "sqlscript-procedure") {
          throw new UnsupportedSqlScript(`nested procedure ${statement.procedure} is not in the portable registry`, statement);
        }
        if ((child.parameters ?? []).length !== 0 || (child.relationParameters ?? []).length !== 1
            || child.outputType !== undefined) {
          throw new UnsupportedSqlScript(
            "initial nested CALL requires exactly one table IN and one table OUT parameter", statement);
        }
        // a write in the called body is refused before it runs anything
        if (containsWrite(child.body ?? [])) {
          throw new UnsupportedSqlScript(`a write inside the nested CALL of ${statement.procedure} is not carried yet`, statement);
        }
        const input = relations.get(statement.input);
        if (input === undefined) {
          throw new UnsupportedSqlScript(`nested CALL input :${statement.input.toLowerCase()} is unknown`, statement);
        }
        const called = await runProcedure(child, {
          client, dialect, relationInputs: {[child.relationParameters[0].name]: input},
          inputCatalogue: {...inputCatalogue, ...(child.catalogue ?? {})},
          maxSteps, maxPlanNodes, maxPlanDepth, maxParameters, maxCallDepth, session, procedures,
          callDepth: callDepth + 1, deferRelation: true, closedRelationInputs: true,
        });
        relations.set(statement.output, called.relation);
        nestedSteps += called.trace.hostSteps;
        nestedCalls += 1 + (called.trace.nestedCalls ?? 0);
        // what the called body sent to the database is this call's too
        dbStatements += called.trace.databaseStatements ?? 0;
        dbParams += called.trace.boundParameters ?? 0;
      } else {
        throw new UnsupportedSqlScript(`procedure statement ${statement.stmt} is not supported`, statement);
      }
    }
  };
  try {
  await execute(program.body);
  if (program.outputType !== undefined) {
    const scalar = scalars.get(program.output);
    // an OUT scalar the path left alone is its initial value (measured on
    // A4H); a RETURNING one stays refused, as it was not measured
    if ((scalar === undefined || !assignedScalars.has(program.output)) && program.outputInitialWhenUnassigned === true) {
      return {value: initialOf(program.outputType), outputType: program.outputType,
        trace: traced(steps)};
    }
    if (scalar === undefined || !assignedScalars.has(program.output)) {
      throw new UnsupportedSqlScript(`scalar output ${program.output} was not assigned`);
    }
    if (["C", "STRING"].includes(program.outputType.abap)) {
      return {value: intoOutput(scalar.value, program.outputType, program.output), outputType: program.outputType,
        trace: traced(steps)};
    }
    // no range check here: a scalar INT2 output can only be assigned an INT2
    // value (an INTEGER into it is refused as not an identical measured type),
    // so it is always in range; the INT2 scalar boundary itself is unmeasured
    if (scalar.value == null) {
      return {value: initialOf(program.outputType), outputType: program.outputType, trace: traced(steps)};
    }
    return {value: scalarForType(scalar.value, program.outputType, program.output), outputType: program.outputType,
      trace: traced(steps)};
  }
  // An OUT table the path taken did not assign is an empty table (measured
  // on A4H: the caller's rows are replaced by none); one assigned nowhere in
  // the body does not compile there, and the compiler refuses it the same way
  // an unassigned OUT is answered without the database: no rows, the
  // declared columns (a typed empty SELECT would render literals whose SQL
  // type is not the declared one, and some types have no literal at all)
  const emptyAnswer = (schema) => ({rows: [], columns: Object.keys(schema).map((name) => ({name})), outputSchema: schema,
    trace: traced(steps + nestedSteps, {nestedCalls})});
  if (Array.isArray(program.outputs) && program.outputs.length > 1) {
    if (deferRelation) {
      throw new UnsupportedSqlScript(`a nested CALL of ${program.outputs.length} outputs is not carried; a CALL hands on one relation`);
    }
    const outputs = {};
    for (const one of program.outputs) {
      if (one.scalar !== undefined) {
        // an OUT scalar: what the body assigned, its initial value otherwise
        const held = scalars.get(one.name);
        outputs[one.name] = {value: assignedScalars.has(one.name) ? intoOutput(held?.value, one.scalar, one.name) : initialOf(one.scalar)};
        continue;
      }
      const assignedRel = relations.get(one.name);
      const answer = assignedRel === undefined ? emptyAnswer(one.schema) : await finishOne(one.name, one.schema, assignedRel);
      outputs[one.name] = {rows: answer.rows, columns: answer.columns, outputSchema: one.schema};
    }
    return {outputs, trace: traced(steps + nestedSteps, {nestedCalls})};
  }
  const single = relations.get(program.output);
  if (single === undefined && deferRelation) {
    throw new UnsupportedSqlScript(`output relation ${program.output} of a nested CALL was not assigned on the path taken`);
  }
  return single === undefined ? emptyAnswer(program.outputSchema) : await finishOne(program.output, program.outputSchema, single);
  } finally {
    for (const handle of snapshots) {
      if (handle.viaWrite) {
        // a failed drop must not hide the error the body ended with
        try { await client.write({sql: `DROP TABLE ${handle.ref}`}); } catch { /* already gone with a rollback */ }
      } else {
        await client.dropRelation(handle);
      }
    }
  }

  async function finishOne(outputName, outputSchema, result) {
  // A native AMDP procedure converts the final SELECT into the declared ABAP
  // OUT-table types. Window ranking is the first place this is observable:
  // both HANA and DuckDB naturally produce BIGINT, while the method declares
  // ABAP I. Preserve the natural type inside the plan, then reproduce the
  // signature conversion exactly once at the procedure boundary.
  let output = result;
  let actualOutput;
  try { actualOutput = schemaOf(result, inputCatalogue); }
  catch (error) { throw new UnsupportedSqlScript(`cannot prove output schema: ${error.message}`); }
  const expectedNames = Object.keys(outputSchema);
  if (JSON.stringify(Object.keys(actualOutput)) !== JSON.stringify(expectedNames)) {
    throw new UnsupportedSqlScript("output relation columns do not match the AMDP signature");
  }
  const converted = expectedNames.map((name) => {
    const actual = actualOutput[name];
    const expected = outputSchema[name];
    const source = col(name, actual);
    if (JSON.stringify(actual) === JSON.stringify(expected)) return {as: name, expr: source};
    // A CHAR expression already satisfies an ABAP STRING output without a
    // narrowing conversion. The inverse does not: an ABAP C boundary has a
    // length and therefore must use the measured truncating cast.
    if (expected.abap === "STRING" && ["C", "STRING"].includes(actual.abap)) {
      return {as: name, expr: source};
    }
    // into an INT2 column: an INTEGER passes unchanged, and its range is
    // checked on the rows below, where HANA raises rather than wraps
    if (isInt2(expected) && actual.abap === "I") return {as: name, expr: source};
    // and an INT2 value into an INTEGER column only widens
    if (expected.abap === "I" && expected.bits === undefined && isInt2(actual)) return {as: name, expr: source};
    if (expected.abap === "I" && actual.abap === "INT8") {
      return {as: name, expr: cast(source, expected)};
    }
    if (expected.abap === "C" && ["C", "STRING"].includes(actual.abap)) {
      return {as: name, expr: cast(source, expected)};
    }
    if (expected.abap === "P" && actual.abap === "P") {
      if (actual.dec !== expected.dec) {
        throw new UnsupportedSqlScript(`output ${name} packed-decimal scale conversion is not measured`);
      }
      return {as: name, expr: cast(source, expected)};
    }
    // INTEGER is exact and has no fractional component. Both measured
    // backends can therefore apply the declared packed-decimal precision and
    // scale at the AMDP output boundary without an intermediate float.
    if (expected.abap === "P" && actual.abap === "I") {
      return {as: name, expr: cast(source, expected)};
    }
    throw new UnsupportedSqlScript(`output ${name} conversion from ${actual.abap} to ${expected.abap} is not measured`);
  });
  if (converted.some((item) => item.expr.node === "cast")) output = project(result, converted);
  const int2Columns = Object.entries(outputSchema).filter(([, type]) => isInt2(type)).map(([column]) => column);
  if (deferRelation) {
    // a nested CALL hands its relation to the caller unevaluated, so the
    // range check at this boundary has no rows to look at; refused rather
    // than letting an out-of-range value through where HANA raises
    if (int2Columns.length > 0) {
      throw new UnsupportedSqlScript(`output ${outputName} of a nested CALL has INT2 columns (${int2Columns.join(", ")}); their range check is not carried across a CALL`);
    }
    return {relation: output, outputSchema: outputSchema,
      trace: traced(steps + nestedSteps, {nestedCalls})};
  }
  let compiled;
  try {
    compiled = lower(output, dialect, {relationRef: (handle) => client.relationRef(handle)});
  } catch (error) {
    if (error instanceof Refused) throw new UnsupportedSqlScript(error.message);
    throw error;
  }
  if (compiled.params.length > maxParameters) {
    throw new UnsupportedSqlScript(`SQLScript bound parameter limit ${maxParameters} exceeded after ${dialect} lowering`);
  }
  const answer = await ask(compiled);
  for (const row of answer.rows) {
    for (const column of int2Columns) {
      if (row[column] !== null && row[column] !== undefined) inInt2Range(row[column], `output ${outputName}.${column}`);
    }
  }
  return {
    rows: answer.rows,
    columns: answer.columns,
    outputSchema: outputSchema,
    trace: traced(steps + nestedSteps, {nestedCalls}),
  };
  }
}
