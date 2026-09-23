// ABAP -> IR, for the Go backend spike (docs: tools/gogen/README.md).
//
// The front half is not ours and is not rewritten: @abaplint/core parses and
// type-checks, and the transpiler's own Rearranger turns a flat Source into a
// binary tree with ABAP's operator precedence. What this file adds is the IR:
// every expression carries its type, every arithmetic expression carries the
// ABAP *calculation type*, and every conversion is an explicit node. A backend
// then has nothing left to decide about semantics -- that is the point of
// putting an IR between the tree and the text.
//
// The subset is deliberately small and everything outside it is a named
// refusal (Unsupported), never a guess: i and f scalars, standard tables of
// them, DO / WHILE / LOOP AT ... INTO / IF, APPEND, READ TABLE ... INDEX,
// static method calls, sin / cos / sqrt / abs / lines, sy-index / sy-tabix /
// sy-subrc.
import {createRequire} from "node:module";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

const require = createRequire(import.meta.url);
const abaplint = require("@abaplint/core");
const {Rearranger} = require("@abaplint/transpiler/build/src/rearranger");
const {Nodes, Statements, Structures, Expressions, BasicTypes} = abaplint;

export class Unsupported extends Error {}

const I = {k: "i"};
const F = {k: "f"};

function typeOf(abapType, where) {
  if (abapType instanceof BasicTypes.IntegerType) return I;
  if (abapType instanceof BasicTypes.FloatType) return F;
  if (abapType instanceof BasicTypes.TableType) {
    if (abapType.getAccessType() !== "STANDARD") throw new Unsupported(`${where}: only STANDARD tables`);
    return {k: "table", row: typeOf(abapType.getRowType(), where)};
  }
  throw new Unsupported(`${where}: type ${abapType.constructor.name} is outside the subset`);
}

const isExpr = (n, cls) => n instanceof Nodes.ExpressionNode && n.get() instanceof cls;
const isStmt = (n, cls) => n instanceof Nodes.StatementNode && n.get() instanceof cls;
const isStruct = (n, cls) => n instanceof Nodes.StructureNode && n.get() instanceof cls;
const tokenStr = (n) => n.getFirstToken().getStr();
const upper = (s) => String(s).toUpperCase();

/** the ABAP calculation type of a set of operand types: f wins, else i */
const calcOf = (types) => (types.some((t) => t.k === "f") ? F : I);

