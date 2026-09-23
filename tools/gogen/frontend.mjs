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
const XS = {k: "xstring"};
const EXC = {k: "exc"};

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
/*
 * An IMPORTING table or structure passed by reference is the caller's own
 * data: measured on A4H, it sees what a CHANGING of the same table did,
 * APPEND included. VALUE( ) is a copy. So a composite IMPORTING by
 * reference is a pointer in Go, and a VALUE( ) one is cloned at the call.
 */
export const composite = (t) => t?.k === "table" || t?.k === "struct";
export const byRef = (p) => p.dir === "importing" && composite(p.type) && !p.byValue;
const numeric = (t) => t.k === "i" || t.k === "f" || t.k === "int8";
const charlike = (t) => t.k === "c" || t.k === "string";

/* ------------------------------------------------------------------- program */

/**
 * Compile the named classes (and whatever interfaces they implement) out of
 * one or more folders of abapGit files. `files` narrows each folder to the
 * objects wanted, so a big pack can be read without parsing all of it.
 */
export function compileProgram({folders, objects, tolerant = false}) {
  const config = abaplint.Config.getDefault().get();
  config.syntax = {...config.syntax, version: "v758", errorNamespace: "."};
  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify(config)));
  // every file of the folders is loaded, so a class sees what it refers to;
  // only the objects named are compiled, and only their syntax errors count
  // a namespace is written # in a file name and / in the object's name
  const objName = (fn) => fn.split("/").pop().split(".")[0].toLowerCase().replace(/#/g, "/");
  const wanted = objects.map((o) => o.toLowerCase().replace(/#/g, "/"));
  const walk = (dir) => {
    for (const e of readdirSync(dir, {withFileTypes: true}).sort((x, y) => x.name.localeCompare(y.name))) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(abap|xml)$/i.test(e.name)) reg.addFile(new abaplint.MemoryFile(e.name, readFileSync(path, "utf8")));
    }
  };
  for (const folder of folders) walk(folder);
  reg.parse();
  REG = reg;
  const ours = (fn) => wanted.includes(objName(fn));
  const errors = reg.findIssues().filter((i) => (i.getKey() === "check_syntax" || i.getKey() === "parser_error") && ours(i.getFilename()));
  // tolerant (a survey): an object with syntax errors is left out and named,
  // instead of refusing the whole program
  const broken = new Set();
  if (errors.length > 0 && !tolerant) throw new Error(errors.map((e) => `${e.getFilename()}: ${e.getMessage()}`).join("\n"));
  for (const e of errors) broken.add(objName(e.getFilename()));
  if (broken.size > 0) wanted.splice(0, wanted.length, ...wanted.filter((w) => !broken.has(w)));

  const program = {structs: new Map(), consts: new Map(), classes: [], skipped: [], wanted: new Set(wanted.map(upper)),
    interfaces: new Set(), reg, sigs: new Map(), broken: [...broken], partial: []};
  const ctx0 = {reg, program};
  for (const obj of reg.getObjects()) {
    if (obj instanceof abaplint.Objects.Class && wanted.includes(obj.getName().toLowerCase())) program.classes.push(classIr(ctx0, obj));
  }
  // every interface used as a reference type: its methods whose signature
  // types, which is what a class must provide to satisfy it
  program.interfaceMethods = new Map();
  const ictx = {reg, program};
  let pending = [...program.interfaces];
  while (pending.length > 0) {
    for (const name of pending) {
      // its own methods and those of the interfaces it includes (INTERFACES
      // inside an interface), which are called as COMP~M through it
      const sigs = [];
      for (const i of [name, ...componentInterfaces(reg, name)]) {
        const all = reg.getObject("INTF", i)?.getDefinition()?.getMethodDefinitions();
        if (!all) continue;
        sigs.push(...Array.from(Array.isArray(all) ? all : all.getAll()).map((m) => methodSignature(ictx, i, `${i}~${upper(m.getName())}`)));
      }
      // a CLASS-METHODS of an interface is the class's function, not a method of the reference
      program.interfaceMethods.set(name, sigs.filter((x) => !x.unsupported && !x.static));
    }
    pending = [...program.interfaces].filter((n) => !program.interfaceMethods.has(n));
  }
  program.rtti = rttiTable(reg, program);
  return program;
}

/**
 * What RTTI (cl_abap_typedescr=>describe_by_name) can describe, for the Go
 * host, which has no transpiler kernel: the structures of the dictionary and
 * the structured TYPES of the compiled classes (CLASS=>TYPE), each as its
 * components and their type kinds. `known` is every name the registry has,
 * so a name that exists but is not a structure dumps instead of reading as
 * TYPE_NOT_FOUND.
 */
function rttiTable(reg, program) {
  const structs = new Map();
  const add = (name, t) => {
    if (!(t instanceof BasicTypes.StructureType)) return;
    structs.set(name, t.getComponents().map((c) => ({name: upper(c.name), kind: typeKindOf(c.type)})));
  };
  const known = new Set();
  for (const obj of reg.getObjects()) {
    const n = upper(obj.getName());
    if (["TABL", "DTEL", "TTYP", "DOMA", "CLAS", "INTF", "VIEW", "DDLS"].includes(obj.getType())) known.add(n);
    try {
      if (obj instanceof abaplint.Objects.Table) add(n, obj.parseType(reg));
      if (obj instanceof abaplint.Objects.Class && program.wanted.has(n)) {
        for (const td of obj.getDefinition()?.getTypeDefinitions().getAll() ?? []) {
          known.add(`${n}=>${upper(td.type.getName())}`);
          add(`${n}=>${upper(td.type.getName())}`, td.type.getType());
        }
      }
    } catch { /* a type abaplint cannot resolve is simply not described */ }
  }
  return {structs, known};
}

/** the RTTI type kind (cl_abap_typedescr=>typekind_*) of an abaplint type */
function typeKindOf(t) {
  if (t instanceof BasicTypes.CharacterType) return "C";
  if (t instanceof BasicTypes.NumericType) return "N";
  if (t instanceof BasicTypes.DateType) return "D";
  if (t instanceof BasicTypes.TimeType) return "T";
  if (t instanceof BasicTypes.IntegerType) return "I";
  if (t instanceof BasicTypes.Integer8Type) return "8";
  if (t instanceof BasicTypes.PackedType) return "P";
  if (t instanceof BasicTypes.FloatType) return "F";
  if (t instanceof BasicTypes.HexType) return "X";
  if (t instanceof BasicTypes.StringType) return "g";
  if (t instanceof BasicTypes.XStringType) return "y";
  if (t instanceof BasicTypes.DecFloat16Type) return "a";
  if (t instanceof BasicTypes.DecFloat34Type) return "e";
  if (t instanceof BasicTypes.StructureType) return "u";
  if (t instanceof BasicTypes.TableType) return "h";
  if (t instanceof BasicTypes.DataReference) return "l";
  if (t instanceof BasicTypes.ObjectReferenceType) return "r";
  return "?";
}

/** ALIASES a FOR i~m of a class or interface (or a superclass): i~m */
function aliasTarget(reg, owner, name) {
  for (const o of [owner, ...ancestors(reg, owner)]) {
    const def = reg.getObject("INTF", o)?.getDefinition() ?? reg.getObject("CLAS", o)?.getDefinition();
    const all = def?.getAliases?.();
    const list = Array.isArray(all) ? all : all?.getAll?.() ?? [];
    const hit = list.find((x) => upper(x.getName()) === name);
    if (hit) return upper(hit.getComponent());
  }
  return undefined;
}

/** the interfaces an interface includes, transitively */
function componentInterfaces(reg, intf, seen = new Set()) {
  for (const c of reg.getObject("INTF", intf)?.getDefinition()?.getImplementing?.() ?? []) {
    const n = upper(c.name);
    if (!seen.has(n)) { seen.add(n); componentInterfaces(reg, n, seen); }
  }
  return [...seen];
}

/** kept for the numeric bench sample: one folder, every class in it */
export function readClass(folder) {
  const objects = [...new Set(readdirSync(folder).map((f) => f.split(".")[0]))];
  return compileProgram({folders: [folder], objects}).classes;
}

/** methods whose ABAP is kernel code in the transpiler runtime, and the host function that does their work */
const NATIVE = new Map([
  ["CL_ABAP_TYPEDESCR=>DESCRIBE_BY_NAME", "Native_DESCRIBE_BY_NAME"],
  ["CL_HTTP_UTILITY=>IF_HTTP_UTILITY~UNESCAPE_URL", "abap.UnescapeURL"],
]);

/* --------------------------------------------------------------------- types */

