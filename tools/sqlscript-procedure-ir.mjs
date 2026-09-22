// The imperative half of portable SQLScript.
//
// Control flow stays in the host; every table value stays a relational plan
// and is executed by the selected database. This module deliberately starts
// with constructors and an interpreter independent of the parser: the first
// tests pin the semantics of immutable relation rebinding and scalar capture
// before a syntax tree is allowed to produce these nodes.
import {effects, schemaOf} from "./sqlscript-ir.mjs";
import {lower} from "./sqlscript-lower.mjs";

export class UnsupportedSqlScript extends Error {
  constructor(message, node) {
    super(message);
    this.code = "UNSUPPORTED_SQLSCRIPT";
    this.line = node?.source?.line ?? node?.line;
    this.col = node?.source?.col ?? node?.col;
  }
}

const upper = (name) => String(name).toUpperCase();

export const procedure = ({parameters = [], relationParameters = [], body = [], output, outputSchema = {}}) =>
  ({ir: "sqlscript-procedure", parameters, relationParameters, body, output: upper(output), outputSchema});
export const declareScalar = (name, type, initial, source) =>
  ({stmt: "declare-scalar", name: upper(name), type, initial, source});
export const assignScalar = (name, expr, source) =>
  ({stmt: "assign-scalar", name: upper(name), expr, source});
export const assignRelation = (name, rel, source) =>
  ({stmt: "assign-relation", name: upper(name), rel, source});
export const whileLoop = (condition, body, source) =>
  ({stmt: "while", condition, body, source});

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
  if (type?.abap === "BOOL" && typeof value !== "boolean") {
    throw new UnsupportedSqlScript(`${name} is not a SQLScript boolean`);
  }
  return value;
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

