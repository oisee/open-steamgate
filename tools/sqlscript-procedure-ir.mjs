// The imperative half of portable SQLScript.
//
// Control flow stays in the host; every table value stays a relational plan
// and is executed by the selected database. This module deliberately starts
// with constructors and an interpreter independent of the parser: the first
// tests pin the semantics of immutable relation rebinding and scalar capture
// before a syntax tree is allowed to produce these nodes.
import {effects, schemaOf, col, cast, project} from "./sqlscript-ir.mjs";
import {lower, Refused} from "./sqlscript-lower.mjs";

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
  catalogue = {}}) =>
  ({ir: "sqlscript-procedure", parameters, relationParameters, body, output: upper(output), outputSchema, outputType,
    catalogue});
export const declareScalar = (name, type, initial, source) =>
  ({stmt: "declare-scalar", name: upper(name), type, initial, source});
export const assignScalar = (name, expr, source) =>
  ({stmt: "assign-scalar", name: upper(name), expr, source});
export const assignRelation = (name, rel, source) =>
  ({stmt: "assign-relation", name: upper(name), rel, source});
export const whileLoop = (condition, body, source) =>
  ({stmt: "while", condition, body, source});
export const ifElse = (branches, otherwise = [], source) =>
  ({stmt: "if", branches, otherwise, source});
export const callProcedure = (name, input, output, source) =>
  ({stmt: "call-procedure", procedure: upper(name), input: upper(input), output: upper(output), source});

function integer(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
    throw new UnsupportedSqlScript(`${name} is outside SQLScript INTEGER`);
  }
  return n;
}