function typeOf(t, where, program) {
  if (t instanceof BasicTypes.IntegerType) return I;
  if (t instanceof BasicTypes.FloatType) return F;
  if (t instanceof BasicTypes.Integer8Type) return INT8;
  if (t instanceof BasicTypes.StringType) return S;
  if (t instanceof BasicTypes.CharacterType) return C(t.getLength());
  if (t instanceof BasicTypes.HexType) return X(t.getLength());
  if (t instanceof BasicTypes.XStringType) return XS;
  // a parameter TYPE c takes the length of what is passed: stored without
  // trailing blanks like any c, so a length no value reaches
  if (t instanceof BasicTypes.CGenericType) return C(262143);
  // csequence and clike take a c or a string: carried as a string, so a c
  // passed in arrives without its trailing blanks, which every character
  // operation of a c ignores anyway (a structure passed as clike is refused
  // at the call, where the conversion to string fails)
  if (t instanceof BasicTypes.CSequenceType || t instanceof BasicTypes.CLikeType) return S;
  if (t instanceof BasicTypes.TableType) {
    const access = t.getAccessType();
    const row = typeOf(t.getRowType(), where, program);
    if (access === "STANDARD") return {k: "table", row};
    // a HASHED table loops in insertion order, so it is a slice whose
    // INSERT keeps the key unique; SORTED is not here yet
    if (access === "HASHED") {
      const key = (t.getOptions().primaryKey?.keyFields ?? []).map(upper);
      if (key.length === 0) throw new Unsupported(`${where}: HASHED table without a key`);
      return {k: "table", row, hashed: key};
    }
    throw new Unsupported(`${where}: ${access} tables`);
  }
  if (t instanceof BasicTypes.StructureType) {
    const comps = t.getComponents();
    const q = t.getQualifiedName();
    // a type declared in a class or a method has no owner in its name: two
    // classes may both have a ty_face, with other fields, so the class names it
    // a DDIC structure (a TABL of the dictionary, e.g. IHTTPNVP) is global:
    // one Go type for every class that uses it, or two classes cannot pass it
    // a structure is the class's own only when the class declares a type of
    // that name; a DDIC table or a type-pool type is global, one Go type
    // for every class that uses it, or two classes cannot pass it
    const local = !q || (!q.includes("=>") && (program.currentTypes?.has(upper(q)) ?? true));
    let go = q ? goName(q) : `S_${comps.map((c) => c.name).join("_").slice(0, 40).toUpperCase()}`;
    if (local && program.currentClass) go = `${program.currentClass}__${go}`;
    const shape = comps.map((c) => upper(c.name)).join(",");
    for (let n = 2; program.structs.has(go) && program.structs.get(go).shape !== undefined && program.structs.get(go).shape !== shape; n += 1) {
      go = `${go.replace(/_V\d+$/, "")}_V${n}`;
    }
    if (program.badStructs?.has(go)) throw new Unsupported(program.badStructs.get(go));
    if (!program.structs.has(go)) {
      const st = {k: "struct", go, fields: [], shape};
      program.structs.set(go, st); // before the fields: a struct may nest itself through a table
      try {
        st.fields = comps.map((c) => ({name: upper(c.name), type: typeOf(c.type, `${where}-${c.name}`, program)}));
      } catch (e) {
        // a field outside the subset: the structure is not in the program,
        // and every later use of it is refused with the same reason
        program.structs.delete(go);
        (program.badStructs ??= new Map()).set(go, e.message);
        throw e;
      }
    }
    return {k: "struct", go};
  }
  if (t instanceof BasicTypes.ObjectReferenceType) {
    const name = upper(t.getIdentifierName());
    const intf = program.reg?.getObject("INTF", name) !== undefined;
    if (!intf && program.reg?.getObject("CLAS", name) === undefined) throw new Unsupported(`${where}: REF TO ${name}, which is not in the program`);
    if (intf) program.interfaces.add(name);
    return {k: "ref", name, intf};
  }
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
  program.currentClass = goName(obj.getName());
  const file = obj.getMainABAPFile();
  // the type names this class declares itself (class and method TYPES)
  program.currentTypes = new Set([...file.getRaw().matchAll(/\bTYPES\s*:?\s*(?:BEGIN\s+OF\s+)?([\w\/]+)/gi)].map((m) => upper(m[1])));
  for (const m of file.getRaw().matchAll(/,\s*(?:BEGIN\s+OF\s+)?([\w\/]+)\s+TYPE\b/gi)) program.currentTypes.add(upper(m[1]));
  const def = obj.getDefinition();
  const spaghetti = new abaplint.SyntaxLogic(reg, obj).run().spaghetti;
  const tree = new Rearranger().run("CLAS", file.getStructure());
  const className = upper(obj.getName());

  // attributes and constants live in the class implementation scope
  const implScope = findScope(spaghetti.getTop(), "class_implementation");
  const defScope = findScope(spaghetti.getTop(), "class_definition");
  const attributes = [];
  const ownAttrs = new Set(def.getAttributes().getAll().map((a) => upper(a.getName())));
  const classVars = {...(defScope?.getData().vars ?? {}), ...(implScope?.getData().vars ?? {})};
  for (const [name, id] of Object.entries(classVars)) {
    if (name === "ME" || name === "SUPER") continue;
    const meta = id.getMeta();
    if (id instanceof abaplint.Types.ClassConstant || (meta.includes("read_only") && meta.includes("static") && name.includes("~"))) {
      registerConst(program, name, id, className);
      continue;
    }
    // an inherited attribute lives in the superclass's part of the object
    if (!ownAttrs.has(name)) continue;
    try {
      const type = typeOf(id.getType(), `${className} ${name}`, program);
      attributes.push({name, type, static: meta.includes("static"), value: attributeValue(id, type, `${className} ${name}`)});
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
      const optional = new Set((p.getOptional?.() ?? []).map(upper));
      const param = (x, dir) => ({name: upper(x.getName()), dir, byValue: x.getMeta().includes("pass_by_value"), type: typeOf(x.getType(), where, program),
        default: defaultOf(p, x), optional: optional.has(upper(x.getName()))});
      const ret = p.getReturning();
      signatures.set(name, {
        name, static: isStatic, private: m.getVisibility?.() === 1, abstract: m.isAbstract?.() ?? false,
        params: [...p.getImporting().map((x) => param(x, "importing")), ...p.getExporting().map((x) => param(x, "exporting")),
          ...p.getChanging().map((x) => param(x, "changing"))],
        returning: ret === undefined ? null : {name: upper(ret.getName()), type: typeOf(ret.getType(), where, program)},
      });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      signatures.set(name, {name, unsupported: e.message});
    }
  };
  // a REDEFINITION declares no parameters of its own: they are the ones of
  // the interface or superclass the method comes from (without this an
  // inherited IF_APC_WSP_EXTENSION~ON_START read its I_MESSAGE_MANAGER as
  // an empty local)
  const origin = (m) => {
    const nm = upper(m.getName());
    if (nm.includes("~")) {
      const [intf, meth] = nm.split("~");
      const idef = reg.getObject("INTF", intf)?.getDefinition();
      const all = idef?.getMethodDefinitions();
      const found = all && Array.from(Array.isArray(all) ? all : all.getAll()).find((x) => upper(x.getName()) === meth);
      if (!found) throw new Unsupported(`${className}: the interface method of REDEFINITION ${nm} is not in the program`);
      return found;
    }
    for (let sup = def.getSuperClass(), guard = 0; sup && guard < 20; guard += 1) {
      const sdef = reg.getObject("CLAS", sup)?.getDefinition();
      if (!sdef) break;
      const found = sdef.getMethodDefinitions().getAll().find((x) => upper(x.getName()) === nm);
      if (found && !found.isRedefinition()) return found;
      sup = sdef.getSuperClass();
    }
    throw new Unsupported(`${className}: where REDEFINITION ${nm} comes from is not in the program`);
  };
  for (const m of def.getMethodDefinitions().getAll()) {
    if (!m.isRedefinition()) { addSig(m, "", m.isStatic()); continue; }
    let o;
    try { o = origin(m); } catch (e) { if (!(e instanceof Unsupported)) throw e; signatures.set(upper(m.getName()), {name: upper(m.getName()), unsupported: e.message}); continue; }
    addSig(Object.assign(Object.create(Object.getPrototypeOf(o)), o, {getName: () => m.getName()}), "", m.isStatic());
  }
  const implemented = [...new Set(def.getImplementing().flatMap((i) => [upper(i.name), ...componentInterfaces(reg, upper(i.name))]))];
  for (const intf of implemented.map((name) => ({name}))) {
    const idef = reg.getObject("INTF", intf.name)?.getDefinition();
    if (idef === undefined) throw new Unsupported(`${className}: interface ${intf.name} not in the program`);
    const all = idef.getMethodDefinitions();
    for (const m of Array.from(Array.isArray(all) ? all : all.getAll())) addSig(m, `${upper(intf.name)}~`, m.isStatic?.() ?? false);
  }

  // single inheritance: the superclass when it is compiled too (else the
  // class stands alone, as it did before inheritance was compiled)
  const sup = def.getSuperClass() ? upper(def.getSuperClass()) : null;
  const cls = {name: className, attributes, methods: [], constructor: null, stubs: [],
    interfaces: def.getImplementing().map((i) => upper(i.name)), super: sup && program.wanted.has(sup) ? sup : null, abstract: def.isAbstract()};
  cls.abstracts = [...signatures.values()].filter((x) => x.abstract && !x.unsupported && !x.name.includes("~"));
  cls.signatures = signatures;
  const typed = new Map([...signatures].filter(([, v]) => !v.unsupported));
  for (const node of tree.findAllStructures(Structures.Method)) {
    const name = upper(node.findFirstExpression(Expressions.MethodName).concatTokens());
    const sig = signatures.get(name);
    const skip = (why) => {
      program.skipped.push(`${className}=>${name}: ${why}`);
      // a method with a typed signature still exists as a stub that raises
      // when called, so its callers compile; only an untyped signature
      // cannot be called at all
      if (typed.has(name)) cls.stubs.push({...typed.get(name), reason: why});
      else signatures.set(name, {name, unsupported: why});
    };
    if (sig === undefined) { skip("no signature"); continue; }
    if (sig.unsupported) { skip(sig.unsupported); continue; }
    // a kernel service the host implements: the ABAP body (the transpiler's
    // @KERNEL code) is replaced by a call into the host
    if (NATIVE.has(`${className}=>${name}`)) {
      cls.methods.push({...sig, locals: [], fieldSymbols: [], calls: [], body: [{s: "native", fn: NATIVE.get(`${className}=>${name}`)}],
        pos: {file: file.getFilename().split("/").pop(), row: node.getFirstToken().getStart().getRow()}});
      continue;
    }
    try {
      const scope = spaghetti.lookupPosition(node.getFirstToken().getStart(), file.getFilename());
      const ctx = {program, reg, className, method: name, sig, signatures, scope, file, spaghetti, locals: new Map(), temps: 0};
      const known = new Set([...sig.params.map((p) => p.name), sig.returning?.name].filter(Boolean));
      ctx.fieldSymbols = new Map();
      for (const [vname, id] of Object.entries(scope.getData().vars)) {
        if (known.has(vname) || vname === "ME" || vname === "SUPER") continue;
        const t = typeOf(id.getType(), `${className}=>${name} ${vname}`, program);
        // a field symbol points into a row: only rows of structures, whose
        // reference both backends can hold (a pointer, an object)
        if (vname.startsWith("<")) {
          if (t.k !== "struct") throw new Unsupported(`field symbol ${vname} of a ${t.k}`);
          ctx.fieldSymbols.set(vname, t);
        } else {
          ctx.locals.set(vname, t);
        }
      }
      const body = node.findDirectStructure(Structures.Body);
      ctx.inits = [];
      const compiled = body === undefined ? [] : block(body, ctx);
      compiled.unshift(...ctx.inits);
      const ir = {...sig, fieldSymbols: [...ctx.fieldSymbols].map(([n, t]) => ({name: n, type: t})), locals: [...ctx.locals].map(([n, t]) => ({name: n, type: t})).sort((a, b) => a.name.localeCompare(b.name)),
        body: compiled, calls: ctx.calls ?? [], pos: {file: file.getFilename().split("/").pop(), row: node.getFirstToken().getStart().getRow()}};
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
    if (cls.constructor && !cls.constructor.dropped) {
      const bad = cls.constructor.calls?.find((c) => signatures.get(c)?.unsupported);
      if (bad) {
        cls.constructor.dropped = true; changed = true;
        program.skipped.push(`${className}=>CONSTRUCTOR: calls ${bad}, which was skipped`);
      }
    }
    for (const m of cls.methods) {
      const bad = m.calls?.find((c) => signatures.get(c)?.unsupported);
      if (bad && !m.dropped) {
        m.dropped = true; changed = true;
        program.skipped.push(`${className}=>${m.name}: calls ${bad}, which was skipped`);
        if (typed.has(m.name)) cls.stubs.push({...typed.get(m.name), reason: `calls ${bad}`});
        signatures.set(m.name, {name: m.name, unsupported: `calls ${bad}`});
      }
    }
  }
  cls.methods = cls.methods.filter((m) => !m.dropped);
  if (cls.constructor?.dropped) cls.constructor = null;
  // a constructor that did not compile: the object can still be created, so
  // the classes that create it compile, but none of its methods runs on a
  // state the constructor never set -- they all raise, with the reason
  const hasCtor = tree.findAllStructures(Structures.Method).some((n) => upper(n.findFirstExpression(Expressions.MethodName).concatTokens()) === "CONSTRUCTOR");
  if (hasCtor && cls.constructor === null) {
    const why = program.skipped.find((x) => x.startsWith(`${className}=>CONSTRUCTOR:`))?.replace(/^[^:]+: /, "") ?? "?";
    cls.ctorBroken = why;
    cls.ctorParams = typed.get("CONSTRUCTOR")?.params ?? [];
    for (const m of cls.methods) cls.stubs.push({...m, reason: `the constructor did not compile: ${why}`});
    cls.methods = [];
  }
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
/**
 * The VALUE of an attribute, set when the object is made (static: when the
 * class is loaded) and not left at the type's initial value: a rotozoom
 * with `mv_scale TYPE i VALUE 8` left at 0 stepped its WHILE by 0 and
 * appended rows until the machine ran out of memory (2026-09-23).
 * Literals only; anything else is refused, not guessed.
 */
function attributeValue(id, type, where) {
  const raw = id.getValue?.();
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" && typeof raw !== "number") throw new Unsupported(`${where}: structured VALUE`);
  const text = String(raw);
  const quoted = /^'.*'$/s.test(text) || /^`.*`$/s.test(text);
  if (!quoted && !/^-?\d+(\.\d+)?$/.test(text)) throw new Unsupported(`${where}: VALUE ${text}`);
  let value = quoted ? text.slice(1, -1).replaceAll(text[0] === "'" ? "''" : "``", text[0]) : text;
  if (type.k === "c") value = value.slice(0, type.len).replace(/ +$/, "");
  else if (!["i", "int8", "f", "string"].includes(type.k)) throw new Unsupported(`${where}: VALUE for type ${type.k}`);
  if (type.k !== "c" && type.k !== "string" && !Number.isFinite(Number(value))) throw new Unsupported(`${where}: VALUE ${text}`);
  return value;
}

function registerConst(program, name, id, className) {
  const go = goName(name.includes("~") ? name : `${className}=>${name}`);
  if (program.consts.has(go)) return go;
  let type;
  try { type = typeOf(id.getType(), name, program); } catch (e) { if (e instanceof Unsupported) return undefined; throw e; }
  let value = id.getValue?.();
  const SCALAR = ["i", "int8", "f", "c", "string", "x", "xstring"];
  // a quote inside a literal is written twice: '#''"' is #'" (the Zork
  // alphabet shifted by one character after it until this was read right)
  const unquote = (v) => {
    v = String(v);
    if (/^'.*'$/s.test(v)) return v.slice(1, -1).replaceAll("''", "'");
    if (/^`.*`$/s.test(v)) return v.slice(1, -1).replaceAll("``", "`");
    return v;
  };
  // CONSTANTS: BEGIN OF ... END OF: one value per component, all scalar
  if (value !== null && typeof value === "object" && type.k === "struct") {
    const fields = program.structs.get(type.go)?.fields ?? [];
    const byName = new Map(Object.entries(value).map(([k, v]) => [upper(k), v]));
    if (fields.length === 0 || fields.some((f) => !SCALAR.includes(f.type.k) || typeof byName.get(f.name) === "object")) return undefined;
    program.consts.set(go, {go, type, value: Object.fromEntries(fields.map((f) => [f.name, byName.has(f.name) ? unquote(byName.get(f.name)) : undefined]))});
    return go;
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (!SCALAR.includes(type.k)) return undefined;
  program.consts.set(go, {go, type, value: unquote(value)});
  return go;
}

/* ---------------------------------------------------------------- statements */

function block(node, ctx) {
  const out = [];
  for (const child of node.getChildren()) {
    if (child instanceof Nodes.StructureNode && (isStruct(child, Structures.Normal) || isStruct(child, Structures.Body))) {
      out.push(...block(child, ctx));
      continue;
    }
    // one statement (or one IF, LOOP, TRY ...) the subset does not cover
    // becomes a stub that raises NOT_COMPILED when it runs, as a system
    // dumps; the rest of the method compiles, and nothing is skipped
    // silently: execution never passes the stub
    const pos = {file: ctx.file.getFilename().split("/").pop(), row: child.getFirstToken().getStart().getRow()};
    try {
      if (child instanceof Nodes.StructureNode) out.push({...structure(child, ctx), pos});
      else if (child instanceof Nodes.StatementNode) {
        const s = statement(child, ctx);
        if (s !== undefined) out.push({...s, pos});
      }
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      const where = `${ctx.className}=>${ctx.method} (${pos.file}:${pos.row})`;
      ctx.program.partial.push(`${where}: ${e.message}`);
      out.push({s: "stub", where, reason: e.message.slice(0, 200), pos});
    }
  }
  return out;
}

/*
 * TRY / CATCH, the part a runtime can honour today: the exceptions the
 * runtime itself raises (arithmetic, conversion, table line, offset). Which
 * of them a CATCH covers is decided here, by the class hierarchy abaplint
 * knows; an exception object (INTO), CLEANUP and leaving the method from
 * inside a TRY are refused by name, not approximated.
 */
const RUNTIME_CX = ["CX_SY_ZERODIVIDE", "CX_SY_ARITHMETIC_OVERFLOW", "CX_SY_CONVERSION_NO_NUMBER", "CX_SY_CONVERSION_OVERFLOW",
  "CX_SY_ITAB_LINE_NOT_FOUND", "CX_SY_RANGE_OUT_OF_BOUNDS", "CX_SY_ARG_OUT_OF_DOMAIN",
  "CX_SY_CREATE_OBJECT_ERROR", "CX_SY_MOVE_CAST_ERROR"];

function isSubclass(reg, cls, ancestor) {
  for (let c = cls, guard = 0; c && guard < 20; guard += 1) {
    if (c === ancestor) return true;
    c = reg.getObject("CLAS", c)?.getDefinition()?.getSuperClass()?.toUpperCase();
  }
  return false;
}

function leaves(stmts, inLoop = false) {
  for (const st of stmts ?? []) {
    if (st.s === "return") return true;
    if ((st.s === "exit" || st.s === "continue") && !inLoop) return true;
    const loop = st.s === "loop" || st.s === "do" || st.s === "while";
    for (const k of ["body", "then", "else"]) if (Array.isArray(st[k]) && leaves(st[k], inLoop || loop)) return true;
    for (const b of st.branches ?? st.cases ?? st.elseifs ?? []) if (leaves(b.body, inLoop || loop)) return true;
    for (const c of st.catches ?? []) if (leaves(c.body, inLoop)) return true;
  }
  return false;
}

function tryBlock(node, ctx) {
  if (node.findDirectStructure(Structures.Cleanup)) throw new Unsupported("TRY with CLEANUP");
  const body = bodyOf(node, ctx);
  const catches = node.findDirectStructures(Structures.Catch).map((c) => {
    const st = c.findDirectStatement(Statements.Catch);
    // CATCH ... INTO x: x is an exception object whose one method here is
    // get_text( ) (its text is the class and the operation, not A4H's text)
    let into = null;
    if (/\bINTO\b/i.test(st.concatTokens())) {
      const target = st.findDirectExpression(Expressions.Target);
      const nm = upper((target.findFirstExpression(Expressions.TargetField) ?? target).concatTokens());
      if (!ctx.locals.has(nm)) throw new Unsupported(`CATCH ... INTO ${nm}: not a local`);
      ctx.locals.set(nm, EXC);
      into = nm;
    }
    const names = st.findDirectExpressions(Expressions.ClassName).map((n) => upper(n.concatTokens()));
    return {classes: names, into, covers: RUNTIME_CX.filter((cx) => names.some((n) => isSubclass(ctx.reg, cx, n))), body: bodyOf(c, ctx)};
  });
  return {s: "try", body, catches};
}

const bodyOf = (n, ctx) => {
  const b = n.findDirectStructure(Structures.Body);
  return b === undefined ? [] : block(b, ctx);
};

function structure(node, ctx) {
  if (isStruct(node, Structures.Types)) return {s: "nop"};
  if (isStruct(node, Structures.Data)) {
    if (/\bVALUE\b/i.test(node.concatTokens())) throw new Unsupported(`DATA BEGIN OF with VALUE: ${node.concatTokens().slice(0, 60)}`);
    return {s: "nop"};
  }
  if (isStruct(node, Structures.Constants)) throw new Unsupported(`CONSTANTS BEGIN OF: ${node.concatTokens().slice(0, 60)}`);
  if (isStruct(node, Structures.Try)) return tryBlock(node, ctx);
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
    const text = st.concatTokens();
    if (/\b(REFERENCE|GROUP|USING|CASTING)\b/i.test(text)) throw new Unsupported(`LOOP form: ${text}`);
    const table = sourceOperand(st.findFirstExpression(Expressions.LoopSource).getFirstChild().getFirstChild(), ctx);
    if (table.type.k !== "table") throw new Unsupported("LOOP over a non-table");
    const lt = st.findFirstExpression(Expressions.LoopTarget);
    const fsNode = lt.findFirstExpression(Expressions.FSTarget) ?? lt.findFirstExpression(Expressions.TargetFieldSymbol);
    let into = null;
    let fs = null;
    if (/\bASSIGNING\b/i.test(lt.concatTokens())) {
      const nm = /<[\w]+>/.exec(lt.concatTokens())?.[0];
      if (nm === undefined || !ctx.fieldSymbols.has(upper(nm))) throw new Unsupported(`LOOP ASSIGNING ${lt.concatTokens()}`);
      fs = upper(nm);
    } else {
      into = lvalue(lt.findFirstExpression(Expressions.Target), ctx);
    }
    void fsNode;
    const bound = (kw) => {
      const e = st.getChildren();
      const at = e.findIndex((c) => isTok(c, kw));
      return at < 0 ? null : convert(source(e[at + 1], ctx, I), I);
    };
    // WHERE comp op value [AND ...]: a row that fails it is not a pass
    const cc = st.findDirectExpression(Expressions.ComponentCond);
    const where = cc ? whereOf(cc, table.type.row, ctx, text) : null;
    return {s: "loop", table, into, fs, where, from: bound("FROM"), to: bound("TO"), rowType: table.type.row, body: bodyOf(node, ctx)};
  }
  throw new Unsupported(`structure ${node.get().constructor.name}`);
}

/** WHERE comp op value [AND ...] over the rows of a table of structures */
function whereOf(cc, rowType, ctx, text) {
  if (rowType.k !== "struct") throw new Unsupported("WHERE over a table not of structures");
  const where = [];
  for (const k of cc.getChildren()) {
    if (isTok(k, "AND")) continue;
    if (!isExpr(k, Expressions.ComponentCompare) || k.getChildren().length !== 3) throw new Unsupported(`WHERE form: ${cc.concatTokens()}`);
    const [comp, opN, src] = k.getChildren();
    const f = fieldOf(ctx, rowType, comp.concatTokens(), text);
    const opT = upper(opN.concatTokens());
    const op = OPS[opT] ?? opT;
    if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Unsupported(`WHERE operator ${op}`);
    const v = source(src, ctx, f.type);
    const calc = numeric(f.type) || numeric(v.type) ? (f.type.k === "f" || v.type.k === "f" ? F : I) : S;
    if (calc !== S && (charlike(f.type) || charlike(v.type))) throw new Unsupported("WHERE comparing characters with a number");
    where.push({name: f.name, ftype: f.type, op, value: convert(v, calc), calc});
  }
  return where;
}

function statement(node, ctx) {
  const text = node.concatTokens();
  if (isStmt(node, Statements.Data) || isStmt(node, Statements.Constant)) {
    // declared from the scope; a VALUE is set once at the start of the
    // method, as ABAP does, not where the statement stands (inside a loop
    // it would reset the field on every pass)
    if (/\bVALUE\b/i.test(text)) ctx.inits.push(initialValue(node, ctx));
    return undefined;
  }
  if (isStmt(node, Statements.Type) || isStmt(node, Statements.TypeBegin) || isStmt(node, Statements.TypeEnd)) return undefined;
  if (isStmt(node, Statements.CreateObject)) return createObject(node, ctx);
  // ASSERT: a false condition ends the program (ASSERTION_FAILED, a runtime
  // error no CATCH reaches); no checkpoint group, so always active
  if (isStmt(node, Statements.Assert)) {
    if (/\bID\b/i.test(node.concatTokens())) throw new Unsupported(`ASSERT with a checkpoint group: ${node.concatTokens()}`);
    return {s: "assert", cond: cond(node.findDirectExpression(Expressions.Cond), ctx), text: node.concatTokens()};
  }
  if (isStmt(node, Statements.Move)) {
    const targets = node.findDirectExpressions(Expressions.Target);
    if (targets.length !== 1) throw new Unsupported("chained assignment");
    const src = node.findDirectExpression(Expressions.Source);
    const inline = targets[0].getChildren()[0];
    if (isExpr(inline, Expressions.InlineData)) {
      // DATA(x) = ... takes the type of what is assigned. abaplint types some
      // built-ins by a fixed return (frac( ) as i, _builtin.js), where ABAP
      // gives the argument's type: frac( f ) is an f (A4H: pulse 0.25, not 0)
      const name = upper(inline.findFirstExpression(Expressions.TargetField).concatTokens());
      const declared = ctx.locals.get(name);
      if (declared && numeric(declared)) {
        let t;
        try { t = source(src, ctx).type; } catch (e) { if (!(e instanceof Unsupported)) throw e; }
        if (t && numeric(t) && declared.k !== t.k) ctx.locals.set(name, t);
      }
    }
    const target = lvalue(targets[0], ctx);
    // a ?= b: a down-cast, checked at run time
    if (node.getChildren().some((c) => isTok(c, "?="))) return {s: "assign", target, value: downCast(source(src, ctx), target.type, node.concatTokens())};
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
  if (isStmt(node, Statements.ReadTable) && /\bWITH\s+(TABLE\s+)?KEY\b/i.test(text)) {
    // READ TABLE t [INTO wa | ASSIGNING <fs> | TRANSPORTING NO FIELDS] WITH [TABLE] KEY c = v ...:
    // the first row whose components equal the values (each converted to the
    // component's type); sy-subrc 0 / 4, sy-tabix the row (0 for a HASHED
    // table), the target left alone when nothing is found
    if (/\b(BINARY|REFERENCE|CASTING|COMPARING)\b/i.test(text) || (/\bTRANSPORTING\b/i.test(text) && !/\bTRANSPORTING\s+NO\s+FIELDS\b/i.test(text))) {
      throw new Unsupported(`READ TABLE form: ${text}`);
    }
    const table = sourceOperand(node.findDirectExpression(Expressions.SimpleSource2).getFirstChild(), ctx);
    if (table.type.k !== "table") throw new Unsupported("READ TABLE of a non-table");
    const cc = node.findDirectExpression(Expressions.ComponentCompareSimple);
    if (!cc) throw new Unsupported(`READ TABLE key form: ${text}`);
    const kids = cc.getChildren();
    const keys = [];
    for (let i = 0; i + 2 < kids.length + 1; i += 3) {
      const comp = kids[i];
      if (!comp || !isTok(kids[i + 1], "=")) throw new Unsupported(`READ TABLE key form: ${cc.concatTokens()}`);
      const cname = upper(comp.concatTokens());
      if (cname === "TABLE_LINE") {
        keys.push({line: true, value: convert(source(kids[i + 2], ctx, table.type.row), table.type.row)});
      } else {
        const f = fieldOf(ctx, table.type.row, cname, text);
        keys.push({name: f.name, value: convert(source(kids[i + 2], ctx, f.type), f.type)});
      }
    }
    const rt = node.findFirstExpression(Expressions.ReadTableTarget);
    let into = null;
    let fs = null;
    if (rt && /\bASSIGNING\b/i.test(rt.concatTokens())) {
      fs = upper(/<[\w]+>/.exec(rt.concatTokens())?.[0] ?? "");
      if (!ctx.fieldSymbols.has(fs)) throw new Unsupported(`READ TABLE ASSIGNING ${fs}`);
    } else if (rt) {
      const tgt = rt.findFirstExpression(Expressions.Target);
      if (!tgt) throw new Unsupported(`READ TABLE target form: ${rt.concatTokens()}`);
      into = lvalue(tgt, ctx);
      if (!sameType(into.type, table.type.row)) into = {...into, conv: true};
    }
    return {s: "read_key", table, keys, into, fs, hashed: !!table.type.hashed};
  }
  if (isStmt(node, Statements.ReadTable)) {
    if (!/\bINDEX\b/i.test(text) || /\b(WITH KEY|REFERENCE|TRANSPORTING|BINARY|CASTING)\b/i.test(text)) {
      throw new Unsupported(`READ TABLE form: ${text}`);
    }
    const table = sourceOperand(node.findDirectExpression(Expressions.SimpleSource2).getFirstChild(), ctx);
    const index = convert(source(node.findDirectExpression(Expressions.Source), ctx, I), I);
    if (/\bASSIGNING\b/i.test(text)) {
      const fsName = upper(/<[\w]+>/.exec(text)?.[0] ?? "");
      if (!ctx.fieldSymbols.has(fsName)) throw new Unsupported(`READ TABLE ASSIGNING ${fsName}`);
      return {s: "read_index", table, index, fs: fsName};
    }
    const into = lvalue(node.findFirstExpression(Expressions.ReadTableTarget).findFirstExpression(Expressions.Target), ctx);
    return {s: "read_index", table, index, into};
  }
  if (isStmt(node, Statements.Sort)) {
    const m = /^SORT\s+(\S+)\s+BY\s+(.*?)\s*\.?$/i.exec(text);
    if (m === null || /\b(STABLE|AS TEXT)\b/i.test(text)) throw new Unsupported(`SORT form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target) ?? node.findFirstExpression(Expressions.Target), ctx);
    if (table.type.k !== "table" || table.type.row.k !== "struct") throw new Unsupported("SORT of a table that is not of structures");
    const keys = [];
    const words = m[2].trim().split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      const f = fieldOf(ctx, table.type.row, words[i], text);
      let desc = false;
      if (/^(ASCENDING|DESCENDING)$/i.test(words[i + 1] ?? "")) { desc = /^DESCENDING$/i.test(words[i + 1]); i += 1; }
      keys.push({name: f.name, type: f.type, desc});
    }
    return {s: "sort", table, keys};
  }
  if (isStmt(node, Statements.DeleteInternal) && /^DELETE\s+\S+\s+WHERE\s+/i.test(text)) {
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("DELETE from a non-table");
    const cc = node.findDirectExpression(Expressions.ComponentCond);
    if (!cc) throw new Unsupported(`DELETE form: ${text}`);
    return {s: "delete_where", table, where: whereOf(cc, table.type.row, ctx, text)};
  }
  if (isStmt(node, Statements.DeleteInternal)) {
    if (!/^DELETE\s+\S+\s+INDEX\s+/i.test(text)) throw new Unsupported(`DELETE form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("DELETE from a non-table");
    const idx = node.findDirectExpressions(Expressions.Source).slice(-1)[0];
    return {s: "delete_index", table, index: convert(source(idx, ctx, I), I)};
  }
  if (isStmt(node, Statements.InsertInternal) && /\bINTO\s+TABLE\b/i.test(text)) {
    if (/\b(LINES OF|INITIAL LINE|ASSIGNING|REFERENCE)\b/i.test(text)) throw new Unsupported(`INSERT form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("INSERT into a non-table");
    const vNode = node.findDirectExpression(Expressions.SimpleSource4) ?? node.findDirectExpression(Expressions.Source);
    // a unique key: a row with the same key is not inserted (sy-subrc 4)
    const keys = table.type.hashed && !(table.type.hashed.length === 1 && table.type.hashed[0] === "TABLE_LINE") ? table.type.hashed : null;
    if (keys && table.type.row.k !== "struct") throw new Unsupported(`INSERT INTO TABLE with key ${keys.join(",")} on a table not of structures`);
    for (const k of keys ?? []) fieldOf(ctx, table.type.row, k, text);
    return {s: "insert_table", table, value: convert(source(vNode, ctx, table.type.row), table.type.row), unique: !!table.type.hashed, keys};
  }
  if (isStmt(node, Statements.InsertInternal)) {
    const m = /\bINDEX\b/i.test(text);
    if (!m || /\b(LINES OF|INITIAL LINE|ASSIGNING|REFERENCE)\b/i.test(text)) throw new Unsupported(`INSERT form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("INSERT into a non-table");
    const srcs = node.findDirectExpressions(Expressions.Source).concat(node.findDirectExpressions(Expressions.SimpleSource4));
    const vNode = node.findDirectExpression(Expressions.SimpleSource4) ?? srcs[0];
    const idxNode = node.findDirectExpressions(Expressions.Source).slice(-1)[0];
    return {s: "insert_index", table, value: convert(source(vNode, ctx, table.type.row), table.type.row), index: convert(source(idxNode, ctx, I), I)};
  }
  if (isStmt(node, Statements.Replace)) {
    const m = /^REPLACE\s+ALL\s+OCCURRENCES\s+OF\s+(.+?)\s+IN\s+(\S+)\s+WITH\s+(.+?)\s*\.?$/i.exec(text);
    if (m === null || /\b(REGEX|PCRE|IGNORING|RESPECTING|IN\s+SECTION|IN\s+BYTE)\b/i.test(text)) throw new Unsupported(`REPLACE form: ${text}`);
    const srcs = node.findDirectExpressions(Expressions.Source);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (target.type.k !== "string") throw new Unsupported(`REPLACE in a ${target.type.k}: trailing blanks of c are not settled here`);
    const [of, wth] = srcs.length >= 2 ? [srcs[0], srcs[srcs.length - 1]] : [null, null];
    if (of === null) throw new Unsupported(`REPLACE operands: ${text}`);
    return {s: "replace_all", target, of: convert(source(of, ctx), S), with: convert(source(wth, ctx), S)};
  }
  if (isStmt(node, Statements.Translate)) {
    const m = /\bTO\s+(UPPER|LOWER)\s+CASE\b/i.exec(text);
    if (m === null) throw new Unsupported(`TRANSLATE form: ${text}`);
    const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (!charlike(target.type)) throw new Unsupported("TRANSLATE of a non-character field");
    return {s: "translate", target, upper: upper(m[1]) === "UPPER"};
  }
  // RAISE name: a classic exception, for the caller's EXCEPTIONS list
  if (isStmt(node, Statements.Raise) && !/^RAISE\s+(EXCEPTION|RESUMABLE)\b/i.test(text)) {
    const n = node.findDirectExpression(Expressions.ExceptionName);
    if (!n) throw new Unsupported(`RAISE form: ${text}`);
    return {s: "raise_classic", name: upper(n.concatTokens()), method: ctx.method.includes("~") ? ctx.method.split("~")[1] : ctx.method};
  }
  if (isStmt(node, Statements.Call)) {
    const chain = node.findDirectExpression(Expressions.MethodCallChain);
    if (chain === undefined) throw new Unsupported(`CALL form: ${text}`);
    return {s: "call", call: call(chain, ctx, true)};
  }
  if (isStmt(node, Statements.Exit)) return {s: "exit"};
  if (isStmt(node, Statements.Continue)) return {s: "continue"};
  if (isStmt(node, Statements.Return)) return {s: "return"};
  // FIELD-SYMBOLS: declared from the scope like DATA
  if (isStmt(node, Statements.FieldSymbol)) return undefined;
  if (isStmt(node, Statements.ModifyInternal)) {
    if (!/^MODIFY\s+\S+\s+INDEX\s+.+\s+FROM\s+/i.test(text) || /\bTRANSPORTING\b/i.test(text)) throw new Unsupported(`MODIFY form: ${text}`);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table") throw new Unsupported("MODIFY of a non-table");
    const [idx, val] = node.findDirectExpressions(Expressions.Source);
    return {s: "modify_index", table, index: convert(source(idx, ctx, I), I), value: convert(source(val, ctx, table.type.row), table.type.row)};
  }
  if (isStmt(node, Statements.Split)) {
    // measured on A4H: an empty string gives no rows, and one empty last
    // piece after a trailing separator is dropped (a| -> [a], a|| -> [a,''])
    if (!/\bINTO\s+TABLE\b/i.test(text)) throw new Unsupported(`SPLIT form: ${text}`);
    const [str, sep] = node.findDirectExpressions(Expressions.Source);
    const table = lvalue(node.findDirectExpression(Expressions.Target), ctx);
    if (table.type.k !== "table" || table.type.row.k !== "string") throw new Unsupported("SPLIT into a table not of strings");
    return {s: "split", table, x: convert(source(str, ctx), S), sep: convert(source(sep, ctx), S)};
  }
  if (isStmt(node, Statements.Find)) {
    // FIND [FIRST OCCURRENCE OF] [REGEX] p IN s [IGNORING CASE] [SUBMATCHES a b ...]
    // [MATCH OFFSET o] [MATCH LENGTH l]; measured on A4H: POSIX leftmost-
    // longest, offsets in characters, a failed FIND leaves every target alone,
    // a submatch target without a group (or of a group that did not take
    // part) becomes initial
    const kids = node.getChildren();
    const words = kids.map((k) => (k instanceof Nodes.TokenNode ? upper(k.concatTokens()) : ""));
    if (words.includes("ALL") || /\b(RESULTS|MATCH\s+COUNT|SECTION|IN\s+TABLE|IN\s+BYTE\s+MODE)\b/i.test(text)) throw new Unsupported(`FIND form: ${text}`);
    const ft = node.findDirectExpression(Expressions.FindType);
    const kind = ft ? upper(ft.concatTokens()) : "";
    if (kind && kind !== "REGEX") throw new Unsupported(`FIND ${kind}`);
    const [pat, subj] = node.findDirectExpressions(Expressions.Source);
    const targets = [];
    let mode = null;
    const out = {s: "find", regex: kind === "REGEX", pattern: convert(source(pat, ctx), S), subject: convert(source(subj, ctx), S),
      icase: /\bIGNORING\s+CASE\b/i.test(text), subs: [], off: null, len: null};
    for (let i = 0; i < kids.length; i += 1) {
      const w = words[i];
      if (w === "SUBMATCHES") { mode = "sub"; continue; }
      if (w === "MATCH" && words[i + 1] === "OFFSET") { mode = "off"; i += 1; continue; }
      if (w === "MATCH" && words[i + 1] === "LENGTH") { mode = "len"; i += 1; continue; }
      if (w) { mode = null; continue; }
      if (!isExpr(kids[i], Expressions.Target) || mode === null) continue;
      const t = lvalue(kids[i], ctx);
      if (mode === "sub") {
        if (!charlike(t.type)) throw new Unsupported(`SUBMATCHES into a ${t.type.k}`);
        out.subs.push({target: t, value: convert({e: "temp", name: `fsub[${out.subs.length}]`, type: S}, t.type)});
      } else {
        if (t.type.k !== "i") throw new Unsupported(`MATCH ${mode === "off" ? "OFFSET" : "LENGTH"} into a ${t.type.k}`);
        out[mode] = t;
      }
    }
    void targets;
    return out;
  }
  if (isStmt(node, Statements.Clear)) return {s: "clear", target: lvalue(node.findDirectExpression(Expressions.Target), ctx)};
  // FREE is CLEAR that also gives the memory back, which a GC does anyway
  if (isStmt(node, Statements.Free)) return {s: "seq", body: node.findDirectExpressions(Expressions.Target).map((t) => ({s: "clear", target: lvalue(t, ctx)}))};
  // WRITE goes to a list; in an APC or HTTP handler nobody ever displays it
  // WRITE is a no-op here, except the transpiler runtime's host code: open-abap-core
  // writes its kernel parts in JS as WRITE '@KERNEL ...', and skipping one would
  // run the ABAP around it on values nobody set
  if (isStmt(node, Statements.Write)) {
    if (/'@KERNEL/i.test(node.concatTokens())) throw new Unsupported(`@KERNEL: host code of the transpiler runtime`);
    return {s: "nop"};
  }
  throw new Unsupported(`statement ${node.get().constructor.name}: ${text}`);
}

function initialValue(node, ctx) {
  const name = upper(node.findFirstExpression(Expressions.DefinitionName).concatTokens());
  const type = ctx.locals.get(name);
  if (type === undefined) throw new Unsupported(`${name}: a VALUE for something that is not a local`);
  const val = node.findFirstExpression(Expressions.Value);
  const src = val?.getChildren().find((c) => !isTok(c));
  if (src === undefined) throw new Unsupported(`VALUE of ${name}`);
  let v;
  if (isExpr(src, Expressions.Constant)) v = sourceOperand(src, ctx);
  else if (isExpr(src, Expressions.SimpleFieldChain) || isExpr(src, Expressions.FieldChain)) v = fieldChain(src, ctx);
  else throw new Unsupported(`VALUE ${src.concatTokens()} of ${name}`);
  if (type.k === "struct" || type.k === "table") throw new Unsupported(`VALUE for a ${type.k}`);
  return {s: "assign", target: {e: "var", name, type}, value: convert(v, type)};
}

/* ------------------------------------------------------------ names, lvalues */

/**
 * Where an ABAP name lives: a local, a parameter (EXPORTING and CHANGING are
 * pointers in Go), an attribute of the instance, a static attribute or a
 * constant. The IR says which; the backend spells it.
 */
function variable(name, ctx) {
  const n = upper(name);
  // me as a value: the object itself (in Go its most-derived self)
  if (n === "ME") return {e: "me", type: {k: "ref", name: ctx.className}};
  if (ctx.fieldSymbols?.has(n)) return {e: "fs", name: n, type: ctx.fieldSymbols.get(n)};
  const p = ctx.sig.params.find((x) => x.name === n);
  // ref: a pointer in Go; box: an EXPORTING / CHANGING box in JS (an
  // IMPORTING table or structure is a pointer in Go and the object itself in JS)
  if (p) return {e: "var", name: n, type: p.type, ref: p.dir !== "importing" || byRef(p), box: p.dir !== "importing"};
  if (ctx.sig.returning?.name === n) return {e: "var", name: n, type: ctx.sig.returning.type};
  if (ctx.locals.has(n)) return {e: "var", name: n, type: ctx.locals.get(n)};
  const attr = findAttribute(ctx, n);
  if (attr) return attr;
  throw new Unsupported(`${ctx.method}: ${name} is not a local, parameter or attribute of the subset`);
}

function findAttribute(ctx, n) {
  if (n === "ME" || n === "SUPER") return undefined;
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
  if (id.getMeta().includes("static")) return {e: "static", go: goName(`${declaringClass(ctx.reg, ctx.className, n, "attr") ?? ctx.className}=>${n}`), type};
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
  } else if (upper(first.concatTokens()) === "ME" && isTok(kids[1], "->")) {
    const a = findAttribute(ctx, upper(kids[2].concatTokens()));
    if (a === undefined) throw new Unsupported(`me->${kids[2].concatTokens()}: not an attribute`);
    place = a;
    i = 3;
  } else if (isExpr(first, Expressions.TargetField) || isExpr(first, Expressions.TargetFieldSymbol)) {
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
    if (isExpr(kids[i], Expressions.TableExpression)) {
      place = rowOf(place, kids[i], ctx);
    } else if (isTok(kids[i], "->") && isExpr(kids[i + 1], Expressions.AttributeName)) {
      place = refAttribute(place, kids[i + 1], ctx);
      i += 1;
    } else if (isTok(kids[i], "-") && isExpr(kids[i + 1], Expressions.ComponentName)) {
      const f = fieldOf(ctx, place.type, kids[i + 1].concatTokens(), target.concatTokens());
      place = {e: "field", base: place, name: f.name, type: f.type};
      i += 1;
    } else {
      throw new Unsupported(`target ${target.concatTokens()}`);
    }
  }
  return place;
}

/** ref->attr: an instance attribute of the class a reference points to */
function refAttribute(base, attrNode, ctx) {
  if (base.type.k !== "ref" || base.type.intf) throw new Unsupported(`-> on a ${base.type.k === "ref" ? "interface reference" : base.type.k}`);
  const name = upper(attrNode.concatTokens());
  const a = [base.type.name, ...ancestors(ctx.reg, base.type.name)].map((c) => ctx.reg.getObject("CLAS", c)?.getDefinition()?.getAttributes().getInstance()
    .find((x) => upper(x.getName()) === name)).find(Boolean);
  if (a === undefined) throw new Unsupported(`${base.type.name}->${name}: not an instance attribute`);
  return {e: "refattr", base, name, type: typeOf(a.getType(), `${base.type.name}->${name}`, ctx.program)};
}

/** tab[ n ]: the row at an index; a missing row raises CX_SY_ITAB_LINE_NOT_FOUND */
function rowOf(place, te, ctx) {
  if (place.type.k !== "table") throw new Unsupported(`a table expression on a ${place.type.k}`);
  const inner = te.getChildren().filter((c) => !isTok(c));
  if (inner.length !== 1 || !isExpr(inner[0], Expressions.Source)) throw new Unsupported(`table expression with a key: ${te.concatTokens()}`);
  return {e: "row", base: place, index: convert(source(inner[0], ctx, I), I), type: place.type.row};
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
    if (isTok(k) && ["XSDBOOL", "BOOLC"].includes(upper(tokenStr(k))) && isTok(kids[i + 1], "(") && isExpr(kids[i + 2], Expressions.Cond)) {
      out.push({bool: upper(tokenStr(k)), cond: kids[i + 2]});
      i += 3;
    } else if (isTok(k) && CONSTRUCTORS.has(upper(tokenStr(k))) && isExpr(kids[i + 1], Expressions.TypeNameOrInfer)) {
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
      else if (it.bool) out.push(it.bool === "BOOLC" ? S : C(1));
      else if (it.group) walk(it.group);
      else if (it.node && isExpr(it.node, Expressions.Source)) walk(it.node);
      else if (it.node) out.push(sourceOperand(it.node, ctx).type);
    }
  };
  walk(node);
  return out;
}

const BIT_OPS = new Set(["BIT-AND", "BIT-OR", "BIT-XOR"]);
const hasBitOp = (node) => node.getChildren().some((c) => (isExpr(c, Expressions.ArithOperator) && BIT_OPS.has(upper(c.concatTokens())))
  || (isExpr(c, Expressions.Source) && hasBitOp(c)));
const hasPow = (node) => node.getChildren().some((c) => (isExpr(c, Expressions.ArithOperator) && c.concatTokens() === "**")
  || (isExpr(c, Expressions.Source) && hasPow(c)));
const hasArith = (node) => node.getChildren().some((c) => isExpr(c, Expressions.ArithOperator)
  || (isExpr(c, Expressions.Source) && hasArith(c)));

/**
 * One Source as IR. When it is arithmetic, every operator runs in the
 * calculation type of all its leaves plus `outer` (the target, or the other
 * side of a comparison), as ABAP computes it.
 */
function source(node, ctx, outer, hint = outer) {
  if (!hasArith(node)) return arith(node, ctx, undefined, hint);
  const bits = hasBitOp(node);
  if (bits) {
    // BIT-AND / BIT-OR / BIT-XOR of two x fields of one length, byte by byte
    const leaves = leafTypes(node, ctx);
    if (!leaves.every((t) => t.k === "x" && t.len === leaves[0].len)) {
      throw new Unsupported(`bit operation on other than x fields of one length: ${node.concatTokens()}`);
    }
    return arith(node, ctx, leaves[0]);
  }
  // an x target computes as i and the i result is converted into it
  // (measured on A4H 2026-09-23 for i MOD 256 into x LENGTH 1: 255 and -1
  // both give FF, 300 gives 2C)
  const target = outer?.k === "x" ? I : outer;
  const types = [...leafTypes(node, ctx), ...(target === undefined ? [] : [target])];
  // ** computes in f when the operands are integers (measured on A4H:
  // 2 ** 31 into i overflows "converting from '2.14748e+09'")
  if (types.some((t) => t.k === "f") || hasPow(node)) return arith(node, ctx, F);
  if (types.some((t) => t.k === "c" || t.k === "string" || t.k === "x")) {
    throw new Unsupported(`calculation type p (a character operand and no f): ${node.concatTokens()}`);
  }
  if (types.some((t) => t.k === "int8")) return arith(node, ctx, INT8);
  if (types.every((t) => t.k === "i")) return arith(node, ctx, I);
  throw new Unsupported(`calculation type of ${node.concatTokens()}`);
}

function arith(node, ctx, calc, hint) {
  const its = items(node);
  let negate = false;
  while (its.length > 0 && its[0].sign !== undefined) {
    if (its.shift().sign === "-") negate = !negate;
  }
  const value = (item, t) => {
    if (item.ctor) { const v = constructor(item.ctor, ctx, item.hint); return t === undefined ? v : convert(v, t); }
    if (item.bool) {
      // xsdbool: a c(1) 'X' or blank; boolc: a string 'X' or ' '
      const v = {e: "bool", cond: cond(item.cond, ctx), blank: item.bool === "BOOLC" ? " " : "", type: item.bool === "BOOLC" ? S : C(1)};
      return t === undefined ? v : convert(v, t);
    }
    if (item.group !== undefined) return arith(item.group, ctx, t);
    if (isExpr(item.node, Expressions.Source)) return arith(item.node, ctx, t);
    const v = sourceOperand(item.node, ctx, item.hint);
    return t === undefined ? v : convert(v, t);
  };
  let expr;
  if (its.length === 3 && its[1].concat) {
    expr = {e: "concat", l: convert(value(its[0]), S), r: convert(value(its[2]), S), type: S};
  } else if (its.length === 3 && its[1].op !== undefined) {
    const op = its[1].op;
    if (calc === undefined) throw new Unsupported(`arithmetic without a calculation type: ${node.concatTokens()}`);
    if (op === "**" && calc.k !== "f") throw new Unsupported(`** with calculation type ${calc.k}`);
    if (BIT_OPS.has(op) !== (calc.k === "x")) throw new Unsupported(`${op} with calculation type ${calc.k}`);
    expr = {e: "bin", op, l: value(its[0], calc), r: value(its[2], calc), type: calc};
  } else if (its.length === 1) {
    // a lone constructor takes its # from where the value goes
    expr = value({...its[0], hint}, calc);
  } else {
    throw new Unsupported(`expression shape: ${node.concatTokens()}`);
  }
  if (!negate) return expr;
  if (!numeric(expr.type)) throw new Unsupported("unary minus on a non-number");
  return {e: "neg", x: expr, type: expr.type};
}

/** one operand: a field chain, a literal, a call, a template, a constructor */
function sourceOperand(n, ctx, hint) {
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
  if (isExpr(n, Expressions.MethodCallChain)) return call(n, ctx, false, hint);
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
  } else if ((isTok(kids[0], "ME") || upper(kids[0].concatTokens()) === "ME") && isTok(kids[1], "->")) {
    place = {e: "attr", name: upper(kids[2].concatTokens()), type: findAttribute(ctx, upper(kids[2].concatTokens()))?.type};
    if (place.type === undefined) throw new Unsupported(`me->${kids[2].concatTokens()}: not an attribute`);
    i = 3;
  } else if (isExpr(kids[0], Expressions.SourceField) || isExpr(kids[0], Expressions.SourceFieldSymbol)) {
    place = variable(kids[0].concatTokens(), ctx);
    i = 1;
  } else if (isTok(kids[0], "ME") || (isExpr(kids[0], Expressions.SourceField) && upper(kids[0].concatTokens()) === "ME")) {
    place = {e: "attr", name: upper(kids[2].concatTokens()), type: findAttribute(ctx, upper(kids[2].concatTokens())).type};
    i = 3;
  } else {
    throw new Unsupported(`field chain ${n.concatTokens()}`);
  }
  for (; i < kids.length; i += 1) {
    if (isExpr(kids[i], Expressions.TableExpression)) {
      place = rowOf(place, kids[i], ctx);
    } else if (isTok(kids[i], "-") && isExpr(kids[i + 1], Expressions.ComponentName)) {
      const f = fieldOf(ctx, place.type, kids[i + 1].concatTokens(), n.concatTokens());
      place = {e: "field", base: place, name: f.name, type: f.type};
      i += 1;
    } else if (isTok(kids[i], "->") && isExpr(kids[i + 1], Expressions.AttributeName) && place.type.k === "ref") {
      place = refAttribute(place, kids[i + 1], ctx);
      i += 1;
    } else if (isTok(kids[i], "->") && upper(kids[i - 1].concatTokens()) === "ME") {
      place = {e: "attr", name: upper(kids[i + 1].concatTokens()), type: findAttribute(ctx, upper(kids[i + 1].concatTokens())).type};
      i += 1;
    } else if (isExpr(kids[i], Expressions.FieldOffset) || isExpr(kids[i], Expressions.FieldLength)) {
      const off = isExpr(kids[i], Expressions.FieldOffset) ? offsetValue(kids[i], ctx) : null;
      if (off !== null) i += 1;
      const len = isExpr(kids[i], Expressions.FieldLength) ? offsetValue(kids[i], ctx) : null;
      if (i < kids.length - 1) throw new Unsupported(`field chain ${n.concatTokens()}`);
      return substring(place, off, len, n);
    } else {
      throw new Unsupported(`field chain ${n.concatTokens()}`);
    }
  }
  return place;
}

/** the number after + or inside ( ) of v+off(len); null for (*) */
function offsetValue(node, ctx) {
  const v = node.getChildren()[1];
  if (isTok(v, "*")) return null;
  if (v instanceof Nodes.TokenNode) {
    if (!/^\d+$/.test(tokenStr(v))) throw new Unsupported(`offset ${node.concatTokens()}`);
    return {e: "int", value: Number(tokenStr(v)), type: I};
  }
  return convert(fieldChain(v, ctx), I);
}

/**
 * v+off(len): characters of a string or c, bytes of an xstring or x. Out of
 * range raises CX_SY_RANGE_OUT_OF_BOUNDS. A c field is read as its full
 * length (trailing blanks included) and the part is stored trimmed again.
 */
function substring(base, off, len, node) {
  const k = base.type.k;
  if (!["string", "c", "xstring", "x"].includes(k)) throw new Unsupported(`offset on a ${k}: ${node.concatTokens()}`);
  const litLen = len?.e === "int" ? len.value : undefined;
  const type = k === "string" ? S : k === "xstring" ? XS : k === "c" ? C(litLen ?? base.type.len) : X(litLen ?? base.type.len);
  return {e: "substr", x: base, off, len, base: base.type, type};
}

const CHAR_UTILITIES = {NEWLINE: "\n", CR_LF: "\r\n", HORIZONTAL_TAB: "\t"};

/** zif_x=>c_y or zcl_x=>attr */
function resolveStatic(owner, attr, ctx) {
  if (owner === "CL_ABAP_CHAR_UTILITIES" && CHAR_UTILITIES[attr] !== undefined) return {e: "chars", value: CHAR_UTILITIES[attr], type: C(1)};
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
  const local = ctx.scope.findType?.(t) ?? ctx.reg.getObject("CLAS", ctx.className)?.getDefinition()?.getTypeDefinitions().getByName(t);
  if (local !== undefined) return typeOf(local.getType(), text, ctx.program);
  if (ctx.reg.getObject("CLAS", t) || ctx.reg.getObject("INTF", t)) return {k: "ref", name: t, intf: ctx.reg.getObject("INTF", t) !== undefined};
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
  if (c.kw === "COND") {
    const to = namedType(c.typeNode, ctx, inferred);
    const kids = c.body?.getChildren() ?? [];
    const branches = [];
    let otherwise = null;
    for (let i = 0; i < kids.length; i += 1) {
      if (isTok(kids[i], "WHEN")) {
        const cnd = cond(kids[i + 1], ctx);
        if (!isTok(kids[i + 2], "THEN")) throw new Unsupported(`COND shape: ${c.text}`);
        branches.push({cond: cnd, value: convert(source(kids[i + 3], ctx, to), to)});
        i += 3;
      } else if (isTok(kids[i], "ELSE")) {
        otherwise = convert(source(kids[i + 1], ctx, to), to);
        i += 1;
      } else {
        throw new Unsupported(`COND part ${kids[i].concatTokens()}: ${c.text}`);
      }
    }
    return {e: "cond", branches, else: otherwise, type: to};
  }
  if (c.kw === "CAST") {
    const to = namedType(c.typeNode, ctx, inferred);
    if (!c.body || !isExpr(c.body, Expressions.Source)) throw new Unsupported(`CAST form: ${c.text}`);
    return downCast(source(c.body, ctx), to, c.text);
  }
  if (c.kw === "NEW") {
    const to = namedType(c.typeNode, ctx, inferred);
    if (to.k !== "ref") throw new Unsupported(`NEW of a ${to.k}: ${c.text}`);
    if (!ctx.program.wanted.has(to.name)) throw new Unsupported(`NEW ${to.name}: the class is not compiled in this program`);
    const sig = constructorSignature(ctx, to.name);
    const given = new Map();
    const body = c.body;
    if (body !== null) {
      if (isExpr(body, Expressions.Source)) {
        const imp = sig.filter((p) => p.dir === "importing");
        given.set(imp.find((p) => p.default === undefined)?.name ?? imp[0]?.name, body);
      } else {
        for (const p of body.findAllExpressions(Expressions.ParameterS)) {
          given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
        }
      }
    }
    const args = sig.map((p) => {
      const src = given.get(p.name);
      if (src === undefined) {
        if (p.default !== undefined) return {dir: "importing", byValue: p.byValue, type: p.type, value: defaultValue(p, ctx)};
        if (p.optional) return {dir: "importing", byValue: p.byValue, type: p.type, value: {e: "zero", type: p.type}};
        throw new Unsupported(`NEW ${to.name}: ${p.name} not supplied`);
      }
      return {dir: "importing", byValue: p.byValue, type: p.type, value: convert(source(src, ctx, p.type), p.type)};
    });
    return {e: "new", cls: to.name, args, type: to};
  }
  throw new Unsupported(`${c.kw} constructor expression`);
}

/**
 * The signature of a method of any class or interface of the registry, by
 * owner and name ("M", or "I~M" for an interface method). Cached; an
 * untypeable signature is a named refusal at the call.
 */
function methodSignature(ctx, owner, name) {
  const key = `${owner}=>${name}`;
  if (ctx.program.sigs.has(key)) return ctx.program.sigs.get(key);
  let sig;
  try {
    const [intf, meth] = name.includes("~") ? name.split("~") : [null, name];
    const defOwner = intf ?? owner;
    const def = ctx.reg.getObject("INTF", defOwner)?.getDefinition() ?? ctx.reg.getObject("CLAS", defOwner)?.getDefinition();
    if (def === undefined) throw new Unsupported(`${defOwner} is not in the program`);
    const m = intf ? Array.from((() => { const all = def.getMethodDefinitions(); return Array.isArray(all) ? all : all.getAll(); })()).find((x) => upper(x.getName()) === meth)
      : declaredMethod(ctx.reg, defOwner, meth);
    if (m === undefined) throw new Unsupported(`${defOwner} has no method ${meth}`);
    const p = m.getParameters();
    const optional = new Set((p.getOptional?.() ?? []).map(upper));
    const param = (x, dir) => ({name: upper(x.getName()), dir, byValue: x.getMeta().includes("pass_by_value"), type: typeOf(x.getType(), key, ctx.program), default: defaultOf(p, x),
      optional: optional.has(upper(x.getName()))});
    const ret = p.getReturning();
    sig = {name, static: m.isStatic?.() ?? false,
      params: [...p.getImporting().map((x) => param(x, "importing")), ...p.getExporting().map((x) => param(x, "exporting")),
        ...p.getChanging().map((x) => param(x, "changing"))],
      returning: ret === undefined ? null : {name: upper(ret.getName()), type: typeOf(ret.getType(), key, ctx.program)}};
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    sig = {name, unsupported: e.message};
  }
  ctx.program.sigs.set(key, sig);
  return sig;
}

/** the superclasses of a class, nearest first, as far as the registry has them */
export function ancestors(reg, cls) {
  const out = [];
  for (let c = reg.getObject("CLAS", cls)?.getDefinition()?.getSuperClass(), g = 0; c && g < 30; g += 1) {
    out.push(upper(c));
    c = reg.getObject("CLAS", c)?.getDefinition()?.getSuperClass();
  }
  return out;
}

/** the definition of a method as a class has it: its own, else the nearest
 * superclass's; a REDEFINITION declares no parameters, so its origin's */
function declaredMethod(reg, cls, meth) {
  for (const c of [cls, ...ancestors(reg, cls)]) {
    const m = reg.getObject("CLAS", c)?.getDefinition()?.getMethodDefinitions().getAll().find((x) => upper(x.getName()) === meth);
    if (m && !m.isRedefinition()) return m;
  }
  return undefined;
}

/** the class in cls's chain, itself first, that declares a method or attribute */
function declaringClass(reg, cls, name, kind) {
  for (const c of [cls, ...ancestors(reg, cls)]) {
    const def = reg.getObject("CLAS", c)?.getDefinition();
    if (!def) return undefined;
    const has = kind === "method" ? def.getMethodDefinitions().getAll().some((x) => upper(x.getName()) === name && !x.isRedefinition())
      : def.getAttributes().getAll().some((x) => upper(x.getName()) === name);
    if (has) return c;
  }
  return undefined;
}

/**
 * CREATE OBJECT o [TYPE cls | TYPE (name)] [EXPORTING ...]. A static class
 * is NEW. A class given by name goes through the program's class registry and
 * takes no arguments. The runtime checks that the result fits o, as the kernel
 * does: CX_SY_CREATE_OBJECT_ERROR for an unknown class, CX_SY_MOVE_CAST_ERROR
 * for one that does not fit.
 */
function createObject(node, ctx) {
  const text = node.concatTokens();
  const target = lvalue(node.findDirectExpression(Expressions.Target), ctx);
  if (target.type.k !== "ref") throw new Unsupported(`CREATE OBJECT into a ${target.type.k}`);
  const params = node.findDirectExpression(Expressions.ParameterListS);
  if (node.findDirectExpression(Expressions.ParameterListExceptions)) throw new Unsupported(`CREATE OBJECT with EXCEPTIONS: ${text}`);
  const dyn = node.findDirectExpression(Expressions.Dynamic);
  if (dyn) {
    if (params) throw new Unsupported(`CREATE OBJECT by name with EXPORTING: ${text}`);
    const inner = dyn.getChildren().filter((c) => !isTok(c));
    if (inner.length !== 1) throw new Unsupported(`CREATE OBJECT TYPE ${dyn.concatTokens()}`);
    return {s: "create_dyn", target, name: convert(sourceOperand(inner[0], ctx), {k: "string"})};
  }
  const clsNode = node.findDirectExpression(Expressions.ClassName);
  if (!clsNode && target.type.intf) throw new Unsupported(`CREATE OBJECT of an interface reference without TYPE: ${text}`);
  const cls = clsNode ? upper(clsNode.concatTokens()) : target.type.name;
  if (!ctx.program.wanted.has(cls)) throw new Unsupported(`CREATE OBJECT ${cls}: the class is not compiled in this program`);
  const sig = constructorSignature(ctx, cls);
  const given = new Map();
  for (const p of params?.findAllExpressions(Expressions.ParameterS) ?? []) {
    given.set(upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()), p.findDirectExpression(Expressions.Source));
  }
  const args = sig.map((p) => {
    const src = given.get(p.name);
    if (src === undefined) {
      if (p.default !== undefined) return {dir: "importing", byValue: p.byValue, type: p.type, value: defaultValue(p, ctx)};
      if (p.optional) return {dir: "importing", byValue: p.byValue, type: p.type, value: {e: "zero", type: p.type}};
      throw new Unsupported(`CREATE OBJECT ${cls}: ${p.name} not supplied`);
    }
    return {dir: "importing", byValue: p.byValue, type: p.type, value: convert(source(src, ctx, p.type), p.type)};
  });
  const made = {e: "new", cls, args, type: {k: "ref", name: cls}};
  return {s: "assign", target, value: !target.type.intf && target.type.name === cls ? made : convert(made, target.type)};
}

/** the importing parameters of a class's constructor, read off its definition */
function constructorSignature(ctx, clsName) {
  // a class without a constructor of its own is created through the
  // nearest superclass's
  const def = ctx.reg.getObject("CLAS", declaringClass(ctx.reg, clsName, "CONSTRUCTOR", "method") ?? clsName)?.getDefinition();
  const m = def?.getMethodDefinitions().getByName("CONSTRUCTOR");
  if (m === undefined) return [];
  const p = m.getParameters();
  if (p.getExporting().length + p.getChanging().length > 0) throw new Unsupported(`${clsName} constructor with EXPORTING/CHANGING`);
  const optional = new Set((p.getOptional?.() ?? []).map(upper));
  return p.getImporting().map((x) => ({name: upper(x.getName()), dir: "importing", byValue: x.getMeta().includes("pass_by_value"),
    type: typeOf(x.getType(), `${clsName}=>CONSTRUCTOR`, ctx.program), default: defaultOf(p, x), optional: optional.has(upper(x.getName()))}));
}

function valueBody(body, to, ctx, text) {
  if (to.k === "table") {
    // VALUE #( ( ... ) ( ... ) ): one row per line, a structure or one value
    const rows = [];
    for (const line of body?.getChildren() ?? []) {
      if (!isExpr(line, Expressions.ValueBodyLine)) throw new Unsupported(`VALUE for a table with ${line.concatTokens().slice(0, 30)}`);
      const inner = line.getChildren().filter((c) => !isTok(c));
      if (to.row.k === "struct") rows.push(valueBody(line, to.row, ctx, text));
      else if (inner.length === 1 && isExpr(inner[0], Expressions.Source)) rows.push(convert(source(inner[0], ctx, to.row), to.row));
      else throw new Unsupported(`VALUE table line ${line.concatTokens().slice(0, 30)}`);
    }
    return {e: "table_lit", rows, type: to};
  }
  if (to.k !== "struct") throw new Unsupported(`VALUE for a ${to.k}: ${text}`);
  const fields = [];
  for (const c of body?.getChildren() ?? []) {
    if (isTok(c)) continue;
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
      const v = source(c.findDirectExpression(Expressions.Source), ctx);
      const fmt = c.findDirectExpression(Expressions.StringTemplateFormatting);
      const opts = {};
      if (fmt) {
        const words = fmt.concatTokens().split(/\s*=\s*|\s+/);
        for (let i = 0; i < words.length; i += 2) {
          const k = upper(words[i]);
          const val = words[i + 1];
          if (k === "DECIMALS" && /^\d+$/.test(val) && v.type.k === "f") opts.decimals = Number(val);
          else if (k === "WIDTH" && /^\d+$/.test(val)) opts.width = Number(val);
          else if (k === "ALIGN" && /^(LEFT|RIGHT|CENTER)$/i.test(val)) opts.align = upper(val);
          else if (k === "PAD" && /^'.'$/.test(val)) opts.pad = val.slice(1, 2);
          else throw new Unsupported(`template formatting ${k} = ${val} for a ${v.type.k}`);
        }
      }
      // f: seventeen significant digits, positional, measured on A4H (abap.FmtF)
      if (!["i", "int8", "f", "string", "c", "x", "xstring"].includes(v.type.k)) throw new Unsupported(`${v.type.k} in a string template`);
      parts.push({value: v, opts});
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

function call(chain, ctx, statement, hint) {
  const kids = chain.getChildren();
  // x->get_text( ) of an exception caught INTO x
  if (kids.length === 3 && isTok(kids[1], "->") && isExpr(kids[2], Expressions.MethodCall)) {
    const v = kids[0].concatTokens();
    if (ctx.locals?.get(upper(v))?.k === "exc") {
      if (upper(kids[2].findDirectExpression(Expressions.MethodName).concatTokens()) !== "GET_TEXT") throw new Unsupported(`exception method ${kids[2].concatTokens()}`);
      return {e: "exc_text", x: {e: "var", name: upper(v), type: EXC}, type: S};
    }
  }
  // cl_abap_random_int=>create( [seed] min max )->get_next( ): a system seeds
  // an unseeded generator at random, so a number, not a sequence, is the
  // contract; a SEED makes the sequence the contract and is refused
  if (/^cl_abap_random_int=>create\(.*\)->get_next\(\s*\)$/i.test(chain.concatTokens())) {
    const create = chain.findFirstExpression(Expressions.MethodCall);
    const ps = create.findFirstExpression(Expressions.ParameterListS)?.findDirectExpressions(Expressions.ParameterS) ?? [];
    const arg = (p) => ps.find((x) => upper(x.findDirectExpression(Expressions.ParameterName).concatTokens()) === p)?.findDirectExpression(Expressions.Source);
    if (arg("SEED") || !arg("MIN") || !arg("MAX") || ps.length !== 2) throw new Unsupported(`cl_abap_random_int form: ${chain.concatTokens()}`);
    return {e: "random", min: convert(source(arg("MIN"), ctx, I), I), max: convert(source(arg("MAX"), ctx, I), I), type: I};
  }
  if (isExpr(kids[0], Expressions.NewObject)) {
    if (kids.length !== 1) throw new Unsupported(`a call on a new object: ${chain.concatTokens()}`);
    const nk = kids[0].getChildren();
    const body = nk.slice(3, -1).find((c) => !isTok(c)) ?? null;
    return constructor({kw: "NEW", typeNode: nk[1], body, text: chain.concatTokens()}, ctx, hint);
  }
  let receiver = null;
  let owner = null;
  let sup = null;
  let receiving = null;
  let exceptions = null;
  let mc;
  if (kids.length === 3 && upper(kids[0].concatTokens()) === "SUPER" && isTok(kids[1], "->") && isExpr(kids[2], Expressions.MethodCall)) {
    // SUPER->m( ): the superclass's implementation, not a virtual call
    sup = ancestors(ctx.reg, ctx.className)[0];
    if (!sup || !ctx.program.wanted.has(sup)) throw new Unsupported(`SUPER-> in ${ctx.className}: the superclass is not compiled in this program`);
    mc = kids[2];
  } else if (kids.length === 1 && isExpr(kids[0], Expressions.MethodCall)) {
    mc = kids[0];
  } else if (kids.length === 3 && isExpr(kids[0], Expressions.ClassName) && isTok(kids[1], "=>") && isExpr(kids[2], Expressions.MethodCall)) {
    if (upper(kids[0].concatTokens()) !== ctx.className) owner = upper(kids[0].concatTokens());
    mc = kids[2];
  } else if (kids.length === 3 && upper(kids[0].concatTokens()) === "ME" && isTok(kids[1], "->")) {
    mc = kids[2];
  } else if (kids.length === 3 && isTok(kids[1], "->") && isExpr(kids[2], Expressions.MethodCall)) {
    receiver = isExpr(kids[0], Expressions.FieldChain) || isExpr(kids[0], Expressions.SourceField) ? fieldChain(kids[0], ctx) : null;
    if (receiver === null || receiver.type.k !== "ref") throw new Unsupported(`call through ${kids[0].concatTokens()}`);
    if (!receiver.type.intf && !ctx.program.wanted.has(receiver.type.name)) throw new Unsupported(`call on a ${receiver.type.name}, which is not compiled in this program`);
    owner = receiver.type.name;
    mc = kids[2];
  } else if (kids.length > 3 && isTok(kids[kids.length - 2], "->") && isExpr(kids[kids.length - 1], Expressions.MethodCall)) {
    // a->b( )->c( ): the receiver is what the chain before the last -> returns
    const head = kids.slice(0, -2);
    const prefix = {getChildren: () => head, concatTokens: () => head.map((k) => k.concatTokens()).join(""),
      findFirstExpression: (t) => head.map((k) => (isTok(k) ? undefined : isExpr(k, t) ? k : k.findFirstExpression(t))).find(Boolean)};
    receiver = call(prefix, ctx, false);
    if (receiver.type.k !== "ref") throw new Unsupported(`call through a ${receiver.type.k}: ${chain.concatTokens()}`);
    if (!receiver.type.intf && !ctx.program.wanted.has(receiver.type.name)) throw new Unsupported(`call on a ${receiver.type.name}, which is not compiled in this program`);
    owner = receiver.type.name;
    mc = kids[kids.length - 1];
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
  if (receiver === null && owner === null && ["TO_LOWER", "TO_UPPER"].includes(name) && !ctx.signatures.has(name)) {
    const argNode = direct ?? named?.findDirectExpressions(Expressions.ParameterS).find((p) => upper(p.findDirectExpression(Expressions.ParameterName).concatTokens()) === "VAL")?.findDirectExpression(Expressions.Source);
    return {e: "case_fn", upper: name === "TO_UPPER", x: convert(source(argNode, ctx), S), type: S};
  }
  if (receiver === null && name === "STRLEN" && !ctx.signatures.has(name)) {
    return {e: "strlen", x: source(direct, ctx), type: I};
  }
  if (receiver === null && owner === null && name === "FIND" && !ctx.signatures.has(name)) {
    // find( val = s sub = x [off = n] ): measured on A4H, see abap.Find
    const arg = (p) => named?.findDirectExpressions(Expressions.ParameterS).find((x) => upper(x.findDirectExpression(Expressions.ParameterName).concatTokens()) === p)?.findDirectExpression(Expressions.Source);
    const given = (named?.findDirectExpressions(Expressions.ParameterS) ?? []).map((x) => upper(x.findDirectExpression(Expressions.ParameterName).concatTokens()));
    if (!named || given.some((p) => !["VAL", "SUB", "OFF"].includes(p)) || !arg("VAL") || !arg("SUB")) throw new Unsupported(`find( ) form: ${chain.concatTokens()}`);
    return {e: "find", val: convert(source(arg("VAL"), ctx), S), sub: convert(source(arg("SUB"), ctx), S), off: arg("OFF") ? convert(source(arg("OFF"), ctx, I), I) : null, type: I};
  }
  if (receiver === null && name === "XSTRLEN" && !ctx.signatures.has(name)) {
    const x = source(direct, ctx);
    if (x.type.k !== "xstring" && x.type.k !== "x") throw new Unsupported(`xstrlen( ) of a ${x.type.k}`);
    return {e: "xstrlen", x, type: I};
  }
  // the character of a code point (a blank is the empty c, as stored)
  // the code point of a character; a blank c is stored empty and is 32
  if (owner === "CL_ABAP_CONV_OUT_CE" && name === "UCCPI") return {e: "uccp", x: convert(source(direct, ctx), S), type: I};
  if (receiver === null && owner === null && name === "SUBSTRING" && !ctx.signatures.has(name)) {
    const ps = named?.findDirectExpressions(Expressions.ParameterS) ?? [];
    const arg = (p) => ps.find((x) => upper(x.findDirectExpression(Expressions.ParameterName).concatTokens()) === p)?.findDirectExpression(Expressions.Source);
    if (!arg("VAL") || ps.some((x) => !["VAL", "OFF", "LEN"].includes(upper(x.findDirectExpression(Expressions.ParameterName).concatTokens())))) {
      throw new Unsupported(`substring( ) form: ${chain.concatTokens()}`);
    }
    const val = convert(source(arg("VAL"), ctx), S);
    return {e: "substr", x: val, base: S, off: arg("OFF") ? convert(source(arg("OFF"), ctx, I), I) : null,
      len: arg("LEN") ? convert(source(arg("LEN"), ctx, I), I) : null, type: S};
  }
  if (owner === "CL_ABAP_CONV_IN_CE" && name === "UCCPI") return {e: "uccpi", x: convert(source(direct, ctx), I), type: C(1)};
  // an ALIASES name is the component it stands for; through an interface
  // reference, a method is otherwise the interface's own: I~M
  const alias = owner !== null && !name.includes("~") ? aliasTarget(ctx.reg, owner, name)
    : owner === null && !name.includes("~") && !ctx.signatures.has(name) ? aliasTarget(ctx.reg, ctx.className, name) : undefined;
  const qualified = alias ?? (owner !== null && receiver?.type.intf && !name.includes("~") ? `${owner}~${name}` : name);
  let sig;
  if (sup !== null && name === "CONSTRUCTOR") {
    const at = declaringClass(ctx.reg, sup, "CONSTRUCTOR", "method");
    sig = {name, static: false, params: at ? constructorSignature(ctx, at) : [], returning: null, none: !at};
  } else if (sup !== null) {
    sig = methodSignature(ctx, sup, name);
  } else if (owner === null && !ctx.signatures.has(name) && !alias) {
    // a method the class inherits: resolved where it is declared
    const at = declaringClass(ctx.reg, ctx.className, name, "method");
    if (at === undefined || at === ctx.className) throw new Unsupported(`unknown method ${name}`);
    if (declaredMethod(ctx.reg, at, name)?.getVisibility?.() === 1) throw new Unsupported(`${name} is private in ${at}`);
    sig = methodSignature(ctx, at, name);
    if (sig.static) owner = at;
  } else {
    sig = owner === null ? ctx.signatures.get(qualified) : methodSignature(ctx, owner, qualified);
  }
  // a static method named through a subclass is the declaring class's function
  if (owner !== null && receiver === null && sig?.static && !qualified.includes("~")) owner = declaringClass(ctx.reg, owner, name, "method") ?? owner;
  if (sig === undefined) throw new Unsupported(`unknown method ${name}`);
  if (sig.unsupported) throw new Unsupported(`${owner ? owner + "=>" : ""}${name} was skipped: ${sig.unsupported}`);
  if (!statement && sig.returning === null) throw new Unsupported(`${name} has no RETURNING, cannot be an operand`);
  if (owner !== null && receiver === null && !sig.static) throw new Unsupported(`${owner}=>${name}: an instance method called statically`);
  if (owner !== null && receiver === null && !ctx.program.wanted.has(owner)) throw new Unsupported(`${owner}=>${name}: ${owner} is not compiled in this program`);
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
    const kidsP = full.getChildren();
    // RECEIVING r = x: the RETURNING value into x
    const ri = kidsP.findIndex((k) => isTok(k, "RECEIVING"));
    if (ri >= 0) receiving = lvalue(kidsP[ri + 1].findDirectExpression(Expressions.Target), ctx);
    // EXCEPTIONS name = n ... OTHERS = n: a classic exception of the method
    // called ends it, and sy-subrc says which
    const exl = full.findDirectExpression(Expressions.ParameterListExceptions);
    if (exl) {
      exceptions = {map: {}, others: 0};
      for (const x of exl.findDirectExpressions(Expressions.ParameterException)) {
        const v = x.findDirectExpression(Expressions.Integer);
        if (!v) throw new Unsupported(`EXCEPTIONS with a value that is not a number: ${x.concatTokens()}`);
        const nm = x.findDirectExpression(Expressions.ParameterName);
        if (nm) exceptions.map[upper(nm.concatTokens())] = Number(v.concatTokens());
        else exceptions.others = Number(v.concatTokens());
      }
    }
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
        if (p.default !== undefined) return {dir: "importing", byValue: p.byValue, type: p.type, value: defaultValue(p, ctx)};
        if (p.optional) return {dir: "importing", byValue: p.byValue, type: p.type, value: {e: "zero", type: p.type}};
        throw new Unsupported(`${name}: parameter ${p.name} not supplied`);
      }
      return {dir: "importing", byValue: p.byValue, type: p.type, value: convert(source(s, ctx, p.type), p.type)};
    }
    const t = targets.get(p.name);
    if (t === undefined) return {dir: p.dir, place: null, type: p.type};
    if (!sameType(t.type, p.type)) throw new Unsupported(`${name}: IMPORTING ${p.name} into a ${t.type.k}, the parameter is ${p.type.k}`);
    return {dir: p.dir, place: t, type: p.type};
  });
  if (owner === null && !sig.static && ctx.sig.static) throw new Unsupported(`${name}: an instance method called from a static one`);
  if (owner === null && sup === null) (ctx.calls = ctx.calls ?? []).push(name);
  if ((exceptions || receiving) && !statement) throw new Unsupported(`RECEIVING / EXCEPTIONS in an expression: ${chain.concatTokens()}`);
  if (receiving && (sig.returning === null || !sameType(receiving.type, sig.returning.type))) throw new Unsupported(`RECEIVING into a ${receiving.type.k}: ${chain.concatTokens()}`);
  // SUPER->constructor( ) of a chain where no superclass has a constructor does nothing
  if (sig.none) return {e: "nop_call", type: {k: "void"}};
  return {e: "call", method: qualified, static: sig.static, owner, receiver, sup, args, type: sig.returning?.type ?? {k: "void"},
    exceptions, receiving, callee: name.includes("~") ? name.split("~")[1] : name};
}

function defaultValue(p, ctx) {
  const t = p.default;
  if (/^-?\d+$/.test(t)) return convert({e: "int", value: Number(t), type: I}, p.type);
  if (/^'.*'$/s.test(t)) return convert({e: "chars", value: t.slice(1, -1), type: C(Math.max(1, t.length - 2))}, p.type);
  if (/^abap_true$/i.test(t)) return convert({e: "chars", value: "X", type: C(1)}, p.type);
  if (/^abap_false$/i.test(t)) return convert({e: "chars", value: "", type: C(1)}, p.type);
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
  // i -> string, measured on A4H: the digits and then a place for the sign,
  // 42 is "42 ", -5 is "5-" (a template writes -5; a move does not)
  if (to.k === "string" && from.k === "i") return ok("i2s");
  if (to.k === "x" && from.k === "i") return ok("i2x");
  // x <-> xstring: the bytes; into x LENGTH n cut or padded right with 00
  if (to.k === "x" && (from.k === "xstring" || from.k === "x")) return ok("xs2x");
  if (to.k === "xstring" && from.k === "x") return {...expr, type: to};
  // x -> i: an x shorter than four bytes is filled with 00 on the left, so
  // it reads unsigned (measured on A4H: FF gives 255); four and more bytes
  // are not measured
  if (to.k === "i" && from.k === "x" && from.len < 4) return ok("x2i");
  if (numeric(to) && charlike(from)) return ok("c2n");
  if (to.k === "table" && from.k === "table" && sameType(from.row, to.row)) return expr;
  if (from.k === "ref" && to.k === "ref") {
    // up-cast: a class into an interface it implements, or any reference into
    // the same interface; a down-cast needs CAST and is refused
    if (to.intf && implementsIntf(expr, from.name, to.name)) return {e: "upcast", x: expr, type: to};
    if (!to.intf && !from.intf && REG && ancestors(REG, from.name).includes(to.name)) return {e: "upcast", x: expr, type: to};
    throw new Unsupported(`reference ${from.name} -> ${to.name}`);
  }
  throw new Unsupported(`conversion ${from.k} -> ${to.k}`);
}

/** a ?= b and CAST: to a class or interface reference, checked at run time
 * (CX_SY_MOVE_CAST_ERROR); an up-cast needs no check */
function downCast(x, to, text) {
  if (x.type.k !== "ref" || to.k !== "ref") throw new Unsupported(`cast of a ${x.type.k} to a ${to.k}: ${text}`);
  try { return convert(x, to); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
  return {e: "cast", x, type: to};
}

let REG = null;
function implementsIntf(expr, cls, intf) {
  if (cls === intf) return true;
  for (const c of [cls, ...(REG ? ancestors(REG, cls) : [])]) {
    const def = REG?.getObject("CLAS", c)?.getDefinition() ?? REG?.getObject("INTF", c)?.getDefinition();
    if ((def?.getImplementing?.() ?? []).some((i) => upper(i.name) === intf)) return true;
  }
  return false;
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
  // only a leading NOT negates the whole comparison; the NOT of IS NOT
  // INITIAL / IS NOT BOUND is read from the text below (counting both made
  // `x IS NOT INITIAL` true for an empty x)
  const not = kids.length > 0 && isTok(kids[0], "NOT");
  const sources = node.findDirectExpressions(Expressions.Source);
  const text = upper(node.concatTokens());
  if (/\bIS\s+(NOT\s+)?BOUND\b/.test(text) && sources.length === 1) {
    const v = source(sources[0], ctx);
    if (v.type.k !== "ref") throw new Unsupported(`IS BOUND of a ${v.type.k}`);
    const r = {c: "initial", x: v};
    return /\bIS\s+NOT\s+BOUND\b/.test(text) !== not ? r : {c: "not", x: r};
  }
  if (/\bIS\s+(NOT\s+)?INITIAL\b/.test(text) && sources.length === 1) {
    const v = source(sources[0], ctx);
    const r = {c: "initial", x: v};
    return /\bIS\s+NOT\s+INITIAL\b/.test(text) !== not ? {c: "not", x: r} : r;
  }
  const opNode = node.findDirectExpression(Expressions.CompareOperator);
  if (sources.length !== 2 || opNode === undefined) throw new Unsupported(`comparison ${node.concatTokens()}`);
  const opText = upper(opNode.concatTokens());
  const op = OPS[opText] ?? opText;
  if (op === "CO" || op === "CS") {
    // measured on A4H: CO is true for an empty operand; CS ignores case and
    // an empty pattern is always found; trailing blanks count in a string,
    // a c operand has none stored
    const r = {c: op.toLowerCase(), l: convert(source(sources[0], ctx), S), r: convert(source(sources[1], ctx), S)};
    return not ? {c: "not", x: r} : r;
  }
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
