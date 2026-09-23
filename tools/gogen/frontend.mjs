// ABAP -> IR, for the Go backend spike (tools/gogen/README.md).
//
// The front half is not ours: @abaplint/core parses, type-checks and builds
// the scopes; the transpiler's Rearranger turns a flat Source into a binary
// tree with ABAP's operator precedence. What this file adds is the IR. Every
// expression carries its type, every arithmetic expression carries the ABAP
// calculation type (the target included, measured on A4H: ANORMALIES), and
// every conversion is an explicit node. A backend has no semantics left to
// decide.
//
// Everything outside the subset is a named refusal (Unsupported), never a
// guess. A method whose body or signature is outside it is skipped and says
// why; a method that calls a skipped one is refused in turn.
import {createRequire} from "node:module";
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {join} from "node:path";

const require = createRequire(import.meta.url);
const abaplint = require("@abaplint/core");
const {Rearranger} = require("@abaplint/transpiler/build/src/rearranger");
const {Nodes, Statements, Structures, Expressions, BasicTypes} = abaplint;

export class Unsupported extends Error {}

export const I = {k: "i"};
export const F = {k: "f"};
export const INT8 = {k: "int8"};
export const S = {k: "string"};
const C = (len) => ({k: "c", len});
const X = (len) => ({k: "x", len});

const isExpr = (n, cls) => n instanceof Nodes.ExpressionNode && n.get() instanceof cls;
const isStmt = (n, cls) => n instanceof Nodes.StatementNode && n.get() instanceof cls;
const isStruct = (n, cls) => n instanceof Nodes.StructureNode && n.get() instanceof cls;
const isTok = (n, s) => n instanceof Nodes.TokenNode && (s === undefined || upper(n.getFirstToken().getStr()) === s);
const tokenStr = (n) => n.getFirstToken().getStr();
const upper = (s) => String(s).toUpperCase();
const goName = (s) => upper(s).replace(/=>|~|-/g, "__").replace(/[^A-Z0-9_]/g, "_");

export const sameType = (a, b) => a.k === b.k && (a.k !== "table" || sameType(a.row, b.row))
  && (a.k !== "struct" || a.go === b.go) && (a.k !== "c" && a.k !== "x" || a.len === b.len)
  && (a.k !== "ref" || a.name === b.name);
const numeric = (t) => t.k === "i" || t.k === "f" || t.k === "int8";
const charlike = (t) => t.k === "c" || t.k === "string";

/* ------------------------------------------------------------------- program */

/**
 * Compile the named classes (and whatever interfaces they implement) out of
 * one or more folders of abapGit files. `files` narrows each folder to the
 * objects wanted, so a big pack can be read without parsing all of it.
 */
export function compileProgram({folders, objects}) {
  const config = abaplint.Config.getDefault().get();
  config.syntax = {...config.syntax, version: "v758", errorNamespace: "."};
  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(config)));
  const wanted = objects.map((o) => o.toLowerCase());
  for (const folder of folders) {
    for (const f of readdirSync(folder).sort()) {
      const base = f.split(".")[0].toLowerCase();
      if (wanted.length > 0 && !wanted.includes(base)) continue;
      reg.addFile(new abaplint.MemoryFile(f, readFileSync(join(folder, f), "utf8")));
    }
  }
  reg.parse();
  const errors = reg.findIssues().filter((i) => i.getKey() === "check_syntax" || i.getKey() === "parser_error");
  if (errors.length > 0) throw new Error(errors.map((e) => `${e.getFilename()}: ${e.getMessage()}`).join("\n"));

  const program = {structs: new Map(), consts: new Map(), classes: [], skipped: []};
  const ctx0 = {reg, program};
  for (const obj of reg.getObjects()) {
    if (obj instanceof abaplint.Objects.Class) program.classes.push(classIr(ctx0, obj));
  }
  return program;
}

/** kept for the numeric bench sample: one folder, every class in it */
export function readClass(folder) {
  const objects = [...new Set(readdirSync(folder).map((f) => f.split(".")[0]))];
  return compileProgram({folders: [folder], objects}).classes;
}

/* --------------------------------------------------------------------- types */

function typeOf(t, where, program) {
  if (t instanceof BasicTypes.IntegerType) return I;
  if (t instanceof BasicTypes.FloatType) return F;
  if (t instanceof BasicTypes.Integer8Type) return INT8;
  if (t instanceof BasicTypes.StringType) return S;
  if (t instanceof BasicTypes.CharacterType) return C(t.getLength());
  if (t instanceof BasicTypes.HexType) return X(t.getLength());
  if (t instanceof BasicTypes.TableType) {
    if (t.getAccessType() !== "STANDARD") throw new Unsupported(`${where}: only STANDARD tables`);
    return {k: "table", row: typeOf(t.getRowType(), where, program)};
  }
  if (t instanceof BasicTypes.StructureType) {
    const comps = t.getComponents();
    const q = t.getQualifiedName();
    const go = q ? goName(q) : `S_${comps.map((c) => c.name).join("_").slice(0, 40).toUpperCase()}`;
    if (!program.structs.has(go)) {
      const st = {k: "struct", go, fields: []};
      program.structs.set(go, st); // before the fields: a struct may nest itself through a table
      st.fields = comps.map((c) => ({name: upper(c.name), type: typeOf(c.type, `${where}-${c.name}`, program)}));
    }
    return {k: "struct", go};
  }
  if (t instanceof BasicTypes.ObjectReferenceType) return {k: "ref", name: upper(t.getIdentifierName())};
  throw new Unsupported(`${where}: type ${t.constructor.name} is outside the subset`);
}