function scalarForType(value, type, name) {
  // SQL NULL stays SQL NULL. Number(null) is 0 in JavaScript, which is a
  // particularly dangerous accidental answer for an INTEGER parameter.
  if (value == null) return null;
  if (type?.abap === "I") return integer(value, name);
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
    if (declared.type?.abap === "STRING") {
      throw new UnsupportedSqlScript(`${context} cannot evaluate STRING on the portable host yet`, expr);
    }
  }
  if (expr.type?.abap === "STRING") {
    throw new UnsupportedSqlScript(`${context} cannot evaluate STRING on the portable host yet`, expr);
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
  session = session ?? {};
  if (typeof session !== "object" || Array.isArray(session)) {
    throw new UnsupportedSqlScript("SQLScript session must be an object");
  }
  if (session.values != null && (typeof session.values !== "object" || Array.isArray(session.values))) {
    throw new UnsupportedSqlScript("SQLScript session values must be an object");
  }
  if (program.outputType !== undefined && program.outputType?.abap !== "I") {
    throw new UnsupportedSqlScript("portable scalar RETURNING is limited to ABAP INTEGER exactly");
  }
  const containsRelationStatement = (body) => body.some((statement) =>
    statement.stmt === "assign-relation"
      || statement.stmt === "call-procedure"
      || (statement.stmt === "while" && containsRelationStatement(statement.body ?? []))
      || (statement.stmt === "if" && (statement.branches ?? []).some((branch) =>
        containsRelationStatement(branch.body ?? []))
        || (statement.stmt === "if" && containsRelationStatement(statement.otherwise ?? []))));
  if (program.outputType !== undefined
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
    const exactScalar = typeKeys.length === 1 && typeKeys[0] === "abap" && ["I", "STRING"].includes(parameter.type.abap);
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
    const value = parameter.kind !== undefined ? boundDateTime(raw, parameter.kind, name)
      : parameter.type.abap === "C" ? boundCharacter(raw, parameter.type, name)
      : parameter.type.abap === "X" ? boundBytes(raw, parameter.type, name) : scalarForType(raw, parameter.type, name);
    scalars.set(name, {type: parameter.type, value});
  }
  if (program.outputType !== undefined) {
    scalars.set(program.output, {type: program.outputType, value: null});
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
  const execute = async (body) => {
    for (const statement of body) {
      step(statement);
      if (statement.stmt === "declare-scalar") {
        assertPortableHostExpression(statement.initial, "scalar declaration", scalars);
        const raw = statement.initial === undefined ? null : evaluateScalar(statement.initial, scalars);
        const value = scalarForType(raw, statement.type, statement.name);
        scalars.set(statement.name, {type: statement.type, value});
      } else if (statement.stmt === "assign-scalar") {
        const current = scalars.get(statement.name);
        if (current === undefined) throw new UnsupportedSqlScript(`assignment to undeclared scalar ${statement.name}`, statement);
        if (JSON.stringify(statement.expr?.type) !== JSON.stringify(current.type)) {
          throw new UnsupportedSqlScript(`scalar assignment ${statement.name} requires an identical measured type`, statement);
        }
        assertPortableHostExpression(statement.expr, "scalar assignment", scalars);
        let value = evaluateScalar(statement.expr, scalars);
        value = scalarForType(value, current.type, statement.name);
        scalars.set(statement.name, {type: current.type, value});
        assignedScalars.add(statement.name);
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
      } else if (statement.stmt === "while") {
        assertPortableHostExpression(statement.condition, "WHILE condition", scalars);
        while (booleanOrNull(evaluateScalar(statement.condition, scalars), "WHILE condition") === true) {
          step(statement);
          await execute(statement.body);
        }
      } else if (statement.stmt === "if") {
        let selected;
        for (const branch of statement.branches) {
          assertPortableHostExpression(branch.condition, "IF condition", scalars);
          if (booleanOrNull(evaluateScalar(branch.condition, scalars), "IF condition") === true) {
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
      } else {
        throw new UnsupportedSqlScript(`procedure statement ${statement.stmt} is not supported`, statement);
      }
    }
  };
  await execute(program.body);
  if (program.outputType !== undefined) {
    const scalar = scalars.get(program.output);
    if (scalar === undefined || !assignedScalars.has(program.output)) {
      throw new UnsupportedSqlScript(`scalar output ${program.output} was not assigned`);
    }
    return {value: scalarForType(scalar.value, program.outputType, program.output), outputType: program.outputType,
      trace: {engine: "host", fallback: false, hostSteps: steps, databaseStatements: 0, boundParameters: 0}};
  }
  const result = relations.get(program.output);
  if (result === undefined) throw new UnsupportedSqlScript(`output relation ${program.output} was not assigned`);
  // A native AMDP procedure converts the final SELECT into the declared ABAP
  // OUT-table types. Window ranking is the first place this is observable:
  // both HANA and DuckDB naturally produce BIGINT, while the method declares
  // ABAP I. Preserve the natural type inside the plan, then reproduce the
  // signature conversion exactly once at the procedure boundary.
  let output = result;
  let actualOutput;
  try { actualOutput = schemaOf(result, inputCatalogue); }
  catch (error) { throw new UnsupportedSqlScript(`cannot prove output schema: ${error.message}`); }
  const expectedNames = Object.keys(program.outputSchema);
  if (JSON.stringify(Object.keys(actualOutput)) !== JSON.stringify(expectedNames)) {
    throw new UnsupportedSqlScript("output relation columns do not match the AMDP signature");
  }
  const converted = expectedNames.map((name) => {
    const actual = actualOutput[name];
    const expected = program.outputSchema[name];
    const source = col(name, actual);
    if (JSON.stringify(actual) === JSON.stringify(expected)) return {as: name, expr: source};
    // A CHAR expression already satisfies an ABAP STRING output without a
    // narrowing conversion. The inverse does not: an ABAP C boundary has a
    // length and therefore must use the measured truncating cast.
    if (expected.abap === "STRING" && ["C", "STRING"].includes(actual.abap)) {
      return {as: name, expr: source};
    }
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
  if (deferRelation) {
    return {relation: output, outputSchema: program.outputSchema,
      trace: {engine: "host", fallback: false, hostSteps: steps + nestedSteps,
        nestedCalls, databaseStatements: 0, boundParameters: 0}};
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
  const answer = await client.native({...compiled, expect: "rows"});
  return {
    rows: answer.rows,
    columns: answer.columns,
    outputSchema: program.outputSchema,
    trace: {engine: dialect, fallback: false, hostSteps: steps + nestedSteps, nestedCalls,
      databaseStatements: 1, boundParameters: compiled.params.length},
  };
}