function freezeExpr(expr, scalars, freezeRel) {
  if (expr === undefined || expr === null) return expr;
  if (expr.node === "param") {
    const name = upper(expr.name);
    const scalar = scalars.get(name);
    if (scalar === undefined) throw new UnsupportedSqlScript(`unknown scalar :${name.toLowerCase()}`, expr);
    return {...expr, type: scalar.type ?? expr.type, value: scalar.value, isNull: scalar.value == null};
  }
  const copy = {...expr};
  for (const key of ["left", "right", "expr", "pattern", "escape", "otherwise"]) {
    if (copy[key] !== undefined) copy[key] = freezeExpr(copy[key], scalars, freezeRel);
  }
  for (const key of ["args", "values"]) {
    if (copy[key] !== undefined) copy[key] = copy[key].map((one) => freezeExpr(one, scalars, freezeRel));
  }
  if (copy.whens !== undefined) {
    copy.whens = copy.whens.map((one) => ({
      when: freezeExpr(one.when, scalars, freezeRel),
      then: freezeExpr(one.then, scalars, freezeRel),
    }));
  }
  if (copy.window !== undefined) {
    copy.window = {
      ...copy.window,
      partitionBy: (copy.window.partitionBy ?? []).map((one) => freezeExpr(one, scalars, freezeRel)),
      orderBy: (copy.window.orderBy ?? []).map((one) => one.expr === undefined ? one : ({
        ...one, expr: freezeExpr(one.expr, scalars, freezeRel),
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
export function freezeRelation(rel, relations, scalars) {
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
      if (copy[key] !== undefined) copy[key] = freezeExpr(copy[key], scalars, freeze);
    }
    if (copy.rel === "limit") {
      const count = copy.n?.value;
      if (copy.n?.type?.abap !== "I" || !Number.isInteger(count) || count < 0) {
        throw new UnsupportedSqlScript("LIMIT count must be a non-negative SQLScript INTEGER", copy.n ?? copy);
      }
    }
    if (copy.items !== undefined) {
      copy.items = copy.items.map((item) => ({...item, expr: freezeExpr(item.expr, scalars, freeze)}));
    }
    if (copy.aggs !== undefined) {
      copy.aggs = copy.aggs.map((item) => ({...item, expr: freezeExpr(item.expr, scalars, freeze)}));
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
  client, dialect, inputs = {}, relationInputs = {}, inputCatalogue = {}, maxSteps = 10000, maxPlanNodes = 10000,
  maxPlanDepth = 256, maxParameters = 10000,
} = {}) {
  if (program?.ir !== "sqlscript-procedure") throw new UnsupportedSqlScript("not a SQLScript procedure IR");
  if (client?.supportsNative !== true) throw new UnsupportedSqlScript("the selected database has no native relational channel");
  for (const [name, value] of Object.entries({maxSteps, maxPlanNodes, maxPlanDepth, maxParameters})) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new UnsupportedSqlScript(`${name} must be a positive safe integer`);
  }
  const scalars = new Map();
  const relations = new Map();
  const supplied = new Map(Object.entries(inputs).map(([name, value]) => [upper(name), value]));
  const suppliedRelations = new Map(Object.entries(relationInputs).map(([name, value]) => [upper(name), value]));
  for (const parameter of program.parameters) {
    const name = upper(parameter.name);
    if (!supplied.has(name)) throw new UnsupportedSqlScript(`missing input ${name}`);
    const value = scalarForType(supplied.get(name), parameter.type, name);
    scalars.set(name, {type: parameter.type, value});
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
    const value = freezeRelation(supplied, new Map(), new Map());
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
  const step = (node) => {
    steps += 1;
    if (steps > maxSteps) throw new UnsupportedSqlScript(`SQLScript step limit ${maxSteps} exceeded`, node);
  };
  const execute = async (body) => {
    for (const statement of body) {
      step(statement);
      if (statement.stmt === "declare-scalar") {
        const raw = statement.initial === undefined ? null : evaluateScalar(statement.initial, scalars);
        const value = scalarForType(raw, statement.type, statement.name);
        scalars.set(statement.name, {type: statement.type, value});
      } else if (statement.stmt === "assign-scalar") {
        const current = scalars.get(statement.name);
        if (current === undefined) throw new UnsupportedSqlScript(`assignment to undeclared scalar ${statement.name}`, statement);
        let value = evaluateScalar(statement.expr, scalars);
        value = scalarForType(value, current.type, statement.name);
        scalars.set(statement.name, {type: current.type, value});
      } else if (statement.stmt === "assign-relation") {
        // Reject hostile/deep input before recursive freezing or effects()
        // can exhaust the JavaScript stack. A var reference is cheap here;
        // the expanded previous version is checked again after substitution.
        const budget = {nodes: maxPlanNodes, depth: maxPlanDepth, parameters: maxParameters};
        assertExpandedRelationBudget(statement.rel, budget);
        const value = freezeRelation(statement.rel, relations, scalars);
        assertExpandedRelationBudget(value, budget);
        if (effects(value).nonDeterministic) {
          throw new UnsupportedSqlScript("non-deterministic relational execution is outside the P1a subset", statement);
        }
        relations.set(statement.name, value);
      } else if (statement.stmt === "while") {
        while (booleanOrNull(evaluateScalar(statement.condition, scalars), "WHILE condition") === true) {
          step(statement);
          await execute(statement.body);
        }
      } else {
        throw new UnsupportedSqlScript(`procedure statement ${statement.stmt} is not supported`, statement);
      }
    }
  };
  await execute(program.body);
  const result = relations.get(program.output);
  if (result === undefined) throw new UnsupportedSqlScript(`output relation ${program.output} was not assigned`);
  const compiled = lower(result, dialect, {relationRef: (handle) => client.relationRef(handle)});
  if (compiled.params.length > maxParameters) {
    throw new UnsupportedSqlScript(`SQLScript bound parameter limit ${maxParameters} exceeded after ${dialect} lowering`);
  }
  const answer = await client.native({...compiled, expect: "rows"});
  return {
    rows: answer.rows,
    columns: answer.columns,
    outputSchema: program.outputSchema,
    trace: {engine: dialect, fallback: false, hostSteps: steps, databaseStatements: 1,
      boundParameters: compiled.params.length},
  };
}