const structOf = (ctx, t) => ctx.program.structs.get(t.go);
const fieldOf = (ctx, t, name, where) => {
  if (t.k !== "struct") throw new Unsupported(`${where}: component ${name} of a non-structure`);
  const f = structOf(ctx, t).fields.find((x) => x.name === upper(name));
  if (f === undefined) throw new Unsupported(`${where}: no component ${name}`);
  return f;
};

/* --------------------------------------------------------------------- class */

function classIr(ctx0, obj) {
  const {reg, program} = ctx0;
  const file = obj.getMainABAPFile();
  const def = obj.getDefinition();
  const spaghetti = new abaplint.SyntaxLogic(reg, obj).run().spaghetti;
  const tree = new Rearranger().run("CLAS", file.getStructure());
  const className = upper(obj.getName());

  // attributes and constants live in the class implementation scope
  const implScope = findScope(spaghetti.getTop(), "class_implementation");
  const defScope = findScope(spaghetti.getTop(), "class_definition");
  const attributes = [];
  const classVars = {...(defScope?.getData().vars ?? {}), ...(implScope?.getData().vars ?? {})};
  for (const [name, id] of Object.entries(classVars)) {
    if (name === "ME" || name === "SUPER") continue;
    const meta = id.getMeta();
    if (id instanceof abaplint.Types.ClassConstant || (meta.includes("read_only") && meta.includes("static") && name.includes("~"))) {
      registerConst(program, name, id, className);
      continue;
    }
    try {
      attributes.push({name, type: typeOf(id.getType(), `${className} ${name}`, program), static: meta.includes("static")});
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      attributes.push({name, unsupported: e.message});
    }
  }

  // signatures: the class's own methods plus the interfaces' it implements
  const signatures = new Map();
  const addSig = (m, prefix, isStatic) => {
    const name = prefix + upper(m.getName());
    const where = `${className}=>${name}`;
    try {
      const p = m.getParameters();
      const param = (x, dir) => ({name: upper(x.getName()), dir, type: typeOf(x.getType(), where, program),
        default: defaultOf(p, x)});
      const ret = p.getReturning();
      signatures.set(name, {
        name, static: isStatic,
        params: [...p.getImporting().map((x) => param(x, "importing")), ...p.getExporting().map((x) => param(x, "exporting")),
          ...p.getChanging().map((x) => param(x, "changing"))],
        returning: ret === undefined ? null : {name: upper(ret.getName()), type: typeOf(ret.getType(), where, program)},
      });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      signatures.set(name, {name, unsupported: e.message});
    }
  };
  for (const m of def.getMethodDefinitions().getAll()) addSig(m, "", m.isStatic());
  for (const intf of def.getImplementing()) {
    const idef = reg.getObject("INTF", intf.name)?.getDefinition();
    if (idef === undefined) throw new Unsupported(`${className}: interface ${intf.name} not in the program`);
    const all = idef.getMethodDefinitions();
    for (const m of (Array.isArray(all) ? all : all.getAll())) addSig(m, `${upper(intf.name)}~`, false);
  }

  const cls = {name: className, attributes, methods: [], constructor: null};
  for (const node of tree.findAllStructures(Structures.Method)) {
    const name = upper(node.findFirstExpression(Expressions.MethodName).concatTokens());
    const sig = signatures.get(name);
    const skip = (why) => { program.skipped.push(`${className}=>${name}: ${why}`); signatures.set(name, {name, unsupported: why}); };
    if (sig === undefined) { skip("no signature"); continue; }
    if (sig.unsupported) { skip(sig.unsupported); continue; }
    try {
      const scope = spaghetti.lookupPosition(node.getFirstToken().getStart(), file.getFilename());
      const ctx = {program, reg, className, method: name, sig, signatures, scope, file, spaghetti, locals: new Map(), temps: 0};
      const known = new Set([...sig.params.map((p) => p.name), sig.returning?.name].filter(Boolean));
      for (const [vname, id] of Object.entries(scope.getData().vars)) {
        if (known.has(vname)) continue;
        ctx.locals.set(vname, typeOf(id.getType(), `${className}=>${name} ${vname}`, program));
      }
      const body = node.findDirectStructure(Structures.Body);
      const compiled = body === undefined ? [] : block(body, ctx);
      const ir = {...sig, locals: [...ctx.locals].map(([n, t]) => ({name: n, type: t})).sort((a, b) => a.name.localeCompare(b.name)),
        body: compiled, calls: ctx.calls ?? []};
      if (name === "CONSTRUCTOR") cls.constructor = ir; else cls.methods.push(ir);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skip(e.message);
    }
  }
  // a compiled method that calls one that did not compile cannot run
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of cls.methods) {
      const bad = m.calls?.find((c) => signatures.get(c)?.unsupported);
      if (bad && !m.dropped) {
        m.dropped = true; changed = true;
        program.skipped.push(`${className}=>${m.name}: calls ${bad}, which was skipped`);
        signatures.set(m.name, {name: m.name, unsupported: `calls ${bad}`});
      }
    }
  }
  cls.methods = cls.methods.filter((m) => !m.dropped);
  return cls;
}

function findScope(node, stype) {
  if (node.getIdentifier().stype === stype) return node;
  for (const c of node.getChildren()) {
    const f = findScope(c, stype);
    if (f) return f;
  }
  return undefined;
}

function defaultOf(params, x) {
  const d = params.getParameterDefault?.(x.getName());
  return d === undefined ? undefined : d.concatTokens();
}