export function readClass(folder) {
  const reg = new abaplint.Registry();
  for (const f of readdirSync(folder).sort()) {
    reg.addFile(new abaplint.MemoryFile(f, readFileSync(join(folder, f), "utf8")));
  }
  reg.parse();
  const errors = reg.findIssues().filter((i) => i.getKey() === "check_syntax" || i.getKey() === "parser_error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.getMessage()).join("\n"));
  const classes = [];
  for (const obj of reg.getObjects()) {
    if (!(obj instanceof abaplint.Objects.Class)) continue;
    classes.push(classIr(reg, obj));
  }
  return classes;
}

function classIr(reg, obj) {
  const file = obj.getMainABAPFile();
  const def = obj.getDefinition();
  const spaghetti = new abaplint.SyntaxLogic(reg, obj).run().spaghetti;
  const tree = new Rearranger().run("CLAS", file.getStructure());
  const className = upper(obj.getName());

  // signatures first: a call site needs the callee's parameter order and types
  const signatures = new Map();
  for (const m of def.getMethodDefinitions().getAll()) {
    const where = `${className}=>${upper(m.getName())}`;
    if (!m.isStatic()) throw new Unsupported(`${where}: instance methods are outside the subset`);
    const p = m.getParameters();
    if (p.getExporting().length + p.getChanging().length > 0) throw new Unsupported(`${where}: only IMPORTING and RETURNING`);
    const ret = p.getReturning();
    signatures.set(upper(m.getName()), {
      name: upper(m.getName()),
      params: p.getImporting().map((x) => ({name: upper(x.getName()), type: typeOf(x.getType(), where)})),
      returning: ret === undefined ? null : {name: upper(ret.getName()), type: typeOf(ret.getType(), where)},
    });
  }

  const methods = [];
  for (const node of tree.findAllStructures(Structures.Method)) {
    const name = upper(node.findFirstExpression(Expressions.MethodName).concatTokens());
    const sig = signatures.get(name);
    const scope = spaghetti.lookupPosition(node.getFirstToken().getStart(), file.getFilename());
    const vars = scope.getData().vars;
    const known = new Set([...sig.params.map((p) => p.name), sig.returning?.name].filter(Boolean));
    const locals = [];
    const types = new Map();
    for (const p of sig.params) types.set(p.name, p.type);
    if (sig.returning) types.set(sig.returning.name, sig.returning.type);
    for (const [vname, ident] of Object.entries(vars)) {
      if (known.has(vname)) continue;
      const t = typeOf(ident.getType(), `${className}=>${name} ${vname}`);
      locals.push({name: vname, type: t});
      types.set(vname, t);
    }
    locals.sort((a, b) => a.name.localeCompare(b.name));
    const ctx = {className, method: name, types, signatures};
    const body = node.findDirectStructure(Structures.Body);
    methods.push({...sig, locals, body: body === undefined ? [] : block(body, ctx)});
  }
  return {name: className, methods};
}

/* ---------------------------------------------------------------- statements */

function block(node, ctx) {
  const out = [];
  for (const child of node.getChildren()) {
    if (child instanceof Nodes.StructureNode) {
      if (isStruct(child, Structures.Normal) || isStruct(child, Structures.Body)) out.push(...block(child, ctx));
      else out.push(structure(child, ctx));
    } else if (child instanceof Nodes.StatementNode) {
      const s = statement(child, ctx);
      if (s !== undefined) out.push(s);
    }
  }
  return out;
}

function structure(node, ctx) {
  const bodyOf = (n) => {
    const b = n.findDirectStructure(Structures.Body);
    return b === undefined ? [] : block(b, ctx);
  };
  if (isStruct(node, Structures.If)) {
    const branches = [{cond: cond(node.findDirectStatement(Statements.If).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(node)}];
    for (const e of node.findDirectStructures(Structures.ElseIf)) {
      branches.push({cond: cond(e.findDirectStatement(Statements.ElseIf).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(e)});
    }
    const els = node.findDirectStructure(Structures.Else);
    return {s: "if", branches, else: els === undefined ? null : bodyOf(els)};
  }
  if (isStruct(node, Structures.Do)) {
    const st = node.findDirectStatement(Statements.Do);
    if (st.concatTokens().toUpperCase().includes("VARYING")) throw new Unsupported("DO ... VARYING");
    const times = st.findDirectExpression(Expressions.Source);
    return {s: "do", times: times === undefined ? null : convert(source(times, ctx, I), I), body: bodyOf(node)};
  }
  if (isStruct(node, Structures.While)) {
    return {s: "while", cond: cond(node.findDirectStatement(Statements.While).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(node)};
  }
  if (isStruct(node, Structures.Loop)) {
    const st = node.findDirectStatement(Statements.Loop);
    const text = st.concatTokens().toUpperCase();
    if (/\b(WHERE|FROM|TO|ASSIGNING|REFERENCE|GROUP|USING)\b/.test(text)) throw new Unsupported(`LOOP form: ${st.concatTokens()}`);
    const table = variable(st.findFirstExpression(Expressions.LoopSource).concatTokens(), ctx);
    const into = variable(st.findFirstExpression(Expressions.LoopTarget).findFirstExpression(Expressions.Target).concatTokens(), ctx);
    if (table.type.k !== "table" || !sameType(table.type.row, into.type)) throw new Unsupported("LOOP INTO a target of another type");
    return {s: "loop", table: table.name, into: into.name, rowType: into.type, body: bodyOf(node)};
  }
  throw new Unsupported(`structure ${node.get().constructor.name}`);
}

function statement(node, ctx) {
  if (isStmt(node, Statements.Data)) {
    if (node.findDirectExpression(Expressions.Value) !== undefined || /\bVALUE\b/i.test(node.concatTokens())) {
      throw new Unsupported(`DATA with VALUE: ${node.concatTokens()}`);
    }
    return undefined; // declared from the scope, zero-initialised like ABAP's initial value
  }
  if (isStmt(node, Statements.Move)) {
    const targets = node.findDirectExpressions(Expressions.Target);
    if (targets.length !== 1) throw new Unsupported("chained assignment");
    const target = variable(targets[0].concatTokens(), ctx);
    if (target.type.k === "table") throw new Unsupported("table assignment (needs copy-on-write)");
    const src = node.findDirectExpression(Expressions.Source);
    // the calculation type of an assignment includes the TARGET: iv_a / iv_b
    // into an f is computed in f, and into an i in i with rounding
    return {s: "assign", target: target.name, value: convert(source(src, ctx, target.type), target.type)};
  }
  if (isStmt(node, Statements.Append)) {
    const text = node.concatTokens().toUpperCase();
    if (/\b(LINES OF|INITIAL LINE|ASSIGNING|REFERENCE|SORTED BY)\b/.test(text)) throw new Unsupported(`APPEND form: ${node.concatTokens()}`);
    const table = variable(node.findDirectExpression(Expressions.Target).concatTokens(), ctx);
    const value = node.findDirectExpression(Expressions.SimpleSource4);
    return {s: "append", table: table.name, value: convert(source(value, ctx, table.type.row), table.type.row)};
  }
  if (isStmt(node, Statements.ReadTable)) {
    const text = node.concatTokens().toUpperCase();
    if (!/\bINDEX\b/.test(text) || /\b(WITH KEY|ASSIGNING|REFERENCE|TRANSPORTING|BINARY)\b/.test(text)) {
      throw new Unsupported(`READ TABLE form: ${node.concatTokens()}`);
    }
    const table = variable(node.findDirectExpression(Expressions.SimpleSource2).concatTokens(), ctx);
    const index = convert(source(node.findDirectExpression(Expressions.Source), ctx, I), I);
    const into = variable(node.findFirstExpression(Expressions.ReadTableTarget).findFirstExpression(Expressions.Target).concatTokens(), ctx);
    return {s: "read_index", table: table.name, index, into: into.name};
  }
  if (isStmt(node, Statements.Exit)) return {s: "exit"};
  if (isStmt(node, Statements.Continue)) return {s: "continue"};
  if (isStmt(node, Statements.Return)) return {s: "return"};
  if (isStmt(node, Statements.Clear)) {
    const v = variable(node.findDirectExpression(Expressions.Target).concatTokens(), ctx);
    return {s: "clear", target: v.name, type: v.type};
  }
  throw new Unsupported(`statement ${node.get().constructor.name}: ${node.concatTokens()}`);
}

/* --------------------------------------------------------------- expressions */

const sameType = (a, b) => a.k === b.k && (a.k !== "table" || sameType(a.row, b.row));

function variable(text, ctx) {
  const name = upper(text);
  const type = ctx.types.get(name);
  if (type === undefined) throw new Unsupported(`${ctx.method}: ${text} is not a local, parameter or RETURNING`);
  return {name, type};
}

const SY = {"SY-INDEX": "index", "SY-TABIX": "tabix", "SY-SUBRC": "subrc"};
const FUNCTIONS = {SIN: F, COS: F, SQRT: F, EXP: F, LOG: F, ABS: null};

/**
 * Collect the operand types of one arithmetic expression: the leaves of the
 * operator tree, NOT the arguments of a call inside it (an argument is an
 * expression of its own, with its own calculation type).
 */
function leafTypes(node, ctx) {
  const out = [];
  const walk = (n) => {
    for (const c of n.getChildren()) {
      if (isExpr(c, Expressions.Source)) walk(c);
      else if (isExpr(c, Expressions.ArithOperator)) continue;
      else if (c instanceof Nodes.TokenNode) continue;
      else out.push(leafType(c, ctx));
    }
  };
  walk(node);
  return out;
}

function leafType(n, ctx) {
  if (isExpr(n, Expressions.FieldChain) || isExpr(n, Expressions.SourceField)) {
    const text = upper(n.concatTokens());
    if (SY[text] !== undefined) return I;
    return variable(text, ctx).type;
  }
  if (isExpr(n, Expressions.Constant)) {
    if (n.findDirectExpression(Expressions.Integer) !== undefined) return I;
    throw new Unsupported(`literal ${n.concatTokens()}: only integer literals (a text literal makes the calculation type p)`);
  }
  if (isExpr(n, Expressions.MethodCallChain)) return call(n, ctx).type;
  throw new Unsupported(`operand ${n.get().constructor.name}`);
}

/**
 * One Source as IR, with every arithmetic node typed in `calc`. `outer` is the
 * type the value flows into (the target of an assignment, the other side of a
 * comparison) and is part of the calculation type, as in ABAP.
 */
function source(node, ctx, outer) {
  const calc = calcOf([...leafTypes(node, ctx), ...(outer === undefined ? [] : [outer])]);
  return arith(node, ctx, calc);
}

function arith(node, ctx, calc) {
  const kids = node.getChildren();
  // unary sign in front of an operand
  let negate = false;
  let at = 0;
  while (at < kids.length && kids[at] instanceof Nodes.TokenNode && ["-", "+"].includes(tokenStr(kids[at]))) {
    if (tokenStr(kids[at]) === "-") negate = !negate;
    at += 1;
  }
  // the rearranged children are operand (ArithOperator operand)?, where an
  // operand is one node or a parenthesised group `( Source )` of three
  const items = [];
  for (let i = at; i < kids.length; i += 1) {
    const k = kids[i];
    if (k instanceof Nodes.TokenNode && tokenStr(k) === "(") {
      const close = kids[i + 2];
      if (!isExpr(kids[i + 1], Expressions.Source) || !(close instanceof Nodes.TokenNode) || tokenStr(close) !== ")") {
        throw new Unsupported(`parenthesis shape: ${node.concatTokens()}`);
      }
      items.push({group: kids[i + 1]});
      i += 2;
    } else {
      items.push({node: k});
    }
  }
  const value = (item) => (item.group !== undefined ? arith(item.group, ctx, calc) : operand(item.node, ctx, calc));
  let expr;
  if (items.length === 3 && isExpr(items[1].node, Expressions.ArithOperator)) {
    const op = upper(items[1].node.concatTokens());
    if (op === "**") throw new Unsupported("** (power)");
    expr = {e: "bin", op, l: value(items[0]), r: value(items[2]), type: calc};
  } else if (items.length === 1) {
    expr = value(items[0]);
  } else {
    throw new Unsupported(`expression shape: ${node.concatTokens()}`);
  }
  return negate ? {e: "neg", x: expr, type: calc} : expr;
}

/** a leaf or a nested Source, converted into the calculation type */
function operand(n, ctx, calc) {
  if (isExpr(n, Expressions.Source)) return arith(n, ctx, calc);
  if (isExpr(n, Expressions.FieldChain) || isExpr(n, Expressions.SourceField)) {
    const text = upper(n.concatTokens());
    if (SY[text] !== undefined) return convert({e: "sy", field: SY[text], type: I}, calc);
    const v = variable(text, ctx);
    return convert({e: "var", name: v.name, type: v.type}, calc);
  }
  if (isExpr(n, Expressions.Constant)) {
    const int = n.findDirectExpression(Expressions.Integer);
    if (int === undefined) throw new Unsupported(`literal ${n.concatTokens()}`);
    const value = Number(int.concatTokens());
    return calc.k === "f" ? {e: "float", value, type: F} : {e: "int", value, type: I};
  }
  if (isExpr(n, Expressions.MethodCallChain)) return convert(call(n, ctx), calc);
  throw new Unsupported(`operand ${n.get().constructor.name}: ${n.concatTokens()}`);
}

function call(chain, ctx) {
  const mc = chain.findDirectExpression(Expressions.MethodCall);
  const className = chain.findDirectExpression(Expressions.ClassName);
  if (mc === undefined || chain.getChildren().length > (className ? 3 : 1)) throw new Unsupported(`call chain ${chain.concatTokens()}`);
  const name = upper(mc.findDirectExpression(Expressions.MethodName).concatTokens());
  const param = mc.findDirectExpression(Expressions.MethodCallParam);
  const direct = param?.findDirectExpression(Expressions.Source);
  const named = param?.findDirectExpression(Expressions.ParameterListS);

  if (className === undefined && (FUNCTIONS[name] !== undefined || name === "LINES")) {
    if (direct === undefined) throw new Unsupported(`${name}( ) with named arguments`);
    if (name === "LINES") {
      const t = variable(direct.concatTokens(), ctx);
      if (t.type.k !== "table") throw new Unsupported("lines( ) of a non-table");
      return {e: "lines", table: t.name, type: I};
    }
    if (name === "ABS") {
      const arg = source(direct, ctx);
      return {e: "fn", name, args: [arg], type: arg.type};
    }
    return {e: "fn", name, args: [convert(source(direct, ctx, F), F)], type: F};
  }
  if (className !== undefined && upper(className.concatTokens()) !== ctx.className) {
    throw new Unsupported(`call into another class ${className.concatTokens()}`);
  }
  const sig = ctx.signatures.get(name);
  if (sig === undefined) throw new Unsupported(`unknown method ${name}`);
  if (sig.returning === null) throw new Unsupported(`${name} has no RETURNING, cannot be an operand`);
  let args;
  if (direct !== undefined) {
    if (sig.params.length !== 1) throw new Unsupported(`${name}: one unnamed argument for ${sig.params.length} parameters`);
    args = [convert(source(direct, ctx, sig.params[0].type), sig.params[0].type)];
  } else if (named !== undefined) {
    const given = new Map();
    for (const p of named.findDirectExpressions(Expressions.ParameterS)) {
      given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
    }
    args = sig.params.map((p) => {
      const s = given.get(p.name);
      if (s === undefined) throw new Unsupported(`${name}: parameter ${p.name} not supplied (OPTIONAL is outside the subset)`);
      return convert(source(s, ctx, p.type), p.type);
    });
  } else {
    if (sig.params.length !== 0) throw new Unsupported(`${name}: called without its parameters`);
    args = [];
  }
  return {e: "call", method: name, args, type: sig.returning.type};
}

/** an explicit conversion node where the types differ, nothing where they agree */
function convert(expr, to) {
  if (sameType(expr.type, to)) return expr;
  if (expr.type.k === "i" && to.k === "f") return {e: "conv", from: I, to: F, x: expr, type: F};
  if (expr.type.k === "f" && to.k === "i") return {e: "conv", from: F, to: I, x: expr, type: I};
  throw new Unsupported(`conversion ${expr.type.k} -> ${to.k}`);
}

/* ---------------------------------------------------------------- conditions */

function cond(node, ctx) {
  const kids = node.getChildren();
  // Cond is a chain: operand (AND|OR operand)*; AND binds tighter than OR
  const parts = [];
  const ops = [];
  for (const k of kids) {
    if (k instanceof Nodes.TokenNode) ops.push(upper(tokenStr(k)));
    else parts.push(k);
  }
  const one = (n) => {
    if (isExpr(n, Expressions.Compare)) return compare(n, ctx);
    if (isExpr(n, Expressions.CondSub)) {
      const not = n.getChildren().some((c) => c instanceof Nodes.TokenNode && upper(tokenStr(c)) === "NOT");
      const inner = cond(n.findDirectExpression(Expressions.Cond), ctx);
      return not ? {c: "not", x: inner} : inner;
    }
    throw new Unsupported(`condition part ${n.get().constructor.name}`);
  };
  // group ANDs first, then ORs
  let orList = [];
  let current = one(parts[0]);
  for (let i = 0; i < ops.length; i += 1) {
    const next = one(parts[i + 1]);
    if (ops[i] === "AND") current = {c: "and", l: current, r: next};
    else if (ops[i] === "OR") { orList.push(current); current = next; }
    else throw new Unsupported(`condition operator ${ops[i]}`);
  }
  orList.push(current);
  return orList.reduce((l, r) => ({c: "or", l, r}));
}

function compare(node, ctx) {
  const kids = node.getChildren();
  const not = kids.some((c) => c instanceof Nodes.TokenNode && upper(tokenStr(c)) === "NOT");
  const sources = node.findDirectExpressions(Expressions.Source);
  const opNode = node.findDirectExpression(Expressions.CompareOperator);
  if (sources.length !== 2 || opNode === undefined) throw new Unsupported(`comparison ${node.concatTokens()}`);
  const op = ({EQ: "=", NE: "<>", LT: "<", LE: "<=", GT: ">", GE: ">="})[upper(opNode.concatTokens())] ?? upper(opNode.concatTokens());
  if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Unsupported(`comparison operator ${op}`);
  // the comparison type covers both sides
  const calc = calcOf([...leafTypes(sources[0], ctx), ...leafTypes(sources[1], ctx)]);
  const cmp = {c: "cmp", op, l: arith(sources[0], ctx, calc), r: arith(sources[1], ctx, calc), type: calc};
  return not ? {c: "not", x: cmp} : cmp;
}