/** an interface or class constant, by its ABAP name (ZIF_X~C_Y) */
function registerConst(program, name, id, className) {
  const go = goName(name.includes("~") ? name : `${className}=>${name}`);
  if (program.consts.has(go)) return go;
  let type;
  try { type = typeOf(id.getType(), name, program); } catch (e) { if (e instanceof Unsupported) return undefined; throw e; }
  let value = id.getValue?.();
  if (typeof value !== "string" && typeof value !== "number") return undefined; // structured constants: not yet
  value = String(value).replace(/^'(.*)'$/s, "$1").replace(/^`(.*)`$/s, "$1");
  program.consts.set(go, {go, type, value});
  return go;
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

const bodyOf = (n, ctx) => {
  const b = n.findDirectStructure(Structures.Body);
  return b === undefined ? [] : block(b, ctx);
};

function structure(node, ctx) {
  if (isStruct(node, Structures.If)) {
    const branches = [{cond: cond(node.findDirectStatement(Statements.If).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(node, ctx)}];
    for (const e of node.findDirectStructures(Structures.ElseIf)) {
      branches.push({cond: cond(e.findDirectStatement(Statements.ElseIf).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(e, ctx)});
    }
    const els = node.findDirectStructure(Structures.Else);
    return {s: "if", branches, else: els === undefined ? null : bodyOf(els, ctx)};
  }
  if (isStruct(node, Structures.Case)) {
    const subjectNode = node.findDirectStatement(Statements.Case).findDirectExpression(Expressions.Source);
    const subject = source(subjectNode, ctx);
    const tmp = `case${ctx.temps++}`;
    const branches = [];
    let others = null;
    for (const w of node.findDirectStructures(Structures.When)) {
      const st = w.findDirectStatement(Statements.When) ?? w.findDirectStatement(Statements.WhenOthers);
      if (st.get() instanceof Statements.WhenOthers || /\bOTHERS\b/i.test(st.concatTokens())) { others = bodyOf(w, ctx); continue; }
      const values = st.findDirectExpressions(Expressions.Source).map((s) => source(s, ctx));
      const conds = values.map((v) => compareValues("=", {e: "temp", name: tmp, type: subject.type}, v, ctx));
      branches.push({cond: conds.reduce((l, r) => ({c: "or", l, r})), body: bodyOf(w, ctx)});
    }
    return {s: "case", temp: tmp, subject, branches, else: others};
  }
  if (isStruct(node, Structures.Do)) {
    const st = node.findDirectStatement(Statements.Do);
    if (/\bVARYING\b/i.test(st.concatTokens())) throw new Unsupported("DO ... VARYING");
    const times = st.findDirectExpression(Expressions.Source);
    return {s: "do", times: times === undefined ? null : convert(source(times, ctx, I), I), body: bodyOf(node, ctx)};
  }
  if (isStruct(node, Structures.While)) {
    return {s: "while", cond: cond(node.findDirectStatement(Statements.While).findDirectExpression(Expressions.Cond), ctx), body: bodyOf(node, ctx)};
  }
  if (isStruct(node, Structures.Loop)) {
    const st = node.findDirectStatement(Statements.Loop);
    if (/\b(WHERE|FROM|TO|ASSIGNING|REFERENCE|GROUP|USING)\b/i.test(st.concatTokens())) throw new Unsupported(`LOOP form: ${st.concatTokens()}`);
    const table = sourceOperand(st.findFirstExpression(Expressions.LoopSource).getFirstChild().getFirstChild(), ctx);
    const into = lvalue(st.findFirstExpression(Expressions.LoopTarget).findFirstExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("LOOP over a non-table");
    return {s: "loop", table, into, rowType: table.type.row, body: bodyOf(node, ctx)};
  }
  throw new Unsupported(`structure ${node.get().constructor.name}`);
}

function statement(node, ctx) {
  const text = node.concatTokens();
  if (isStmt(node, Statements.Data)) {
    if (/\bVALUE\b/i.test(text)) throw new Unsupported(`DATA with VALUE: ${text}`);
    return undefined; // declared from the scope, initial like ABAP
  }
  if (isStmt(node, Statements.Move)) {
    const targets = node.findDirectExpressions(Expressions.Target);
    if (targets.length !== 1) throw new Unsupported("chained assignment");
    const target = lvalue(targets[0], ctx);
    const src = node.findDirectExpression(Expressions.Source);
    // the calculation type of an assignment includes the TARGET
    return {s: "assign", target, value: convert(source(src, ctx, target.type), target.type)};
  }
  if (isStmt(node, Statements.Append)) {
    if (/\b(LINES OF|INITIAL LINE|ASSIGNING|REFERENCE|SORTED BY)\b/i.test(text)) throw new Unsupported(`APPEND form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("APPEND to a non-table");
    const value = node.findDirectExpression(Expressions.SimpleSource4) ?? node.findDirectExpression(Expressions.Source);
    return {s: "append", table, value: convert(source(value, ctx, table.type.row), table.type.row)};
  }
  if (isStmt(node, Statements.ReadTable)) {
    if (!/\bINDEX\b/i.test(text) || /\b(WITH KEY|ASSIGNING|REFERENCE|TRANSPORTING|BINARY)\b/i.test(text)) {
      throw new Unsupported(`READ TABLE form: ${text}`);
    }
    const table = sourceOperand(node.findDirectExpression(Expressions.SimpleSource2).getFirstChild(), ctx);
    const index = convert(source(node.findDirectExpression(Expressions.Source), ctx, I), I);
    const into = lvalue(node.findFirstExpression(Expressions.ReadTableTarget).findFirstExpression(Expressions.Target), ctx);
    return {s: "read_index", table, index, into};
  }
  if (isStmt(node, Statements.Translate)) {
    const m = /\bTO\s+(UPPER|LOWER)\s+CASE\b/i.exec(text);
    if (m === null) throw new Unsupported(`TRANSLATE form: ${text}`);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (!charlike(target.type)) throw new Unsupported("TRANSLATE of a non-character field");
    return {s: "translate", target, upper: upper(m[1]) === "UPPER"};
  }
  if (isStmt(node, Statements.Call)) {
    const chain = node.findDirectExpression(Expressions.MethodCallChain);
    if (chain === undefined) throw new Unsupported(`CALL form: ${text}`);
    return {s: "call", call: call(chain, ctx, true)};
  }
  if (isStmt(node, Statements.Exit)) return {s: "exit"};
  if (isStmt(node, Statements.Continue)) return {s: "continue"};
  if (isStmt(node, Statements.Return)) return {s: "return"};
  if (isStmt(node, Statements.Clear)) return {s: "clear", target: lvalue(node.findDirectExpression(Expressions.Target), ctx)};
  throw new Unsupported(`statement ${node.get().constructor.name}: ${text}`);
}

/* ------------------------------------------------------------ names, lvalues */

/**
 * Where an ABAP name lives: a local, a parameter (EXPORTING and CHANGING are
 * pointers in Go), an attribute of the instance, a static attribute or a
 * constant. The IR says which; the backend spells it.
 */
function variable(name, ctx) {
  const n = upper(name);
  const p = ctx.sig.params.find((x) => x.name === n);
  if (p) return {e: "var", name: n, type: p.type, ref: p.dir !== "importing"};
  if (ctx.sig.returning?.name === n) return {e: "var", name: n, type: ctx.sig.returning.type};
  if (ctx.locals.has(n)) return {e: "var", name: n, type: ctx.locals.get(n)};
  const attr = findAttribute(ctx, n);
  if (attr) return attr;
  throw new Unsupported(`${ctx.method}: ${name} is not a local, parameter or attribute of the subset`);
}

function findAttribute(ctx, n) {
  // instance and static attributes are declared in the class definition's
  // scope, constants and interface constants show in the implementation's
  const impl = findScope(ctx.spaghetti.getTop(), "class_implementation");
  const defs = findScope(ctx.spaghetti.getTop(), "class_definition");
  const id = impl?.getData().vars[n] ?? defs?.getData().vars[n];
  if (id === undefined) return undefined;
  if (id instanceof abaplint.Types.ClassConstant || n.includes("~")) {
    const go = registerConst(ctx.program, n, id, ctx.className);
    if (go === undefined) throw new Unsupported(`constant ${n} is outside the subset`);
    return {e: "const", go, type: ctx.program.consts.get(go).type};
  }
  const type = typeOf(id.getType(), `${ctx.className} ${n}`, ctx.program);
  if (id.getMeta().includes("static")) return {e: "static", go: goName(`${ctx.className}=>${n}`), type};
  return {e: "attr", name: n, type};
}

/** a Target (or InlineData) as an assignable place */
function lvalue(target, ctx) {
  const kids = target.getChildren();
  let place;
  let i = 0;
  const first = kids[0];
  if (isExpr(first, Expressions.InlineData)) {
    place = variable(first.findFirstExpression(Expressions.TargetField).concatTokens(), ctx);
    i = 1;
  } else if (isExpr(first, Expressions.TargetField)) {
    place = variable(first.concatTokens(), ctx);
    i = 1;
  } else if (isTok(first, "ME")) {
    if (!isTok(kids[1], "->")) throw new Unsupported(`target ${target.concatTokens()}`);
    place = {e: "attr", name: upper(kids[2].concatTokens()), type: findAttribute(ctx, upper(kids[2].concatTokens())).type};
    i = 3;
  } else {
    throw new Unsupported(`target ${target.concatTokens()}`);
  }
  for (; i < kids.length; i += 1) {
    if (isTok(kids[i], "-") && isExpr(kids[i + 1], Expressions.ComponentName)) {
      const f = fieldOf(ctx, place.type, kids[i + 1].concatTokens(), target.concatTokens());
      place = {e: "field", base: place, name: f.name, type: f.type};
      i += 1;
    } else {
      throw new Unsupported(`target ${target.concatTokens()}`);
    }
  }
  return place;
}

/* --------------------------------------------------------------- expressions */

const SY = {"SY-INDEX": "Index", "SY-TABIX": "Tabix", "SY-SUBRC": "Subrc"};
const CONSTRUCTORS = new Set(["VALUE", "CONV", "NEW", "REF", "COND", "SWITCH", "EXACT", "CORRESPONDING", "REDUCE", "FILTER", "CAST", "BOOLC", "XSDBOOL"]);

/**
 * The children of one Source, split into operands and operators. An operand
 * is one node, a parenthesised group `( Source )`, or a constructor
 * expression `CONV t( ... )` / `VALUE t( ... )`, which the parser leaves
 * inline in the same Source as the operator after it: `CONV f( w ) / 2` is
 * one Source of seven children.
 */
function items(node) {
  const kids = node.getChildren();
  const out = [];
  for (let i = 0; i < kids.length; i += 1) {
    const k = kids[i];
    if (isTok(k) && CONSTRUCTORS.has(upper(tokenStr(k))) && isExpr(kids[i + 1], Expressions.TypeNameOrInfer)) {
      // KW type ( body ) -- the body may be absent: VALUE #( )
      let j = i + 2;
      if (!isTok(kids[j]) || tokenStr(kids[j]) !== "(") throw new Unsupported(`constructor shape: ${node.concatTokens()}`);
      let body = null;
      if (!(isTok(kids[j + 1]) && tokenStr(kids[j + 1]) === ")")) { body = kids[j + 1]; j += 1; }
      if (!isTok(kids[j + 1]) || tokenStr(kids[j + 1]) !== ")") throw new Unsupported(`constructor shape: ${node.concatTokens()}`);
      out.push({ctor: {kw: upper(tokenStr(k)), typeNode: kids[i + 1], body, text: node.concatTokens()}});
      i = j + 1;
    } else if (isTok(k) && tokenStr(k) === "(") {
      const close = kids[i + 2];
      if (!isExpr(kids[i + 1], Expressions.Source) || !isTok(close) || tokenStr(close) !== ")") throw new Unsupported(`parenthesis: ${node.concatTokens()}`);
      out.push({group: kids[i + 1]});
      i += 2;
    } else if (isExpr(k, Expressions.ArithOperator)) {
      out.push({op: upper(k.concatTokens())});
    } else if (isTok(k) && ["&&", "&"].includes(tokenStr(k))) {
      out.push({concat: true});
    } else if (isTok(k) && ["-", "+"].includes(tokenStr(k)) && out.length === 0) {
      out.push({sign: tokenStr(k)});
    } else {
      out.push({node: k});
    }
  }
  return out;
}

/** the leaves of one arithmetic expression: calls count as leaves, their arguments do not */
function leafTypes(node, ctx) {
  const out = [];
  const walk = (n) => {
    for (const it of items(n)) {
      if (it.ctor) out.push(constructor(it.ctor, ctx).type);
      else if (it.group) walk(it.group);
      else if (it.node && isExpr(it.node, Expressions.Source)) walk(it.node);
      else if (it.node) out.push(sourceOperand(it.node, ctx).type);
    }
  };
  walk(node);
  return out;
}

const hasArith = (node) => node.getChildren().some((c) => isExpr(c, Expressions.ArithOperator)
  || (isExpr(c, Expressions.Source) && hasArith(c)));

/**
 * One Source as IR. When it is arithmetic, every operator runs in the
 * calculation type of all its leaves plus `outer` (the target, or the other
 * side of a comparison), as ABAP computes it.
 */
function source(node, ctx, outer) {
  if (!hasArith(node)) return arith(node, ctx, undefined);
  const types = [...leafTypes(node, ctx), ...(outer === undefined ? [] : [outer])];
  if (types.some((t) => t.k === "f")) return arith(node, ctx, F);
  if (types.some((t) => t.k === "c" || t.k === "string" || t.k === "x")) {
    throw new Unsupported(`calculation type p (a character operand and no f): ${node.concatTokens()}`);
  }
  if (types.some((t) => t.k === "int8")) return arith(node, ctx, INT8);
  if (types.every((t) => t.k === "i")) return arith(node, ctx, I);
  throw new Unsupported(`calculation type of ${node.concatTokens()}`);
}

function arith(node, ctx, calc) {
  const its = items(node);
  let negate = false;
  while (its.length > 0 && its[0].sign !== undefined) {
    if (its.shift().sign === "-") negate = !negate;
  }
  const value = (item, t) => {
    if (item.ctor) { const v = constructor(item.ctor, ctx); return t === undefined ? v : convert(v, t); }
    if (item.group !== undefined) return arith(item.group, ctx, t);
    if (isExpr(item.node, Expressions.Source)) return arith(item.node, ctx, t);
    const v = sourceOperand(item.node, ctx);
    return t === undefined ? v : convert(v, t);
  };
  let expr;
  if (its.length === 3 && its[1].concat) {
    expr = {e: "concat", l: convert(value(its[0]), S), r: convert(value(its[2]), S), type: S};
  } else if (its.length === 3 && its[1].op !== undefined) {
    const op = its[1].op;
    if (op === "**") throw new Unsupported("** (power)");
    if (calc === undefined) throw new Unsupported(`arithmetic without a calculation type: ${node.concatTokens()}`);
    expr = {e: "bin", op, l: value(its[0], calc), r: value(its[2], calc), type: calc};
  } else if (its.length === 1) {
    expr = value(its[0], calc);
  } else {
    throw new Unsupported(`expression shape: ${node.concatTokens()}`);
  }
  if (!negate) return expr;
  if (!numeric(expr.type)) throw new Unsupported("unary minus on a non-number");
  return {e: "neg", x: expr, type: expr.type};
}

/** one operand: a field chain, a literal, a call, a template, a constructor */
function sourceOperand(n, ctx) {
  if (isExpr(n, Expressions.Source)) return source(n, ctx);
  if (isExpr(n, Expressions.FieldChain) || isExpr(n, Expressions.SourceField)) return fieldChain(n, ctx);
  if (isExpr(n, Expressions.Constant)) {
    const int = n.findDirectExpression(Expressions.Integer);
    if (int !== undefined) {
      const value = Number(int.concatTokens());
      if (!Number.isSafeInteger(value) || Math.abs(value) > 2147483647) throw new Unsupported(`integer literal ${value}`);
      return {e: "int", value, type: I};
    }
    const text = n.concatTokens();
    if (text.startsWith("'")) {
      const v = text.slice(1, -1).replaceAll("''", "'");
      return {e: "chars", value: v.replace(/ +$/, ""), type: C(Math.max(1, v.length))};
    }
    if (text.startsWith("`")) return {e: "str", value: text.slice(1, -1).replaceAll("``", "`"), type: S};
    throw new Unsupported(`literal ${text}`);
  }
  if (isExpr(n, Expressions.MethodCallChain)) return call(n, ctx, false);
  if (isExpr(n, Expressions.StringTemplate)) return template(n, ctx);
  throw new Unsupported(`operand ${n.get().constructor.name}: ${n.concatTokens()}`);
}

function fieldChain(n, ctx) {
  const kids = isExpr(n, Expressions.SourceField) ? [n] : n.getChildren();
  const text = upper(n.concatTokens());
  if (SY[text] !== undefined) return {e: "sy", field: SY[text], type: I};
  if (text === "ABAP_TRUE") return {e: "chars", value: "X", type: C(1)};
  if (text === "ABAP_FALSE") return {e: "chars", value: "", type: C(1)};
  let place;
  let i = 0;
  if (isExpr(kids[0], Expressions.ClassName) && isTok(kids[1], "=>")) {
    const owner = upper(kids[0].concatTokens());
    const attr = upper(kids[2].concatTokens());
    place = resolveStatic(owner, attr, ctx);
    i = 3;
  } else if (isExpr(kids[0], Expressions.SourceField)) {
    place = variable(kids[0].concatTokens(), ctx);
    i = 1;
  } else if (isTok(kids[0], "ME") || (isExpr(kids[0], Expressions.SourceField) && upper(kids[0].concatTokens()) === "ME")) {
    place = {e: "attr", name: upper(kids[2].concatTokens()), type: findAttribute(ctx, upper(kids[2].concatTokens())).type};
    i = 3;
  } else {
    throw new Unsupported(`field chain ${n.concatTokens()}`);
  }
  for (; i < kids.length; i += 1) {
    if (isTok(kids[i], "-") && isExpr(kids[i + 1], Expressions.ComponentName)) {
      const f = fieldOf(ctx, place.type, kids[i + 1].concatTokens(), n.concatTokens());
      place = {e: "field", base: place, name: f.name, type: f.type};
      i += 1;
    } else if (isTok(kids[i], "->") && upper(kids[i - 1].concatTokens()) === "ME") {
      place = {e: "attr", name: upper(kids[i + 1].concatTokens()), type: findAttribute(ctx, upper(kids[i + 1].concatTokens())).type};
      i += 1;
    } else {
      throw new Unsupported(`field chain ${n.concatTokens()}`);
    }
  }
  return place;
}

/** zif_x=>c_y or zcl_x=>attr */
function resolveStatic(owner, attr, ctx) {
  const intf = ctx.reg.getObject("INTF", owner)?.getDefinition();
  const clas = ctx.reg.getObject("CLAS", owner)?.getDefinition();
  const def = intf ?? clas;
  if (def === undefined) throw new Unsupported(`${owner}=>${attr}: ${owner} is not in the program`);
  const c = def.getAttributes().getConstants().find((x) => upper(x.getName()) === attr);
  if (c !== undefined) {
    const go = registerConst(ctx.program, `${owner}~${attr}`, c, owner);
    if (go === undefined) throw new Unsupported(`constant ${owner}=>${attr} is outside the subset`);
    return {e: "const", go, type: ctx.program.consts.get(go).type};
  }
  if (owner === ctx.className) {
    const a = findAttribute(ctx, attr);
    if (a) return a;
  }
  throw new Unsupported(`${owner}=>${attr}`);
}

/* ------------------------------------------------------------- constructors */

function namedType(typeNode, ctx, inferred) {
  if (typeNode === undefined) throw new Unsupported("a constructor without a type");
  const text = typeNode.concatTokens();
  if (text === "#") {
    if (inferred === undefined) throw new Unsupported("# without a type to infer from here");
    return inferred;
  }
  const t = upper(text);
  const builtin = {I, F, STRING: S, INT8, D: C(8), T: C(6)}[t];
  if (builtin) return builtin;
  const m = /^(\w+)=>(\w+)$/.exec(t);
  if (m) {
    const owner = ctx.reg.getObject("INTF", m[1])?.getDefinition() ?? ctx.reg.getObject("CLAS", m[1])?.getDefinition();
    const td = owner?.getTypeDefinitions().getByName(m[2]);
    if (td === undefined) throw new Unsupported(`type ${text}`);
    return typeOf(td.getType(), text, ctx.program);
  }
  throw new Unsupported(`type ${text}`);
}

function constructor(c, ctx, inferred) {
  if (c.kw === "CONV") {
    const to = namedType(c.typeNode, ctx, inferred);
    if (c.body === null || c.body.getChildren().length !== 1) throw new Unsupported(`CONV with LET or empty: ${c.text}`);
    // the type of CONV takes part in the calculation type of its argument
    return convert(source(c.body.findDirectExpression(Expressions.Source), ctx, to), to);
  }
  if (c.kw === "VALUE") {
    const to = namedType(c.typeNode, ctx, inferred);
    return valueBody(c.body, to, ctx, c.text);
  }
  throw new Unsupported(`${c.kw} constructor expression`);
}

function valueBody(body, to, ctx, text) {
  if (to.k !== "struct") throw new Unsupported(`VALUE for a ${to.k}: ${text}`);
  const fields = [];
  for (const c of body?.getChildren() ?? []) {
    if (!isExpr(c, Expressions.FieldAssignment)) throw new Unsupported(`VALUE body: ${text}`);
    const name = upper(c.findDirectExpression(Expressions.FieldSub).concatTokens());
    if (name.includes("-")) throw new Unsupported(`VALUE with a nested component path: ${name}`);
    const f = fieldOf(ctx, to, name, text);
    const src = c.findDirectExpression(Expressions.Source);
    const its = items(src);
    let v;
    if (its.length === 1 && its[0].ctor && its[0].ctor.typeNode.concatTokens() === "#") {
      v = constructor(its[0].ctor, ctx, f.type);
    } else {
      v = convert(source(src, ctx, f.type), f.type);
    }
    fields.push({name, value: v});
  }
  return {e: "struct", type: to, fields};
}

/* ------------------------------------------------------------------- templates */

function templateText(raw) {
  const t = raw.replace(/^[|}]/, "").replace(/[{|]$/, "");
  return t.replace(/\\([{}|\\nrt])/g, (m, c) => ({n: "\n", r: "\r", t: "\t"})[c] ?? c);
}

function template(n, ctx) {
  const parts = [];
  for (const c of n.getChildren()) {
    if (c instanceof Nodes.TokenNode) {
      const txt = templateText(tokenStr(c));
      if (txt !== "") parts.push({text: txt});
    } else if (isExpr(c, Expressions.StringTemplateSource)) {
      if (c.findDirectExpression(Expressions.StringTemplateFormatting)) throw new Unsupported(`template formatting option: ${c.concatTokens()}`);
      const v = source(c.findDirectExpression(Expressions.Source), ctx);
      // f: seventeen significant digits, positional, measured on A4H (abap.FmtF)
      if (!["i", "int8", "f", "string", "c", "x"].includes(v.type.k)) throw new Unsupported(`${v.type.k} in a string template`);
      parts.push({value: v});
    } else {
      throw new Unsupported(`template part ${c.get().constructor.name}`);
    }
  }
  return {e: "template", parts, type: S};
}

/* ------------------------------------------------------------------------ calls */

const FUNCTIONS = {
  SIN: "f", COS: "f", TAN: "f", SQRT: "f", EXP: "f", LOG: "f", LOG10: "f",
  ABS: "same", SIGN: "same", FLOOR: "same", CEIL: "same", TRUNC: "same", FRAC: "same",
  NMAX: "max", NMIN: "max",
};

function call(chain, ctx, statement) {
  const kids = chain.getChildren();
  let receiver = null;
  let mc;
  if (kids.length === 1 && isExpr(kids[0], Expressions.MethodCall)) {
    mc = kids[0];
  } else if (kids.length === 3 && isExpr(kids[0], Expressions.ClassName) && isTok(kids[1], "=>") && isExpr(kids[2], Expressions.MethodCall)) {
    if (upper(kids[0].concatTokens()) !== ctx.className) throw new Unsupported(`call into another class ${kids[0].concatTokens()}`);
    mc = kids[2];
  } else if (kids.length === 3 && upper(kids[0].concatTokens()) === "ME" && isTok(kids[1], "->")) {
    mc = kids[2];
  } else {
    throw new Unsupported(`call chain ${chain.concatTokens()}`);
  }
  const name = upper(mc.findDirectExpression(Expressions.MethodName).concatTokens());
  const param = mc.findDirectExpression(Expressions.MethodCallParam);
  const direct = param?.findDirectExpression(Expressions.Source);
  const named = param?.findDirectExpression(Expressions.ParameterListS);
  const full = param?.findDirectExpression(Expressions.MethodParameters);

  if (receiver === null && FUNCTIONS[name] !== undefined && !ctx.signatures.has(name)) return builtin(name, direct, named, ctx);
  if (receiver === null && name === "LINES" && !ctx.signatures.has(name)) {
    const t = source(direct, ctx);
    if (t.type.k !== "table") throw new Unsupported("lines( ) of a non-table");
    return {e: "lines", table: t, type: I};
  }
  if (receiver === null && name === "STRLEN" && !ctx.signatures.has(name)) {
    return {e: "strlen", x: source(direct, ctx), type: I};
  }
  const sig = ctx.signatures.get(name);
  if (sig === undefined) throw new Unsupported(`unknown method ${name}`);
  if (sig.unsupported) throw new Unsupported(`${name} was skipped: ${sig.unsupported}`);
  if (!statement && sig.returning === null) throw new Unsupported(`${name} has no RETURNING, cannot be an operand`);
  const importing = sig.params.filter((p) => p.dir === "importing");
  const given = new Map();
  const targets = new Map();
  if (direct !== undefined) {
    if (importing.length < 1) throw new Unsupported(`${name}: an argument for no parameter`);
    given.set(importing.filter((p) => p.default === undefined)[0]?.name ?? importing[0].name, direct);
  } else if (named !== undefined) {
    for (const p of named.findDirectExpressions(Expressions.ParameterS)) {
      given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
    }
  } else if (full !== undefined) {
    const text = full.concatTokens();
    if (/\b(CHANGING|RECEIVING|EXCEPTIONS)\b/i.test(text)) throw new Unsupported(`call with ${text}`);
    const exp = full.findDirectExpression(Expressions.MethodParameters) ?? full;
    for (const list of full.findAllExpressions(Expressions.ParameterListS)) {
      for (const p of list.findDirectExpressions(Expressions.ParameterS)) {
        given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
      }
    }
    for (const list of full.findAllExpressions(Expressions.ParameterListT)) {
      for (const p of list.findDirectExpressions(Expressions.ParameterT)) {
        targets.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), lvalue(p.findDirectExpression(Expressions.Target), ctx));
      }
    }
    void exp;
  }
  const args = sig.params.map((p) => {
    if (p.dir === "importing") {
      const s = given.get(p.name);
      if (s === undefined) {
        if (p.default === undefined) throw new Unsupported(`${name}: parameter ${p.name} not supplied`);
        return {dir: "importing", value: defaultValue(p, ctx)};
      }
      return {dir: "importing", value: convert(source(s, ctx, p.type), p.type)};
    }
    const t = targets.get(p.name);
    if (t === undefined) return {dir: p.dir, place: null, type: p.type};
    if (!sameType(t.type, p.type)) throw new Unsupported(`${name}: IMPORTING ${p.name} into a ${t.type.k}, the parameter is ${p.type.k}`);
    return {dir: p.dir, place: t, type: p.type};
  });
  if (!sig.static && ctx.sig.static) throw new Unsupported(`${name}: an instance method called from a static one`);
  (ctx.calls = ctx.calls ?? []).push(name);
  return {e: "call", method: name, static: sig.static, args, type: sig.returning?.type ?? {k: "void"}};
}

function defaultValue(p, ctx) {
  const t = p.default;
  if (/^-?\d+$/.test(t)) return convert({e: "int", value: Number(t), type: I}, p.type);
  if (/^'.*'$/s.test(t)) return convert({e: "chars", value: t.slice(1, -1), type: C(Math.max(1, t.length - 2))}, p.type);
  throw new Unsupported(`DEFAULT ${t}`);
}

function builtin(name, direct, named, ctx) {
  const kind = FUNCTIONS[name];
  if (kind === "max") {
    if (named === undefined) throw new Unsupported(`${name}( ) without val1 / val2`);
    const vals = named.findDirectExpressions(Expressions.ParameterS).map((p) => source(p.findDirectExpression(Expressions.Source), ctx));
    const t = vals.some((v) => v.type.k === "f") ? F : vals.every((v) => v.type.k === "i") ? I : null;
    if (t === null) throw new Unsupported(`${name}( ) over ${vals.map((v) => v.type.k).join(",")}`);
    return {e: "fn", name, args: vals.map((v) => convert(v, t)), type: t};
  }
  const argNode = direct ?? named?.findDirectExpressions(Expressions.ParameterS).find((p) => upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()) === "VAL")?.findDirectExpression(Expressions.Source);
  if (argNode === undefined) throw new Unsupported(`${name}( ) arguments`);
  if (kind === "f") return {e: "fn", name, args: [convert(source(argNode, ctx, F), F)], type: F};
  const arg = source(argNode, ctx);
  if (!numeric(arg.type)) throw new Unsupported(`${name}( ) of a ${arg.type.k}`);
  return {e: "fn", name, args: [arg], type: arg.type};
}

/* ------------------------------------------------------------------- conversion */

/**
 * An explicit conversion node where the types differ, nothing where they
 * agree. The kinds are the ones ABAP's conversion rules separate; a pair
 * that is not listed is refused, not approximated.
 */
export function convert(expr, to) {
  const from = expr.type;
  if (sameType(from, to)) return expr;
  const ok = (kind) => ({e: "conv", kind, from, to, x: expr, type: to});
  if (numeric(from) && numeric(to)) return ok("num");
  if (to.k === "string" && from.k === "c") return ok("c2s");
  if (to.k === "c" && charlike(from)) return ok("s2c");
  // i -> string and x -> string are conversion rules not measured yet (the
  // sign of an i goes to the END there, unlike in a template): refused
  // until an A4H probe says what they give
  if (to.k === "x" && from.k === "i") return ok("i2x");
  if (numeric(to) && charlike(from)) return ok("c2n");
  if (to.k === "table" && from.k === "table" && sameType(from.row, to.row)) return expr;
  throw new Unsupported(`conversion ${from.k} -> ${to.k}`);
}

/* ---------------------------------------------------------------- conditions */

function cond(node, ctx) {
  const parts = [];
  const ops = [];
  for (const k of node.getChildren()) {
    if (k instanceof Nodes.TokenNode) ops.push(upper(tokenStr(k)));
    else parts.push(k);
  }
  const one = (n) => {
    if (isExpr(n, Expressions.Compare)) return compare(n, ctx);
    if (isExpr(n, Expressions.CondSub)) {
      const not = n.getChildren().some((c) => isTok(c, "NOT"));
      const inner = cond(n.findDirectExpression(Expressions.Cond), ctx);
      return not ? {c: "not", x: inner} : inner;
    }
    throw new Unsupported(`condition part ${n.get().constructor.name}`);
  };
  const orList = [];
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

const OPS = {EQ: "=", NE: "<>", LT: "<", LE: "<=", GT: ">", GE: ">="};

function compare(node, ctx) {
  const kids = node.getChildren();
  const not = kids.some((c) => isTok(c, "NOT"));
  const sources = node.findDirectExpressions(Expressions.Source);
  const text = upper(node.concatTokens());
  if (/\bIS\s+(NOT\s+)?INITIAL\b/.test(text) && sources.length === 1) {
    const v = source(sources[0], ctx);
    const r = {c: "initial", x: v};
    return /\bIS\s+NOT\s+INITIAL\b/.test(text) !== not ? {c: "not", x: r} : r;
  }
  const opNode = node.findDirectExpression(Expressions.CompareOperator);
  if (sources.length !== 2 || opNode === undefined) throw new Unsupported(`comparison ${node.concatTokens()}`);
  const opText = upper(opNode.concatTokens());
  const op = OPS[opText] ?? opText;
  if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Unsupported(`comparison operator ${op}`);
  const types = [...leafTypes(sources[0], ctx), ...leafTypes(sources[1], ctx)];
  let r;
  if (types.some(numeric)) {
    // numbers compare numerically; a character operand is converted to the
    // numeric type (f when any operand is f)
    const calc = types.some((t) => t.k === "f") ? F : types.some((t) => t.k === "int8") ? INT8 : I;
    if (types.some(charlike) && calc.k !== "f") throw new Unsupported(`comparison of i with characters: ${node.concatTokens()}`);
    r = {c: "cmp", op, l: convert(arith(sources[0], ctx, hasArith(sources[0]) ? calc : undefined), calc), r: convert(arith(sources[1], ctx, hasArith(sources[1]) ? calc : undefined), calc), type: calc};
  } else {
    r = compareValues(op, source(sources[0], ctx), source(sources[1], ctx), ctx);
  }
  return not ? {c: "not", x: r} : r;
}

/** character comparisons: c ignores trailing blanks, which the stored form already has */
function compareValues(op, l, r, ctx) {
  if (numeric(l.type) || numeric(r.type)) {
    const calc = l.type.k === "f" || r.type.k === "f" ? F : I;
    return {c: "cmp", op, l: convert(l, calc), r: convert(r, calc), type: calc};
  }
  if (charlike(l.type) && charlike(r.type)) return {c: "cmp", op, l: convert(l, S), r: convert(r, S), type: S};
  throw new Unsupported(`comparison of ${l.type.k} with ${r.type.k}`);
}
